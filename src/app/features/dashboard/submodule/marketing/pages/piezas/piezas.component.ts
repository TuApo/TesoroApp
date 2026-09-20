import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { MarketingService, Pieza } from '../../service/marketing.service';

/**
 * Galeria de piezas: lo que se genero, lo que alguien subio, y de donde bajarlo.
 *
 * <p>Dos decisiones que no son obvias:
 *
 * <p><b>Las vistas previas se descargan como blob.</b> El endpoint del archivo exige
 * sesion y una etiqueta {@code <img src>} no manda la cabecera de autorizacion. Se baja
 * con HttpClient y se convierte en URL de objeto — que hay que <b>revocar</b> al salir, o
 * el navegador se queda con todas las imagenes en memoria.
 *
 * <p><b>Se cargan bajo demanda, no todas de golpe.</b> Cada pieza pesa entre 100 y 150 KB;
 * sesenta serian nueve megas en una pantalla que probablemente se abre desde un celular.
 */
@Component({
  selector: 'app-piezas',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './piezas.component.html',
  styleUrl: './piezas.component.css',
})
export class PiezasComponent implements OnInit, OnDestroy {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly piezas = signal<Pieza[]>([]);
  readonly generando = signal(false);

  /** Vistas previas ya descargadas, por id de pieza. */
  readonly vistas = signal<Record<string, string>>({});
  private readonly pedidas = new Set<string>();

  vacanteFiltro = '';
  readonly abierta = signal<Pieza | null>(null);

  // Subida de pieza propia.
  readonly mostrandoSubida = signal(false);
  archivoElegido: File | null = null;
  tituloNuevo = '';
  destinosNuevos = '';
  copyNuevo = '';
  readonly subiendo = signal(false);

  readonly hayPiezas = computed(() => this.piezas().length > 0);
  readonly generadas = computed(() => this.piezas().filter((p) => !p.es_subida).length);
  readonly subidas = computed(() => this.piezas().filter((p) => p.es_subida).length);

  ngOnInit(): void { this.cargarGaleria(); }

  ngOnDestroy(): void {
    // Sin esto, cada visita a la pantalla deja sesenta blobs vivos en memoria.
    for (const url of Object.values(this.vistas())) URL.revokeObjectURL(url);
  }

  cargarGaleria(): void {
    this.cargando.set(true);
    this.api.galeria().subscribe({
      next: (p) => { this.piezas.set(p); this.cargando.set(false); this.precargarPrimeras(); },
      error: (e) => { this.cargando.set(false); this.error('No se pudo cargar la galería', e); },
    });
  }

  buscarVacante(): void {
    const id = Number(this.vacanteFiltro);
    if (!Number.isFinite(id) || id <= 0) { this.cargarGaleria(); return; }
    this.cargando.set(true);
    this.api.deVacante(id).subscribe({
      next: (p) => { this.piezas.set(p); this.cargando.set(false); this.precargarPrimeras(); },
      error: (e) => { this.cargando.set(false); this.error('No se pudo consultar esa vacante', e); },
    });
  }

  generar(): void {
    const id = Number(this.vacanteFiltro);
    if (!Number.isFinite(id) || id <= 0) {
      Swal.fire({ icon: 'info', title: 'Falta la vacante',
        text: 'Escribe el número de la vacante para la que quieres generar piezas.' });
      return;
    }
    this.generando.set(true);
    this.api.generar(id).subscribe({
      next: (r) => {
        this.generando.set(false);
        this.buscarVacante();
        const partes = [`${r.generadas} nuevas`];
        if (r.reutilizadas) partes.push(`${r.reutilizadas} ya estaban`);
        if (r.fallidas) partes.push(`${r.fallidas} fallaron`);
        Swal.fire({
          icon: r.fallidas && !r.generadas ? 'warning' : 'success',
          title: r.generadas || r.reutilizadas ? 'Piezas listas' : 'No se generó ninguna',
          text: partes.join(' · ') + (r.motivos.length ? ` — ${r.motivos[0]}` : ''),
        });
      },
      error: (e) => { this.generando.set(false); this.error('No se pudieron generar', e); },
    });
  }

