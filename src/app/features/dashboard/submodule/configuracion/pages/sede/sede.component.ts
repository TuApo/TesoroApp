import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import Swal from 'sweetalert2';
import { firstValueFrom } from 'rxjs';

import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { NetworkStatusService } from '../../../../../../core/services/network-status.service';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';

const SEDES_CACHE_KEY = 'sidebar.sedes.cache.v1';

interface Sede {
  id: string;
  nombre: string;
  activa?: boolean;
}

/**
 * Página "Sede": cambia la sede de trabajo del usuario. Reemplaza el submenú
 * "Cambiar Sede" del engranaje del header. Reutiliza el mismo cache local
 * (SEDES_CACHE_KEY) para funcionar aún offline.
 */
@Component({
  selector: 'app-sede-config',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sede.component.html',
  styleUrl: './sede.component.css',
})
export class SedeConfigComponent implements OnInit {
  sedes: Sede[] = [];
  sedeActualId = '';
  seleccionId = '';
  cargando = false;
  guardando = false;
  isOnline = true;

  /** Multi-sede (V40): ids de las sedes ASIGNADAS al usuario (principal incluida). */
  sedesAsignadasIds = new Set<string>();

  constructor(
    private readonly util: UtilityServiceService,
    private readonly network: NetworkStatusService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.isOnline = this.network.isOnline;

    const user: any = this.util.getUser?.();
    this.sedeActualId = String(user?.sede?.id ?? '');
    this.seleccionId = this.sedeActualId;

    // Multi-sede (V40): con varias asignadas, la lista se parte en "Tus sedes"
    // y "Otras sedes". Sesiones previas al despliegue solo traen el singular.
    const asignadas: any[] = Array.isArray(user?.sedes) ? user.sedes : [];
    this.sedesAsignadasIds = new Set(
      asignadas.map((s: any) => String(s?.id ?? '')).filter(Boolean),
    );
    if (this.sedeActualId) this.sedesAsignadasIds.add(this.sedeActualId);

    this.hidratarDesdeCache();
    this.cargarSedes();
  }

  /** Sedes asignadas al usuario presentes en el catálogo (principal primero). */
  get sedesPropias(): Sede[] {
    return this.sedes
      .filter((s) => this.sedesAsignadasIds.has(String(s.id)))
      .sort((a, b) =>
        Number(String(b.id) === this.sedeActualId) - Number(String(a.id) === this.sedeActualId)
        || (a?.nombre ?? '').localeCompare(b?.nombre ?? ''));
  }

  get sedesOtras(): Sede[] {
    return this.sedes.filter((s) => !this.sedesAsignadasIds.has(String(s.id)));
  }

  /** true si el usuario tiene más de una sede asignada: activa la vista agrupada. */
  get tieneVarias(): boolean {
    return this.sedesAsignadasIds.size > 1;
  }

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

  seleccionar(id: string): void {
    this.seleccionId = String(id);
  }

  get hayCambio(): boolean {
    return !!this.seleccionId && this.seleccionId !== this.sedeActualId;
  }

  guardar(): void {
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

    this.guardando = true;
    this.cdr.markForCheck();

    this.util.cambiarSedePorUsuarioId(user.id, this.seleccionId).subscribe({
      next: (res: any) => {
        if (!res?.ok) {
          this.guardando = false;
          this.cdr.markForCheck();
          Swal.fire('Error', 'Hubo un problema al asignar la sede.', 'error');
          return;
        }

        const encontrada = this.sedes.find(
          (s) => String(s.id) === String(res.sede_id || this.seleccionId),
        );
        const nombreSede = res?.sede ?? encontrada?.nombre ?? '';

        user.sede = {
          id: res?.sede_id ?? encontrada?.id ?? this.seleccionId,
          nombre: nombreSede,
          activa: encontrada?.activa ?? true,
        };
        // Multi-sede (V40): el backend marca la elegida como principal y CONSERVA
        // las demás asignaciones; se refleja lo mismo en la copia local.
        const idNueva = String(user.sede.id);
        const previas: any[] = Array.isArray(user.sedes) ? user.sedes : [];
        let estaba = false;
        user.sedes = previas.map((s: any) => {
          const esNueva = String(s?.id) === idNueva;
          if (esNueva) estaba = true;
          return { ...s, es_principal: esNueva };
        });
        if (!estaba) {
          user.sedes.push({ ...user.sede, es_principal: true });
        }
        try {
          setLocalStorageItem('user', JSON.stringify(user));
        } catch {
          // no crítico
        }

        Swal.fire('Editado', 'La sede ha sido asignada.', 'success').then(() => {
          // Recarga limpia del dashboard para que header/menús tomen la sede nueva.
          this.router
            .navigateByUrl('/dashboard', { skipLocationChange: true })
            .then(() => this.router.navigateByUrl('/dashboard/configuracion/sede'));
        });
      },
      error: () => {
        this.guardando = false;
        this.cdr.markForCheck();
        Swal.fire('Error', 'Hubo un problema al asignar la sede.', 'error');
      },
    });
  }

  trackById = (_: number, s: Sede) => s.id;
}
