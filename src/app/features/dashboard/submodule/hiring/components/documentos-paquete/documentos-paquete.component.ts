import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, ViewChild,
} from '@angular/core';
import { catchError, firstValueFrom, of, take } from 'rxjs';
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
import {
  ContratoEnCurso, contratoEnCurso, esAnteriorA, filtroOtroContrato, procesoDelContrato, procesoVigente, tieneContratoActivoReal,
} from '../../pages/recruitment-pipeline/contrato.rules';
import {
  DOCUMENTOS_PAQUETE,
  SOLO_PLANTILLA_HTML,
  SOLO_PLANTILLA_HTML_ALIANZA,
  SUSTITUIDOS_EN_APOYO,
  esSoloSubir,
} from '../../shared/paquete-documental.data';
import {
  DocSeccion, SECCION_LABELS, getDocSeccion, isDocumentoVisible, resolverPerfil,
} from '../generate-contracting-documents/documentos-por-empresa.config';
import {
  DocumentosParametrizadosService,
  SOLO_FORANEOS,
  type EstadoFirma,
  type PermitidosPersona,
  type ResolucionDocumental,
  type UsuarioDocumento,
} from '../../service/documentos-parametrizados/documentos-parametrizados.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';
import {
  PlantillaHtmlDialogComponent, PlantillaHtmlData, PlantillaHtmlResultado, valoresDelBorrador,
} from '../plantilla-html/plantilla-html.dialog';

/** Un documento del paquete y en qué va. */
export interface ItemPaquete {
  /** Clave interna: decide plantilla, rama y con qué título se guarda en gestión documental. */
  titulo: string;
  /**
   * Cómo se LEE en pantalla: el nombre del parametrizador cuando la regla está activa, para que
   * la pestaña y *Parametrización de vacantes › Documentos* digan lo mismo. Si no, el título.
   */
  nombre?: string | null;
  /** Lo trae la flota de robots (antecedentes, ADRES, AFP). Se puede reemplazar a mano. */
  deRobot?: boolean;
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
  /** Por qué no le aplica a esta persona (p. ej. el auxilio de hospedaje a quien no es foráneo). */
  noAplica?: string | null;
  /**
   * Por qué NO se puede generar ni subir aquí: no está chuleado en el parametrizador para la
   * requisición de la persona (o no se pudo validar). `null` = se puede.
   */
  bloqueado?: string | null;
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
  private readonly dialog = inject(MatDialog);
  private readonly util = inject(UtilityServiceService);
  private readonly sedeScope = inject(SedeScopeService);
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

  /**
   * El visor se cuelga del <body> al abrirse. Este componente vive dentro de una pestaña
   * (mat-tab) cuyo contenido lleva `transform`: con eso el `position: fixed` del visor se
   * medía contra la pestaña y no contra la pantalla, y salía arriba en vez de centrado.
   * Angular lo sigue quitando al cerrar (`@if`), esté donde esté.
   */
  @ViewChild('visorEl') set visorEl(el: ElementRef<HTMLElement> | undefined) {
    if (!el || el.nativeElement.parentElement === document.body) return;
    document.body.appendChild(el.nativeElement);
    // Si el componente se destruye con el visor abierto, Angular no lo encuentra dentro de su
    // vista para quitarlo: se quita aquí.
    const nodo = el.nativeElement;
    this.destroyRef.onDestroy(() => nodo.remove());
  }
  /** Código del contrato: acompaña a cada documento que se sube. */
  private codigoContratacion: string | null = null;
  /**
   * Proceso del mismo contrato (id de ProcesoCandidato): ata cada subida a ESE
   * vínculo en gestión documental (ms-documents V21).
   */
  private procesoContratacion: number | string | null = null;
  /** Documento subiéndose ahora mismo (título), para bloquear su fila. */
  readonly subiendo = signal<string | null>(null);
  /** Vacante remitida: de ella dependen los documentos que aplican. */
  private readonly vacante = signal<Record<string, unknown> | null>(null);

  /** ¿Foránea? (ms-templates `EsForaneo`). `null` = sin respuesta todavía: no se decide. */
  private readonly foraneo = signal<boolean | null>(null);

  /**
   * Lo que esta persona puede generar y subir según su requisición (ms-templates
   * `/permitidos`, la misma regla que valida el servidor). `null` = todavía sin respuesta.
   */
  readonly permitidos = signal<PermitidosPersona | null>(null);

  /**
   * El aviso de la parametrización, abierto o plegado.
   *
   * Dice de qué requisición salen los documentos, pero son tres líneas que se leen una vez y
   * después estorban: se puede cerrar con la X y queda una sola línea para volver a abrirlo.
   * La preferencia es del puesto de trabajo, así que vive en el navegador (como las posiciones
   * de carné), no en el servidor.
   */
  readonly avisoParamAbierto = signal<boolean>(this.leerAvisoParam());

  avisoParam(abierto: boolean): void {
    this.avisoParamAbierto.set(abierto);
    try {
      localStorage.setItem(DocumentosPaqueteComponent.CLAVE_AVISO_PARAM, abierto ? '1' : '0');
    } catch {
      /* sin localStorage (modo privado o SSR): se pierde la preferencia, no es crítico */
    }
  }

  private static readonly CLAVE_AVISO_PARAM = 'documentos-paquete.aviso-parametrizacion';

