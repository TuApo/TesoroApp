/** Modelos de Infraestructura › DevOps (ms-infra /api/v1/infra/devops, JSON snake_case). */

export interface Ejecucion {
  id: number; numero: number; flujo: string; rama: string | null; evento: string | null;
  estado: string | null; conclusion: string | null; creada: string | null; actualizada: string | null;
  duracion_seg: number; url: string | null; titulo: string | null; actor: string | null; destino: string | null;
}
export interface Artefacto { id: number; nombre: string; bytes: number; expirado: boolean; creado: string | null }
export interface Paso { nombre: string; estado: string; conclusion: string | null; duracion_seg: number }
export interface DetalleEjecucion {
  ejecucion: Ejecucion; pasos: Paso[]; artefactos: Artefacto[]; verificacion: Record<string, unknown> | null;
}
export interface VersionPlay { nombre: string | null; estado: string | null; codigos: number[]; fraccion: number | null; notas: string | null }
export interface PistaPlay { pista: string; versiones: VersionPlay[] }
export interface EstadoPlay { configurado: boolean; paquete: string; cuenta: string | null; pistas: PistaPlay[]; error: string | null }
export interface Descarga { nombre: string; bytes: number; modificado: number }
export interface EstadoServidor {
  version_web: string | null; web_iniciada: number | null; web_salud: string | null;
  latest: Record<string, unknown> | null; descargas: Descarga[]; error: string | null;
}
export interface Plataforma {
  clave: string; nombre: string; icono: string; estado: string; version: string | null;
  detalle: string | null; fecha: string | null; url: string | null;
}
export interface Integracion {
  clave: string; grupo: string; nombre: string; estado: 'OK' | 'AVISO' | 'FALTA' | 'ERROR' | 'DESCONOCIDO' | string;
  detalle: string | null; accion: string | null; url: string | null;
}
export interface Chequeo { clave: string; nombre: string; estado: string; detalle: string | null }
export interface Integridad {
  origen: string | null; version: string | null; version_code: number | null; fecha: string | null;
  chequeos: Chequeo[]; crudo: Record<string, unknown> | null;
}
export interface Trabajo {
  id: string; tipo: string; usuario: string | null; creado: string | null; estado: string;
  inicio: string | null; fin: string | null; codigo: number | null; log: string | null; url: string | null;
}
export interface Accion {
  tipo: string; nombre: string; descripcion: string; icono: string; disponible: boolean;
  motivo: string | null; destinos: string[];
}
export interface ResumenDevops {
  plataformas: Plataforma[]; ejecuciones: Ejecucion[]; play: EstadoPlay; servidor: EstadoServidor;
  integraciones: Integracion[]; trabajos: Trabajo[]; acciones: Accion[]; repo: string; rama: string; generado: string;
}
export interface OrdenIn { tipo: string; destino?: string | null; estado?: string | null; rama?: string | null }
export interface OrdenOut { canal: 'github' | 'servidor'; mensaje: string; rama?: string; trabajo?: Trabajo }
