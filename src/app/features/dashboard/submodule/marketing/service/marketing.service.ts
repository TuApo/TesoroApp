import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import { environment } from '@/environments/environment';

/** Una pieza: la generó el motor o la subió alguien. */
export interface Pieza {
  id: string;
  titulo: string | null;
  origen: 'VACANTE' | 'OFICINA' | 'CAMPANA' | 'LIBRE';
  vacante_id: number | null;
  formato: string | null;
  estado: 'PENDIENTE' | 'GENERANDO' | 'LISTA' | 'ERROR' | 'ARCHIVADA' | 'REVISAR';
  ancho_px: number | null;
  alto_px: number | null;
  tiene_imagen: boolean;
  tiene_pdf: boolean;
  copy_texto: string | null;
  error_detalle: string | null;
  es_subida: boolean;
  creado_en: string;
}

export interface TokenMarca {
  grupo: string; clave: string; valor: string; etiqueta: string | null; nota: string | null;
}
export interface Marca {
  id: string; clave: string; nombre: string; descripcion: string | null;
  tono_de_voz: string | null; predeterminada: boolean; tokens: TokenMarca[];
}
export interface SeccionManual {
  slug: string; titulo: string; resumen: string | null; cuerpo_html: string | null; orden: number;
}
export interface ResumenGeneracion {
  vacanteId: number; generadas: number; reutilizadas: number; fallidas: number; motivos: string[];
}
export interface EnlacePropio {
  codigo: string; url: string; url_legible: string; vacante_id: number | null; creado_en: string;
}

/** Los numeros de cabecera del tablero. `es_global` dice si se esta viendo todo o solo lo propio. */
export interface ResumenTablero {
  clics: number; clics_unicos: number; enlaces_activos: number;
  preregistros: number; entrevistas: number; contratados: number; difusores: number;
  piezas_generadas: number; piezas_con_error: number; descargas: number;
  tasa_registro: number; tasa_contratacion: number;
  desde: string; hasta: string; es_global: boolean;
}
export interface PuntoSerie { fecha: string; clics: number; preregistros: number; contratados: number; }
export interface FilaRanking {
  usuario_id: string; codigo: string; clics: number;
  preregistros: number; contratados: number; tasa_registro: number;
}
export interface CorteCanal { etiqueta: string; clics: number; }
export interface Canales { dispositivo: CorteCanal[]; navegador: CorteCanal[]; canal: CorteCanal[]; }
export interface FilaVacante { vacante_id: number; clics: number; difusores: number; preregistros: number; }

/** Un juego de plantillas con su regla de vigencia. */
export interface Programacion {
  id: string; marca_id: string; nombre: string;
  tipo: 'MENSUAL' | 'RANGO' | 'PERMANENTE';
  mes: number | null; anio: number | null;
  desde: string | null; hasta: string | null;
  repetir_anual: boolean; prioridad: number; piezas_por_vacante: number;
  activo: boolean; plantillas_count: number;
  /** Rige en la fecha consultada. */
  vigente?: boolean;
  /** De las vigentes, ES la que se aplicaría: con varias a la vez manda la de más prioridad. */
  gana?: boolean;
}
export interface ItemProgramacion {
  id?: string; plantilla_id: string; plantilla_nombre?: string;
  peso: number; obligatoria: boolean; orden: number;
}
export interface AlcanceProgramacion { tipo: string; valor: string; }
export interface Vigente extends Programacion {
  fecha: string; hay?: boolean; nota?: string;
  plantillas?: ItemProgramacion[]; alcance?: AlcanceProgramacion[];
}
/** Lo que devuelve de verdad `/plantillas`. Sin `clave` ni `activa`: esos campos no salen. */
export interface PlantillaResumen {
  id: string; nombre: string; descripcion: string | null;
  categoria: string | null; estado: string; marca_id: string;
}

