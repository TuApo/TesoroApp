import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatStepperModule } from '@angular/material/stepper';
import { MatTooltipModule } from '@angular/material/tooltip';

import { firstValueFrom } from 'rxjs';

import { PlantillasCorreoService } from '../../services/plantillas-correo.service';
import {
  AnalisisImportacion, Catalogo, OrigenDatos, PlantillaResumen, ResultadoImportacion, Variable,
} from '../../models/plantilla-correo.model';

/** Lo que la página que abre el diálogo le pasa. */
export interface DatosImportar {
  origenes: OrigenDatos[];
  plantillas: PlantillaResumen[];
  /** Preseleccionada cuando se importa DENTRO de una plantilla ya abierta. */
  plantillaDestino?: PlantillaResumen | null;
}

/**
 * Asistente para traer una plantilla de correo ya hecha (Stripo, Mailchimp, un
 * HTML a mano) al catálogo.
 *
 * <h3>Por qué son cuatro pasos y no un pegar-y-guardar</h3>
 * Una plantilla real trae dos cosas que no encajan solas: marcadores de otro
 * sistema (`{{nombre}}`, `{{cedula}}`, `{{finca}}`) e imágenes alojadas en un CDN
 * ajeno. Guardarla sin resolver lo primero manda los marcadores literales, entre
 * llaves, en el correo de cientos de personas; sin resolver lo segundo, el día
 * que caduque ese CDN todos los correos salen con recuadros rotos.
 *
 * Los pasos son: **archivo → variables → imágenes → destino**. El de variables e
 * imágenes vienen preseleccionados por el backend, así que en el caso normal es
 * revisar y seguir.
 */
@Component({
  selector: 'app-importar-html-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule,
    MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressBarModule, MatSelectModule, MatSnackBarModule, MatStepperModule, MatTooltipModule,
  ],
  templateUrl: './importar-html-dialog.component.html',
  styleUrl: './importar-html-dialog.component.css',
})
export class ImportarHtmlDialogComponent {
  private srv = inject(PlantillasCorreoService);
  private snack = inject(MatSnackBar);
  readonly datos = inject<DatosImportar>(MAT_DIALOG_DATA);
  readonly ref = inject<MatDialogRef<ImportarHtmlDialogComponent, ResultadoImportacion | null>>(MatDialogRef);

  // Paso 1
  readonly nombreArchivo = signal<string | null>(null);
  readonly htmlPegado = signal('');
  readonly analizando = signal(false);
  readonly analisis = signal<AnalisisImportacion | null>(null);

  // Paso 2 · emparejado. placeholder → clave del catálogo ('' = dejar literal)
  readonly mapeos = signal<Record<string, string>>({});
  readonly catalogo = signal<Catalogo | null>(null);

  // Paso 3 · imágenes seleccionadas para traer a la biblioteca
  readonly imagenesElegidas = signal<Set<string>>(new Set());

  // Paso 4 · destino
  readonly origenCodigo = signal<string | null>(null);
  readonly plantillaDestinoId = signal<string | null>(null);
  readonly nombre = signal('');
  readonly categoria = signal('');
  readonly asunto = signal('');
  readonly modoImagenes = signal<'CID' | 'URL'>('URL');
  readonly guardando = signal(false);

  constructor() {
    this.origenCodigo.set(this.datos.plantillaDestino?.origen_codigo ?? 'CONTRATACION');
    this.plantillaDestinoId.set(this.datos.plantillaDestino?.id ?? null);
    if (this.datos.plantillaDestino) this.nombre.set(this.datos.plantillaDestino.nombre);
  }

  // ── Derivados ──────────────────────────────────────────────────────────────

  readonly variablesPlanas = computed<Variable[]>(() =>
    (this.catalogo()?.grupos ?? []).flatMap((g) => g.variables));

  readonly sinEquivalente = computed(() =>
    (this.analisis()?.placeholders ?? []).filter((p) => !this.mapeos()[p.nombre]));

  readonly imagenesDescargables = computed(() =>
    (this.analisis()?.imagenes ?? []).filter((i) => i.descargable));

  readonly plantillaDestino = computed(() =>
    this.datos.plantillas.find((p) => p.id === this.plantillaDestinoId()) ?? null);

  /** Al añadir una versión a una plantilla con borrador, ese borrador se pierde. */
  readonly avisaBorrador = computed(() => !!this.plantillaDestino()?.tiene_borrador);

  readonly pesoLegible = computed(() => {
    const b = this.analisis()?.tamano_bytes ?? 0;
    return b < 1024 ? `${b} B` : `${Math.round(b / 1024)} KB`;
  });

  // ── Paso 1 ─────────────────────────────────────────────────────────────────

