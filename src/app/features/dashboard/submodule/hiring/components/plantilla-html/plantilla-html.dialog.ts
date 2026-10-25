import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, ViewChild, computed, inject, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { take } from 'rxjs';

import {
  DocumentosParametrizadosService,
  type CambioDatoDocumento,
  type RevisionDatosPlantilla,
  type UsuarioDocumento,
} from '../../service/documentos-parametrizados/documentos-parametrizados.service';
import {
  type ControlPlantilla, type PreguntaSiNo, type RespuestaSiNo,
  SELECTOR_SI_NO, leerPreguntas, marcarRespuesta, normalizarSiNo, pintarPendientes, sinResponder,
} from './si-no-plantilla';

export interface PlantillaHtmlData {
  /** Clave de la plantilla en ms-templates (p. ej. `ficha-tecnica-trabajador`). */
  clave: string;
  titulo: string;
  cedula: string;
  centroCostoId: number;
  /**
   * Quien genera: "Persona que hace Contratación" cuando el contrato no lo trae, testigo 1 del
   * contrato con su documento, y la sede de la que sale el municipio donde se firma.
   */
  usuario?: UsuarioDocumento | null;
  /**
   * Proceso abierto tras dar de baja un contrato. Separa el borrador: lo que se
   * diligenció para el contrato anterior no se reaplica en la contratación nueva.
   */
  turno?: string | null;
}

/** Llave del borrador en localStorage. Sin turno tras baja, la de siempre. */
function llaveBorrador(clave: string, cedula: string, centroCostoId: number, turno?: string | null): string {
  return `${BORRADOR_PREFIJO}${clave}:${cedula}:${centroCostoId}${turno ? ':p' + turno : ''}`;
}

/** Cierra con `guardado` cuando el PDF quedó en el expediente; `undefined` = se canceló. */
export type PlantillaHtmlResultado = { guardado: true } | undefined;

/** Estilos de edición que se inyectan en el documento (solo pantalla; el PDF no los lleva). */
const ESTILOS_EDICION = `
  html, body { background: #e5e7eb; }
  .ph { background: none !important; outline: none !important; }
  .ph-edit { cursor: text; border-radius: 2px; }
  .ph-edit:hover { outline: 1px solid #93c5fd !important; }
  .ph-vacio { background: #fef3c7 !important; outline: 1px dashed #d97706 !important;
              display: inline-block; min-width: 22px; min-height: 1em; }
  .ph-editado { background: #dcfce7 !important; outline: 1px solid #16a34a !important; }
  .ph-edit.chk { cursor: pointer; }
  td.ph-casilla { cursor: pointer; }
  td.ph-casilla:hover { background: #eff6ff !important; }
  /* Preguntas SI/NO: el paréntesis es el radio; la X es la elección (igual que en el PDF). */
  /* Un paréntesis vacío no mide nada de alto: sin tamaño mínimo el clic caía fuera. */
  .ph-radio { cursor: pointer; border-radius: 50%; transition: background .12s;
              display: inline-block; min-width: 1.2em; min-height: 1.2em; vertical-align: middle; text-align: center; }
  .ph-radio .ph-edit { outline: none !important; background: none !important; }
  .ph-radio:hover { background: #dbeafe !important; }
  .ph-radio-falta { background: #fef3c7 !important; outline: 1px dashed #d97706; }
  .ph-radio-elegido { background: #dcfce7 !important; outline: 1px solid #16a34a; font-weight: 700; }
  .ph-radio.ph-radio-fijo { cursor: not-allowed; background: none !important; outline: none; }
  .ph-radio.ph-radio-fijo:hover { background: none !important; }
  .ph-edit:focus { outline: 2px solid #2563eb !important; background: #eff6ff !important; }
  /* Dato de la persona: lo que se escriba aquí vuelve también a su registro al consolidar. */
  .ph-bd { box-shadow: inset 0 -2px 0 rgba(37, 99, 235, .55); }
`;

/**
 * Borrador de lo diligenciado, por documento y persona, en el navegador: al salir y volver a
 * abrir el documento aparece como se dejó. No genera ni sube nada; eso lo hace "Consolidar".
 */
