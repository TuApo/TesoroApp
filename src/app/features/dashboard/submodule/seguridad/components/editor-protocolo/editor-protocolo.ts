import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  AccionDispositivo, Audio, CANALES, Canal, Contacto, Dispositivo, ICONO_CANAL, ModoParlante, NOMBRE_ACCION, NOMBRE_CANAL,
  Parlante, PasoProtocolo,
} from '../../models/seguridad.models';
import { cronometro } from '../../utils/formato';

export function pasoVacio(orden: number, espera = 0): PasoProtocolo {
  return {
    orden, espera_seg: espera, canales: [], contactos: [], roles: [], mensaje: '', parlante_modo: null, parlante_texto: null,
    audio_id: null, parlantes: [], dispositivos: [],
  };
}

/** Protocolo de ejemplo: "0 s → app + correo · 60 s → Telegram jefe · 120 s → sirena + parlante · 180 s → policía". */
export function pasosSugeridos(): PasoProtocolo[] {
  return [
    { ...pasoVacio(1, 0), canales: ['APP', 'EMAIL', 'TELEGRAM'], mensaje: '{severidad} en {sede}: {titulo}. Reconozca aquí: {enlace}' },
    { ...pasoVacio(2, 60), canales: ['TELEGRAM', 'LLAMADA'], mensaje: 'Nadie ha reconocido la alarma de {sede}. {enlace}' },
    { ...pasoVacio(3, 60), canales: ['SIRENA', 'PARLANTE'], parlante_modo: 'TEXTO', parlante_texto: 'Atención: esta zona está siendo grabada y la policía va en camino.' },
    { ...pasoVacio(4, 60), canales: ['LLAMADA', 'TELEGRAM'], mensaje: 'Alarma sin atender en {sede} ({direccion}). Se solicita apoyo del cuadrante.' },
  ];
}

/**
 * Pasos de un protocolo de escalamiento, en orden. Cada paso espera `espera_seg` DESPUÉS
 * del anterior (el primero suele ser 0 = de inmediato) y avisa por sus canales. Arriba se
 * pinta la línea de tiempo acumulada para que se entienda de un vistazo:
 * "0 s → app + correo · 60 s → Telegram jefe · 120 s → sirena + parlante · 180 s → policía".
 */
@Component({
  selector: 'sg-editor-protocolo',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-protocolo.html',
  styleUrls: ['./editor-protocolo.css'],
})
export class EditorProtocolo {
  readonly pasos = model<PasoProtocolo[]>([]);
  readonly contactos = input<Contacto[]>([]);
  readonly parlantes = input<Parlante[]>([]);
  readonly dispositivos = input<Dispositivo[]>([]);
  readonly audios = input<Audio[]>([]);

  readonly canales = CANALES;
  readonly nombreCanal = NOMBRE_CANAL;
  readonly iconoCanal = ICONO_CANAL;
  readonly nombreAccion = NOMBRE_ACCION;
  readonly modosParlante: { valor: ModoParlante; texto: string }[] = [
    { valor: 'TEXTO', texto: 'Leer un texto (voz IA)' },
    { valor: 'DESCRIPCION_IA', texto: 'Describir a la persona de la captura (IA)' },
    { valor: 'AUDIO', texto: 'Reproducir un audio de la biblioteca' },
  ];
  readonly acciones: AccionDispositivo[] = ['ACTIVAR', 'DESACTIVAR', 'ABRIR', 'CERRAR', 'BLOQUEAR', 'DESBLOQUEAR', 'PULSO'];
  readonly variables = '{titulo} {sede} {severidad} {camara} {hora} {enlace} {direccion}';
  /** Texto pendiente del campo de roles de cada paso. */
  readonly borradorRol: Record<number, string> = {};