/** Una imagen del banco. `seleccionable` es lo único que decide si se puede usar. */
export interface ImagenBanco {
  id: string;
  tipo: 'FOTO_PERSONA' | 'FOTO_LUGAR' | 'FONDO' | 'RECURSO';
  titulo: string; mime: string | null;
  ancho_px: number | null; alto_px: number | null;
  oficina_id: string | null; empresa_usuaria: string | null; etiquetas: string | null;
  exige_consentimiento: boolean;
  seleccionable: boolean;
  motivo_bloqueo: string | null;
  creado_en: string;
}
export interface Consentimiento {
  id: string; persona_cedula: string; nombre: string | null;
  tiene_documento: boolean;
  vigente_desde: string; vigente_hasta: string | null;
  revocado_en: string | null; revocado_motivo: string | null;
  vigente: boolean; observacion: string | null;
}

/** Una convocatoria con su periodo. `vigente` = activa Y dentro de plazo. */
export interface Campana {
  id: string; marca_id: string; nombre: string;
  objetivo: string | null; publico: string | null;
  desde: string | null; hasta: string | null;
  estado: 'BORRADOR' | 'ACTIVA' | 'CERRADA';
  responsable_id: string | null;
  vigente: boolean; en_plazo: boolean;
  dias_restantes: number | null;
  creado_en: string;
}
export interface ResumenCampana extends ResumenTablero {
  campana: Campana;
  /** Si es `false`, las cifras salen de los últimos 90 días y no de su periodo. */
  periodo_declarado: boolean;
}

export interface FormatoPlantilla {
  clave: string; ancho_px: number; alto_px: number; dpi: number; salida: string;
}
export interface DetallePlantilla {
  id: string; nombre: string; descripcion: string | null; categoria: string | null;
  estado: string; marca_id: string;
  version_numero: number; version_id: string;
  html: string; css: string | null; variables_schema: string | null;
  notas_cambio: string | null; publicada_en: string | null;
  formatos: FormatoPlantilla[];
  versiones: { id: string; numero: number; notas: string }[];
}
/** Un formato ensayado. `imagen` es un data URI listo para un `<img>`. */
export interface ResultadoEnsayo {
  formato: string; ancho_px: number; alto_px: number;
  cabe: boolean; problemas: Record<string, unknown>[];
  error: string | null; imagen: string | null;
}
export interface Ensayo {
  cabe_en_todos: boolean; fallan: string[]; resultados: ResultadoEnsayo[];
}

// ── seguimiento de vacantes ───────────────────────────────────────────────
export interface VacanteSeguimiento {
  vacante_id: number; cargo: string; empresa: string; finca: string;
  municipios: string; fecha_ingreso: string; cupos: string;
  estado_vacante: string; temporal: string;
  estado: 'SIN_MATERIAL' | 'EN_PROCESO' | 'LISTA' | 'PUBLICADA' | 'CERRADA';
  piezas: number; adjuntos: number; posts: number; notas: string | null;
}
export interface ListadoSeguimiento {
  vacantes: VacanteSeguimiento[]; total: number; sin_material: number; aviso?: string;
}
export interface Adjunto {
  id: string; titulo: string; descripcion: string | null;
  tipo_contenido: string; tipo_legible: string;
  mime: string | null; tamano_bytes: number | null;
  tiene_personas: boolean; consentimiento_ok: boolean;
  publicable: boolean; es_imagen: boolean; creado_en: string;
}
export interface PostGenerado {
  id: string; vacante_id: number; tono_perfil_id: string | null; tono_nombre: string | null;
  canal: string; texto: string; hashtags: string | null; cta: string | null;
  estado: 'BORRADOR' | 'APROBADO' | 'PUBLICADO' | 'DESCARTADO';
  generado_por_ia: boolean; creado_en: string;
}
export interface TonoResumen {
  id: string; clave: string; nombre: string; descripcion: string | null;
  canal_sugerido: string | null; formalidad: number; longitud_max: number;
  predeterminado: boolean;
}
export interface DetalleSeguimiento {
  vacante: Record<string, unknown>;
  seguimiento: { estado: string; notas: string | null } | null;
  piezas: number; adjuntos: Adjunto[]; posts: PostGenerado[]; tonos: TonoResumen[];
}

