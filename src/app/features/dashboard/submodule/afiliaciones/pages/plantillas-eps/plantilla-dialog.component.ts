import {
  Component, Inject, OnInit, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  PlantillaDetalle, PlantillaRequest, CampoDisponible, CampoRequest, CampoDto,
  FUENTES_CAMPO, TIPOS_RENDER, FuenteCampo, TipoRender
} from '../../models/plantilla-eps.models';
import { CanvasEditorComponent } from './canvas-editor/canvas-editor.component';

export interface PlantillaDialogData {
  detalle: PlantillaDetalle | null;
  camposDisponibles: CampoDisponible[];
}

/**
 * Diálogo para crear/editar una plantilla EPS (V36/V39).
 *
 * Pestañas:
 *   1. Configuración — metadatos (EPS, temporal, sexo, nombre, notas)
 *   2. Editor Visual — canvas editor con páginas, campos posicionados y tipografía
 *
 * El tab de HTML puro se mantiene dentro del tab "Editor Visual" como opción secundaria
 * (toggle para planillas sin páginas canvas).
 */
@Component({
  selector: 'app-plantilla-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule, MatTabsModule,
    MatSlideToggleModule, MatTooltipModule, MatChipsModule, MatDividerModule, MatSnackBarModule,
    CanvasEditorComponent,
  ],
  template: `
<h2 mat-dialog-title>
  {{ data.detalle ? 'Editar plantilla' : 'Nueva plantilla' }}
  @if (data.detalle) {
    <span class="version-badge">v{{ data.detalle.version }}</span>
  }
  @if (data.detalle?.paginas?.length) {
    <span class="canvas-badge">
      <mat-icon inline>layers</mat-icon>
      {{ data.detalle!.paginas!.length }} página{{ data.detalle!.paginas!.length !== 1 ? 's' : '' }}
    </span>
  }
</h2>

<mat-dialog-content class="dialog-content">
  <mat-tab-group [(selectedIndex)]="tabIndex" animationDuration="150ms">

    <!-- ── Pestaña 1: Configuración ─────────────────────────────── -->
    <mat-tab label="📋 Configuración">
      <div class="tab-body" [formGroup]="metaForm">

        <div class="field-grid">
          <mat-form-field appearance="outline" class="full">
            <mat-label>Nombre de la plantilla</mat-label>
            <input matInput formControlName="nombrePlantilla"
                   placeholder="Ej: Plantilla_CapitalSalud_TuAlianza">
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>EPS (clave normalizada)</mat-label>
            <input matInput formControlName="epsKey"
                   placeholder="Ej: CAPITAL_SALUD">
            <mat-hint>Sin espacios, mayúsculas, guión bajo</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>EPS (nombre completo)</mat-label>
            <input matInput formControlName="epsNombre"
                   placeholder="Ej: Capital Salud EPSS">
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Temporal</mat-label>
            <mat-select formControlName="temporalKey">
              <mat-option [value]="null">Aplica a todas</mat-option>
              <mat-option value="APOYO_LABORAL">Apoyo Laboral</mat-option>
              <mat-option value="TU_ALIANZA">Tu Alianza</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Sexo</mat-label>
            <mat-select formControlName="sexo">
              <mat-option [value]="null">Ambos</mat-option>
              <mat-option value="M">Masculino</mat-option>
              <mat-option value="F">Femenino</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full">
            <mat-label>ID Google Docs (referencia)</mat-label>
            <input matInput formControlName="googleDocId"
                   placeholder="Pega el ID del doc de referencia (solo trazabilidad)">
            <mat-hint>El PDF se genera del editor visual, no de Google Docs.</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full">
            <mat-label>Notas</mat-label>
            <textarea matInput formControlName="notas" rows="2"></textarea>
          </mat-form-field>
        </div>

        <mat-slide-toggle formControlName="activa" color="primary">Plantilla activa</mat-slide-toggle>

        <!-- HTML Fallback (oculto por defecto, solo para plantillas legacy sin canvas) -->
        <div class="html-fallback-section">
          <button type="button" mat-stroked-button class="btn-toggle-html"
                  (click)="mostrarHtml = !mostrarHtml">
            <mat-icon>{{ mostrarHtml ? 'expand_less' : 'expand_more' }}</mat-icon>
            {{ mostrarHtml ? 'Ocultar' : 'Mostrar' }} HTML de respaldo (motor legacy)
          </button>

          @if (mostrarHtml) {
            <div class="html-section">
              <div class="html-toolbar">
                <span class="html-hint">
                  HTML usado como fallback cuando no hay páginas del editor visual.
                  Usa <code>{{'{{PlaceholderName}}'}}</code> para insertar datos.
                </span>
                <button type="button" mat-stroked-button (click)="insertarEjemploCss()">
                  <mat-icon>style</mat-icon> Insertar CSS firma
                </button>
              </div>
              <textarea class="html-editor" formControlName="htmlContenido"
                        placeholder="<!DOCTYPE html>..."></textarea>
              <div class="placeholders-ref">
                <strong>Placeholders disponibles en el editor:</strong>
                <div class="ph-chips">
                  @for (c of camposActuales; track c.placeholder) {
                    @if (c.activo) {
                      <span class="ph-chip" (click)="copiarPlaceholder(c.placeholder)">
                        {{ '{' + '{' + c.placeholder + '}' + '}' }}
                      </span>
                    }
                  }
                  @if (!camposActuales.length) {
                    <span class="ph-empty">Los campos se definen en el Editor Visual</span>
                  }
                </div>
              </div>
            </div>
          }
        </div>

      </div>
    </mat-tab>

    <!-- ── Pestaña 2: Editor Visual ─────────────────────────────── -->
    <mat-tab label="🖼️ Editor Visual">
      <div class="canvas-tab-body">
        @if (data.detalle?.id) {
          <app-canvas-editor
            [plantillaId]="data.detalle!.id"
            [campos]="camposActuales"
            [camposDisponibles]="data.camposDisponibles"
            (camposSaved)="onCamposSaved($event)">
          </app-canvas-editor>
        } @else {
          <div class="canvas-pending">
            <mat-icon>save</mat-icon>
            <p>Guarda primero la plantilla (pestaña Configuración) para habilitar el editor visual.</p>
            <button mat-raised-button color="primary" (click)="guardar()">
              <mat-icon>save</mat-icon> Crear plantilla
            </button>
          </div>
        }
      </div>
    </mat-tab>

  </mat-tab-group>
</mat-dialog-content>

<mat-dialog-actions align="end">
  <button mat-button mat-dialog-close>Cancelar</button>
  <button mat-raised-button color="primary" (click)="guardar()"
          [disabled]="metaForm.invalid">
    <mat-icon>save</mat-icon>
    {{ data.detalle ? 'Actualizar metadatos' : 'Crear plantilla' }}
  </button>
</mat-dialog-actions>
  `,
  styles: [`
    .dialog-content { padding: 0 24px; overflow-y: auto; }
    .version-badge {
      margin-left: 12px; font-size: .75rem; background: #e0e7ff;
      color: #3730a3; padding: 2px 8px; border-radius: 12px;
    }
    .canvas-badge {
      margin-left: 8px; font-size: .75rem; background: #dcfce7;
      color: #166534; padding: 2px 8px; border-radius: 12px;
      display: inline-flex; align-items: center; gap: 3px;
    }
    .tab-body { padding: 20px 0; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
    .field-grid .full { grid-column: 1 / -1; }
    mat-form-field { width: 100%; }

    /* Canvas tab */
    .canvas-tab-body {
      height: calc(90vh - 200px); min-height: 500px;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .canvas-pending {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100%; gap: 12px; color: #64748b; text-align: center;
    }
    .canvas-pending mat-icon { font-size: 3rem !important; color: #cbd5e1; }
    .canvas-pending p { max-width: 300px; font-size: .88rem; }

    /* HTML fallback */
    .html-fallback-section { margin-top: 20px; }
    .btn-toggle-html { font-size: .78rem; }
    .html-section { margin-top: 10px; }
    .html-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .html-hint { font-size: .82rem; color: #666; }
    .html-editor {
      width: 100%; min-height: 240px; font-family: 'Courier New', monospace; font-size: .8rem;
      border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;
      resize: vertical; box-sizing: border-box;
    }
    .html-editor:focus { outline: 2px solid #3b82f6; }

    .placeholders-ref { margin-top: 10px; }
    .placeholders-ref strong { font-size: .82rem; display: block; margin-bottom: 6px; }
    .ph-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .ph-chip {
      background: #ede9fe; color: #5b21b6; font-size: .75rem; padding: 3px 10px;
      border-radius: 12px; cursor: pointer; font-family: monospace;
      transition: background .15s;
    }
    .ph-chip:hover { background: #ddd6fe; }
    .ph-empty { color: #aaa; font-size: .8rem; }

    h2[mat-dialog-title] { display: flex; align-items: center; flex-wrap: wrap; }
  `],
})
export class PlantillaDialogComponent implements OnInit {

