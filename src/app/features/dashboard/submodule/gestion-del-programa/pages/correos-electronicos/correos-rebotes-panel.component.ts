import { Component, OnInit } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import Swal from 'sweetalert2';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { CorreosService } from '../../services/correos.service';
import {
  DireccionRebotada,
  EnvioRebotado,
  EstadoRebotes,
  TIPO_REBOTE_META,
  TipoRebote,
} from '../../models/correo-rebote.model';

function aFecha(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Rebotes de correo, debajo de las cuentas remitentes.
 *
 * El rebote vuelve al buzón de la cuenta remitente; el backend lee cada 10 min
 * los avisos de mailer-daemon de esos buzones y los cruza con su envío por
 * Message-ID. Aquí se
 * ve qué direcciones rebotaron y qué envíos no llegaron.
 *
 * Fase 1: solo se marca. Ningún envío se bloquea por una dirección inválida;
 * «Desmarcar» sirve cuando la persona corrigió su buzón o fue un falso positivo.
 */
@Component({
  selector: 'app-correos-rebotes-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    ...TABLA_ESTANDAR,
  ],
  template: `
  <section class="rb">
    <div class="rb-head">
      <div class="rb-title">
        <mat-icon>unsubscribe</mat-icon>
        <div>
          <h2>Rebotes</h2>
          <p>Correos que el servidor de destino devolvió. Por ahora solo se marcan: ningún envío se bloquea.</p>
        </div>
      </div>
      <div class="rb-estado" *ngIf="estado as e">
        <span class="rb-chip" [class.ok]="e.configurado && !e.ultimo_error" [class.mal]="!e.configurado || e.ultimo_error">
          <mat-icon>{{ !e.configurado ? 'link_off' : e.ultimo_error ? 'error' : 'mark_email_read' }}</mat-icon>
          {{ !e.configurado ? 'Lectura de rebotes sin configurar' : e.ultimo_error ? 'Error al leer un buzón' : 'Leyendo los buzones remitentes cada 10 min' }}
        </span>
        <span class="rb-sub" *ngIf="e.ultima_pasada" [matTooltip]="e.ultimo_error || ('Buzones: ' + (e.buzones || []).join(', '))">
          Última revisión {{ fechaHora(e.ultima_pasada) }}
        </span>
        <button mat-stroked-button (click)="revisar()" [disabled]="!e.configurado || revisando">
          <mat-spinner *ngIf="revisando" diameter="16"></mat-spinner>
          <mat-icon *ngIf="!revisando">sync</mat-icon>
          Revisar ahora
        </button>
      </div>
    </div>

    <mat-tab-group animationDuration="0ms">
      <mat-tab [label]="'Direcciones (' + direcciones.length + ')'">
        <div class="rb-filtro">
          <mat-slide-toggle [checked]="soloInvalidas" (change)="soloInvalidas = $event.checked; cargarDirecciones()">
            Solo las marcadas como inválidas
          </mat-slide-toggle>
        </div>
        <app-tabla-estandar
          id="programa-correos-rebotes-direcciones"
          titulo="Direcciones que rebotaron"
          modulo="Gestión del programa"
          busqueda="Dirección u origen…"
          vacio="Ninguna dirección ha rebotado."
          [datos]="direcciones"
          [columnas]="colDirecciones"
          [filaId]="idFila"
          [cargando]="cargando"
          [filasPorPagina]="25"
          [seleccionable]="false"
          [pegable]="false">
          <ng-template tablaAcciones let-d>
            <button mat-icon-button *ngIf="d.invalida" (click)="desmarcar(d)"
                    matTooltip="Desmarcar: la persona corrigió su buzón">
              <mat-icon>restart_alt</mat-icon>
            </button>
          </ng-template>
        </app-tabla-estandar>
      </mat-tab>

      <mat-tab [label]="'Envíos rebotados (' + envios.length + ')'">
        <app-tabla-estandar
          id="programa-correos-rebotes-envios"
          titulo="Envíos rebotados"
          modulo="Gestión del programa"
          busqueda="Destinatario, asunto u origen…"
          vacio="Ningún envío ha rebotado."
          [datos]="envios"
          [columnas]="colEnvios"
          [filaId]="idFila"
          [cargando]="cargando"
          [filasPorPagina]="25"
          [seleccionable]="false"
          [pegable]="false">
        </app-tabla-estandar>
      </mat-tab>
    </mat-tab-group>
  </section>
  `,
  styles: [`
    .rb { margin-top: 24px; border-top: 1px solid var(--mat-sys-outline-variant, #e0e0e0); padding-top: 16px; }
    .rb-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .rb-title { display: flex; gap: 10px; align-items: flex-start; }
    .rb-title h2 { margin: 0; font-size: 1.15rem; }
    .rb-title p { margin: 2px 0 0; color: #666; font-size: .85rem; }
    .rb-estado { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .rb-chip { display: inline-flex; gap: 4px; align-items: center; padding: 2px 10px; border-radius: 12px; font-size: .8rem; background: #f1f3f4; }
    .rb-chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .rb-chip.ok { background: #e6f4ea; color: #1e7e34; }
    .rb-chip.mal { background: #fdecea; color: #b3261e; }
    .rb-sub { font-size: .8rem; color: #666; }
    .rb-filtro { padding: 10px 0; }
    button mat-spinner { display: inline-block; margin-right: 6px; }
  `],
})
export class CorreosRebotesPanelComponent implements OnInit {
  estado: EstadoRebotes | null = null;
  direcciones: DireccionRebotada[] = [];
  envios: EnvioRebotado[] = [];
  soloInvalidas = false;
  cargando = false;
  revisando = false;

