import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FieldRendererComponent } from '@/app/shared/components/forms/field-renderer/field-renderer.component';
import { DynamicField, FieldValue, FormSection, FormTheme } from '../../models/dynamic-forms.models';
import { ocupaFilaCompleta } from '../../models/field-layout';
import { temaEfectivo, variablesTema } from '../../models/form-theme';

/** Sección lista para pintar: todos los campos con `name` garantizado. */
interface SeccionPreview {
  titulo: string | null;
  campos: DynamicField[];
}

/** Maqueta en la que se mira el formulario. */
export type DispositivoPreview = 'movil' | 'escritorio';

/**
 * Vista previa del builder: pinta EN VIVO el formulario tal como lo verá quien lo
 * llene, derivada 100% del estado de la página (input sections); no mantiene una copia
 * editable de la estructura.
 *
 * Dos maquetas, a elección de quien construye (el mismo formulario se llena desde el
 * APK y desde un escritorio):
 *  - `movil`      → teléfono, una sola columna.
 *  - `escritorio` → ventana ancha con la grilla de dos columnas del runtime.
 * Solo cambia el marco y el número de columnas: el contenido es el mismo árbol.
 *
 * Los VALORES sí son estado local efímero (probar los controles no toca nada):
 * como en modo creación los campos aún no tienen `name` (lo genera el backend),
 * se sintetiza un name posicional SOLO para esta vista — jamás viaja al API.
 * Cambiar de maqueta no los pierde: viven en el componente, no en los marcos.
 */
