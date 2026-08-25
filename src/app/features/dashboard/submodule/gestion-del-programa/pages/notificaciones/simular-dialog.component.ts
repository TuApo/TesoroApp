import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { NotificacionesConfigService } from '../../services/notificaciones-config.service';
import {
  AUDIENCIA_MODO_LABEL,
  CANALES,
  Canal,
  Condicion,
  DESTINO_TIPO_LABEL,
  NotificationType,
  NotifRegla,
  OpcionAudiencia,
  parseCondiciones,
  placeholdersDe,
  SimulacionResultado,
  URGENCIA_META,
} from '../../models/notificacion-config.model';

export interface SimularDialogData {
  regla: NotifRegla;
  tipo?: NotificationType;
}

/**
 * Dry-run de una regla: responde a quién le llegaría y con qué texto, sin
 * escribir absolutamente nada.
 *
 * Es el paso previo obligatorio a activar cualquier regla. Una regla con la
 * audiencia mal puesta le llega a toda la empresa de una sola vez y eso no se
 * puede deshacer; aquí equivocarse es gratis.
 *
 * El formulario de prueba se ARMA SOLO a partir de la regla: se leen los
 * `{{placeholders}}` de las plantillas y del destino, y los campos que compara
 * la condición, y se ofrece un input por cada uno. Pedirle a quien configura
 * que escriba a mano el JSON del evento sería pedirle que adivine el contrato.
 */
