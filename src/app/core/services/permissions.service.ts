import { Injectable } from '@angular/core';
import { getLocalStorageItem } from '../utils/safe-storage';

/**
 * IDs estables de nodos del arbol de permisos (permisos_tree).
 * Se usan para gatekeepear trabajo en background (precargas, suscripciones,
 * tareas de cache) sin acoplarse al nombre del modulo, que puede cambiar.
 */
export const PERMISSION_NODE_IDS = {
  SELECCION: '2b0a8e7efb5246aa9c6119be011c80d9',
} as const;

interface PermNode {
  id: string;
  nombre?: string;
  ruta?: string;
  icono?: string;
  acciones?: string[];
  permiso_ids?: Record<string, string>;
  hijos?: PermNode[];
}

/**
 * Módulo navegable (con pantalla propia) que el usuario puede leer.
 * Es lo que consume el menú inteligente del header para buscar por nombre.
 */
export interface ModuloAccesible {
  id: string;
  nombre: string;
  /** Ruta absoluta ya normalizada, p. ej. `/dashboard/nomina/novedades`. */
  ruta: string;
  icono: string;
  /** Nombres de los módulos padre, del más externo al más cercano. */
  padres: string[];
}

const READ_KEYS = new Set(['VER', 'LEER', 'READ', 'VIEW']);

const ADMIN_ROLE_NAMES = new Set([
  'ADMIN',
  'ADMINISTRADOR',
  'ADMINISTRADORA',
  'SUPER ADMIN',
  'SUPERADMIN',
]);

/**
 * Roles que ven los nodos "ADMINISTRATIVO" del arbol. Espejo de
 * NavbarComponent.PRIVILEGED_ROLES: el buscador no debe ofrecer modulos que
 * el menu lateral esconde.
 */
const PRIVILEGED_MENU_ROLES = new Set(['ADMIN', 'GERENCIA']);

const ADMINISTRATIVE_NODE_NAMES = new Set(['administrativo', 'administrativos']);