  /**
   * Baja las vistas previas de las primeras tarjetas en cuanto llega la lista.
   *
   * <p>La primera version las ataba a mouseenter y luego a un IntersectionObserver. Lo
   * primero no funcionaba en movil —no hay hover— y lo segundo no llegaba a activarse,
   * porque la lista llega asincrona y el gancho de ciclo de vida ya habia pasado.
   *
   * <p>Esto es tonto y funciona: un tope fijo. Doce piezas son metro y medio de scroll y
   * kilo y medio de descarga; el resto se ve al abrirlas. Cuando una vacante tiene cuatro
   * —el caso normal— se ven todas de una.
   */
  private precargarPrimeras(limite = 12): void {
    for (const p of this.piezas().slice(0, limite)) this.verPrevia(p);
  }

  /** Pide la vista previa la primera vez que hace falta. */
  verPrevia(p: Pieza): void {
    if (!p.tiene_imagen || this.pedidas.has(p.id)) return;
    this.pedidas.add(p.id);
    this.api.urlDeVista(p.id).subscribe({
      next: (url) => this.vistas.update((v) => ({ ...v, [p.id]: url })),
      // Sin vista previa la tarjeta sigue sirviendo: se puede descargar igual.
      error: () => this.pedidas.delete(p.id),
    });
  }

  previa(p: Pieza): string | null { return this.vistas()[p.id] ?? null; }

  descargar(p: Pieza, formato: 'imagen' | 'pdf'): void {
    this.api.archivo(p.id, formato, 'DESCARGA').subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(p.titulo || 'pieza').replace(/[^\w\s.-]/g, '')}-${p.formato ?? ''}`
          + (formato === 'pdf' ? '.pdf' : '.png');
        a.click();
        // Se revoca en el siguiente ciclo: revocarla ya cancelaria la descarga.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: (e) => this.error('No se pudo descargar', e),
    });
  }

  async copiarTexto(p: Pieza): Promise<void> {
    if (!p.copy_texto) return;
    try {
      await navigator.clipboard.writeText(p.copy_texto);
      Swal.fire({ icon: 'success', title: 'Texto copiado', timer: 1400, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'info', title: 'Copia el texto a mano', text: p.copy_texto });
    }
  }

  abrir(p: Pieza): void { this.verPrevia(p); this.abierta.set(p); }
  cerrar(): void { this.abierta.set(null); }

  // ── subida ──────────────────────────────────────────────────────────────

  elegirArchivo(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.archivoElegido = input.files?.[0] ?? null;
    if (this.archivoElegido && !this.tituloNuevo) {
      this.tituloNuevo = this.archivoElegido.name.replace(/\.[^.]+$/, '');
    }
  }

  subir(): void {
    if (!this.archivoElegido || !this.tituloNuevo.trim()) return;
    this.subiendo.set(true);
    this.api.subirPieza({
      archivo: this.archivoElegido,
      titulo: this.tituloNuevo.trim(),
      destinoTipo: 'VACANTE',
      destinos: this.destinosNuevos.split(',').map((s) => s.trim()).filter(Boolean),
      copyTexto: this.copyNuevo.trim() || undefined,
    }).subscribe({
      next: () => {
        this.subiendo.set(false);
        this.mostrandoSubida.set(false);
        this.archivoElegido = null; this.tituloNuevo = ''; this.destinosNuevos = ''; this.copyNuevo = '';
        this.cargarGaleria();
        Swal.fire({ icon: 'success', title: 'Pieza subida' });
      },
      error: (e) => { this.subiendo.set(false); this.error('No se pudo subir', e); },
    });
  }

  // ── presentacion ────────────────────────────────────────────────────────

  etiquetaFormato(f: string | null): string {
    switch (f) {
      case 'WSP_ESTADO': return 'Estado de WhatsApp';
      case 'WSP_DIFUSION': return 'WhatsApp difusión';
      case 'FEED_45': return 'Feed 4:5';
      case 'FEED_11': return 'Cuadrado';
      case 'STORY': return 'Historia';
      case 'AFICHE_A4': return 'Afiche A4';
      case 'MEDIA_CARTA': return 'Media carta';
      case 'BANNER_WEB': return 'Banner web';
      default: return f ?? 'Subida';
    }
  }

  trackPieza = (_: number, p: Pieza) => p.id;

  private error(titulo: string, e: any): void {
    Swal.fire({ icon: 'error', title: titulo,
      text: e?.error?.error ?? e?.message ?? 'Error inesperado' });
  }
}
