import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom, isObservable } from 'rxjs';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';

export type TipoCampoForm = 'texto' | 'numero' | 'clave' | 'seleccion' | 'multiple' | 'booleano' | 'area' | 'fecha'
  | 'fechaHora' | 'hora' | 'color' | 'chips' | 'rango';

export interface OpcionForm { valor: unknown; texto: string; }

/** Un campo del formulario. Sirve igual para los CRUD del módulo y para los `campos` de una integración. */
export interface CampoForm {
  clave: string;
  etiqueta: string;
  tipo: TipoCampoForm;
  requerido?: boolean;
  ayuda?: string | null;
  placeholder?: string;
  opciones?: OpcionForm[];
  min?: number;
  max?: number;
  paso?: number;
  /** Ocupa toda la fila. */
  ancho?: boolean;
  /** Se muestra solo si devuelve true con los valores actuales. */
  visible?: (v: Record<string, any>) => boolean;
  /** Requerido solo si devuelve true (además de `requerido`). */
  requeridoSi?: (v: Record<string, any>) => boolean;
  /** Para `clave`: hay un valor guardado (vacío = no cambia). */
  guardado?: boolean;
  /** Título de una sección que empieza en este campo. */
  seccion?: string;
}

export interface DatosFormulario {
  titulo: string;
  icono?: string;
  descripcion?: string;
  aviso?: { tono: 'info' | 'warn' | 'danger'; texto: string };
  campos: CampoForm[];
  valores?: Record<string, any>;
  textoGuardar?: string;
  tono?: 'primario' | 'peligro';
  /** Validación cruzada: devuelve el mensaje que impide guardar, o null. */
  validar?: (v: Record<string, any>) => string | null;
  /** Si se da, el diálogo guarda él mismo (muestra el error sin cerrarse) y se cierra con el resultado. */
  guardar?: (v: Record<string, any>) => Observable<unknown> | Promise<unknown>;
  ancho?: string;
}

/**
 * Formulario en diálogo, descrito con campos. Sin `guardar` se cierra con los valores;
 * con `guardar` espera la respuesta del servidor y, si falla, se queda abierto con el
 * mensaje (así no se pierde lo escrito).
 */
@Component({
  selector: 'sg-formulario-dialogo',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSlideToggleModule, MatProgressBarModule, MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './formulario-dialogo.html',
  styleUrls: ['./dialogos.css'],
})
export class FormularioDialogo {
  readonly ref = inject<MatDialogRef<FormularioDialogo, unknown>>(MatDialogRef);
  readonly data = inject<DatosFormulario>(MAT_DIALOG_DATA);

  readonly valores: Record<string, any> = this.inicial();
  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly verClave = signal<Record<string, boolean>>({});
  /** Texto pendiente de cada campo de chips. */
  readonly borradorChip: Record<string, string> = {};
  /** Fuerza el repintado al cambiar un valor (los campos visibles dependen de otros). */
  readonly version = signal(0);

  private inicial(): Record<string, any> {
    const v: Record<string, any> = { ...(this.data.valores ?? {}) };
    for (const c of this.data.campos) {
      if (v[c.clave] === undefined) {
        v[c.clave] = c.tipo === 'booleano' ? false : c.tipo === 'chips' || c.tipo === 'multiple' ? [] : c.tipo === 'rango' ? (c.min ?? 0) : null;
      }
      if (c.tipo === 'clave') v[c.clave] = '';
    }
    return v;
  }

  cambio(): void { this.version.update((x) => x + 1); this.error.set(null); }

  visible(c: CampoForm): boolean { this.version(); return !c.visible || c.visible(this.valores); }
  requerido(c: CampoForm): boolean { this.version(); return !!c.requerido || !!c.requeridoSi?.(this.valores); }

  alternarClave(clave: string): void { this.verClave.update((m) => ({ ...m, [clave]: !m[clave] })); }

