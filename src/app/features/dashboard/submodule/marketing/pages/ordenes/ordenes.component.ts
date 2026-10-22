import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { OrdenesService } from '../../ordenes/ordenes.service';
import {
  CAMPOS_ESPEC, CANALES, ESTADOS_ORDEN, ETIQUETA_ESTADO, NuevaOrden, OrdenResumen, TIPOS_ENTREGABLE,
  etiquetaTipo, iconoTipo,
} from '../../ordenes/ordenes.models';
import { Marca, MarketingService } from '../../service/marketing.service';

interface EntregableForm { tipo: string; titulo: string; espec: Record<string, string> }

/**
 * Ordenes de servicio: lo que se le pide a marketing (un video, un PDF, un curso...).
 *
 * <p>Arriba, cuantas hay en cada estado y que necesita atencion; la lista se ordena por la
 * fecha en que se pidio. Pedir es para cualquiera; producir es del equipo de marketing.
 */
@Component({
  selector: 'app-mk-ordenes',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ordenes.component.html',
  styleUrls: ['../../ordenes/ordenes-comun.css', './ordenes.component.css'],
})
export class OrdenesComponent implements OnInit {
  private readonly api = inject(OrdenesService);
  private readonly mk = inject(MarketingService);
  private readonly router = inject(Router);

  readonly estados = ESTADOS_ORDEN;
  readonly tipos = TIPOS_ENTREGABLE;
  readonly canales = CANALES;
  readonly etiqueta = ETIQUETA_ESTADO;
  readonly camposEspec = CAMPOS_ESPEC;
  readonly iconoTipo = iconoTipo;
  readonly etiquetaTipo = etiquetaTipo;

  readonly cargando = signal(true);
  readonly ordenes = signal<OrdenResumen[]>([]);
  readonly porEstado = signal<Record<string, number>>({});
  readonly esAdmin = signal(false);
  readonly filtroEstado = signal('');
  readonly mias = signal(false);
  readonly busca = signal('');

  readonly marcas = signal<Marca[]>([]);
  readonly creando = signal(false);
  readonly guardando = signal(false);

  // formulario de nueva orden
  titulo = '';
  tipo = 'VIDEO';
  marcaId: string | null = null;
  prioridad = 'MEDIA';
  fechaRequerida = '';
  brief = '';
  objetivo = '';
  publico = '';
  canalesElegidos = new Set<string>();
  relacionTipo = '';
  relacionEtiqueta = '';
  entregables: EntregableForm[] = [];

  readonly atencion = computed(() => (this.porEstado()['EN_REVISION'] ?? 0) + (this.porEstado()['CAMBIOS'] ?? 0));
  readonly hoy = new Date().toISOString().slice(0, 10);

  ngOnInit(): void {
    this.cargar();
    this.mk.marcas().subscribe({ next: (m) => this.marcas.set(m), error: () => {} });
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.listar({ estado: this.filtroEstado(), mias: this.mias(), busca: this.busca() }).subscribe({
      next: (r) => {
        this.ordenes.set(r.ordenes);
        this.esAdmin.set(r.es_admin);
        if (!this.filtroEstado()) this.porEstado.set(r.por_estado);
        this.cargando.set(false);
      },
      error: () => { this.cargando.set(false); Swal.fire({ icon: 'error', title: 'No se pudieron cargar las órdenes' }); },
    });
  }

  filtrar(estado: string): void { this.filtroEstado.set(estado); this.cargar(); }

  private temporizador: ReturnType<typeof setTimeout> | null = null;
  buscar(texto: string): void {
    this.busca.set(texto);
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargar(), 300);
  }

  alternarMias(): void { this.mias.set(!this.mias()); this.cargar(); }

  abrir(o: OrdenResumen): void { this.router.navigate(['/dashboard/marketing/ordenes', o.id]); }

  vencida(o: OrdenResumen): boolean {
    return !!o.fecha_requerida && o.fecha_requerida < this.hoy && !['ENTREGADA', 'CANCELADA'].includes(o.estado);
  }

  // ── nueva orden ───────────────────────────────────────────────────────────

  nueva(): void {
    this.titulo = ''; this.tipo = 'VIDEO'; this.prioridad = 'MEDIA'; this.fechaRequerida = '';
    this.brief = ''; this.objetivo = ''; this.publico = ''; this.canalesElegidos = new Set();
    this.relacionTipo = ''; this.relacionEtiqueta = '';
    this.marcaId = this.marcas().find((m) => m.predeterminada)?.id ?? null;
    this.entregables = [this.entregableVacio('VIDEO')];
    this.creando.set(true);
  }

  entregableVacio(tipo: string): EntregableForm {
    const espec: Record<string, string> = {};
    for (const c of CAMPOS_ESPEC[tipo] ?? []) if (c.opciones) espec[c.clave] = c.opciones[0];
    return { tipo, titulo: '', espec };
  }

  cambiarTipoOrden(tipo: string): void {
    this.tipo = tipo;
    // El primer entregable acompaña al tipo de la orden mientras nadie lo haya tocado.
    if (this.entregables.length === 1 && !this.entregables[0].titulo) this.entregables[0] = this.entregableVacio(tipo);
  }

  cambiarTipoEntregable(e: EntregableForm, tipo: string): void {
    const nuevo = this.entregableVacio(tipo);
    e.tipo = tipo;
    e.espec = nuevo.espec;
  }

  agregarEntregable(): void { this.entregables = [...this.entregables, this.entregableVacio(this.tipo)]; }

  quitarEntregable(i: number): void { this.entregables = this.entregables.filter((_, j) => j !== i); }

  alternarCanal(c: string): void {
    const s = new Set(this.canalesElegidos);
    s.has(c) ? s.delete(c) : s.add(c);
    this.canalesElegidos = s;
  }

  guardar(): void {
    if (!this.titulo.trim()) { Swal.fire({ icon: 'warning', title: 'Falta el título' }); return; }
    if (!this.entregables.length) { Swal.fire({ icon: 'warning', title: 'Agrega al menos un entregable' }); return; }
    const o: NuevaOrden = {
      titulo: this.titulo.trim(), tipo: this.tipo, marca_id: this.marcaId, prioridad: this.prioridad,
      fecha_requerida: this.fechaRequerida || null, brief: this.brief, objetivo: this.objetivo,
      publico: this.publico, canales: [...this.canalesElegidos],
      relacion_tipo: this.relacionTipo || null, relacion_etiqueta: this.relacionEtiqueta || null,
      entregables: this.entregables.map((e) => ({
        tipo: e.tipo,
        titulo: e.titulo.trim() || `${etiquetaTipo(e.tipo)} — ${this.titulo.trim()}`,
        especificacion: this.espec(e),
      })),
    };
    this.guardando.set(true);
    this.api.crear(o).subscribe({
      next: (r) => { this.guardando.set(false); this.creando.set(false); this.router.navigate(['/dashboard/marketing/ordenes', r.id]); },
      error: (e) => { this.guardando.set(false); Swal.fire({ icon: 'error', title: 'No se pudo crear', text: e?.error?.error ?? '' }); },
    });
  }

  private espec(e: EntregableForm): Record<string, unknown> {
    const r: Record<string, unknown> = {};
    for (const c of CAMPOS_ESPEC[e.tipo] ?? []) {
      const v = e.espec[c.clave];
      if (v === undefined || v === '') continue;
      r[c.clave] = c.numero || /^\d+$/.test(v) ? Number(v) : v;
    }
    return r;
  }
}