  tabIndex = 0;
  mostrarHtml = false;
  fuentes  = FUENTES_CAMPO;
  tiposRender = TIPOS_RENDER;

  metaForm!: FormGroup;

  /** Campos vivos (con posición visual) — se actualiza al guardar desde el canvas editor. */
  camposActuales: CampoDto[] = [];

  constructor(
    public dialogRef: MatDialogRef<PlantillaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PlantillaDialogData,
    private fb: FormBuilder,
    private snack: MatSnackBar,
  ) {}

  ngOnInit() {
    const d = this.data.detalle;
    this.camposActuales = d?.campos ? d.campos.map(c => ({ ...c })) : [];

    this.metaForm = this.fb.group({
      nombrePlantilla: [d?.nombrePlantilla ?? '', Validators.required],
      epsKey:          [d?.epsKey ?? '',          Validators.required],
      epsNombre:       [d?.epsNombre ?? '',        Validators.required],
      temporalKey:     [d?.temporalKey ?? null],
      sexo:            [d?.sexo ?? null],
      googleDocId:     [d?.googleDocId ?? ''],
      htmlContenido:   [d?.htmlContenido ?? ''],
      activa:          [d?.activa ?? true],
      notas:           [d?.notas ?? ''],
    });
  }

  /** Recibe los campos actualizados desde el canvas editor (posición, tipografía, etc.). */
  onCamposSaved(campos: CampoDto[]) {
    this.camposActuales = campos;
    this.snack.open('Campos del canvas actualizados', '', { duration: 2000 });
  }

