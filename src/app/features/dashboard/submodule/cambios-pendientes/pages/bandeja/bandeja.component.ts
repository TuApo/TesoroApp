import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import {
  CambioDetalle, CambioPendiente, CambiosPendientesService,
} from '../../services/cambios-pendientes.service';

/** Una diferencia concreta entre lo que hay y lo que se propone. */
interface Diferencia { campo: string; actual: string; propuesto: string; }

/**
 * Bandeja de cambios por aprobar.
 *
 * Una ficha que ya pasó por contratación no la sobreescribe el formulario público: lo que la
 * persona manda llega aquí y alguien de oficina decide. Ver `CambioPendienteService` en ms-hr.
 *
 * La pantalla enseña SOLO lo que cambiaría, no el formulario entero: quien revisa tiene que
 * poder decidir en segundos, y una lista de 138 respuestas idénticas esconde justo la que no
 * lo es.
 */
@Component({
  selector: 'app-bandeja-cambios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bandeja.component.html',
  styleUrls: ['./bandeja.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BandejaComponent implements OnInit {
  private readonly api = inject(CambiosPendientesService);

  readonly filas = signal<CambioPendiente[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly estado = signal<'PENDIENTE' | 'APROBADO' | 'RECHAZADO'>('PENDIENTE');
  readonly oficina = signal('');

  readonly abierto = signal<CambioDetalle | null>(null);
  readonly diferencias = signal<Diferencia[]>([]);
  readonly trabajando = signal(false);

  ngOnInit(): void { void this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const r = await this.api.listar(this.estado(), this.oficina().trim() || undefined);
      this.filas.set(r.results ?? []);
      this.total.set(r.count ?? 0);
    } catch {
      this.filas.set([]);
      this.total.set(0);
      await Swal.fire('No se pudo cargar', 'Intente de nuevo en un momento.', 'error');
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarEstado(e: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'): void {
    this.estado.set(e);
    void this.cargar();
  }

  async abrir(fila: CambioPendiente): Promise<void> {
    try {
      const d = await this.api.detalle(fila.id);
      this.abierto.set(d);
      this.diferencias.set(this.compararCon(d));
    } catch {
      await Swal.fire('No se pudo abrir', 'Intente de nuevo.', 'error');
    }
  }

  cerrar(): void {
    this.abierto.set(null);
    this.diferencias.set([]);
  }

  async aprobar(): Promise<void> {
    const d = this.abierto();
    if (!d) return;
    const ok = await Swal.fire({
      title: 'Aplicar estos cambios',
      text: `Se escribirán en la ficha de ${d.nombre || d.numero_documento}. Es la única vía por la que estos datos entran.`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Aplicar', cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;
    await this.resolver(() => this.api.aprobar(d.id), 'Cambios aplicados');
  }

  async rechazar(): Promise<void> {
    const d = this.abierto();
    if (!d) return;
    const r = await Swal.fire({
      title: 'Descartar estos cambios',
      input: 'text',
      inputLabel: 'Motivo (opcional, queda registrado)',
      showCancelButton: true,
      confirmButtonText: 'Descartar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    await this.resolver(() => this.api.rechazar(d.id, r.value || undefined), 'Cambios descartados');
  }

  private async resolver(accion: () => Promise<unknown>, titulo: string): Promise<void> {
    this.trabajando.set(true);
    try {
      await accion();
      this.cerrar();
      await this.cargar();
      await Swal.fire(titulo, '', 'success');
    } catch (e: any) {
      await Swal.fire('No se pudo', e?.error?.error ?? 'Intente de nuevo.', 'error');
    } finally {
      this.trabajando.set(false);
    }
  }

  /** Etiquetas legibles. Lo que no esté aquí se muestra con su nombre técnico. */
  private static readonly ETIQUETAS: Record<string, string> = {
    tipo_doc: 'Tipo de documento', numero_documento: 'Número de documento',
    primer_nombre: 'Primer nombre', segundo_nombre: 'Segundo nombre',
    primer_apellido: 'Primer apellido', segundo_apellido: 'Segundo apellido',
    sexo: 'Sexo', fecha_nacimiento: 'Fecha de nacimiento', estado_civil: 'Estado civil',
    rh: 'Tipo de sangre', departamento: 'Departamento', municipio: 'Municipio',
  };

  /**
   * Compara lo propuesto con lo que hay. Solo campos PLANOS de la ficha: las secciones
   * anidadas (contacto, residencia, hijos…) se listan aparte como "otras secciones", porque
   * compararlas campo a campo daría una tabla ilegible sin ayudar a decidir.
   */
  private compararCon(d: CambioDetalle): Diferencia[] {
    const actual = d.actual ?? {};
    const prop = d.payload ?? {};
    const out: Diferencia[] = [];
    for (const [k, v] of Object.entries(BandejaComponent.ETIQUETAS)) {
      const a = this.txt(actual[k]);
      const p = this.txt(prop[k]);
      // Un campo que el formulario no mandó NO es un borrado: es un campo que no se tocó.
      if (p === '' ) continue;
      if (a !== p) out.push({ campo: v, actual: a || '—', propuesto: p });
    }
    return out;
  }

  /** Secciones anidadas que traen datos, para avisar de que hay más de lo que se lista. */
  seccionesExtra(): string[] {
    const p = this.abierto()?.payload ?? {};
    return Object.entries(p)
      .filter(([, v]) => v && typeof v === 'object' && Object.keys(v).length > 0)
      .map(([k]) => k);
  }

  private txt(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return '';
    return String(v).trim();
  }
}