/** minusculas, sin acentos y sin espacios repetidos: para comparar nombres. */
export function normalizarTexto(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Patrones de URL que identifican endpoints exclusivos del modulo SELECCION
 * (pipeline de contratacion). Se usan para filtrar el refresco de cache
 * offline y evitar requests a data que el usuario actual no debe consumir.
 */
const SELECCION_URL_PATTERNS: RegExp[] = [
  /\/gestion_contratacion\/contratacion\/candidatos-tabla\//,
  /\/gestion_contratacion\/candidatos\/by-document\//,
  /\/gestion_contratacion\/biometria\//,
  /\/gestion_contratacion\/procesos\/by-document-min\//,
  /\/gestion_documental\/documentos\/\?.*type=3[02]\b/,
];

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  /**
   * Indica si el usuario actual tiene permiso de lectura sobre un nodo del
   * arbol de permisos, identificado por su id. Busca el nodo en el arbol
   * guardado en localStorage y aplica las mismas reglas que el navbar
   * (READ en acciones/permiso_ids, o cualquier hijo con READ).
   */
  hasReadPermission(nodeId: string): boolean {
    const tree = this.loadTree();
    if (!tree) return false;
    const node = this.findNodeById(tree, nodeId);
    if (!node) return false;
    return this.canRead(node);
  }

  /**
   * True si el rol del usuario es ADMIN. Se usa para omitir trabajo en background
   * que solo tiene sentido para roles operativos (precargas, caches dirigidas).
   * Se hace tolerante a variaciones de texto porque distintos endpoints del
   * backend pueden devolver rol como {nombre: "ADMIN"} o como string.
   */
  isAdmin(): boolean {
    return ADMIN_ROLE_NAMES.has(this.getNormalizedRoleName());
  }

  /** Expuesto para debugging: devuelve el rol detectado ya normalizado. */
  getNormalizedRoleName(): string {
    const raw = this.getRoleName();
    if (!raw) return '';
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  /**
   * True si la URL pertenece al modulo SELECCION (pipeline de contratacion).
   * Se usa para gatekeepear refrescos de cache offline y evitar que usuarios
   * sin permiso sigan golpeando endpoints que ya no les corresponden.
   */
  isSeleccionPipelineUrl(url: string): boolean {
    if (!url) return false;
    return SELECCION_URL_PATTERNS.some((re: RegExp) => re.test(url));
  }

  /**
   * True si el usuario actual puede consumir datos del pipeline SELECCION.
   * Se considera que NO puede si es admin o si no tiene permiso de lectura.
   */
  canUseSeleccionPipeline(): boolean {
    if (this.isAdmin()) return false;
    return this.hasReadPermission(PERMISSION_NODE_IDS.SELECCION);
  }

  /**
   * True si el usuario actual puede navegar a la URL dada según el árbol de
   * permisos. Se busca el nodo cuya ruta sea el prefijo más largo de la URL
   * (misma normalización de ruta que usa el navbar al pintar el menú) y se
   * evalúa su lectura. Fail-open deliberado: sin árbol cargado, o si la URL
   * no corresponde a ningún módulo del árbol (home, cuenta, cambiar
   * contraseña…), se permite — solo se bloquea lo que SÍ está modelado en el
   * árbol y no es legible para el usuario.
   */
  canReadRoute(url: string): boolean {
    const tree = this.loadTree();
    if (!tree || !url) return true;

    const destino = url.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    let mejorLen = -1;
    let permitido = true;

    const visitar = (n: PermNode) => {
      const ruta = this.rutaAbsoluta(n);
      if (ruta && (destino === ruta || destino.startsWith(ruta + '/'))) {
        if (ruta.length > mejorLen) {
          mejorLen = ruta.length;
          permitido = this.canRead(n);
        } else if (ruta.length === mejorLen && !permitido) {
          // Varios nodos pueden compartir ruta (alias): basta uno legible.
          permitido = this.canRead(n);
        }
      }
      (n.hijos ?? []).forEach(h => visitar(h));
    };
    tree.forEach(n => visitar(n));
    return permitido;
  }

  /**
   * Lista plana de los módulos navegables que el usuario puede leer, cada uno
   * con la cadena de padres para mostrarla como migaja. Misma fuente y mismas
   * reglas de visibilidad que usa el navbar al pintar el menú (lectura + ocultar
   * "ADMINISTRATIVO" a roles no privilegiados), para que el buscador nunca
   * ofrezca una pantalla que el menú no muestra y el guard bloquearía.
   */
  listReadableModules(): ModuloAccesible[] {
    const tree = this.loadTree();
    if (!tree) return [];

    const privilegiado = PRIVILEGED_MENU_ROLES.has(this.getNormalizedRoleName());
    const modulos: ModuloAccesible[] = [];
    const rutasVistas = new Set<string>();

    const visitar = (n: PermNode, padres: string[]) => {
      const nombre = (n?.nombre ?? '').trim();
      if (!privilegiado && ADMINISTRATIVE_NODE_NAMES.has(normalizarTexto(nombre))) return;
      if (!this.canRead(n)) return;

      const ruta = this.rutaAbsoluta(n);
      // Los contenedores puros (sin ruta propia o apuntando al home) no son
      // destino: solo aportan su nombre a la migaja de los hijos.
      if (nombre && ruta && ruta !== '/dashboard' && !rutasVistas.has(ruta)) {
        rutasVistas.add(ruta);
        modulos.push({ id: n.id, nombre, ruta, icono: (n.icono ?? '').trim(), padres });
      }

      const hijos = n.hijos ?? [];
      if (hijos.length) {
        const siguiente = nombre ? [...padres, nombre] : padres;
        hijos.forEach(h => visitar(h, siguiente));
      }
    };

    tree.forEach(n => visitar(n, []));
    return modulos;
  }

  private rutaAbsoluta(n: PermNode): string | null {
    const ruta = (n?.ruta ?? '').trim();
    if (!ruta) return null;
    const abs = ruta.startsWith('/') ? ruta : `/dashboard/${ruta}`;
    return abs.replace(/\/+$/, '');
  }

  private getRoleName(): string {
    if (typeof localStorage === 'undefined') return '';
    try {
      const raw = getLocalStorageItem('user');
      if (!raw) return '';
      const user = JSON.parse(raw);
      // El backend devuelve rol como {id, nombre} (login, UsuarioDetailSerializer),
      // pero en fallbacks o en el JWT puede aparecer como string plano.
      const rol = user?.rol;
      if (!rol) return '';
      if (typeof rol === 'string') return rol;
      return String(rol?.nombre ?? '');
    } catch {
      return '';
    }
  }

  private loadTree(): PermNode[] | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = getLocalStorageItem('user');
      if (!raw) return null;
      const user = JSON.parse(raw);
      const tree = user?.permisos_tree;
      return Array.isArray(tree) ? tree : null;
    } catch {
      return null;
    }
  }

  private findNodeById(nodes: PermNode[], id: string): PermNode | null {
    for (const n of nodes) {
      if (n?.id === id) return n;
      const hit = n?.hijos ? this.findNodeById(n.hijos, id) : null;
      if (hit) return hit;
    }
    return null;
  }

  private canRead(n: PermNode): boolean {
    const acciones = (n.acciones ?? []).map(a => (a || '').toUpperCase());
    if (acciones.some(a => READ_KEYS.has(a))) return true;

    const permKeys = Object.keys(n.permiso_ids ?? {}).map(k => k.toUpperCase());
    if (permKeys.some(k => READ_KEYS.has(k))) return true;

    return (n.hijos ?? []).some(h => this.canRead(h));
  }
}
