import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';

/** Persona de la plataforma, ya normalizada para pintar y buscar. */
export interface Persona {
  id: string;
  nombre: string;
  email: string;
  documento: string;
  rol: string;
  iniciales: string;
  color: string;
  /** Texto en minúsculas sin tildes para buscar por nombre, correo o cédula. */
  clave: string;
}

const PALETA = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#9333ea', '#c2410c', '#4f46e5'];

/** Roles que casi nunca reciben tareas: van al final de las sugerencias, no se ocultan. */
const ROLES_AL_FINAL = new Set(['OPERARIO', 'ASPIRANTE', 'BOT', 'SIN-ASIGNAR']);

export function sinTildes(t: string): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Directorio de personas para asignar, mencionar y seguir tareas.
 *
 * El backend de tareas solo guarda ids (el JWT no trae nombres), así que los nombres se
 * resuelven aquí contra /gestion_admin/usuarios/. Esa lista es grande (miles de filas), por
 * eso se pide UNA vez por sesión y se comparte entre todas las pantallas del módulo; antes
 * cada pantalla de Matder la volvía a descargar.
 */
@Injectable({ providedIn: 'root' })
export class DirectorioService {
  private readonly http = inject(HttpClient);
  private carga: Promise<void> | null = null;

  readonly personas = signal<Map<string, Persona>>(new Map());
  readonly listo = signal(false);
  readonly lista = computed(() => Array.from(this.personas().values()));

  /** Quien usa la app ahora mismo. */
  readonly yo = (() => {
    const u = obtenerUsuarioActual();
    return { id: u.id || '', nombre: u.nombreCompleto || 'Yo' };
  })();

  cargar(): Promise<void> {
    if (!this.carga) {
      this.carga = firstValueFrom(this.http.get<any[]>(`${environment.apiUrl}/gestion_admin/usuarios/`))
        .then(filas => {
          const m = new Map<string, Persona>();
          for (const u of filas ?? []) {
            const p = this.normalizar(u);
            if (p) m.set(p.id, p);
          }
          this.personas.set(m);
          this.listo.set(true);
        })
        .catch(() => {
          // Sin directorio la app sigue: los nombres caen a "Usuario" y se puede reintentar.
          this.carga = null;
          this.listo.set(true);
        });
    }
    return this.carga;
  }

  persona(id: string | null | undefined): Persona | null {
    if (!id) return null;
    return this.personas().get(id) ?? null;
  }

  nombre(id: string | null | undefined, porDefecto = 'Sin asignar'): string {
    if (!id) return porDefecto;
    if (id === this.yo.id) return this.persona(id)?.nombre ?? this.yo.nombre;
    return this.persona(id)?.nombre ?? 'Usuario';
  }

  iniciales(id: string | null | undefined): string {
    return this.persona(id)?.iniciales ?? (id === this.yo.id ? iniciales(this.yo.nombre) : '?');
  }

  color(id: string | null | undefined): string {
    return this.persona(id)?.color ?? colorDe(id ?? '');
  }

  /**
   * Sugerencias para un selector: primero los ids "cercanos" (miembros del espacio), luego
   * el resto; los roles operativos al final. Con menos de 2 letras solo sugiere cercanos.
   */
  buscar(texto: string, cercanos: string[] = [], limite = 12): Persona[] {
    const q = sinTildes(texto.trim());
    const prioridad = new Set(cercanos);
    const candidatos = q.length < 2
      ? cercanos.map(id => this.persona(id)).filter((p): p is Persona => !!p)
      : this.lista().filter(p => p.clave.includes(q));
    return candidatos
      .sort((a, b) =>
        (Number(prioridad.has(b.id)) - Number(prioridad.has(a.id))) ||
        (Number(ROLES_AL_FINAL.has(a.rol)) - Number(ROLES_AL_FINAL.has(b.rol))) ||
        a.nombre.localeCompare(b.nombre, 'es'))
      .slice(0, limite);
  }

  private normalizar(u: any): Persona | null {
    const id = u?.id ? String(u.id) : '';
    if (!id) return null;
    const nombres = `${u?.datos_basicos?.nombres ?? u?.nombres ?? ''} ${u?.datos_basicos?.apellidos ?? u?.apellidos ?? ''}`
      .replace(/\s+/g, ' ').trim();
    const email = String(u?.correo_electronico ?? u?.email ?? '');
    const documento = String(u?.numero_de_documento ?? '');
    const nombre = titulo(nombres) || email || documento || 'Usuario';
    const rol = String(u?.rol?.nombre ?? u?.rol ?? '').toUpperCase();
    return {
      id, nombre, email, documento, rol,
      iniciales: iniciales(nombre),
      color: colorDe(id),
      clave: sinTildes(`${nombre} ${email} ${documento}`),
    };
  }
}

function titulo(t: string): string {
  return t.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase());
}

export function iniciales(nombre: string): string {
  const partes = (nombre ?? '').split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  const a = partes[0][0] ?? '';
  const b = partes.length > 2 ? partes[2][0] : (partes[1]?.[0] ?? '');
  return (a + b).toUpperCase();
}

export function colorDe(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETA[Math.abs(h) % PALETA.length];
}
