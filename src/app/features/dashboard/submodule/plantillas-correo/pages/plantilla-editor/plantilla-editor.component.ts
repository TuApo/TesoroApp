import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';

import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Subject, debounceTime, firstValueFrom, takeUntil } from 'rxjs';
import Swal from 'sweetalert2';

import { EditorBloquesComponent } from '../../components/editor-bloques/editor-bloques.component';
import {
  ImportarHtmlDialogComponent, DatosImportar,
} from '../../components/importar-html-dialog/importar-html-dialog.component';
import { PanelDivisibleComponent } from '../../components/panel-divisible/panel-divisible.component';
import { PanelVariablesComponent } from '../../components/panel-variables/panel-variables.component';
import { PreviewCorreoComponent } from '../../components/preview-correo/preview-correo.component';
import { PropsBloqueComponent } from '../../components/props-bloque/props-bloque.component';
import { PlantillasCorreoService } from '../../services/plantillas-correo.service';
import {
  Activo, Bloque, DocumentoCorreo, FUENTES_CORREO, OrigenDatos, PlantillaDetalle,
  PlantillaResumen, Preview, Sujeto, TEMA_POR_DEFECTO, Variable,
} from '../../models/plantilla-correo.model';

/**
 * Editor de una plantilla de correo.
 *
 * <h3>Cómo se reparte el trabajo con el backend</h3>
 * Aquí se edita el **documento de bloques**; el HTML lo compila siempre el
 * backend. Es deliberado: si el navegador compilara su propia versión habría dos
 * motores de maquetación —uno en TypeScript y otro en Java— que acabarían
 * divergiendo, y el correo que se ve en la pantalla dejaría de ser el que se
 * envía. Lo que se ve en la vista previa es literalmente el HTML que saldrá.
 *
 * <h3>Autoguardado</h3>
 * Cada cambio programa un guardado con 900 ms de retardo. Sin él, editar un
 * párrafo sería una petición por tecla; con un retardo mucho mayor, cerrar la
 * pestaña perdería trabajo. El guardado va contra el BORRADOR: lo que reciben
 * los destinatarios no cambia hasta que se publica.
 */
@Component({
  selector: 'app-plantilla-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, RouterLink,
    EditorBloquesComponent, PanelVariablesComponent, PanelDivisibleComponent,
    PreviewCorreoComponent, PropsBloqueComponent,
    MatButtonModule, MatButtonToggleModule, MatCardModule, MatChipsModule,
    MatDialogModule, MatDividerModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatProgressBarModule,
    MatSelectModule, MatSidenavModule, MatSnackBarModule, MatTabsModule, MatTooltipModule,
  ],
  templateUrl: './plantilla-editor.component.html',
  styleUrl: './plantilla-editor.component.css',
})
export class PlantillaEditorComponent implements OnInit, OnDestroy {
  private srv = inject(PlantillasCorreoService);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private titulo = inject(Title);
  private dialogo = inject(MatDialog);

  readonly fuentes = FUENTES_CORREO;

  readonly id = signal<string>('');
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly publicando = signal(false);

  readonly detalle = signal<PlantillaDetalle | null>(null);
  readonly documento = signal<DocumentoCorreo>({ tema: { ...TEMA_POR_DEFECTO }, bloques: [] });
  readonly activos = signal<Activo[]>([]);
  readonly seleccionadoId = signal<string | null>(null);

  /** Campos de cabecera, separados del documento porque se guardan igual. */
  readonly asunto = signal('');
  readonly preencabezado = signal('');
  readonly modoEdicion = signal<'BLOQUES' | 'HTML'>('BLOQUES');
  readonly modoImagenes = signal<'CID' | 'URL'>('CID');
  readonly htmlCrudo = signal('');

  /** Sujeto con el que se previsualiza: null = valores de ejemplo. */
  readonly sujeto = signal<Sujeto | null>(null);
  readonly sujetos = signal<Sujeto[]>([]);
  readonly buscandoSujetos = signal(false);
  readonly preview = signal<Preview | null>(null);
  readonly cargandoPreview = signal(false);

