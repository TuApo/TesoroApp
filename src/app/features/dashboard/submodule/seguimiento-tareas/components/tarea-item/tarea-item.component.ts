import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { Estado, Tarea } from '../../models/tareas.models';
import { ESTADOS, estadoInfo, etiquetaOrigen, prioridadInfo, vencimiento } from '../../utils/tareas-ui';
import { TareaAvatarComponent } from '../avatar/avatar.component';

/**
 * Fila de tarea para las vistas de lista (Mis tareas, vista lista del tablero, calendario).
 * Un clic en el círculo la completa (o la reabre); el resto de la fila abre el detalle.
 */
@Component({
  selector: 'app-tarea-item',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, MatMenuModule, TareaAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = tarea();
    <div class="ti" [class.ti--hecha]="t.status === 'DONE'" [attr.data-venc]="venc().tono"
         role="button" tabindex="0" (click)="abrir.emit(t)" (keydown.enter)="abrir.emit(t)">
      <button type="button" class="ti__check" [attr.data-tono]="estado().tono"
              [matTooltip]="t.status === 'DONE' ? 'Reabrir' : 'Marcar como completada'"
              [attr.aria-label]="t.status === 'DONE' ? 'Reabrir tarea' : 'Completar tarea'"
              (click)="$event.stopPropagation(); completar.emit(t)">
        <mat-icon>{{ t.status === 'DONE' ? 'check_circle' : (t.status === 'BLOCKED' ? 'block' : (t.status === 'IN_PROGRESS' ? 'timelapse' : 'radio_button_unchecked')) }}</mat-icon>
      </button>

      <div class="ti__cuerpo">
        <div class="ti__titulo">
          @if (t.priority === 'URGENT' || t.priority === 'HIGH') {
            <mat-icon class="ti__prio" [attr.data-p]="prioridad().tono" [matTooltip]="'Prioridad ' + prioridad().etiqueta">{{ prioridad().icono }}</mat-icon>
          }
          <span class="ti__texto">{{ t.title }}</span>
          @for (l of t.labels ?? []; track l.id) {
            <span class="ti__etq" [style.--c]="l.label_color">{{ l.label_name }}</span>
          }
        </div>
        <div class="ti__meta">
          @if (mostrarContexto() && t.board_name) {
            <span class="ti__ctx" [matTooltip]="(t.workspace_name || '') + ' › ' + t.board_name + (t.list_name ? ' › ' + t.list_name : '')">
              <i class="ti__dot" [style.background]="t.board_accent || 'var(--primary)'"></i>{{ t.board_name }}
            </span>
          }
          @if (t.status !== 'TODO' && t.status !== 'DONE') {
            <span class="ti__estado" [attr.data-tono]="estado().tono">{{ estado().etiqueta }}</span>
          }
          @if (t.due_at) {
            <span class="ti__venc" [attr.data-tono]="venc().tono"><mat-icon>event</mat-icon>{{ venc().texto }}</span>
          }
          @if ((t.checklist_total ?? 0) > 0) {
            <span class="ti__cnt" [class.ti__cnt--ok]="t.checklist_done === t.checklist_total"
                  [matTooltip]="'Checklist ' + t.checklist_done + ' de ' + t.checklist_total">
              <mat-icon>checklist</mat-icon>{{ t.checklist_done }}/{{ t.checklist_total }}
            </span>
          }
          @if ((t.comment_count ?? 0) > 0) {
            <span class="ti__cnt" [matTooltip]="t.comment_count + ' comentarios'"><mat-icon>chat_bubble_outline</mat-icon>{{ t.comment_count }}</span>
          }
          @if ((t.attachment_count ?? 0) > 0) {
            <span class="ti__cnt" [matTooltip]="t.attachment_count + ' adjuntos'"><mat-icon>attach_file</mat-icon>{{ t.attachment_count }}</span>
          }
          @if (t.is_watching) {
            <span class="ti__cnt" matTooltip="La sigues"><mat-icon>visibility</mat-icon></span>
          }
          @if (t.origen_tipo) {
            <span class="ti__cnt" [matTooltip]="'Viene de: ' + origen()"><mat-icon>link</mat-icon></span>
          }
        </div>
      </div>

      <div class="ti__lado">
        @if (mostrarResponsable()) {
          @if (t.assignee_group && !t.assignee) {
            <app-tarea-avatar [grupo]="t.assignee_group_name || 'Grupo'" [tam]="28" />
          } @else {
            <app-tarea-avatar [usuario]="t.assignee" [tam]="28" />
          }
        }
        <button type="button" class="ti__mas" [matMenuTriggerFor]="menu" aria-label="Cambiar estado"
                (click)="$event.stopPropagation()" matTooltip="Cambiar estado">
          <mat-icon>more_vert</mat-icon>
        </button>
        <mat-menu #menu="matMenu" xPosition="before">
          @for (e of estados; track e.clave) {
            <button mat-menu-item [disabled]="e.clave === t.status" (click)="cambiarEstado.emit({ tarea: t, estado: e.clave })">
              <mat-icon [attr.data-tono]="e.tono" class="menu-ico">{{ e.icono }}</mat-icon>{{ e.etiqueta }}
            </button>
          }
        </mat-menu>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ti { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px;
          background: var(--surface); border: 1px solid var(--border); cursor: pointer;
          transition: border-color .15s, box-shadow .15s, transform .15s; min-width: 0; }
    .ti:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
    .ti:focus-visible { outline: none; box-shadow: var(--ring); }
    .ti[data-venc="vencida"] { border-left: 3px solid var(--danger); }
    .ti[data-venc="hoy"] { border-left: 3px solid var(--warning); }
    .ti--hecha .ti__texto { text-decoration: line-through; color: var(--muted); }
    .ti__check { flex: none; border: 0; background: none; padding: 2px; border-radius: 50%; cursor: pointer;
                 color: var(--text-faint); display: inline-flex; min-height: 0 !important; }
    .ti__check:hover { color: var(--mt-done); background: var(--ok-bg); }
    .ti__check[data-tono="done"] { color: var(--mt-done); }
    .ti__check[data-tono="prog"] { color: var(--mt-prog); }
    .ti__check[data-tono="block"] { color: var(--mt-block); }
    .ti__check mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .ti__cuerpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .ti__titulo { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
    .ti__texto { font-weight: 650; color: var(--text); overflow-wrap: anywhere; }
    .ti__prio { font-size: 18px; width: 18px; height: 18px; }
    .ti__prio[data-p="urgente"] { color: var(--danger); }
    .ti__prio[data-p="alta"] { color: var(--warning); }
    .ti__etq { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px;
               color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
    .ti__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
    .ti__meta mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .ti__ctx { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ti__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .ti__estado { font-weight: 700; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; }
    .ti__estado[data-tono="prog"] { color: var(--info-fg); background: var(--info-bg); }
    .ti__estado[data-tono="block"] { color: var(--danger-fg); background: var(--danger-bg); }
    .ti__venc, .ti__cnt { display: inline-flex; align-items: center; gap: 3px; }
    .ti__venc[data-tono="vencida"] { color: var(--danger-fg); font-weight: 700; }
    .ti__venc[data-tono="hoy"] { color: var(--warn-fg); font-weight: 700; }
    .ti__venc[data-tono="pronto"] { color: var(--text-2); }
    .ti__cnt--ok { color: var(--ok-fg); }
    .ti__lado { display: flex; align-items: center; gap: 4px; flex: none; }
    .ti__mas { border: 0; background: none; color: var(--text-faint); cursor: pointer; border-radius: 8px; padding: 4px;
               display: inline-flex; min-height: 0 !important; }
    .ti__mas:hover { background: var(--surface-3); color: var(--text); }
    .menu-ico[data-tono="done"] { color: var(--mt-done); }
    .menu-ico[data-tono="prog"] { color: var(--mt-prog); }
    .menu-ico[data-tono="block"] { color: var(--mt-block); }
    @media (max-width: 600px) {
      .ti { padding: 10px; gap: 8px; }
      .ti__ctx { max-width: 140px; }
    }
  `],
})
export class TareaItemComponent {
  readonly tarea = input.required<Tarea>();
  readonly mostrarContexto = input(true);
  readonly mostrarResponsable = input(true);
  readonly abrir = output<Tarea>();
  readonly completar = output<Tarea>();
  readonly cambiarEstado = output<{ tarea: Tarea; estado: Estado }>();

  readonly estados = ESTADOS;
  readonly estado = computed(() => estadoInfo(this.tarea().status));
  readonly prioridad = computed(() => prioridadInfo(this.tarea().priority));
  readonly venc = computed(() => vencimiento(this.tarea()));
  readonly origen = computed(() => etiquetaOrigen(this.tarea().origen_tipo));
}
