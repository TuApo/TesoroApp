import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { catchError, of, take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SharedModule } from '@/app/shared/shared.module';
import { MatIconModule } from '@angular/material/icon';
import { PDFDocument } from 'pdf-lib';
import Swal from 'sweetalert2';

import { ElectronWindowService } from '@/app/core/services/electron-window.service';

import { ArchivosBackendService } from '../../service/archivos/archivos-backend.service';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';
import { procesoDelContrato, procesoVigente } from '../../pages/recruitment-pipeline/contrato.rules';
import {
  DOCUMENTOS_PAQUETE,
  TYPE_ID_POR_TITULO,
  esSoloSubir,
} from '../../shared/paquete-documental.data';
import {
  DocSeccion, SECCION_LABELS, getDocSeccion, isDocumentoVisible,
} from '../generate-contracting-documents/documentos-por-empresa.config';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/** Un documento del paquete y en qué va. */
export interface ItemPaquete {
  titulo: string;
  /** `true` = llega de fuera y hay que subirlo; `false` = lo genera la plataforma. */
  soloSubir: boolean;
  /** Ya está en el expediente. */
  listo: boolean;
  /** Tipo con el que lo guarda gestión documental; `null` si aún no tiene. */
  typeId: number | null;
  /** URL del archivo cuando ya está subido, para poder abrirlo. */
  fileUrl: string | null;
  /** Nombre con el que quedó guardado. */
  nombreArchivo: string | null;
  /** Rama del árbol documental a la que pertenece. */
  seccion: DocSeccion | null;
  /**
   * Aplica a ESTA persona según su empresa usuaria y su finca. Los que no
   * aplican se siguen listando —el catálogo entero está a la vista— pero no
   * cuentan para cerrar el día.
   */
  delPaquete: boolean;
}

/** Una rama del árbol documental, con lo que le toca a esta persona. */
export interface RamaPaquete {
  key: DocSeccion | 'otros';
  label: string;
  icon: string;
  items: ItemPaquete[];
  listos: number;
}

/**
 * El paquete documental del día, de un vistazo.
 *
 * Qué documentos le tocan a ESTA persona depende de la empresa usuaria y la
 * finca de su vacante, así que la lista no es fija: se resuelve con las mismas
 * reglas que usa el generador (`documentos-por-empresa.config`) y sobre la
 * misma lista de títulos (`shared/paquete-documental.data`). Aquí no se
 * genera ni se sube nada —eso es la pantalla de generación, que son catorce
 * mil líneas—: esto dice QUÉ falta para cerrar el paquete y lleva allá.
 */
