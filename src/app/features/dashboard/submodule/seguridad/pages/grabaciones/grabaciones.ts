import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { abrirFormulario } from '../../components/dialogos/formulario-dialogo';
import { VisorCamara } from '../../components/visor-camara/visor-camara';
import { Camara, Clip, FuenteReproduccion, Grabaciones, Reproduccion } from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService, urlApi } from '../../services/seguridad.service';
import { cronometro, descargarBlob, fechaHora, hoyInput, horaCorta, isoLocal } from '../../utils/formato';

interface Segmento { inicio: Date; fin: Date; izq: number; ancho: number; duracion: number; }

/**
 * Grabaciones: elegir cámara y día, ver en la línea de 24 h qué hay grabado en el servidor
 * central (y si el DVR permite reproducir lo suyo), reproducir desde un momento, descargar
 * un clip en MP4 y guardarlo en la lista de clips (queda auditado).
 */
@Component({
  selector: 'app-seguridad-grabaciones',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, VisorCamara, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './grabaciones.html',
  styleUrls: ['../../styles/seguridad-comun.css', './grabaciones.css'],
})
export class SeguridadGrabaciones {
  private readonly api = inject(SeguridadService);
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly route = inject(ActivatedRoute);

  readonly camaras = signal<Camara[]>([]);
  readonly camaraId = signal<string | null>(null);
  readonly dia = signal(hoyInput());
  readonly grabaciones = signal<Grabaciones | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  /** Momento elegido en la línea (minutos desde las 00:00). */
  readonly minuto = signal(0);
  readonly duracionMin = signal(10);
  readonly fuente = signal<FuenteReproduccion>('CENTRAL');
  readonly reproduccion = signal<Reproduccion | null>(null);
  readonly descargando = signal(false);

  readonly clips = signal<Clip[]>([]);
  readonly cargandoClips = signal(false);

  readonly f = { fechaHora, horaCorta, cronometro };
  readonly marcas = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  readonly duraciones = [1, 2, 5, 10, 15, 30];

  readonly camara = computed(() => this.camaras().find((c) => c.id === this.camaraId()) ?? null);
  readonly inicioDia = computed(() => new Date(`${this.dia()}T00:00:00`));
  readonly segmentos = computed<Segmento[]>(() => {
    const g = this.grabaciones();
    const d0 = this.inicioDia().getTime();
    const d1 = d0 + 86_400_000;
    return (g?.central ?? []).map((s) => {
      const ini = new Date(s.inicio);
      const fin = new Date(ini.getTime() + s.duracion_seg * 1000);
      const a = Math.max(d0, ini.getTime()), b = Math.min(d1, fin.getTime());
      return { inicio: ini, fin, duracion: s.duracion_seg, izq: ((a - d0) / 86_400_000) * 100, ancho: Math.max(0.15, ((b - a) / 86_400_000) * 100) };
    }).filter((s) => s.ancho > 0);
  });
  readonly totalGrabado = computed(() => this.segmentos().reduce((t, s) => t + s.duracion, 0));
  readonly momento = computed(() => new Date(this.inicioDia().getTime() + this.minuto() * 60_000));
  readonly horaMomento = computed(() => {
    const m = this.minuto();
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });
  readonly hayGrabacionEnMomento = computed(() => {
    const t = this.momento().getTime();
    return this.segmentos().some((s) => s.inicio.getTime() <= t && t < s.fin.getTime());
  });

  readonly columnasClips: ColumnaTabla<Clip>[] = [
    { id: 'camara', header: 'Cámara', valor: (c) => c.camara_nombre, tarjeta: 'titulo' },
    { id: 'desde', header: 'Desde', valor: (c) => c.desde, formato: (c) => fechaHora(c.desde), tarjeta: 'subtitulo' },
    { id: 'duracion', header: 'Duración', align: 'right', prioridad: 2,
      valor: (c) => (new Date(c.hasta).getTime() - new Date(c.desde).getTime()) / 1000,
      formato: (c) => cronometro((new Date(c.hasta).getTime() - new Date(c.desde).getTime()) / 1000) },
    { id: 'motivo', header: 'Motivo', valor: (c) => c.motivo ?? '', prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'por', header: 'Guardado por', valor: (c) => c.creado_por_nombre ?? '', prioridad: 3, tarjeta: 'meta' },
    { id: 'creado', header: 'Fecha', valor: (c) => c.creado_en, formato: (c) => fechaHora(c.creado_en), prioridad: 3 },
  ];
  readonly idClip = (c: Clip) => c.id;

  constructor() {
    this.api.camaras().subscribe({
      next: (c) => {
        this.camaras.set([...c].sort((a, b) => `${a.sede_nombre} ${a.nombre}`.localeCompare(`${b.sede_nombre} ${b.nombre}`)));
        const pedida = this.route.snapshot.queryParamMap.get('camara');
        if (pedida) this.elegirCamara(pedida);
      },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudieron leer las cámaras.')),
    });
    this.cargarClips();
    const ahora = new Date();
    this.minuto.set(Math.max(0, ahora.getHours() * 60 + ahora.getMinutes() - 15));
  }

  elegirCamara(id: string | null): void {
    this.camaraId.set(id);
    this.reproduccion.set(null);
    this.buscar();
  }

