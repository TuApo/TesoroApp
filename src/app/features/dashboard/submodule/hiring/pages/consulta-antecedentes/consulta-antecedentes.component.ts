import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { saveAs } from 'file-saver';

import {
  AccionMasiva,
  BadgeCelda,
  ColumnaTabla,
  TABLA_ESTANDAR,
} from '@/app/shared/components/tabla-estandar';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { EstadoColaAntecedentes } from '../../service/robots/robots.service';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { ConsultaAntecedentesService, ResultadoLote } from './consulta-antecedentes.service';
import {
  CedulaLeida,
  FUENTES,
  FuenteAntecedente,
  LecturaCedulas,
  MAX_CEDULAS_CARGA,
  TIPOS_DOC,
  TIPOS_PDF_ANTECEDENTES,
  TipoDoc,
  entradasDeHoja,
  estadoFuente,
  leerCedulas,
  partirTexto,
} from './consulta-antecedentes.util';

/** Una persona consultada desde esta pantalla. */
export interface FilaConsulta {
  cedula: string;
  tipo: TipoDoc;
  /** Cuándo se agregó a la lista (ISO). */
  agregada: string;
  /** Resultado del último encolado en esta sesión. */
  encolado?: 'nueva' | 'reciente' | 'forzada' | 'error';
  cola?: EstadoColaAntecedentes | null;
  resultado?: ResultadoLote | null;
}

/** La lista se recuerda en este navegador para volver a verla luego (no es dato de negocio). */
const CLAVE_LISTA = 'tuapo.consulta-antecedentes.lista';
/** Mientras haya fuentes en cola se refresca cada 20 s. */
const REFRESCO_MS = 20_000;
/** Peticiones de encolado en paralelo. */
const PARALELO = 4;

/**
 * Contratación › Consulta de antecedentes.
 *
 * Pide los antecedentes de cédulas que todavía no se han registrado (una a una o
 * por Excel) y muestra lo que van trayendo los robots: el nombre que reporta
 * ADRES y el veredicto de cada fuente. Cuando la persona se registre después, la
 * ficha de contratación ya encuentra estos resultados y PDFs por su cédula.
 */
