import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LowerCasePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BandejaApiService } from '../bandeja-api.service';
import { BandejaEstadoService } from '../bandeja-estado.service';
import { HiloResumen } from '../bandeja.models';
import { ESTADOS_HILO, cuando, espera, iconoCanal, tituloHilo } from '../bandeja-ui';
import { mensajeError } from '../../utils/tareas-ui';
import { HiloDetalleComponent } from '../hilo/hilo-detalle.component';

interface Vista { clave: string; etiqueta: string; icono: string }

/**
 * Conversaciones de la bandeja: lista con filtros a la izquierda y la conversación abierta a
 * la derecha (en el celular, una cosa a la vez). El hilo abierto va en `?hilo=` para poder
 * compartir el enlace y para que los avisos lleguen directo.
 */
@Component({
  selector: 'app-bandeja-entrada',
  standalone: true,
  imports: [FormsModule, LowerCasePipe, RouterLink, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule, HiloDetalleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './entrada.component.html',
  styleUrls: ['../bandeja-comun.css', './entrada.component.css'],
})
export class EntradaComponent implements OnInit {
  private readonly api = inject(BandejaApiService);
  readonly estado = inject(BandejaEstadoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);

  readonly vistas: Vista[] = [
    { clave: 'pendientes', etiqueta: 'Por responder', icono: 'reply' },
    { clave: 'vencidos', etiqueta: 'Vencidos', icono: 'alarm' },
    { clave: 'esperando', etiqueta: 'Esperando', icono: 'hourglass_top' },
    { clave: 'no_leidos', etiqueta: 'No leídos', icono: 'mark_email_unread' },
    { clave: 'todos', etiqueta: 'Todas', icono: 'inbox' },
    { clave: 'con_compromisos', etiqueta: 'Con compromisos', icono: 'handshake' },
    { clave: 'con_tareas', etiqueta: 'Con tareas', icono: 'task' },
    { clave: 'grupos', etiqueta: 'Grupos', icono: 'groups' },
    { clave: 'resueltos', etiqueta: 'Resueltas', icono: 'task_alt' },
    { clave: 'archivados', etiqueta: 'Archivadas', icono: 'archive' },
    { clave: 'masivos', etiqueta: 'Boletines', icono: 'campaign' },
    { clave: 'ignorados', etiqueta: 'No seguidas', icono: 'visibility_off' },
  ];

  readonly vista = signal('pendientes');
  readonly canal = signal<string>('');
  readonly q = signal('');
  readonly hilos = signal<HiloResumen[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly abierto = signal<string | null>(null);
  readonly hayMas = computed(() => this.hilos().length < this.total());

  readonly ESTADOS = ESTADOS_HILO;
  readonly cuando = cuando;
  readonly espera = espera;
  readonly iconoCanal = iconoCanal;
  readonly tituloHilo = tituloHilo;

  private buscarTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroy)).subscribe(qp => {
      const v = qp.get('vista');
      const h = qp.get('hilo');
      const vistaNueva = v ?? this.vista();
      const cambioVista = vistaNueva !== this.vista() || this.hilos().length === 0;
      this.vista.set(vistaNueva);
      this.abierto.set(h);
      if (cambioVista) void this.cargar(true);
    });
  }

  async cargar(desdeCero: boolean): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    const pg = desdeCero ? 0 : this.pagina() + 1;
    try {
      const r = await this.api.hilos({
        usuario: this.estado.supervisando() ? this.estado.usuario() : null,
        vista: this.vista(), canal: this.canal() || null, q: this.q().trim() || null, pagina: pg, tamano: 40,
      });
      this.hilos.set(desdeCero ? r.items : [...this.hilos(), ...r.items]);
      this.total.set(r.total);
      this.pagina.set(pg);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo cargar la bandeja.'));
    } finally {
      this.cargando.set(false);
    }
  }

  elegirVista(v: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { vista: v, hilo: null }, queryParamsHandling: 'merge' });
  }

  elegirCanal(c: string): void {
    this.canal.set(c);
    void this.cargar(true);
  }

  buscar(texto: string): void {
    this.q.set(texto);
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
    this.buscarTimer = setTimeout(() => void this.cargar(true), 350);
  }

  abrir(h: HiloResumen): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { hilo: h.id }, queryParamsHandling: 'merge' });
    if (h.no_leidos > 0 && !this.estado.supervisando()) {
      this.hilos.update(l => l.map(x => x.id === h.id ? { ...x, no_leidos: 0 } : x));
    }
  }

  cerrar(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { hilo: null }, queryParamsHandling: 'merge' });
  }

  /** El detalle avisa que algo cambió (estado, compromisos, tareas): se refresca la fila y los indicadores. */
  async alCambiar(): Promise<void> {
    void this.estado.refrescar();
    await this.cargar(true);
  }
}
