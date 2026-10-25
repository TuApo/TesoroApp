import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, switchMap } from 'rxjs';
import { environment } from '@/environments/environment';
import type { ControlPlantilla } from '../../components/plantilla-html/si-no-plantilla';
import { VacancyCascadeService, canonicalTemporal } from '../../../vacancies/service/vacancy-cascade/vacancy-cascade.service';
import { FarmsService } from '../../../farms/services/farms/farms.service';
import { CODIGO_POR_TITULO, TYPE_ID_POR_TITULO } from '../../shared/paquete-documental.data';

/**
 * Parametrización documental en el flujo de contratación (interruptor por temporal).
 *
 *   OFF    → los perfiles regex de documentos-por-empresa.config.ts, como siempre.
 *   SOMBRA → se siguen usando las regex, pero se consulta la parametrización y se REGISTRA
 *            la comparación en ms-auth-admin (bitácora de sombra).
 *   ON     → SOLO la parametrización. Si la empresa no tiene filas, error explícito:
 *            nunca se cae en silencio a un perfil por defecto.
 *
 * Todo se compara por id de tipo documental (TYPE_ID_POR_TITULO ↔ tipo_documento_ref):
 * los títulos del front y los nombres del backend no coinciden.
 */
export type ModoDocumentos = 'OFF' | 'SOMBRA' | 'ON';

export interface ItemPaqueteResuelto {
  codigo: string;
  nombre: string;
  naturaleza: string;
  plantilla_codigo: string | null;
  forma: 'ORIGINAL' | 'COPIA' | 'DIGITAL';
  copias: number;
  orden: number | null;
  obligatorio: boolean;
  condicion: string | null;
  vigencia_dias: number | null;
}

export interface DocumentoResuelto {
  tipo: {
    id: number; codigo: string; nombre: string; naturaleza: string; plantilla_codigo: string | null;
    etapa: string; vigencia_dias: number | null; condicion: string; observacion: string | null;
    tipo_documento_ref: number | null;
  };
  obligatorio: boolean;
  orden_archivo: number | null;
  destinos: { destino: string; forma: string; copias: number; orden: number | null }[];
  copias_fisicas: number;
  copias_digitales: number;
  origen: string;
}

export interface DocumentosResueltos {
  centro_costo_id: number;
  centro_canonico_id: number;
  finca: string | null;
  empresa_vacante_id: number;
  temporal_config_ref: number | null;
  modo: ModoDocumentos;
  documentos: DocumentoResuelto[];
  paquetes: { destino: string; items: ItemPaqueteResuelto[]; ejemplares_fisicos: number; ejemplares_digitales: number }[];
  totales: { documentos: number; copias_fisicas: number; copias_digitales: number };
}

/** Resultado de resolver una vacante: nunca lanza; el error viaja como dato para pintarlo. */
export type ResolucionDocumental =
  | { estado: 'OK'; modo: ModoDocumentos; temporalRef: number | null; datos: DocumentosResueltos; tiposApi: Set<number> }
  | { estado: 'OFF'; modo: 'OFF'; temporalRef: number | null }
  | { estado: 'ERROR'; modo: ModoDocumentos; temporalRef: number | null; codigo: string; mensaje: string };

type Vacante = Record<string, unknown> | null | undefined;

@Injectable({ providedIn: 'root' })
export class DocumentosParametrizadosService {
  private readonly http = inject(HttpClient);
  private readonly cascada = inject(VacancyCascadeService);
  private readonly fincas = inject(FarmsService);

  private readonly base = `${environment.apiUrl}/api/v1/admin/parametrizacion/vacantes`;
  private readonly plantillas = `${environment.apiUrl}/plantillas/excel`;
  private readonly firma = `${environment.apiUrl}/plantillas/firma`;
  private readonly modos = new Map<number, Observable<ModoDocumentos>>();

