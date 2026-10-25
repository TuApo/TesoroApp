import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { EcoMapa } from '../../../../../economiapp/components/eco-mapa';
import { FichaTienda, TiendaService } from '../../service/tienda.service';

/**
 * Ficha de una tienda: qué es (física, virtual, global, bodega o punto en una oficina),
 * a quién atiende (sus oficinas o todas), dónde queda y cómo entrega.
 */
@Component({
  selector: 'app-ficha-tienda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, EcoMapa],
  templateUrl: './ficha-tienda.html',
  styleUrls: ['../../styles/tienda-comun.css', './ficha-tienda.css'],
})
export class FichaTiendaComponent {
  private api = inject(TiendaService);
  readonly tiendaId = input.required<string>();
  readonly f = signal<FichaTienda | null>(null);
  readonly madres = signal<{ id: string; nombre: string; tipo: string }[]>([]);
  readonly oficinasConocidas = signal<string[]>([]);
  readonly nuevaOficina = signal('');
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  constructor() {
    effect(() => { const id = this.tiendaId(); untracked(() => this.cargar(id)); });
    this.api.oficinasConocidas().subscribe({ next: o => this.oficinasConocidas.set(o), error: () => null });
  }

  async cargar(id: string): Promise<void> {
    this.error.set(null); this.aviso.set(null);
    try {
      const [f, m] = await Promise.all([firstValueFrom(this.api.fichaTienda(id)), firstValueFrom(this.api.madresPosibles(id))]);
      this.f.set({ ...f, permite_domicilio: !!+f.permite_domicilio, permite_recogida: !!+f.permite_recogida, publicada_en_virtual: !!+f.publicada_en_virtual,
        atiende_todas_oficinas: !!+f.atiende_todas_oficinas, activa: !!+f.activa, entrega_sabado: !!+(f.entrega_sabado ?? 0),
        dias_habiles_entrega: f.dias_habiles_entrega ?? 2 });
      this.madres.set(m);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cargar la ficha'); }
  }

  poner<K extends keyof FichaTienda>(k: K, v: FichaTienda[K]): void { this.f.update(f => f ? { ...f, [k]: v } : f); }
  /** Un punto en oficina no atiende a todas; elegir madre lo apaga. */
  ponerMadre(id: string | null): void { this.f.update(f => f ? { ...f, tienda_madre_id: id, atiende_todas_oficinas: id ? false : f.atiende_todas_oficinas } : f); }

  async guardar(): Promise<void> {
    const f = this.f(); if (!f) return;
    this.guardando.set(true); this.error.set(null); this.aviso.set(null);
    try {
      await firstValueFrom(this.api.guardarFichaTienda(f.id, f));
      await this.cargar(f.id);
      this.aviso.set('Ficha guardada');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo guardar'); }
    finally { this.guardando.set(false); }
  }

  async agregarOficina(): Promise<void> {
    const f = this.f(); const o = this.nuevaOficina().trim(); if (!f || !o) return;
    try { await firstValueFrom(this.api.asignarOficina(f.id, o, true)); this.nuevaOficina.set(''); this.cargar(f.id); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo asignar la oficina'); }
  }
  async quitarOficina(o: string): Promise<void> {
    const f = this.f(); if (!f || !confirm(`¿Quitar la oficina ${o} de esta tienda?`)) return;
    try { await firstValueFrom(this.api.quitarOficina(f.id, o)); this.cargar(f.id); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo quitar'); }
  }
  usarGps(): void {
    navigator.geolocation?.getCurrentPosition(p => this.f.update(f => f ? { ...f, latitud: +p.coords.latitude.toFixed(7), longitud: +p.coords.longitude.toFixed(7) } : f));
  }
}