@Component({
  selector: 'app-simular-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
  ],
  template: `
    <div class="dialog-header">
      <mat-icon class="dialog-icon">science</mat-icon>
      <div>
        <h2 mat-dialog-title>Simular «{{ data.regla.nombre }}»</h2>
        <p class="dialog-subtitle">
          Evento <code>{{ data.regla.evento_clave }}</code> · no se envía ni se guarda nada
        </p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <mat-dialog-content>
      <!-- ── Evento de prueba ── -->
      <section class="bloque">
        <h3>Evento de prueba</h3>

        <p class="ayuda" *ngIf="!campos.length && !esPayload">
          Esta regla no usa datos del evento: su plantilla es fija y la audiencia no
          depende del payload. Pulsa <b>Simular</b> directamente.
        </p>

        <div class="grid-2" *ngIf="campos.length">
          <mat-form-field appearance="outline" *ngFor="let c of campos">
            <mat-label>{{ c }}</mat-label>
            <input matInput [ngModel]="valores[c]" (ngModelChange)="valores[c] = $event"
                   [placeholder]="'Valor de ' + c">
          </mat-form-field>
        </div>

        <!-- En modo PAYLOAD los destinatarios los trae el evento, no la regla:
             sin elegir a alguien aquí la simulación daría siempre cero. -->
        <div class="selector" *ngIf="esPayload">
          <div class="sel-header">
            <mat-form-field appearance="outline" class="sel-buscar">
              <mat-label>Destinatarios del evento</mat-label>
              <input matInput [ngModel]="filtro" (ngModelChange)="filtro = $event"
                     placeholder="Buscar una persona">
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            <span class="sel-contador">{{ destinatarios.length }} elegido(s)</span>
          </div>
          <div class="sel-cargando" *ngIf="cargandoPersonas"><mat-spinner diameter="24"></mat-spinner></div>
          <div class="sel-lista" *ngIf="!cargandoPersonas">
            <label class="sel-item" *ngFor="let p of personasFiltradas">
              <input type="checkbox" [checked]="destinatarios.includes(p.id)"
                     (change)="alternarDestinatario(p.id)">
              <span class="sel-nombre">{{ p.nombre }}</span>
              <span class="sel-detalle" *ngIf="p.detalle">{{ p.detalle }}</span>
            </label>
            <p class="sel-vacio" *ngIf="!personasFiltradas.length">Sin coincidencias.</p>
          </div>
        </div>

        <mat-form-field appearance="outline" class="ancho-total">
          <mat-label>Quién provocó el hecho (opcional)</mat-label>
          <mat-select [(ngModel)]="actorId">
            <mat-option [value]="null">Nadie en concreto</mat-option>
            <mat-option *ngFor="let p of personas" [value]="p.id">{{ p.nombre }}</mat-option>
          </mat-select>
          <mat-hint *ngIf="data.regla.excluir_actor">
            La regla excluye al actor: elígelo para comprobar que queda fuera
          </mat-hint>
          <mat-hint *ngIf="!data.regla.excluir_actor">
            La regla NO excluye al actor: seguirá recibiendo el aviso
          </mat-hint>
        </mat-form-field>
      </section>

      <div class="acciones-sim">
        <button mat-flat-button color="primary" (click)="simular()" [disabled]="corriendo">
          <mat-spinner diameter="18" *ngIf="corriendo"></mat-spinner>
          <mat-icon *ngIf="!corriendo">play_arrow</mat-icon>
          Simular
        </button>
      </div>

      <!-- ── Resultado ── -->
      <section class="bloque resultado" *ngIf="resultado as r">
        <mat-divider></mat-divider>

        <div class="veredicto" [class.veredicto-ok]="r.condicion_se_cumple && r.destinatarios_total > 0"
             [class.veredicto-no]="!r.condicion_se_cumple"
             [class.veredicto-vacio]="r.condicion_se_cumple && r.destinatarios_total === 0">
          <mat-icon>{{ iconoVeredicto(r) }}</mat-icon>
          <div>
            <span class="veredicto-titulo">{{ tituloVeredicto(r) }}</span>
            <span class="veredicto-sub">{{ subVeredicto(r) }}</span>
          </div>
        </div>

        <div class="metricas">
          <div class="metrica">
            <span class="m-label">Personas alcanzadas</span>
            <span class="m-valor">{{ r.destinatarios_total }}</span>
          </div>
          <div class="metrica">
            <span class="m-label">Audiencia</span>
            <span class="m-valor pequeno">{{ AUDIENCIA_LABEL[r.audiencia_modo] }}</span>
          </div>
          <div class="metrica">
            <span class="m-label">Urgencia</span>
            <span class="m-valor pequeno">{{ URGENCIA[r.urgencia].label }}</span>
          </div>
          <div class="metrica">
            <span class="m-label">Canales</span>
            <span class="m-valor pequeno">{{ canalesLegibles(r.canales) }}</span>
          </div>
        </div>

        <div class="aviso aviso-warn" *ngIf="r.destinatarios_total > 200">
          <mat-icon>groups</mat-icon>
          <span>Son <b>{{ r.destinatarios_total }}</b> personas por cada evento. Si además va por
            correo, revisa la cuota de las cuentas remitentes antes de activar.</span>
        </div>

        <h3>Así se vería</h3>
        <div class="tarjeta-preview">
          <span class="preview-avatar" [style.background]="colorTipo + '1a'" [style.color]="colorTipo">
            <mat-icon>{{ iconoTipo }}</mat-icon>
          </span>
          <div class="preview-texto">
            <span class="preview-titulo">{{ r.titulo || '(título vacío)' }}</span>
            <span class="preview-mensaje" *ngIf="r.mensaje">{{ r.mensaje }}</span>
            <span class="preview-destino" *ngIf="r.destino_tipo !== 'NINGUNO'">
              <mat-icon>open_in_new</mat-icon>
              {{ DESTINO_LABEL[r.destino_tipo] }}: <code>{{ r.destino_valor }}</code>
            </span>
          </div>
        </div>

        <!-- Un placeholder sin dato se queda literal en el texto: es el error más
             común al configurar y hay que verlo aquí, no en la campana del usuario. -->
        <div class="aviso aviso-warn" *ngIf="placeholdersSinResolver(r).length">
          <mat-icon>report_problem</mat-icon>
          <span>Quedaron placeholders sin datos y se enviarían tal cual:
            <code *ngFor="let p of placeholdersSinResolver(r)">{{ p }}</code></span>
        </div>

        <details class="muestra" *ngIf="r.destinatarios_muestra.length">
          <summary>Ver ids alcanzados ({{ r.destinatarios_muestra.length }} de {{ r.destinatarios_total }})</summary>
          <ul>
            <li *ngFor="let id of r.destinatarios_muestra">
              {{ nombreDe(id) }} <code>{{ id }}</code>
            </li>
          </ul>
        </details>

        <p class="sello" *ngIf="!r.escribio">
          <mat-icon>lock</mat-icon>
          Simulación: no se creó ningún mensaje ni se envió ningún correo.
        </p>
      </section>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cerrar()">Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; }
    .dialog-icon { font-size: 36px; width: 36px; height: 36px; color: #3f51b5; }
    h2[mat-dialog-title] { margin: 0; font-size: 18px; }
    .dialog-subtitle { margin: 2px 0 0; font-size: 13px; color: #666; }
    .dialog-subtitle code, .preview-destino code, .muestra code {
      background: #f2f3f7; border: 1px solid #e3e5ee; border-radius: 4px; padding: 1px 5px; font-size: 11px;
    }
    mat-dialog-content { padding: 16px 24px !important; }
    mat-dialog-actions { padding: 12px 24px 16px !important; }

    .bloque h3 { margin: 16px 0 8px; font-size: 14px; font-weight: 600; color: #23262f; }
    .bloque:first-child h3 { margin-top: 0; }
    .ayuda { font-size: 12px; color: #6b6f80; line-height: 1.4; margin: 0 0 8px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
    .ancho-total { width: 100%; }

    .selector { border: 1px solid #e3e5ee; border-radius: 10px; padding: 12px; background: #fafbfe; margin-bottom: 12px; }
    .sel-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .sel-buscar { flex: 1 1 220px; }
    .sel-contador { font-size: 12px; color: #6b6f80; white-space: nowrap; }
    .sel-cargando { display: flex; justify-content: center; padding: 12px 0; }
    .sel-lista { max-height: 180px; overflow-y: auto; }
    .sel-item { display: flex; align-items: baseline; gap: 8px; padding: 4px 2px; border-radius: 6px; cursor: pointer; }
    .sel-item:hover { background: #f0f2fa; }
    .sel-nombre { font-size: 13px; }
    .sel-detalle { font-size: 11px; color: #8a8fa3; }
    .sel-vacio { font-size: 12px; color: #8a8fa3; margin: 8px 4px; }

    .acciones-sim { display: flex; justify-content: flex-end; padding: 8px 0 4px; }
    .acciones-sim mat-spinner { margin-right: 8px; }

    .veredicto {
      display: flex; align-items: flex-start; gap: 10px;
      border-radius: 10px; padding: 12px 14px; margin: 16px 0 12px;
    }
    .veredicto mat-icon { font-size: 24px; width: 24px; height: 24px; flex: 0 0 auto; }
    .veredicto > div { display: flex; flex-direction: column; line-height: 1.3; }
    .veredicto-titulo { font-size: 14px; font-weight: 700; }
    .veredicto-sub { font-size: 12px; opacity: .85; }
    .veredicto-ok { background: #e9f7ee; border: 1px solid #cfe9d9; color: #1c6b34; }
    .veredicto-no { background: #f2f3f7; border: 1px solid #e3e5ee; color: #4a4f63; }
    .veredicto-vacio { background: #fff4e5; border: 1px solid #ffd8a8; color: #8a5300; }

    .metricas { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .metrica {
      display: flex; flex-direction: column; gap: 2px;
      background: #f5f6fa; border: 1px solid #e7e9f3; border-radius: 9px; padding: 10px 12px;
    }
    .m-label { font-size: 11px; color: #6b6f80; }
    .m-valor { font-size: 20px; font-weight: 700; color: #23262f; }
    .m-valor.pequeno { font-size: 13px; font-weight: 600; }

    .aviso {
      display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap;
      border-radius: 8px; padding: 8px 12px; margin: 12px 0; font-size: 13px; line-height: 1.35;
    }
    .aviso mat-icon { font-size: 18px; width: 18px; height: 18px; margin-top: 1px; flex: 0 0 auto; }
    .aviso-warn { background: #fff4e5; color: #8a5300; border: 1px solid #ffd8a8; }
    .aviso code { background: #fff; border: 1px solid #f0d0a8; border-radius: 4px; padding: 1px 5px; font-size: 11px; }

    .tarjeta-preview {
      display: flex; gap: 12px; align-items: flex-start;
      border: 1px solid #e3e5ee; border-radius: 10px; padding: 12px 14px; background: #fff;
    }
    .preview-avatar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 38px; height: 38px; border-radius: 10px; flex: 0 0 auto;
    }
    .preview-avatar mat-icon { font-size: 21px; width: 21px; height: 21px; }
    .preview-texto { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .preview-titulo { font-size: 14px; font-weight: 600; color: #23262f; }
    .preview-mensaje { font-size: 13px; color: #4a4f63; }
    .preview-destino { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #6b6f80; }
    .preview-destino mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .muestra { margin-top: 12px; font-size: 12px; }
    .muestra summary { cursor: pointer; color: #3f51b5; }
    .muestra ul { margin: 8px 0 0; padding-left: 18px; max-height: 160px; overflow-y: auto; }
    .muestra li { margin-bottom: 3px; color: #4a4f63; }

    .sello {
      display: flex; align-items: center; gap: 6px;
      margin: 14px 0 0; font-size: 12px; color: #1c6b34;
    }
    .sello mat-icon { font-size: 16px; width: 16px; height: 16px; }

    @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
  `],
})
export class SimularDialogComponent implements OnInit {
  /** Campos del evento que hay que pedir: placeholders + campos de la condición. */
  campos: string[] = [];
  valores: Record<string, string> = {};