  /** Modo del interruptor de una temporal. Si no se puede leer, OFF (lo seguro). */
  modo(temporalRef: number | null): Observable<ModoDocumentos> {
    if (temporalRef == null) return of('OFF');
    if (!this.modos.has(temporalRef)) {
      this.modos.set(temporalRef, this.http.get<{ modo: ModoDocumentos }>(`${this.base}/documentos/modos/${temporalRef}`).pipe(
        map((r) => (r?.modo === 'ON' || r?.modo === 'SOMBRA' ? r.modo : 'OFF') as ModoDocumentos),
        catchError(() => of('OFF' as ModoDocumentos)),
        shareReplay({ bufferSize: 1, refCount: false }),
      ));
    }
    return this.modos.get(temporalRef)!;
  }

  /** id de afiliacion_temporal_config a partir del texto canónico que guarda la vacante. */
  temporalRef(temporal: string | null | undefined): Observable<number | null> {
    const canonica = canonicalTemporal(temporal ?? null);
    if (!canonica) return of(null);
    return this.cascada.listarTemporales().pipe(
      map((ts) => ts.find((t) => t.valor === canonica)?.configRef ?? null),
      catchError(() => of(null)),
    );
  }

  /**
   * Resuelve los documentos de la vacante según el modo de su temporal. OFF no consulta
   * nada más. SOMBRA y ON piden la parametrización por el centro canónico.
   */
  resolverVacante(v: Vacante): Observable<ResolucionDocumental> {
    return this.temporalRef(v?.['temporal'] as string).pipe(
      switchMap((ref) => this.modo(ref).pipe(map((modo) => ({ ref, modo })))),
      switchMap(({ ref, modo }) => {
        if (modo === 'OFF') return of({ estado: 'OFF', modo: 'OFF', temporalRef: ref } as ResolucionDocumental);
        return this.pedirResueltos(v).pipe(
          map((datos) => ({ estado: 'OK', modo, temporalRef: ref, datos, tiposApi: tiposDe(datos) } as ResolucionDocumental)),
          catchError((err) => of({
            estado: 'ERROR', modo, temporalRef: ref,
            codigo: err?.error?.codigo ?? 'ERROR',
            mensaje: err?.error?.error ?? err?.message ?? 'No se pudieron resolver los documentos parametrizados.',
          } as ResolucionDocumental)),
        );
      }),
    );
  }

  /** Por la configuración centro+cargo de la vacante; si no la tiene, por el resolvedor de fincas. */
  private pedirResueltos(v: Vacante): Observable<DocumentosResueltos> {
    const configId = v?.['configuracion_centro_cargo_id'];
    if (configId != null && configId !== '') {
      return this.http.get<DocumentosResueltos>(`${this.base}/configuraciones/${configId}/documentos-resueltos`);
    }
    return this.fincas.resolverPorVacante(v?.['finca'] as string, v?.['empresa_usuaria_solicita'] as string).pipe(
      switchMap((r) => {
        const id = (r?.['opciones'] as Array<Record<string, unknown>> | undefined)?.[0]?.['id'];
        if (id == null) {
          throw { error: { codigo: 'CENTRO_NO_RESUELTO', error: 'No se encontró el centro de costo de la vacante en el maestro.' } };
        }
        return this.http.get<DocumentosResueltos>(`${this.base}/centros/${id}/documentos-resueltos`);
      }),
    );
  }

  /** ¿El documento (por título del catálogo del front) está en la parametrización? */
  static visibleEnParametrizacion(titulo: string, r: ResolucionDocumental): boolean {
    if (r.estado !== 'OK') return false;
    const tipo = DocumentosParametrizadosService.tipoDeTitulo(titulo, r);
    return tipo != null && r.tiposApi.has(tipo);
  }

