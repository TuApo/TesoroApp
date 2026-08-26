import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import Swal from 'sweetalert2';
import { firstValueFrom } from 'rxjs';

import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { NetworkStatusService } from '../../../../../../core/services/network-status.service';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import { AlcanceSedes, SedeOperativa } from '../../../../../../shared/models/sede-alcance.model';

const SEDES_CACHE_KEY = 'sidebar.sedes.cache.v1';

interface Sede {
  id: string;
  nombre: string;
  activa?: boolean;
}

/** Fila del buscador: el catálogo cruzado con lo que el usuario ya tiene concedido. */
interface OpcionSede extends Sede {
  elegida: boolean;
  /** Concedida por un administrador: el usuario no puede quitársela. */
  fija: boolean;
  temporal: boolean;
  vigenteHasta: string | null;
}

/**
 * Página "Sede de trabajo": buscador ACUMULATIVO de sedes.
 *
 * Un usuario puede operar sobre varias sedes a la vez; la que marque como activa es la
 * que ven el header y los filtros por defecto de los tableros. Reglas (ms-auth-admin V62):
 *
 *  - el administrador alcanza TODAS las sedes y aquí solo elige cuál tiene activa;
 *  - lo que se concede a sí mismo quien NO es administrador caduca a las 24 h;
 *  - las sedes permanentes las da un administrador y no se pueden quitar desde aquí.
 *
 * Reutiliza el cache local del catálogo (SEDES_CACHE_KEY) para pintar algo aún sin red.
 */
@Component({
  selector: 'app-sede-config',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sede.component.html',
  styleUrl: './sede.component.css',
})
export class SedeConfigComponent implements OnInit, OnDestroy {
  sedes: Sede[] = [];
  cargando = false;
  guardando = false;
  isOnline = true;

  /** Alcance del usuario tal como lo devolvió el backend (fuente de la verdad). */
  esAdmin = false;
  alcanceEsTodas = false;

  /** Selección en curso: ids marcados + cuál queda activa. */
  seleccion = new Set<string>();
  principalId = '';

  /** Estado inicial, para saber si hay cambios y qué concesión es nueva. */
  private inicialSeleccion = new Set<string>();
  private inicialPrincipal = '';
  private meta = new Map<string, { fija: boolean; temporal: boolean; vigenteHasta: string | null }>();

  filtro = '';
  /** Reloj que refresca las cuentas atrás de las sedes temporales. */
  private tic?: ReturnType<typeof setInterval>;

