import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../../../../environments/environment';
import { detectarPlataforma, Plataforma } from '../../../../../../core/security/plataforma.util';
import {
  CapturaHuella, EstadoEstrategia, EstrategiaHuella, HuellaError, OrigenHuella,
} from './huella.model';
import {
  EstrategiaAgenteLocal, EstrategiaArchivo, EstrategiaElectron, EstrategiaNativaAndroid,
} from './estrategias';

/**
 * CAPTURA DE HUELLA, UNA PUERTA PARA TODAS LAS FORMAS
 *
 * Antes la pantalla de contratación preguntaba directamente por
 * `window.electron.fingerprint.get()`. Eso ataba la huella al escritorio: en un
 * navegador y en el APK la propiedad no existe y el flujo moría en un mensaje
 * que hablaba de Electron, algo que a quien contrata no le dice nada.
 *
 * Aquí cada forma de conseguir una huella es una estrategia intercambiable
 * (ver `estrategias.ts`) y este servicio elige. Añadir una quinta —otro lector,
 * otro puente— no toca la pantalla: se registra abajo y ya.
 *
 * ORDEN DE PREFERENCIA, y su porqué:
 *
 *   1. el puente nativo del envoltorio (Electron en escritorio, plugin en el APK)
 *      — es el camino más corto al lector y el único que hoy da calidad;
 *   2. el agente local — mismo lector, desde cualquier navegador del equipo;
 *   3. adjuntar la imagen — no necesita nada, pero no verifica nada:
 *      va de última y queda marcada como tal en la trazabilidad.
 *
 * Las dos primeras se sondean; la tercera no se ofrece sola porque necesita un
 * clic de la persona para abrir el selector de archivos.
 */
@Injectable({ providedIn: 'root' })
export class HuellaCapturaService {
  /**
   * Dónde escucha el agente del lector. Loopback a propósito: nunca una IP de
   * la red, que expondría el lector de un equipo a toda la oficina.
   */
  private static readonly AGENTE_POR_DEFECTO = 'http://127.0.0.1:52181';

  private readonly plataforma: Plataforma = detectarPlataforma();
  private readonly estrategias: EstrategiaHuella[];
  /** La instancia concreta del agente, para poder preguntarle por qué falló. */
  private readonly agenteLocal: EstrategiaAgenteLocal;

  /** Última foto del sondeo, para que la pantalla pueda pintar el selector. */
  readonly estado = signal<EstadoEstrategia[]>([]);

  /** Evita sondear en cada pintado; se rehace con `refrescar()`. */
  private sondeo: Promise<EstadoEstrategia[]> | null = null;

  /**
   * Hay una captura en curso. El agente atiende de uno en uno —mientras el
   * lector espera un dedo no puede contestar nada más—, así que sondearlo
   * justo entonces solo produce un timeout y un "sin lector" falso encima de
   * una captura que va perfectamente.
   */
  private capturando = false;

  constructor() {
    const agente = environment.huelleroAgenteUrl || HuellaCapturaService.AGENTE_POR_DEFECTO;

    // El orden de este arreglo ES el orden de preferencia.
    this.agenteLocal = new EstrategiaAgenteLocal(agente);

    this.estrategias = [
      new EstrategiaElectron(),
      new EstrategiaNativaAndroid(),
      this.agenteLocal,
      // EstrategiaCamara existe pero NO se registra: se retiró a petición del
      // usuario. Ver la nota en estrategias.ts antes de volver a añadirla.
      new EstrategiaArchivo(),
    ];
  }

  /** Estado de cada estrategia, sondeando las que se puedan sondear. */
  async disponibles(): Promise<EstadoEstrategia[]> {
    if (!this.sondeo) this.sondeo = this.sondear();
    return this.sondeo;
  }

  /** Vuelve a sondear. Úsalo cuando alguien conecte el lector sin recargar. */
  async refrescar(): Promise<EstadoEstrategia[]> {
    this.sondeo = null;
    return this.disponibles();
  }

  private async sondear(): Promise<EstadoEstrategia[]> {
    // Con una captura en vuelo, la última foto conocida es mejor dato que un
    // sondeo que va a expirar seguro.
    if (this.capturando && this.estado().length) return this.estado();

    // En paralelo: el sondeo del agente tiene su propio timeout y no debe
    // sumarse al de los demás.
    const estados = await Promise.all(this.estrategias.map(async (e) => {
      const { disponible, motivo } = await e.comprobar().catch(() => ({
        disponible: false, motivo: 'sin-agente' as const,
      }));
      return {
        origen: e.origen, nombre: e.nombre, descripcion: e.descripcion, disponible, motivo,
      };
    }));
    this.estado.set(estados);
    return estados;
  }