  readonly idFila = (x: { id: number }) => x.id;

  readonly colDirecciones: ColumnaTabla<DireccionRebotada>[] = [
    { id: 'direccion', header: 'Dirección', valor: (d) => d.direccion, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'invalida', header: 'Estado', valor: (d) => (d.invalida ? 'Inválida' : 'Con avisos'), tarjeta: 'badge',
      badge: (d) => d.invalida
        ? { texto: 'Inválida', tono: 'danger', icono: 'block' }
        : { texto: d.desmarcada_en ? 'Desmarcada' : 'Con avisos', tono: 'neutro', icono: 'info' } },
    { id: 'ultimo_tipo', header: 'Último motivo', valor: (d) => this.tipoLabel(d.ultimo_tipo), tarjeta: 'meta',
      badge: (d) => this.tipoBadge(d.ultimo_tipo) },
    { id: 'ultimo_detalle', header: 'Detalle del servidor', valor: (d) => d.ultimo_detalle ?? '',
      formato: (d) => (d.ultimo_codigo ? d.ultimo_codigo + ' · ' : '') + (d.ultimo_detalle || '—'),
      prioridad: 3, tarjeta: 'cuerpo', minAncho: '260px' },
    { id: 'rebotes', header: 'Avisos', valor: (d) => d.rebotes_duros + d.rebotes_blandos, align: 'right',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'origen_ultimo', header: 'Origen', valor: (d) => d.origen_ultimo ?? '', formato: (d) => d.origen_ultimo || '—',
      prioridad: 2, tarjeta: 'meta' },
    { id: 'ultimo_rebote', header: 'Último aviso', valor: (d) => aFecha(d.ultimo_rebote),
      formato: (d) => this.fechaHora(d.ultimo_rebote), copiaTexto: (d) => this.fechaHora(d.ultimo_rebote), tarjeta: 'meta' },
  ];

