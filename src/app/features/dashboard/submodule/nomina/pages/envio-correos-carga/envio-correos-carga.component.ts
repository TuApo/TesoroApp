import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  OnInit, computed, inject, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  CarpetaResumen, EnvioCorreosService, EstadoItem, ItemCarga,
  LoteCarga, PreviewCarga, TipoRef,
} from '../../service/envio-correos/envio-correos.service';
import {
  VisorDocumentoComponent, VisorDocumentoData,
} from '../../components/visor-documento/visor-documento.component';

/** Archivos por tanda. Cada uno viaja entero y se procesa en ms-documents. */
const TAMANO_TANDA = 20;

/**
 * Tandas en vuelo a la vez.
 *
 * 3 y no más: cada archivo se escribe a disco y pasa por detección de tipo en
 * ms-documents. Subir de aquí satura el servicio y el tiempo total deja de
 * bajar — se gana ancho de banda y se pierde en cola del lado del servidor.
 */
const TANDAS_EN_PARALELO = 3;

/** Estado de una tanda en la tabla de proceso. */
interface Tanda {
  n: number;
  carpeta: string;
  archivos: number;
  estado: 'EN_COLA' | 'SUBIENDO' | 'HECHA' | 'CON_ERRORES';
  cargados: number;
  errores: number;
  segundos: number | null;
  rutas: string[];
}

/**
 * Nómina → Envío de correos (modelo antiguo) → Carga por carpeta.
 *
 * Reemplaza el flujo de Drive: se selecciona la carpeta raíz del corte y todo
 * entra a gestión documental identificado por cédula, con la jerarquía intacta.
 *
 * Dos pasos, igual que el backend:
 *   1. Se manda el MANIFIESTO (rutas y tamaños). El backend clasifica, lee la
 *      quincena y cruza contra lo ya subido. Aquí no viaja ningún byte.
 *   2. Tras revisar y corregir, los binarios suben por tandas EN PARALELO, con
 *      una tabla que muestra qué está haciendo cada una.
 *
 * El paso intermedio existe porque los nombres de Drive están escritos a mano
 * desde hace años: hay carpetas que mezclan categorías y archivos sin cédula
 * legible. Subir primero y descubrirlo después obliga a limpiar en producción.
 */
