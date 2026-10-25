/**
 * «Gestor y correos» de un centro de costo: datos del gestor, oficina responsable y la
 * lista de correos por rol (jefe de gestión humana, ejecutiva, SST…).
 *
 * Existe aparte de `DynamicFormDialogComponent` porque lleva una LISTA editable de
 * correos, igual que el diálogo de calendarios lleva una lista de fechas.
 *
 * Guarda él mismo (y no el componente padre) para poder mostrar dentro del diálogo el
 * rechazo del backend sin perder lo escrito. El PUT es completo: un correo que se quita
 * de la lista queda inactivo en la BD, no se borra.
 *
 * Las validaciones en línea son las MISMAS reglas del backend (ValidadorContactos); el
 * backend las vuelve a aplicar, así que esto es ayuda, no seguridad.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  CentroVacante, ContactosCentro, OficinaTemporal, ParametrizacionVacantesService,
  RolContacto, RolContactoInfo,
} from '../../services/parametrizacion-vacantes/parametrizacion-vacantes.service';

export interface GestorCorreosDialogData {
  centro: CentroVacante;
  puedeEditar: boolean;
  oficinas: OficinaTemporal[];
  roles: RolContactoInfo[];
}

/** Una fila editable de la tabla de correos. `clave` solo sirve para el @for. */
interface FilaCorreo { clave: number; rol: RolContacto; email: string; }

/** Mismas expresiones que ValidadorContactos (ms-auth-admin). */
const RE_CORREO = /^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$/;
const RE_TELEFONO = /^(3\d{9}|60[1-8]\d{7})$/;

export function normalizarTelefono(t: string | null | undefined): string {
  let s = (t ?? '').trim().replace(/[\s\-.()]/g, '');
  if (s.startsWith('+57')) s = s.slice(3);
  else if (s.startsWith('57') && s.length === 12) s = s.slice(2);
  return s;
}

export function errorTelefono(t: string | null | undefined): string | null {
  const s = normalizarTelefono(t);
  if (!s) return null;
  return RE_TELEFONO.test(s) ? null : 'Celular de 10 dígitos que empiece por 3, o fijo 60X + 7 dígitos.';
}

export function errorCorreo(e: string | null | undefined): string | null {
  const s = (e ?? '').trim().toLowerCase();
  if (!s) return 'Escribe el correo o quita la fila.';
  return RE_CORREO.test(s) ? null : 'No parece un correo válido.';
}