@Component({
  selector: 'app-consulta-antecedentes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './consulta-antecedentes.component.html',
  styleUrl: './consulta-antecedentes.component.css',
})
export class ConsultaAntecedentesComponent implements OnInit {
  private readonly api = inject(ConsultaAntecedentesService);
  private readonly sedes = inject(SedeScopeService);
  private readonly docs = inject(GestionDocumentalService);
  private readonly visor = inject(DocViewerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tiposDoc = TIPOS_DOC;
  readonly maxCarga = MAX_CEDULAS_CARGA;

  /* ---- Entrada ---- */
  texto = '';
  tipo: TipoDoc = 'CC';
  readonly lectura = signal<LecturaCedulas | null>(null);
  readonly archivo = signal<string | null>(null);

  /* ---- Estado ---- */
  readonly filas = signal<FilaConsulta[]>([]);
  readonly encolando = signal(false);
  readonly avance = signal({ hechas: 0, total: 0 });
  readonly refrescando = signal(false);
  readonly actualizadoEn = signal<Date | null>(null);
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  readonly resumen = computed(() => {
    const fs = this.filas();
    let completas = 0;
    let enCola = 0;
    let conNombre = 0;
    let alertas = 0;
    for (const f of fs) {
      if (this.obligatoriasListas(f) === 6) completas++;
      if (this.pendientes(f) > 0) enCola++;
      if (f.resultado?.nombre || f.resultado?.apellido) conNombre++;
      if (FUENTES.some((x) => String(f.resultado?.veredictos?.[x.veredicto] ?? '').toUpperCase() === 'NO CUMPLE')) alertas++;
    }
    return { total: fs.length, completas, enCola, conNombre, alertas };
  });

  /* ---- Tabla ---- */
  readonly idFila = (f: FilaConsulta) => f.cedula;

  readonly columnas: ColumnaTabla<FilaConsulta>[] = [
    { id: 'cedula', header: 'Cédula', valor: (f) => f.cedula, tarjeta: 'subtitulo' },
    { id: 'tipo', header: 'Tipo', valor: (f) => f.resultado?.tipo_documento || f.tipo, prioridad: 3 },
    {
      id: 'nombre', header: 'Nombres', tarjeta: 'titulo',
      valor: (f) => f.resultado?.nombre ?? '',
      formato: (f) => f.resultado?.nombre || '—',
    },
    {
      id: 'apellido', header: 'Apellidos',
      valor: (f) => f.resultado?.apellido ?? '',
      formato: (f) => f.resultado?.apellido || '—',
    },
    {
      id: 'ubicacion', header: 'Departamento / municipio', prioridad: 3,
      valor: (f) => [f.resultado?.departamento, f.resultado?.municipio].filter(Boolean).join(' / '),
      formato: (f) => [f.resultado?.departamento, f.resultado?.municipio].filter(Boolean).join(' / ') || '—',
    },
    {
      id: 'avance', header: 'Obligatorias', align: 'center', tarjeta: 'badge',
      valor: (f) => this.obligatoriasListas(f),
      badge: (f) => this.badgeAvance(f),
      copiaTexto: (f) => `${this.obligatoriasListas(f)}/6`,
    },
    ...FUENTES.map((fu): ColumnaTabla<FilaConsulta> => ({
      id: `f_${fu.cola}`,
      header: fu.etiqueta,
      align: 'center',
      prioridad: fu.obligatoria ? 2 : 3,
      valor: (f) => this.textoFuente(f, fu),
      badge: (f) => this.badgeFuente(f, fu),
    })),
    {
      id: 'actualizado', header: 'Última consulta', prioridad: 3,
      valor: (f) => f.resultado?.fecha_ultima_modificacion ?? f.cola?.updated_at ?? '',
      formato: (f) => this.fechaCorta(f.resultado?.fecha_ultima_modificacion ?? f.cola?.updated_at),
    },
  ];

  /** Zip en armado por la acción masiva «Descargar PDF» (una carpeta por cédula). */
  private zipLote: any = null;
  private zipLoteArchivos = 0;

  readonly accionesMasivas: AccionMasiva<FilaConsulta, any>[] = [
    {
      id: 'descargar', etiqueta: 'Descargar PDF', icono: 'folder_zip', tono: 'primario',
      preparar: async () => {
        const mod: any = await import('jszip');
        const JSZip = mod.default ?? mod;
        this.zipLote = new JSZip();
        this.zipLoteArchivos = 0;
        return true;
      },
      confirmar: {
        icono: 'info',
        texto: () => 'Se baja un solo .zip con una carpeta por cédula y el PDF más reciente de cada fuente.',
        boton: 'Descargar',
      },
      ejecutar: async (f) => {
        const n = await this.agregarAlZip(this.zipLote, f, `${f.cedula}/`);
        if (n === 0) throw new Error('Sin PDF todavía');
        this.zipLoteArchivos += n;
      },
      etiquetaFila: (f) => f.cedula,
      verbo: 'agregada(s) al zip',
      alTerminar: async () => {
        const zip = this.zipLote;
        this.zipLote = null;
        if (!zip || !this.zipLoteArchivos) return;
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `antecedentes_${this.sello()}.zip`);
      },
    },
    {
      id: 'forzar', etiqueta: 'Volver a consultar', icono: 'refresh', tono: 'aviso',
      preparar: async () => (await this.oficina()) ?? undefined,
      confirmar: {
        icono: 'warning',
        texto: () => 'Se vuelven a pedir las 8 fuentes aunque la consulta sea reciente. Cada '
          + 'consulta gasta CAPTCHAs y deja otro PDF en el expediente: úsalo solo si el dato no sirve.',
      },
      ejecutar: async (f, ctx) => {
        const r = await firstValueFrom(this.api.forzar(f.cedula, f.tipo, (ctx.datos as string | undefined) ?? null));
        this.marcar(f.cedula, { encolado: r?.accion === 'force_ya_abierto' ? 'nueva' : 'forzada' });
      },
      etiquetaFila: (f) => f.cedula,
      verbo: 'enviada(s) a consulta',
      alTerminar: () => this.refrescar(),
    },
    {
      id: 'quitar', etiqueta: 'Quitar de la lista', icono: 'playlist_remove', tono: 'neutro',
      confirmar: {
        icono: 'question',
        texto: () => 'Solo se quitan de esta pantalla. Los resultados y PDF siguen guardados por cédula.',
      },
      ejecutar: async (f) => {
        this.filas.update((fs) => fs.filter((x) => x.cedula !== f.cedula));
        this.guardarLista();
      },
      etiquetaFila: (f) => f.cedula,
      verbo: 'quitada(s)',
    },
  ];