  destinatarios: string[] = [];
  actorId: string | null = null;
  personas: OpcionAudiencia[] = [];
  cargandoPersonas = false;
  filtro = '';

  corriendo = false;
  resultado: SimulacionResultado | null = null;

  readonly AUDIENCIA_LABEL = AUDIENCIA_MODO_LABEL;
  readonly DESTINO_LABEL = DESTINO_TIPO_LABEL;
  readonly URGENCIA = URGENCIA_META;

  constructor(
    private api: NotificacionesConfigService,
    private snack: MatSnackBar,
    private ref: MatDialogRef<SimularDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SimularDialogData,
  ) {}

  ngOnInit(): void {
    const r = this.data.regla;
    const dePlantillas = placeholdersDe(r.plantilla_titulo, r.plantilla_mensaje, r.destino_valor);
    const condiciones: Condicion[] = parseCondiciones(r.condicion_json) ?? [];
    const deCondiciones = condiciones.map((c) => c.campo).filter(Boolean);
    this.campos = [...new Set([...dePlantillas, ...deCondiciones])];

    // El selector de personas se usa para destinatarios (modo PAYLOAD) y para el
    // actor, así que se carga siempre que haga falta alguno de los dos.
    this.cargandoPersonas = true;
    this.api.opcionesDe('USUARIOS').subscribe((ps) => {
      this.personas = ps;
      this.cargandoPersonas = false;
    });
  }