@Component({
  selector: 'app-envio-correos-carga',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatCardModule, MatChipsModule,
    MatDialogModule, MatExpansionModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatPaginatorModule, MatProgressBarModule, MatSelectModule,
    MatTableModule, MatTooltipModule,
  ],
  templateUrl: './envio-correos-carga.component.html',
  styleUrl: './envio-correos-carga.component.css',
})
export class EnvioCorreosCargaComponent implements OnInit {
  private srv = inject(EnvioCorreosService);
  private titulo = inject(Title);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);

  readonly inputCarpeta = viewChild<ElementRef<HTMLInputElement>>('inputCarpeta');

  // ── Estado ────────────────────────────────────────────────────────────────
  readonly cargando = signal(false);
  readonly subiendo = signal(false);
  readonly preview = signal<PreviewCarga | null>(null);
  readonly empresa = signal<'APOYO_LABORAL' | 'ALIANZA' | null>(null);
  readonly nombreCarpeta = signal<string>('');
  readonly totalSeleccionados = signal(0);

  /** ruta relativa → File. Es lo que ata cada binario con su item clasificado. */
  private archivosPorRuta = new Map<string, File>();

  // Proceso de subida
  readonly tandas = signal<Tanda[]>([]);
  readonly subidos = signal(0);
  readonly totalASubir = signal(0);
  readonly erroresSubida = signal<{ ruta: string; motivo: string }[]>([]);

  // Contenido de la carga (documentos ya cargados)
  readonly documentos = signal<ItemCarga[]>([]);
  readonly totalDocumentos = signal(0);
  readonly paginaDocumentos = signal(0);
  readonly filtroDocumentos = signal('');

  // Cargas anteriores
  readonly lotesPrevios = signal<LoteCarga[]>([]);

  // Selector de quincena (override)
  readonly meses = [
    { v: '01', n: 'Enero' }, { v: '02', n: 'Febrero' }, { v: '03', n: 'Marzo' },
    { v: '04', n: 'Abril' }, { v: '05', n: 'Mayo' }, { v: '06', n: 'Junio' },
    { v: '07', n: 'Julio' }, { v: '08', n: 'Agosto' }, { v: '09', n: 'Septiembre' },
    { v: '10', n: 'Octubre' }, { v: '11', n: 'Noviembre' }, { v: '12', n: 'Diciembre' },
  ];
  readonly anios = signal<number[]>([]);
  readonly anioSel = signal<number | null>(null);
  readonly mesSel = signal<string | null>(null);
  readonly quincenaSel = signal<'1Q' | '2Q' | 'MES' | null>(null);

  // ── Derivados ─────────────────────────────────────────────────────────────
  readonly lote = computed(() => this.preview()?.lote ?? null);
  readonly tipos = computed<TipoRef[]>(() => this.preview()?.tipos_disponibles ?? []);
  readonly carpetas = computed<CarpetaResumen[]>(() => this.preview()?.carpetas ?? []);
  readonly porResolver = computed<ItemCarga[]>(() => this.preview()?.items_por_resolver ?? []);
  readonly advertencias = computed<string[]>(() => this.preview()?.advertencias ?? []);

  readonly resumen = computed(() => {
    const r = this.preview()?.resumen ?? {};
    return Object.entries(r)
      .map(([estado, total]) => ({ estado: estado as EstadoItem, total }))
      .sort((a, b) => b.total - a.total);
  });

  readonly pendientes = computed(() => this.preview()?.resumen?.['PENDIENTE'] ?? 0);
  readonly yaCargados = computed(() => this.preview()?.resumen?.['CARGADO'] ?? 0);

  readonly progreso = computed(() => {
    const total = this.totalASubir();
    return total === 0 ? 0 : Math.round((this.subidos() / total) * 100);
  });

  readonly tandasHechas = computed(() =>
    this.tandas().filter((t) => t.estado === 'HECHA' || t.estado === 'CON_ERRORES').length);

  readonly columnasResolver = ['archivo', 'carpeta', 'cedula', 'tipo', 'motivo', 'acciones'];
  readonly columnasCarpetas = ['ruta', 'archivos', 'tipo'];
  readonly columnasTandas = ['n', 'carpeta', 'archivos', 'estado', 'resultado', 'tiempo'];
  readonly columnasDocumentos = ['cedula', 'archivo', 'tipo', 'tamano', 'acciones'];
  readonly columnasLotes = ['carpeta', 'quincena', 'empresa', 'archivos', 'estado', 'acciones'];

  ngOnInit(): void {
    this.titulo.setTitle('Carga por carpeta | Envío de correos (modelo antiguo)');
    const actual = new Date().getFullYear();
    this.anios.set([actual + 1, actual, actual - 1, actual - 2]);
    this.cargarLotesPrevios();
  }

  // ── 1. Selección de la carpeta ────────────────────────────────────────────

  abrirSelectorCarpeta(): void {
    this.inputCarpeta()?.nativeElement.click();
  }

  onCarpetaSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    const lista = Array.from(input.files ?? []);
    input.value = '';
    if (!lista.length) return;

    this.archivosPorRuta.clear();
    for (const f of lista) {
      // webkitRelativePath trae la ruta COMPLETA desde la carpeta elegida
      // ("pdf NOMINA 1Q AGOSTO 2026/APOYO/1016034796.pdf"), que es justo la
      // jerarquía que hay que preservar.
      const ruta = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      this.archivosPorRuta.set(ruta, f);
    }
    this.totalSeleccionados.set(this.archivosPorRuta.size);

    const primera = this.archivosPorRuta.keys().next().value ?? '';
    this.nombreCarpeta.set(primera.includes('/') ? primera.split('/')[0] : '');
    this.previsualizar();
  }

  private async previsualizar(): Promise<void> {
    this.cargando.set(true);
    this.preview.set(null);
    this.erroresSubida.set([]);
    this.tandas.set([]);
    this.documentos.set([]);
    try {
      const archivos = Array.from(this.archivosPorRuta.entries())
        .map(([ruta, f]) => ({ ruta_relativa: ruta, tamano_bytes: f.size }));

      const r = await firstValueFrom(this.srv.previsualizar(
        this.nombreCarpeta(), this.empresa(), this.claveManual(), archivos));
      this.preview.set(r);
      this.sincronizarSelectorQuincena(r);
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo analizar la carpeta.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Deja el selector de quincena mostrando lo que el backend dedujo. */
  private sincronizarSelectorQuincena(p: PreviewCarga): void {
    const clave = p.lote.periodo_clave;
    if (!clave) { this.anioSel.set(null); this.mesSel.set(null); this.quincenaSel.set(null); return; }
    this.anioSel.set(Number(clave.slice(0, 4)));
    this.mesSel.set(clave.slice(5, 7));
    this.quincenaSel.set(clave.length === 7 ? 'MES' : (clave.slice(8) as '1Q' | '2Q'));
  }

  /** Clave canónica compuesta a mano en el selector, o null si está incompleto. */
  private claveManual(): string | null {
    const a = this.anioSel(), m = this.mesSel(), q = this.quincenaSel();
    if (!a || !m || !q) return null;
    return q === 'MES' ? `${a}-${m}` : `${a}-${m}-${q}`;
  }

  // ── 2. Correcciones sobre el preview ──────────────────────────────────────

  async aplicarQuincena(): Promise<void> {
    const clave = this.claveManual();
    if (!this.lote() || !clave) return;
    await this.parchearLote({ periodo_clave: clave });
  }

  async aplicarEmpresa(): Promise<void> {
    if (!this.lote()) return;
    await this.parchearLote({ empresa: this.empresa() });
  }

  /** "Toda esta carpeta es de este tipo": resuelve un CERTI_CARTAS de un golpe. */
  async aplicarTipoACarpeta(carpeta: string, typeId: number): Promise<void> {
    if (!typeId) return;
    await this.parchearLote({ carpeta, type_id: typeId });
  }

  private async parchearLote(cambios: Record<string, unknown>): Promise<void> {
    const lote = this.lote();
    if (!lote) return;
    this.cargando.set(true);
    try {
      this.preview.set(await firstValueFrom(this.srv.ajustarLote(lote.lote_id, cambios)));
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo aplicar el cambio.');
    } finally {
      this.cargando.set(false);
    }
  }

  async fijarTipoItem(item: ItemCarga, typeId: number): Promise<void> {
    await this.parchearItems([{ id: item.id, type_id: typeId }]);
  }

  async fijarCedulaItem(item: ItemCarga, cedula: string): Promise<void> {
    const limpia = (cedula ?? '').trim().toUpperCase();
    if (!limpia) return;
    await this.parchearItems([{ id: item.id, cedula: limpia }]);
  }

  async omitirItem(item: ItemCarga): Promise<void> {
    await this.parchearItems([{ id: item.id, estado: 'OMITIDO' }]);
  }

  private async parchearItems(
    items: { id: number; type_id?: number; cedula?: string; estado?: 'OMITIDO' | 'PENDIENTE' }[],
  ): Promise<void> {
    const lote = this.lote();
    if (!lote) return;
    this.cargando.set(true);
    try {
      this.preview.set(await firstValueFrom(this.srv.ajustarItems(lote.lote_id, items)));
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo corregir el archivo.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── 3. Subida EN PARALELO con tabla de proceso ────────────────────────────

  async subir(): Promise<void> {
    const lote = this.lote();
    if (!lote || this.subiendo()) return;

    const pendientes = this.pendientes();
    const confirma = await Swal.fire({
      icon: 'question',
      title: '¿Subir el corte?',
      html: `Se van a cargar <b>${pendientes}</b> archivo(s) como
             <b>${lote.periodo_etiqueta ?? 'sin quincena'}</b>
             ${lote.empresa ? `de <b>${this.nombreEmpresa(lote.empresa)}</b>` : ''}.<br>
             Los duplicados, omitidos y por resolver no se suben.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, subir',
      cancelButtonText: 'Cancelar',
    });
    if (!confirma.isConfirmed) return;

    const rutas = await this.rutasPendientes(lote.lote_id);
    if (!rutas.length) { this.error('No hay archivos pendientes para subir.'); return; }

    this.subiendo.set(true);
    this.subidos.set(0);
    this.totalASubir.set(rutas.length);
    this.erroresSubida.set([]);
    this.tandas.set(this.armarTandas(rutas));

    try {
      await this.procesarEnParalelo(lote.lote_id);

      // Se recarga el lote para ver el estado final tal como quedó en el servidor.
      this.preview.set(await firstValueFrom(this.srv.obtenerLote(lote.lote_id)));
      await this.cargarDocumentos();
      this.cargarLotesPrevios();

      const fallidos = this.erroresSubida().length;
      await Swal.fire({
        icon: fallidos ? 'warning' : 'success',
        title: fallidos ? 'Carga terminada con errores' : 'Carga completada',
        html: fallidos
          ? `Se cargaron ${this.subidos() - fallidos} archivo(s) y fallaron ${fallidos}.
             Revisa el detalle abajo y reintenta solo esos.`
          : `Se cargaron ${this.subidos()} archivo(s) correctamente.`,
      });
    } catch (e: any) {
      this.error(e?.error?.error ?? 'La carga se interrumpió. Los archivos ya subidos se conservan.');
    } finally {
      this.subiendo.set(false);
    }
  }

  /**
   * Trocea las rutas en tandas, agrupándolas por carpeta.
   *
   * Se agrupa por carpeta —y no en bloques ciegos de 20— para que la tabla de
   * proceso diga algo útil: "va por la subcarpeta Nomina 14-08-2026", en vez de
   * "tanda 37 de 236", que no le sirve a nadie para saber qué está pasando.
   */
  private armarTandas(rutas: string[]): Tanda[] {
    const porCarpeta = new Map<string, string[]>();
    for (const r of rutas) {
      const i = r.lastIndexOf('/');
      const carpeta = i < 0 ? '(raíz)' : r.slice(0, i);
      const lista = porCarpeta.get(carpeta) ?? [];
      lista.push(r);
      porCarpeta.set(carpeta, lista);
    }

    const out: Tanda[] = [];
    let n = 1;
    for (const [carpeta, lista] of porCarpeta) {
      for (let i = 0; i < lista.length; i += TAMANO_TANDA) {
        const trozo = lista.slice(i, i + TAMANO_TANDA);
        out.push({
          n: n++,
          carpeta,
          archivos: trozo.length,
          estado: 'EN_COLA',
          cargados: 0,
          errores: 0,
          segundos: null,
          rutas: trozo,
        });
      }
    }
    return out;
  }

  /**
   * Lanza {@link TANDAS_EN_PARALELO} trabajadores que van tomando tandas de la
   * cola. Cada uno actualiza su fila conforme avanza, así que la tabla refleja
   * lo que está pasando de verdad y no una barra que sube sola.
   */
  private async procesarEnParalelo(loteId: number): Promise<void> {
    let siguiente = 0;
    const cola = this.tandas();

    const trabajador = async (): Promise<void> => {
      for (;;) {
        const indice = siguiente++;
        if (indice >= cola.length) return;

        const tanda = cola[indice];
        const inicio = Date.now();
        this.actualizarTanda(tanda.n, { estado: 'SUBIENDO' });

        const files = tanda.rutas
          .map((r) => this.archivosPorRuta.get(r))
          .filter((f): f is File => !!f);
        const rutasOk = tanda.rutas.filter((r) => this.archivosPorRuta.has(r));
        if (!files.length) {
          this.actualizarTanda(tanda.n, { estado: 'HECHA', segundos: 0 });
          continue;
        }

        try {
          const resp = await firstValueFrom(this.srv.subirTanda(loteId, files, rutasOk));
          const fallos = resp.resultados
            .filter((r) => r.estado === 'ERROR')
            .map((r) => ({ ruta: r.ruta_relativa, motivo: r.motivo ?? 'Error sin detalle.' }));
          const cargados = resp.resultados.filter((r) => r.estado === 'CARGADO').length;

          this.subidos.update((v) => v + files.length);
          if (fallos.length) this.erroresSubida.update((prev) => [...prev, ...fallos]);
          this.actualizarTanda(tanda.n, {
            estado: fallos.length ? 'CON_ERRORES' : 'HECHA',
            cargados,
            errores: fallos.length,
            segundos: Math.round((Date.now() - inicio) / 100) / 10,
          });
        } catch (e: any) {
          // Una tanda que revienta no tumba las demás: se marca y se sigue.
          this.subidos.update((v) => v + files.length);
          this.erroresSubida.update((prev) => [...prev, {
            ruta: tanda.carpeta,
            motivo: e?.error?.error ?? `La tanda ${tanda.n} falló entera.`,
          }]);
          this.actualizarTanda(tanda.n, {
            estado: 'CON_ERRORES',
            errores: files.length,
            segundos: Math.round((Date.now() - inicio) / 100) / 10,
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(TANDAS_EN_PARALELO, cola.length) }, () => trabajador()));
  }

  private actualizarTanda(n: number, cambios: Partial<Tanda>): void {
    this.tandas.update((lista) =>
      lista.map((t) => (t.n === n ? { ...t, ...cambios } : t)));
  }

  /**
   * Rutas que el SERVIDOR marcó como PENDIENTE, paginando el listado del lote.
   *
   * Se pregunta explícitamente en vez de deducirlas por descarte sobre el mapa
   * local: el estado real vive en el servidor y cambia con cada corrección
   * (omitidos, duplicados, ya cargados en un intento anterior).
   */
  private async rutasPendientes(loteId: number): Promise<string[]> {
    const out: string[] = [];
    let pagina = 0;
    let totalPaginas = 1;
    while (pagina < totalPaginas) {
      const r = await firstValueFrom(this.srv.itemsDeLote(loteId, 'PENDIENTE', pagina, 500));
      totalPaginas = Math.max(r.total_pages, 1);
      out.push(...r.content.map((i) => i.ruta_relativa));
      pagina++;
    }
    return out;
  }

  // ── 4. Contenido de la carga ──────────────────────────────────────────────

  async cargarDocumentos(): Promise<void> {
    const lote = this.lote();
    if (!lote) return;
    try {
      const r = await firstValueFrom(
        this.srv.itemsDeLote(lote.lote_id, 'CARGADO', this.paginaDocumentos(), 50));
      this.documentos.set(r.content);
      this.totalDocumentos.set(r.total_elements);
    } catch {
      this.error('No se pudo cargar el contenido de esta carga.');
    }
  }

  onPaginaDocumentos(e: PageEvent): void {
    this.paginaDocumentos.set(e.pageIndex);
    this.cargarDocumentos();
  }

  /** Abre el PDF en un visor embebido (descarga con JWT, no `window.open`). */
  verDocumento(item: ItemCarga): void {
    if (!item.document_id) return;
    this.dialog.open<VisorDocumentoComponent, VisorDocumentoData>(VisorDocumentoComponent, {
      data: {
        documentId: item.document_id,
        titulo: item.titulo,
        nombreArchivo: item.nombre_archivo,
        cedula: item.cedula,
      },
      width: '900px',
      maxWidth: '95vw',
    });
  }

  private async cargarLotesPrevios(): Promise<void> {
    try {
      const r = await firstValueFrom(this.srv.listarLotes(0, 10));
      this.lotesPrevios.set(r.content);
    } catch { /* el listado es informativo; su fallo no bloquea la carga */ }
  }

  /** Abre una carga anterior para revisar su contenido. */
  async abrirLotePrevio(loteId: number): Promise<void> {
    this.cargando.set(true);
    try {
      this.preview.set(await firstValueFrom(this.srv.obtenerLote(loteId)));
      this.archivosPorRuta.clear();
      this.totalSeleccionados.set(0);
      this.tandas.set([]);
      this.paginaDocumentos.set(0);
      await this.cargarDocumentos();
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo abrir esa carga.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Cancelar / reiniciar ──────────────────────────────────────────────────

  async cancelar(): Promise<void> {
    const lote = this.lote();
    if (!lote) { this.reiniciar(); return; }
    const c = await Swal.fire({
      icon: 'warning', title: '¿Descartar esta carga?',
      text: 'Se descarta el análisis. Los archivos ya subidos NO se borran.',
      showCancelButton: true, confirmButtonText: 'Descartar', cancelButtonText: 'Volver',
    });
    if (!c.isConfirmed) return;
    // Solo se cancela en servidor si aún no se subió nada; un lote completado
    // es historial y no debe tocarse.
    if (lote.estado !== 'COMPLETADO') {
      try { await firstValueFrom(this.srv.cancelarLote(lote.lote_id)); } catch { /* ya da igual */ }
    }
    this.reiniciar();
  }

  reiniciar(): void {
    this.preview.set(null);
    this.archivosPorRuta.clear();
    this.totalSeleccionados.set(0);
    this.nombreCarpeta.set('');
    this.erroresSubida.set([]);
    this.tandas.set([]);
    this.documentos.set([]);
    this.subidos.set(0);
    this.totalASubir.set(0);
    this.cargarLotesPrevios();
  }

  // ── Presentación ──────────────────────────────────────────────────────────

  nombreEmpresa(v: string | null): string {
    if (v === 'APOYO_LABORAL') return 'Apoyo Laboral';
    if (v === 'ALIANZA') return 'Tu Alianza';
    return '—';
  }

  etiquetaEstado(estado: EstadoItem): string {
    const mapa: Record<EstadoItem, string> = {
      PENDIENTE: 'Listos para subir',
      CARGADO: 'Cargados',
      DUPLICADO: 'Ya estaban',
      AMBIGUO: 'Ambiguos',
      SIN_CEDULA: 'Sin cédula',
      SIN_TIPO: 'Sin tipo',
      OMITIDO: 'Omitidos',
      ERROR: 'Con error',
    };
    return mapa[estado] ?? estado;
  }

  claseEstado(estado: EstadoItem): string {
    if (estado === 'PENDIENTE' || estado === 'CARGADO') return 'chip-ok';
    if (estado === 'DUPLICADO' || estado === 'OMITIDO') return 'chip-neutro';
    return 'chip-alerta';
  }

  etiquetaTanda(estado: Tanda['estado']): string {
    const mapa: Record<Tanda['estado'], string> = {
      EN_COLA: 'En cola',
      SUBIENDO: 'Subiendo…',
      HECHA: 'Hecha',
      CON_ERRORES: 'Con errores',
    };
    return mapa[estado];
  }

  claseTanda(estado: Tanda['estado']): string {
    if (estado === 'HECHA') return 'chip-ok';
    if (estado === 'SUBIENDO') return 'chip-info';
    if (estado === 'CON_ERRORES') return 'chip-alerta';
    return 'chip-neutro';
  }

  tamanoLegible(bytes: number | null): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private error(mensaje: string): void {
    Swal.fire({ icon: 'error', title: 'Error', text: mensaje });
  }
}
