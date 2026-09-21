import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Cola, Servicio, Tiquete, Turno, TurnosService } from '../../service/turnos.service';
import { conectarSse, ConexionSse, tokenActual } from '../../service/sse.util';
import { etiquetaEstado } from '../../components/panel-atencion/panel-atencion';

/**
 * Recepción: la sala en vivo y emitir turnos a mano para quien no usó el QR ni el kiosco.
 * El tiquete se muestra grande para leerlo o imprimirlo en una impresora térmica.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-cola',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorOficina],
  templateUrl: './cola.html',
  styleUrls: ['../../styles/turnos-comun.css', './cola.css'],
})
export class ColaRecepcion implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private destroyRef = inject(DestroyRef);

  readonly cola = signal<Cola | null>(null);
  readonly servicios = signal<Servicio[]>([]);
  readonly canal = signal('cerrado');
  readonly ahora = signal(Date.now());
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly tiquete = signal<Tiquete | null>(null);

  form = { servicio_id: '', prioridad: 'NORMAL', documento: '', nombre: '', telefono: '', empresa_usuaria_nombre: '', observaciones: '' };

  private conexion: ConexionSse | null = null;
  private refresco: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.conectar(id));
    });
    const reloj = setInterval(() => this.ahora.set(Date.now()), 15000);
    this.destroyRef.onDestroy(() => { clearInterval(reloj); this.conexion?.cerrar(); });
  }

  ngOnInit(): void { this.ctx.cargar(); }

  emitir(): void {
    const id = this.ctx.oficinaId();
    if (!id || !this.form.servicio_id) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.api.emitirTurno(id, {
      servicio_id: this.form.servicio_id, prioridad: this.form.prioridad, canal: 'RECEPCION',
      documento: this.form.documento.trim() || null, nombre: this.form.nombre.trim() || null,
      telefono: this.form.telefono.trim() || null, empresa_usuaria_nombre: this.form.empresa_usuaria_nombre.trim() || null,
      observaciones: this.form.observaciones.trim() || null,
    }).subscribe({
      next: t => {
        this.tiquete.set(t);
        this.ocupado.set(false);
        this.form = { ...this.form, documento: '', nombre: '', telefono: '', observaciones: '' };
        this.recargar();
      },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo emitir el turno'); },
    });
  }

  cancelar(t: Turno): void {
    if (!confirm(`¿Cancelar el turno ${t.codigo}?`)) return;
    this.api.cancelarEnEspera(t.id, 'Cancelado en recepción').subscribe({ next: () => this.recargar(), error: () => this.recargar() });
  }

  imprimirTiquete(): void { window.print(); }

  estado(t: Turno): string { return etiquetaEstado(t.estado); }
  espera(t: Turno): string {
    const min = Math.max(0, Math.floor((this.ahora() - new Date(t.creado_en).getTime()) / 60000));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  }
  requiereDocumento(): boolean { return !!this.servicios().find(s => s.id === this.form.servicio_id)?.requiere_documento; }

  private conectar(oficinaId: string | null): void {
    this.conexion?.cerrar();
    this.conexion = null;
    if (!oficinaId) { this.cola.set(null); this.servicios.set([]); return; }
    this.api.servicios(oficinaId).subscribe({
      next: s => { this.servicios.set(s.filter(x => x.activo)); if (!this.form.servicio_id && s.length) this.form.servicio_id = s[0].id; },
      error: () => this.servicios.set([]),
    });
    this.recargar();
    const token = tokenActual();
    if (!token) return;
    this.conexion = conectarSse(this.api.urlEventosOficina(oficinaId), {
      token,
      onEstado: e => this.canal.set(e),
      onEvento: nombre => { if (nombre.startsWith('turno-') || nombre.startsWith('puesto-')) this.recargarPronto(); },
    });
  }

  private recargarPronto(): void {
    if (this.refresco) clearTimeout(this.refresco);
    this.refresco = setTimeout(() => this.recargar(), 250);
  }

  private recargar(): void {
    const id = this.ctx.oficinaId();
    if (!id) return;
    this.api.cola(id).subscribe({ next: c => this.cola.set(c), error: () => {} });
  }
}
