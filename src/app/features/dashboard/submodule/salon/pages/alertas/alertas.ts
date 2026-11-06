import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AccionMasiva, ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent } from '@/app/shared/components/tabla-estandar';

import { SalonEncabezado } from '../../components/salon-encabezado';
import { Alerta, ETIQUETA_ALERTA, EstadoAlerta } from '../../models/salon.models';
import { SALON_CONTEXTO, permisosDeContexto } from '../../services/salon-contexto.token';
import { SalonService, mensajeError } from '../../services/salon.service';

const ESTADOS: Array<{ valor: EstadoAlerta | ''; texto: string }> = [
  { valor: 'ABIERTA', texto: 'Abiertas' }, { valor: 'ATENDIDA', texto: 'Atendidas' },
  { valor: 'CERRADA', texto: 'Cerradas' }, { valor: 'FALSO_POSITIVO', texto: 'Falsos positivos' }, { valor: '', texto: 'Todas' },
];

/**
 * Alertas del salón (§4.4) en la tabla estándar: filtro por estado y fechas, acciones
 * «Atender» y «Falso positivo» por fila y en bloque (la tabla pone confirmación y motivo).
 */
@Component({
  selector: 'app-salon-alertas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, SalonEncabezado, ...TABLA_ESTANDAR],
  styleUrls: ['../../salon-comun.css'],
  template: `
    <div class="sl-pagina">
      <app-salon-encabezado subtitulo="Mesas sin atención, escalados, limpieza y cámaras" />

      @if (!ctx.tiendaId()) {
        <div class="sl-panel sl-vacio"><mat-icon>storefront</mat-icon><strong>Elige una sede.</strong></div>
      } @else {
        @if (error(); as e) { <div class="sl-aviso sl-tono-danger" role="alert"><mat-icon>cloud_off</mat-icon>{{ e }}</div> }
        <app-tabla-estandar #tabla id="salon-alertas" titulo="Alertas del salón" modulo="Salón" entidad="alerta"
          [datos]="filas()" [columnas]="columnas" [filaId]="idFila" [cargando]="cargando()" [filaClase]="claseFila"
          [accionesMasivas]="permisos.puedeOperar() ? accionesMasivas : []" vacio="No hay alertas con este filtro.">
          <div tablaHerramientas class="sl-fila">
            <label class="sl-campo"><span>Estado</span>
              <select class="sl-select" [ngModel]="estado()" (ngModelChange)="estado.set($event); cargar()">
                @for (e of estados; track e.valor) { <option [value]="e.valor">{{ e.texto }}</option> }
              </select>
            </label>
            <label class="sl-campo"><span>Desde</span><input class="sl-input" type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event); cargar()" /></label>
            <label class="sl-campo"><span>Hasta</span><input class="sl-input" type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event); cargar()" /></label>
          </div>
          <div tablaAccionesBarra>
            <button type="button" class="sl-btn sl-btn--chico" (click)="cargar()" title="Actualizar"><mat-icon>refresh</mat-icon></button>
          </div>
          <ng-template tablaAcciones let-a>
            @if (permisos.puedeOperar() && a.estado === 'ABIERTA') {
              <button type="button" class="sl-btn sl-btn--chico sl-btn--ok" (click)="atender(a)" title="Marcar como atendida"><mat-icon>task_alt</mat-icon></button>
              <button type="button" class="sl-btn sl-btn--chico" (click)="falsoPositivo(a)" title="Falso positivo (con motivo)"><mat-icon>thumb_down_off_alt</mat-icon></button>
            }
          </ng-template>
        </app-tabla-estandar>
      }
    </div>
  `,
  styles: [`
    .sl-fila .sl-campo { min-width: 150px; }
    .sl-fila .sl-select, .sl-fila .sl-input { min-height: 40px; }
  `],
})
export class SalonAlertasPage implements OnDestroy {
  readonly ctx = inject(SALON_CONTEXTO);
  readonly permisos = permisosDeContexto(this.ctx);
  private api = inject(SalonService);
  private snack = inject(MatSnackBar);
  private tabla = viewChild<TablaEstandarComponent<Alerta>>('tabla');

