import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import {
  TramiteEpsService, LineaTiempoEps, TramiteDetalle, EtapaTramite, DocumentoTramite,
} from '../../services/tramite-eps.service';

interface Paso { clave: string; titulo: string; estado: 'hecho' | 'curso' | 'pendiente' | 'mal'; detalle: string; }

const ETAPAS: { etapa: EtapaTramite; titulo: string; icono: string; ayuda: string }[] = [
  { etapa: 'REMISION', titulo: 'Remitido', icono: 'outgoing_mail', ayuda: 'Lo enviado a la EPS o al tramitador: correo, pantallazo de la plataforma, acuse.' },
  { etapa: 'RESPUESTA', titulo: 'Respuestas de la EPS', icono: 'mark_email_unread', ayuda: 'Requerimientos, observaciones o devoluciones. Pueden ser varias.' },
  { etapa: 'AFILIACION', titulo: 'Afiliación', icono: 'verified', ayuda: 'El certificado o soporte final de la afiliación.' },
];

/**
 * Control de la afiliación EPS de un contrato, en la ficha de Confirmación de Ingresos:
 * documento generado → remitido → respuestas de la EPS → afiliado, con VARIOS soportes por
 * etapa (van a gestión documental con la cédula) y todo el histórico.
 */
@Component({
  selector: 'app-tramite-eps-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressBarModule, MatSnackBarModule],
  templateUrl: './tramite-eps-panel.component.html',
  styleUrls: ['./tramite-eps-panel.component.css'],
})
export class TramiteEpsPanelComponent implements OnChanges {
  @Input({ required: true }) procesoId!: number;
  /** Avisa al padre (la tabla) que el trámite cambió, para refrescar el color de la fila. */
  @Output() cambio = new EventEmitter<number>();

  private svc = inject(TramiteEpsService);
  private snack = inject(MatSnackBar);

  readonly etapas = ETAPAS;
  linea = signal<LineaTiempoEps | null>(null);
  cargando = signal(false);
  trabajando = signal<string | null>(null);
  verHistorial = false;
  nota = '';
  radicado = '';
  avanzar = true;

  ngOnChanges() { this.cargar(); }

  cargar() {
    if (!this.procesoId) return;
    this.cargando.set(true);
    this.svc.lineaTiempo(this.procesoId).subscribe({
      next: l => { this.linea.set(l); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.snack.open('No se pudo cargar el trámite EPS', 'Cerrar', { duration: 4000 }); },
    });
  }

  get actual(): TramiteDetalle | null { return this.linea()?.tramites?.[0] ?? null; }

  /** Pasos del ciclo con su estado, para la línea de tiempo. */
  pasos(): Paso[] {
    const l = this.linea();
    const t = this.actual?.tramite;
    const docs = this.actual?.documentos ?? [];
    const n = (e: EtapaTramite) => docs.filter(d => d.etapa === e).length;
    const gen = l?.generaciones?.[0];
    const e = t?.estado;
    const orden = ['POR_ENVIAR', 'RADICADA', 'CON_RESPUESTA', 'CONFIRMADA'];
    const llego = (x: string) => !!e && e !== 'RECHAZADA' && orden.indexOf(e) >= orden.indexOf(x);
    return [
      { clave: 'gen', titulo: 'Documento generado', estado: gen ? 'hecho' : 'pendiente',
        detalle: gen ? `${this.fecha(gen.generadoAt)}${l!.generaciones.length > 1 ? ` · ${l!.generaciones.length} veces` : ''}` : 'aún no' },
      { clave: 'datos', titulo: 'Trámite abierto', estado: t ? 'hecho' : 'pendiente', detalle: t ? t.epsNombre : 'sin abrir' },
      { clave: 'rem', titulo: 'Remitido', estado: llego('RADICADA') ? 'hecho' : e === 'POR_ENVIAR' ? 'curso' : 'pendiente',
        detalle: t?.radicadoFecha ? `${this.fecha(t.radicadoFecha)}${t.radicadoNumero ? ' · No. ' + t.radicadoNumero : ''} · ${n('REMISION')} soporte(s)` : `${n('REMISION')} soporte(s)` },
      { clave: 'resp', titulo: 'Respuesta EPS', estado: e === 'CON_RESPUESTA' ? 'curso' : n('RESPUESTA') ? 'hecho' : 'pendiente',
        detalle: n('RESPUESTA') ? `${n('RESPUESTA')} respuesta(s)` : e === 'CON_RESPUESTA' ? 'registrada sin soporte' : 'ninguna' },
      { clave: 'afi', titulo: e === 'RECHAZADA' ? 'Rechazada' : 'Afiliado', estado: e === 'CONFIRMADA' ? 'hecho' : e === 'RECHAZADA' ? 'mal' : 'pendiente',
        detalle: e === 'CONFIRMADA' ? `${t?.confirmacionFecha ? this.fecha(t.confirmacionFecha) : ''} · ${n('AFILIACION')} soporte(s)`
          : e === 'RECHAZADA' ? (t?.rechazoMotivo || 'devuelta') : 'pendiente' },
    ];
  }