  async elegirArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    this.nombreArchivo.set(archivo.name);
    await this.correr(() => firstValueFrom(this.srv.analizarArchivo(archivo, this.origenCodigo())));
    input.value = '';
  }

  async soltarArchivo(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    const archivo = ev.dataTransfer?.files?.[0];
    if (!archivo) return;
    this.nombreArchivo.set(archivo.name);
    await this.correr(() => firstValueFrom(this.srv.analizarArchivo(archivo, this.origenCodigo())));
  }

  /**
   * Cambiar el origen después de analizar deja las sugerencias obsoletas: se
   * calcularon contra otro catálogo. Se rehace el análisis con el mismo HTML
   * —no hay que volver a subir el archivo— y se pierden los emparejados hechos
   * a mano, que es lo correcto: apuntaban a variables de un origen distinto.
   */
  async cambiarOrigen(codigo: string | null): Promise<void> {
    this.origenCodigo.set(codigo);
    const a = this.analisis();
    if (!a) return;
    await this.correr(() => firstValueFrom(this.srv.analizarHtml(a.html, codigo)));
  }

  async analizarPegado(): Promise<void> {
    if (!this.htmlPegado().trim()) return;
    this.nombreArchivo.set('(pegado)');
    await this.correr(() => firstValueFrom(this.srv.analizarHtml(this.htmlPegado(), this.origenCodigo())));
  }

  /**
   * Ejecuta el análisis y siembra los pasos siguientes con lo que sugirió el
   * backend: emparejado preseleccionado y todas las imágenes descargables
   * marcadas. El caso normal es revisar y seguir, no rellenar.
   */
  private async correr(op: () => Promise<AnalisisImportacion>): Promise<void> {
    this.analizando.set(true);
    try {
      const a = await op();
      this.analisis.set(a);

      const mapeos: Record<string, string> = {};
      for (const p of a.placeholders) if (p.clave_sugerida) mapeos[p.nombre] = p.clave_sugerida;
      this.mapeos.set(mapeos);

      this.imagenesElegidas.set(new Set(a.imagenes.filter((i) => i.descargable).map((i) => i.url)));

      if (a.asunto_sugerido) {
        this.asunto.set(a.asunto_sugerido);
        if (!this.nombre()) this.nombre.set(a.asunto_sugerido);
      }
      this.catalogo.set(await firstValueFrom(this.srv.catalogo(this.origenCodigo())));
    } catch (e: any) {
      this.analisis.set(null);
      this.nombreArchivo.set(null);
      this.snack.open(e?.error?.error ?? 'No se pudo leer el archivo.', 'Cerrar', { duration: 6000 });
    } finally {
      this.analizando.set(false);
    }
  }

  // ── Paso 2 ─────────────────────────────────────────────────────────────────

  /**
   * El marcador tal como se escribe en la plantilla.
   *
   * Se arma aquí y no en el HTML porque Angular decodifica las entidades
   * (`&#123;`) ANTES de buscar interpolaciones: unas llaves escapadas en la
   * plantilla producen una interpolación real y el componente no compila.
   */
  marcador(nombre: string): string {
    return `{{${nombre}}}`;
  }

  /** '' = sin emparejar (se enviará literal). */
  mapeoDe(placeholder: string): string {
    return this.mapeos()[placeholder] ?? '';
  }

  readonly totalEmparejados = computed(() => Object.keys(this.mapeos()).length);

  mapear(placeholder: string, clave: string): void {
    this.mapeos.update((m) => ({ ...m, [placeholder]: clave }));
  }

  /** Deja el marcador tal cual: se enviará literal, entre llaves. */
  dejarLiteral(placeholder: string): void {
    this.mapeos.update((m) => {
      const copia = { ...m };
      delete copia[placeholder];
      return copia;
    });
  }

  aceptarTodasLasSugerencias(): void {
    const mapeos: Record<string, string> = {};
    for (const p of this.analisis()?.placeholders ?? []) {
      if (p.clave_sugerida) mapeos[p.nombre] = p.clave_sugerida;
    }
    this.mapeos.set(mapeos);
  }

  explicacion(procedencia: string): string {
    switch (procedencia) {
      case 'CATALOGO': return 'Ya es una variable de este origen: no hay nada que emparejar.';
      case 'NOMINA_LEGACY': return 'Equivalencia conocida con los marcadores antiguos de Nómina.';
      case 'GENERICO': return 'Equivalencia declarada en el catálogo de alias.';
      case 'COINCIDENCIA_NOMBRE': return 'El nombre coincide con el último tramo de una clave, y solo con una.';
      case 'COINCIDENCIA_ETIQUETA': return 'El nombre se parece a la etiqueta de una variable.';
      default: return 'No hay equivalente en este origen. Si lo dejas así, se enviará literal.';
    }
  }

  // ── Paso 3 ─────────────────────────────────────────────────────────────────

  alternarImagen(url: string): void {
    this.imagenesElegidas.update((s) => {
      const copia = new Set(s);
      if (copia.has(url)) copia.delete(url); else copia.add(url);
      return copia;
    });
  }

  todasLasImagenes(marcar: boolean): void {
    this.imagenesElegidas.set(marcar
      ? new Set(this.imagenesDescargables().map((i) => i.url))
      : new Set());
  }

  estaElegida(url: string): boolean {
    return this.imagenesElegidas().has(url);
  }

  // ── Paso 4 ─────────────────────────────────────────────────────────────────

  async importar(): Promise<void> {
    const a = this.analisis();
    if (!a) return;
    this.guardando.set(true);
    try {
      const r = await firstValueFrom(this.srv.aplicarImportacion({
        html: a.html,
        plantilla_id: this.plantillaDestinoId(),
        nombre: this.nombre() || null,
        categoria: this.categoria() || null,
        origen_codigo: this.origenCodigo(),
        asunto: this.asunto() || null,
        modo_imagenes: this.modoImagenes(),
        mapeos: this.mapeos(),
        imagenes: [...this.imagenesElegidas()],
        publicar: false,
      }));
      this.ref.close(r);
    } catch (e: any) {
      this.snack.open(e?.error?.error ?? 'No se pudo importar la plantilla.', 'Cerrar', { duration: 6000 });
    } finally {
      this.guardando.set(false);
    }
  }

  permitirSoltar(ev: DragEvent): void {
    ev.preventDefault();
  }
}