  readonly estados = ESTADOS;
  readonly estado = signal<EstadoAlerta | ''>('ABIERTA');
  readonly desde = signal<string>('');
  readonly hasta = signal<string>('');
  readonly filas = signal<Alerta[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly idFila = (a: Alerta) => a.id;
  readonly claseFila = (a: Alerta) => a.estado === 'ABIERTA' ? (a.tipo === 'ESCALADO' ? 'te-fila--peligro' : 'te-fila--alerta') : '';

  readonly columnas: ColumnaTabla<Alerta>[] = [
    { id: 'mesa', header: 'Mesa', valor: a => a.mesa_nombre ?? '(cámara)', tarjeta: 'titulo' },
    { id: 'tipo', header: 'Tipo', valor: a => ETIQUETA_ALERTA[a.tipo] ?? a.tipo, tarjeta: 'badge', align: 'center',
      badge: a => ({ texto: ETIQUETA_ALERTA[a.tipo] ?? a.tipo, tono: a.tipo === 'ESCALADO' ? 'danger' : a.tipo === 'ATENCION' ? 'warn' : a.tipo === 'CAMARA' ? 'violet' : 'info' }) },
    { id: 'estado', header: 'Estado', valor: a => a.estado, align: 'center',
      badge: a => ({ texto: a.estado.replace('_', ' '), tono: a.estado === 'ABIERTA' ? 'danger' : a.estado === 'ATENDIDA' ? 'ok' : a.estado === 'FALSO_POSITIVO' ? 'neutro' : 'info' }) },
    { id: 'creada', header: 'Creada', valor: a => a.creada_en ? new Date(a.creada_en) : null, formato: a => fechaCorta(a.creada_en), tarjeta: 'subtitulo' },
    { id: 'atendida', header: 'Atendida', valor: a => a.atendida_en ? new Date(a.atendida_en) : null, formato: a => fechaCorta(a.atendida_en), prioridad: 2 },
    { id: 'por', header: 'Por', valor: a => a.atendida_por ?? '', formato: a => a.atendida_por ?? '—', prioridad: 3 },
    { id: 'tardo', header: 'Tardó', align: 'right', prioridad: 2, valor: a => a.segundos_para_atender,
      formato: a => a.segundos_para_atender == null ? '—' : `${Math.round(a.segundos_para_atender / 60)} min` },
    { id: 'detalle', header: 'Detalle', valor: a => a.detalle ?? '', formato: a => a.detalle ?? '—', prioridad: 3, tarjeta: 'cuerpo' },
  ];

  readonly accionAtender: AccionMasiva<Alerta> = {
    id: 'atender', etiqueta: 'Atender', icono: 'task_alt', tono: 'primario',
    aplicaA: a => a.estado === 'ABIERTA',
    confirmar: { icono: 'question', texto: 'Se marcan como atendidas; si eran ATENCIÓN/ESCALADO reinician el cronómetro de la mesa.' },
    ejecutar: a => this.api.atenderAlerta(a.id),
    etiquetaFila: a => `${a.mesa_nombre ?? 'cámara'} · ${ETIQUETA_ALERTA[a.tipo]}`,
    verbo: 'atendida(s)',
    alTerminar: () => this.cargar(),
  };
  readonly accionFalso: AccionMasiva<Alerta> = {
    id: 'falso', etiqueta: 'Falso positivo', icono: 'thumb_down_off_alt', tono: 'aviso',
    aplicaA: a => a.estado === 'ABIERTA',
    confirmar: { icono: 'warning', texto: 'Queda registrado para afinar la visión; no cambia el estado de la mesa.', nota: 'Motivo', notaObligatoria: true },
    ejecutar: (a, ctx) => this.api.falsoPositivo(a.id, ctx.nota),
    etiquetaFila: a => `${a.mesa_nombre ?? 'cámara'} · ${ETIQUETA_ALERTA[a.tipo]}`,
    verbo: 'marcada(s) como falso positivo',
    alTerminar: () => this.cargar(),
  };
  readonly accionesMasivas = [this.accionAtender, this.accionFalso];

  private refrescoId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => { if (this.ctx.tiendaId()) this.cargar(); });
    this.refrescoId = setInterval(() => { if (this.estado() === 'ABIERTA') this.cargar(true); }, 30_000);
  }
  ngOnDestroy(): void { if (this.refrescoId) clearInterval(this.refrescoId); }

  cargar(silencioso = false): void {
    const id = this.ctx.tiendaId();
    if (!id) return;
    if (!silencioso) this.cargando.set(true);
    this.api.alertas(id, { estado: this.estado() || null, desde: this.desde() || null, hasta: this.hasta() || null }).subscribe({
      next: l => { this.filas.set(l); this.error.set(null); this.cargando.set(false); },
      error: e => { this.error.set(mensajeError(e, 'No se pudieron cargar las alertas')); this.cargando.set(false); },
    });
  }

  atender(a: Alerta): void {
    this.api.atenderAlerta(a.id).subscribe({
      next: () => { this.snack.open('Alerta atendida', 'OK', { duration: 2500 }); this.cargar(true); },
      error: e => this.snack.open(mensajeError(e), 'OK', { duration: 5000 }),
    });
  }
  /** Reusa el flujo masivo de la tabla sobre una sola fila: así pide el motivo con el mismo diálogo. */
  falsoPositivo(a: Alerta): void {
    void this.tabla()?.correrAccionMasiva(this.accionFalso, [a]);
  }
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
