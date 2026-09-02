import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output,
  computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  ConceptoRegla, Ficha, SolicitudHistorica, TesoreriaApiService, VeredictoRegla,
} from '../../service/tesoreria-api.service';

/**
 * La ficha 360 de una persona: todo lo que hace falta para decidir si se le autoriza.
 *
 * <h3>Qué resuelve</h3>
 * Antes el mostrador veía la cédula, el nombre y un cupo calculado en el navegador. Si el
 * sistema decía que no, decía solo que no: para saber si era el tope, una ventana de
 * fecha, un mercado sin recoger o un bloqueo viejo había que llamar por teléfono a
 * tesorería.
 *
 * <p>Aquí se ve de una vez cuánto tiene de tope y <b>de dónde sale</b>, cuánto debe y por
 * qué conceptos, qué ha pedido y en qué estado está cada cosa, si está en el padrón de
 * activos y a paz y salvo, sus incapacidades frente al tiempo laborado, y el veredicto de
 * cada regla una por una.
 *
 * <h3>Por qué se muestran las reglas que SÍ cumple</h3>
 * Porque una autorización no es solo "no me dejó": es también "por qué me dejó". Cuando
 * alguien revise una autorización dentro de seis meses, la lista completa es la
 * explicación.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ficha-persona',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './ficha-persona.html',
  styleUrls: ['../../styles/tesoreria-comun.css', './ficha-persona.css'],
})
export class FichaPersona {

  private api = inject(TesoreriaApiService);

  readonly ficha = signal<Ficha | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly concepto = signal<ConceptoRegla>('MERCADO');
  readonly pestana = signal<'condiciones' | 'solicitudes' | 'deuda' | 'padron'>('condiciones');
  /** Reglas que se cumplen: plegadas por defecto, porque lo urgente es lo que falla. */
  readonly verCumplidas = signal(false);

  private documentoActual: string | null = null;

  /** Documento a mostrar. Cambiarlo recarga la ficha. */
  @Input() set documento(doc: string | null) {
    if (!doc) { this.ficha.set(null); this.documentoActual = null; return; }
    this.documentoActual = doc;
    this.cargar();
  }

  /** Sede del autorizador, para que la evaluación la tenga en cuenta. */
  @Input() sede: string | null = null;

  /** Se emite cuando algo cambia y el contenedor debería refrescar sus propios datos. */
  @Output() cambio = new EventEmitter<void>();

  // ── Derivados ─────────────────────────────────────────────────────────────

  readonly evaluacion = computed(() => this.ficha()?.evaluacion ?? null);

  readonly alertasCriticas = computed(() =>
    (this.ficha()?.alertas ?? []).filter(a => a.nivel === 'critica'));

  readonly alertasDeAviso = computed(() =>
    (this.ficha()?.alertas ?? []).filter(a => a.nivel === 'aviso'));

  readonly reglasQueFallan = computed(() =>
    (this.evaluacion()?.reglas ?? []).filter(r => r.estado === 'NO_CUMPLE'));

  readonly reglasSinDatos = computed(() =>
    (this.evaluacion()?.reglas ?? []).filter(r => r.estado === 'SIN_DATOS'));

  readonly reglasQueCumplen = computed(() =>
    (this.evaluacion()?.reglas ?? []).filter(r => r.estado === 'CUMPLE' || r.estado === 'NO_APLICA'));

  readonly solicitudesPendientes = computed(() =>
    (this.ficha()?.solicitudes ?? []).filter(s => s.estado === 'PENDIENTE'));

  readonly desgloseDeuda = computed(() => {
    const d = this.ficha()?.deuda?.desglose ?? {};
    return Object.entries(d).map(([concepto, valor]) => ({ concepto, valor }));
  });

  // ── Acciones ──────────────────────────────────────────────────────────────

  cambiarConcepto(c: ConceptoRegla): void {
    if (this.concepto() === c) return;
    this.concepto.set(c);
    this.cargar();
  }

  recargar(): void { this.cargar(); }

  private cargar(): void {
    const doc = this.documentoActual;
    if (!doc) return;
    this.cargando.set(true);
    this.error.set(null);

    this.api.ficha(doc, this.concepto(), null, null, this.sede).subscribe({
      next: f => { this.ficha.set(f); this.cargando.set(false); },
      error: () => {
        this.error.set('No se pudo cargar la ficha. Revisa la conexión e intenta de nuevo.');
        this.cargando.set(false);
      },
    });
  }

  /**
   * Anula una autorización pendiente y libera su cupo.
   *
   * <p>Hasta ahora no había forma de llegar a este estado desde ninguna pantalla, y por eso
   * se acumularon 3.851 autorizaciones abiertas de meses, cada una reteniendo cupo de
   * alguien que probablemente ya ni recordaba haberla pedido.
   */
  async anular(s: SolicitudHistorica): Promise<void> {
    const { value: motivo, isConfirmed } = await Swal.fire({
      title: 'Anular autorización',
      html: `<p style="text-align:left;margin:0 0 10px">
               <b>${s.codigo_autorizacion}</b><br>
               ${s.concepto} por ${this.pesos(s.monto_autorizado)}
             </p>
             <p style="text-align:left;font-size:13px;color:#5c6660;margin:0 0 12px">
               El cupo vuelve a quedar disponible para la persona.
             </p>`,
      input: 'text',
      inputPlaceholder: '¿Por qué se anula?',
      inputValidator: v => (!v || !v.trim()) ? 'Hay que decir por qué se anula' : null,
      showCancelButton: true,
      confirmButtonText: 'Anular',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#a33328',
    });
    if (!isConfirmed || !motivo) return;

    this.api.anularAutorizacion(s.id, motivo).subscribe({
      next: () => {
        Swal.fire({ icon: 'success', title: 'Autorización anulada',
          text: 'El cupo quedó disponible de nuevo.', timer: 2200, showConfirmButton: false });
        this.cargar();
        this.cambio.emit();
      },
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo anular',
        text: e?.error?.error ?? 'Intenta de nuevo.' }),
    });
  }

  // ── Presentación ──────────────────────────────────────────────────────────

  pesos(v: number | null | undefined): string {
    if (v == null) return '—';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0,
    }).format(v);
  }

  claseDeRegla(r: VeredictoRegla): string {
    if (r.estado === 'NO_CUMPLE') return r.severidad === 'BLOQUEA' ? 'rojo' : 'ambar';
    if (r.estado === 'SIN_DATOS') return 'ambar';
    if (r.estado === 'NO_APLICA') return 'gris';
    return 'verde';
  }

  iconoDeRegla(r: VeredictoRegla): string {
    if (r.estado === 'NO_CUMPLE') return r.severidad === 'BLOQUEA' ? 'block' : 'warning';
    if (r.estado === 'SIN_DATOS') return 'help';
    if (r.estado === 'NO_APLICA') return 'remove';
    return 'check_circle';
  }

  claseDeSolicitud(s: SolicitudHistorica): string {
    if (s.es_reversa) return 'azul';
    if (s.vencida) return 'gris';
    switch (s.estado) {
      case 'PENDIENTE': return 'ambar';
      case 'EJECUTADA': return 'verde';
      case 'ANULADA':   return 'gris';
      default:          return 'gris';
    }
  }

  /** Nombre legible de las columnas de deuda, que en la base son crípticas. */
  nombreDeConcepto(clave: string): string {
    const nombres: Record<string, string> = {
      saldos: 'Saldos',
      fondos: 'Fondo de empleados',
      mercados: 'Mercados',
      prestamo_para_descontar: 'Préstamo por descontar',
      casino: 'Casino',
      valor_anchetas: 'Anchetas',
      fondo: 'Fondo',
      carnet: 'Carné',
      seguro_funerario: 'Seguro funerario',
      prestamo_para_hacer: 'Préstamo programado',
      anticipo_liquidacion: 'Anticipo de liquidación',
      cuentas: 'Cuentas',
    };
    return nombres[clave] ?? clave.replace(/_/g, ' ');
  }

  /**
   * Detalle de la regla en texto plano. Se muestra plegado: el autorizador normalmente
   * necesita el mensaje, y el detalle solo cuando algo no cuadra.
   */
  detalleLegible(r: VeredictoRegla): string[] {
    if (!r.detalle) return [];
    return Object.entries(r.detalle)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}`);
  }
}
