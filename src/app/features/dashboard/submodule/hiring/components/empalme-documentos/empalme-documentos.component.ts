import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, input, signal,
} from '@angular/core';
import { firstValueFrom, take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { SharedModule } from '@/app/shared/shared.module';
import { MatIconModule } from '@angular/material/icon';
import { PDFArray, PDFDocument, PDFPage, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import Swal from 'sweetalert2';

import { ElectronWindowService } from '@/app/core/services/electron-window.service';
import { ArchivosBackendService } from '../../service/archivos/archivos-backend.service';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import {
  DocumentosParametrizadosService,
  type DocumentosResueltos,
} from '../../service/documentos-parametrizados/documentos-parametrizados.service';
import {
  contratoEnCurso, filtroOtroContrato, procesoDelContrato, procesoVigente,
} from '../../pages/recruitment-pipeline/contrato.rules';

/** Un archivo del expediente de la persona. */
interface ArchivoExpediente {
  /** Id del documento en gestión documental. */
  id: string;
  /** Nombre con el que se guardó el archivo. */
  archivo: string;
  url: string;
  fecha: string | null;
}

/** Un documento del paquete, en la posición que le da el parametrizador. */
export interface ItemEmpalme {
  codigo: string;
  nombre: string;
  /** Tipo de gestión documental; null si el parametrizador no lo enlaza a ninguno. */
  typeId: number | null;
  forma: string;
  copias: number;
  obligatorio: boolean;
  /**
   * Lo que entra al PDF por este documento: el archivo vigente, el mismo que enseña «Todos los
   * documentos». Para los exámenes médicos, TODOS los soportes cargados en ese paso (ver
   * TIPOS_TODOS_LOS_ARCHIVOS). Vacío si no hay nada.
   */
  archivos: ArchivoExpediente[];
}

export interface PaqueteEmpalme {
  destino: DestinoEmpalme;
  titulo: string;
  /** Nombre de la columna en el parametrizador. */
  destinoTxt: string;
  icono: string;
  items: ItemEmpalme[];
  /** Cuántos documentos del paquete tienen archivo (los que entran al PDF). */
  presentes: number;
}

/**
 * La hoja de CONSTANCIA DE FIRMA ELECTRÓNICA que ms-templates (`ConstanciaFirma`) agrega al final
 * de cada documento firmado. Es la prueba de la firma y se queda en gestión documental, pero NO
 * va en la entrega. PDFBox escribe el título en hexadecimal por la «Ó» (WinAnsi D3); se busca
 * también en claro por si otra herramienta lo reescribe.
 */
const MARCAS_CONSTANCIA = ['434F4E5354414E434941204445204649524D4120454C454354', 'CONSTANCIA DE FIRMA ELECTR'];

function esConstanciaFirma(page: PDFPage): boolean {
  try {
    const ctx = page.doc.context;
    const contenido = page.node.Contents();
    const partes = contenido instanceof PDFArray
      ? contenido.asArray().map((r) => ctx.lookup(r))
      : [contenido];
    for (const p of partes) {
      if (!(p instanceof PDFRawStream)) continue;
      const texto = new TextDecoder('latin1').decode(decodePDFRawStream(p).decode()).toUpperCase();
      if (MARCAS_CONSTANCIA.some((m) => texto.includes(m))) return true;
    }
  } catch {
    // Un contenido que no se sabe leer no es la constancia (esa la escribe PDFBox, sin rarezas).
  }
  return false;
}

/**
 * Tipos que se entregan con TODOS sus archivos y no solo el vigente. En «Exámenes médicos» se
 * sube un archivo por examen (todos tipo 32) y el resultado son esos soportes pegados juntos,
 * como los lista ese paso del pipeline (los del contrato en curso).
 */
const TIPOS_TODOS_LOS_ARCHIVOS: ReadonlySet<number> = new Set([32]);

type DestinoEmpalme = 'TRABAJADOR' | 'TRABAJADOR_FINCA' | 'ESCANER_USUARIA';

/**
 * Los tres paquetes, en el orden en que se muestran. El destino es la columna de la matriz
 * documental del parametrizador (ms-auth-admin); ARCHIVO_TEMPORAL no se empalma aquí.
 */
const PAQUETES: readonly { destino: DestinoEmpalme; titulo: string; destinoTxt: string; icono: string }[] = [
  { destino: 'TRABAJADOR', titulo: 'Empleado', destinoTxt: 'Trabajador', icono: 'person' },
  {
    destino: 'TRABAJADOR_FINCA', titulo: 'Documentos que el empleado debe entregar a la finca',
    destinoTxt: 'Trabajador (finca)', icono: 'badge',
  },
  {
    destino: 'ESCANER_USUARIA', titulo: 'Documentos para la finca',
    destinoTxt: 'Escáner usuaria (digital)', icono: 'document_scanner',
  },
];

type EstadoParametrizacion =
  | { estado: 'CARGANDO' }
  | { estado: 'OK'; datos: DocumentosResueltos }
  | { estado: 'SIN_VACANTE' }
  | { estado: 'ERROR'; mensaje: string };

/**
 * ORGANIZACIÓN DE EMPALME
 *
 * Arma, con los archivos que ya están en el expediente, los tres paquetes que pide la matriz
 * documental de la empresa usuaria: lo que se le entrega al empleado, lo que el empleado
 * entrega en la finca y lo que se le manda escaneado a la finca. Cada paquete es UN PDF.
 *
 * Qué entra y en qué orden NO se decide aquí: sale del parametrizador (destino y orden de
 * cada documento, resuelto por la vacante del proceso). Aquí solo se previsualiza y se
 * descarga. Un documento que la matriz pide y no está en el expediente se lista como
 * faltante y el PDF sale sin él. El PDF se arma en el navegador (pdf-lib).
 */
@Component({
  selector: 'app-empalme-documentos',
  standalone: true,
  imports: [SharedModule, MatIconModule],
  templateUrl: './empalme-documentos.component.html',
  styleUrls: ['./empalme-documentos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpalmeDocumentosComponent {
  candidatoSeleccionado = input<any | null>(null);
  /** Cédula ya resuelta por el pipeline (el registro puede traerla vacía). */
  cedula = input<string | null>(null);
  /** Sube con cada consulta nueva del buscador: obliga a releer el expediente. */
  consultaSeq = input<number>(0);

  private readonly docsSrv = inject(GestionDocumentalService);
  private readonly vacantesSrv = inject(VacantesService);
  private readonly docsParametrizados = inject(DocumentosParametrizadosService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly ventanas = inject(ElectronWindowService);
  /** `file_url` es una ruta protegida: hay que pedirla con el token. */
  private readonly archivos = inject(ArchivosBackendService);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  /** Destino que se está empalmando, o null. */
  readonly uniendo = signal<DestinoEmpalme | null>(null);

  /**
   * Archivos de cada tipo documental del contrato en curso que entran al empalme: el vigente (el de
   * «Todos los documentos») o, en TIPOS_TODOS_LOS_ARCHIVOS, todos en orden de carga.
   */
  private readonly expediente = signal<ReadonlyMap<number, ArchivoExpediente[]>>(new Map());
  readonly parametrizacion = signal<EstadoParametrizacion | null>(null);
  /**
   * Lo que «Todos los documentos» deja ver de la requisición (ms-templates `permitidos`). Con la
   * regla activa, un documento que la sección no ofrece —no chuleado o que no le aplica a esta
   * persona— tampoco entra al empalme. null = sin regla o sin respuesta: no se recorta.
   */
  private readonly tiposDeLaSeccion = signal<ReadonlySet<number> | null>(null);

  /** Cédula con la que se trabaja. */
  readonly cedulaEfectiva = computed<string>(() => {
    const explicita = (this.cedula() ?? '').toString().trim();
    if (explicita) return explicita;
    const cand = this.candidatoSeleccionado();
    return cand?.numero_documento ? String(cand.numero_documento).trim() : '';
  });

  /** Los tres paquetes con sus documentos en el orden del parametrizador. */
  readonly paquetes = computed<PaqueteEmpalme[]>(() => {
    const p = this.parametrizacion();
    if (p?.estado !== 'OK') return [];
    const exp = this.expediente();
    const seccion = this.tiposDeLaSeccion();
    const tipoPorCodigo = new Map<string, number | null>(
      p.datos.documentos.map((d) => [d.tipo.codigo, d.tipo.tipo_documento_ref ?? null]));
    const ordenGeneral = new Map<string, number | null>(
      p.datos.documentos.map((d) => [d.tipo.codigo, d.orden_archivo ?? null]));
    // Orden GENERAL del parametrizador (orden de archivo, vacíos al final y luego código: el
    // mismo criterio de la vista General) para los tres paquetes. El orden propio de cada
    // destino (`destinos[x].orden`) se ignora a propósito: se ordena en un solo sitio.
    const porGeneral = (a: ItemEmpalme, b: ItemEmpalme): number => {
      const oa = ordenGeneral.get(a.codigo) ?? Number.MAX_SAFE_INTEGER;
      const ob = ordenGeneral.get(b.codigo) ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0;
    };

    return PAQUETES.map((def) => {
      const resuelto = p.datos.paquetes.find((x) => x.destino === def.destino);
      const items: ItemEmpalme[] = [];
      for (const it of resuelto?.items ?? []) {
        const typeId = tipoPorCodigo.get(it.codigo) ?? null;
        if (seccion && (typeId == null || !seccion.has(typeId))) continue;
        items.push({
          codigo: it.codigo,
          nombre: it.nombre,
          typeId,
          forma: it.forma,
          copias: it.copias ?? 0,
          obligatorio: !!it.obligatorio,
          archivos: typeId != null ? exp.get(typeId) ?? [] : [],
        });
      }
      items.sort(porGeneral);
      return { ...def, items, presentes: items.filter((i) => i.archivos.length).length };
    });
  });

  /** Clave del último expediente leído, para no releerlo en cada refresco. */
  private leidoPara: string | null = null;

  constructor() {
    effect(() => {
      const ced = this.cedulaEfectiva();
      const cand = this.candidatoSeleccionado();
      // Con un contrato anterior el empalme es el del contrato EN CURSO (ver contratoEnCurso);
      // el proceso entra en la clave para releer tras "Dar de baja".
      const curso = contratoEnCurso(cand);
      const clave = ced ? `${ced}#${this.consultaSeq()}#${curso?.procesoId ?? ''}` : null;
      if (clave === this.leidoPara) return;
      this.leidoPara = clave;
      this.expediente.set(new Map());
      this.parametrizacion.set(null);
      this.tiposDeLaSeccion.set(null);
      this.cerrarVisor();
      if (ced) {
        this.cargarExpediente(ced, curso);
        void this.cargarParametrizacion(ced, cand);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.visorNodo?.remove();
      if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    });
  }

  private cargarExpediente(cedula: string, curso: ReturnType<typeof contratoEnCurso>): void {
    this.cargando.set(true);
    this.error.set(null);

    this.docsSrv.getDocuments(cedula)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r: unknown) => {
          const lista = Array.isArray(r)
            ? r
            : ((r as Record<string, unknown>)?.['results'] as unknown[]) ?? [];

          // Misma regla que «Todos los documentos» (documentos-paquete): fuera lo del contrato
          // anterior y UN archivo por tipo, el primero, que es el vigente (el backend lista por id
          // descendente). Las cargas viejas del mismo tipo siguen activas en gestión documental
          // —antecedentes, ADRES, ARL se reconsultan— y no deben colarse en el PDF.
          const porTipo = new Map<number, ArchivoExpediente[]>();
          const esDeOtroContrato = filtroOtroContrato(curso, lista as any[]);
          const vistos = new Set<number>();
          for (const d of lista as Array<Record<string, unknown>>) {
            const typeId = Number(d?.['type']);
            if (!Number.isFinite(typeId)) continue;
            if (esDeOtroContrato(d)) continue;
            const todos = TIPOS_TODOS_LOS_ARCHIVOS.has(typeId);
            if (!todos && vistos.has(typeId)) continue;
            vistos.add(typeId);
            const url = String(d?.['file_url'] ?? '').trim();
            // El vigente sin archivo deja el tipo vacío: no se cae a una carga anterior.
            if (!url) continue;
            const fila: ArchivoExpediente = {
              id: String(d?.['id'] ?? url),
              archivo: String(d?.['title'] ?? d?.['fileName'] ?? '').trim(),
              url,
              fecha: (d?.['uploaded_at'] as string) ?? null,
            };
            // El listado viene del más nuevo al más viejo: los soportes se pegan en orden de carga.
            const arr = porTipo.get(typeId);
            if (!arr) porTipo.set(typeId, [fila]);
            else if (todos && !arr.some((a) => a.id === fila.id)) arr.unshift(fila);
          }

          this.expediente.set(porTipo);
          this.cargando.set(false);
        },
        error: () => {
          this.error.set('No se pudo leer el expediente. Reintenta en un momento.');
          this.cargando.set(false);
        },
      });
  }

  /**
   * Matriz documental de la REMISIÓN de la persona: la empresa usuaria y el centro de su requisición
   * vigente, tal como los resuelve ms-templates (`permitidos`, `entrevistas[0].proceso.publicacion_id`),
   * que es la misma regla de «Todos los documentos». Solo si el servidor no la da, la vacante del
   * proceso en curso. El orden de los paquetes es el General del parametrizador para esa empresa
   * (ver `paquetes`): se vuelve a pedir al armar cada PDF, así que un cambio de orden en
   * Parametrización de vacantes → Documentos se ve sin recargar la pantalla.
   *
   * @param silencioso no pinta «cargando» (relectura al armar el PDF).
   */
  private async cargarParametrizacion(cedula: string, cand: unknown, silencioso = false): Promise<void> {
    const clave = this.leidoPara;
    if (!silencioso) this.parametrizacion.set({ estado: 'CARGANDO' });

    let res: EstadoParametrizacion;
    let seccion: ReadonlySet<number> | null = null;
    try {
      let datos: DocumentosResueltos | null = null;
      const perm = await firstValueFrom(this.docsParametrizados.permitidos(cedula));
      if (DocumentosParametrizadosService.restringe(perm) && perm.restriccion === 'BLOQUEO' && perm.estado === 'OK') {
        // Lo que la sección ofrece y le aplica a esta persona (los de foráneos a quien no lo es, no).
        seccion = new Set(perm.documentos
          .filter((d) => d.aplica && d.tipo_documento_ref != null)
          .map((d) => d.tipo_documento_ref as number));
      }
      const centro = perm?.requisicion?.centro_canonico_id ?? null;
      if (centro != null) {
        datos = await firstValueFrom(this.docsParametrizados.resueltosPorCentro(centro));
      } else {
        const p = (procesoVigente(cand) ?? procesoDelContrato(cand)) as Record<string, unknown> | null;
        const vacanteId = p?.['publicacion'] ?? null;
        if (vacanteId != null && vacanteId !== '') {
          const v = await firstValueFrom(this.vacantesSrv.obtenerVacante(String(vacanteId))).catch(() => null);
          if (v) datos = await firstValueFrom(this.docsParametrizados.resueltosDeVacante(v as Record<string, unknown>));
        }
      }
      res = datos ? { estado: 'OK', datos } : { estado: 'SIN_VACANTE' };
    } catch (e: any) {
      res = {
        estado: 'ERROR',
        mensaje: e?.error?.error ?? 'No se pudo leer la parametrización documental de la remisión.',
      };
    }
    // Si mientras tanto se cambió de persona, esta respuesta ya no es de nadie.
    if (this.leidoPara !== clave) return;
    // Una relectura fallida no borra lo que ya estaba en pantalla.
    if (silencioso && res.estado !== 'OK') return;
    this.tiposDeLaSeccion.set(seccion);
    this.parametrizacion.set(res);
  }

  recargar(): void {
    this.leidoPara = null;
    const ced = this.cedulaEfectiva();
    if (!ced) return;
    const cand = this.candidatoSeleccionado();
    const curso = contratoEnCurso(cand);
    this.leidoPara = `${ced}#${this.consultaSeq()}#${curso?.procesoId ?? ''}`;
    this.cargarExpediente(ced, curso);
    void this.cargarParametrizacion(ced, cand);
  }

  // ── Visor ────────────────────────────────────────────────────────────────

  readonly visorSrc = signal<SafeResourceUrl | null>(null);
  readonly visorTitulo = signal<string>('');
  private visorUrl: string | null = null;
  /** URL del PDF empalmado en memoria, para revocarla al cerrar. */
  private blobUrl: string | null = null;
  private visorNodo: HTMLElement | null = null;

  /**
   * El visor se cuelga del <body>: este componente vive dentro de un mat-tab, cuyo contenido
   * lleva `transform`, y un `position: fixed` ahí dentro no se centra en la pantalla.
   */
  @ViewChild('visorEl') set visorEl(el: ElementRef<HTMLElement> | undefined) {
    if (!el) return;
    this.visorNodo = el.nativeElement;
    if (el.nativeElement.parentElement !== document.body) document.body.appendChild(el.nativeElement);
  }

  private abrirVisor(url: string, titulo: string): void {
    this.visorUrl = url;
    this.visorTitulo.set(titulo);
    this.visorSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(`${url}#view=Fit`));
  }

  cerrarVisor(): void {
    this.visorSrc.set(null);
    this.visorTitulo.set('');
    this.visorUrl = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  abrirFuera(): void {
    if (this.visorUrl) this.ventanas.openExternal(this.visorUrl);
  }

  descargarDelVisor(): void {
    if (!this.visorUrl) return;
    this.bajarArchivo(this.visorUrl, this.visorTitulo() || 'empalme.pdf');
  }

  private bajarArchivo(url: string, nombre: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── El empalme ───────────────────────────────────────────────────────────

  /** Nombre del PDF: paquete, cédula y fecha, que es como se archiva. */
  private nombreSalida(p: PaqueteEmpalme): string {
    const ced = this.cedulaEfectiva() || 'expediente';
    const hoy = new Date().toISOString().slice(0, 10);
    const paquete = p.destinoTxt
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `Empalme_${paquete}_${ced}_${hoy}.pdf`;
  }

  descargar(p: PaqueteEmpalme): void {
    void this.unir(p, true);
  }

  previsualizar(p: PaqueteEmpalme): void {
    void this.unir(p, false);
  }

  /**
   * Arma el PDF del paquete en el orden del parametrizador.
   *
   * Se descarga por bloques —quince conexiones a la vez ahogan al navegador—
   * pero se anexa SIEMPRE en el orden del paquete. Los formularios se aplanan
   * antes de copiarse, o los campos rellenados (la huella, las firmas) se
   * pierden al fundir. Por documento entra el archivo vigente (los exámenes, todos sus soportes).
   */
  private async unir(paquete: PaqueteEmpalme, descargar: boolean): Promise<void> {
    if (this.uniendo()) return;
    // El orden se relee del parametrizador justo ahora: si alguien lo cambió, el PDF sale con el nuevo.
    this.uniendo.set(paquete.destino);
    const ced = this.cedulaEfectiva();
    if (ced) await this.cargarParametrizacion(ced, this.candidatoSeleccionado(), true);
    const p = this.paquetes().find((x) => x.destino === paquete.destino) ?? paquete;

    const usados = new Set<string>();
    const elegidos: { titulo: string; url: string }[] = [];
    for (const it of p.items) {
      for (const a of it.archivos) {
        if (usados.has(a.id)) continue;
        usados.add(a.id);
        elegidos.push({ titulo: it.nombre, url: a.url });
      }
    }
    if (!elegidos.length) {
      this.uniendo.set(null);
      return;
    }

    Swal.fire({
      title: `Empalmando: ${p.titulo}`,
      text: `Descargando y uniendo ${elegidos.length} archivo(s)…`,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const final = await PDFDocument.create();
      final.setTitle(`${p.titulo} — ${this.cedulaEfectiva()}`);
      final.setCreator('TesoroApp');

      const BLOQUE = 8;
      const fallidos: string[] = [];
      let anexados = 0;

      for (let i = 0; i < elegidos.length; i += BLOQUE) {
        const bloque = elegidos.slice(i, i + BLOQUE);
        Swal.update({
          text: `Documentos ${i + 1}–${Math.min(i + BLOQUE, elegidos.length)}`
              + ` de ${elegidos.length}`,
        });

        const bajados = await Promise.allSettled(bloque.map(async (d) => {
          // `fetch` a pelo no sirve: `file_url` es una ruta protegida
          // (`/api/v1/documents/…`) y el gateway responde 401 sin token; contra
          // el origen del front devolvía el index.html, que "unía" HTML.
          const b = await firstValueFrom(this.archivos.blob(d.url));
          if (!b || b.size === 0) throw new Error('vacío');
          return { doc: d, tipo: b.type || '', buffer: await b.arrayBuffer() };
        }));

        // Secuencial y en el orden del bloque: `allSettled` conserva el orden
        // de entrada, así que el PDF sale como está en pantalla.
        for (let j = 0; j < bajados.length; j++) {
          const r = bajados[j];
          if (r.status !== 'fulfilled') {
            fallidos.push(bloque[j].titulo);
            continue;
          }
          const { doc, tipo, buffer } = r.value;
          try {
            const esImagen = tipo.includes('image/')
              || /\.(jpe?g|png)$/i.test(doc.url);
            if (esImagen) {
              const png = tipo.includes('png') || /\.png$/i.test(doc.url);
              const img = png
                ? await final.embedPng(buffer)
                : await final.embedJpg(buffer);
              const page = final.addPage([img.width, img.height]);
              page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
            } else {
              const origen = await PDFDocument.load(buffer, { ignoreEncryption: true });
              try {
                origen.getForm().flatten();
              } catch {
                // Sin formulario, o con campos que pdf-lib no sabe aplanar: se
                // copia igual, que es mejor que perder el documento entero.
              }
              // Sin la hoja de constancia de firma electrónica: no va en la entrega.
              const indices = origen.getPages()
                .map((pg, k) => (esConstanciaFirma(pg) ? -1 : k))
                .filter((k) => k >= 0);
              const paginas = await final.copyPages(origen, indices);
              for (const pg of paginas) final.addPage(pg);
            }
            anexados++;
          } catch {
            fallidos.push(doc.titulo);
          }
        }
      }

      if (!anexados) {
        Swal.fire({
          icon: 'error',
          title: 'No se pudo empalmar',
          text: 'Ninguno de los archivos se pudo leer. Revisa que abran uno a uno.',
        });
        return;
      }

      Swal.update({ text: 'Cerrando el PDF…' });
      const bytes = await final.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });

      if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = URL.createObjectURL(blob);

      Swal.close();

      if (descargar) {
        const url = this.blobUrl;
        this.bajarArchivo(url, this.nombreSalida(p));
        // El navegador ya tiene el archivo: la URL en memoria solo hace falta
        // hasta que termine de guardarlo.
        setTimeout(() => {
          if (this.blobUrl === url) {
            URL.revokeObjectURL(url);
            this.blobUrl = null;
          }
        }, 30_000);
      } else {
        this.abrirVisor(this.blobUrl, this.nombreSalida(p));
      }

      if (fallidos.length) {
        Swal.fire({
          icon: 'warning',
          title: `Quedaron fuera ${fallidos.length} documento(s)`,
          html: `No se pudieron leer:<br><b>${fallidos.join('<br>')}</b>`
              + '<br><br>El resto sí quedó en el PDF.',
        });
      }
    } catch (e: unknown) {
      console.error('[empalme] Falló la unión:', e);
      Swal.fire({
        icon: 'error',
        title: 'Error al empalmar',
        text: (e as Error)?.message || 'No se pudo armar el PDF. Reintenta.',
      });
    } finally {
      this.uniendo.set(null);
    }
  }
}