interface BorradorPlantilla {
  valores: Record<string, string>;
  respuestas: Record<string, RespuestaSiNo>;
  ts: number;
}
const BORRADOR_PREFIJO = 'plantilla-html-borrador:';
/** Un borrador más viejo que esto se descarta (y se limpia al abrir cualquier documento). */
const BORRADOR_VIGENCIA_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Lo diligenciado en el borrador de un documento, tal como viaja a ms-templates al generar:
 * expresión -> texto y, para las preguntas SI/NO, campo -> respuesta. Vacío si no hay borrador.
 * Lo usa "Solicitar firma" para mandar a firmar los documentos como se dejaron.
 */
export function valoresDelBorrador(clave: string, cedula: string, centroCostoId: number, turno?: string | null): Record<string, string> {
  try {
    const raw = localStorage.getItem(llaveBorrador(clave, cedula, centroCostoId, turno));
    if (!raw) return {};
    const b = JSON.parse(raw) as BorradorPlantilla;
    if (Date.now() - (b.ts ?? 0) > BORRADOR_VIGENCIA_MS) return {};
    return { ...(b.valores ?? {}), ...(b.respuestas ?? {}) };
  } catch {
    return {};
  }
}

/** Cómo se llama en pantalla cada dato de la temporal que puede faltar (`faltan_temporal`). */
const DATO_TEMPORAL: Readonly<Record<string, string>> = {
  nit: 'NIT',
  representante_legal_nombre: 'nombre del representante legal',
  representante_legal_tipo_doc: 'tipo de documento del representante legal',
  representante_legal_documento: 'número de documento del representante legal',
  direccion_coordinador: 'dirección del coordinador',
};

/**
 * Documento HTML de la plantilla (ficha técnica, contrato…) pintado con los datos de la
 * persona, para COMPLETAR A MANO lo que falta.
 *
 * ms-templates devuelve el documento con cada campo marcado (`span.ph-edit[data-expr]`,
 * los que no tienen dato con `ph-vacio`). Aquí se vuelven editables: los de texto se
 * escriben, las casillas se marcan con un clic. Una expresión que aparece varias veces se
 * actualiza en todas. Al guardar, ms-templates genera el PDF con Chromium usando lo escrito
 * y lo deja en gestión documental.
 */
