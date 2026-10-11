import { Injectable } from '@angular/core';
import { getLocalStorageItem, setLocalStorageItem } from '@/app/core/utils/safe-storage';

export interface Reciente { tipo: 'tablero' | 'espacio'; id: number; nombre: string; detalle?: string; acento?: string | null; visto: string }

const CLAVE = 'tareas.recientes.v1';
const MAX = 8;

/** Tableros y espacios abiertos hace poco (solo en este navegador), para volver rápido. */
@Injectable({ providedIn: 'root' })
export class RecientesService {
  todos(): Reciente[] {
    try { return JSON.parse(getLocalStorageItem(CLAVE) ?? '[]'); } catch { return []; }
  }

  anotar(r: Omit<Reciente, 'visto'>): void {
    const resto = this.todos().filter(x => !(x.tipo === r.tipo && x.id === r.id));
    try { setLocalStorageItem(CLAVE, JSON.stringify([{ ...r, visto: new Date().toISOString() }, ...resto].slice(0, MAX))); }
    catch { /* sin almacenamiento */ }
  }

  quitar(tipo: Reciente['tipo'], id: number): void {
    try { setLocalStorageItem(CLAVE, JSON.stringify(this.todos().filter(x => !(x.tipo === tipo && x.id === id)))); }
    catch { /* sin almacenamiento */ }
  }
}