  readonly colEnvios: ColumnaTabla<EnvioRebotado>[] = [
    { id: 'destinatario', header: 'Destinatario', valor: (e) => e.destinatario, tarjeta: 'titulo', minAncho: '200px' },
    { id: 'asunto', header: 'Asunto', valor: (e) => e.asunto ?? '', formato: (e) => e.asunto || '—', tarjeta: 'subtitulo' },
    { id: 'rebote_tipo', header: 'Motivo', valor: (e) => this.tipoLabel(e.rebote_tipo), tarjeta: 'badge',
      badge: (e) => this.tipoBadge(e.rebote_tipo) },
    { id: 'rebote_detalle', header: 'Detalle del servidor', valor: (e) => e.rebote_detalle ?? '',
      formato: (e) => (e.rebote_codigo ? e.rebote_codigo + ' · ' : '') + (e.rebote_detalle || '—'),
      prioridad: 3, tarjeta: 'cuerpo', minAncho: '260px' },
    { id: 'origen', header: 'Origen', valor: (e) => e.origen ?? '', formato: (e) => e.origen || '—', prioridad: 2, tarjeta: 'meta' },
    { id: 'enviado_en', header: 'Enviado', valor: (e) => aFecha(e.enviado_en),
      formato: (e) => this.fechaHora(e.enviado_en), copiaTexto: (e) => this.fechaHora(e.enviado_en), prioridad: 2, tarjeta: 'meta' },
    { id: 'rebote_en', header: 'Aviso', valor: (e) => aFecha(e.rebote_en),
      formato: (e) => this.fechaHora(e.rebote_en), copiaTexto: (e) => this.fechaHora(e.rebote_en), tarjeta: 'meta' },
  ];

  constructor(private correos: CorreosService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.correos.estadoRebotes().subscribe({ next: (e) => (this.estado = e), error: () => (this.estado = null) });
    this.cargarDirecciones();
    this.cargando = true;
    this.correos.enviosRebotados().subscribe({
      next: (r) => { this.envios = r; this.cargando = false; },
      error: () => { this.envios = []; this.cargando = false; },
    });
  }

  cargarDirecciones(): void {
    this.correos.direccionesRebotadas(this.soloInvalidas).subscribe({
      next: (r) => (this.direcciones = r),
      error: () => (this.direcciones = []),
    });
  }

  revisar(): void {
    this.revisando = true;
    this.correos.revisarRebotes().subscribe({
      next: ({ resumen, estado }) => {
        this.revisando = false;
        this.estado = estado;
        this.snack.open(resumen.leidos === 0
          ? 'No hay avisos nuevos en el buzón.'
          : `${resumen.leidos} avisos leídos: ${resumen.rebotes} rebotes, ${resumen.demoras} demoras.`, 'OK', { duration: 5000 });
        this.cargar();
      },
      error: (err) => {
        this.revisando = false;
        this.snack.open(err?.error?.error || 'No fue posible revisar los buzones.', 'OK', { duration: 6000 });
      },
    });
  }

  async desmarcar(d: DireccionRebotada): Promise<void> {
    const r = await Swal.fire({
      icon: 'question',
      title: 'Desmarcar dirección',
      html: `<b>${d.direccion}</b> dejará de figurar como inválida. El historial se conserva y un rebote nuevo la vuelve a marcar.`,
      showCancelButton: true,
      confirmButtonText: 'Desmarcar',
      cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.correos.desmarcarDireccion(d.id).subscribe({
      next: () => { this.snack.open('Dirección desmarcada.', 'OK', { duration: 3000 }); this.cargarDirecciones(); },
      error: (err) => this.snack.open(err?.error?.error || 'No fue posible desmarcar.', 'OK', { duration: 5000 }),
    });
  }

  tipoLabel(t: TipoRebote | null): string {
    return t ? TIPO_REBOTE_META[t]?.label ?? t : '—';
  }

  tipoBadge(t: TipoRebote | null) {
    if (!t) return null;
    const m = TIPO_REBOTE_META[t];
    return m ? { texto: m.label, tono: m.tono } : { texto: t, tono: 'neutro' as const };
  }

  fechaHora(v: string | null | undefined): string {
    const d = aFecha(v);
    return d ? formatDate(d, 'dd/MM/yyyy HH:mm', 'en-US') : '—';
  }
}