@Component({
  selector: 'app-form-preview',
  standalone: true,
  imports: [CommonModule, FieldRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pv">

      <!-- Selector de maqueta: lo primero, porque decide todo lo que se ve debajo. -->
      <div class="pv__barra">
        <div class="pv__tabs" role="group" aria-label="Ver la vista previa como">
          <button type="button" class="pv__tab" [class.pv__tab--on]="dispositivo() === 'movil'"
                  [attr.aria-pressed]="dispositivo() === 'movil'"
                  (click)="dispositivo.set('movil')">
            <span class="material-symbols-outlined" aria-hidden="true">smartphone</span>
            Móvil
          </button>
          <button type="button" class="pv__tab" [class.pv__tab--on]="dispositivo() === 'escritorio'"
                  [attr.aria-pressed]="dispositivo() === 'escritorio'"
                  (click)="dispositivo.set('escritorio')">
            <span class="material-symbols-outlined" aria-hidden="true">desktop_windows</span>
            Escritorio
          </button>
        </div>
        @if (hayValores()) {
          <button type="button" class="pv__reset" (click)="limpiar()" title="Limpiar los valores de prueba">
            <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
            Limpiar
          </button>
        }
      </div>

      @if (dispositivo() === 'movil') {
        <div class="phone" role="region" aria-label="Vista previa del formulario en un teléfono">
          <div class="phone__top"><span class="phone__notch"></span></div>
          <div class="pv__screen phone__screen">
            <ng-container [ngTemplateOutlet]="cuerpo" />
          </div>
          <div class="pv__foot phone__foot">
            <span class="pv__hint">Vista previa · los valores no se guardan</span>
          </div>
        </div>
      } @else {
        <div class="desk" role="region" aria-label="Vista previa del formulario en un escritorio">
          <div class="desk__bar">
            <span class="desk__punto" aria-hidden="true"></span>
            <span class="desk__punto" aria-hidden="true"></span>
            <span class="desk__punto" aria-hidden="true"></span>
            <span class="desk__pestana">{{ formName() || 'Formulario sin nombre' }}</span>
          </div>
          <div class="pv__screen desk__screen">
            <ng-container [ngTemplateOutlet]="cuerpo" />
          </div>
          <div class="pv__foot desk__foot">
            <span class="pv__hint">Vista previa · los valores no se guardan</span>
          </div>
        </div>
      }
    </div>

    <!-- Cuerpo común: lo único que cambia entre maquetas es el número de columnas. -->
    <ng-template #cuerpo>
      <div class="pv__header">
        <span class="material-symbols-outlined pv__icono" aria-hidden="true">{{ icono() }}</span>
        <div class="pv__header-txt">
          <h3 class="pv__name">{{ formName() || 'Formulario sin nombre' }}</h3>
          @if (formDescription()) {
            <p class="pv__desc">{{ formDescription() }}</p>
          }
        </div>
      </div>

      @if (wizard() && vista().length > 1) {
        <div class="pv__pasos" aria-hidden="true">
          @for (sec of vista(); track $index) {
            <span class="pv__paso" [class.pv__paso--actual]="$index === 0">{{ $index + 1 }}</span>
          }
          <span class="pv__pasos-txt">Paso 1 de {{ vista().length }}</span>
        </div>
      }

      @if (totalCampos() === 0) {
        <div class="pv__empty">
          <span class="material-symbols-outlined" aria-hidden="true">
            {{ dispositivo() === 'escritorio' ? 'desktop_windows' : 'smartphone' }}
          </span>
          <p>Agrega campos para ver la vista previa en vivo.</p>
        </div>
      } @else {
        @for (sec of vista(); track $index) {
          @if (sec.campos.length > 0) {
            <section class="pv__section">
              @if (sec.titulo) { <h4 class="pv__section-title">{{ sec.titulo }}</h4> }
              <!-- Móvil: una columna (el teléfono simula el ancho real).
                   Escritorio: la misma grilla de dos columnas del runtime. -->
              <div class="pv__fields" [class.pv__fields--grid]="dispositivo() === 'escritorio'">
                @for (f of sec.campos; track f.name) {
                  <div class="pv__cell" [class.pv__cell--full]="anchoCompleto(f)">
                    <app-field-renderer
                        [field]="f"
                        mode="preview"
                        [value]="valor(f)"
                        [sectionValues]="valores()"
                        [formValues]="valores()"
                        (valueChange)="poner(f, $event)"
                        (childChange)="poner($event.field, $event.value)" />
                  </div>
                }
              </div>
            </section>
          }
        }
      }
    </ng-template>
  `,
  styles: [`
    .pv {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }

    /* ── Selector de maqueta ── */

    .pv__barra {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pv__tabs {
      display: inline-flex;
      padding: 3px;
      gap: 3px;
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 999px;
      background: var(--surface, #fff);
    }
    .pv__tab {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--slate-600, #475569);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 5px 12px;
      cursor: pointer;
    }
    .pv__tab:hover { background: var(--slate-100, #f1f5f9); }
    .pv__tab:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
    .pv__tab--on,
    .pv__tab--on:hover {
      background: var(--navy, #21263c);
      color: #fff;
    }
    .pv__tab .material-symbols-outlined { font-size: 16px; }

    .pv__reset {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 999px;
      background: var(--surface, #fff);
      color: var(--slate-600, #475569);
      font: inherit;
      font-size: 0.75rem;
      padding: 5px 11px;
      cursor: pointer;
    }
    .pv__reset:hover { background: var(--slate-100, #f1f5f9); }
    .pv__reset:focus-visible { outline: 2px solid var(--lime, #8cd50a); outline-offset: 1px; }
    .pv__reset .material-symbols-outlined { font-size: 15px; }

    /* ── Cuerpo (común a las dos maquetas) ── */

    .pv__screen {
      /* --pv-pad: el ancho del respiro lateral; la cabecera lo sangra para ir a borde. */
      overflow-y: auto;
      background: var(--df-bg, var(--slate-50, #f8fafc));
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 0 var(--pv-pad) 20px;
    }
    .pv__header {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--df-header-bg, var(--navy, #21263c));
      color: #fff;
      margin: 0 calc(-1 * var(--pv-pad));
      padding: 14px 16px 16px;
    }
    .pv__header-txt { min-width: 0; }
    .pv__icono {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.14);
      font-size: 20px;
    }
    .pv__name {
      margin: 0;
      font-size: 1.02rem;
      font-weight: 700;
      word-break: break-word;
    }
    .pv__desc {
      margin: 4px 0 0;
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.75);
      word-break: break-word;
    }
    .pv__pasos {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      padding: 2px 0;
    }
    .pv__paso {
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--slate-200, #e8edf3);
      color: var(--slate-700, #334155);
      font-size: 11px;
      font-weight: 700;
    }
    .pv__paso--actual {
      background: var(--df-primary, #8cd50a);
      color: var(--df-on-primary, #21263c);
    }
    .pv__pasos-txt {
      font-size: 11px;
      color: var(--muted, #64748b);
    }
    .pv__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-top: 90px;
      color: var(--slate-500, #64748b);
      text-align: center;
      padding: 0 20px;
    }
    .pv__empty .material-symbols-outlined { font-size: 44px; }
    .pv__empty p { margin: 0; font-size: 0.88rem; }

    .pv__section {
      background: var(--df-surface, #fff);
      border: 1px solid var(--df-borde, #e8edf3);
      border-radius: var(--df-radius, 14px);
      padding: 12px;
    }
    .pv__section-title {
      margin: 0 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--df-borde, #e8edf3);
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--df-accent, #21263c);
    }
    .pv__fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pv__fields--grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--df-gap, 16px) 18px;
    }
    .pv__cell { min-width: 0; }
    .pv__fields--grid .pv__cell--full { grid-column: 1 / -1; }

    .pv__foot {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--navy-deep, #0f172a);
      padding: 8px 14px;
    }
    .pv__hint {
      font-size: 0.72rem;
      color: rgba(255, 255, 255, 0.6);
    }

    /* ── Maqueta teléfono ── */

    .phone {
      width: 380px;
      max-width: 100%;
      margin: 0 auto;
      border: 10px solid var(--navy-deep, #0f172a);
      border-radius: 42px;
      background: var(--surface, #fff);
      box-shadow: var(--shadow-md, 0 10px 26px rgba(17,24,39,.10));
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .phone__top {
      background: var(--navy-deep, #0f172a);
      display: flex;
      justify-content: center;
      padding-bottom: 6px;
    }
    .phone__notch {
      width: 110px;
      height: 16px;
      background: #000;
      border-radius: 0 0 12px 12px;
    }
    .phone__screen {
      --pv-pad: 12px;
      height: 600px;
    }

    /* ── Maqueta escritorio ── */

    .desk {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--slate-300, #cbd5e1);
      border-radius: 14px;
      background: var(--surface, #fff);
      box-shadow: var(--shadow-md, 0 10px 26px rgba(17,24,39,.10));
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .desk__bar {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--navy-deep, #0f172a);
      padding: 8px 12px;
    }
    .desk__punto {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.28);
    }
    .desk__pestana {
      flex: 1 1 auto;
      margin-left: 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.72rem;
      padding: 3px 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .desk__screen {
      --pv-pad: 20px;
      height: 620px;
      /* La grilla se mide contra la ventana simulada, no contra el viewport: así la
         maqueta angosta colapsa a una columna igual que el runtime en pantalla chica. */
      container-type: inline-size;
      container-name: pv-desk;
    }
    .desk__screen .pv__header { padding: 18px 22px 20px; }
    .desk__screen .pv__section { padding: var(--df-pad, 18px 20px); }

    @container pv-desk (max-width: 620px) {
      .pv__fields--grid { grid-template-columns: minmax(0, 1fr); }
    }
  `],
})
export class FormPreviewComponent {
  formName = input<string>('');
  formDescription = input<string>('');
  /** ÚNICA fuente de la estructura: las secciones del builder tal cual. */
  sections = input<FormSection[]>([]);
  /** Tema en edición: la vista previa muestra los colores reales, no los de la marca. */
  theme = input<FormTheme | null>(null);
  /** true = el formulario se llenará paso a paso; se dibujan los pasos en la maqueta. */
  wizard = input<boolean>(false);
  /** Maqueta visible. Es `model` para que la página pueda recordar la elección. */
  dispositivo = model<DispositivoPreview>('movil');

  /** Regla de fila completa compartida con el runtime. */
  protected readonly anchoCompleto = ocupaFilaCompleta;

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Mismas custom properties que el runtime, aplicadas por API del DOM (el binding
    // [style] de Angular no fija propiedades personalizadas).
    effect(() => {
      const vars = variablesTema(this.theme());
      const el = this.host.nativeElement;
      for (const [nombre, valor] of Object.entries(vars)) el.style.setProperty(nombre, valor);
    });
  }

  /** Icono del tema, el mismo que encabeza el formulario publicado. */
  icono = computed(() => temaEfectivo(this.theme()).icon || 'edit_note');

  /** Valores efímeros de prueba, por name (real o sintetizado). */
  private valoresMap = signal<Record<string, FieldValue>>({});
  valores = this.valoresMap.asReadonly();

  /** Estructura derivada con `name` garantizado en cada campo e hijo. */
  vista = computed<SeccionPreview[]>(() =>
    this.sections().map((s, si) => ({
      titulo: s.title?.trim() || null,
      campos: s.fields.map((f, fi) => this.conNombre(f, `pv_s${si}_f${fi}`)),
    })),
  );

  totalCampos = computed(() =>
    this.sections().reduce((acc, s) => acc + s.fields.length, 0));

  hayValores = computed(() => Object.keys(this.valoresMap()).length > 0);

  valor(f: DynamicField): FieldValue {
    const n = f.name;
    return n ? (this.valoresMap()[n] ?? null) : null;
  }

  poner(f: DynamicField, v: FieldValue): void {
    const n = f.name;
    if (!n) return;
    this.valoresMap.update(m => ({ ...m, [n]: v }));
  }

  limpiar(): void {
    this.valoresMap.set({});
  }

  /** Copia del campo con name sintético posicional (solo para el preview). */
  private conNombre(f: DynamicField, uid: string): DynamicField {
    const hijos = f.children?.map((c, ci) => ({ ...c, name: c.name ?? `${uid}_c${ci}` }));
    return hijos
      ? { ...f, name: f.name ?? uid, children: hijos }
      : { ...f, name: f.name ?? uid };
  }
}
