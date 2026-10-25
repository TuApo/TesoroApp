import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgenteService, ComandoOut } from './agente.service';

/**
 * AGENTE DE SUPERVISIÓN (dispositivo). Pensado para correr en el APK (Capacitor) del equipo
 * corporativo. Es TRANSPARENTE por diseño:
 *  - Muestra SIEMPRE un indicador visible de "equipo supervisado".
 *  - En el primer arranque pide aceptar el aviso de supervisión (consentimiento).
 *  - Reporta sólo METADATOS (batería, red, almacenamiento, ubicación) con APIs del WebView.
 *  - Ejecuta sólo comandos VISIBLES (mensaje, alarma, bloqueo con overlay, localizar).
 *
 * NO hay captura de micrófono/cámara ambiental, contenido de mensajes ni keylogging: no se
 * solicitan esos permisos ni existen en el backend. El inventario de apps y la detección de
 * SIM/Device-Owner requieren un plugin NATIVO (ver AGENTE-ANDROID-NATIVO.md); este agente web
 * cubre el resto y degrada con elegancia.
 */
@Component({
  selector: 'app-agente-supervision',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './agente-supervision.component.html',
  styleUrls: ['./agente-supervision.component.css'],
})
export class AgenteSupervisionComponent implements OnInit, OnDestroy {
  private api = inject(AgenteService);
  private readonly KEY = 'dm_agente_token';
  private readonly KEY_CONSENT = 'dm_agente_consent';
  private timer: any = null;

  fase = signal<'enrolar' | 'consentimiento' | 'activo'>('enrolar');
  pin = signal('');
  nombre = signal('');
  aviso = signal('');
  avisoVersion = signal(1);
  token = signal<string | null>(null);
  estado = signal('');
  ultimoReporte = signal('');

  // Overlay de comando visible (bloqueo / mensaje / alarma)
  overlay = signal<{ tipo: string; texto: string } | null>(null);

  readonly avisoPorDefecto =
    'Este equipo es corporativo y está gestionado por tu empresa de forma transparente. ' +
    'Se registran metadatos de estado y ubicación con fines de protección del activo y los ' +
    'datos corporativos. Nunca se accede al micrófono, la cámara ambiental ni al contenido de ' +
    'tus mensajes. La app es visible y desinstalable por los canales normales.';

  ngOnInit(): void {
    const t = this.lsGet(this.KEY);
    if (t) {
      this.token.set(t);
      if (this.lsGet(this.KEY_CONSENT)) { this.fase.set('activo'); this.iniciarCiclo(); }
      else this.fase.set('consentimiento');
    }
  }
  ngOnDestroy(): void { if (this.timer) clearInterval(this.timer); }

  // ── Enrolamiento ───────────────────────────────────────────────────────
  enrolar(): void {
    const pin = this.pin().trim().toUpperCase();
    if (!pin) { this.estado.set('Escribe el PIN que te dio tu empresa'); return; }
    this.estado.set('Enrolando…');
    this.api.enrolar(pin, this.infoDispositivo()).subscribe({
      next: r => {
        this.token.set(r.token); this.lsSet(this.KEY, r.token);
        this.aviso.set(r.aviso_supervision); this.avisoVersion.set(r.consentimiento_version);
        this.fase.set('consentimiento'); this.estado.set('');
      },
      error: e => this.estado.set(e?.error?.message || 'No se pudo enrolar (¿PIN correcto/vigente?)'),
    });
  }

  // ── Consentimiento ───────────────────────────────────────────────────────
  aceptar(): void {
    const t = this.token(); if (!t) return;
    this.api.consentimiento(t, this.avisoVersion(), this.nombre() || 'Colaborador').subscribe({
      next: () => { this.lsSet(this.KEY_CONSENT, '1'); this.fase.set('activo'); this.iniciarCiclo(); },
      error: () => this.estado.set('No se pudo registrar el consentimiento'),
    });
  }
  rechazar(): void {
    // El equipo es corporativo: si no se acepta, el agente no reporta, pero el indicador y la
    // info quedan visibles. No se oculta nada.
    this.estado.set('Debes aceptar la supervisión para usar este equipo corporativo.');
  }