  agregarChip(c: CampoForm, ev?: Event): void {
    ev?.preventDefault();
    const t = (this.borradorChip[c.clave] ?? '').trim();
    if (!t) return;
    const lista: string[] = Array.isArray(this.valores[c.clave]) ? this.valores[c.clave] : [];
    const nuevos = t.split(/[,;\n]/).map((x) => x.trim()).filter((x) => x && !lista.includes(x));
    this.valores[c.clave] = [...lista, ...nuevos];
    this.borradorChip[c.clave] = '';
    this.cambio();
  }

  quitarChip(c: CampoForm, x: string): void {
    this.valores[c.clave] = (this.valores[c.clave] as string[]).filter((y) => y !== x);
    this.cambio();
  }

  private faltantes(): string[] {
    return this.data.campos
      .filter((c) => this.visible(c) && this.requerido(c) && c.tipo !== 'booleano')
      .filter((c) => {
        const v = this.valores[c.clave];
        if (c.tipo === 'clave' && c.guardado) return false;
        return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
      })
      .map((c) => c.etiqueta);
  }

  /** Valores limpios: sin campos ocultos, números como número, claves vacías fuera. */
  private salida(): Record<string, any> {
    const out: Record<string, any> = { ...this.valores };
    for (const c of this.data.campos) {
      if (!this.visible(c)) { delete out[c.clave]; continue; }
      const v = out[c.clave];
      if (c.tipo === 'numero' || c.tipo === 'rango') out[c.clave] = v === '' || v === null || v === undefined ? null : Number(v);
      if (c.tipo === 'clave' && !v) delete out[c.clave];
      if ((c.tipo === 'texto' || c.tipo === 'area') && typeof v === 'string') out[c.clave] = v.trim() || null;
    }
    return out;
  }

  async aceptar(): Promise<void> {
    for (const c of this.data.campos) if (c.tipo === 'chips' && (this.borradorChip[c.clave] ?? '').trim()) this.agregarChip(c);
    const f = this.faltantes();
    if (f.length) { this.error.set(`Falta llenar: ${f.join(', ')}.`); return; }
    const v = this.salida();
    const msg = this.data.validar?.(v);
    if (msg) { this.error.set(msg); return; }
    if (!this.data.guardar) { this.ref.close(v); return; }
    this.guardando.set(true);
    this.error.set(null);
    try {
      const r = this.data.guardar(v);
      const res = isObservable(r) ? await firstValueFrom(r, { defaultValue: null }) : await r;
      this.ref.close(res ?? v);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo guardar.'));
    } finally {
      this.guardando.set(false);
    }
  }
}

/** Abre el formulario y devuelve lo que devolvió (o undefined si se canceló). */
export function abrirFormulario<T = Record<string, any>>(dialog: MatDialog, datos: DatosFormulario): Promise<T | undefined> {
  return firstValueFrom(
    dialog.open<FormularioDialogo, DatosFormulario, T>(FormularioDialogo, {
      data: datos, width: datos.ancho ?? '640px', maxWidth: '96vw', autoFocus: 'first-tabbable',
    }).afterClosed(),
  );
}

/** Confirmación simple (sin campos) o con un motivo obligatorio. */
export async function confirmar(dialog: MatDialog, op: {
  titulo: string; texto: string; boton?: string; peligro?: boolean; motivo?: string; motivoObligatorio?: boolean; icono?: string;
}): Promise<{ motivo: string } | undefined> {
  const r = await abrirFormulario<Record<string, any>>(dialog, {
    titulo: op.titulo, icono: op.icono ?? (op.peligro ? 'warning' : 'help'), descripcion: op.texto,
    textoGuardar: op.boton ?? 'Confirmar', tono: op.peligro ? 'peligro' : 'primario', ancho: '480px',
    campos: op.motivo ? [{ clave: 'motivo', etiqueta: op.motivo, tipo: 'area', requerido: !!op.motivoObligatorio, ancho: true }] : [],
  });
  return r ? { motivo: (r['motivo'] as string) ?? '' } : undefined;
}