  /**
   * La estrategia que se usaría ahora mismo sin preguntar nada: la primera
   * disponible que no necesite un clic. `null` si solo queda adjuntar imagen.
   */
  async preferida(): Promise<EstrategiaHuella | null> {
    const estados = await this.disponibles();
    for (const e of this.estrategias) {
      if (e.requiereGesto) continue;
      if (estados.find((s) => s.origen === e.origen)?.disponible) return e;
    }
    return null;
  }

  /** ¿Hay algún lector de verdad, o solo quedan la cámara y el adjunto? */
  async hayLector(): Promise<boolean> {
    return (await this.preferida()) !== null;
  }

  /**
   * Como `hayLector`, pero volviendo a sondear una vez si la respuesta es que
   * no. El sondeo se memoiza al abrir la pestaña, y lo normal es arrancar el
   * agente DESPUÉS de tener la página abierta: sin este reintento, el "no"
   * quedaba cacheado hasta recargar y el lector parecía roto.
   */
  async hayLectorTrasReintento(): Promise<boolean> {
    if (await this.hayLector()) return true;
    await this.refrescar();
    return this.hayLector();
  }

  /**
   * Qué falló exactamente al hablar con el agente, en texto. `undefined` si no
   * ha fallado. La pantalla lo enseña tal cual: preferimos un mensaje técnico
   * visible a un "no hay lector" cómodo que no permite arreglar nada.
   */
  detalleAgente(): string | undefined {
    return this.agenteLocal.detalleFallo;
  }

  /** ¿Es un celular? Ahí la cámara se ofrece primero, no como consuelo. */
  esMovil(): boolean {
    return this.plataforma === 'android' || this.plataforma === 'ios';
  }

  /**
   * Por qué no hay lector, en palabras para la pantalla. Se sondea primero,
   * porque el mensaje depende de qué contestó el agente local.
   */
  async motivoSinLector(): Promise<string> {
    await this.disponibles();
    return this.explicarAusencia();
  }

  /**
   * Captura una huella. Sin `origen`, usa la preferida; si no hay ninguna,
   * lanza en vez de caer sola a `archivo`: adjuntar una imagen es una decisión
   * de quien contrata, no un respaldo silencioso.
   */
  async capturar(origen?: OrigenHuella): Promise<CapturaHuella> {
    this.capturando = true;
    try {
      if (origen) {
        const elegida = this.estrategias.find((e) => e.origen === origen);
        if (!elegida) throw new HuellaError('Forma de captura desconocida.', origen);
        return await elegida.capturar();
      }

      const preferida = await this.preferida();
      if (!preferida) throw new HuellaError(this.explicarAusencia(), 'electron');
      return await preferida.capturar();
    } finally {
      this.capturando = false;
    }
  }

  /**
   * Qué decirle a la persona cuando no hay lector. Un mensaje por envoltorio:
   * el paso siguiente no es el mismo en un navegador que en el celular.
   */
  private explicarAusencia(): string {
    const estados = this.estado();
    const agente = estados.find((e) => e.origen === 'agente-local');

    // El agente contesta pero no ve el lector: eso NO es "falta el agente", y
    // decirlo mal manda a instalar algo que ya está instalado.
    if (agente?.motivo === 'sin-lector') {
      return 'El agente del lector está funcionando, pero no ve ningún lector conectado. '
        + 'Revisa el cable USB y vuelve a intentar.';
    }
    if (agente?.motivo === 'sin-permiso') {
      return 'El navegador bloqueó la conexión con el agente del lector. '
        + 'Autoriza el acceso a la red local y vuelve a intentar.';
    }
    switch (this.plataforma) {
      case 'electron':
        return 'No se encontró el lector. Revisa que esté conectado y que el equipo '
          + 'tenga instalado el software del lector.';
      case 'android':
      case 'ios':
        return 'En el celular no hay lector: adjunta la imagen de la huella.';
      default:
        return 'Desde el navegador hace falta el agente del lector instalado en este equipo. '
          + 'Si no lo tienes, puedes adjuntar la imagen de la huella.';
    }
  }
}