  private leerAvisoParam(): boolean {
    try {
      return localStorage.getItem(DocumentosPaqueteComponent.CLAVE_AVISO_PARAM) !== '0';
    } catch {
      return true;
    }
  }

  /** La regla manda: temporal en ON con requisición, y la restricción en BLOQUEO. */
  readonly restringido = computed(() => {
    const p = this.permitidos();
    return DocumentosParametrizadosService.restringe(p) && p!.restriccion === 'BLOQUEO';
  });

  /**
   * Tipos documentales que sube la flota de robots (`TIPO_DOC_POR_ROBOT` del robots-worker):
   * Procuraduría, Contraloría, OFAC, Policivos, ADRES, Sisbén, Medidas correctivas y AFP-RUAF.
   * La fila se marca sola cuando el robot los deja; subirlos a mano guarda una versión nueva que
   * pasa a ser la vigente, así que sirve para corregir lo que trajo el robot.
   */
  private static readonly TIPOS_DE_ROBOT: ReadonlySet<number> = new Set([3, 4, 5, 6, 7, 8, 10, 11]);

  /**
   * Proceso en curso cuando la persona ya tuvo otro contrato (null si no lo tuvo). Lo
   * generado, los borradores y la solicitud de firma del contrato anterior no cuentan:
   * se arranca en blanco (ver `contratoEnCurso`).
   */
  private turno: ContratoEnCurso | null = null;

  /** Clave del último expediente leído, para no releerlo en cada refresco. */
  private leidoPara: string | null = null;