  /**
   * Tipo de gestión documental de un título: el fijo de `TYPE_ID_POR_TITULO` o, para los que se
   * crean al darlos de alta en el catálogo (`CODIGO_POR_TITULO`), el que trae la resolución por código.
   */
  static tipoDeTitulo(titulo: string, r: ResolucionDocumental | null | undefined): number | null {
    const fijo = TYPE_ID_POR_TITULO[titulo];
    if (fijo != null) return fijo;
    const codigo = CODIGO_POR_TITULO[titulo];
    if (!codigo || !r || r.estado !== 'OK') return null;
    const doc = (r.datos?.documentos ?? []).find((d) => d.tipo?.codigo === codigo);
    return doc?.tipo?.tipo_documento_ref ?? null;
  }

  /** Registra en ms-auth-admin la comparación regex vs parametrización. Nunca rompe el flujo. */
  registrarSombra(v: Vacante, perfilRegex: string | null, titulosRegex: string[], r: ResolucionDocumental, origen: string): void {
    if (r.modo !== 'SOMBRA') return;
    const tiposRegex = Array.from(new Set(titulosRegex.map((t) => TYPE_ID_POR_TITULO[t]).filter((x): x is number => x != null)));
    const body = {
      temporal_config_ref: r.temporalRef,
      empresa_usuaria_vacante_ref: r.estado === 'OK' ? r.datos.empresa_vacante_id : null,
      centro_costo_ref: r.estado === 'OK' ? r.datos.centro_canonico_id : null,
      empresa_texto: (v?.['empresa_usuaria_solicita'] as string) ?? null,
      finca_texto: (v?.['finca'] as string) ?? null,
      perfil_regex: perfilRegex,
      resultado_api: r.estado === 'OK' ? 'OK' : r.codigo,
      tipos_regex: tiposRegex,
      tipos_api: r.estado === 'OK' ? Array.from(r.tiposApi) : [],
      origen,
    };
    this.http.post(`${this.base}/documentos/sombra`, body).pipe(catchError(() => of(null))).subscribe((res) => {
      if (res) console.info('[documentos sombra]', origen, res);
    });
  }

  /** ZIP del paquete de ingreso (un PDF por destino + individuales + manifiesto). */
  descargarPaquete(cedula: string, centroCostoId: number, persistir = false): Observable<Blob> {
    return this.http.post(`${this.plantillas}/paquete`, { cedula, centro_costo_id: centroCostoId, persistir }, { responseType: 'blob' });
  }

  /** PDF de un solo destino del paquete. */
  descargarDestino(cedula: string, centroCostoId: number, destino: string): Observable<Blob> {
    return this.http.post(`${this.plantillas}/paquete`, { cedula, centro_costo_id: centroCostoId },
      { responseType: 'blob', params: { destino } });
  }

  /**
   * Centro canónico de la vacante SIN mirar el interruptor OFF/SOMBRA/ON: las plantillas
   * HTML (ficha técnica en pantalla) lo necesitan para resolver los datos de la empresa.
   */
  /**
   * Tipos documentales (ids de gestión documental) que la matriz de la empresa de la vacante
   * pide, SIN mirar el interruptor. Documentos lo usa para saber si una plantilla HTML de
   * Apoyo va en el paquete de esta persona aunque la temporal esté en OFF.
   */
  tiposDeLaMatriz(v: Vacante): Observable<Set<number>> {
    return this.pedirResueltos(v).pipe(map((d) => tiposDe(d)));
  }

  /**
   * Parametrización de la vacante SIN mirar el interruptor: el empalme arma sus paquetes por
   * destino (Trabajador, Trabajador (finca), Escáner usuaria) con el orden que fija el parametrizador.
   */
  resueltosDeVacante(v: Vacante): Observable<DocumentosResueltos> {
    return this.pedirResueltos(v);
  }

  /** Lo mismo por centro canónico (el de la requisición, cuando no hay vacante a la vista). */
  resueltosPorCentro(centroId: number): Observable<DocumentosResueltos> {
    return this.http.get<DocumentosResueltos>(`${this.base}/centros/${centroId}/documentos-resueltos`);
  }

  centroCanonico(v: Vacante): Observable<number> {
    return this.pedirResueltos(v).pipe(map((d) => d.centro_canonico_id));
  }

