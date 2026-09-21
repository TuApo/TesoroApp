import { AdaptadorVistaCaso, PersonaEnVista } from '@/app/core/services/vista-caso.registro';
import {
  AccionPaso,
  CapaCaso,
  CapaCatalogo,
  CatalogoPasos,
  EstadoPipelineCaso,
  ScrollGuardado,
  leerEstadoPipeline,
  mismaPersona,
  normalizarDocumento,
  pasoAAbrir,
  resumenDePaso,
} from './pipeline-caso.rules';

/** Ruta del pipeline; la cédula va en la URL para que una pestaña nueva del navegador llegue igual. */
export const RUTA_PIPELINE = '/dashboard/hiring/recruitment-pipeline';

/**
 * Lo que el adaptador necesita de la pantalla. Es una interfaz, no el componente, para
 * poder probar la restauración con una pantalla de mentira.
 */
export interface PipelineParaCaso {
  documentoEnPantalla(): string | null;
  tipoDocEnPantalla(): string | null;
  nombreEnPantalla(): string | null;
  capaAbierta(): CapaCaso;
  pasoAbierto(): string | null;
  catalogo(): CatalogoPasos;
  capas(): readonly CapaCatalogo[];
  /** La vista ya se inicializó: existe el buscador. */
  vistaLista(): boolean;
  /** Hay una búsqueda por documento en curso, y cuál. */
  buscando(): boolean;
  documentoBuscado(): string | null;
  buscarPorDocumento(documento: string, tipoDoc?: string | null): void;
  abrirPaso(accion: AccionPaso): void;
  /** Raíz del DOM de la pantalla, para los desplazamientos. */
  raiz(): ParentNode | null;
}

/** Contenedores del pipeline que se desplazan (uno por pestaña). */
const SELECTOR_SCROLL = '.tab-content-scrollable';

/**
 * El pipeline como pestaña de un caso: guarda la persona y el paso, y al volver BUSCA a la
 * persona por el mismo camino de siempre (el buscador, con vetados, robot y cola) y luego
 * abre el paso. Los campos no se tocan: los llena la pantalla con lo que hay guardado.
 */
export class AdaptadorPipelineCaso implements AdaptadorVistaCaso<EstadoPipelineCaso> {
  readonly camposDom = false;

  constructor(private readonly p: PipelineParaCaso) {}

  capturar(): EstadoPipelineCaso | null {
    const documento = normalizarDocumento(this.p.documentoEnPantalla());
    if (!documento) return null;
    const estado: EstadoPipelineCaso = {
      v: 1,
      documento,
      tipo_doc: this.p.tipoDocEnPantalla() || null,
      nombre: this.p.nombreEnPantalla() || null,
      capa: this.p.capaAbierta(),
      paso: this.p.pasoAbierto(),
    };
    const scroll = leerScrolls(this.p.raiz());
    if (scroll.length) estado.scroll = scroll;
    return estado;
  }

  ruta(): string {
    const d = normalizarDocumento(this.p.documentoEnPantalla());
    return d ? `${RUTA_PIPELINE}?cedula=${encodeURIComponent(d)}` : RUTA_PIPELINE;
  }

  persona(): PersonaEnVista {
    const documento = normalizarDocumento(this.p.documentoEnPantalla());
    return {
      documento: documento || null,
      persona_nombre: documento ? this.p.nombreEnPantalla() || null : null,
      motivo: this.resumen(),
    };
  }

  resumen(): string {
    return resumenDePaso({ capa: this.p.capaAbierta(), paso: this.p.pasoAbierto() }, this.p.catalogo(), this.p.capas());
  }

  async restaurar(e: EstadoPipelineCaso, avance: (p: number) => void): Promise<void> {
    const estado = leerEstadoPipeline(e);
    if (!estado) return;
    avance(0.05);
    await esperar(() => this.p.vistaLista(), 8000);
    if (!mismaPersona(this.p.documentoEnPantalla(), estado.documento)) {
      // Con la cédula en la URL la pantalla ya la está buscando al nacer: no se repite.
      const enCurso = this.p.buscando() && mismaPersona(this.p.documentoBuscado(), estado.documento);
      if (!enCurso) this.p.buscarPorDocumento(estado.documento, estado.tipo_doc);
      avance(0.15);
      await esperar(() => !this.p.buscando(), 20000, t => avance(0.15 + 0.5 * t));
      // No se encontró (o falló): la pantalla ya lo dijo; no hay paso que abrir.
      if (!mismaPersona(this.p.documentoEnPantalla(), estado.documento)) return;
    }
    avance(0.7);
    // Los pasos visibles dependen de la persona (veredicto, contrato): se deciden ya cargada.
    this.p.abrirPaso(pasoAAbrir(estado, this.p.catalogo()));
    avance(0.85);
    if (estado.scroll?.length) {
      await pausa(350);
      reponerScrolls(this.p.raiz(), estado.scroll);
    }
    avance(1);
  }
}

/** Los contenedores desplazados de la pantalla, por selector e índice. */
export function leerScrolls(raiz: ParentNode | null): ScrollGuardado[] {
  if (!raiz) return [];
  const out: ScrollGuardado[] = [];
  raiz.querySelectorAll<HTMLElement>(SELECTOR_SCROLL).forEach((el, n) => {
    if (el.scrollTop > 0) out.push({ sel: SELECTOR_SCROLL, n, top: Math.round(el.scrollTop) });
  });
  return out;
}

export function reponerScrolls(raiz: ParentNode | null, scrolls: ScrollGuardado[] | undefined): void {
  if (!raiz || !scrolls?.length) return;
  for (const s of scrolls) {
    const el = raiz.querySelectorAll<HTMLElement>(s.sel)[s.n];
    if (el) el.scrollTop = s.top;
  }
}

/** Espera a que se cumpla algo, sondeando; `tic` recibe 0–1 del tiempo consumido. */
export function esperar(cond: () => boolean, ms: number, tic?: (t: number) => void): Promise<boolean> {
  return new Promise(resolve => {
    const inicio = Date.now();
    const paso = () => {
      if (cond()) { resolve(true); return; }
      const t = (Date.now() - inicio) / ms;
      if (t >= 1) { resolve(false); return; }
      tic?.(t);
      setTimeout(paso, 100);
    };
    paso();
  });
}

function pausa(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
