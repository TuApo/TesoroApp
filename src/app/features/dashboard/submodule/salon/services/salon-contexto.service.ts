import { Injectable, computed, inject, signal } from '@angular/core';

import { AlcanceSalon, TiendaSalon } from '../models/salon.models';
import type { SalonContexto } from './salon-contexto.token';
import { SalonService } from './salon.service';

const CLAVE = 'salon:tienda';

/**
 * La sede (tienda) sobre la que trabaja el panel. Propio del submódulo —no se usa el
 * `ContextoTiendaService` de Tienda— para que el salón se pueda montar en otra app donde
 * ese servicio no existe.
 *
 * <p>Se recuerda en `localStorage` (`salon:tienda`) por comodidad, NO por seguridad: el
 * servidor valida el alcance en cada petición. Además acepta la sede por query param
 * (`?tienda=<id>`), que gana sobre lo guardado: así otra app puede abrir el panel con la
 * sede ya fijada sin que el usuario la elija.
 *
 * <p>Las páginas NO lo inyectan directo: usan el token `SALON_CONTEXTO` (interfaz
 * `SalonContexto`), que por defecto resuelve a esta clase.
 */
@Injectable({ providedIn: 'root' })
export class SalonContextoService implements SalonContexto {
  private api = inject(SalonService);

  readonly alcance = signal<AlcanceSalon | null>(null);
  readonly tiendaId = signal<string | null>(leerGuardada());
  /** Sin claim de tenant en TesoroApp todavía: queda null. */
  readonly tenantId = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly tiendas = computed(() => this.alcance()?.tiendas ?? []);
  readonly tienda = computed<TiendaSalon | null>(() => this.tiendas().find(t => t.id === this.tiendaId()) ?? null);
  readonly rolEnTienda = computed(() => this.tienda()?.rol_en_la_tienda ?? null);
  /** Operación (sentar, atender, cambiar estado): `puedeVender` en el backend. */
  readonly puedeOperar = computed(() => {
    const r = this.rolEnTienda();
    return this.alcance()?.ve_todo === true || r === 'ADMIN_NEGOCIO' || r === 'ADMIN_TIENDA' || r === 'TENDERO' || r === 'MESERO';
  });
  /** Configuración (reglas, cámaras, salones): `puedeAdministrar` en el backend. */
  readonly puedeAdministrar = computed(() => {
    const r = this.rolEnTienda();
    return this.alcance()?.ve_todo === true || r === 'ADMIN_NEGOCIO' || r === 'ADMIN_TIENDA';
  });

  /**
   * Carga el alcance (una vez, salvo `forzar`). `desdeQuery` es el `?tienda=` de la URL,
   * si lo hay: se aplica antes de validar contra el alcance.
   */
  cargar(desdeQuery?: string | null, forzar = false): void {
    if (desdeQuery && desdeQuery !== this.tiendaId()) this.seleccionar(desdeQuery);
    if (this.alcance() && !forzar) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.alcance().subscribe({
      next: alcance => {
        this.alcance.set(alcance);
        const actual = this.tiendaId();
        // Si lo guardado ya no es suyo (le quitaron la sede), se pasa a la primera disponible
        // en vez de dejar la pantalla pidiendo algo que el servidor rechazará con 403.
        if (!alcance.tiendas.some(t => t.id === actual)) {
          this.seleccionar(alcance.tiendas.length ? alcance.tiendas[0].id : null);
        }
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar el alcance de sedes');
        this.cargando.set(false);
      },
    });
  }

  seleccionar(id: string | null): void {
    this.tiendaId.set(id);
    try { id ? localStorage.setItem(CLAVE, id) : localStorage.removeItem(CLAVE); } catch { /* sin storage */ }
  }
}

function leerGuardada(): string | null {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}