  ngOnInit(): void {
    this.filas.set(this.leerLista());
    if (this.filas().length) this.refrescar();
    this.destroyRef.onDestroy(() => this.pararRefresco());
  }

  /* ================================================================== */
  /*  Entrada                                                            */
  /* ================================================================== */

  leerTexto(): void {
    this.archivo.set(null);
    const entradas = partirTexto(this.texto).map((e) => ({ ...e, tipo: this.tipo }));
    this.lectura.set(leerCedulas(entradas));
  }

  async leerExcel(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const XLSX: any = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      const filas: unknown[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' });
      const entradas = entradasDeHoja(filas).map((e) => ({ valor: e.valor, tipo: e.tipo ?? this.tipo }));
      const lectura = leerCedulas(entradas);
      if (!lectura.validas.length) {
        await Swal.fire('Sin cédulas', 'No encontré cédulas en la primera hoja del archivo. '
          + 'Pon las cédulas en una columna con el encabezado «Cédula».', 'warning');
        return;
      }
      this.texto = '';
      this.archivo.set(file.name);
      this.lectura.set(lectura);
    } catch {
      await Swal.fire('Archivo no válido', 'No se pudo leer el archivo. Usa un Excel (.xlsx, .xls) o .csv.', 'error');
    }
  }

  limpiarEntrada(): void {
    this.texto = '';
    this.archivo.set(null);
    this.lectura.set(null);
  }

  /** Encola lo leído y lo agrega a la lista. */
  async consultar(): Promise<void> {
    const lectura = this.lectura();
    if (!lectura?.validas.length || this.encolando()) return;
    let validas = lectura.validas;
    if (validas.length > MAX_CEDULAS_CARGA) {
      const r = await Swal.fire({
        icon: 'warning',
        title: `Son ${validas.length} cédulas`,
        html: `Se encolan las primeras <b>${MAX_CEDULAS_CARGA}</b>. Los robots completan unas 100 personas por `
          + 'hora y los portales del Estado bloquean por volumen: carga el resto cuando avancen.',
        showCancelButton: true,
        confirmButtonText: `Encolar ${MAX_CEDULAS_CARGA}`,
        cancelButtonText: 'Cancelar',
      });
      if (!r.isConfirmed) return;
      validas = validas.slice(0, MAX_CEDULAS_CARGA);
    }

    const oficina = await this.oficina();
    if (oficina === null) return;

    this.encolando.set(true);
    this.avance.set({ hechas: 0, total: validas.length });
    this.agregarALista(validas);

    const fallidas: string[] = [];
    const cola = [...validas];
    const trabajador = async () => {
      for (let c = cola.shift(); c; c = cola.shift()) {
        try {
          const r = await firstValueFrom(this.api.asegurar(c.cedula, c.tipo, oficina));
          const nueva = r?.accion === 'created' || r?.accion === 'reset';
          this.marcar(c.cedula, { encolado: nueva ? 'nueva' : 'reciente' });
        } catch {
          fallidas.push(c.cedula);
          this.marcar(c.cedula, { encolado: 'error' });
        }
        this.avance.update((a) => ({ ...a, hechas: a.hechas + 1 }));
      }
    };
    await Promise.all(Array.from({ length: PARALELO }, trabajador));

    this.encolando.set(false);
    this.limpiarEntrada();
    await this.refrescar();

    const filas = this.filas();
    const nuevas = filas.filter((f) => validas.some((v) => v.cedula === f.cedula) && f.encolado === 'nueva').length;
    const recientes = filas.filter((f) => validas.some((v) => v.cedula === f.cedula) && f.encolado === 'reciente').length;
    await Swal.fire({
      icon: fallidas.length ? 'warning' : 'success',
      title: 'Consulta enviada',
      html: `<b>${nuevas}</b> enviada(s) a los robots.`
        + (recientes ? `<br><b>${recientes}</b> ya tenían una consulta de los últimos 15 días: se muestra esa.` : '')
        + (fallidas.length ? `<br><b>${fallidas.length}</b> no se pudieron encolar: ${fallidas.slice(0, 10).join(', ')}` : '')
        + '<br><br><small>Los resultados van llegando en minutos (ADRES es la más lenta). '
        + 'Esta pantalla se actualiza sola.</small>',
    });
  }

