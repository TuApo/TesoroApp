import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import {
  PersonaCelebradaAdmin, PersonalizacionCumpleanos, PiezaCelebracion,
} from '../../../../components/celebracion/celebracion.models';
import { CelebracionService } from '../../../../components/celebracion/celebracion.service';
import { fechaLarga } from '../../../../components/celebracion/preparar';

const ESTADOS: Record<string, string> = {
  SOLICITADA: 'En cola', GENERANDO: 'Generando…', LISTA: 'Lista para revisar', APROBADA: 'Aprobada · sale en la celebración',
  FALLIDA: 'Falló', DESCARTADA: 'Descartada',
};

/**
 * Marketing › Cumpleaños › personalizar a una persona: el enlace para que el equipo elija
 * etiquetas, el mensaje de su jefe, y el fondo propio que hace Higgsfield (horizontal y
 * vertical), que se revisa y aprueba antes de salir.
 */
@Component({
  selector: 'app-cumpleanos-personalizacion',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cumpleanos-personalizacion.component.html',
  styleUrls: ['../banners/pestanas-banners.css', './cumpleanos-personalizacion.component.css'],
})
export class CumpleanosPersonalizacionComponent implements OnInit {
  readonly persona = input.required<PersonaCelebradaAdmin>();
  readonly cerrar = output<void>();
  /** Algo cambió (aprobó, generó, escribió): el calendario se recarga al cerrar. */
  readonly cambio = output<void>();
  /** Ver cómo queda en la celebración (lo abre la página con el probador). */
  readonly probar = output<void>();

  private readonly api = inject(CelebracionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly datos = signal<PersonalizacionCumpleanos | null>(null);
  readonly animar = signal(false);
  readonly pidiendo = signal(false);
  readonly mensaje = signal('');
  readonly firma = signal('');
  readonly guardandoMensaje = signal(false);
  readonly estados = ESTADOS;
  private reloj: ReturnType<typeof setInterval> | null = null;

  /** Siempre el de la web: copiado desde el escritorio o el celular, file:// no le sirve a nadie. */
  readonly enlace = computed(() => {
    const e = this.datos()?.enlace;
    if (!e) return null;
    const base = location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.host)
      ? `${location.origin}${location.pathname}` : 'https://tesoro.tuapo.co/';
    return `${base}#${e}`;
  });
  readonly enCurso = computed(() => (this.datos()?.piezas ?? []).some((p) => p.estado === 'SOLICITADA' || p.estado === 'GENERANDO'));
  readonly piezasPorOrientacion = computed(() => {
    const ps = this.datos()?.piezas ?? [];
    return (['H', 'V'] as const).map((o) => ({ o, piezas: ps.filter((p) => p.orientacion === o) }));
  });

  ngOnInit(): void {
    this.cargar();
    this.destroyRef.onDestroy(() => { if (this.reloj) clearInterval(this.reloj); });
  }

  fecha(): string { return fechaLarga(this.persona().fecha); }
  url(u: string | null | undefined): string { return this.api.urlFoto(u); }

  cargar(): void {
    this.api.personalizacion(this.persona().id).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.mensaje.set(d.mensaje_jefe ?? '');
        this.firma.set(d.mensaje_jefe_firma ?? '');
        this.vigilar();
      },
      error: () => Swal.fire('No se pudo cargar', 'Intenta de nuevo.', 'error'),
    });
  }

  /** Mientras algo se genera, se vuelve a mirar cada 15 s. */
  private vigilar(): void {
    if (this.enCurso() && !this.reloj) {
      this.reloj = setInterval(() => this.api.personalizacion(this.persona().id).subscribe({
        next: (d) => { this.datos.set(d); if (!this.enCurso() && this.reloj) { clearInterval(this.reloj); this.reloj = null; this.cambio.emit(); } },
      }), 15000);
    }
  }

  crearEnlace(): void {
    this.api.enlaceAportes(this.persona().id).subscribe({
      next: () => { this.cargar(); this.cambio.emit(); },
      error: () => Swal.fire('No se pudo crear el enlace', 'Intenta de nuevo.', 'error'),
    });
  }

  copiar(): void {
    const e = this.enlace();
    if (!e) return;
    void navigator.clipboard?.writeText(e).then(
      () => Swal.fire({ icon: 'success', title: 'Enlace copiado', text: 'Pégalo en el grupo del equipo.', timer: 1800, showConfirmButton: false }),
      () => Swal.fire('Copia este enlace', e, 'info'));
  }

  whatsapp(): string {
    const p = this.persona();
    const texto = `🎂 El ${this.fecha()} es el cumpleaños de ${p.nombre}. Ayúdanos a celebrarlo: elige cómo es en este enlace 👉 ${this.enlace()}`;
    return `https://wa.me/?text=${encodeURIComponent(texto)}`;
  }

  guardarMensaje(): void {
    this.guardandoMensaje.set(true);
    this.api.editar(this.persona().id, { mensaje_jefe: this.mensaje().trim(), mensaje_jefe_firma: this.firma().trim() }).subscribe({
      next: () => { this.guardandoMensaje.set(false); this.cargar(); this.cambio.emit(); },
      error: (e: HttpErrorResponse) => { this.guardandoMensaje.set(false); Swal.fire('No se pudo guardar', e.error?.error || '', 'error'); },
    });
  }

  generar(): void {
    this.pidiendo.set(true);
    this.api.personalizar(this.persona().id, this.animar()).subscribe({
      next: (r) => {
        this.pidiendo.set(false);
        this.cargar();
        this.cambio.emit();
        Swal.fire({
          icon: 'success', title: 'Pedido a la IA',
          text: r.higgsfield_configurado
            ? 'Higgsfield lo está generando. Tarda uno o dos minutos; aquí verás cuando esté listo para revisar.'
            : 'El servidor aún no tiene la llave de Higgsfield: lo completa el asistente. Aquí verás cuando esté listo para revisar.',
        });
      },
      error: (e: HttpErrorResponse) => { this.pidiendo.set(false); Swal.fire('No se pudo pedir', e.error?.error || 'Intenta de nuevo.', 'warning'); },
    });
  }

  aprobar(p: PiezaCelebracion): void {
    this.api.aprobarPieza(p.id).subscribe({
      next: () => { this.cargar(); this.cambio.emit(); },
      error: (e: HttpErrorResponse) => Swal.fire('No se pudo aprobar', e.error?.error || '', 'error'),
    });
  }

  descartar(p: PiezaCelebracion): void {
    this.api.descartarPieza(p.id).subscribe({ next: () => { this.cargar(); this.cambio.emit(); } });
  }

  subir(p: PiezaCelebracion, ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.api.subirPieza(p.id, f).subscribe({
      next: () => { this.cargar(); this.cambio.emit(); },
      error: (e: HttpErrorResponse) => Swal.fire('No se pudo subir', e.error?.error || '', 'error'),
    });
  }
}