  /**
   * Condiciones de la persona que deciden qué documentos le aplican. La regla vive en UN solo
   * sitio (ms-templates `EsForaneo`); aquí solo se consulta. Sin respuesta: `null` (no se decide).
   */
  condicionesPersona(cedula: string): Observable<CondicionesPersona | null> {
    return this.http.post<CondicionesPersona>(`${this.plantillas}/condiciones`, { cedula })
      .pipe(catchError(() => of(null)));
  }

  /**
   * Qué puede GENERAR y CARGAR esta persona: solo lo chuleado para la empresa usuaria y el centro
   * de su requisición vigente (ms-templates `DocumentosPermitidos`, la misma regla que valida la
   * carga y la generación en el servidor). Sin respuesta: un ERROR con el motivo, nunca "todo".
   */
  permitidos(cedula: string): Observable<PermitidosPersona> {
    return this.http.post<PermitidosPersona>(`${this.plantillas}/permitidos`, { cedula }).pipe(
      catchError((err) => of({
        estado: 'ERROR', modo: null, restriccion: 'BLOQUEO', motivo: 'SIN_RESPUESTA',
        mensaje: err?.error?.error ?? 'No se pudo validar qué documentos permite la requisición de esta persona.',
        requisicion: null, documentos: [], tipos_gobernados: [], codigos_gobernados: [],
        tipos_permitidos: [], codigos_permitidos: [],
      } as PermitidosPersona)),
    );
  }

  /**
   * ¿Se puede generar o cargar este tipo de gestión documental? Mismo criterio que el servidor:
   * sin restricción o en AVISO todo pasa; un tipo fuera del catálogo del parametrizador no se
   * restringe; con ERROR (temporal en ON y parametrización sin resolver) nada pasa.
   */
  static tipoPermitido(p: PermitidosPersona | null | undefined, typeId: number | null): boolean {
    if (!p || p.restriccion !== 'BLOQUEO' || p.estado === 'SIN_RESTRICCION') return true;
    if (p.estado === 'ERROR') return false;
    if (typeId == null || !p.tipos_gobernados.includes(typeId)) return true;
    return p.tipos_permitidos.includes(typeId);
  }

  /** ¿La regla manda sobre esta persona? (temporal en ON, con requisición, restricción no apagada). */
  static restringe(p: PermitidosPersona | null | undefined): boolean {
    return !!p && p.estado !== 'SIN_RESTRICCION' && p.restriccion !== 'OFF';
  }

  /** La plantilla en HTML con los datos de la persona y los campos marcados para completar. */
  vistaPlantilla(clave: string, cedula: string, centroCostoId: number, usuario?: UsuarioDocumento | null): Observable<VistaPlantilla> {
    return this.http.post<VistaPlantilla>(`${this.plantillas}/${encodeURIComponent(clave)}/vista`,
      { cedula, centro_costo_id: centroCostoId, ...datosSesion(usuario) });
  }

  /**
   * Genera el PDF con lo completado a mano (`valores`: expresión -> texto). Con `persistir`
   * queda guardado en gestión documental con el tipo de la plantilla.
   */
  generarPlantilla(clave: string, cedula: string, centroCostoId: number,
                   valores: Record<string, string>, persistir: boolean, usuario?: UsuarioDocumento | null,
                   datos?: { guardar: boolean; confirmarSobrescritura?: boolean }): Observable<Blob> {
    return this.http.post(`${this.plantillas}/${encodeURIComponent(clave)}/generar`,
      {
        cedula, centro_costo_id: centroCostoId, persistir, valores, ...datosSesion(usuario),
        // Llenado bilateral: lo escrito vuelve también a los datos de la persona (ms-hr).
        guardar_datos: !!datos?.guardar,
        confirmar_sobrescritura: !!datos?.confirmarSobrescritura,
      },
      { responseType: 'blob' });
  }