  etiquetaEstado(e?: string | null): string {
    return ({ POR_ENVIAR: 'Por remitir', RADICADA: 'Remitido', CON_RESPUESTA: 'Con respuesta de la EPS',
      CONFIRMADA: 'Afiliado', RECHAZADA: 'Rechazado' } as Record<string, string>)[e ?? ''] ?? (e || 'Sin trámite');
  }

  docsDe(etapa: EtapaTramite): DocumentoTramite[] {
    return (this.actual?.documentos ?? []).filter(d => d.etapa === etapa || (etapa === 'RESPUESTA' && d.etapa === 'OTRO'));
  }

  // ── acciones ─────────────────────────────────────────────────────────────

  iniciar() {
    this.trabajando.set('Abriendo el trámite…');
    this.svc.iniciar([this.procesoId]).subscribe({
      next: r => {
        this.trabajando.set(null);
        this.snack.open(r.ok ? 'Trámite abierto' : (r.detalles[0] || 'No se pudo abrir el trámite'), 'Cerrar', { duration: r.ok ? 3000 : 7000 });
        this.recargar();
      },
      error: err => { this.trabajando.set(null); this.error(err, 'No se pudo abrir el trámite'); },
    });
  }

  /** Varios archivos a una etapa: en tandas de hasta 12 MB; solo la primera mueve el estado. */
  async subir(etapa: EtapaTramite, ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    const t = this.actual?.tramite;
    if (!t || !archivos.length) return;
    const tandas = TramiteEpsService.tandas(archivos);
    let cargados = 0;
    const detalles: string[] = [];
    try {
      for (let i = 0; i < tandas.length; i++) {
        this.trabajando.set(`Subiendo ${archivos.length} archivo(s)… ${i + 1}/${tandas.length}`);
        const r = await firstValueFrom(this.svc.subir(t.id, etapa, tandas[i], this.nota || null, this.avanzar && i === 0));
        cargados += r.cargados;
        detalles.push(...r.detalles);
      }
      this.snack.open(`${cargados} de ${archivos.length} soporte(s) cargado(s)` + (detalles.length ? ` · ${detalles.join(' · ')}` : ''),
        'Cerrar', { duration: detalles.length ? 9000 : 4000 });
      this.nota = '';
    } catch (err) {
      this.error(err, 'No se pudieron subir los soportes');
    } finally {
      this.trabajando.set(null);
      this.recargar();
    }
  }

  /** Mueve el trámite sin archivo (la EPS respondió por teléfono, se registró en su plataforma…). */
  mover(etapa: EtapaTramite) {
    const t = this.actual?.tramite;
    if (!t) return;
    this.trabajando.set('Actualizando…');
    this.svc.mover(t.id, etapa, this.nota || null, etapa === 'REMISION' ? this.radicado : null).subscribe({
      next: () => { this.trabajando.set(null); this.nota = ''; this.radicado = ''; this.recargar(); },
      error: err => { this.trabajando.set(null); this.error(err, 'No se pudo actualizar el trámite'); },
    });
  }

  rechazar() {
    const t = this.actual?.tramite;
    const motivo = (this.nota || '').trim() || prompt('Motivo de la devolución de la EPS:')?.trim();
    if (!t || !motivo) return;
    this.svc.rechazar(t.id, motivo).subscribe({
      next: r => { if (!r.ok) this.snack.open(r.detalles[0] || 'No se pudo rechazar', 'Cerrar', { duration: 6000 }); this.nota = ''; this.recargar(); },
      error: err => this.error(err, 'No se pudo rechazar'),
    });
  }

  reabrir() {
    const t = this.actual?.tramite;
    if (!t) return;
    this.svc.reabrir(t.id, this.nota || null).subscribe({
      next: r => { if (!r.ok) this.snack.open(r.detalles[0] || 'No se pudo reabrir', 'Cerrar', { duration: 6000 }); this.nota = ''; this.recargar(); },
      error: err => this.error(err, 'No se pudo reabrir'),
    });
  }

  ver(d: DocumentoTramite) {
    this.svc.descargar(d.id).subscribe({
      next: blob => { const url = URL.createObjectURL(blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60_000); },
      error: err => this.error(err, 'No se pudo abrir el soporte'),
    });
  }

  private recargar() { this.cargar(); this.cambio.emit(this.procesoId); }

  private error(err: unknown, porDefecto: string) {
    const e = (err as { error?: { error?: string } })?.error?.error;
    this.snack.open(e || porDefecto, 'Cerrar', { duration: 7000 });
  }

  fecha(s: string | null | undefined): string {
    if (!s) return '';
    const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + (s.length > 10 ? ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '');
  }

  peso(b: number | null): string {
    if (!b) return '';
    return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  }
}