  /* ================================================================== */
  /*  Lista y refresco                                                   */
  /* ================================================================== */

  async refrescar(): Promise<void> {
    this.pararRefresco();
    const cedulas = this.filas().map((f) => f.cedula);
    if (!cedulas.length) return;
    this.refrescando.set(true);
    try {
      const [estados, resultados] = await Promise.all([
        this.api.estados(cedulas),
        this.api.resultados(cedulas).catch(() => ({} as Record<string, ResultadoLote>)),
      ]);
      this.filas.update((fs) => fs.map((f) => ({
        ...f,
        cola: estados[f.cedula] ?? null,
        resultado: resultados[f.cedula] ?? f.resultado ?? null,
      })));
      this.actualizadoEn.set(new Date());
    } catch {
      // Un fallo de red no borra lo que ya se ve; se reintenta en la próxima vuelta.
    } finally {
      this.refrescando.set(false);
    }
    if (this.filas().some((f) => this.pendientes(f) > 0)) {
      this.temporizador = setTimeout(() => this.refrescar(), REFRESCO_MS);
    }
  }

  private pararRefresco(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = null;
  }

  private agregarALista(nuevas: CedulaLeida[]): void {
    const ahora = new Date().toISOString();
    this.filas.update((fs) => {
      const ya = new Set(fs.map((f) => f.cedula));
      const agregar = nuevas
        .filter((n) => !ya.has(n.cedula))
        .map((n): FilaConsulta => ({ cedula: n.cedula, tipo: n.tipo, agregada: ahora }));
      // Lo recién pedido arriba.
      return [...agregar, ...fs];
    });
    this.guardarLista();
  }

  private marcar(cedula: string, cambio: Partial<FilaConsulta>): void {
    this.filas.update((fs) => fs.map((f) => (f.cedula === cedula ? { ...f, ...cambio } : f)));
  }