  constructor() {
    effect(() => {
      const cand = this.candidatoSeleccionado();
      const ced = this.cedulaEfectiva() || null;
      // El proceso en curso entra en la clave: la recarga que sigue a "Dar de baja"
      // tiene que volver a leer el expediente (lo del contrato anterior deja de contar).
      const turno = contratoEnCurso(cand);
      const clave = ced ? `${ced}#${this.consultaSeq()}#${turno?.procesoId ?? ''}` : null;
      if (clave === this.leidoPara) return;
      this.leidoPara = clave;
      this.turno = turno;
      this.vacante.set(null);
      this.docPorTipo.set(new Map());
      this.foraneo.set(null);
      this.permitidos.set(null);
      this.estadoFirma.set(null);
      if (ced) {
        this.cargarEstadoFirma(ced);
        this.cargar(ced, cand);
        this.docsParametrizados.condicionesPersona(ced).pipe(take(1), takeUntilDestroyed(this.destroyRef))
          .subscribe((c) => this.foraneo.set(c ? c.foraneo : null));
        this.docsParametrizados.permitidos(ced).pipe(take(1), takeUntilDestroyed(this.destroyRef))
          .subscribe((p) => this.permitidos.set(p));
      }
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

    // Con un contrato anterior se trabaja SIEMPRE sobre el proceso en curso: lo que se suba
    // queda en el expediente del contrato nuevo, no en el del anterior (aunque siga activo).
    const delContrato = procesoDelContrato(cand);
    const proc = (this.turno ? procesoVigente(cand) : null)
      ?? (tieneContratoActivoReal(delContrato) ? delContrato : null)
      ?? procesoVigente(cand) ?? delContrato as Record<string, unknown> | null;
    const p = proc as Record<string, any> | null;
    this.codigoContratacion =
      p?.['contrato_codigo'] ?? p?.['contrato']?.['codigo_contrato'] ?? null;
    this.procesoContratacion = p?.['id'] ?? null;
    const vacanteId = p?.['publicacion'] ?? null;

    if (vacanteId) {
      this.vacantesSrv.obtenerVacante(String(vacanteId))
        .pipe(take(1), catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
        .subscribe((v) => {
          const vac = (v as Record<string, unknown>) ?? null;
          this.vacante.set(vac);
          this.resolverDocumentosParametrizados(vac);
        });
    }

    this.docsSrv.getDocuments(cedula)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r: unknown) => {
          const lista = Array.isArray(r)
            ? r
            : ((r as Record<string, unknown>)?.['results'] as unknown[]) ?? [];
          const porTipo = new Map<number, { url: string; nombre: string }>();
          const esDeOtroContrato = filtroOtroContrato(this.turno, lista);
          for (const d of lista as Array<Record<string, unknown>>) {
            const t = Number(d?.['type']);
            if (!Number.isFinite(t)) continue;
            // Del contrato anterior: para el proceso en curso ese documento no existe.
            if (esDeOtroContrato(d)) continue;
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
    const r = this.resolucion();
    const ctx = {
      temporal: (v?.['temporal'] as string) ?? null,
      empresaUsuaria: (v?.['empresa_usuaria_solicita'] as string) ?? null,
      finca: (v?.['finca'] as string) ?? null,
    };
    const presentes = this.docPorTipo();
    const esApoyo = /APOYO/i.test(String(v?.['temporal'] ?? ''));
    const matriz = this.tiposMatriz();

    // Las que solo existen como plantilla HTML de Apoyo no aplican a otra temporal.
    const foraneo = this.foraneo();
    const p = this.permitidos();
    const restringido = this.restringido();
    const empresa = p?.requisicion?.empresa || 'la empresa usuaria';
    const titulados: ItemPaquete[] = DOCUMENTOS_PAQUETE.filter((titulo) => esApoyo
      ? !SUSTITUIDOS_EN_APOYO.has(titulo) && !SOLO_PLANTILLA_HTML_ALIANZA.has(titulo)
      : !SOLO_PLANTILLA_HTML.has(titulo)).map((titulo) => {
      const typeId = DocumentosParametrizadosService.tipoDeTitulo(titulo, r);
      const doc = typeId !== null ? presentes.get(typeId) ?? null : null;
      // Solo para foráneos (Auxilio de alimentación y hospedaje): a quien no lo es, no le aplica.
      const noAplica = esApoyo && SOLO_FORANEOS.has(titulo) && foraneo === false ? 'No aplica: no es foráneo' : null;
      // Con la regla activa, aquí solo se genera y se sube lo chuleado para la requisición.
      // Un documento chuleado que no le toca a esta persona (los del grupo de foráneos) trae su
      // motivo desde el servidor: se dice eso y no "no está parametrizado".
      const chuleado = restringido && typeId !== null
        ? p!.documentos.find((d) => d.tipo_documento_ref === typeId) ?? null : null;
      const bloqueado = !restringido ? null
        : p!.estado === 'ERROR' ? (p!.mensaje || 'No se pudo validar la parametrización documental.')
          : typeId !== null && p!.tipos_permitidos.includes(typeId) ? null
            : chuleado ? `No aplica: ${chuleado.motivo ?? 'no le corresponde a esta persona'}`
              : noAplica ?? `No está parametrizado para ${empresa}`;
      return {
        noAplica,
        bloqueado,
        titulo,
        soloSubir: esSoloSubir(titulo),
        listo: !!doc,
        typeId,
        fileUrl: doc?.url || null,
        nombreArchivo: doc?.nombre || null,
        seccion: getDocSeccion(titulo),
        // Temporal en ON: solo la parametrización (sin filas = no aplica nada y se avisa).
        // Las plantillas HTML nuevas no están en los perfiles regex: las decide la matriz de la empresa.
        delPaquete: !noAplica && (r?.modo === 'ON'
          ? DocumentosParametrizadosService.visibleEnParametrizacion(titulo, r)
          : SOLO_PLANTILLA_HTML.has(titulo)
            ? typeId !== null && !!matriz?.has(typeId)
            : isDocumentoVisible(titulo, ctx)),
      };
    }).filter((i) =>
      // Con la regla activa la lista ES la parametrización de la requisición: lo que no está
      // chuleado no se ofrece. Queda a la vista si ya está en el expediente (solo lectura) o si
      // es de foráneos (se dice por qué no aplica). Sin poder validar, se ve todo bloqueado.
      !restringido || p!.estado === 'ERROR' || !i.bloqueado || i.listo || !!i.noAplica);

    return restringido && p!.estado === 'OK' ? this.comoElParametrizador(titulados, p!, presentes) : titulados;
  });

  /**
   * La lista de la pestaña = la del parametrizador, documento por documento.
   *
   * Esta pantalla parte de un catálogo de TÍTULOS del front, y eso no cuadraba con la
   * parametrización por dos lados: un tipo documental con dos títulos salía dos veces (Referencias
   * y Referenciación son el mismo tipo 118), y lo chuleado que no tiene título aquí —antecedentes,
   * ADRES, RUI, AFP y exámenes, que se cargan en Selección y en Exámenes médicos— no salía.
   * Contaba 28 documentos donde el parametrizador enseñaba 35. Se corrige a la salida: un tipo, una
   * fila, y lo que falte se añade con el nombre del catálogo.
   */
  private comoElParametrizador(items: ItemPaquete[], p: PermitidosPersona,
                               presentes: ReadonlyMap<number, { url: string; nombre: string }>): ItemPaquete[] {
    const porTipo = new Map<number, ItemPaquete>();
    const sinTipo: ItemPaquete[] = [];
    for (const i of items) {
      if (i.typeId === null) { sinTipo.push(i); continue; }
      const previo = porTipo.get(i.typeId);
      // Con dos títulos del mismo tipo manda el que se puede diligenciar aquí (tiene plantilla).
      if (!previo || (!this.esDiligenciable(previo) && this.esDiligenciable(i))) porTipo.set(i.typeId, i);
    }
    for (const d of p.documentos) {
      const ref = d.tipo_documento_ref;
      if (ref == null) continue;
      const deRobot = DocumentosPaqueteComponent.TIPOS_DE_ROBOT.has(ref);
      const conocido = porTipo.get(ref);
      if (conocido) {
        // Se lee con el nombre del parametrizador; por dentro sigue siendo el mismo documento.
        porTipo.set(ref, { ...conocido, nombre: d.nombre, deRobot });
        continue;
      }
      const doc = presentes.get(ref) ?? null;
      const noAplica = d.aplica ? null : `No aplica: ${d.motivo ?? 'no le corresponde a esta persona'}`;
      porTipo.set(ref, {
        titulo: d.nombre,
        nombre: d.nombre,
        deRobot,
        soloSubir: d.naturaleza !== 'GENERADO',
        listo: !!doc,
        typeId: ref,
        fileUrl: doc?.url || null,
        nombreArchivo: doc?.nombre || null,
        // Sin título propio en esta pantalla: antecedentes y consultas en su rama, el resto con
        // los que hay que subir.
        seccion: d.naturaleza === 'GENERADO' ? 'contrato'
          : deRobot || d.naturaleza === 'CONSULTA' ? 'consultas' : 'subir-manual',
        delPaquete: d.aplica,
        noAplica,
        bloqueado: noAplica,
      });
    }
    return [...sinTipo, ...porTipo.values()];
  }

  /** Los que le tocan a esta persona: son los que cierran el día. */
  readonly itemsPaquete = computed(() => this.items().filter((i) => i.delPaquete));

  // ── Parametrización documental (interruptor OFF | SOMBRA | ON de la temporal) ──────────
  private readonly docsParametrizados = inject(DocumentosParametrizadosService);
  /** Resolución de la vacante: OFF, OK (con documentos y paquetes por destino) o ERROR. */
  readonly resolucion = signal<ResolucionDocumental | null>(null);
  /**
   * Tipos que la matriz documental de la empresa pide (vacantes de Apoyo), aunque la temporal
   * esté en OFF. Decide si las plantillas HTML sin perfil regex van en el paquete.
   */
  private readonly tiposMatriz = signal<ReadonlySet<number> | null>(null);
  readonly descargando = signal<string | null>(null);
  /** Plegado por defecto: una sola línea con los totales; se abre para ver destinos y descargas. */
  readonly paqueteAbierto = signal(false);

  readonly destinosLabel: Record<string, string> = {
    ARCHIVO_TEMPORAL: 'Archivo de la temporal',
    ESCANER_USUARIA: 'Escáner empresa usuaria (digital)',
    TRABAJADOR_FINCA: 'Trabajador (finca)',
    TRABAJADOR: 'Trabajador',
  };
  readonly naturalezaLabel: Record<string, string> = {
    GENERADO: 'Se genera', DILIGENCIADO_MANUAL: 'Diligenciado a mano', SOPORTE_CARGADO: 'Soporte a cargar', CONSULTA: 'Consulta',
  };
  readonly condicionLabel: Record<string, string> = {
    NINGUNA: '', CARGO_CRITICO: 'Solo cargo crítico', SEGUN_CARGO: 'Según el cargo', OMITIBLE_TEMPORADA: 'Puede omitirse en temporada',
  };

  /** Mensaje cuando la temporal está en ON y la vacante no resuelve documentos. */
  readonly errorParametrizado = computed(() => {
    const r = this.resolucion();
    return r?.estado === 'ERROR' && r.modo === 'ON' ? r.mensaje : null;
  });

  /** Paquete parametrizado a la vista: en ON es EL paquete; en SOMBRA, una vista previa. */
  readonly paqueteParametrizado = computed(() => {
    const r = this.resolucion();
    return r?.estado === 'OK' && (r.modo === 'ON' || r.modo === 'SOMBRA') ? r : null;
  });

  /** Lo que no genera la plataforma: soportes, consultas y formatos a mano, con su estado. */
  readonly checklistParametrizado = computed(() => {
    const r = this.paqueteParametrizado();
    if (!r) return [];
    const presentes = this.docPorTipo();
    return r.datos.documentos
      .filter((d) => d.tipo.naturaleza !== 'GENERADO')
      .map((d) => ({
        codigo: d.tipo.codigo,
        nombre: d.tipo.nombre,
        naturaleza: this.naturalezaLabel[d.tipo.naturaleza] ?? d.tipo.naturaleza,
        etapa: d.tipo.etapa,
        condicion: this.condicionLabel[d.tipo.condicion] ?? d.tipo.condicion,
        vigenciaDias: d.tipo.vigencia_dias,
        observacion: d.tipo.observacion,
        obligatorio: d.obligatorio,
        cargado: d.tipo.tipo_documento_ref != null && presentes.has(d.tipo.tipo_documento_ref),
        sinTipo: d.tipo.tipo_documento_ref == null,
      }));
  });

  private resolverDocumentosParametrizados(v: Record<string, unknown> | null): void {
    this.resolucion.set(null);
    this.tiposMatriz.set(null);
    if (!v?.['temporal']) return;
    if (/APOYO/i.test(String(v['temporal']))) {
      this.docsParametrizados.tiposDeLaMatriz(v)
        .pipe(take(1), catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
        .subscribe((tipos) => {
          if (this.vacante() === v) this.tiposMatriz.set(tipos);
        });
    }
    this.docsParametrizados.resolverVacante(v)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (this.vacante() !== v) return;
        this.resolucion.set(r);
        if (r.modo === 'SOMBRA') {
          const ctx = {
            temporal: (v['temporal'] as string) ?? null,
            empresaUsuaria: (v['empresa_usuaria_solicita'] as string) ?? null,
            finca: (v['finca'] as string) ?? null,
          };
          const titulosRegex = DOCUMENTOS_PAQUETE.filter((t) => isDocumentoVisible(t, ctx));
          this.docsParametrizados.registrarSombra(v, resolverPerfil(ctx)?.nombre ?? null, titulosRegex, r, 'PAQUETE');
        }
      });
  }

  descargarPaqueteCompleto(): void {
    const r = this.paqueteParametrizado();
    const ced = this.cedulaEfectiva();
    if (!r || !ced) return;
    this.descargarBlob('ZIP', this.docsParametrizados.descargarPaquete(ced, r.datos.centro_canonico_id),
      `paquete-ingreso-${ced}.zip`);
  }

  descargarDestino(destino: string): void {
    const r = this.paqueteParametrizado();
    const ced = this.cedulaEfectiva();
    if (!r || !ced) return;
    this.descargarBlob(destino, this.docsParametrizados.descargarDestino(ced, r.datos.centro_canonico_id, destino),
      `paquete-${destino.toLowerCase()}-${ced}.pdf`);
  }

  private descargarBlob(clave: string, blob$: import('rxjs').Observable<Blob>, nombre: string): void {
    this.descargando.set(clave);
    blob$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        this.descargando.set(null);
      },
      error: async (err) => {
        this.descargando.set(null);
        // La respuesta de error llega como Blob (responseType blob): se lee para mostrar el motivo.
        let motivo = 'No se pudo generar el paquete.';
        try {
          const txt = err?.error instanceof Blob ? await err.error.text() : '';
          motivo = (txt && JSON.parse(txt)?.error) || motivo;
        } catch { /* se queda el mensaje genérico */ }
        void Swal.fire({ icon: 'error', title: 'Paquete de ingreso', text: motivo });
      },
    });
  }

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
  /** Pedir la vacante: el diálogo y la lista viven en `help-information`. */
  asignarVacante(): void {
    this.nav.pedirAsignarVacante();
  }

  /**
   * Documentos que se abren con clic para generarlos y diligenciar lo que les falta.
   *
   * Solo los de Apoyo Laboral: son plantillas HTML de ms-templates. Ya no hay salida a la
   * pantalla vieja de generación —se retiró de este módulo—, así que lo que no tenga plantilla
   * se sube desde aquí como cualquier soporte.
   */
  esDiligenciable(item: ItemPaquete): boolean {
    if (!(item.titulo in this.PLANTILLA_HTML)) return false;
    const temporal = String(this.vacante()?.['temporal'] ?? '');
    // Tu Alianza: solo sus plantillas propias. Ficha Técnica, Contrato… de Tu Alianza siguen en su generador PDF.
    if (/ALIANZA/i.test(temporal)) return SOLO_PLANTILLA_HTML_ALIANZA.has(item.titulo);
    return /APOYO/i.test(temporal) && !SOLO_PLANTILLA_HTML_ALIANZA.has(item.titulo);
  }

  /**
   * Quien está generando. El nombre es el mismo dato que la ficha PDF usaba como "Persona que
   * firma"; el documento y la sede los pide el contrato (testigo 1 y municipio de la firma).
   */
  private usuarioSesion(): UsuarioDocumento {
    const u: any = this.util.getUser?.() ?? {};
    const nombre = `${u?.datos_basicos?.nombres ?? ''} ${u?.datos_basicos?.apellidos ?? ''}`.trim();
    return {
      nombre: nombre ? nombre.toUpperCase() : null,
      documento: u?.numero_de_documento ? String(u.numero_de_documento) : null,
      sede: this.sedeScope.trabajaDesdeTransversal()
        ? (this.oficinaDeLaEntrevista() ?? u?.sede?.nombre ?? null)
        : (u?.sede?.nombre ?? null),
    };
  }

  /**
   * Oficina de la última entrevista del candidato. Quien trabaja desde una sede
   * transversal (ADMINISTRATIVOS, VIRTUAL) no firma el contrato "en" esa sede: el
   * contrato pertenece a la oficina donde se entrevistó a la persona.
   */
  private oficinaDeLaEntrevista(): string | null {
    const cand: any = this.candidatoSeleccionado();
    const entrevistas: any[] = Array.isArray(cand?.entrevistas) ? [...cand.entrevistas] : [];
    entrevistas.sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0));
    return entrevistas.map((e) => String(e?.oficina ?? '').trim()).find(Boolean) ?? null;
  }

  /**
   * Plantilla HTML (ms-templates) de cada documento diligenciable de Apoyo Laboral. Con estar
   * aquí el documento ya se puede abrir con clic desde Documentos (`esDiligenciable`).
   */
  private readonly PLANTILLA_HTML: Readonly<Record<string, string>> = {
    'Ficha Técnica': 'ficha-tecnica-trabajador',
    'Contrato': 'contrato-obra-labor',
    'Ficha Social': 'ficha-social-apoyo',
    'Manejo Imagen': 'acuerdo-uso-imagen',
    'Carnet': 'carne-trabajador',
    'Autorización Derechos de Imagen': 'autorizacion-derechos-imagen',
    'Referenciación Trabajador en Misión': 'referenciacion',
    // Cláusula de foráneos (tipo 105 AUXILIO_ALIMENTACION): solo le aplica a quien es foráneo.
    'Auxilio Extralegal de Alimentación y Hospedaje': 'clausula-alimentacion-hospedaje',
    'Programa Foráneos': 'programa-foraneos',
    // La fila de SIEMPRE (tipo 26) abre la plantilla en Apoyo: no se añaden ni se ocultan filas.
    'Autorización de Datos': 'autorizacion-tratamiento-datos',
    'Entrega de Documentos y Autorizaciones': 'entrega-documentos-autorizaciones',
    // Cláusula adicional al contrato: jornada flexible (tipo 248 CLAUSULA_JORNADA_FLEXIBLE).
    'Cláusula Jornada Flexible': 'clausula-jornada-flexible',
  };

  /**
   * Clic sobre un documento diligenciable (ficha técnica, contrato): se pinta su plantilla
   * HTML con los datos de la persona para completar a mano lo que falta; al guardar,
   * ms-templates genera el PDF y lo deja en el expediente.
   *
   * Las plantillas HTML son las de Apoyo Laboral. Una vacante de Tu Alianza no tiene
   * plantilla HTML: sigue por el generador de siempre (el contrato, con sus variantes
   * Básica / TA Completa / Administrativo).
   */
  diligenciar(item: ItemPaquete): void {
    const ced = this.cedulaEfectiva();
    if (!this.esDiligenciable(item) || !ced) return;
    if (item.bloqueado) {
      Swal.fire('No se puede generar', `«${item.nombre || item.titulo}»: ${item.bloqueado}.`, 'info');
      return;
    }
    const v = this.vacante();
    if (!v) {
      Swal.fire('Sin vacante', `Asigna primero la vacante: «${item.nombre || item.titulo}» se llena con su empresa y su centro de costo.`, 'info');
      return;
    }
    const clave = this.PLANTILLA_HTML[item.titulo];
    if (!clave) return;

    Swal.fire({ title: `Preparando: ${item.nombre || item.titulo}…`, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    // El centro es el de la requisición que valida el servidor; sin ella, el de la vacante a la vista.
    const centroRequisicion = this.permitidos()?.estado === 'OK' ? this.permitidos()?.requisicion?.centro_canonico_id ?? null : null;
    (centroRequisicion != null ? of(centroRequisicion) : this.docsParametrizados.centroCanonico(v))
      .pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (centroCostoId) => {
        Swal.close();
        this.dialog.open<PlantillaHtmlDialogComponent, PlantillaHtmlData, PlantillaHtmlResultado>(PlantillaHtmlDialogComponent, {
          maxWidth: '100vw', maxHeight: '100vh', width: '100vw', height: '100vh',
          panelClass: 'pdf-editor-fullscreen-dialog', disableClose: true, autoFocus: false,
          data: { clave, titulo: item.nombre || item.titulo, cedula: ced, centroCostoId, usuario: this.usuarioSesion(), turno: this.turno?.procesoId },
        }).afterClosed().pipe(take(1)).subscribe((r) => {
          if (!r?.guardado) return;
          Swal.fire({ icon: 'success', title: 'Guardado', text: `${item.nombre || item.titulo} quedó en el expediente.`, timer: 2200, showConfirmButton: false });
          this.recargar();
        });
      },
      error: (e) => {
        Swal.close();
        Swal.fire(`No se pudo abrir: ${item.nombre || item.titulo}`,
          e?.error?.error || 'No se encontró el centro de costo de la vacante en la parametrización documental.', 'error');
      },
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
    this.visorTitulo.set(item.nombreArchivo || item.nombre || item.titulo);
    this.visorUrl.set(item.fileUrl);
    // `file_url` llega como ruta protegida (`/api/v1/documents/…`): en el
    // iframe hay que meter el archivo ya descargado con el token, o el
    // navegador pide esa ruta al front y le devuelven el index.html.
    this.visorSrc.set(null);
    this.archivos.blob(item.fileUrl).pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (b) => {
        this.liberarVisor();
        this.visorBlob = URL.createObjectURL(b);
        // PDF: que el visor del navegador abra con "ajustar a la página" (parámetro de apertura
        // estándar de PDF; a una imagen no le afecta).
        const esPdf = b.type === 'application/pdf' || /\.pdf$/i.test(item.nombreArchivo || item.fileUrl || '');
        this.visorSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.visorBlob + (esPdf ? '#view=Fit' : '')));
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
   * Documento sobre el que se está arrastrando un archivo ahora mismo.
   *
   * Se guarda el título y no un booleano por fila: así solo se ilumina la
   * casilla de destino, que es lo que dice dónde va a caer.
   */
  readonly arrastrando = signal<string | null>(null);

  alArrastrar(ev: DragEvent, item: ItemPaquete): void {
    // Sin `preventDefault` el navegador ABRE el archivo y se lleva la pantalla
    // por delante: es el comportamiento por defecto de soltar algo en una web.
    ev.preventDefault();
    if (item.typeId === null || this.subiendo() || item.bloqueado) return;
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    this.arrastrando.set(item.titulo);
  }

  alSalirArrastre(item: ItemPaquete): void {
    if (this.arrastrando() === item.titulo) this.arrastrando.set(null);
  }

  /** Soltar un archivo encima ES subirlo a ese documento. */
  alSoltar(ev: DragEvent, item: ItemPaquete): void {
    ev.preventDefault();
    this.arrastrando.set(null);
    const file = ev.dataTransfer?.files?.[0];
    if (!file || item.typeId === null) return;
    void this.subirArchivo(file, item);
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
    await this.subirArchivo(file, item);
  }

  /** El camino común del botón y del archivo soltado encima. */
  private async subirArchivo(file: File, item: ItemPaquete): Promise<void> {
    if (item.typeId === null) return;
    if (item.bloqueado) {
      Swal.fire('No se puede subir', `«${item.nombre || item.titulo}»: ${item.bloqueado}.`, 'info');
      return;
    }

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
        this.procesoContratacion,
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
            e?.error?.error || e?.error?.message || e?.message || 'Inténtalo de nuevo.',
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
    if (ced) {
      this.cargar(ced, cand);
      this.cargarEstadoFirma(ced);
    }
  }

  // ── Firma electrónica del candidato ──────────────────────────────────────
  /** Correo, documentos que debe firmar (los chuleados con "requiere firma") y última solicitud. */
  readonly estadoFirma = signal<EstadoFirma | null>(null);
  readonly solicitandoFirma = signal(false);

  private cargarEstadoFirma(cedula: string): void {
    this.docsParametrizados.estadoFirma(cedula)
      .pipe(take(1), catchError((e) => of<EstadoFirma>({
        correo: null, correo_confirmado: null, nombre: null, documentos: [], ultima: null,
        motivo: 'No se pudo consultar la firma: ' + (e?.error?.error || e?.message || 'intenta con Actualizar'),
      })), takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        // Una solicitud de firma del contrato anterior no es la de este proceso.
        const inicio = this.turno?.inicio;
        this.estadoFirma.set(inicio && e?.ultima && esAnteriorA(e.ultima.solicitada_en, inicio)
          ? { ...e, ultima: null } : e);
      });
  }

  /** Una línea con cómo va la firma. */
  firmaTexto(ef: EstadoFirma): string {
    const u = ef.ultima;
    const n = ef.documentos.length;
    const docs = `${n} documento${n === 1 ? '' : 's'}`;
    if (!u) return n ? `${docs} requiere${n === 1 ? '' : 'n'} su firma · se enviará${n === 1 ? '' : 'n'} a ${ef.correo || '(sin correo registrado)'}`
      : (ef.motivo || 'No hay documentos que firmar.');
    const abierta = u.eventos.some((e) => e.tipo === 'ABIERTA' || e.tipo === 'DOCUMENTO_VISTO');
    switch (u.estado) {
      case 'PENDIENTE': return `Enviada a ${u.correo} el ${u.solicitada_en} · ${abierta ? 'ya la abrió' : 'aún no la abre'} · vence el ${u.expira_en}`;
      case 'FIRMADA': return `Firmada el ${u.firmada_en} · ${u.documentos.length} documento(s) consolidados en el expediente`;
      case 'VENCIDA': return `La solicitud del ${u.solicitada_en} venció sin firmar: vuelve a solicitarla.`;
      default: return `La solicitud del ${u.solicitada_en} quedó anulada.`;
    }
  }

  /**
   * "Solicitar firma": manda al correo del candidato los documentos que requieren su firma, en PDF
   * y como se dejaron diligenciados (el borrador de cada uno). El servidor decide cuáles son,
   * valida la parametrización y guarda la evidencia; al aceptar, se consolidan en el expediente.
   */
  /**
   * ¿Se le ofrece «Firmar»? Si el documento requiere la firma del empleado (lo dice ms-templates en
   * el estado de firma) y aún no está firmado: el consolidado (por correo o en la oficina) se guarda
   * como `<plantilla>-firmado.pdf`, y lo que se ve aquí ya es solo lo del contrato en curso.
   */
  puedeFirmar(item: ItemPaquete): boolean {
    if (!this.esDiligenciable(item)) return false;
    if (item.listo && /-firmado\.pdf$/i.test(item.nombreArchivo || '')) return false;
    const clave = this.PLANTILLA_HTML[item.titulo];
    return !!clave && !!this.estadoFirma()?.documentos?.some((d) => d.clave === clave);
  }

  /**
   * Firma presencial de UN documento: el trabajador lo firma en este equipo, en la misma página
   * que le llegaría por correo. Al pulsar «Aceptar y finalizar» queda consolidado igual que por
   * correo (PDF firmado + constancia en el expediente de este contrato) y la vista previa ya sale
   * con su firma; mientras no lo firme, el recuadro «Firma del trabajador» sale en blanco.
   */
  async firmarPresencial(item: ItemPaquete): Promise<void> {
    const ced = this.cedulaEfectiva();
    const clave = this.PLANTILLA_HTML[item.titulo];
    if (!ced || !clave || this.solicitandoFirma()) return;
    if (item.bloqueado) {
      Swal.fire('No se puede firmar', `«${item.nombre || item.titulo}»: ${item.bloqueado}.`, 'info');
      return;
    }
    const v = this.vacante();
    const centroRequisicion = this.permitidos()?.estado === 'OK' ? this.permitidos()?.requisicion?.centro_canonico_id ?? null : null;
    if (centroRequisicion == null && !v) {
      Swal.fire('Sin vacante', 'Asigna primero la vacante: el documento se llena con su empresa y su centro de costo.', 'info');
      return;
    }
    const nombre = item.nombre || item.titulo;
    const ok = await Swal.fire({
      title: 'Firmar en este equipo',
      icon: 'question',
      html: `<div style="text-align:left;font-size:.9rem">
        <p>Se abrirá <b>${this.escapar(nombre)}</b>, como está diligenciado, en la página de firma.</p>
        <p>El trabajador lo lee, firma en cada recuadro «Firma del trabajador» y pulsa <b>Aceptar y finalizar</b>:
        queda consolidado en su expediente igual que cuando firma desde el correo.</p>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Abrir para firmar',
      cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;

    this.solicitandoFirma.set(true);
    Swal.fire({ title: `Preparando: ${nombre}…`, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const centroCostoId = centroRequisicion ?? await firstValueFrom(this.docsParametrizados.centroCanonico(v!));
      const valores = valoresDelBorrador(clave, ced, centroCostoId, this.turno?.procesoId);
      const r = await firstValueFrom(this.docsParametrizados.firmarPresencial(ced, centroCostoId, clave, valores, this.usuarioSesion()));
      this.ventanas.openExternal(r.enlace);
      await Swal.fire({
        icon: 'info',
        title: 'Firma abierta',
        html: `<div style="text-align:left;font-size:.9rem">
          <p>La página de firma de <b>${this.escapar(r.documento)}</b> se abrió en otra ventana.</p>
          <p>Cuando el trabajador termine, pulsa <b>Ya firmó</b> para ver el documento consolidado.
          El enlace vence el ${this.escapar(r.expira_en)}.</p>
          <p><a href="${this.escapar(r.enlace)}" target="_blank" rel="noopener">Abrir otra vez la página de firma</a></p>
        </div>`,
        confirmButtonText: 'Ya firmó',
      });
      this.recargar();
    } catch (e: any) {
      Swal.fire('No se pudo abrir la firma', e?.error?.error || e?.error?.message || 'Intenta de nuevo.', 'error');
    } finally {
      this.solicitandoFirma.set(false);
    }
  }

  async solicitarFirma(): Promise<void> {
    const ced = this.cedulaEfectiva();
    if (!ced || this.solicitandoFirma()) return;
    let ef = this.estadoFirma();
    if (!ef) {
      this.solicitandoFirma.set(true);
      ef = await firstValueFrom(this.docsParametrizados.estadoFirma(ced)).catch(() => null);
      this.solicitandoFirma.set(false);
      if (!ef) {
        Swal.fire('No se pudo', 'No se pudo consultar qué documentos requieren firma. Intenta con Actualizar.', 'error');
        return;
      }
      this.estadoFirma.set(ef);
    }
    if (!ef.documentos.length) {
      Swal.fire('Nada que firmar', ef.motivo || 'Ningún documento de esta persona requiere su firma: no hay nada que consolidar.', 'info');
      return;
    }
    if (!ef.correo) {
      Swal.fire('Sin correo', 'La persona no tiene correo registrado: agrégalo en sus datos de contacto antes de solicitar la firma.', 'warning');
      return;
    }
    const v = this.vacante();
    const centroRequisicion = this.permitidos()?.estado === 'OK' ? this.permitidos()?.requisicion?.centro_canonico_id ?? null : null;
    if (centroRequisicion == null && !v) {
      Swal.fire('Sin vacante', 'Asigna primero la vacante: los documentos se llenan con su empresa y su centro de costo.', 'info');
      return;
    }
    this.solicitandoFirma.set(true);
    let centroCostoId: number;
    try {
      centroCostoId = centroRequisicion ?? await firstValueFrom(this.docsParametrizados.centroCanonico(v!));
    } catch {
      this.solicitandoFirma.set(false);
      Swal.fire('No se pudo', 'No se encontró el centro de costo de la vacante.', 'error');
      return;
    }

    const valores: Record<string, Record<string, string>> = {};
    const filas = ef.documentos.map((d) => {
      const vs = valoresDelBorrador(d.clave, ced, centroCostoId, this.turno?.procesoId);
      valores[d.clave] = vs;
      const n = Object.keys(vs).length;
      return `<li>${this.escapar(d.nombre)} <small style="color:#6b7280">· ${n ? 'diligenciado (' + n + ' dato' + (n === 1 ? '' : 's') + ')' : 'con los datos de la persona'}</small></li>`;
    }).join('');
    const pendiente = ef.ultima?.estado === 'PENDIENTE';
    const ok = await Swal.fire({
      title: 'Solicitar firma',
      icon: 'question',
      html: `<div style="text-align:left;font-size:.9rem">
        <p>Se enviarán en PDF, como están diligenciados, a:</p>
        <p style="font-size:1.05rem"><b>${this.escapar(ef.correo)}</b>${ef.correo_confirmado ? ' <small style="color:#15803d">(correo confirmado)</small>' : ' <small style="color:#b45309">(correo sin confirmar)</small>'}</p>
        <ol>${filas}</ol>
        <p>La persona recibe un botón <b>Firmar</b>; al aceptar con su número de documento, los documentos quedan consolidados en el expediente.</p>
        ${pendiente ? '<p style="color:#b45309">La solicitud pendiente anterior dejará de servir.</p>' : ''}
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Solicitar firma',
      cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) {
      this.solicitandoFirma.set(false);
      return;
    }
    Swal.fire({ title: 'Generando y enviando los documentos…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    this.docsParametrizados.solicitarFirma(ced, centroCostoId, valores, this.usuarioSesion())
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.solicitandoFirma.set(false);
          Swal.fire('Solicitud enviada', `Se enviaron ${r.documentos} documento(s) a ${r.correo}. El enlace vence el ${r.expira_en}.`, 'success');
          this.cargarEstadoFirma(ced);
        },
        error: (e) => {
          this.solicitandoFirma.set(false);
          Swal.fire('No se pudo solicitar la firma', e?.error?.error || e?.error?.message || 'Intenta de nuevo.', 'error');
          this.cargarEstadoFirma(ced);
        },
      });
  }

  private escapar(s: string | null | undefined): string {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }
}