  get esPayload(): boolean { return this.data.regla.audiencia_modo === 'PAYLOAD'; }

  get iconoTipo(): string { return this.data.tipo?.icono ?? 'notifications'; }
  get colorTipo(): string { return this.data.tipo?.color ?? '#64748b'; }

  get personasFiltradas(): OpcionAudiencia[] {
    const q = this.filtro.trim().toLowerCase();
    if (!q) return this.personas.slice(0, 200);
    return this.personas
      .filter((p) => `${p.nombre} ${p.detalle ?? ''}`.toLowerCase().includes(q))
      .slice(0, 200);
  }

  alternarDestinatario(id: string): void {
    this.destinatarios = this.destinatarios.includes(id)
      ? this.destinatarios.filter((x) => x !== id)
      : [...this.destinatarios, id];
  }

  nombreDe(id: string): string {
    return this.personas.find((p) => p.id === id)?.nombre ?? '';
  }

  canalesLegibles(canales: Canal[]): string {
    return canales
      .map((c) => CANALES.find((x) => x.value === c)?.label ?? c)
      .join(', ') || '—';
  }

  simular(): void {
    this.corriendo = true;
    this.resultado = null;
    this.api
      .simular(this.data.regla.id, {
        actor_id: this.actorId,
        destinatarios: this.destinatarios.length ? this.destinatarios : null,
        payload: this.construirPayload(),
      })
      .subscribe({
        next: (res) => { this.resultado = res; this.corriendo = false; },
        error: (e) => {
          this.corriendo = false;
          const err = e as { error?: { error?: string } | string };
          const msg = typeof err?.error === 'string'
            ? err.error
            : err?.error?.error ?? 'No se pudo simular la regla';
          this.snack.open(msg, 'Cerrar', { duration: 7000 });
        },
      });
  }

  /**
   * Convierte los campos planos del formulario en el objeto anidado que espera
   * el motor: `card.title` tiene que viajar como `{card:{title:…}}`, que es lo
   * que lee `PayloadAccessor` al resolver la ruta con puntos.
   */
  private construirPayload(): Record<string, unknown> {
    const raiz: Record<string, unknown> = {};
    for (const [campo, valor] of Object.entries(this.valores)) {
      if (valor === undefined || valor === '') continue;
      const partes = campo.split('.');
      let nodo = raiz;
      for (let i = 0; i < partes.length - 1; i++) {
        const hijo = nodo[partes[i]];
        if (typeof hijo !== 'object' || hijo === null) nodo[partes[i]] = {};
        nodo = nodo[partes[i]] as Record<string, unknown>;
      }
      nodo[partes[partes.length - 1]] = valor;
    }
    return raiz;
  }

  /** Placeholders que sobrevivieron al render: se enviarían literales al usuario. */
  placeholdersSinResolver(r: SimulacionResultado): string[] {
    return placeholdersDe(r.titulo, r.mensaje, r.destino_valor);
  }

  iconoVeredicto(r: SimulacionResultado): string {
    if (!r.condicion_se_cumple) return 'filter_alt_off';
    return r.destinatarios_total > 0 ? 'check_circle' : 'person_off';
  }

  tituloVeredicto(r: SimulacionResultado): string {
    if (!r.condicion_se_cumple) return 'La condición no se cumple: no se notificaría';
    if (r.destinatarios_total === 0) return 'La condición se cumple, pero no hay a quién avisar';
    return `Se notificaría a ${r.destinatarios_total} persona(s)`;
  }

  subVeredicto(r: SimulacionResultado): string {
    if (!r.condicion_se_cumple) {
      return 'Con estos datos la regla se queda quieta. Ajusta los valores del evento de prueba.';
    }
    if (r.destinatarios_total === 0) {
      return this.esPayload
        ? 'En este modo los destinatarios vienen en el evento: elige a alguien arriba.'
        : 'La audiencia configurada no resolvió a nadie. Revisa la selección de la regla.';
    }
    return 'Revisa el texto y los destinatarios antes de activarla.';
  }

  cerrar(): void { this.ref.close(); }
}
