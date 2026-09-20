import { Injectable, computed, inject, signal } from '@angular/core';
import { Alcance, TiendaResumen, TiendaService } from './tienda.service';

/**
 * La tienda sobre la que está trabajando el usuario, compartida por todas las pantallas.
 *
 * <p>Existe porque casi todo el módulo necesita una tienda: el POS cobra en una, el
 * inventario es de una, los indicadores se filtran por una. Obligar a elegirla en cada
 * pantalla sería insufrible, y guardarla en cada componente haría que cambiarla en el POS
 * no cambiara nada en inventario.
 *
 * <p>La selección se recuerda en `localStorage` solo por comodidad. NO es seguridad: el
 * servidor valida el alcance en cada petición y devuelve 403 si la tienda no es suya,
 * aunque el navegador tenga guardado otro id.
 */
@Injectable({ providedIn: 'root' })
export class ContextoTiendaService {
  private api = inject(TiendaService);

  private static readonly CLAVE = 'tuapo.tienda.seleccionada';

  readonly alcance = signal<Alcance | null>(null);
  readonly tiendaId = signal<string | null>(this.leerGuardada());
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly tiendas = computed(() => this.alcance()?.tiendas ?? []);
  readonly esSuperAdmin = computed(() => this.alcance()?.ve_todo === true);

  readonly tienda = computed<TiendaResumen | null>(() => {
    const id = this.tiendaId();
    return this.tiendas().find(t => t.id === id) ?? null;
  });

  /** Rol del usuario EN la tienda seleccionada. Es lo que decide qué botones se pintan. */
  readonly rolEnTienda = computed(() => this.tienda()?.rol_en_la_tienda ?? null);

  readonly puedeVender = computed(() => {
    const rol = this.rolEnTienda();
    return rol === 'ADMIN_NEGOCIO' || rol === 'ADMIN_TIENDA' || rol === 'TENDERO';
  });

  readonly puedeAdministrarTienda = computed(() => {
    const rol = this.rolEnTienda();
    return rol === 'ADMIN_NEGOCIO' || rol === 'ADMIN_TIENDA';
  });

  readonly puedeMoverInventario = computed(() => {
    const rol = this.rolEnTienda();
    return rol === 'ADMIN_NEGOCIO' || rol === 'ADMIN_TIENDA' || rol === 'BODEGUERO';
  });

  /**
   * Carga el alcance. Se llama al entrar al módulo y se puede repetir sin coste real: si
   * ya está cargado no vuelve a pedirlo, salvo que se fuerce tras crear una tienda.
   */
  cargar(forzar = false): void {
    if (this.alcance() && !forzar) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.miAlcance().subscribe({
      next: alcance => {
        this.alcance.set(alcance);
        // Si lo guardado ya no está en el alcance —le quitaron la tienda, o cambió de
        // rama— se elige la primera disponible en vez de dejar la pantalla apuntando a
        // algo que el servidor va a rechazar con 403.
        const guardada = this.tiendaId();
        const sigueSiendoSuya = alcance.tiendas.some(t => t.id === guardada);
        if (!sigueSiendoSuya) {
          this.seleccionar(alcance.tiendas.length ? alcance.tiendas[0].id : null);
        }
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar el alcance de tiendas');
        this.cargando.set(false);
      },
    });
  }

  seleccionar(id: string | null): void {
    this.tiendaId.set(id);
    try {
      if (id) localStorage.setItem(ContextoTiendaService.CLAVE, id);
      else localStorage.removeItem(ContextoTiendaService.CLAVE);
    } catch {
      // Navegador con almacenamiento bloqueado: la selección funciona igual durante la
      // sesión, solo no se recuerda al volver. No es motivo para romper la pantalla.
    }
  }

  private leerGuardada(): string | null {
    try {
      return localStorage.getItem(ContextoTiendaService.CLAVE);
    } catch {
      return null;
    }
  }
}