  /**
   * Qué pasaría con los datos de la persona al guardar el documento, sin escribir nada: lo que
   * va a la base, los datos existentes que se reemplazan y lo que solo cambia el PDF.
   */
  revisarDatosPlantilla(clave: string, cedula: string, centroCostoId: number, valores: Record<string, string>,
                        usuario?: UsuarioDocumento | null): Observable<RevisionDatosPlantilla> {
    return this.http.post<RevisionDatosPlantilla>(`${this.plantillas}/${encodeURIComponent(clave)}/datos/revisar`,
      { cedula, centro_costo_id: centroCostoId, valores, ...datosSesion(usuario) });
  }

  /** Correo del candidato, documentos que debe firmar y la última solicitud de firma. */
  estadoFirma(cedula: string): Observable<EstadoFirma> {
    return this.http.get<EstadoFirma>(`${this.firma}/estado`, { params: { cedula } });
  }

  /**
   * Envía al correo del candidato los documentos a firmar, generados con lo diligenciado
   * (`valores` por clave de plantilla, del borrador de cada documento).
   */
  solicitarFirma(cedula: string, centroCostoId: number, valores: Record<string, Record<string, string>>,
                 usuario?: UsuarioDocumento | null): Observable<{ id: number; correo: string; documentos: number; expira_en: string }> {
    return this.http.post<{ id: number; correo: string; documentos: number; expira_en: string }>(`${this.firma}/solicitar`,
      { cedula, centro_costo_id: centroCostoId, valores, ...datosSesion(usuario) });
  }

  /**
   * Firma presencial de UN documento (V41 de ms-templates): devuelve el enlace de la misma página
   * de firma del correo para que el trabajador firme ahí mismo; al finalizar queda consolidado
   * igual que por correo. `valores` = lo diligenciado en la vista de ese documento.
   */
  firmarPresencial(cedula: string, centroCostoId: number, clave: string, valores: Record<string, string>,
                   usuario?: UsuarioDocumento | null): Observable<FirmaPresencial> {
    return this.http.post<FirmaPresencial>(`${this.firma}/presencial`,
      { cedula, centro_costo_id: centroCostoId, clave, valores, ...datosSesion(usuario) });
  }
}

export interface FirmaPresencial { id: number; enlace: string; documento: string; expira_en: string; }

/** Firma electrónica del candidato (ms-templates `/plantillas/firma`). */
export interface DocumentoAFirmar { codigo: string; nombre: string; clave: string; }

export interface SolicitudFirmaResumen {
  id: number;
  estado: 'PENDIENTE' | 'FIRMADA' | 'VENCIDA' | 'ANULADA';
  correo: string;
  solicitada_en: string;
  solicitada_por: string | null;
  expira_en: string;
  firmada_en: string | null;
  documentos: { orden: number; codigo: string; nombre: string; sha256_enviado: string; document_id: number | null }[];
  eventos: { tipo: string; ocurrido_en: string; detalle: string | null }[];
}

export interface EstadoFirma {
  correo: string | null;
  correo_confirmado: boolean | null;
  nombre: string | null;
  documentos: DocumentoAFirmar[];
  /** Por qué no se puede solicitar (sin parametrización, nada marcado con firma...). */
  motivo: string | null;
  ultima: SolicitudFirmaResumen | null;
}

/**
 * Quien genera el documento. Alimenta la fuente `sesion` del diccionario de ms-templates:
 * el nombre es "Persona que hace Contratación" y el testigo 1 del contrato, el documento es
 * su "No de CC", y de la sede sale el municipio donde se firma.
 */
export interface UsuarioDocumento {
  nombre?: string | null;
  documento?: string | null;
  sede?: string | null;
}

function datosSesion(u?: UsuarioDocumento | null): Record<string, string | null> {
  return {
    usuario_nombre: u?.nombre || null,
    usuario_documento: u?.documento || null,
    usuario_sede: u?.sede || null,
  };
}

