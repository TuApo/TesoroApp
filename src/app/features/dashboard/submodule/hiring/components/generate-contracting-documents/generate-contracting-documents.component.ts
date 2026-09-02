import { SharedModule } from '@/app/shared/shared.module';
import { isPlatformBrowser } from '@angular/common';
import { Component, inject, OnInit, PLATFORM_ID, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef, signal } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  PDFDocument, PDFTextField, PDFCheckBox, StandardFonts, rgb, degrees,
  pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath,
} from 'pdf-lib';
import { dibujarImagenPlana, aplanarFormulario } from './pdf-aplanado.util';
import Swal from 'sweetalert2';
import { separarReferencias } from './referencias.util';
import { MatDialog } from '@angular/material/dialog';
import {
  CarnetPosicionDialogComponent,
  type CarnetPosicionData,
  type CarnetPosicionResult,
} from './carnet-posicion-dialog.component';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { HiringService } from '../../service/hiring.service';
import * as fontkit from 'fontkit';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import autoTable, { RowInput } from 'jspdf-autotable';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { REFERENCIAS_A, REFERENCIAS_F } from '@/app/shared/model/const';
import { fillMinervaPdf } from './minerva-fill';
import { fillFichaSocialPdf } from './ficha-social-fill';
import { fillFichaTecnicaPdf } from './ficha-tecnica-fill';
import { buildContratoAdministrativoPdf } from './contrato-administrativo-fill';
import { salarioContratoCO, SMMLV_VIGENTE } from './salario.util';
import {
  buildCartaDescuentoFlorPdf,
  buildFormatoTimbrePdf,
  buildCartaAutorizacionCorreoPdf,
  type CartaTuAlianzaCtx,
} from './cartas-tu-alianza-fill';
import { switchMap, map, take, catchError, tap, finalize } from 'rxjs/operators';
import { of, forkJoin, firstValueFrom, throwError } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { isDocumentoVisible, getDocSeccion, SECCION_LABELS, type DocSeccion } from './documentos-por-empresa.config';
import { resolverEmpresaUsuaria } from './empresas-usuarias.data';
import { instalarGuardiaTexto, textoUnaLinea } from './pdf-text-safe';
import {
  FORMATO_ENTREGA_APOYO,
  FORMATO_ENTREGA_TU_ALIANZA,
  PLAN_FUNERAL,
  PLAN_FUNERAL_FLORES_ANDES,
} from './formato-entrega-docs.data';
// Dos formatos de carnet, uno por temporal:
//   Apoyo    → CR80 horizontal con código de barras (`carnet-apoyo-fill`).
//   Alianza  → el mismo diseño de la generación masiva de Home
//              (`carnet-masivo-fill`), grilla 3x3 en carta vertical con QR.
import { buildCarnetApoyoPdf } from './carnet-apoyo-fill';
import {
  ARL_ALIANZA, TELEFONO_COORDINADOR_ALIANZA, buildCarnetsMasivoPdf,
} from './carnet-masivo-fill';
import QRCode from 'qrcode';
import { PermissionsService } from '@/app/core/services/permissions.service';

type UploadedInfo = {
  file: File;
  fileName: string;
  previewUrl?: string; // URL creada con URL.createObjectURL
  typeId?: number;     // override de typeMap[key]: una misma entry de UI puede mapear a varios tipos del backend (p.ej. Ficha Técnica básica=34 vs TA completa=111)
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-generate-contracting-documents',
  imports: [
    SharedModule, RouterLink, MatProgressBarModule
  ],
  templateUrl: './generate-contracting-documents.component.html',
  styleUrl: './generate-contracting-documents.component.css'
})

export class GenerateContractingDocumentsComponent implements OnInit {
  @ViewChild('pdfPreviewIframe') pdfPreviewIframe!: ElementRef<HTMLIFrameElement>;
  pdfSafeUrl: SafeResourceUrl | null = null;
  today = new Date();

  /**
   * Devuelve la fecha que debe imprimirse en los contratos y autorizaciones.
   * Usa `ContratoCandidato.fecha_contrato` del candidato si está cargada;
   * de lo contrario cae a la fecha actual (compat con flujos viejos).
   * Parseo manual para evitar el shift de zona horaria al usar 'YYYY-MM-DD'.
   */
  /**
   * Fecha con la que se FECHAN los documentos: la del contrato, no la del día
   * en que se generan.
   *
   * Es un dato del contrato, no "hoy": un documento reimpreso la semana
   * siguiente tiene que seguir diciendo la fecha en que se firmó. Solo cuando
   * el contrato todavía no tiene `fecha_contrato` se cae a la de hoy, que es lo
   * más cercano que hay.
   *
   * Se lee `YYYY-MM-DD` a mano y no con `new Date(s)` porque esa cadena se
   * interpreta como medianoche UTC: en Colombia (UTC-5) daría el día anterior,
   * y el documento saldría fechado un día antes justo en los cambios de mes.
   */
  private getFechaContrato(): Date {
    const raw = this._entrevistaSel?.proceso?.contrato?.fecha_contrato;
    if (!raw) return new Date();
    const s = String(raw).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const parsed = new Date(y, mo, d);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    const fallback = new Date(s);
    return isNaN(fallback.getTime()) ? new Date() : fallback;
  }

  // ═══════════════════════════════════════════════════════════════
  // Estado de PRESENTACIÓN
  //
  // Nada de acá toca datos ni contratos: solo decide qué se ve. Existe
  // porque en portátiles de 768 px el encabezado, el giro de foto y el pie
  // con hasta cuatro botones dejaban la lista de documentos en ~170 px
  // (unas dos filas de treinta y pico).
  // ═══════════════════════════════════════════════════════════════

  /** Panel visible cuando el componente es angosto (≤ 800 px de ancho útil). */
  vista: 'lista' | 'preview' = 'lista';

  /** Pestaña de origen. Sustituye al mat-tab-group, que desbordaba al angostarse. */
  tabDocs: 'generables' | 'subir' | 'otras' = 'generables';

  /** Búsqueda por título. Con 30+ documentos es más rápido que recorrer secciones. */
  busquedaDoc = '';

  /** Filtro por estado del documento. */
  filtroEstado: 'todos' | 'pendientes' | 'listos' = 'todos';

  private hostRef = inject(ElementRef<HTMLElement>);

  /** El componente está en modo de un solo panel (mismo umbral que el CSS). */
  private get modoUnPanel(): boolean {
    const w = this.hostRef?.nativeElement?.clientWidth ?? 0;
    return w > 0 && w <= 800;
  }

  setVista(v: 'lista' | 'preview') { this.vista = v; }

  setTab(t: 'generables' | 'subir' | 'otras') {
    this.tabDocs = t;
  }

  setFiltro(f: 'todos' | 'pendientes' | 'listos') {
    this.filtroEstado = f;
  }

  limpiarBusqueda() { this.busquedaDoc = ''; }

  /** Normaliza para comparar sin tildes ni mayúsculas. */
  private static normBusqueda(s: string): string {
    return String(s ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim();
  }

  private coincideBusqueda(titulo: string): boolean {
    const q = GenerateContractingDocumentsComponent.normBusqueda(this.busquedaDoc);
    if (!q) return true;
    return GenerateContractingDocumentsComponent.normBusqueda(titulo).includes(q);
  }

  private pasaFiltroEstado(doc: { titulo: string }): boolean {
    if (this.filtroEstado === 'pendientes') return !this.hasFile(doc);
    if (this.filtroEstado === 'listos') return this.hasFile(doc);
    return true;
  }

  /**
   * Grupos de la pestaña activa, ya filtrados por búsqueda y estado.
   *
   * Los CONTADORES de cada sección se siguen calculando sobre el grupo
   * completo (`agruparPorSeccion`), no sobre lo filtrado: si al buscar
   * "carnet" la sección dijera 0/1 en vez de 4/7, el número dejaría de
   * significar avance del expediente.
   */
  get gruposFiltrados(): Array<{ key: DocSeccion; label: string; icon: string; items: { titulo: string }[]; completados: number; totalSeccion: number }> {
    const base = this.tabDocs === 'subir'
      ? this.docsSubirAgrupados
      : this.docsGenerablesAgrupados;

    return base
      .map(g => ({
        ...g,
        totalSeccion: g.items.length,
        items: g.items.filter(d => this.coincideBusqueda(d.titulo) && this.pasaFiltroEstado(d)),
      }))
      .filter(g => g.items.length > 0);
  }

  /** Documentos de otras pantallas, filtrados solo por búsqueda (no tienen estado propio acá). */
  get otrasFiltradas() {
    return this.docsOtrasPantallasDisponibles.filter(d => this.coincideBusqueda(d.titulo));
  }

  /** Hay algo escrito o algún filtro distinto de "todos". */
  get hayFiltroActivo(): boolean {
    return !!this.busquedaDoc.trim() || this.filtroEstado !== 'todos';
  }

  /** Conteos para los chips de filtro (sobre los documentos visibles del expediente). */
  get conteoFiltros(): { todos: number; pendientes: number; listos: number } {
    const vis = this.documentosVisibles;
    const listos = vis.filter(d => this.hasFile(d)).length;
    return { todos: vis.length, pendientes: vis.length - listos, listos };
  }

  cedula: string = '';
  nombreCompletoLogin: string = '';
  codigoContratacion: any = '';
  firmaPersonalAdministrativo: any = '';
  user: any = {};
  sede: any = '';
  cedulaPersonalAdministrativo: any = '';
  referenciasA = REFERENCIAS_A;
  referenciasF = REFERENCIAS_F;
  empresa: string = '';

  firma: any = '';
  candidato: any = {};
  vacante: any = {};
  huella: any = '';
  foto: any = '';

  // ── Datos de obra/empresa para los documentos ──
  // El contrato (editable desde "Datos de obra" en Contratación) tiene prioridad;
  // si está vacío, se usa el dato original de la vacante/publicación.
  /**
   * Entrevista elegida al cargar (ver la selección en `ngOnInit`: ordena por id
   * DESC y prefiere la que tiene `publicacion`). Antes cada getter leía
   * `entrevistas[0]` —el orden crudo del backend—, así que el código de
   * contratación y la vacante salían de una entrevista y la fecha, la empresa
   * usuaria y la descripción de obra salían de OTRA.
   */
  entrevistaDoc: any = null;

  private get _entrevistaSel(): any {
    return this.entrevistaDoc ?? this.candidato?.entrevistas?.[0] ?? null;
  }

  private get _contratoObra(): any {
    return this._entrevistaSel?.proceso?.contrato || {};
  }
  get empresaUsuariaDoc(): string {
    return this._contratoObra?.empresa_usuaria || this.vacante?.empresaUsuariaSolicita || '';
  }
  get centroCostoDoc(): string {
    return this._contratoObra?.centro_costo_obra || this.vacante?.finca || '';
  }
  get direccionDoc(): string {
    const raw = this._contratoObra?.direccion_empresa || this.vacante?.direccion || '';
    // La dirección a veces ya viene con prefijo ("Dir.Km 4...", "DIRECCIÓN: ...")
    // y los contratos le anteponen su propio "DIR." → quedaba "DIR. Dir.Km 4".
    // Solo se quita como prefijo seguido de puntuación (no toca "Diagonal", etc.).
    return String(raw).replace(/^\s*(direcci[oó]n\b\s*[.:]?|dir\s*[.:])\s*/i, '').trim();
  }
  get descripcionObraDoc(): string {
    return this._contratoObra?.descripcion_de_obra || this.vacante?.descripcion || '';
  }
  /**
   * Cargo de la vacante tal como sale impreso en el contrato. Misma cadena de
   * fallbacks que usan los contratos/certificaciones (cargo puede llegar como
   * string u objeto según la época de la vacante).
   */
  get cargoDoc(): string {
    const vac: any = this.vacante;
    if (vac?.cargo?.nombre_cargo_empresa) return String(vac.cargo.nombre_cargo_empresa);
    if (vac?._id_cargo?.nombre_cargo_empresa) return String(vac._id_cargo.nombre_cargo_empresa);
    if (vac?.cargo?.nombre_cargo) return String(vac.cargo.nombre_cargo);
    if (vac?.nombre_cargo) return String(vac.nombre_cargo);
    if (typeof vac?.cargo === 'string') return vac.cargo;
    return '';
  }

  /**
   * Campo "Salario Mensual Ordinario" de la caratula de los contratos, ya
   * convertido a letras: "$ 2.500.000 DOS MILLONES QUINIENTOS MIL PESOS M/C".
   *
   * Antes iba el SMMLV escrito a mano dentro del codigo, asi que TODO contrato
   * salia con el minimo aunque la vacante pagara otra cosa. Ahora sale de la
   * vacante; si esta no trae salario se cae al minimo legal, que es el piso que
   * la ley garantiza de todas formas.
   */
  get salarioContratoDoc(): string {
    const crudo =
      this.vacante?.salario ??
      this._entrevistaSel?.proceso?.vacante_salario ??
      this.entrevistaDoc?.proceso?.vacante_salario ??
      null;
    return salarioContratoCO(crudo) || salarioContratoCO(SMMLV_VIGENTE);
  }

  /**
   * Limpia un valor que va impreso en un PDF legal.
   *
   * El backend de contratación arrastra `0` como "vacío" en varias columnas
   * (herencia de la migración desde Excel), y ni `??` ni `filter(Boolean)` lo
   * atrapan cuando llega como string `"0"`. Sin esto salen contratos con
   * "Nombre del Trabajador: 0 0" o "Domicilio: 0 - 0 - 0".
   */
  private limpio(v: any): string {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    if (!s || s === '0' || s === '0.0' || s === 'null' || s === 'undefined') return '';
    // Fechas centinela del origen (serial 0 de Excel).
    if (/^0?0?\/?0?1\/1900$/.test(s) || s.startsWith('1900-01-0')) return '';
    return s;
  }

  /**
   * Municipio donde se firma el contrato.
   *
   * `user.sede.nombre` es un CÓDIGO de sede (FACA_PRIMERA, MONTE_VERDE…), no un
   * municipio: el modelo `Sede` del backend solo tiene `nombre` y `activa`, sin
   * ciudad. Por eso se traduce acá. Las claves se normalizan a NFC porque en BD
   * conviven las dos formas Unicode (TOCANCIPÁ existe como NFD y como NFC).
   *
   * Si la sede no está mapeada se cae al domicilio de la temporal, que es lo
   * correcto para VIRTUAL/FORANEOS y lo menos malo para una sede nueva:
   * imprimir un municipio equivocado es peor que imprimir el de la sede legal.
   */
  private static readonly SEDE_A_MUNICIPIO: { [sede: string]: string } = {
    'ADMINISTRATIVOS': 'Facatativá',
    'CARTAGENITA': 'Facatativá',
    'FACA_PRIMERA': 'Facatativá',
    'FACA_PRINCIPAL': 'Facatativá',
    'BOSA': 'Bogotá D.C.',
    'FONTIBÓN': 'Bogotá D.C.',
    'SUBA': 'Bogotá D.C.',
    'USME': 'Bogotá D.C.',
    'FUNZA': 'Funza',
    'MONTE_VERDE': 'Funza',
    'MADRID': 'Madrid',
    'ROSAL': 'El Rosal',
    'SOACHA': 'Soacha',
    'SOTAQUIRA': 'Sotaquirá',
    'TOCANCIPÁ': 'Tocancipá',
    'ZIPAQUIRÁ': 'Zipaquirá',
    // ANDES, FORANEOS y VIRTUAL no tienen municipio propio → domicilio de la temporal.
  };

  /**
   * Datos legales de cada empresa usuaria para el Acuerdo de Uso de Imagen.
   *
   * No están en la BD: `CentroCosto` solo guarda empresa, dirección y ciudad,
   * sin NIT ni representante legal. Sin este catálogo el documento imprime
   * "___________" en esos cuatro campos.
   *
   * Las claves se comparan normalizadas (sin acentos, sin sufijos societarios).
   * Para agregar una empresa, basta con una entrada nueva.
   */
  get municipioFirma(): string {
    const key = String(this.sede ?? '')
      .normalize('NFC')
      .toUpperCase()
      .trim();
    const mapeado = GenerateContractingDocumentsComponent.SEDE_A_MUNICIPIO[key];
    if (mapeado) return mapeado;

    const emp = String(this.empresa ?? '').toUpperCase();
    return emp.includes('ALIANZA') ? 'Madrid' : 'Facatativá';
  }

  batchMode = false;
  batchCedulas: any[] = [];
  blockSeleccionado: any = null;
  procesandoBatch = false;
  guardandoBatch = false;
  todoGenerado = false;

  // ── Lote masivo: estado de presentación ──
  // La entrada de cédulas pasó del SweetAlert con textarea a un primer paso
  // dentro del mismo panel: así se puede revisar lo pegado (repetidas, basura)
  // antes de disparar 30 generaciones, y volver a editar sin perder el lote.
  /** Paso visible del panel de lote. */
  loteStep: 'cedulas' | 'cola' = 'cedulas';
  /** Texto crudo pegado por el usuario. */
  loteTexto = '';
  /** Progreso de la subida (antes iba en un Swal bloqueante). */
  loteSubidas = 0;
  lotePorSubir = 0;
  /** Resumen de la última subida. Reemplaza el Swal final. */
  loteResumen: { ok: number; fallidos: { cedula: string; error: string }[] } | null = null;

  _getExitosos(): number {
    return this.batchCedulas?.filter?.((x: any) => x?.status === 'Done' && !x?.guardado)?.length || 0;
  }

  /**
   * Parseo del texto pegado. Misma regla que tenía el Swal (una por línea,
   * se ignoran las vacías) más lo que antes pasaba de largo: las cédulas
   * REPETIDAS, que generaban el mismo contrato dos veces y lo subían dos
   * veces.
   *
   * El filtro de "no parece un documento" es a propósito PERMISIVO
   * (alfanumérico, 4-20). Descartar de más es el error caro: una cédula que
   * se cae en silencio deja a una persona sin contrato y nadie se entera.
   * Una que pasa de más termina como fila en Error diciendo "Candidato no
   * encontrado", que se ve. Por eso solo se descarta lo que claramente es
   * otra cosa (encabezados con espacios, nombres, símbolos).
   */
  get loteParseo(): { validas: string[]; repetidas: string[]; invalidas: string[] } {
    const validas: string[] = [];
    const repetidas: string[] = [];
    const invalidas: string[] = [];
    const vistas = new Set<string>();

    for (const linea of String(this.loteTexto ?? '').split('\n')) {
      const c = linea.replace(/[.\s-]/g, '').trim();
      if (!c) continue;
      if (!/^[A-Za-z0-9]{4,20}$/.test(c)) { invalidas.push(linea.trim()); continue; }
      if (vistas.has(c)) { repetidas.push(c); continue; }
      vistas.add(c);
      validas.push(c);
    }
    return { validas, repetidas, invalidas };
  }

  /** Conteos del lote, para el pie del panel. */
  get loteStats(): { total: number; generados: number; subidos: number; errores: number; pendientes: number } {
    const items = this.batchCedulas ?? [];
    const subidos = items.filter(x => x?.guardado).length;
    return {
      total: items.length,
      generados: items.filter(x => x?.status === 'Done').length,
      subidos,
      errores: items.filter(x => x?.status === 'Error').length,
      pendientes: items.filter(x => x?.status === 'Pending' || x?.status === 'Processing').length,
    };
  }

  /** Porcentaje de la barra del panel de lote (generación o subida). */
  get loteProgreso(): number {
    if (this.guardandoBatch) {
      return this.lotePorSubir ? Math.round((this.loteSubidas / this.lotePorSubir) * 100) : 0;
    }
    const s = this.loteStats;
    if (!s.total) return 0;
    return Math.round(((s.generados + s.errores) / s.total) * 100);
  }

  /** Hay contratos generados que todavía no se han subido. */
  get loteHayPorSubir(): boolean {
    return this._getExitosos() > 0;
  }

  /** Texto de estado de un ítem del lote. */
  estadoLote(item: any): string {
    if (item?.guardado) return 'Subido al servidor';
    switch (item?.status) {
      case 'Done': return 'Generado · listo para subir';
      case 'Processing': return 'Generando contrato…';
      case 'Error': return item?.error || 'Error desconocido';
      default: return 'En espera';
    }
  }

  /** Clase de estado de un ítem del lote. */
  claseLote(item: any): string {
    if (item?.guardado) return 'subido';
    switch (item?.status) {
      case 'Done': return 'listo';
      case 'Processing': return 'procesando';
      case 'Error': return 'error';
      default: return 'pendiente';
    }
  }

  /** Ícono de estado de un ítem del lote. */
  iconoLote(item: any): string {
    if (item?.guardado) return 'cloud_done';
    switch (item?.status) {
      case 'Done': return 'check_circle';
      case 'Processing': return 'autorenew';
      case 'Error': return 'error';
      default: return 'schedule';
    }
  }

  /**
   * Arma el lote a partir del texto pegado y pasa al paso de la cola.
   * Es lo mismo que hacía el `if (text)` del Swal, con las repetidas fuera.
   */
  prepararLote(): void {
    const { validas } = this.loteParseo;
    if (!validas.length) return;

    this.batchCedulas = validas.map((c: string) => ({
      cedula: c,
      status: 'Pending',
      blobUrl: null,
      file: null,
      error: null,
      guardado: false,
    }));
    this.blockSeleccionado = this.batchCedulas[0];
    this.todoGenerado = false;
    this.loteResumen = null;
    this.loteStep = 'cola';
  }

  /** Vuelve al paso de cédulas sin perder lo generado. */
  volverACedulas(): void {
    if (this.procesandoBatch || this.guardandoBatch) return;
    this.loteResumen = null;
    this.loteStep = 'cedulas';
  }

  /**
   * Detiene el lote en curso sin cerrarlo.
   *
   * Antes la única forma de parar era cerrar el modal, y `cerrarBatch()`
   * vacía `batchCedulas`: se perdían los contratos ya generados y sin subir.
   * El `for` de `ejecutarBatch` revisa la bandera al principio de cada ítem,
   * así que el que esté en curso termina y no queda en "Processing".
   */
  detenerBatch(): void {
    this.batchCancelado = true;
  }

  /** Saca una cédula del lote (solo con el lote quieto). */
  quitarDelLote(item: any): void {
    if (this.procesandoBatch || this.guardandoBatch) return;
    if (item?.rawBlobUrl) { try { URL.revokeObjectURL(item.rawBlobUrl); } catch { /* ya revocado */ } }
    this.batchCedulas = this.batchCedulas.filter(x => x !== item);
    if (this.blockSeleccionado === item) this.blockSeleccionado = this.batchCedulas[0] ?? null;
    if (!this.batchCedulas.length) this.loteStep = 'cedulas';
    this.todoGenerado = this.batchCedulas.some(x => x.status === 'Done');
  }

  /**
   * Devuelve los fallidos a "Pending" y vuelve a correr el lote.
   * `ejecutarBatch` salta los que ya están en 'Done', así que solo reintenta
   * lo que falló.
   */
  async reintentarFallidos(): Promise<void> {
    if (this.procesandoBatch || this.guardandoBatch) return;
    for (const item of this.batchCedulas) {
      if (item?.status === 'Error') { item.status = 'Pending'; item.error = null; }
    }
    this.loteResumen = null;
    await this.ejecutarBatch();
  }

  /** Selecciona un ítem del lote (y en pantalla angosta muestra su PDF). */
  seleccionarLote(item: any): void {
    this.blockSeleccionado = item;
    if (this.modoUnPanel) this.loteVista = 'preview';
  }

  /** Panel visible del lote cuando el componente es angosto. */
  loteVista: 'cola' | 'preview' = 'cola';
  setLoteVista(v: 'cola' | 'preview') { this.loteVista = v; }

  private platformId = inject(PLATFORM_ID);
  private route = inject(ActivatedRoute);
  private utilService = inject(UtilityServiceService);
  private registroProcesoContratacion = inject(RegistroProcesoContratacion);
  private vacantesService = inject(VacantesService);
  private contratacionService = inject(HiringService);
  private gestionDocumentalService = inject(GestionDocumentalService);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);
  private permissions = inject(PermissionsService);
  private dialog = inject(MatDialog);

  documentos = [
    // Generales
    { titulo: 'Autorización de Datos' },
    { titulo: 'Manejo Imagen' },
    { titulo: 'Ficha Social' },
    { titulo: 'Entrevista de Ingreso' },
    { titulo: 'Entrevista de Ingreso Tu Alianza' },
    { titulo: 'Hoja de Vida Minerva' },
    { titulo: 'Contratos Otrosí' },
    { titulo: 'Auxilio Alimentación' },
    { titulo: 'Autorización Daños Pérdidas' },
    // Contrato y ficha
    { titulo: 'Ficha Técnica' },
    { titulo: 'Contrato' },
    // Inducciones por empresa
    { titulo: 'Inducción' },
    { titulo: 'Inducción Agrícola' },
    { titulo: 'Inducción Jardines de los Andes' },
    { titulo: 'Inducción Sagaro' },
    { titulo: 'Inducción Flores de los Andes' },
    { titulo: 'Inducción Ipanema' },
    { titulo: 'Inducción Ipanema Foráneos' },
    { titulo: 'Inducción Rebaño' },
    { titulo: 'Inducción Melody' },
    { titulo: 'Inducción Tu Alianza sin Casino' },
    { titulo: 'Inducción Administrativos' },
    // Operativos por empresa
    { titulo: 'Carta Descuento de Flor' },
    { titulo: 'Formato Timbre Ingreso/Salida' },
    { titulo: 'Carta Autorización Correo Electrónico' },
    { titulo: 'Acta de Funciones' },
    { titulo: 'Acta de Herramientas de Trabajo' },
    { titulo: 'Acta de Dotaciones' },
    { titulo: 'Acta de Funciones de SST' },
    // Operativos Flores del Rio
    { titulo: 'Entrega Carnets' },
    { titulo: 'Inducción Capacitación' },
    { titulo: 'Formato Solicitud' },
    // Sagaro extras
    { titulo: 'Sagaro Lockers' },
    { titulo: 'Sagaro Imagen' },
    { titulo: 'Sagaro Celular' },
    { titulo: 'OTRO SI Sagaro Fumigador' },
    { titulo: 'OTRO SI Jornada Laboral' },
    { titulo: 'Carnet' },
    // Subir manual: identidad / vinculación
    { titulo: 'Cédula' },
    { titulo: 'ARL' },
    { titulo: 'EPS' },
    { titulo: 'CCF' },
    { titulo: 'Pago Seguridad Social' },
    { titulo: 'Autorización Ingreso' },
    // Subir manual: estudios y referencias
    { titulo: 'Diplomas y Certificados de Estudios' },
    { titulo: 'Referencias (1 personal, 1 familiar, 2 laborales)' },
    { titulo: 'Referenciación' },
    // Subir manual: pruebas
    { titulo: 'Pruebas Psicológicas' },
    { titulo: 'Prueba Psicotécnica' },
    { titulo: 'Prueba Lectoescritura' },
    { titulo: 'Figura Humana' },
    { titulo: 'Test del Árbol' },
    { titulo: 'Prueba de Conocimiento' },
    { titulo: 'Prueba Técnica Formato Elite' },
    { titulo: 'Otras Pruebas' },
    // Subir manual: salud / SST
    { titulo: 'Colinesterasa' },
    { titulo: 'Curso Manipulación de Alimentos' },
    { titulo: 'Historial Laboral (Semanas Cotizadas)' },
    { titulo: 'Formato Resultado Prueba Valanti' },
    { titulo: 'Prueba SST' },
    { titulo: 'SST' },
    { titulo: 'Planilla SST' },
    { titulo: 'Evaluación SST' },
    // Subir manual: visita / vehículo / bonificaciones
    { titulo: 'Visita Domiciliaria' },
    { titulo: 'Fotografías Visita Domiciliaria' },
    { titulo: 'Tarjeta de Propiedad' },
    { titulo: 'Licencia de Conducción' },
    { titulo: 'Formato de Bonificación Ipanema' },
  ];

  nombreCompleto = '';

  private randIndex(max: number): number {
    if (!Number.isFinite(max) || max <= 0) return 0;

    const c = globalThis.crypto as Crypto | undefined;

    // ¡IMPORTANTE! No "descolgar" el método. Úsalo ligado a `crypto` o con bind.
    if (c?.getRandomValues) {
      const getRV = c.getRandomValues.bind(c);   // evita "Illegal invocation"
      const buf = new Uint32Array(1);
      getRV(buf);
      return Number(buf[0] % max);
    }

    // Fallback no criptográfico (suficiente para UI)
    return Math.floor(Math.random() * max);
  }

  // ─────────────────────────────────────────────────────────────
  // Devuelve una referencia aleatoria según el tipo:
  //  'A' => this.referenciasA,  'F' => this.referenciasF
  // ─────────────────────────────────────────────────────────────
  getReferencia(tipo: 'A' | 'F'): string {
    const pool = tipo === 'A' ? this.referenciasA : this.referenciasF;
    if (!pool?.length) return '';
    return pool[this.randIndex(pool.length)];
  }

  uploadedFiles: { [key: string]: UploadedInfo } = {};

  // typeMap: documento → ID de tipo en backend.
  // IDs ≥ 200 son PLACEHOLDERS para los docs nuevos. Hay que crearlos
  // en gestion_documental y reemplazar acá con el ID real antes de habilitar la subida.
  typeMap: { [key: string]: number } = {
    // Existentes
    'Contrato': 25,
    'Autorización de Datos': 26,
    'Inducción': 27,
    'Inducción Agrícola': 27,
    'Inducción Jardines de los Andes': 27,
    'Inducción Sagaro': 27,
    'Inducción Flores de los Andes': 27,
    'Inducción Ipanema': 27,
    'Inducción Ipanema Foráneos': 27,
    'Inducción Administrativos': 27,
    'Inducción Rebaño': 27,
    'Inducción Melody': 27,
    'Inducción Tu Alianza sin Casino': 27,
    'Ficha Técnica': 34,
    'Entrevista de Ingreso': 103,
    'Contratos Otrosí': 104,
    'Auxilio Alimentación': 105,
    'Autorización Daños Pérdidas': 106,
    'Cédula': 29,
    'ARL': 30,
    'Figura Humana': 31,
    'EPS': 36,
    'CCF': 37,                                 // antes 'Caja'
    'Pago Seguridad Social': 38,
    'Entrega Carnets': 95,
    'Inducción Capacitación': 96,
    'Formato Solicitud': 97,
    'Pruebas Psicológicas': 19,
    'Autorización Ingreso': 112,
    'Formato de Bonificación Ipanema': 113,    // antes 'Bonificación Ipanema'
    'Prueba Psicotécnica': 114,
    'Diplomas y Certificados de Estudios': 101,// antes 'Certificados Estudios'
    'SST': 91,
    'Otras Pruebas': 115,
    'Hoja de Vida Minerva': 28,
    'Prueba Lectoescritura': 20,
    'Visita Domiciliaria': 41,
    'Prueba SST': 24,
    'Manejo Imagen': 46,
    'Ficha Social': 98,
    'Sagaro Lockers': 108,
    'Sagaro Imagen': 109,
    'Sagaro Celular': 110,
    'OTRO SI Sagaro Fumigador': 220, // OTROSI_SAGARO_FUMIGADOR (tipo real creado en BD prod)
    // Mismo tipo documental que 'Contratos Otrosí' (104): son dos otrosí
    // distintos en contenido pero se archivan bajo el mismo tipo.
    'OTRO SI Jornada Laboral': 104,
    'Referencias (1 personal, 1 familiar, 2 laborales)': 118, // antes 'Referenciación'
    'Referenciación': 118,                     // alias temporal para backward compat
    // Tipos reales creados en BD prod (ids 201-220). Entrevista y Colinesterasa reusan tipos preexistentes (103/107).
    'Entrevista de Ingreso Tu Alianza': 103, // ENTREVISTA_INGRESO (tipo real ya existente en BD)
    'Carta Descuento de Flor': 201,
    'Formato Timbre Ingreso/Salida': 202,
    'Carta Autorización Correo Electrónico': 203,
    'Acta de Funciones': 204,
    'Acta de Herramientas de Trabajo': 205,
    'Acta de Dotaciones': 206,
    'Acta de Funciones de SST': 207,
    'Prueba Técnica Formato Elite': 208,
    'Colinesterasa': 107, // COLINESTERASA (tipo real existente en BD)
    'Curso Manipulación de Alimentos': 210,
    'Historial Laboral (Semanas Cotizadas)': 211,
    'Formato Resultado Prueba Valanti': 212,
    'Tarjeta de Propiedad': 213,
    'Licencia de Conducción': 214,
    'Fotografías Visita Domiciliaria': 215,
    'Prueba de Conocimiento': 216,
    'Test del Árbol': 217,
    'Planilla SST': 218,
    'Evaluación SST': 219,
  };

  /**
   * Documentos que se administran en OTRAS pantallas.
   *
   * No están en `typeMap` a propósito: desde aquí no se suben ni se generan.
   * Pero SÍ existen en el servidor y antes se descartaban en silencio al armar
   * `existingDocs`, así que no se podían ni ver. Se listan en una pestaña
   * aparte, de solo lectura, y NO entran en los contadores de progreso: el
   * checklist por empresa define qué exige cada cliente y no debe moverse
   * porque aquí se muestren documentos de otro lado.
   */
  readonly DOCS_OTRAS_PANTALLAS: ReadonlyArray<{ titulo: string; typeId: number; origen: string }> = [
    { titulo: 'Procuraduría', typeId: 3, origen: 'Preguntas de selección' },
    { titulo: 'Contraloría', typeId: 4, origen: 'Preguntas de selección' },
    { titulo: 'OFAC', typeId: 5, origen: 'Preguntas de selección' },
    { titulo: 'Policivos', typeId: 6, origen: 'Preguntas de selección' },
    { titulo: 'ADRES', typeId: 7, origen: 'Preguntas de selección' },
    { titulo: 'Sisbén', typeId: 8, origen: 'Preguntas de selección' },
    { titulo: 'AFP / Fondo de pensión', typeId: 11, origen: 'Robots' },
    { titulo: 'Semanas cotizadas', typeId: 33, origen: 'Preguntas de selección' },
    { titulo: 'Exámenes médicos', typeId: 32, origen: 'Pipeline de contratación' },
    { titulo: 'Carnet', typeId: 102, origen: 'Pipeline de contratación' },
  ];

  /** Solo las que de verdad están cargadas — no tiene sentido listar vacíos. */
  get docsOtrasPantallasDisponibles() {
    return this.DOCS_OTRAS_PANTALLAS.filter(d => !!this.existingDocs[d.titulo]);
  }

  // Diccionario para almacenar info de documentos ya existentes en base de datos
  existingDocs: { [key: string]: { date: string, url: string } } = {};

  async ngOnInit(): Promise<void> {
    // SSR: no hagas nada del navegador
    if (!isPlatformBrowser(this.platformId)) {
      this.user = {};
      return;
    }

    // Loader
    Swal.fire({
      icon: 'info',
      title: 'Cargando datos...',
      text: 'Por favor, espera un momento.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      // 1) Cédula: ruta -> localStorage
      const cedulaRuta = this.route.snapshot.paramMap.get('numeroDocumento') ?? '';
      this.cedula = cedulaRuta || localStorage.getItem('cedula') || '';
      if (this.cedula) localStorage.setItem('cedula', this.cedula);

      // 2) Usuario/sede
      this.user = this.utilService.getUser?.() ?? {};
      this.nombreCompletoLogin = `${this.user?.datos_basicos?.nombres ?? ''} ${this.user?.datos_basicos?.apellidos ?? ''}`.trim();
      this.cedulaPersonalAdministrativo = this.user?.numero_de_documento ?? '';
      this.sede = this.user?.sede?.nombre ?? '';

      // 3) Validación temprana
      if (!this.cedula) {
        Swal.close();
        Swal.fire('Sin datos', 'No hay cédula en la URL ni en sesión.', 'info');
        return;
      }

      // 4) Observables principales
      // El tipo llega por query param desde el pipeline: con cédula duplicada
      // (CC vs C.C/CE) el backend devolvería "el más recientemente atendido",
      // que puede ser el OTRO titular, y todos los documentos saldrían con
      // los datos equivocados.
      const tipoDocRuta = this.route.snapshot.queryParamMap.get('tipo_doc') || undefined;
      const datoCandidato$ = this.registroProcesoContratacion
        .getCandidatoPorDocumento(this.cedula, true, tipoDocRuta)
        .pipe(take(1), catchError(() => of(null)));

      const datoAdministrativo$ = this.user?.numero_de_documento
        ? this.contratacionService.buscarEncontratacion(this.user.numero_de_documento)
          .pipe(take(1), catchError(() => of(null)))
        : of(null);

      const datoAdministrativoBiometria$ = this.user?.numero_de_documento
        ? this.registroProcesoContratacion.getCandidatoPorDocumento(this.user.numero_de_documento, true)
          .pipe(take(1), catchError(() => of(null)))
        : of(null);

      const docsBackend$ = this.cedula
        // Compartido con el pipeline vía caché por cédula: si este diálogo se
        // abre justo después de consultar a la persona, no repite la petición.
        ? this.gestionDocumentalService.getDocumentosDeCandidato(this.cedula).pipe(take(1), catchError(() => of([])))
        : of([]);

      // 5) Ejecutar, cargar vacante (si hay), y setear estado
      forkJoin({ datoCandidato: datoCandidato$, datoAdministrativo: datoAdministrativo$, datoAdministrativoBiometria: datoAdministrativoBiometria$, docsBackend: docsBackend$ })
        .pipe(
          switchMap(({ datoCandidato, datoAdministrativo, datoAdministrativoBiometria, docsBackend }) => {
            this.candidato = datoCandidato;
            console.log('datoCandidato', datoCandidato);

            // Mapear documentos existentes
            this.existingDocs = {};
            if (Array.isArray(docsBackend)) {
              // Invertir typeMap para buscar títulos por ID.
              // OJO: el mapa NO es inyectivo — varios títulos comparten typeId
              // (27 = las 11 inducciones, 103 = las 2 entrevistas, 118 = las 2
              // referencias). Con un `idToTitle[typeId] = title` plano ganaba el
              // ÚLTIMO y el documento se indexaba bajo un título que casi nunca
              // era el visible para esa empresa → salía "Pendiente" aunque
              // estuviera en el servidor. Mapeamos a TODOS los títulos del tipo.
              const idToTitles = new Map<number, string[]>();
              for (const [title, typeId] of Object.entries(this.typeMap)) {
                const arr = idToTitles.get(typeId);
                if (arr) arr.push(title);
                else idToTitles.set(typeId, [title]);
              }
              // Aliases: typeIds del backend que no tienen entry propia en `documentos[]`
              // pero deben mostrarse bajo una entry unificada de la UI.
              if (!idToTitles.has(111)) idToTitles.set(111, ['Ficha Técnica']); // Ficha TA completa

              // Documentos de otras pantallas: no están en `typeMap`, así que
              // antes se descartaban aquí y quedaban invisibles aunque
              // estuvieran en el servidor. Se indexan para poder verlos.
              for (const d of this.DOCS_OTRAS_PANTALLAS) {
                const arr = idToTitles.get(d.typeId);
                if (arr) arr.push(d.titulo);
                else idToTitles.set(d.typeId, [d.titulo]);
              }
              // El fondo de pensión se guarda como AFP (11) o como
              // FONDO_PENSION (9); el backend hace ese mismo fallback.
              if (!idToTitles.has(9)) idToTitles.set(9, ['AFP / Fondo de pensión']);

              // `type` llega como número o como objeto anidado según el
              // endpoint. Comparar `doc.type` crudo contra un Map<number>
              // fallaba en silencio y el documento salía "Pendiente" estando
              // en el servidor. Mismo criterio que `urlDeTipo`.
              const tipoDe = (d: any): number => {
                const t = d?.type;
                return Number(t && typeof t === 'object' ? t.id : t);
              };

              // Solo documentos del TITULAR abierto: el GET expande <ced>/x<ced>
              // y puede traer el expediente del OTRO titular con el mismo
              // número (CC vs C.C/CE). Sin owner_id (payload viejo) se acepta.
              const ownerEsperado = (
                String(this.candidato?.tipo_doc || 'CC').trim().toUpperCase() === 'CC'
                  ? String(this.cedula ?? '').trim()
                  : `x${String(this.cedula ?? '').trim()}`
              ).toLowerCase();
              const docsDelTitular = (docsBackend || []).filter((d: any) =>
                d?.owner_id == null || String(d.owner_id).trim().toLowerCase() === ownerEsperado);

              docsDelTitular.forEach((doc: any) => {
                const titles = idToTitles.get(tipoDe(doc));
                if (!titles?.length) return;
                // El backend ya recorta a 1 documento por tipo, así que esto es
                // la representación más fiel disponible: no hay forma de saber
                // qué variante (p.ej. cuál inducción) se subió.
                const entry = {
                  date: doc.created_at || doc.updated_at || '',
                  url: doc.file_url || doc.file || doc.current_file?.url || ''
                };
                for (const title of titles) {
                  this.existingDocs[title] = entry;
                }
              });

              console.log('existingDocs cargados:', this.existingDocs);
            }

            this.firma = this.bioUrl(datoCandidato?.biometria?.firma);
            this.huella = this.bioUrl(datoCandidato?.biometria?.huella);
            this.foto = this.bioUrl(datoCandidato?.biometria?.foto);
            // El giro manual es de la foto de ESTE candidato: al cambiar de
            // persona se vuelve a empezar desde el enderezado automático.
            this.rotacionFoto.set(0);
            void this.refrescarPreviewFoto();

            // Selección de entrevista:
            //   1) Ordena por id DESC (la última creada, sin depender del orden del backend).
            //   2) Prefiere la primera con `proceso.publicacion` (necesaria para filtrar por empresa/finca).
            //   3) Si ninguna tiene publicación, cae a la primera con contrato_codigo.
            //   4) Último recurso: la más reciente.
            const entrevistas: any[] = Array.isArray(datoCandidato?.entrevistas) ? [...datoCandidato.entrevistas] : [];
            entrevistas.sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0));
            const entrevistaConPub = entrevistas.find(e => e?.proceso?.publicacion);
            const entrevistaConContrato = entrevistas.find(
              e => e?.proceso?.contrato_codigo || e?.proceso?.contrato?.codigo_contrato
            );
            const entrevistaVálida = entrevistaConPub || entrevistaConContrato || entrevistas[0];

            console.log('[entrevista pick]',
              'total=', entrevistas.length,
              '| ids=', entrevistas.map(e => e?.id),
              '| picked=', entrevistaVálida?.id,
              '| razón=', entrevistaConPub ? 'tiene publicacion'
              : entrevistaConContrato ? 'solo contrato_codigo'
                : 'fallback más reciente',
              '| pub_id=', entrevistaVálida?.proceso?.publicacion ?? null);

            // Se guarda la entrevista elegida para que TODOS los documentos
            // (fecha de contrato, empresa usuaria, descripción de obra…) salgan
            // de la misma, y no del primer elemento crudo del array.
            this.entrevistaDoc = entrevistaVálida ?? null;

            this.codigoContratacion =
              entrevistaVálida?.proceso?.contrato_codigo ??
              entrevistaVálida?.proceso?.contrato?.codigo_contrato ?? null;

            this.firmaPersonalAdministrativo = datoAdministrativoBiometria?.biometria?.firma?.file_url
              ?? datoAdministrativoBiometria?.biometria?.firma?.file
              ?? datoAdministrativo?.data?.[0]?.firmaSolicitante
              ?? '';

            const vacanteId = entrevistaVálida?.proceso?.publicacion ?? null;
            const vacante$ = vacanteId
              ? this.vacantesService.obtenerVacante(vacanteId).pipe(take(1), catchError(() => of(null)))
              : of(null);

            return vacante$.pipe(map(vac => ({ vac, datoAdministrativo, datoCandidato })));
          }),
          tap(({ vac }) => {
            this.vacante = vac ?? {};
            console.log('vacanteData', vac);
            this.empresa = this.vacante?.temporal || '';
            console.log('Código de contratación:', this.codigoContratacion);
          }),
          finalize(() => Swal.close())
        )
        .subscribe({
          next: () => {
            this.cdr.markForCheck();
          },
          error: (err) => {
            console.error(err);
            Swal.close();
            Swal.fire('Error', 'Ocurrió un error al cargar información.', 'error');
          },
        });

    } catch (error) {
      console.error('Error en ngOnInit:', error);
      Swal.close();
      this.user = {};
      Swal.fire('Error', 'Ocurrió un error inesperado.', 'error');
    }
  }

  isSubirPDF(doc: any): boolean {
    return [
      // Existentes (con renames aplicados)
      'Cédula', 'ARL', 'Figura Humana', 'EPS', 'CCF', 'Pago Seguridad Social',
      'Pruebas Psicológicas', 'Prueba Lectoescritura', 'Visita Domiciliaria', 'Prueba SST',
      'Autorización Ingreso', 'Formato de Bonificación Ipanema', 'Prueba Psicotécnica',
      'Diplomas y Certificados de Estudios', 'SST', 'Otras Pruebas',
      'Referencias (1 personal, 1 familiar, 2 laborales)', 'Referenciación',
      // NUEVOS subir-only
      'Prueba Técnica Formato Elite', 'Colinesterasa', 'Curso Manipulación de Alimentos',
      'Historial Laboral (Semanas Cotizadas)', 'Formato Resultado Prueba Valanti',
      'Tarjeta de Propiedad', 'Licencia de Conducción', 'Fotografías Visita Domiciliaria',
      'Prueba de Conocimiento', 'Test del Árbol', 'Planilla SST', 'Evaluación SST',
      // Los que pasaron de stub a subir-only (no se generan, solo se suben)
      // (Carta Descuento de Flor / Formato Timbre / Carta Autorización Correo
      //  ya se generan: ver `cartas-tu-alianza-fill.ts`)
      'Acta de Funciones',
      'Acta de Herramientas de Trabajo',
      'Acta de Dotaciones',
      'Acta de Funciones de SST',
    ].includes(doc.titulo);
  }

  /** Documentos con 2 variantes (básica / TA Completa) — el botón Generar abre un mat-menu. */
  hasVariants(doc: { titulo: string }): boolean {
    return doc.titulo === 'Contrato' || doc.titulo === 'Ficha Técnica';
  }

  /**
   * Solo el rol GERENCIA puede generar el contrato a término fijo
   * (variante "Administrativo"). Se usa para ocultar esa acción al resto.
   */
  get esGerencia(): boolean {
    return /GERENCIA/i.test(this.user?.rol?.nombre ?? '');
  }

  /**
   * Super admin (ADMIN / ADMINISTRADOR / SUPER ADMIN / SUPERADMIN, según
   * `PermissionsService.isAdmin()`): ve el catálogo COMPLETO de documentos,
   * sin el filtro por temporal / empresa usuaria / finca.
   *
   * El filtro por empresa existe para no abrumar al operario con documentos
   * que su finca nunca usa, pero deja al admin sin poder consultar ni resubir
   * expedientes de otras empresas (y lo deja en 3 documentos si la vacante no
   * resuelve perfil). Para ese rol el filtro es un estorbo, no una protección:
   * el backend nunca filtró por empresa ni por rol.
   */
  get esSuperAdmin(): boolean {
    return this.permissions.isAdmin();
  }

  /**
   * Plantilla (Apoyo Laboral / Tu Alianza) para Contrato y Ficha Técnica.
   * El rol admin la escoge en un diálogo (puede generar cualquiera de las dos
   * desde la misma pantalla); al resto de roles se la impone la temporal de la
   * vacante (`this.empresa`), como siempre.
   * Devuelve null si el admin cancela el diálogo.
   */
  private async elegirPlantillaApoyoAlianza(titulo: string): Promise<'APOYO' | 'ALIANZA' | null> {
    const emp = (this.empresa ?? '').toUpperCase().trim();
    if (!this.esSuperAdmin) return emp.includes('ALIANZA') ? 'ALIANZA' : 'APOYO';
    const res = await Swal.fire({
      title: titulo,
      text: `¿Con qué plantilla lo generas? (temporal de la vacante: ${this.empresa || 'sin definir'})`,
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Apoyo Laboral',
      denyButtonText: 'Tu Alianza',
      cancelButtonText: 'Cancelar',
    });
    if (res.isConfirmed) return 'APOYO';
    if (res.isDenied) return 'ALIANZA';
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAQUETES UNIDOS POR OFICINA
  // Soacha y Faca Primera entregan un único PDF con el expediente mínimo, en
  // vez de imprimir documento por documento. Cada oficina define su propia
  // lista; el armado es el mismo.
  // ══════════════════════════════════════════════════════════════════════

  /** Orden exacto del paquete. `soloPrimeraPagina` recorta el contrato. */
  private readonly PAQUETE_SOACHA: Array<{
    titulo: string; typeId: number | number[]; soloPrimeraPagina?: boolean; externa?: boolean;
  }> = [
      { titulo: 'Ficha Técnica', typeId: 34 },
      { titulo: 'Cédula', typeId: 29 },
      { titulo: 'ARL', typeId: 30 },
      { titulo: 'Ficha Social', typeId: 98 },
      // Los exámenes médicos no están en `typeMap` de este componente (se
      // administran desde recruitment-pipeline), así que se buscan por typeId.
      { titulo: 'Exámenes médicos', typeId: 32, externa: true },
      { titulo: 'Contrato', typeId: 25, soloPrimeraPagina: true },
    ];

  /**
   * ¿La vacante es de Tu Alianza? Los dos paquetes de Faca Primera cambian de
   * lista según la temporal: Ficha Social y Manejo de Imagen son documentos del
   * lado de Apoyo Laboral (matriz Elite) y no van en un expediente de Alianza.
   */
  private get esTemporalAlianza(): boolean {
    return /ALIANZA/i.test(
      String(this.vacante?.temporal ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    );
  }

  /**
   * Faca Primera - paquete "Finca Usuarios": mismo mecanismo que Soacha, otra
   * lista. Acá el contrato va COMPLETO (Soacha recorta a la hoja 1) y se suma la
   * inducción que aplique. La inducción no es fija: depende de la empresa
   * usuaria de la vacante, así que se resuelve acá.
   */
  private get PAQUETE_FINCA_USUARIOS(): Array<{
    titulo: string; typeId: number | number[]; soloPrimeraPagina?: boolean; externa?: boolean;
  }> {
    const induccion = this.induccionHabilitada;

    // Tu Alianza: lista corta definida por operaciones. Sin Ficha Social ni
    // Manejo de Imagen (son de la matriz de Apoyo Laboral / Elite).
    if (this.esTemporalAlianza) {
      return [
        { titulo: 'Ficha Técnica', typeId: 34 },
        { titulo: 'Cédula', typeId: 29 },
        { titulo: 'ARL', typeId: 30 },
        { titulo: 'Contrato', typeId: 25 },
        ...(induccion ? [{ titulo: induccion, typeId: this.typeMap[induccion] ?? 27 }] : []),
        { titulo: 'Exámenes médicos', typeId: 32, externa: true },
      ];
    }

    return [
      { titulo: 'Ficha Técnica', typeId: 34 },
      { titulo: 'Cédula', typeId: 29 },
      { titulo: 'ARL', typeId: 30 },
      { titulo: 'Ficha Social', typeId: 98 },
      { titulo: 'Contrato', typeId: 25 },
      { titulo: 'Manejo Imagen', typeId: 46 },
      ...(induccion ? [{ titulo: induccion, typeId: this.typeMap[induccion] ?? 27 }] : []),
      { titulo: 'Exámenes médicos', typeId: 32, externa: true },
    ];
  }

  /**
   * Faca Primera - paquete "Finca": el expediente completo, con los
   * antecedentes incluidos.
   *
   * Los antecedentes (Procuraduría, Contraloría, OFAC, Policivos, ADRES,
   * Sisbén, AFP y Semanas cotizadas) NO están en el `typeMap` de este
   * componente: los sube `selection-questions`. `armarPaqueteUnido` los
   * encuentra igual, porque busca en el servidor por `typeId`. Los ids salen
   * del `typeMap` de ese componente.
   *
   * El orden es el que pidió operaciones y no coincide con el de Finca
   * Usuarios: acá los antecedentes van antes del contrato.
   */
  private get PAQUETE_FINCA(): Array<{
    titulo: string; typeId: number | number[]; soloPrimeraPagina?: boolean; externa?: boolean;
  }> {
    const induccion = this.induccionHabilitada;

    // Tu Alianza: lista y ORDEN definidos por operaciones. Difiere de la de
    // Apoyo Laboral en más que el orden — acá van la Entrevista de Ingreso y la
    // Colinesterasa, y NO van Sisbén, Autorización de Ingreso, Manejo de Imagen
    // ni Semanas cotizadas.
    if (this.esTemporalAlianza) {
      // La Colinesterasa se sube desde esta pantalla solo si el perfil de la
      // empresa la muestra; si no, el aviso de faltantes debe mandar a cargarla
      // donde corresponda en vez de sugerir que se resuelve aquí.
      const colinesterasaAqui = this.documentosVisibles.some(d => d.titulo === 'Colinesterasa');
      return [
        { titulo: 'Ficha Técnica', typeId: 34 },
        { titulo: 'Cédula', typeId: 29 },
        { titulo: 'Policivos', typeId: 6, externa: true },
        { titulo: 'Procuraduría', typeId: 3, externa: true },
        { titulo: 'Contraloría', typeId: 4, externa: true },
        { titulo: 'OFAC', typeId: 5, externa: true },
        { titulo: 'Entrevista de Ingreso Tu Alianza', typeId: 103 },
        { titulo: 'Exámenes médicos', typeId: 32, externa: true },
        { titulo: 'Colinesterasa', typeId: 107, externa: !colinesterasaAqui },
        { titulo: 'Contrato', typeId: 25 },
        { titulo: 'ARL', typeId: 30 },
        ...(induccion ? [{ titulo: induccion, typeId: this.typeMap[induccion] ?? 27 }] : []),
        { titulo: 'ADRES', typeId: 7, externa: true },
        { titulo: 'AFP / Fondo de pensión', typeId: [11, 9], externa: true },
      ];
    }

    return [
      { titulo: 'Ficha Técnica', typeId: 34 },
      { titulo: 'Cédula', typeId: 29 },
      { titulo: 'Procuraduría', typeId: 3, externa: true },
      { titulo: 'Contraloría', typeId: 4, externa: true },
      { titulo: 'OFAC', typeId: 5, externa: true },
      { titulo: 'Policivos', typeId: 6, externa: true },
      { titulo: 'ADRES', typeId: 7, externa: true },
      { titulo: 'Sisbén', typeId: 8, externa: true },
      { titulo: 'Autorización Ingreso', typeId: 112 },
      { titulo: 'Contrato', typeId: 25 },
      { titulo: 'Manejo Imagen', typeId: 46 },
      ...(induccion ? [{ titulo: induccion, typeId: this.typeMap[induccion] ?? 27 }] : []),
      { titulo: 'ARL', typeId: 30 },
      { titulo: 'Exámenes médicos', typeId: 32, externa: true },
      { titulo: 'AFP / Fondo de pensión', typeId: [11, 9], externa: true },
      { titulo: 'Semanas cotizadas', typeId: 33, externa: true },
    ];
  }

  /**
   * La inducción habilitada para esta vacante.
   *
   * Todas las inducciones comparten el tipo 27 en el backend, pero solo una
   * está visible por empresa usuaria (`documentos-por-empresa.config.ts`). Se
   * toma la primera visible; si la empresa no tiene ninguna, el paquete sale
   * sin inducción en vez de fallar.
   */
  get induccionHabilitada(): string | null {
    return this.documentosVisibles
      .find(d => d.titulo.startsWith('Inducción'))?.titulo ?? null;
  }

  /**
   * La oficina del usuario logueado, LISTA PARA IMPRIMIR.
   *
   * `user.sede.nombre` es el código de sede tal cual lo guarda el backend, con
   * guion bajo (`FACA_PRIMERA`, `MONTE_VERDE`). Eso sirve como llave —lo usan
   * `SEDE_A_MUNICIPIO`, `esOficinaSoacha` y `esOficinaFacaPrimera`— pero en un
   * documento impreso se lee mal, así que acá el guion se vuelve espacio.
   *
   * OJO: este getter es solo para pintar. Comparar contra él rompe esas tres
   * reglas; para comparar se sigue usando `this.sede`.
   */
  get oficinaUsuarioImpresa(): string {
    return String(this.user?.sede?.nombre ?? '').replace(/_/g, ' ').trim();
  }

  /** El botón del paquete solo se ofrece a la oficina de Soacha. */
  get esOficinaSoacha(): boolean {
    return /SOACHA/i.test(
      String(this.sede ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    );
  }

  /**
   * Solo FACA_PRIMERA. No se usa /FACA/ porque FACA_PRINCIPAL es otra oficina
   * y no pidió el paquete.
   */
  get esOficinaFacaPrimera(): boolean {
    return /^FACA[_\s-]?PRIMERA$/i.test(
      String(this.sede ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    );
  }

  /** Paquete de Soacha: expediente mínimo, contrato recortado a la hoja 1. */
  async descargarPaqueteSoacha(): Promise<void> {
    await this.armarPaqueteUnido({
      etiqueta: 'Soacha',
      nombre: 'Paquete-Soacha',
      piezas: this.PAQUETE_SOACHA,
      // Cédula, ARL y exámenes no se generan: se suben, así que esos se buscan
      // tal cual. El contrato usa la variante básica (por obra o labor).
      generables: [
        { titulo: 'Ficha Técnica', generar: () => this.generarFichaTecnica() },
        { titulo: 'Ficha Social', generar: () => this.generarFichaSocial() },
        { titulo: 'Contrato', generar: () => this.runContratoVariant('basica') },
      ],
    });
  }

  /** Faca Primera - Finca Usuarios: contrato completo + imagen + inducción. */
  async descargarPaqueteFincaUsuarios(): Promise<void> {
    const induccion = this.induccionHabilitada;
    await this.armarPaqueteUnido({
      etiqueta: 'Finca Usuarios',
      nombre: 'Paquete-Finca-Usuarios',
      piezas: this.PAQUETE_FINCA_USUARIOS,
      // Se declaran los generables de AMBAS temporales; `armarPaqueteUnido`
      // ejecuta solo los que estén en `piezas`, así que Ficha Social y Manejo
      // Imagen no se tocan cuando la vacante es de Tu Alianza.
      generables: [
        // La ficha técnica va por variante: Tu Alianza tiene formato propio.
        { titulo: 'Ficha Técnica', generar: () => this.runFichaTecnicaVariant('basica') },
        { titulo: 'Ficha Social', generar: () => this.generarFichaSocial() },
        { titulo: 'Contrato', generar: () => this.runContratoVariant('basica') },
        { titulo: 'Manejo Imagen', generar: () => this.generarManejoImagen() },
        // `generarPDF` despacha la inducción que corresponda a la empresa.
        ...(induccion ? [{ titulo: induccion, generar: () => this.generarPDF(induccion) }] : []),
      ],
    });
  }

  /**
   * Faca Primera - Finca: expediente completo con antecedentes.
   *
   * Los antecedentes no se generan acá (los sube `selection-questions`), así
   * que solo se listan en `piezas`: si alguno falta, `armarPaqueteUnido` lo
   * reporta al final en vez de abortar el paquete.
   */
  async descargarPaqueteFinca(): Promise<void> {
    const induccion = this.induccionHabilitada;
    await this.armarPaqueteUnido({
      etiqueta: 'Finca',
      nombre: 'Paquete-Finca',
      piezas: this.PAQUETE_FINCA,
      generables: [
        { titulo: 'Ficha Técnica', generar: () => this.runFichaTecnicaVariant('basica') },
        { titulo: 'Contrato', generar: () => this.runContratoVariant('basica') },
        { titulo: 'Manejo Imagen', generar: () => this.generarManejoImagen() },
        // Solo entra en el paquete de Tu Alianza, pero se genera desde acá
        // (formato TA SE-RE-2): sin esto habría que ir a buscarla al servidor y
        // el paquete saldría incompleto la primera vez.
        { titulo: 'Entrevista de Ingreso Tu Alianza', generar: () => this.generarPDF('Entrevista de Ingreso Tu Alianza') },
        ...(induccion ? [{ titulo: induccion, generar: () => this.generarPDF(induccion) }] : []),
      ],
    });
  }

  /**
   * Une los documentos del paquete en un solo PDF y lo descarga.
   *
   * Cada pieza se toma de lo generado en esta sesión (`uploadedFiles`) y, si no
   * está, del documento ya cargado en el servidor. Lo que falte se reporta al
   * final en vez de abortar: es preferible entregar el paquete y decir qué
   * faltó, a no entregar nada.
   */
  private async armarPaqueteUnido(cfg: {
    etiqueta: string;
    nombre: string;
    piezas: Array<{
      titulo: string;
      typeId: number | number[];
      soloPrimeraPagina?: boolean;
      /**
       * `true` = la pieza NO se administra en esta pantalla (antecedentes,
       * exámenes…). Solo puede venir del servidor, así que si falta no sirve
       * de nada quedarse aquí: hay que cargarla donde corresponda. Se usa para
       * que el aviso de faltantes diga qué puede resolver el usuario y qué no.
       */
      externa?: boolean;
    }>;
    generables: Array<{ titulo: string; generar: () => any }>;
  }): Promise<void> {
    const log = `[paquete ${cfg.etiqueta}]`;

    if (!this.cedula) {
      Swal.fire('Sin candidato', 'No hay cédula seleccionada.', 'info');
      return;
    }

    // El paquete genera Contrato/Ficha, que llevan firma, huella y foto:
    // misma regla dura que la generación individual.
    if (!await this.exigirBiometria()) return;

    Swal.fire({ title: 'Armando el paquete…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      // Generar primero lo que se puede generar, para no obligar al usuario a
      // hacerlo documento por documento antes de descargar.
      //
      // Solo lo que de verdad va en ESTE paquete: `generables` se declara con
      // todas las piezas posibles y las listas cambian según la temporal, así
      // que sin este filtro un candidato de Tu Alianza terminaba con la Ficha
      // Social y el Manejo de Imagen (documentos de Apoyo Laboral / Elite)
      // montados en `uploadedFiles`, listos para subirse sin corresponderle.
      const enElPaquete = new Set(cfg.piezas.map(p => p.titulo));
      for (const g of cfg.generables) {
        if (!enElPaquete.has(g.titulo)) continue;
        if (this.uploadedFiles[g.titulo]?.file instanceof File) continue; // ya está
        try {
          await g.generar();
        } catch (e) {
          // Si uno falla se sigue: el faltante se reporta al final.
          console.error(log, 'no se pudo generar', g.titulo, e);
        }
      }

      let docsServidor: any[] = [];
      try {
        docsServidor = (await firstValueFrom(
          this.gestionDocumentalService.getDocumentosDeCandidato(this.cedula).pipe(take(1), catchError(() => of([])))
        )) ?? [];
      } catch { docsServidor = []; }

      // `type` puede venir como número o como objeto anidado según el
      // endpoint, así que se normaliza antes de comparar. Y se aceptan VARIOS
      // ids por pieza: el fondo de pensión se guarda como AFP (11) o como
      // FONDO_PENSION (9) — el propio backend hace ese fallback
      // (PDF_KIND_TO_TYPE_IDS['fondo'] en Robots/views.py).
      const idDeTipo = (x: any): number => {
        const t = x?.type;
        return Number(t && typeof t === 'object' ? t.id : t);
      };
      // Igual que en existingDocs: nunca meter al paquete legal un PDF del
      // OTRO titular con el mismo número (el GET expande <ced>/x<ced>).
      const ownerPaquete = (
        String(this.candidato?.tipo_doc || 'CC').trim().toUpperCase() === 'CC'
          ? String(this.cedula ?? '').trim()
          : `x${String(this.cedula ?? '').trim()}`
      ).toLowerCase();
      const docsPropios = (docsServidor || []).filter((x: any) =>
        x?.owner_id == null || String(x.owner_id).trim().toLowerCase() === ownerPaquete);
      const urlDeTipo = (typeId: number | number[]): string | null => {
        const ids = Array.isArray(typeId) ? typeId : [typeId];
        for (const id of ids) {
          const d = docsPropios.find((x: any) => idDeTipo(x) === id);
          if (d) return d.file_url || d.file || d.current_file?.url || null;
        }
        return null;
      };

      const salida = await PDFDocument.create();
      const faltantes: string[] = [];
      const faltantesExternos: string[] = [];

      for (const pieza of cfg.piezas) {
        let bytes: ArrayBuffer | null = null;

        // Primero lo que esté cargado en esta sesión aunque TODAVIA NO se haya
        // subido al servidor: el flujo normal es generar/adjuntar y descargar
        // el paquete antes de darle "Guardar y Cargar al Servidor".
        const local = this.uploadedFiles[pieza.titulo]?.file;
        if (local instanceof File) bytes = await local.arrayBuffer();

        if (!bytes) {
          const url = this.existingDocs[pieza.titulo]?.url || urlDeTipo(pieza.typeId);
          if (url) bytes = await this.fetchAsArrayBufferOrNull(url);
        }

        if (!bytes) {
          (pieza.externa ? faltantesExternos : faltantes).push(pieza.titulo);
          continue;
        }

        try {
          const src = await PDFDocument.load(bytes);
          const total = src.getPageCount();
          const indices = pieza.soloPrimeraPagina ? [0] : src.getPageIndices();
          const paginas = await salida.copyPages(src, indices.filter(i => i < total));
          paginas.forEach(p => salida.addPage(p));
        } catch (e) {
          console.error(log, 'no se pudo leer', pieza.titulo, e);
          faltantes.push(`${pieza.titulo} (ilegible)`);
        }
      }

      if (salida.getPageCount() === 0) {
        await this.cerrarLoadingSwal();
        Swal.fire('Sin documentos', 'Ninguno de los documentos del paquete está disponible todavía.', 'warning');
        return;
      }

      const blob = new Blob([(await salida.save()) as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${cfg.nombre}-${this.cedula}.pdf`;
      a.click();

      this.setPdfPreview(url);

      await this.cerrarLoadingSwal();
      if (faltantes.length || faltantesExternos.length) {
        // Se separan los dos casos porque la acción del usuario es distinta:
        // los de esta pantalla los puede generar o adjuntar aquí mismo; los
        // externos hay que cargarlos donde se administran.
        const bloques: string[] = [];
        if (faltantes.length) {
          bloques.push(
            `<p style="margin:0 0 4px 0">Puedes generarlos o adjuntarlos en esta pantalla:</p>` +
            `<b>${faltantes.join('<br>')}</b>`
          );
        }
        if (faltantesExternos.length) {
          bloques.push(
            `<p style="margin:10px 0 4px 0">Estos no se cargan aquí — se suben en ` +
            `<b>Preguntas de selección</b> y deben estar en el servidor:</p>` +
            `<b>${faltantesExternos.join('<br>')}</b>`
          );
        }
        Swal.fire({
          icon: 'warning',
          title: 'Paquete descargado, pero incompleto',
          html: bloques.join(''),
        });
      } else {
        Swal.fire({ icon: 'success', title: 'Paquete descargado', timer: 1800, showConfirmButton: false });
      }
    } catch (e) {
      console.error(log, e);
      Swal.close();
      Swal.fire('Error', 'No se pudo armar el paquete.', 'error');
    }
  }

  /**
   * Carnet de Apoyo: 2 hojas carta (frente y reverso) para imprimir a doble
   * cara y recortar. Se descarga directo, no se sube al gestor documental.
   */
  async generarCarnet(): Promise<void> {
    const cand: any = this.candidato ?? {};
    if (!cand?.numero_documento) {
      Swal.fire('Sin candidato', 'Selecciona un candidato primero.', 'info');
      return;
    }

    const contrato: any = this._entrevistaSel?.proceso?.contrato ?? {};

    // Consecutivo: ES el codigo de contrato. Ya no se escribe a mano — lo
    // asigna el backend por rango de oficina al guardar Examenes medicos o
    // Pago y Transporte, que es lo unico que garantiza que no se repita entre
    // usuarios simultaneos. `carnet_codigo` queda solo como respaldo de los
    // carnets viejos, cuando el numero se tecleaba.
    const consecutivo =
      this.limpio(contrato.codigo_contrato) ||
      this.limpio(this._entrevistaSel?.proceso?.contrato_codigo) ||
      this.limpio(contrato.carnet_codigo);

    if (!consecutivo) {
      Swal.fire(
        'Sin codigo de contrato',
        'El carnet usa el codigo de contrato como consecutivo y este candidato todavia no lo tiene. ' +
        'Guarda "Examenes medicos" o "Pago y Transporte" para generarlo y vuelve a intentar.',
        'info',
      );
      return;
    }

    // EPS y AFP salen de los antecedentes del proceso.
    const ants: any[] = Array.isArray(this._entrevistaSel?.proceso?.antecedentes)
      ? this._entrevistaSel.proceso.antecedentes : [];
    const porNombre = (n: string) =>
      this.limpio(ants.find(a => String(a?.nombre ?? '').toUpperCase() === n)?.observacion);

    // Contacto de emergencia desde los familiares del candidato.
    const fams: any[] = Array.isArray(cand?.familiares) ? cand.familiares : [];
    const emerg = fams.find(f => String(f?.tipo ?? '').toUpperCase().includes('EMERGENCIA')) ?? {};

    const nombreCompleto = [
      cand.primer_apellido, cand.segundo_apellido, cand.primer_nombre, cand.segundo_nombre,
    ].map(v => this.limpio(v)).filter(Boolean).join(' ');

    // La fecha del carnet es SIEMPRE `contrato.fecha_ingreso`, el DateField real.
    // Antes mandaba `carnet_fecha_ingreso`, que es un CharField de texto libre, y
    // el mismo carnet salía con una fecha desde acá y con otra desde Home —que
    // nunca lo miró—. Los cuatro caminos usan ahora la misma fuente.
    const fIng = this.limpio(contrato.fecha_ingreso);
    const fechaIngreso = /^\d{4}-\d{2}-\d{2}/.test(fIng)
      ? `${fIng.slice(8, 10)}/${fIng.slice(5, 7)}/${fIng.slice(0, 4)}`
      : fIng;

    const aDataUrl = async (url?: string) => {
      if (!url) return null;
      const b = await this.fetchAsArrayBufferOrNull(url);
      if (!b) return null;
      let bin = '';
      const u8 = new Uint8Array(b);
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return `data:image/png;base64,${btoa(bin)}`;
    };

    // ¿Cuál de los dos formatos? Se pregunta siempre, pero el botón que queda
    // enfocado es el de la temporal de la vacante, que es el caso normal.
    const esAlianzaVacante = (this.empresa || '').toUpperCase().includes('ALIANZA');
    const eleccion = await Swal.fire({
      icon: 'question',
      title: 'Formato del carnet',
      text: '¿Cuál formato quieres generar?',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Apoyo Laboral',
      denyButtonText: 'Tu Alianza',
      cancelButtonText: 'Cancelar',
      focusConfirm: !esAlianzaVacante,
      focusDeny: esAlianzaVacante,
    });
    if (eleccion.isDismissed) return;
    const formatoApoyo = eleccion.isConfirmed;

    // ¿En qué espacio de la hoja y cómo se voltea? Lo primero reutiliza una hoja
    // ya recortada en vez de gastar una nueva por cada carnet (los dos formatos
    // usan grilla 3x3); lo segundo es lo que hace que el reverso caiga detrás
    // del frente y la tarjeta quede pareja al recortar.
    const ajustes = await firstValueFrom(
      this.dialog.open<CarnetPosicionDialogComponent, CarnetPosicionData, CarnetPosicionResult | null>(
        CarnetPosicionDialogComponent,
        { data: { formato: formatoApoyo ? 'apoyo' : 'alianza' }, autoFocus: 'dialog' },
      ).afterClosed(),
    );
    if (!ajustes) return;
    const { celda: posicion, impresion } = ajustes;

    try {
      const cedula = this.limpio(cand.numero_documento);
      const codigo = String(consecutivo).trim();
      // La foto se endereza igual que en la ficha y la hoja de vida.
      const fotoDataUrl = await this.fotoAlDerechoDataUrl(this.foto);

      const blob = formatoApoyo
        // ── Apoyo: CR80 horizontal con código de barras ──
        ? buildCarnetApoyoPdf({
          nombreCompleto,
          cedula,
          centroCostos: this.limpio(contrato.carnet_centro_costo) || this.limpio(contrato.Ccentro_de_costos),
          cargo: this.limpio(this.vacante?.cargo),
          consecutivo: codigo,
          fechaIngreso,
          eps: porNombre('EPS'),
          afp: porNombre('AFP'),
          emergenciaNombre: this.limpio(emerg.nombre),
          emergenciaTelefono: this.limpio(emerg.telefono),
          logoDataUrl: await aDataUrl('logos/Logo_AL.png'),
          fotoDataUrl,
        }, posicion, impresion)
        // ── Tu Alianza: el diseño de la generación masiva de Home ──
        : buildCarnetsMasivoPdf([{
          CEDULA: cedula,
          CODIGO: codigo,
          // Apellidos y nombres van separados: el frente los imprime en dos
          // renglones (apellidos en negrita arriba, nombres debajo).
          APELLIDOS: [cand.primer_apellido, cand.segundo_apellido]
            .map((v: any) => this.limpio(v)).filter(Boolean).join(' '),
          NOMBRES: [cand.primer_nombre, cand.segundo_nombre]
            .map((v: any) => this.limpio(v)).filter(Boolean).join(' '),
          FECHA_INGRESO: fechaIngreso,
          CENTRO_COSTO: this.limpio(contrato.carnet_centro_costo) || this.limpio(contrato.Ccentro_de_costos),
          FAMILIAR_EMERGENCIA_NOMBRE: this.limpio(emerg.nombre),
          FAMILIAR_EMERGENCIA_TELEFONO: this.limpio(emerg.telefono),
          fotoDataUrl,
          // El QR lleva el mismo payload que arma Home (`CEDULA|CODIGO`), para
          // que un mismo lector sirva con los dos.
          qrDataUrl: await QRCode.toDataURL(`${cedula}|${codigo}`, {
            errorCorrectionLevel: 'M', margin: 1, width: 300,
          }).catch(() => null),
        }], {
          logoDataUrl: await aDataUrl('logos/Logo_TA.png'),
          telefonoCoordinador: TELEFONO_COORDINADOR_ALIANZA,
          arl: ARL_ALIANZA,
          // El diálogo numera las celdas 0..8 y este formato las espera 1..9:
          // sin el +1 el carnet caía una celda antes de la elegida (o sea,
          // encima de un hueco ya recortado).
          posicion: posicion + 1,
          impresion,
        });

      // Solo se genera y se muestra en el previsualizador; la descarga la decide
      // el usuario desde ahí.
      const url = URL.createObjectURL(blob);
      this.setPdfPreview(url);
    } catch (e) {
      console.error('[carnet]', e);
      Swal.fire('Error', 'No se pudo generar el carnet.', 'error');
    }
  }

  /**
   * ¿el documento tiene archivo (subido en esta sesión o existente en BD)?
   */
  hasFile(doc: { titulo: string }): boolean {
    return !!(this.uploadedFiles[doc.titulo] || this.existingDocs[doc.titulo]);
  }

  // ───────── Cache de filtro (perf) ─────────
  // Recalcula `documentosVisibles` solo cuando cambia el contexto (temporal/empresa/finca).
  // El objeto retornado se reutiliza por referencia → derivados (docsGenerables, etc.) son estables.
  private _docsVisiblesCache: { titulo: string }[] | null = null;
  private _docsVisiblesKey = '<unset>';

  /**
   * Documentos visibles según finca / empresa usuaria / temporal de la vacante.
   * `documentos-por-empresa.config.ts` es una WHITELIST ESTRICTA: lo que no está
   * en el perfil resuelto no se muestra, y si ningún perfil matchea solo quedan
   * los MÍNIMOS (Cédula, Contrato, Hoja de Vida Minerva).
   *
   * Excepción: un super admin ve el catálogo completo, sin filtro.
   */
  get documentosVisibles(): { titulo: string }[] {
    const tmp = this.vacante?.temporal ?? null;
    const emp = this.vacante?.empresaUsuariaSolicita ?? null;
    const fin = this.vacante?.finca ?? null;
    const sinFiltro = this.esSuperAdmin;
    const key = `${sinFiltro}|${tmp}|${emp}|${fin}`;

    if (key === this._docsVisiblesKey && this._docsVisiblesCache) {
      return this._docsVisiblesCache;
    }

    const ctx = { temporal: tmp, empresaUsuaria: emp, finca: fin };
    const visibles = sinFiltro
      ? [...this.documentos]
      : this.documentos.filter(d => isDocumentoVisible(d.titulo, ctx));

    this._docsVisiblesKey = key;
    this._docsVisiblesCache = visibles;

    console.debug('[docs filter]', sinFiltro ? '(super admin: sin filtro)' : ctx,
      '→', visibles.length, 'visibles:', visibles.map(d => d.titulo));

    return visibles;
  }

  /**
   * Vista plana 3-niveles (Todos): completados → generables → resto.
   * Mantiene la firma original del primer refactor para compat.
   */
  get documentosOrdenados(): { titulo: string }[] {
    const visibles = this.documentosVisibles;
    return [
      ...visibles.filter(d => this.hasFile(d)),
      ...visibles.filter(d => !this.hasFile(d) && !this.isSubirPDF(d)),
      ...visibles.filter(d => !this.hasFile(d) && this.isSubirPDF(d)),
    ];
  }

  /** Tab "Auto-generables": sólo los que NO son subir-only. */
  get docsGenerables(): { titulo: string }[] {
    const visibles = this.documentosVisibles;
    return [
      ...visibles.filter(d => !this.isSubirPDF(d) && this.hasFile(d)),
      ...visibles.filter(d => !this.isSubirPDF(d) && !this.hasFile(d)),
    ];
  }

  /** Tab "Solo subida": los que sí son subir-only. */
  get docsSubir(): { titulo: string }[] {
    const visibles = this.documentosVisibles;
    return [
      ...visibles.filter(d => this.isSubirPDF(d) && this.hasFile(d)),
      ...visibles.filter(d => this.isSubirPDF(d) && !this.hasFile(d)),
    ];
  }

  /** Avance del expediente (sobre los documentos visibles). */
  get progresoExpediente(): { completados: number; total: number; porcentaje: number } {
    const visibles = this.documentosVisibles;
    const total = visibles.length;
    const completados = visibles.reduce((acc, d) => acc + (this.hasFile(d) ? 1 : 0), 0);
    const porcentaje = total ? Math.round((completados / total) * 100) : 0;
    return { completados, total, porcentaje };
  }

  /** Conteo de completados por sub-grupo, para los badges en los tabs. */
  get progresoGenerables(): { completados: number; total: number } {
    const sub = this.documentosVisibles.filter(d => !this.isSubirPDF(d));
    return { completados: sub.filter(d => this.hasFile(d)).length, total: sub.length };
  }
  get progresoSubir(): { completados: number; total: number } {
    const sub = this.documentosVisibles.filter(d => this.isSubirPDF(d));
    return { completados: sub.filter(d => this.hasFile(d)).length, total: sub.length };
  }

  /** Agrupa documentos por sección (Generales / Inducción / Operativos / etc.) preservando el orden de SECCION_LABELS. */
  private agruparPorSeccion(docs: { titulo: string }[]): Array<{ key: DocSeccion; label: string; icon: string; items: { titulo: string }[]; completados: number }> {
    const map = new Map<DocSeccion, { titulo: string }[]>();
    for (const d of docs) {
      const k = (getDocSeccion(d.titulo) ?? 'generales') as DocSeccion;
      const arr = map.get(k);
      if (arr) arr.push(d);
      else map.set(k, [d]);
    }
    return SECCION_LABELS
      .map(s => {
        const items = map.get(s.key) ?? [];
        const completados = items.filter(d => this.hasFile(d)).length;
        return { ...s, items, completados };
      })
      .filter(g => g.items.length > 0);
  }

  /** Auto-generables agrupados por sección — para el HTML. */
  get docsGenerablesAgrupados() {
    return this.agruparPorSeccion(this.docsGenerables);
  }

  /** Subir-only agrupados por sección — para el HTML. */
  get docsSubirAgrupados() {
    return this.agruparPorSeccion(this.docsSubir);
  }

  /** Estado de un documento — alimenta el chip y el círculo de la izquierda. */
  estadoDoc(doc: { titulo: string }): 'completado_local' | 'completado_servidor' | 'pendiente' {
    if (this.uploadedFiles[doc.titulo]) return 'completado_local';
    if (this.existingDocs[doc.titulo]) return 'completado_servidor';
    return 'pendiente';
  }

  subirArchivo(event: Event, campo: string) {
    this.subirArchivoConTypeId(event, campo, undefined);
  }

  /**
   * Sube manual un PDF para una entry con variantes (p. ej. Ficha Técnica básica
   * vs TA Completa). El mat-menu pasa la variante; aquí se traduce a un typeId
   * override que se guardará en `uploadedFiles[campo].typeId`.
   */
  subirArchivoVariant(event: Event, campo: string, variant: 'basica' | 'completa') {
    let typeIdOverride: number | undefined;
    if (campo === 'Ficha Técnica') {
      typeIdOverride = variant === 'completa' ? 111 : undefined;
    }
    // Contrato comparte typeId 25 entre variantes → no necesita override.
    this.subirArchivoConTypeId(event, campo, typeIdOverride);
  }

  private subirArchivoConTypeId(event: Event, campo: string, typeIdOverride: number | undefined) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      this.resetInput(input);
      return;
    }

    // Validación del nombre de archivo
    if (file.name.length > 100) {
      Swal.fire('Error', 'El nombre del archivo no debe exceder los 100 caracteres', 'error');
      this.resetInput(input);
      return;
    }

    // Validar que el PDF no esté protegido con contraseña
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      this.checkPdfProtected(file).then(isProtected => {
        if (isProtected) {
          Swal.fire({
            icon: 'error',
            title: 'PDF protegido',
            html: 'Este PDF está <b>protegido con contraseña</b>. No se puede subir.<br><br>Quite la contraseña del archivo y vuelva a intentarlo.',
          });
          this.resetInput(input);
          return;
        }
        this.setFileInQueue(file, campo, input, typeIdOverride);
      });
      return;
    }

    this.setFileInQueue(file, campo, input, typeIdOverride);
  }

  /**
   * ¿El PDF exige contraseña para poder LEERLO?
   *
   * Ojo con la diferencia: la mayoría de los PDF que traen `/Encrypt` solo
   * tienen restricciones de permisos (no imprimir, no editar) puestas por quien
   * los emitió —EPS, cajas de compensación, entidades— y se abren sin pedir
   * nada. Esos hay que dejarlos subir.
   *
   * Antes se rechazaba por dos motivos que daban falsos positivos: encontrar
   * `/Encrypt` en la cabecera, y que `PDFDocument.load` con
   * `ignoreEncryption: false` falla ante CUALQUIER cifrado, incluso el de solo
   * permisos. La prueba real es si el documento se puede abrir y tiene páginas.
   */
  private async checkPdfProtected(file: File): Promise<boolean> {
    try {
      const buffer = await file.arrayBuffer();
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return doc.getPageCount() === 0;
    } catch {
      // No se pudo abrir: o pide contraseña de apertura, o está dañado.
      return true;
    }
  }

  private setFileInQueue(file: File, campo: string, input?: HTMLInputElement, typeId?: number) {
    // Revocar URL anterior si existía (evitar memory leaks)
    const prev = this.uploadedFiles[campo]?.previewUrl;
    if (prev) {
      try { URL.revokeObjectURL(prev); } catch { }
    }

    // Guardar archivo y URL de previsualización
    const previewUrl = URL.createObjectURL(file);
    this.uploadedFiles[campo] = { file, fileName: file.name, previewUrl, typeId };

    // Mostrar previsualización en el iframe (si es PDF)
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      this.setPdfPreview(previewUrl);
    } else {
      // Si quieres permitir ver imágenes también, puedes poner el mismo previewUrl
      // this.setPdfPreview(previewUrl);
      Swal.fire('Aviso', 'El archivo seleccionado no es un PDF. Solo se previsualizan PDFs.', 'info');
    }

    // Permitir volver a seleccionar el mismo archivo
    if (input) this.resetInput(input);
  }

  /** Última URL puesta en el visor, para revocarla cuando entre otra. */
  private urlPreviewActual: string | null = null;

  private setPdfPreview(url: string, intento = 0) {
    // En modo de un solo panel el visor está oculto por CSS (nunca con @if:
    // el iframe tiene que seguir en el DOM para que esta asignación llegue).
    // Al generar o al ver un PDF se pasa solo al visor, que es lo que el
    // usuario quiere mirar en ese momento.
    if (intento === 0 && this.modoUnPanel) this.vista = 'preview';

    const el = this.pdfPreviewIframe?.nativeElement;
    if (!el) {
      // El iframe puede no estar montado todavía (generación disparada antes de
      // que termine de renderizar la vista). Antes la asignación se perdía en
      // silencio y el visor se quedaba con el documento anterior.
      if (intento < 10) {
        setTimeout(() => this.setPdfPreview(url, intento + 1), 60);
      } else {
        console.warn('[preview] el iframe nunca estuvo disponible');
      }
      return;
    }

    el.src = url;

    // Liberar el blob anterior, no el que se acaba de poner.
    if (this.urlPreviewActual && this.urlPreviewActual !== url
      && this.urlPreviewActual.startsWith('blob:')) {
      try { URL.revokeObjectURL(this.urlPreviewActual); } catch { }
    }
    this.urlPreviewActual = url;
  }

  private resetInput(input: HTMLInputElement): void {
    const newInput = input.cloneNode(true) as HTMLInputElement;
    input.parentNode?.replaceChild(newInput, input);
  }

  verPDF(doc: { titulo: string }) {
    const fileData = this.uploadedFiles[doc.titulo];
    const existingDateUrl = this.existingDocs[doc.titulo]?.url;

    if (fileData?.file) {
      const fileReader = new FileReader();
      fileReader.onload = () => {
        const blob = new Blob([fileReader.result as ArrayBuffer], { type: 'application/pdf' });
        const pdfUrl = URL.createObjectURL(blob);
        this.setPdfPreview(pdfUrl);
      };
      fileReader.readAsArrayBuffer(fileData.file);
    } else if (existingDateUrl) {
      // Si existe en el backend, se muestra la URL remota
      this.setPdfPreview(existingDateUrl);
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se ha generado el documento',
      });
    }
  }

  /**
   * Cierra el Swal de carga y cede un tick antes de abrir el siguiente.
   *
   * SweetAlert2 reutiliza el popup cuando se dispara otro `Swal.fire()` en el
   * mismo tick, y el estado de `showLoading()` sobrevive a ese reemplazo: el
   * diálogo nuevo aparece con el spinner girando y SIN botón de confirmar, así
   * que el usuario no puede cerrarlo. `hideLoading()` restaura el botón y el
   * `setTimeout(0)` deja que termine la animación de cierre.
   */
  private async cerrarLoadingSwal(): Promise<void> {
    Swal.hideLoading();
    Swal.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  async cargarpdf() {
    Swal.fire({
      title: 'Cargando...',
      text: 'Por favor, espera mientras se suben los archivos.',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const { ok, fallidos, exitosos } = await this.subirTodosLosArchivos();

      // cerrar SIEMPRE el loading antes de mostrar otro swal
      await this.cerrarLoadingSwal();

      if (ok) {
        // Sin archivos pendientes también devuelve ok=true. Antes decía
        // "guardados exitosamente" sin haber subido nada, y el usuario
        // creía que sí se había guardado.
        const huboSubida = exitosos.length > 0;
        await Swal.fire({
          title: huboSubida ? '¡Éxito!' : 'Sin cambios',
          text: huboSubida
            ? `Datos y archivos guardados exitosamente (${exitosos.length}).`
            : 'No había documentos nuevos para subir.',
          icon: huboSubida ? 'success' : 'info',
          confirmButtonText: 'Ok',
        });
        return;
      }

      // Si hubo fallidos, muestra resumen (y ya no queda cargando)
      const htmlFallidos = `
      <p style="margin:0 0 8px 0">Algunos archivos no se subieron:</p>
      <ul style="text-align:left;margin:0;padding-left:18px">
        ${fallidos.map(f => `<li><b>${f.key}</b>: ${this.escapeHtml(f.error)}</li>`).join('')}
      </ul>
    `;

      await Swal.fire({
        icon: 'warning',
        title: 'Guardado con advertencias',
        html: htmlFallidos,
        confirmButtonText: 'Ok',
      });

    } catch (error: any) {
      await this.cerrarLoadingSwal();
      await Swal.fire({
        title: 'Error',
        text: `Hubo un error al subir los archivos: ${error?.message ?? String(error)}`,
        icon: 'error',
        confirmButtonText: 'Ok',
      });
    }
  }

  // Sube y SIEMPRE retorna resumen (nunca se queda “colgada”)
  async subirTodosLosArchivos(): Promise<{
    ok: boolean;
    exitosos: string[];
    fallidos: { key: string; error: string }[];
  }> {
    const archivosAEnviar = Object.keys(this.uploadedFiles)
      .filter((key) => (key in this.typeMap) && this.uploadedFiles[key]?.file)
      .map((key) => ({
        key,
        ...this.uploadedFiles[key],
        typeId: this.uploadedFiles[key]?.typeId ?? this.typeMap[key],
      }));

    if (archivosAEnviar.length === 0) {
      return { ok: true, exitosos: [], fallidos: [] };
    }

    const promesasDeSubida = archivosAEnviar.map(({ key, file, fileName, typeId }) =>
      new Promise<{ key: string }>((resolveSubida, rejectSubida) => {
        this.gestionDocumentalService
          // Sin el tipo, el backend asume CC y los documentos de un CE/PPT
          // quedarían en el expediente del titular CC con el mismo número.
          .guardarDocumento(fileName, this.cedula, typeId, file, this.codigoContratacion,
            String(this.candidato?.tipo_doc || '').trim() || undefined)
          .pipe(take(1))
          .subscribe({
            next: () => resolveSubida({ key }),
            error: (err) =>
              rejectSubida({
                key,
                error: err?.error?.message || err?.message || 'Error desconocido',
              }),
          });
      })
    );

    const results = await Promise.allSettled(promesasDeSubida);

    const exitosos: string[] = [];
    const fallidos: { key: string; error: string }[] = [];

    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        exitosos.push(r.value.key);
      } else {
        const info = r.reason as { key: string; error: string };
        fallidos.push({ key: info.key, error: info.error });
      }
    });

    // Si necesitas lógica extra cuando viene "Contrato", hazla aquí,
    // PERO asegura que al final siempre retornas.
    // const contratoIncluido = archivosAEnviar.some(a => a.key === 'Contrato' || a.typeId === this.typeMap['Contrato']);
    // if (contratoIncluido) { ...await algo... }

    return { ok: fallidos.length === 0, exitosos, fallidos };
  }

  /**
   * Punto de entrada para los documentos con 2 variantes (Contrato, Ficha Técnica).
   * La UI llama a este método desde un mat-menu pasando la variante elegida por el
   * usuario. La regla "última gana" se aplica automáticamente porque ambas variantes
   * comparten la misma entry en `uploadedFiles`.
   */
  /**
   * Biometría que la persona YA tiene cargada en el servidor.
   *
   * Se lee de lo que `ngOnInit` dejó en `firma`/`huella`/`foto`, que sale de
   * `biometria.{firma,huella,foto}.file_url` (así lo expone
   * `DocumentacionBiometricaSerializer`). Vacío = no está cargada.
   */
  private biometriaFaltante(): string[] {
    const tiene = (v: any) => typeof v === 'string' && v.trim() !== '';
    const falta: string[] = [];
    if (!tiene(this.firma)) falta.push('Firma');
    if (!tiene(this.huella)) falta.push('Huella');
    if (!tiene(this.foto)) falta.push('Foto');
    return falta;
  }

  /**
   * URL utilizable de un documento biométrico, venga como venga.
   *
   * `DocumentacionBiometricaSerializer` expone cada pieza con
   * `DocumentSerializer`, cuyo `file_url` sale de la versión marcada
   * `is_current`. Si un expediente se quedó sin versión vigente, `file_url`
   * llega `null` aunque el archivo exista, así que se aceptan también las
   * otras formas en que el backend ha expuesto el archivo.
   */
  private bioUrl(doc: any): string {
    const v =
      doc?.file_url
      ?? doc?.file
      ?? doc?.current_file?.url
      ?? doc?.current_version?.file_url
      ?? '';
    return typeof v === 'string' ? v.trim() : '';
  }

  /**
   * Biometría consultada por PERSONA, no por fila de Candidato.
   *
   * `candidatos/by-document` resuelve entre TODAS las variantes de la cédula
   * (`<ced>`, `X<ced>`) y devuelve la fila más "viva"; en cambio la subida de
   * biometría usa `Candidato.resolve_by_documento`, que sólo mira el número
   * exacto. Con cédula duplicada las dos rutas pueden caer en filas distintas
   * y la firma/huella queda colgando de la que este componente NO cargó: el
   * operador la ve capturada y aquí salía "FALTA".
   *
   * `GET /biometria/<cedula>` usa el mismo resolutor que la subida, así que
   * es la fuente que sí ve lo que el operador acaba de capturar.
   */
  private async getBiometriaPersona(cedula: string | number): Promise<any> {
    const doc = String(cedula ?? '').trim();
    if (!doc) return null;
    return firstValueFrom(
      this.registroProcesoContratacion
        .getBiometriaPorCedula(doc)
        .pipe(take(1), catchError(() => of(null)))
    );
  }

  /**
   * Rellena los huecos de `firma`/`huella`/`foto` releyendo del servidor.
   *
   * Se llama justo antes de bloquear la generación por dos motivos:
   *  1) el componente carga la biometría una sola vez en `ngOnInit`, así que
   *     lo capturado después (otra pestaña, otro operador) no se veía;
   *  2) resuelve el caso de la cédula duplicada descrito en
   *     `getBiometriaPersona`.
   *
   * Sólo rellena lo que está vacío: nunca pisa una URL que ya sirve.
   */
  private async completarBiometriaDesdeServidor(): Promise<void> {
    if (!this.biometriaFaltante().length) return;

    const bio = await this.getBiometriaPersona(this.cedula);
    if (!bio) return;

    const antesFoto = this.foto;
    if (!this.firma) this.firma = this.bioUrl(bio?.firma);
    if (!this.huella) this.huella = this.bioUrl(bio?.huella);
    if (!this.foto) this.foto = this.bioUrl(bio?.foto);

    if (this.foto && this.foto !== antesFoto) {
      this.rotacionFoto.set(0);
      await this.refrescarPreviewFoto();
    }
    this.cdr.markForCheck();
  }

  /**
   * Bloquea la generación si a la persona le falta firma, huella o foto.
   *
   * Antes solo avisaba y dejaba "Generar de todas formas", pero los documentos
   * salían con los recuadros en blanco y tocaba reimprimirlos: ahora la
   * biometría completa es requisito duro. Devuelve `true` solo si están las 3.
   */
  private async exigirBiometria(): Promise<boolean> {
    // Sin candidato cargado no hay nada que juzgar: el aviso sería falso.
    // Se mira si el objeto trae datos (arranca en `{}`) y no un campo puntual,
    // para no depender de qué serializer responda el endpoint.
    if (!this.candidato || Object.keys(this.candidato).length === 0) return true;

    // Antes de bloquear, releer del servidor: lo que se capturó después de
    // abrir esta pantalla —o lo que quedó en la otra fila de una cédula
    // duplicada— no estaba en el snapshot de `ngOnInit`.
    await this.completarBiometriaDesdeServidor();

    const falta = this.biometriaFaltante();
    if (!falta.length) return true;

    const nombre = [this.candidato?.primer_nombre, this.candidato?.primer_apellido]
      .filter(Boolean).join(' ').trim();

    // Una tarjeta por requisito con su estado, para que se vea de una qué
    // está cargado y qué es exactamente lo que falta.
    const filas = [
      { label: 'Firma', icono: '✍️' },
      { label: 'Huella', icono: '👆' },
      { label: 'Foto', icono: '📷' },
    ].map(({ label, icono }) => {
      const ok = !falta.includes(label);
      return (
        `<div style="display:flex;align-items:center;justify-content:space-between;` +
        `padding:10px 14px;border-radius:10px;margin-bottom:8px;` +
        `background:${ok ? '#f0fdf4' : '#fef2f2'};` +
        `border:1px solid ${ok ? '#bbf7d0' : '#fecaca'};">` +
        `<span style="font-weight:600;color:#111827;">${icono}&nbsp;&nbsp;${label}</span>` +
        `<span style="font-size:12px;font-weight:700;letter-spacing:.4px;` +
        `padding:3px 10px;border-radius:999px;` +
        `color:${ok ? '#166534' : '#b91c1c'};` +
        `background:${ok ? '#dcfce7' : '#fee2e2'};">` +
        `${ok ? '✓ CARGADA' : '✗ FALTA'}` +
        `</span></div>`
      );
    }).join('');

    await Swal.fire({
      icon: 'error',
      title: 'No se puede generar la documentación',
      html:
        `<p style="text-align:left;margin:0 0 12px;color:#374151;">` +
        (nombre ? `<b>${this.escapeHtml(nombre)}</b>` : 'La persona') +
        (this.cedula ? ` <span style="color:#6b7280;">(${this.escapeHtml(String(this.cedula))})</span>` : '') +
        ` no tiene la biometría completa:</p>` +
        filas +
        `<p style="text-align:left;margin:12px 0 0;font-size:13px;color:#6b7280;">` +
        `Los documentos se imprimen y se firman: sin firma, huella y foto salen ` +
        `incompletos. Captura lo que falta y vuelve a generar.</p>`,
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#111827',
      width: 460,
    });

    return false;
  }

  async generarPDFVariant(documento: string, variant: 'basica' | 'completa' | 'administrativo') {
    if (!await this.exigirBiometria()) return;

    if (documento === 'Contrato') {
      this.runContratoVariant(variant);
      return;
    }
    if (documento === 'Ficha Técnica') {
      // Ficha Técnica no tiene variante administrativa; se ignora silenciosamente
      // si llega por accidente desde un menú compartido.
      if (variant === 'administrativo') {
        Swal.fire('Atención', 'Ficha Técnica no tiene variante administrativa.', 'warning');
        return;
      }
      this.runFichaTecnicaVariant(variant);
      return;
    }
    Swal.fire('Error', 'Documento no soporta variantes: ' + documento, 'error');
  }

  /**
   * Despacha la variante de Contrato.
   *  - completa       → contrato Tu Alianza completo (no depende de empresa).
   *  - administrativo → contrato a término fijo inferior a un año, ramificado por
   *                     la temporal asociada a la vacante (Apoyo Laboral / Tu Alianza).
   *  - basica         → contrato por obra o labor (depende de empresa).
   */
  private async runContratoVariant(variant: 'basica' | 'completa' | 'administrativo'): Promise<void> {
    if (variant === 'completa') {
      await this.generarContratoCompletoTrabajoTuAlianza();
      return;
    }
    if (variant === 'administrativo') {
      await this.generarContratoAdministrativo();
      return;
    }
    if (!this.empresa || this.empresa.trim() === '') {
      Swal.fire('Atención', 'Selecciona el candidato, la empresa no está definida.', 'warning');
      return;
    }
    const plantilla = await this.elegirPlantillaApoyoAlianza('Contrato');
    if (!plantilla) return; // admin canceló el diálogo
    // Sin try/catch un throw dentro del generador (jsPDF es muy estricto con
    // valores null/undefined en doc.text) dejaba la UI sin PDF y SIN mensaje:
    // TesoroApp no registra un ErrorHandler global.
    try {
      if (plantilla === 'ALIANZA') {
        await this.generarContratoTrabajoTuAlianza();
      } else {
        await this.generarContratoTrabajo(plantilla);
      }
    } catch (e) {
      console.error('[contrato] fallo generando la variante básica', e);
      Swal.fire(
        'No se pudo generar el contrato',
        'Faltan datos del candidato o de la vacante. Revisa residencia, cargo y código de contratación.',
        'error'
      );
    }
  }

  /**
   * Genera el contrato a término fijo inferior a un año para personal administrativo
   * (empresa usuaria). La elección entre plantilla Apoyo Laboral / Tu Alianza se
   * hace con `this.empresa` (= `this.vacante.temporal`).
   *
   * El PDF queda almacenado en `uploadedFiles['Contrato']` para que comparta el
   * mismo flujo de subida/preview que el contrato por obra o labor.
   */
  generarContratoAdministrativo(): void {
    // Solo GERENCIA puede generar el contrato a término fijo (Administrativo).
    if (!this.esGerencia) {
      Swal.fire(
        'Acceso restringido',
        'Solo el rol GERENCIA puede generar el contrato a término fijo (Administrativo).',
        'warning'
      );
      return;
    }
    if (!this.empresa || this.empresa.trim() === '') {
      Swal.fire(
        'Atención',
        'Selecciona el candidato, la empresa (temporal) no está definida.',
        'warning'
      );
      return;
    }
    const emp = this.empresa.toUpperCase().trim();
    if (!emp.includes('APOYO') && !emp.includes('ALIANZA')) {
      Swal.fire(
        'Error',
        `Temporal no reconocida: "${this.empresa}". Solo APOYO LABORAL o TU ALIANZA.`,
        'error'
      );
      return;
    }

    try {
      const doc = buildContratoAdministrativoPdf({
        empresa: this.empresa,
        candidato: this.candidato,
        vacante: this.vacante,
        cedula: this.cedula,
        codigoContratacion: this.codigoContratacion ?? '',
        sede: this.sede,
        firmaTrabajadorBase64: this.firma ?? '',
        firmaAdministrativoBase64: this.firmaPersonalAdministrativo ?? '',
        user: this.user,
        nombreCompletoLogin: this.nombreCompletoLogin,
      });

      const pdfBlob = doc.output('blob');
      const fileName = `${this.empresa}_Contrato_Administrativo.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      this.uploadedFiles['Contrato'] = { file: pdfFile, fileName };
      this.verPDF({ titulo: 'Contrato' });
    } catch (e: any) {
      console.error('[generarContratoAdministrativo] error:', e);
      Swal.fire(
        'Error',
        e?.message || 'No se pudo generar el contrato administrativo.',
        'error'
      );
    }
  }

  /** Despacha la variante de Ficha Técnica. La Completa override el typeId a 111 al guardar. */
  private async runFichaTecnicaVariant(variant: 'basica' | 'completa'): Promise<void> {
    if (variant === 'completa') {
      await this.generarFichaTecnicaTuAlianzaCompleta();
      return;
    }
    if (!this.empresa || this.empresa.trim() === '') {
      Swal.fire('Atención', 'Selecciona el candidato, la empresa no está definida.', 'warning');
      return;
    }
    const plantilla = await this.elegirPlantillaApoyoAlianza('Ficha Técnica');
    if (!plantilla) return; // admin canceló el diálogo
    if (plantilla === 'ALIANZA') {
      await this.generarFichaTecnicaTuAlianza();
    } else {
      await this.generarFichaTecnica(plantilla);
    }
  }

  /**
   * Documentos exentos del requisito de biometría completa.
   *
   * Son autorizaciones que la persona firma a mano cuando se las entregan: no
   * llevan recuadro de huella ni de foto y la firma se inserta solo si existe
   * (`fetchAsArrayBufferOrNull` tolera que falte). Exigir firma+huella+foto
   * dejaba trabado al personal administrativo, que se contrata sin pasar por
   * la captura biométrica.
   */
  private static readonly DOCS_SIN_BIOMETRIA = new Set<string>([
    'Manejo Imagen',   // Acuerdo y autorización de uso de imagen
    'Sagaro Imagen',   // Acuerdo uso de imagen (Sagaro)
    'Sagaro Celular',  // Política de uso de celular, cámaras y dispositivos
    'Sagaro Lockers',  // Acta de entrega de locker
    'OTRO SI Sagaro Fumigador',
  ]);

  async generarPDF(documento: string): Promise<void> {
    // Biometría completa (firma, huella, foto) es requisito para generar,
    // salvo las autorizaciones de uso de imagen / celular y cámaras.
    if (!GenerateContractingDocumentsComponent.DOCS_SIN_BIOMETRIA.has(documento)
      && !await this.exigirBiometria()) return;

    // Contratos Otrosí no depende de la empresa
    if (documento === 'Contratos Otrosí') {
      await this.generarContratosOtroSi();
      return;
    }
    // Auxilio Alimentación no depende de la empresa
    if (documento === 'Auxilio Alimentación') {
      await this.generarAuxilioAlimentacion();
      return;
    }
    // Autorización Daños Pérdidas no depende de la empresa
    if (documento === 'Autorización Daños Pérdidas') {
      await this.generarAutorizacionDanosPerdidas();
      return;
    }
    // Hoja de Vida Minerva no depende de la empresa
    if (documento === 'Hoja de Vida Minerva') {
      await this.generarHojaDeVidaMinerva();
      return;
    }

    // Contrato y Ficha Técnica tienen 2 variantes (básica / TA Completa) y se
    // disparan desde un mat-menu vía `generarPDFVariant(...)`, no por aquí.

    if (!this.empresa || this.empresa.trim() === '') {
      Swal.fire('Atención', 'Selecciona el candidato, la empresa no está definida.', 'warning');
      return;
    }

    const emp = this.empresa.toUpperCase().trim();

    if (documento === 'Autorización de Datos') {
      await this.generarAutorizacionDatos();
    }
    else if (documento === 'Inducción') {
      if (emp.includes('APOYO LINEA')) {
        await this.generarEntregaDocsApoyo();
      } else if (emp.includes('APOYO')) {
        await this.generarEntregaDocsApoyo();
      } else {
        Swal.fire('Atención', 'Falta seleccionar la remisión o la empresa no aplica para este documento', 'info');
      }
    }
    else if (documento === 'Inducción Agrícola') {
      await this.generarEntregaDocsAgricola();
    }
    else if (documento === 'Inducción Jardines de los Andes') {
      await this.generarEntregaDocsJardinez();
    }
    else if (documento === 'Inducción Sagaro') {
      await this.generarEntregaDocsTuAlianzaSAGARO();
    }
    else if (documento === 'Inducción Flores de los Andes') {
      await this.generarEntregaDocsTuAlianzaFloresAndes();
    }
    else if (documento === 'Inducción Ipanema') {
      await this.generarEntregaDocsTuAlianzaIpanema();
    }
    else if (documento === 'Inducción Ipanema Foráneos') {
      await this.generarEntregaDocsTuAlianzaIpanemaForaneos();
    }
    else if (documento === 'Inducción Rebaño') {
      await this.generarEntregaDocsTuAlianzaRebano();
    }
    else if (documento === 'Inducción Melody') {
      await this.generarEntregaDocsTuAlianzaMelody();
    }
    else if (documento === 'Inducción Tu Alianza sin Casino') {
      await this.generarEntregaDocsTuAlianzaSinCasino();
    }
    else if (documento === 'Inducción Administrativos') {
      await this.generarEntregaDocsTuAlianzaAdministrativos();
    }
    else if (documento === 'Entrega Carnets') {
      await this.generarEntregaCarnets();
    }
    else if (documento === 'Inducción Capacitación') {
      await this.generarInduccionCapacitacion();
    }
    else if (documento === 'Formato Solicitud') {
      await this.generarFormatoSolicitud();
    }
    else if (documento === 'Manejo Imagen') {
      await this.generarManejoImagen();
    }
    else if (documento === 'Ficha Social') {
      await this.generarFichaSocial();
    }
    else if (documento === 'Entrevista de Ingreso Tu Alianza') {
      await this.generarEntrevistaDeIngresoTuAlianza();
    }
    else if (documento === 'Contratos Otrosí') {
      await this.generarContratosOtroSi();
    }
    else if (documento === 'Sagaro Lockers') {
      await this.generarSagaroLockers();
    }
    else if (documento === 'Sagaro Celular') {
      await this.generarSagaroCelular();
    }
    else if (documento === 'Sagaro Imagen') {
      await this.generarSagaroImagen();
    }
    else if (documento === 'Carnet') {
      await this.generarCarnet();
    }
    else if (documento === 'OTRO SI Jornada Laboral') {
      await this.generarOtroSiJornadaLaboral();
    }
    else if (documento === 'OTRO SI Sagaro Fumigador') {
      await this.generarOtroSiSagaroFumigador();
    }
    else if (documento === 'Carta Descuento de Flor') {
      await this.generarCartaDescuentoFlor();
    }
    else if (documento === 'Formato Timbre Ingreso/Salida') {
      await this.generarFormatoTimbre();
    }
    else if (documento === 'Carta Autorización Correo Electrónico') {
      await this.generarCartaAutorizacionCorreo();
    }
    else {
      Swal.fire('Error', 'Funcionalidad de PDF no implementada para: ' + documento, 'error');
    }
  }

  /**
   * Recorta la imagen (centrada) a la proporción pedida y la devuelve como
   * dataURL JPEG.
   *
   * Se usa para que la foto llene el recuadro de la ficha técnica. Ahí no se
   * puede dibujar sobre la página como en la Minerva: el campo es un botón
   * cuyo widget se pinta ENCIMA y tapaba la foto, dejando el recuadro en
   * blanco. `setImage` sí pinta dentro del botón, pero siempre respeta la
   * proporción de la imagen; si la proporción ya coincide con la del campo,
   * no queda aire alrededor.
   */
  // ───────── Giro manual de la foto ─────────
  /**
   * Grados que el usuario pidió girar la foto, además del enderezado
   * automático. El EXIF a veces viene mal o ausente y la heurística de
   * "más ancha que alta" no alcanza; con esto se corrige a mano y sale igual
   * en TODOS los documentos (ficha, hoja de vida y carnet).
   *
   * No se persiste: es por candidato abierto. Se reinicia al cambiar de persona.
   */
  readonly rotacionFoto = signal(0);

  /** Miniatura ya girada, para ver cómo va a salir antes de generar. */
  readonly fotoPreview = signal<string | null>(null);

  /** Cada clic suma 90°. A los 360 vuelve al original. */
  async girarFoto(): Promise<void> {
    this.rotacionFoto.set((this.rotacionFoto() + 90) % 360);
    await this.refrescarPreviewFoto();
  }

  async refrescarPreviewFoto(): Promise<void> {
    this.fotoPreview.set(this.foto ? await this.fotoAlDerechoDataUrl(this.foto) : null);
    this.cdr.markForCheck();
  }

  /**
   * Deja la foto del candidato "al derecho" y siempre vertical.
   *
   * La foto se toma con la cámara y llega apaisada: la rotación viaja solo como
   * metadato EXIF. Ni `pdf-lib` (`embedJpg` copia los bytes tal cual) ni un
   * `createImageBitmap` sin `imageOrientation` miran ese metadato, así que la
   * foto salía acostada en la ficha técnica y en la hoja de vida Minerva.
   *
   * Dos pasos, en este orden:
   *   1. Decodifica con `imageOrientation: 'from-image'` → aplica el EXIF.
   *   2. Si aun así queda más ancha que alta, la gira 90° en sentido horario.
   *
   * El giro es horario en TODOS los documentos a propósito: es el mismo que ya
   * usaba la ficha técnica Tu Alianza Completa, así que la foto sale en la
   * misma dirección en los tres formatos.
   *
   * Devuelve JPEG, o null si algo falla (el llamador se queda con el original).
   */
  private async fotoAlDerecho(bytes: ArrayBuffer): Promise<Blob | null> {
    try {
      const blob = new Blob([bytes]);

      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch {
        // Navegadores sin soporte de imageOrientation: al menos se endereza
        // lo que se pueda con el giro por proporción.
        bitmap = await createImageBitmap(blob).catch(() => null);
      }
      if (!bitmap) return null;

      // Giro total = enderezado automático (90° si viene apaisada) + el giro
      // manual que el usuario haya pedido con el botón. El manual se suma, no
      // reemplaza: así cada clic gira 90° más respecto a lo que se está viendo.
      const auto = bitmap.width > bitmap.height ? 90 : 0;
      const grados = ((auto + this.rotacionFoto()) % 360 + 360) % 360;
      const deLado = grados === 90 || grados === 270;

      const canvas = document.createElement('canvas');
      canvas.width = deLado ? bitmap.height : bitmap.width;
      canvas.height = deLado ? bitmap.width : bitmap.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) { bitmap.close?.(); return null; }

      // Se traslada al vértice que queda arriba-izquierda después del giro,
      // para dibujar siempre desde (0,0) sin recortar nada.
      if (grados === 90) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
      } else if (grados === 180) {
        ctx.translate(canvas.width, canvas.height);
        ctx.rotate(Math.PI);
      } else if (grados === 270) {
        ctx.translate(0, canvas.height);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      return await new Promise<Blob | null>(resolve => {
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92);
      });
    } catch (e) {
      console.warn('[foto] no se pudo corregir la orientación:', e);
      return null;
    }
  }

  /** Igual que `fotoAlDerecho`, para las rutas que embeben bytes (pdf-lib). */
  private async fotoAlDerechoBytes(bytes: ArrayBuffer): Promise<Uint8Array | null> {
    const blob = await this.fotoAlDerecho(bytes);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  /** Igual que `fotoAlDerecho`, para las rutas que reciben una URL/dataURL. */
  private async fotoAlDerechoDataUrl(url?: string): Promise<string | null> {
    if (!url) return null;
    const bytes = await this.fetchAsArrayBufferOrNull(url);
    if (!bytes) return null;
    const blob = await this.fotoAlDerecho(bytes);
    if (!blob) return null;
    return await new Promise<string | null>(resolve => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(String(fr.result || '') || null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  }

  private async recortarAlAspecto(url: string, aspecto: number): Promise<string | null> {
    try {
      const bytes = await this.fetchAsArrayBufferOrNull(url);
      if (!bytes || !isFinite(aspecto) || aspecto <= 0) return null;

      // Primero se endereza (EXIF + vertical) y después se recorta: recortar
      // sobre la foto acostada dejaba el encuadre girado dentro del recuadro.
      const enderezada = await this.fotoAlDerecho(bytes);
      const bitmap = await createImageBitmap(enderezada ?? new Blob([bytes]));
      const actual = bitmap.width / bitmap.height;

      let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
      if (actual > aspecto) {
        sw = bitmap.height * aspecto;      // sobra ancho: se recorta a los lados
        sx = (bitmap.width - sw) / 2;
      } else if (actual < aspecto) {
        sh = bitmap.width / aspecto;       // sobra alto: se recorta arriba y abajo
        sy = (bitmap.height - sh) / 2;
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      console.warn('[pdf] no se pudo recortar la imagen:', e);
      return null;
    }
  }

  /**
   * Inyecta una imagen en un campo /Btn del AcroForm.
   *
   * `minerva.pdf` tiene dos botones de imagen: `CampoImagen1` (foto del
   * candidato, rect ~90x120 pt) y `CampoImagen2` (firma). El nombre completo
   * incluye la página (`topmostSubform[0].PageN[0]...`), por eso se recibe una
   * lista de candidatos y se usa el primero que exista en el formulario.
   *
   * @returns true si la imagen quedó puesta.
   */
  private async inyectarImagenEnCampoPdf(
    pdfDoc: any,
    form: any,
    url: string,
    nombresCandidatos: string[],
    /**
     * 'contener' → la imagen cabe entera dentro del rect (deja aire alrededor).
     * 'cubrir'   → llena el rect recortando el sobrante, y pinta fondo blanco
     *              antes para tapar lo que la plantilla trae impreso dentro del
     *              recuadro ("FOTOGRAFÍA RECIENTE / Clic aquí para cargar").
     */
    modo: 'contener' | 'cubrir' = 'contener',
    /**
     * `alDerecho` solo para la FOTO del candidato: aplica el EXIF y la deja
     * vertical. No se activa para la firma, que es apaisada por naturaleza y
     * girarla la dejaría de lado.
     */
    opts?: { alDerecho?: boolean },
  ): Promise<boolean> {
    if (!url) return false;

    const bytes = await this.fetchAsArrayBufferOrNull(url);
    if (!bytes) return false;

    let u8 = new Uint8Array(bytes) as any;
    if (opts?.alDerecho) {
      // Sale JPEG, así que la detección de formato de abajo va después.
      const enderezada = await this.fotoAlDerechoBytes(bytes);
      if (enderezada) u8 = enderezada as any;
    }
    // 0xFF D8 = JPEG; 0x89 'P' 'N' 'G' = PNG.
    const isJpg = u8[0] === 0xFF && u8[1] === 0xD8;
    const img = isJpg ? await pdfDoc.embedJpg(u8) : await pdfDoc.embedPng(u8);

    // Primer nombre que exista de verdad en el formulario.
    let campo: any = null;
    let nombreUsado = '';
    for (const n of nombresCandidatos) {
      try {
        campo = form.getField(n);
        nombreUsado = n;
        break;
      } catch { /* siguiente candidato */ }
    }
    if (!campo) {
      console.warn('[pdf] ningún campo de imagen encontrado entre:', nombresCandidatos);
      return false;
    }

    // Siempre dibujada sobre la PÁGINA, nunca con `setImage`: como apariencia
    // del widget la imagen desaparece al copiar estas páginas a otro PDF.
    // El helper también quita el widget y respeta ambos modos.
    return dibujarImagenPlana(pdfDoc, form, nombreUsado, img, modo);
  }

  // --- Hoja de Vida Minerva ---
  async generarHojaDeVidaMinerva() {
    const cand = this.candidato;
    if (!cand?.numero_documento) {
      Swal.fire('Error', 'No se encontró el candidato. Seleccione uno primero.', 'error');
      return;
    }

    try {
      const pdfUrl = 'Docs/minerva.pdf';
      const arrayBuffer = await this.fetchAsArrayBufferOrNull(pdfUrl);
      if (!arrayBuffer) {
        Swal.fire('Error', 'No se encontró el formato minerva.pdf en el servidor.', 'error');
        return;
      }
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      pdfDoc.registerFontkit(fontkit as unknown as any);
      const fontBytes = await this.fetchAsArrayBufferOrNull('fonts/Roboto-Regular.ttf');
      if (!fontBytes) {
        Swal.fire('Error', 'No se pudo cargar la fuente Roboto.', 'error');
        return;
      }
      const customFont = await pdfDoc.embedFont(fontBytes);
      const form = pdfDoc.getForm();

      // Llenado completo de los 4 páginas (mapping en minerva-fill.ts).
      fillMinervaPdf(pdfDoc, form, customFont, cand, this.vacante);

      // Firma del solicitante → CampoImagen2 (página 4).
      try {
        if (this.firma) {
          await this.inyectarImagenEnCampoPdf(pdfDoc, form, this.firma, [
            'topmostSubform[0].Page4[0].CampoImagen2[0]',
          ]);
        }
      } catch (e) {
        console.error('Error inyectando firma en Hoja de Vida Minerva:', e);
      }

      // Foto del candidato → CampoImagen1. La plantilla tiene el recuadro
      // (rect ~90x120 pt) pero NUNCA se llenaba: solo se inyectaba la firma,
      // por eso la hoja de vida salía sin foto.
      try {
        if (this.foto) {
          const ok = await this.inyectarImagenEnCampoPdf(pdfDoc, form, this.foto, [
            'topmostSubform[0].Page1[0].CampoImagen1[0]',
            'topmostSubform[0].Page2[0].CampoImagen1[0]',
            'topmostSubform[0].Page3[0].CampoImagen1[0]',
            'topmostSubform[0].Page4[0].CampoImagen1[0]',
          ], 'cubrir', { alDerecho: true });
          if (!ok) console.warn('[minerva] no se pudo colocar la foto del candidato');
        } else {
          console.warn('[minerva] el candidato no tiene foto biométrica cargada');
        }
      } catch (e) {
        console.error('Error inyectando foto en Hoja de Vida Minerva:', e);
      }

      // Bloquear campos
      aplanarFormulario(form);

      // Guardar y agregar marca de agua
      const pdfBytes = await pdfDoc.save();
      const watermarkedBytes = await this.addWatermarkHV(pdfBytes as unknown as Uint8Array);

      // Crear File para subir
      const normalizeText = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const sCand = (v: any) => String(v ?? '').trim();
      const fileName = `Minerva-${normalizeText(sCand(cand.primer_apellido))}-${normalizeText(sCand(cand.primer_nombre))}.pdf`;
      const blob = new Blob([watermarkedBytes as BlobPart], { type: 'application/pdf' });
      const file = new File([blob], fileName, { type: 'application/pdf' });

      // Guardar en uploadedFiles para subir con cargarpdf()
      this.uploadedFiles['Hoja de Vida Minerva'] = { file, fileName };

      // Preview
      const blobUrl = URL.createObjectURL(blob);
      this.setPdfPreview(blobUrl);

      Swal.fire({ icon: 'success', title: 'Hoja de Vida generada', text: 'Se generó y está lista para subir.', timer: 2000, showConfirmButton: false });
    } catch (error) {
      console.error('Error generando Hoja de Vida Minerva:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar la Hoja de Vida.' });
    }
  }

  /** Agrega marca de agua "TUAPO HV GENERADA" al PDF */
  private async addWatermarkHV(pdfBytes: Uint8Array): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    for (const page of pdfDoc.getPages()) {
      const { width, height } = page.getSize();
      page.drawText('TUAPO HV GENERADA', {
        x: width / 2 - 230,
        y: height / 2 - 250,
        size: 62,
        font: helveticaFont,
        color: rgb(152 / 255, 227 / 255, 57 / 255),
        opacity: 0.2,
        rotate: degrees(45),
      });
    }
    return await pdfDoc.save();
  }

  // --- Entrevista de Ingreso ---
  async generarSagaroLockers() {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginLeft = 20;
      const marginRigth = 20;
      const maxWidth = pageWidth - marginLeft - marginRigth;

      const cand = this.candidato ?? {};
      const numIdentificacion = String(cand.numero_documento ?? '').trim();

      const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ').toUpperCase();
      const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ').toUpperCase();
      const nombreCompleto = `${nombres} ${apellidos}`.trim();

      let cargo = '';
      if (this.vacante?.cargo?.nombre_cargo_empresa) cargo = this.vacante.cargo.nombre_cargo_empresa;
      else if (this.vacante?._id_cargo?.nombre_cargo_empresa) cargo = this.vacante._id_cargo.nombre_cargo_empresa;
      else if (this.vacante?.cargo?.nombre_cargo) cargo = this.vacante.cargo.nombre_cargo;
      else if (this.vacante?.nombre_cargo) cargo = this.vacante.nombre_cargo;
      else if (typeof this.vacante?.cargo === 'string') cargo = this.vacante.cargo;
      cargo = String(cargo).toUpperCase();

      doc.setProperties({ title: `108_SAGARO_LOCKERS_${numIdentificacion}.pdf` });

      let currentY = 30;

      // Titulo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('CONSENTIMIENTO INFORMADO', pageWidth / 2, currentY, { align: 'center' });
      currentY += 8;
      doc.text('AUTORIZACIÓN PARA INSPECCIÓN DE LOCKERS Y ELEMENTOS', pageWidth / 2, currentY, { align: 'center' });
      currentY += 6;
      doc.text('PERSONALES', pageWidth / 2, currentY, { align: 'center' });
      currentY += 15;

      // Párrafos
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);

      const p1 = `En mi condición de trabajador(a) de FLORES SAGARO S.A., mediante el presente documento manifiesto libre y espontáneamente mi consentimiento informado y autorización expresa para la implementación de mecanismos de inspección de lockers y elementos personales, conforme a las políticas corporativas del empleador y el Reglamento Interno de Trabajo, bajo los siguientes términos:`;
      const p1Lines = doc.splitTextToSize(p1, maxWidth);
      doc.text(p1Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p1Lines.length * 5) + 5;

      const p2 = `1. Declaro que otorgo este consentimiento de manera libre, voluntaria e informada para participar en la implementación de medidas de seguridad, prevención y control establecidas por el empleador. En consecuencia, exonero al empleador de responsabilidad civil derivada del uso adecuado y legal de dichos mecanismos.`;
      const p2Lines = doc.splitTextToSize(p2, maxWidth);
      doc.text(p2Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p2Lines.length * 5);

      const p3 = `2. Autorizo al empleador, como mecanismo de seguridad, prevención y/o control, a realizar inspecciones en los lockers y/o elementos personales ubicados dentro de las instalaciones de la empresa cuando existan razones objetivas relacionadas con:`;
      const p3Lines = doc.splitTextToSize(p3, maxWidth);
      doc.text(p3Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p3Lines.length * 5);

      const p4 = `   1. protección de los bienes de la empresa,`;
      doc.text(p4, marginLeft, currentY); currentY += 5;
      const p5 = `   2. seguridad de los trabajadores, o`;
      doc.text(p5, marginLeft, currentY); currentY += 5;
      const p6 = `   3. verificación del cumplimiento de obligaciones laborales.`;
      doc.text(p6, marginLeft, currentY); currentY += 8;

      const p7 = `Estas inspecciones se realizarán de manera proporcional, razonable, necesaria y basada en criterios previamente definidos.`;
      const p7Lines = doc.splitTextToSize(p7, maxWidth);
      doc.text(p7Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p7Lines.length * 5) + 5;

      const p8 = `3. Las inspecciones no requieren previo aviso; sin embargo, se garantiza que el trabajador estará presente durante su realización, para salvaguardar sus derechos y evitar cualquier actuación arbitraria.`;
      const p8Lines = doc.splitTextToSize(p8, maxWidth);
      doc.text(p8Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p8Lines.length * 5);

      const p9 = `4. Se informa que la negativa injustificada a participar en las medidas de seguridad, prevención y/o control podrá considerarse como falta grave, conforme al Reglamento Interno de Trabajo y demás normatividad aplicable.`;
      const p9Lines = doc.splitTextToSize(p9, maxWidth);
      doc.text(p9Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p9Lines.length * 5);

      const p10 = `5. Declaro que mis derechos a la intimidad, integridad personal, libre desarrollo de la personalidad, igualdad, debido proceso, defensa y trato digno han sido y serán plenamente respetados por la compañía.`;
      const p10Lines = doc.splitTextToSize(p10, maxWidth);
      doc.text(p10Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p10Lines.length * 5);

      const p11 = `6. En caso de que durante una inspección se acceda incidentalmente a información o elementos que contengan datos personales, FLORES SAGARO S.A. garantiza el cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013, especialmente en lo relacionado con el uso, custodia y confidencialidad de dichos datos.`;
      const p11Lines = doc.splitTextToSize(p11, maxWidth);
      doc.text(p11Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p11Lines.length * 5) + 8;

      const fechaDelContrato = this.getFechaContrato();
      const dia = fechaDelContrato.getDate().toString();
      const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const mes = meses[fechaDelContrato.getMonth()];
      const yearStr = fechaDelContrato.getFullYear().toString();
      const lastDigit = yearStr.substring(3, 4);

      const fechaText = `En constancia se firma a los  ${dia}  días del mes de  ${mes}  de 202 ${lastDigit} .`;
      doc.text(fechaText, marginLeft, currentY);
      currentY += 15;

      doc.setFont('helvetica', 'bold');
      doc.text('NOMBRE:', marginLeft, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(nombreCompleto, marginLeft + 25, currentY);
      currentY += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('CARGO:', marginLeft, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(cargo, marginLeft + 25, currentY);
      currentY += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('CÉDULA:', marginLeft, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(numIdentificacion, marginLeft + 25, currentY);
      currentY += 12;

      doc.setFont('helvetica', 'bold');
      doc.text('FIRMA:', marginLeft, currentY);
      // Signature will be drawn above FIRMA if it responds
      const fetchAsArrayBufferOrNull = async (url: any) => {
        if (!url) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.arrayBuffer();
        } catch {
          return null;
        }
      };

      const firmaCand = await fetchAsArrayBufferOrNull(cand?.biometria?.firma?.file_url ?? this.firma);
      if (firmaCand) {
        try {
          const kind = (new Uint8Array(firmaCand)[0] === 0xFF) ? 'JPEG' : 'PNG';
          // Use currentY - 15 so signature sits on top of FIRMA
          doc.addImage(new Uint8Array(firmaCand), kind, marginLeft + 20, currentY - 12, 35, 20);
        } catch (e) { console.error('Error insertando firma candidato Sagaro Lockers', e); }
      }

      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], '108_SAGARO_LOCKERS.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Sagaro Lockers'] = { file, fileName: '108_SAGARO_LOCKERS.pdf' };
      this.verPDF({ titulo: 'Sagaro Lockers' });

    } catch (error) {
      console.error('Error generando Sagaro Lockers:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el PDF de Sagaro Lockers' });
    }
  }

  async generarSagaroCelular() {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginLeft = 20;
      const marginRigth = 20;
      const maxWidth = pageWidth - marginLeft - marginRigth;

      const cand = this.candidato ?? {};
      const numIdentificacion = String(cand.numero_documento ?? '').trim();

      const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ').toUpperCase();
      const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ').toUpperCase();
      const nombreCompleto = `${nombres} ${apellidos}`.trim();

      let cargo = '';
      if (this.vacante?.cargo?.nombre_cargo_empresa) cargo = this.vacante.cargo.nombre_cargo_empresa;
      else if (this.vacante?._id_cargo?.nombre_cargo_empresa) cargo = this.vacante._id_cargo.nombre_cargo_empresa;
      else if (this.vacante?.cargo?.nombre_cargo) cargo = this.vacante.cargo.nombre_cargo;
      else if (this.vacante?.nombre_cargo) cargo = this.vacante.nombre_cargo;
      else if (typeof this.vacante?.cargo === 'string') cargo = this.vacante.cargo;
      cargo = String(cargo).toUpperCase();

      doc.setProperties({ title: `110_SAGARO_CELULAR_${numIdentificacion}.pdf` });

      let currentY = 20;

      // Titulo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('POLÍTICA INTERNA LINEAMIENTOS PARA EL USO DE CELULAR Y/O', pageWidth / 2, currentY, { align: 'center' });
      currentY += 6;
      doc.text('DISPOSITIVOS ELECTRÓNICOS PERSONALES', pageWidth / 2, currentY, { align: 'center' });
      currentY += 12;

      // Párrafos
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);

      const p1 = `FLORES SAGARO S.A. en cumplimiento de sus deberes de protección, prevención y control dentro del Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST), así como de lo establecido en el artículo 58 del Código Sustantivo del Trabajo, adopta la siguiente política interna sobre el uso de teléfonos celulares y/o electrónicos personales durante la jornada laboral y/o el desarrollo de actividades laborales, conforme a lo siguiente:`;
      const p1Lines = doc.splitTextToSize(p1, maxWidth);
      doc.text(p1Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p1Lines.length * 5) + 6;

      const p2 = `1. Durante la jornada laboral y en la ejecución de funciones asignadas, no está permitido el uso de teléfonos celulares, radios, audífonos, cámaras, relojes inteligentes u otros dispositivos electrónicos personales.`;
      const p2Lines = doc.splitTextToSize(p2, maxWidth - 5);
      doc.text(p2, marginLeft + 5, currentY, { maxWidth: maxWidth - 5, align: 'justify' });
      currentY += (p2Lines.length * 5) + 4;

      const p3 = `2. La utilización de dispositivos electrónicos personales durante la prestación del servicio puede generar distracciones, reducción del rendimiento laboral y riesgos de accidentalidad. De acuerdo con el artículo 58 numeral 1 del CST, el trabajador tiene la obligación de poner a disposición del empleador su capacidad de trabajo de forma efectiva y adecuada para la ejecución de sus funciones. Asimismo, conforme al SG-SST, el uso indebido de estos dispositivos se considera una práctica insegura que incrementa el riesgo de incidentes y accidentes laborales.`;
      const p3Lines = doc.splitTextToSize(p3, maxWidth - 5);
      doc.text(p3, marginLeft + 5, currentY, { maxWidth: maxWidth - 5, align: 'justify' });
      currentY += (p3Lines.length * 5) + 4;

      const p4 = `3. Los dispositivos electrónicos personales deberán permanecer guardados durante la jornada. Se permitirá su uso únicamente:`;
      const p4Lines = doc.splitTextToSize(p4, maxWidth - 5);
      doc.text(p4, marginLeft + 5, currentY, { maxWidth: maxWidth - 5, align: 'justify' });
      currentY += (p4Lines.length * 5) + 2;

      doc.setFont('helvetica', 'bold');
      doc.text('a. En horarios destinados a descanso', marginLeft + 10, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(' (pausas, refrigerio o almuerzo),', marginLeft + 73, currentY);
      currentY += 5;
      doc.text('siempre fuera de áreas peligrosas o zonas restringidas.', marginLeft + 15, currentY);
      currentY += 5;

      doc.setFont('helvetica', 'bold');
      doc.text('b. Por autorización expresa del jefe inmediato,', marginLeft + 10, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(' cuando existan', marginLeft + 91, currentY);
      currentY += 5;
      doc.text('situaciones de urgencia, fuerza mayor o asuntos personales de carácter', marginLeft + 15, currentY);
      currentY += 5;
      doc.text('inaplazable.', marginLeft + 15, currentY);
      currentY += 5;

      doc.setFont('helvetica', 'bold');
      doc.text('c. En casos de emergencia,', marginLeft + 10, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(' cuando el trabajador requiera comunicarse o', marginLeft + 56, currentY);
      currentY += 5;
      doc.text('informar una situación crítica.', marginLeft + 15, currentY);
      currentY += 6;

      const p5 = `En todo caso, los trabajadores deberán cumplir con los protocolos de seguridad establecidos por la empresa.`;
      const p5Lines = doc.splitTextToSize(p5, maxWidth);
      doc.text(p5Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p5Lines.length * 5) + 6;

      const p6 = `4. El incumplimiento de esta política constituye falta disciplinaria, la cual podrá ser calificada como falta grave cuando:`;
      const p6Lines = doc.splitTextToSize(p6, maxWidth - 5);
      doc.text(p6, marginLeft + 5, currentY, { maxWidth: maxWidth - 5, align: 'justify' });
      currentY += (p6Lines.length * 5) + 2;

      const bullets = [
        `• genere riesgo para el trabajador o para terceros;`,
        `• afecte la seguridad industrial;`,
        `• comprometa la productividad o la calidad del trabajo;`,
        `• implique desobediencia a órdenes legítimas;`,
        `• se realice en zonas críticas, de alto riesgo o prohibidas.`
      ];

      bullets.forEach(bullet => {
        doc.text(bullet, marginLeft + 5, currentY);
        currentY += 5;
      });
      currentY += 4;

      const p7 = `Cualquier proceso disciplinario se adelantará respetando el debido proceso (art. 29 Constitución Política) y lo dispuesto en el Reglamento Interno de Trabajo.`;
      const p7Lines = doc.splitTextToSize(p7, maxWidth);
      doc.text(p7Lines, marginLeft, currentY, { maxWidth, align: 'justify' });

      doc.addPage();
      currentY = 20;

      const p8pt1 = `5. Las directrices establecidas en este documento aplican para los trabajadores asignados a las áreas de: ____________________________________________________, sin perjuicio de actualizaciones o modificaciones posteriores, las cuales serán comunicadas de manera previa, escrita y oportuna por parte de la empresa.`;
      const p8Lines = doc.splitTextToSize(p8pt1, maxWidth - 5);
      doc.text(p8pt1, marginLeft + 5, currentY, { maxWidth: maxWidth - 5, align: 'justify' });
      currentY += (p8Lines.length * 5) + 6;

      const p9 = `Esta política se entiende conocida y aceptada desde el momento de su socialización, firma de recibido o publicación en los medios institucionales establecidos por la compañía.`;
      const p9Lines = doc.splitTextToSize(p9, maxWidth);
      doc.text(p9Lines, marginLeft, currentY, { maxWidth, align: 'justify' });
      currentY += (p9Lines.length * 5) + 20;

      doc.setFont('helvetica', 'bold');
      doc.text('_________________________________', marginLeft, currentY);
      currentY += 5;
      doc.text('FLORES SAGARO S.A.', marginLeft, currentY);
      currentY += 10;

      doc.text('NOMBRE:', marginLeft, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(nombreCompleto, marginLeft + 25, currentY);
      currentY += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('CÉDULA:', marginLeft, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(numIdentificacion, marginLeft + 25, currentY);
      currentY += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('CARGO:', marginLeft, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(cargo, marginLeft + 25, currentY);
      currentY += 12;

      doc.setFont('helvetica', 'bold');
      doc.text('FIRMA:', marginLeft, currentY);
      // Signature will be drawn above FIRMA if it responds
      const fetchAsArrayBufferOrNull = async (url: any) => {
        if (!url) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.arrayBuffer();
        } catch {
          return null;
        }
      };

      const firmaCand = await fetchAsArrayBufferOrNull(cand?.biometria?.firma?.file_url ?? this.firma);
      if (firmaCand) {
        try {
          const kind = (new Uint8Array(firmaCand)[0] === 0xFF) ? 'JPEG' : 'PNG';
          doc.addImage(new Uint8Array(firmaCand), kind, marginLeft + 20, currentY - 12, 35, 20);
        } catch (e) { console.error('Error insertando firma candidato Sagaro Celular', e); }
      }

      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], '110_SAGARO_CELULAR.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Sagaro Celular'] = { file, fileName: '110_SAGARO_CELULAR.pdf' };
      this.verPDF({ titulo: 'Sagaro Celular' });

    } catch (error) {
      console.error('Error generando Sagaro Celular:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el PDF de Sagaro Celular' });
    }
  }

  // --- Entrevista de Ingreso Tu Alianza (formato TA SE-RE-2) ---
  async generarEntrevistaDeIngresoTuAlianza() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};
      const refFamiliarArr: any[] = cand.referencias?.filter((r: any) => r.tipo === 'FAMILIAR1' || r.tipo === 'FAMILIAR2') || [];

      // Extracción de datos Personales
      const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ').toUpperCase();
      const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ').toUpperCase();
      const nombreCompleto = `${apellidos} ${nombres}`.trim();

      const numIdentificacion = String(cand.numero_documento ?? '').trim();
      const estadoCivil = String(cand.estado_civil ?? '').toUpperCase();
      const calcEdadLocal = (fNac: any): string => {
        if (!fNac) return '';
        const dob = new Date(fNac);
        if (isNaN(dob.getTime())) return '';
        const diffMS = Date.now() - dob.getTime();
        const ageDT = new Date(diffMS);
        return String(Math.abs(ageDT.getUTCFullYear() - 1970));
      };

      const fmtFechaLocal = (f: any): string => {
        if (!f) return '';
        // "YYYY-MM-DD" a secas se parsea como medianoche UTC: en Bogotá
        // (UTC-5) getDate() devolvía el día ANTERIOR y el documento salía
        // con nacimiento/expedición corridos un día.
        const s = String(f).slice(0, 10);
        const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(f);
        if (isNaN(d.getTime())) return String(f);
        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
      };

      const fechaExpedicion = cand.info_cc?.fecha_expedicion ? fmtFechaLocal(cand.info_cc?.fecha_expedicion) : '';
      const lugarExpedicion = [cand.info_cc?.mpio_expedicion, cand.info_cc?.depto_expedicion].filter(Boolean).join(' - ').toUpperCase();
      const fechaNacimiento = cand.fecha_nacimiento ? fmtFechaLocal(cand.fecha_nacimiento) : '';
      const lugarNacimiento = [cand.info_cc?.mpio_nacimiento, cand.info_cc?.depto_nacimiento].filter(Boolean).join(' - ').toUpperCase();

      const edadStr = calcEdadLocal(cand.fecha_nacimiento);
      const genero = cand.sexo === 'Masculino' ? 'M' : (cand.sexo === 'Femenino' ? 'F' : String(cand.sexo || ''));
      const celular = cand.contacto?.celular || cand.numCelular || cand.telefono || '';

      const ent0 = cand.entrevistas?.[0] || {};
      const antecedentes = ent0.proceso?.antecedentes || [];
      const epsObj = antecedentes.find((a: any) => a.nombre?.toUpperCase() === 'EPS');
      const eps = epsObj ? String(epsObj.observacion).toUpperCase() : '';

      const email = String(cand.contacto?.email || cand.correo_electronico || '').toUpperCase();
      const noWhatsapp = celular; // "no whatsapp es el mismo numero de celular"
      const whaStr = cand.contacto?.whatsapp || celular;
      const direccion = String(cand.residencia?.direccion ?? '').toUpperCase();
      const barrio = String(cand.residencia?.barrio ?? '').toUpperCase();
      const ciudad = String(cand.municipio ?? cand.residencia?.municipio ?? cand.info_cc?.mpio_expedicion ?? '').toUpperCase();

      // Familiar
      const haceCuantoVive = String(cand.residencia?.hace_cuanto_vive ?? '').toUpperCase();
      const tipoVivienda = String(cand.vivienda?.tipo_vivienda ?? '').toUpperCase();
      const conQuienVive = String(cand.vivienda?.personas_con_quien_convive ?? '').toUpperCase();
      const laViviendaEs = String(cand.vivienda?.caracteristicas_vivienda ?? '').toUpperCase(); // O similar si aplica
      const cantidadHijos = cand.hijos?.length?.toString() || '0';
      const edadesHijos = Array.isArray(cand.hijos) ? cand.hijos.map((h: any) => calcEdadLocal(h.fecha_nac)).join(', ') : '';
      const cuidaHijos = String(cand.vivienda?.responsable_hijos ?? '').toUpperCase();

      const evalCand = cand.evaluacion || {};
      const relacionFamiliar = String(evalCand.relacion_familiar ?? '').toUpperCase();
      const motivacion = String(ent0.como_se_proyecta ?? '').toUpperCase();

      // Academica y Laboral
      const formaciones = cand.formaciones || [];
      const formacion = formaciones.length > 0 ? formaciones[0] : {};
      const nivelAcademico = String(formacion.nivel ?? formacion.nivel_educativo ?? '').toUpperCase();
      const estudiaActualmente = cand.vivienda?.estudia_actualmente ? 'SI' : 'NO';
      const nombreInst = String(formacion.institucion ?? '').toUpperCase();
      const anioFin = formacion.anio_finalizacion ? String(formacion.anio_finalizacion) : (formacion.fecha_fin ? String(new Date(formacion.fecha_fin).getFullYear()) : '');

      const exprResumen = cand.experiencia_resumen || {};
      const historialExp = cand.experiencias || [];
      const tieneExp = (historialExp.length > 0 || exprResumen.tiene_experiencia) ? 'SI' : 'NO';

      const areaExp = String(ent0.tipo_experiencia_flores ?? '').toUpperCase();

      const empresasArr = historialExp.map((e: any) => e.empresa).filter(Boolean);
      const empresas = empresasArr.length > 0 ? empresasArr.join(', ').toUpperCase() : String(exprResumen.empresas_laborado ?? '').toUpperCase();

      const desempeno = String(evalCand.rendimiento_laboral ?? evalCand.rendimiento ?? '').toUpperCase();
      const felicitaciones = String(evalCand.porque_lo_felicitarian ?? '').toUpperCase();
      const situacionConflicto = String(evalCand.malentendido ?? '').toUpperCase();
      const actividadesDiferentes = String(evalCand.actividades_diarias ?? '').toUpperCase(); // Map as requested or fallback

      const nombreEvaluador = String(ent0.proceso?.nombre_evaluador ?? this.nombreCompletoLogin).toUpperCase();
      const observaciones = String(evalCand.observaciones ?? 'SIN OBSERVACIONES').substring(0, 300);

      // --- Setup del Documento ---
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `ENTREVISTA_INGRESO_TU_ALIANZA_${numIdentificacion}.pdf` });
      const pageWidth = doc.internal.pageSize.getWidth();
      const mLeft = 14;
      const anchoTabla = pageWidth - (mLeft * 2);

      const { logoPath } = this.getEmpresaInfo();
      const grayTit = [210, 210, 210] as [number, number, number];

      // --- 1) Encabezado ---
      autoTable(doc, {
        startY: 10,
        margin: { left: mLeft, right: mLeft },
        theme: 'grid',
        body: [
          [
            { content: '', rowSpan: 3, styles: { cellWidth: 50, minCellHeight: 20 } },
            { content: 'PROCESO DE GESTIÓN HUMANA Y BIENESTAR', colSpan: 4, styles: { halign: 'center', fontStyle: 'bold', fontSize: 9 } }
          ],
          [
            { content: 'ENTREVISTA DE INGRESO', colSpan: 4, styles: { halign: 'center', fontStyle: 'bold', fontSize: 9 } }
          ],
          [
            { content: 'Código: TA SE-RE-2', styles: { halign: 'center', fontSize: 8 } },
            { content: 'Versión: 02', styles: { halign: 'center', fontSize: 8 } },
            { content: 'Fecha: Mayo 02-22', styles: { halign: 'center', fontSize: 8 } },
            { content: 'Página: 1 de 1', styles: { halign: 'center', fontSize: 8 } }
          ]
        ],
        didDrawCell: (data) => {
          if (data.row.index === 0 && data.column.index === 0 && logoPath) {
            try {
              const x = data.cell.x + 2;
              const y = data.cell.y + 2;
              const w = data.cell.width - 4;
              const h = data.cell.height - 4;
              doc.addImage(logoPath, 'PNG', x, y, w, h);
            } catch (e) { }
          }
        }
      });

      let finalY = (doc as any).lastAutoTable.finalY + 3;

      const secTitle = (title: string, yPos: number) => {
        doc.setFillColor(grayTit[0], grayTit[1], grayTit[2]);
        doc.rect(mLeft, yPos, anchoTabla, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text(title, pageWidth / 2, yPos + 4.5, { align: 'center' });
        // Double wrapper frame simulation
        doc.setDrawColor(0);
        doc.setLineWidth(0.3);
        doc.rect(mLeft, yPos, anchoTabla, 6, 'S');
        doc.rect(mLeft + 0.6, yPos + 0.6, anchoTabla - 1.2, 4.8, 'S');
        return yPos + 8;
      };

      const mkLabelVal = (lbl: string, val: string, xLbl: number, xVal: number, y: number) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(lbl, xLbl, y);
        doc.setFont('helvetica', 'normal');
        doc.text(val || '', xVal, y);
      };

      // --- 2) Información Personal ---
      finalY = secTitle('Información Personal', finalY);
      let px1 = mLeft, pxV1 = mLeft + 25;
      let px2 = mLeft + 85, pxV2 = mLeft + 115;
      let px3 = mLeft + 150, pxV3 = mLeft + 168;

      mkLabelVal('Nombre:', nombreCompleto, px1, pxV1, finalY + 4);
      mkLabelVal('No. Identificación:', numIdentificacion, px2, pxV2, finalY + 4);
      mkLabelVal('Estado Civil:', estadoCivil, px3, pxV3, finalY + 4);
      finalY += 10;

      px1 = mLeft; pxV1 = mLeft + 28;
      mkLabelVal('Fecha Expedición:', fechaExpedicion, px1, pxV1, finalY);
      mkLabelVal('Lugar Expedición:', lugarExpedicion, px2, pxV2, finalY);
      finalY += 6;

      mkLabelVal('Fecha Nacimiento:', fechaNacimiento, px1, pxV1, finalY);
      mkLabelVal('Lugar Nacimiento:', lugarNacimiento, px2, pxV2, finalY);
      finalY += 6;

      px1 = mLeft; pxV1 = mLeft + 10;
      px2 = mLeft + 35; pxV2 = mLeft + 50;
      px3 = mLeft + 80; let pxV3_2 = mLeft + 95;
      let px4 = mLeft + 130, pxV4 = mLeft + 140;
      mkLabelVal('Edad:', edadStr, px1, pxV1, finalY);
      mkLabelVal('Genero:', genero, px2, pxV2, finalY);
      mkLabelVal('Celular:', celular, px3, pxV3_2, finalY);
      mkLabelVal('EPS:', eps, px4, pxV4, finalY);
      finalY += 6;

      px1 = mLeft; pxV1 = mLeft + 12;
      px2 = mLeft + 80; pxV2 = mLeft + 100;
      px3 = mLeft + 130; pxV3_2 = mLeft + 148;
      mkLabelVal('Email:', email, px1, pxV1, finalY);
      mkLabelVal('No WhatsApp:', noWhatsapp, px2, pxV2, finalY);
      mkLabelVal('WhatsApp:', whaStr, px3, pxV3_2, finalY);
      finalY += 6;

      px1 = mLeft; pxV1 = mLeft + 15;
      px2 = mLeft + 65; pxV2 = mLeft + 80;
      px3 = mLeft + 125; pxV3_2 = mLeft + 140;
      mkLabelVal('Dirección:', direccion, px1, pxV1, finalY);
      mkLabelVal('Barrio:', barrio, px2, pxV2, finalY);
      mkLabelVal('Ciudad:', ciudad, px3, pxV3_2, finalY);
      finalY += 5;

      // --- 3) Información Familiar ---
      finalY = secTitle('Información Familiar', finalY);
      const fx1 = mLeft, fxV1 = mLeft + 55;
      const fx2 = mLeft + 105, fxV2 = mLeft + 130;

      mkLabelVal('¿Hace cuanto vive en la zona?', haceCuantoVive, fx1, fxV1, finalY + 4);
      mkLabelVal('Tipo de vivienda:', tipoVivienda, fx2, fxV2, finalY + 4);
      finalY += 10;
      mkLabelVal('¿Con quién vive?', conQuienVive, fx1, fxV1, finalY);
      mkLabelVal('La vivienda es:', laViviendaEs, fx2, fxV2, finalY);
      finalY += 6;
      mkLabelVal('¿Cantidad hijos?', cantidadHijos, fx1, fxV1, finalY);
      mkLabelVal('Edades de los hijos:', edadesHijos, fx2, fx2 + 32, finalY);
      finalY += 6;
      mkLabelVal('¿Quién cuida de sus hijos menores de edad cuando usted se encuentra trabajando?', cuidaHijos, fx1, mLeft + 115, finalY);
      finalY += 6;
      mkLabelVal('¿Cómo es su relación familiar?', relacionFamiliar, fx1, fxV1, finalY);
      finalY += 6;
      mkLabelVal('¿Cuál es su motivación?', motivacion, fx1, fxV1, finalY);
      finalY += 9;

      // --- 4) Información Académica y Laboral ---
      finalY = secTitle('Información Académica y Laboral', finalY);
      let ax1 = mLeft, axV1 = mLeft + 65;
      let ax2 = mLeft + 115, axV2 = mLeft + 148;

      mkLabelVal('Nivel académico:', nivelAcademico, ax1, axV1, finalY + 4);
      mkLabelVal('¿Estudia actualmente?', estudiaActualmente, ax2, axV2, finalY + 4);
      finalY += 10;
      mkLabelVal('Nombre de la institución:', nombreInst, ax1, axV1, finalY);
      mkLabelVal('Año de finalización:', anioFin, ax2, axV2, finalY);
      finalY += 6;
      mkLabelVal('¿Tiene experiencia Laboral?', tieneExp, ax1, axV1, finalY);
      finalY += 6;
      mkLabelVal('¿En que area tiene experiencia?', areaExp, ax1, axV1, finalY);
      finalY += 6;
      mkLabelVal('¿En que empresas ha trabajado?', empresas, ax1, axV1, finalY);
      finalY += 6;
      mkLabelVal('¿Cómo considera su desempeño laboral?', desempeno, ax1, axV1, finalY);
      finalY += 6;
      mkLabelVal('¿Ha recibido un reconocimiento o felicitación por el rendimiento?', felicitaciones, ax1, ax1 + 95, finalY);
      finalY += 8;
      mkLabelVal('¿Ha tenido usted alguna situación conflictiva?', situacionConflicto, ax1, ax1 + 65, finalY);
      finalY += 8;
      mkLabelVal('Está dispuesto a realizar actividades diferentes al cargo?', actividadesDiferentes, ax1, ax1 + 80, finalY);
      finalY += 6;

      // --- 5) Observaciones del Evaluador ---
      finalY = secTitle('Observaciones del Evaluador', finalY);

      // El tamaño de fuente viene en 11 desde secTitle; lo bajamos a 8 (como el
      // resto del documento) para que el label no se monte sobre el valor.
      doc.setFontSize(8);

      // Rectángulo gris solo para el título "Nombre del evaluador:"
      doc.setFillColor(230, 230, 230);
      doc.rect(mLeft, finalY + 2, 36, 5, 'F');

      doc.setFont('helvetica', 'normal');
      doc.text('Nombre del evaluador:', mLeft + 1, finalY + 5.5);
      doc.text(nombreEvaluador, mLeft + 38, finalY + 5.5);

      finalY += 10;

      // Rectángulo gris solo para el título "Observaciones:"
      doc.setFillColor(230, 230, 230);
      doc.rect(mLeft, finalY, 25, 5, 'F');

      doc.setFont('helvetica', 'normal');
      doc.text('Observaciones:', mLeft + 1, finalY + 3.5);
      doc.text(observaciones, mLeft + 27, finalY + 3.5, { maxWidth: 140 });

      finalY += 40;
      // ───────── Firmas ─────────
      const toDataURL = async (url?: string): Promise<string | null> => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      const firmaData = await toDataURL(this.firma);
      if (firmaData) {
        doc.addImage(firmaData, 'PNG', mLeft + 25, finalY - 18, 50, 18);
      }

      const selloData = await toDataURL('firma/gestion_entrevista.png');
      if (selloData) {
        doc.addImage(selloData, 'PNG', mLeft + 105, finalY - 18, 50, 18);
      }

      doc.setDrawColor(0);
      doc.setLineWidth(0.4);
      doc.line(mLeft + 20, finalY, mLeft + 80, finalY);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Firma del Entrevistado', mLeft + 50, finalY + 4, { align: 'center' });

      doc.line(mLeft + 100, finalY, mLeft + 160, finalY);
      doc.text('Firma de Gestión Humana', mLeft + 130, finalY + 4, { align: 'center' });

      const blob = doc.output('blob');
      const mockFile = new File([blob], `ENTREVISTA_INGRESO_TU_ALIANZA_${numIdentificacion}.pdf`, { type: 'application/pdf' });

      // Guardarlo usando la estructura que utiliza el componente
      this.uploadedFiles['Entrevista de Ingreso Tu Alianza'] = {
        file: mockFile,
        fileName: `ENTREVISTA_INGRESO_TU_ALIANZA_${numIdentificacion}.pdf`,
      };
      // Era el único generador que no mostraba el resultado: quedaba en la
      // cola de subida pero el previsualizador seguía con el documento anterior.
      this.verPDF({ titulo: 'Entrevista de Ingreso Tu Alianza' });

      this.setPdfPreview(URL.createObjectURL(blob));

    } catch (error) {
      console.error(error);
      Swal.fire('Error', 'Hubo un error al generar la Entrevista de Ingreso Tu Alianza.', 'error');
    }
  }

  // --- Manejo Imagen Modificado con Textos Formateados en Negrita ---
  async generarManejoImagen() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};

      // ── Mapeo de Variables ──
      const nombreTrabajador = [
        cand.primer_apellido, cand.segundo_apellido,
        cand.primer_nombre, cand.segundo_nombre,
      ].map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' ').toUpperCase();
      const numIdentificacion = this.limpio(cand.numero_documento);
      // `limpio` descarta el 0 que el backend arrastra como "vacío"; sin esto
      // el documento salía diciendo "con domicilio en 0" y "No. 1105... de 0".
      const domicilioTrabajador = (
        this.limpio(cand.residencia?.municipio) ||
        this.limpio(cand.municipio) ||
        this.limpio(cand.residencia?.ciudad)
      ).toUpperCase();

      const empresaUsuaria = this.limpio(this.empresaUsuariaDoc).toUpperCase();

      // NIT, domicilio y representante legal de la empresa usuaria NO existen
      // en la BD (`CentroCosto` solo guarda empresa/dirección/ciudad), por eso
      // el documento salía con "___". Se resuelven de este catálogo y, si la
      // vacante llegara a traerlos algún día, ese dato tiene prioridad.
      const datosEU = resolverEmpresaUsuaria(empresaUsuaria);
      const nitEmpresaUsuaria = datosEU.nit || this.limpio(vac.nitEmpresaUsuaria ?? vac.nit);
      // El catálogo MANDA sobre `Publicacion.direccion`: ese campo guarda la
      // finca donde se presta el servicio (The Elite Flower figura como
      // "KM 25 VIA SIBATÉ"), no el domicilio social que exige el documento.
      const domicilioEmpresaUsuaria = datosEU.domicilio || this.limpio(this.direccionDoc || vac.domicilioEmpresaUsuaria);
      const representanteEmpresaUsuaria = (
        datosEU.representante || this.limpio(vac.representanteLegalEmpresaUsuaria ?? vac.representanteLegal)
      ).toUpperCase();
      const ccRepresentanteEmpresaUsuaria = datosEU.ccRepresentante || this.limpio(vac.ccRepresentanteEmpresaUsuaria ?? vac.ccRepresentante);

      const fechaDelContrato = this.getFechaContrato();
      const opcionesFecha: Intl.DateTimeFormatOptions = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' };
      const fechaFirmaTexto = fechaDelContrato.toLocaleDateString('es-CO', opcionesFecha);

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `MANEJO_IMAGEN_${nombreTrabajador}.pdf`, author: 'Tu Alianza SAS / Apoyo Laboral' });

      // Red de seguridad: ningún `doc.text` de este documento puede salirse de
      // la hoja, pase por donde pase. El encuadre fino (columna por columna) lo
      // hacen los `textoUnaLinea` de más abajo; esto sólo evita el derrame.
      instalarGuardiaTexto(doc, { margenIzquierdo: 6, margenDerecho: 6 });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginLeft = 12;
      const anchoTabla = pageWidth - (marginLeft * 2);

      const { logoPath } = this.getEmpresaInfo();

      autoTable(doc, {
        startY: 10,
        margin: { left: marginLeft },
        tableWidth: anchoTabla,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 7, halign: 'center', valign: 'middle', textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.2, cellPadding: 0.5 },
        body: [
          [
            { content: '', rowSpan: 3, styles: { cellWidth: 28 } },
            { content: 'PROCESO DE CONTRATACIÓN', colSpan: 3, styles: { fontStyle: 'bold' } },
            { content: 'Página: 1 de 1', rowSpan: 3, styles: { fontStyle: 'bold', cellWidth: 22 } }
          ],
          [
            { content: 'ACUERDO Y AUTORIZACIÓN DE USO DE IMAGEN', colSpan: 3, styles: { fontStyle: 'bold' } }
          ],
          [
            { content: 'Código: AL CO-RE-12', styles: { fontStyle: 'bold' } },
            { content: 'Versión: 01', styles: { fontStyle: 'bold' } },
            { content: 'Fecha Emisión: Agosto 26-25', styles: { fontStyle: 'bold' } }
          ]
        ],
        didDrawCell: (data) => {
          if (data.row.index === 0 && data.column.index === 0 && logoPath) {
            try {
              const dimHeight = data.cell.height - 1;
              const dimWidth = 24;
              const posX = data.cell.x + (data.cell.width - dimWidth) / 2;
              const posY = data.cell.y + 0.5;
              doc.addImage(logoPath, 'PNG', posX, posY, dimWidth, dimHeight);
            } catch (e) { }
          }
        }
      });

      const finalYTabla = (doc as any).lastAutoTable.finalY;
      let currentY = finalYTabla + 6;

      // ── Límites verticales del documento ──
      // El contenido crece con los datos (razón social de la empresa usuaria,
      // domicilio, representante legal, nombre del trabajador). Sin un tope,
      // `currentY` se pasaba del alto de la hoja y el bloque de firmas acababa
      // pintándose ENCIMA del último párrafo. Todo lo que baja pasa por
      // `asegurarBloque`, que abre página cuando ya no cabe.
      const LIMITE_INFERIOR = pageHeight - 14;
      const TOPE_SUPERIOR = 14;

      /** Reserva `alto` mm de página; si no caben, salta a una hoja nueva. */
      const asegurarBloque = (alto: number): void => {
        if (currentY + alto > LIMITE_INFERIOR) {
          doc.addPage();
          currentY = TOPE_SUPERIOR;
        }
      };

      // Mini-renderizador de Negritas justificado simple
      const printFormattedJustified = (textRaw: string, pSize = 7.5, indentLeft = 0) => {
        doc.setFontSize(pSize);
        const espacioW = doc.getTextWidth(' ');

        /**
         * Parte el texto en piezas (palabras y bloques de espacio) marcando
         * cuáles van en negrita.
         *
         * El marcador `**` se lee por TRAMO y no por palabra. Antes se
         * preguntaba `palabra.includes('**')`, así que de
         * `**domingo, 22 de marzo de 2026**` solo salían en negrita "domingo," y
         * "2026" —las dos palabras que llevaban los asteriscos pegados— y
         * "22 de marzo de" quedaba en redonda. Lo mismo le pasaba a todos los
         * tramos de varias palabras del documento: `**EL EMPLEADOR Y LA EMPRESA
         * USUARIA**` se imprimía con la mitad de las palabras sin negrita.
         *
         * Los bloques de 2+ espacios se conservan con su ancho real: en el
         * formato aprobado el hueco antes de la fecha es un espacio para
         * diligenciar, no una separación de palabras, así que no se colapsa a
         * uno ni se estira al justificar.
         */
        const partirEnPiezas = (texto: string): Array<{ raw: string; bold: boolean }> => {
          const piezas: Array<{ raw: string; bold: boolean }> = [];
          // Los tramos impares son los que iban entre `**`.
          texto.split('**').forEach((tramo, i) => {
            const bold = i % 2 === 1;
            for (const parte of tramo.split(/(\s+)/)) {
              if (parte !== '') piezas.push({ raw: parte, bold });
            }
          });
          return piezas;
        };

        const words = partirEnPiezas(textRaw);

        let lineWords: any[] = [];
        let lineWidth = 0;
        const lineMaxW = anchoTabla - indentLeft;
        const altoLinea = pSize * 0.35 + 0.8;

        // Medir palabras y aplicar formatos primitivos **texto** para negrita
        let lines: any[][] = [];

        /**
         * Parte una "palabra" más ancha que el renglón (correos, URLs, NITs o
         * razones sociales sin espacios) en trozos que sí caben. Sin esto se
         * pintaba entera desde el margen izquierdo y se metía en lo que hubiera
         * a la derecha.
         */
        const partirPalabraLarga = (w: string): string[] => {
          const trozos: string[] = [];
          let actual = '';
          for (const ch of w) {
            const tentativa = actual + ch;
            if (actual && doc.getTextWidth(tentativa) > lineMaxW) {
              trozos.push(actual);
              actual = ch;
            } else {
              actual = tentativa;
            }
          }
          if (actual) trozos.push(actual);
          return trozos;
        };

        for (let i = 0; i < words.length; i++) {
          const pieza = words[i];
          const word = pieza.raw;
          if (/^\s+$/.test(word)) {
            // Es un bloque de espacio. Uno solo separa palabras y lo estira la
            // justificación; dos o más son un hueco del formato y se respeta su
            // ancho tal cual.
            if (lineWidth > 0) { // no añadir el primer espacio a una linea vacia
              const fijo = word.length > 1;
              const anchoHueco = espacioW * word.length;
              lineWords.push({ text: ' ', isSpace: true, fijo, bold: false, width: anchoHueco });
              lineWidth += anchoHueco;
            }
            continue;
          }

          const isBold = pieza.bold;
          const wToPrint = word;

          doc.setFont('helvetica', isBold ? 'bold' : 'normal');
          const trozos = doc.getTextWidth(wToPrint) > lineMaxW
            ? partirPalabraLarga(wToPrint)
            : [wToPrint];

          for (const trozo of trozos) {
            const textW = doc.getTextWidth(trozo);

            if (lineWidth + textW > lineMaxW && lineWords.length > 0) {
              // Remover último espacio si lo hay
              if (lineWords[lineWords.length - 1].isSpace) lineWords.pop();
              lines.push([...lineWords]);
              lineWords = [];
              lineWidth = 0;
            }

            lineWords.push({ text: trozo, isSpace: false, bold: isBold, width: textW });
            lineWidth += textW;
          }
        }
        if (lineWords.length > 0) lines.push(lineWords);

        // Escribir líneas justificadas
        for (let l = 0; l < lines.length; l++) {
          // Cada renglón comprueba que cabe ANTES de pintarse.
          asegurarBloque(altoLinea);
          doc.setFontSize(pSize);

          let cLine = lines[l];
          let wordsOnly = cLine.filter(w => !w.isSpace);
          let rawLineWidth = wordsOnly.reduce((acc, curr) => acc + curr.width, 0);

          // Huecos que SÍ se estiran al justificar (los fijos del formato no) y
          // el ancho que ya se llevan los fijos, que no está disponible para
          // repartir.
          const huecosFlexibles = cLine.filter(w => w.isSpace && !w.fijo).length;
          const anchoFijos = cLine
            .filter(w => w.isSpace && w.fijo)
            .reduce((acc, curr) => acc + curr.width, 0);

          // Si no es la última línea de párrafo, calcula delta de espacios
          // justificados. Nunca por debajo de un espacio normal: un valor
          // negativo haría RETROCEDER el cursor y pintaría unas palabras
          // encima de otras.
          let spaceExtraWidth = espacioW;
          if (l < lines.length - 1 && huecosFlexibles > 0) {
            const gapTotal = lineMaxW - rawLineWidth - anchoFijos;
            spaceExtraWidth = Math.max(espacioW, gapTotal / huecosFlexibles);
          }

          let curX = marginLeft + indentLeft;
          for (let j = 0; j < cLine.length; j++) {
            const itm = cLine[j];
            if (itm.isSpace) {
              curX += itm.fijo ? itm.width : spaceExtraWidth;
            } else {
              doc.setFont('helvetica', itm.bold ? 'bold' : 'normal');
              doc.text(itm.text, curX, currentY);
              curX += itm.width;
            }
          }

          currentY += altoLinea;
        }
        currentY += 1.5; // salto extra párrafo
      };

      const centerText = (text: string, size = 9) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(size);
        const split: string[] = doc.splitTextToSize(text, anchoTabla);
        const altoLinea = size * 0.35 + 0.5;
        // Renglón a renglón (y no el array entero) para poder comprobar el
        // límite inferior en cada uno: un título largo tampoco puede invadir
        // lo que venga debajo.
        for (const linea of split) {
          asegurarBloque(altoLinea);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(size);
          doc.text(linea, marginLeft + (anchoTabla / 2), currentY, { align: 'center', maxWidth: anchoTabla });
          currentY += altoLinea;
        }
        currentY += 1.5;
      };

      // == Contenido del Documento ==

      centerText('ACUERDO USO DE IMAGEN', 9);

      const pIntro = `Entre los suscritos a saber, **APOYO LABORAL TS**, persona jurídica identificada con NIT 900.814.587-1, con domicilio en la Carrera 2 # 8 - 156, Facatativá, Cundinamarca, debidamente representada por la señora MAYRA HUAMANÍ LÓPEZ, identificada con la cédula de extranjería N° 332.318 en su calidad de Representante Legal, quien para los efectos del presente documento se denominará **EL EMPLEADOR**; Y por otra parte, **${empresaUsuaria || '_________________'}**, persona jurídica con NIT **${nitEmpresaUsuaria || '___________'}**, con domicilio en la **${domicilioEmpresaUsuaria || '_________________'}**, legalmente representada por el señor(a) **${representanteEmpresaUsuaria || '_________________'}**, identificado con la cédula de ciudadanía No. **${ccRepresentanteEmpresaUsuaria || '___________'}**, quien en adelante se denominará **LA EMPRESA USUARIA**; Y por otra parte, el señor **${nombreTrabajador || '_________________'}**, identificado con la cédula de ciudadanía No. **${numIdentificacion || '___________'}**, mayor de edad, con domicilio en **${domicilioTrabajador || this.municipioFirma.toUpperCase()}**, quien en adelante se denominará **EL TRABAJADOR**; hemos celebrado el presente acuerdo de uso de imagen, conforme a la Ley Estatutaria 1581 de 2012 de protección de datos y normas reglamentarias y a las demás normas concordantes, previa a las siguientes consideraciones:`;
      printFormattedJustified(pIntro, 7.5);

      centerText('CONSIDERACIONES', 8.5);

      printFormattedJustified(`**I.** **EL EMPLEADOR Y LA EMPRESA USUARIA** en ejercicio de su objeto social desarrolla diversas campañas, tendientes a fortalecer su imagen corporativa, efectuar capacitaciones, en las cuales elabora material audiovisual en el que eventualmente puede utilizar el nombre, imagen, voz y/o apariencia **DEL TRABAJADOR**, las cuales pueden ser incluidas en las imágenes, fotos, grabaciones de video, cintas de audio, imágenes digitales, y similares tomadas o hechas por **EL EMPLEADOR Y/O EMPRESA USUARIA** o su personal, las cuáles serán incluidas en obras audiovisuales.`, 7.5);
      printFormattedJustified(`**II.** Que **EL EMPLEADOR Y/O LA EMPRESA USUARIA** es el titular de todos y cada uno de los derechos patrimoniales de autor sobre las obras audiovisuales señaladas en el numeral anterior, situación que declara y reconoce expresamente **EL TRABAJADOR**.`, 7.5);
      printFormattedJustified(`**III.** Que las partes convienen en celebrar el presente Acuerdo de Uso de Imagen, por medio del cual **EL TRABAJADOR** acepta su eventual participación en la ejecución y desarrollo de las obras audiovisuales anteriormente mencionadas.`, 7.5);

      printFormattedJustified(`En razón de lo expuesto, las Partes suscriben el presente documento, el cual está regido por la Legislación Colombiana, la Ley Estatutaria 1581 de 2012 y la Ley 23 de 1982 y por las siguientes:`, 7.5);

      centerText('CLÁUSULAS', 8.5);

      printFormattedJustified(`**1.** **OBJETO** - **EL TRABAJADOR** en uso de sus plenas facultades, autoriza irrevocablemente **AL EMPLEADOR Y /O LA EMPRESA USUARIA**, para que utilice su nombre, imagen, voz y/o apariencia, como tal, las cuales pueden ser incluidas en las imágenes, fotos, grabaciones de video, cintas de audio, imágenes digitales, y similares tomadas o hechas por el **EMPLEADOR Y/O LA EMPRESA USUARIA** o su personal, las cuáles serán incluidas en las Obras audiovisuales que este desarrolle en ejercicio de las campañas antes mencionadas y en consecuencia, acepta que el **EMPLEADOR Y/O LA EMPRESA USUARIA**, tiene la propiedad de tales imágenes, grabaciones de video y audio realizadas en ejercicio de las campañas antes mencionadas incluyendo la totalidad de derechos de autor, y puede usarlos para el propósito de publicarlos, reproducirlos y ponerlos a disposición del público en cualquier medio conocido o por conocerse. Estos usos incluyen, pero no se limitan a las ilustraciones, exhibiciones, grabaciones de videos, audio, transmisiones, reproducciones (totales o parciales), publicaciones, anuncios y materiales promocionales o educativos a través de cualquier plataforma de distribución existente o por inventarse, incluidas redes sociales. Así mismo, **EL TRABAJADOR** otorga esta autorización para los exclusivos efectos de emitir, publicar, divulgar y promocionar en cualquier lugar del mundo, y por el máximo tiempo permitido por la ley, las imágenes y datos antes mencionados.`, 7.5, 4);
      printFormattedJustified(`**2.** **MODALIDAD DE USO** - Tal utilización podrá realizarse mediante la divulgación a través de su reproducción, tanto en medios impresos como electrónicos/digitales, así como su comunicación, emisión y divulgación pública, a través de los medios existentes, o por inventarse, incluidos aquellos de acceso remoto, conocidos como internet, para los fines de presentación de las campañas y proyectos y los fines promocionales e informativos que **AL EMPLEADOR Y/O LA EMPRESA USUARIA** o un tercero autorizado por éste, estime convenientes.`, 7.5, 4);
      printFormattedJustified(`**3.** **VALOR** - **EL TRABAJADOR** manifiesta expresamente que esta autorización la otorga con carácter gratuito, por cuanto la obtención de su imagen para los fines antes previstos se efectúa en ejercicio del Contrato de Trabajo, por lo que expresamente entiende que no recibirá ningún tipo de compensación, bonificación o pago de ninguna naturaleza, ni para la realización de las obras audiovisuales en que estas se utilicen. Así mismo, **EL TRABAJADOR** reconoce que no existe ninguna expectativa sobre los eventuales efectos económicos de la divulgación o sobre el tipo de documento audiovisual que pueda realizar **AL EMPLEADOR Y/O LA EMPRESA USUARIA** o un tercero autorizado por éste para la realización del Proyecto.`, 7.5, 4);
      printFormattedJustified(`**4.** **VIGENCIA DE LA AUTORIZACIÓN** - La vigencia de la autorización de uso de imagen corresponde al máximo término establecido en la legislación vigente en Colombia en materia derechos de autor, con autorización para el territorio del mundo, durante el cual **EL EMPLEADOR Y/O LA EMPRESA USUARIA** es titular de los derechos sobre los videos resultado del Proyecto, quien podrá cederlos a un tercero.`, 7.5, 4);
      printFormattedJustified(`**5.** **PERFECCIONAMIENTO** - El presente convenio se rige por las normas de la República de Colombia y se perfecciona desde la firma del mismo.`, 7.5, 4);

      printFormattedJustified(`Las Partes suscriben el presente documento en dos (2) originales del mismo tenor y valor, el día      **${fechaFirmaTexto}**.`, 7.5);

      // ── Sección de firmas ──
      // Se reserva el alto COMPLETO del bloque antes de empezar: si no cabe en
      // lo que queda de hoja se abre una nueva. Antes se pintaba a ciegas sobre
      // `currentY` y, con datos largos, quedaba encima del último párrafo.
      const ALTO_BLOQUE_FIRMAS = 8 + 22 + 10;
      asegurarBloque(ALTO_BLOQUE_FIRMAS);
      currentY += 8;

      // Dos columnas que NO se tocan. Todo texto variable se acota a la suya.
      const xColEmpleador = marginLeft;
      const xColTrabajador = marginLeft + 90;
      const anchoColEmpleador = 90 - 4;
      const anchoColTrabajador = (pageWidth - marginLeft) - xColTrabajador;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      textoUnaLinea(doc, 'Por EL EMPLEADOR', xColEmpleador, currentY, anchoColEmpleador);
      textoUnaLinea(doc, 'Por EL TRABAJADOR', xColTrabajador, currentY, anchoColTrabajador);

      const yLineaFirma = currentY + 22; // Reducido el salto de la firma

      // Inserción de firma del Empleador (MAYRA HUMANI LOPEZ), ahora apuntando a FirmaMayra.png
      const firmaAdmin = await this.fetchAsArrayBufferOrNull('firma/FirmaMayra.png');
      if (firmaAdmin) {
        try {
          const kind = (new Uint8Array(firmaAdmin)[0] === 0xFF) ? 'JPEG' : 'PNG';
          // Se redujo la Y y se amplió el Width para que se vea mas estirada como la firma de verdad
          doc.addImage(new Uint8Array(firmaAdmin), kind, marginLeft + 5, currentY + 1, 35, 20);
        } catch (e) { console.error('Error insertando firma admin Manejo Imagen', e); }
      }

      // Inserción de firma del Trabajador
      const firmaCand = await this.fetchAsArrayBufferOrNull(cand?.biometria?.firma?.file_url ?? this.firma);
      if (firmaCand) {
        try {
          const kind = (new Uint8Array(firmaCand)[0] === 0xFF) ? 'JPEG' : 'PNG';
          doc.addImage(new Uint8Array(firmaCand), kind, marginLeft + 95, currentY + 1, 35, 20);
        } catch (e) { console.error('Error insertando firma candidato Manejo Imagen', e); }
      }

      // Dibujar lineas de firma principales (Acortadas un poco para encajar en margins)
      doc.setLineWidth(0.3);
      const mWidth = anchoTabla / 2 - 10;
      doc.line(marginLeft, yLineaFirma, marginLeft + mWidth, yLineaFirma);
      doc.line(marginLeft + 90, yLineaFirma, marginLeft + 90 + mWidth, yLineaFirma);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      textoUnaLinea(doc, 'MAYRA HUMANÍ LÓPEZ', xColEmpleador, yLineaFirma + 4, anchoColEmpleador);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      textoUnaLinea(doc, 'Cedula de extranjería 332.318', xColEmpleador, yLineaFirma + 8, anchoColEmpleador);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      // El nombre del trabajador es el dato más largo del documento (cuatro
      // componentes en mayúsculas). Acotado a su columna: primero reduce el
      // cuerpo y, en el extremo, recorta — nunca invade la columna vecina ni
      // se sale de la hoja.
      textoUnaLinea(doc, nombreTrabajador, xColTrabajador, yLineaFirma + 4, anchoColTrabajador);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      textoUnaLinea(
        doc,
        `C.C                                            ${numIdentificacion}`,
        xColTrabajador,
        yLineaFirma + 8,
        anchoColTrabajador,
      );

      // ---------------------------------------------------------
      // --- PÁGINA 2: Autorización de uso de Derechos de Imagen ---
      // ---------------------------------------------------------
      doc.addPage();
      currentY = 10;
      // Sin `setPage(2)` a pelo: si el cuerpo de la página 1 necesitó paginar,
      // esta ya no es la hoja 2 y fijarla ahí pintaría el encabezado y las
      // firmas del anexo encima del contrato.

      // Tabla Encabezado Página 2
      autoTable(doc, {
        startY: currentY,
        margin: { left: marginLeft },
        tableWidth: anchoTabla,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 7, halign: 'center', valign: 'middle', textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.2, cellPadding: 0.5 },
        body: [
          [
            { content: '', rowSpan: 3, styles: { cellWidth: 28 } },
            { content: 'PROCESO DE CONTRATACIÓN', colSpan: 3 },
            { content: 'Página: 1 de 1', rowSpan: 3, styles: { cellWidth: 22 } }
          ],
          [
            { content: 'AUTORIZACIÓN DE USO DE DERECHOS DE IMAGEN', colSpan: 3, styles: { fontStyle: 'bold' } }
          ],
          [
            { content: 'Código: AL CO-RE-13' },
            { content: 'Versión: 01' },
            { content: 'Fecha Emisión: Agosto 26-25' }
          ]
        ],
        didDrawCell: (data) => {
          if (data.row.index === 0 && data.column.index === 0 && logoPath) {
            try {
              const dimHeight = data.cell.height - 1;
              const dimWidth = 24;
              const posX = data.cell.x + (data.cell.width - dimWidth) / 2;
              const posY = data.cell.y + 0.5;
              doc.addImage(logoPath, 'PNG', posX, posY, dimWidth, dimHeight);
            } catch (e) { }
          }
        }
      });

      currentY = (doc as any).lastAutoTable.finalY + 8;

      // Titulo Centrado
      centerText('Autorización de uso de Derechos de Imagen sobre fotografías y producciones audiovisuales (videos) y de propiedad intelectual otorgado', 10);

      currentY += 4;

      // Párrafos Justificados Pág 2
      // Si no se conoce el lugar de expedición se omite la frase entera, en vez
      // de imprimir "de 0" o dejar el hueco.
      const expedidaEn = domicilioTrabajador ? ` de ${domicilioTrabajador}` : '';
      const p2_1 = `Yo, ${nombreTrabajador} , con documento de identidad No. ${numIdentificacion}${expedidaEn} , mediante el presente formato autorizo a la empresa Apoyo Laboral T.S. S.A.S., en adelante la Empresa Temporal y la empresa ${empresaUsuaria} S.A.S. en adelante Empresa Usuaria , para que hagan el uso y tratamiento de mis derechos de imagen para incluirlos sobre fotografías y producciones audiovisuales (videos); así como de los Derechos de Autor; los Derechos Conexos y en general todos aquellos derechos de propiedad intelectual que tengan que ver con el derecho de imagen. Todo esto con sujeción a la Ley 1581 de 2012 y por las normas legales aplicables, para las siguientes finalidades:`;
      printFormattedJustified(p2_1, 9);

      const p2_2 = `Este(os) video(os)/foto(s) podrá(n) ser utilizado(s) con fines informativos en diferentes escenarios y plataformas de comunicación internas y externas de la Empresa.`;
      printFormattedJustified(p2_2, 9);

      const p2_3 = `Este(os) video(os)/foto(s) es(son) sin ánimo de lucro y en ningún momento será utilizado para objetivos distintos a los requerimientos empresariales. La Empresa queda exenta de cualquier responsabilidad que se pueda derivar de la presente actividad con la firma de la autorización.`;
      printFormattedJustified(p2_3, 9);

      const p2_4 = `La presente autorización no tiene ámbito geográfico determinado, por lo que las imágenes en las que aparezca podrán ser utilizadas en el territorio del mundo, así mismo, tampoco tiene ningún límite de tiempo para su concesión, ni para explotación de las imágenes, o parte de estas, por lo que mi autorización se considera concedida por un plazo de tiempo ilimitado.`;
      printFormattedJustified(p2_4, 9);

      const p2_5 = `Declaro que soy responsable de la veracidad de los datos suministrados y que he sido informado que EMPRESA TEMPORAL Y LA EMPRESA USUARIA son responsable de los datos personales por mi suministrados y entiendo que los canales de atención al titular a mi disposición son: EMPRESA TEMPORAL Correo electrónico: protecciondedatos.tuapo@gmail.com, Telefono: 6017444002 y EMPRESA USUARIA Correo Electrónico: datospersonales@eliteflower.com y Teléfono: 6018910444.`;
      printFormattedJustified(p2_5, 9);

      currentY += 4;
      // La ciudad de firma es donde se suscribe el documento (la sede), no el
      // domicilio del trabajador; y así nunca queda vacía.
      const p2_6 = `Para constancia de lo anterior se firma y otorga esta autorización de manera voluntaria en la ciudad de ${this.municipioFirma.toUpperCase()} el día     **${fechaFirmaTexto}**`;
      printFormattedJustified(p2_6, 9);

      // Firma del Trabajador (Pág 2 - Abajo a la izquierda).
      // `pageHeight - 50` es sólo la posición PREFERIDA. Si el texto llegó más
      // abajo se respeta el texto (y si ya no cabe el bloque, se abre hoja):
      // antes se fijaba a ciegas y la firma caía sobre el último párrafo.
      const ALTO_BLOQUE_FIRMA_2 = 22 + 10;
      currentY = Math.max(currentY + 6, pageHeight - 50);
      asegurarBloque(ALTO_BLOQUE_FIRMA_2);

      const firmaCand2 = await this.fetchAsArrayBufferOrNull(cand?.biometria?.firma?.file_url ?? this.firma);
      if (firmaCand2) {
        try {
          const kind = (new Uint8Array(firmaCand2)[0] === 0xFF) ? 'JPEG' : 'PNG';
          doc.addImage(new Uint8Array(firmaCand2), kind, marginLeft + 5, currentY + 1, 35, 20);
        } catch (e) { console.error('Error insertando firma candidato Manejo Imagen Pag2', e); }
      }

      const yLineaFirma2 = currentY + 22;
      doc.setLineWidth(0.3);
      doc.line(marginLeft, yLineaFirma2, marginLeft + 75, yLineaFirma2);

      // Mismo criterio que en la página 1: el rótulo con el nombre se acota al
      // ancho útil de la hoja.
      const anchoUtil = pageWidth - marginLeft * 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      textoUnaLinea(doc, `Nombres: ${nombreTrabajador}`, marginLeft, yLineaFirma2 + 4, anchoUtil);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      textoUnaLinea(doc, `C.C ${numIdentificacion}`, marginLeft, yLineaFirma2 + 8, anchoUtil);


      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], 'MANEJO_IMAGEN.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Manejo Imagen'] = { file, fileName: 'MANEJO_IMAGEN.pdf' };
      this.verPDF({ titulo: 'Manejo Imagen' });

    } catch (error) {
      console.error('Error generando MANEJO_IMAGEN:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el PDF de Manejo de Imagen' });
    }
  }

  async generarSagaroImagen() {
    try {
      const cand: any = this.candidato ?? {};
      const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ').toUpperCase();
      const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ').toUpperCase();
      const nombreTrabajador = `${nombres} ${apellidos}`.trim();
      const numIdentificacion = String(cand.numero_documento ?? '').trim();
      let cargoTrabajador = '';
      if (this.vacante?.cargo?.nombre_cargo_empresa) {
        cargoTrabajador = this.vacante.cargo.nombre_cargo_empresa;
      } else if (this.vacante?.cargo?.nombre_cargo) {
        cargoTrabajador = this.vacante.cargo.nombre_cargo;
      } else if (typeof this.vacante?.cargo === 'string') {
        cargoTrabajador = this.vacante.cargo;
      }
      cargoTrabajador = String(cargoTrabajador).toUpperCase();

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `109_SAGARO_IMAGEN_${nombreTrabajador}.pdf` });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const mLeft = 20;
      const mRight = 20;
      const anchoLinea = pageWidth - mLeft - mRight;

      let currentY = 25;

      // Titles
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('CONSENTIMIENTO INFORMADO', pageWidth / 2, currentY, { align: 'center' });
      currentY += 10;
      doc.text('AUTORIZACIÓN PARA USO DE IMAGEN, VIDEOGRABACIONES Y', pageWidth / 2, currentY, { align: 'center' });
      currentY += 6;
      doc.text('SISTEMAS DE MONITOREO CORPORATIVO', pageWidth / 2, currentY, { align: 'center' });
      currentY += 15;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);

      const p1 = `En mi calidad de trabajador(a) de FLORES SAGARO S.A., manifiesto de manera libre, voluntaria e informada mi consentimiento y otorgo autorización expresa para el tratamiento y uso de mi imagen captada mediante fotografías, videograbaciones y sistemas de monitoreo o videovigilancia instalados por el empleador, bajo los siguientes términos:`;
      const linesP1 = doc.splitTextToSize(p1, anchoLinea);
      doc.text(linesP1, mLeft, currentY, { align: 'justify', maxWidth: anchoLinea });
      currentY += (linesP1.length * 5) + 5;

      const items1 = [
        "1. FLORES SAGARO S.A. actúa como responsable del tratamiento de las imágenes y datos personales captados mediante los sistemas de vigilancia instalados dentro de las áreas autorizadas de la empresa.",
        "2. Autorizo el uso de mi imagen, fotografías y/o videos para fines:"
      ];

      for (const item of items1) {
        const lines = doc.splitTextToSize(item, anchoLinea);
        doc.text(lines, mLeft, currentY, { align: 'justify', maxWidth: anchoLinea });
        currentY += (lines.length * 5) + 2;
      }

      currentY += 2;
      const subItems = [
        "1. corporativos y administrativos,",
        "2. laborales,",
        "3. disciplinarios,",
        "4. de seguridad física y patrimonial,",
        "5. de cumplimiento de normas legales, contractuales y reglamentarias."
      ];

      for (const sItem of subItems) {
        doc.text(sItem, mLeft + 10, currentY);
        currentY += 5;
      }

      currentY += 5;
      const p2 = `Estas imágenes podrán constituir prueba dentro de procesos administrativos o disciplinarios internos.`;
      const linesP2 = doc.splitTextToSize(p2, anchoLinea);
      doc.text(linesP2, mLeft, currentY, { align: 'justify', maxWidth: anchoLinea });
      currentY += (linesP2.length * 5) + 5;

      const items2 = [
        "3. Reconozco que el empleador es autónomo para instalar y administrar sistemas de cámaras de seguridad dentro de las instalaciones laborales, siempre que su ubicación no vulnere espacios de privacidad protegida constitucionalmente.",
        "4. Las imágenes no serán empleadas para fines distintos a los autorizados, ni se entregarán a terceros, salvo requerimiento de autoridad judicial, administrativa o legalmente competente.",
        "5. Podré ejercer mis derechos de acceso, corrección, actualización o supresión de datos personales, mediante solicitud escrita al área de Talento Humano o al correo institucional habilitado para protección de datos.",
        "6. Las grabaciones serán conservadas únicamente por el tiempo necesario para cumplir con las finalidades aquí descritas o por el período exigido por normas legales aplicables.",
        "7. Declaro que mis derechos a la intimidad, integridad personal, libre desarrollo de la personalidad, igualdad, debido proceso, defensa y trato digno han sido garantizados por el empleador y no considero vulnerado ninguno de ellos con motivo de la implementación de sistemas de videovigilancia.",
        "8. Otorgo este consentimiento de forma libre y consciente, y exonero al empleador de responsabilidad civil derivada del uso adecuado y legal de estos sistemas."
      ];

      for (const item of items2) {
        if (currentY > pageHeight - 30) {
          doc.addPage();
          currentY = 20;
        }
        const lines = doc.splitTextToSize(item, anchoLinea);
        doc.text(lines, mLeft, currentY, { align: 'justify', maxWidth: anchoLinea });
        currentY += (lines.length * 5) + 3;
      }

      currentY += 5;
      const fechaDelContrato = this.getFechaContrato();
      const dia = fechaDelContrato.getDate();
      const mes = fechaDelContrato.toLocaleString('es-CO', { month: 'long' });
      const anio = fechaDelContrato.getFullYear();

      const txtFecha = `En constancia se firma a los ${dia} días del mes de ${mes} de ${anio}.`;
      doc.text(txtFecha, mLeft, currentY);
      currentY += 15;

      doc.setFont('helvetica', 'bold');
      doc.text(`NOMBRE: ${nombreTrabajador}`, mLeft, currentY);
      currentY += 6;
      doc.text(`CARGO: ${cargoTrabajador}`, mLeft, currentY);
      currentY += 6;
      doc.text(`CÉDULA: ${numIdentificacion}`, mLeft, currentY);
      currentY += 6;
      doc.text('FIRMA:', mLeft, currentY);

      // Firma
      const firmaCand = await this.fetchAsArrayBufferOrNull(cand?.biometria?.firma?.file_url ?? this.firma);
      if (firmaCand) {
        try {
          const kind = (new Uint8Array(firmaCand)[0] === 0xFF) ? 'JPEG' : 'PNG';
          doc.addImage(new Uint8Array(firmaCand), kind, mLeft + 20, currentY - 10, 35, 20);
        } catch (e) { console.error('Error insertando firma candidato', e); }
      }

      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], '109_SAGARO_IMAGEN.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Sagaro Imagen'] = { file, fileName: '109_SAGARO_IMAGEN.pdf' };
      this.verPDF({ titulo: 'Sagaro Imagen' });

    } catch (error) {
      console.error('Error generando Sagaro Imagen:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el documento' });
    }
  }

  async generarFichaSocial() {
    try {
      const pdfBytes = await this.fetchAsArrayBufferOrNull('Docs/Ficha social.pdf');
      if (!pdfBytes) {
        Swal.fire('Error', 'No se encontró el formato Ficha social.pdf', 'error');
        return;
      }
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const form = pdfDoc.getForm();
      const cand = this.candidato;

      // Llenado completo del formulario (mapping en ficha-social-fill.ts).
      fillFichaSocialPdf(form, cand, this.vacante, this.empresa);

      // FIRMAS — en el PDF real las DOS cajas ("FIRMA DE AUTORIZACIÓN" arriba,
      // "FIRMA TRABAJADOR" abajo) son 2 widgets del MISMO campo /Btn
      // `firma_af_image`; no existe `firma_administrativa`. Ambas las firma el
      // trabajador consultado (el "DOCUMENTO No" del bloque es su cédula); la
      // firma del logueado NO va en este formato.
      // PROBLEMA: `form.flatten()` aplana los buttons con appearance vacío y pisa
      // cualquier `drawImage` previo. SOLUCIÓN: capturar los rects ANTES del
      // flatten, aplanar el formulario, y DESPUÉS dibujar la firma como imagen
      // en cada rect (ya no son form fields, no las pisa nadie).
      type FirmaRect = { x: number; y: number; width: number; height: number; pageIndex: number };

      const capturarRects = (campoBtn: string): FirmaRect[] => {
        try {
          const field: any = form.getField(campoBtn);
          const widgets: any[] = field?.acroField?.getWidgets?.() ?? [];
          const pages = pdfDoc.getPages();
          return widgets.map((widget: any) => {
            const rect = widget.getRectangle();
            // Detectar la página: los Annots guardan PDFRef, así que cada
            // entrada se resuelve con context.lookup antes de comparar.
            // Fallback 0: Ficha Social tiene 1 página.
            const ctxPdf: any = (pdfDoc as any).context;
            let pageIndex = 0;
            for (let i = 0; i < pages.length; i++) {
              const annots: any[] = (pages[i] as any).node?.Annots?.()?.asArray?.() ?? [];
              if (annots.some((a: any) => a === widget.dict || ctxPdf?.lookup?.(a) === widget.dict)) {
                pageIndex = i;
                break;
              }
            }
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, pageIndex };
          });
        } catch {
          return [];
        }
      };

      const rectsFirma = [
        ...capturarRects('firma_af_image'),
        // Por si alguna versión del formato separa las cajas en 2 campos.
        ...capturarRects('firma_administrativa'),
      ];

      aplanarFormulario(form); // Evitar que siga siendo editable (ANTES de dibujar firmas)

      if (rectsFirma.length && this.firma) {
        try {
          const bytes = await this.fetchAsArrayBufferOrNull(this.firma);
          if (bytes) {
            const u8 = new Uint8Array(bytes) as any;
            const isJpg = u8[0] === 0xFF;
            const img = isJpg ? await pdfDoc.embedJpg(u8) : await pdfDoc.embedPng(u8);
            const dims = img.scale(1);
            for (const rect of rectsFirma) {
              const scale = Math.min(rect.width / dims.width, rect.height / dims.height) * 0.95;
              const drawW = dims.width * scale;
              const drawH = dims.height * scale;
              pdfDoc.getPages()[rect.pageIndex].drawImage(img, {
                x: rect.x + (rect.width - drawW) / 2,
                y: rect.y + (rect.height - drawH) / 2,
                width: drawW,
                height: drawH,
              });
            }
          }
        } catch (e) {
          console.error('Error dibujando firma:', e);
        }
      }

      const resultBytes = await pdfDoc.save();
      const file = new File([resultBytes as any], 'FICHA_SOCIAL.pdf', { type: 'application/pdf' });
      this.uploadedFiles['Ficha Social'] = { file, fileName: 'FICHA_SOCIAL.pdf' };
      this.verPDF({ titulo: 'Ficha Social' });

    } catch (error) {
      console.error('Error generando FICHA_SOCIAL:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar la Ficha Social.' });
    }
  }

  /**
   * Autorización para el tratamiento de datos personales.
   *
   * Este documento lo emite la TEMPORAL, no la empresa usuaria: lo único que
   * decide plantilla, logo y NIT es si `this.empresa` (= `vacante.temporal`) es
   * Apoyo Laboral o Tu Alianza. Se compara con `includes` — igual que
   * `generarContratoAdministrativo()` — porque la temporal llega con variantes
   * ("APOYO LABORAL SAS", "APOYO LABORAL TS SAS", "TU ALIANZA S.A.S", …) y la
   * comparación por igualdad exacta abortaba la generación en silencio.
   */
  generarAutorizacionDatos() {
    const EMP_APOYO = 'APOYO LABORAL TS S.A.S';
    const EMP_TA = 'TU ALIANZA SAS';

    const emp = (this.empresa || '').toUpperCase().trim();
    const esApoyo = emp.includes('APOYO');
    const esAlianza = !esApoyo && emp.includes('ALIANZA');

    if (!esApoyo && !esAlianza) {
      Swal.fire(
        'Error',
        `Temporal no reconocida: "${this.empresa}". Solo APOYO LABORAL o TU ALIANZA.`,
        'error'
      );
      return;
    }

    const empresaSeleccionada = esApoyo ? EMP_APOYO : EMP_TA;
    const logoPath = esApoyo ? 'logos/Logo_AL.png' : 'logos/Logo_TA.png';
    const nit = esApoyo ? 'NIT: 900.814.587-1' : 'NIT: 900.864.596-1';

    // Documento
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: `${empresaSeleccionada}_Autorizacion_Datos.pdf`,
      author: empresaSeleccionada,
      creator: empresaSeleccionada,
    });

    // Encabezado (logo + NIT)
    const imgWidth = 27, imgHeight = 10, marginTop = 5, marginLeft = 7;
    doc.addImage(logoPath, 'PNG', marginLeft, marginTop, imgWidth, imgHeight);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(nit, marginLeft, marginTop + imgHeight + 3);
    doc.setFont('helvetica', 'normal');

    // Título
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.text(
      'AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS PERSONALES DE CANDIDATOS',
      pageWidth / 2,
      30,
      { align: 'center' }
    );

    // Márgenes y área de texto (reservamos 30 mm para firmas)
    const margenIzquierdo = 9;
    const margenDerecho = 9;
    const margenSuperior = 39; // arranca texto debajo del título
    const margenInferior = 30; // espacio fijo para firmas
    const anchoTexto = pageWidth - margenIzquierdo - margenDerecho;

    // Texto por empresa
    let parrafos: string[] = [];
    if (empresaSeleccionada === EMP_APOYO) {
      parrafos = [
        `APOYO LABORAL TS S.A.S, tratará sus datos personales, consistentes en, pero sin limitarse a, su nombre, información de contacto, fecha y lugar de nacimiento, número de identificación, estado civil, dependientes, fotografía, antecedentes de educación y empleo, referencias personales y laborales, información sobre visas y antecedentes judiciales ("Información Personal") con el fin de (1) evaluarlo como potencial empleado de APOYO LABORAL TS S.A.S; (2) evaluar y corroborar la información contenida en su hoja de vida e información sobre la experiencia profesional y trayectoria académica (3) almacenar y clasificar su Información Personal para facilitar su acceso;`,
        `(4) proporcionar información a las autoridades competentes cuando medie requerimiento de dichas autoridades en ejercicio de sus funciones y facultades legales, en cumplimiento de un deber legal o para proteger los derechos de APOYO LABORAL TS S.A.S; (5) proporcionar información a auditores internos o externos en el marco de las finalidades aquí descritas; (6) dar a conocer la realización de eventos de interés o de nuevas convocatorias para otros puestos de trabajo; (7) verificar la información aportada y adelantar todas las actuaciones necesarias, incluida la revisión de la información aportada por usted en las distintas listas de riesgos para prevenir los riesgos para APOYO LABORAL TS S.A.S a lavado de activos, financiación del terrorismo y asuntos afines, dentro del marco de implementación de su SAGRILAFT; y todas las demás actividades que sean compatibles con estas finalidades.`,
        `Para poder cumplir con las finalidades anteriormente expuestas, APOYO LABORAL TS S.A.S requiere tratar los siguientes datos personales suyos que son considerados como sensibles: género, datos biométricos y datos relacionados con su salud (“Información Personal Sensible”). Usted tiene derecho a autorizar o no la recolección y tratamiento de su Información Personal Sensible por parte de APOYO LABORAL TS S.A.S y sus encargados. No obstante, si usted no autoriza a APOYO LABORAL TS S.A.S a recolectar y hacer el tratamiento de esta Información Personal Sensible, APOYO LABORAL TS S.A.S no podrá cumplir con las finalidades del tratamiento descritas anteriormente.`,
        `Asimismo, usted entiende y autoriza a APOYO LABORAL TS S.A.S para que verifique, solicite y/o consulte su Información Personal en listas de riesgo, incluidas restrictivas y no restrictivas, así como vinculantes y no vinculantes para Colombia, a través de cualquier motor de búsqueda tales como, pero sin limitarse a, las plataformas de los entes Administradores del Sistema de Seguridad Social Integral, las Autoridades Judiciales y de Policía Nacional, la Procuraduría General de la República, la Contraloría General de la Nación o cualquier otra fuente de información legalmente constituida y/o a través de otros motores de búsqueda diseñados con miras a verificar su situación laboral actual, sus aptitudes académicas y demás información pertinente para los fines antes señalados. APOYO LABORAL TS S.A.S realizará estas gestiones directamente, o a través de sus filiales o aliados estratégicos con quienes acuerde realizar estas actividades. APOYO LABORAL TS S.A.S podrá adelantar el proceso de consulta, a partir de su Información Personal, a través de la base de datos de la Policía Nacional, Contraloría General de la República, Contraloría General de la Nación, OFAC Sanctions List Search y otras similares.`,
        `Dentro de las obligaciones que establece la ley, APOYO LABORAL TS S.A.S debe establecer si sus candidatos o sus familiares califican como Persona Expuesta Políticamente ("PEP"). Por lo anterior, en caso de que usted o algún familiar suyo ostente la calidad de PEP, o llegue a adquirirla, usted deberá comunicar tal situación a APOYO LABORAL TS S.A.S, indicando los datos de identificación de dicho familiar, el parentesco que tiene con usted, y el cargo que desempeña o desempeñó dentro de los dos (2) años anteriores. De igual forma, usted certifica que entiende a qué se refiere la palabra PEP y certifica que ni usted ni sus familiares califican como PEP y que, en caso de calificar en dicha categoría, declara haber informado tal situación a APOYO LABORAL TS S.A.S. En los casos en los que APOYO LABORAL TS S.A.S deba llevar a cabo el tratamiento de datos personales de terceros proporcionados por usted, ya sea por ser referencia suya o PEP asociado a usted, entre otros motivos, usted certifica que tal información fue suministrada con la debida autorización de esas personas para que esta fuera entregada a APOYO LABORAL TS S.A.S y tratada de conformidad su Política de Tratamiento de Datos Personales.`,
        `Asimismo, usted entiende que APOYO LABORAL TS S.A.S podrá transmitir su Información Personal e Información Personal Sensible, a (i) otras oficinas del mismo grupo corporativo de APOYO LABORAL TS S.A.S, incluso radicadas en diferentes jurisdicciones que no comporten niveles de protección de datos equivalentes a los de la legislación colombiana y a (ii) terceros a los que APOYO LABORAL TS S.A.S les encargue el tratamiento de su Información Personal e Información Personal Sensible.`,
        `De igual forma, como titular de su Información Personal e Información Personal Sensible, usted tiene derecho, entre otras, a conocer, actualizar, rectificar y a solicitar la supresión de la misma, así como a solicitar prueba de esta autorización, en cualquier tiempo, y mediante comunicación escrita dirigida al correo electrónico: protecciondedatos.tuapo@gmail.com de acuerdo al procedimiento previsto en los artículos 14 y 15 de la Ley 1581 de 2012.`,
        `En virtud de lo anterior, con su firma, APOYO LABORAL TS S.A.S podrá recolectar, almacenar, usar y en general realizar el tratamiento de su Información Personal e Información Personal Sensible, para las finalidades anteriormente expuestas, en desarrollo de la Política de Tratamiento de Datos Personales de la Firma, la cual puede ser solicitada a través de: correo electrónico protecciondedatos.tuapo@gmail.com.`
      ];
    } else {
      // Tu Alianza (sin cláusula PEP)
      parrafos = [
        `${empresaSeleccionada}, tratará sus datos personales, consistentes en, pero sin limitarse a, su nombre, información de contacto, fecha y lugar de nacimiento, número de identificación, estado civil, dependientes, fotografía, antecedentes de educación y empleo, referencias personales y laborales, información sobre visas y antecedentes judiciales ("Información Personal") con el fin de (1) evaluarlo como potencial empleado de ${empresaSeleccionada}; (2) evaluar y corroborar la información contenida en su hoja de vida e información sobre la experiencia profesional y trayectoria académica (3) almacenar y clasificar su Información Personal para facilitar su acceso;`,
        `(4) proporcionar información a las autoridades competentes cuando medie requerimiento de dichas autoridades en ejercicio de sus funciones y facultades legales, en cumplimiento de un deber legal o para proteger los derechos de ${empresaSeleccionada}; (5) proporcionar información a auditores internos o externos en el marco de las finalidades aquí descritas; (6) dar a conocer la realización de eventos de interés o de nuevas convocatorias para otros puestos de trabajo; (7) verificar la información aportada y adelantar todas las actuaciones necesarias, incluida la revisión de la información aportada por usted en las distintas listas de riesgos para prevenir los riesgos para ${empresaSeleccionada} a lavado de activos, financiación del terrorismo y asuntos afines, dentro del marco de implementación de su SAGRILAFT; y todas las demás actividades que sean compatibles con estas finalidades.`,
        `Para poder cumplir con las finalidades anteriormente expuestas, ${empresaSeleccionada} requiere tratar los siguientes datos personales suyos que son considerados como sensibles: género, datos biométricos y datos relacionados con su salud (“Información Personal Sensible”). Usted tiene derecho a autorizar o no la recolección y tratamiento de su Información Personal Sensible por parte de ${empresaSeleccionada} y sus encargados. No obstante, si usted no autoriza a ${empresaSeleccionada} a recolectar y hacer el tratamiento de esta Información Personal Sensible, ${empresaSeleccionada} no podrá cumplir con las finalidades del tratamiento descritas anteriormente.`,
        `Asimismo, usted entiende y autoriza a ${empresaSeleccionada} para que verifique, solicite y/o consulte su Información Personal en listas de riesgo, incluidas restrictivas y no restrictivas, así como vinculantes y no vinculantes para Colombia, a través de cualquier motor de búsqueda tales como, pero sin limitarse a, las plataformas de los entes Administradores del Sistema de Seguridad Social Integral, las Autoridades Judiciales y de Policía Nacional, la Procuraduría General de la República, la Contraloría General de la Nación o cualquier otra fuente de información legalmente constituida y/o a través de otros motores de búsqueda diseñados con miras a verificar su situación laboral actual, sus aptitudes académicas y demás información pertinente para los fines antes señalados. ${empresaSeleccionada} realizará estas gestiones directamente, o a través de sus filiales o aliados estratégicos con quienes acuerde realizar estas actividades. ${empresaSeleccionada} podrá adelantar el proceso de consulta, a partir de su Información Personal, a través de la base de datos de la Policía Nacional, Contraloría General de la República, Contraloría General de la Nación, OFAC Sanctions List Search y otras similares.`,
        `Asimismo, usted entiende que ${empresaSeleccionada} podrá transmitir su Información Personal e Información Personal Sensible, a (i) otras oficinas del mismo grupo corporativo de ${empresaSeleccionada}, incluso radicadas en diferentes jurisdicciones que no comporten niveles de protección de datos equivalentes a los de la legislación colombiana y a (ii) terceros a los que ${empresaSeleccionada} les encargue el tratamiento de su Información Personal e Información Personal Sensible.`,
        `De igual forma, como titular de su Información Personal e Información Personal Sensible, usted tiene derecho, entre otras, a conocer, actualizar, rectificar y a solicitar la supresión de la misma, así como a solicitar prueba de esta autorización, en cualquier tiempo, y mediante comunicación escrita dirigida al correo electrónico: protecciondedatos.tuapo@gmail.com de acuerdo al procedimiento previsto en los artículos 14 y 15 de la Ley 1581 de 2012.`,
        `En virtud de lo anterior, con su firma, ${empresaSeleccionada} podrá recolectar, almacenar, usar y en general realizar el tratamiento de su Información Personal e Información Personal Sensible, para las finalidades anteriormente expuestas, en desarrollo de la Política de Tratamiento de Datos Personales de la Firma, la cual puede ser solicitada a través de: correo electrónico protecciondedatos.tuapo@gmail.com.`
      ];
    }

    // ================== CONFIG RÁPIDA (tamaño e interlineado) ==================
    const FONT_SIZE_PT = 8.2;      // Tamaño de letra (prueba 8.0–8.8)
    const LEADING = 1.40;          // Interlineado: 1.00 (muy compacto) – 1.20 (más aire)
    const PARAGRAPH_GAP_MM = 1.5;  // Espacio entre párrafos en mm

    // Auto-ajuste opcional para forzar 1 hoja
    const ENABLE_AUTO_FIT = false; // true: reduce tamaño/interlineado si no cabe
    const MIN_FONT_PT = 6.8;
    const MIN_LEADING = 1.00;

    // ================== Helpers de composición ==================
    const MM_PER_PT = 0.352777778;
    const calcLineHeight = (fs: number, lf: number) => fs * MM_PER_PT * lf;

    // Negrita para MAYÚSCULAS, (1), (2), y nombre de empresa
    const esPalabraNegrita = (pal: string, empresa: string) =>
      pal === empresa || /^[A-ZÁÉÍÓÚÜÑ]+$/.test(pal) || /^\(\d+\)$/.test(pal);

    const renderizarLineaJustificada = (
      linea: string,
      empresa: string,
      y: number,
      anchoDisponible: number,
      ultima: boolean,
      margenX: number
    ) => {
      const palabras = linea.split(' ');
      let anchoPalabras = 0;
      const piezas = palabras.map(p => {
        const limpio = p.replace(/[.,]/g, '').trim();
        const bold = esPalabraNegrita(limpio, empresa);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        const w = doc.getTextWidth(p);
        anchoPalabras += w;
        return { p, bold, w };
      });

      const espacios = piezas.length - 1;
      const wEsp = doc.getTextWidth(' ');
      let x = margenX;

      if (ultima || espacios <= 0) {
        piezas.forEach((it, i) => {
          doc.setFont('helvetica', it.bold ? 'bold' : 'normal');
          doc.text(it.p, x, y);
          x += it.w + (i < espacios ? wEsp : 0);
        });
      } else {
        const extra = (anchoDisponible - anchoPalabras) / espacios;
        piezas.forEach((it, i) => {
          doc.setFont('helvetica', it.bold ? 'bold' : 'normal');
          doc.text(it.p, x, y);
          x += it.w + extra;
        });
      }
      doc.setFont('helvetica', 'normal');
    };

    const dividirYMedir = (fs: number, lf: number) => {
      doc.setFontSize(fs);
      let totalLineas = 0;
      parrafos.forEach(p => {
        const lines = doc.splitTextToSize(p.trim().replace(/\s+/g, ' '), anchoTexto);
        totalLineas += lines.length;
      });
      const extraParrafos = Math.max(parrafos.length - 1, 0);
      const totalAlto = totalLineas * calcLineHeight(fs, lf) + extraParrafos * PARAGRAPH_GAP_MM;
      return totalAlto;
    };

    // === Ajuste de tamaño/interlineado (solo si ENABLE_AUTO_FIT === true) ===
    let fontSize = FONT_SIZE_PT;
    let leading = LEADING;

    if (ENABLE_AUTO_FIT) {
      const altoDisponible = pageHeight - margenSuperior - margenInferior;
      let totalAlto = dividirYMedir(fontSize, leading);
      while (totalAlto > altoDisponible && (fontSize > MIN_FONT_PT || leading > MIN_LEADING)) {
        if (leading > MIN_LEADING) {
          leading = Math.max(MIN_LEADING, parseFloat((leading - 0.02).toFixed(2)));
        } else {
          fontSize = Math.max(MIN_FONT_PT, parseFloat((fontSize - 0.2).toFixed(1)));
        }
        totalAlto = dividirYMedir(fontSize, leading);
      }
    }

    // Render de párrafos
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'normal');
    const lineHeight = calcLineHeight(fontSize, leading);
    let cursorY = margenSuperior;

    const renderizarParrafo = (texto: string) => {
      const lines: string[] = doc.splitTextToSize(texto.trim().replace(/\s+/g, ' '), anchoTexto);
      lines.forEach((ln, idx) => {
        const ultima = idx === lines.length - 1;
        renderizarLineaJustificada(ln, empresaSeleccionada, cursorY, anchoTexto, ultima, margenIzquierdo);
        cursorY += lineHeight;
      });
      cursorY += PARAGRAPH_GAP_MM; // gap entre párrafos
    };

    parrafos.forEach(renderizarParrafo);

    // ===== Bloque de firmas (fijo en la misma hoja, sin solapar) =====
    const yFirmaBase = pageHeight - 24; // línea de firma
    doc.line(10, yFirmaBase, 100, yFirmaBase);

    if (this.firma !== '') {
      const firmaConPrefijo = this.firma;
      doc.addImage(firmaConPrefijo, 'PNG', 10, yFirmaBase - 30, 80, 28);
    } else {
      //Swal.fire({ icon: 'error', title: 'Error', text: 'No se encontró la firma' });
      //return;
    }

    doc.setFont('helvetica', 'bold');
    doc.text('Firma de Autorización', 10, yFirmaBase + 3);
    doc.setFont('helvetica', 'normal');

    doc.text(`Número de Identificación: ${this.cedula}`, 10, yFirmaBase + 7);


    const fechaDelContrato = this.getFechaContrato();
    const opcionesFormato: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    const fechaFormateada = fechaDelContrato.toLocaleDateString('es-ES', opcionesFormato);
    doc.text(`Fecha de Autorización: ${fechaFormateada}`, 10, yFirmaBase + 11);

    // Guardar y mostrar
    const pdfBlob = doc.output('blob');
    const fileName = `${empresaSeleccionada}_Autorizacion_Datos.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Autorización de Datos'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Autorización de Datos' });
  }

  // Función para renderizar una línea justificada y subrayarla
  renderJustifiedLineEntregaDocs(doc: jsPDF, linea: string, x: number, y: number, maxWidth: number, isLastLine: boolean) {
    const palabras = linea.split(' ');
    const totalSpaces = palabras.length - 1;

    // Medir ancho total de las palabras
    let totalWordsWidth = 0;
    palabras.forEach((word) => {
      doc.setFont('helvetica', 'normal');
      const w = this.roundTo(doc.getTextWidth(word), 3);
      totalWordsWidth += w;
    });

    let spaceWidth = this.roundTo(doc.getTextWidth(' '), 3);
    let extraSpace = spaceWidth;

    // Ajustar espacios si no es la última línea y hay más de una palabra
    if (!isLastLine && totalSpaces > 0) {
      extraSpace = (maxWidth - totalWordsWidth) / totalSpaces;
    }

    let currentX = x;
    palabras.forEach((word, i) => {
      doc.setFont('helvetica', 'normal');
      doc.text(word, currentX, y);
      if (i < totalSpaces) {
        currentX += doc.getTextWidth(word) + extraSpace;
      } else {
        currentX += doc.getTextWidth(word);
      }
    });

    // Subrayar la línea completa desde el inicio al final del texto impreso
    doc.line(x, y + 1, currentX, y + 1);
  }

  // Formatea el texto, detectando palabras en mayúsculas
  formatText(texto: string): { text: string; bold: boolean }[] {
    const words = texto.split(/(\s+)/); // Divide en palabras y espacios
    return words.map(word => {
      if (word === word.toUpperCase() && word.match(/[A-Z]/)) {
        return { text: word, bold: true };
      }
      return { text: word, bold: false };
    });
  }

  // Función para formatear la fecha actual
  obtenerFechaActual() {
    const meses = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];

    const hoy = new Date();
    const dia = hoy.getDate().toString().padStart(2, '0'); // Añadir 0 si es necesario
    const mes = meses[hoy.getMonth()]; // Obtener nombre del mes
    const anio = hoy.getFullYear().toString().slice(-2); // Últimos 2 dígitos del año

    return `${mes} ${dia}-${anio}`;
  }

  private roundTo(num: number, decimals: number) {
    return Math.round(num * (10 ** decimals)) / (10 ** decimals);
  }

  private isBoldWord(word: string) {
    return word === word.toUpperCase() && /[A-ZÁÉÍÓÚÜÑ]/.test(word);
  }

  renderJustifiedText(
    doc: jsPDF,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    // La última línea de cada párrafo NO se justifica (se alinea a la izquierda),
    // que es el comportamiento tipográfico correcto para contratos.
    justifyLastLine: boolean = false,
    /**
     * Margen inferior reservado, en mm. Con los 10 mm fijos que había antes, el
     * texto del contrato de Apoyo se pasaba UNA sola línea y arrastraba media
     * frase a la página siguiente, desperdiciando una hoja.
     */
    bottomMargin: number = 10,
    /**
     * Si se pasa, al saltar de página dibuja el encabezado de la hoja nueva y
     * devuelve el `y` donde continúa el texto. Permite que un documento fluya
     * CONTINUO entre páginas: la última línea de cada hoja queda llena y
     * justificada como cualquier otro renglón.
     */
    onPageBreak?: () => number,
  ): number {
    const pageHeight =
      (doc as any)?.internal?.pageSize?.height ??
      (doc as any)?.internal?.pageSize?.getHeight?.() ??
      279;

    // ✅ Normaliza números para evitar NaN
    x = Number(x);
    y = Number(y);
    maxWidth = Number(maxWidth);
    lineHeight = Number(lineHeight);

    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 10;
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) maxWidth = 180;
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) lineHeight = 4;

    // ✅ Normaliza texto (evita undefined/null)
    text = String(text ?? '').replace(/\r/g, '').trim().replace(/\s+/g, ' ');
    if (!text) return y; // nada que pintar

    const words = text.split(' ');
    const boldWords = words.map(w => !!this.isBoldWord(w));

    // Medición consistente de espacio
    doc.setFont('helvetica', 'normal');
    const spaceWidthNormal = doc.getTextWidth(' '); // sin roundTo para evitar NaN

    // Medir cada palabra con su estilo real (y blindar NaN)
    const wordWidths: number[] = [];
    for (let i = 0; i < words.length; i++) {
      doc.setFont('helvetica', boldWords[i] ? 'bold' : 'normal');
      const w = doc.getTextWidth(words[i]);
      wordWidths.push(Number.isFinite(w) ? w : 0);
    }

    // ── Anti-huérfana ──────────────────────────────────────────────────
    // Se cuenta cuántas líneas ocupará el bloque ANTES de dibujar. Si no cabe
    // en lo que queda de página pero le falta poco, se comprime el
    // interlineado lo justo para que entre completo.
    //
    // Sin esto el contrato arrastraba media frase a la hoja siguiente por UNA
    // línea, y bajar el margen inferior a mano nunca acertaba porque el
    // sobrante depende del largo del texto de cada candidato.
    let totalLineas = 1;
    {
      let ancho = 0;
      for (let i = 0; i < words.length; i++) {
        const w = Number.isFinite(wordWidths[i]) ? wordWidths[i] : 0;
        const sep = ancho > 0 ? spaceWidthNormal : 0;
        if (ancho + w + sep > maxWidth && ancho > 0) {
          totalLineas++;
          ancho = w;
        } else {
          ancho += w + sep;
        }
      }
    }

    // Se simula la paginación para ver cuántas líneas caen en la ÚLTIMA hoja.
    // El error anterior era intentar meter el bloque ENTERO en lo que quedaba
    // de la página actual: como el bloque abarca varias hojas, la condición
    // nunca se cumplía y la compresión no se aplicaba nunca.
    const simular = (lh: number) => {
      const cabenPrimera = Math.max(0, Math.floor(((pageHeight - bottomMargin) - y) / lh) + 1);
      if (totalLineas <= cabenPrimera) return 0; // no hay salto
      const porPagina = Math.max(1, Math.floor((pageHeight - bottomMargin - 10) / lh) + 1);
      const resto = totalLineas - cabenPrimera;
      const enUltima = resto % porPagina;
      return enUltima === 0 ? porPagina : enUltima;
    };

    // Si la última hoja recibe 1 o 2 líneas sueltas, se aprieta el interlineado
    // hasta un 12% para reabsorberlas en la hoja anterior.
    // Con `onPageBreak` la capacidad por página depende del encabezado dibujado
    // y el cálculo de `simular` no aplica: el texto simplemente fluye.
    if (!onPageBreak && simular(lineHeight) > 0 && simular(lineHeight) <= 2) {
      for (let f = 0.99; f >= 0.88; f -= 0.01) {
        if (simular(lineHeight * f) === 0) { lineHeight = lineHeight * f; break; }
      }
    }

    let currentLine: { word: string; width: number; bold: boolean }[] = [];
    let currentLineWidth = 0;

    for (let i = 0; i < words.length; i++) {
      const word = String(words[i] ?? '');
      const width = Number(wordWidths[i]);
      const bold = boldWords[i];

      const safeWidth = Number.isFinite(width) ? width : 0;
      const additionalSpace = currentLine.length > 0 ? spaceWidthNormal : 0;
      const testWidth = currentLineWidth + safeWidth + additionalSpace;

      if (testWidth > maxWidth && currentLine.length > 0) {
        // Línea completa: justificar
        this.renderJustifiedLine(doc, currentLine, x, y, maxWidth, false);
        y += lineHeight;

        if (y > pageHeight - bottomMargin) {
          doc.addPage();
          y = onPageBreak ? onPageBreak() : 10;
        }

        currentLine = [{ word, width: safeWidth, bold }];
        currentLineWidth = safeWidth;
      } else {
        currentLine.push({ word, width: safeWidth, bold });
        currentLineWidth = testWidth;
      }
    }

    // Última línea (justificar si se pide)
    if (currentLine.length > 0) {
      const canJustifyLast = justifyLastLine && currentLine.length > 1;
      this.renderJustifiedLine(doc, currentLine, x, y, maxWidth, !canJustifyLast);
    }

    return Number.isFinite(y) ? y : 10;
  }

  private renderJustifiedLine(
    doc: jsPDF,
    lineData: { word: string; width: number; bold: boolean }[],
    x: number,
    y: number,
    maxWidth: number,
    isLastLine = false
  ) {
    // ✅ Blindaje números
    x = Number(x);
    y = Number(y);
    maxWidth = Number(maxWidth);

    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 10;
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) maxWidth = 180;

    // ✅ Espacio normal
    doc.setFont('helvetica', 'normal');
    const normalSpaceWidth = doc.getTextWidth(' ');

    // ✅ Normaliza widths para que nunca sean NaN
    const safeLine = lineData.map(it => ({
      word: String(it.word ?? ''),
      bold: !!it.bold,
      width: Number.isFinite(Number(it.width)) ? Number(it.width) : 0
    }));

    const totalTextWidth = safeLine.reduce((sum, w) => sum + w.width, 0);
    const totalSpaces = safeLine.length - 1;

    // ✅ SOLO justificar si realmente hay espacio extra (si no, NO justificar)
    const extra = maxWidth - totalTextWidth;
    const shouldJustify = !isLastLine && totalSpaces > 0 && Number.isFinite(extra) && extra > 0;

    const justifySpaceWidth = shouldJustify
      ? extra / totalSpaces
      : normalSpaceWidth;

    let currentX = x;

    // ✅ Asegura última palabra alineada solo si vamos a justificar
    const lastWordWidth = safeLine[safeLine.length - 1]?.width ?? 0;
    const xLastWord = shouldJustify ? (x + maxWidth - lastWordWidth) : 0;

    for (let index = 0; index < safeLine.length; index++) {
      const item = safeLine[index];

      if (!Number.isFinite(currentX)) currentX = x;

      doc.setFont('helvetica', item.bold ? 'bold' : 'normal');
      doc.text(item.word, currentX, y);

      if (index < totalSpaces) {
        if (shouldJustify && index === totalSpaces - 1) {
          currentX = Number.isFinite(xLastWord) ? xLastWord : (currentX + item.width + justifySpaceWidth);
        } else {
          currentX += item.width + justifySpaceWidth;
        }
      } else {
        currentX += item.width;
      }
    }

    doc.setFont('helvetica', 'normal');
  }





  // Helper pequeño para HTML-safe en mensajes
  private escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  private toSafeArrayBuffer(u8: Uint8Array): ArrayBuffer {
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
  }

  // --- Helpers ---
  private norm(s: any): string {
    return String(s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private getRutaInfo(oficinas: Array<{ nombre?: string; ruta?: boolean }>, sede: string) {
    const arr = Array.isArray(oficinas) ? oficinas : [];
    const match = arr.find(o => this.norm(o?.nombre) === this.norm(sede));
    const nombreRuta = match?.nombre ?? (sede ?? '');
    const usaRuta = match == null ? '' : (match.ruta ? 'SI' : 'NO');
    return { nombreRuta, usaRuta };
  }



  // Función para convertir una cadena Base64 (con o sin prefijo) a Uint8Array
  base64ToUint8Array(base64: string): Uint8Array {
    // Verifica si la cadena contiene el prefijo y lo elimina si está presente
    const base64Data = base64.includes('data:image')
      ? base64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '')
      : base64;

    // Decodifica la cadena base64 en un binario
    const binaryString = atob(base64Data);
    const len = binaryString.length;

    // Convierte el binario en un Uint8Array
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  // Detecta PNG o JPEG por firma binaria
  private sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
    if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
      bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
      return 'image/png';
    }
    if (bytes.length >= 3 &&
      bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return 'image/jpeg';
    }
    return null;
  }

  /** Quita headers data: y duplicados, y retorna base64 “limpio” */
  private cleanBase64(raw?: string | null): string | null {
    if (!raw) return null;
    let s = String(raw).trim();
    if (!s) return null;
    // si ya viene como dataURL, separa en header + cuerpo
    if (s.startsWith('data:')) {
      const idx = s.indexOf(',');
      if (idx >= 0) s = s.slice(idx + 1);
    }
    // por si el cuerpo vuelve a empezar con data:
    s = s.replace(/^data:[^,]+,/, '');
    // quitar espacios y saltos
    s = s.replace(/\s+/g, '');
    return s;
  }

  /** Convierte base64 limpio a bytes */
  private b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Detecta tipo de imagen por “magic numbers” */
  private sniffImg(bytes: Uint8Array): 'png' | 'jpg' | null {
    if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png';
    if (bytes.length >= 2 &&
      bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg';
    return null;
  }

  /** Embebe cualquier imagen (base64/dataURL/bytes) como PNG o JPG según corresponda */
  private async embedAnyImage(
    pdfDoc: PDFDocument,
    input: string | Uint8Array | ArrayBuffer | null | undefined
  ) {
    if (!input) return null;

    let bytes: Uint8Array | null = null;
    if (typeof input === 'string') {
      const b64 = this.cleanBase64(input);
      if (!b64) return null;
      bytes = this.b64ToBytes(b64);
    } else if (input instanceof Uint8Array) {
      bytes = input;
    } else if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    }

    if (!bytes?.length) return null;

    const kind = this.sniffImg(bytes);
    try {
      if (kind === 'png') return await pdfDoc.embedPng(bytes);
      if (kind === 'jpg') return await pdfDoc.embedJpg(bytes);
      // desconocido: intento PNG y luego JPG
      try { return await pdfDoc.embedPng(bytes); }
      catch { return await pdfDoc.embedJpg(bytes); }
    } catch (e) {
      console.error('embedAnyImage failed:', e);
      return null;
    }
  }

  // === Helpers universales (puedes dejarlos como privados en la clase) ===
  private safe<T>(v: T | null | undefined, fallback = ''): string {
    return v == null ? fallback : String(v);
  }

  parseDateToDDMMYYYY(v: any): string {
    if (v === null || v === undefined) return '';

    // Si llega como string
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return '';

      // ✅ corta hora: "YYYY-MM-DDTHH:mm:ss" o "YYYY-MM-DD HH:mm:ss"
      const datePart = s.split('T')[0].split(' ')[0].trim();

      // Si viene "YYYY-MM-DD"
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;

      // Si ya viene "DD/MM/YYYY"
      const m2 = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(datePart);
      if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}`;

      // Fallback: intenta parsear igual (por si viene ISO raro)
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }

      return '';
    }

    // Si llega Date
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      const dd = String(v.getDate()).padStart(2, '0');
      const mm = String(v.getMonth() + 1).padStart(2, '0');
      const yyyy = v.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }

    // Si llega timestamp numérico
    if (typeof v === 'number') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
    }

    return '';
  }

  /** Número de documento con separador de miles: "1128324722" → "1.128.324.722". */
  private numeroDocConPuntos(v: any): string {
    const s = this.limpio(v);
    if (!/^\d+$/.test(s)) return s; // pasaporte u otros formatos: tal cual
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  private formatLongDateES(input?: string | null): string {
    if (!input) return '';
    const s = String(input).trim();
    let d: Date | null = null;

    // dd/mm/yyyy -> local
    const mDMY = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (mDMY) {
      const [, dd, mm, yyyy] = mDMY;
      d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    // yyyy-mm-dd -> local (evita UTC)
    const mYMD = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!d && mYMD) {
      const [, yyyy, mm, dd] = mYMD;
      d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    // ISO con tiempo/zonas -> conserva el día del string ignorando hora/offset
    const mISO = /^(\d{4})-(\d{2})-(\d{2})[T\s].*$/.exec(s);
    if (!d && mISO) {
      const [, yyyy, mm, dd] = mISO;
      d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    // Fallback (último recurso)
    if (!d) d = new Date(s);
    if (isNaN(d.getTime())) return '';

    return d.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  private formatMoneyCOP(n?: string | number | null): string {
    if (n == null || n === '') return '';
    const val = typeof n === 'string' ? Number(n) : n;
    if (isNaN(val)) return '';
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(val);
  }

  // Tamaño por defecto para TODOS los campos
  private readonly PDF_FONT_SIZE = 7;

  private setText(form: any, fieldName: string, value: string, font?: any, size?: number) {
    try {
      const f = form.getTextField(fieldName);
      f.setText(value ?? '');
      // Fuerza 10pt si no te pasan otro tamaño
      f.setFontSize(size ?? this.PDF_FONT_SIZE);
      if (font) f.updateAppearances(font);
    } catch {
      // campo no existe en el PDF, ignorar
    }
  }


  private setXIf(form: any, fieldName: string, cond: boolean) {
    this.setText(form, fieldName, cond ? 'X' : '');
  }

  /** Cache en memoria para assets estáticos (templates PDF + fuentes + logos + firmas). */
  private _staticAssetsCache = new Map<string, Promise<ArrayBuffer>>();

  /** Prefijos cuya respuesta es segura cachear (assets servidos del paquete). */
  private _isStaticAssetUrl(url: string): boolean {
    return /^(Docs\/|fonts\/|Imagenes\/|assets\/|logos\/|firma\/)/.test(url);
  }

  private async fetchAsArrayBufferOrNull(url?: string): Promise<ArrayBuffer | null> {
    if (!url) return null;

    // Assets estáticos → cachear la promesa para reutilizar en futuras generaciones.
    if (this._isStaticAssetUrl(url)) {
      let cached = this._staticAssetsCache.get(url);
      if (!cached) {
        cached = (async () => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`fetch failed: ${url}`);
          return res.arrayBuffer();
        })();
        // Si la promesa rechaza, removerla del cache para permitir reintento la próxima vez.
        cached.catch(() => this._staticAssetsCache.delete(url));
        this._staticAssetsCache.set(url, cached);
      }
      try {
        return await cached;
      } catch {
        return null;
      }
    }

    // URLs dinámicas (firma del candidato, foto, huella) → sin cache.
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch { return null; }
  }


  private getEmpresaInfo(plantilla?: 'APOYO' | 'ALIANZA'): { logoPath?: string; firmaPath?: string; persona?: string; nombreEmpresa?: string } {
    // Deriva desde la temporal de la vacante, salvo que el admin haya elegido
    // plantilla explícita (esa manda: logo/nombre del formato elegido).
    // El `?? ''` evita el crash cuando la vacante no trae temporal.
    const temporal = plantilla === 'APOYO' ? 'APOYO LABORAL'
      : plantilla === 'ALIANZA' ? 'TU ALIANZA'
        : (this.vacante?.temporal ?? '');

    if (temporal.includes('APOYO LABORAL')) {
      return {
        logoPath: 'logos/Logo_AL.png',
        firmaPath: 'firma/FirmaAndreaSD.png',
        nombreEmpresa: 'APOYO LABORAL TS S.A.S.',
      };
    }
    if (temporal.includes('TU ALIANZA')) {
      return {
        logoPath: 'logos/Logo_TA.png',
        firmaPath: 'firma/FirmaAndreaSD.png',
        nombreEmpresa: 'TU ALIANZA S.A.S.',
      };
    }
    // Por defecto: sin logo/firma, pero mantiene el centro/usuaria como nombre visible
    return {
      logoPath: undefined,
      firmaPath: undefined,
      persona: '',
      nombreEmpresa: ''
    };
  }

  private hijosTop5(): any[] {
    const arr: any[] = Array.isArray(this.candidato?.hijos) ? this.candidato.hijos : [];
    // filtra vacíos por nombre
    return arr.filter(h => (this.safe(h?.nombre).trim() !== '')).slice(0, 5);
  }



  // Generar documento de entrega de documentos de apoyo
  async generarEntregaDocsApoyo() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    // Carga URL → DataURL (necesario para doc.addImage en navegador)
    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null; // si no carga, omitimos la imagen
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Apoyo_Laboral_Entrega_Documentos.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10; // cursor vertical global
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    // Cuadro de logo/NIT
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    // Logo (si no carga, se omite)
    const logoData = await toDataURL('logos/Logo_AL.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    // NIT
    doc.setFontSize(7);

    // Tabla derecha del encabezado
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 44, startY + 7);

    // Líneas y columnas
    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    // Contenido columnas
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_APOYO.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_APOYO.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_APOYO.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 4;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 5;
    });

    // La plantilla v19/v26 no lleva subtítulo entre el punto 2) y la tabla.
    const startYForTable = y + 1;

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'Floraleza S.A.S\nFlores San Juan S.A.S\nFundación Fernando Borrero Caicedo\nLuisiana Farms S.A.S\nPetalia S.A.S\nThe Elite Flower S.A.S C.I', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '01 y 16 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Valor de Almuerzo $ 3.700\n\nDescuento quincenal por nómina y/o Liquidacion Final', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'Fantasy Flower S.A.S.\nMercedes S.A.S.\nWayuu Flowers S.A.S **', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '06 y 21 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Valor de Almuerzo $ 3.700\n\nDescuento quincenal por nómina y/o Liquidacion Final', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: startYForTable,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 0.5, bottom: 0.5, left: 1, right: 1 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 66 }, 1: { cellWidth: 37 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 3;

    // Notas
    doc.setFontSize(7).setFont('helvetica', 'normal');
    const noteMaxW = contentWidth;
    const nota1 = 'Nota: * Para los  centros de costo de la empresa usuaria The Elite Flower S.A.S.C.I. Carnations, Florex, Jardines de Colombia Normandía. Tinzuque, Tikiya, Chuzacá, su fecha de pago son 06 y 21 de cada mes.';
    const nota2 = '** Para los  centros de costo de la empresa usuaria Wayuu Flowers S.A.S.: Pozo Azul, Postcosecha Excellence, Belchite, su fecha de pago son 01 y 16 de cada mes';

    const l1 = doc.splitTextToSize(nota1, noteMaxW) as string[];
    doc.text(l1, marginLeft, y); y += l1.length * 3;

    const l2 = doc.splitTextToSize(nota2, noteMaxW) as string[];
    doc.text(l2, marginLeft, y); y += l2.length * 3;

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'bold');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    doc.text('SI (  X  )', 155, y);
    doc.text('NO(     )', 175, y);

    // Forma de pago
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 5;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.text('Cuál?', 130, y);
    doc.line(140, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.text('Especificar aquí...', 150, y + 10);
    }

    // Número TJT / Código
    y += 8;
    doc.setFontSize(8);
    // Cajas grises de la plantilla v19 donde van los dos datos.
    doc.setFillColor(217, 217, 217);
    doc.rect(marginLeft + 25, y - 3, 65, 6, 'F');
    doc.rect(140, y - 3, 60, 6, 'F');

    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y);
    doc.setFont('helvetica', 'normal').text('Celular', marginLeft, y + 3);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 27, y + 1);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', 110, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, 142, y + 1);
    y += 4; // advance past "Celular" at y+3

    // IMPORTANTE (justificado)
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth, margenJust = marginLeft, lineHeight = 3;
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, margenJust, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Va marcado SI por defecto.
    doc.text('SI (  x  )', 170, y);
    doc.text('NO (     )', 190, y);
    y += 4; // advance past ACEPTO line

    // Contenido final numerado
    doc.setFontSize(6.5);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales APOYO LABORAL TS S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(6.5);
    contenidoFinal.forEach((item) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 10) as string[];
      doc.text(textoLineas, marginLeft + 10, y);
      y += textoLineas.length * 2.5 + 1;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    console.log('Seguro funerario?', seguro);
    if (seguro) {
      doc.text('SI (  x  )', 170, y - 3);
      doc.text('NO (     )', 190, y - 3);
    } else {
      doc.text('SI (     )', 170, y - 3);
      doc.text('NO (  x  )', 190, y - 3);
    }

    // Nota
    y += 1;
    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const notaLines = doc.splitTextToSize(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      contentWidth - 12
    ) as string[];
    doc.text(notaLines, marginLeft + 12, y);
    y += notaLines.length * 2.5;

    // Banner "Recuerde que:"
    y += 1;
    ensureSpace(10);
    doc.setFillColor(230, 230, 230);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://www.apoyolaboralts.com', marginLeft + 95, y + 1, { url: 'http://www.apoyolaboralts.com' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 130, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 185, y + 1);
    y += 4; // advance past banner

    // DEL COLABORADOR
    y += 2;
    ensureSpace(20);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(6.5);
    const lh = 2.5;
    const gapAfterItem = 1;

    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet = marginLeft;
    const xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet, y);

      doc.setFont('helvetica', 'normal');
      const parrafos = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const partes = parrafos.length ? parrafos : [''];

      partes.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach((ln) => {
          ensureSpace(lh);
          doc.text(ln, xText, y);
          y += lh;
        });
        if (pi < partes.length - 1) y += 1;
      });

      y += gapAfterItem;
    });

    // Firma + datos
    y += 12;
    ensureSpace(50);
    const firmaLineY = y;

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 65, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 38, y - 1);
    doc.line(marginLeft + 35, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 38, y - 1);
    doc.line(marginLeft + 33, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.

    // Sello / imagen final
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 85, y - 10, 55, 18);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Apoyo_Laboral'}_Entrega_de_documentos.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción' });
  }

  async generarEntregaDocsAgricola() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    // Carga URL → DataURL (necesario para doc.addImage en navegador)
    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null; // si no carga, omitimos la imagen
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Apoyo_Laboral_Entrega_Documentos.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10; // cursor vertical global
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    // Cuadro de logo/NIT
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    // Logo (si no carga, se omite)
    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    // NIT
    doc.setFontSize(7);

    // Tabla derecha del encabezado
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 44, startY + 7);

    // Líneas y columnas
    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    // Contenido columnas
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 4;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 5;
    });

    // La plantilla TA CO-RE-6 v19 no lleva subtítulo entre el punto 2) y la
    // tabla: la tabla va inmediatamente después.
    const startYForTable = y + 1;

    // ───────── Tabla (autotable) ─────────
    const GRIS_ENCABEZADO: [number, number, number] = [128, 128, 128];
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: GRIS_ENCABEZADO, textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: GRIS_ENCABEZADO, textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: GRIS_ENCABEZADO, textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'FLORES DEL RIO & CIA S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'No cuenta con servicio de casino, se debe llevar el almuerzo', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'BOUQUETS MIXTOS SAS C.I', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'No cuenta con servicio de casino, se debe llevar el almuerzo', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'C.I AGRICOLA CARDENAL S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        {
          content: 'Valor de Almuerzo $ 8.100\nDescuento quincenal por nómina y/o Liquidacion Final',
          styles: { fontSize: 6.5, halign: H_CENTER }
        }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: startYForTable,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 66 }, 1: { cellWidth: 37 }, 2: { cellWidth: 'auto' as const } },
      // Primera línea de la celda de casino en negrita (el valor del almuerzo).
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 2 &&
          String(data.cell.raw?.content ?? '').includes('Valor de Almuerzo')) {
          data.cell.styles.fontStyle = 'normal';
        }
      },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 3;

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'bold');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Siempre SI: el descuento de casino se informa en la inducción.
    doc.text('SI (  X  )', 145, y);
    doc.text('NO(     )', 160, y);
    doc.text('No Aplica (     )', 178, y);

    // Forma de pago
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 4;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.text('Cuál?', 130, y);
    doc.line(140, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.text('Especificar aquí...', 150, y + 10);
    }

    // Número TJT / Código
    y += 8;
    doc.setFontSize(8);
    // Cajas grises de la plantilla v19 donde van los dos datos.
    doc.setFillColor(217, 217, 217);
    doc.rect(marginLeft + 25, y - 3, 65, 6, 'F');
    doc.rect(140, y - 3, 60, 6, 'F');

    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y);
    doc.setFont('helvetica', 'normal').text('Celular', marginLeft, y + 3);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 27, y + 1);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', 110, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, 142, y + 1);
    y += 4; // advance past "Celular" at y+3

    // IMPORTANTE (justificado)
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth, margenJust = marginLeft, lineHeight = 3;
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, margenJust, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Igual que el casino: en blanco, lo marca el trabajador.
    // Siempre SI: el trabajador queda informado del cambio en la inducción.
    doc.text('SI (  x  )', 170, y);
    doc.text('NO (     )', 190, y);
    y += 4; // advance past ACEPTO line

    // Contenido final numerado
    doc.setFontSize(6.5);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(6.5);
    contenidoFinal.forEach((item) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 10) as string[];
      doc.text(textoLineas, marginLeft + 10, y);
      y += textoLineas.length * 3 + 1;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    console.log('Seguro funerario?', seguro);
    if (seguro) {
      doc.text('SI (  x  )', 170, y - 3);
      doc.text('NO (     )', 190, y - 3);
    } else {
      doc.text('SI (     )', 170, y - 3);
      doc.text('NO (  x  )', 190, y - 3);
    }

    // Nota
    y += 1;
    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const notaLines = doc.splitTextToSize(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      contentWidth - 12
    ) as string[];
    doc.text(notaLines, marginLeft + 12, y);
    y += notaLines.length * 3;

    // Banner "Recuerde que:"
    y += 2;
    ensureSpace(10);
    doc.setFillColor(230, 230, 230);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 95, y + 1, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 130, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 185, y + 1);
    y += 4; // advance past banner

    // DEL COLABORADOR
    y += 2;
    ensureSpace(20);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(6.5);
    const lh = 3;
    const gapAfterItem = 1;

    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet = marginLeft;
    const xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet, y);

      doc.setFont('helvetica', 'normal');
      const parrafos = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const partes = parrafos.length ? parrafos : [''];

      partes.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach((ln) => {
          ensureSpace(lh);
          doc.text(ln, xText, y);
          y += lh;
        });
        if (pi < partes.length - 1) y += 1;
      });

      y += gapAfterItem;
    });

    // Firma + datos
    y += 16;
    ensureSpace(50);
    const firmaLineY = y;

    // Huella box removed for this PDF type

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 65, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 38, y - 1);
    doc.line(marginLeft + 35, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 38, y - 1);
    doc.line(marginLeft + 33, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.

    // Sello / imagen final
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 85, y - 10, 55, 18);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Apoyo_Laboral'}_Entrega_documentos_Agricola.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Agrícola'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Agrícola' });
  }

  async generarEntregaDocsJardinez() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    // Carga URL → DataURL (necesario para doc.addImage en navegador)
    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null; // si no carga, omitimos la imagen
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Apoyo_Laboral_Entrega_Documentos.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10; // cursor vertical global
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    // Cuadro de logo/NIT
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    // Logo (si no carga, se omite)
    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    // NIT
    doc.setFontSize(7);

    // Tabla derecha del encabezado
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 44, startY + 7);

    // Líneas y columnas
    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    // Contenido columnas
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 5;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 4;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 4;
    });

    // La plantilla v19/v26 no lleva subtítulo entre el punto 2) y la tabla.
    const startYForTable = y + 1;

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'C.I JARDINES DE LOS ANDES S.A.S.', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', rowSpan: 7, styles: { fontSize: 6.5, halign: H_CENTER, valign: 'middle' } },
        { content: 'Valor de Almuerzo $ 3.800\nDescuento quincenal por nómina y/o Liquidación Final', rowSpan: 6, styles: { fontSize: 6.5, halign: H_CENTER, valign: 'middle' } }
      ],
      [
        { content: 'AMANCAY S.A.S.', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'VALMAR PRODUCTORA S.A.S.', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'C.I CALAFATE S.A.S.', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'FLORES CAMPO VERDE S.A.S.', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'HMVE S.A.S. (Valmar)', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'HMVE S.A.S. (Yundama y Curubital)', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'No cuenta con servicio de casino, se debe llevar el almuerzo', styles: { fontSize: 6.5, halign: H_CENTER, valign: 'middle' } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: startYForTable,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 45 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 4;

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'italic');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    // Siempre SI: el descuento de casino se informa en la inducción.
    doc.text('SI (  X  )', 145, y);
    doc.text('NO (     )', 160, y);
    doc.text('No Aplica(     )', 178, y);

    // Forma de pago
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 4;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.text('Cuál?', 130, y);
    doc.line(140, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.text('Especificar aquí...', 150, y + 10);
    }

    // Número TJT / Código
    y += 8;
    doc.setFontSize(7.5);
    // Cajas grises de la plantilla v19 donde van los dos datos.
    doc.setFillColor(217, 217, 217);
    doc.rect(marginLeft + 25, y - 3, 65, 6, 'F');
    doc.rect(140, y - 3, 60, 6, 'F');

    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y);
    doc.setFont('helvetica', 'normal').text('Celular', marginLeft, y + 3);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 27, y + 1);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', 110, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, 142, y + 1);
    y += 4; // advance past "Celular" at y+3

    // IMPORTANTE (justificado)
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth, margenJust = marginLeft, lineHeight = 3;
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, margenJust, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Siempre SI: el trabajador queda informado del cambio en la inducción.
    doc.text('SI (  x  )', 165, y);
    doc.text('NO (     )', 180, y);
    y += 4; // advance past ACEPTO line

    // Contenido final numerado
    doc.setFontSize(6.5);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 dias para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(6.5);
    contenidoFinal.forEach((item) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 10) as string[];
      doc.text(textoLineas, marginLeft + 10, y);
      y += textoLineas.length * 3 + 1;
    });

    // SI / NO del seguro (on same line as last item 9)
    const seguro = !!contrato?.seguro_funerario;
    console.log('Seguro funerario?', seguro);
    if (seguro) {
      doc.text('SI (  x  )', 170, y - 3);
      doc.text('NO (     )', 190, y - 3);
    } else {
      doc.text('SI (     )', 170, y - 3);
      doc.text('NO (  x  )', 190, y - 3);
    }

    // Nota
    y += 1;
    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const notaLines = doc.splitTextToSize(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      contentWidth - 12
    ) as string[];
    doc.text(notaLines, marginLeft + 12, y);
    y += notaLines.length * 3;

    // Banner "Recuerde que:"
    y += 2;
    ensureSpace(10);
    doc.setFillColor(230, 230, 230);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://www.tualianza.co', marginLeft + 95, y + 1, { url: 'http://www.tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 120, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 185, y + 1);
    y += 4; // advance past banner

    // DEL COLABORADOR
    y += 2;
    ensureSpace(20);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(6.5);
    const lh = 3;
    const gapAfterItem = 1;

    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet = marginLeft;
    const xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet, y);

      doc.setFont('helvetica', 'normal');
      const parrafos = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const partes = parrafos.length ? parrafos : [''];

      partes.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach((ln) => {
          ensureSpace(lh);
          doc.text(ln, xText, y);
          y += lh;
        });
        if (pi < partes.length - 1) y += 1;
      });

      y += gapAfterItem;
    });

    // Firma + datos
    y += 16;
    ensureSpace(50);
    const firmaLineY = y;

    // Huella box removed for this PDF type

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 65, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 38, y - 1);
    doc.line(marginLeft + 35, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 38, y - 1);
    doc.line(marginLeft + 33, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.

    // Sello / imagen final
    const selloData = await toDataURL('firma/FirmaEntregaDocTuAlianza.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 85, y - 10, 55, 18);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Apoyo_Laboral'}_Entrega_documentos_Jardines.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Jardines de los Andes'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Jardines de los Andes' });
  }


  async generarEntregaDocsTuAlianzaSAGARO() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    // Carga URL → DataURL (necesario para doc.addImage en navegador)
    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null; // si no carga, omitimos la imagen
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_Documentos_Sagaro.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10; // cursor vertical global
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    // Cuadro de logo/NIT
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    // Logo (si no carga, se omite)
    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    // NIT
    doc.setFontSize(7);

    // Tabla derecha del encabezado
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 40, startY + 7);

    // Líneas y columnas
    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    // Contenido columnas
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 4;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 5;
    });

    // La plantilla v19 no lleva subtítulo entre el punto 2) y la tabla.
    const startYForTable = y + 1;

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'FLORES SÁGARO S.A', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Valor de Almuerzo $ 4.077\nDescuento quincenal por nómina y/o Liquidacion Final', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: startYForTable,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 45 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 3;

    // (Sin notas para Sagaro)
    doc.setFontSize(7).setFont('helvetica', 'normal');

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'bold');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    doc.text('SI (  X  )', 155, y);
    doc.text('NO(     )', 175, y);

    // Forma de pago
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 4;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.text('Cuál?', 130, y);
    doc.line(140, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.text('Especificar aquí...', 150, y + 10);
    }

    // Número TJT / Código
    y += 8;
    doc.setFontSize(8);
    // Cajas grises de la plantilla v19 donde van los dos datos.
    doc.setFillColor(217, 217, 217);
    doc.rect(marginLeft + 25, y - 3, 65, 6, 'F');
    doc.rect(140, y - 3, 60, 6, 'F');

    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y);
    doc.setFont('helvetica', 'normal').text('Celular', marginLeft, y + 3);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 27, y + 1);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', 110, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, 142, y + 1);
    y += 4; // advance past "Celular" at y+3

    // IMPORTANTE (justificado)
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth, margenJust = marginLeft, lineHeight = 3;
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, margenJust, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Igual que el casino: en blanco, lo marca el trabajador.
    // Siempre SI: el trabajador queda informado del cambio en la inducción.
    doc.text('SI (  x  )', 170, y);
    doc.text('NO (     )', 190, y);
    y += 4; // advance past ACEPTO line

    // Contenido final numerado
    doc.setFontSize(6.5);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(6.5);
    contenidoFinal.forEach((item) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 10) as string[];
      doc.text(textoLineas, marginLeft + 10, y);
      y += textoLineas.length * 3 + 1;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    console.log('Seguro funerario?', seguro);
    if (seguro) {
      doc.text('SI (  x  )', 170, y - 3);
      doc.text('NO (     )', 190, y - 3);
    } else {
      doc.text('SI (     )', 170, y - 3);
      doc.text('NO (  x  )', 190, y - 3);
    }

    // Nota
    y += 1;
    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const notaLines = doc.splitTextToSize(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      contentWidth - 12
    ) as string[];
    doc.text(notaLines, marginLeft + 12, y);
    y += notaLines.length * 3;

    // Banner "Recuerde que:"
    y += 2;
    ensureSpace(10);
    doc.setFillColor(230, 230, 230);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 95, y + 1, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 125, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 180, y + 1);
    y += 4; // advance past banner

    // DEL COLABORADOR
    y += 2;
    ensureSpace(20);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(6.5);
    const lh = 3;
    const gapAfterItem = 1;

    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet = marginLeft;
    const xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet, y);

      doc.setFont('helvetica', 'normal');
      const parrafos = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const partes = parrafos.length ? parrafos : [''];

      partes.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach((ln) => {
          ensureSpace(lh);
          doc.text(ln, xText, y);
          y += lh;
        });
        if (pi < partes.length - 1) y += 1;
      });

      y += gapAfterItem;
    });

    // Firma + datos
    y += 16;
    ensureSpace(50);
    const firmaLineY = y;

    // Huella box removed for this PDF type

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 65, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 38, y - 1);
    doc.line(marginLeft + 35, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 38, y - 1);
    doc.line(marginLeft + 33, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.

    // Sello / imagen final
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 85, y - 10, 55, 18);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Sagaro.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Sagaro'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Sagaro' });
  }

  async generarEntregaDocsTuAlianzaFloresAndes() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    // Carga URL → DataURL (necesario para doc.addImage en navegador)
    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null; // si no carga, omitimos la imagen
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_Documentos_Flores_Andes.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10; // cursor vertical global
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    // Cuadro de logo/NIT
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    // Logo (si no carga, se omite)
    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    // NIT
    doc.setFontSize(7);

    // Tabla derecha del encabezado
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 40, startY + 7);

    // Líneas y columnas
    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    // Contenido columnas
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 4;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 5;
    });

    // La plantilla v19 no lleva subtítulo entre el punto 2) y la tabla.
    const startYForTable = y + 1;

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'FLORES DE LOS ANDES S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '05 y 20 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Monteverde, Flores de los Andes NO ofrece servicio de casino, por lo\ntanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: startYForTable,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 45 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 3;

    // (Sin notas para Sagaro)
    doc.setFontSize(7).setFont('helvetica', 'normal');

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'bold');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('No Aplica ( X )', 145, y);

    // Forma de pago
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 4;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.text('Cuál?', 130, y);
    doc.line(140, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.text('Especificar aquí...', 150, y + 10);
    }

    // Número TJT / Código
    y += 8;
    doc.setFontSize(8);
    // Cajas grises de la plantilla v19 donde van los dos datos.
    doc.setFillColor(217, 217, 217);
    doc.rect(marginLeft + 25, y - 3, 65, 6, 'F');
    doc.rect(140, y - 3, 60, 6, 'F');

    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y);
    doc.setFont('helvetica', 'normal').text('Celular', marginLeft, y + 3);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 27, y + 1);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', 110, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, 142, y + 1);
    y += 4; // advance past "Celular" at y+3

    // IMPORTANTE (justificado)
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth, margenJust = marginLeft, lineHeight = 3;
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, margenJust, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Igual que el casino: en blanco, lo marca el trabajador.
    // Siempre SI: el trabajador queda informado del cambio en la inducción.
    doc.text('SI (  x  )', 170, y);
    doc.text('NO (     )', 190, y);
    y += 4; // advance past ACEPTO line

    // Contenido final numerado
    doc.setFontSize(6.5);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL_FLORES_ANDES
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(6.5);
    contenidoFinal.forEach((item) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 10) as string[];
      doc.text(textoLineas, marginLeft + 10, y);
      y += textoLineas.length * 3 + 1;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    console.log('Seguro funerario?', seguro);
    if (seguro) {
      doc.text('SI (  x  )', 170, y - 3);
      doc.text('NO (     )', 190, y - 3);
    } else {
      doc.text('SI (     )', 170, y - 3);
      doc.text('NO (  x  )', 190, y - 3);
    }

    // Nota
    y += 1;
    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const notaLines = doc.splitTextToSize(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      contentWidth - 12
    ) as string[];
    doc.text(notaLines, marginLeft + 12, y);
    y += notaLines.length * 3;

    // Banner "Recuerde que:"
    y += 2;
    ensureSpace(10);
    doc.setFillColor(230, 230, 230);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 95, y + 1, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 125, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 180, y + 1);
    y += 4; // advance past banner

    // DEL COLABORADOR
    y += 2;
    ensureSpace(20);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(6.5);
    const lh = 3;
    const gapAfterItem = 1;

    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet = marginLeft;
    const xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet, y);

      doc.setFont('helvetica', 'normal');
      const parrafos = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const partes = parrafos.length ? parrafos : [''];

      partes.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach((ln) => {
          ensureSpace(lh);
          doc.text(ln, xText, y);
          y += lh;
        });
        if (pi < partes.length - 1) y += 1;
      });

      y += gapAfterItem;
    });

    // Firma + datos
    y += 16;
    ensureSpace(50);
    const firmaLineY = y;

    // Huella box removed for this PDF type

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 65, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 38, y - 1);
    doc.line(marginLeft + 35, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 38, y - 1);
    doc.line(marginLeft + 33, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.

    // Sello / imagen final
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 85, y - 10, 55, 18);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Flores_de_los_andes.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Flores de los Andes'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Flores de los Andes' });
  }

  async generarEntregaDocsTuAlianzaIpanema() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    // Carga URL → DataURL (necesario para doc.addImage en navegador)
    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null; // si no carga, omitimos la imagen
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_Documentos_Ipanema.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10; // cursor vertical global
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    // Cuadro de logo/NIT
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    // Logo (si no carga, se omite)
    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    // NIT
    doc.setFontSize(7);

    // Tabla derecha del encabezado
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 40, startY + 7);

    // Líneas y columnas
    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    // Contenido columnas
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 4;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 5;
    });

    // La plantilla v19 no lleva subtítulo entre el punto 2) y la tabla.
    const startYForTable = y + 1;

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'FLORES IPANEMA S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Valor de Almuerzo $ 6.040\nDescuento quincenal por nómina y/o Liquidacion Final', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: startYForTable,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 45 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 3;

    // (Ipanema no lleva notas bajo la tabla)
    doc.setFontSize(7).setFont('helvetica', 'normal');

    // Autorización casino: sale marcada en SI, igual que el resto de las
    // inducciones — el descuento se informa en la inducción. La plantilla
    // TA CO-RE-6 v19 solo tiene SI/NO, sin la tercera opción 'No Aplica'.
    doc.setFontSize(8).setFont('helvetica', 'italic');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 155, y);

    // Forma de pago
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 4;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.text('Cuál?', 130, y);
    doc.line(140, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.text('Especificar aquí...', 150, y + 10);
    }

    // Número TJT / Código
    y += 8;
    doc.setFontSize(8);
    // Cajas grises de la plantilla v19 donde van los dos datos.
    doc.setFillColor(217, 217, 217);
    doc.rect(marginLeft + 25, y - 3, 65, 6, 'F');
    doc.rect(140, y - 3, 60, 6, 'F');

    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y);
    doc.setFont('helvetica', 'normal').text('Celular', marginLeft, y + 3);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 27, y + 1);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', 110, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, 142, y + 1);
    y += 4; // advance past "Celular" at y+3

    // IMPORTANTE (justificado)
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth, margenJust = marginLeft, lineHeight = 3;
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, margenJust, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Igual que el casino: en blanco, lo marca el trabajador.
    // Siempre SI: el trabajador queda informado del cambio en la inducción.
    doc.text('SI (  x  )', 170, y);
    doc.text('NO (     )', 190, y);
    y += 4; // advance past ACEPTO line

    // Contenido final numerado
    doc.setFontSize(6.5);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(6.5);
    contenidoFinal.forEach((item) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 10) as string[];
      doc.text(textoLineas, marginLeft + 10, y);
      y += textoLineas.length * 3 + 1;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    console.log('Seguro funerario?', seguro);
    if (seguro) {
      doc.text('SI (  x  )', 170, y - 3);
      doc.text('NO (     )', 190, y - 3);
    } else {
      doc.text('SI (     )', 170, y - 3);
      doc.text('NO (  x  )', 190, y - 3);
    }

    // Nota
    y += 1;
    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const notaLines = doc.splitTextToSize(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      contentWidth - 12
    ) as string[];
    doc.text(notaLines, marginLeft + 12, y);
    y += notaLines.length * 3;

    // Banner "Recuerde que:"
    y += 2;
    ensureSpace(10);
    doc.setFillColor(230, 230, 230);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 95, y + 1, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 125, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 180, y + 1);
    y += 4; // advance past banner

    // DEL COLABORADOR
    y += 2;
    ensureSpace(20);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(6.5);
    const lh = 3;
    const gapAfterItem = 1;

    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet = marginLeft;
    const xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet, y);

      doc.setFont('helvetica', 'normal');
      const parrafos = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const partes = parrafos.length ? parrafos : [''];

      partes.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach((ln) => {
          ensureSpace(lh);
          doc.text(ln, xText, y);
          y += lh;
        });
        if (pi < partes.length - 1) y += 1;
      });

      y += gapAfterItem;
    });

    // Firma + datos
    y += 16;
    ensureSpace(50);
    const firmaLineY = y;

    // Huella box removed for this PDF type

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 65, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 38, y - 1);
    doc.line(marginLeft + 35, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 38, y - 1);
    doc.line(marginLeft + 33, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.

    // Sello / imagen final
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 85, y - 10, 55, 18);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Ipanema.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Ipanema'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Ipanema' });
  }

  async generarEntregaDocsTuAlianzaIpanemaForaneos() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    // Carga URL → DataURL (necesario para doc.addImage en navegador)
    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null; // si no carga, omitimos la imagen
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_Documentos_Ipanema_Foraneos.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10; // cursor vertical global
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    // Cuadro de logo/NIT
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    // Logo (si no carga, se omite)
    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    // NIT
    doc.setFontSize(7);

    // Tabla derecha del encabezado
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES IPANEMA FORÁNEOS', tableStartX + 30, startY + 7);

    // Líneas y columnas
    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    // Contenido columnas
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 4;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 5;
    });

    // La plantilla v19 no lleva subtítulo entre el punto 2) y la tabla.
    const startYForTable = y + 1;

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [128, 128, 128], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'FLORES IPANEMA S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '05 y 20 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Valor de Almuerzo $ 6.040\nDescuento quincenal por nómina y/o Liquidacion Final', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: startYForTable,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 45 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalYTabla = (doc as any).lastAutoTable?.finalY ?? (startYForTable + 30);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalYTabla, pageWidth - rightMargin, finalYTabla);

    y = finalYTabla + 3;

    // (Sin notas para Sagaro)
    doc.setFontSize(7).setFont('helvetica', 'normal');

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'italic');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 155, y);
    doc.text('No Aplica (   )', 170, y);

    // Forma de pago
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 4;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 20, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 60, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.text('Cuál?', 130, y);
    doc.line(140, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.text('Especificar aquí...', 150, y + 10);
    }

    // Número TJT / Código
    y += 8;
    doc.setFontSize(8);
    // Cajas grises de la plantilla v19 donde van los dos datos.
    doc.setFillColor(217, 217, 217);
    doc.rect(marginLeft + 25, y - 3, 65, 6, 'F');
    doc.rect(140, y - 3, 60, 6, 'F');

    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y);
    doc.setFont('helvetica', 'normal').text('Celular', marginLeft, y + 3);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 27, y + 1);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', 110, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, 142, y + 1);
    y += 4; // advance past "Celular" at y+3

    // IMPORTANTE (justificado)
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth, margenJust = marginLeft, lineHeight = 3;
    doc.setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, margenJust, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    // Igual que el casino: en blanco, lo marca el trabajador.
    // Siempre SI: el trabajador queda informado del cambio en la inducción.
    doc.text('SI (  x  )', 170, y);
    doc.text('NO (     )', 190, y);
    y += 4; // advance past ACEPTO line

    // Contenido final numerado
    doc.setFontSize(6.5);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(6.5);
    contenidoFinal.forEach((item) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 10) as string[];
      doc.text(textoLineas, marginLeft + 10, y);
      y += textoLineas.length * 3 + 1;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    console.log('Seguro funerario?', seguro);
    if (seguro) {
      doc.text('SI (  x  )', 170, y - 3);
      doc.text('NO (     )', 190, y - 3);
    } else {
      doc.text('SI (     )', 170, y - 3);
      doc.text('NO (  x  )', 190, y - 3);
    }

    // Nota
    y += 1;
    doc.setFont('helvetica', 'bold').text('Nota:', marginLeft, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const notaLines = doc.splitTextToSize(
      'Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.',
      contentWidth - 12
    ) as string[];
    doc.text(notaLines, marginLeft + 12, y);
    y += notaLines.length * 3;

    // Banner "Recuerde que:"
    y += 2;
    ensureSpace(10);
    doc.setFillColor(230, 230, 230);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que:', marginLeft + 2, y + 1);
    doc.setFont('helvetica', 'normal').setTextColor(0, 0, 0);
    doc.text('Puede encontrar esta información disponible en:', marginLeft + 25, y + 1);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 95, y + 1, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 125, y + 1);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 180, y + 1);
    y += 4; // advance past banner

    // DEL COLABORADOR
    y += 2;
    ensureSpace(20);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí  el curso de inducción General y de Seguridad y Salud en el Trabajo, así como  el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(6.5);
    const lh = 3;
    const gapAfterItem = 1;

    doc.setFont('helvetica', 'bold');
    const bulletBoxWidth =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet = marginLeft;
    const xText = xBullet + bulletBoxWidth;
    const availWidth = pageWidth - rightMargin - xText;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet, y);

      doc.setFont('helvetica', 'normal');
      const parrafos = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const partes = parrafos.length ? parrafos : [''];

      partes.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, availWidth) as string[];
        lines.forEach((ln) => {
          ensureSpace(lh);
          doc.text(ln, xText, y);
          y += lh;
        });
        if (pi < partes.length - 1) y += 1;
      });

      y += gapAfterItem;
    });

    // Firma + datos
    y += 16;
    ensureSpace(50);
    const firmaLineY = y;

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 65, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 38, y - 1);
    doc.line(marginLeft + 35, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 38, y - 1);
    doc.line(marginLeft + 33, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.

    // Sello / imagen final
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 85, y - 10, 55, 18);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlobForaneos = doc.output('blob');
    const fileNameForaneos = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Ipanema_Foraneos.pdf`;
    const pdfFileForaneos = new File([pdfBlobForaneos], fileNameForaneos, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Ipanema Foráneos'] = { file: pdfFileForaneos, fileName: fileNameForaneos };
    this.verPDF({ titulo: 'Inducción Ipanema Foráneos' });
  }

  async generarEntregaDocsTuAlianzaAdministrativos() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null;
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_documentos_Administrativos.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10;
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    doc.setFontSize(7);
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES ADMINISTRATIVOS', tableStartX + 30, startY + 7);

    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 6;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 6;
    });

    // Forma de pago
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('FORMA DE PAGO:', marginLeft, y);
    y += 5;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 30, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 75, y: y },
      { nombre: 'Otra', x: marginLeft + 125, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'bold').setFontSize(7).text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('Cuál?', 150, y);
    doc.line(160, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.setFont('helvetica', 'normal').text('Especificar aquí...', 160, y - 1);
    }

    // Nomor / Codigo
    y += 8;

    // Grey backgrounds as per image
    doc.setFillColor(220, 220, 220); // light gray
    doc.rect(marginLeft + 18, y - 4, 65, 5, 'F');
    doc.rect(marginLeft + 108, y - 4, 85, 5, 'F');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y - 1);
    doc.setFont('helvetica', 'bold').text('Celular', marginLeft, y + 2.5);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 21, y);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', marginLeft + 85, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, marginLeft + 110, y);
    y += 7;

    // IMPORTANTE (justificado)
    y += 3;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth;
    const lineHeight = 3.5;
    doc.setFont('helvetica', 'italic');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, marginLeft, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 4;
    doc.setFont('helvetica', 'normal').setFontSize(7);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 160, y);
    y += 6;

    // Contenido final numerado
    doc.setFontSize(7);
    const contenidoFinal = [
      { numero: '3)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '4)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '5)', texto: 'Capacitación e inducción de labores y responsabilidades generales específicas del cargo a desempeñar.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(7);
    contenidoFinal.forEach((item) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 5) as string[];
      doc.text(textoLineas, marginLeft + 4, y);
      y += textoLineas.length * 3.5 + 2;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    y -= 3.5;
    doc.setFont('helvetica', 'bold');
    if (seguro) {
      doc.text('SI ( x )', 140, y);
      doc.text('NO (   )', 160, y);
    } else {
      doc.text('SI (   )', 140, y);
      doc.text('NO ( x )', 160, y);
    }

    // Nota
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const notaText = 'Nota: Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.';
    doc.text(notaText, marginLeft, y);
    y += 5;

    // Banner "Recuerde que:"
    ensureSpace(10);
    doc.setFillColor(220, 220, 220);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que: Puede encontrar esta información disponible en:', marginLeft + 2, y + 1.5);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 80, y + 1.5, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 105, y + 1.5);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 160, y + 1.5);
    y += 7;

    // DEL COLABORADOR
    ensureSpace(35);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibi lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí el curso de inducción General y de Seguridad y Salud en el Trabajo, así como el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(7);
    const lh2 = 3.5;
    const gapAfterItem2 = 2;

    const bulletBoxWidth2 =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet2 = marginLeft;
    const xText2 = xBullet2 + bulletBoxWidth2;
    const availWidth2 = pageWidth - rightMargin - xText2;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet2, y);

      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(texto, availWidth2) as string[];
      lines.forEach((ln) => {
        ensureSpace(lh2);
        doc.text(ln, xText2, y);
        y += lh2;
      });
      y += gapAfterItem2;
    });

    // Firma + datos
    y += 18;
    ensureSpace(35);
    const firmaLineY = y;

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 60, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 32, y - 1);
    doc.line(marginLeft + 30, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido_', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 28, y - 1);
    doc.line(marginLeft + 26, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.
    // Sello
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 135, y - 17, 50, 16);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Administrativos.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Administrativos'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Administrativos' });
  }

  async generarEntregaDocsTuAlianzaRebano() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null;
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_documentos_Rebano.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10;
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    doc.setFontSize(7);
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 40, startY + 7);

    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 5;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 6;
    });

    // Subtítulo tabla (not present exactly as sub-text in Rebaño but we draw the table directly)

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'FLORES EL REBAÑO S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Servicio Opcional Valor de Almuerzo $ 6.500\nDescuento quincenal por Nómina y/o Liquidación Final. El trabajador\npuede llevar Almuerzo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: y,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 35 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (y + 20);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 4;

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'italic');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 155, y);

    // Forma de pago
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 5;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 25, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 65, y: y },
      { nombre: 'Otra', x: marginLeft + 115, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').setFontSize(7).text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('Cuál?', 138, y);
    doc.line(150, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.setFont('helvetica', 'normal').text('Especificar aquí...', 150, y - 1);
    }

    // Nomor / Codigo
    y += 8;

    // Grey backgrounds 
    doc.setFillColor(220, 220, 220); // light gray
    doc.rect(marginLeft + 18, y - 4, 60, 5, 'F');
    doc.rect(marginLeft + 105, y - 4, 90, 5, 'F');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y - 1);
    doc.setFont('helvetica', 'bold').text('Celular', marginLeft, y + 2.5);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 21, y);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', marginLeft + 80, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, marginLeft + 105, y);
    y += 7;

    // IMPORTANTE (justificado)
    y += 3;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth;
    const lineHeight = 3.5;
    doc.setFont('helvetica', 'italic');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, marginLeft, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 4;
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 160, y);
    y += 6;

    // Contenido final numerado
    doc.setFontSize(7);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(7);
    contenidoFinal.forEach((item) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 5) as string[];
      doc.text(textoLineas, marginLeft + 4, y);
      y += textoLineas.length * 3.5 + 2;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    y -= 3.5;
    doc.setFont('helvetica', 'bold');
    if (seguro) {
      doc.text('SI ( x )', 140, y);
      doc.text('NO (   )', 160, y);
    } else {
      doc.text('SI (   )', 140, y);
      doc.text('NO ( x )', 160, y);
    }

    // Nota
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const notaText = 'Nota: Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.';
    doc.text(notaText, marginLeft, y);
    y += 5;

    // Banner "Recuerde que:"
    ensureSpace(10);
    doc.setFillColor(220, 220, 220);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que: Puede encontrar esta información disponible en:', marginLeft + 2, y + 1.5);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 80, y + 1.5, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 105, y + 1.5);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 160, y + 1.5);
    y += 7;

    // DEL COLABORADOR
    ensureSpace(35);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí el curso de inducción General y de Seguridad y Salud en el Trabajo, así como el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(7);
    const lh2 = 3.5;
    const gapAfterItem2 = 2;

    const bulletBoxWidth2 =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet2 = marginLeft;
    const xText2 = xBullet2 + bulletBoxWidth2;
    const availWidth2 = pageWidth - rightMargin - xText2;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet2, y);

      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(texto, availWidth2) as string[];
      lines.forEach((ln) => {
        ensureSpace(lh2);
        doc.text(ln, xText2, y);
        y += lh2;
      });
      y += gapAfterItem2;
    });

    // Firma + datos
    y += 18;
    ensureSpace(35);
    const firmaLineY = y;

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 60, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 32, y - 1);
    doc.line(marginLeft + 30, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido_', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 28, y - 1);
    doc.line(marginLeft + 26, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.
    // Sello
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 135, y - 17, 50, 16);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Rebano.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Rebaño'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Rebaño' });
  }

  async generarEntregaDocsTuAlianzaMelody() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null;
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_documentos_Melody.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10;
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    doc.setFontSize(7);
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 40, startY + 7);

    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 7;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 5;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 6;
    });

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'MELODY FLOWERS S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontSize: 6.5, halign: H_CENTER } },
        { content: 'Servicio Opcional Valor de Almuerzo $ 7.500\nDescuento quincenal por Nómina y/o Liquidación Final. El trabajador\npuede llevar Almuerzo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: y,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 35 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (y + 20);
    doc.setDrawColor(0).setLineWidth(0.2);
    doc.line(leftMargin, finalY, pageWidth - rightMargin, finalY);

    y = finalY + 4;

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'italic');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 155, y);

    // Forma de pago
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 5;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 25, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 65, y: y },
      { nombre: 'Otra', x: marginLeft + 115, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').setFontSize(7).text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('Cuál?', 140, y);
    doc.line(150, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.setFont('helvetica', 'normal').text('Especificar aquí...', 150, y - 1);
    }

    // Nomor / Codigo
    y += 8;

    // Grey backgrounds 
    doc.setFillColor(220, 220, 220); // light gray
    doc.rect(marginLeft + 18, y - 4, 60, 5, 'F');
    doc.rect(marginLeft + 105, y - 4, 90, 5, 'F');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y - 1);
    doc.setFont('helvetica', 'bold').text('Celular', marginLeft, y + 2.5);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 21, y);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', marginLeft + 80, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, marginLeft + 105, y);
    y += 7;

    // IMPORTANTE (justificado)
    y += 3;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth;
    const lineHeight = 3.5;
    doc.setFont('helvetica', 'italic');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, marginLeft, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 4;
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 160, y);
    y += 6;

    // Contenido final numerado
    doc.setFontSize(7);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales TU ALIANZA S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(7);
    contenidoFinal.forEach((item) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 5) as string[];
      doc.text(textoLineas, marginLeft + 4, y);
      y += textoLineas.length * 3.5 + 2;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    y -= 3.5;
    doc.setFont('helvetica', 'bold');
    if (seguro) {
      doc.text('SI ( x )', 140, y);
      doc.text('NO (   )', 160, y);
    } else {
      doc.text('SI (   )', 140, y);
      doc.text('NO ( x )', 160, y);
    }

    // Nota
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const notaText = 'Nota: Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.';
    doc.text(notaText, marginLeft, y);
    y += 5;

    // Banner "Recuerde que:"
    ensureSpace(10);
    doc.setFillColor(220, 220, 220);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que: Puede encontrar esta información disponible en:', marginLeft + 2, y + 1.5);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 80, y + 1.5, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 105, y + 1.5);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 160, y + 1.5);
    y += 7;

    // DEL COLABORADOR
    ensureSpace(35);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí el curso de inducción General y de Seguridad y Salud en el Trabajo, así como el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(7);
    const lh2 = 3.5;
    const gapAfterItem2 = 2;

    const bulletBoxWidth2 =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet2 = marginLeft;
    const xText2 = xBullet2 + bulletBoxWidth2;
    const availWidth2 = pageWidth - rightMargin - xText2;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet2, y);

      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(texto, availWidth2) as string[];
      lines.forEach((ln) => {
        ensureSpace(lh2);
        doc.text(ln, xText2, y);
        y += lh2;
      });
      y += gapAfterItem2;
    });

    // Firma + datos
    y += 18;
    ensureSpace(35);
    const firmaLineY = y;

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 60, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 32, y - 1);
    doc.line(marginLeft + 30, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido_', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 28, y - 1);
    doc.line(marginLeft + 26, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.
    // Sello
    const selloData = await toDataURL('firma/CARLOS.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 135, y - 17, 50, 16);
    }
    // Añadimos el texto Carlos A. Rojas para simular la firma de la imagen
    doc.setFont('helvetica', 'normal').setFontSize(6.5);

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Melody.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Melody'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Melody' });
  }

  async generarEntregaDocsTuAlianzaSinCasino() {
    // ───────── Helpers ─────────
    const H_CENTER = 'center' as const;
    const BOLD = 'bold' as const;
    const ITALIC = 'italic' as const;

    const toDataURL = async (url?: string): Promise<string | null> => {
      if (!url) return null;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch fail');
        const b = await r.blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('reader fail'));
          fr.readAsDataURL(b);
        });
      } catch {
        return null;
      }
    };

    const renderJustifiedLine = (
      doc: jsPDF,
      linea: string,
      x: number,
      y: number,
      anchoDisponible: number,
      ultimaLinea: boolean
    ) => {
      const palabras = linea.split(' ').filter(Boolean);
      if (palabras.length <= 1 || ultimaLinea) { doc.text(linea, x, y); return; }
      const widths = palabras.map(p => doc.getTextWidth(p));
      const totalPalabras = widths.reduce((a, b) => a + b, 0);
      const espacios = palabras.length - 1;
      const extra = (anchoDisponible - totalPalabras) / espacios;
      let cursorX = x;
      palabras.forEach((p, i) => {
        doc.text(p, cursorX, y);
        if (i < espacios) cursorX += widths[i] + extra;
      });
    };

    // ───────── PDF base y layout ─────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({
      title: 'Tu_Alianza_Entrega_documentos_Sin_Casino.pdf',
      author: this.empresa,
      creator: this.empresa,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const leftMargin = 10;
    const rightMargin = 10;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 10;
    const marginLeft = leftMargin;

    // ───────── Encabezado (logo + tabla) ─────────
    const startX = leftMargin;
    const startY = y;
    const headerHeight = 13;
    const logoBoxWidth = 50;
    const tableWidth = contentWidth;

    doc.setLineWidth(0.1);
    doc.rect(startX, startY, logoBoxWidth, headerHeight);

    const logoData = await toDataURL('logos/Logo_TA.png');
    if (logoData) {
      doc.addImage(logoData, 'PNG', startX + 2, startY + 1.5, 27, 10);
    }

    doc.setFontSize(7);
    const tableStartX = startX + logoBoxWidth;
    const rightHeaderWidth = tableWidth - logoBoxWidth;
    doc.rect(tableStartX, startY, rightHeaderWidth, headerHeight);

    doc.setFont('helvetica', 'bold');
    doc.text('PROCESO DE CONTRATACIÓN', tableStartX + 54, startY + 3);
    doc.text('ENTREGA DE DOCUMENTOS Y AUTORIZACIONES', tableStartX + 40, startY + 7);

    const h1Y = startY + 4;
    const h2Y = startY + 8;
    doc.line(tableStartX, h1Y, tableStartX + rightHeaderWidth, h1Y);
    doc.line(tableStartX, h2Y, tableStartX + rightHeaderWidth, h2Y);

    const col1 = tableStartX + 30;
    const col2 = tableStartX + 50;
    const col3 = tableStartX + 110;

    doc.line(col1, h2Y, col1, startY + headerHeight);
    doc.line(col2, h2Y, col2, startY + headerHeight);
    doc.line(col3, h2Y, col3, startY + headerHeight);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(`Código: ${FORMATO_ENTREGA_TU_ALIANZA.codigo}`, tableStartX + 2, startY + 11.5);
    doc.text(`Versión: ${FORMATO_ENTREGA_TU_ALIANZA.version}`, col1 + 2, startY + 11.5);
    doc.text(`Fecha de Emisión: ${FORMATO_ENTREGA_TU_ALIANZA.fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text('Página: 1 de 1', col3 + 6, startY + 11.5);

    y = startY + headerHeight + 5;

    // ───────── Intro ─────────
    doc.setFontSize(8).setFont('helvetica', 'normal');
    const maxWidth = contentWidth;
    const intro = 'Reciba un cordial saludo, por medio del presente documento afirmo haber recibido, leído y comprendido los documentos relacionados a continuación:';
    doc.text(intro, marginLeft, y, { maxWidth });
    doc.setFontSize(7);
    y += 5;

    // Lista 1) 2)
    const lista = [
      'Copia del Contrato Individual de Trabajo.',
      'Inducción General de nuestra Compañía e Información General de la Empresa Usuaria el cual incluye información sobre:'
    ];
    lista.forEach((item, index) => {
      const numero = `${index + 1}) `;
      doc.setFont('helvetica', 'bold'); doc.text(numero, marginLeft, y);
      // Se mide en negrita, que es como se dibujó el número; midiéndolo en
      // normal el texto arrancaba antes y quedaba pegado al paréntesis.
      const numW = doc.getTextWidth(numero);
      doc.setFont('helvetica', 'normal');
      doc.text(item, marginLeft + numW, y);
      y += 5;
    });

    // ───────── Tabla (autotable) ─────────
    const head: RowInput[] = [[
      { content: 'EMPRESA USUARIA', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } },
      { content: 'FECHA DE PAGO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } },
      { content: 'SERVICION DE CASINO', styles: { halign: H_CENTER, fontStyle: BOLD, fillColor: [150, 150, 150], textColor: 255 } }
    ]];

    const body: RowInput[] = [
      [
        { content: 'AGROIDEA SAS', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '04 y 19 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'BALLESTEROS GOMEZ MARIBEL DAYANNA', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'CASA DENTAL EDUARDO DAZA LTDA', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'DANIELA LEON', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'DELI POLLO LG', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'FRUITSFULL COMPANY SAS', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '05 y 20 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'COMERCIALIZADORA TS', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '03 y 18 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'TURFLOR SAS', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'Las fechas de pago son: Mensuales\nel 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ],
      [
        { content: 'YES CREMALLERAS S.A.S', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: '15 y 30 de cada mes', styles: { fontStyle: BOLD, fontSize: 6.5, halign: H_CENTER } },
        { content: 'NO ofrece servicio de casino, por lo tanto, el trabajador debe llevarlo.', styles: { fontSize: 6.5, halign: H_CENTER } }
      ]
    ];

    autoTable(doc, {
      head, body,
      startY: y,
      theme: 'grid',
      margin: { left: leftMargin, right: rightMargin },
      styles: { font: 'helvetica', fontSize: 6.5, cellPadding: { top: 1.0, bottom: 1.0, left: 1, right: 1 } },
      headStyles: { lineWidth: 0.2, lineColor: [120, 120, 120] },
      bodyStyles: { lineWidth: 0.2, lineColor: [180, 180, 180], valign: 'middle' },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 35 }, 2: { cellWidth: 'auto' as const } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? (y + 40);
    y = finalY + 4;

    // Autorización casino
    doc.setFontSize(8).setFont('helvetica', 'italic');
    doc.text('Teniendo en cuenta la anterior información, autorizo descuento de casino:', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('No Aplica ( X )', 145, y);

    // Forma de pago
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('3) FORMA DE PAGO:', marginLeft, y);
    y += 5;

    const contrato = this.candidato?.entrevistas?.[0]?.proceso?.contrato || {};
    const formaPagoSeleccionada: string = contrato?.forma_de_pago ?? '';
    const numeroPagos: string = contrato?.numero_para_pagos ?? '';
    const codigoTarjeta: string = contrato?.identification_number_tarjeta ?? '';

    const opciones = [
      { nombre: 'Daviplata', x: marginLeft, y: y },
      { nombre: 'Davivienda cta ahorros', x: marginLeft + 25, y: y },
      { nombre: 'Davivienda Tarjeta Master', x: marginLeft + 65, y: y },
      { nombre: 'Otra', x: marginLeft + 105, y: y },
    ];

    opciones.forEach((op) => {
      doc.rect(op.x, op.y - 3, 4, 4);
      doc.setFont('helvetica', 'normal').setFontSize(7).text(op.nombre, op.x + 6, op.y);
      if (formaPagoSeleccionada === op.nombre) {
        doc.setFont('helvetica', 'bold').text('X', op.x + 1, op.y);
      }
    });

    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('Cuál?', 135, y);
    doc.line(145, y, 200, y);
    if (formaPagoSeleccionada === 'Otra') {
      doc.setFont('helvetica', 'normal').text('Especificar aquí...', 135, y - 1);
    }

    // Nomor / Codigo
    y += 8;

    // Grey backgrounds 
    doc.setFillColor(230, 230, 230); // light gray
    doc.rect(marginLeft + 18, y - 4, 45, 5, 'F');
    doc.rect(marginLeft + 90, y - 4, 105, 5, 'F');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold').text('Número TJT ó', marginLeft, y - 1);
    doc.setFont('helvetica', 'bold').text('Celular', marginLeft, y + 2.5);
    doc.setFont('helvetica', 'normal').text(numeroPagos, marginLeft + 20, y);

    doc.setFont('helvetica', 'bold').text('Código de Tarjeta', marginLeft + 70, y);
    doc.setFont('helvetica', 'normal').text(codigoTarjeta, marginLeft + 95, y);
    y += 7;

    // IMPORTANTE (justificado)
    y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const importante =
      'IMPORTANTE: Recuerde que si usted cuenta con su forma de pago Daviplata, cualquier cambio realizado en la misma debe ser notificado a la Emp. Temporal. También tenga presente que la entrega de la tarjeta Master por parte de la Emp. Temporal es provisional, y se reemplaza por la forma de pago DAVIPLATA; tan pronto Davivienda nos informa que usted activó su DAVIPLATA, se le genera automáticamente el cambio de forma de pago. CUIDADO! El manejo de estas cuentas es responsabilidad de usted como trabajador, por eso son personales e intransferibles.';
    const anchoJust = contentWidth;
    const lineHeight = 3;
    doc.setFont('helvetica', 'italic');
    const lineas = doc.splitTextToSize(importante.trim().replace(/\s+/g, ' '), anchoJust) as string[];
    lineas.forEach((ln, i) => {
      const last = i === lineas.length - 1;
      renderJustifiedLine(doc, ln, marginLeft, y, anchoJust, last);
      y += lineHeight;
    });

    // Acepto cambio
    y += 3;
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text('ACEPTO CAMBIO SIN PREVIO AVISO YA QUE HE SIDO INFORMADO (A) :', marginLeft, y);
    doc.setFont('helvetica', 'bold');
    doc.text('SI ( X )', 140, y);
    doc.text('NO (   )', 160, y);
    y += 5;

    // Contenido final numerado
    doc.setFontSize(7);
    const contenidoFinal = [
      { numero: '4)', texto: 'Entrega y Manejo del Carné de la Empresa de Servicios Temporales APOYO LABORAL TS S.A.S.' },
      { numero: '5)', texto: 'Capacitación de Ley 1010 DEL 2006 (Acosos laboral) y mecanismo para interponer una queja general o frente al acoso.' },
      { numero: '6)', texto: 'Socialización de las políticas vigentes y aplicables de la Empresa Temporal.' },
      { numero: '7)', texto: 'Curso de Seguridad y Salud en el Trabajo "SST" de la Empresa Temporal.' },
      {
        numero: '8)',
        texto: 'Se hace entrega de la documentación requerida para la vinculación de beneficiarios a la Caja de Compensación Familiar y se establece compromiso de 15 días para la entrega sobre la documentación para afiliación de beneficiarios a la Caja de Compensación y EPS si aplica.\nDe lo contrario se entenderá que usted no desea recibir este beneficio, recuerde que es su responsabilidad el registro de los mismos.'
      },
      {
        numero: '9)',
        texto: PLAN_FUNERAL
      }
    ];

    const bottomSafe = 12;
    const ensureSpace = (need: number) => {
      if (y + need > pageHeight - bottomSafe) { doc.addPage(); y = 15; }
    };

    doc.setFontSize(7);
    contenidoFinal.forEach((item) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold').text(item.numero, marginLeft, y);
      doc.setFont('helvetica', 'normal');
      const textoLineas = doc.splitTextToSize(item.texto, contentWidth - 5) as string[];
      doc.text(textoLineas, marginLeft + 4, y);
      y += textoLineas.length * 3 + 1;
    });

    // SI / NO del seguro
    const seguro = !!contrato?.seguro_funerario;
    y -= 3;
    doc.setFont('helvetica', 'bold');
    if (seguro) {
      doc.text('SI ( x )', 140, y);
      doc.text('NO (   )', 160, y);
    } else {
      doc.text('SI (   )', 140, y);
      doc.text('NO ( x )', 160, y);
    }

    // Nota
    y += 3;
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const notaText = 'Nota: Si usted autorizó este descuento debe presentar una carta en la oficina de la Temporal solicitando el retiro, para la desafiliación de este plan.';
    doc.text(notaText, marginLeft, y);
    y += 4;

    // Banner "Recuerde que:"
    ensureSpace(10);
    doc.setFillColor(220, 220, 220);
    doc.rect(marginLeft, y - 2, contentWidth, 5, 'F');
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(0, 0, 0);
    doc.text('Recuerde que: Puede encontrar esta información disponible en:', marginLeft + 2, y + 1.5);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink('http://tualianza.co', marginLeft + 85, y + 1.5, { url: 'http://tualianza.co' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text('Documentos de interes, Ingresando el código:', marginLeft + 115, y + 1.5);
    doc.setFont('helvetica', 'bold').setFontSize(7);
    doc.text('9876', marginLeft + 170, y + 1.5);
    y += 6;

    // DEL COLABORADOR
    ensureSpace(35);

    const contenidoFinalColaborador = [
      { numero: 'a)', texto: 'Por medio de la presente manifiesto que recibí lo anteriormente mencionado y que acepto el mismo.' },
      { numero: 'b)', texto: 'Leí y comprendí el curso de inducción General y de Seguridad y Salud en el Trabajo, así como el contrato y las recomendaciones laboral y todas las cláusulas y condiciones establecidas.' },
      { numero: 'c)', texto: 'Información Condiciones de Salud: Manifiesto que conozco los resultados de mis exámenes médicos de ingreso dadas por el médico ocupacional y que recibí copia del concepto médico.' },
    ];

    doc.setFont('helvetica', 'bold').setFontSize(7.5);
    doc.text('DEL COLABORADOR:', marginLeft, y);
    y += 4;

    doc.setFontSize(7);
    const lh2 = 3.5;
    const gapAfterItem2 = 2;

    const bulletBoxWidth2 =
      Math.max(doc.getTextWidth('a) '), doc.getTextWidth('b) '), doc.getTextWidth('c) ')) + 1.5;

    const xBullet2 = marginLeft;
    const xText2 = xBullet2 + bulletBoxWidth2;
    const availWidth2 = pageWidth - rightMargin - xText2;

    contenidoFinalColaborador.forEach(({ numero, texto }) => {
      ensureSpace(12);
      doc.setFont('helvetica', 'bold');
      doc.text(numero, xBullet2, y);

      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(texto, availWidth2) as string[];
      lines.forEach((ln) => {
        ensureSpace(lh2);
        doc.text(ln, xText2, y);
        y += lh2;
      });
      y += gapAfterItem2;
    });

    // Firma + datos
    y += 15;
    ensureSpace(35);
    const firmaLineY = y;

    // Firma line + label
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.line(marginLeft, firmaLineY, marginLeft + 60, firmaLineY);
    doc.text('Firma de Aceptación', marginLeft, firmaLineY + 4);

    const firmaData = await toDataURL(this.firma);
    if (firmaData) {
      doc.addImage(firmaData, 'PNG', marginLeft, firmaLineY - 13, 32, 12);
    } else {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la firma' });
    }

    // No de Identificación
    y = firmaLineY + 12;
    doc.setFont('helvetica', 'bold').setFontSize(8);
    doc.text('No de Identificación:', marginLeft, y);
    doc.setFont('helvetica', 'normal').text(String(this.candidato?.numero_documento ?? ''), marginLeft + 32, y - 1);
    doc.line(marginLeft + 30, y, marginLeft + 80, y);

    // Fecha de Recibido
    y += 8;
    doc.setFont('helvetica', 'bold').text('Fecha de Recibido_', marginLeft, y);
    const dateObj = this.getFechaContrato();
    const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getFullYear()}`;
    doc.setFont('helvetica', 'normal').text(dateStr, marginLeft + 28, y - 1);
    doc.line(marginLeft + 26, y, marginLeft + 80, y);

    // El rótulo 'Duración: 30 Minutos. Responsable de la socialización:'
    // ya viene dentro del PNG del sello; no se dibuja aparte.
    // Sello
    const selloData = await toDataURL('firma/FirmaEntregaDocApoyo.png');
    if (selloData) {
      doc.addImage(selloData, 'PNG', marginLeft + 135, y - 17, 50, 16);
    }

    // ───────── Exportar y previsualizar ─────────
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa || 'Tu_Alianza'}_Entrega_documentos_Sin_Casino.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Inducción Tu Alianza sin Casino'] = { file: pdfFile, fileName };
    this.verPDF({ titulo: 'Inducción Tu Alianza sin Casino' });
  }




  // Generar contrato de trabajo
  generarContratoTrabajo(plantilla?: 'APOYO' | 'ALIANZA') {
    // Determinar la ruta del logo y el NIT
    let logoPath = '';
    let nit = '';
    let domicilio = '';
    let codigo = '';
    let version = '';
    let fechaEmision = '';

    // `publicacion.temporal` es texto libre (CharField sin choices), así que la
    // comparación estricta dejaba fuera variantes reales de la BD
    // ("APOYO LABORAL", "APOYO LABORAL TS SAS", minúsculas, espacio final...)
    // y caía al else con "Empresa no reconocida". Match tolerante, igual que
    // `runContratoVariant` y `contrato-administrativo-fill.ts`.
    // La `plantilla` elegida por el admin MANDA sobre la temporal de la vacante:
    // sin esto, al generar "Apoyo" con vacante de Alianza el formato salía con
    // logo/NIT/código de Alianza.
    const empresaNorm = (this.empresa ?? '').toUpperCase().trim();
    const marca = plantilla
      ?? (empresaNorm.includes('APOYO') ? 'APOYO'
        : empresaNorm.includes('ALIANZA') ? 'ALIANZA' : null);

    if (marca === 'APOYO') {
      logoPath = 'logos/Logo_AL.png';
      nit = '900.814.587-1';
      domicilio = 'CARRERA 2 # 8 - 156 FACATATIVÁ C/MARCA';
      codigo = 'AL CO-RE-1';
      version = '07';
      fechaEmision = 'Enero 06-21';
    } else if (marca === 'ALIANZA') {
      logoPath = 'logos/Logo_TA.png';
      nit = '900.864.596-1';
      domicilio = 'CLL 7 4 49 Madrid, Cundinamarca';
      codigo = 'TA CO-RE-1';
      version = '06';
      fechaEmision = 'Mayo 02-2022';
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Empresa no reconocida para generar el contrato',
      });
      return;
    }

    // Crear el documento PDF en formato vertical
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter',
      compress: true,
    });

    doc.setProperties({
      title: 'Contrato_Trabajo.pdf',
      creator: this.empresa,
      author: this.empresa,
    });


    // Posiciones iniciales
    const startX = 5;
    const startY = 5;
    const tableWidth = 205;

    // **Cuadro para el logo y NIT**
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, 50, 13); // Cuadro del logo y NIT

    // Agregar logo
    doc.addImage(logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);

    // Agregar NIT
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("NIT", startX + 32, startY + 7);
    doc.setFont('helvetica', 'normal');
    doc.text(nit, startX + 32, startY + 10);

    // **Tabla al lado del logo**
    let tableStartX = startX + 50; // Inicio de la tabla al lado del cuadro
    doc.rect(tableStartX, startY, tableWidth - 50, 13); // Borde exterior de la tabla

    // Encabezados
    doc.setFont('helvetica', 'bold');
    doc.text("PROCESO DE CONTRATACIÓN", tableStartX + 55, startY + 3);
    doc.text(this.codigoContratacion ?? '', tableStartX + 130, startY + 3);
    doc.text("CONTRATO DE TRABAJO POR OBRA O LABOR", tableStartX + 43, startY + 7);

    // Líneas divisoras
    let col1 = tableStartX + 30;
    let col2 = tableStartX + 50;
    let col3 = tableStartX + 110;

    doc.line(tableStartX, startY + 4, tableStartX + tableWidth - 50, startY + 4); // Línea horizontal bajo el título
    doc.line(tableStartX, startY + 8, tableStartX + tableWidth - 50, startY + 8); // Línea horizontal bajo el título
    doc.line(col1, startY + 8, col1, startY + 13); // Línea vertical 1
    doc.line(col2, startY + 8, col2, startY + 13); // Línea vertical 2
    doc.line(col3, startY + 8, col3, startY + 13); // Línea vertical 3

    // **Contenido de las columnas**
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("Código: " + codigo, tableStartX + 2, startY + 11.5);
    doc.text("Versión: " + version, col1 + 2, startY + 11.5); // Ajustar dentro de columna
    doc.text(`Fecha Emisión: ${fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text("Página: 1 de 3", col3 + 6, startY + 11.5); // Ajustar dentro de columna

    // Representado por
    doc.setFontSize(7);

    const fechaISO = this.vacante.fechaIngreso; // '2024-12-04T05:00:00.000Z'

    // Convertir la fecha ISO a un objeto Date
    const fecha = new Date(fechaISO);

    // Formatear al formato dd/mm/yyyy
    const fechaFormateada = [
      String(fecha.getDate()).padStart(2, '0'),  // dd
      String(fecha.getMonth() + 1).padStart(2, '0'),  // mm
      fecha.getFullYear()  // yyyy
    ].join('/');

    // Datos de titulos
    //
    // El ORDEN define el corte en 2 columnas: con rowsPerColumn = 12, los
    // primeros 12 van a la columna izquierda (hasta "Descripción de la Obra")
    // y los 3 últimos a la derecha (Domicilio del patrono, Tipo y No de
    // Identificación, Email). No reordenar sin revisar ese corte.
    const datos = [
      { titulo: 'Representado por', valor: 'MAYRA HUAMANÍ LÓPEZ' },
      {
        titulo: 'Nombre del Trabajador',
        valor: [
          this.candidato?.primer_nombre,
          this.candidato?.segundo_nombre,
          this.candidato?.primer_apellido,
          this.candidato?.segundo_apellido,
        ].map(v => this.limpio(v)).filter(Boolean).join(' ')
      },
      { titulo: 'Fecha de Nacimiento', valor: this.parseDateToDDMMYYYY(this.candidato?.fecha_nacimiento) || this.limpio(this.candidato?.fecha_nacimiento) },
      // `residencia` es un OneToOne inverso: DRF OMITE la clave cuando el
      // candidato no tiene fila de residencia, así que el acceso directo
      // reventaba con "Cannot read properties of undefined".
      // Antes se concatenaba el literal 'BOGOTÁ' al domicilio de TODO candidato,
      // aunque la operación es mayoritariamente en Cundinamarca. Se usa el
      // municipio real del candidato y, si no hay, se omite.
      { titulo: 'Domicilio del Trabajador', valor: [this.candidato?.residencia?.direccion, this.candidato?.residencia?.barrio, this.candidato?.municipio].map(v => this.limpio(v)).filter(Boolean).join(' ') },
      { titulo: 'Fecha de Iniciación', valor: this.parseDateToDDMMYYYY(this._entrevistaSel?.proceso?.contrato?.fecha_ingreso) || this.limpio(this._entrevistaSel?.proceso?.contrato?.fecha_ingreso) },
      { titulo: 'Salario Mensual Ordinario', valor: this.salarioContratoDoc },
      { titulo: 'Periódo de Pago Salario', valor: 'Quincenal' },
      { titulo: 'Subsidio de Transporte', valor: 'SE PAGA EL LEGAL VIGENTE  O SE SUMINISTRA EL TRANSPORTE' },
      { titulo: 'Forma de Pago', valor: 'Banca Móvil,  Cuenta de Ahorro o Tarjeta Monedero' },
      { titulo: 'Nombre Empresa Usuria', valor: this.limpio(this.empresaUsuariaDoc) },
      { titulo: 'Cargo', valor: this.limpio(this.vacante?.cargo) },
      { titulo: 'Descripción de la Obra/Motivo Temporada', valor: this.limpio(this.descripcionObraDoc) },
      // ── Columna derecha ──
      { titulo: 'Domicilio del patrono', valor: this.limpio(domicilio) },
      { titulo: 'Tipo y No de Identificación', valor: [this.limpio(this.candidato?.tipo_doc), this.numeroDocConPuntos(this.cedula)].filter(Boolean).join('        ') },
      { titulo: 'Email', valor: this.limpio(this.candidato?.contacto?.email) },
    ];
    // Configuración de columnas
    const columnWidth = 110; // Ancho de cada columna
    const rowSpacing = 3;    // Espaciado entre filas
    const columnMargin = 10; // Margen entre columnas
    const columnStartX = 5;  // Posición inicial X
    const columnStartY = startY + 17; // Posición inicial Y
    // 12 filas en la columna izquierda (termina en "Descripción de la Obra")
    // y el resto en la derecha.
    const rowsPerColumn = 12;

    // Iteración para generar el texto. La fila "Descripción de la Obra/Motivo
    // Temporada" puede desbordarse si el texto es largo; aplicamos
    // splitTextToSize y trackeamos cuántas líneas extras agregó para empujar el
    // texto siguiente hacia abajo. La detección va por TÍTULO, no por índice.
    const descripcionExtraLineH = 2.5; // mm aprox para fontSize 7
    const pageW = doc.internal.pageSize.getWidth();
    const rightMargin = 5;
    let descripcionExtraLineas = 0;

    // Offset del valor MEDIDO, no fijo: se toma el rótulo más largo de cada
    // columna. Con offsets fijos (48 / 30.2) el valor caía encima del rótulo en
    // los dos casos límite —"Descripción de la Obra/Motivo Temporada" a la
    // izquierda y "Tipo y No de Identificación" a la derecha—, que es
    // justamente el texto sobre texto.
    doc.setFont('helvetica', 'normal').setFontSize(7);
    const anchoRotuloMax = (desde: number, hasta: number) =>
      Math.max(...datos.slice(desde, hasta).map(d => doc.getTextWidth(`${d.titulo}:`)));
    const offsetCol0 = Math.max(48, anchoRotuloMax(0, rowsPerColumn) + 2);
    const offsetCol1 = anchoRotuloMax(rowsPerColumn, datos.length) + 2;

    datos.forEach((item, index) => {
      const currentColumn = Math.floor(index / rowsPerColumn); // Columna actual (cada 12 filas)
      const rowInColumn = index % rowsPerColumn; // Fila dentro de la columna actual

      const x = columnStartX + currentColumn * (columnWidth + columnMargin);
      const y = columnStartY + rowInColumn * rowSpacing;

      // Establecer el título en fuente normal
      doc.setFont('helvetica', 'normal');
      doc.text(`${item.titulo}:`, x, y);

      const valueX = x + (currentColumn === 0 ? offsetCol0 : offsetCol1);

      // jsPDF lanza si el texto no es string, así que TODAS las ramas coercen.
      const valor = String(item.valor ?? '');

      const esDescripcionObra = item.titulo
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .includes('descripcion de la obra');

      doc.setFont('helvetica', 'bold');

      // Las primeras filas de la izquierda comparten renglón con la columna
      // derecha; ahí el valor no puede pasar del inicio de esa columna o se
      // monta encima. Más abajo la derecha ya no tiene filas y se puede usar
      // todo el ancho de página.
      const inicioColumnaDerecha = columnStartX + (columnWidth + columnMargin);
      const filasEnColumnaDerecha = datos.length - rowsPerColumn;
      const compartRenglon = currentColumn === 0 && rowInColumn < filasEnColumnaDerecha;
      const limiteDerecho = compartRenglon ? inicioColumnaDerecha - 2 : pageW - rightMargin;
      const maxW = Math.max(20, limiteDerecho - valueX);

      if (esDescripcionObra) {
        // Descripción de la obra/labor — wrap para que NUNCA se corte ni se salga.
        const lines: string[] = doc.splitTextToSize(valor.trim() || '—', maxW);
        doc.text(lines, valueX, y);
        descripcionExtraLineas = Math.max(0, lines.length - 1);
      } else {
        // `maxWidth` hace que jsPDF reparta en varias líneas en vez de
        // desbordarse sobre la columna vecina.
        doc.text(valor, valueX, y, { maxWidth: maxW });
      }
    });

    // Restaurar la fuente a la normal después del bucle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    // Ajuste vertical: empujamos el bloque siguiente hacia abajo por cada
    // línea extra que ocupó la descripción multilinea.
    let y = columnStartY + rowsPerColumn * rowSpacing + 2
      + (descripcionExtraLineas * descripcionExtraLineH); // Posición vertical después de los datos
    // Texto adicional
    let texto = 'Entre el EMPLEADOR y el TRABAJADOR arriba indicados, se ha celebrado el contrato regulado por las cláusulas que adelante se indican, aparte de la ley, siendo ellas las siguientes: PRIMERA. El Trabajador, a partir de la fecha de iniciación, se obliga para con el EMPLEADOR a ejecutar la obra arriba indicada, sometiéndose durante su realización en todo a las órdenes de éste. Declara por consiguiente el TRABAJADOR completa y total disponibilidad para con el EMPLEADOR para ejecutar las obras indicadas en el encabezamiento, siempre que así le sean exigidas por sus clientes al EMPLEADOR. Teniendo en cuenta que, la EMPRESA USUARIA, desarrolla su actividad productiva y comercial a nivel nacional, las partes convienen en que la EMPRESA USUARIA podrá trasladar la base de operaciones de EL TRABAJADOR, en cualquier tiempo, a cualquier otro lugar donde desarrolle tales actividades sin que por ello se opere desmejora o modificación sustancial de las condiciones de trabajo ni de la categoría del TRABAJADOR, consideradas en el momento de la suscripción de este contrato. SEGUNDA. DURACIÓN DEL CONTRATO: La necesaria para la realización de la obra o labor contratada y conforme a las necesidades del patrono o establecimiento que requiera la ejecución de la obra, todo conforme a lo previsto en el Art. 45 del CST y teniendo en cuenta la fecha de iniciación de la obra; y la índole de la misma, circunstancias una y otra ya anotadas. PARÁGRAFO PRIMERO: Las partes acuerdan que por ser el TRABAJADOR contratado como trabajador en misión para ser enviado a la empresa la duración de la obra o labor no podrá superar el tiempo establecido en el Art. 77 de la Ley 50 de 1990 en su numeral 3°. PARÁGRAFO SEGUNDO: El término de duración del presente contrato es de carácter temporal por ser el EMPLEADOR una empresa de servicios temporales, y por tanto tendrá vigencia hasta la realización de la obra o labor contratada que sea indicada por las Empresas Usuarias del EMPLEADOR en este contrato, acordando las partes que para todos los efectos legales, la obra o labor contratada termina en la fecha en que la EMPRESA USUARIA, a la que será enviado el TRABAJADOR, comunique la terminación de la misma. PARÁGRAFO TERCERO: La labor se realizará de manera personal en las instalaciones de la EMPRESA ';
    // this.vacante.empresaUsuariaSolicita + CENTRO DE COSTOS + this.vacante.finca + DIR. + this.vacante.direccion
    doc.setFont('helvetica', 'normal');
    // Construir texto dinámico sin null ni undefined
    const partes = [
      this.empresaUsuariaDoc,
      'CENTRO DE COSTOS',
      this.centroCostoDoc || '',
      this.direccionDoc ? `DIR. ${this.direccionDoc}` : ''
    ].filter(Boolean); // elimina los vacíos o null

    // MAYÚSCULAS obligatorias (incluida la dirección): renderJustifiedText pone
    // en negrita toda palabra en mayúsculas, así el tramo completo sale en bold.
    const textoLinea = partes.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
    texto += textoLinea + (textoLinea.endsWith('.') ? '' : '.');

    doc.setFont('helvetica', 'normal');

    let x = 5; // Margen izquierdo
    const lineHeight = 3.4;
    const maxWidth = 205;

    doc.setFontSize(6.5);

    // TERCERA. continúa EN EL MISMO párrafo, como texto corrido después de la
    // dirección: se concatena con `texto` y se renderiza todo en UN solo bloque
    // justificado (así no hay salto de párrafo ni riesgo de solaparse).
    let texto2 = 'TERCERA. El salario como contraprestación del servicio será el indicado arriba, según la clasificación de oficios y tarifas determinados por el EMPLEADOR, la cual hace parte de este contrato; sometida sí en su eficiencia a que el valor a recibir corresponda al oficio respectivo efectivamente contratado con el usuario, según el tiempo laborado en la respectiva jornada, inferior a la máxima legal; éste regirá en proporción al número de horas respectivamente trabajadas y en él están los valores incluidos correspondientes a dominicales y festivos reconocidos por la ley como descanso remunerado. PARÁGRAFO PRIMERO: El patrono manifiesta expresamente que el TRABAJADOR tendrá derecho a todas las prestaciones sociales consagradas en la ley 50 de 1990 y demás estipulaciones previstas en el CST. Tales como compensación monetaria por vacaciones y prima de servicios proporcional al tiempo laborado, cualquiera que este sea. PARÁGRAFO SEGUNDO: Se conviene por las partes, que en caso de que el TRABAJADOR devengue comisiones o cualquiera otra modalidad de salario variable, el 82.5 % de dichos ingresos constituyen remuneración ordinaria y el 17.5 % restante está destinado a remunerar el descanso en días dominicales y festivos de que tratan los capítulos I y II del título VII del CST. CUARTA. EL TRABAJADOR, se someterá al horario de trabajo que señale el EMPLEADOR de acuerdo con las especificaciones del Usuario. QUINTA. PERÍODO DE PRUEBA: el período de prueba no excederá de dos (2) meses ni podrá ser superior a la quinta parte del término pactado, si el contrato tuviere una duración inferior a un año. SEXTA. EL TRABAJADOR y EL EMPLEADOR podrán convenir en repartir las horas de la jornada diaria en los términos del Art. 164 del CST., teniendo en cuenta que el descanso entre las secciones de la jornada no se computa dentro de la misma, según el art. 167 del estatuto Ibídem. Así mismo todo trabajador extra, suplementario o festivo, solo será reconocido en caso de ser exigido o autorizado a trabajar por el EMPLEADOR a solicitud de la entidad con la cual aquel tenga acuerdo de realización de trabajo o servicio. SÉPTIMA. Son justas causas para dar por terminado este contrato, además de las previstas en el art.7° del decreto 2351, las disposiciones concordantes y las consignadas en el reglamento interno del trabajo del EMPLEADOR, así como las siguientes: 1ª La terminación por cualquier causa, del contrato de prestación de servicios suscritos entre el EMPLEADOR y el USUARIO en donde prestará servicios el TRABAJADOR. 2ª El que la EMPRESA USUARIA en donde prestará servicios el TRABAJADOR, solicite el cambio de este por cualquier causa. 3ª El que la EMPRESA USUARIA en donde prestará servicios el TRABAJADOR, comunique la terminación de la obra o labor contratada. 4ª Que la EMPRESA USUARIA comunique al EMPLEADOR el incumplimiento leve de cualquiera de las obligaciones por parte del TRABAJADOR en TRES oportunidades, dos de las cuales hayan generado SANCIÓN AL TRABAJADOR. OCTAVA. Las partes acuerdan que NO CONSTITUYEN SALARIO, las sumas que ocasionalmente y por mera liberalidad reciba el TRABAJADOR del EMPLEADOR, como auxilios, gratificaciones, bonificaciones, primas extralegales, premios, bonos ocasionales, gastos de transporte adicionales y representación que el EMPLEADOR otorgue o llegue a otorgar en cualquier tiempo al TRABAJADOR, como tampoco no constituyen salario en dinero o en especie, cualquier alimentación, habitación o vestuario que entregue el EMPLEADOR, o un TERCERO al TRABAJADOR, durante la vigencia de este contrato.Tampoco constituirá salario, conforme a los términos del artículo 128 del Código Sustantivo del trabajo, cualquier bonificación o auxilio habitual, que se llegaren a acordar convencional o habitualmente entre las partes. Estos dineros, no se computarán como parte de salario para efectos de prestaciones sociales liquidables o BASE1 de éste. Al efecto el TRABAJADOR y el EMPLEADOR, así lo pactan expresamente en los términos del artículo 128 del C.S. del T. en C. Con. Con el articulo quince (15) de la ley cincuenta (50) de 1990. PARÁGRAFO PRIMERO: Las partes acuerdan que el EMPLEADOR, a su arbitrio y liberalidad podrá en cualquier momento cancelar o retirar el pago de bonificaciones habituales o esporádicas que en algún momento reconozca o hubiese reconocido al trabajador diferentes a su salario, sin que esto constituya desmejora de sus condiciones laborales; toda vez que como salario y retribución directa a favor del trabajador derivada de su actividad o fuerza laboral únicamente se pacta la suma establecida en la caratula del presente contrato. NOVENA. En caso que el TRABAJADOR requiera ausentarse de su lugar de trabajo, deberá avisar por lo menos con 24 horas de anticipación a la EMPRESA USUARIA o según lo establecido en el Reglamento Interno de la misma. DÉCIMA. CONFIDENCIALIDAD: El TRABAJADOR en virtud del presente contrato se compromete a 1) Manejar de manera confidencial la información que como tal sea presentada y entregada, y toda aquella que se genere en torno a ella como fruto de la prestación de sus servicios. 2) Guardar confidencialidad sobre esta información y no emplearla en beneficio propio o de terceros mientras conserve sus características de confidencialidad y que pueda perjudicar los intereses del EMPLEADOR o de la EMPRESA USUARIA. 3) Solicitar previamente y por escrito autorización para cualquier publicación relacionada con el tema de contrato, autorización que debe solicitarse ante el empleador. DÉCIMA PRIMERA. AUTORIZACION TRATAMIENTO DE DATOS PERSONALES, 1). De acuerdo a lo establecido en la ley 1581 de 2012, la Constitución Nacional y a las políticas establecidas por el EMPLEADOR para el caso en particular, el trabajador debe guardar reserva respecto a la protección de datos de los clientes, proveedores, compañeros, directivos del EMPLEADOR Y EMPRESA USUARIA, salvo que medie autorización expresa de cada persona para divulgar la información. 2). Guardar completa reserva sobre las operaciones, negocios y procedimientos industriales y comerciales, o cualquier otra clase de datos acerca del EMPLEADOR Y EMPRESA USUARIA que conozca por razón de sus funciones o de sus relaciones con ella, lo que no obsta para denunciar delitos comunes o violaciones del contrato de trabajo o de las normas legales de trabajo ante las autoridades competentes. DÉCIMA SEGUNDA. DECLARACIONES: Autorización Tratamiento Datos Personales “Ley de Protección de Datos 1581 de 2012 – decreto 1733 de 2013” Declaro que he sido informado que conozco y acepto la Política de Uso de Datos Personales e Información del EMPLEADOR, y que la información proporcionada es veraz, completa, exacta, actualizada y verificable. Mediante la firma del presente documento, manifiesto que conoce y acepto que cualquier consulta o reclamación relacionada con el Tratamiento de sus datos personales podrá ser elevada por escrito ante el EMPLEADOR; (¡) Que la Empresa APOYO LABORAL TS S.A.S con NIT. 900.814.586-1, con domicilio principal en la Calle 7 No. 7– 49 de Madrid, para efectos de lo dispuesto en la ley Estatutaria 1581 de 2012, el Decreto 1733 de 2013, y demás normas que lo adicionen o modifiquen relativas a la Protección de Datos Personales, es responsable del tratamiento de los datos PERSONALES QUE LE HE SUMINISTRADO. (¡¡).Que, para el ejercicio de mis derechos relacionados con mis datos personales, el EMPLEADOR ha puesto a mi disposición la línea de atención: Afiliados marcando a Bogotá 6017444002; a través del correo electrónico protecciondedatos.tuapo@gmail.com; las oficinas del EMPLEADOR a nivel nacional o en la Carrera 112ª # 18ª 05 de Bogotá. En todo caso, he sido informado que sólo podré elevar queja por infracciones a lo dispuesto en las normas sobre Protección de Datos ante la Superintendencia de Industria y Comercio una vez haya agotado el trámite ante el EMPLEADOR o sus encargados. Conozco que la normatividad de Protección de Datos Personales tiene por objeto el desarrollo del derecho constitucional de todas las personas a conocer, actualizar y rectificar de forma gratuita la información que se recaude sobre ellas en bases de datos o archivos, y los derechos, libertades y garantías a los que se refieren el artículo 15 y 20 de la Constitución Política de Colombia. Autorizo también, de manera expresa, el envío de mensajes a través de cualquier medio que he registrado a mi EMPLEADOR el día de la contratación, para remitir comunicados internos sobre información concerniente a Seguridad Social, así como también, la notificaciones sobre licencias, permisos, cartas laborales, cesantías, citaciones, memorandos, y todos aquellos procesos internos que conlleven a la comunicación entre el EMPLEADOR y el EMPLEADO. (iii) Notificación sobre desprendibles de pagos de Nómina y/o liquidación final. En adición y complemento de las autorizaciones previamente otorgadas, autorizo de manera expresa y previa sin lugar a pagos ni retribuciones al EMPLEADOR, a sus sucesores, cesionarios a cualquier título o a quien represente los derechos, para que efectúe el Tratamiento de mis Datos Personales de la  manera y para las finalidades que se señalan a continuación. Para efectos de la presente autorización, se entiende por “Datos Personales” la información personal que suministre por cualquier medio, incluyendo, pero sin limitarse a, aquella de carácter financiero, crediticio, ';
    y = this.renderJustifiedText(doc, texto + ' ' + texto2, x, y, maxWidth, lineHeight, true, 3);

    doc.setFontSize(7);
    // Añadir otra pagina
    doc.addPage();
    y = 5; // Posición vertical al inicio de la página
    // **Cuadro para el logo y NIT**
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, 50, 13); // Cuadro del logo y NIT

    // Agregar logo
    doc.addImage(logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);

    // Agregar NIT
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("NIT", startX + 32, startY + 7);
    doc.setFont('helvetica', 'normal');
    doc.text(nit, startX + 32, startY + 10);

    // **Tabla al lado del logo**
    tableStartX = startX + 50; // Inicio de la tabla al lado del cuadro
    doc.rect(tableStartX, startY, tableWidth - 50, 13); // Borde exterior de la tabla

    // Encabezados
    doc.setFont('helvetica', 'bold');
    doc.text("PROCESO DE CONTRATACIÓN", tableStartX + 55, startY + 3);
    doc.text(this.codigoContratacion ?? '', tableStartX + 130, startY + 3);
    doc.text("CONTRATO DE TRABAJO POR OBRA O LABOR", tableStartX + 43, startY + 7);

    // Líneas divisoras
    col1 = tableStartX + 30;
    col2 = tableStartX + 50;
    col3 = tableStartX + 110;

    doc.line(tableStartX, startY + 4, tableStartX + tableWidth - 50, startY + 4); // Línea horizontal bajo el título
    doc.line(tableStartX, startY + 8, tableStartX + tableWidth - 50, startY + 8); // Línea horizontal bajo el título
    doc.line(col1, startY + 8, col1, startY + 13); // Línea vertical 1
    doc.line(col2, startY + 8, col2, startY + 13); // Línea vertical 2
    doc.line(col3, startY + 8, col3, startY + 13); // Línea vertical 3

    // **Contenido de las columnas**
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("Código: AL CO-RE-1", tableStartX + 2, startY + 11.5);
    doc.text("Versión: 07", col1 + 2, startY + 11.5); // Ajustar dentro de columna
    doc.text(`Fecha Emisión: Enero 06-21`, col2 + 5, startY + 11.5);
    doc.text("Página: 2 de 3", col3 + 6, startY + 11.5); // Ajustar dentro de columna

    // texto adicional
    y = columnStartY; // Posición inicial Y
    doc.setFontSize(6.5);
    let texto3 = 'comercial, profesional, sensible (tales como mis huellas, imagen, voz, entre otros), técnico y administrativo, privada, semiprivada o de cualquier naturaleza pasada, presente o futura, contenida en cualquier medio físico, digital o electrónico, entre otros y sin limitarse a documentos, fotos, memorias USB, grabaciones, datos biométricos, correos electrónicos y video grabaciones. Así mismo, se entiende por “Tratamiento” el recolectar, consultar, recopilar, evaluar, catalogar, clasificar, ordenar, grabar, almacenar, actualizar, modificar, aclarar, reportar, informar, analizar, utilizar, compartir, circular, suministrar, suprimir, procesar, solicitar, verificar, intercambiar, retirar, trasferir, transmitir, o divulgar, y en general, efectuar cualquier operación o conjunto de operaciones sobre mis Datos Personales en medio físicos, digitales, electrónicos, o por cualquier otro medio. La autorización que otorgo por el presente medio para el Tratamiento de mis Datos Personales tendrá las siguientes finalidades: a. Promocionar, comercializar u ofrecer, de manera individual o conjunta productos y/o servicios propios u ofrecidos en alianza comercial, a través de cualquier medio o canal, o para complementar, optimizar o profundizar el portafolio de productos y/o servicios actualmente ofrecidos. Esta autorización para el Tratamiento de mis Datos Personales se hace extensiva a las entidades subordinadas de EL EMPLEADOR, o ante cualquier sociedad en la que éstas tengan participación accionaria directa o indirectamente (en adelante “LAS ENTIDADES AUTORIZADAS”). a. autoriza explícitamente al EMPLEADOR, en forma previa, expresa e informada, para que directamente o a través de sus empleados, asesores, consultores, empresas usuarias, proveedores de servicios de selección, contratación, exámenes ocupacionales, estudios de seguridad, dotación y elementos de protección personal, capacitaciones, cursos, Fondos de empleados, Fondos funerarios, Empresas del Sistema de Seguridad Social: Fondos de Pensiones, EPS, Administradoras de Riesgos Laborales, Cajas de Compensación Familiar, entre otros: 1. A realizar cualquier operación que tenga una finalidad lícita, tales como la recolección, el almacenamiento, el uso, la circulación, supresión, transferencia y  transmisión (el “Tratamiento”) de los datos personales relacionados con su vinculación laboral y con la ejecución, desarrollo y terminación del presente contrato de trabajo, cuya finalidad incluye, pero no se limita, a los procesos verificación de la aptitud física del TRABAJADOR para desempeñar en  forma eficiente  las labores sin impactar negativamente  su salud o la  de terceros, las afiliaciones del TRABAJADOR y sus beneficiarios al Sistema general de seguridad social y parafiscales, la remisión del TRABAJADOR para que realice apertura de cuenta de nómina, archivo y procesamiento de nómina, gestión y archivo de procesos disciplinarios, archivo de documentos soporte de su vinculación contractual, reporte ante autoridades administrativas, laborales, fiscales o judiciales, entre otras, así como el cumplimiento de obligaciones legales o contractuales del EMPLEADOR con terceros, la debida ejecución del Contrato de trabajo, el cumplimiento de las políticas internas del EMPLEADOR, la verificación del cumplimiento de las obligaciones del TRABAJADOR, la administración de sus sistemas de información y comunicaciones, la generación de copias y archivos de seguridad de la información en los equipos proporcionados por EL EMPLEADOR. Además,  la información personal se recibirá y utilizará para efectos de administración del factor humano en temas de capacitación laboral, bienestar social, cumplimiento de normas de seguridad laboral y seguridad social, siendo necesario, en algunos eventos, recibir información sensible sobre estados de salud e información de menores de edad beneficiarios de esquemas de seguridad social, así como la información necesaria para el cumplimiento de obligaciones laborales de orden legal y extralegal. Toda la anterior información se tratará conforme a las exigencias legales en cada caso. 2. EL TRABAJADOR conoce el carácter facultativo de entregar o no al EMPLEADOR sus datos sensibles. 3. EL TRABAJADOR autoriza al responsable del tratamiento de manera expresa a dar tratamiento a los datos sensibles del titular, siendo esto datos los siguientes: origen racial o étnico, orientación sexual, filiación política o religiosa, datos referentes a la salud, datos biométricos, actividad en organizaciones sindicales o de derechos humanos, 4.EL TRABAJADOR da autorización expresa al responsable del tratamiento para que capture y use la información personal y sensible de sus hijos menores de edad. b.  Como elemento de análisis en etapas pre-contractuales, contractuales, y post-contractuales para establecer y/o mantener cualquier relación contractual, incluyendo como parte de ello, los siguientes propósitos: (i). Actualizar bases de datos y tramitar la apertura y/o servicios en EL EMPLEADOR o en cualquiera de las ENTIDADES AUTORIZADAS, (ii). Evaluar riesgos derivados de la relación contractual potencial, vigente o concluida. (iii). Realizar, validar,   autorizar o verificar transacciones incluyendo, cuando sea requerido, la consulta y reproducción de datos sensibles tales como la huella, imagen o la voz. (iv). Obtener conocimiento del perfil comercial o transaccional del titular, el nacimiento, modificación, celebración y/ o extinción de obligaciones directas, contingentes o indirectas, el incumplimiento de las obligaciones que adquiera con EL EMPLEADOR  o con cualquier tercero, así como cualquier novedad en relación con tales obligaciones, hábitos de pago y comportamiento  crediticio con EL EMPLEADOR y/o terceros. (v). Conocer información acerca de mi manejo de cuentas corrientes, ahorros, depósitos, tarjetas de crédito, comportamiento comercial, laboral y demás productos o servicios y, en general, del cumplimiento y manejo de mis créditos y obligaciones, cualquiera que sea su naturaleza. Esta autorización comprende información referente al manejo, estado, cumplimiento de las relaciones, contratos y servicios, hábitos de pago, incluyendo aportes al sistema de seguridad social, obligaciones y las deudas vigentes, vencidas sin cancelar, procesos, o la utilización indebida de servicios financieros. (vi). Dar cumplimiento a sus obligaciones legales y contractuales. (vii). Ejercer sus derechos, incluyendo los referentes a actividades de cobranza judicial y extrajudicial y las gestiones conexas para obtener el pago de las obligaciones a cargo del titular o de su empleador, si es el caso. (viii). Implementación de software y servicios tecnológicos. Para efectos de lo dispuesto en el presente literal b, EL EMPLEADOR  en lo que resulte aplicable, podrá efectuar el Tratamiento de mis Datos Personales  ante entidades de consulta, que manejen o administren bases de datos para los fines legalmente definidos, domiciliadas en Colombia o en el exterior, sean personas naturales o jurídicas, colombianas o extranjeras. c. Realizar ventas cruzadas de productos y/o servicios ofrecidos por EL EMPLEADOR o por cualquiera de LAS ENTIDADES  AUTORIZADAS o sus aliados comerciales, incluyendo la celebración de convenios de marca compartida. d. Elaborar y reportar información estadística, encuestas de satisfacción, estudios y análisis de mercado, incluyendo la posibilidad de contactarme para dichos propósitos. e. Enviar mensajes, notificaciones o alertas a través de cualquier medio para remitir extractos, divulgar información legal, de seguridad, promociones, campañas comerciales, publicitarias, de mercadeo, institucionales o de educación financiera, sorteos, eventos u otros beneficios e informar al titular acerca de las innovaciones efectuadas en sus productos y/o servicios, dar a conocer las mejoras o cambios en sus canales de atención, así como dar a conocer otros servicios y/o productos ofrecidos por EL EMPLEADOR;  LAS ENTIDADES AUTORIZADAS o sus aliados comerciales. f.  Llevar  a  cabo  las  gestiones  pertinentes,  incluyendo  la  recolección  y  entrega  de  información ante autoridades públicas o privadas, nacionales o extranjeras con competencia sobre EL EMPLEADOR, LAS ENTIDADES  AUTORIZADAS o sobre sus actividades, productos y /o servicios, cuando se requiera para dar cumplimiento a sus deberes legales o reglamentarios, incluyendo dentro de estos, aquellos referentes a la prevención de la evasión fiscal, lavado de activos y financiación del terrorismo u otros propósitos similares emitidas por autoridades competentes,  g. validar información con las diferentes bases de datos de EL EMPLEADOR, de LAS ENTIDADES AUTORIZADAS, de autoridades y/o entidades estatales y de terceros tales como  operadores de información y demás entidades que formen parte del Sistema de Seguridad Social Integral, empresas prestadoras de servicios públicos  y de telefonía móvil, entre otras, para desarrollar las actividades propias de objeto social principal y conexo y/o cumplir con obligaciones legales. h. Para que mis datos Personales puedan ser utilizados como medio de prueba. Los Datos Personales suministrados podrán circular y transferirse a la totalidad de las áreas de EL EMPLEADOR incluyendo proveedores de servicios, usuarios de red, redes de distribución y personas que realicen la promoción de sus productos y servicios, incluidos call centers, domiciliados en Colombia o en el exterior, sean personas naturales o jurídicas, colombianas o extranjeros a su fuerza comercial, equipos de telemercadeo y/o procesadores de datos que trabajen en nombre de EL EMPLEADOR, incluyendo pero sin limitarse, contratistas, delegados, outsourcing, tercerización, red de oficinas o aliados, con el objeto de desarrollar servicios de alojamiento de sistemas, de mantenimiento, servicios de análisis, servicios de mensajería por e-mail o correo físico, servicios de entrega, gestión de transacciones de pago, cobranza, entre otros. En consecuencia, el titular entiendepara  gastos  o  viajes,  así  como  el  valor de los tiquetes aéreos no devueltos; las sumas que llegaren a faltar en cumplimiento de mis funciones y a mi cargo previa liquidación y verificación de las mismas, Compra de Flor y/o servicio de alimentación suministrado a través de la Empresa Usuaria de manera quincenal y por el monto de  y acepta que mediante la presentación autorización concede a estos terceros, autorización para acceder a sus Datos Personales en la medida en que así lo requieren  para la prestación de los servicios para los cuales fueron contratados y sujeto al cumplimiento de los deberes que les correspondan como encargados del Tratamiento de mis Datos Personales. Igualmente, a EL EMPLEADOR para compartir mis datos Personales con las entidades gremiales a las que pertenezca la entidad, para fines comerciales, estadísticos y de estudio y análisis de mercadeo. Es entendido que las personas naturales y jurídicas, nacionales y extranjeras mencionadas anteriormente ante las cuales EL EMPLEADOR puede llevar a cabo el Tratamiento de mis Datos Personales, también cuentan con mi autorización para permitir dicho Tratamiento. Adicionalmente, mediante el otorgamiento de la presente autorización, manifiesto: (i) que los Datos Personales suministrados son veraces, verificables y completos, (ii) que conozco y entiendo que el suministro de la presente autorización es voluntaria, razón por la cual no me encuentro obligado a otorgar la presenta autorización, (iii) que conozco y entiendo que mediante la simple presentación de una comunicación escrita puedo limitar en todo o en parte el alcance de la presente autorización  para que, entre otros, la misma se otorgue únicamente frente a EL EMPLEADOR pero no frente a LAS ENTIDADES AUTORIZADAS y (iv) haber sido informado  sobre mis derechos a conocer, actualizar y rectificar mis Datos Personales, el carácter facultativo de mis respuestas a las preguntas que sean hechas cuando versen sobre datos sensibles o sobre datos de los niños, niñas o adolescentes, solicitar prueba de la autorización otorgada para su tratamiento, ser informado sobre el uso que se ha dado a los mismo, presentar quejas ante la autoridad competente por infracción a la ley una vez haya agotado el trámite de consulta o reclamo ante EL EMPLEADOR, revocar la presentación autorización, solicitar la supresión de sus datos en los casos en que sea procedente y ejercer en forma gratuita mis derechos y garantías constitucionales y legales. EL EMPLEADOR informa que el tratamiento de sus Datos Personales se efectuará de acuerdo con la Política de la entidad en esta materia, la cual puede ser consultada en sus instalaciones. DÉCIMA  TERCERA. AUTORIZACIÓN DE DESCUENTOS: El TRABAJADOR autoriza expresamente al EMPLEADOR para que se descuenten de mi salario y  prestaciones o cualquier otro concepto las sumas que por error  haya recibido, permitiendo que el EMPLEADOR compense del valor de los salarios, prestaciones legales o extralegales, indemnizaciones y otro tipo de dinero a pagar al momento de la Nómina y/o liquidación las sumas que yo como TRABAJADOR esté  debiendo al EMPLEADOR Y EMPRESA USUARIA por los siguientes conceptos: Préstamos debidamente autorizados por escrito; valor de los elementos de trabajo y mercancías extraviadas bajo mi responsabilidad y que llegaren a faltar al momento de hacer entrega del inventario; los valores que se me hubieren confiado para mi manejo y que hayan sido dispuestos abusivamente para otros propósitos en perjuicio del EMPLEADOR; los anticipos o sumas no legalizadas con las facturas o comprobantes requeridos que me fueron entregadas alimentación establecido, todo lo que exceda de valores aprobados (Celulares, Tarjetas de Crédito, etc.), modificaciones en las Bases de Datos sin el soporte correspondiente, errores de digitación y procedimientos internos que por mi culpa afecten económicamente a la empresa y cualquier pago que me haya sido realizado y que no me corresponda.  De  igual  forma,  en  caso  de  recibir  Subsidio  de Transporte y  Bonificaciones,  autorizo  la deducción  cuando se  causen ausencias al trabajo por cualquier motivo en el mes por el cual recibí pago completo. Por lo anterior, autorizo expresamente al EMPLEADOR para que retenga y cobre de mi salario y liquidación final, de cualquier otro concepto a mi favor, ';
    y = this.renderJustifiedText(doc, texto3, x, y, maxWidth, lineHeight, true, 3);

    // agregar pagina
    doc.addPage();

    y = 5; // Posición vertical al inicio de la página
    doc.setFontSize(7);
    // **Cuadro para el logo y NIT**
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, 50, 13); // Cuadro del logo y NIT

    // Agregar logo
    doc.addImage(logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);

    // Agregar NIT
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("NIT", startX + 32, startY + 7);
    doc.setFont('helvetica', 'normal');
    doc.text(nit, startX + 32, startY + 10);

    // **Tabla al lado del logo**
    tableStartX = startX + 50; // Inicio de la tabla al lado del cuadro
    doc.rect(tableStartX, startY, tableWidth - 50, 13); // Borde exterior de la tabla

    // Encabezados
    doc.setFont('helvetica', 'bold');
    doc.text("PROCESO DE CONTRATACIÓN", tableStartX + 55, startY + 3);
    doc.text(this.codigoContratacion ?? '', tableStartX + 130, startY + 3);
    doc.text("CONTRATO DE TRABAJO POR OBRA O LABOR", tableStartX + 43, startY + 7);

    // Líneas divisoras
    col1 = tableStartX + 30;
    col2 = tableStartX + 50;
    col3 = tableStartX + 110;

    doc.line(tableStartX, startY + 4, tableStartX + tableWidth - 50, startY + 4); // Línea horizontal bajo el título
    doc.line(tableStartX, startY + 8, tableStartX + tableWidth - 50, startY + 8); // Línea horizontal bajo el título
    doc.line(col1, startY + 8, col1, startY + 13); // Línea vertical 1
    doc.line(col2, startY + 8, col2, startY + 13); // Línea vertical 2
    doc.line(col3, startY + 8, col3, startY + 13); // Línea vertical 3

    // **Contenido de las columnas**
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("Código: AL CO-RE-1", tableStartX + 2, startY + 11.5);
    doc.text("Versión: 07", col1 + 2, startY + 11.5); // Ajustar dentro de columna
    doc.text(`Fecha Emisión: Enero 06-21`, col2 + 5, startY + 11.5);
    doc.text("Página: 3 de 3", col3 + 6, startY + 11.5); // Ajustar dentro de columna

    y = columnStartY; // Posición inicial Y
    doc.setFontSize(6.5);
    let texto4 = 'de mis Cesantías consignadas en el fondo de Cesantías los saldos que esté adeudando por los conceptos anteriormente citados.  DÉCIMA CUARTA. Las prestaciones sociales se liquidarán y pagaran una vez el TRABAJADOR haya diligenciado el Paz y Salvo en la compañía donde labore en misión y se pagarán en las fechas estipuladas según la  ley.  DÉCIMA QUINTA. AUTORIZACIÓN CONSIGNACION DE PAGO DE LIQUIDACIÓN FINAL O DEFINITIVA, A través del presente documento y en pleno uso de mis facultades legales e intelectuales, doy la autorización a mi EMPLEADOR,  para que me consigne el valor que corresponda a mi liquidación final o definitiva en la misma forma de pago asignada para mi Nómina, dentro de las fechas establecidas y otorgadas por la empresa; De igual manera autoriza al EMPLEADOR, en el evento en que se niegue o no sea posible recibirla directamente, para que deposite en la mencionada cuenta el monto de su liquidación final de contrato de trabajo. Autorizo también, para que me sea notificado mediante correo electrónico, mensaje de texto, whatsapp o cualquier medio registrado, el desprendible de mi liquidación definitiva con la descripción del pago y todos los documentos correspondientes a mi desvinculación laboral. DÉCIMA SEXTA. CONSENTIMIENTO INFORMADO. Exámenes toxicológicos: manifiesto que conozco la política de prevención de consumo de alcohol, y otras sustancias psicoactivas de la Empresa Usuaria, así como también la Política de la Empresa  de Servicios Temporales APOYO LABORAL TS S.A.S., (en adelante E.S.T.) Por lo tanto, sé que no debo presentarme en sus instalaciones a ejecutar las actividades para las cuales fui contratado en calidad de trabajador en misión por la E.S.T. bajo los efectos de alguna de estas sustancias o en su defecto, consumirlas durante el tiempo que dure mi permanencia ya que pongo en riesgo mi salud, mi seguridad y la de las personas que se encuentren presentes en las instalaciones. Por lo anterior, autorizo para que se me practiquen cuestionarios y/o pruebas (incluso médicas y de laboratorio), de manera preventiva, aleatoria o por confirmación, toda vez que ya me encuentre laborando dentro de las instalaciones de la empresa,  con el objeto de determinar mi aptitud física y mental para llevar a cabo las actividades contratadas, en virtud de la investigación disciplinaria que realice la Empresa y que lo amerite, o en cualquier momento cuando así lo estime pertinente la Compañía, y que los podrá utilizar como pruebas para los mismos fines. Dichas pruebas y exámenes podrán incluir las relativas al consumo de alcohol y sustancias psicoactivas, las cuales se practicarán con la metodología que la empresa usuaria establezca. En el evento en que alguna de las pruebas tenga resultado “positivo” para consumo o en caso de comprobarse el incumplimiento de las obligaciones a mi cargo en relación con esta política, la empresa usuaria informará de dicha situación a la E.S.T. a la cual me encuentro vinculado, quien es mi verdadero empleador y de manera adicional, podrá solicitar mi retiro de sus instalaciones. Autorizo que la empresa usuaria, conserve el documento que contiene los resultados, siempre y cuando lo haga con la debida reserva. La decisión que aquí manifiesto la he tomado de manera autónoma  , libre  y  voluntaria  y  por  tanto, no considero que las mencionadas pruebas y las atribuciones que aquí acepto para la empresa constituyan injerencias indebidas e inconsultas sobre mis derechos a la intimidad y al libre desarrollo de mi personalidad. DÉCIMA SEPTIMA. ENTREGA Y ACEPTACIÓN DEL CARGO Y  FUNCIONES ASIGNADAS. En   forma   atenta   le   informamos   que   en   el   ejercicio   de   su   cargo  asignado para la  Empresa Usuaria donde ingresa como trabajador en misión,  usted desarrollará  algunas de las siguientes funciones según su cargo: * Operario de Cultivo y/o Oficios Varios: Labores de Cultivo que incluyen Corte de Flor, Limpieza de Camas y Plantas, Labores Culturales, Riego, Fumigación (1),  Monitoreo, Pesaje de Productos, Transporte de Flor, Control y Calidad, erradicaciones, Enmalle, Desbotone y todas las labores de Mantenimiento de los Cultivos. *Operario de Poscosecha y/o Oficios Varios: Labores de Poscosecha como Clasificación, Boncheo, Encapuchado, Empaque, Recepción, Manejo de inventarios, Cuarto frío,  Control y Calidad y/ oficios varios. *Operario Mantenimiento: Labores de Mantenimiento, Poda de Prado, Manejo de Maquinaria Agrícola, Electricista, Electromecánico, Soldador, Maestro de Construcción, Ayudante de Construcción, Mantenimiento de Cubiertas Plásticas e Infraestructura y Redes (2) *Labores de Conducción, Auxiliar de Conducción, Logística e Inventarios y/ Oficios Varios*Apoyo/Reemplazos Administrativos: Asistente de Producción, Asistente de Poscosecha, Asistente de Gestión Humana,  Comerciales y/ Oficios Varios*Todas las demás labores asignadas por la Empresa Usuaria y que contemple el cargo para el cuál fue contratado. Igualmente, le indicamos que el incumplimiento a las funciones antes relacionadas, será calificado como falta grave y por tanto como justa causa para la finalización del contrato de trabajo, de conformidad con lo previsto en el artículo 7) literal a) numeral 6) del Decreto 2351 de 1965, norma que subrogó el artículo 62 del código Sustantivo de Trabajo,  en concordancia con lo previsto el numeral 1° del artículo 58 del mismo Estatuto. PARÁGRAFO PRIMERO. El TRABAJADOR, deberá responder por todos y cada uno de los elementos de trabajo que le entregue EL EMPLEADOR y/o la EMPRESA USUARIA para el desempeño de su cargo. DÉCIMA OCTAVA. El TRABAJADOR, debe registrar en las oficinas del EMPLEADOR, su dirección, número de teléfono y domicilio y dar aviso inmediato en cualquier cambio que ocurra. DÉCIMA NOVENA. El TRABAJADOR, debe respetar y someterse al Reglamento de Trabajo vigente de ambas empresas en todas sus partes, cuyo texto manifiesta conocer en todas sus partes. VIGÉSIMA. EL TRABAJADOR acepta, entiende y conoce que EL EMPLEADOR, tiene la obligación legal de prevenir y controlar el lavado de activos y la financiación del terrorismo, por tanto, expresa de manera voluntaria e inequívoca, que no se encuentra vinculado  ni ha sido condenado por parte de las autoridades nacionales e internacionales en cualquier tipo de investigación por delitos de narcotráfico, terrorismo, secuestro, lavado de activos, financiación del terrorismo y administración de recursos relacionados con actividades terroristas  y/o cualquier delito colateral o subyacente a estos; ni se encuentra incluido en listas para el control de lavado de activos  y financiación del terrorismo, administradas por cualquier autoridad nacional o extranjera. Convienen las partes, conforme a lo establecido en el numeral 6º del artículo séptimo del decreto 2351 de 1.965, que la inexactitud en la manifestación del EL TRABAJADOR contenida en la presente adición al contrato de trabajo, constituye falta grave y dará lugar a la terminación del contrato de trabajo por justa causa de despido. VIGÉSIMA PRIMERA. INCAPACIDADES MÉDICAS: Si EL TRABAJADOR, por causa de enfermedad o accidente, no asistiere a su trabajo, deberá presentar a EL EMPLEADOR, a la mayor brevedad, la respectiva incapacidad, a cuyo efecto se establece que exclusivamente será válida la expedida por los médicos de la respectiva Entidad Promotora de Salud, para justificar las ausencias antedichas. VIGÉSIMA SEGUNDA. AUTORIZACIÓN DE ACCESO A HISTÓRIA CLÍNICA: De acuerdo con lo establecido en el artículo 34 de la Ley 23 de 1981 y la Resolución 1995 de 1999 expedida por el Ministerio de Salud, EL TRABAJADOR autoriza expresamente a EL EMPLEADOR para que tenga acceso y copia de su historia clínica, así como de todos aquellos datos que en aquélla se registren o lleguen a ser registrados, con el fin de adelantar todos los trámites que sean necesarios ante entidades como Empresas Promotoras de Salud (EPS),  Administradoras de Riesgos laborales (ARL), Administradoras de Fondos de Pensiones (AFP), Instituciones Prestadoras de Salud (IPS), médicos particulares y demás entidades de la Seguridad Social. VIGÉSIMA TERCERA. REGLAMENTO DE TRABAJO Y DE HIGIENE Y SEGURIDAD INDUSTRIAL. El TRABAJADOR deja constancia de que conoce y acepta el Reglamento de Trabajo y el Reglamento de Higiene y Seguridad Industrial del TRABAJADOR. VIGÉSIMA CUARTA. El TRABAJADOR ha leído, entiende y acepta de manera íntegra todo el contenido del presente contrato y manifiesta bajo la gravedad de juramento, que no sufre de problemas de alcoholismo, drogadicción, enfermedad infectocontagiosa, ni consumidor habitual de sustancias alucinógenas, ni drogas enervantes.  PARÁGRADO PRIMERO. Las partes declaran que no reconocerán validas las estipulaciones anteriores a este contrato de trabajo, que este es el único vigente entre ellas reempazando y que desconocen cualquier otro verbal o escrito anterior, el cual tendrá vigencia a partir de la FECHA DE INICIACION, y para lo cual el TRABAJADOR inicia su vinculación laboral con el EMPLEADOR.; pudiendo las partes convenir por escrito modificaciones al mismo, las que formarán parte integrante de este contrato. El presente contrato se ANULARÁ si el TRABAJADOR no se presenta a laborar el día que corresponde o si la EMPRESA USUARIA desiste de la Contratación. Previa la declaración de que a él se tienen incorporadas todas las disposiciones del reglamento interno que rige en la EMPRESA EMPLEADORA. El TRABAJADOR deja expresa constancia de que al suscribir el presente contrato recibió copia del mismo'
    y = this.renderJustifiedText(doc, texto4, x, y, maxWidth, lineHeight);


    // Numerales (1) y (2) con notas al pie
    y += lineHeight; // Añadir espacio
    doc.setFont('helvetica', 'bold');
    doc.text('(1)', 5, y + lineHeight);
    doc.text('(2)', 5, y + lineHeight * 2);
    doc.setFont('helvetica', 'normal');
    doc.text('Las labores de Fumigación sólo aplican para el personal masculino mayor de edad. ', 10, y + lineHeight);
    doc.text('Estas labores se realizarán previa aprobación de requisitos del S.G.-S.S.T. de la Empresa Usuaria.', 10, y + lineHeight * 2);

    // Para constancia se firma ante testigos el día _____________________________En el Municipio de Madrid
    y += 15; // Añadir espacio
    // Fecha de contrato (no la fecha actual): día/mes/año del ContratoCandidato.
    const fechaFirmaContrato = this.getFechaContrato();
    const fechaFirmaTextoLargo = fechaFirmaContrato.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.setFont('helvetica', 'bold');
    doc.text('Para constancia se firma ante testigos el día ' + fechaFirmaTextoLargo + ' En el Municipio de ' + this.municipioFirma, 5, y);

    // Firma del EMPLEADOR.
    //
    // Apoyo Laboral firma con el bloque ESCANEADO completo (`firma/image.png`):
    // trae la firma, el sello de la empresa y el propio rótulo "El Empleador /
    // MAYRA HUAMANÍ L. / C.E. 332318". Por eso acá NO se escriben esas tres
    // líneas con `doc.text`: saldrían duplicadas encima del escaneo.
    //
    // Tu Alianza sigue con la firma suelta + rótulo impreso: el sello del PNG
    // es de Apoyo Laboral y no puede aparecer en un contrato de Alianza.
    if (marca === 'APOYO') {
      // 34 x 24.4 mm mantiene la proporción del PNG (1054x757) y no invade la
      // línea de firma del trabajador, que arranca en x = 40.
      doc.addImage('firma/image.png', 'PNG', 5, y + 10, 34, 24.4);
    } else {
      doc.addImage('firma/FirmaMayra.png', 'PNG', 5, y + 10, 20, 20);
      doc.setFont('helvetica', 'bold');
      doc.text('EL EMPLEADOR', 5, y + 35);
      doc.text('MAYRA HUAMANÍ L.', 5, y + 38);
      doc.text('C.E. 332318', 5, y + 41);
    }
    // El resto del bloque va en redonda en ambas ramas.
    doc.setFont('helvetica', 'normal');
    // linea de firma larga
    doc.setLineWidth(0.1);
    doc.line(40, y + 20, 200, y + 20);
    // Firma del trabajador
    doc.text('Firma del trabajador', 41, y + 23);
    doc.text(this.numeroDocConPuntos(this.cedula), 110, y + 18);
    doc.text('Número de Identificación del Trabajador', 110, y + 23);
    if (this.firma !== '') {
      // Asegúrate de que this.firma solo sea el base64 sin el 'data:image/png;base64,'
      const firmaConPrefijo = this.firma;

      doc.addImage(firmaConPrefijo, 'PNG', 42, 211, 35, 15);
    } else {
      /*Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se encontró la firma',
      });
      return;*/
    }


    doc.line(40, y + 40, 200, y + 40);
    const firmaAndrea = 'firma/FirmaAndreaS.png';
    doc.addImage(firmaAndrea, 'PNG', 82, y + 22, 18, 18);
    doc.setFont('helvetica', 'bold');
    doc.text('Testigo 1 Nombre y No de CC', 41, y + 43);
    doc.text('Andrea Sotelo', 80, y + 43);
    doc.text('C.C. 1.019.034.641', 80, y + 46);

    // Testigo 2
    doc.text('Testigo 2 Nombre y No de CC', 110, y + 43);
    doc.text(this.nombreCompletoLogin, 150, y + 43);
    doc.text('C.C.' + this.user.numero_de_documento, 150, y + 46);

    if (this.firmaPersonalAdministrativo !== '') {
      // Asegúrate de que this.firmaPersonalAdministrativo solo sea el base64 sin el 'data:image/png;base64,'
      const firmaPersonalAdministrativoConPrefijo = this.firmaPersonalAdministrativo;
      doc.addImage(firmaPersonalAdministrativoConPrefijo, 'PNG', 150, 230, 48, 15);
    }

    // Convertir a Blob y guardar en uploadedFiles
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa}_Contrato.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Contrato'] = { file: pdfFile, fileName };

    this.verPDF({ titulo: 'Contrato' });
  }

  /**
   * Abre el panel de lote en el paso de cédulas.
   *
   * Antes esto era un `Swal.fire` con un textarea: no se veía cuántas cédulas
   * habían quedado, ni las repetidas, y al equivocarse había que volver a
   * pegar la lista entera. Ahora el textarea es el primer paso del mismo
   * panel (ver `prepararLote`), que es a donde va lo que hacía el `if (text)`.
   */
  async abrirModalLote() {
    this.loteStep = 'cedulas';
    this.loteVista = 'cola';
    this.loteTexto = '';
    this.loteResumen = null;
    this.loteSubidas = 0;
    this.lotePorSubir = 0;
    this.batchCedulas = [];
    this.blockSeleccionado = null;
    this.todoGenerado = false;
    this.batchMode = true;
  }

  /** Señal de cancelación del lote: el for la revisa en cada ítem. */
  private batchCancelado = false;

  cerrarBatch() {
    // Si el lote sigue corriendo, primero se detiene: sin esto el loop seguía
    // mutando this.candidato/cedula por debajo de la pantalla normal y un
    // "Generar PDF" manual salía con el candidato que el lote tuviera cargado.
    this.batchCancelado = true;
    // Los object URLs de los PDFs generados no se liberan solos.
    for (const it of this.batchCedulas) {
      if (it?.rawBlobUrl) { try { URL.revokeObjectURL(it.rawBlobUrl); } catch { /* ya revocado */ } }
    }
    this.batchMode = false;
    this.batchCedulas = [];
    this.blockSeleccionado = null;
    this.loteStep = 'cedulas';
    this.loteTexto = '';
    this.loteResumen = null;
    this.loteSubidas = 0;
    this.lotePorSubir = 0;
  }

  async ejecutarBatch() {
    this.procesandoBatch = true;
    this.batchCancelado = false;

    // Backup del estado actual
    const bCedula = this.cedula;
    const bCandidato = this.candidato;
    const bVacante = this.vacante;
    const bEmpresa = this.empresa;
    const bFirma = this.firma;
    const bCodigo = this.codigoContratacion;
    // La entrevista elegida TAMBIÉN es estado por candidato: sin respaldarla y
    // sustituirla por ítem, todos los contratos del lote salían con la empresa
    // usuaria, la obra y la fecha del candidato originalmente abierto.
    const bEntrevista = this.entrevistaDoc;

    for (let item of this.batchCedulas) {
      if (this.batchCancelado) break;
      if (item.status === 'Done') continue;

      item.status = 'Processing';
      this.blockSeleccionado = item;
      // La app corre zoneless: sin esto la cola no se repinta y el usuario
      // ve el lote congelado en "En espera" mientras de verdad avanza.
      this.cdr.markForCheck();

      try {
        const datoCandidato = await firstValueFrom(
          this.registroProcesoContratacion.getCandidatoPorDocumento(item.cedula, true)
            .pipe(catchError(() => of(null)))
        );
        if (!datoCandidato) throw new Error('Candidato no encontrado');

        // Misma regla dura que la generación individual: sin firma, huella y
        // foto el contrato no se genera. El ítem queda en Error diciendo
        // exactamente qué le falta a esa cédula.
        // Se consulta también `/biometria/<cedula>`, que resuelve por PERSONA
        // (`Candidato.resolve_by_documento`) y no por la fila que devolvió
        // `by-document`: con cédula duplicada (CC / C.C / X<ced>) la biometría
        // cuelga de la otra fila y aquí salía "sin biometría" teniéndola.
        const bioPersona = await this.getBiometriaPersona(item.cedula);
        const bio = datoCandidato?.biometria;
        const firmaUrl = this.bioUrl(bio?.firma) || this.bioUrl(bioPersona?.firma);
        const huellaUrl = this.bioUrl(bio?.huella) || this.bioUrl(bioPersona?.huella);
        const fotoUrl = this.bioUrl(bio?.foto) || this.bioUrl(bioPersona?.foto);
        const faltaBio: string[] = [];
        if (!firmaUrl) faltaBio.push('firma');
        if (!huellaUrl) faltaBio.push('huella');
        if (!fotoUrl) faltaBio.push('foto');
        if (faltaBio.length) throw new Error(`Sin biometría: falta ${faltaBio.join(', ')}`);

        const vacId = datoCandidato?.entrevistas?.[0]?.proceso?.publicacion;
        const vacData = vacId ? await firstValueFrom(this.vacantesService.obtenerVacante(vacId).pipe(catchError(() => of(null)))) : null;

        this.cedula = item.cedula;
        this.candidato = datoCandidato;
        this.vacante = vacData || {};
        this.empresa = this.vacante?.temporal || '';
        this.firma = firmaUrl;
        this.huella = huellaUrl;
        this.foto = fotoUrl;
        // Misma regla de selección de entrevista que la carga individual: la
        // que tiene publicación, si no la que tiene código de contrato, si no
        // la más reciente. De acá salen obra/empresa/fecha del contrato.
        const entrevistasItem: any[] = Array.isArray(datoCandidato?.entrevistas) ? datoCandidato.entrevistas : [];
        this.entrevistaDoc =
          entrevistasItem.find((e: any) => e?.proceso?.publicacion != null)
          ?? entrevistasItem.find((e: any) => e?.proceso?.contrato_codigo || e?.proceso?.contrato?.codigo_contrato)
          ?? entrevistasItem[0]
          ?? null;
        this.codigoContratacion =
          this.entrevistaDoc?.proceso?.contrato_codigo
          ?? this.entrevistaDoc?.proceso?.contrato?.codigo_contrato ?? '';

        const result: any = await this.generarContratoCompletoTrabajoTuAlianza(true);
        if (result && result.file) {
          item.file = result.file;
          item.blobUrl = this.sanitizer.bypassSecurityTrustResourceUrl(result.blobUrl);
          item.rawBlobUrl = result.blobUrl;
          // El código y el tipo son POR ÍTEM: al subir el lote ya se restauró
          // el estado del candidato original y leer this.* archivaba todos
          // los contratos con el código del candidato equivocado.
          item.codigoContrato = this.codigoContratacion || '';
          item.tipoDoc = String(datoCandidato?.tipo_doc || '').trim() || undefined;
          item.status = 'Done';
        } else {
          throw new Error('Retorno vacío al generar PDF');
        }
      } catch (err: any) {
        item.status = 'Error';
        item.error = err?.message || 'Error desconocido';
      }
      this.cdr.markForCheck();
    }

    // Restaurar estado
    this.cedula = bCedula;
    this.candidato = bCandidato;
    this.vacante = bVacante;
    this.empresa = bEmpresa;
    this.firma = bFirma;
    this.codigoContratacion = bCodigo;
    this.entrevistaDoc = bEntrevista;
    this.procesandoBatch = false;
    this.todoGenerado = this.batchCedulas.some(x => x.status === 'Done');
    this.cdr.markForCheck();
  }

  async guardarBatch() {
    this.guardandoBatch = true;
    this.loteResumen = null;

    const items = this.batchCedulas.filter(x => x.status === 'Done' && !x.guardado && x.file);
    if (items.length === 0) {
      Swal.fire('Info', 'No hay contratos nuevos para guardar.', 'info');
      this.guardandoBatch = false;
      return;
    }

    // El progreso va en la barra del propio panel, no en un Swal bloqueante:
    // durante la subida el usuario puede seguir viendo la cola y qué cédula
    // va, en vez de quedarse mirando un popup.
    this.loteSubidas = 0;
    this.lotePorSubir = items.length;
    this.cdr.markForCheck();

    const typeId = this.typeMap['Contrato'] || 25;
    let success = 0;
    const fallidos: { cedula: string; error: string }[] = [];

    for (const item of items) {
      try {
        await firstValueFrom(this.gestionDocumentalService.guardarDocumento(
          // Código y tipo POR ÍTEM (capturados al generar): this.codigoContratacion
          // ya volvió a ser el del candidato original al terminar el lote.
          item.file.name, item.cedula, typeId, item.file, item.codigoContrato, item.tipoDoc
        ));
        item.guardado = true;
        success++;
      } catch (e: any) {
        const reason = e?.error?.detail || e?.error?.message || e?.message || 'Error desconocido';
        fallidos.push({ cedula: item.cedula, error: reason });
        console.error(`[guardarBatch] Error subiendo contrato de ${item.cedula}:`, e);
      }

      // Actualizar progreso
      this.loteSubidas = success + fallidos.length;
      this.cdr.markForCheck();
    }

    this.guardandoBatch = false;
    // El resumen queda dentro del panel, con la lista de fallidos a la vista
    // y el botón de reintentar al lado: antes era un tercer Swal que había
    // que cerrar para poder volver a intentarlo.
    this.loteResumen = { ok: success, fallidos };
    this.cdr.markForCheck();
  }

  async generarContratoCompletoTrabajoTuAlianza(isBatch: boolean = false) {
    const respContratacion: any = await firstValueFrom(
      this.contratacionService.buscarEncontratacion(this.cedula).pipe(
        take(1),
        catchError((err) => {
          console.error('Error buscando contratación:', err);
          return of({ data: [] });
        })
      )
    );

    console.log('Datos de contratación recibidos:', respContratacion);
    const datoContratacion = respContratacion?.data?.[0] ?? {};
    console.log('Dato de contratación para ficha técnica Tu Alianza:', datoContratacion);
    // Determinar la ruta del logo y el NIT
    let logoPath = '';
    let nit = '';
    let domicilio = '';
    let codigo = '';
    let version = '';
    let fechaEmision = '';

    logoPath = 'logos/Logo_TA.png';
    nit = '900.864.596-1';
    domicilio = 'CLL 7 4 49 Madrid, Cundinamarca';
    codigo = 'TA CO-RE-1';
    version = '06';
    fechaEmision = 'Mayo 02-2022';


    // Crear el documento PDF en formato vertical
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter',
      compress: true,
    });

    doc.setProperties({
      title: 'Contrato_Trabajo.pdf',
      creator: this.empresa,
      author: this.empresa,
    });


    // Posiciones iniciales
    const startX = 7;
    const startY = 7;
    const tableWidth = 203;

    // **Cuadro para el logo y NIT**
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, 50, 13); // Cuadro del logo y NIT

    // Agregar logo
    doc.addImage(logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);

    // Agregar NIT
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("NIT", startX + 32, startY + 7);
    doc.setFont('helvetica', 'normal');
    doc.text(nit, startX + 32, startY + 10);

    // **Tabla al lado del logo**
    let tableStartX = startX + 50; // Inicio de la tabla al lado del cuadro
    doc.rect(tableStartX, startY, tableWidth - 50, 13); // Borde exterior de la tabla

    // Encabezados
    doc.setFont('helvetica', 'bold');
    doc.text("PROCESO DE CONTRATACIÓN", tableStartX + 55, startY + 3);
    // doc.text(this.codigoContratacion, tableStartX + 130, startY + 3);
    doc.text("CONTRATO DE TRABAJO POR OBRA O LABOR", tableStartX + 43, startY + 7);

    // Líneas divisoras
    let col1 = tableStartX + 30;
    let col2 = tableStartX + 50;
    let col3 = tableStartX + 110;

    doc.line(tableStartX, startY + 4, tableStartX + tableWidth - 50, startY + 4); // Línea horizontal bajo el título
    doc.line(tableStartX, startY + 8, tableStartX + tableWidth - 50, startY + 8); // Línea horizontal bajo el título
    doc.line(col1, startY + 8, col1, startY + 13); // Línea vertical 1
    doc.line(col2, startY + 8, col2, startY + 13); // Línea vertical 2
    doc.line(col3, startY + 8, col3, startY + 13); // Línea vertical 3

    // **Contenido de las columnas**
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("Código: " + codigo, tableStartX + 2, startY + 11.5);
    doc.text("Versión: " + version, col1 + 2, startY + 11.5); // Ajustar dentro de columna
    doc.text(`Fecha Emisión: ${fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text("Página: 1 de 3", col3 + 6, startY + 11.5); // Ajustar dentro de columna

    // Representado por
    doc.setFontSize(7);

    const fechaISO = this.vacante.fechaIngreso; // '2024-12-04T05:00:00.000Z'

    // Convertir la fecha ISO a un objeto Date
    const fecha = new Date(fechaISO);

    // Formatear al formato dd/mm/yyyy
    const fechaFormateada = [
      String(fecha.getDate()).padStart(2, '0'),  // dd
      String(fecha.getMonth() + 1).padStart(2, '0'),  // mm
      fecha.getFullYear()  // yyyy
    ].join('/');
    // helper: primer valor NO vacío (null/undefined/''/'   ' => ignora)
    const pickText = (...vals: any[]) => {
      for (const v of vals) {
        const t = (v ?? '').toString().trim();
        if (t) return t;
      }
      return '';
    };

    // helper: solo fecha (si viene con hora, recorta) y la deja en YYYY-MM-DD
    const onlyDate = (v: any) => {
      const s = pickText(v);
      if (!s) return '';
      return s.split('T')[0].split(' ')[0].trim();
    };

    // ✅ úsalo en tu arreglo
    // =========================================================
    // ✅ Helpers: T = título normal, V = valor en MAYÚSCULAS
    // ✅ + Normaliza textos con letras/dígitos separados: "C A R A" -> "CARA", "3 0 3 4" -> "3034"
    // =========================================================
    // =========================================================
    // ✅ FIX: Domicilio del Trabajador quedaba con letras separadas ("C A R A ...")
    // ✅ Solución: normalizar tokens separados (letras sueltas y números sueltos)
    // =========================================================

    // =========================================================
    // ✅ FIX REAL (2 cosas):
    // 1) Limpia caracteres invisibles (ZWSP, etc.) y une letras/dígitos separados.
    // 2) Resetea charSpacing de jsPDF a 0 antes de pintar texto (si quedó “pegado” de otra parte).
    // =========================================================

    // =========================================================
    // ✅ FIX DEFINITIVO:
    // 1) Normaliza el texto (quita invisibles/espacios raros, une letras/dígitos sueltos).
    // 2) Fuerza charSpace: 0 EN CADA doc.text() (no depende del estado global).
    //    (jsPDF soporta options.charSpace en doc.text) :contentReference[oaicite:1]{index=1}
    // =========================================================

    // ✅ Helpers: T = título normal, V = valor en MAYÚSCULAS (normalizado)
    const T = (v: any) => String(v ?? '').trim();

    const normalizeText = (v: any): string => {
      let s = String(v ?? '');

      // Normaliza unicode (por si vienen combinaciones raras)
      if (typeof (s as any).normalize === 'function') {
        s = s.normalize('NFKD');
      }

      // Elimina invisibles típicos (ZWSP/ZWNJ/ZWJ/BOM/WJ/soft-hyphen, etc.)
      s = s.replace(/[\u200B-\u200D\uFEFF\u2060-\u2064\u00AD]/g, '');

      // Quita marcas combinantes (tildes “separadas”)
      // (si no soporta \p{M}, cae sin problema porque la mayoría no trae esto)
      try {
        s = s.replace(/\p{M}+/gu, '');
      } catch {
        // fallback: rango común de diacríticos combinantes
        s = s.replace(/[\u0300-\u036F]+/g, '');
      }

      // Espacios raros -> espacio normal
      s = s.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

      // Colapsa whitespace
      s = s.replace(/\s+/g, ' ').trim();
      if (!s) return '';

      const tokens = s.split(' ');
      const out: string[] = [];

      let buf = '';
      let kind: 'L' | 'D' | null = null;

      const flush = () => {
        if (buf) out.push(buf);
        buf = '';
        kind = null;
      };

      const isSingleLetter = (t: string) => {
        // unicode letter si está disponible
        try { return /^\p{L}$/u.test(t); } catch { return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]$/.test(t); }
      };

      for (const t of tokens) {
        if (!t) continue;

        if (isSingleLetter(t)) {
          if (kind && kind !== 'L') flush();
          kind = 'L';
          buf += t;
          continue;
        }

        // Los dígitos sueltos NO se juntan: el domicilio "CLL 7 4 49" debe
        // salir tal cual, no "CLL 74 49". Solo se juntan letras espaciadas
        // (tipo "H E I D Y" → "HEIDY").

        flush();
        out.push(t);
      }

      flush();
      return out.join(' ');
    };

    const V = (v: any) => normalizeText(v).toUpperCase();

    // Orden alineado a la plantilla oficial TA CO-RE-1 (CONTRATO POR OBRA O
    // LABOR): Representado por → Domicilio del patrono → Nombre del Trabajador →
    // Tipo y No de Identificación → Fecha de Nacimiento → Domicilio del
    // Trabajador → Fecha de Iniciación → Salario → Periodo → Subsidio → Forma
    // de Pago → Empresa Usuaria → Cargo → Descripción. (Email queda al final.)
    const datos = [
      { titulo: T('Representado por'), valor: V('HEIDY JACKELINE TORRES SOTELO') },

      { titulo: T('Domicilio del patrono'), valor: V(domicilio) },

      {
        titulo: T('Nombre del Trabajador'),
        valor: V([
          this.candidato?.primer_apellido,
          this.candidato?.segundo_apellido,
          this.candidato?.primer_nombre,
          this.candidato?.segundo_nombre,
        ].filter(x => String(x ?? '').trim()).join(' '))
      },

      { titulo: T('Tipo y No de Identificación'), valor: V(`${this.candidato?.tipo_doc ?? ''}        ${this.numeroDocConPuntos(this.cedula)}   -   Email: ${pickText(this.candidato?.contacto?.email, datoContratacion?.primercorreoelectronico)}`) },

      {
        titulo: T('Fecha de Nacimiento'),
        valor: V(this.parseDateToDDMMYYYY(pickText(this.candidato?.fecha_nacimiento, datoContratacion?.fecha_nacimiento)) || onlyDate(pickText(this.candidato?.fecha_nacimiento, datoContratacion?.fecha_nacimiento)))
      },

      {
        titulo: T('Domicilio del Trabajador'),
        valor: V(
          [
            (this.candidato?.residencia?.direccion ?? datoContratacion.direccion_residencia),
            this.candidato?.residencia?.barrio,
            datoContratacion.municipio
          ]
            .filter(x => String(x ?? '').trim())
            .join(' - ')
        )
      },

      { titulo: T('Fecha de Iniciación'), valor: V(this.parseDateToDDMMYYYY(this.candidato?.entrevistas?.[0]?.proceso?.contrato?.fecha_ingreso) || (this.candidato?.entrevistas?.[0]?.proceso?.contrato?.fecha_ingreso ?? '')) },

      {
        titulo: T('Salario Mensual Ordinario'),
        valor: V(this.salarioContratoDoc)
      },

      { titulo: T('Periodo de Pago Salario'), valor: V('Quincenal') },

      { titulo: T('Subsidio de Transporte'), valor: V('SE PAGA EL LEGAL VIGENTE O SE SUMINISTRA EL TRANSPORTE') },

      { titulo: T('Forma de Pago'), valor: V('Banca Móvil, Cuenta de Ahorro o Tarjeta Monedero') },

      { titulo: T('Nombre Empresa Usuaria'), valor: V(this.empresaUsuariaDoc) },

      { titulo: T('Cargo'), valor: V(this.vacante?.cargo) },

      { titulo: T('Descripción de la Obra/Motivo Temporada '), valor: V(this.descripcionObraDoc) },
    ];

    // =========================================================
    // Render en PDF (FORZANDO charSpace = 0 en CADA texto)
    // =========================================================
    const columnWidth = 110;
    const rowSpacing = 3;
    const columnMargin = 10;
    const columnStartX = 7;
    const columnStartY = startY + 17;
    const rowsPerColumn = 15;

    // Offset vertical acumulado por columna. Cuando una celda (p.ej. la
    // descripción de la obra/labor) se expande a múltiples líneas, las celdas
    // siguientes en la MISMA columna deben empujarse hacia abajo para no
    // solaparse.
    const yOffsetByColumn: Record<number, number> = {};
    const valueLineH = 2.5; // mm aprox para fontSize 7

    datos.forEach((item, index) => {
      const currentColumn = Math.floor(index / rowsPerColumn);
      const rowInColumn = index % rowsPerColumn;

      const x = columnStartX + currentColumn * (columnWidth + columnMargin);
      const y = (columnStartY + rowInColumn * rowSpacing) + 3 + (yOffsetByColumn[currentColumn] ?? 0);

      // (opcional) también resetea estado global
      if (typeof (doc as any).setCharSpace === 'function') {
        (doc as any).setCharSpace(0);
      }

      // ✅ Título normal (charSpace forzado a 0)
      doc.setFont('helvetica', 'normal');
      (doc as any).text(`${item.titulo}:`, x, y, { charSpace: 0 });

      // ✅ Valor negrita (charSpace forzado a 0)
      doc.setFont('helvetica', 'bold');
      const valueText = String(item.valor ?? '').trim();

      const isDescripcion = String(item.titulo ?? '')
        .toLowerCase()
        .includes('descripción de la obra');

      if (index > 14) {
        (doc as any).text(valueText, x + 30.2, y, { charSpace: 0 });
      } else if (isDescripcion) {
        // La descripción es la última fila de la ficha: puede usar TODA la
        // línea, con el mismo margen derecho que el izquierdo de la columna.
        const valueX = x + 48;
        const valueMaxW = doc.internal.pageSize.getWidth() - columnStartX - valueX;
        const lines: string[] = doc.splitTextToSize(valueText || '—', Math.max(20, valueMaxW));
        (doc as any).text(lines, valueX, y, { charSpace: 0 });
        const extra = Math.max(0, lines.length - 1);
        yOffsetByColumn[currentColumn] = (yOffsetByColumn[currentColumn] ?? 0) + extra * valueLineH;
      } else {
        (doc as any).text(valueText, x + 48, y, { charSpace: 0 });
      }
    });



    // Restaurar la fuente a la normal después del bucle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    // Posición vertical después de los datos. Tomamos el mayor offset acumulado
    // entre columnas para garantizar que el texto siguiente no pise las líneas
    // extras de la descripción multilinea de obra/labor.
    const maxYOffset = Math.max(0, ...Object.values(yOffsetByColumn));
    let y = columnStartY + rowsPerColumn * rowSpacing + 2 + maxYOffset;
    // Texto adicional
    let texto = 'Entre  el  EMPLEADOR  y  el   TRABAJADOR  arriba indicados,  se  ha celebrado el contrato  regulado  por  las cláusulas  que  adelante  se  indican,  aparte  de  la  ley,  siendo  ellas las  siguientes:  PRIMERA.  El Trabajador,  a  partir  de  la  fecha  de  iniciación,  se  obliga  para  con  e l  EMPLEADOR   a ejecutar  la  obra arriba  indicada  sometiéndose  durante  su realización  en  todo  a  las  órdenes  de  éste. Declara  por  consiguiente e l TRABAJADOR completa y total  disponibilidad para con  el  EMPLEADOR   para  ejecutar  las  obras  indicadas  en  el  encabezamiento,  siempre  que así  le  sean  exigidas  por  sus clientes  al   EMPLEADOR,   sin  que  por  ello  se  opere  desmejora  o  modificación  sustancial  de las  condiciones de trabajo tenidas  en  cuenta en  el  momento  de  la  suscripción  de  este  contrato.   SEGUNDA.   DURACIÓN DEL CONTRATO:   La necesaria  para  la  realización de la obra o labor contratada  y  conforme  a  las  necesidades  del  patrono  o  establecimiento  que  requiera  la  ejecución  de  la  obra,  todo  conforme a lo previsto en el Art. 45 del CST y teniendo en cuenta  la  fecha  de  iniciación  de  la  obra;  y  la  índole  de  la  misma,  circunstancias  una  y  otra  ya  anotadas.  PARÁGRAFO PRIMERO:  Las  partes  acuerdan  que  por  ser  el TRABAJADOR contratado como trabajador en misión para ser enviado a la empresa la duración de la obra o labor no podrá superar el tiempo establecido en el Art. 77 de la Ley 50 de 1990 en su numeral 3°. PARÁGRAFO SEGUNDO: El término de duración del presente contrato es de carácter temporal por ser el EMPLEADOR una  empresa  de  servicios temporales,  y  por  tanto tendrá  vigencia  hasta la realización  de  la  obra o  labor  contratada  que  sea  indicada  por  las  Empresas  Usuarias  del  EMPLEADOR  en  este  contrato, acordando  las  partes  que  para  todos  los  efectos  legales,  la  obra  o  labor  contratada  termina  en  la  fecha  en  que  la  EMPRESA  USUARIA, a la que será  enviado el  TRABAJADOR, comunique la terminación de la misma. PARÁGRAFO TERCERO: La labor se  realizará  en  las  instalaciones de la EMPRESA ';
    // this.vacante.empresaUsuariaSolicita + CENTRO DE COSTOS + this.vacante.finca + DIR. + this.vacante.direccion
    doc.setFont('helvetica', 'normal');
    let x = 7;
    const lineHeight = 3.4;
    const maxWidth = 203;

    doc.setFontSize(6.5);
    // Empresa usuaria + centro de costos van PEGADOS al final del PARÁGRAFO
    // TERCERO, dentro del mismo párrafo: al ir en MAYÚSCULAS,
    // renderJustifiedText los pinta en negrita él solo.
    const partes = [
      this.empresaUsuariaDoc,
      'CENTRO DE COSTOS',
      this.centroCostoDoc || '',
      this.direccionDoc ? `DIR. ${this.direccionDoc}` : ''
    ].filter(Boolean); // elimina los vacíos o null

    // MAYÚSCULAS obligatorias (incluida la dirección) → renderJustifiedText
    // pinta en negrita las palabras en mayúsculas.
    const textoLinea = partes.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
    texto += textoLinea + (textoLinea.endsWith('.') ? '' : '.');

    // TERCERA. continúa EN EL MISMO párrafo, como texto corrido después de la
    // dirección: se concatena con `texto` y se renderiza todo en UN solo bloque
    // justificado (sin salto de párrafo y sin riesgo de solaparse).
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    let texto2 = 'TERCERA. El salario como contraprestación del servicio será el indicado arriba, según la clasificación de oficios y tarifas determinados por el EMPLEADOR, la cual hace parte de este contrato; sometida sí en su eficiencia a que el valor a recibir corresponda al oficio respectivo efectivamente contratado con el usuario, según el tiempo laborado en la respectiva jornada, inferior a la máxima legal; éste regirá en proporción al número de horas respectivamente trabajadas y en él están los valores incluidos correspondientes a dominicales y festivos reconocidos por la ley como descanso remunerado. PARÁGRAFO PRIMERO: El patrono manifiesta expresamente que el TRABAJADOR tendrá derecho a todas las prestaciones sociales consagradas en la ley 50 de 1990 y demás estipulaciones previstas en el CST. Tales como compensación monetaria por vacaciones y prima de  servicios  proporcional al tiempo laborado, cualquiera que este sea. PARÁGRAFO SEGUNDO: Se conviene por las partes, que en caso de que el TRABAJADOR devengue comisiones o cualquiera otra modalidad de salario variable, el 82.5 % de dichos ingresos constituyen remuneración ordinaria y el 17.5 % restante  está  destinado  a  remunerar  el  descanso  en  días  dominicales y festivos de que tratan los capítulos I y II del título VII del CST. CUARTA. EL TRABAJADOR, se someterá al horario de trabajo que señale el EMPLEADOR de acuerdo con las especificaciones del Usuario. QUINTA. PERÍODO DE PRUEBA: el período de prueba no excederá de dos (2) meses ni podrá ser superior a la quinta parte del término pactado, si el contrato tuviere una duración inferior a un año. SEXTA. EL TRABAJADOR y EL EMPLEADOR podrán convenir en repartir las horas de la jornada diaria en los términos del Art. 164 del CST., teniendo en cuenta que el descanso entre las secciones de la jornada no se computa dentro de la misma, según el art. 167 del estatuto Ibídem.  Así  mismo  todo  trabajador  extra,  suplementario  o  festivo, solo  será reconocido en caso de ser exigido o autorizado a trabajar por el EMPLEADOR a solicitud de la entidad con la cual aquel tenga acuerdo de realización de trabajo o servicio. SÉPTIMA. Son justas causas para dar por terminado este contrato, además de las previstas en el art.7° del decreto 2351, las disposiciones concordantes y las consignadas en el reglamento interno del trabajo del EMPLEADOR, así como las siguientes: 1ª La terminación por cualquier causa, del contrato de prestación de servicios suscritos entre el EMPLEADOR y el USUARIO en donde prestará servicios el TRABAJADOR. 2ª El que la EMPRESA USUARIA en donde prestará servicios el TRABAJADOR, solicite el cambio de este por cualquier causa. 3ª El que la EMPRESA USUARIA en donde prestará servicios el TRABAJADOR, comunique la terminación de la obra o labor contratada. 4ª Que la EMPRESA USUARIA comunique al EMPLEADOR el incumplimiento leve de cualquiera de las obligaciones por parte del TRABAJADOR en TRES oportunidades, dos de las cuales hayan generado SANCIÓN AL TRABAJADOR. OCTAVA. Las partes acuerdan que NO CONSTITUYEN SALARIO, las sumas que ocasionalmente y por mera liberalidad reciba el TRABAJADOR del EMPLEADOR, como auxilios, gratificaciones, bonificaciones, primas extralegales, premios, bonos ocasionales, gastos de transporte adicionales y representación que el EMPLEADOR otorgue o llegue a otorgar en cualquier tiempo al TRABAJADOR, como tampoco no constituyen salario en dinero o en especie, cualquier alimentación, habitación o vestuario que entregue el EMPLEADOR, o un TERCERO al TRABAJADOR, durante la vigencia de este contrato. Tampoco constituirá salario, conforme a los términos del artículo 128 del Código Sustantivo del trabajo, cualquier bonificación o auxilio habitual, que se llegaren a acordar convencional o habitualmente entre las partes. Estos dineros, no se computarán como parte de salario para efectos de prestaciones sociales liquidables o BASE1 de éste. Al efecto el TRABAJADOR y el EMPLEADOR, así lo pactan expresamente en los términos del artículo 128 del C.S. del T. en C. Con. Con el articulo quince (15) de la ley cincuenta (50) de 1990. PARÁGRAFO PRIMERO: Las partes acuerdan que el EMPLEADOR, a su arbitrio y liberalidad podrá en cualquier momento cancelar o retirar el pago de bonificaciones habituales o esporádicas que en algún momento reconozca o hubiese reconocido al trabajador diferentes a su salario, sin que esto constituya desmejora de sus condiciones laborales; toda vez que como salario y retribución directa a favor del trabajador derivada de su actividad o fuerza laboral únicamente se pacta la suma establecida en la caratula del presente contrato. NOVENA.  En caso que el TRABAJADOR requiera ausentarse de su lugar de trabajo, deberá avisar por lo menos con 24 horas de anticipación a la EMPRESA USUARIA o según lo establecido en el Reglamento Interno de la misma.  DÉCIMA. CONFIDENCIALIDAD: El TRABAJADOR en virtud del presente contrato se compromete a 1) Manejar de manera confidencial la información que como tal sea presentada y entregada, y toda aquella que se genere en torno a ella como fruto de la prestación de sus servicios. 2) Guardar confidencialidad sobre esta información y no emplearla en beneficio propio o de terceros mientras conserve sus características de confidencialidad y que pueda perjudicar los intereses del EMPLEADOR o de la EMPRESA USUARIA. 3) Solicitar previamente y por escrito autorización para cualquier publicación relacionada con el tema de contrato, autorización que debe solicitarse ante el empleador. DÉCIMA PRIMERA. AUTORIZACION TRATAMIENTO DE DATOS PERSONALES, 1). De acuerdo a lo establecido en la ley 1581 de 2012, la Constitución Nacional y a las políticas establecidas por el EMPLEADOR para el caso en particular, el trabajador debe guardar reserva respecto a la protección de datos de los clientes, proveedores, compañeros, directivos del EMPLEADOR Y EMPRESA USUARIA, salvo que medie autorización expresa de cada persona para divulgar la información. 2). Guardar completa reserva sobre las operaciones, negocios y procedimientos industriales y comerciales, o cualquier otra clase de datos acerca del EMPLEADOR Y EMPRESA USUARIA que conozca por razón de sus funciones o de sus relaciones con ella, lo que no obsta para denunciar delitos comunes o violaciones del contrato de trabajo o de las normas legales de trabajo ante las autoridades competentes. DÉCIMA SEGUNDA. DECLARACIONES: Autorización Tratamiento Datos Personales “Ley de Protección de Datos 1581 de 2012 – decreto 1733 de 2013” Declaro que he sido informado que conozco y acepto la Política de Uso de Datos Personales e Información del EMPLEADOR, y que la información proporcionada es veraz, completa, exacta, actualizada y verificable. Mediante la firma del presente documento, manifiesto que conoce y acepto que cualquier consulta o reclamación relacionada con el Tratamiento de sus datos personales podrá ser elevada por escrito ante el EMPLEADOR; (¡) Que la Empresa TU ALIANZA S.A.S con NIT. 900.864.596-1, con domicilio principal en la Calle 7 No. 7– 49 de Madrid,  para efectos  de  lo  dispuesto  en  la ley  Estatutaria  1581  de  2012,  el  Decreto  1733  de  2013,  y  demás  normas  que  lo adicionen o modifiquen relativas a la Protección de Datos Personales, es responsable del tratamiento de los datos PERSONALES QUE LE HE SUMINISTRADO. (¡¡). Que, para el ejercicio de mis derechos relacionados con mis datos personales, el EMPLEADOR ha puesto a mi disposición la línea de atención: Afiliados marcando a Bogotá 6017444002; a través del correo electrónico protecciondedatos.tuapo@gmail.com; las oficinas del EMPLEADOR a nivel nacional o en la Carrera 112ª # 18ª 05 de  Bogotá.  En  todo  caso,  he  sido  informado  que  sólo  podré  elevar  queja  por infracciones a lo dispuesto en las normas sobre Protección de Datos ante la Superintendencia de Industria y Comercio una vez haya agotado el trámite ante el EMPLEADOR o sus encargados. Conozco que la normatividad de Protección de Datos Personales tiene por  objeto  el  desarrollo  del  derecho  constitucional  de  todas  las  personas  a  conocer,  actualizar  y  rectificar  de  forma  gratuita  la  información  que  se  recaude  sobre  ellas  en'
    // Encabezado de las páginas 2..3, dibujado por renderJustifiedText en CADA
    // salto de página: así el texto fluye CONTINUO entre hojas y la última
    // línea de cada página queda llena y justificada como cualquier renglón
    // (antes cada hoja era un bloque aparte y su última línea quedaba corta o
    // estirada con espacios enormes).
    let numPagina = 1;
    const encabezadoPagina = (): number => {
      numPagina++;
      doc.setFontSize(7);
      doc.setLineWidth(0.1);
      doc.rect(startX, startY, 50, 13); // Cuadro del logo y NIT
      doc.addImage(logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);
      doc.setFont('helvetica', 'bold');
      doc.text("NIT", startX + 32, startY + 7);
      doc.setFont('helvetica', 'normal');
      doc.text(nit, startX + 32, startY + 10);
      tableStartX = startX + 50;
      doc.rect(tableStartX, startY, tableWidth - 50, 13);
      doc.setFont('helvetica', 'bold');
      doc.text("PROCESO DE CONTRATACIÓN", tableStartX + 55, startY + 3);
      doc.text("CONTRATO DE TRABAJO POR OBRA O LABOR", tableStartX + 43, startY + 7);
      col1 = tableStartX + 30;
      col2 = tableStartX + 50;
      col3 = tableStartX + 110;
      doc.line(tableStartX, startY + 4, tableStartX + tableWidth - 50, startY + 4);
      doc.line(tableStartX, startY + 8, tableStartX + tableWidth - 50, startY + 8);
      doc.line(col1, startY + 8, col1, startY + 13);
      doc.line(col2, startY + 8, col2, startY + 13);
      doc.line(col3, startY + 8, col3, startY + 13);
      doc.setFont('helvetica', 'bold');
      doc.text("Código: " + codigo, tableStartX + 2, startY + 11.5);
      doc.text("Versión: " + version, col1 + 2, startY + 11.5);
      doc.text(`Fecha Emisión: ${fechaEmision}`, col2 + 5, startY + 11.5);
      doc.text(`Página: ${numPagina} de 3`, col3 + 6, startY + 11.5);
      // Restaurar la fuente del cuerpo: renderJustifiedLine no fija el tamaño.
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      return columnStartY;
    };

    let texto3 = 'bases de datos o archivos, y los derechos, libertades y garantías a los que se refieren el artículo 15 y 20 de la Constitución Política de Colombia. Autorizo también, de manera expresa, el envío de mensajes a través de cualquier medio que he registrado a mi EMPLEADOR el día de la contratación, para remitir comunicados internos sobre información concerniente a Seguridad Social, así como también, la notificaciones sobre licencias, permisos, cartas laborales, cesantías, citaciones, memorandos, y todos aquellos procesos internos que conlleven a la comunicación entre el EMPLEADOR y el EMPLEADO. (iii) Notificación sobre desprendibles de pagos de Nómina y/ o liquidación final. En adición y complemento de las autorizaciones previamente otorgadas, autorizo de manera expresa y previa sin lugar a pagos ni retribuciones al EMPLEADOR, a sus sucesores, cesionarios a cualquier título o a quien represente los derechos, para que efectúe el Tratamiento de mis Datos Personales de la manera y para las finalidades que se señalan a continuación. Para efectos de la presente autorización, se entiende por “Datos Personales” la información personal que suministre por cualquier medio, incluyendo, pero sin limitarse a, aquella de carácter financiero, crediticio, comercial, profesional, sensible (tales como mis huellas, imagen, voz, entre otros), técnico y administrativo, privada, semiprivada o de cualquier naturaleza pasada, presente o futura, contenida en cualquier medio físico, digital o electrónico, entre otros y sin limitarse a documentos, fotos, memorias USB, grabaciones, datos biométricos, correos electrónicos y video grabaciones. Así mismo, se entiende por “Tratamiento” el recolectar, consultar, recopilar, evaluar, catalogar, clasificar, ordenar, grabar, almacenar, actualizar, modificar, aclarar, reportar, informar, analizar, utilizar, compartir, circular, suministrar, suprimir, procesar, solicitar, verificar, intercambiar, retirar, trasferir, transmitir, o divulgar, y en general, efectuar cualquier operación o conjunto de operaciones sobre mis Datos Personales en medio físicos, digitales, electrónicos, o por cualquier otro medio. La autorización que otorgo por el presente medio para el Tratamiento de mis Datos Personales tendrá las siguientes finalidades: a. Promocionar, comercializar u ofrecer, de manera individual o conjunta productos y/o servicios propios u ofrecidos en alianza comercial, a través de cualquier medio o canal, o para complementar, optimizar o profundizar el portafolio de productos y/o servicios actualmente ofrecidos. Esta autorización para el Tratamiento de mis Datos Personales se hace extensiva a las entidades subordinadas de EL EMPLEADOR, o ante cualquier sociedad en la que éstas tengan participación accionaria directa o indirectamente (en adelante “LAS ENTIDADES AUTORIZADAS”). a. autoriza explícitamente al EMPLEADOR , en forma previa, expresa e informada, para que directamente o a través de sus empleados, asesores, consultores, empresas usuarias, proveedores de servicios de selección, contratación, exámenes ocupacionales, estudios de seguridad, dotación y elementos de protección personal, capacitaciones, cursos, Fondos de empleados, Fondos funerarios, Empresas del Sistema de Seguridad Social: Fondos de Pensiones, EPS, Administradoras de Riesgos Laborales, Cajas de Compensación Familiar, entre otros: 1. A realizar cualquier operación que tenga una finalidad lícita, tales como la recolección, el almacenamiento, el uso, la circulación, supresión, transferencia y transmisión (el “Tratamiento”) de los datos personales relacionados con su vinculación laboral y con la ejecución, desarrollo y terminación del presente contrato de trabajo, cuya finalidad incluye, pero no se limita, a los procesos verificación de la aptitud física del TRABAJADOR para desempeñar en forma eficiente las labores sin impactar negativamente su salud o la de terceros, las afiliaciones del TRABAJADOR y sus beneficiarios al Sistema general de seguridad social y parafiscales, la remisión del TRABAJADOR para que realice apertura de cuenta de nómina, archivo y procesamiento de nómina, gestión y archivo de procesos disciplinarios, archivo de documentos soporte de su vinculación contractual, reporte ante autoridades administrativas, laborales, fiscales o judiciales, entre otras, así como el cumplimiento de obligaciones legales o contractuales del EMPLEADOR con terceros, la debida ejecución del Contrato de trabajo, el cumplimiento de las políticas internas del EMPLEADOR, la verificación del cumplimiento de las obligaciones del TRABAJADOR, la administración de sus sistemas de información y comunicaciones, la generación de copias y archivos de seguridad de la información en los equipos proporcionados por EL EMPLEADOR. Además, la información personal se recibirá y utilizará para efectos de administración del factor humano en temas de capacitación laboral, bienestar social, cumplimiento de normas de seguridad laboral y seguridad social, siendo necesario, en algunos eventos, recibir información sensible sobre estados de salud e información de menores de edad beneficiarios de esquemas de seguridad social, así como la información necesaria para el cumplimiento de obligaciones laborales de orden legal y extralegal. Toda la anterior información se tratará conforme a las exigencias legales en cada caso. 2. EL TRABAJADOR conoce el carácter facultativo de entregar o no al EMPLEADOR sus datos sensibles. 3. EL TRABAJADOR autoriza al responsable del tratamiento de manera expresa a dar tratamiento a los datos sensibles del titular, siendo esto datos los siguientes: origen racial o étnico, orientación sexual, filiación política o religiosa, datos referentes a la salud, datos biométricos, actividad en organizaciones sindicales o de derechos humanos, 4.EL TRABAJADOR da autorización expresa al responsable del tratamiento para que capture y use la información personal y sensible de sus hijos menores de edad. b. Como elemento de análisis en etapas pre-contractuales, contractuales, y post- contractuales para establecer y/o mantener cualquier relación contractual, incluyendo como parte de ello, los siguientes propósitos: (i). Actualizar bases de datos y tramitar la apertura y/o servicios en EL EMPLEADOR o en cualquiera de las ENTIDADES AUTORIZADAS, (ii). Evaluar riesgos derivados de la relación contractual potencial, vigente o concluida. (iii). Realizar, validar, autorizar o verificar transacciones incluyendo, cuando sea requerido, la consulta y reproducción de datos sensibles tales como la huella, imagen o la voz. (iv). Obtener conocimiento del perfil comercial o transaccional del titular, el nacimiento, modificación, celebración y/ o extinción de obligaciones directas, contingentes o indirectas, el incumplimiento de las obligaciones que adquiera con EL EMPLEADOR o con cualquier tercero, así como cualquier novedad en relación con tales obligaciones, hábitos de pago y comportamiento crediticio con EL EMPLEADOR y/o terceros. (v). Conocer información acerca de mi manejo de cuentas corrientes, ahorros, depósitos, tarjetas de crédito, comportamiento comercial, laboral y demás productos o servicios y, en general, del cumplimiento y manejo de mis créditos y obligaciones, cualquiera que sea su naturaleza. Esta autorización comprende información referente al manejo, estado, cumplimiento de las relaciones, contratos y servicios, hábitos de pago, incluyendo aportes al sistema de seguridad social, obligaciones y las deudas vigentes, vencidas sin cancelar, procesos, o la utilización indebida de servicios financieros. (vi). Dar cumplimiento a sus obligaciones legales y contractuales. (vii). Ejercer sus derechos, incluyendo los referentes a actividades de cobranza judicial y extrajudicial y las gestiones conexas para obtener el pago de las obligaciones a cargo del titular o de su empleador, si es el caso. (viii). Implementación de software y servicios tecnológicos. Para efectos de lo dispuesto en el presente literal b, EL EMPLEADOR en lo que resulte aplicable, podrá efectuar el Tratamiento de mis Datos Personales ante entidades de consulta, que manejen o administren bases de datos para los fines legalmente definidos, domiciliadas en Colombia o en el exterior, sean personas naturales o jurídicas, colombianas o extranjeras. c. Realizar ventas cruzadas de productos y/o servicios ofrecidos por EL EMPLEADOR o por cualquiera de LAS ENTIDADES AUTORIZADAS o sus aliados comerciales, incluyendo la celebración de convenios de marca compartida. d. Elaborar y reportar información estadística, encuestas de satisfacción, estudios y análisis de mercado, incluyendo la posibilidad de contactarme para dichos propósitos. e. Enviar mensajes, notificaciones o alertas a través de cualquier medio para remitir extractos, divulgar información legal, de seguridad, promociones, campañas comerciales, publicitarias, de mercadeo, institucionales o de educación financiera, sorteos, eventos u otros beneficios e informar al titular acerca de las innovaciones efectuadas en sus productos y/o servicios, dar a conocer las mejoras o cambios en sus canales de atención, así como dar a conocer otros servicios y/o productos ofrecidos por EL EMPLEADOR; LAS ENTIDADES AUTORIZADAS o sus aliados comerciales. f. Llevar a cabo las gestiones pertinentes, incluyendo la recolección y entrega de información ante autoridades públicas o privadas, nacionales o extranjeras con competencia sobre EL EMPLEADOR, LAS ENTIDADES AUTORIZADAS o sobre sus actividades, productos y /o servicios, cuando se requiera para dar cumplimiento a sus deberes legales o reglamentarios, incluyendo dentro de estos, aquellos referentes a la prevención de la evasión fiscal, lavado de activos y financiación del terrorismo u otros propósitos similares emitidas por autoridades competentes, g. validar información con las diferentes bases de datos de EL EMPLEADOR, de LAS ENTIDADES AUTORIZADAS, de autoridades y/o entidades estatales y de terceros tales como operadores de información y demás entidades que formen parte del Sistema de Seguridad Social Integral, empresas prestadoras de servicios públicos y de telefonía móvil, entre otras, para desarrollar las actividades propias de objeto social principal y conexo y/o cumplir con obligaciones legales. h. Para que mis datos Personales puedan ser utilizados como medio de prueba. Los Datos Personales suministrados podrán circular y transferirse a la totalidad de las áreas de EL EMPLEADOR incluyendo proveedores de servicios, usuarios de red, redes de distribución y personas que realicen la promoción de sus productos y servicios, incluidos call centers, domiciliados en Colombia o en el exterior, sean personas naturales o jurídicas, colombianas o extranjeros a su fuerza comercial, equipos de telemercadeo y/o procesadores de datos que trabajen en nombre de EL EMPLEADOR, incluyendo pero sin limitarse, contratistas, delegados, outsourcing, tercerización, red de oficinas o aliados, con el objeto de desarrollar servicios de alojamiento de sistemas, de mantenimiento, servicios de análisis, servicios de mensajería por e- mail o correo físico, servicios de entrega, gestión de transacciones de pago, cobranza, entre otros. En consecuencia, el titular entiende y acepta que mediante la presentación autorización concede a estos terceros, autorización para acceder a sus Datos Personales en la medida en que así lo requieren para la prestación de los servicios para los cuales fueron contratados y sujeto al cumplimiento de los deberes que les correspondan como encargados del Tratamiento de mis Datos Personales. Igualmente, a EL EMPLEADOR para compartir mis datos Personales con las entidades gremiales a las que pertenezca la entidad, para fines comerciales, estadísticos y de estudio y análisis de mercadeo. Es entendido que las personas naturales y jurídicas, nacionales y extranjeras mencionadas anteriormente ante las cuales EL EMPLEADOR puede llevar a cabo el Tratamiento de mis Datos Personales, también cuentan con mi autorización para permitir dicho Tratamiento. Adicionalmente, mediante el otorgamiento de la presente autorización, manifiesto: (i) que los Datos Personales suministrados son veraces, verificables y completos, (ii) que conozco y entiendo que el suministro de la presente autorización es voluntaria, razón por la cual no me encuentro obligado a otorgar la presenta autorización, (iii) que conozco y entiendo que mediante la simple presentación de una comunicación escrita puedo limitar en todo o en parte el alcance de la presente autorización para que, entre otros, la misma se otorgue únicamente frente a EL EMPLEADOR pero no frente a LAS ENTIDADES AUTORIZADAS y (iv) haber sido informado sobre mis derechos a conocer, actualizar y rectificar mis Datos Personales, el carácter facultativo de mis respuestas a las preguntas que sean hechas cuando versen sobre datos sensibles o sobre datos de los niños, niñas o adolescentes, solicitar prueba de la autorización otorgada para su tratamiento, ser informado sobre el uso que se ha dado a los mismo, presentar quejas ante la autoridad competente por infracción a la ley una vez haya agotado el trámite de consulta o reclamo ante EL EMPLEADOR, revocar la presentación autorización, solicitar la supresión de sus datos en los casos en que sea procedente y ejercer en forma gratuita mis derechos y garantías constitucionales y legales. EL EMPLEADOR informa que el tratamiento de sus Datos Personales se efectuará de acuerdo con la Política de la entidad en esta materia, la cual puede ser consultada en sus instalaciones. DÉCIMA TERCERA. AUTORIZACIÓN DE DESCUENTOS: El TRABAJADOR autoriza expresamente al EMPLEADOR para que se descuenten de mi salario y prestaciones o cualquier otro concepto las sumas que por error haya recibido, permitiendo que el EMPLEADOR compense del valor de los salarios, prestaciones legales o extralegales, indemnizaciones y otro tipo de dinero a pagar al momento de la Nómina y/o liquidación las sumas que yo como TRABAJADOR esté debiendo al EMPLEADOR Y EMPRESA USUARIA por'
    let texto4 = `los siguientes conceptos: 'Préstamos debidamente autorizados por escrito; valor de los elementos de trabajo y mercancías extraviadas bajo mi responsabilidad y que llegaren a faltar al momento de hacer entrega del inventario; los valores que se me hubieren confiado para mi manejo y que hayan sido dispuestos abusivamente para otros propósitos en perjuicio del EMPLEADOR; los anticipos o sumas no legalizadas con las facturas o comprobantes requeridos que me fueron entregadas para gastos o viajes, así como el valor de los tiquetes aéreos no devueltos; las sumas que llegaren a faltar en cumplimiento de mis funciones y a mi cargo previa liquidación y verificación de las mismas, Compra de Flor y/o servicio de alimentación suministrado a través de la Empresa Usuaria de manera quincenal y por el monto de alimentación establecido, todo lo que exceda de valores aprobados (Celulares, Tarjetas de Crédito, etc.), modificaciones en las Bases de Datos sin el soporte correspondiente, errores de digitación y procedimientos internos que por mi culpa afecten económicamente a la empresa y cualquier pago que me haya sido realizado y que no me corresponda. De igual forma, en caso de recibir Subsidio de Transporte y Bonificaciones, autorizo la deducción cuando se causen ausencias al trabajo por cualquier motivo en el mes por el cual recibí pago completo. Por lo anterior, autorizo expresamente al EMPLEADOR para que retenga y cobre de mi salario y liquidación final, de cualquier otro concepto a mi favor, de mis Cesantías consignadas en el fondo de Cesantías los saldos que esté adeudando por los conceptos anteriormente citados. DÉCIMA CUARTA. Las prestaciones sociales se liquidarán y pagaran una vez el TRABAJADOR haya diligenciado el Paz y Salvo en la compañía donde labore en misión y se pagarán en las fechas estipuladas según la  ley.  DÉCIMA QUINTA. AUTORIZACIÓN CONSIGNACION DE PAGO DE LIQUIDACIÓN FINAL O DEFINITIVA, A través del presente documento y en pleno uso de mis facultades legales e intelectuales, doy la autorización a mi EMPLEADOR,  para que me consigne el valor que corresponda a mi liquidación final o definitiva en la misma forma de pago asignada para mi Nómina, dentro de las fechas establecidas y otorgadas por la empresa; De igual manera autoriza al EMPLEADOR, en el evento en que se niegue o no sea posible recibirla directamente, para que deposite en la mencionada cuenta el monto de su liquidación final de contrato de trabajo. Autorizo también, para que me sea notificado mediante correo electrónico, mensaje de texto, whatsapp o cualquier medio registrado, el desprendible de mi liquidación definitiva con la descripción del pago y todos los documentos correspondientes a mi desvinculación laboral. DÉCIMA SEXTA. CONSENTIMIENTO INFORMADO. Exámenes toxicológicos: manifiesto que conozco la política de prevención de consumo de alcohol, y otras sustancias psicoactivas de la Empresa Usuaria, así como también la Política de la Empresa de Servicios Temporales TU ALIANZA S.A.S., (en adelante E.S.T.) Por lo tanto, sé que no debo presentarme en sus instalaciones a ejecutar las actividades para las cuales fui contratado en calidad de trabajador en misión por la E.S.T. bajo los efectos de alguna de estas sustancias o en su defecto, consumirlas durante el tiempo que dure mi permanencia ya que pongo en riesgo mi salud, mi seguridad y la de las personas que se encuentren presentes en las instalaciones. Por lo anterior, autorizo para que se me practiquen cuestionarios y/o pruebas (incluso médicas y de laboratorio) de manera preventiva, aleatoria o por confirmación, toda vez que ya me encuentre laborando dentro de las instalaciones de la empresa, con el objeto de determinar mi aptitud física y mental para llevar a cabo las actividades contratadas, en virtud de la investigación disciplinaria que realice la Empresa y que lo amerite, o en cualquier momento cuando así lo estime pertinente la Compañía, y que los podrá utilizar como pruebas para los mismos fines. Dichas pruebas y exámenes podrán incluir las relativas al consumo de alcohol y sustancias psicoactivas, las cuales se practicarán con la metodología que la empresa usuaria establezca. En el evento en que alguna de las pruebas tenga resultado “positivo” para consumo o en caso de comprobarse el incumplimiento de las obligaciones a mi cargo en relación con esta política, la empresa usuaria informará de dicha situación a la E.S.T. a la cual me encuentro vinculado, quien es mi verdadero empleador y de manera adicional, podrá solicitar mi retiro de sus instalaciones. Autorizo que la empresa usuaria, conserve el documento que contiene los resultados, siempre y cuando lo haga con la debida reserva. La decisión que aquí manifiesto la he tomado de manera autónoma, libre y voluntaria y por tanto, no considero que las mencionadas pruebas y las atribuciones que aquí acepto para la empresa constituyan injerencias indebidas e inconsultas sobre mis derechos a la intimidad y al libre desarrollo de mi personalidad. DÉCIMA SEPTIMA. ENTREGA Y ACEPTACIÓN DEL CARGO Y FUNCIONES ASIGNADAS. De manera atenta le informamos que en el ejercicio de su cargo asignado y mencionado en el presente, usted desarrollará las labores que establezca la Empresa Usuaria donde ingresa como trabajador en misión, dentro sus procesos; comprometiéndose a ejercer fielmente sus funciones, y con la firma de este contrato, se da por entendido y aceptado las condiciones del mismo. * Operario de Cultivo y/o Oficios Varios: Labores de Cultivo que incluyen Corte de Flor, Limpieza de Camas y Plantas, Labores Culturales, Riego, Fumigación (1),  Monitoreo, Pesaje de Productos, Transporte de Flor, Control y Calidad, erradicaciones, Enmalle, Desbotone y todas las labores de Mantenimiento de los Cultivos.*Operario de Poscosecha y/o Oficios Varios: Labores de Poscosecha como Clasificación, Boncheo, Encapuchado, Empaque, Recepción, Manejo de inventarios, Cuarto frío,  Control y Calidad y/ oficios varios.*Operario Mantenimiento: Labores de Mantenimiento, Poda de Prado, Manejo de Maquinaria Agrícola, Electricista, Electromecánico, Soldador, Maestro de Construcción, Ayudante de Construcción, Mantenimiento de Cubiertas Plásticas e Infraestructura y Redes (2)*Labores de Conducción, Auxiliar de Conducción, Logística e Inventarios y/ Oficios Varios.*Apoyo/Reemplazos Administrativos: Asistente de Producción, Asistente de Poscosecha, Asistente de Gestión Humana,  Comerciales y/ Oficios Varios.*Todas las demás labores asignadas por la Empresa Usuaria y que contemple el cargo para el cuál fue contratado. (1)Las labores de Fumigación sólo aplican para el personal masculino mayor de edad. (2) Estas labores se realizarán previa aprobación de requisitos del S.G.-S.S.T. de la Empresa Usuaria.Igualmente, le indicamos que el incumplimiento a las funciones antes relacionadas, será calificado como falta grave y por tanto como justa causa para la finalización del contrato de trabajo, de conformidad con lo previsto en el artículo 7) literal a) numeral 6) del Decreto 2351 de 1965, norma que subrogó el artículo 62 del código Sustantivo de Trabajo,  en concordancia con lo previsto el numeral 1° del artículo 58 del mismo Estatuto. PARÁGRAFO PRIMERO. El TRABAJADOR, deberá responder por todos y cada uno de los elementos de trabajo que le entregue EL EMPLEADOR y/o la EMPRESA USUARIA para el desempeño de su cargo. DÉCIMA OCTAVA. El TRABAJADOR, debe registrar en las oficinas del EMPLEADOR, su dirección, número de teléfono y domicilio y dar aviso inmediato en cualquier cambio que ocurra. DÉCIMA NOVENA. El TRABAJADOR, debe respetar y someterse al Reglamento de Trabajo vigente de ambas empresas en todas sus partes, cuyo texto manifiesta conocer en todas sus partes. VIGÉSIMA. EL TRABAJADOR acepta, entiende y conoce que EL EMPLEADOR, tiene la obligación legal de prevenir y controlar el lavado de activos y la financiación del terrorismo, por tanto, expresa de manera voluntaria e inequívoca, que no se encuentra vinculado  ni ha sido condenado por parte de las autoridades nacionales e internacionales en cualquier tipo de investigación por delitos de narcotráfico, terrorismo, secuestro, lavado de activos, financiación del terrorismo y administración de recursos relacionados con actividades terroristas  y/o cualquier delito colateral o subyacente a estos; ni se encuentra incluido en listas para el control de lavado de activos  y financiación del terrorismo, administradas por cualquier autoridad nacional o extranjera. Convienen las partes, conforme a lo establecido en el numeral 6º del artículo séptimo del decreto 2351 de 1.965, que la inexactitud en la manifestación del EL TRABAJADOR contenida en la presente adición al contrato de trabajo, constituye falta grave y dará lugar a la terminación del contrato de trabajo por justa causa de despido. VIGÉSIMA PRIMERA. INCAPACIDADES MÉDICAS: Si EL TRABAJADOR, por causa de enfermedad o accidente, no asistiere a su trabajo, deberá presentar a EL EMPLEADOR, a la mayor brevedad, la respectiva incapacidad, a cuyo efecto se establece que exclusivamente será válida la expedida por los médicos de la respectiva Entidad Promotora de Salud, para justificar las ausencias antedichas. VIGÉSIMA SEGUNDA. AUTORIZACIÓN DE ACCESO A HISTÓRIA CLÍNICA: De acuerdo con lo establecido en el artículo 34 de la Ley 23 de 1981 y la Resolución 1995 de 1999 expedida por el Ministerio de Salud, EL TRABAJADOR autoriza expresamente a EL EMPLEADOR para que tenga acceso y copia de su historia clínica, así como de todos aquellos datos que en aquélla se registren o lleguen a ser registrados, con el fin de adelantar todos los trámites que sean necesarios ante entidades como Empresas Promotoras de Salud (EPS),  Administradoras de Riesgos laborales (ARL), Administradoras de Fondos de Pensiones (AFP), Instituciones Prestadoras de Salud (IPS), médicos particulares y demás entidades de la Seguridad Social. VIGÉSIMA TERCERA. REGLAMENTO DE TRABAJO Y DE HIGIENE Y SEGURIDAD INDUSTRIAL. El TRABAJADOR deja constancia de que conoce y acepta el Reglamento de Trabajo y el Reglamento de Higiene y Seguridad Industrial del TRABAJADOR. VIGÉSIMA CUARTA. El TRABAJADOR ha leído, entiende y acepta de manera íntegra todo el contenido del presente contrato y manifiesta bajo la gravedad de juramento, que no sufre de problemas de alcoholismo, drogadicción, enfermedad infectocontagiosa, ni consumidor habitual de sustancias alucinógenas, ni drogas enervantes.  PARÁGRAFO PRIMERO. Las partes declaran que no reconocerán válidas las estipulaciones anteriores a este contrato de trabajo, que es el único vigente entre ellas reemplazando y que desconocen cualquier otro verbal o escrito anterior, el cual tendrá vigencia a partir de la FECHA DE INICIACION, y para lo cual el TRABAJADOR inicia su vinculación laboral con el EMPLEADOR.; pudiendo las partes convenir por escrito modificaciones al mismo, las que formarán parte integrante de este contrato. El presente contrato se ANULARÁ si el TRABAJADOR no se presenta a laborar el día que corresponde o si la EMPRESA USUARIA desiste de la Contratación. Previa la declaración de que a él se tienen incorporadas todas las disposiciones del reglamento interno que rige en la EMPRESA EMPLEADORA. El TRABAJADOR deja expresa constancia de que al suscribir el presente contrato recibió copia del mismo.`;
    // TODO el contrato en UN solo bloque continuo: fluye entre páginas vía
    // `encabezadoPagina` y cada renglón (incluida la última línea de cada hoja)
    // queda justificado al margen. Solo la línea final del contrato va a la
    // izquierda, porque cierra el párrafo.
    y = this.renderJustifiedText(doc, texto + ' ' + texto2 + ' ' + texto3 + ' ' + texto4, x, y + 5, maxWidth, lineHeight, false, 10, encabezadoPagina);

    y += 4; // Añadir espacio
    // Fecha de contrato (no la fecha actual): se imprime sobre la línea de firma.
    const fechaCompleta = new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(this.getFechaContrato());

    // Texto corrido, sin línea de firma: la fecha va pegada en el mismo
    // renglón (fecha en normal, el resto en negrita).
    doc.setFont('helvetica', 'bold');
    const prefijoConstancia = 'Para constancia se firma ante testigos el día ';
    doc.text(prefijoConstancia, 7, y);
    const xFecha = 7 + doc.getTextWidth(prefijoConstancia);
    doc.setFont('helvetica', 'normal');
    doc.text(fechaCompleta, xFecha, y);
    doc.setFont('helvetica', 'bold');
    doc.text(' en la ciudad de Bogotá', xFecha + doc.getTextWidth(fechaCompleta), y);

    y += 12; // Mover bloque hacia arriba

    // --- Fila 1: Trabajador e Identificación ---
    // Firma del Trabajador (Izquierda)
    doc.text('Firma del Trabajador', 20, y);
    doc.line(50, y, 122, y);
    if (this.firma && this.firma !== '') {
      try {
        const rFirma = await fetch(this.firma);
        if (rFirma.ok) {
          const bFirma = await rFirma.blob();
          const base64Firma = await new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(bFirma);
          });
          doc.addImage(base64Firma, 'PNG', 65, y - 9, 28, 8);
        } else {
          doc.addImage(this.firma, 'PNG', 65, y - 9, 28, 8);
        }
      } catch (e) {
        try { doc.addImage(this.firma, 'PNG', 65, y - 9, 28, 8); } catch (ex) { }
      }
    }

    // No de Identificación (Derecha)
    doc.text('No de Identificación', 130, y);
    doc.line(158, y, 203, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.numeroDocConPuntos(this.cedula), 165, y - 1);

    y += 24; // Espacio para la segunda fila de firmas

    // --- Fila 2: Empleador, Testigo 1, Testigo 2 ---

    // El Empleador (Izquierda)
    try {
      doc.addImage('firma/firmaselloalianza.jpeg', 'PNG', 4, y - 18, 28, 14);
    } catch (e) { }
    doc.setFont('helvetica', 'bold');
    doc.text('El Empleador', 11, y);
    doc.text('Heidy J. Torres S.', 8, y + 4);
    doc.text('C.C. 52,440,635', 10, y + 8);

    // Testigo 1 (Centro)
    doc.text('Firma y C.C. Testigo 1', 43, y);
    doc.line(75, y, 130, y);
    try {
      doc.addImage('firma/Angela.png', 'PNG', 85, y - 16, 30, 14);
    } catch (e) { }
    doc.text('Angie Gutiérrez C.C.1.073.174.200', 76, y + 4);

    // Testigo 2 (Derecha)
    doc.text('Firma y CC Testigo 2', 135, y);
    doc.line(165, y, 203, y);

    if (this.firmaPersonalAdministrativo && this.firmaPersonalAdministrativo !== '') {
      try {
        const rAdmin = await fetch(this.firmaPersonalAdministrativo);
        if (rAdmin.ok) {
          const bAdmin = await rAdmin.blob();
          const base64Admin = await new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(bAdmin);
          });
          doc.addImage(base64Admin, 'PNG', 165, y - 16, 35, 14);
        } else {
          doc.addImage(this.firmaPersonalAdministrativo, 'PNG', 165, y - 16, 35, 14);
        }
      } catch (e) {
        try { doc.addImage(this.firmaPersonalAdministrativo, 'PNG', 165, y - 16, 35, 14); } catch (ex) { }
      }
    }

    const user = this.utilService.getUser();
    // nombre y cc del que esta iniciado sesion
    doc.text(user.datos_basicos.nombres + ' ' + user.datos_basicos.apellidos, 165, y + 4);
    doc.text(user.numero_de_documento, 165, y + 7);

    // Convertir a Blob y guardar en uploadedFiles
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa}_Contrato.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

    if (isBatch) {
      return { file: pdfFile, blobUrl: URL.createObjectURL(pdfBlob) };
    }

    this.uploadedFiles['Contrato'] = { file: pdfFile, fileName };

    this.verPDF({ titulo: 'Contrato' });
    return;
  }

  // Generar contrato de trabajo
  async generarContratoTrabajoTuAlianza() {
    const respContratacion: any = await firstValueFrom(
      this.contratacionService.buscarEncontratacion(this.cedula).pipe(
        take(1),
        catchError((err) => {
          console.error('Error buscando contratación:', err);
          return of({ data: [] });
        })
      )
    );

    console.log('Datos de contratación recibidos:', respContratacion);
    const datoContratacion = respContratacion?.data?.[0] ?? {};
    console.log('Dato de contratación para ficha técnica Tu Alianza:', datoContratacion);
    // Determinar la ruta del logo y el NIT
    let logoPath = '';
    let nit = '';
    let domicilio = '';
    let codigo = '';
    let version = '';
    let fechaEmision = '';

    if (this.empresa === 'TU ALIANZA SAS') {
      logoPath = 'logos/Logo_TA.png';
      nit = '900.864.596-1';
      domicilio = 'CLL 7 4 49 Madrid, Cundinamarca';
      codigo = 'TA CO-RE-1';
      version = '06';
      fechaEmision = 'Mayo 02-2022';
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Empresa no reconocida para generar el contrato',
      });
      return;
    }

    // Crear el documento PDF en formato vertical
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter',
      compress: true,
    });

    doc.setProperties({
      title: 'Contrato_Trabajo.pdf',
      creator: this.empresa,
      author: this.empresa,
    });


    // Posiciones iniciales
    const startX = 7;
    const startY = 7;
    const tableWidth = 203;

    // **Cuadro para el logo y NIT**
    doc.setLineWidth(0.1);
    doc.rect(startX, startY, 50, 13); // Cuadro del logo y NIT

    // Agregar logo
    doc.addImage(logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);

    // Agregar NIT
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("NIT", startX + 32, startY + 7);
    doc.setFont('helvetica', 'normal');
    doc.text(nit, startX + 32, startY + 10);

    // **Tabla al lado del logo**
    let tableStartX = startX + 50; // Inicio de la tabla al lado del cuadro
    doc.rect(tableStartX, startY, tableWidth - 50, 13); // Borde exterior de la tabla

    // Encabezados
    doc.setFont('helvetica', 'bold');
    doc.text("PROCESO DE CONTRATACIÓN", tableStartX + 55, startY + 3);
    // doc.text(this.codigoContratacion, tableStartX + 130, startY + 3);
    doc.text("CONTRATO DE TRABAJO POR OBRA O LABOR", tableStartX + 43, startY + 7);

    // Líneas divisoras
    let col1 = tableStartX + 30;
    let col2 = tableStartX + 50;
    let col3 = tableStartX + 110;

    doc.line(tableStartX, startY + 4, tableStartX + tableWidth - 50, startY + 4); // Línea horizontal bajo el título
    doc.line(tableStartX, startY + 8, tableStartX + tableWidth - 50, startY + 8); // Línea horizontal bajo el título
    doc.line(col1, startY + 8, col1, startY + 13); // Línea vertical 1
    doc.line(col2, startY + 8, col2, startY + 13); // Línea vertical 2
    doc.line(col3, startY + 8, col3, startY + 13); // Línea vertical 3

    // **Contenido de las columnas**
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text("Código: " + codigo, tableStartX + 2, startY + 11.5);
    doc.text("Versión: " + version, col1 + 2, startY + 11.5); // Ajustar dentro de columna
    doc.text(`Fecha Emisión: ${fechaEmision}`, col2 + 5, startY + 11.5);
    doc.text("Página: 1 de 3", col3 + 6, startY + 11.5); // Ajustar dentro de columna

    // Representado por
    doc.setFontSize(7);

    const fechaISO = this.vacante.fechaIngreso; // '2024-12-04T05:00:00.000Z'

    // Convertir la fecha ISO a un objeto Date
    const fecha = new Date(fechaISO);

    // Formatear al formato dd/mm/yyyy
    const fechaFormateada = [
      String(fecha.getDate()).padStart(2, '0'),  // dd
      String(fecha.getMonth() + 1).padStart(2, '0'),  // mm
      fecha.getFullYear()  // yyyy
    ].join('/');
    // helper: primer valor NO vacío (null/undefined/''/'   ' => ignora)
    const pickText = (...vals: any[]) => {
      for (const v of vals) {
        const t = (v ?? '').toString().trim();
        if (t) return t;
      }
      return '';
    };

    // helper: solo fecha (si viene con hora, recorta) y la deja en YYYY-MM-DD
    const onlyDate = (v: any) => {
      const s = pickText(v);
      if (!s) return '';
      return s.split('T')[0].split(' ')[0].trim();
    };

    // ✅ úsalo en tu arreglo
    // =========================================================
    // ✅ Helpers: T = título normal, V = valor en MAYÚSCULAS
    // ✅ + Normaliza textos con letras/dígitos separados: "C A R A" -> "CARA", "3 0 3 4" -> "3034"
    // =========================================================

    // ✅ Helpers: T = título normal, V = valor en MAYÚSCULAS (normalizado)
    const T = (v: any) => String(v ?? '').trim();

    const normalizeText = (v: any): string => {
      let s = String(v ?? '');

      // Normaliza unicode (por si vienen combinaciones raras)
      if (typeof (s as any).normalize === 'function') {
        s = s.normalize('NFKD');
      }

      // Elimina invisibles típicos (ZWSP/ZWNJ/ZWJ/BOM/WJ/soft-hyphen, etc.)
      s = s.replace(/[\u200B-\u200D\uFEFF\u2060-\u2064\u00AD]/g, '');

      // Quita marcas combinantes (tildes “separadas”)
      // (si no soporta \p{M}, cae sin problema porque la mayoría no trae esto)
      try {
        s = s.replace(/\p{M}+/gu, '');
      } catch {
        // fallback: rango común de diacríticos combinantes
        s = s.replace(/[\u0300-\u036F]+/g, '');
      }

      // Espacios raros -> espacio normal
      s = s.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

      // Colapsa whitespace
      s = s.replace(/\s+/g, ' ').trim();
      if (!s) return '';

      const tokens = s.split(' ');
      const out: string[] = [];

      let buf = '';
      let kind: 'L' | 'D' | null = null;

      const flush = () => {
        if (buf) out.push(buf);
        buf = '';
        kind = null;
      };

      const isSingleLetter = (t: string) => {
        // unicode letter si está disponible
        try { return /^\p{L}$/u.test(t); } catch { return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]$/.test(t); }
      };

      for (const t of tokens) {
        if (!t) continue;

        if (isSingleLetter(t)) {
          if (kind && kind !== 'L') flush();
          kind = 'L';
          buf += t;
          continue;
        }

        // Los dígitos sueltos NO se juntan: el domicilio "CLL 7 4 49" debe
        // salir tal cual, no "CLL 74 49". Solo se juntan letras espaciadas
        // (tipo "H E I D Y" → "HEIDY").

        flush();
        out.push(t);
      }

      flush();
      return out.join(' ');
    };

    const V = (v: any) => normalizeText(v).toUpperCase();
    
    const datos = [
      { titulo: T('Representado por'), valor: V('HEIDY JACKELINE TORRES SOTELO') },
      { titulo: T('Domicilio del patrono'), valor: V(domicilio) },
      {
        titulo: T('Nombre del Trabajador'),
        valor: V([
          this.candidato?.primer_apellido,
          this.candidato?.segundo_apellido,
          this.candidato?.primer_nombre,
          this.candidato?.segundo_nombre,
        ].filter(x => String(x ?? '').trim()).join(' '))
      },
      { titulo: T('Tipo y No de Identificación'), valor: V(`${this.candidato?.tipo_doc ?? ''}        ${this.numeroDocConPuntos(this.cedula)}   -   Email: ${pickText(this.candidato?.contacto?.email, datoContratacion?.primercorreoelectronico)}`) },
      {
        titulo: T('Fecha de Nacimiento'),
        valor: V(this.parseDateToDDMMYYYY(pickText(this.candidato?.fecha_nacimiento, datoContratacion?.fecha_nacimiento)) || onlyDate(pickText(this.candidato?.fecha_nacimiento, datoContratacion?.fecha_nacimiento)))
      },
            {
        titulo: T('Domicilio del Trabajador'),
        valor: V(
          [
            (this.candidato?.residencia?.direccion ?? datoContratacion.direccion_residencia),
            this.candidato?.residencia?.barrio,
            datoContratacion.municipio
          ]
            .filter(x => String(x ?? '').trim())
            .join(' - ')
          )
      },
      { titulo: T('Fecha de Iniciación'), valor: V(this.parseDateToDDMMYYYY(this.candidato?.entrevistas?.[0]?.proceso?.contrato?.fecha_ingreso) || (this.candidato?.entrevistas?.[0]?.proceso?.contrato?.fecha_ingreso ?? '')) },
      {
        titulo: T('Salario Mensual Ordinario'),
        valor: V(this.salarioContratoDoc)
      },
      { titulo: T('Periodo de Pago Salario'), valor: V('Quincenal') },
      { titulo: T('Subsidio de Transporte'), valor: V('SE PAGA EL LEGAL VIGENTE O SE SUMINISTRA EL TRANSPORTE') },
      { titulo: T('Forma de Pago'), valor: V('Banca Móvil, Cuenta de Ahorro o Tarjeta Monedero') },
      { titulo: T('Nombre Empresa Usuaria'), valor: V(this.empresaUsuariaDoc) },
      { titulo: T('Cargo'), valor: V(this.vacante?.cargo) },
      { titulo: T('Descripción de la Obra/Motivo Temporada '), valor: V(this.descripcionObraDoc) },

    ];

    // =========================================================
    // Render en PDF (FORZANDO charSpace = 0 en CADA texto)
    // =========================================================
    const columnWidth = 110;
    const rowSpacing = 3;
    const columnMargin = 10;
    const columnStartX = 7;
    const columnStartY = startY + 17;
    const rowsPerColumn = 15;

    // Offset vertical acumulado por columna. Cuando una celda (p.ej. la
    // descripción de la obra/labor) se expande a múltiples líneas, las celdas
    // siguientes en la MISMA columna deben empujarse hacia abajo para no
    // solaparse.
    const yOffsetByColumn: Record<number, number> = {};
    const valueLineH = 2.5; // mm aprox para fontSize 7

    datos.forEach((item, index) => {
      const currentColumn = Math.floor(index / rowsPerColumn);
      const rowInColumn = index % rowsPerColumn;

      const x = columnStartX + currentColumn * (columnWidth + columnMargin);
      const y = (columnStartY + rowInColumn * rowSpacing) + 3 + (yOffsetByColumn[currentColumn] ?? 0);

      // (opcional) también resetea estado global
      if (typeof (doc as any).setCharSpace === 'function') {
        (doc as any).setCharSpace(0);
      }

      // ✅ Título normal (charSpace forzado a 0)
      doc.setFont('helvetica', 'normal');
      (doc as any).text(`${item.titulo}:`, x, y, { charSpace: 0 });

      // ✅ Valor negrita (charSpace forzado a 0)
      doc.setFont('helvetica', 'bold');
      const valueText = String(item.valor ?? '').trim();

      const isDescripcion = String(item.titulo ?? '')
        .toLowerCase()
        .includes('descripción de la obra');

      if (index > 14) {
        (doc as any).text(valueText, x + 30.2, y, { charSpace: 0 });
      } else if (isDescripcion) {
        // La descripción es la última fila de la ficha: puede usar TODA la
        // línea, con el mismo margen derecho que el izquierdo de la columna.
        const valueX = x + 48;
        const valueMaxW = doc.internal.pageSize.getWidth() - columnStartX - valueX;
        const lines: string[] = doc.splitTextToSize(valueText || '—', Math.max(20, valueMaxW));
        (doc as any).text(lines, valueX, y, { charSpace: 0 });
        const extra = Math.max(0, lines.length - 1);
        yOffsetByColumn[currentColumn] = (yOffsetByColumn[currentColumn] ?? 0) + extra * valueLineH;
      } else {
        (doc as any).text(valueText, x + 48, y, { charSpace: 0 });
      }
    });



    // Restaurar la fuente a la normal después del bucle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    // Posición vertical después de los datos. Tomamos el mayor offset acumulado
    // entre columnas para garantizar que el texto siguiente no pise las líneas
    // extras de la descripción multilinea de obra/labor.
    const maxYOffset = Math.max(0, ...Object.values(yOffsetByColumn));
    let y = columnStartY + rowsPerColumn * rowSpacing + 2 + maxYOffset;
    // Texto adicional
    let texto = 'Entre  el  EMPLEADOR  y  el   TRABAJADOR  arriba indicados,  se  ha celebrado el contrato  regulado  por  las cláusulas  que  adelante  se  indican,  aparte  de  la  ley,  siendo  ellas las  siguientes:  PRIMERA.  El Trabajador,  a  partir  de  la  fecha  de  iniciación,  se  obliga  para  con  e l  EMPLEADOR   a ejecutar  la  obra arriba  indicada  sometiéndose  durante  su realización  en  todo  a  las  órdenes  de  éste. Declara  por  consiguiente e l TRABAJADOR completa y total  disponibilidad para con  el  EMPLEADOR   para  ejecutar  las  obras  indicadas  en  el  encabezamiento,  siempre  que así  le  sean  exigidas  por  sus clientes  al   EMPLEADOR,   sin  que  por  ello  se  opere  desmejora  o  modificación  sustancial  de las  condiciones de trabajo tenidas  en  cuenta en  el  momento  de  la  suscripción  de  este  contrato.   SEGUNDA.   DURACIÓN DEL CONTRATO:   La necesaria  para  la  realización de la obra o labor contratada  y  conforme  a  las  necesidades  del  patrono  o  establecimiento  que  requiera  la  ejecución  de  la  obra,  todo  conforme a lo previsto en el Art. 45 del CST y teniendo en cuenta  la  fecha  de  iniciación  de  la  obra;  y  la  índole  de  la  misma,  circunstancias  una  y  otra  ya  anotadas.  PARÁGRAFO PRIMERO:  Las  partes  acuerdan  que  por  ser  el TRABAJADOR contratado como trabajador en misión para ser enviado a la empresa la duración de la obra o labor no podrá superar el tiempo establecido en el Art. 77 de la Ley 50 de 1990 en su numeral 3°. PARÁGRAFO SEGUNDO: El término de duración del presente contrato es de carácter temporal por ser el EMPLEADOR una  empresa  de  servicios temporales,  y  por  tanto tendrá  vigencia  hasta la realización  de  la  obra o  labor  contratada  que  sea  indicada  por  las  Empresas  Usuarias  del  EMPLEADOR  en  este  contrato, acordando  las  partes  que  para  todos  los  efectos  legales,  la  obra  o  labor  contratada  termina  en  la  fecha  en  que  la  EMPRESA  USUARIA, a la que será  enviado el  TRABAJADOR, comunique la terminación de la misma. PARÁGRAFO TERCERO: La labor se  realizará  en  las  instalaciones de la EMPRESA ';
    // this.vacante.empresaUsuariaSolicita + CENTRO DE COSTOS + this.vacante.finca + DIR. + this.vacante.direccion
    doc.setFont('helvetica', 'normal');
    let x = 7;
    const lineHeight = 3.4;
    const maxWidth = 203;

    doc.setFontSize(6.5);
    // Empresa usuaria + centro de costos van PEGADOS al final del PARÁGRAFO
    // TERCERO, dentro del mismo párrafo: al ir en MAYÚSCULAS,
    // renderJustifiedText los pinta en negrita él solo.
    doc.setFontSize(6.5);
    const partes = [
      this.empresaUsuariaDoc,
      'CENTRO DE COSTOS',
      this.centroCostoDoc || '',
      this.direccionDoc ? `DIR. ${this.direccionDoc}` : ''
    ].filter(Boolean); // elimina los vacíos o null

    // MAYÚSCULAS obligatorias (incluida la dirección) → renderJustifiedText
    // pinta en negrita las palabras en mayúsculas.
    const textoLinea = partes.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
    texto += textoLinea + (textoLinea.endsWith('.') ? '' : '.');

    // TERCERA. continúa EN EL MISMO párrafo, como texto corrido después de la
    // dirección: se concatena con `texto` y se renderiza todo en UN solo bloque
    // justificado (sin salto de párrafo y sin riesgo de solaparse).
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    let texto2 = 'TERCERA. El salario como contraprestación del servicio será el indicado arriba, según la clasificación de oficios y tarifas determinados por el EMPLEADOR, la cual hace parte de este contrato; sometida sí en su eficiencia a que el valor a recibir corresponda al oficio respectivo efectivamente contratado con el usuario, según el tiempo laborado en la respectiva jornada, inferior a la máxima legal; éste regirá en proporción al número de horas respectivamente trabajadas y en él están los valores incluidos correspondientes a dominicales y festivos reconocidos por la ley como descanso remunerado. PARÁGRAFO PRIMERO: El patrono manifiesta expresamente que el TRABAJADOR tendrá derecho a todas las prestaciones sociales consagradas en la ley 50 de 1990 y demás estipulaciones previstas en el CST. Tales como compensación monetaria por vacaciones y prima de  servicios  proporcional al tiempo laborado, cualquiera que este sea. PARÁGRAFO SEGUNDO: Se conviene por las partes, que en caso de que el TRABAJADOR devengue comisiones o cualquiera otra modalidad de salario variable, el 82.5 % de dichos ingresos constituyen remuneración ordinaria y el 17.5 % restante  está  destinado  a  remunerar  el  descanso  en  días  dominicales y festivos de que tratan los capítulos I y II del título VII del CST. CUARTA. EL TRABAJADOR, se someterá al horario de trabajo que señale el EMPLEADOR de acuerdo con las especificaciones del Usuario. QUINTA. PERÍODO DE PRUEBA: el período de prueba no excederá de dos (2) meses ni podrá ser superior a la quinta parte del término pactado, si el contrato tuviere una duración inferior a un año. SEXTA. EL TRABAJADOR y EL EMPLEADOR podrán convenir en repartir las horas de la jornada diaria en los términos del Art. 164 del CST., teniendo en cuenta que el descanso entre las secciones de la jornada no se computa dentro de la misma, según el art. 167 del estatuto Ibídem.  Así  mismo  todo  trabajador  extra,  suplementario  o  festivo, solo  será reconocido en caso de ser exigido o autorizado a trabajar por el EMPLEADOR a solicitud de la entidad con la cual aquel tenga acuerdo de realización de trabajo o servicio. SÉPTIMA. Son justas causas para dar por terminado este contrato, además de las previstas en el art.7° del decreto 2351, las disposiciones concordantes y las consignadas en el reglamento interno del trabajo del EMPLEADOR, así como las siguientes: 1ª La terminación por cualquier causa, del contrato de prestación de servicios suscritos entre el EMPLEADOR y el USUARIO en donde prestará servicios el TRABAJADOR. 2ª El que la EMPRESA USUARIA en donde prestará servicios el TRABAJADOR, solicite el cambio de este por cualquier causa. 3ª El que la EMPRESA USUARIA en donde prestará servicios el TRABAJADOR, comunique la terminación de la obra o labor contratada. 4ª Que la EMPRESA USUARIA comunique al EMPLEADOR el incumplimiento leve de cualquiera de las obligaciones por parte del TRABAJADOR en TRES oportunidades, dos de las cuales hayan generado SANCIÓN AL TRABAJADOR. OCTAVA. Las partes acuerdan que NO CONSTITUYEN SALARIO, las sumas que ocasionalmente y por mera liberalidad reciba el TRABAJADOR del EMPLEADOR, como auxilios, gratificaciones, bonificaciones, primas extralegales, premios, bonos ocasionales, gastos de transporte adicionales y representación que el EMPLEADOR otorgue o llegue a otorgar en cualquier tiempo al TRABAJADOR, como tampoco no constituyen salario en dinero o en especie, cualquier alimentación, habitación o vestuario que entregue el EMPLEADOR, o un TERCERO al TRABAJADOR, durante la vigencia de este contrato. Tampoco constituirá salario, conforme a los términos del artículo 128 del Código Sustantivo del trabajo, cualquier bonificación o auxilio habitual, que se llegaren a acordar convencional o habitualmente entre las partes. Estos dineros, no se computarán como parte de salario para efectos de prestaciones sociales liquidables o BASE1 de éste. Al efecto el TRABAJADOR y el EMPLEADOR, así lo pactan expresamente en los términos del artículo 128 del C.S. del T. en C. Con. Con el articulo quince (15) de la ley cincuenta (50) de 1990. PARÁGRAFO PRIMERO: Las partes acuerdan que el EMPLEADOR, a su arbitrio y liberalidad podrá en cualquier momento cancelar o retirar el pago de bonificaciones habituales o esporádicas que en algún momento reconozca o hubiese reconocido al trabajador diferentes a su salario, sin que esto constituya desmejora de sus condiciones laborales; toda vez que como salario y retribución directa a favor del trabajador derivada de su actividad o fuerza laboral únicamente se pacta la suma establecida en la caratula del presente contrato. NOVENA.  En caso que el TRABAJADOR requiera ausentarse de su lugar de trabajo, deberá avisar por lo menos con 24 horas de anticipación a la EMPRESA USUARIA o según lo establecido en el Reglamento Interno de la misma.  DÉCIMA. CONFIDENCIALIDAD: El TRABAJADOR en virtud del presente contrato se compromete a 1) Manejar de manera confidencial la información que como tal sea presentada y entregada, y toda aquella que se genere en torno a ella como fruto de la prestación de sus servicios. 2) Guardar confidencialidad sobre esta información y no emplearla en beneficio propio o de terceros mientras conserve sus características de confidencialidad y que pueda perjudicar los intereses del EMPLEADOR o de la EMPRESA USUARIA. 3) Solicitar previamente y por escrito autorización para cualquier publicación relacionada con el tema de contrato, autorización que debe solicitarse ante el empleador. DÉCIMA PRIMERA. AUTORIZACION TRATAMIENTO DE DATOS PERSONALES, 1). De acuerdo a lo establecido en la ley 1581 de 2012, la Constitución Nacional y a las políticas establecidas por el EMPLEADOR para el caso en particular, el trabajador debe guardar reserva respecto a la protección de datos de los clientes, proveedores, compañeros, directivos del EMPLEADOR Y EMPRESA USUARIA, salvo que medie autorización expresa de cada persona para divulgar la información. 2). Guardar completa reserva sobre las operaciones, negocios y procedimientos industriales y comerciales, o cualquier otra clase de datos acerca del EMPLEADOR Y EMPRESA USUARIA que conozca por razón de sus funciones o de sus relaciones con ella, lo que no obsta para denunciar delitos comunes o violaciones del contrato de trabajo o de las normas legales de trabajo ante las autoridades competentes. DÉCIMA SEGUNDA. DECLARACIONES: Autorización Tratamiento Datos Personales “Ley de Protección de Datos 1581 de 2012 – decreto 1733 de 2013” Declaro que he sido informado que conozco y acepto la Política de Uso de Datos Personales e Información del EMPLEADOR, y que la información proporcionada es veraz, completa, exacta, actualizada y verificable. Mediante la firma del presente documento, manifiesto que conoce y acepto que cualquier consulta o reclamación relacionada con el Tratamiento de sus datos personales podrá ser elevada por escrito ante el EMPLEADOR; (¡) Que la Empresa TU ALIANZA S.A.S con NIT. 900.864.596-1, con domicilio principal en la Calle 7 No. 7– 49 de Madrid,  para efectos  de  lo  dispuesto  en  la ley  Estatutaria  1581  de  2012,  el  Decreto  1733  de  2013,  y  demás  normas  que  lo adicionen o modifiquen relativas a la Protección de Datos Personales, es responsable del tratamiento de los datos PERSONALES QUE LE HE SUMINISTRADO. (¡¡). Que, para el ejercicio de mis derechos relacionados con mis datos personales, el EMPLEADOR ha puesto a mi disposición la línea de atención: Afiliados marcando a Bogotá 6017444002; a través del correo electrónico protecciondedatos.tuapo@gmail.com; las oficinas del EMPLEADOR a nivel nacional o en la Carrera 112ª # 18ª 05 de  Bogotá.  En  todo  caso,  he  sido  informado  que  sólo  podré  elevar  queja  por infracciones a lo dispuesto en las normas sobre Protección de Datos ante la Superintendencia de Industria y Comercio una vez haya agotado el trámite ante el EMPLEADOR o sus encargados. Conozco que la normatividad de Protección de Datos Personales tiene por  objeto  el  desarrollo  del  derecho  constitucional  de  todas  las  personas  a  conocer,  actualizar  y  rectificar  de  forma  gratuita  la  información  que  se  recaude  sobre  ellas  en'
    // Encabezado de las páginas 2..3, dibujado por renderJustifiedText en CADA
    // salto de página: así el texto fluye CONTINUO entre hojas y la última
    // línea de cada página queda llena y justificada como cualquier renglón
    // (antes cada hoja era un bloque aparte y su última línea quedaba corta o
    // estirada con espacios enormes).
    let numPagina = 1;
    const encabezadoPagina = (): number => {
      numPagina++;
      doc.setFontSize(7);
      doc.setLineWidth(0.1);
      doc.rect(startX, startY, 50, 13); // Cuadro del logo y NIT
      doc.addImage(logoPath, 'PNG', startX + 2, startY + 1.5, 27, 10);
      doc.setFont('helvetica', 'bold');
      doc.text("NIT", startX + 32, startY + 7);
      doc.setFont('helvetica', 'normal');
      doc.text(nit, startX + 32, startY + 10);
      tableStartX = startX + 50;
      doc.rect(tableStartX, startY, tableWidth - 50, 13);
      doc.setFont('helvetica', 'bold');
      doc.text("PROCESO DE CONTRATACIÓN", tableStartX + 55, startY + 3);
      doc.text("CONTRATO DE TRABAJO POR OBRA O LABOR", tableStartX + 43, startY + 7);
      col1 = tableStartX + 30;
      col2 = tableStartX + 50;
      col3 = tableStartX + 110;
      doc.line(tableStartX, startY + 4, tableStartX + tableWidth - 50, startY + 4);
      doc.line(tableStartX, startY + 8, tableStartX + tableWidth - 50, startY + 8);
      doc.line(col1, startY + 8, col1, startY + 13);
      doc.line(col2, startY + 8, col2, startY + 13);
      doc.line(col3, startY + 8, col3, startY + 13);
      doc.setFont('helvetica', 'bold');
      doc.text("Código: " + codigo, tableStartX + 2, startY + 11.5);
      doc.text("Versión: " + version, col1 + 2, startY + 11.5);
      doc.text(`Fecha Emisión: ${fechaEmision}`, col2 + 5, startY + 11.5);
      doc.text(`Página: ${numPagina} de 3`, col3 + 6, startY + 11.5);
      // Restaurar la fuente del cuerpo: renderJustifiedLine no fija el tamaño.
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      return columnStartY;
    };

    let texto3 = 'bases de datos o archivos, y los derechos, libertades y garantías a los que se refieren el artículo 15 y 20 de la Constitución Política de Colombia. Autorizo también, de manera expresa, el envío de mensajes a través de cualquier medio que he registrado a mi EMPLEADOR el día de la contratación, para remitir comunicados internos sobre información concerniente a Seguridad Social, así como también, la notificaciones sobre licencias, permisos, cartas laborales, cesantías, citaciones, memorandos, y todos aquellos procesos internos que conlleven a la comunicación entre el EMPLEADOR y el EMPLEADO. (iii) Notificación sobre desprendibles de pagos de Nómina y/ o liquidación final. En adición y complemento de las autorizaciones previamente otorgadas, autorizo de manera expresa y previa sin lugar a pagos ni retribuciones al EMPLEADOR, a sus sucesores, cesionarios a cualquier título o a quien represente los derechos, para que efectúe el Tratamiento de mis Datos Personales de la manera y para las finalidades que se señalan a continuación. Para efectos de la presente autorización, se entiende por “Datos Personales” la información personal que suministre por cualquier medio, incluyendo, pero sin limitarse a, aquella de carácter financiero, crediticio, comercial, profesional, sensible (tales como mis huellas, imagen, voz, entre otros), técnico y administrativo, privada, semiprivada o de cualquier naturaleza pasada, presente o futura, contenida en cualquier medio físico, digital o electrónico, entre otros y sin limitarse a documentos, fotos, memorias USB, grabaciones, datos biométricos, correos electrónicos y video grabaciones. Así mismo, se entiende por “Tratamiento” el recolectar, consultar, recopilar, evaluar, catalogar, clasificar, ordenar, grabar, almacenar, actualizar, modificar, aclarar, reportar, informar, analizar, utilizar, compartir, circular, suministrar, suprimir, procesar, solicitar, verificar, intercambiar, retirar, trasferir, transmitir, o divulgar, y en general, efectuar cualquier operación o conjunto de operaciones sobre mis Datos Personales en medio físicos, digitales, electrónicos, o por cualquier otro medio. La autorización que otorgo por el presente medio para el Tratamiento de mis Datos Personales tendrá las siguientes finalidades: a. Promocionar, comercializar u ofrecer, de manera individual o conjunta productos y/o servicios propios u ofrecidos en alianza comercial, a través de cualquier medio o canal, o para complementar, optimizar o profundizar el portafolio de productos y/o servicios actualmente ofrecidos. Esta autorización para el Tratamiento de mis Datos Personales se hace extensiva a las entidades subordinadas de EL EMPLEADOR, o ante cualquier sociedad en la que éstas tengan participación accionaria directa o indirectamente (en adelante “LAS ENTIDADES AUTORIZADAS”). a. autoriza explícitamente al EMPLEADOR , en forma previa, expresa e informada, para que directamente o a través de sus empleados, asesores, consultores, empresas usuarias, proveedores de servicios de selección, contratación, exámenes ocupacionales, estudios de seguridad, dotación y elementos de protección personal, capacitaciones, cursos, Fondos de empleados, Fondos funerarios, Empresas del Sistema de Seguridad Social: Fondos de Pensiones, EPS, Administradoras de Riesgos Laborales, Cajas de Compensación Familiar, entre otros: 1. A realizar cualquier operación que tenga una finalidad lícita, tales como la recolección, el almacenamiento, el uso, la circulación, supresión, transferencia y transmisión (el “Tratamiento”) de los datos personales relacionados con su vinculación laboral y con la ejecución, desarrollo y terminación del presente contrato de trabajo, cuya finalidad incluye, pero no se limita, a los procesos verificación de la aptitud física del TRABAJADOR para desempeñar en forma eficiente las labores sin impactar negativamente su salud o la de terceros, las afiliaciones del TRABAJADOR y sus beneficiarios al Sistema general de seguridad social y parafiscales, la remisión del TRABAJADOR para que realice apertura de cuenta de nómina, archivo y procesamiento de nómina, gestión y archivo de procesos disciplinarios, archivo de documentos soporte de su vinculación contractual, reporte ante autoridades administrativas, laborales, fiscales o judiciales, entre otras, así como el cumplimiento de obligaciones legales o contractuales del EMPLEADOR con terceros, la debida ejecución del Contrato de trabajo, el cumplimiento de las políticas internas del EMPLEADOR, la verificación del cumplimiento de las obligaciones del TRABAJADOR, la administración de sus sistemas de información y comunicaciones, la generación de copias y archivos de seguridad de la información en los equipos proporcionados por EL EMPLEADOR. Además, la información personal se recibirá y utilizará para efectos de administración del factor humano en temas de capacitación laboral, bienestar social, cumplimiento de normas de seguridad laboral y seguridad social, siendo necesario, en algunos eventos, recibir información sensible sobre estados de salud e información de menores de edad beneficiarios de esquemas de seguridad social, así como la información necesaria para el cumplimiento de obligaciones laborales de orden legal y extralegal. Toda la anterior información se tratará conforme a las exigencias legales en cada caso. 2. EL TRABAJADOR conoce el carácter facultativo de entregar o no al EMPLEADOR sus datos sensibles. 3. EL TRABAJADOR autoriza al responsable del tratamiento de manera expresa a dar tratamiento a los datos sensibles del titular, siendo esto datos los siguientes: origen racial o étnico, orientación sexual, filiación política o religiosa, datos referentes a la salud, datos biométricos, actividad en organizaciones sindicales o de derechos humanos, 4.EL TRABAJADOR da autorización expresa al responsable del tratamiento para que capture y use la información personal y sensible de sus hijos menores de edad. b. Como elemento de análisis en etapas pre-contractuales, contractuales, y post- contractuales para establecer y/o mantener cualquier relación contractual, incluyendo como parte de ello, los siguientes propósitos: (i). Actualizar bases de datos y tramitar la apertura y/o servicios en EL EMPLEADOR o en cualquiera de las ENTIDADES AUTORIZADAS, (ii). Evaluar riesgos derivados de la relación contractual potencial, vigente o concluida. (iii). Realizar, validar, autorizar o verificar transacciones incluyendo, cuando sea requerido, la consulta y reproducción de datos sensibles tales como la huella, imagen o la voz. (iv). Obtener conocimiento del perfil comercial o transaccional del titular, el nacimiento, modificación, celebración y/ o extinción de obligaciones directas, contingentes o indirectas, el incumplimiento de las obligaciones que adquiera con EL EMPLEADOR o con cualquier tercero, así como cualquier novedad en relación con tales obligaciones, hábitos de pago y comportamiento crediticio con EL EMPLEADOR y/o terceros. (v). Conocer información acerca de mi manejo de cuentas corrientes, ahorros, depósitos, tarjetas de crédito, comportamiento comercial, laboral y demás productos o servicios y, en general, del cumplimiento y manejo de mis créditos y obligaciones, cualquiera que sea su naturaleza. Esta autorización comprende información referente al manejo, estado, cumplimiento de las relaciones, contratos y servicios, hábitos de pago, incluyendo aportes al sistema de seguridad social, obligaciones y las deudas vigentes, vencidas sin cancelar, procesos, o la utilización indebida de servicios financieros. (vi). Dar cumplimiento a sus obligaciones legales y contractuales. (vii). Ejercer sus derechos, incluyendo los referentes a actividades de cobranza judicial y extrajudicial y las gestiones conexas para obtener el pago de las obligaciones a cargo del titular o de su empleador, si es el caso. (viii). Implementación de software y servicios tecnológicos. Para efectos de lo dispuesto en el presente literal b, EL EMPLEADOR en lo que resulte aplicable, podrá efectuar el Tratamiento de mis Datos Personales ante entidades de consulta, que manejen o administren bases de datos para los fines legalmente definidos, domiciliadas en Colombia o en el exterior, sean personas naturales o jurídicas, colombianas o extranjeras. c. Realizar ventas cruzadas de productos y/o servicios ofrecidos por EL EMPLEADOR o por cualquiera de LAS ENTIDADES AUTORIZADAS o sus aliados comerciales, incluyendo la celebración de convenios de marca compartida. d. Elaborar y reportar información estadística, encuestas de satisfacción, estudios y análisis de mercado, incluyendo la posibilidad de contactarme para dichos propósitos. e. Enviar mensajes, notificaciones o alertas a través de cualquier medio para remitir extractos, divulgar información legal, de seguridad, promociones, campañas comerciales, publicitarias, de mercadeo, institucionales o de educación financiera, sorteos, eventos u otros beneficios e informar al titular acerca de las innovaciones efectuadas en sus productos y/o servicios, dar a conocer las mejoras o cambios en sus canales de atención, así como dar a conocer otros servicios y/o productos ofrecidos por EL EMPLEADOR; LAS ENTIDADES AUTORIZADAS o sus aliados comerciales. f. Llevar a cabo las gestiones pertinentes, incluyendo la recolección y entrega de información ante autoridades públicas o privadas, nacionales o extranjeras con competencia sobre EL EMPLEADOR, LAS ENTIDADES AUTORIZADAS o sobre sus actividades, productos y /o servicios, cuando se requiera para dar cumplimiento a sus deberes legales o reglamentarios, incluyendo dentro de estos, aquellos referentes a la prevención de la evasión fiscal, lavado de activos y financiación del terrorismo u otros propósitos similares emitidas por autoridades competentes, g. validar información con las diferentes bases de datos de EL EMPLEADOR, de LAS ENTIDADES AUTORIZADAS, de autoridades y/o entidades estatales y de terceros tales como operadores de información y demás entidades que formen parte del Sistema de Seguridad Social Integral, empresas prestadoras de servicios públicos y de telefonía móvil, entre otras, para desarrollar las actividades propias de objeto social principal y conexo y/o cumplir con obligaciones legales. h. Para que mis datos Personales puedan ser utilizados como medio de prueba. Los Datos Personales suministrados podrán circular y transferirse a la totalidad de las áreas de EL EMPLEADOR incluyendo proveedores de servicios, usuarios de red, redes de distribución y personas que realicen la promoción de sus productos y servicios, incluidos call centers, domiciliados en Colombia o en el exterior, sean personas naturales o jurídicas, colombianas o extranjeros a su fuerza comercial, equipos de telemercadeo y/o procesadores de datos que trabajen en nombre de EL EMPLEADOR, incluyendo pero sin limitarse, contratistas, delegados, outsourcing, tercerización, red de oficinas o aliados, con el objeto de desarrollar servicios de alojamiento de sistemas, de mantenimiento, servicios de análisis, servicios de mensajería por e- mail o correo físico, servicios de entrega, gestión de transacciones de pago, cobranza, entre otros. En consecuencia, el titular entiende y acepta que mediante la presentación autorización concede a estos terceros, autorización para acceder a sus Datos Personales en la medida en que así lo requieren para la prestación de los servicios para los cuales fueron contratados y sujeto al cumplimiento de los deberes que les correspondan como encargados del Tratamiento de mis Datos Personales. Igualmente, a EL EMPLEADOR para compartir mis datos Personales con las entidades gremiales a las que pertenezca la entidad, para fines comerciales, estadísticos y de estudio y análisis de mercadeo. Es entendido que las personas naturales y jurídicas, nacionales y extranjeras mencionadas anteriormente ante las cuales EL EMPLEADOR puede llevar a cabo el Tratamiento de mis Datos Personales, también cuentan con mi autorización para permitir dicho Tratamiento. Adicionalmente, mediante el otorgamiento de la presente autorización, manifiesto: (i) que los Datos Personales suministrados son veraces, verificables y completos, (ii) que conozco y entiendo que el suministro de la presente autorización es voluntaria, razón por la cual no me encuentro obligado a otorgar la presenta autorización, (iii) que conozco y entiendo que mediante la simple presentación de una comunicación escrita puedo limitar en todo o en parte el alcance de la presente autorización para que, entre otros, la misma se otorgue únicamente frente a EL EMPLEADOR pero no frente a LAS ENTIDADES AUTORIZADAS y (iv) haber sido informado sobre mis derechos a conocer, actualizar y rectificar mis Datos Personales, el carácter facultativo de mis respuestas a las preguntas que sean hechas cuando versen sobre datos sensibles o sobre datos de los niños, niñas o adolescentes, solicitar prueba de la autorización otorgada para su tratamiento, ser informado sobre el uso que se ha dado a los mismo, presentar quejas ante la autoridad competente por infracción a la ley una vez haya agotado el trámite de consulta o reclamo ante EL EMPLEADOR, revocar la presentación autorización, solicitar la supresión de sus datos en los casos en que sea procedente y ejercer en forma gratuita mis derechos y garantías constitucionales y legales. EL EMPLEADOR informa que el tratamiento de sus Datos Personales se efectuará de acuerdo con la Política de la entidad en esta materia, la cual puede ser consultada en sus instalaciones. DÉCIMA TERCERA. AUTORIZACIÓN DE DESCUENTOS: El TRABAJADOR autoriza expresamente al EMPLEADOR para que se descuenten de mi salario y prestaciones o cualquier otro concepto las sumas que por error haya recibido, permitiendo que el EMPLEADOR compense del valor de los salarios, prestaciones legales o extralegales, indemnizaciones y otro tipo de dinero a pagar al momento de la Nómina y/o liquidación las sumas que yo como TRABAJADOR esté debiendo al EMPLEADOR Y EMPRESA USUARIA por'
    // La hoja 3 (cláusulas DÉCIMA CUARTA→VIGÉSIMA CUARTA + constancia + firmas)
    // FALTABA en esta variante: el contrato quedaba cortado en "...EMPRESA
    // USUARIA por". Mismo texto y cierre que la variante Completa.
    let texto4 = `los siguientes conceptos: 'Préstamos debidamente autorizados por escrito; valor de los elementos de trabajo y mercancías extraviadas bajo mi responsabilidad y que llegaren a faltar al momento de hacer entrega del inventario; los valores que se me hubieren confiado para mi manejo y que hayan sido dispuestos abusivamente para otros propósitos en perjuicio del EMPLEADOR; los anticipos o sumas no legalizadas con las facturas o comprobantes requeridos que me fueron entregadas para gastos o viajes, así como el valor de los tiquetes aéreos no devueltos; las sumas que llegaren a faltar en cumplimiento de mis funciones y a mi cargo previa liquidación y verificación de las mismas, Compra de Flor y/o servicio de alimentación suministrado a través de la Empresa Usuaria de manera quincenal y por el monto de alimentación establecido, todo lo que exceda de valores aprobados (Celulares, Tarjetas de Crédito, etc.), modificaciones en las Bases de Datos sin el soporte correspondiente, errores de digitación y procedimientos internos que por mi culpa afecten económicamente a la empresa y cualquier pago que me haya sido realizado y que no me corresponda. De igual forma, en caso de recibir Subsidio de Transporte y Bonificaciones, autorizo la deducción cuando se causen ausencias al trabajo por cualquier motivo en el mes por el cual recibí pago completo. Por lo anterior, autorizo expresamente al EMPLEADOR para que retenga y cobre de mi salario y liquidación final, de cualquier otro concepto a mi favor, de mis Cesantías consignadas en el fondo de Cesantías los saldos que esté adeudando por los conceptos anteriormente citados. DÉCIMA CUARTA. Las prestaciones sociales se liquidarán y pagaran una vez el TRABAJADOR haya diligenciado el Paz y Salvo en la compañía donde labore en misión y se pagarán en las fechas estipuladas según la  ley.  DÉCIMA QUINTA. AUTORIZACIÓN CONSIGNACION DE PAGO DE LIQUIDACIÓN FINAL O DEFINITIVA, A través del presente documento y en pleno uso de mis facultades legales e intelectuales, doy la autorización a mi EMPLEADOR,  para que me consigne el valor que corresponda a mi liquidación final o definitiva en la misma forma de pago asignada para mi Nómina, dentro de las fechas establecidas y otorgadas por la empresa; De igual manera autoriza al EMPLEADOR, en el evento en que se niegue o no sea posible recibirla directamente, para que deposite en la mencionada cuenta el monto de su liquidación final de contrato de trabajo. Autorizo también, para que me sea notificado mediante correo electrónico, mensaje de texto, whatsapp o cualquier medio registrado, el desprendible de mi liquidación definitiva con la descripción del pago y todos los documentos correspondientes a mi desvinculación laboral. DÉCIMA SEXTA. CONSENTIMIENTO INFORMADO. Exámenes toxicológicos: manifiesto que conozco la política de prevención de consumo de alcohol, y otras sustancias psicoactivas de la Empresa Usuaria, así como también la Política de la Empresa de Servicios Temporales TU ALIANZA S.A.S., (en adelante E.S.T.) Por lo tanto, sé que no debo presentarme en sus instalaciones a ejecutar las actividades para las cuales fui contratado en calidad de trabajador en misión por la E.S.T. bajo los efectos de alguna de estas sustancias o en su defecto, consumirlas durante el tiempo que dure mi permanencia ya que pongo en riesgo mi salud, mi seguridad y la de las personas que se encuentren presentes en las instalaciones. Por lo anterior, autorizo para que se me practiquen cuestionarios y/o pruebas (incluso médicas y de laboratorio) de manera preventiva, aleatoria o por confirmación, toda vez que ya me encuentre laborando dentro de las instalaciones de la empresa, con el objeto de determinar mi aptitud física y mental para llevar a cabo las actividades contratadas, en virtud de la investigación disciplinaria que realice la Empresa y que lo amerite, o en cualquier momento cuando así lo estime pertinente la Compañía, y que los podrá utilizar como pruebas para los mismos fines. Dichas pruebas y exámenes podrán incluir las relativas al consumo de alcohol y sustancias psicoactivas, las cuales se practicarán con la metodología que la empresa usuaria establezca. En el evento en que alguna de las pruebas tenga resultado “positivo” para consumo o en caso de comprobarse el incumplimiento de las obligaciones a mi cargo en relación con esta política, la empresa usuaria informará de dicha situación a la E.S.T. a la cual me encuentro vinculado, quien es mi verdadero empleador y de manera adicional, podrá solicitar mi retiro de sus instalaciones. Autorizo que la empresa usuaria, conserve el documento que contiene los resultados, siempre y cuando lo haga con la debida reserva. La decisión que aquí manifiesto la he tomado de manera autónoma, libre y voluntaria y por tanto, no considero que las mencionadas pruebas y las atribuciones que aquí acepto para la empresa constituyan injerencias indebidas e inconsultas sobre mis derechos a la intimidad y al libre desarrollo de mi personalidad. DÉCIMA SEPTIMA. ENTREGA Y ACEPTACIÓN DEL CARGO Y FUNCIONES ASIGNADAS. De manera atenta le informamos que en el ejercicio de su cargo asignado y mencionado en el presente, usted desarrollará las labores que establezca la Empresa Usuaria donde ingresa como trabajador en misión, dentro sus procesos; comprometiéndose a ejercer fielmente sus funciones, y con la firma de este contrato, se da por entendido y aceptado las condiciones del mismo. * Operario de Cultivo y/o Oficios Varios: Labores de Cultivo que incluyen Corte de Flor, Limpieza de Camas y Plantas, Labores Culturales, Riego, Fumigación (1),  Monitoreo, Pesaje de Productos, Transporte de Flor, Control y Calidad, erradicaciones, Enmalle, Desbotone y todas las labores de Mantenimiento de los Cultivos.*Operario de Poscosecha y/o Oficios Varios: Labores de Poscosecha como Clasificación, Boncheo, Encapuchado, Empaque, Recepción, Manejo de inventarios, Cuarto frío,  Control y Calidad y/ oficios varios.*Operario Mantenimiento: Labores de Mantenimiento, Poda de Prado, Manejo de Maquinaria Agrícola, Electricista, Electromecánico, Soldador, Maestro de Construcción, Ayudante de Construcción, Mantenimiento de Cubiertas Plásticas e Infraestructura y Redes (2)*Labores de Conducción, Auxiliar de Conducción, Logística e Inventarios y/ Oficios Varios.*Apoyo/Reemplazos Administrativos: Asistente de Producción, Asistente de Poscosecha, Asistente de Gestión Humana,  Comerciales y/ Oficios Varios.*Todas las demás labores asignadas por la Empresa Usuaria y que contemple el cargo para el cuál fue contratado. (1)Las labores de Fumigación sólo aplican para el personal masculino mayor de edad. (2) Estas labores se realizarán previa aprobación de requisitos del S.G.-S.S.T. de la Empresa Usuaria.Igualmente, le indicamos que el incumplimiento a las funciones antes relacionadas, será calificado como falta grave y por tanto como justa causa para la finalización del contrato de trabajo, de conformidad con lo previsto en el artículo 7) literal a) numeral 6) del Decreto 2351 de 1965, norma que subrogó el artículo 62 del código Sustantivo de Trabajo,  en concordancia con lo previsto el numeral 1° del artículo 58 del mismo Estatuto. PARÁGRAFO PRIMERO. El TRABAJADOR, deberá responder por todos y cada uno de los elementos de trabajo que le entregue EL EMPLEADOR y/o la EMPRESA USUARIA para el desempeño de su cargo. DÉCIMA OCTAVA. El TRABAJADOR, debe registrar en las oficinas del EMPLEADOR, su dirección, número de teléfono y domicilio y dar aviso inmediato en cualquier cambio que ocurra. DÉCIMA NOVENA. El TRABAJADOR, debe respetar y someterse al Reglamento de Trabajo vigente de ambas empresas en todas sus partes, cuyo texto manifiesta conocer en todas sus partes. VIGÉSIMA. EL TRABAJADOR acepta, entiende y conoce que EL EMPLEADOR, tiene la obligación legal de prevenir y controlar el lavado de activos y la financiación del terrorismo, por tanto, expresa de manera voluntaria e inequívoca, que no se encuentra vinculado  ni ha sido condenado por parte de las autoridades nacionales e internacionales en cualquier tipo de investigación por delitos de narcotráfico, terrorismo, secuestro, lavado de activos, financiación del terrorismo y administración de recursos relacionados con actividades terroristas  y/o cualquier delito colateral o subyacente a estos; ni se encuentra incluido en listas para el control de lavado de activos  y financiación del terrorismo, administradas por cualquier autoridad nacional o extranjera. Convienen las partes, conforme a lo establecido en el numeral 6º del artículo séptimo del decreto 2351 de 1.965, que la inexactitud en la manifestación del EL TRABAJADOR contenida en la presente adición al contrato de trabajo, constituye falta grave y dará lugar a la terminación del contrato de trabajo por justa causa de despido. VIGÉSIMA PRIMERA. INCAPACIDADES MÉDICAS: Si EL TRABAJADOR, por causa de enfermedad o accidente, no asistiere a su trabajo, deberá presentar a EL EMPLEADOR, a la mayor brevedad, la respectiva incapacidad, a cuyo efecto se establece que exclusivamente será válida la expedida por los médicos de la respectiva Entidad Promotora de Salud, para justificar las ausencias antedichas. VIGÉSIMA SEGUNDA. AUTORIZACIÓN DE ACCESO A HISTÓRIA CLÍNICA: De acuerdo con lo establecido en el artículo 34 de la Ley 23 de 1981 y la Resolución 1995 de 1999 expedida por el Ministerio de Salud, EL TRABAJADOR autoriza expresamente a EL EMPLEADOR para que tenga acceso y copia de su historia clínica, así como de todos aquellos datos que en aquélla se registren o lleguen a ser registrados, con el fin de adelantar todos los trámites que sean necesarios ante entidades como Empresas Promotoras de Salud (EPS),  Administradoras de Riesgos laborales (ARL), Administradoras de Fondos de Pensiones (AFP), Instituciones Prestadoras de Salud (IPS), médicos particulares y demás entidades de la Seguridad Social. VIGÉSIMA TERCERA. REGLAMENTO DE TRABAJO Y DE HIGIENE Y SEGURIDAD INDUSTRIAL. El TRABAJADOR deja constancia de que conoce y acepta el Reglamento de Trabajo y el Reglamento de Higiene y Seguridad Industrial del TRABAJADOR. VIGÉSIMA CUARTA. El TRABAJADOR ha leído, entiende y acepta de manera íntegra todo el contenido del presente contrato y manifiesta bajo la gravedad de juramento, que no sufre de problemas de alcoholismo, drogadicción, enfermedad infectocontagiosa, ni consumidor habitual de sustancias alucinógenas, ni drogas enervantes.  PARÁGRAFO PRIMERO. Las partes declaran que no reconocerán válidas las estipulaciones anteriores a este contrato de trabajo, que es el único vigente entre ellas reemplazando y que desconocen cualquier otro verbal o escrito anterior, el cual tendrá vigencia a partir de la FECHA DE INICIACION, y para lo cual el TRABAJADOR inicia su vinculación laboral con el EMPLEADOR.; pudiendo las partes convenir por escrito modificaciones al mismo, las que formarán parte integrante de este contrato. El presente contrato se ANULARÁ si el TRABAJADOR no se presenta a laborar el día que corresponde o si la EMPRESA USUARIA desiste de la Contratación. Previa la declaración de que a él se tienen incorporadas todas las disposiciones del reglamento interno que rige en la EMPRESA EMPLEADORA. El TRABAJADOR deja expresa constancia de que al suscribir el presente contrato recibió copia del mismo.`;

    // TODO el contrato en UN solo bloque continuo: fluye entre páginas vía
    // `encabezadoPagina` y cada renglón (incluida la última línea de cada hoja)
    // queda justificado al margen. La línea final va a la izquierda (cierra el
    // párrafo).
    y = this.renderJustifiedText(doc, texto + ' ' + texto2 + ' ' + texto3 + ' ' + texto4, x, y + 5, maxWidth, lineHeight, false, 10, encabezadoPagina);

    y += 4; // Añadir espacio
    // Fecha de contrato (no la fecha actual): se imprime sobre la línea de firma.
    const fechaCompleta = new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(this.getFechaContrato());

    // Texto corrido, sin línea de firma: la fecha va pegada en el mismo
    // renglón (fecha en normal, el resto en negrita).
    doc.setFont('helvetica', 'bold');
    const prefijoConstancia = 'Para constancia se firma ante testigos el día ';
    doc.text(prefijoConstancia, 7, y);
    const xFecha = 7 + doc.getTextWidth(prefijoConstancia);
    doc.setFont('helvetica', 'normal');
    doc.text(fechaCompleta, xFecha, y);
    doc.setFont('helvetica', 'bold');
    doc.text(' en la ciudad de Bogotá', xFecha + doc.getTextWidth(fechaCompleta), y);

    y += 12;

    // --- Fila 1: Trabajador e Identificación ---
    doc.text('Firma del Trabajador', 20, y);
    doc.line(50, y, 122, y);
    if (this.firma && this.firma !== '') {
      try {
        const rFirma = await fetch(this.firma);
        if (rFirma.ok) {
          const bFirma = await rFirma.blob();
          const base64Firma = await new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(bFirma);
          });
          doc.addImage(base64Firma, 'PNG', 65, y - 9, 28, 8);
        } else {
          doc.addImage(this.firma, 'PNG', 65, y - 9, 28, 8);
        }
      } catch (e) {
        try { doc.addImage(this.firma, 'PNG', 65, y - 9, 28, 8); } catch (ex) { }
      }
    }

    // No de Identificación (Derecha)
    doc.text('No de Identificación', 130, y);
    doc.line(158, y, 203, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.numeroDocConPuntos(this.cedula), 165, y - 1);

    y += 24; // Espacio para la segunda fila de firmas

    // --- Fila 2: Empleador, Testigo 1, Testigo 2 ---
    try {
      doc.addImage('firma/firmaselloalianza.jpeg', 'PNG', 4, y - 18, 28, 14);
    } catch (e) { }
    doc.setFont('helvetica', 'bold');
    doc.text('El Empleador', 11, y);
    doc.text('Heidy J. Torres S.', 8, y + 4);
    doc.text('C.C. 52,440,635', 10, y + 8);

    // Testigo 1 (Centro)
    doc.text('Firma y C.C. Testigo 1', 43, y);
    doc.line(75, y, 130, y);
    try {
      doc.addImage('firma/Angela.png', 'PNG', 85, y - 16, 30, 14);
    } catch (e) { }
    doc.text('Angie Gutiérrez C.C.1.073.174.200', 76, y + 4);

    // Testigo 2 (Derecha)
    doc.text('Firma y CC Testigo 2', 135, y);
    doc.line(165, y, 203, y);

    if (this.firmaPersonalAdministrativo && this.firmaPersonalAdministrativo !== '') {
      try {
        const rAdmin = await fetch(this.firmaPersonalAdministrativo);
        if (rAdmin.ok) {
          const bAdmin = await rAdmin.blob();
          const base64Admin = await new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(bAdmin);
          });
          doc.addImage(base64Admin, 'PNG', 165, y - 16, 35, 14);
        } else {
          doc.addImage(this.firmaPersonalAdministrativo, 'PNG', 165, y - 16, 35, 14);
        }
      } catch (e) {
        try { doc.addImage(this.firmaPersonalAdministrativo, 'PNG', 165, y - 16, 35, 14); } catch (ex) { }
      }
    }

    const usuarioSesion = this.utilService.getUser();
    // nombre y cc del que está en sesión (testigo 2)
    doc.text(usuarioSesion.datos_basicos.nombres + ' ' + usuarioSesion.datos_basicos.apellidos, 165, y + 4);
    doc.text(usuarioSesion.numero_de_documento, 165, y + 7);

    // Convertir a Blob y guardar en uploadedFiles
    const pdfBlob = doc.output('blob');
    const fileName = `${this.empresa}_Contrato.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    this.uploadedFiles['Contrato'] = { file: pdfFile, fileName };

    this.verPDF({ titulo: 'Contrato' });
  }

  async promptCodigoContrato(codigoGenerado: string): Promise<string | null> {
    const resultSwal = await Swal.fire({
      title: 'Código de Contrato',
      html: `¿Qué código deseas usar para la Ficha Técnica?<br><br><b>Generado:</b> ${codigoGenerado || 'Ninguno'}`,
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: '#3085d6',
      denyButtonColor: '#10b981',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Usar Generado',
      denyButtonText: 'Escribir Código',
      cancelButtonText: 'Vacio (Blanco)'
    });

    if (resultSwal.isDenied) {
      const { value: codigoEscrito } = await Swal.fire({
        title: 'Especificar Código',
        input: 'text',
        inputPlaceholder: 'Ingresa el código...',
        showCancelButton: true,
        confirmButtonText: 'Aceptar',
        cancelButtonText: 'Cancelar'
      });
      if (codigoEscrito !== undefined) {
        return codigoEscrito;
      } else {
        return null;
      }
    } else if (resultSwal.dismiss === Swal.DismissReason.cancel) {
      return '';
    } else if (resultSwal.isDismissed) {
      return null;
    }

    return codigoGenerado;
  }

  async generarFichaTecnica(plantilla?: 'APOYO' | 'ALIANZA') {
    try {
      // =========================================================
      // 0) Helpers de imagen (PDF-lib) - robustos como en jsPDF
      // =========================================================
      const bytesCache = new Map<string, Promise<ArrayBuffer | null>>();

      const isHttp = (u: string) => /^https?:\/\//i.test(u);
      const isDataUrl = (u: string) => /^data:image\//i.test(u);

      const normalizeUrl = (u: string) => {
        const s = String(u ?? '').trim();
        if (!s) return '';
        if (isHttp(s) || isDataUrl(s)) return s;

        const clean = s.replace(/^\/+/, '');
        // Si ya viene con assets/, lo dejamos
        if (clean.startsWith('assets/')) return clean;

        // Muchos de tus recursos parecen estar como "logos/.." o "firma/.." o "Docs/.."
        // En Angular normalmente deben ir bajo assets/
        return `assets/${clean}`;
      };

      const dataUrlToBytes = (dataUrl: string): ArrayBuffer | null => {
        try {
          const [meta, b64] = dataUrl.split(',');
          if (!meta || !b64) return null;
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        } catch {
          return null;
        }
      };

      const detectImageType = (ab: ArrayBuffer): 'png' | 'jpg' | null => {
        const b = new Uint8Array(ab);
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (
          b.length >= 8 &&
          b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
          b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A
        ) return 'png';

        // JPG: FF D8 FF
        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';

        return null;
      };

      const fetchBytesOrNull = async (urlOrData?: string): Promise<ArrayBuffer | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;

        // data:image/*
        if (isDataUrl(raw)) return dataUrlToBytes(raw);

        const url = normalizeUrl(raw);
        if (!url) return null;

        // cache por URL para no descargar varias veces
        if (bytesCache.has(url)) return await bytesCache.get(url)!;

        const p = (async () => {
          // 1) Intenta con tu helper (si ya está armado con headers, baseUrl, etc.)
          try {
            const ab = await this.fetchAsArrayBufferOrNull(url);
            if (ab) return ab;
          } catch { }

          // 2) Intento extra: si por alguna razón normalizeUrl “rompió” tu path,
          //    probamos el raw original (solo cuando era relativo)
          if (!isHttp(raw) && !raw.startsWith('assets/') && !isDataUrl(raw)) {
            try {
              const ab2 = await this.fetchAsArrayBufferOrNull(raw);
              if (ab2) return ab2;
            } catch { }
          }

          return null;
        })();

        bytesCache.set(url, p);
        return await p;
      };

      const embedImageOrNull = async (pdfDoc: PDFDocument, urlOrData?: string) => {
        const ab = await fetchBytesOrNull(urlOrData);
        if (!ab) return null;

        const kind = detectImageType(ab);
        if (!kind) return null;

        try {
          const u8 = new Uint8Array(ab);
          return kind === 'png' ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
        } catch {
          return null;
        }
      };

      const setButtonImageSafe = async (
        pdfDoc: PDFDocument,
        form: any,
        buttonName: string,
        urlOrData?: string
      ) => {
        const img = await embedImageOrNull(pdfDoc, urlOrData);
        if (!img) return false;
        // Se DIBUJA en la página en vez de `setImage`: así la imagen sobrevive
        // al copiar estas páginas a otro PDF. Ver pdf-aplanado.util.ts.
        return dibujarImagenPlana(pdfDoc, form, buttonName, img);
      };

      // =========================================================
      // 1) Normalización desde this.candidato y this.vacante
      // =========================================================
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};

      const contacto: any = cand.contacto ?? {};
      const residencia: any = cand.residencia ?? {};
      const infoCc: any = cand.info_cc ?? {};

      const entrevista: any = Array.isArray(cand.entrevistas) ? cand.entrevistas[0] : null;
      const proceso: any = entrevista?.proceso ?? {};
      const contrato: any = proceso?.contrato ?? {};
      const antecedentes: any[] = Array.isArray(proceso?.antecedentes) ? proceso.antecedentes : [];

      const norm = (v: any) => String(v ?? '').trim().toUpperCase();

      const findAnte = (nombre: string) => antecedentes.find(a => norm(a?.nombre) === norm(nombre));

      const eps = String(findAnte('EPS')?.observacion ?? '');
      const afp = String(findAnte('AFP')?.observacion ?? '');

      const mapEstadoCivil = (code: any): string => {
        const c = norm(code);
        if (c === 'SO' || c === 'SOLTERO' || c === 'S') return 'SO';
        if (c === 'CA' || c === 'CASADO') return 'CA';
        if (c === 'UN' || c === 'UL' || c === 'UNION LIBRE' || c === 'UNIÓN LIBRE') return 'UN';
        if (c === 'SE' || c === 'SEP' || c === 'SEPARADO') return 'SE';
        if (c === 'VI' || c === 'VIUDO') return 'VI';
        return c || '';
      };

      const nombreCompleto = [
        cand.primer_nombre,
        cand.segundo_nombre,
        cand.primer_apellido,
        cand.segundo_apellido,
      ]
        .map((x: any) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' ');

      let codigoGenerado = String(contrato?.codigo_contrato ?? proceso?.contrato_codigo ?? '').trim();
      let codigoContrato = codigoGenerado;

      if (String(this.empresa).toUpperCase().includes('ALIANZA')) {
        const codigoContratoRes = await this.promptCodigoContrato(codigoGenerado);
        if (codigoContratoRes === null) {
          Swal.close();
          return;
        }
        codigoContrato = codigoContratoRes;
      }

      const fechaIngreso = String(vac?.fechadeIngreso ?? '').trim(); // "2025-12-12"
      const salario = vac?.salario ?? proceso?.vacante_salario ?? '';

      const formacion0: any = Array.isArray(cand.formaciones) ? cand.formaciones[0] : null;
      const exp0: any = Array.isArray(cand.experiencias) ? cand.experiencias[0] : null;

      // dv = "datoPersonal" esperado por tu PDF
      const dv: any = {
        primer_apellido: cand.primer_apellido ?? '',
        segundo_apellido: cand.segundo_apellido ?? '',
        primer_nombre: cand.primer_nombre ?? '',
        segundo_nombre: cand.segundo_nombre ?? '',

        tipodedocumento: cand.tipo_doc ?? '',
        numerodeceduladepersona: cand.numero_documento ?? '',

        fecha_expedicion_cc: infoCc?.fecha_expedicion ?? '',
        departamento_expedicion_cc: infoCc?.depto_expedicion ?? '',
        municipio_expedicion_cc: infoCc?.mpio_expedicion ?? '',

        genero: cand.sexo ?? '',
        fecha_nacimiento: cand.fecha_nacimiento ?? '',
        lugar_nacimiento_departamento: infoCc?.depto_nacimiento ?? '',
        lugar_nacimiento_municipio: infoCc?.mpio_nacimiento ?? '',

        estado_civil: mapEstadoCivil(cand.estado_civil),

        direccion_residencia: residencia?.direccion ?? '',
        barrio: residencia?.barrio ?? '',
        municipio: (vac?.municipio?.[0] ?? entrevista?.oficina ?? '').toString(),
        departamento: '', // no viene en el JSON

        celular: contacto?.celular ?? '',
        primercorreoelectronico: contacto?.email ?? '',

        rh: cand.rh ?? '',
        zurdo_diestro: cand.zurdo_diestro ?? '',

        escolaridad: formacion0?.nivel ?? '',
        nombre_institucion: formacion0?.institucion ?? '',
        titulo_obtenido: formacion0?.titulo_obtenido ?? '',
        ano_finalizacion: formacion0?.anio_finalizacion ?? '',

        nombre_expe_laboral1_empresa: exp0?.empresa ?? '',
        direccion_empresa1: exp0?.direccion ?? '',
        telefonos_empresa1: exp0?.telefonos ?? '',
        nombre_jefe_empresa1: exp0?.nombre_jefe ?? '',
        cargo_empresa1: exp0?.cargo ?? '',
        fecha_retiro_empresa1: exp0?.fecha_retiro ?? '',
        motivo_retiro_empresa1: exp0?.motivo_retiro ?? '',
      };

      // ds = "datoSeleccion"
      const ds: any = {
        fechaIngreso,
        salario,
        eps,
        afp,
        cargo: vac?.cargo ?? '',
        centro_costo_entrevista: entrevista?.oficina ?? '',
        empresa_usuario: vac?.empresaUsuariaSolicita ?? '',
      };

      // datoInfoContratacion
      const datoInfoContratacion: any = {
        codigo_contrato: codigoContrato,
        forma_pago: contrato?.forma_de_pago ?? '',
        numero_pagos: contrato?.numero_para_pagos ?? '',
        porcentaje_arl: contrato?.porcentaje_arl ?? '',
        cesantias: contrato?.cesantias ?? '',
        centro_de_costos: contrato?.Ccentro_de_costos ?? contrato?.centro_de_costos ?? '',
        subCentroCostos: contrato?.subcentro_de_costos ?? '',
        categoria: contrato?.categoria ?? '',
        operacion: contrato?.operacion ?? '',
        grupo: contrato?.grupo ?? '',
        horas_extras:
          contrato?.horas_extras === true ? 'SI' :
            contrato?.horas_extras === false ? 'NO' :
              (contrato?.horas_extras ?? ''),
        semanas_cotizadas: '0',
      };

      // URLs biometría (NO base64)
      const firmaUrl = cand?.biometria?.firma?.file_url ?? cand?.biometria?.firma?.file ?? '';
      const fotoUrl = cand?.biometria?.foto?.file_url ?? cand?.biometria?.foto?.file ?? '';
      const huellaUrl = cand?.biometria?.huella?.file_url ?? cand?.biometria?.huella?.file ?? '';

      // =========================================================
      // 2) Cargar PDF base y setear campos
      // =========================================================
      const pdfUrl = 'Docs/Ficha tecnica.pdf';
      const arrayBuffer = await this.fetchAsArrayBufferOrNull(pdfUrl);
      if (!arrayBuffer) throw new Error('No se pudo cargar el PDF base.');

      const pdfDoc = await PDFDocument.load(arrayBuffer);
      pdfDoc.registerFontkit(fontkit as any);

      const fontBytes = await this.fetchAsArrayBufferOrNull('fonts/Roboto-Regular.ttf');
      const customFont = fontBytes ? await pdfDoc.embedFont(fontBytes) : undefined;

      const form = pdfDoc.getForm();

      // Branding: manda la plantilla elegida por el admin; si no, la temporal.
      const { logoPath, nombreEmpresa } = this.getEmpresaInfo(plantilla);
      const empUsuaria = this.safe(this.empresaUsuariaDoc);

      await setButtonImageSafe(pdfDoc, form, 'Image16_af_image', logoPath);
      await setButtonImageSafe(pdfDoc, form, 'Image18_af_image', logoPath);

      // Cabecera / contrato
      this.setText(form, 'CodContrato', this.safe(codigoContrato), customFont, 7.2);
      try { this.setText(form, 'codigo_contrato', this.safe(codigoContrato), customFont, 7.2); } catch (e) { }
      this.setText(form, 'sede', this.safe(this.oficinaUsuarioImpresa), customFont, 7.2);

      // Llenado completo del formulario (mapping en ficha-tecnica-fill.ts).
      // ctx contiene los datos derivados que el helper necesita y que dependen de
      // servicios del componente (`this.user`, `this.getRutaInfo`, etc.)
      const rutaInfo = this.getRutaInfo(vac.oficinasQueContratan, ds.centro_costo_entrevista || '');
      const ctx = {
        codigoContrato: this.safe(codigoContrato),
        sedeNombre: this.safe(this.oficinaUsuarioImpresa),
        empUsuaria: this.safe(empUsuaria),
        temporal: this.safe(vac?.temporal ?? this.empresa),
        personaQueFirma: this.safe(`${this.user?.datos_basicos?.nombres ?? ''} ${this.user?.datos_basicos?.apellidos ?? ''}`.trim()),
        usaRuta: this.safe(rutaInfo.usaRuta),
        auxilioTransporte: this.safe(vac.auxilioTransporte),
        // Centro de costo y cargo: MISMOS valores que imprime el contrato, para
        // que ficha y contrato nunca salgan con datos distintos.
        centroCosto: this.safe(this.centroCostoDoc),
        cargo: this.safe(this.cargoDoc),
        referenciasA: this.referenciasA,
        referenciasF: this.referenciasF,
      };
      fillFichaTecnicaPdf(form, customFont, cand, vac, ctx);

      // Firmas Biométricas y Administrativas
      this.setText(form, 'Persona que firma', this.safe(`${this.user?.datos_basicos?.nombres ?? ''} ${this.user?.datos_basicos?.apellidos ?? ''}`.trim()), customFont);

      // La imagen se dibuja sobre la PÁGINA, nunca con `setImage`: como
      // apariencia del widget desaparece al copiar estas páginas a otro PDF
      // (Nitro, Acrobat). El helper además quita el widget para que su fondo
      // no tape lo dibujado. Ver pdf-aplanado.util.ts.
      const inyectarImagenSegura = async (campoBtn: string, urlOrData?: string) => {
        if (!urlOrData) return;
        try {
          const img = await embedImageOrNull(pdfDoc, urlOrData);
          if (!img) return;
          dibujarImagenPlana(pdfDoc, form, campoBtn, img);
        } catch (e) {
          console.error(`No se pudo inyectar imagen en ${campoBtn}:`, e);
        }
      };

      await inyectarImagenSegura('Image15_af_image', this.firmaPersonalAdministrativo);
      await inyectarImagenSegura('Image11_af_image', firmaUrl);
      await inyectarImagenSegura('Image10_af_image', huellaUrl);

      // La foto tiene que LLENAR el recuadro, sin aire alrededor.
      //
      // No sirve `setImage`: pdf-lib encaja la imagen dentro del widget
      // (escala al MENOR de los dos factores) y ademas el widget de este boton
      // trae fondo blanco -- /MK /BG [1 1 1] -- que asoma por los lados.
      // Tampoco basta pre-recortar a la proporcion del campo: ese camino hace
      // un segundo fetch de la foto y si falla (CORS, red) cae en silencio a
      // la imagen sin recortar, que es justo como se veia.
      //
      // Se dibuja sobre la pagina escalando al MAYOR factor (modo 'cubrir'),
      // con recorte al rectangulo para que no invada la hoja. El dibujo lo
      // aplaza el helper hasta despues del `flatten()`, o el aplanado pintaria
      // el fondo del widget encima. Ver pdf-aplanado.util.ts.
      if (fotoUrl) {
        // La foto se re-codifica a JPEG con `fotoAlDerecho` (EXIF + giro manual):
        // pdf-lib solo embebe PNG/JPEG y la foto a veces llega en otro formato
        // (webp, etc.) — el preview en pantalla se veía bien pero la ficha salía
        // SIN foto y sin error. Si la re-codificación falla, se intenta la cruda.
        const fotoParaPdf = (await this.fotoAlDerechoDataUrl(fotoUrl)) ?? fotoUrl;
        const imgFoto = await embedImageOrNull(pdfDoc, fotoParaPdf);
        if (imgFoto) {
          dibujarImagenPlana(pdfDoc, form, 'Image17_af_image', imgFoto, 'cubrir');
        } else {
          console.warn('[ficha] no se pudo decodificar la foto del candidato:', fotoUrl);
        }
      }

      // Bloquear campos
      aplanarFormulario(form);

      // Guardar PDF
      const pdfBytes = await pdfDoc.save();
      const ab = this.toSafeArrayBuffer(pdfBytes);
      const file = new File([ab], 'Ficha tecnica.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Ficha Técnica'] = { file, fileName: 'Ficha tecnica.pdf' };
      this.verPDF({ titulo: 'Ficha Técnica' });
    } catch (error) {
      console.error('Error generando ficha técnica:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar la ficha técnica.' });
    }
  }

  // Asegúrate de tener estos imports en el archivo:
  // import { firstValueFrom, of } from 'rxjs';
  // import { catchError, take } from 'rxjs/operators';

  async generarFichaTecnicaTuAlianza() {
    let datoContratacion: any = {};

    try {
      // =========================================================
      // 0) ESPERAR a que llegue la contratación ANTES de continuar
      // =========================================================
      const numeroDoc = String(this.candidato?.numero_documento ?? '').trim();
      if (!numeroDoc) throw new Error('El candidato no tiene número de documento.');

      const respContratacion: any = await firstValueFrom(
        this.contratacionService.buscarEncontratacion(numeroDoc).pipe(
          take(1),
          catchError((err) => {
            console.error('Error buscando contratación:', err);
            return of({ data: [] });
          })
        )
      );

      console.log('Datos de contratación recibidos:', respContratacion);
      datoContratacion = respContratacion?.data?.[0] ?? {};
      console.log('Dato de contratación para ficha técnica Tu Alianza:', datoContratacion);

      // =========================================================
      // 0) Helpers de imagen (PDF-lib) - robustos + NO SE VOLTEA
      // =========================================================
      const bytesCache = new Map<string, Promise<ArrayBuffer | null>>();

      const isHttp = (u: string) => /^https?:\/\//i.test(u);
      const isDataUrl = (u: string) => /^data:image\//i.test(u);

      const normalizeUrl = (u: string) => {
        const s = String(u ?? '').trim();
        if (!s) return '';
        if (isHttp(s) || isDataUrl(s)) return s;

        const clean = s.replace(/^\/+/, '');
        if (clean.startsWith('assets/')) return clean;

        return `assets/${clean}`;
      };

      const dataUrlToBytes = (dataUrl: string): ArrayBuffer | null => {
        try {
          const [meta, b64] = dataUrl.split(',');
          if (!meta || !b64) return null;
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        } catch {
          return null;
        }
      };

      const detectImageType = (ab: ArrayBuffer): 'png' | 'jpg' | null => {
        const b = new Uint8Array(ab);
        if (
          b.length >= 8 &&
          b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
          b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A
        ) return 'png';

        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';

        return null;
      };

      const fetchBytesOrNull = async (urlOrData?: string): Promise<ArrayBuffer | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;

        if (isDataUrl(raw)) return dataUrlToBytes(raw);

        const url = normalizeUrl(raw);
        if (!url) return null;

        if (bytesCache.has(url)) return await bytesCache.get(url)!;

        const p = (async () => {
          try {
            const ab = await this.fetchAsArrayBufferOrNull(url);
            if (ab) return ab;
          } catch { }

          if (!isHttp(raw) && !raw.startsWith('assets/') && !isDataUrl(raw)) {
            try {
              const ab2 = await this.fetchAsArrayBufferOrNull(raw);
              if (ab2) return ab2;
            } catch { }
          }

          return null;
        })();

        bytesCache.set(url, p);
        return await p;
      };

      type ImgFixOpts = {
        forcePortrait?: boolean; // si viene horizontal, lo gira para que quede vertical
        jpegQuality?: number;    // 0..1
      };

      const fixImageBytesForPdf = async (
        ab: ArrayBuffer,
        kind: 'png' | 'jpg',
        opts?: ImgFixOpts
      ): Promise<{ bytes: Uint8Array; outKind: 'png' | 'jpg' }> => {
        const forcePortrait = opts?.forcePortrait ?? false;
        const jpegQuality = opts?.jpegQuality ?? 0.92;

        try {
          const mime = kind === 'png' ? 'image/png' : 'image/jpeg';
          const blob = new Blob([ab], { type: mime });

          // 1) Decodifica respetando EXIF cuando el browser lo soporta
          let bitmap: ImageBitmap | null = null;
          try {
            bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
          } catch {
            bitmap = await createImageBitmap(blob).catch(() => null);
          }

          // 2) Fuente para dibujar (bitmap o <img>)
          const getSource = async (): Promise<{
            w: number;
            h: number;
            draw: (ctx: CanvasRenderingContext2D) => void;
            close?: () => void;
          } | null> => {
            if (bitmap) {
              const w = bitmap.width;
              const h = bitmap.height;
              return {
                w,
                h,
                draw: (ctx) => ctx.drawImage(bitmap as ImageBitmap, 0, 0),
                close: () => bitmap?.close?.()
              };
            }

            const url = URL.createObjectURL(blob);
            try {
              const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = reject;
                el.src = url;
              });

              const w = img.naturalWidth || img.width;
              const h = img.naturalHeight || img.height;
              return { w, h, draw: (ctx) => ctx.drawImage(img, 0, 0) };
            } finally {
              URL.revokeObjectURL(url);
            }
          };

          const src = await getSource();
          if (!src) return { bytes: new Uint8Array(ab), outKind: kind };

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            src.close?.();
            return { bytes: new Uint8Array(ab), outKind: kind };
          }

          // 3) ✅ FORZAR “VERTICAL” si viene horizontal
          if (forcePortrait && src.w > src.h) {
            canvas.width = src.h;
            canvas.height = src.w;
            ctx.translate(canvas.width, 0);
            ctx.rotate(Math.PI / 2);
            src.draw(ctx);
          } else {
            canvas.width = src.w;
            canvas.height = src.h;
            src.draw(ctx);
          }

          src.close?.();

          // 4) Exporta al mismo formato (png/png, jpg/jpg)
          const outMime = kind === 'png' ? 'image/png' : 'image/jpeg';
          const outBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
              outMime,
              outMime === 'image/jpeg' ? jpegQuality : undefined
            );
          });

          return { bytes: new Uint8Array(await outBlob.arrayBuffer()), outKind: kind };
        } catch {
          return { bytes: new Uint8Array(ab), outKind: kind };
        }
      };

      const embedImageOrNull = async (
        pdfDoc: PDFDocument,
        urlOrData?: string,
        opts?: ImgFixOpts
      ) => {
        const ab = await fetchBytesOrNull(urlOrData);
        if (!ab) return null;

        const kind = detectImageType(ab);
        if (!kind) return null;

        try {
          const fixed = await fixImageBytesForPdf(ab, kind, opts);
          return fixed.outKind === 'png'
            ? await pdfDoc.embedPng(fixed.bytes)
            : await pdfDoc.embedJpg(fixed.bytes);
        } catch {
          return null;
        }
      };

      const setButtonImageSafe = async (
        pdfDoc: PDFDocument,
        form: any,
        buttonName: string,
        urlOrData?: string,
        opts?: ImgFixOpts
      ) => {
        const img = await embedImageOrNull(pdfDoc, urlOrData, opts);
        if (!img) return false;
        // Se DIBUJA en la página en vez de `setImage`: así la imagen sobrevive
        // al copiar estas páginas a otro PDF. Ver pdf-aplanado.util.ts.
        return dibujarImagenPlana(pdfDoc, form, buttonName, img);
      };

      // =========================================================
      // 1) Normalización desde this.candidato y this.vacante
      // =========================================================
      const cand: any = this.candidato ?? {};
      console.log('Candidato para ficha técnica Tu Alianza:', cand);
      const vac: any = this.vacante ?? {};
      console.log('Vacante para ficha técnica Tu Alianza:', vac);

      const contacto: any = cand.contacto ?? {};
      const residencia: any = cand.residencia ?? {};
      const infoCc: any = cand.info_cc ?? {};

      const entrevista: any = Array.isArray(cand.entrevistas) ? cand.entrevistas[0] : null;
      const proceso: any = entrevista?.proceso ?? {};
      const contrato: any = proceso?.contrato ?? {};
      const antecedentes: any[] = Array.isArray(proceso?.antecedentes) ? proceso.antecedentes : [];

      const norm = (v: any) => String(v ?? '').trim().toUpperCase();
      const findAnte = (nombre: string) => antecedentes.find(a => norm(a?.nombre) === norm(nombre));

      const eps = String(findAnte('EPS')?.observacion ?? '');
      const afp = String(findAnte('AFP')?.observacion ?? '');

      const mapEstadoCivil = (code: any): string => {
        const c = norm(code);
        if (c === 'SO' || c === 'SOLTERO' || c === 'S') return 'SO';
        if (c === 'CA' || c === 'CASADO') return 'CA';
        if (c === 'UN' || c === 'UL' || c === 'UNION LIBRE' || c === 'UNIÓN LIBRE') return 'UN';
        if (c === 'SE' || c === 'SEP' || c === 'SEPARADO') return 'SE';
        if (c === 'VI' || c === 'VIUDO') return 'VI';
        return c || '';
      };

      const nombreCompleto = [
        cand.primer_nombre,
        cand.segundo_nombre,
        cand.primer_apellido,
        cand.segundo_apellido,
      ]
        .map((x: any) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' ');

      let codigoGenerado = String(contrato?.codigo_contrato ?? proceso?.contrato_codigo ?? '').trim();
      const codigoContratoRes = await this.promptCodigoContrato(codigoGenerado);
      if (codigoContratoRes === null) {
        Swal.close();
        return;
      }
      const codigoContrato = codigoContratoRes;

      const fechaIngreso = String(vac?.fechadeIngreso ?? '').trim();
      const salario = vac?.salario ?? proceso?.vacante_salario ?? '';

      const formacion0: any = Array.isArray(cand.formaciones) ? cand.formaciones[0] : null;
      const exp0: any = Array.isArray(cand.experiencias) ? cand.experiencias[0] : null;

      const dv: any = {
        primer_apellido: cand.primer_apellido ?? '',
        segundo_apellido: cand.segundo_apellido ?? '',
        primer_nombre: cand.primer_nombre ?? '',
        segundo_nombre: cand.segundo_nombre ?? '',

        tipodedocumento: cand.tipo_doc ?? '',
        numerodeceduladepersona: cand.numero_documento ?? '',

        fecha_expedicion_cc: infoCc?.fecha_expedicion ?? '',
        departamento_expedicion_cc: infoCc?.depto_expedicion ?? '',
        municipio_expedicion_cc: infoCc?.mpio_expedicion ?? '',

        genero: cand.sexo ?? '',
        fecha_nacimiento: cand.fecha_nacimiento ?? '',
        lugar_nacimiento_departamento: infoCc?.depto_nacimiento ?? '',
        lugar_nacimiento_municipio: infoCc?.mpio_nacimiento ?? '',

        estado_civil: mapEstadoCivil(cand.estado_civil),

        direccion_residencia: residencia?.direccion ?? '',
        barrio: residencia?.barrio ?? '',
        municipio: (vac?.municipio?.[0] ?? entrevista?.oficina ?? '').toString(),
        departamento: '',

        celular: contacto?.celular ?? '',
        primercorreoelectronico: contacto?.email ?? '',

        rh: cand.rh ?? '',
        zurdo_diestro: cand.zurdo_diestro ?? '',

        escolaridad: formacion0?.nivel ?? '',
        nombre_institucion: formacion0?.institucion ?? '',
        titulo_obtenido: formacion0?.titulo_obtenido ?? '',
        ano_finalizacion: formacion0?.anio_finalizacion ?? '',

        nombre_expe_laboral1_empresa: exp0?.empresa ?? '',
        direccion_empresa1: exp0?.direccion ?? '',
        telefonos_empresa1: exp0?.telefonos ?? '',
        nombre_jefe_empresa1: exp0?.nombre_jefe ?? '',
        cargo_empresa1: exp0?.cargo ?? '',
        fecha_retiro_empresa1: exp0?.fecha_retiro ?? '',
        motivo_retiro_empresa1: exp0?.motivo_retiro ?? '',
      };

      const ds: any = {
        fechaIngreso,
        salario,
        eps,
        afp,
        cesantias: entrevista?.proceso?.contrato?.cesantias ?? '',
        cargo: vac?.cargo ?? '',
        centro_costo_entrevista: entrevista?.oficina ?? '',
        empresa_usuario: vac?.empresaUsuariaSolicita ?? '',
      };

      // =========================================================
      // 2) Cargar PDF base y setear campos
      // =========================================================
      const pdfUrl = 'Docs/FICHA FORANEOS TU ALIANZA.pdf';
      const arrayBuffer = await this.fetchAsArrayBufferOrNull(pdfUrl);
      if (!arrayBuffer) throw new Error('No se pudo cargar el PDF base.');

      const pdfDoc = await PDFDocument.load(arrayBuffer);
      pdfDoc.registerFontkit(fontkit as any);

      const fontBytes = await this.fetchAsArrayBufferOrNull('fonts/Roboto-Regular.ttf');
      const customFont = fontBytes ? await pdfDoc.embedFont(fontBytes) : undefined;

      const form = pdfDoc.getForm();
      try { this.setText(form, 'codigo_contrato', this.safe(codigoContrato), customFont); } catch (e) { }
      // La plantilla trae el campo `oficina` y nadie lo llenaba: sale la oficina
      // de quien está generando el documento, sin el guion bajo del código.
      this.setText(form, 'oficina', this.safe(this.oficinaUsuarioImpresa), customFont);

      // ✅ Imagen: nunca se voltea, siempre vertical
      await setButtonImageSafe(pdfDoc, form, 'Imagen1_af_image', this.foto, { forcePortrait: true });

      this.setText(form, '1er Apellido', this.safe(dv.primer_apellido), customFont);
      this.setText(form, '2do apellido', this.safe(dv.segundo_apellido), customFont);
      this.setText(
        form,
        'Nombres',
        [this.safe(dv.primer_nombre), this.safe(dv.segundo_nombre)].filter(Boolean).join(' '),
        customFont
      );
      this.setText(form, 'num-identificacion', this.safe(dv.numerodeceduladepersona), customFont);
      this.setText(form, 'No de Hijos', this.safe(datoContratacion?.num_hijos_dependen_economicamente ?? ''), customFont);
      this.setText(form, 'Email', this.safe(datoContratacion?.primercorreoelectronico), customFont);

      // helpers
      const pickText = (...vals: any[]) => {
        for (const v of vals) {
          const t = this.safe(v).trim();
          if (t) return t;
        }
        return '';
      };

      const pickDateDDMM = (...vals: any[]) => {
        for (const v of vals) {
          const d = this.parseDateToDDMMYYYY(v);
          const t = this.safe(d).trim();
          if (t) return t;
        }
        return '';
      };

      // Fecha y lugar de Expedición
      const expFecha = pickDateDDMM(dv?.fecha_expedicion_cc, datoContratacion?.fecha_expedicion_cc);
      const expLugar = pickText(dv?.municipio_expedicion_cc, datoContratacion?.municipio_expedicion_cc);

      this.setText(
        form,
        'Fecha y lugar de Expediciòn',
        [expFecha, expLugar].filter(Boolean).join(' '),
        customFont
      );

      // Fecha y lugar de Nacimiento
      const nacFecha = pickDateDDMM(dv?.fecha_nacimiento, datoContratacion?.fecha_nacimiento);
      const nacLugar = pickText(dv?.lugar_nacimiento_municipio, datoContratacion?.lugar_nacimiento_municipio);

      this.setText(
        form,
        'Fecha y lugar de Nacimiento',
        [nacFecha, nacLugar].filter(Boolean).join(' '),
        customFont
      );

      // Dirección
      this.setText(
        form,
        'Dirección',
        pickText(dv?.direccion_residencia, datoContratacion?.direccion_residencia),
        customFont
      );

      // Mun + Barrio
      const munVal = pickText(dv?.municipio, datoContratacion?.municipio);
      const barVal = pickText(dv?.barrio, datoContratacion?.barrio);
      this.setText(form, 'Mun Bar', [munVal, barVal].filter(Boolean).join(' - '), customFont);

      // Dies/Zurd
      this.setText(
        form,
        'DiesZurd',
        pickText(dv?.zurdo_diestro, datoContratacion?.zurdo_diestro),
        customFont
      );

      // RH
      this.setText(
        form,
        'RH',
        pickText(dv?.rh, datoContratacion?.rh),
        customFont
      );

      // PlanFunerario
      const siNo = this.candidato?.entrevistas?.[0]?.proceso?.contrato?.seguro_funerario ? 'SI' : 'NO';
      this.setText(form, 'PlanFunerario', `Desea afiliarse al plan funerario : ${siNo}`, customFont, 6);

      this.setText(form, 'Celular', this.safe(dv.celular), customFont);
      this.setText(form, 'Estado Civil', this.safe(dv.estado_civil), customFont);
      this.setText(form, 'Correo Electrónico', this.safe(dv.primercorreoelectronico), customFont);
      this.setText(form, 'EPS', this.safe(ds.eps), customFont);
      this.setText(form, 'AFP', this.safe(ds.afp), customFont);
      this.setText(form, 'AFC', this.safe(ds.cesantias ?? ''), customFont);

      // escolaridad
      this.setText(form, 'escolaridad', this.safe(datoContratacion?.escolaridad ?? ''), customFont);
      this.setText(form, 'Nombre de la Instit', this.safe(datoContratacion?.nombre_institucion ?? ''), customFont);
      this.setText(form, 'UniversidadAño Finalización', this.safe(datoContratacion?.ano_finalizacion ?? ''), customFont);
      this.setText(form, 'Titulo Obtenido o Ultimo Cursado', this.safe(datoContratacion?.titulo_obtenido ?? ''), customFont);

      // info familiar
      this.setText(form, 'Nombre y apellido padre', this.safe(datoContratacion?.nombre_padre ?? ''), customFont);
      this.setText(form, 'Vive', this.safe(datoContratacion?.vive_padre ?? ''), customFont);
      this.setText(form, 'Ocupación', this.safe(datoContratacion?.ocupacion_padre ?? ''), customFont);
      this.setText(form, 'Dirección_2', this.safe(datoContratacion?.direccion_padre ?? ''), customFont);
      this.setText(form, 'Teléfono', this.safe(datoContratacion?.telefono_padre ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio', this.safe(datoContratacion?.barrio_padre ?? ''), customFont);

      this.setText(form, 'Nombre y apellido madre', this.safe(datoContratacion?.nombre_madre ?? ''), customFont);
      this.setText(form, 'Vive_2', this.safe(datoContratacion?.vive_madre ?? ''), customFont);
      this.setText(form, 'Ocupación_2', this.safe(datoContratacion?.ocupacion_madre ?? ''), customFont);
      this.setText(form, 'Dirección_3', this.safe(datoContratacion?.direccion_madre ?? ''), customFont);
      this.setText(form, 'Teléfono_2', this.safe(datoContratacion?.telefono_madre ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio_2', this.safe(datoContratacion?.barrio_madre ?? ''), customFont);

      this.setText(
        form,
        'Nombreyapellidoconyuge',
        this.safe(`${datoContratacion?.nombre_conyugue ?? ''} ${datoContratacion?.apellido_conyugue ?? ''}`.trim()),
        customFont
      );
      this.setText(form, 'Ocupación_3', this.safe(datoContratacion?.ocupacion_conyugue ?? ''), customFont);
      this.setText(form, 'Dirección_4', this.safe(datoContratacion?.direccion_conyugue ?? ''), customFont);
      this.setText(form, 'Teléfono_3', this.safe(datoContratacion?.telefono_conyugue ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio_3', this.safe(datoContratacion?.barrio_municipio_conyugue ?? ''), customFont);

      this.setText(form, 'Familiar en caso de Emergencia', this.safe(datoContratacion?.familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Parentesco', this.safe(datoContratacion?.parentesco_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Ocupación_4', this.safe(datoContratacion?.ocupacion_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Dirección_5', this.safe(datoContratacion?.direccion_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Teléfono_4', this.safe(datoContratacion?.telefono_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio_4', this.safe(datoContratacion?.barrio_familiar_emergencia ?? ''), customFont);

      const hijos = Array.isArray(datoContratacion?.hijos) ? datoContratacion!.hijos : [];

      const parseYmd = (ymd: string) => {
        const [y, m, d] = ymd.split('-').map(n => Number(n));
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d);
      };
      const formatDate = (ymd: string) => {
        const dt = parseYmd(ymd);
        if (!dt) return '';
        const dd = String(dt.getDate()).padStart(2, '0');
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const yyyy = dt.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };
      const calcAge = (ymd: string) => {
        const birth = parseYmd(ymd);
        if (!birth) return '';
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age < 0 ? '' : String(age);
      };

      for (let i = 0; i < 5; i++) {
        const idx = i + 1;
        const h = hijos[i] ?? {};

        const nombre = norm((h as any).nombre);
        const sexo = norm((h as any).sexo);
        const fechaRaw = String((h as any).fecha_nacimiento ?? '').trim();
        const noDoc = norm((h as any).no_documento);
        const ocupacion = norm((h as any).estudia_o_trabaja);
        const curso = norm((h as any).curso);

        this.setText(form, `nombre_hijo_${idx}`, this.safe(nombre), customFont);
        this.setText(form, `fecha_nac_hijo_${idx}`, this.safe(formatDate(fechaRaw)), customFont);
        this.setText(form, `no_iden_hijo_${idx}`, this.safe(noDoc), customFont);
        this.setText(form, `sexo_hijo_${idx}`, this.safe(sexo), customFont);
        this.setText(form, `edad_hijo_${idx}`, this.safe(calcAge(fechaRaw)), customFont);
        this.setText(form, `ocupacion_hijo_${idx}`, this.safe(ocupacion), customFont);
        this.setText(form, `curso_hijo_${idx}`, this.safe(curso), customFont);
      }

      this.setText(form, 'TALLA CHAQUETA', this.safe(datoContratacion.chaqueta ?? ''), customFont);
      this.setText(form, 'TALLA PANTALON', this.safe(datoContratacion.pantalon ?? ''), customFont);
      this.setText(form, 'TALLA OVEROL', this.safe(datoContratacion.camisa ?? ''), customFont);
      this.setText(form, 'No calzado', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Botas de Caucho', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Zapatones', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Botas Material', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Botas Material', this.safe(datoContratacion.calzado ?? ''), customFont);

      this.setText(form, 'Nombre Empresa', this.safe(datoContratacion.nombre_expe_laboral1_empresa ?? ''), customFont);
      this.setText(form, 'Dirección Empresa', this.safe(datoContratacion.direccion_empresa1 ?? ''), customFont);
      this.setText(form, 'Teléfonos', this.safe(datoContratacion.telefonos_empresa1 ?? ''), customFont);
      this.setText(form, 'Jefe Inmediato', this.safe(datoContratacion.nombre_jefe_empresa1 ?? ''), customFont);
      this.setText(form, 'Cargo', this.safe(datoContratacion.cargo_empresa1 ?? ''), customFont);
      this.setText(form, 'F de Retiro', this.safe(datoContratacion.fecha_retiro_empresa1 ?? ''), customFont);
      this.setText(
        form,
        'motivoretiro',
        this.safe(`Motivo de retiro: ${datoContratacion?.motivo_retiro_empresa1 ?? ''}`),
        customFont
      );

      // referencias personales
      this.setText(form, '1', this.safe(datoContratacion.nombre_referencia_personal1 ?? ''), customFont);
      this.setText(form, 'Teléfonos1', this.safe(datoContratacion.telefono_referencia_personal1 ?? ''), customFont);
      this.setText(form, 'Ocupación1', this.safe(datoContratacion.ocupacion_referencia_personal1 ?? ''), customFont);

      this.setText(form, '2', this.safe(datoContratacion.nombre_referencia_personal2 ?? ''), customFont);
      this.setText(form, 'Teléfonos2', this.safe(datoContratacion.telefono_referencia_personal2 ?? ''), customFont);
      this.setText(form, 'Ocupación2', this.safe(datoContratacion.ocupacion_referencia_personal2 ?? ''), customFont);

      // referencias familiares
      this.setText(form, '1_2', this.safe(datoContratacion.nombre_referencia_familiar1 ?? ''), customFont);
      this.setText(form, 'Teléfonos1_2', this.safe(datoContratacion.telefono_referencia_familiar1 ?? ''), customFont);
      this.setText(form, 'Ocupación1_2', this.safe(datoContratacion.ocupacion_referencia_familiar1 ?? ''), customFont);

      this.setText(form, '2_2', this.safe(datoContratacion.nombre_referencia_familiar2 ?? ''), customFont);
      this.setText(form, 'Teléfonos2_2', this.safe(datoContratacion.telefono_referencia_familiar2 ?? ''), customFont);
      this.setText(form, 'Ocupación2_2', this.safe(datoContratacion.ocupacion_referencia_familiar2 ?? ''), customFont);

      // Fallback al modelo nuevo (gestion_contratacion) cuando `datoContratacion`
      // legacy no tenga el dato — necesario porque el endpoint legacy a veces solo
      // retorna 1 referencia familiar y dejaba la segunda fila vacía.
      const refsModelo = Array.isArray(cand.referencias) ? cand.referencias : [];
      // PERSONAL/PERSONAL1/PERSONAL2 y FAMILIAR/FAMILIAR1/FAMILIAR2 conviven en
      // BD; comparar por igualdad exacta dejaba vacías las de los recientes.
      const { personales: refsP_modelo, familiares: refsF_modelo } = separarReferencias(refsModelo);

      this.setText(form, 'nombre-referencia-peronal1', this.safe(datoContratacion.nombre_referencia_personal1 || refsP_modelo[0]?.nombre || ''), customFont);
      this.setText(form, 'nombre-referencia-peronal2', this.safe(datoContratacion.nombre_referencia_personal2 || refsP_modelo[1]?.nombre || ''), customFont);
      this.setText(form, 'nombre-referencia-familiar1', this.safe(datoContratacion.nombre_referencia_familiar1 || refsF_modelo[0]?.nombre || ''), customFont);
      this.setText(form, 'nombre-referencia-familiar2', this.safe(datoContratacion.nombre_referencia_familiar2 || refsF_modelo[1]?.nombre || ''), customFont);

      // aleatorios descripciones (robusto y sin repetidos en el par)
      const normalize = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ');

      const pickTwoDistinct = (arr: readonly string[]): [string, string] => {
        const unique = Array.from(new Set((arr ?? []).map(normalize).filter(v => v.length > 0)));
        if (unique.length === 0) return ['', ''];
        if (unique.length === 1) return [unique[0], ''];
        const i = Math.floor(Math.random() * unique.length);
        const j = (i + 1 + Math.floor(Math.random() * (unique.length - 1))) % unique.length;
        return [unique[i], unique[j]];
      };

      const [personal1, personal2] = pickTwoDistinct(this.referenciasA);
      this.setText(form, 'descripcion-personal1', personal1, customFont);
      this.setText(form, 'descripcion-personal2', personal2, customFont);

      const [familiar1, familiar2] = pickTwoDistinct(this.referenciasF);
      this.setText(form, 'descripcion-familiar1', familiar1, customFont);
      this.setText(form, 'descripcion-familiar2', familiar2, customFont);
      // Parentesco con fallback al modelo nuevo. Una sola escritura por campo
      // (antes había duplicados que se pisaban entre sí).
      this.setText(form, 'parentesco_familiar_1', this.safe(datoContratacion.parentesco_referencia_familiar1 || datoContratacion.parentesco_familiar_1 || refsF_modelo[0]?.parentesco || '').toUpperCase(), customFont);
      this.setText(form, 'parentesco_familiar_2', this.safe(datoContratacion.parentesco_referencia_familiar2 || datoContratacion.parentesco_familiar_2 || refsF_modelo[1]?.parentesco || '').toUpperCase(), customFont);
      // descripcion-laboral1 en este tengo que dejar la info de 
      const descripcionLaboral1Str = [
        exp0?.empresa,
        exp0?.tiempo_trabajado,
        exp0?.labores_realizadas,
        exp0?.labores_principales
      ].filter(x => !!String(x || '').trim()).join(' - ');
      this.setText(form, 'descripcion-laboral1', this.safe(descripcionLaboral1Str), customFont);

      // firmado
      console.log('Usuario que firma ficha técnica Tu Alianza:', this.nombreCompletoLogin);
      console.log('Cédula usuario que firma ficha técnica Tu Alianza:', this.cedulaPersonalAdministrativo);
      this.setText(
        form,
        'fimado',
        `C.C. ${this.safe(this.cedulaPersonalAdministrativo)} ${this.nombreCompletoLogin}`,
        customFont
      );

      // Bloquear campos
      aplanarFormulario(form);

      // Guardar PDF
      const pdfBytes = await pdfDoc.save();
      const ab = this.toSafeArrayBuffer(pdfBytes);
      const file = new File([ab], 'Ficha tecnica.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Ficha Técnica'] = { file, fileName: 'Ficha tecnica.pdf' };
      this.verPDF({ titulo: 'Ficha Técnica' });
    } catch (error) {
      console.error('Error generando ficha técnica:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar la ficha técnica.' });
    }
  }


  async generarFichaTecnicaTuAlianzaCompleta() {
    let datoContratacion: any = {};

    try {
      // =========================================================
      // 0) ESPERAR a que llegue la contratación ANTES de continuar
      // =========================================================
      const numeroDoc = String(this.candidato?.numero_documento ?? '').trim();
      if (!numeroDoc) throw new Error('El candidato no tiene número de documento.');

      const respContratacion: any = await firstValueFrom(
        this.contratacionService.buscarEncontratacion(numeroDoc).pipe(
          take(1),
          catchError((err) => {
            console.error('Error buscando contratación:', err);
            return of({ data: [] });
          })
        )
      );

      console.log('Datos de contratación recibidos:', respContratacion);
      datoContratacion = respContratacion?.data?.[0] ?? {};
      console.log('Dato de contratación para ficha técnica Tu Alianza:', datoContratacion);

      // =========================================================
      // 0) Helpers de imagen (PDF-lib) - robustos como en jsPDF
      // =========================================================
      const bytesCache = new Map<string, Promise<ArrayBuffer | null>>();

      const isHttp = (u: string) => /^https?:\/\//i.test(u);
      const isDataUrl = (u: string) => /^data:image\//i.test(u);

      const normalizeUrl = (u: string) => {
        const s = String(u ?? '').trim();
        if (!s) return '';
        if (isHttp(s) || isDataUrl(s)) return s;

        const clean = s.replace(/^\/+/, '');
        if (clean.startsWith('assets/')) return clean;

        return `assets/${clean}`;
      };

      const dataUrlToBytes = (dataUrl: string): ArrayBuffer | null => {
        try {
          const [meta, b64] = dataUrl.split(',');
          if (!meta || !b64) return null;
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        } catch {
          return null;
        }
      };

      const detectImageType = (ab: ArrayBuffer): 'png' | 'jpg' | null => {
        const b = new Uint8Array(ab);
        if (
          b.length >= 8 &&
          b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
          b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A
        ) return 'png';

        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';

        return null;
      };

      const fetchBytesOrNull = async (urlOrData?: string): Promise<ArrayBuffer | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;

        if (isDataUrl(raw)) return dataUrlToBytes(raw);

        const url = normalizeUrl(raw);
        if (!url) return null;

        if (bytesCache.has(url)) return await bytesCache.get(url)!;

        const p = (async () => {
          try {
            const ab = await this.fetchAsArrayBufferOrNull(url);
            if (ab) return ab;
          } catch { }

          if (!isHttp(raw) && !raw.startsWith('assets/') && !isDataUrl(raw)) {
            try {
              const ab2 = await this.fetchAsArrayBufferOrNull(raw);
              if (ab2) return ab2;
            } catch { }
          }

          return null;
        })();

        bytesCache.set(url, p);
        return await p;
      };

      const embedImageOrNull = async (pdfDoc: PDFDocument, urlOrData?: string) => {
        const ab = await fetchBytesOrNull(urlOrData);
        if (!ab) return null;

        const kind = detectImageType(ab);
        if (!kind) return null;

        try {
          const u8 = new Uint8Array(ab);
          return kind === 'png' ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
        } catch {
          return null;
        }
      };

      const setButtonImageSafe = async (
        pdfDoc: PDFDocument,
        form: any,
        buttonName: string,
        urlOrData?: string
      ) => {
        const img = await embedImageOrNull(pdfDoc, urlOrData);
        if (!img) return false;
        // Se DIBUJA en la página en vez de `setImage`: así la imagen sobrevive
        // al copiar estas páginas a otro PDF. Ver pdf-aplanado.util.ts.
        return dibujarImagenPlana(pdfDoc, form, buttonName, img);
      };

      // =========================================================
      // 1) Normalización desde this.candidato y this.vacante
      // =========================================================
      const cand: any = this.candidato ?? {};
      console.log('Candidato para ficha técnica Tu Alianza:', cand);
      const vac: any = this.vacante ?? {};
      console.log('Vacante para ficha técnica Tu Alianza:', vac);

      const contacto: any = cand.contacto ?? {};
      const residencia: any = cand.residencia ?? {};
      const infoCc: any = cand.info_cc ?? {};

      const entrevista: any = Array.isArray(cand.entrevistas) ? cand.entrevistas[0] : null;
      const proceso: any = entrevista?.proceso ?? {};
      const contrato: any = proceso?.contrato ?? {};
      const antecedentes: any[] = Array.isArray(proceso?.antecedentes) ? proceso.antecedentes : [];

      const norm = (v: any) => String(v ?? '').trim().toUpperCase();
      const findAnte = (nombre: string) => antecedentes.find(a => norm(a?.nombre) === norm(nombre));

      const eps = String(findAnte('EPS')?.observacion ?? '');
      const afp = String(findAnte('AFP')?.observacion ?? '');

      const mapEstadoCivil = (code: any): string => {
        const c = norm(code);
        if (c === 'SO' || c === 'SOLTERO' || c === 'S') return 'SO';
        if (c === 'CA' || c === 'CASADO') return 'CA';
        if (c === 'UN' || c === 'UL' || c === 'UNION LIBRE' || c === 'UNIÓN LIBRE') return 'UN';
        if (c === 'SE' || c === 'SEP' || c === 'SEPARADO') return 'SE';
        if (c === 'VI' || c === 'VIUDO') return 'VI';
        return c || '';
      };

      const nombreCompleto = [
        cand.primer_nombre,
        cand.segundo_nombre,
        cand.primer_apellido,
        cand.segundo_apellido,
      ]
        .map((x: any) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' ');

      let codigoGenerado = String(contrato?.codigo_contrato ?? proceso?.contrato_codigo ?? '').trim();
      const codigoContratoRes = await this.promptCodigoContrato(codigoGenerado);
      if (codigoContratoRes === null) {
        Swal.close();
        return;
      }
      const codigoContrato = codigoContratoRes;

      const fechaIngreso = String(vac?.fechadeIngreso ?? '').trim();
      const salario = vac?.salario ?? proceso?.vacante_salario ?? '';

      const formacion0: any = Array.isArray(cand.formaciones) ? cand.formaciones[0] : null;
      const exp0: any = Array.isArray(cand.experiencias) ? cand.experiencias[0] : null;

      const dv: any = {
        primer_apellido: cand.primer_apellido ?? '',
        segundo_apellido: cand.segundo_apellido ?? '',
        primer_nombre: cand.primer_nombre ?? '',
        segundo_nombre: cand.segundo_nombre ?? '',

        tipodedocumento: cand.tipo_doc ?? '',
        numerodeceduladepersona: cand.numero_documento ?? '',

        fecha_expedicion_cc: infoCc?.fecha_expedicion ?? '',
        departamento_expedicion_cc: infoCc?.depto_expedicion ?? '',
        municipio_expedicion_cc: infoCc?.mpio_expedicion ?? '',

        genero: cand.sexo ?? '',
        fecha_nacimiento: cand.fecha_nacimiento ?? '',
        lugar_nacimiento_departamento: infoCc?.depto_nacimiento ?? '',
        lugar_nacimiento_municipio: infoCc?.mpio_nacimiento ?? '',

        estado_civil: mapEstadoCivil(cand.estado_civil),

        direccion_residencia: residencia?.direccion ?? '',
        barrio: residencia?.barrio ?? '',
        municipio: (vac?.municipio?.[0] ?? entrevista?.oficina ?? '').toString(),
        departamento: '',

        celular: contacto?.celular ?? '',
        primercorreoelectronico: contacto?.email ?? '',

        rh: cand.rh ?? '',
        zurdo_diestro: cand.zurdo_diestro ?? '',

        escolaridad: formacion0?.nivel ?? '',
        nombre_institucion: formacion0?.institucion ?? '',
        titulo_obtenido: formacion0?.titulo_obtenido ?? '',
        ano_finalizacion: formacion0?.anio_finalizacion ?? '',

        nombre_expe_laboral1_empresa: exp0?.empresa ?? '',
        direccion_empresa1: exp0?.direccion ?? '',
        telefonos_empresa1: exp0?.telefonos ?? '',
        nombre_jefe_empresa1: exp0?.nombre_jefe ?? '',
        cargo_empresa1: exp0?.cargo ?? '',
        fecha_retiro_empresa1: exp0?.fecha_retiro ?? '',
        motivo_retiro_empresa1: exp0?.motivo_retiro ?? '',
      };

      const ds: any = {
        fechaIngreso,
        salario,
        eps,
        afp,
        cesantias: entrevista.proceso?.contrato?.cesantias ?? '',
        cargo: vac?.cargo ?? '',
        centro_costo_entrevista: entrevista?.oficina ?? '',
        empresa_usuario: vac?.empresaUsuariaSolicita ?? '',
      };

      // =========================================================
      // 2) Cargar PDF base y setear campos
      // =========================================================
      const pdfUrl = 'Docs/FICHA FORANEOS TU ALIANZA COMPLETA.pdf';
      const arrayBuffer = await this.fetchAsArrayBufferOrNull(pdfUrl);
      if (!arrayBuffer) throw new Error('No se pudo cargar el PDF base.');

      const pdfDoc = await PDFDocument.load(arrayBuffer);
      pdfDoc.registerFontkit(fontkit as any);

      const fontBytes = await this.fetchAsArrayBufferOrNull('fonts/Roboto-Regular.ttf');
      const customFont = fontBytes ? await pdfDoc.embedFont(fontBytes) : undefined;

      const form = pdfDoc.getForm();
      try { this.setText(form, 'codigo_contrato', this.safe(codigoContrato), customFont); } catch (e) { }
      // Mismo campo `oficina` que la ficha Tu Alianza básica.
      this.setText(form, 'oficina', this.safe(this.oficinaUsuarioImpresa), customFont);

      // Imagen1_af_image — la foto se endereza antes de entrar, porque este
      // `setButtonImageSafe` no recibe opciones (a diferencia del de la ficha
      // Tu Alianza Completa, que ya usa forcePortrait).
      await setButtonImageSafe(
        pdfDoc, form, 'Imagen1_af_image',
        (await this.fotoAlDerechoDataUrl(this.foto)) ?? this.foto,
      );

      this.setText(form, '1er Apellido', this.safe(dv.primer_apellido), customFont);
      this.setText(form, '2do apellido', this.safe(dv.segundo_apellido), customFont);
      this.setText(
        form,
        'Nombres',
        [this.safe(dv.primer_nombre), this.safe(dv.segundo_nombre)].filter(Boolean).join(' '),
        customFont
      );
      // num-identificacion
      this.setText(form, 'num-identificacion', this.safe(dv.numerodeceduladepersona), customFont);
      // No de Hijos
      this.setText(form, 'No de Hijos', this.safe(datoContratacion?.num_hijos_dependen_economicamente ?? ''), customFont);
      // primercorreoelectronico
      this.setText(form, 'Email', this.safe(datoContratacion?.primercorreoelectronico), customFont);

      // helpers
      const pickText = (...vals: any[]) => {
        for (const v of vals) {
          const t = this.safe(v).trim();
          if (t) return t;
        }
        return '';
      };

      const pickDateDDMM = (...vals: any[]) => {
        for (const v of vals) {
          const d = this.parseDateToDDMMYYYY(v);
          const t = this.safe(d).trim();
          if (t) return t;
        }
        return '';
      };

      // ===============================
      // Fecha y lugar de Expedición
      // ===============================
      const expFecha = pickDateDDMM(dv?.fecha_expedicion_cc, datoContratacion?.fecha_expedicion_cc);
      const expLugar = pickText(dv?.municipio_expedicion_cc, datoContratacion?.municipio_expedicion_cc);

      this.setText(
        form,
        'Fecha y lugar de Expediciòn',
        [expFecha, expLugar].filter(Boolean).join(' '),
        customFont
      );

      // ===============================
      // Fecha y lugar de Nacimiento
      // ===============================
      const nacFecha = pickDateDDMM(dv?.fecha_nacimiento, datoContratacion?.fecha_nacimiento);
      const nacLugar = pickText(dv?.lugar_nacimiento_municipio, datoContratacion?.lugar_nacimiento_municipio);

      this.setText(
        form,
        'Fecha y lugar de Nacimiento',
        [nacFecha, nacLugar].filter(Boolean).join(' '),
        customFont
      );

      // Dirección (dv si tiene contenido; si no, candidato)
      this.setText(
        form,
        'Dirección',
        pickText(dv?.direccion_residencia, datoContratacion?.direccion_residencia),
        customFont
      );


      // Mun + Barrio: fallback por campo (dv->candidato) y luego une
      const munVal = pickText(dv?.municipio, datoContratacion?.municipio);
      const barVal = pickText(dv?.barrio, datoContratacion?.barrio);
      this.setText(form, 'Mun Bar', [munVal, barVal].filter(Boolean).join(' - '), customFont);

      // Dies/Zurd (dv si no está vacío; si no, candidato)
      this.setText(
        form,
        'DiesZurd',
        pickText(dv?.zurdo_diestro, datoContratacion?.zurdo_diestro),
        customFont
      );

      // RH (dv si no está vacío; si no, candidato)
      this.setText(
        form,
        'RH',
        pickText(dv?.rh, datoContratacion?.rh),
        customFont
      );


      // PlanFunerario
      const siNo = this.candidato?.entrevistas?.[0]?.proceso?.contrato?.seguro_funerario ? 'SI' : 'NO';

      this.setText(
        form,
        'PlanFunerario',
        `Desea afiliarse al plan funerario : ${siNo}`,
        customFont,
        6
      );

      this.setText(form, 'Celular', this.safe(dv.celular), customFont);
      this.setText(form, 'Estado Civil', this.safe(dv.estado_civil), customFont);
      this.setText(form, 'Correo Electrónico', this.safe(dv.primercorreoelectronico), customFont);
      this.setText(form, 'EPS', this.safe(ds.eps), customFont);
      this.setText(form, 'AFP', this.safe(ds.afp), customFont);
      this.setText(form, 'AFC', this.safe(ds.cesantias ?? ''), customFont);

      // escolaridad
      this.setText(form, 'escolaridad', this.safe(datoContratacion?.escolaridad ?? ''), customFont);
      this.setText(form, 'Nombre de la Instit', this.safe(datoContratacion?.nombre_institucion ?? ''), customFont);
      this.setText(form, 'UniversidadAño Finalización', this.safe(datoContratacion?.ano_finalizacion ?? ''), customFont);
      this.setText(form, 'Titulo Obtenido o Ultimo Cursado', this.safe(datoContratacion?.titulo_obtenido ?? ''), customFont);

      // info familiar
      this.setText(form, 'Nombre y apellido padre', this.safe(datoContratacion?.nombre_padre ?? ''), customFont);
      this.setText(form, 'Vive', this.safe(datoContratacion?.vive_padre ?? ''), customFont);
      this.setText(form, 'Ocupación', this.safe(datoContratacion?.ocupacion_padre ?? ''), customFont);
      this.setText(form, 'Dirección_2', this.safe(datoContratacion?.direccion_padre ?? ''), customFont);
      this.setText(form, 'Teléfono', this.safe(datoContratacion?.telefono_padre ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio', this.safe(datoContratacion?.barrio_padre ?? ''), customFont);

      this.setText(form, 'Nombre y apellido madre', this.safe(datoContratacion?.nombre_madre ?? ''), customFont);
      this.setText(form, 'Vive_2', this.safe(datoContratacion?.vive_madre ?? ''), customFont);
      this.setText(form, 'Ocupación_2', this.safe(datoContratacion?.ocupacion_madre ?? ''), customFont);
      this.setText(form, 'Dirección_3', this.safe(datoContratacion?.direccion_madre ?? ''), customFont);
      this.setText(form, 'Teléfono_2', this.safe(datoContratacion?.telefono_madre ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio_2', this.safe(datoContratacion?.barrio_madre ?? ''), customFont);

      this.setText(
        form,
        'Nombreyapellidoconyuge',
        this.safe(`${datoContratacion?.nombre_conyugue ?? ''} ${datoContratacion?.apellido_conyugue ?? ''}`.trim()),
        customFont
      );
      this.setText(form, 'Ocupación_3', this.safe(datoContratacion?.ocupacion_conyugue ?? ''), customFont);
      this.setText(form, 'Dirección_4', this.safe(datoContratacion?.direccion_conyugue ?? ''), customFont);
      this.setText(form, 'Teléfono_3', this.safe(datoContratacion?.telefono_conyugue ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio_3', this.safe(datoContratacion?.barrio_municipio_conyugue ?? ''), customFont);

      this.setText(form, 'Familiar en caso de Emergencia', this.safe(datoContratacion?.familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Parentesco', this.safe(datoContratacion?.parentesco_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Ocupación_4', this.safe(datoContratacion?.ocupacion_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Dirección_5', this.safe(datoContratacion?.direccion_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'Teléfono_4', this.safe(datoContratacion?.telefono_familiar_emergencia ?? ''), customFont);
      this.setText(form, 'BarrioMunicipio_4', this.safe(datoContratacion?.barrio_familiar_emergencia ?? ''), customFont);


      const hijos = Array.isArray(datoContratacion?.hijos) ? datoContratacion!.hijos : [];

      const parseYmd = (ymd: string) => {
        // espera "YYYY-MM-DD"
        const [y, m, d] = ymd.split('-').map(n => Number(n));
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d); // local, evita desfases
      };
      const formatDate = (ymd: string) => {
        const dt = parseYmd(ymd);
        if (!dt) return '';
        const dd = String(dt.getDate()).padStart(2, '0');
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const yyyy = dt.getFullYear();
        return `${dd}/${mm}/${yyyy}`; // cambia si tu PDF quiere YYYY-MM-DD
      };
      const calcAge = (ymd: string) => {
        const birth = parseYmd(ymd);
        if (!birth) return '';
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age < 0 ? '' : String(age);
      };

      for (let i = 0; i < 5; i++) {
        const idx = i + 1;
        const h = hijos[i] ?? {};

        const nombre = norm((h as any).nombre);
        const sexo = norm((h as any).sexo);
        const fechaRaw = norm((h as any).fecha_nacimiento);
        const noDoc = norm((h as any).no_documento);
        const ocupacion = norm((h as any).estudia_o_trabaja);
        const curso = norm((h as any).curso);

        this.setText(form, `nombre_hijo_${idx}`, this.safe(nombre), customFont);
        this.setText(form, `fecha_nac_hijo_${idx}`, this.safe(formatDate(fechaRaw)), customFont);
        this.setText(form, `no_iden_hijo_${idx}`, this.safe(noDoc), customFont);
        this.setText(form, `sexo_hijo_${idx}`, this.safe(sexo), customFont);
        this.setText(form, `edad_hijo_${idx}`, this.safe(calcAge(fechaRaw)), customFont);
        this.setText(form, `ocupacion_hijo_${idx}`, this.safe(ocupacion), customFont);
        this.setText(form, `curso_hijo_${idx}`, this.safe(curso), customFont);
      }


      this.setText(form, 'TALLA CHAQUETA', this.safe(datoContratacion.chaqueta ?? ''), customFont);
      this.setText(form, 'TALLA PANTALON', this.safe(datoContratacion.pantalon ?? ''), customFont);
      this.setText(form, 'TALLA OVEROL', this.safe(datoContratacion.camisa ?? ''), customFont);
      this.setText(form, 'No calzado', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Botas de Caucho', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Zapatones', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Botas Material', this.safe(datoContratacion.calzado ?? ''), customFont);
      this.setText(form, 'No Botas Material', this.safe(datoContratacion.calzado ?? ''), customFont);

      this.setText(form, 'Nombre Empresa', this.safe(datoContratacion.nombre_expe_laboral1_empresa ?? ''), customFont);
      this.setText(form, 'Dirección Empresa', this.safe(datoContratacion.direccion_empresa1 ?? ''), customFont);
      this.setText(form, 'Teléfonos', this.safe(datoContratacion.telefonos_empresa1 ?? ''), customFont);
      this.setText(form, 'Jefe Inmediato', this.safe(datoContratacion.nombre_jefe_empresa1 ?? ''), customFont);
      this.setText(form, 'Cargo', this.safe(datoContratacion.cargo_empresa1 ?? ''), customFont);
      this.setText(form, 'F de Retiro', this.safe(datoContratacion.fecha_retiro_empresa1 ?? ''), customFont);
      // motivoretiro
      this.setText(
        form,
        'motivoretiro',
        this.safe(`Motivo de retiro: ${datoContratacion?.motivo_retiro_empresa1 ?? ''}`),
        customFont
      );

      // referencias personales
      this.setText(form, '1', this.safe(datoContratacion.nombre_referencia_personal1 ?? ''), customFont);
      this.setText(form, 'Teléfonos1', this.safe(datoContratacion.telefono_referencia_personal1 ?? ''), customFont);
      this.setText(form, 'Ocupación1', this.safe(datoContratacion.ocupacion_referencia_personal1 ?? ''), customFont);

      this.setText(form, '2', this.safe(datoContratacion.nombre_referencia_personal2 ?? ''), customFont);
      this.setText(form, 'Teléfonos2', this.safe(datoContratacion.telefono_referencia_personal2 ?? ''), customFont);
      this.setText(form, 'Ocupación2', this.safe(datoContratacion.ocupacion_referencia_personal2 ?? ''), customFont);

      // referencias familiares
      this.setText(form, '1_2', this.safe(datoContratacion.nombre_referencia_familiar1 ?? ''), customFont);
      this.setText(form, 'Teléfonos1_2', this.safe(datoContratacion.telefono_referencia_familiar1 ?? ''), customFont);
      this.setText(form, 'Ocupación1_2', this.safe(datoContratacion.ocupacion_referencia_familiar1 ?? ''), customFont);

      this.setText(form, '2_2', this.safe(datoContratacion.nombre_referencia_familiar2 ?? ''), customFont);
      this.setText(form, 'Teléfonos2_2', this.safe(datoContratacion.telefono_referencia_familiar2 ?? ''), customFont);
      this.setText(form, 'Ocupación2_2', this.safe(datoContratacion.ocupacion_referencia_familiar2 ?? ''), customFont);

      // Fallback al modelo nuevo (gestion_contratacion) cuando `datoContratacion`
      // legacy no tenga el dato — necesario porque el endpoint legacy a veces solo
      // retorna 1 referencia familiar y dejaba la segunda fila vacía.
      const refsModelo = Array.isArray(cand.referencias) ? cand.referencias : [];
      // PERSONAL/PERSONAL1/PERSONAL2 y FAMILIAR/FAMILIAR1/FAMILIAR2 conviven en
      // BD; comparar por igualdad exacta dejaba vacías las de los recientes.
      const { personales: refsP_modelo, familiares: refsF_modelo } = separarReferencias(refsModelo);

      this.setText(form, 'nombre-referencia-peronal1', this.safe(datoContratacion.nombre_referencia_personal1 || refsP_modelo[0]?.nombre || ''), customFont);
      this.setText(form, 'nombre-referencia-peronal2', this.safe(datoContratacion.nombre_referencia_personal2 || refsP_modelo[1]?.nombre || ''), customFont);
      this.setText(form, 'nombre-referencia-familiar1', this.safe(datoContratacion.nombre_referencia_familiar1 || refsF_modelo[0]?.nombre || ''), customFont);
      this.setText(form, 'nombre-referencia-familiar2', this.safe(datoContratacion.nombre_referencia_familiar2 || refsF_modelo[1]?.nombre || ''), customFont);

      // aleatorios descripciones (robusto y sin repetidos en el par)
      const normalize = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ');

      const pickTwoDistinct = (arr: readonly string[]): [string, string] => {
        // 1) Normaliza, limpia vacíos y elimina duplicados reales
        const unique = Array.from(
          new Set((arr ?? []).map(normalize).filter(v => v.length > 0))
        );

        // 2) Casos límite
        if (unique.length === 0) return ['', ''];
        if (unique.length === 1) return [unique[0], '']; // ✅ NUNCA repite

        // 3) Selección aleatoria sin while infinito
        const i = Math.floor(Math.random() * unique.length);
        const j = (i + 1 + Math.floor(Math.random() * (unique.length - 1))) % unique.length;

        return [unique[i], unique[j]];
      };

      const [personal1, personal2] = pickTwoDistinct(this.referenciasA);
      this.setText(form, 'descripcion-personal1', personal1, customFont);
      this.setText(form, 'descripcion-personal2', personal2, customFont);

      const [familiar1, familiar2] = pickTwoDistinct(this.referenciasF);
      this.setText(form, 'descripcion-familiar1', familiar1, customFont);
      this.setText(form, 'descripcion-familiar2', familiar2, customFont);
      this.setText(form, 'parentesco_familiar_1', this.safe(datoContratacion.parentesco_referencia_familiar1 || datoContratacion.parentesco_familiar_1 || refsF_modelo[0]?.parentesco || '').toUpperCase(), customFont);
      this.setText(form, 'parentesco_familiar_2', this.safe(datoContratacion.parentesco_referencia_familiar2 || datoContratacion.parentesco_familiar_2 || refsF_modelo[1]?.parentesco || '').toUpperCase(), customFont);
      // descripcion-laboral1 en este tengo que dejar la info de 
      const descripcionLaboral1Str = [
        exp0?.empresa,
        exp0?.tiempo_trabajado,
        exp0?.labores_realizadas,
        exp0?.labores_principales
      ].filter(x => !!String(x || '').trim()).join(' - ');
      this.setText(form, 'descripcion-laboral1', this.safe(descripcionLaboral1Str), customFont);
      this.setText(form, 'finca_a', this.centroCostoDoc, customFont);
      this.setText(form, 'nombres_y_apellidos', datoContratacion.primer_nombre + ' ' + datoContratacion.segundo_nombre + ' ' + datoContratacion.primer_apellido + ' ' + datoContratacion.segundo_apellido, customFont);
      this.setText(form, 'numero_identificacion', this.cedula, customFont);

      // URLs biometría (NO base64)
      const firmaUrl = cand?.biometria?.firma?.file_url ?? cand?.biometria?.firma?.file ?? '';
      const fotoUrl = cand?.biometria?.foto?.file_url ?? cand?.biometria?.foto?.file ?? '';
      const huellaUrl = cand?.biometria?.huella?.file_url ?? cand?.biometria?.huella?.file ?? '';

      await setButtonImageSafe(pdfDoc, form, 'firma', firmaUrl);
      await setButtonImageSafe(pdfDoc, form, 'huella', huellaUrl);


      if (this.firma !== '') {
        setButtonImageSafe(pdfDoc, form, 'firma', this.firma);
      } else {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se encontró la firma' });
        return;
      }


      this.setText(
        form,
        'fimado',
        `C.C. ${this.safe(this.cedulaPersonalAdministrativo)} ${this.nombreCompletoLogin}`,
        customFont
      );

      // Bloquear campos
      aplanarFormulario(form);

      // Guardar PDF
      const pdfBytes = await pdfDoc.save();
      const ab = this.toSafeArrayBuffer(pdfBytes);
      const file = new File([ab], 'Ficha tecnica.pdf', { type: 'application/pdf' });

      // Misma UI entry "Ficha Técnica"; typeId 111 override para que el backend
      // reciba el tipo "TA Completa" al subir. Pisa cualquier versión previa
      // (básica o completa anterior) — última gana.
      this.uploadedFiles['Ficha Técnica'] = { file, fileName: 'Ficha tecnica.pdf', typeId: 111 };
      this.verPDF({ titulo: 'Ficha Técnica' });
    } catch (error) {
      console.error('Error generando ficha técnica:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar la ficha técnica.' });
    }
  }


  // =========================================================
  // ENTREGA_CARNETS_FLORES_ANDES (typeId 95)
  // Template: Docs/entrega_carnets.pdf
  // Campos: Nombre Trabajador, numero_identificacion, firma_af_image, fecha_ingreso
  // =========================================================
  async generarEntregaCarnets() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};

      // ── Helpers locales de imagen (mismo patrón que generarFichaTecnicaTuAlianzaCompleta) ──
      const isDataUrl = (u: string) => /^data:image\//i.test(u);

      const dataUrlToBytes = (dataUrl: string): ArrayBuffer | null => {
        try {
          const [meta, b64] = dataUrl.split(',');
          if (!meta || !b64) return null;
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        } catch { return null; }
      };

      const detectImageType = (ab: ArrayBuffer): 'png' | 'jpg' | null => {
        const b = new Uint8Array(ab);
        if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
          b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'png';
        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
        return null;
      };

      const fetchBytesOrNull = async (urlOrData?: string): Promise<ArrayBuffer | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;
        if (isDataUrl(raw)) return dataUrlToBytes(raw);
        try { return await this.fetchAsArrayBufferOrNull(raw); } catch { return null; }
      };

      const embedImageOrNull = async (pdfDoc: PDFDocument, urlOrData?: string) => {
        const ab = await fetchBytesOrNull(urlOrData);
        if (!ab) return null;
        const kind = detectImageType(ab);
        if (!kind) return null;
        try {
          const u8 = new Uint8Array(ab);
          return kind === 'png' ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
        } catch { return null; }
      };

      const setButtonImageSafe = async (
        pdfDoc: PDFDocument, form: any, buttonName: string, urlOrData?: string
      ) => {
        const img = await embedImageOrNull(pdfDoc, urlOrData);
        if (!img) return false;
        // Se DIBUJA en la página en vez de `setImage`: así la imagen sobrevive
        // al copiar estas páginas a otro PDF. Ver pdf-aplanado.util.ts.
        return dibujarImagenPlana(pdfDoc, form, buttonName, img);
      };
      // ── Fin helpers ──

      // Nombre completo: apellidos luego nombres
      const nombreTrabajador = [
        cand.primer_apellido, cand.segundo_apellido,
        cand.primer_nombre, cand.segundo_nombre,
      ].map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' ').toUpperCase();

      const numIdentificacion = String(cand.numero_documento ?? '').trim();


      // fecha actual dd/mm/yyyy
      let fechaIngreso = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });


      // 1) Cargar PDF plantilla
      const pdfUrl = 'Docs/entrega_carnets.pdf';
      const arrayBuffer = await this.fetchAsArrayBufferOrNull(pdfUrl);
      if (!arrayBuffer) throw new Error('No se pudo cargar el PDF de entrega de carnets.');

      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const form = pdfDoc.getForm();

      // 2) Llenar campos de texto
      this.setText(form, 'Nombre Trabajador', nombreTrabajador);
      this.setText(form, 'numero_identificacion', numIdentificacion);
      this.setText(form, 'fecha_ingreso', fechaIngreso);

      // 3) Firma → botón de imagen
      await setButtonImageSafe(pdfDoc, form, 'firma_af_image', this.firma);
      await setButtonImageSafe(pdfDoc, form, 'firma_trabajador_af_image', this.firmaPersonalAdministrativo);

      // 4) Bloquear campos y guardar
      aplanarFormulario(form);

      const pdfBytes = await pdfDoc.save();
      const ab = this.toSafeArrayBuffer(pdfBytes);
      const file = new File([ab], 'Entrega_carnets.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Entrega Carnets'] = { file, fileName: 'Entrega_carnets.pdf' };
      this.verPDF({ titulo: 'Entrega Carnets' });
    } catch (error) {
      console.error('Error generando Entrega de Carnets:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar la Entrega de Carnets.' });
    }
  }


  // =========================================================
  // INDUCCION_CAPACITACION_FLORES_ANDES (typeId 96)
  // Template: Docs/induccion_capacitacion_andes.pdf
  // Campos: numero_documento, nombre_completo, fecha_ingreso, firma_af_image
  // =========================================================
  async generarInduccionCapacitacion() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};

      // ── Helpers locales de imagen (mismo patrón que generarFichaTecnicaTuAlianzaCompleta) ──
      const isDataUrl = (u: string) => /^data:image\//i.test(u);

      const dataUrlToBytes = (dataUrl: string): ArrayBuffer | null => {
        try {
          const [meta, b64] = dataUrl.split(',');
          if (!meta || !b64) return null;
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        } catch { return null; }
      };

      const detectImageType = (ab: ArrayBuffer): 'png' | 'jpg' | null => {
        const b = new Uint8Array(ab);
        if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
          b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'png';
        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
        return null;
      };

      const fetchBytesOrNull = async (urlOrData?: string): Promise<ArrayBuffer | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;
        if (isDataUrl(raw)) return dataUrlToBytes(raw);
        try { return await this.fetchAsArrayBufferOrNull(raw); } catch { return null; }
      };

      const embedImageOrNull = async (pdfDoc: PDFDocument, urlOrData?: string) => {
        const ab = await fetchBytesOrNull(urlOrData);
        if (!ab) return null;
        const kind = detectImageType(ab);
        if (!kind) return null;
        try {
          const u8 = new Uint8Array(ab);
          return kind === 'png' ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
        } catch { return null; }
      };

      const setButtonImageSafe = async (
        pdfDoc: PDFDocument, form: any, buttonName: string, urlOrData?: string
      ) => {
        const img = await embedImageOrNull(pdfDoc, urlOrData);
        if (!img) return false;
        // Se DIBUJA en la página en vez de `setImage`: así la imagen sobrevive
        // al copiar estas páginas a otro PDF. Ver pdf-aplanado.util.ts.
        return dibujarImagenPlana(pdfDoc, form, buttonName, img);
      };
      // ── Fin helpers ──

      const numeroDocumento = String(cand.numero_documento ?? '').trim();

      const nombreCompleto = [
        cand.primer_apellido, cand.segundo_apellido,
        cand.primer_nombre, cand.segundo_nombre,
      ].map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' ').toUpperCase();

      // Fecha de ingreso dd/mm/yyyy
      const fechaRaw = String(
        cand?.entrevistas?.[0]?.proceso?.contrato?.fecha_ingreso ?? ''
      ).trim();

      let fechaIngreso = '';

      if (fechaRaw) {
        const [year, month, day] = fechaRaw.split('-');
        fechaIngreso = `${day}/${month}/${year}`;
      }

      // 1) Cargar PDF plantilla
      const pdfUrl = 'Docs/induccion_capacitacion_andes.pdf';
      const arrayBuffer = await this.fetchAsArrayBufferOrNull(pdfUrl);
      if (!arrayBuffer) throw new Error('No se pudo cargar el PDF de inducción y capacitación.');

      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const form = pdfDoc.getForm();

      // 2) Llenar campos de texto (tamaño 12)
      this.setText(form, 'numero_documento', numeroDocumento, undefined, 12);
      this.setText(form, 'nombre_completo', nombreCompleto, undefined, 12);
      this.setText(form, 'fecha_ingreso', fechaIngreso, undefined, 12);

      // 3) Firma → botón de imagen
      await setButtonImageSafe(pdfDoc, form, 'firma_af_image', this.firma);
      await setButtonImageSafe(pdfDoc, form, 'firma_trabajador_af_image', this.firmaPersonalAdministrativo);

      // 4) Bloquear campos y guardar
      aplanarFormulario(form);

      const pdfBytes = await pdfDoc.save();
      const ab = this.toSafeArrayBuffer(pdfBytes);
      const file = new File([ab], 'Induccion_capacitacion.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Inducción Capacitación'] = { file, fileName: 'Induccion_capacitacion.pdf' };
      this.verPDF({ titulo: 'Inducción Capacitación' });
    } catch (error) {
      console.error('Error generando Inducción y Capacitación:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar la Inducción y Capacitación.' });
    }
  }


  // =========================================================
  // ✅ Imagen robusta (URL / base64 / dataURL / bytes)
  // =========================================================
  private isDataImageUrl(s: string): boolean {
    return /^data:image\/(png|jpe?g);base64,/i.test(s.trim());
  }

  private isLikelyUrl(s: string): boolean {
    const v = s.trim();
    return (
      /^https?:\/\//i.test(v) ||
      /^blob:/i.test(v) ||
      v.startsWith('/') ||
      v.startsWith('assets/') ||
      v.startsWith('Docs/')
    );
  }

  private isLikelyBase64(s: string): boolean {
    const v = s.trim();
    if (!v) return false;
    if (this.isLikelyUrl(v)) return false;
    if (v.includes('://') || v.includes('.') || v.includes('?') || v.includes('&')) return false;

    const clean = v.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=_-]+$/.test(clean)) return false;
    return clean.length > 80;
  }

  private normalizeBase64(b64: string): string {
    let s = (b64 ?? '').trim();

    const m = s.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/i);
    if (m?.[1]) s = m[1];

    s = s.replace(/\s+/g, '');
    s = s.replace(/-/g, '+').replace(/_/g, '/');

    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);

    return s;
  }


  // ==============================
  //  FORMATO SOLICITUD FLORES ANDES (typeId 97)
  // ==============================
  async generarFormatoSolicitud() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};

      // ── Helpers locales de imagen ──
      const isDataUrl = (u: string) => /^data:image\//i.test(u);

      const dataUrlToBytes = (dataUrl: string): ArrayBuffer | null => {
        try {
          const [meta, b64] = dataUrl.split(',');
          if (!meta || !b64) return null;
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          return bytes.buffer;
        } catch { return null; }
      };

      const detectImageType = (ab: ArrayBuffer): 'png' | 'jpg' | null => {
        const b = new Uint8Array(ab);
        if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
          b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'png';
        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
        return null;
      };

      const fetchBytesOrNull = async (urlOrData?: string): Promise<ArrayBuffer | null> => {
        const raw = String(urlOrData ?? '').trim();
        if (!raw) return null;
        if (isDataUrl(raw)) return dataUrlToBytes(raw);
        try { return await this.fetchAsArrayBufferOrNull(raw); } catch { return null; }
      };

      const embedImageOrNull = async (pdfDoc: PDFDocument, urlOrData?: string) => {
        const ab = await fetchBytesOrNull(urlOrData);
        if (!ab) return null;
        const kind = detectImageType(ab);
        if (!kind) return null;
        try {
          const u8 = new Uint8Array(ab);
          return kind === 'png' ? await pdfDoc.embedPng(u8) : await pdfDoc.embedJpg(u8);
        } catch { return null; }
      };

      const setButtonImageSafe = async (
        pdfDoc: PDFDocument, form: any, buttonName: string, urlOrData?: string
      ) => {
        const img = await embedImageOrNull(pdfDoc, urlOrData);
        if (!img) return false;
        // Se DIBUJA en la página en vez de `setImage`: así la imagen sobrevive
        // al copiar estas páginas a otro PDF. Ver pdf-aplanado.util.ts.
        return dibujarImagenPlana(pdfDoc, form, buttonName, img);
      };
      // ── Fin helpers ──

      const norm = (v: any) => String(v ?? '').trim().toUpperCase();

      // ── Datos del candidato ──
      const contacto: any = cand.contacto ?? {};
      const residencia: any = cand.residencia ?? {};
      const infoCc: any = cand.info_cc ?? {};
      const vivienda: any = cand.vivienda ?? {};

      const entrevista: any = Array.isArray(cand.entrevistas) ? cand.entrevistas[0] : null;
      const proceso: any = entrevista?.proceso ?? {};
      const contrato: any = proceso?.contrato ?? {};
      const antecedentes: any[] = Array.isArray(proceso?.antecedentes) ? proceso.antecedentes : [];

      const findAnte = (nombre: string) => antecedentes.find((a: any) => norm(a?.nombre) === norm(nombre));

      const apellidos = [cand.primer_apellido, cand.segundo_apellido]
        .map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' ').toUpperCase();
      const nombres = [cand.primer_nombre, cand.segundo_nombre]
        .map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' ').toUpperCase();
      const numeroCedula = String(cand.numero_documento ?? '').trim();
      const lugarExpedicion = String(infoCc?.mpio_expedicion ?? '').trim().toUpperCase();

      // Fecha de nacimiento
      const fechaNacRaw = String(cand.fecha_nacimiento ?? '').trim();
      let diaNac = '', mesNac = '', anioNac = '';
      if (fechaNacRaw) {
        // Parse LOCAL: "YYYY-MM-DD" con new Date() es medianoche UTC y en
        // Bogotá imprimía el día anterior al real.
        const s10 = fechaNacRaw.slice(0, 10);
        const d = /^\d{4}-\d{2}-\d{2}$/.test(s10) ? new Date(`${s10}T00:00:00`) : new Date(fechaNacRaw);
        if (!isNaN(d.getTime())) {
          diaNac = String(d.getDate()).padStart(2, '0');
          mesNac = String(d.getMonth() + 1).padStart(2, '0');
          anioNac = String(d.getFullYear());
        }
      }

      const lugarNacimiento = String(infoCc?.mpio_nacimiento ?? '').trim().toUpperCase();

      // Fecha de ingreso dd/mm/yyyy
      const fechaRaw = String(
        cand?.entrevistas?.[0]?.proceso?.contrato?.fecha_ingreso ?? ''
      ).trim();

      let fechaIngreso = '';

      if (fechaRaw) {
        const [year, month, day] = fechaRaw.split('-');
        fechaIngreso = `${day}/${month}/${year}`;
      }

      // Género
      const sexo = norm(cand.sexo ?? cand.genero ?? '');
      const esMasculino = sexo === 'M' || sexo === 'MASCULINO';
      const esFemenino = sexo === 'F' || sexo === 'FEMENINO';

      // ── Obtener datos de contratación ──
      let datoContratacion: any = {};
      try {
        const numeroDoc = numeroCedula;
        if (numeroDoc) {
          const respContratacion: any = await firstValueFrom(
            this.contratacionService.buscarEncontratacion(numeroDoc).pipe(
              take(1),
              catchError((err) => {
                console.error('[FormatoSolicitud] Error buscando contratación:', err);
                return of({ data: [] });
              })
            )
          );
          datoContratacion = respContratacion?.data?.[0] ?? {};
        }
      } catch (e) {
        console.error('[FormatoSolicitud] Error obteniendo contratación:', e);
      }

      // Tallas
      const tallaCamiseta = String(datoContratacion?.camisa ?? '').trim();
      const tallaCalzado = String(datoContratacion?.calzado ?? '').trim();
      const numHijos = String(datoContratacion?.num_hijos_dependen_economicamente ?? '').trim();

      // Estado civil
      const estadoCivil = norm(cand.estado_civil ?? '');

      // Vivienda
      const tipoViviendaAlt = norm(vivienda?.tipo_vivienda_alt ?? datoContratacion?.tipo_vivienda_alt ?? '');
      const tipoVivienda = norm(vivienda?.tipo_vivienda ?? datoContratacion?.tipo_vivienda ?? '');

      // Quién cuida los hijos
      const cuidadorHijos = String(vivienda?.responsable_hijos ?? datoContratacion?.responsable_hijos ?? '').trim();

      // Dirección y barrio
      const direccion = String(residencia?.direccion ?? datoContratacion?.direccion_residencia ?? '').trim();
      const barrio = String(residencia?.barrio ?? datoContratacion?.barrio ?? '').trim();
      const direccionCompleta = [direccion, barrio].filter(Boolean).join(' - ');

      // Teléfono
      const telefono = String(contacto?.celular ?? contacto?.telefono ?? datoContratacion?.celular ?? '').trim();

      // Ciudad (municipio de residencia)
      const ciudad = String(residencia?.municipio ?? datoContratacion?.municipio ?? '').trim().toUpperCase();

      // Experiencias laborales (hasta 3)
      const experiencias: any[] = Array.isArray(cand.experiencias) ? cand.experiencias : [];

      // Cómo supo del trabajo
      const comoSeEntero = String(entrevista?.como_se_entero ?? datoContratacion?.como_se_entero ?? '').trim();

      // EPS / AFP / Cesantías
      const eps = String(findAnte('EPS')?.observacion ?? '').trim();
      const afp = String(findAnte('AFP')?.observacion ?? '').trim();
      const cesantias = String(contrato?.cesantias ?? '').trim();

      // ── Cargar PDF ──
      const pdfUrl = 'Docs/formato_empleo_andes.pdf';
      const arrayBuffer = await this.fetchAsArrayBufferOrNull(pdfUrl);
      if (!arrayBuffer) throw new Error('No se pudo cargar el PDF formato solicitud.');

      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const form = pdfDoc.getForm();

      // ── Campos de texto ──
      this.setText(form, 'Fecha de Ingreso', fechaIngreso);
      this.setText(form, 'Apellidos', apellidos);
      this.setText(form, 'Nombres', nombres);
      this.setText(form, 'Numero Cédula', numeroCedula);
      this.setText(form, 'Lugar Expedición', lugarExpedicion);

      this.setText(form, 'Día', diaNac);
      this.setText(form, 'Mes', mesNac);
      this.setText(form, 'Año', anioNac);

      this.setText(form, 'Lugar de Nac', lugarNacimiento);

      this.setText(form, 'Talla', tallaCamiseta);
      this.setText(form, 'Calzado', tallaCalzado);
      this.setText(form, 'Numero de Hijos', numHijos);

      this.setText(form, 'Quien cuida de sus hijos', cuidadorHijos);
      this.setText(form, 'Dirección de Vivienda y Barrio', direccionCompleta);
      this.setText(form, 'Teléfono', telefono);
      this.setText(form, 'Ciudad', ciudad);

      // ── Género (X en campo correspondiente) ──
      if (esMasculino) this.setText(form, 'masculino', 'X');
      if (esFemenino) this.setText(form, 'Femenino', 'X');

      // ── Estado civil checkboxes (X en campo correspondiente) ──
      const ecMap: { [key: string]: string } = {
        SO: 'Solteroa', SOLTERO: 'Solteroa', S: 'Solteroa',
        CA: 'Casadoa', CASADO: 'Casadoa', CASADA: 'Casadoa',
        UL: 'Unión Libre', UNION_LIBRE: 'Unión Libre', UN: 'Unión Libre',
        SE: 'Separadoa', SEPARADO: 'Separadoa', SEPARADA: 'Separadoa',
        VI: 'Viudoa', VIUDO: 'Viudoa', VIUDA: 'Viudoa',
      };
      const ecField = ecMap[estadoCivil];
      if (ecField) this.setText(form, ecField, 'X');

      // ── Tipo vivienda alt (propiedad): Propia / Familiar / Arriendo ──
      if (tipoViviendaAlt === 'PROPIA') this.setText(form, 'propia', 'X');
      else if (tipoViviendaAlt === 'FAMILIAR' || tipoViviendaAlt === 'AMIGOS') this.setText(form, 'Familiar', 'X');
      else if (tipoViviendaAlt === 'ARRIENDO') this.setText(form, 'Arriendo', 'X');

      // ── Tipo vivienda (estructura) ──
      const tvNorm = tipoVivienda.replace(/[,\s]+/g, ' ').trim();
      if (tvNorm.includes('CASA') && tvNorm.includes('LOTE')) this.setText(form, 'Casa Lote', 'X');
      else if (tvNorm.includes('APARTAMENTO')) this.setText(form, 'Apartamento', 'X');
      else if (tvNorm.includes('HABITACIÓN') || tvNorm.includes('HABITACION') || tvNorm === 'PIEZA') this.setText(form, 'Pieza', 'X');
      else if (tvNorm.includes('FINCA') || tvNorm.includes('LOTE')) this.setText(form, 'Lote con Cimientos', 'X');
      else if (tvNorm.includes('CASA')) this.setText(form, 'Casa', 'X');

      // ── Experiencias laborales (hasta 3 filas) ──
      for (let i = 0; i < 3; i++) {
        const exp = experiencias[i] ?? {};
        const rowSuffix = `Row${i + 1}`;
        this.setText(form, `Nombre de la Empresa${rowSuffix}`, String(exp.empresa ?? '').trim());
        this.setText(form, `Tiempo Laborado${rowSuffix}`, String(exp.tiempo_trabajado ?? exp.tiempo ?? '').trim());
        this.setText(form, `Cargo${rowSuffix}`, String(exp.cargo ?? '').trim());
        this.setText(form, `Sueldo${rowSuffix}`, String(exp.sueldo ?? '').trim());
        this.setText(form, `Motivo del Retiro${rowSuffix}`, String(exp.motivo_retiro ?? '').trim());
      }

      // ── Cómo supo del trabajo ──
      this.setText(form, 'Como supo del trabajo', comoSeEntero);

      // ── EPS / Fondo de Pensiones / Cesantías ──
      this.setText(form, 'Nombre de EPS', eps);
      this.setText(form, 'Nombre de Fondo de Pensiones', afp);
      this.setText(form, 'Nombre de Fondo de Cesantías', cesantias);

      // ── Firmas ──
      await setButtonImageSafe(pdfDoc, form, 'Firma del Trabajador_af_image', this.firma);
      await setButtonImageSafe(pdfDoc, form, 'Firma de RRHH_af_image', this.firmaPersonalAdministrativo);

      // ── Bloquear campos y guardar ──
      aplanarFormulario(form);

      const pdfBytes = await pdfDoc.save();
      const ab = this.toSafeArrayBuffer(pdfBytes);
      const file = new File([ab], 'Formato_solicitud.pdf', { type: 'application/pdf' });

      this.uploadedFiles['Formato Solicitud'] = { file, fileName: 'Formato_solicitud.pdf' };
      this.verPDF({ titulo: 'Formato Solicitud' });
    } catch (error) {
      console.error('Error generando Formato Solicitud:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el Formato de Solicitud.' });
    }
  }


  // ─────────────────────────────────────────────────────────────────────
  // Contratos Otrosí – PDF generado con jsPDF
  // ─────────────────────────────────────────────────────────────────────
  async generarContratosOtroSi() {
    try {
      const cand: any = this.candidato ?? {};
      const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ').toUpperCase();
      const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ').toUpperCase();
      const nombreCompleto = `${nombres} ${apellidos}`.trim();
      const cedula = String(cand.numero_documento ?? this.cedula ?? '').trim();
      const ciudadExpedicion = [cand.info_cc?.mpio_expedicion, cand.info_cc?.depto_expedicion].filter(Boolean).join(', ').toUpperCase() || '';

      // ─── Helpers de fecha ───
      const mesesEs = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const hoy = new Date();
      const dia = hoy.getDate();
      const mes = mesesEs[hoy.getMonth()];
      const anio = hoy.getFullYear();

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `CONTRATOS_OTROS_SI_${cedula}.pdf` });

      const pageW = doc.internal.pageSize.getWidth();   // ~215.9
      // ─── Márgenes APA: 2.54 cm = 25.4 mm ───
      const mL = 25.4;
      const mR = 25.4;
      const mTop = 25.4;
      const maxW = pageW - mL - mR;

      // ─── Helper: texto justificado ───
      const lineH = 4.2;
      const justifyText = (text: string, x: number, yStart: number, width: number, fontSize?: number): number => {
        if (fontSize) doc.setFontSize(fontSize);
        const lines: string[] = doc.splitTextToSize(text, width);
        let cy = yStart;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const isLast = i === lines.length - 1;
          if (isLast || !line) {
            // Última línea: alineación izquierda normal
            doc.text(line, x, cy);
          } else {
            // Justificar: distribuir espacio extra entre palabras
            const words = line.split(/\s+/);
            if (words.length <= 1) {
              doc.text(line, x, cy);
            } else {
              const totalTextW = words.reduce((sum, w) => sum + doc.getTextWidth(w), 0);
              const extraSpace = (width - totalTextW) / (words.length - 1);
              let wx = x;
              for (let j = 0; j < words.length; j++) {
                doc.text(words[j], wx, cy);
                wx += doc.getTextWidth(words[j]) + extraSpace;
              }
            }
          }
          cy += lineH;
        }
        return cy;
      };

      let y = mTop;

      // ───── Título centrado ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('OTRO SI A CONTRATOS CELEBRADOS ENTRE TU ALIANZA S.A.S.CON', pageW / 2, y, { align: 'center' });
      y += 5;
      doc.text('SUS COLABORADORES EN MISIÓN', pageW / 2, y, { align: 'center' });
      y += 10;

      // ───── Párrafo introductorio (justificado) ─────
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const introText = `OTRO SI al contrato en misión celebrado el día ${dia} de ${mes} de ${anio} entre la empresa temporal TU ALIANZA S.A.S. NIT. 900.864.596-1 y ${nombreCompleto || '________________________________'} identificado con Cédula de Ciudadanía ${cedula || '_______________'} de ${ciudadExpedicion || '__________________________'} se ha convenido celebrarse este OTRO SI en los siguientes términos:`;
      y = justifyText(introText, mL + 4, y, maxW - 4, 9);
      y += 3;

      // ───── i) ─────
      doc.setFont('helvetica', 'bold');
      doc.text('i)', mL, y);
      doc.setFont('helvetica', 'normal');
      y = justifyText(
        'Entre las partes existe una relación de trabajo regida por un contrato de trabajo por obra o labor al cual se entiende incorporado este documento.',
        mL + 8, y, maxW - 8
      );
      y += 3;

      // ───── ii) ─────
      doc.setFont('helvetica', 'bold');
      doc.text('ii)', mL, y);
      doc.setFont('helvetica', 'normal');
      y = justifyText(
        'Que el EMPLEADOR tiene establecido un concurso de ventas en el cual el TRABAJADOR podrá participar y eventualmente hacerse acreedor de premios o bonificaciones, en caso de cumplir con las políticas y condiciones del concurso.',
        mL + 8, y, maxW - 8
      );
      y += 3;

      // ───── iii) Artículo 128 ─────
      doc.setFont('helvetica', 'bold');
      doc.text('iii)', mL, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('El artículo 128 del Código Sustantivo del Trabajo, establece: ', mL + 8, y);
      y += lineH;

      // Art. 128 en itálica justificado
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      y = justifyText(
        `"No constituyen salario las sumas que ocasional y por mera liberalidad recibe el trabajador del empleador, como primas, bonificaciones o gratificaciones ocasionales, participación de utilidades, excedentes de las empresas de economía solidaria y lo que recibe en dinero o en especie no para su beneficio, ni para enriquecer su patrimonio, sino para desempeñar a cabalidad sus funciones, como gastos de representación o medios de transporte, elementos de trabajo y otros semejantes. Tampoco las prestaciones sociales de que tratan los títulos VIII y IX, ni los beneficios o auxilios habituales u ocasionales acordados convencional o contractualmente u otorgados en forma extralegal por el empleador, cuando las partes hayan dispuesto expresamente que no constituyen salario en dinero o en especie, tales como la alimentación, habitación o vestuario, las primas extralegales, de vacaciones, de servicios o de navidad."`,
        mL + 8, y, maxW - 8, 8.5
      );
      y += 4;

      // ───── Preámbulo ─────
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('De conformidad con lo anterior', mL + 4, y);
      let xLP = mL + 4 + doc.getTextWidth('De conformidad con lo anterior ');
      doc.setFont('helvetica', 'bold');
      doc.text('LAS PARTES', xLP, y);
      xLP += doc.getTextWidth('LAS PARTES ');
      doc.setFont('helvetica', 'normal');
      doc.text('acuerdan las siguientes cláusulas adicionales:', xLP, y);
      y += 7;

      // ───── PRIMERA ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      y = justifyText(
        'PRIMERA. EXCLUSIÓN SALARIAL BONIFICACION PREMIO A LA EXCELENCIA, U OTRO TIPO DE PREMIO POR CUMPLIMIENTO DE METAS POR PRODUCTIVIDAD POR CUMPLIMIENTO DE PARAMETROS DE CALIDAD, 0 POR CUMPLIMIENTO DE PORCENTAJES DE ASISTENCIA AL TRABAJO O POR OTROS QUE SE CREEN.',
        mL, y, maxW
      );

      doc.setFont('helvetica', 'normal');
      y = justifyText(
        'LAS PARTES acuerdan que en caso de que EL EMPLEADOR reconozca al TRABAJADOR un premio o bonificación como resultado de la participación en el concurso de ventas por él establecido, dicho premio o bonificación, el cual podrá ser entregado en dinero, en especie o en bonos para compra de producto, no constituyen factor salarial de ninguna índole conforme lo establecen los artículo 128 del CST.',
        mL, y, maxW
      );
      y += 3;

      // ───── SEGUNDA ─────
      doc.setFont('helvetica', 'bold');
      doc.text('SEGUNDA. BASE PARA CALCULAR PRESTACIONES Y COTIZACIONES.', mL, y);
      doc.setFont('helvetica', 'normal');
      y += lineH;
      y = justifyText(
        'Por no constituir factor salarial, el premio o bonificación entregado por el EMPLEADOR en el marco del concurso de ventas, no se tendrá en cuenta para integrar la base para calcular prestaciones sociales, indemnizaciones, ni cotizaciones al sistema de seguridad social.',
        mL, y, maxW
      );
      y += 3;

      // ───── TERCERA ─────
      doc.setFont('helvetica', 'bold');
      doc.text('TERCERA. EL TRABAJADOR', mL + 4, y);
      let xT = mL + 4 + doc.getTextWidth('TERCERA. EL TRABAJADOR ');
      doc.setFont('helvetica', 'normal');
      doc.text('autoriza expresamente a', xT, y);
      xT += doc.getTextWidth('autoriza expresamente a ');
      doc.setFont('helvetica', 'bold');
      doc.text('EL EMPLEADOR,', xT, y);
      doc.setFont('helvetica', 'normal');
      y += lineH;
      y = justifyText(
        'para que en cualquier momento y sin necesidad de preaviso alguno, se abstenga de reconocer y/o pagar el premio o bonificación, sea total o proporcional de concurso de ventas que se tienen establecido de manera libre y voluntaria.',
        mL, y, maxW
      );
      y += 6;

      // ───── Cierre con fecha real ─────
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      y = justifyText(
        `En señal de conformidad a satisfacción las partes lo suscriben en dos ejemplares de un mismo tenor, en la ciudad de Bogotá D.C. a los ${dia} del mes de ${mes} del año ${anio}`,
        mL, y, maxW
      );
      y += 10;

      // ───── Área de firmas ─────
      const toDataURL = async (url?: string): Promise<string | null> => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      // Encabezados
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('EL EMPLEADOR', mL + 10, y);
      doc.text('EL TRABAJADOR', pageW / 2 + 20, y);
      y += 4;

      // Sello empleador (izquierda)
      try {
        const selloData = await toDataURL('firma/firmaselloalianza.jpeg');
        if (selloData) {
          doc.addImage(selloData, 'JPEG', mL, y, 45, 20);
        }
      } catch { }

      // Firma candidato (derecha) — usa this.firma
      try {
        const firmaData = await toDataURL(this.firma);
        if (firmaData) {
          doc.addImage(firmaData, 'PNG', pageW / 2 + 15, y + 6, 32, 14);
        }
      } catch { }

      y += 22;

      // Líneas de firma
      doc.setLineWidth(0.4);
      doc.line(mL, y, mL + 55, y);
      doc.line(pageW / 2 + 10, y, pageW - mR, y);
      y += 5;

      // Datos bajo firma empleador
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('TU ALIANZA S.A.S', mL, y);
      y += 4;
      doc.text('NIT. 900.864.596-1', mL, y);

      // Datos bajo firma trabajador
      let yRight = y - 4;
      doc.setFont('helvetica', 'bold');
      doc.text('FIRMA', pageW / 2 + 10, yRight);
      yRight += 4;
      doc.setFont('helvetica', 'normal');
      doc.text(`No de Identificación: ${cedula}`, pageW / 2 + 10, yRight);

      // ───── Guardar PDF ─────
      const pdfBlob = doc.output('blob');
      const fileName = `CONTRATOS_OTROS_SI_${cedula}.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      this.uploadedFiles['Contratos Otrosí'] = { file: pdfFile, fileName };
      this.verPDF({ titulo: 'Contratos Otrosí' });

    } catch (error) {
      console.error('Error generando Contratos Otrosí:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el documento Contratos Otrosí.' });
    }
  }


  // ─────────────────────────────────────────────────────────────────────
  // OTRO SI JORNADA LABORAL – modifica las horas semanales pactadas.
  //
  // Documento distinto al de "Contratos Otrosí" (que es de exclusión salarial
  // por concurso de ventas, art. 128 CST). Acá solo se modifica la jornada.
  //
  // Las horas van en una constante porque la Ley 2101 de 2021 las reduce por
  // etapas: cuando cambie el tope legal, se ajusta en un solo punto.
  // ─────────────────────────────────────────────────────────────────────
  private readonly HORAS_SEMANALES_OTROSI = '41.5';

  async generarOtroSiJornadaLaboral() {
    try {
      const cand: any = this.candidato ?? {};
      const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ').toUpperCase();
      const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ').toUpperCase();
      const nombreCompleto = `${nombres} ${apellidos}`.trim();
      const cedula = String(cand.numero_documento ?? this.cedula ?? '').trim();
      const ciudadExpedicion =
        [cand.info_cc?.mpio_expedicion, cand.info_cc?.depto_expedicion]
          .filter(Boolean).join(', ').toUpperCase() || '';

      // Fecha del CONTRATO, no la de hoy: el documento afirma cuándo se
      // celebró el contrato en misión.
      const mesesEs = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const f = this.getFechaContrato();
      const dia = f.getDate();
      const mes = mesesEs[f.getMonth()];
      const anio = f.getFullYear();

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `OTRO_SI_JORNADA_${cedula}.pdf` });

      const pageW = doc.internal.pageSize.getWidth();
      const mL = 25.4;
      const mR = 25.4;
      const maxW = pageW - mL - mR;
      const lineH = 4.6;

      const justifyText = (text: string, x: number, yStart: number, width: number, fontSize?: number): number => {
        if (fontSize) doc.setFontSize(fontSize);
        const lines: string[] = doc.splitTextToSize(text, width);
        let cy = yStart;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const isLast = i === lines.length - 1;
          if (isLast || !line) {
            doc.text(line, x, cy);
          } else {
            const words = line.split(/\s+/);
            if (words.length <= 1) {
              doc.text(line, x, cy);
            } else {
              const totalTextW = words.reduce((sum, w) => sum + doc.getTextWidth(w), 0);
              const extra = (width - totalTextW) / (words.length - 1);
              let wx = x;
              for (const w of words) {
                doc.text(w, wx, cy);
                wx += doc.getTextWidth(w) + extra;
              }
            }
          }
          cy += lineH;
        }
        return cy;
      };

      let y = 25.4;

      // ───── Título ─────
      doc.setFont('helvetica', 'bold').setFontSize(11);
      doc.text('OTRO SI A CONTRATOS CELEBRADOS ENTRE TU ALIANZA S.A.S.', pageW / 2, y, { align: 'center' });
      y += 5;
      doc.text('CON SUS COLABORADORES EN MISIÓN', pageW / 2, y, { align: 'center' });
      y += 12;

      // ───── Párrafo introductorio ─────
      doc.setFont('helvetica', 'normal').setFontSize(9.5);
      const intro =
        `OTRO SI al contrato en misión celebrado el día ${dia} de ${mes} de ${anio} entre la empresa temporal ` +
        `TU ALIANZA S.A.S. NIT. 900.864.596-1 y ${nombreCompleto || '________________________________'} identificado ` +
        `con Cédula de Ciudadanía ${cedula || '_______________'} de ${ciudadExpedicion || '__________________________'} ` +
        `se ha convenido celebrar este OTRO SI en los siguientes términos:`;
      y = justifyText(intro, mL, y, maxW, 9.5);
      y += 7;

      // ───── CLAUSULA PRIMERA ─────
      doc.setFont('helvetica', 'bold').setFontSize(9.5);
      const rotuloPrimera = 'CLAUSULA PRIMERA';
      doc.text(rotuloPrimera, mL, y);
      const xPrimera = mL + doc.getTextWidth(rotuloPrimera);
      doc.setFont('helvetica', 'normal');
      // El rótulo va en negrita en la misma línea; el resto del texto se
      // reflowea debajo respetando el ancho de página.
      const restoPrimera =
        `. El presente documento tiene por objeto modificar las horas laborales semanales al inicialmente ` +
        `acordado, siendo estas de ${this.HORAS_SEMANALES_OTROSI} horas , a partir de la fecha de Ingreso.`;
      const primeraLines: string[] = doc.splitTextToSize(restoPrimera, maxW - (xPrimera - mL));
      doc.text(primeraLines[0], xPrimera, y);
      y += lineH * 2;
      if (primeraLines.length > 1) {
        y = justifyText(primeraLines.slice(1).join(' '), mL, y, maxW, 9.5);
      }
      y += 5;

      // ───── CLAUSULA SEGUNDA ─────
      doc.setFont('helvetica', 'bold');
      const rotuloSegunda = 'CLAUSULA SEGUNDA';
      doc.text(rotuloSegunda, mL, y);
      const xSegunda = mL + doc.getTextWidth(rotuloSegunda);
      doc.setFont('helvetica', 'normal');
      const restoSegunda =
        `. Todas las demás cláusulas y estipulaciones contractuales del contrato principal, NO son ` +
        `modificadas por el presente acuerdo, permanecen vigentes y su exigibilidad permanece.`;
      const segundaLines: string[] = doc.splitTextToSize(restoSegunda, maxW - (xSegunda - mL));
      doc.text(segundaLines[0], xSegunda, y);
      y += lineH;
      if (segundaLines.length > 1) {
        y = justifyText(segundaLines.slice(1).join(' '), mL, y, maxW, 9.5);
      }

      // ───── Cierre ─────
      y += 22;
      doc.setFont('helvetica', 'normal').setFontSize(9.5);
      y = justifyText(
        `En señal de conformidad a satisfacción las partes lo suscriben en dos ejemplares de un mismo tenor, ` +
        `en Madrid a los ${dia} del mes ${mes} del año ${anio}`,
        mL, y, maxW, 9.5
      );

      // ───── Firmas ─────
      y += 20;
      const toDataURL = async (url?: string): Promise<string | null> => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      doc.setFont('helvetica', 'bold').setFontSize(10);
      doc.text('EL EMPLEADOR', mL, y);
      doc.text('EL TRABAJADOR', pageW / 2 + 10, y);
      y += 6;

      try {
        const selloData = await toDataURL('firma/firmaselloalianza.jpeg');
        if (selloData) doc.addImage(selloData, 'JPEG', mL + 5, y, 45, 20);
      } catch { }

      try {
        const firmaData = await toDataURL(this.firma);
        if (firmaData) doc.addImage(firmaData, 'PNG', pageW / 2 + 15, y + 6, 32, 14);
      } catch { }

      y += 24;
      doc.setLineWidth(0.4);
      doc.line(mL, y, mL + 55, y);
      doc.line(pageW / 2 + 10, y, pageW - mR, y);
      y += 5;

      doc.setFont('helvetica', 'bold').setFontSize(9);
      doc.text('TU ALIANZA S.A.S.', mL, y);
      doc.text('FIRMA', pageW / 2 + 10, y);
      y += 4;
      doc.text('NIT. 900.864.596-1', mL, y);

      // El rótulo se dibuja en negrita, así que el ancho se mide TAMBIÉN en
      // negrita (es más ancha que la normal). Midiéndolo después de cambiar a
      // normal, la cédula quedaba pegada encima de los dos puntos.
      const rotuloId = 'No de Identificación:';
      const xId = pageW / 2 + 10;
      doc.text(rotuloId, xId, y);
      const anchoRotuloId = doc.getTextWidth(rotuloId);
      doc.setFont('helvetica', 'normal');
      doc.text(cedula, xId + anchoRotuloId + 2, y);

      const pdfBlob = doc.output('blob');
      const fileName = `OTRO_SI_JORNADA_${cedula}.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      this.uploadedFiles['OTRO SI Jornada Laboral'] = { file: pdfFile, fileName };
      this.verPDF({ titulo: 'OTRO SI Jornada Laboral' });
    } catch (error) {
      console.error('Error generando OTRO SI Jornada Laboral:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el OTRO SI Jornada Laboral.' });
    }
  }


  // ─────────────────────────────────────────────────────────────────────
  // OTRO SI SAGARO FUMIGADOR – modificación del día de descanso obligatorio
  // (domingo → jueves). PDF generado con jsPDF. Réplica del formato oficial.
  // ─────────────────────────────────────────────────────────────────────
  async generarOtroSiSagaroFumigador() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};
      const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ').toUpperCase();
      const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ').toUpperCase();
      const nombreCompleto = `${nombres} ${apellidos}`.trim();
      const cedula = String(cand.numero_documento ?? this.cedula ?? '').trim();
      const ciudadExpedicion = [cand.info_cc?.mpio_expedicion, cand.info_cc?.depto_expedicion].filter(Boolean).join(', ').toUpperCase() || '';
      const area = String(vac?.cargo ?? '').toUpperCase().trim();

      // ─── Fecha de contrato (no la actual) ───
      const mesesEs = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const fecha = this.getFechaContrato();
      const dia = fecha.getDate();
      const mes = mesesEs[fecha.getMonth()];
      const anio = fecha.getFullYear();

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `OTRO_SI_SAGARO_FUMIGADOR_${cedula}.pdf` });

      const pageW = doc.internal.pageSize.getWidth();   // ~215.9
      const pageH = doc.internal.pageSize.getHeight();  // ~279.4
      const mL = 22;
      const mR = 22;
      const mTop = 18;
      const maxW = pageW - mL - mR;

      const lineH = 3.9;
      const BODY = 8.6;

      // ─── Helper: párrafo con segmentos en negrita/normal, justificado ───
      type Seg = { t: string; b?: boolean };
      const measure = (w: string, b: boolean): number => {
        doc.setFont('helvetica', b ? 'bold' : 'normal');
        return doc.getTextWidth(w);
      };
      const renderRich = (segs: Seg[], x: number, yStart: number, width: number, justify = true): number => {
        doc.setFontSize(BODY);
        const words: { w: string; b: boolean }[] = [];
        for (const s of segs) {
          for (const w of s.t.split(/\s+/).filter(Boolean)) words.push({ w, b: !!s.b });
        }
        doc.setFont('helvetica', 'normal');
        const spaceW = doc.getTextWidth(' ');
        let cy = yStart;
        let line: { w: string; b: boolean }[] = [];
        let lineW = 0;
        const flush = (isLast: boolean) => {
          if (!line.length) { cy += lineH; return; }
          if (justify && !isLast && line.length > 1) {
            const wordsW = line.reduce((a, c) => a + measure(c.w, c.b), 0);
            const extra = (width - wordsW) / (line.length - 1);
            let cx = x;
            for (const tok of line) {
              doc.setFont('helvetica', tok.b ? 'bold' : 'normal');
              doc.text(tok.w, cx, cy);
              cx += measure(tok.w, tok.b) + extra;
            }
          } else {
            let cx = x;
            for (const tok of line) {
              doc.setFont('helvetica', tok.b ? 'bold' : 'normal');
              doc.text(tok.w, cx, cy);
              cx += measure(tok.w, tok.b) + spaceW;
            }
          }
          cy += lineH;
          line = [];
          lineW = 0;
        };
        for (const tok of words) {
          const wW = measure(tok.w, tok.b);
          const prospective = line.length ? lineW + spaceW + wW : wW;
          if (prospective > width && line.length) flush(false);
          lineW = line.length ? lineW + spaceW + wW : wW;
          line.push(tok);
        }
        flush(true);
        return cy;
      };

      const toDataURL = async (url?: string): Promise<string | null> => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      let y = mTop;

      // ───── Título centrado ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('OTRO SI A CONTRATOS CELEBRADOS ENTRE TU ALIANZA S.A.S.', pageW / 2, y, { align: 'center' });
      y += 5;
      doc.text('CON SUS COLABORADORES EN MISIÓN', pageW / 2, y, { align: 'center' });
      y += 8;

      // ───── Párrafo introductorio ─────
      y = renderRich([
        { t: 'OTRO SI al contrato en misión celebrado el día' },
        { t: dia ? ` ${dia} de ${mes} de ${anio} ` : ' ______________________ ' },
        { t: 'entre la empresa' },
        { t: ' TU ALIANZA S.A.S. NIT. 900.864.596-1 ', b: true },
        { t: 'y' },
        { t: ` ${nombreCompleto || '________________________________'} ` },
        { t: 'identificado con Cédula de Ciudadanía' },
        { t: ` ${cedula || '_______________'} ` },
        { t: ciudadExpedicion ? `de ${ciudadExpedicion} ` : '' },
        { t: 'se ha convenido celebrar este OTRO SI en los siguientes términos:' },
      ], mL, y, maxW);
      y += 4;

      // ───── CONSIDERACIONES PREVIAS ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text('CONSIDERACIONES PREVIAS', pageW / 2, y, { align: 'center' });
      y += 5;

      y = renderRich([
        { t: '1. ', b: true },
        { t: 'Que las partes suscribieron un contrato de trabajo por la duración de la obra o labor.' },
      ], mL, y, maxW);
      y += 1.5;

      y = renderRich([
        { t: '2. ', b: true },
        { t: 'Que, en virtud del objeto social de' },
        { t: ' EL EMPLEADOR, EL (LA) TRABAJADOR(A) ', b: true },
        { t: 'presta sus servicios en calidad de Trabajador en Misión, en las instalaciones de la Empresa Usuaria correspondiente.' },
      ], mL, y, maxW);
      y += 1.5;

      y = renderRich([
        { t: '3. ', b: true },
        { t: 'Que la Empresa Usuaria, por su naturaleza operativa y técnica, durante las diferentes temporadas requiere la prestación de servicios de manera continua, incluyendo ocasionalmente los días domingos.' },
      ], mL, y, maxW);
      y += 1.5;

      y = renderRich([
        { t: '4. ', b: true },
        { t: 'Que el artículo 14 de la Ley 2466 de 2025, modificatorio del artículo 179 del Código Sustantivo del Trabajo, establece la facultad de las partes para convenir por escrito un día de descanso obligatorio distinto al domingo.' },
      ], mL, y, maxW);
      y += 1.5;

      y = renderRich([
        { t: '5. ', b: true },
        { t: 'Que EL (LA) TRABAJADOR(A) presta sus servicios específicamente en la Finca Ságaro, en el área de' },
        { t: area ? ` ${area}.` : ' ____________________________________.' },
      ], mL, y, maxW);
      y += 3;

      // ───── CLÁUSULAS ─────
      y = renderRich([
        { t: 'CLAUSULA PRIMERA: MODIFICACIÓN DEL DÍA DE DESCANSO OBLIGATORIO ', b: true },
        { t: 'De manera expresa, libre y voluntaria, las partes acuerdan modificar el día de descanso obligatorio semanal del (la)' },
        { t: ' TRABAJADOR(A) EN MISIÓN', b: true },
        { t: '. A partir de la firma del presente OTRO SÍ, el día de descanso obligatorio remunerado dejará de ser el domingo y pasará a ser el día jueves, garantizando en todo caso el disfrute de un (1) día completo de descanso a la semana.' },
      ], mL, y, maxW);
      y += 2.5;

      y = renderRich([
        { t: 'CLAUSULA SEGUNDA. NATURALEZA DEL DÍA DOMINGO. ', b: true },
        { t: 'Como consecuencia de lo anterior, las partes acuerdan que el día domingo se considerará, para todos los efectos legales, contractuales y prestacionales, como día hábil laboral ordinario. En consecuencia, el trabajo ejecutado en día domingo dentro de la jornada ordinaria pactada no generará recargo por trabajo dominical, ni dará lugar a descansos compensatorios adicionales, en razón a que el descanso obligatorio ha sido trasladado al día jueves.' },
      ], mL, y, maxW);
      y += 2.5;

      y = renderRich([
        { t: 'CLAUSULA TERCERA. REMUNERACIÓN DEL DÍA DE DESCANSO- EL EMPLEADOR ', b: true },
        { t: 'reconocerá y remunerará el día de descanso obligatorio pactado dentro del salario básico mensual, conforme a lo dispuesto en el artículo 173 del Código Sustantivo del Trabajo, siempre que' },
        { t: ' EL (LA) TRABAJADOR(A) ', b: true },
        { t: 'labore la semana completa o el tiempo proporcional correspondiente.' },
      ], mL, y, maxW);
      y += 2.5;

      y = renderRich([
        { t: 'CLAUSULA CUARTA. TRABAJO EXCEPCIONAL EN EL DÍA DE DESCANSO ', b: true },
        { t: 'En el evento en que, por necesidades excepcionales del servicio,' },
        { t: ' EL (LA) TRABAJADOR(A) ', b: true },
        { t: 'deba laborar el día miércoles, correspondiente a su descanso obligatorio,' },
        { t: ' EL EMPLEADOR ', b: true },
        { t: 'reconocerá y pagará dicho tiempo con el recargo legal vigente, de conformidad con lo establecido en la Ley 2466 de 2025, en proporción a las horas efectivamente laboradas.' },
      ], mL, y, maxW);
      y += 2.5;

      y = renderRich([
        { t: 'CLAUSULA QUINTA. CONDICIONES LABORALES ESPECÍFICAS ', b: true },
        { t: '–EL (LA) TRABAJADOR(A) prestará sus servicios bajo las siguientes condiciones laborales, las cuales acepta expresamente:' },
      ], mL, y, maxW);
      y += 1.5;
      y = renderRich([
        { t: 'a) Transporte: ', b: true },
        { t: 'EL (LA) TRABAJADOR(A) se presentará por sus propios medios al lugar de trabajo, sin que ello genere reconocimiento adicional distinto al legalmente establecido.' },
      ], mL + 3, y, maxW - 3);
      y += 1.2;
      y = renderRich([
        { t: 'b) Salario: ', b: true },
        { t: 'devengará el Salario Mínimo Legal Mensual Vigente (SMLMV).' },
      ], mL + 3, y, maxW - 3);
      y += 1.2;
      y = renderRich([
        { t: 'c) Auxilio de transporte: ', b: true },
        { t: 'se reconocerá conforme a la ley, siempre que se cumplan los requisitos legales para su pago.' },
      ], mL + 3, y, maxW - 3);
      y += 2.5;

      y = renderRich([
        { t: 'CLAUSULA SEXTA. ', b: true },
        { t: 'Todas las demás cláusulas y estipulaciones contractuales del contrato principal, NO son modificadas por el presente acuerdo, por tanto, permanecen vigentes y su exigibilidad permanece también.' },
      ], mL, y, maxW);
      y += 4;

      // ───── Cierre con fecha ─────
      y = renderRich([
        { t: `En señal de conformidad a satisfacción las partes lo suscriben en dos ejemplares de un mismo tenor, en Bogotá los ${dia} días del mes de ${mes} del año ${anio}.` },
      ], mL, y, maxW);
      y += 12;

      // ───── Área de firmas ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('EL EMPLEADOR', mL + 8, y);
      doc.text('EL TRABAJADOR', pageW / 2 + 18, y);
      y += 3;

      // Sello empleador (izquierda)
      try {
        const selloData = await toDataURL('firma/firmaselloalianza.jpeg');
        if (selloData) doc.addImage(selloData, 'JPEG', mL, y, 42, 19);
      } catch { }

      // Firma del candidato (derecha)
      try {
        const firmaData = await toDataURL(this.firma);
        if (firmaData) doc.addImage(firmaData, 'PNG', pageW / 2 + 14, y + 4, 32, 14);
      } catch { }

      y += 21;
      doc.setLineWidth(0.4);
      doc.line(mL, y, mL + 60, y);
      doc.line(pageW / 2 + 10, y, pageW - mR, y);
      y += 4;

      // Datos bajo firma empleador
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('HEIDY JACKELINE TORRES SOTELO', mL, y);
      y += 4;
      doc.text('TU ALIANZA S.A.S', mL, y);
      y += 4;
      doc.text('NIT. 900.864.596-1', mL, y);

      // Datos bajo firma trabajador
      let yRight = y - 8;
      doc.setFont('helvetica', 'bold');
      doc.text('FIRMA', pageW / 2 + 10, yRight);
      yRight += 4;
      doc.setFont('helvetica', 'normal');
      doc.text(`N° de Documento: ${cedula}`, pageW / 2 + 10, yRight);

      // ───── Pie de página ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('V2-07-Jun-22', pageW - mR, pageH - 16, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text('Tu Alianza S.A.S., Oficina Madrid: Cl 7 #4-49 Centro, PBX 744 4002;', pageW / 2, pageH - 11, { align: 'center' });
      doc.text('Oficina Facatativá Cra. 2 # 8-156 Centro Tel: 890 29 70. Mail: servicioalcliente@tsservicios.co', pageW / 2, pageH - 8, { align: 'center' });

      // ───── Guardar PDF ─────
      const pdfBlob = doc.output('blob');
      const fileName = `OTRO_SI_SAGARO_FUMIGADOR_${cedula}.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      this.uploadedFiles['OTRO SI Sagaro Fumigador'] = { file: pdfFile, fileName };
      this.verPDF({ titulo: 'OTRO SI Sagaro Fumigador' });

    } catch (error) {
      console.error('Error generando OTRO SI Sagaro Fumigador:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el OTRO SI Sagaro Fumigador.' });
    }
  }


  // ─────────────────────────────────────────────────────────────────────
  // Auxilio Extralegal de Alimentación y Hospedaje – PDF generado con jsPDF
  // ─────────────────────────────────────────────────────────────────────
  async generarAuxilioAlimentacion() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};
      const cedula = String(cand.numero_documento ?? this.cedula ?? '').trim();
      const empresaUsuaria = (this.empresaUsuariaDoc || vac.finca || '').toString().toUpperCase().trim();

      // ─── Helpers de fecha ───
      const mesesEs = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const hoy = new Date();
      const dia = hoy.getDate();
      const mes = mesesEs[hoy.getMonth()];
      const anio = hoy.getFullYear();

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `AUXILIO_ALIMENTACION_${cedula}.pdf` });

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      // Márgenes APA: 25.4 mm
      const mL = 25.4;
      const mR = 25.4;
      const mTop = 25.4;
      const maxW = pageW - mL - mR;

      // ─── Helper: texto justificado ───
      const lineH = 4.2;
      const justifyText = (text: string, x: number, yStart: number, width: number, fontSize?: number): number => {
        if (fontSize) doc.setFontSize(fontSize);
        const lines: string[] = doc.splitTextToSize(text, width);
        let cy = yStart;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const isLast = i === lines.length - 1;
          if (isLast || !line) {
            doc.text(line, x, cy);
          } else {
            const words = line.split(/\s+/);
            if (words.length <= 1) {
              doc.text(line, x, cy);
            } else {
              const totalTextW = words.reduce((sum, w) => sum + doc.getTextWidth(w), 0);
              const extraSpace = (width - totalTextW) / (words.length - 1);
              let wx = x;
              for (let j = 0; j < words.length; j++) {
                doc.text(words[j], wx, cy);
                wx += doc.getTextWidth(words[j]) + extraSpace;
              }
            }
          }
          cy += lineH;
        }
        return cy;
      };

      let y = mTop;

      // ───── Logo Tu Alianza ─────
      try {
        doc.addImage('logos/Logo_TA.png', 'PNG', mL, y, 40, 14);
      } catch { }
      y += 16;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('NIT 900. 864.596-1', mL, y);
      y += 10;

      // ───── Título centrado ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('AUXILIO EXTRALEGAL DE ALIMENTACIÓN Y HOSPEDAJE', pageW / 2, y, { align: 'center' });
      y += 10;

      // ─── Helper: texto justificado con negritas inline ───
      type MixedToken = { word: string; bold: boolean };
      const justifyMixed = (segments: { t: string; b: boolean }[], x: number, yStart: number, width: number): number => {
        // Flatten segments into word-level tokens
        const tokens: MixedToken[] = [];
        for (const seg of segments) {
          const words = seg.t.split(/\s+/).filter(w => w);
          for (const w of words) tokens.push({ word: w, bold: seg.b });
        }
        // Build lines respecting actual widths
        const lines: MixedToken[][] = [];
        let curLine: MixedToken[] = [];
        let curW = 0;
        doc.setFont('helvetica', 'normal');
        const sw = doc.getTextWidth(' ');
        for (const tk of tokens) {
          doc.setFont('helvetica', tk.bold ? 'bold' : 'normal');
          const ww = doc.getTextWidth(tk.word);
          const need = curLine.length > 0 ? sw + ww : ww;
          if (curW + need > width && curLine.length > 0) {
            lines.push(curLine);
            curLine = [tk]; curW = ww;
          } else {
            curLine.push(tk); curW += need;
          }
        }
        if (curLine.length > 0) lines.push(curLine);
        // Render
        let cy = yStart;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          const isLast = i === lines.length - 1;
          let totalTW = 0;
          for (const tk of ln) {
            doc.setFont('helvetica', tk.bold ? 'bold' : 'normal');
            totalTW += doc.getTextWidth(tk.word);
          }
          const gap = (isLast || ln.length <= 1) ? sw : (width - totalTW) / (ln.length - 1);
          let wx = x;
          for (const tk of ln) {
            doc.setFont('helvetica', tk.bold ? 'bold' : 'normal');
            doc.text(tk.word, wx, cy);
            wx += doc.getTextWidth(tk.word) + gap;
          }
          cy += lineH;
        }
        doc.setFont('helvetica', 'normal');
        return cy;
      };

      // ───── Párrafo 1 (con negritas) ─────
      doc.setFontSize(9);
      const eu = empresaUsuaria || '________________________';
      y = justifyMixed([
        { t: 'Convienen los contratantes que los beneficios de alimentación suministrados, como son bebida caliente y pan en la mañana y el almuerzo serán gratuitos, la comida dependerá de las horas laborales durante los turnos, al', b: false },
        { t: 'TRABAJADOR EN MISION', b: true },
        { t: 'por la empresa usuaria', b: false },
        { t: eu + ',', b: true },
        { t: 'cuyo monto autoriza deducir de su nómina quincenalmente, así como el hospedaje que le otorga esa sociedad en sus dependencias o fuera de estas, no constituye remuneración por el servicio prestado ni se concede para el beneficio o enriquecimiento del', b: false },
        { t: 'TRABAJADOR EN MISION', b: true },
        { t: 'y por tanto no se tendrán en cuenta como factor salarial, para la liquidación de acreencias laborales, ni el pago de aportes parafiscales, de conformidad con lo establecido en el Art. 17 de la Ley344 de 1.996 y el Artículo 30 de la Ley 1393 de 2010. Así mismo las partes estipulan que por tratarse de un beneficio extralegal no constitutivo de salario, reconocido por mera liberalidad de la citada empresa, ésta se reservará el derecho de modificarlos o suprimirlos en forma unilateral en cualquier momento cuando las condiciones de la empresa así lo exijan, sin que ello implique desmejora alguna en las condiciones laborales del', b: false },
        { t: 'TRABAJADOR EN MISION.', b: true },
      ], mL, y, maxW);
      y += 3;

      // ───── Párrafo 2 (con negritas) ─────
      y = justifyMixed([
        { t: 'El beneficio de hospedaje cesará una vez terminado por cualquier causa el presente contrato de trabajo, o cuando la empresa usuaria así lo disponga; por tanto en el evento de que no se desalojen por el', b: false },
        { t: 'TRABAJADOR EN MISION', b: true },
        { t: 'las dependencias mencionadas, se procederá a lanzamiento por las autoridades de policía, en cumplimiento del procedimiento señalado en la Ley 1801.', b: false },
      ], mL, y, maxW);
      y += 4;

      // ───── Párrafo 3 (fecha) ─────
      y = justifyText(
        `Para constancia de su celebración y aceptación se suscribe la presente cláusula adicional al contrato de trabajo, a los ${dia} días del mes de ${mes} del ${anio}.`,
        mL, y, maxW
      );
      y += 10;

      // ───── Área de firmas ─────
      const toDataURL = async (url?: string): Promise<string | null> => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      // Encabezados
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('LA EMPLEADORA', mL, y);
      doc.text('EL EMPLEADO', pageW / 2 + 15, y);
      y += 5;

      // Sello empleador (izquierda)
      try {
        const selloData = await toDataURL('firma/firmaselloalianza.jpeg');
        if (selloData) {
          doc.addImage(selloData, 'JPEG', mL, y, 45, 20);
        }
      } catch { }

      // Firma candidato (derecha) — usa this.firma
      try {
        const firmaData = await toDataURL(this.firma);
        if (firmaData) {
          doc.addImage(firmaData, 'PNG', pageW / 2 + 10, y, 45, 20);
        }
      } catch { }

      y += 22;

      // Líneas de firma
      doc.setLineWidth(0.4);
      doc.line(mL, y, mL + 55, y);
      doc.line(pageW / 2 + 10, y, pageW - mR, y);
      y += 5;

      // Datos bajo firma empleador
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('REPRESENTANTE LEGAL', mL, y);
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.text('Heidi Jackeline Torres Sotelo', mL, y);

      // Datos bajo firma trabajador
      let yRight = y - 4;
      doc.setFont('helvetica', 'bold');
      doc.text('Firma del Trabajador', pageW / 2 + 10, yRight);
      yRight += 4;
      doc.setFont('helvetica', 'normal');
      doc.text(`N° de Identificación: ${cedula}`, pageW / 2 + 10, yRight);

      // ───── Footer ─────
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      const footerY = pageH - 15;
      doc.text('Tu Alianza S.A.S., Oficina Madrid: Cl 7 #4-49 Centro, PBX 744 4002;', pageW / 2, footerY, { align: 'center' });
      doc.text('Oficina Facatativá Cra. 2 # 8-156 Centro Tel: 890 29 70. Mail: servicioalcliente@tsservicios.co', pageW / 2, footerY + 3.5, { align: 'center' });
      doc.setTextColor(0, 0, 0);

      // ───── Guardar PDF ─────
      const pdfBlob = doc.output('blob');
      const fileName = `AUXILIO_ALIMENTACION_${cedula}.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      this.uploadedFiles['Auxilio Alimentación'] = { file: pdfFile, fileName };
      this.verPDF({ titulo: 'Auxilio Alimentación' });

    } catch (error) {
      console.error('Error generando Auxilio Alimentación:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el documento Auxilio Alimentación.' });
    }
  }


  // ─────────────────────────────────────────────────────────────────────
  // Autorización Descuento por Nómina por Daños o Pérdidas – jsPDF
  // ─────────────────────────────────────────────────────────────────────
  async generarAutorizacionDanosPerdidas() {
    try {
      const cand: any = this.candidato ?? {};
      const vac: any = this.vacante ?? {};
      const cedula = String(cand.numero_documento ?? this.cedula ?? '').trim();
      const empresaUsuaria = (this.empresaUsuariaDoc || vac.finca || '').toString().trim();
      const municipio = (cand.residencia?.municipio ?? '').toString().trim();
      const departamento = (cand.residencia?.departamento ?? '').toString().trim();
      const ubicacion = [municipio, departamento].filter(Boolean).join('– ') || 'Bogotá D.C.';

      // ─── Fecha ───
      const mesesEs = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const hoy = new Date();
      const dia = hoy.getDate();
      const mes = mesesEs[hoy.getMonth()];
      const anio = hoy.getFullYear();

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
      doc.setProperties({ title: `AUTORIZACION_DANOS_PERDIDAS_${cedula}.pdf` });

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const mL = 25.4;
      const mR = 25.4;
      const maxW = pageW - mL - mR;

      // ─── Helper: texto justificado ───
      const lineH = 4.2;
      const justifyText = (text: string, x: number, yStart: number, width: number, fontSize?: number): number => {
        if (fontSize) doc.setFontSize(fontSize);
        const lines: string[] = doc.splitTextToSize(text, width);
        let cy = yStart;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const isLast = i === lines.length - 1;
          if (isLast || !line) {
            doc.text(line, x, cy);
          } else {
            const words = line.split(/\s+/);
            if (words.length <= 1) {
              doc.text(line, x, cy);
            } else {
              const totalTextW = words.reduce((sum, w) => sum + doc.getTextWidth(w), 0);
              const extraSpace = (width - totalTextW) / (words.length - 1);
              let wx = x;
              for (let j = 0; j < words.length; j++) {
                doc.text(words[j], wx, cy);
                wx += doc.getTextWidth(words[j]) + extraSpace;
              }
            }
          }
          cy += lineH;
        }
        return cy;
      };

      let y = 25.4;

      // ───── Logo Tu Alianza ─────
      try {
        doc.addImage('logos/Logo_TA.png', 'PNG', mL, y, 40, 14);
      } catch { }
      y += 16;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('NIT 900. 864.596-1', mL, y);
      y += 8;

      // ───── Título centrado ─────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('AUTORIZACIÓN DESCUENTO POR NÓMINA POR DAÑOS O PÉRDIDAS', pageW / 2, y, { align: 'center' });
      y += 12;

      // ───── Lugar y fecha ─────
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`${ubicacion}; ${dia} de ${mes} de ${anio}`, mL, y);
      y += 8;

      // ───── Señores: ─────
      doc.text('Señores:', mL, y);
      y += 6;

      // ───── TU ALIANZA S.A.S (bold) ─────
      doc.setFont('helvetica', 'bold');
      doc.text('TU ALIANZA S.A.S', mL, y);
      y += 10;

      // ───── Apreciados señores: ─────
      doc.setFont('helvetica', 'normal');
      doc.text('Apreciados señores:', mL, y);
      y += 8;

      // ───── Párrafo 1 ─────
      y = justifyText(
        `Por medio de la presente autorizo a la empresa para que descuente del valor que haya de pagarme por concepto de salarios, cesantías, intereses de cesantías, primas de servicios, vacaciones, bonificaciones, premios, indemnizaciones o cualquier otra suma, el valor correspondiente a favor del hotel ${empresaUsuaria || 'las Ramblas'} por los daños o perdidas de las cuales soy responsable y que realice durante el tiempo que me encuentre al servicio de la misma. Manifiesto expresamente que asumo plenamente el valor fijado por la empresa y autorizo su descuento por nómina o en la liquidación final del contrato de trabajo. De la misma manera, manifiesto expresamente que estoy enterado(a) que en caso de que no se realice el descuento de mi salario por cualquier motivo, es mi obligación informar y pagar a Tu alianza S.A.S. el valor de la cuota correspondiente.`,
        mL, y, maxW
      );
      y += 3;

      // ───── Párrafo 2 ─────
      y = justifyText(
        'Lo anterior, teniendo en cuenta lo prescrito en los artículos 139 y 151 del Código Sustantivo del Trabajo que permite autorizar el pago del salario del trabajador a un tercero y realizar descuentos.',
        mL, y, maxW
      );
      y += 4;

      // ───── Párrafo 3 (fecha) ─────
      y = justifyText(
        `Como constancia y aceptación de lo anterior, suscribo la presente autorización a los ${dia} días del mes de ${mes} de ${anio}.`,
        mL, y, maxW
      );
      y += 8;

      // ───── Cordialmente ─────
      doc.text('Cordialmente,', mL, y);
      y += 15;

      // ───── Firma del trabajador ─────
      const toDataURL = async (url?: string): Promise<string | null> => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      // Firma candidato
      try {
        const firmaData = await toDataURL(this.firma);
        if (firmaData) {
          doc.addImage(firmaData, 'PNG', mL, y - 10, 45, 18);
        }
      } catch { }

      // Línea de firma
      doc.setLineWidth(0.4);
      doc.line(mL, y, mL + 55, y);
      y += 5;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('Firma del trabajador', mL, y);
      y += 4;
      // El rótulo va en negrita: se mide en negrita ANTES de cambiar a normal,
      // o la cédula se monta encima de los dos puntos.
      const rotuloDoc = 'N° de Documento:';
      doc.text(rotuloDoc, mL, y);
      const anchoRotuloDoc = doc.getTextWidth(rotuloDoc);
      doc.setFont('helvetica', 'normal');
      doc.text(cedula, mL + anchoRotuloDoc + 2, y);

      // ───── Footer ─────
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      const footerY = pageH - 15;
      doc.text('Tu Alianza S.A.S., Oficina Madrid: Cl 7 #4-49 Centro, PBX 744 4002;', pageW / 2, footerY, { align: 'center' });
      doc.text('Oficina Facatativá Cra. 2 # 8-156 Centro Tel: 890 29 70. Mail: servicioalcliente@tsservicios.co', pageW / 2, footerY + 3.5, { align: 'center' });
      doc.setTextColor(0, 0, 0);

      // ───── Guardar PDF ─────
      const pdfBlob = doc.output('blob');
      const fileName = `AUTORIZACION_DANOS_PERDIDAS_${cedula}.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      this.uploadedFiles['Autorización Daños Pérdidas'] = { file: pdfFile, fileName };
      this.verPDF({ titulo: 'Autorización Daños Pérdidas' });

    } catch (error) {
      console.error('Error generando Autorización Daños Pérdidas:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al generar el documento Autorización Daños Pérdidas.' });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Cartas / autorizaciones TU ALIANZA (ver `cartas-tu-alianza-fill.ts`)
  // ══════════════════════════════════════════════════════════════

  /**
   * Convierte un asset (o la firma del candidato) a data URL.
   * Reutiliza el cache de `fetchAsArrayBufferOrNull` para los assets estáticos.
   */
  private async assetToDataUrl(url?: string | null): Promise<string | null> {
    if (!url) return null;
    if (url.startsWith('data:')) return url;

    const buf = await this.fetchAsArrayBufferOrNull(url);
    if (!buf) return null;

    const bytes = new Uint8Array(buf);
    const mime = (bytes[0] === 0xFF && bytes[1] === 0xD8) ? 'image/jpeg' : 'image/png';

    let binary = '';
    const CHUNK = 0x8000; // evita "Maximum call stack size exceeded" en imágenes grandes
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  /** Datos + assets comunes a las tres cartas de Tu Alianza. */
  private async buildCartaTuAlianzaCtx(): Promise<CartaTuAlianzaCtx> {
    const cand: any = this.candidato ?? {};

    const nombres = [cand.primer_nombre, cand.segundo_nombre].filter(Boolean).join(' ');
    const apellidos = [cand.primer_apellido, cand.segundo_apellido].filter(Boolean).join(' ');

    const [logoDataUrl, firmaTrabajadorDataUrl, firmaJefeGhDataUrl] = await Promise.all([
      this.assetToDataUrl('logos/Logo_TA.png'),
      this.assetToDataUrl(cand?.biometria?.firma?.file_url ?? this.firma),
      this.assetToDataUrl('firma/FirmaAndreaSD.png'),
    ]);

    return {
      nombreCompleto: `${nombres} ${apellidos}`.trim().toUpperCase(),
      cedula: String(cand.numero_documento ?? this.cedula ?? '').trim(),
      telefono: String(cand.contacto?.celular || cand.numCelular || cand.telefono || '').trim(),
      correo: String(cand.contacto?.email || cand.correo_electronico || '').trim(),
      fecha: this.getFechaContrato(),
      logoDataUrl,
      firmaTrabajadorDataUrl,
      firmaJefeGhDataUrl,
    };
  }

  /**
   * Genera una de las cartas de Tu Alianza, la deja en `uploadedFiles` y la
   * muestra en el visor. Centraliza el manejo de errores de las tres.
   */
  private async generarCartaTuAlianza(
    titulo: string,
    fileName: string,
    build: (ctx: CartaTuAlianzaCtx) => Blob,
  ): Promise<void> {
    try {
      const ctx = await this.buildCartaTuAlianzaCtx();
      if (!ctx.cedula) {
        Swal.fire('Error', 'No se encontró el candidato. Seleccione uno primero.', 'error');
        return;
      }

      const blob = build(ctx);
      const nombreArchivo = fileName.replace('{cedula}', ctx.cedula);
      const file = new File([blob], nombreArchivo, { type: 'application/pdf' });

      this.uploadedFiles[titulo] = { file, fileName: nombreArchivo };
      this.verPDF({ titulo });
    } catch (error) {
      console.error(`Error generando ${titulo}:`, error);
      Swal.fire({ icon: 'error', title: 'Error', text: `Ocurrió un error al generar ${titulo}.` });
    }
  }

  generarCartaDescuentoFlor() {
    return this.generarCartaTuAlianza(
      'Carta Descuento de Flor',
      'CARTA_DESCUENTO_FLOR_{cedula}.pdf',
      buildCartaDescuentoFlorPdf,
    );
  }

  generarFormatoTimbre() {
    return this.generarCartaTuAlianza(
      'Formato Timbre Ingreso/Salida',
      'FORMATO_TIMBRE_INGRESO_SALIDA_{cedula}.pdf',
      buildFormatoTimbrePdf,
    );
  }

  generarCartaAutorizacionCorreo() {
    return this.generarCartaTuAlianza(
      'Carta Autorización Correo Electrónico',
      'AUTORIZACION_NOTIFICACION_ELECTRONICA_{cedula}.pdf',
      buildCartaAutorizacionCorreoPdf,
    );
  }

}