// ── configuración de marcas ───────────────────────────────────────────────
export interface Tono extends TonoResumen {
  instruccion: string; ejemplo: string | null; usa_emojis: boolean;
  activo: boolean; orden: number;
}
/** Un requisito de la marca. `como_resolver` dice adónde ir si no se cumple. */
export interface PuntoCompletitud {
  clave: string; titulo: string; porque: string;
  cumple: boolean; detalle: string; como_resolver: string;
}
export interface ResumenCompletitud {
  obligatorio_total: number; obligatorio_ok: number; obligatorio_falta: number;
  ampliado_total: number; ampliado_ok: number;
  lista_para_usar: boolean; porcentaje_ampliado: number;
}
export interface MarcaConfig extends ResumenCompletitud {
  id: string; clave: string; nombre: string; descripcion: string | null;
  predeterminada: boolean; activo: boolean; tonos: number;
}
/** Un activo de marca: logo, isotipo, fondo, textura o el archivo de la fuente. */
export interface ActivoMarca {
  id: string; tipo: string; nombre: string; mime: string | null;
  uso_permitido: string | null; licencia: string | null; tiene_archivo: boolean;
}

export interface DetalleMarcaConfig {
  id: string; clave: string; nombre: string; descripcion: string | null;
  tono_de_voz: string | null; predeterminada: boolean;
  tokens: { id: string; grupo: string; clave: string; valor: string;
            etiqueta: string | null; nota: string | null }[];
  tonos: Tono[];
  obligatorio: PuntoCompletitud[];
  ampliado: PuntoCompletitud[];
  resumen: ResumenCompletitud;
}

