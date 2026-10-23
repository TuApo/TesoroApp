import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import {
  AltaAgente, DiscoR, EquipoVista, ResumenUbicaciones, RespaldoVista, UbicacionVista,
} from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { bps, bytes, duracion, hace, hora, num, pct } from '../../utils/formato';

type SistemaInstalacion = 'linux' | 'windows' | 'kubernetes';

/**
 * Infraestructura distribuida: cada ubicación (sede, datacenter, nube) con sus equipos y
 * clústeres, su salud y sus respaldos. La principal se arma sola con lo que ms-infra ve; las
 * remotas informan con el agente TuApo (solo conexiones salientes, token propio por equipo).
 */
@Component({
  selector: 'app-infra-ubicaciones',
  standalone: true,
  imports: [MatIconModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ubicaciones.html',
  styleUrls: ['../../styles/infra-comun.css', './ubicaciones.css'],
})
export class InfraUbicaciones {
  private readonly api = inject(InfraService);
  readonly f = { bps, bytes, duracion, hace, hora, num, pct };

  readonly datos = signal<ResumenUbicaciones | null>(null);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal(false);
  readonly aviso = signal<string | null>(null);

  /** Formulario de ubicación: null = cerrado; id vacío = nueva. */
  readonly formUbicacion = signal<{ id: string; nombre: string; tipo: string; ciudad: string; notas: string } | null>(null);
  /** Formulario de equipo nuevo dentro de una ubicación. */
  readonly formEquipo = signal<{ ubicacionId: string; nombre: string; tipo: 'servidor' | 'cluster'; descripcion: string } | null>(null);
  /** Alta recién hecha: el token se ve UNA vez, aquí. */
  readonly alta = signal<AltaAgente | null>(null);
  readonly sistema = signal<SistemaInstalacion>('linux');
  readonly respaldosInstalacion = signal('');
  readonly chequeosInstalacion = signal('');
  readonly copiado = signal<string | null>(null);

  readonly elegido = signal<string | null>(null);
  /** Acción destructiva esperando el segundo clic: "borrar:<id>", "token:<id>", "ubicacion:<id>". */
  readonly confirmando = signal<string | null>(null);

  readonly lista = computed(() => this.datos()?.lista ?? []);
  readonly remotas = computed(() => this.lista().filter((u) => !u.principal));
  readonly detalle = computed(() => {
    const id = this.elegido();
    if (!id) return null;
    for (const u of this.lista()) {
      const e = u.equipos_detalle.find((x) => x.id === id);
      if (e) return { equipo: e, ubicacion: u };
    }
    return null;
  });

  readonly comandos = computed(() => {
    const a = this.alta();
    if (!a) return null;
    const central = a.central_url.replace(/\/$/, '');
    const extras: [string, string][] = [];
    if (this.respaldosInstalacion().trim()) extras.push(['AGENTE_RESPALDOS', this.unir(this.respaldosInstalacion())]);
    if (this.chequeosInstalacion().trim()) extras.push(['AGENTE_CHEQUEOS', this.unir(this.chequeosInstalacion())]);
    const sh = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    const ps = (v: string) => `'${v.replace(/'/g, "''")}'`;
    const base = `${central}/api/v1/public/infra/agente/archivos`;
    const nombreK8s = a.agente.nombre.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'mi-cluster';
    return {
      linux: `curl -fsSL ${base}/instalar.sh | sudo AGENTE_TOKEN=${sh(a.token)} CENTRAL_URL=${sh(central)}`
        + extras.map(([k, v]) => ` ${k}=${sh(v)}`).join('') + ' bash',
      windows: `$env:AGENTE_TOKEN=${ps(a.token)}; $env:CENTRAL_URL=${ps(central)}; `
        + extras.map(([k, v]) => `$env:${k}=${ps(v)}; `).join('') + `irm ${base}/instalar.ps1 | iex`,
      kubernetes: [
        'kubectl create namespace tuapo-agente',
        `kubectl -n tuapo-agente create secret generic agente-infra --from-literal=AGENTE_TOKEN=${sh(a.token)}`,
        `curl -fsSLO ${base}/agente_infra.py && curl -fsSLO ${base}/kubernetes.yaml`,
        'kubectl -n tuapo-agente create configmap agente-infra --from-file=agente_infra.py',
        `sed -i 's/mi-cluster/${nombreK8s}/; s#https://api.tuapo.co#${central}#' kubernetes.yaml && kubectl apply -f kubernetes.yaml`,
      ].join('\n'),
    };
  });

  constructor() {
    this.cargar();
    const t = setInterval(() => this.cargar(), 20_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  cargar() {
    this.api.ubicaciones().subscribe({
      next: (d) => { this.datos.set(d); this.error.set(null); },
      error: () => this.error.set('No se pudieron leer las ubicaciones. Reintentando cada 20 s.'),
    });
  }

  // ── Ubicaciones ───────────────────────────────────────────────────────────

  nuevaUbicacion() {
    this.formUbicacion.set({ id: '', nombre: '', tipo: 'oficina', ciudad: '', notas: '' });
  }

  editarUbicacion(u: UbicacionVista) {
    this.formUbicacion.set({ id: u.ubicacion.id, nombre: u.ubicacion.nombre, tipo: u.ubicacion.tipo, ciudad: u.ubicacion.ciudad ?? '', notas: u.ubicacion.notas ?? '' });
  }

  guardarUbicacion() {
    const f = this.formUbicacion();
    if (!f || !f.nombre.trim()) return;
    const cuerpo = { nombre: f.nombre.trim(), tipo: f.tipo, ciudad: f.ciudad.trim(), notas: f.notas.trim() };
    this.ocupado.set(true);
    (f.id ? this.api.editarUbicacion(f.id, cuerpo) : this.api.crearUbicacion(cuerpo)).subscribe({
      next: () => { this.formUbicacion.set(null); this.listo(f.id ? 'Ubicación actualizada.' : 'Ubicación creada: agrégale sus equipos.'); },
      error: (e) => this.falla(e),
    });
  }

  borrarUbicacion(u: UbicacionVista) {
    if (!this.segundoClic(`ubicacion:${u.ubicacion.id}`)) return;
    this.ocupado.set(true);
    this.api.borrarUbicacion(u.ubicacion.id).subscribe({ next: () => this.listo('Ubicación borrada.'), error: (e) => this.falla(e) });
  }

  // ── Equipos ───────────────────────────────────────────────────────────────

  nuevoEquipo(u: UbicacionVista) {
    this.formEquipo.set({ ubicacionId: u.ubicacion.id, nombre: '', tipo: 'servidor', descripcion: '' });
  }

  crearEquipo() {
    const f = this.formEquipo();
    if (!f || !f.nombre.trim()) return;
    this.ocupado.set(true);
    this.api.crearAgente(f.ubicacionId, { nombre: f.nombre.trim(), tipo: f.tipo, descripcion: f.descripcion.trim() }).subscribe({
      next: (a) => { this.formEquipo.set(null); this.mostrarAlta(a); this.listo(null); },
      error: (e) => this.falla(e),
    });
  }

  regenerar(e: EquipoVista) {
    if (!this.segundoClic(`token:${e.id}`)) return;
    this.ocupado.set(true);
    this.api.regenerarToken(e.id).subscribe({ next: (a) => { this.mostrarAlta(a); this.listo(null); }, error: (x) => this.falla(x) });
  }

  alternarActivo(e: EquipoVista) {
    this.ocupado.set(true);
    this.api.editarAgente(e.id, { activo: !e.activo }).subscribe({
      next: () => this.listo(e.activo ? 'Equipo desactivado: su token deja de servir hasta reactivarlo.' : 'Equipo reactivado.'),
      error: (x) => this.falla(x),
    });
  }

  borrarEquipo(e: EquipoVista) {
    if (!this.segundoClic(`borrar:${e.id}`)) return;
    this.ocupado.set(true);
    this.api.borrarAgente(e.id).subscribe({
      next: () => { this.elegido.set(null); this.listo('Equipo borrado. Desinstala también su agente.'); },
      error: (x) => this.falla(x),
    });
  }

  private mostrarAlta(a: AltaAgente) {
    this.alta.set(a);
    this.sistema.set(a.agente.tipo === 'cluster' ? 'kubernetes' : 'linux');
    this.respaldosInstalacion.set('');
    this.chequeosInstalacion.set('');
    this.copiado.set(null);
  }

  cerrarAlta() {
    this.alta.set(null);
  }

  copiar(texto: string, clave: string) {
    navigator.clipboard?.writeText(texto).then(() => {
      this.copiado.set(clave);
      setTimeout(() => this.copiado.set(null), 2500);
    });
  }

  // ── Ayudas de la plantilla ────────────────────────────────────────────────

  tonoUbicacion(u: UbicacionVista): string {
    return u.estado === 'ok' ? 'ok' : u.estado === 'critico' ? 'danger' : u.estado === 'atencion' ? 'warn' : 'neutro';
  }

  iconoUbicacion(tipo: string): string {
    return ({ oficina: 'apartment', datacenter: 'dns', nube: 'cloud', otro: 'place' } as Record<string, string>)[tipo] ?? 'place';
  }

  iconoEquipo(e: EquipoVista): string {
    if (e.tipo === 'cluster') return 'hub';
    if (e.tipo === 'nodo-k3s') return 'device_hub';
    if (e.tipo === 'almacenamiento') return 'sd_storage';
    return 'dns';
  }

  /** Texto y tono del estado de un equipo (agente o local). */
  estadoEquipo(e: EquipoVista): { texto: string; tono: string; icono: string } {
    if (e.origen === 'local') {
      const m: Record<string, { texto: string; tono: string; icono: string }> = {
        ok: { texto: 'Bien', tono: 'ok', icono: 'check_circle' },
        atencion: { texto: 'Atención', tono: 'warn', icono: 'warning' },
        critico: { texto: e.reporte?.cpu_pct == null ? 'No responde' : 'Crítico', tono: 'danger', icono: 'error' },
      };
      return m[e.estado] ?? { texto: 'Sin datos', tono: 'neutro', icono: 'help' };
    }
    const cuando = e.ultimo_reporte ? hace(e.ultimo_reporte) : '';
    switch (e.estado) {
      case 'en-linea': return { texto: `En línea · ${cuando}`, tono: e.salud === 'critico' ? 'danger' : e.salud === 'atencion' ? 'warn' : 'ok', icono: 'wifi' };
      case 'atrasado': return { texto: `Atrasado · ${cuando}`, tono: 'warn', icono: 'schedule' };
      case 'caido': return { texto: `Sin reportar · ${cuando}`, tono: 'danger', icono: 'wifi_off' };
      case 'nunca': return { texto: 'Falta instalar el agente', tono: 'neutro', icono: 'download' };
      case 'inactivo': return { texto: 'Desactivado', tono: 'neutro', icono: 'block' };
      default: return { texto: e.estado, tono: 'neutro', icono: 'help' };
    }
  }

  memPct(e: EquipoVista): number | null {
    const r = e.reporte;
    return r?.mem_total && r.mem_usada != null ? (100 * r.mem_usada) / r.mem_total : null;
  }

  usoDisco(d: DiscoR): number | null {
    return d.total && d.libre != null ? (100 * (d.total - d.libre)) / d.total : null;
  }

  /** El disco más lleno del equipo (para la fila de la lista). */
  peorDisco(e: EquipoVista): { montaje: string; pct: number } | null {
    let peor: { montaje: string; pct: number } | null = null;
    for (const d of e.reporte?.discos ?? []) {
      const p = this.usoDisco(d);
      if (p != null && (!peor || p > peor.pct)) peor = { montaje: d.montaje ?? '?', pct: p };
    }
    return peor;
  }

  tonoPct(p: number | null | undefined, aviso = 85, grave = 95): string {
    return p == null ? '' : p >= grave ? 'danger' : p >= aviso ? 'warn' : 'ok';
  }

  estadoRespaldo(r: RespaldoVista): { texto: string; tono: string; icono: string } {
    switch (r.estado) {
      case 'al-dia': return { texto: 'Al día', tono: 'ok', icono: 'verified' };
      case 'vencido': return { texto: 'Vencido', tono: 'danger', icono: 'history' };
      case 'fallo': return { texto: 'Falló', tono: 'danger', icono: 'error' };
      default: return { texto: 'Sin datos', tono: 'warn', icono: 'help' };
    }
  }

  horas(h: number | null | undefined): string {
    if (h == null) return '—';
    return h < 48 ? `${num(h, h < 10 ? 1 : 0)} h` : `${num(h / 24, 0)} días`;
  }

  idEquipo = (e: EquipoVista) => e.id;

  // ── Internos ──────────────────────────────────────────────────────────────

  private unir(texto: string): string {
    return texto.split(/\n+/).map((l) => l.trim()).filter((l) => !!l).join(';');
  }

  private segundoClic(clave: string): boolean {
    if (this.confirmando() === clave) {
      this.confirmando.set(null);
      return true;
    }
    this.confirmando.set(clave);
    setTimeout(() => { if (this.confirmando() === clave) this.confirmando.set(null); }, 5000);
    return false;
  }

  private listo(mensaje: string | null) {
    this.ocupado.set(false);
    this.aviso.set(mensaje);
    if (mensaje) setTimeout(() => { if (this.aviso() === mensaje) this.aviso.set(null); }, 6000);
    this.cargar();
  }

  private falla(e: { error?: { message?: string; detail?: string }; status?: number }) {
    this.ocupado.set(false);
    this.aviso.set(`No se pudo: ${e?.error?.message ?? e?.error?.detail ?? 'error ' + (e?.status ?? '')}`);
  }
}