/** Respuesta de `/plantillas/excel/permitidos` (ms-templates, `DocumentosPermitidos`). */
export interface PermitidosPersona {
  /** SIN_RESTRICCION: la regla no aplica (temporal no está en ON, sin requisición...; ver `motivo`). */
  estado: 'SIN_RESTRICCION' | 'OK' | 'ERROR';
  modo: string | null;
  /** Interruptor de la regla en el servidor: OFF | AVISO | BLOQUEO. */
  restriccion: 'OFF' | 'AVISO' | 'BLOQUEO';
  motivo: string | null;
  mensaje: string | null;
  requisicion: {
    publicacion_id: number | string | null; temporal: string | null; empresa: string | null; finca: string | null;
    cargo: string | null; centro_canonico_id: number | null; empresa_vacante_id: number | null;
  } | null;
  documentos: {
    codigo: string; nombre: string; naturaleza: string; plantilla_codigo: string | null;
    tipo_documento_ref: number | null; obligatorio: boolean; aplica: boolean; motivo: string | null;
  }[];
  tipos_gobernados: number[];
  codigos_gobernados: string[];
  tipos_permitidos: number[];
  codigos_permitidos: string[];
}

/** Respuesta de `/plantillas/excel/condiciones` (ms-templates, `EsForaneo`). */
export interface CondicionesPersona {
  foraneo: boolean;
  /** OFICINA_FORANEOS | GRUPO_PAGO_FORANEOS */
  razones: string[];
}

/**
 * Títulos que solo se exigen a foráneos (espejo de `EsForaneo.TIPOS_SOLO_FORANEOS`, por título).
 * Pasa al catálogo como condición SOLO_FORANEOS cuando se despliegue ms-auth-admin.
 */
export const SOLO_FORANEOS: ReadonlySet<string> = new Set(['Auxilio Extralegal de Alimentación y Hospedaje', 'Programa Foráneos']);

/** Respuesta de `/plantillas/excel/{clave}/vista`. */
export interface VistaPlantilla {
  clave: string;
  version: number;
  /** Documento completo (CSS, fuentes y logos incrustados). Campos: `span.ph-edit[data-expr]`. */
  html: string;
  campos: number;
  vacios: number;
  /**
   * Datos de la temporal que la plantilla usa y no están cargados (`nit`,
   * `representante_legal_nombre`…). La vista abre igual; generar responde 409 mientras falten.
   */
  faltan_temporal?: string[];
  /** Preguntas SI/NO de la plantilla: se contestan como radio y son obligatorias. */
  controles?: ControlPlantilla[];
  /**
   * Expresiones (`data-expr`) cuyo dato vive en una columna de la persona: lo que se escriba en
   * ellas se guarda también en sus datos al consolidar. Las demás solo cambian el PDF.
   */
  guardables?: string[];
}

/** Un campo del documento frente a los datos de la persona (respuesta de ms-hr). */
export interface CambioDatoDocumento {
  etiqueta: string | null;
  entidad: string;
  campo: string;
  antes: string | null;
  despues: string | null;
  estado: 'GUARDAR' | 'SIN_CAMBIO' | 'NO_SE_GUARDA';
  /** Reemplaza un dato que ya estaba en la base. */
  sobrescribe: boolean;
  /** Crea un registro nuevo (un hijo, el cónyuge…). */
  crea: boolean;
  motivo: string | null;
}

/** `/plantillas/excel/{clave}/datos/revisar` y el cuerpo del 409 `DATOS_SOBRESCRIBEN`. */
export interface RevisionDatosPlantilla {
  aplicado: boolean;
  guardar: number;
  sobrescribe: number;
  no_se_guarda: number;
  cambios: CambioDatoDocumento[];
  /** Escrito a mano que solo cambia el PDF (dato de la empresa, compuesto, texto fijo…). */
  solo_documento: { etiqueta: string; motivo: string }[];
}

function tiposDe(d: DocumentosResueltos): Set<number> {
  return new Set((d?.documentos ?? []).map((x) => x.tipo?.tipo_documento_ref).filter((x): x is number => x != null));
}