  readonly ultimoGuardado = signal<Date | null>(null);
  readonly haycambios = signal(false);

  /** Oculta la previa para dar todo el ancho al lienzo. Se recuerda entre sesiones. */
  readonly previaOculta = signal(localStorage.getItem('pc:previa-oculta') === '1');

  private guardar$ = new Subject<void>();
  private previsualizar$ = new Subject<void>();
  private muerto$ = new Subject<void>();

  readonly plantilla = computed(() => this.detalle()?.plantilla ?? null);
  readonly catalogo = computed(() => this.detalle()?.catalogo ?? null);
  readonly desconocidas = computed(() => this.detalle()?.variables_desconocidas ?? []);

  readonly bloqueSeleccionado = computed<Bloque | null>(() => {
    const id = this.seleccionadoId();
    return id ? this.documento().bloques.find((b) => b.id === id) ?? null : null;
  });

  readonly puedePublicar = computed(() => {
    const p = this.plantilla();
    return !!p?.tiene_borrador && !!this.asunto().trim();
  });

  async ngOnInit(): Promise<void> {
    this.id.set(this.ruta.snapshot.paramMap.get('id') ?? '');

    // Autoguardado: 900 ms tras la última tecla. Ver javadoc de la clase.
    this.guardar$.pipe(debounceTime(900), takeUntil(this.muerto$))
      .subscribe(() => void this.guardarBorrador());

    // La previa se recompila algo más tarde: cuesta una llamada que además
    // resuelve variables contra ms-hr, y no aporta nada verla a medio escribir.
    this.previsualizar$.pipe(debounceTime(1400), takeUntil(this.muerto$))
      .subscribe(() => void this.recargarPreview());

    await Promise.all([this.cargar(), this.cargarActivos()]);
  }

  alternarPrevia(): void {
    this.previaOculta.update((v) => !v);
    try {
      localStorage.setItem('pc:previa-oculta', this.previaOculta() ? '1' : '0');
    } catch { /* modo privado: no recordarlo no rompe nada */ }
  }

  /**
   * Trae una plantilla ya hecha y la guarda como versión NUEVA de esta misma
   * plantilla: se conserva el código, el histórico y quién la usa. Es lo que
   * permite rehacer el diseño de un correo que ya está en producción.
   */
  async importarHtml(): Promise<void> {
    const p = this.plantilla();
    if (!p) return;
    const [origenes, plantillas] = await Promise.all([
      firstValueFrom(this.srv.origenes(true)),
      firstValueFrom(this.srv.listar({})),
    ]);
    const ref = this.dialogo.open(ImportarHtmlDialogComponent, {
      data: { origenes, plantillas, plantillaDestino: p } satisfies DatosImportar,
      maxWidth: '96vw',
    });
    const r = await firstValueFrom(ref.afterClosed());
    if (!r) return;

    this.aplicar(r.plantilla);
    await this.recargarPreview();
    await Swal.fire({
      title: 'Plantilla importada',
      html: `${r.placeholders_reemplazados} marcador(es) emparejados y `
          + `${r.imagenes_importadas} imagen(es) en la biblioteca.`
          + (r.avisos.length ? `<div style="text-align:left;font-size:12.5px;margin-top:10px">`
              + r.avisos.map((a: string) => `• ${a}`).join('<br>') + '</div>' : '')
          + '<div style="font-size:12.5px;margin-top:10px">Se guardó como <b>borrador</b>: '
          + 'revísala y pulsa Publicar cuando esté lista.</div>',
      icon: 'success', confirmButtonColor: '#0f766e', width: 620,
    });
  }

  ngOnDestroy(): void {
    this.muerto$.next();
    this.muerto$.complete();
  }

