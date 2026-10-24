import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import { ArchivosNativos } from '../../../../../core/nativo/archivos-nativos';
import { obtenerUsuarioActual } from '../../../../../core/utils/usuario-actual';
import { mensajeDe } from './campo.service';

export interface Trabajador {
  cedula: string; nombre: string | null; celular: string | null; finca: string | null; empresa_usuaria: string | null;
  cargo: string | null; temporal: string | null; oficina: string | null; fecha_ingreso: string | null; codigo_contrato: string | null;
}

export interface MiPersonal {
  alcance: string; sedes: string[]; fincas: string[]; meses: number; total: number; personal: Trabajador[]; generado_ms: number;
}

/**
 * «Mi personal»: los trabajadores que le corresponden al coordinador según su usuario y sus
 * permisos (el recorte lo hace ms-hr). Se descarga al teléfono —archivo en la carpeta privada
 * de la app— y se busca LOCALMENTE: funciona igual sin señal. Se borra al cerrar sesión.
 */
@Injectable({ providedIn: 'root' })
export class PersonalService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/gestion_contratacion/coordinador/mi-personal`;

  readonly datos = signal<MiPersonal | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly fincas = computed(() => [...new Set((this.datos()?.personal ?? []).map(t => t.finca).filter((f): f is string => !!f))].sort());

  private get usuario(): string { return obtenerUsuarioActual().id || 'anonimo'; }
  private listo: Promise<void> | null = null;

  /** Lo guardado en el teléfono (instantáneo, sin red). */
  cargarLocal(): Promise<void> {
    this.listo ??= ArchivosNativos.leerJson<MiPersonal>(this.usuario, 'personal/mi-personal.json').then(d => {
      if (d && !this.datos()) this.datos.set(d);
    });
    return this.listo;
  }

  /** Baja la lista fresca y la deja en el teléfono. */
  async descargar(sede?: string): Promise<boolean> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const d = await firstValueFrom(this.http.get<MiPersonal>(this.url, { params: sede ? { sede } : {} }));
      this.datos.set(d);
      await ArchivosNativos.guardarJson(this.usuario, 'personal/mi-personal.json', d);
      return true;
    } catch (e) {
      this.error.set(mensajeDe(e, this.datos() ? 'Sin señal: se muestra la lista guardada en el teléfono' : 'No se pudo descargar tu personal'));
      return false;
    } finally {
      this.cargando.set(false);
    }
  }

  /** Búsqueda local por nombre, cédula, finca o cargo (sin tildes ni mayúsculas). */
  buscar(q: string, finca: string | null, limite = 150): Trabajador[] {
    const l = this.datos()?.personal ?? [];
    const palabras = sinTildes(q).split(/\s+/).filter(Boolean);
    const out: Trabajador[] = [];
    for (const t of l) {
      if (finca && t.finca !== finca) continue;
      if (palabras.length) {
        const texto = sinTildes(`${t.nombre ?? ''} ${t.cedula} ${t.finca ?? ''} ${t.cargo ?? ''} ${t.empresa_usuaria ?? ''}`);
        if (!palabras.every(p => texto.includes(p))) continue;
      }
      out.push(t);
      if (out.length >= limite) break;
    }
    return out;
  }

  contar(q: string, finca: string | null): number {
    return this.buscar(q, finca, Number.MAX_SAFE_INTEGER).length;
  }
}

export function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