@Component({
  selector: 'app-plantilla-html-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './plantilla-html.dialog.html',
  styleUrls: ['./plantilla-html.dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlantillaHtmlDialogComponent {
  readonly data = inject<PlantillaHtmlData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PlantillaHtmlDialogComponent, PlantillaHtmlResultado>>(MatDialogRef);
  private readonly docs = inject(DocumentosParametrizadosService);
  private readonly destroyRef = inject(DestroyRef);
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('marco') set marco(el: ElementRef<HTMLIFrameElement> | undefined) {
    this.iframe = el?.nativeElement;
    this.pintar();
  }
  private iframe?: HTMLIFrameElement;
  private html: string | null = null;

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly campos = signal(0);
  readonly vacios = signal(0);
  readonly editados = signal(0);
  /**
   * Datos de la temporal que el documento necesita y no están cargados (NIT, representante
   * legal…). Se ve el documento, pero no se guarda: ms-templates respondería 409.
   */
  readonly faltanTemporal = signal<string[]>([]);
  readonly faltanTemporalTexto = computed(() => this.faltanTemporal().map((c) => DATO_TEMPORAL[c] ?? c.replace(/_/g, ' ')).join(', '));

  /** Preguntas SI/NO (radio obligatorio): sin responderlas todas no se guarda. */
  readonly preguntas = signal<PreguntaSiNo[]>([]);
  readonly sinResponder = computed(() => sinResponder(this.preguntas()));
  private controles: ControlPlantilla[] = [];
  private docIframe?: Document;

  /** Expresiones cuyo dato vive en el registro de la persona (llenado bilateral). */
  private guardables = new Set<string>();
  readonly hayGuardables = signal(false);

  /**
   * Confirmación antes de consolidar cuando lo escrito toca los datos de la persona: qué se
   * guarda, qué dato existente se reemplaza y qué no se puede guardar (solo queda en el PDF).
   */
  readonly revision = signal<RevisionDatosPlantilla | null>(null);
  readonly aGuardar = computed(() => (this.revision()?.cambios ?? []).filter((c) => c.estado === 'GUARDAR'));
  readonly noSeGuardan = computed(() => [
    ...(this.revision()?.cambios ?? []).filter((c) => c.estado === 'NO_SE_GUARDA')
      .map((c) => ({ etiqueta: this.etiqueta(c), motivo: c.motivo ?? '' })),
    ...(this.revision()?.solo_documento ?? []),
  ]);

  /** Lo escrito a mano: expresión -> texto. Es lo que viaja al generar. */
  private readonly valores = new Map<string, string>();
  /** Valor con el que llegó cada expresión: volver a él deshace el cambio. */
  private readonly originales = new Map<string, string>();

  private readonly claveBorrador =
    llaveBorrador(this.data.clave, this.data.cedula, this.data.centroCostoId, this.data.turno);
  /** Mientras se reaplica el borrador no se vuelve a escribir en él. */
  private restaurando = false;

  /** Texto comparable: sin espacios duros ni espacios a los lados. */
  private normalizar(t: string | null | undefined): string {
    return (t ?? '').replace(/ /g, ' ').trim();
  }

  constructor() {
    this.docs.vistaPlantilla(this.data.clave, this.data.cedula, this.data.centroCostoId, this.data.usuario)
      .pipe(take(1))
      .subscribe({
        next: (v) => {
          this.html = v.html;
          this.campos.set(v.campos);
          this.vacios.set(v.vacios);
          this.faltanTemporal.set(v.faltan_temporal ?? []);
          this.controles = v.controles ?? [];
          this.guardables = new Set(v.guardables ?? []);
          this.hayGuardables.set(this.guardables.size > 0);
          this.cargando.set(false);
          this.pintar();
        },
        error: (e) => {
          this.cargando.set(false);
          this.error.set(e?.error?.error || e?.error?.mensaje || 'No se pudo cargar la plantilla con los datos de la persona.');
        },
      });
  }

  /** Mete el documento en el iframe cuando ya están los dos: el HTML y el iframe. */
  private pintar(): void {
    const f = this.iframe;
    if (!f || this.html == null || f.dataset['pintado'] === '1') return;
    f.dataset['pintado'] = '1';
    f.addEventListener('load', () => this.preparar(), { once: true });
    // Propiedad del DOM y no binding: Angular sanearía `srcdoc` y se llevaría los estilos.
    f.srcdoc = this.html;
  }

  private preparar(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;
    const estilo = doc.createElement('style');
    estilo.textContent = ESTILOS_EDICION;
    doc.head.appendChild(estilo);
    this.docIframe = doc;

    // Preguntas SI/NO: un clic en su casilla la contesta y desmarca la otra (radio).
    this.preguntas.set(leerPreguntas(doc, this.controles));
    for (const p of this.preguntas()) if (p.valor) marcarRespuesta(doc, p.campo, p.valor);
    for (const s of Array.from(doc.querySelectorAll<HTMLElement>(SELECTOR_SI_NO))) {
      const campo = s.dataset['campo'] ?? '';
      const opcion = normalizarSiNo(s.dataset['opcion']);
      const blanco = (s.closest('.mk') as HTMLElement | null) ?? s;
      // Las fijas las contesta la base (p. ej. plan funeral = lo elegido en Contratación).
      if (this.preguntas().some((p) => p.campo === campo && p.fijo)) {
        blanco.title = 'Lo trae Contratación: se cambia allí, no en el documento';
        continue;
      }
      blanco.title = `Marcar ${opcion ?? ''}`;
      if (opcion) blanco.addEventListener('click', () => this.responder(campo, opcion));
    }
    pintarPendientes(doc, this.preguntas());

    for (const s of Array.from(doc.querySelectorAll<HTMLElement>('span.ph-edit[data-expr]'))) {
      const expr = s.dataset['expr'] ?? '';
      if (s.dataset['control'] === 'si_no') continue;
      if (!this.originales.has(expr)) this.originales.set(expr, this.normalizar(s.textContent));
      if (this.guardables.has(expr)) s.classList.add('ph-bd');
      if (s.classList.contains('chk')) {
        // Una casilla vacía no ocupa nada: el clic vale en toda su celda si es lo único que tiene.
        const td = s.closest('td');
        const blanco = td && td.querySelectorAll('span.ph-edit').length === 1 ? td : s;
        blanco.classList.add('ph-casilla');
        blanco.title = 'Clic para marcar o desmarcar';
        blanco.addEventListener('click', () => this.cambiar(doc, expr, (s.textContent ?? '').trim() ? '' : 'X'));
        continue;
      }
      s.setAttribute('contenteditable', 'plaintext-only');
      if (s.contentEditable !== 'plaintext-only') s.setAttribute('contenteditable', 'true');
      s.spellcheck = false;
      s.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); });
      s.addEventListener('input', () => this.cambiar(doc, expr, s.textContent ?? '', s));
    }
    this.restaurarBorrador(doc);
    // Los estilos de edición (recuadro de los vacíos) cambian anchos: se vuelve a medir.
    this.ajustar(doc);
  }

  /** Reaplica lo que se diligenció la última vez (solo campos que siguen en el documento). */
  private restaurarBorrador(doc: Document): void {
    const b = this.leerBorrador();
    if (!b) return;
    const exprs = new Set(this.originales.keys());
    // Una pregunta fija no se reaplica: el borrador puede traer una respuesta vieja.
    const campos = new Set(this.preguntas().filter((p) => !p.fijo).map((p) => p.campo));
    this.restaurando = true;
    try {
      for (const [expr, v] of Object.entries(b.valores ?? {})) if (exprs.has(expr)) this.cambiar(doc, expr, v);
      for (const [campo, v] of Object.entries(b.respuestas ?? {})) {
        const r = normalizarSiNo(v);
        if (r && campos.has(campo)) this.responder(campo, r);
      }
    } finally {
      this.restaurando = false;
    }
  }

  private leerBorrador(): BorradorPlantilla | null {
    try {
      const ahora = Date.now();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k?.startsWith(BORRADOR_PREFIJO) || k === this.claveBorrador) continue;
        const ts = (JSON.parse(localStorage.getItem(k) ?? '{}') as Partial<BorradorPlantilla>).ts ?? 0;
        if (ahora - ts > BORRADOR_VIGENCIA_MS) localStorage.removeItem(k);
      }
      const raw = localStorage.getItem(this.claveBorrador);
      if (!raw) return null;
      const b = JSON.parse(raw) as BorradorPlantilla;
      return ahora - (b.ts ?? 0) > BORRADOR_VIGENCIA_MS ? null : b;
    } catch {
      return null;
    }
  }

  private guardarBorrador(): void {
    if (this.restaurando || !this.isBrowser) return;
    const respuestas: Record<string, RespuestaSiNo> = {};
    for (const p of this.preguntas()) if (p.valor) respuestas[p.campo] = p.valor;
    const b: BorradorPlantilla = { valores: Object.fromEntries(this.valores), respuestas, ts: Date.now() };
    try {
      localStorage.setItem(this.claveBorrador, JSON.stringify(b));
    } catch { /* sin almacenamiento el documento funciona igual, solo no se recuerda */ }
  }

  /** Letra del dato que no cabe en su celda, igual que en el PDF (script de ms-templates). */
  private ajustar(doc: Document, el?: HTMLElement): void {
    const win = doc.defaultView as (Window & { ajustarDatosExcel?: (el?: HTMLElement) => unknown }) | null;
    try { win?.ajustarDatosExcel?.(el); } catch { /* sin ajuste se ve igual que antes */ }
  }

  /**
   * Aplica el valor a todas las apariciones de la expresión y recuenta.
   *
   * Si el valor vuelve a ser el original, el cambio se deshace: deja de viajar al generar
   * y se quita el verde. Antes quedaba marcado aunque se borrara lo escrito.
   */
  private cambiar(doc: Document, expr: string, valor: string, origen?: HTMLElement): void {
    const limpio = valor.replace(/\u00a0/g, ' ');
    const esOriginal = this.normalizar(limpio) === (this.originales.get(expr) ?? '');
    if (esOriginal) this.valores.delete(expr);
    else this.valores.set(expr, limpio.trim());
    const todas = Array.from(doc.querySelectorAll<HTMLElement>('span.ph-edit[data-expr]'));
    for (const s of todas) {
      if (s.dataset['expr'] !== expr) continue;
      if (s !== origen) s.textContent = limpio;
      // Una casilla sin marcar no es un dato que falte.
      s.classList.toggle('ph-vacio', !limpio.trim() && !s.classList.contains('chk'));
      s.classList.toggle('ph-editado', !esOriginal);
      this.ajustar(doc, s);
    }
    this.vacios.set(todas.filter((s) => !s.classList.contains('chk') && !(s.textContent ?? '').trim()).length);
    this.editados.set(this.valores.size);
    this.guardarBorrador();
  }

  /** Contesta una pregunta SI/NO con un clic en su paréntesis: X en el elegido, el otro vacío. */
  responder(campo: string, valor: RespuestaSiNo): void {
    if (this.preguntas().some((p) => p.campo === campo && p.fijo)) return;
    this.preguntas.update((ps) => ps.map((p) => (p.campo === campo ? { ...p, valor } : p)));
    if (this.docIframe) {
      marcarRespuesta(this.docIframe, campo, valor);
      pintarPendientes(this.docIframe, this.preguntas());
    }
    this.guardarBorrador();
  }

  /**
   * Consolidar. Si lo escrito toca los datos de la persona, primero se revisa (sin escribir) y
   * se pide confirmación con la lista de lo que se guarda y lo que se reemplaza.
   */
  guardar(): void {
    if (this.guardando() || this.cargando() || this.faltanTemporal().length || this.sinResponder().length) return;
    const valores = this.valoresAEnviar();
    const tocaDatos = Object.keys(valores).some((k) => this.guardables.has(k));
    if (!tocaDatos) {
      this.consolidar(valores, false);
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.docs.revisarDatosPlantilla(this.data.clave, this.data.cedula, this.data.centroCostoId, valores, this.data.usuario)
      .pipe(take(1))
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          if (r.guardar > 0 || r.no_se_guarda > 0) this.revision.set(r);
          else this.consolidar(valores, false);
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(e?.error?.error || 'No se pudieron revisar los datos de la persona. No se guardó nada.');
        },
      });
  }

  /** Desde la confirmación: guarda los datos (reemplazando lo que se mostró) y el documento. */
  confirmarDatos(): void {
    const r = this.revision();
    this.revision.set(null);
    this.consolidar(this.valoresAEnviar(), (r?.sobrescribe ?? 0) > 0);
  }

  volverDeRevision(): void {
    this.revision.set(null);
  }

  /** Nombre del campo para la pantalla: el del documento o, si no, la columna. */
  etiqueta(c: CambioDatoDocumento): string {
    return c.etiqueta || c.campo.replace(/_/g, ' ');
  }

  private valoresAEnviar(): Record<string, string> {
    // Las respuestas SI/NO viajan con el campo como clave; ms-templates pone la X.
    const valores: Record<string, string> = Object.fromEntries(this.valores);
    for (const p of this.preguntas()) if (p.valor) valores[p.campo] = p.valor;
    return valores;
  }

  private consolidar(valores: Record<string, string>, confirmarSobrescritura: boolean): void {
    this.guardando.set(true);
    this.error.set(null);
    this.docs.generarPlantilla(this.data.clave, this.data.cedula, this.data.centroCostoId,
      valores, true, this.data.usuario, { guardar: true, confirmarSobrescritura })
      .pipe(take(1))
      .subscribe({
        next: () => this.ref.close({ guardado: true }),
        error: async (e) => {
          this.guardando.set(false);
          // La respuesta es un Blob (se pidió PDF): el error JSON viene dentro.
          let msg = 'No se pudo generar ni guardar el documento.';
          try {
            const txt = e?.error instanceof Blob ? await e.error.text() : '';
            const cuerpo = txt ? JSON.parse(txt) : null;
            // Otro cambio entró entre la revisión y el guardado: se vuelve a pedir confirmación.
            if (cuerpo?.codigo === 'DATOS_SOBRESCRIBEN' && cuerpo.revision) {
              this.revision.set(cuerpo.revision as RevisionDatosPlantilla);
              return;
            }
            msg = cuerpo?.error || msg;
          } catch { /* se deja el mensaje genérico */ }
          this.error.set(msg);
        },
      });
  }

  cancelar(): void {
    this.ref.close();
  }
}