@Component({
  selector: 'app-gestor-correos-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatTooltipModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 class="gc-titulo" mat-dialog-title>
      <mat-icon>contact_mail</mat-icon>
      Gestor y correos · {{ data.centro.finca }}
      @if (data.centro.ccostos) { <span class="gc-codigo">{{ data.centro.ccostos }}</span> }
    </h2>

    <mat-dialog-content class="gc-cuerpo">
      @if (cargando()) {
        <div class="gc-cargando"><mat-spinner diameter="28"></mat-spinner></div>
      } @else {
        @if (!data.puedeEditar) {
          <p class="gc-aviso gc-aviso--info">
            <mat-icon>visibility</mat-icon>
            <span>Solo lectura: editar gestores y correos requiere permiso de administración del parametrizador.</span>
          </p>
        }
        @if (errorServidor()) {
          <p class="gc-aviso gc-aviso--error" role="alert">
            <mat-icon>error_outline</mat-icon><span>{{ errorServidor() }}</span>
          </p>
        }

        <section class="gc-gestor">
          <mat-form-field appearance="outline" class="gc-campo gc-campo--ancho">
            <mat-label>Nombre del gestor</mat-label>
            <input matInput maxlength="200" [disabled]="!data.puedeEditar"
                   [ngModel]="nombre()" (ngModelChange)="nombre.set($event)">
            @if (errorNombre()) { <mat-hint class="gc-hint-error">{{ errorNombre() }}</mat-hint> }
          </mat-form-field>

          <mat-form-field appearance="outline" class="gc-campo">
            <mat-label>Teléfono</mat-label>
            <input matInput maxlength="20" [disabled]="!data.puedeEditar" inputmode="tel"
                   [ngModel]="telefono()" (ngModelChange)="telefono.set($event)">
            @if (errorTel()) { <mat-hint class="gc-hint-error">{{ errorTel() }}</mat-hint> }
          </mat-form-field>

          <mat-form-field appearance="outline" class="gc-campo">
            <mat-label>Oficina responsable</mat-label>
            <mat-select [disabled]="!data.puedeEditar" [ngModel]="oficina()" (ngModelChange)="oficina.set($event)">
              <mat-option [value]="null">— Sin oficina —</mat-option>
              @for (o of oficinasVisibles(); track o.nombre) {
                <mat-option [value]="o.nombre">{{ o.nombre }}@if (!o.activo) { (inactiva) }</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </section>

        <section class="gc-correos">
          <header class="gc-correos__cab">
            <h3>Correos <span class="gc-contador">{{ filas().length }}</span></h3>
            <span class="grow"></span>
            <button mat-stroked-button type="button" (click)="copiarTodos()" [disabled]="!filas().length"
                    matTooltip="Copia los correos sin repetir, separados por punto y coma">
              <mat-icon>content_copy</mat-icon> Copiar todos
            </button>
            @if (data.puedeEditar) {
              <button mat-flat-button type="button" class="btn-managerial" (click)="agregar()">
                <mat-icon>add</mat-icon> Agregar correo
              </button>
            }
          </header>

          @if (!filas().length) {
            <p class="gc-vacio">Este centro no tiene correos.</p>
          } @else {
            <table class="gc-tabla">
              <thead><tr><th class="gc-col-rol">Rol</th><th>Correo</th><th class="gc-col-acc"></th></tr></thead>
              <tbody>
                @for (f of filas(); track f.clave; let i = $index) {
                  <tr [class.gc-fila--error]="errorFila(f)">
                    <td>
                      @if (data.puedeEditar) {
                        <select class="gc-select" [ngModel]="f.rol" (ngModelChange)="cambiar(i, { rol: $event })">
                          @for (r of data.roles; track r.rol) { <option [value]="r.rol">{{ r.etiqueta }}</option> }
                        </select>
                      } @else { {{ etiqueta(f.rol) }} }
                    </td>
                    <td>
                      @if (data.puedeEditar) {
                        <input class="gc-input" type="email" maxlength="200" [ngModel]="f.email"
                               (ngModelChange)="cambiar(i, { email: $event })" placeholder="correo@empresa.com">
                        @if (errorFila(f)) { <div class="gc-error">{{ errorFila(f) }}</div> }
                      } @else { {{ f.email }} }
                    </td>
                    <td class="gc-col-acc">
                      @if (data.puedeEditar) {
                        <button mat-icon-button type="button" (click)="quitar(i)"
                                matTooltip="Desactivar: deja de usarse pero queda en el historial">
                          <mat-icon>block</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
          @if (data.puedeEditar) {
            <p class="gc-nota">
              El correo del rol <strong>Gestor temporal</strong> es el que queda como correo del gestor del centro.
              Un correo que quites queda inactivo en el historial; no se borra.
            </p>
          }
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(false)">{{ data.puedeEditar ? 'Cancelar' : 'Cerrar' }}</button>
      @if (data.puedeEditar) {
        <button mat-flat-button class="btn-managerial" type="button"
                [disabled]="guardando() || cargando() || hayErrores()" (click)="guardar()">
          @if (guardando()) { <mat-spinner diameter="18"></mat-spinner> } @else { Guardar }
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .gc-titulo { display: flex; align-items: center; gap: 8px; }
    .gc-codigo { font-size: 12px; font-weight: 500; padding: 2px 8px; border-radius: 10px; background: var(--mat-sys-surface-container-high, #eceff4); }
    .gc-cuerpo { min-width: min(760px, 90vw); display: flex; flex-direction: column; gap: 12px; padding-top: 8px !important; }
    .gc-cargando { display: flex; justify-content: center; padding: 32px; }
    .gc-gestor { display: flex; flex-wrap: wrap; gap: 0 12px; }
    .gc-campo { flex: 1 1 180px; }
    .gc-campo--ancho { flex: 2 1 260px; }
    .gc-hint-error, .gc-error { color: var(--mat-sys-error, #b3261e); }
    .gc-error { font-size: 12px; margin-top: 2px; }
    .gc-aviso { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; border-radius: 8px; }
    .gc-aviso--info { background: var(--info-bg, #e8f0fe); color: var(--info-fg, #174ea6); }
    .gc-aviso--error { background: var(--warn-bg, #fdecea); color: var(--warn-fg, #8c1d18); }
    .gc-correos__cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .gc-correos__cab h3 { margin: 0; font-size: 15px; }
    .gc-contador { font-size: 12px; padding: 1px 8px; border-radius: 10px; background: var(--mat-sys-surface-container-high, #eceff4); }
    .grow { flex: 1; }
    .gc-tabla { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .gc-tabla th { text-align: left; font-size: 12px; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid rgba(0,0,0,.12); }
    .gc-tabla td { padding: 4px 8px; border-bottom: 1px solid rgba(0,0,0,.06); vertical-align: top; }
    .gc-col-rol { width: 200px; }
    .gc-col-acc { width: 48px; text-align: right; }
    .gc-select, .gc-input { width: 100%; box-sizing: border-box; padding: 7px 8px; border: 1px solid rgba(0,0,0,.24); border-radius: 6px; font: inherit; background: transparent; color: inherit; }
    .gc-fila--error .gc-input { border-color: var(--mat-sys-error, #b3261e); }
    .gc-vacio, .gc-nota { margin: 6px 0 0; font-size: 13px; opacity: .75; }
  `],
})
export class GestorCorreosDialogComponent {
  readonly data = inject<GestorCorreosDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject<MatDialogRef<GestorCorreosDialogComponent, boolean>>(MatDialogRef);
  private readonly svc = inject(ParametrizacionVacantesService);
  private readonly snack = inject(MatSnackBar);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly errorServidor = signal<string | null>(null);

  readonly nombre = signal('');
  readonly telefono = signal('');
  readonly oficina = signal<string | null>(null);
  readonly filas = signal<FilaCorreo[]>([]);
  private siguiente = 0;

  /** Activas + la que tenga el centro aunque se haya desactivado en el catálogo. */
  readonly oficinasVisibles = computed(() => {
    const actual = this.oficina();
    return this.data.oficinas.filter(o => o.activo || o.nombre === actual);
  });

  readonly errorTel = computed(() => errorTelefono(this.telefono()));
  readonly errorNombre = computed(() =>
    this.filas().length && !this.nombre().trim() ? 'Obligatorio cuando el centro tiene correos.' : null);

  /** (rol, correo) repetidos: el backend lo rechazaría. */
  private readonly duplicados = computed(() => {
    const vistos = new Map<string, number>();
    for (const f of this.filas()) {
      const k = `${f.rol}|${f.email.trim().toLowerCase()}`;
      vistos.set(k, (vistos.get(k) ?? 0) + 1);
    }
    return vistos;
  });

  readonly hayErrores = computed(() =>
    !!this.errorTel() || !!this.errorNombre() || this.filas().some(f => !!this.errorFila(f)));

  constructor() {
    this.svc.contactosDeCentro(this.data.centro.id).subscribe({
      next: c => { this.llenar(c); this.cargando.set(false); },
      error: e => {
        this.cargando.set(false);
        this.errorServidor.set(e?.error?.error ?? 'No se pudieron cargar los correos del centro.');
      },
    });
  }

  private llenar(c: ContactosCentro): void {
    this.nombre.set(c.nombre_gestor ?? '');
    this.telefono.set(c.telefono_gestor ?? '');
    this.oficina.set(c.oficina_responsable ?? null);
    this.filas.set(c.correos.map(x => ({ clave: this.siguiente++, rol: x.rol, email: x.email })));
  }

  etiqueta(rol: RolContacto): string {
    return this.data.roles.find(r => r.rol === rol)?.etiqueta ?? rol;
  }

  errorFila(f: FilaCorreo): string | null {
    const e = errorCorreo(f.email);
    if (e) return e;
    return (this.duplicados().get(`${f.rol}|${f.email.trim().toLowerCase()}`) ?? 0) > 1
      ? 'Repetido en el mismo rol.' : null;
  }

  agregar(): void {
    // Propone el primer rol libre: así "Agregar" no crea un duplicado de entrada.
    const usados = new Set(this.filas().map(f => f.rol));
    const rol = this.data.roles.find(r => !usados.has(r.rol))?.rol ?? 'OTRO_1';
    this.filas.update(l => [...l, { clave: this.siguiente++, rol, email: '' }]);
  }

  cambiar(i: number, cambio: Partial<FilaCorreo>): void {
    this.filas.update(l => l.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  }

  quitar(i: number): void {
    this.filas.update(l => l.filter((_, j) => j !== i));
  }

  copiarTodos(): void {
    const unicos = [...new Set(this.filas().map(f => f.email.trim().toLowerCase()).filter(Boolean))];
    navigator.clipboard?.writeText(unicos.join('; ')).then(
      () => this.snack.open(`${unicos.length} correo(s) copiados`, 'OK', { duration: 2500 }),
      () => this.snack.open('No se pudo copiar al portapapeles', 'Cerrar', { duration: 4000 }));
  }

  guardar(): void {
    if (this.hayErrores()) return;
    this.guardando.set(true);
    this.errorServidor.set(null);
    this.svc.guardarContactosDeCentro(this.data.centro.id, {
      nombre_gestor: this.nombre().trim() || null,
      telefono_gestor: normalizarTelefono(this.telefono()) || null,
      oficina_responsable: this.oficina(),
      correos: this.filas().map(f => ({ rol: f.rol, email: f.email.trim().toLowerCase() })),
    }).subscribe({
      next: () => { this.guardando.set(false); this.ref.close(true); },
      error: e => {
        this.guardando.set(false);
        const cod = e?.error?.codigo ? ` [${e.error.codigo}]` : '';
        this.errorServidor.set((e?.error?.error ?? 'No se pudo guardar.') + cod);
      },
    });
  }
}
