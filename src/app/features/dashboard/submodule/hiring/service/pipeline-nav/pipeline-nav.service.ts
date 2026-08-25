import { Injectable, signal } from '@angular/core';
import { Avance, pctDe, sumarAvances } from '../../shared/progreso.util';

/** URLs de la biometría; `null` cuando esa pieza aún no existe. */
export interface BiometriaResumen {
  foto: string | null;
  firma: string | null;
  huella: string | null;
}

/** Lo que la ficha muestra de la vacante remitida. */
export interface VacanteAsignadaResumen {
  id: number;
  cargo: string;
  empresa: string;
  finca: string;
  codigo: string | null;
}

/** Sub-pestañas que viven dentro del área de trabajo de Selección. */
export type PanelSeleccion =
  | 'entrevista'
  | 'formacion'
  | 'remision'
  /** IA · resumen del perfil. */
  | 'ia'
  /** IA · chat sobre esta persona. */
  | 'iaChat';

/** Cada bloque que reporta cuánto lleva llenado. */
export type ClaveAvance =
  | 'entrevista'
  | 'formacion'
  | 'antecedentes'
  | 'remision'
  | 'examenes'
  | 'pago'
  | 'obra'
  | 'referencias'
  | 'traslados'
  | 'huella'
  | 'documentos';

/**
 * Estado compartido de los dos railes del pipeline.
 *
 * El pipeline pinta la navegación completa —capa 1 (Selección / Contratación)
 * y capa 2 (los sub-pasos de la que esté abierta)—, pero quien SABE en qué
 * sub-paso va y cuánto lleva llenado cada uno son los hijos, que están dentro
 * de los `mat-tab` y no pueden hablar con el rail por `@Input`/`@Output` sin
 * atravesar tres componentes.
 *
 * Este servicio es ese canal. Se provee en `RecruitmentPipelineComponent`, no
 * en root: es estado de UNA pantalla y tiene que morir con ella.
 */
@Injectable()
export class PipelineNavService {
  /** Sub-pestaña abierta dentro de Selección. La escribe el rail o el hijo. */
  readonly panelSeleccion = signal<PanelSeleccion>('entrevista');

  /** Sub-paso abierto dentro de Contratación (índice del mat-tab-group hijo). */
  readonly subContratacion = signal<number>(0);

  /**
   * Cuánto lleva llenado cada bloque de la ficha.
   *
   * Lo publica `form-entrevista`, que es el dueño del formulario, y lo pinta la
   * ficha del pipeline. Se mide con LAS MISMAS reglas que el formulario de la
   * vacante —los obligatorios habilitados, vía `avanceDeForm`— para que el
   * porcentaje de la ficha y el del rail no puedan discrepar: si un campo
   * bloquea el guardado, cuenta como pendiente en los dos sitios.
   *
   * Va aparte de `ClaveAvance` a propósito: son los datos de la PERSONA, no un
   * paso del proceso, y meterlos en el agregado de Selección movería un número
   * que ya se está usando para otra cosa.
   */
  readonly avanceFicha = signal<Readonly<Record<string, Avance>>>({});

  /**
   * Bloque de la ficha que se pidió editar, o `null` cuando no hay nada pedido.
   *
   * La ficha la pinta el pipeline, pero los CAMPOS viven en el formulario de
   * `form-entrevista`, tres componentes más abajo. El lápiz publica aquí qué
   * quiere editar y el dueño del formulario abre el diálogo: es el mismo
   * camino que ya usan el rail y los avances.
   *
   * `'todos'` = la ficha entera; si no, el id del bloque.
   */
  readonly edicionFicha = signal<string | null>(null);

  pedirEdicion(bloque: string): void {
    this.edicionFicha.set(bloque);
  }

  /**
   * La vacante a la que se remite, resumida para la ficha.
   *
   * La publica `help-information`, que es quien la tiene; la ficha del pipeline
   * solo la pinta. Sin este canal habría que subir toda la lista de vacantes al
   * pipeline para mostrar dos líneas.
   */
  readonly vacanteAsignada = signal<VacanteAsignadaResumen | null>(null);

  /**
   * Contador de "quiero cambiar la vacante". Es un número y no un booleano
   * porque pedirlo dos veces seguidas tiene que abrir el diálogo dos veces.
   */
  readonly pedidoVacante = signal<number>(0);

  pedirAsignarVacante(): void {
    this.pedidoVacante.update((n) => n + 1);
  }

  /**
   * Biometría de la persona, resuelta por el pipeline (documento subido o
   * biometría embebida) y consumida por el paso Cédula & Huella, que es donde
   * se captura. Sin este canal habría que repetir en Contratación toda la
   * resolución de URLs que el pipeline ya hace.
   */
  readonly biometria = signal<BiometriaResumen>({ foto: null, firma: null, huella: null });

  /** "Ábreme la cámara": la cámara y la subida viven en el pipeline. */
  readonly pedidoFoto = signal<number>(0);

  pedirFoto(): void {
    this.pedidoFoto.update((n) => n + 1);
  }

  private readonly _avances = signal<Readonly<Partial<Record<ClaveAvance, Avance>>>>({});
  readonly avances = this._avances.asReadonly();

  /**
   * Publica cuánto lleva llenado un bloque.
   *
   * Ignora la republicación idéntica: los formularios emiten `valueChanges` en
   * ráfagas (prellenado desde la vacante, `patchValue` por campo) y sin este
   * corte cada tecleo repintaría los dos railes enteros.
   */
  publicar(clave: ClaveAvance, avance: Avance): void {
    const actual = this._avances()[clave];
    if (actual && actual.hechos === avance.hechos && actual.total === avance.total) return;
    this._avances.update((m) => ({ ...m, [clave]: avance }));
  }

  avance(clave: ClaveAvance): Avance | null {
    return this._avances()[clave] ?? null;
  }

  pct(clave: ClaveAvance): number {
    return pctDe(this._avances()[clave]);
  }

  /** Avance de un paso entero = suma del de sus sub-pasos. */
  agregado(claves: readonly ClaveAvance[]): Avance {
    const m = this._avances();
    return sumarAvances(claves.map((k) => m[k]));
  }

  /** Persona nueva: los contadores del anterior no sirven para nada. */
  reiniciar(): void {
    this._avances.set({});
    this.panelSeleccion.set('entrevista');
    this.subContratacion.set(0);
    this.edicionFicha.set(null);
    this.vacanteAsignada.set(null);
    this.biometria.set({ foto: null, firma: null, huella: null });
    this.avanceFicha.set({});
  }
}
