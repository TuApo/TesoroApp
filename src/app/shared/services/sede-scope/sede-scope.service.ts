import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import { UtilityServiceService } from '../utilityService/utility-service.service';
import { AlcanceSedes, SedeOperativa } from '../../models/sede-alcance.model';
import { getLocalStorageItem, setLocalStorageItem } from '../../../core/utils/safe-storage';

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
 *  - Tampoco el personal de oficina de una sede TRANSVERSAL (ADMINISTRATIVOS, VIRTUAL):
 *    atiende a trabajadores de todas las oficinas. Lo decide ms-auth-admin y llega en
 *    la sesión como `todas_sedes`.
 *  - El resto opera sobre sus sedes vigentes; con una sola, el comportamiento es el
 *    de siempre (el filtro queda anclado y no se puede cambiar).
 */
@Injectable({ providedIn: 'root' })
export class SedeScopeService {
  private readonly util = inject(UtilityServiceService);

  /** Roles que no se recortan por sede (los mismos que ya usaba el filtro de Vacantes). */
  private static readonly ROLES_SIN_LIMITE = ['ADMIN', 'GERENCIA'];

  /**
   * Sedes TRANSVERSALES (las mismas que ms-auth-admin): no son la oficina de ningún
   * trabajador en misión, así que un registro no debería quedar etiquetado con ellas
   * solo porque quien lo hizo trabaja allí.
   */
  private static readonly SEDES_TRANSVERSALES = ['administrativos', 'virtual'];

  /** Última oficina elegida para etiquetar registros (por usuario), para proponerla. */
  private static readonly CLAVE_ULTIMA_OFICINA = 'tuapo.oficina-registro';

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

  /** true si el usuario tiene ese rol (comparado en mayúsculas). */
  tieneRol(nombre: string): boolean {
    return this.rolesDe(this.usuario()).includes(nombre.toUpperCase());
  }

  /** true si el usuario no se recorta por sede (ve todas las oficinas). */
  sinLimite(): boolean {
    const user = this.usuario();
    // El backend ya resolvió el alcance (rol o sede transversal): se le cree.
    if (user?.todas_sedes === true) return true;
    const roles = this.rolesDe(user);
    return roles.some((r) => SedeScopeService.ROLES_SIN_LIMITE.includes(r));
  }

  /** true si la sede es transversal (ADMINISTRATIVOS, VIRTUAL). */
  esTransversal(nombre: unknown): boolean {
    return SedeScopeService.SEDES_TRANSVERSALES.includes(SedeScopeService.normalizar(nombre));
  }

  /**
   * true si ahora mismo trabaja DESDE una sede transversal: lo que registre no puede
   * llevar su sede activa como oficina y hay que preguntarle a cuál pertenece.
   */
  trabajaDesdeTransversal(): boolean {
    return this.esTransversal(this.activa());
  }

  /**
   * Oficina con la que se etiqueta un registro nuevo (autorización, préstamo, mercado,
   * reporte…). Si su sede activa es una oficina, esa, sin preguntar: es lo de siempre.
   * Si es una sede transversal, el registro NO se queda con ella: se le pregunta a qué
   * oficina pertenece, proponiendo `sugerida` (la de la persona, si se conoce) o la
   * última que eligió. Devuelve null si cancela.
   */
  async oficinaParaRegistrar(opts: { sugerida?: string | null; que?: string } = {}): Promise<string | null> {
    const activa = this.activa();
    if (!this.esTransversal(activa)) return activa || null;

    let opciones = this.nombres();
    // Sesión anterior a la regla de sedes transversales: solo traía su propia sede.
    if (opciones.length < 2) {
      await this.sincronizar();
      opciones = this.nombres();
    }
    const casar = (v: unknown) => opciones.find((n) => SedeScopeService.normalizar(n) === SedeScopeService.normalizar(v));
    const propuesta = casar(opts.sugerida) ?? casar(this.ultimaOficina());

    const inputOptions: Record<string, string> = {};
    for (const n of opciones) inputOptions[n] = n.replace(/_/g, ' ');
    const r = await Swal.fire({
      icon: 'question',
      title: '¿A qué oficina pertenece?',
      html:
        `Trabajas desde <b>${escapar(activa)}</b>, que atiende a todas las oficinas. ` +
        `Elige la oficina ${escapar(opts.que ?? 'de este registro')} para que quede en su lugar.` +
        `<br><small>Si vas a trabajar un rato con la misma, márcala como activa en ` +
        `Configuración › Sede y no te lo volveremos a preguntar.</small>`,
      input: 'select',
      inputOptions,
      inputValue: propuesta ?? '',
      inputPlaceholder: 'Elige la oficina',
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (v ? null : 'Elige la oficina del registro'),
    });
    if (!r.isConfirmed || !r.value) return null;
    this.recordarOficina(String(r.value));
    return String(r.value);
  }

  /**
   * Vuelve a pedir el alcance a ms-auth-admin y lo deja en la sesión. Sirve para que una
   * sesión abierta antes de un cambio de sedes (o de esta regla) no tenga que salir y
   * volver a entrar.
   */
  async sincronizar(): Promise<void> {
    const user = this.usuario();
    if (!user?.id || !this.util.traerAlcanceSedes) return;
    try {
      const alcance = await firstValueFrom(this.util.traerAlcanceSedes(String(user.id)));
      this.guardarEnSesion(alcance);
    } catch {
      // Sin red o sin permiso: se sigue con lo que trae la sesión.
    }
  }

  /** Deja el alcance en la sesión local para que los tableros filtren sin volver a pedirlo. */
  guardarEnSesion(alcance: AlcanceSedes | null | undefined): void {
    const user = this.usuario();
    // Una respuesta sin la lista de sedes no es un alcance: no se pisa la sesión con ella.
    if (!user || !alcance || !Array.isArray(alcance.sedes)) return;
    const principal = alcance.principal ?? null;
    user.sede = principal ? { id: principal.id, nombre: principal.nombre, activa: principal.activa } : null;
    user.sedes = alcance.sedes ?? [];
    user.todas_sedes = !!alcance.todas;
    user.sede_transversal = alcance.sede_transversal ?? null;
    try {
      setLocalStorageItem('user', JSON.stringify(user));
    } catch {
      // no crítico
    }
  }

  private ultimaOficina(): string | null {
    try {
      return getLocalStorageItem(`${SedeScopeService.CLAVE_ULTIMA_OFICINA}.${this.usuario()?.id ?? ''}`);
    } catch {
      return null;
    }
  }

  private recordarOficina(nombre: string): void {
    try {
      setLocalStorageItem(`${SedeScopeService.CLAVE_ULTIMA_OFICINA}.${this.usuario()?.id ?? ''}`, nombre);
    } catch {
      // no crítico
    }
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

function escapar(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