  // ── Carga ──────────────────────────────────────────────────────────────────

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const d = await firstValueFrom(this.srv.detalle(this.id()));
      this.aplicar(d);
      await this.recargarPreview();
    } catch (e: any) {
      this.error(e, 'No se pudo cargar la plantilla.');
      void this.router.navigate(['/dashboard/gestion-del-programa/plantillas-correo']);
    } finally {
      this.cargando.set(false);
    }
  }

  private aplicar(d: PlantillaDetalle): void {
    this.detalle.set(d);
    this.titulo.setTitle(`${d.plantilla.nombre} | Plantillas de correo`);

    const v = d.version;
    this.asunto.set(v?.asunto ?? '');
    this.preencabezado.set(v?.preencabezado ?? '');
    this.modoEdicion.set(v?.modo_edicion ?? 'BLOQUES');
    this.modoImagenes.set(v?.modo_imagenes ?? 'CID');
    this.htmlCrudo.set(v?.cuerpo_html ?? '');
    this.documento.set(this.parsearDocumento(v?.documento_json, v?.tema_json));
    this.haycambios.set(false);
  }

  /**
   * El tema puede venir dentro del documento o en su propia columna (una versión
   * antigua, o una plantilla restaurada). Se prefiere el del documento y se cae
   * al de la columna; el resultado siempre tiene todas las claves, así que el
   * editor nunca lee un `undefined` de un color.
   */
  private parsearDocumento(documentoJson: string | null | undefined,
                           temaJson: string | null | undefined): DocumentoCorreo {
    let doc: Partial<DocumentoCorreo> = {};
    try { if (documentoJson) doc = JSON.parse(documentoJson); } catch { doc = {}; }
    let temaSuelto = {};
    try { if (temaJson) temaSuelto = JSON.parse(temaJson); } catch { temaSuelto = {}; }
    return {
      tema: { ...TEMA_POR_DEFECTO, ...temaSuelto, ...(doc.tema ?? {}) },
      bloques: Array.isArray(doc.bloques) ? doc.bloques : [],
    };
  }

  private async cargarActivos(): Promise<void> {
    try {
      this.activos.set(await firstValueFrom(this.srv.activos()));
    } catch {
      // La biblioteca vacía no impide editar el resto del correo.
      this.activos.set([]);
    }
  }

  // ── Cambios del editor ─────────────────────────────────────────────────────

  cambioDocumento(doc: DocumentoCorreo): void {
    this.documento.set(doc);
    this.marcar();
  }

  cambioBloque(b: Bloque): void {
    this.documento.update((d) => ({
      ...d,
      bloques: d.bloques.map((x) => (x.id === b.id ? b : x)),
    }));
    this.marcar();
  }

  cambioTema(campo: string, valor: unknown): void {
    this.documento.update((d) => ({ ...d, tema: { ...d.tema, [campo]: valor } as any }));
    this.marcar();
  }

  cambioCabecera(): void {
    this.marcar();
  }

  async eliminarBloque(b: Bloque): Promise<void> {
    const res = await Swal.fire({
      title: '¿Eliminar el bloque?',
      text: 'El contenido que tenga se pierde. Puedes deshacerlo descartando el borrador sin publicar.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    });
    if (!res.isConfirmed) return;
    this.documento.update((d) => ({ ...d, bloques: d.bloques.filter((x) => x.id !== b.id) }));
    if (this.seleccionadoId() === b.id) this.seleccionadoId.set(null);
    this.marcar();
  }

  /**
   * Inserta una variable donde esté el cursor. Si el foco no está en un campo de
   * texto, se copia al portapapeles: es mejor que no hacer nada visible y dejar
   * al usuario dudando de si el clic funcionó.
   */
  async insertarVariable(v: Variable): Promise<void> {
    const marcador = `{{${v.clave}}}`;
    const activo = document.activeElement as HTMLElement | null;

    if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA')) {
      const campo = activo as HTMLInputElement | HTMLTextAreaElement;
      const ini = campo.selectionStart ?? campo.value.length;
      const fin = campo.selectionEnd ?? ini;
      campo.value = campo.value.slice(0, ini) + marcador + campo.value.slice(fin);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      campo.setSelectionRange(ini + marcador.length, ini + marcador.length);
      campo.focus();
      return;
    }
    if (activo?.isContentEditable) {
      document.execCommand('insertText', false, marcador);
      return;
    }
    try {
      await navigator.clipboard.writeText(marcador);
      this.snack.open(`${marcador} copiado. Pégalo donde lo necesites.`, 'Cerrar', { duration: 3000 });
    } catch {
      this.snack.open(`Escribe ${marcador} donde lo necesites.`, 'Cerrar', { duration: 4000 });
    }
  }

  private marcar(): void {
    this.haycambios.set(true);
    this.guardar$.next();
    this.previsualizar$.next();
  }

  // ── Guardado y publicación ─────────────────────────────────────────────────

  async guardarBorrador(silencioso = true): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      await firstValueFrom(this.srv.guardarBorrador(this.id(), {
        modo_edicion: this.modoEdicion(),
        asunto: this.asunto(),
        preencabezado: this.preencabezado() || null,
        documento_json: this.modoEdicion() === 'BLOQUES' ? JSON.stringify(this.documento()) : null,
        tema_json: JSON.stringify(this.documento().tema),
        cuerpo_html: this.modoEdicion() === 'HTML' ? this.htmlCrudo() : null,
        modo_imagenes: this.modoImagenes(),
      }));
      this.ultimoGuardado.set(new Date());
      this.haycambios.set(false);

      // El detalle se recarga para refrescar `tiene_borrador` y la lista de
      // variables desconocidas, que es lo que la barra superior muestra en rojo.
      this.detalle.set(await firstValueFrom(this.srv.detalle(this.id())));
      if (!silencioso) this.snack.open('Borrador guardado.', 'Cerrar', { duration: 2000 });
    } catch (e: any) {
      this.error(e, 'No se pudo guardar el borrador.');
    } finally {
      this.guardando.set(false);
    }
  }

  async publicar(): Promise<void> {
    if (this.haycambios()) await this.guardarBorrador();

    const res = await Swal.fire({
      title: '¿Publicar esta versión?',
      html: 'A partir de ahora es la que se enviará.<br>La versión anterior queda archivada en el histórico, no se borra.',
      icon: 'question', showCancelButton: true, input: 'text',
      inputPlaceholder: 'Qué cambió (opcional)',
      confirmButtonText: 'Publicar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0f766e',
    });
    if (!res.isConfirmed) return;

    this.publicando.set(true);
    try {
      this.aplicar(await firstValueFrom(this.srv.publicar(this.id(), res.value || null)));
      this.snack.open('Plantilla publicada.', 'Cerrar', { duration: 2500 });
      await this.recargarPreview();
    } catch (e: any) {
      this.error(e, 'No se pudo publicar.');
    } finally {
      this.publicando.set(false);
    }
  }

  async descartarBorrador(): Promise<void> {
    const res = await Swal.fire({
      title: '¿Descartar los cambios sin publicar?',
      text: 'Se vuelve a la última versión publicada. Los cambios del borrador se pierden.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Descartar', cancelButtonText: 'Seguir editando', confirmButtonColor: '#dc2626',
    });
    if (!res.isConfirmed) return;
    try {
      this.aplicar(await firstValueFrom(this.srv.descartarBorrador(this.id())));
      await this.recargarPreview();
      this.snack.open('Borrador descartado.', 'Cerrar', { duration: 2500 });
    } catch (e: any) {
      this.error(e, 'No se pudo descartar el borrador.');
    }
  }

  async restaurar(versionId: string): Promise<void> {
    const res = await Swal.fire({
      title: '¿Restaurar esta versión?',
      text: 'Se copia como nuevo borrador. Nada se publica hasta que lo revises.',
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Restaurar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0f766e',
    });
    if (!res.isConfirmed) return;
    try {
      this.aplicar(await firstValueFrom(this.srv.restaurar(this.id(), versionId)));
      await this.recargarPreview();
    } catch (e: any) {
      this.error(e, 'No se pudo restaurar la versión.');
    }
  }

  // ── Vista previa y prueba ──────────────────────────────────────────────────

  async recargarPreview(): Promise<void> {
    this.cargandoPreview.set(true);
    try {
      this.preview.set(await firstValueFrom(
        this.srv.preview(this.id(), { clave: this.sujeto()?.clave ?? null, borrador: true })));
    } catch (e: any) {
      this.preview.set(null);
    } finally {
      this.cargandoPreview.set(false);
    }
  }

  async buscarSujetos(texto: string): Promise<void> {
    const origen = this.plantilla()?.origen_codigo;
    if (!origen || texto.trim().length < 3) { this.sujetos.set([]); return; }
    this.buscandoSujetos.set(true);
    try {
      this.sujetos.set(await firstValueFrom(this.srv.buscarSujetos(origen, texto.trim())));
    } catch {
      this.sujetos.set([]);
    } finally {
      this.buscandoSujetos.set(false);
    }
  }

  async elegirSujeto(s: Sujeto | null): Promise<void> {
    this.sujeto.set(s);
    await this.recargarPreview();
  }

  /**
   * Correo de prueba. Se avisa de que consume cuota porque sale por el mismo
   * SMTP que los envíos reales y el proveedor lo cuenta igual: no es gratis.
   */
  async enviarPrueba(): Promise<void> {
    const sugerido = this.preview()?.destinatario_sugerido ?? '';
    const res = await Swal.fire({
      title: 'Enviar correo de prueba',
      html: 'Sale por el mismo remitente que los envíos reales y <b>consume cuota</b> del día.',
      input: 'email', inputValue: sugerido, inputPlaceholder: 'tu.correo@ejemplo.com',
      showCancelButton: true, confirmButtonText: 'Enviar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0f766e',
      inputValidator: (v) => (v && v.includes('@') ? null : 'Escribe una dirección válida'),
    });
    if (!res.isConfirmed || !res.value) return;

    try {
      const r = await firstValueFrom(this.srv.enviarPrueba(this.id(), {
        destinatario: res.value,
        clave: this.sujeto()?.clave ?? null,
        borrador: true,
      }));
      await Swal.fire({
        title: 'Prueba enviada',
        html: `Enviado desde <b>${r.remitente}</b>.<br>Quedan ${r.disponible_hoy} envíos hoy.`,
        icon: 'success', confirmButtonColor: '#0f766e',
      });
    } catch (e: any) {
      this.error(e, 'No se pudo enviar la prueba.');
    }
  }

  // ── Modo HTML ──────────────────────────────────────────────────────────────

  /**
   * Cambiar a HTML es de ida y vuelta, pero no simétrico: al volver a BLOQUES el
   * documento sigue intacto (nunca se borra) y el HTML pegado se descarta. Se
   * avisa porque perder 40 KB de una plantilla de Stripo sin aviso sería grave.
   */
  async cambiarModo(nuevo: 'BLOQUES' | 'HTML'): Promise<void> {
    if (nuevo === this.modoEdicion()) return;
    if (nuevo === 'BLOQUES' && this.htmlCrudo().trim()) {
      const res = await Swal.fire({
        title: '¿Volver al editor de bloques?',
        text: 'El HTML que pegaste dejará de usarse y se recupera el lienzo de bloques.',
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Volver a bloques', cancelButtonText: 'Cancelar',
      });
      if (!res.isConfirmed) return;
    }
    this.modoEdicion.set(nuevo);
    this.marcar();
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────

  private error(e: any, porDefecto: string): void {
    this.snack.open(e?.error?.error ?? porDefecto, 'Cerrar', { duration: 5000 });
  }
}
