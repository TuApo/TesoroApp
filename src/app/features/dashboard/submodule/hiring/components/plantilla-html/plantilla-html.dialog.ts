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
  type UsuarioDocumento,
} from '../../service/documentos-parametrizados/documentos-parametrizados.service';

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
  .ph-edit:focus { outline: 2px solid #2563eb !important; background: #eff6ff !important; }
`;

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

  /** Lo escrito a mano: expresión -> texto. Es lo que viaja al generar. */
  private readonly valores = new Map<string, string>();
  /** Valor con el que llegó cada expresión: volver a él deshace el cambio. */
  private readonly originales = new Map<string, string>();

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

    for (const s of Array.from(doc.querySelectorAll<HTMLElement>('span.ph-edit[data-expr]'))) {
      const expr = s.dataset['expr'] ?? '';
      if (!this.originales.has(expr)) this.originales.set(expr, this.normalizar(s.textContent));
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
    // Los estilos de edición (recuadro de los vacíos) cambian anchos: se vuelve a medir.
    this.ajustar(doc);
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
  }

  guardar(): void {
    if (this.guardando() || this.cargando() || this.faltanTemporal().length) return;
    this.guardando.set(true);
    this.error.set(null);
    this.docs.generarPlantilla(this.data.clave, this.data.cedula, this.data.centroCostoId,
      Object.fromEntries(this.valores), true, this.data.usuario)
      .pipe(take(1))
      .subscribe({
        next: () => this.ref.close({ guardado: true }),
        error: async (e) => {
          this.guardando.set(false);
          // La respuesta es un Blob (se pidió PDF): el error JSON viene dentro.
          let msg = 'No se pudo generar ni guardar el documento.';
          try {
            const txt = e?.error instanceof Blob ? await e.error.text() : '';
            msg = (txt && JSON.parse(txt)?.error) || msg;
          } catch { /* se deja el mensaje genérico */ }
          this.error.set(msg);
        },
      });
  }

  cancelar(): void {
    this.ref.close();
  }
}