  cambiarDia(d: string): void {
    this.dia.set(d);
    this.reproduccion.set(null);
    this.buscar();
  }

  buscar(): void {
    const id = this.camaraId();
    if (!id || !this.dia()) { this.grabaciones.set(null); return; }
    const d0 = this.inicioDia();
    const d1 = new Date(d0.getTime() + 86_400_000 - 1000);
    this.cargando.set(true);
    this.error.set(null);
    this.api.grabaciones(id, isoLocal(d0), isoLocal(d1)).subscribe({
      next: (g) => { this.grabaciones.set(g); this.cargando.set(false); },
      error: (e) => { this.cargando.set(false); this.grabaciones.set(null); this.error.set(mensajeDeError(e, 'No se pudieron leer las grabaciones.')); },
    });
  }

  clicLinea(ev: MouseEvent): void {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const m = Math.round(((ev.clientX - r.left) / r.width) * 1440);
    this.minuto.set(Math.min(1439, Math.max(0, m)));
  }

  teclaLinea(ev: KeyboardEvent): void {
    const paso = ev.shiftKey ? 60 : 5;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); this.minuto.set(Math.min(1439, this.minuto() + paso)); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.minuto.set(Math.max(0, this.minuto() - paso)); }
    if (ev.key === 'Enter') { ev.preventDefault(); this.reproducir(); }
  }

  ponerHora(v: string): void {
    const [h, m] = (v || '0:0').split(':').map(Number);
    this.minuto.set(Math.min(1439, (h || 0) * 60 + (m || 0)));
  }

  irASegmento(s: Segmento): void {
    const d0 = this.inicioDia().getTime();
    this.minuto.set(Math.max(0, Math.round((Math.max(s.inicio.getTime(), d0) - d0) / 60_000)));
    this.reproducir();
  }

  reproducir(fuente: FuenteReproduccion = this.fuente()): void {
    const id = this.camaraId();
    if (!id) return;
    this.fuente.set(fuente);
    const desde = this.momento();
    const hasta = new Date(desde.getTime() + this.duracionMin() * 60_000);
    this.error.set(null);
    this.api.reproduccion(id, isoLocal(desde), isoLocal(hasta), fuente).subscribe({
      next: (r) => this.reproduccion.set(r),
      error: (e) => this.error.set(mensajeDeError(e, fuente === 'DVR' ? 'El DVR no entregó la grabación.' : 'No se pudo abrir la grabación.')),
    });
  }

  async descargar(): Promise<void> {
    const id = this.camaraId();
    const c = this.camara();
    if (!id) return;
    this.descargando.set(true);
    try {
      const b = await firstValueFrom(this.api.descargar(id, isoLocal(this.momento()), this.duracionMin() * 60));
      descargarBlob(b, `${(c?.nombre ?? 'camara').replace(/[^\w-]+/g, '_')}_${this.dia()}_${this.horaMomento().replace(':', 'h')}.mp4`);
    } catch (e) {
      this.acciones.aviso(mensajeDeError(e, 'No se pudo descargar el clip.'), true);
    } finally { this.descargando.set(false); }
  }

  async guardarClip(): Promise<void> {
    const id = this.camaraId();
    if (!id) return;
    const desde = this.momento();
    const hasta = new Date(desde.getTime() + this.duracionMin() * 60_000);
    const r = await abrirFormulario(this.dialog, {
      titulo: 'Guardar clip', icono: 'bookmark_add', ancho: '480px',
      descripcion: `${this.camara()?.nombre ?? ''} · ${fechaHora(desde)} → ${horaCorta(hasta)}. El clip se conserva aunque la grabación continua se borre por retención.`,
      campos: [{ clave: 'motivo', etiqueta: 'Motivo', tipo: 'area', requerido: true, ancho: true, placeholder: 'Ej.: robo del 11-oct, denuncia N.º…' }],
      guardar: (v) => this.api.crearClip({ camara_id: id, desde: isoLocal(desde), hasta: isoLocal(hasta), motivo: v['motivo'] }),
    });
    if (r) { this.acciones.aviso('Clip guardado.'); this.cargarClips(); }
  }

  cargarClips(): void {
    this.cargandoClips.set(true);
    this.api.clips().subscribe({
      next: (c) => { this.clips.set(c); this.cargandoClips.set(false); },
      error: () => this.cargandoClips.set(false),
    });
  }

  async descargarClip(c: Clip): Promise<void> {
    const u = urlApi(c.url);
    if (!u) { this.acciones.aviso('Este clip todavía no tiene archivo.', true); return; }
    try {
      const b = await firstValueFrom(this.http.get(u, { responseType: 'blob' }));
      descargarBlob(b, `clip_${c.camara_nombre.replace(/[^\w-]+/g, '_')}_${c.desde.slice(0, 16).replace(/[:T]/g, '-')}.mp4`);
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo descargar el clip.'), true); }
  }

  verClip(c: Clip): void {
    this.camaraId.set(c.camara_id);
    const d = new Date(c.desde);
    this.dia.set(isoLocal(d).slice(0, 10));
    this.minuto.set(d.getHours() * 60 + d.getMinutes());
    this.duracionMin.set(Math.max(1, Math.ceil((new Date(c.hasta).getTime() - d.getTime()) / 60_000)));
    this.buscar();
    this.reproducir('CENTRAL');
  }
}