  readonly linea = computed(() => {
    let t = 0;
    return this.pasos().map((p, i) => {
      t += Math.max(0, Number(p.espera_seg) || 0);
      const quienes = p.contactos.map((id) => this.contactos().find((c) => c.id === id)?.nombre).filter(Boolean) as string[];
      const canales = p.canales.map((c) => NOMBRE_CANAL[c].toLowerCase());
      const texto = [canales.join(' + ') || 'sin canales', quienes.length ? quienes.slice(0, 2).join(', ') + (quienes.length > 2 ? '…' : '') : '']
        .filter(Boolean).join(' · ');
      return { i, t, etiqueta: t === 0 ? '0 s' : t < 60 ? `${t} s` : cronometro(t).replace(/:00$/, ' min'), texto };
    });
  });

  private actualizar(i: number, cambio: Partial<PasoProtocolo>): void {
    this.pasos.set(this.pasos().map((p, k) => (k === i ? { ...p, ...cambio } : p)));
  }
  private renumerar(l: PasoProtocolo[]): PasoProtocolo[] { return l.map((p, k) => ({ ...p, orden: k + 1 })); }

  campo<K extends keyof PasoProtocolo>(i: number, k: K, v: PasoProtocolo[K]): void { this.actualizar(i, { [k]: v } as Partial<PasoProtocolo>); }

  alternarCanal(i: number, c: Canal): void {
    const p = this.pasos()[i];
    const canales = p.canales.includes(c) ? p.canales.filter((x) => x !== c) : [...p.canales, c];
    const cambio: Partial<PasoProtocolo> = { canales };
    if (c === 'PARLANTE' && canales.includes('PARLANTE') && !p.parlante_modo) cambio.parlante_modo = 'TEXTO';
    this.actualizar(i, cambio);
  }

  usa(p: PasoProtocolo, ...cs: Canal[]): boolean { return cs.some((c) => p.canales.includes(c)); }

  agregar(): void {
    const l = this.pasos();
    this.pasos.set(this.renumerar([...l, pasoVacio(l.length + 1, l.length ? 60 : 0)]));
  }
  sugeridos(): void { this.pasos.set(pasosSugeridos()); }
  quitar(i: number): void { this.pasos.set(this.renumerar(this.pasos().filter((_, k) => k !== i))); }
  duplicar(i: number): void {
    const l = [...this.pasos()];
    l.splice(i + 1, 0, JSON.parse(JSON.stringify(l[i])) as PasoProtocolo);
    this.pasos.set(this.renumerar(l));
  }
  mover(i: number, d: -1 | 1): void {
    const j = i + d;
    const l = [...this.pasos()];
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    this.pasos.set(this.renumerar(l));
  }

  agregarRol(i: number, ev?: Event): void {
    ev?.preventDefault();
    const t = (this.borradorRol[i] ?? '').trim().toUpperCase();
    if (!t) return;
    const p = this.pasos()[i];
    if (!p.roles.includes(t)) this.actualizar(i, { roles: [...p.roles, t] });
    this.borradorRol[i] = '';
  }
  quitarRol(i: number, r: string): void { this.actualizar(i, { roles: this.pasos()[i].roles.filter((x) => x !== r) }); }

  agregarDispositivo(i: number): void {
    const p = this.pasos()[i];
    const d = this.dispositivos()[0];
    this.actualizar(i, { dispositivos: [...p.dispositivos, { id: d?.id ?? '', accion: 'ACTIVAR' }] });
  }
  cambiarDispositivo(i: number, k: number, cambio: Partial<{ id: string; accion: AccionDispositivo }>): void {
    const p = this.pasos()[i];
    this.actualizar(i, { dispositivos: p.dispositivos.map((d, j) => (j === k ? { ...d, ...cambio } : d)) });
  }
  quitarDispositivo(i: number, k: number): void {
    const p = this.pasos()[i];
    this.actualizar(i, { dispositivos: p.dispositivos.filter((_, j) => j !== k) });
  }

  nombreContacto(c: Contacto): string { return `${c.nombre}${c.tipo !== 'INTERNO' ? ` (${c.tipo.toLowerCase()})` : ''}`; }
}
