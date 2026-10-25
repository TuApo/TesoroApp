import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  AppInstalada, Comando, Cuenta, DeviceManagementService, Dispositivo, EventoMon,
  Geocerca, Politica, Tablero, Telemetria, TipoComando, Ubicacion,
} from '../../device-management.service';

/**
 * Consola de Gestión de Equipos (panel de flota). Supervisión TRANSPARENTE: cada acción
 * administrativa (localizar, alarma, bloquear, mensaje, respaldo, borrado corporativo) es
 * VISIBLE en el dispositivo del colaborador. El panel no expone —porque el backend no la
 * tiene— ninguna captura ambiental de micrófono/cámara ni lectura de contenido privado.
 */
@Component({
  selector: 'app-dm-consola',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTabsModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './consola.component.html',
  styleUrls: ['./consola.component.css'],
})
export class ConsolaComponent {
  private api = inject(DeviceManagementService);
  private snack = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);

  cargando = signal(true);
  cuenta = signal<Cuenta | null>(null);
  tablero = signal<Tablero | null>(null);
  flota = signal<Dispositivo[]>([]);
  politicas = signal<Politica[]>([]);
  geocercas = signal<Geocerca[]>([]);
  alertas = signal<EventoMon[]>([]);

  // Detalle del dispositivo seleccionado
  sel = signal<Dispositivo | null>(null);
  selTelemetria = signal<Telemetria | null>(null);
  selApps = signal<AppInstalada[]>([]);
  selUbicaciones = signal<Ubicacion[]>([]);
  selComandos = signal<Comando[]>([]);
  selEventos = signal<EventoMon[]>([]);

  // Alta de dispositivo
  nuevoEtiqueta = signal('');
  nuevoPlataforma = signal('ANDROID');
  pinReciente = signal<{ etiqueta: string; pin: string; expira: string } | null>(null);

  // Alta de geocerca
  gNombre = signal(''); gLat = signal<number | null>(null); gLon = signal<number | null>(null);
  gRadio = signal<number>(300); gTipo = signal('PERMITIDA');

  // Alta de política
  pNombre = signal(''); pBloqueadas = signal(''); pBloqueo = signal(true); pCifrado = signal(true);

  readonly comandosAntirobo: { tipo: TipoComando; label: string; icon: string; critico?: boolean }[] = [
    { tipo: 'LOCALIZAR', label: 'Localizar', icon: 'my_location' },
    { tipo: 'ALARMA', label: 'Sonar alarma', icon: 'volume_up' },
    { tipo: 'BLOQUEAR', label: 'Bloquear', icon: 'lock' },
    { tipo: 'DESBLOQUEAR', label: 'Desbloquear', icon: 'lock_open' },
    { tipo: 'MENSAJE', label: 'Mensaje', icon: 'sms' },
    { tipo: 'RESPALDAR', label: 'Respaldar', icon: 'cloud_upload' },
    { tipo: 'WIPE_CORP', label: 'Borrado corporativo', icon: 'delete_forever', critico: true },
  ];

  mapaUrl = computed<SafeResourceUrl | null>(() => {
    const u = this.sel()?.ultima_ubicacion;
    if (!u) return null;
    const d = 0.01;
    const bbox = `${u.lon - d},${u.lat - d},${u.lon + d},${u.lat + d}`;
    const url = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${u.lat},${u.lon}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  cupoTexto = computed(() => {
    const c = this.cuenta();
    return c ? `${c.dispositivos_usados}/${c.max_dispositivos}` : '—';
  });

  ngOnInit(): void { this.recargar(); }

  recargar(): void {
    this.cargando.set(true);
    this.api.cuenta().subscribe({ next: c => this.cuenta.set(c), error: () => {} });
    this.api.tablero().subscribe({ next: t => this.tablero.set(t), error: () => {} });
    this.api.politicas().subscribe({ next: p => this.politicas.set(p), error: () => {} });
    this.api.geocercas().subscribe({ next: g => this.geocercas.set(g), error: () => {} });
    this.api.alertas().subscribe({ next: a => this.alertas.set(a), error: () => {} });
    this.api.flota().subscribe({
      next: f => { this.flota.set(f); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.toast('No se pudo cargar la flota'); },
    });
  }

  // ── Alta de dispositivo ────────────────────────────────────────────────
  crearDispositivo(): void {
    const etiqueta = this.nuevoEtiqueta().trim();
    if (!etiqueta) { this.toast('Pon una etiqueta'); return; }
    this.api.crear({ etiqueta, plataforma: this.nuevoPlataforma() }).subscribe({
      next: d => {
        this.pinReciente.set({ etiqueta: d.etiqueta, pin: d.pin_enrolamiento, expira: d.pin_expira_en });
        this.nuevoEtiqueta.set('');
        this.recargar();
      },
      error: e => this.toast(e?.error?.message || 'No se pudo crear (¿límite de licencia?)'),
    });
  }

  // ── Selección / detalle ────────────────────────────────────────────────
  seleccionar(d: Dispositivo): void {
    this.sel.set(d);
    this.selTelemetria.set(null); this.selApps.set([]); this.selUbicaciones.set([]);
    this.selComandos.set([]); this.selEventos.set([]);
    this.api.telemetria(d.id).subscribe({ next: t => this.selTelemetria.set(t), error: () => {} });
    this.api.apps(d.id).subscribe({ next: a => this.selApps.set(a), error: () => {} });
    this.api.ubicaciones(d.id).subscribe({ next: u => this.selUbicaciones.set(u), error: () => {} });
    this.api.comandos(d.id).subscribe({ next: c => this.selComandos.set(c), error: () => {} });
    this.api.eventos(d.id).subscribe({ next: ev => this.selEventos.set(ev), error: () => {} });
  }
  cerrarDetalle(): void { this.sel.set(null); }

  // ── Comandos anti-robo ─────────────────────────────────────────────────
  comando(tipo: TipoComando): void {
    const d = this.sel(); if (!d) return;
    let payload: Record<string, unknown> | undefined;
    if (tipo === 'MENSAJE') {
      const texto = window.prompt('Mensaje a mostrar en el equipo:');
      if (!texto) return;
      payload = { texto };
    }
    if (tipo === 'WIPE_CORP' && !window.confirm(
      'Esto borrará los DATOS CORPORATIVOS del equipo (perfil de trabajo). El colaborador lo verá. ¿Continuar?')) return;
    this.api.emitirComando(d.id, tipo, payload).subscribe({
      next: () => { this.toast(`Comando ${tipo} enviado (visible en el equipo)`); this.seleccionar(d); this.recargar(); },
      error: () => this.toast('No se pudo enviar el comando'),
    });
  }

  retirar(d: Dispositivo): void {
    if (!window.confirm(`¿Retirar "${d.etiqueta}" de la flota?`)) return;
    this.api.retirar(d.id).subscribe({ next: () => { this.cerrarDetalle(); this.recargar(); }, error: () => this.toast('No se pudo retirar') });
  }

  // ── Geocercas ──────────────────────────────────────────────────────────
  crearGeocerca(): void {
    if (this.gLat() == null || this.gLon() == null) { this.toast('Pon lat y lon'); return; }
    this.api.crearGeocerca({
      nombre: this.gNombre() || 'Zona', centro_lat: this.gLat()!, centro_lon: this.gLon()!,
      radio_m: this.gRadio(), tipo: this.gTipo(),
    }).subscribe({ next: () => { this.gNombre.set(''); this.gLat.set(null); this.gLon.set(null); this.cargarGeocercas(); }, error: () => this.toast('No se pudo crear la geocerca') });
  }
  eliminarGeocerca(g: Geocerca): void {
    this.api.eliminarGeocerca(g.id).subscribe({ next: () => this.cargarGeocercas(), error: () => this.toast('No se pudo eliminar') });
  }
  private cargarGeocercas(): void { this.api.geocercas().subscribe({ next: g => this.geocercas.set(g) }); }

  // ── Políticas ──────────────────────────────────────────────────────────
  crearPolitica(): void {
    const apps = this.pBloqueadas().split(',').map(s => s.trim()).filter(Boolean);
    this.api.crearPolitica({
      nombre: this.pNombre() || 'Política', apps_bloqueadas: apps,
      requiere_bloqueo: this.pBloqueo(), requiere_cifrado: this.pCifrado(),
    }).subscribe({ next: () => { this.pNombre.set(''); this.pBloqueadas.set(''); this.api.politicas().subscribe(p => this.politicas.set(p)); }, error: () => this.toast('No se pudo crear la política') });
  }
  asignarPolitica(d: Dispositivo, politicaId: string): void {
    if (!politicaId) return;
    this.api.asignarPolitica(d.id, politicaId).subscribe({ next: () => this.toast('Política asignada (se aplica en el próximo sync)'), error: () => this.toast('No se pudo asignar') });
  }

  // ── Alertas ────────────────────────────────────────────────────────────
  marcarVisto(e: EventoMon): void {
    this.api.marcarVisto(e.id).subscribe({ next: () => this.alertas.set(this.alertas().filter(x => x.id !== e.id)), error: () => {} });
  }

  severidadClase(sev: string): string {
    switch (sev) { case 'CRITICO': return 'sev-critico'; case 'ALERTA': return 'sev-alerta'; case 'AVISO': return 'sev-aviso'; default: return 'sev-info'; }
  }
  private toast(m: string): void { this.snack.open(m, 'OK', { duration: 3500 }); }
}
