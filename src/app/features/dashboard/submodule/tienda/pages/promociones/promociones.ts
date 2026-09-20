import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { Negocio, TiendaService } from '../../service/tienda.service';

/**
 * Promociones y combos.
 *
 * <p>Una promoción se diseña una vez y se publica en las tiendas que se quiera. Por eso el
 * alta pide el negocio y las tiendas por separado: duplicar la campaña por cada punto
 * haría imposible medirla como una sola.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-promociones',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, ...TABLA_ESTANDAR],
  templateUrl: './promociones.html',
  styleUrls: ['../../styles/tienda-comun.css', './promociones.css'],
})
export class Promociones implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly promociones = signal<Array<Record<string, unknown>>>([]);
  readonly vigentes = signal<Array<Record<string, unknown>>>([]);
  readonly combos = signal<Array<Record<string, unknown>>>([]);
  readonly negocios = signal<Negocio[]>([]);

  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly formularioAbierto = signal(false);

  readonly tipos = [
    { codigo: 'PORCENTAJE', nombre: 'Porcentaje de descuento', pideValor: '% a descontar' },
    { codigo: 'MONTO_FIJO', nombre: 'Monto fijo de descuento', pideValor: 'Pesos a descontar' },
    { codigo: 'PRECIO_ESPECIAL', nombre: 'Precio especial', pideValor: 'Precio final por unidad' },
    { codigo: 'NXM', nombre: 'Lleve N pague M', pideValor: '' },
  ];

  /** Promociones del negocio en la tabla estándar (valores planos para buscar, filtrar y copiar). */
  readonly columnasPromociones: ColumnaTabla<Record<string, unknown>>[] = [
    { id: 'promocion', header: 'Promoción', valor: (p) => p['nombre'] as string, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'tipo', header: 'Tipo', valor: (p) => p['tipo'] as string, tarjeta: 'subtitulo' },
    { id: 'valor', header: 'Valor', align: 'right', valor: (p) => p['valor'] as number, tarjeta: 'meta' },
    { id: 'prioridad', header: 'Prioridad', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (p) => p['prioridad'] as number },
    { id: 'usos', header: 'Usos', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (p) => p['usos_actuales'] as number },
    { id: 'estado', header: 'Estado', tarjeta: 'badge',
      valor: (p) => (p['activa'] ? 'activa' : 'inactiva'),
      badge: (p) => p['activa'] ? { texto: 'activa', tono: 'ok' } : { texto: 'inactiva', tono: 'neutro' } },
  ];
  readonly idPromocion = (p: Record<string, unknown>) => p['id'];

  nueva = {
    negocio_id: '', codigo: '', nombre: '', descripcion: '',
    tipo: 'PORCENTAJE', valor: 0, nxm_lleva: 3, nxm_paga: 2,
    prioridad: 100, acumulable: false, max_usos_persona: null as number | null,
    vigente_hasta: '',
  };

  ngOnInit(): void {
    this.ctx.cargar();
    this.api.negocios().subscribe({
      next: n => {
        this.negocios.set(n);
        if (n.length && !this.nueva.negocio_id) {
          this.nueva.negocio_id = n[0].id;
          this.cargarPromociones(n[0].id);
        }
      },
      error: () => {},
    });
    const tienda = this.ctx.tiendaId();
    if (tienda) this.cargarDeTienda(tienda);
  }

  cargarPromociones(negocioId: string): void {
    this.api.promociones(negocioId).subscribe({
      next: p => this.promociones.set(p), error: () => this.promociones.set([]),
    });
  }

  cargarDeTienda(tienda: string): void {
    this.api.promocionesVigentes(tienda).subscribe({
      next: v => this.vigentes.set(v), error: () => this.vigentes.set([]),
    });
    this.api.combos(tienda).subscribe({
      next: c => this.combos.set(c), error: () => this.combos.set([]),
    });
  }

  crear(): void {
    const tienda = this.ctx.tiendaId();
    const cuerpo: Record<string, unknown> = {
      negocio_id: this.nueva.negocio_id,
      codigo: this.nueva.codigo,
      nombre: this.nueva.nombre,
      descripcion: this.nueva.descripcion,
      tipo: this.nueva.tipo,
      prioridad: this.nueva.prioridad,
      acumulable: this.nueva.acumulable,
      max_usos_persona: this.nueva.max_usos_persona,
      // Sin objetivo la promoción no aplica a nada; TODO es el caso más común al empezar.
      objetivos: [{ tipo: 'TODO' }],
      tiendas: tienda ? [tienda] : [],
    };
    if (this.nueva.tipo === 'NXM') {
      cuerpo['nxm_lleva'] = this.nueva.nxm_lleva;
      cuerpo['nxm_paga'] = this.nueva.nxm_paga;
    } else {
      cuerpo['valor'] = this.nueva.valor;
    }
    if (this.nueva.vigente_hasta) {
      cuerpo['vigente_hasta'] = `${this.nueva.vigente_hasta}T23:59:59Z`;
    }

    this.api.crearPromocion(cuerpo).subscribe({
      next: () => {
        this.aviso.set(`Promoción "${this.nueva.nombre}" creada y publicada en esta tienda.`);
        this.formularioAbierto.set(false);
        this.cargarPromociones(this.nueva.negocio_id);
        if (tienda) this.cargarDeTienda(tienda);
      },
      error: e => {
        const cuerpo = (e as { error?: { error?: string } })?.error;
        this.error.set(cuerpo?.error ?? 'No se pudo crear la promoción');
      },
    });
  }

  cambiarEstado(p: Record<string, unknown>, activa: boolean): void {
    this.api.cambiarEstadoPromocion(String(p['id']), activa).subscribe({
      next: () => {
        this.aviso.set(activa ? 'Promoción activada.' : 'Promoción desactivada.');
        this.cargarPromociones(this.nueva.negocio_id);
      },
      error: () => this.error.set('No se pudo cambiar el estado'),
    });
  }

  tipoActual() {
    return this.tipos.find(t => t.codigo === this.nueva.tipo) ?? this.tipos[0];
  }
}
