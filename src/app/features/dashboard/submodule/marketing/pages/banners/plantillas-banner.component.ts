import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';
import { BannerItem, Diseno, PlantillaBanner } from '../../carrusel/carrusel.models';
import { CarruselService } from '../../carrusel/carrusel.service';
import { BannerSlideComponent } from '../../carrusel/banner-slide.component';

/**
 * Las plantillas predefinidas: el diseño de cada tipo de comunicado. Cambiar aquí los
 * colores de "Aviso urgente" cambia TODOS los banners que la usan y no los sobrescriben,
 * que es la gracia: la identidad se decide una vez.
 */
@Component({
  selector: 'app-plantillas-banner',
  standalone: true,
  imports: [FormsModule, MatIconModule, BannerSlideComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cab">
      <p class="sub">Cada plantilla es un tipo de comunicado con su diseño. Al crear un banner se elige una y solo se
        cambian el texto y la imagen. Los banners heredan lo que no sobrescriban.</p>
      <button type="button" class="btn btn--primario" (click)="nueva()"><mat-icon>add</mat-icon> Nueva plantilla</button>
    </div>
    <div class="grid">
      @for (t of plantillas(); track t.id) {
        <article class="tarjeta" [class.tarjeta--off]="!t.activo">
          <div class="muestra"><app-banner-slide [item]="muestra(t)" orientacion="HORIZONTAL" [activo]="false" [miniatura]="true" nombreUsuario="Ana" /></div>
          <div class="datos">
            <strong>{{ t.nombre }} @if (!t.activo) { <small>(desactivada)</small> }</strong>
            <small>{{ t.descripcion }}</small>
          </div>
          <div class="acciones">
            <button type="button" class="mini" (click)="editar(t)" title="Editar"><mat-icon>edit</mat-icon></button>
            <button type="button" class="mini" (click)="usar.emit(t.id)" title="Crear un banner con esta plantilla">
              <mat-icon>add_photo_alternate</mat-icon></button>
          </div>
        </article>
      }
    </div>

    @if (editando(); as e) {
      <div class="telon" (click)="editando.set(null)">
        <form class="panel" (click)="$event.stopPropagation()" (ngSubmit)="guardar()">
          <h3>{{ e.id ? 'Editar plantilla' : 'Nueva plantilla' }}</h3>
          <div class="muestra muestra--grande"><app-banner-slide [item]="muestra(e)" orientacion="HORIZONTAL" [activo]="false" nombreUsuario="Ana" /></div>
          <label class="campo"><span>Nombre</span>
            <input name="nombre" [ngModel]="e.nombre" (ngModelChange)="campo('nombre', $event)" required maxlength="120" /></label>
          <label class="campo"><span>Para qué sirve</span>
            <input name="descripcion" [ngModel]="e.descripcion" (ngModelChange)="campo('descripcion', $event)" maxlength="500" /></label>
          <div class="fila">
            <label class="campo"><span>Diseño</span>
              <select name="diseno" [ngModel]="e.diseno" (ngModelChange)="campo('diseno', $event)">
                @for (d of disenos; track d.valor) { <option [value]="d.valor">{{ d.nombre }}</option> }
              </select></label>
            <label class="campo"><span>Ícono (Material)</span>
              <input name="icono" [ngModel]="e.icono" (ngModelChange)="campo('icono', $event)" placeholder="event" /></label>
          </div>
          <div class="fila">
            <label class="campo"><span>Etiqueta por defecto</span>
              <input name="etq" [ngModel]="e.etiqueta_defecto" (ngModelChange)="campo('etiqueta_defecto', $event)" maxlength="30" /></label>
            <label class="campo"><span>Botón por defecto</span>
              <input name="cta" [ngModel]="e.cta_defecto" (ngModelChange)="campo('cta_defecto', $event)" maxlength="30" /></label>
          </div>
          <div class="fila">
            <label class="campo"><span>Título de ejemplo</span>
              <input name="te" [ngModel]="e.titulo_ejemplo" (ngModelChange)="campo('titulo_ejemplo', $event)" maxlength="90" /></label>
            <label class="campo"><span>Subtítulo de ejemplo</span>
              <input name="se" [ngModel]="e.subtitulo_ejemplo" (ngModelChange)="campo('subtitulo_ejemplo', $event)" maxlength="160" /></label>
          </div>
          <div class="colores">
            <label class="color"><input type="color" name="cf" [ngModel]="e.color_fondo" (ngModelChange)="campo('color_fondo', $event)" /> Fondo</label>
            <label class="color"><input type="color" name="ct" [ngModel]="e.color_texto" (ngModelChange)="campo('color_texto', $event)" /> Texto</label>
            <label class="color"><input type="color" name="ca" [ngModel]="e.color_acento" (ngModelChange)="campo('color_acento', $event)" /> Acento</label>
            <label class="campo rango"><span>Oscurecer: {{ e.oscurecer }} %</span>
              <input type="range" name="os" min="0" max="90" step="5" [ngModel]="e.oscurecer" (ngModelChange)="campo('oscurecer', +$event)" /></label>
          </div>
          <label class="check"><input type="checkbox" name="act" [ngModel]="e.activo" (ngModelChange)="campo('activo', $event)" />
            Activa (se ofrece al crear banners)</label>
          <div class="pie">
            <button type="button" class="btn btn--fantasma" (click)="editando.set(null)">Cancelar</button>
            <button type="submit" class="btn btn--primario" [disabled]="guardando() || !e.nombre">Guardar</button>
          </div>
        </form>
      </div>
    }
  `,
  styleUrl: './pestanas-banners.css',
})
export class PlantillasBannerComponent {
  private readonly api = inject(CarruselService);

  readonly plantillas = input<PlantillaBanner[]>([]);
  readonly cambio = output<void>();
  readonly usar = output<string>();

  readonly editando = signal<Partial<PlantillaBanner> | null>(null);
  readonly guardando = signal(false);

  readonly disenos: { valor: Diseno; nombre: string }[] = [
    { valor: 'TEXTO_IZQUIERDA', nombre: 'Texto a la izquierda' },
    { valor: 'TEXTO_CENTRO', nombre: 'Texto centrado' },
    { valor: 'FRANJA_INFERIOR', nombre: 'Franja inferior' },
    { valor: 'TARJETA_LATERAL', nombre: 'Tarjeta lateral' },
    { valor: 'SOLO_MEDIA', nombre: 'Solo imagen o video' },
  ];

  /** Un banner de muestra sin imagen: se ve el color de fondo con el texto de ejemplo. */
  muestra(t: Partial<PlantillaBanner>): BannerItem {
    return {
      id: t.id ?? 'nueva',
      titulo: t.titulo_ejemplo || t.nombre || 'Título de ejemplo',
      subtitulo: t.subtitulo_ejemplo || 'Subtítulo de ejemplo',
      etiqueta: t.etiqueta_defecto ?? null,
      cta_texto: t.cta_defecto || null,
      diseno: (t.diseno ?? 'TEXTO_IZQUIERDA') as Diseno,
      color_fondo: t.color_fondo ?? '#0f172a',
      color_texto: t.color_texto ?? '#ffffff',
      color_acento: t.color_acento ?? '#f59e0b',
      oscurecer: t.oscurecer ?? 45,
      icono: t.icono ?? null,
      destino: { tipo: t.cta_defecto ? 'DETALLE' : 'NINGUNO' },
      duracion_segundos: 7,
      descartable: false,
      horizontal: null,
      vertical: null,
    };
  }

  nueva(): void {
    this.editando.set({
      nombre: '', descripcion: '', diseno: 'TEXTO_IZQUIERDA', color_fondo: '#0f172a', color_texto: '#ffffff',
      color_acento: '#f59e0b', oscurecer: 45, icono: 'campaign', etiqueta_defecto: '', cta_defecto: 'Ver más', activo: true,
    });
  }

  editar(t: PlantillaBanner): void { this.editando.set({ ...t }); }

  campo<K extends keyof PlantillaBanner>(k: K, v: PlantillaBanner[K]): void {
    this.editando.update((e) => (e ? { ...e, [k]: v } : e));
  }

  guardar(): void {
    const e = this.editando();
    if (!e?.nombre) return;
    this.guardando.set(true);
    const req = e.id ? this.api.editarPlantilla(e.id, e) : this.api.crearPlantilla(e);
    req.subscribe({
      next: () => { this.guardando.set(false); this.editando.set(null); this.cambio.emit(); },
      error: (err: HttpErrorResponse) => {
        this.guardando.set(false);
        Swal.fire('No se pudo guardar', err.error?.error || 'Intenta de nuevo.', 'error');
      },
    });
  }
}