@Injectable({ providedIn: 'root' })
export class MarketingService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/marketing`;

  /** Las marcas cambian poco: se cachean para no pedirlas en cada pantalla. */
  private marcas$?: Observable<Marca[]>;

  marcas(): Observable<Marca[]> {
    if (!this.marcas$) {
      this.marcas$ = this.http.get<Marca[]>(`${this.base}/marcas`).pipe(shareReplay(1));
    }
    return this.marcas$;
  }

  manual(marcaId: string): Observable<SeccionManual[]> {
    return this.http.get<SeccionManual[]>(`${this.base}/marcas/${marcaId}/manual`);
  }

  galeria(estado = 'LISTA', limite = 60): Observable<Pieza[]> {
    return this.http.get<Pieza[]>(`${this.base}/piezas?estado=${estado}&limite=${limite}`);
  }

  deVacante(vacanteId: number): Observable<Pieza[]> {
    return this.http.get<Pieza[]>(`${this.base}/vacantes/${vacanteId}/piezas`);
  }

  generar(vacanteId: number): Observable<ResumenGeneracion> {
    return this.http.post<ResumenGeneracion>(`${this.base}/vacantes/${vacanteId}/generar`, {});
  }

  misEnlaces(): Observable<{ codigo: string | null; enlaces: EnlacePropio[] }> {
    return this.http.get<{ codigo: string | null; enlaces: EnlacePropio[] }>(`${this.base}/mis-enlaces`);
  }

  /**
   * Trae el binario como blob.
   *
   * <p>No se puede poner la URL directamente en un `<img src>`: la peticion necesita la
   * cabecera de autorizacion y una etiqueta img no la manda. Por eso se descarga con
   * HttpClient y se convierte en una URL de objeto.
   */
  archivo(piezaId: string, formato: 'imagen' | 'pdf' = 'imagen', canal?: string): Observable<Blob> {
    const q = canal ? `&canal=${encodeURIComponent(canal)}` : '';
    return this.http.get(`${this.base}/piezas/${piezaId}/archivo?formato=${formato}${q}`,
      { responseType: 'blob' });
  }

  /** URL de objeto lista para pintar. Quien la use debe revocarla al destruir la vista. */
  urlDeVista(piezaId: string): Observable<string> {
    return this.archivo(piezaId, 'imagen').pipe(map((b) => URL.createObjectURL(b)));
  }

  subirPieza(datos: {
    archivo: File; titulo: string; destinoTipo?: string; destinos?: string[]; copyTexto?: string;
  }): Observable<Pieza> {
    const fd = new FormData();
    fd.append('archivo', datos.archivo);
    fd.append('titulo', datos.titulo);
    if (datos.destinoTipo) fd.append('destinoTipo', datos.destinoTipo);
    for (const d of datos.destinos ?? []) fd.append('destinos', d);
    if (datos.copyTexto) fd.append('copyTexto', datos.copyTexto);
    return this.http.post<Pieza>(`${this.base}/piezas/subir`, fd);
  }

  subirActivoDeMarca(marcaId: string, archivo: File, tipo: string, extras: {
    nombre?: string; familiaCss?: string; usoPermitido?: string; licencia?: string;
  } = {}): Observable<unknown> {
    const fd = new FormData();
    fd.append('archivo', archivo);
    const q = new URLSearchParams({ tipo });
    for (const [k, v] of Object.entries(extras)) if (v) q.set(k, v);
    return this.http.post(`${this.base}/marcas/${marcaId}/activos?${q}`, fd);
  }

  // ── tablero ─────────────────────────────────────────────────────────────

  /**
   * El rango va en la URL como `desde`/`hasta` en ISO. El backend recorta por rol: pedir
   * el ranking sin ser administrador devuelve una lista vacia, no un error, para que la
   * pantalla no tenga que saber de permisos.
   */
  private rango(desde: string, hasta: string): string {
    return `desde=${desde}&hasta=${hasta}`;
  }

  resumenTablero(desde: string, hasta: string): Observable<ResumenTablero> {
    return this.http.get<ResumenTablero>(`${this.base}/tablero/resumen?${this.rango(desde, hasta)}`);
  }

  serieTablero(desde: string, hasta: string): Observable<PuntoSerie[]> {
    return this.http.get<PuntoSerie[]>(`${this.base}/tablero/serie?${this.rango(desde, hasta)}`);
  }

  rankingTablero(desde: string, hasta: string, limite = 20): Observable<FilaRanking[]> {
    return this.http.get<FilaRanking[]>(
      `${this.base}/tablero/ranking?${this.rango(desde, hasta)}&limite=${limite}`);
  }

  canalesTablero(desde: string, hasta: string): Observable<Canales> {
    return this.http.get<Canales>(`${this.base}/tablero/canales?${this.rango(desde, hasta)}`);
  }

  vacantesTablero(desde: string, hasta: string, limite = 15): Observable<FilaVacante[]> {
    return this.http.get<FilaVacante[]>(
      `${this.base}/tablero/vacantes?${this.rango(desde, hasta)}&limite=${limite}`);
  }


  // ── programación ────────────────────────────────────────────────────────

  /**
   * Las plantillas. **Con marca**, porque sin ella el backend devuelve las de todas y en
   * pantalla salen cuatro filas con dos nombres repetidos: no hay forma de saber cuál es
   * de qué marca, y se puede meter una plantilla de Tu Alianza en el juego de Apoyo
   * Laboral. Con `marcaId` el backend no filtra por estado, así que eso se hace aquí.
   */
  plantillas(marcaId?: string): Observable<PlantillaResumen[]> {
    const url = marcaId ? `${this.base}/plantillas?marcaId=${marcaId}` : `${this.base}/plantillas`;
    return this.http.get<PlantillaResumen[]>(url).pipe(
      map((l) => l.filter((p) => p.estado === 'PUBLICADA')),
    );
  }

  programaciones(marcaId: string, fecha: string): Observable<Programacion[]> {
    return this.http.get<Programacion[]>(
      `${this.base}/programaciones?marcaId=${marcaId}&fecha=${fecha}`);
  }

  /** Qué juego saldría si se creara una vacante ese día. */
  vigente(marcaId: string, fecha: string): Observable<Vigente> {
    return this.http.get<Vigente>(
      `${this.base}/programaciones/vigente?marcaId=${marcaId}&fecha=${fecha}`);
  }

  crearProgramacion(body: Partial<Programacion>): Observable<Programacion> {
    return this.http.post<Programacion>(`${this.base}/programaciones`, body);
  }

  editarProgramacion(id: string, body: Partial<Programacion>): Observable<Programacion> {
    return this.http.put<Programacion>(`${this.base}/programaciones/${id}`, body);
  }

  desactivarProgramacion(id: string): Observable<{ desactivada: boolean }> {
    return this.http.delete<{ desactivada: boolean }>(`${this.base}/programaciones/${id}`);
  }

  /** La lista se reemplaza entera: es como se edita en pantalla y evita mezclas raras. */
  fijarPlantillas(id: string, items: Partial<ItemProgramacion>[]): Observable<ItemProgramacion[]> {
    return this.http.put<ItemProgramacion[]>(`${this.base}/programaciones/${id}/plantillas`, items);
  }


  // ── banco de imágenes ───────────────────────────────────────────────────

  banco(tipo?: string, limite = 60): Observable<ImagenBanco[]> {
    const q = tipo ? `tipo=${tipo}&limite=${limite}` : `limite=${limite}`;
    return this.http.get<ImagenBanco[]>(`${this.base}/banco?${q}`);
  }

  consentimientosDe(id: string): Observable<Consentimiento[]> {
    return this.http.get<Consentimiento[]>(`${this.base}/banco/${id}/consentimientos`);
  }

  /** Igual que las piezas: la imagen viaja como blob porque la petición necesita el JWT. */
  imagenBanco(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/banco/${id}/archivo`, { responseType: 'blob' });
  }

  subirAlBanco(datos: FormData): Observable<ImagenBanco> {
    return this.http.post<ImagenBanco>(`${this.base}/banco`, datos);
  }

  registrarConsentimiento(id: string, datos: FormData): Observable<{ vigente: boolean }> {
    return this.http.post<{ vigente: boolean }>(`${this.base}/banco/${id}/consentimiento`, datos);
  }

  revocarConsentimiento(consentimientoId: string, motivo: string): Observable<{ revocado: boolean }> {
    return this.http.post<{ revocado: boolean }>(
      `${this.base}/banco/consentimientos/${consentimientoId}/revocar`, { motivo });
  }

  retirarDelBanco(id: string): Observable<{ retirada: boolean }> {
    return this.http.delete<{ retirada: boolean }>(`${this.base}/banco/${id}`);
  }


  // ── campañas ────────────────────────────────────────────────────────────

  campanas(marcaId: string, estado?: string): Observable<Campana[]> {
    const q = estado ? `marcaId=${marcaId}&estado=${estado}` : `marcaId=${marcaId}`;
    return this.http.get<Campana[]>(`${this.base}/campanas?${q}`);
  }

  resumenCampana(id: string): Observable<ResumenCampana> {
    return this.http.get<ResumenCampana>(`${this.base}/campanas/${id}/resumen`);
  }

  crearCampana(body: Partial<Campana>): Observable<Campana> {
    return this.http.post<Campana>(`${this.base}/campanas`, body);
  }

  editarCampana(id: string, body: Partial<Campana>): Observable<Campana> {
    return this.http.put<Campana>(`${this.base}/campanas/${id}`, body);
  }

  estadoCampana(id: string, estado: string): Observable<Campana> {
    return this.http.post<Campana>(`${this.base}/campanas/${id}/estado`, { estado });
  }


  // ── editor de plantillas ────────────────────────────────────────────────

  detallePlantilla(id: string): Observable<DetallePlantilla> {
    return this.http.get<DetallePlantilla>(`${this.base}/plantillas/${id}/detalle`);
  }

  /** Renderiza lo que se está editando sin guardar nada. */
  ensayarPlantilla(id: string, html: string, css: string): Observable<Ensayo> {
    return this.http.post<Ensayo>(`${this.base}/plantillas/${id}/ensayo`, { html, css });
  }

  /** Publica. El backend lo rechaza si no cabe en algún formato. */
  publicarPlantilla(id: string, html: string, css: string, notas: string): Observable<unknown> {
    return this.http.post(`${this.base}/plantillas/${id}/versiones`,
      { html, css, notas_cambio: notas });
  }

  restaurarVersion(id: string, versionId: string): Observable<unknown> {
    return this.http.post(`${this.base}/plantillas/${id}/versiones/${versionId}/restaurar`, {});
  }


  // ── seguimiento de vacantes ─────────────────────────────────────────────

  seguimiento(estado?: string, busca?: string): Observable<ListadoSeguimiento> {
    const q = new URLSearchParams();
    if (estado) q.set('estado', estado);
    if (busca) q.set('busca', busca);
    return this.http.get<ListadoSeguimiento>(`${this.base}/seguimiento/vacantes?${q}`);
  }

  detalleSeguimiento(vacanteId: number): Observable<DetalleSeguimiento> {
    return this.http.get<DetalleSeguimiento>(`${this.base}/seguimiento/vacantes/${vacanteId}`);
  }

  generarPiezasDe(vacanteId: number): Observable<ResumenGeneracion> {
    return this.http.post<ResumenGeneracion>(
      `${this.base}/seguimiento/vacantes/${vacanteId}/piezas`, {});
  }

  generarPost(vacanteId: number, tonoPerfilId: string, canal?: string): Observable<PostGenerado> {
    return this.http.post<PostGenerado>(`${this.base}/seguimiento/vacantes/${vacanteId}/posts`,
      { tono_perfil_id: tonoPerfilId, canal });
  }

  editarPost(postId: string, cambios: Partial<PostGenerado>): Observable<PostGenerado> {
    return this.http.put<PostGenerado>(`${this.base}/seguimiento/posts/${postId}`, cambios);
  }

  adjuntar(vacanteId: number, datos: FormData): Observable<Adjunto> {
    return this.http.post<Adjunto>(`${this.base}/seguimiento/vacantes/${vacanteId}/adjuntos`, datos);
  }

  reclasificar(adjuntoId: string, cambios: Partial<Adjunto>): Observable<Adjunto> {
    return this.http.put<Adjunto>(`${this.base}/seguimiento/adjuntos/${adjuntoId}`, cambios);
  }

  retirarAdjunto(adjuntoId: string): Observable<{ retirado: boolean }> {
    return this.http.delete<{ retirado: boolean }>(`${this.base}/seguimiento/adjuntos/${adjuntoId}`);
  }

  archivoAdjunto(adjuntoId: string): Observable<Blob> {
    return this.http.get(`${this.base}/seguimiento/adjuntos/${adjuntoId}/archivo`,
      { responseType: 'blob' });
  }

  actualizarSeguimiento(vacanteId: number, cambios: { estado?: string; notas?: string }):
      Observable<unknown> {
    return this.http.put(`${this.base}/seguimiento/vacantes/${vacanteId}`, cambios);
  }

  // ── configuración de marcas ─────────────────────────────────────────────

  marcasConfig(): Observable<MarcaConfig[]> {
    return this.http.get<MarcaConfig[]>(`${this.base}/config-marcas`);
  }

  detalleMarcaConfig(marcaId: string): Observable<DetalleMarcaConfig> {
    return this.http.get<DetalleMarcaConfig>(`${this.base}/config-marcas/${marcaId}`);
  }

  editarIdentidad(marcaId: string, cambios: { nombre?: string; descripcion?: string;
                                              tono_de_voz?: string }): Observable<unknown> {
    return this.http.put(`${this.base}/config-marcas/${marcaId}`, cambios);
  }

  fijarToken(marcaId: string, token: { grupo?: string; clave: string; valor: string;
                                       etiqueta?: string; nota?: string }): Observable<unknown> {
    return this.http.put(`${this.base}/config-marcas/${marcaId}/tokens`, token);
  }

  crearTono(marcaId: string, tono: Partial<Tono>): Observable<Tono> {
    return this.http.post<Tono>(`${this.base}/config-marcas/${marcaId}/tonos`, tono);
  }

  editarTono(marcaId: string, tonoId: string, tono: Partial<Tono>): Observable<Tono> {
    return this.http.put<Tono>(`${this.base}/config-marcas/${marcaId}/tonos/${tonoId}`, tono);
  }

  desactivarTono(marcaId: string, tonoId: string): Observable<unknown> {
    return this.http.delete(`${this.base}/config-marcas/${marcaId}/tonos/${tonoId}`);
  }

  activosDeMarca(marcaId: string): Observable<ActivoMarca[]> {
    return this.http.get<ActivoMarca[]>(`${this.base}/marcas/${marcaId}/activos`);
  }

  subirActivoMarca(marcaId: string, datos: FormData): Observable<unknown> {
    return this.http.post(`${this.base}/marcas/${marcaId}/activos`, datos);
  }

}