  // ── Ciclo de reporte + comandos ───────────────────────────────────────────
  private iniciarCiclo(): void {
    this.reportar();
    this.timer = setInterval(() => this.reportar(), 60000);
  }

  private async reportar(): Promise<void> {
    const t = this.token(); if (!t) return;
    try {
      const tele = await this.telemetriaWeb();
      this.api.telemetria(t, tele).subscribe({ error: () => {} });
      const loc = await this.ubicacionWeb();
      if (loc) this.api.ubicacion(t, loc).subscribe({ error: () => {} });
      this.ultimoReporte.set(new Date().toLocaleTimeString());
    } catch { /* degradar en silencio */ }
    this.api.comandos(t).subscribe({ next: cmds => cmds.forEach(c => this.ejecutar(c)), error: () => {} });
  }

  private ejecutar(c: ComandoOut): void {
    const t = this.token(); if (!t) return;
    let texto = '';
    try { if (c.payload_json) texto = (JSON.parse(c.payload_json).texto) || ''; } catch {}
    switch (c.tipo) {
      case 'MENSAJE': this.overlay.set({ tipo: 'Mensaje de tu empresa', texto: texto || 'Mensaje administrativo' }); break;
      case 'ALARMA': this.sonarAlarma(); this.overlay.set({ tipo: '🔊 Alarma', texto: 'Alarma activada por tu empresa' }); break;
      case 'BLOQUEAR': this.overlay.set({ tipo: '🔒 Equipo bloqueado', texto: texto || 'Bloqueado por tu empresa. Contacta a soporte.' }); break;
      case 'DESBLOQUEAR': this.overlay.set(null); break;
      case 'LOCALIZAR': this.ubicacionWeb().then(l => { if (l) this.api.ubicacion(t, l).subscribe({ error: () => {} }); }); break;
      default: break; // RESPALDAR/WIPE_CORP/SINCRONIZAR/APLICAR_POLITICA: requieren plugin nativo
    }
    this.api.resultado(t, c.id, 'EJECUTADO', { via: 'agente-web' }).subscribe({ error: () => {} });
  }

  cerrarOverlay(): void { this.overlay.set(null); }

  // ── Recolección con APIs del WebView (sin plugins nuevos) ─────────────────
  private infoDispositivo(): Record<string, unknown> {
    const ua = navigator.userAgent || '';
    return { plataforma: 'ANDROID', modelo: this.modeloDeUA(ua), fabricante: '', os_version: '', serie: '' };
  }
  private modeloDeUA(ua: string): string {
    const m = ua.match(/;\s?([^;)]+)\s?Build/); return m ? m[1].trim() : (ua.slice(0, 60));
  }
  private async telemetriaWeb(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    try {
      const b: any = await (navigator as any).getBattery?.();
      if (b) { out['bateria_pct'] = Math.round(b.level * 100); out['cargando'] = !!b.charging; }
    } catch {}
    try {
      const est: any = await (navigator as any).storage?.estimate?.();
      if (est) { out['almacen_libre_mb'] = Math.round(((est.quota || 0) - (est.usage || 0)) / 1048576); out['almacen_total_mb'] = Math.round((est.quota || 0) / 1048576); }
    } catch {}
    const conn: any = (navigator as any).connection;
    out['red_tipo'] = navigator.onLine ? (conn?.type === 'wifi' ? 'WIFI' : 'MOVIL') : 'NINGUNA';
    return out;
  }
  private ubicacionWeb(): Promise<Record<string, unknown> | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy || 0), origen: 'GPS' }),
        () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });
  }

  private sonarAlarma(): void {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      o.start(); g.gain.setValueAtTime(0.3, ctx.currentTime);
      setTimeout(() => { o.stop(); ctx.close(); }, 2500);
    } catch {}
  }

  private lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
  private lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch {} }
}