  constructor(
    private readonly util: UtilityServiceService,
    private readonly network: NetworkStatusService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.isOnline = this.network.isOnline;

    // Pintado inmediato con lo que ya hay en la sesión; el alcance real llega después.
    const user: any = this.util.getUser?.();
    const sedeActual = String(user?.sede?.id ?? '');
    const previas: any[] = Array.isArray(user?.sedes) ? user.sedes : [];
    for (const s of previas) {
      const id = String(s?.id ?? '');
      if (!id) continue;
      this.seleccion.add(id);
      this.meta.set(id, {
        fija: !s?.temporal,
        temporal: !!s?.temporal,
        vigenteHasta: s?.vigente_hasta ?? null,
      });
    }
    if (sedeActual) {
      this.seleccion.add(sedeActual);
      this.principalId = sedeActual;
    }
    this.marcarInicial();

    this.hidratarDesdeCache();
    this.cargarSedes();
    this.cargarAlcance();

    // Las temporales caducan: sin este reloj la etiqueta "quedan 3 h" se queda congelada.
    this.tic = setInterval(() => this.cdr.markForCheck(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.tic) clearInterval(this.tic);
  }

  // ── Datos ───────────────────────────────────────────────────────────────

  private hidratarDesdeCache(): void {
    try {
      const raw = getLocalStorageItem(SEDES_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        this.sedes = parsed;
        this.cdr.markForCheck();
      }
    } catch {
      // cache corrupta: la ignoramos, cargarSedes() la reescribe
    }
  }

  async cargarSedes(): Promise<void> {
    this.isOnline = this.network.isOnline;
    if (!this.isOnline) return;
    this.cargando = true;
    this.cdr.markForCheck();
    try {
      const data: any = await firstValueFrom(this.util.traerSucursales());
      const lista: Sede[] = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
          ? data
          : Array.isArray(data?.sucursal)
            ? data.sucursal
            : [];

      this.sedes = [...lista].sort((a, b) => (a?.nombre ?? '').localeCompare(b?.nombre ?? ''));
      try {
        setLocalStorageItem(SEDES_CACHE_KEY, JSON.stringify(this.sedes));
      } catch {
        // sin persistencia: no es crítico
      }
    } catch {
      if (!this.sedes.length) {
        Swal.fire('Error', 'No fue posible cargar las sedes.', 'error');
      }
    } finally {
      this.cargando = false;
      this.cdr.markForCheck();
    }
  }

  /** Alcance real (quién es admin, qué es permanente y qué caduca). */
  private async cargarAlcance(): Promise<void> {
    if (!this.network.isOnline) return;
    const user: any = this.util.getUser?.();
    if (!user?.id) return;
    try {
      const alcance = await firstValueFrom(this.util.traerAlcanceSedes(String(user.id)));
      this.aplicarAlcance(alcance);
    } catch {
      // Sin alcance nos quedamos con lo que traía la sesión: se puede seguir operando.
    }
  }

  private aplicarAlcance(alcance: AlcanceSedes): void {
    this.esAdmin = !!alcance?.es_admin;
    this.alcanceEsTodas = !!alcance?.todas;

    this.seleccion = new Set<string>();
    this.meta = new Map();
    for (const s of alcance?.sedes ?? []) {
      const id = String(s.id);
      this.seleccion.add(id);
      this.meta.set(id, { fija: !s.temporal, temporal: !!s.temporal, vigenteHasta: s.vigente_hasta });
      if (s.es_principal) this.principalId = id;
    }
    if (alcance?.principal) this.principalId = String(alcance.principal.id);
    this.marcarInicial();
    this.cdr.markForCheck();
  }

  private marcarInicial(): void {
    this.inicialSeleccion = new Set(this.seleccion);
    this.inicialPrincipal = this.principalId;
  }

  // ── Buscador ────────────────────────────────────────────────────────────

  private static normalizar(v: string): string {
    return (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  /**
   * Catálogo filtrado por el texto del buscador. El administrador ve todas las sedes;
   * el resto también las ve, pero añadir una es una concesión temporal de 24 h.
   */
  get opciones(): OpcionSede[] {
    const q = SedeConfigComponent.normalizar(this.filtro);
    return this.sedes
      .filter((s) => !q || SedeConfigComponent.normalizar(s.nombre).includes(q))
      .map((s) => this.aOpcion(s));
  }

  /** Sedes ya marcadas, en fichas: es el "acumulado" del selector. */
  get elegidas(): OpcionSede[] {
    return this.sedes
      .filter((s) => this.seleccion.has(String(s.id)))
      .map((s) => this.aOpcion(s))
      .sort((a, b) =>
        Number(b.id === this.principalId) - Number(a.id === this.principalId)
        || a.nombre.localeCompare(b.nombre));
  }

  private aOpcion(s: Sede): OpcionSede {
    const id = String(s.id);
    const m = this.meta.get(id);
    return {
      ...s,
      id,
      elegida: this.seleccion.has(id),
      fija: !!m && m.fija,
      temporal: !!m && m.temporal,
      vigenteHasta: m?.vigenteHasta ?? null,
    };
  }

  /** Marca o desmarca una sede sin perder el resto: el buscador es acumulativo. */
  alternar(s: OpcionSede): void {
    const id = String(s.id);
    if (this.seleccion.has(id)) {
      if (this.esFija(id)) return;             // permanente: solo un administrador la quita
      if (this.seleccion.size === 1) return;   // nunca dejarlo sin ninguna sede
      this.seleccion.delete(id);
      if (this.principalId === id) {
        this.principalId = this.elegidas[0]?.id ?? '';
      }
    } else {
      this.seleccion.add(id);
      if (!this.principalId) this.principalId = id;
    }
    this.filtro = '';
    this.cdr.markForCheck();
  }

  /** Deja una sede ya marcada como la ACTIVA (la que usa el header y los filtros). */
  activar(id: string): void {
    if (!this.seleccion.has(String(id))) return;
    this.principalId = String(id);
    this.cdr.markForCheck();
  }

  esFija(id: string): boolean {
    // Quien alcanza TODAS las sedes (ADMIN o GERENCIA) no tiene nada "fijo": la lista es
    // el catálogo entero y aquí solo elige cuál deja activa.
    if (this.alcanceEsTodas) return false;
    return !!this.meta.get(String(id))?.fija;
  }

  /** true si la sede se añade en ESTA edición: es la que estrenará el plazo de 24 h. */
  esNueva(id: string): boolean {
    return this.seleccion.has(String(id)) && !this.inicialSeleccion.has(String(id));
  }

  get nuevas(): OpcionSede[] {
    return this.elegidas.filter((s) => this.esNueva(s.id));
  }

  /** "quedan 3 h" / "quedan 45 min" de una concesión temporal; vacío si es permanente. */
  restante(s: OpcionSede): string {
    if (!s.vigenteHasta) return '';
    const ms = new Date(s.vigenteHasta).getTime() - Date.now();
    if (!Number.isFinite(ms)) return '';
    if (ms <= 0) return 'caducada';
    const min = Math.round(ms / 60_000);
    if (min < 60) return `quedan ${min} min`;
    return `quedan ${Math.round(min / 60)} h`;
  }

  get hayCambio(): boolean {
    if (this.principalId !== this.inicialPrincipal) return true;
    if (this.seleccion.size !== this.inicialSeleccion.size) return true;
    for (const id of this.seleccion) {
      if (!this.inicialSeleccion.has(id)) return true;
    }
    return false;
  }

  // ── Guardado ────────────────────────────────────────────────────────────

  async guardar(): Promise<void> {
    if (!this.hayCambio || this.guardando) return;

    this.isOnline = this.network.isOnline;
    if (!this.isOnline) {
      Swal.fire('Sin conexión', 'Necesitas estar en línea para cambiar de sede.', 'info');
      return;
    }

    const user: any = this.util.getUser?.();
    if (!user?.id) {
      Swal.fire('Error', 'No se pudo identificar el usuario.', 'error');
      return;
    }

    // Al que no es administrador se le avisa de que lo que añade caduca: es la diferencia
    // entre "ya tengo esa sede" y "la tengo prestada hasta mañana".
    const nuevas = this.nuevas;
    if (!this.alcanceEsTodas && nuevas.length) {
      const nombres = nuevas.map((s) => s.nombre).join(', ');
      const confirma = await Swal.fire({
        icon: 'info',
        title: 'Acceso temporal',
        html: `Vas a operar también sobre <b>${nombres}</b>.<br>`
            + 'Ese acceso se retira solo <b>a las 24 horas</b>. '
            + 'Para dejarlo permanente lo tiene que asignar un administrador.',
        showCancelButton: true,
        confirmButtonText: 'Entendido, cambiar',
        cancelButtonText: 'Cancelar',
      });
      if (!confirma.isConfirmed) return;
    }

    this.guardando = true;
    this.cdr.markForCheck();

    try {
      const alcance = await firstValueFrom(this.util.guardarSedesOperativas(
        String(user.id),
        [...this.seleccion],
        this.principalId || null,
      ));
      this.persistirEnSesion(user, alcance);
      this.aplicarAlcance(alcance);

      await Swal.fire(
        'Listo',
        this.alcanceEsTodas || !nuevas.length
          ? 'Tus sedes quedaron actualizadas.'
          : 'Tus sedes quedaron actualizadas. El acceso nuevo caduca en 24 horas.',
        'success',
      );
      // Recarga limpia del dashboard para que header/menús tomen la sede nueva.
      await this.router.navigateByUrl('/dashboard', { skipLocationChange: true });
      await this.router.navigateByUrl('/dashboard/configuracion/sede');
    } catch {
      Swal.fire('Error', 'Hubo un problema al guardar las sedes.', 'error');
    } finally {
      this.guardando = false;
      this.cdr.markForCheck();
    }
  }

  /** La sesión local guarda el alcance para que los tableros filtren sin volver a pedirlo. */
  private persistirEnSesion(user: any, alcance: AlcanceSedes): void {
    const principal: SedeOperativa | null = alcance?.principal ?? null;
    user.sede = principal
      ? { id: principal.id, nombre: principal.nombre, activa: principal.activa }
      : null;
    user.sedes = alcance?.sedes ?? [];
    try {
      setLocalStorageItem('user', JSON.stringify(user));
    } catch {
      // no crítico
    }
  }

  trackById = (_: number, s: Sede) => s.id;
}