  copiarPlaceholder(placeholder: string) {
    const texto = `{{${placeholder}}}`;
    navigator.clipboard.writeText(texto).then(() =>
      this.snack.open(`Copiado: ${texto}`, '', { duration: 1500 })
    );
  }

  insertarEjemploCss() {
    const css = `<style>
  /* ── Fuente cursiva para campos de FIRMA ─────────── */
  @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap');
  .afil-firma {
    font-family: 'Dancing Script', cursive;
    font-size: 18px;
    font-weight: 600;
    color: #1a237e;
    letter-spacing: 1px;
  }
  /* ── Imágenes (sello/firma en imagen) ─────────────── */
  .afil-img {
    max-height: 50px;
    max-width: 150px;
    object-fit: contain;
    vertical-align: middle;
  }
</style>`;
    const current = this.metaForm.get('htmlContenido')?.value ?? '';
    if (!current.includes('.afil-firma')) {
      this.metaForm.get('htmlContenido')?.setValue(css + '\n\n' + current);
      this.snack.open('CSS insertado al inicio del HTML', '', { duration: 2000 });
    } else {
      this.snack.open('El CSS de firma ya está en el HTML', '', { duration: 2000 });
    }
  }

  guardar() {
    if (this.metaForm.invalid) { this.tabIndex = 0; return; }
    const v = this.metaForm.value;

    // Convertir CampoDto[] → CampoRequest[]
    const campos: CampoRequest[] = this.camposActuales.map((c, i) => ({
      id:                c.id || undefined,
      placeholder:       c.placeholder,
      fuente:            c.fuente,
      campoFuente:       c.campoFuente   || undefined,
      fuenteConfigCampo: c.fuenteConfigCampo || undefined,
      valorLiteral:      c.valorLiteral  || undefined,
      formula:           c.formula       || undefined,
      tipoRender:        c.tipoRender,
      formato:           c.formato       || undefined,
      activo:            c.activo,
      orden:             i,
      // posición visual
      pagina:     c.pagina,
      posX:       c.posX,
      posY:       c.posY,
      ancho:      c.ancho,
      alto:       c.alto,
      fontSize:   c.fontSize,
      fontFamily: c.fontFamily  || undefined,
      fontColor:  c.fontColor,
      fontBold:   c.fontBold,
      fontItalic: c.fontItalic,
      textAlign:  c.textAlign,
    }));

    const req: PlantillaRequest = {
      temporalKey:     v.temporalKey || null,
      epsKey:          v.epsKey,
      epsNombre:       v.epsNombre,
      sexo:            v.sexo || null,
      nombrePlantilla: v.nombrePlantilla,
      googleDocId:     v.googleDocId || null,
      htmlContenido:   v.htmlContenido || null,
      activa:          v.activa,
      notas:           v.notas || null,
      campos,
    };

    this.dialogRef.close(req);
  }
}