  async vaciarLista(): Promise<void> {
    const r = await Swal.fire({
      icon: 'question',
      title: 'Vaciar la lista',
      text: 'Solo se limpia esta pantalla. Los resultados y PDF siguen guardados por cédula.',
      showCancelButton: true,
      confirmButtonText: 'Vaciar',
      cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.pararRefresco();
    this.filas.set([]);
    this.guardarLista();
  }

  private leerLista(): FilaConsulta[] {
    try {
      const raw = localStorage.getItem(CLAVE_LISTA);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr.filter((x) => x?.cedula).map((x) => ({ cedula: String(x.cedula), tipo: x.tipo ?? 'CC', agregada: x.agregada ?? '' }))
        : [];
    } catch {
      return [];
    }
  }

  private guardarLista(): void {
    try {
      localStorage.setItem(CLAVE_LISTA, JSON.stringify(
        this.filas().map((f) => ({ cedula: f.cedula, tipo: f.tipo, agregada: f.agregada }))));
    } catch {
      /* sin almacenamiento: la lista vive solo mientras la pantalla esté abierta */
    }
  }

  private async oficina(): Promise<string | null> {
    return this.sedes.oficinaParaRegistrar({ que: 'de estas consultas' });
  }

  /* ================================================================== */
  /*  PDF                                                                */
  /* ================================================================== */

  /** Tipo de documento con el que la cola consultó a la persona (la cola puede inferir PET). */
  private tipoDe(f: FilaConsulta): string {
    return f.cola?.tipo_documento || f.resultado?.tipo_documento || f.tipo;
  }

  /** PDF de antecedentes de una persona: el más reciente por tipo. Lanza si falla la consulta. */
  private async pdfsDe(f: FilaConsulta): Promise<[number, any][]> {
    // Un PET/PPT, CE… tiene sus PDF como `x<cédula>`: el servicio junta las dos llaves según el tipo.
    const lista: any[] = await firstValueFrom(
      this.docs.getDocumentosDeCandidato(f.cedula, { force: true, tipoDoc: this.tipoDe(f) }));
    // ms-documents lista del más nuevo al más viejo y no versiona: gana el primero por tipo.
    const porTipo = new Map<number, any>();
    for (const d of lista ?? []) {
      if (TIPOS_PDF_ANTECEDENTES[d?.type] && !porTipo.has(d.type)) porTipo.set(d.type, d);
    }
    return [...porTipo.entries()];
  }

  /**
   * Baja los PDF de la cédula (con el JWT, por el visor) y los mete en el zip bajo
   * `carpeta`. Devuelve cuántos entraron.
   */
  private async agregarAlZip(zip: any, f: FilaConsulta, carpeta = ''): Promise<number> {
    const cedula = f.cedula;
    const docs = await this.pdfsDe(f);
    let n = 0;
    for (const [t, d] of docs) {
      const blob = await this.visor.fetchBlob(d?.file_url);
      if (!blob) continue;
      const ext = blob.type === 'application/pdf' ? 'pdf' : (blob.type.split('/')[1] || 'bin');
      const nombre = `${cedula}_${TIPOS_PDF_ANTECEDENTES[t]}`.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_');
      zip.file(`${carpeta}${nombre}.${ext}`, blob);
      n++;
    }
    return n;
  }

  private sello(): string {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  async verPdfs(f: FilaConsulta): Promise<void> {
    let docs: [number, any][] = [];
    try {
      docs = await this.pdfsDe(f);
    } catch {
      await Swal.fire('Error', 'No se pudieron traer los documentos.', 'error');
      return;
    }
    if (!docs.length) {
      await Swal.fire('Sin PDF todavía', `Los robots aún no han dejado PDF de la cédula ${f.cedula}.`, 'info');
      return;
    }
    // El file_url llega RELATIVO y pide JWT: un <a href> lo resolvía contra el front y
    // abría la app en blanco. El visor lo baja con el token y abre el PDF como blob.
    const filas = docs
      .map(([t, d], i) => `<li><button type="button" data-doc="${i}" `
        + 'style="all:unset;cursor:pointer;color:#2563eb;text-decoration:underline">'
        + `${TIPOS_PDF_ANTECEDENTES[t]}</button> <small>${this.fechaCorta(d.uploaded_at)}</small></li>`)
      .join('');
    const r = await Swal.fire({
      title: `PDF de ${f.cedula}`,
      html: `<ul style="text-align:left;margin:0;padding-left:18px;line-height:1.9">${filas}</ul>`,
      showDenyButton: true,
      denyButtonText: `Descargar todos (${docs.length})`,
      denyButtonColor: '#111827',
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        popup.querySelectorAll<HTMLButtonElement>('button[data-doc]').forEach((b) =>
          b.addEventListener('click', async () => {
            const d = docs[Number(b.dataset['doc'])]?.[1];
            // openInNewTab reserva la pestaña en el mismo clic (si no, el navegador la bloquea).
            const ok = await this.visor.openInNewTab(d?.file_url);
            if (!ok) b.insertAdjacentHTML('afterend', ' <small style="color:#be123c">no se pudo abrir</small>');
          }));
      },
    });
    if (r.isDenied) await this.descargarZip([f]);
  }

  /** Un .zip con los PDF de las filas dadas (una carpeta por cédula si son varias). */
  async descargarZip(filas: FilaConsulta[]): Promise<void> {
    Swal.fire({ title: 'Preparando el zip…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const mod: any = await import('jszip');
      const JSZip = mod.default ?? mod;
      const zip = new JSZip();
      let total = 0;
      for (const [i, f] of filas.entries()) {
        if (filas.length > 1) Swal.update({ title: `Preparando el zip… ${i + 1} de ${filas.length}` });
        // Una cédula que falle no tumba el zip de las demás.
        total += await this.agregarAlZip(zip, f, filas.length > 1 ? `${f.cedula}/` : '').catch(() => 0);
      }
      if (!total) {
        await Swal.fire('Sin PDF', 'No se pudo bajar ningún PDF.', 'warning');
        return;
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const nombre = filas.length === 1 ? `antecedentes_${filas[0].cedula}.zip` : `antecedentes_${this.sello()}.zip`;
      Swal.close();
      saveAs(blob, nombre);
    } catch {
      await Swal.fire('Error', 'No se pudo armar el zip.', 'error');
    }
  }

  /* ================================================================== */
  /*  Presentación                                                       */
  /* ================================================================== */

  private estadoCola(f: FilaConsulta, fu: FuenteAntecedente): string | null | undefined {
    return (f.cola as any)?.[`estado_${fu.cola}`];
  }

  private veredicto(f: FilaConsulta, fu: FuenteAntecedente): string {
    const v = f.resultado?.veredictos?.[fu.veredicto];
    return v === null || v === undefined ? '' : String(v);
  }

  obligatoriasListas(f: FilaConsulta): number {
    return FUENTES.filter((fu) => fu.obligatoria && estadoFuente(this.estadoCola(f, fu)) === 'consultado').length;
  }

  pendientes(f: FilaConsulta): number {
    return FUENTES.filter((fu) => {
      const e = estadoFuente(this.estadoCola(f, fu));
      return fu.obligatoria && (e === 'en_cola' || e === 'consultando');
    }).length;
  }

  private badgeAvance(f: FilaConsulta): BadgeCelda {
    if (f.encolado === 'error') return { texto: 'No se encoló', tono: 'danger', icono: 'error' };
    if (!f.cola) return { texto: 'Sin consulta', tono: 'neutro' };
    const n = this.obligatoriasListas(f);
    if (n === 6) return { texto: '6/6', tono: 'ok', icono: 'check_circle' };
    return { texto: `${n}/6`, tono: this.pendientes(f) ? 'info' : 'warn', icono: this.pendientes(f) ? 'schedule' : undefined };
  }

  private textoFuente(f: FilaConsulta, fu: FuenteAntecedente): string {
    switch (estadoFuente(this.estadoCola(f, fu))) {
      case 'sin_fila': return '';
      case 'en_cola': return 'En cola';
      case 'consultando': return 'Consultando';
      case 'bloqueado': return 'Bloqueado';
      case 'consultado': return this.veredicto(f, fu) || 'Consultado';
    }
  }

  private badgeFuente(f: FilaConsulta, fu: FuenteAntecedente): BadgeCelda {
    const e = estadoFuente(this.estadoCola(f, fu));
    if (e === 'sin_fila') return { texto: '—', tono: 'neutro' };
    if (e === 'en_cola') return { texto: 'En cola', tono: 'neutro', icono: 'schedule' };
    if (e === 'consultando') return { texto: 'Consultando', tono: 'info', icono: 'sync' };
    if (e === 'bloqueado') return { texto: 'Verificar a mano', tono: 'warn', icono: 'block' };
    const v = this.veredicto(f, fu);
    const V = v.toUpperCase();
    if (V === 'CUMPLE') return { texto: 'Cumple', tono: 'ok' };
    if (V === 'NO CUMPLE') return { texto: 'No cumple', tono: 'danger' };
    if (!v) return { texto: 'Consultado', tono: 'neutro' };
    return { texto: v, tono: 'info' };
  }

  fechaCorta(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  }
}
