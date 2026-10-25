import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, input, output, signal, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { Hablante } from '../../../service/turnos.service';
import { EstadoDeCanal, EstadoTranscripcion, HABLANTES } from '../../../service/transcripcion-en-vivo';
import { ItemConversacion, Nombres, formatoTiempo } from '../en-vivo.util';

/**
 * La conversación en vivo, como un chat: la persona a la izquierda, el asesor a la derecha,
 * el minuto de la llamada en la columna del medio y lo que se está diciendo ahora en gris
 * (se reemplaza hasta que la frase se cierra). Arriba, un medidor de voz por canal: así se
 * ve de un vistazo quién está hablando y si llega audio de los dos lados.
 */
@Component({
  selector: 'app-panel-transcripcion',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-transcripcion.html',
  styleUrl: './panel-transcripcion.css',
})
export class PanelTranscripcion {
  readonly items = input<ItemConversacion[]>([]);
  readonly nombres = input<Nombres>({ ASESOR: 'Asesor', PERSONA: 'Persona' });
  readonly estado = input<EstadoTranscripcion>('apagada');
  readonly canales = input<Record<Hablante, EstadoDeCanal>>({ ASESOR: { estado: 'apagado', detalle: null }, PERSONA: { estado: 'apagado', detalle: null } });
  readonly niveles = input<Record<Hablante, number>>({ ASESOR: 0, PERSONA: 0 });
  readonly motivo = input<string | null>(null);
  readonly errorGuardado = input<string | null>(null);
  /** Arrancar sola al conectar la llamada (preferencia del asesor). */
  readonly automatica = input(true);
  /** La videollamada está conectada (se puede transcribir). */
  readonly enLlamada = input(false);
  /** Frase a resaltar (clave), p. ej. la cita de un tema. */
  readonly resaltada = input<string | null>(null);
  /** El navegador dejó el audio en pausa: hace falta un toque para activarlo. */
  readonly audioBloqueado = input(false);
  /** Cómo se captura el audio (worklet o ScriptProcessor): queda en el DOM para diagnosticar. */
  readonly metodo = input<'worklet' | 'script' | null>(null);

  readonly pausar = output<void>();
  readonly reanudar = output<void>();
  readonly iniciar = output<void>();
  readonly reintentar = output<void>();
  readonly automaticaCambio = output<boolean>();
  readonly activarAudio = output<void>();

  readonly HABLANTES = HABLANTES;
  readonly formato = formatoTiempo;
  readonly lista = viewChild<ElementRef<HTMLElement>>('lista');

  /** Seguir lo último (se apaga solo si la persona sube a leer). */
  readonly seguir = signal(true);
  readonly nuevas = signal(0);
  readonly destello = signal<string | null>(null);
  private vistos = 0;
  private temporizadorDestello: ReturnType<typeof setTimeout> | null = null;

  readonly confirmadas = computed(() => this.items().filter(i => !i.provisional));
  /** Última frase cerrada: es lo único que se anuncia a lectores de pantalla (las parciales cambian demasiado). */
  readonly anuncio = computed(() => {
    const c = this.confirmadas();
    const u = c[c.length - 1];
    return u ? `${this.nombres()[u.hablante]}: ${u.texto}` : '';
  });

  readonly etiquetaEstado = computed(() => ({
    apagada: 'Apagada', conectando: 'Conectando…', transcribiendo: 'Transcribiendo', pausada: 'En pausa', error: 'Con error',
  } as Record<EstadoTranscripcion, string>)[this.estado()]);

  readonly visibleAviso = computed(() => this.estado() === 'transcribiendo' || this.estado() === 'conectando');

  constructor() {
    // Lo nuevo entra por abajo: si se está siguiendo, se baja; si no, se cuenta.
    afterRenderEffect(() => {
      const n = this.confirmadas().length;
      this.items();
      const seguir = this.seguir();
      untracked(() => {
        const el = this.lista()?.nativeElement;
        if (!el) return;
        if (seguir) { el.scrollTop = el.scrollHeight; this.vistos = n; this.nuevas.set(0); }
        else this.nuevas.set(Math.max(0, n - this.vistos));
      });
    });
    // Cita de un tema: se lleva a la vista y destella.
    afterRenderEffect(() => {
      const clave = this.resaltada();
      if (!clave) return;
      untracked(() => {
        const el = this.lista()?.nativeElement?.querySelector<HTMLElement>(`[data-clave="${CSS.escape(clave)}"]`);
        if (!el) return;
        this.seguir.set(false);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        this.destello.set(clave);
        if (this.temporizadorDestello) clearTimeout(this.temporizadorDestello);
        this.temporizadorDestello = setTimeout(() => this.destello.set(null), 2600);
      });
    });
  }

  alDesplazar(): void {
    const el = this.lista()?.nativeElement;
    if (!el) return;
    const alFondo = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (alFondo !== this.seguir()) this.seguir.set(alFondo);
  }

  irAlFinal(): void { this.seguir.set(true); }

  alternarSeguir(): void { this.seguir.update(v => !v); }

  etiquetaCanal(c: EstadoDeCanal): string {
    return ({ apagado: 'Sin conectar', conectando: 'Conectando…', transcribiendo: 'Escuchando', reconectando: 'Reconectando…', pausado: 'En pausa', error: 'Error' } as Record<string, string>)[c.estado] ?? c.estado;
  }

  claseHablante(h: Hablante): string { return h === 'ASESOR' ? 'asesor' : 'persona'; }
}
