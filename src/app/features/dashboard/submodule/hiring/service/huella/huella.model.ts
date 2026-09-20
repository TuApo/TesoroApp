/**
 * CONTRATO ÚNICO DE LA CAPTURA DE HUELLA
 *
 * Todo lo que viene después de capturar —consentimiento, hashes, subida a
 * biometría— no debería enterarse de CÓMO llegó la imagen. Por eso cada forma
 * de conseguir una huella se implementa como una `EstrategiaHuella` y todas
 * devuelven la misma `CapturaHuella`.
 */

/** De dónde salió la imagen. Se guarda en la trazabilidad de la captura. */
export type OrigenHuella =
  /** Lector USB por el ejecutable del SDK, vía IPC de Electron (escritorio). */
  | 'electron'
  /** Lector USB por un agente instalado en el equipo, hablando por HTTP local. */
  | 'agente-local'
  /** Lector conectado al celular por OTG, vía plugin nativo de Capacitor. */
  | 'nativo-android'
  /** Foto de la huella con la cámara del propio dispositivo. La única captura
   *  que funciona en un celular sin instalar nada. */
  | 'camara'
  /** La persona adjunta la imagen. Salida de emergencia, funciona en todas partes. */
  | 'archivo';

/** Por qué una estrategia no se puede usar aquí. Es lo que se le muestra a quien contrata. */
export type MotivoNoDisponible =
  | 'plataforma'      // este envoltorio no la soporta (p. ej. Electron en un navegador)
  | 'sin-agente'      // no hay nada escuchando en el equipo
  | 'sin-plugin'      // el APK no trae el plugin nativo
  | 'sin-permiso'     // el usuario negó el permiso (red local, USB, cámara)
  | 'sin-camara'      // el dispositivo no expone ninguna cámara usable
  | 'sin-lector';     // el puente responde pero no ve el dispositivo

export interface CapturaHuella {
  /** Imagen lista para pintar en un `<img>` y para convertir en File. */
  dataUrl: string;
  mime: string;
  origen: OrigenHuella;
  /** Modelo del lector, cuando el puente lo informa. */
  dispositivo?: string;
  /**
   * Codigo de calidad del SDK. OJO: NO es un porcentaje — en el U.are.U, 0 es
   * `GOOD`. Interpretarlo como "0 %" seria justo al reves de la realidad.
   */
  calidad?: number;
  /** Dimensiones reales de la captura, para poder auditarla despues. */
  ancho?: number;
  alto?: number;
  dpi?: number;
}

/** Estado de una estrategia, para pintar el selector y explicar los ausentes. */
export interface EstadoEstrategia {
  origen: OrigenHuella;
  nombre: string;
  descripcion: string;
  disponible: boolean;
  motivo?: MotivoNoDisponible;
}

/**
 * Fallo de captura con un motivo legible. El flujo anterior tragaba el error real
 * del proceso principal de Electron —que rechaza con un objeto plano, no con un
 * Error— y acababa mostrando "Desconocido", que no le sirve a nadie en la oficina.
 */
export class HuellaError extends Error {
  constructor(
    override readonly message: string,
    readonly origen: OrigenHuella,
    /** true cuando la persona canceló: no es un fallo y no debe alertar. */
    readonly cancelado = false,
  ) {
    super(message);
    this.name = 'HuellaError';
  }
}

export interface EstrategiaHuella {
  readonly origen: OrigenHuella;
  /** Cómo se llama en el selector: "Lector de este equipo", "Adjuntar imagen"… */
  readonly nombre: string;
  readonly descripcion: string;
  /**
   * `true` si necesita que la persona haga clic (abrir el selector de archivos).
   * El servicio no puede probar estas estrategias solo para ver si funcionan.
   */
  readonly requiereGesto: boolean;

  /** ¿Se puede usar aquí y ahora? No debe lanzar: devuelve el motivo. */
  comprobar(): Promise<{ disponible: boolean; motivo?: MotivoNoDisponible }>;

  /** Captura una huella o lanza `HuellaError`. */
  capturar(): Promise<CapturaHuella>;
}
