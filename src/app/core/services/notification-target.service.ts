import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { PermissionsService } from './permissions.service';
import { DestinoTipo } from './notification-center.service';

/** Lo que hay que abrir cuando alguien hace clic en una notificación. */
export interface DestinoResuelto {
  /** Ruta interna del router, ya absoluta. */
  ruta?: string;
  /** URL externa; se abre en pestaña nueva. */
  url?: string;
}

/**
 * Traduce el destino tipado de una notificación a una navegación real.
 *
 * Antes el destino era un string libre (`matder_notifications.link`) y el front
 * lo prefijaba a mano con `/dashboard/matder/`, así que una notificación solo
 * podía apuntar dentro de Matder. Ahora el backend guarda un par
 * (destino_tipo, destino_valor) y esta clase lo resuelve: es lo que permite que
 * un comunicado lleve a un formulario dinámico concreto, a un módulo o a una
 * vista cualquiera de la app.
 */
@Injectable({ providedIn: 'root' })
export class NotificationTargetService {

  /** Caché de rutas de formularios dinámicos ya resueltas (id → ruta). */
  private rutasFormulario = new Map<string, string | null>();

  constructor(
    private router: Router,
    private http: HttpClient,
    private permisos: PermissionsService,
  ) {}

  /** true si el destino es navegable (para no pintar el cursor de mano en balde). */
  esNavegable(tipo: DestinoTipo, valor: string | null): boolean {
    return tipo !== 'NINGUNO' && !!valor;
  }

  /**
   * Resuelve y navega. Devuelve false si el destino no se pudo resolver, para
   * que quien llama pueda dejar la notificación marcada como leída pero sin
   * mandar al usuario a una pantalla en blanco.
   */
  async abrir(tipo: DestinoTipo, valor: string | null): Promise<boolean> {
    const destino = await this.resolver(tipo, valor);
    if (!destino) return false;

    if (destino.url) {
      window.open(destino.url, '_blank', 'noopener');
      return true;
    }
    if (destino.ruta) {
      await this.router.navigateByUrl(destino.ruta);
      return true;
    }
    return false;
  }

  async resolver(tipo: DestinoTipo, valor: string | null): Promise<DestinoResuelto | null> {
    if (!valor || tipo === 'NINGUNO') return null;

    switch (tipo) {
      case 'RUTA':
        return { ruta: this.absoluta(valor) };

      case 'URL':
        return /^https?:\/\//i.test(valor) ? { url: valor } : null;

      case 'MODULO':
        return this.resolverModulo(valor);

      case 'FORM_PUBLICO':
        // El formulario público vive fuera del dashboard y no exige sesión.
        return { ruta: `/f/${valor}` };

      case 'FORM_DINAMICO': {
        const ruta = await this.rutaDeFormulario(valor);
        return ruta ? { ruta: this.absoluta(ruta) } : null;
      }

      default:
        return null;
    }
  }

  /**
   * Busca el módulo en el árbol de permisos que ya tiene cargado el usuario.
   *
   * Dos consecuencias buscadas: no hay petición extra, y si el usuario NO tiene
   * permiso sobre ese módulo el destino no resuelve — no se le manda a una
   * pantalla que el guard va a rebotar.
   */
  private resolverModulo(moduloId: string): DestinoResuelto | null {
    const objetivo = this.normalizarId(moduloId);
    const modulo = this.permisos.listReadableModules()
      .find(m => this.normalizarId(m.id) === objetivo);
    return modulo?.ruta ? { ruta: modulo.ruta } : null;
  }

  /**
   * Resuelve la ruta de un formulario dinámico contra ms-forms, cacheando el
   * resultado — incluido el fallo, para no repetir una petición que ya se sabe
   * que no lleva a ninguna parte.
   */
  private async rutaDeFormulario(formId: string): Promise<string | null> {
    if (this.rutasFormulario.has(formId)) return this.rutasFormulario.get(formId) ?? null;
    try {
      // /placement es el endpoint que expone route_path (PlacementDto de ms-forms);
      // el detalle del formulario no lo trae.
      const placement = await firstValueFrom(
        this.http.get<{ route_path?: string }>(
          `${environment.apiUrl}/api/dynamic-forms/forms/${formId}/placement`),
      );
      const ruta = placement?.route_path ?? null;
      this.rutasFormulario.set(formId, ruta);
      return ruta;
    } catch {
      this.rutasFormulario.set(formId, null);
      return null;
    }
  }

  /** El backend guarda rutas relativas al dashboard ("matder/cards/12"). */
  private absoluta(ruta: string): string {
    const limpia = ruta.trim();
    return limpia.startsWith('/') ? limpia : `/dashboard/${limpia}`;
  }

  /**
   * Los UUID del árbol de permisos llegan SIN guiones (herencia de la migración
   * desde Django) mientras que el backend guarda la forma canónica. Se comparan
   * normalizados o el módulo nunca haría match.
   */
  private normalizarId(id: string): string {
    return (id ?? '').replace(/-/g, '').toLowerCase();
  }
}
