import { Injectable, inject } from '@angular/core';

import { UtilityServiceService } from '../utilityService/utility-service.service';
import { SedeOperativa } from '../../models/sede-alcance.model';

/**
 * Alcance de sedes del usuario en sesión: sobre qué oficinas puede operar.
 *
 * Es el único punto donde se decide qué filas de un tablero puede tocar alguien por
 * razón de sede. Antes cada módulo leía `user.sede.nombre` (una sola oficina), así que
 * un usuario con varias sedes asignadas solo veía una. Aquí se lee la lista completa
 * que el login deja en `user.sedes` (ms-auth-admin V62), donde cada entrada trae su
 * vigencia: las temporales caducan a las 24 h y el backend deja de enviarlas.
 *
 * Reglas:
 *  - ADMIN y GERENCIA no se recortan por sede: ven todas las oficinas.
 *  - El resto opera sobre sus sedes vigentes; con una sola, el comportamiento es el
 *    de siempre (el filtro queda anclado y no se puede cambiar).
 */
@Injectable({ providedIn: 'root' })
export class SedeScopeService {
  private readonly util = inject(UtilityServiceService);

  /** Roles que no se recortan por sede (los mismos que ya usaba el filtro de Vacantes). */
  private static readonly ROLES_SIN_LIMITE = ['ADMIN', 'GERENCIA'];

  private static normalizar(v: unknown): string {
    return String(v ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/_/g, ' ')
      .toLowerCase().trim();
  }

  private usuario(): any {
    return this.util.getUser?.() ?? null;
  }

  private rolesDe(user: any): string[] {
    const raw = user?.roles ?? user?.rol ?? [];
    const lista: any[] = Array.isArray(raw) ? raw : [raw];
    return lista
      .map((r: any) => (typeof r === 'string' ? r : r?.nombre))
      .filter((v: any): v is string => !!v)
      .map((v: string) => v.toUpperCase());
  }

  /** true si el usuario no se recorta por sede (ve todas las oficinas). */
  sinLimite(): boolean {
    const roles = this.rolesDe(this.usuario());
    return roles.some((r) => SedeScopeService.ROLES_SIN_LIMITE.includes(r));
  }

  /** Sedes vigentes del usuario, tal como las dejó el login. */
  sedes(): SedeOperativa[] {
    const user = this.usuario();
    const lista: any[] = Array.isArray(user?.sedes) ? user.sedes : [];
    const salida: SedeOperativa[] = lista
      .filter((s: any) => s?.id && s?.nombre)
      .map((s: any) => ({
        id: String(s.id),
        nombre: String(s.nombre),
        activa: s.activa !== false,
        es_principal: !!s.es_principal,
        temporal: !!s.temporal,
        vigente_hasta: s.vigente_hasta ?? null,
      }));
    if (salida.length) return salida;

    // Sesión anterior al despliegue multi-sede: solo trae el singular.
    const sede = user?.sede;
    if (!sede?.id || !sede?.nombre) return [];
    return [{
      id: String(sede.id), nombre: String(sede.nombre), activa: sede.activa !== false,
      es_principal: true, temporal: false, vigente_hasta: null,
    }];
  }

  /** Nombres de oficina sobre las que puede operar, ordenados alfabéticamente. */
  nombres(): string[] {
    return this.sedes().map((s) => s.nombre).sort((a, b) => a.localeCompare(b));
  }

  /** Sede ACTIVA: la que se estampa en documentos y la que filtra por defecto. */
  activa(): string {
    const user = this.usuario();
    const principal = this.sedes().find((s) => s.es_principal);
    return principal?.nombre ?? String(user?.sede?.nombre ?? '');
  }

  /** true si tiene más de una sede: entonces el selector de oficina tiene sentido. */
  tieneVarias(): boolean {
    return this.sedes().length > 1;
  }

  /**
   * true si el usuario puede cambiar el filtro de oficina: porque no se recorta por
   * sede, o porque tiene varias asignadas.
   */
  puedeElegirOficina(): boolean {
    return this.sinLimite() || this.tieneVarias();
  }

  /**
   * Oficinas que puede ofrecer un selector. `catalogo` es la lista completa de sedes
   * del sistema; quien no se recorta la recibe entera, el resto solo las suyas.
   */
  opciones(catalogo: string[]): string[] {
    if (this.sinLimite()) return [...catalogo];
    const propias = new Set(this.nombres().map(SedeScopeService.normalizar));
    const dentro = catalogo.filter((n) => propias.has(SedeScopeService.normalizar(n)));
    // Si el catálogo aún no llegó (o no empata), al menos se ofrecen las suyas.
    return dentro.length ? dentro : this.nombres();
  }

  /**
   * true si una fila cuya oficina es `oficina` cae dentro del alcance del usuario.
   * Sin oficina la fila no se recorta: no hay dato por el que excluirla.
   */
  alcanza(oficina: unknown): boolean {
    if (this.sinLimite()) return true;
    const buscada = SedeScopeService.normalizar(oficina);
    if (!buscada) return true;
    return this.nombres().some((n) => SedeScopeService.normalizar(n) === buscada);
  }
}
