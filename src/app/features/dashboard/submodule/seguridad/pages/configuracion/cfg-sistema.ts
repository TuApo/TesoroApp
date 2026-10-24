import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { Sistema } from '../../models/seguridad.models';
import { SeguridadService } from '../../services/seguridad.service';
import { bytes, hace, num } from '../../utils/formato';

/**
 * Estado del sistema: la pasarela de video (MediaMTX), los workers de IA visual (con GPU o en
 * CPU, fps e inferencia), si hay GPU disponible y cuánto ocupan grabaciones y capturas. Se
 * relee cada 15 s mientras la pestaña está abierta.
 */
@Component({
  selector: 'sg-cfg-sistema',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as e) { <div class="sg-aviso danger"><mat-icon aria-hidden="true">error</mat-icon><span>{{ e }}</span></div> }
    @if (sistema(); as s) {
      <section class="sg-lecturas" aria-label="Estado del sistema">
        <div class="sg-lectura" [class.danger]="!s.video.en_linea">
          <span class="et">Pasarela de video</span><span class="va">{{ s.video.en_linea ? 'En línea' : 'Caída' }}</span>
          <span class="ay">{{ s.video.version ? 'MediaMTX ' + s.video.version : '' }}@if (s.video.rutas != null) { · {{ s.video.rutas }} rutas } @if (s.video.lectores != null) { · {{ s.video.lectores }} viendo }</span>
        </div>
        <div class="sg-lectura" [class.warn]="!s.gpu_disponible">
          <span class="et">GPU</span><span class="va">{{ s.gpu_disponible ? 'Disponible' : 'No' }}</span>
          <span class="ay">{{ s.gpu_disponible ? 'IA acelerada (CUDA)' : 'La IA corre en CPU, con menos fps' }}</span>
        </div>
        <div class="sg-lectura" [class.warn]="!enLinea()">
          <span class="et">Workers IA</span><span class="va">{{ enLinea() }}<small>/ {{ s.workers.length }}</small></span><span class="ay">en línea</span>
        </div>
        <div class="sg-lectura"><span class="et">Grabaciones</span><span class="va">{{ f.bytes(s.almacenamiento.grabaciones_bytes) }}</span>
          <span class="ay">capturas {{ f.bytes(s.almacenamiento.capturas_bytes) }}</span></div>
        <div class="sg-lectura" [class.danger]="pocoDisco(s)">
          <span class="et">Disco libre</span><span class="va">{{ f.bytes(s.almacenamiento.disco_libre_bytes) }}</span></div>
      </section>
      @if (s.video.mensaje) { <div class="sg-aviso warn"><mat-icon aria-hidden="true">info</mat-icon><span>{{ s.video.mensaje }}</span></div> }

      <section class="sg-tarjeta">
        <h3><mat-icon aria-hidden="true">memory</mat-icon>Workers de IA visual <span class="sg-sub">se actualiza cada 15 s</span></h3>
        <div class="sg-scroll-x">
          <table class="sg-tabla-simple">
            <thead><tr><th>Worker</th><th>Estado</th><th>Aceleración</th><th class="num">Cámaras</th><th class="num">fps</th><th class="num">Inferencia</th><th class="num">CPU</th><th class="num">Memoria</th><th>Versión</th></tr></thead>
            <tbody>
              @for (w of s.workers; track w.nombre) {
                <tr>
                  <td><b>{{ w.nombre }}</b><br /><small class="sg-tenue">{{ w.host ?? '' }}</small></td>
                  <td>@if (w.en_linea) { <span class="sg-chip ok">En línea</span> } @else { <span class="sg-chip danger" [title]="w.ultima_conexion ?? ''">{{ w.ultima_conexion ? f.hace(w.ultima_conexion) : 'Nunca' }}</span> }</td>
                  <td>{{ w.gpu || (w.proveedor ?? 'CPU') }}</td>
                  <td class="num">{{ w.camaras }}</td>
                  <td class="num">{{ f.num(w.fps, 1) }}</td>
                  <td class="num">{{ w.inferencia_ms != null ? f.num(w.inferencia_ms) + ' ms' : '—' }}</td>
                  <td class="num">{{ w.cpu != null ? f.num(w.cpu) + '%' : '—' }}</td>
                  <td class="num">{{ w.mem != null ? (w.mem > 100 ? f.bytes(w.mem) : f.num(w.mem) + '%') : '—' }}</td>
                  <td class="sg-mono">{{ w.version ?? '—' }}</td>
                </tr>
              } @empty { <tr><td colspan="9" class="sg-tenue">Ningún worker se ha registrado todavía.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
      @if (!s.gpu_disponible) {
        <p class="sg-nota">Sin GPU la analítica corre en CPU: deje 1–2 fps por cámara y active la IA solo donde haga falta. Con la GPU del servidor activa
          (driver NVIDIA + toolkit de contenedores) el worker la usa solo, sin cambiar nada aquí.</p>
      }
    } @else if (!error()) { <p class="sg-tenue">Cargando…</p> }
  `,
  styleUrls: ['../../styles/seguridad-comun.css', './configuracion.css'],
})
export class CfgSistema {
  private readonly api = inject(SeguridadService);
  readonly sistema = signal<Sistema | null>(null);
  readonly error = signal<string | null>(null);
  readonly f = { bytes, hace, num };

  constructor() {
    this.cargar();
    const t = setInterval(() => this.cargar(), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** Menos de 20 GB libres. */
  pocoDisco(s: Sistema): boolean { const l = s.almacenamiento.disco_libre_bytes; return l != null && l < 20 * 1024 ** 3; }

  enLinea(): number { return this.sistema()?.workers.filter((w) => w.en_linea).length ?? 0; }

  cargar(): void {
    this.api.sistema().subscribe({
      next: (s) => { this.sistema.set(s); this.error.set(null); },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudo leer el estado del sistema.')),
    });
  }
}
