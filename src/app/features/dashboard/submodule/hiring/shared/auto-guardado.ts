import { DestroyRef, signal } from '@angular/core';
import { AbstractControl } from '@angular/forms';

export type EstadoAutoGuardado = 'inactivo' | 'pendiente' | 'guardando' | 'guardado' | 'incompleto' | 'error';

/**
 * Lo que lanza `guardar` cuando todavía no hay nada que se pueda guardar (p. ej.
 * falta elegir la vacante). No es un error: el indicador dice qué falta.
 */
export class GuardadoIncompleto extends Error {}

/**
 * Guardado automático de un paso del pipeline, sin botón.
 *
 * <p>Selección y Contratación tenían un "Guardar" / "Enviar" / "Cargar" por
 * pestaña: lo diligenciado se perdía si nadie lo pulsaba antes de cambiar de
 * pestaña o de persona. Ahora cada respuesta se guarda sola:
 * <ul>
 *   <li><b>Texto</b> (input, textarea): al SALIR del campo, no en cada tecla.</li>
 *   <li><b>Listas, calendario, casillas</b>: en cuanto cambian.</li>
 * </ul>
 *
 * <p>Solo cuenta lo que tocó la persona (`dirty`): los parches que hace el
 * código al cargar a alguien no se escriben de vuelta.
 *
 * <p>Una escritura a la vez: lo que cambie mientras se guarda sale en la
 * siguiente. Y cada guardado recuerda PARA QUIÉN se pidió (`llave`): si entre
 * pedirlo y hacerlo se abrió otra persona, se descarta en vez de escribir lo de
 * una en el expediente de la otra.
 */
export class AutoGuardado {
  readonly estado = signal<EstadoAutoGuardado>('inactivo');
  readonly error = signal<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private enVuelo = false;
  private otraVez = false;
  private esperandoSalida = false;
  private llavePedida: string | null = null;

  /**
   * @param guardar escritura real. Debe lanzar si falla (el mensaje se muestra).
   * @param llave   a quién pertenece lo que se va a guardar (p. ej. la cédula).
   */
  constructor(
    private readonly guardar: () => Promise<void>,
    private readonly llave: () => string,
    private readonly espera = 300,
  ) {}

  /** Engancha un formulario: los cambios del usuario programan el guardado. */
  vigilar(form: AbstractControl, destroyRef: DestroyRef): void {
    const sub = form.valueChanges.subscribe(() => {
      if (!form.dirty) return;
      this.cambio();
    });
    destroyRef.onDestroy(() => {
      sub.unsubscribe();
      this.cancelar();
    });
  }

  /**
   * Hubo un cambio del usuario. Si está escribiendo en un campo de texto se
   * espera a que salga de él; si no, se guarda ya.
   */
  cambio(): void {
    this.llavePedida ??= this.llave();
    if (AutoGuardado.escribiendoTexto()) {
      this.esperandoSalida = true;
      // Y también tras una pausa al escribir: quien recarga la página (F5) sin
      // salir del campo no pierde lo escrito.
      this.programar(AutoGuardado.PAUSA_ESCRIBIENDO);
      return;
    }
    this.programar();
  }

  /** Pausa al escribir tras la que se guarda aunque el foco siga en el campo. */
  static readonly PAUSA_ESCRIBIENDO = 1500;

  /** Enlazar a `(focusout)` del contenedor del formulario. */
  alSalirDeCampo(): void {
    if (!this.esperandoSalida) return;
    this.esperandoSalida = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // Sin espera: el clic que sacó el foco puede ser el de abrir a otra persona,
    // y la escritura tiene que arrancar ANTES de que cambie.
    void this.ahora();
  }

  /** Guarda tras una pausa corta (varios cambios seguidos salen en uno). */
  programar(espera = this.espera): void {
    this.llavePedida ??= this.llave();
    this.estado.set('pendiente');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.ahora(); }, espera);
  }

  /** Guarda ya (o en cuanto termine la escritura en curso). */
  async ahora(): Promise<void> {
    this.llavePedida ??= this.llave();
    if (this.enVuelo) { this.otraVez = true; return; }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.esperandoSalida = false;

    const pedida = this.llavePedida;
    this.llavePedida = null;
    if (!pedida || pedida !== this.llave()) {
      // Se cambió de persona entre el cambio y el guardado.
      this.estado.set('inactivo');
      return;
    }

    this.enVuelo = true;
    this.estado.set('guardando');
    this.error.set(null);
    try {
      await this.guardar();
      this.estado.set('guardado');
    } catch (e: any) {
      if (e instanceof GuardadoIncompleto) {
        this.estado.set('incompleto');
        this.error.set(e.message || null);
      } else {
        this.estado.set('error');
        this.error.set(AutoGuardado.mensaje(e));
      }
    } finally {
      this.enVuelo = false;
    }

    if (this.otraVez) {
      this.otraVez = false;
      this.llavePedida ??= pedida;
      await this.ahora();
    }
  }

  /** Olvida lo pendiente: se abrió otra persona o se cerró la pantalla. */
  cancelar(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.esperandoSalida = false;
    this.otraVez = false;
    this.llavePedida = null;
    if (!this.enVuelo) this.estado.set('inactivo');
  }

  /** ¿El foco está en un campo donde se escribe (y hay que esperar a que salga)? */
  static escribiendoTexto(): boolean {
    if (typeof document === 'undefined') return false;
    const a = document.activeElement as HTMLElement | null;
    if (!a) return false;
    if (a.tagName === 'TEXTAREA') return true;
    if (a.tagName !== 'INPUT') return false;
    const tipo = ((a as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color'].includes(tipo);
  }

  private static mensaje(e: any): string {
    const cuerpo = e?.error;
    return (typeof cuerpo === 'string' && cuerpo)
      || cuerpo?.detail || cuerpo?.error || cuerpo?.message
      || e?.message
      || 'No se pudo guardar. Revise la conexión.';
  }
}
