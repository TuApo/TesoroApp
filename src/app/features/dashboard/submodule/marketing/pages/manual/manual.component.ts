import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { Marca, MarketingService, SeccionManual, TokenMarca } from '../../service/marketing.service';

/**
 * El manual de marca.
 *
 * <p>Lo que lo hace distinto de un PDF colgado: las muestras de color que se ven aqui
 * <b>son</b> las variables que usa el render. No hay dos verdades — si alguien cambia el
 * kit, esta pantalla y las piezas cambian a la vez.
 */
@Component({
  selector: 'app-manual',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manual.component.html',
  styleUrl: './manual.component.css',
})
export class ManualComponent implements OnInit {
  private readonly api = inject(MarketingService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly marcas = signal<Marca[]>([]);
  readonly elegida = signal<Marca | null>(null);
  readonly secciones = signal<SeccionManual[]>([]);
  readonly cargando = signal(true);

  readonly colores = computed(() =>
    (this.elegida()?.tokens ?? []).filter((t) => t.grupo === 'COLOR'));
  readonly tipografias = computed(() =>
    (this.elegida()?.tokens ?? []).filter((t) => t.grupo === 'TIPOGRAFIA'));
  readonly otros = computed(() =>
    (this.elegida()?.tokens ?? []).filter((t) => !['COLOR', 'TIPOGRAFIA'].includes(t.grupo)));

  ngOnInit(): void {
    this.api.marcas().subscribe({
      next: (m) => {
        this.marcas.set(m);
        const inicial = m.find((x) => x.predeterminada) ?? m[0];
        if (inicial) this.elegir(inicial); else this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  elegir(m: Marca): void {
    this.elegida.set(m);
    this.cargando.set(true);
    this.api.manual(m.id).subscribe({
      next: (s) => { this.secciones.set(s); this.cargando.set(false); },
      error: () => { this.secciones.set([]); this.cargando.set(false); },
    });
  }

  /**
   * El cuerpo del manual lo escribe un administrador desde la plataforma y lleva marcado
   * a proposito (negritas, listas). Se marca como confiable porque su origen es interno;
   * si algun dia lo pudiera editar cualquiera, esto tendria que pasar por un saneador.
   */
  html(s: SeccionManual): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(s.cuerpo_html ?? '');
  }

  async copiar(t: TokenMarca): Promise<void> {
    try { await navigator.clipboard.writeText(t.valor); } catch { /* sin portapapeles */ }
  }

  esClaro(hex: string): boolean {
    const h = hex.replace('#', '');
    if (h.length !== 6) return false;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    // Luminancia percibida: decide si el texto encima va oscuro o claro.
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160;
  }

  trackToken = (_: number, t: TokenMarca) => t.clave;
  trackSeccion = (_: number, s: SeccionManual) => s.slug;
}