@Component({
  selector: 'app-documentos-paquete',
  standalone: true,
  imports: [SharedModule, MatIconModule],
  templateUrl: './documentos-paquete.component.html',
  styleUrls: ['./documentos-paquete.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentosPaqueteComponent {
  candidatoSeleccionado = input<any | null>(null);
  /**
   * Cédula ya resuelta por el pipeline.
   *
   * Hay registros cargados a los que `numero_documento` les llega vacío —la
   * ficha los pinta con "CC · —"— y este módulo se quedaba en "busca primero a
   * la persona" con la persona delante. El pipeline sabe con qué documento se
   * buscó; que lo diga.
   */
  cedula = input<string | null>(null);
  /** Sube con cada consulta nueva del buscador: obliga a releer el expediente. */
  consultaSeq = input<number>(0);

  /** Con qué cédula se trabaja: la del registro o, si falta, la buscada. */
  readonly cedulaEfectiva = computed<string>(() => {
    const explicita = (this.cedula() ?? '').toString().trim();
    if (explicita) return explicita;
    const cand = this.candidatoSeleccionado();
    return cand?.numero_documento ? String(cand.numero_documento).trim() : '';
  });

  private readonly docsSrv = inject(GestionDocumentalService);
  private readonly vacantesSrv = inject(VacantesService);
  private readonly nav = inject(PipelineNavService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ventanas = inject(ElectronWindowService);
  /** `file_url` es una ruta protegida, no una URL pintable. Ver el servicio. */
  private readonly archivos = inject(ArchivosBackendService);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  /** Lo que ya está en el expediente, por tipo: sirve para marcar y para abrir. */
  private readonly docPorTipo = signal<ReadonlyMap<number, { url: string; nombre: string }>>(new Map());
  private readonly sanitizer = inject(DomSanitizer);

  /** Visor en la propia pantalla: abrir en otra pestaña pierde el sitio. */
  readonly visorSrc = signal<SafeResourceUrl | null>(null);
  readonly visorTitulo = signal<string>('');
  readonly visorUrl = signal<string | null>(null);
  /** Código del contrato: acompaña a cada documento que se sube. */
  private codigoContratacion: string | null = null;
  /** Documento subiéndose ahora mismo (título), para bloquear su fila. */
  readonly subiendo = signal<string | null>(null);
  /** Vacante remitida: de ella dependen los documentos que aplican. */
  private readonly vacante = signal<Record<string, unknown> | null>(null);

  /** Clave del último expediente leído, para no releerlo en cada refresco. */
  private leidoPara: string | null = null;

  constructor() {
    effect(() => {
      const cand = this.candidatoSeleccionado();
      const ced = this.cedulaEfectiva() || null;
      const clave = ced ? `${ced}#${this.consultaSeq()}` : null;
      if (clave === this.leidoPara) return;
      this.leidoPara = clave;
      this.vacante.set(null);
      this.docPorTipo.set(new Map());
      if (ced) this.cargar(ced, cand);
    });

    // El avance alimenta el rail, igual que los demás sub-pasos. Cuenta SOLO
    // los que aplican a esta persona: el catálogo entero está a la vista, pero
    // un documento de otra empresa no puede contar como pendiente suyo.
    effect(() => {
      const items = this.itemsPaquete();
      this.nav.publicar('documentos', {
        hechos: items.filter((i) => i.listo).length,
        total: items.length,
      });
    });
  }

  private cargar(cedula: string, cand: unknown): void {
    this.cargando.set(true);
    this.error.set(null);

    const proc = procesoDelContrato(cand) ?? procesoVigente(cand) as Record<string, unknown> | null;
    const p = proc as Record<string, any> | null;
    this.codigoContratacion =
      p?.['contrato_codigo'] ?? p?.['contrato']?.['codigo_contrato'] ?? null;
    const vacanteId = p?.['publicacion'] ?? null;

    if (vacanteId) {
      this.vacantesSrv.obtenerVacante(String(vacanteId))
        .pipe(take(1), catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
        .subscribe((v) => this.vacante.set((v as Record<string, unknown>) ?? null));
    }

    this.docsSrv.getDocuments(cedula)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r: unknown) => {
          const lista = Array.isArray(r)
            ? r
            : ((r as Record<string, unknown>)?.['results'] as unknown[]) ?? [];
          const porTipo = new Map<number, { url: string; nombre: string }>();
          for (const d of lista as Array<Record<string, unknown>>) {
            const t = Number(d?.['type']);
            if (!Number.isFinite(t)) continue;
            // Se queda el primero: el backend ya devuelve el vigente de cada tipo.
            if (porTipo.has(t)) continue;
            porTipo.set(t, {
              url: String(d?.['file_url'] ?? ''),
              nombre: String(d?.['title'] ?? d?.['fileName'] ?? ''),
            });
          }
          this.docPorTipo.set(porTipo);
          this.cargando.set(false);
        },
        error: () => {
          this.error.set('No se pudo leer el expediente. Reintenta o ábrelo en Generar documentación.');
          this.cargando.set(false);
        },
      });
  }

  /**
   * EL CATÁLOGO ENTERO, con el estado de cada documento para esta persona.
   *
   * Antes esta lista venía ya filtrada por empresa usuaria y finca, así que un
   * documento que hacía falta pero no estaba en el perfil —o, peor, toda la
   * lista cuando aún no hay vacante remitida— simplemente no existía en
   * pantalla. Ahora se listan TODOS: los que genera la plataforma y los que
   * hay que subir, y cada uno dice si entra en el paquete de esta persona
   * (`delPaquete`). Lo que se filtra es la VISTA, no los datos.
   */
  readonly items = computed<ItemPaquete[]>(() => {
    const v = this.vacante();
    const ctx = {
      temporal: (v?.['temporal'] as string) ?? null,
      empresaUsuaria: (v?.['empresaUsuariaSolicita'] as string) ?? null,
      finca: (v?.['finca'] as string) ?? null,
    };
    const presentes = this.docPorTipo();

    return DOCUMENTOS_PAQUETE.map((titulo) => {
      const typeId = TYPE_ID_POR_TITULO[titulo] ?? null;
      const doc = typeId !== null ? presentes.get(typeId) ?? null : null;
      return {
        titulo,
        soloSubir: esSoloSubir(titulo),
        listo: !!doc,
        typeId,
        fileUrl: doc?.url || null,
        nombreArchivo: doc?.nombre || null,
        seccion: getDocSeccion(titulo),
        delPaquete: isDocumentoVisible(titulo, ctx),
      };
    });
  });

  /** Los que le tocan a esta persona: son los que cierran el día. */
  readonly itemsPaquete = computed(() => this.items().filter((i) => i.delPaquete));

  /** Los que genera la plataforma. */
  readonly generables = computed(() => this.items().filter((i) => !i.soloSubir));
  /** Los que hay que subir. */
  readonly porSubir = computed(() => this.items().filter((i) => i.soloSubir));

  /**
   * QUÉ SE ESTÁ MIRANDO.
   *
   * `todos` es el arranque a propósito: la pregunta que trae aquí suele ser
   * "¿dónde subo esto?", y un documento que no está en el perfil de la empresa
   * seguía habiendo que subirlo. Los demás filtros son las tres preguntas que
   * se hacen de verdad: qué falta para cerrar, qué se genera y qué hay que
   * subir a mano.
   */
  readonly filtro = signal<'todos' | 'paquete' | 'faltan' | 'generan' | 'subir'>('todos');

  verFiltro(f: 'todos' | 'paquete' | 'faltan' | 'generan' | 'subir'): void {
    this.filtro.set(f);
  }

  readonly filtros: ReadonlyArray<{ id: 'todos' | 'paquete' | 'faltan' | 'generan' | 'subir'; label: string; icon: string }> = [
    { id: 'todos',   label: 'Todos',        icon: 'apps' },
    { id: 'paquete', label: 'Del paquete',  icon: 'inventory_2' },
    { id: 'faltan',  label: 'Faltan',       icon: 'error_outline' },
    { id: 'generan', label: 'Se generan',   icon: 'auto_fix_high' },
    { id: 'subir',   label: 'Por subir',    icon: 'cloud_upload' },
  ];

  /** Cuántos hay en cada filtro: el número es parte de la decisión. */
  cuantos(id: 'todos' | 'paquete' | 'faltan' | 'generan' | 'subir'): number {
    return this.aplicarFiltro(this.items(), id).length;
  }

  private aplicarFiltro(items: readonly ItemPaquete[], f: string): ItemPaquete[] {
    switch (f) {
      case 'paquete': return items.filter((i) => i.delPaquete);
      case 'faltan':  return items.filter((i) => i.delPaquete && !i.listo);
      case 'generan': return items.filter((i) => !i.soloSubir);
      case 'subir':   return items.filter((i) => i.soloSubir);
      default:        return [...items];
    }
  }

  /** Lo que se pinta ahora mismo. */
  readonly itemsVisibles = computed(() => this.aplicarFiltro(this.items(), this.filtro()));

  /**
   * El paquete repartido por las ramas del árbol documental.
   *
   * Es el MISMO reparto que usa la pantalla de generación
   * (`SECCION_LABELS` / `getDocSeccion`), para que un documento esté en la
   * misma rama se mire por donde se mire. Las ramas vacías no se pintan, y lo
   * que no tenga rama declarada cae en "Otros" en vez de desaparecer.
   */
  readonly ramas = computed<RamaPaquete[]>(() => {
    const porRama = new Map<string, ItemPaquete[]>();
    for (const it of this.itemsVisibles()) {
      const k = it.seccion ?? 'otros';
      const arr = porRama.get(k);
      if (arr) arr.push(it); else porRama.set(k, [it]);
    }

    const out: RamaPaquete[] = [];
    for (const s of SECCION_LABELS) {
      const items = porRama.get(s.key);
      if (!items?.length) continue;
      out.push({ key: s.key, label: s.label, icon: s.icon, items,
        listos: items.filter((i) => i.listo).length });
    }
    const otros = porRama.get('otros');
    if (otros?.length) {
      out.push({ key: 'otros', label: 'Otros', icon: 'folder', items: otros,
        listos: otros.filter((i) => i.listo).length });
    }
    return out;
  });

  readonly listosGenerables = computed(() => this.generables().filter((i) => i.listo).length);
  readonly listosPorSubir = computed(() => this.porSubir().filter((i) => i.listo).length);

  /** Los que genera la plataforma DENTRO del paquete de esta persona. */
  readonly generablesPaquete = computed(() => this.itemsPaquete().filter((i) => !i.soloSubir));
  /** Los que hay que subir DENTRO del paquete de esta persona. */
  readonly porSubirPaquete = computed(() => this.itemsPaquete().filter((i) => i.soloSubir));
  readonly listosGenerablesPaquete = computed(() => this.generablesPaquete().filter((i) => i.listo).length);
  readonly listosPorSubirPaquete = computed(() => this.porSubirPaquete().filter((i) => i.listo).length);

  // El resumen mide el PAQUETE de la persona, no el catálogo: es lo que hay
  // que completar para cerrar el día.
  readonly total = computed(() => this.itemsPaquete().length);
  readonly listos = computed(() => this.itemsPaquete().filter((i) => i.listo).length);
  readonly faltan = computed(() => this.total() - this.listos());
  readonly pct = computed(() => {
    const t = this.total();
    return t > 0 ? Math.round((this.listos() / t) * 100) : 0;
  });

  /**
   * Sin vacante remitida no se sabe a qué empresa va, y el filtro cae al
   * mínimo (cédula, contrato y hoja de vida). Se avisa, porque una lista de
   * tres documentos parece un paquete completo cuando no lo es.
   */
  readonly sinVacante = computed(() => !this.vacante());

  /**
   * ¿Se puede generar la documentación? Lo decide el pipeline (necesita el
   * proceso y el contrato) y lo publica por `PipelineNavService`.
   *
   * Aquí importa porque este módulo es de donde se sale hacia el generador:
   * ofrecer el botón cuando la pantalla de destino va a rechazar el trabajo es
   * mandar a alguien a un viaje en balde.
   */
  readonly generacion = this.nav.generacion;

  /**
   * Ir a llenar lo que falta.
   *
   * Contratación y Documentos son pestañas del MISMO grupo (`hiring-questions`),
   * así que basta con mover el sub-paso: el rail se recalcula solo y la pantalla
   * cambia sin pasar por el pipeline.
   */
  irAPagoTransporte(): void {
    this.nav.subContratacion.set(0);
  }

  /** Pedir la vacante: el diálogo y la lista viven en `help-information`. */
  asignarVacante(): void {
    this.nav.pedirAsignarVacante();
  }

  irAGenerar(): void {
    const cand = this.candidatoSeleccionado();
    const ced = this.cedulaEfectiva();
    if (!ced) return;
    this.router.navigate(['/dashboard/hiring/generate-contracting-documents', ced], {
      queryParams: { tipo_doc: cand?.tipo_doc || 'CC' },
    });
  }

  /**
   * Previsualiza el documento SIN salir de la pantalla.
   *
   * Abrirlo en el navegador del sistema hacía perder el sitio: se estaba
   * revisando el paquete y había que volver a buscar a la persona.
   */
  ver(item: ItemPaquete): void {
    if (!item.fileUrl) return;
    this.visorTitulo.set(item.nombreArchivo || item.titulo);
    this.visorUrl.set(item.fileUrl);
    // `file_url` llega como ruta protegida (`/api/v1/documents/…`): en el
    // iframe hay que meter el archivo ya descargado con el token, o el
    // navegador pide esa ruta al front y le devuelven el index.html.
    this.visorSrc.set(null);
    this.archivos.blob(item.fileUrl).pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (b) => {
        this.liberarVisor();
        this.visorBlob = URL.createObjectURL(b);
        this.visorSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.visorBlob));
      },
      error: () => {
        this.visorTitulo.set('');
        this.visorUrl.set(null);
        Swal.fire('No se pudo abrir', 'El archivo no está disponible ahora mismo.', 'error');
      },
    });
  }

  /** URL en memoria del documento que se está viendo. */
  private visorBlob: string | null = null;

  private liberarVisor(): void {
    if (this.visorBlob) {
      URL.revokeObjectURL(this.visorBlob);
      this.visorBlob = null;
    }
  }

  cerrarVisor(): void {
    this.liberarVisor();
    this.visorSrc.set(null);
    this.visorUrl.set(null);
    this.visorTitulo.set('');
  }

  /**
   * Descarga el que se está viendo, o uno concreto de la lista.
   *
   * Un `<a href>` a la ruta del backend no sirve: sin token baja un 401 y
   * contra el origen del front baja el index.html de la aplicación. Se pide
   * con el token y se guarda el archivo de verdad.
   */
  descargar(item?: ItemPaquete): void {
    const url = item ? item.fileUrl : this.visorUrl();
    if (!url) return;
    const nombre = (item?.nombreArchivo || item?.titulo || this.visorTitulo() || 'documento') + '';
    this.archivos.descargarComo(url, nombre);
  }

  /** Abre el documento fuera de la app, para imprimirlo o guardarlo aparte. */
  abrirFuera(item?: ItemPaquete): void {
    // Fuera de la app no hay token que valga: se abre la copia local ya
    // descargada para el visor y, si aún no está, se descarga.
    if (this.visorBlob && !item) {
      this.ventanas.openExternal(this.visorBlob);
      return;
    }
    this.descargar(item);
  }

  /**
   * Sube un PDF sin salir del pipeline.
   *
   * Mismas guardas que la pantalla de generación —nombre de archivo y PDF que
   * pide contraseña— y el MISMO endpoint, con el código de contrato y el tipo
   * de documento de la persona: un documento subido desde aquí tiene que
   * quedar idéntico a uno subido desde allá, o el expediente se parte en dos
   * según por dónde se haya entrado.
   */
  async subir(evento: Event, item: ItemPaquete): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || item.typeId === null) return;

    const cand = this.candidatoSeleccionado();
    const cedula = this.cedulaEfectiva() || null;
    if (!cedula) return;

    if (file.name.length > 100) {
      Swal.fire('Nombre muy largo', 'El nombre del archivo no debe pasar de 100 caracteres.', 'error');
      return;
    }

    if (await this.pdfPideClave(file)) {
      Swal.fire({
        icon: 'error',
        title: 'PDF protegido',
        html: 'Este PDF está <b>protegido con contraseña</b>. No se puede subir.<br><br>'
            + 'Quítale la contraseña y vuelve a intentarlo.',
      });
      return;
    }

    this.subiendo.set(item.titulo);
    this.docsSrv
      .guardarDocumento(
        item.titulo,
        cedula,
        item.typeId,
        file,
        this.codigoContratacion ?? undefined,
        String(cand?.tipo_doc || '').trim() || undefined,
      )
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.subiendo.set(null);
          this.recargar();
        },
        error: (e: any) => {
          this.subiendo.set(null);
          Swal.fire(
            'No se pudo subir',
            e?.error?.message || e?.message || 'Inténtalo de nuevo.',
            'error',
          );
        },
      });
  }

  /**
   * ¿El PDF exige contraseña para ABRIRSE?
   *
   * Ojo con la diferencia: muchos PDF de EPS y cajas traen cifrado de solo
   * permisos (no imprimir, no editar) y se abren sin pedir nada. Esos hay que
   * dejarlos subir, así que la prueba es si el documento abre y tiene páginas,
   * no si viene cifrado.
   */
  private async pdfPideClave(file: File): Promise<boolean> {
    const esPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!esPdf) return false;
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      return doc.getPageCount() === 0;
    } catch {
      return true;
    }
  }

  recargar(): void {
    this.leidoPara = null;
    const cand = this.candidatoSeleccionado();
    const ced = this.cedulaEfectiva();
    if (ced) this.cargar(ced, cand);
  }
}
