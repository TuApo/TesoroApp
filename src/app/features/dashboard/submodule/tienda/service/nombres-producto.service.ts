import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TiendaService } from './tienda.service';

/** Nombres de producto por id (todas las páginas del catálogo, una vez por sesión). */
@Injectable({ providedIn: 'root' })
export class NombresProducto {
  private api = inject(TiendaService);
  readonly nombres = signal<Record<string, string>>({});
  private cargando: Promise<void> | null = null;

  cargar(): Promise<void> {
    if (this.cargando) return this.cargando;
    this.cargando = (async () => {
      const out: Record<string, string> = {};
      for (let pagina = 0; pagina < 30; pagina++) {
        const r = await firstValueFrom(this.api.productos({ pagina, tamano: 200 })).catch(() => null);
        if (!r) break;
        for (const p of r.content) out[p.id] = p.nombre;
        if (pagina + 1 >= r.total_pages) break;
      }
      this.nombres.set(out);
    })();
    return this.cargando;
  }

  de(id: string | null | undefined): string { return id ? (this.nombres()[id] ?? id.slice(0, 8)) : '—'; }
}
