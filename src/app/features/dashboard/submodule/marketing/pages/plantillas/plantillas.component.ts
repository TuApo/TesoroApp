import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  DetallePlantilla, Ensayo, MarketingService, PlantillaResumen,
} from '../../service/marketing.service';

/**
 * El editor de plantillas.
 *
 * <p><b>La regla de esta pantalla</b>: no se publica una plantilla que no quepa. Una
 * plantilla rota no da error —sigue generando piezas, con el cargo cortado— y el fallo
 * aparece semanas después en una cartelera impresa. El botón de publicar sólo se enciende
 * después de un ensayo limpio, y el backend lo vuelve a comprobar por su cuenta.
 *
 * <p>El ensayo usa datos <b>a propósito incómodos</b>: una razón social larguísima, un
 * cargo de sesenta caracteres, ocho municipios. Probar con "Operario" y "Madrid" no prueba
 * nada.
 */
@Component({
  selector: 'app-mk-plantillas',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plantillas.component.html',
  styleUrl: './plantillas.component.css',
})
export class PlantillasComponent implements OnInit {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly lista = signal<PlantillaResumen[]>([]);
  readonly detalle = signal<DetallePlantilla | null>(null);

  readonly html = signal('');
  readonly css = signal('');
  readonly ensayo = signal<Ensayo | null>(null);
  readonly ensayando = signal(false);
  readonly publicando = signal(false);

  /** Se tocó el código desde el último ensayo: lo que se ve ya no es lo que hay. */
  readonly sucio = signal(false);

  readonly puedePublicar = computed(() =>
    !!this.ensayo()?.cabe_en_todos && !this.sucio() && !this.publicando());

  ngOnInit(): void {
    this.api.marcas().subscribe({
      next: (m) => {
        const pred = m.find((x) => x.predeterminada) ?? m[0];
        this.api.plantillas(pred?.id).subscribe({
          next: (l) => { this.lista.set(l); this.cargando.set(false); },
          error: () => this.cargando.set(false),
        });
      },
      error: () => this.cargando.set(false),
    });
  }

  abrir(p: PlantillaResumen): void {
    this.api.detallePlantilla(p.id).subscribe({
      next: (d) => {
        this.detalle.set(d);
        this.html.set(d.html);
        this.css.set(d.css ?? '');
        this.ensayo.set(null);
        this.sucio.set(false);
      },
      error: (e) => Swal.fire({ icon: 'error', title: 'No se pudo abrir',
                                text: e?.error?.error ?? '' }),
    });
  }

  cerrar(): void { this.detalle.set(null); this.ensayo.set(null); }

  cambiar(campo: 'html' | 'css', valor: string): void {
    campo === 'html' ? this.html.set(valor) : this.css.set(valor);
    this.sucio.set(true);
  }

  probar(): void {
    const d = this.detalle();
    if (!d) return;
    this.ensayando.set(true);
    this.api.ensayarPlantilla(d.id, this.html(), this.css()).subscribe({
      next: (e) => { this.ensayo.set(e); this.sucio.set(false); this.ensayando.set(false); },
      error: (err) => {
        this.ensayando.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudo ensayar',
                    text: err?.error?.error ?? 'El render no respondió' });
      },
    });
  }

  async publicar(): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    const r = await Swal.fire({
      title: `Publicar la versión ${d.version_numero + 1}`,
      input: 'text',
      inputPlaceholder: '¿Qué cambiaste? (queda en el historial)',
      showCancelButton: true, confirmButtonText: 'Publicar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;

    this.publicando.set(true);
    this.api.publicarPlantilla(d.id, this.html(), this.css(), r.value || '').subscribe({
      next: () => {
        this.publicando.set(false);
        Swal.fire({ icon: 'success', title: 'Publicada', timer: 1400, showConfirmButton: false });
        this.abrir({ id: d.id } as PlantillaResumen);
      },
      error: (err) => {
        this.publicando.set(false);
        // El backend vuelve a ensayar por su cuenta: si llega aquí, es que no cabe.
        Swal.fire({ icon: 'error', title: 'No se publicó',
                    text: err?.error?.error ?? 'No se pudo publicar' });
      },
    });
  }

  async restaurar(versionId: string, numero: number): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    const r = await Swal.fire({
      icon: 'question',
      title: `¿Volver a la versión ${numero}?`,
      text: 'Las piezas ya generadas no cambian; sólo las nuevas.',
      showCancelButton: true, confirmButtonText: 'Volver', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.restaurarVersion(d.id, versionId).subscribe({
      next: () => this.abrir({ id: d.id } as PlantillaResumen),
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo volver' }),
    });
  }

  /** Lo que falló, en una frase que se entienda sin saber qué es un clamp. */
  problemaLegible(r: { problemas: Record<string, unknown>[]; error: string | null }): string {
    if (r.error) return r.error;
    if (!r.problemas?.length) return '';
    return r.problemas
      .map((p) => String(p['detalle'] ?? p['tipo'] ?? 'algo no cabe'))
      .join(' · ');
  }
}
