import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';

import { Aviso, DisenoResuelto, Media, Turno, TurnosService, VistaPantalla } from '../../dashboard/submodule/turnos/service/turnos.service';
import { AudioAtenuador } from '../../dashboard/submodule/turnos/service/audio-atenuador';
import { ReproductorGuion } from '../../dashboard/submodule/turnos/components/reproductor-guion/reproductor-guion';
import { DatosVista, EmisionPieza } from '../../dashboard/submodule/turnos/components/vista-render/vista-render';
import { conectarSse, ConexionSse } from '../../dashboard/submodule/turnos/service/sse.util';
import { CroquisSvg, leerPisos } from '../../dashboard/submodule/turnos/components/croquis-svg/croquis-svg';
import { idYoutube } from '../../dashboard/submodule/turnos/service/media.util';

/**
 * El televisor de la sala de espera.
 *
 * <p>Se abre sin sesión con el código de la pantalla. Recibe la cola por SSE y, al llamar
 * un turno, lo canta (campanilla + voz del navegador), lo muestra grande unos segundos y
 * resalta el área en el mini-mapa. Mientras tanto circula la publicidad: imágenes,
 * videos propios, YouTube, avisos y fichas de cursos con QR.
 *
 * <p>Reporta cada pieza emitida y un latido por minuto: es lo que permite saber desde
 * administración que un televisor lleva tres días apagado.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-pantalla-sala',
  imports: [CommonModule, MatIconModule, CroquisSvg, ReproductorGuion],
  templateUrl: './pantalla-sala.html',
  styleUrl: './pantalla-sala.css',
})
export class PantallaSala implements OnInit {
  readonly codigo = input.required<string>();

  private api = inject(TurnosService);
  private sanitizer = inject(DomSanitizer);
  private destroyRef = inject(DestroyRef);

  readonly vista = signal<VistaPantalla | null>(null);
  readonly error = signal<string | null>(null);
  readonly canal = signal('cerrado');
  readonly ahora = signal(new Date());
  readonly enCurso = signal<Turno[]>([]);
  readonly enEspera = signal<Turno[]>([]);
  readonly piezas = signal<Media[]>([]);
  readonly indice = signal(0);
  readonly llamado = signal<Turno | null>(null);
  readonly audioDesbloqueado = signal(false);
  /** El diseño (guion + vistas) que le toca a esta pantalla; sin él se usa la plantilla fija. */
  readonly diseno = signal<DisenoResuelto | null>(null);
  /** Aviso de perifoneo sonando ahora (para el rótulo en pantalla). */
  readonly perifoneo = signal<Media | null>(null);
  /** Avisos vigentes (bloque y pantalla completa) y el que está tomando la pantalla ahora. */
  readonly avisos = signal<Aviso[]>([]);
  readonly avisoPantalla = signal<Aviso | null>(null);
  private ultimoAviso = new Map<string, number>();
  private audioAviso: HTMLAudioElement | null = null;
  private temporizadorAviso: ReturnType<typeof setTimeout> | null = null;
  /** Baja la publicidad y la música mientras habla la voz; vuelve al terminar. */
  private atenuador = new AudioAtenuador();
  private musicaFondo: HTMLAudioElement | null = null;
  private ultimoPerifoneo = new Map<string, number>();
  private audioPerifoneo: HTMLAudioElement | null = null;
  private camaPerifoneo: HTMLAudioElement | null = null;
  readonly conDiseno = computed(() => (this.diseno()?.guion?.pasos?.length ?? 0) > 0 && (this.diseno()?.vistas?.length ?? 0) > 0);
  readonly datosVista = computed<DatosVista>(() => ({
    oficina_nombre: this.vista()?.oficina_nombre ?? '',
    ahora: this.ahora(),
    llamado: this.llamado(),
    en_curso: this.enCurso(),
    en_espera: this.enEspera(),
    piezas: this.piezas(),
    playlists: this.diseno()?.playlists ?? {},
    croquis: this.vista()?.croquis ?? null,
    url_turno: this.diseno()?.url_turno ?? null,
    avisos: this.avisos(),
  }));
  readonly avisoBloqueLegado = computed(() => this.avisos().find(a => a.modo === 'BLOQUE') ?? null);

  readonly pieza = computed<Media | null>(() => this.piezas()[this.indice()] ?? null);
  readonly urlPieza = computed<string | null>(() => { const p = this.pieza(); return p ? this.api.urlMedia(p) : null; });
  readonly urlEmbebida = computed<SafeResourceUrl | null>(() => {
    const p = this.pieza();
    if (!p) return null;
    if (p.tipo === 'YOUTUBE') {
      const id = idYoutube(p.url);
      return id ? this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=${p.silenciado ? 1 : 0}&controls=0&loop=1&playlist=${id}&rel=0`) : null;
    }
    if (p.tipo === 'VIMEO') {
      const m = /vimeo\.com\/(\d+)/.exec(p.url ?? '');
      return m ? this.sanitizer.bypassSecurityTrustResourceUrl(`https://player.vimeo.com/video/${m[1]}?autoplay=1&muted=${p.silenciado ? 1 : 0}&controls=0&loop=1`) : null;
    }
    if (p.tipo === 'HTML' && p.url) return this.sanitizer.bypassSecurityTrustResourceUrl(p.url);
    return null;
  });
  readonly qrCurso = computed<string | null>(() => {
    const p = this.pieza();
    if (!p || p.tipo !== 'CURSO' || !p.curso_url) return null;
    return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=8&data=${encodeURIComponent(p.curso_url)}`;
  });
  readonly areaResaltada = computed(() => this.llamado()?.area_id ?? this.enCurso()[0]?.area_id ?? null);
  /** El mini-mapa muestra el piso del área que se está cantando (o el primero). */
  readonly pisoResaltado = computed<string | null>(() => {
    const c = this.vista()?.croquis;
    if (!c) return null;
    const area = c.areas?.find(a => a.id === this.areaResaltada());
    const pisos = leerPisos(c);
    return area?.piso && pisos.some(p => p.id === area.piso) ? area.piso : pisos[0]?.id ?? null;
  });
  readonly mostrarMedia = computed(() => { const v = this.vista(); return !!v && v.layout !== 'SOLO_TURNOS' && this.piezas().length > 0; });
  readonly mostrarTurnos = computed(() => { const v = this.vista(); return !!v && v.layout !== 'SOLO_MEDIA'; });

  private conexion: ConexionSse | null = null;
  private temporizadorPieza: ReturnType<typeof setTimeout> | null = null;
  private inicioPieza = Date.now();
  private temporizadorLlamado: ReturnType<typeof setTimeout> | null = null;
  private colaVoz: Turno[] = [];
  private hablando = false;

  constructor() {
    effect(() => {
      const p = this.pieza();
      untracked(() => this.programarSiguiente(p));
    });
  }

  ngOnInit(): void {
    this.cargar();
    const reloj = setInterval(() => this.ahora.set(new Date()), 1000);
    const latido = setInterval(() => this.api.publicoLatido(this.codigo()).subscribe({ error: () => {} }), 60_000);
    const refresco = setInterval(() => this.api.publicoPiezas(this.codigo()).subscribe({ next: p => this.piezas.set(p), error: () => {} }), 5 * 60_000);
    // Por si se perdió el aviso SSE de un diseño nuevo: se comprueba la firma cada dos minutos.
    const refrescoDiseno = setInterval(() => this.refrescarDiseno(), 2 * 60_000);
    const perifoneo = setInterval(() => { this.revisarPerifoneo(); this.revisarAvisos(); }, 20_000);
    this.destroyRef.onDestroy(() => { clearInterval(perifoneo); this.audioPerifoneo?.pause(); this.camaPerifoneo?.pause(); this.audioAviso?.pause(); this.pararMusicaFondo(); });
    this.destroyRef.onDestroy(() => { clearInterval(reloj); clearInterval(latido); clearInterval(refresco); clearInterval(refrescoDiseno); this.conexion?.cerrar(); if (this.temporizadorPieza) clearTimeout(this.temporizadorPieza); });
  }

  private cargar(): void {
    this.api.publicoVistaPantalla(this.codigo()).subscribe({
      next: v => {
        this.vista.set(v);
        this.enCurso.set(v.en_curso);
        this.enEspera.set(v.en_espera);
        this.piezas.set(v.piezas);
        this.aplicarDiseno(v.diseno ?? null);
        this.avisos.set(v.avisos ?? []);
        this.error.set(null);
        this.conectar(v);
        this.arrancarMusicaFondo();
      },
      error: e => this.error.set(e?.status === 404 ? 'Pantalla no encontrada o desactivada. Revise el enlace.' : 'No se pudo conectar. Reintentando…'),
    });
    // Sin vista aún (red caída al arrancar): se reintenta hasta que responda.
    setTimeout(() => { if (!this.vista()) this.cargar(); }, 15_000);
  }

  private conectar(v: VistaPantalla): void {
    if (this.conexion) return;
    this.conexion = conectarSse(this.api.urlEventosPantalla(this.codigo()), {
      token: null,
      onEstado: e => {
        this.canal.set(e);
        // Al reconectar se pide la cola completa: algo pudo pasar mientras no había canal.
        if (e === 'conectado') this.api.publicoVistaPantalla(this.codigo()).subscribe({ next: nv => { this.vista.set(nv); this.enCurso.set(nv.en_curso); this.enEspera.set(nv.en_espera); }, error: () => {} });
      },
      onEvento: (nombre, datos) => this.evento(nombre, datos as Turno, v),
    });
  }

  /** Solo se rearma el televisor si la firma cambió: un guardado sin cambios no parpadea. */
  private aplicarDiseno(d: DisenoResuelto | null): void {
    if (!d || !d.guion || !d.guion.pasos?.length) { this.diseno.set(null); return; }
    if (this.diseno()?.firma === d.firma) return;
    this.diseno.set(d);
  }

  private refrescarDiseno(): void {
    this.api.publicoDiseno(this.codigo()).subscribe({ next: d => this.aplicarDiseno(d), error: () => {} });
  }

  /** Emisiones de las piezas que reproducen los bloques de publicidad del diseño. */
  emisionDesdeDiseno(e: EmisionPieza): void {
    this.api.publicoEmision(this.codigo(), e.media_id, e.segundos).subscribe({ error: () => {} });
  }

  private evento(nombre: string, t: Turno, v: VistaPantalla): void {
    if (nombre === 'diseno-cambiado') { this.refrescarDiseno(); return; }
    if (nombre === 'avisos-cambiados') { this.refrescarAvisos(); return; }
    if (nombre === 'aviso') { this.recibirAviso(t as unknown as Aviso); return; }
    if (!nombre.startsWith('turno-')) return;
    switch (nombre) {
      case 'turno-creado':
      case 'turno-aplazado':
        this.enEspera.update(l => [...l.filter(x => x.id !== t.id), t].slice(0, v.turnos_visibles));
        this.enCurso.update(l => l.filter(x => x.id !== t.id));
        break;
      case 'turno-llamado':
        this.enEspera.update(l => l.filter(x => x.id !== t.id));
        this.enCurso.update(l => [t, ...l.filter(x => x.id !== t.id)]);
        this.cantar(t);
        break;
      case 'turno-iniciado':
        this.enCurso.update(l => l.map(x => (x.id === t.id ? t : x)));
        break;
      case 'turno-cerrado':
        this.enCurso.update(l => l.filter(x => x.id !== t.id));
        this.enEspera.update(l => l.filter(x => x.id !== t.id));
        break;
    }
    // La lista de espera visible puede haberse quedado corta: se completa desde el servidor.
    if (nombre === 'turno-llamado' || nombre === 'turno-cerrado') {
      this.api.publicoVistaPantalla(this.codigo()).subscribe({ next: nv => this.enEspera.set(nv.en_espera), error: () => {} });
    }
  }

  // ── Cantar el turno ────────────────────────────────────────────────────

  private cantar(t: Turno): void {
    this.llamado.set(t);
    if (this.temporizadorLlamado) clearTimeout(this.temporizadorLlamado);
    this.temporizadorLlamado = setTimeout(() => this.llamado.set(null), 12_000);
    const v = this.vista();
    if (v?.sonido) this.campanilla();
    if (v?.voz) { this.colaVoz.push(t); this.hablar(); }
  }

  private campanilla(): void {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      [880, 1175].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.001;
        o.connect(g).connect(ctx.destination);
        const t0 = ctx.currentTime + i * 0.22;
        g.gain.setValueAtTime(0.001, t0); g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
        o.start(t0); o.stop(t0 + 0.55);
      });
      this.audioDesbloqueado.set(true);
    } catch { /* sin audio */ }
  }

  /**
   * Canta el siguiente turno de la cola de voz. Primero con la voz de marca del
   * servidor (mp3 ya sintetizado o generado al momento); si no hay voz del
   * servidor, falla la red o el navegador bloquea el audio, con la voz del
   * navegador, como siempre. Cantar el turno nunca depende de un tercero.
   */
  private hablar(): void {
    if (this.hablando || !this.colaVoz.length) return;
    const t = this.colaVoz.shift()!;
    this.hablando = true;
    this.atenuador.bajar(this.vista()?.voz_marca?.atenuar_volumen ?? 20);
    const fin = () => { this.atenuador.subir(); this.hablando = false; setTimeout(() => this.hablar(), 300); };
    let cayo = false;
    const caer = () => { if (cayo) return; cayo = true; this.hablarNavegador(t, fin); };
    if (this.vista()?.voz_marca && !this.vista()!.voz_marca!.cantar_con_voz) { caer(); return; }
    try {
      const a = new Audio(this.api.urlAudioLlamado(this.codigo(), t.id));
      a.preload = 'auto';
      a.onended = fin;
      a.onerror = caer;
      a.play().catch(caer);
    } catch { caer(); }
  }

  // ── Música de fondo ────────────────────────────────────────────────────

  /** Suena en bucle a bajo volumen cuando la sala ya desbloqueó el audio; la voz la atenúa. */
  private arrancarMusicaFondo(): void {
    const vm = this.vista()?.voz_marca;
    const url = vm?.musica_fondo_url ? this.api.urlMedia({ url: vm.musica_fondo_url }) : null;
    if (!url) { this.pararMusicaFondo(); return; }
    if (this.musicaFondo && this.musicaFondo.src === url) return;
    this.pararMusicaFondo();
    const a = new Audio(url);
    a.loop = true;
    a.volume = Math.max(0, Math.min(1, (vm?.musica_fondo_volumen ?? 15) / 100));
    this.musicaFondo = a;
    this.atenuador.registrar(a);
    if (this.audioDesbloqueado()) a.play().catch(() => {});
  }

  private pararMusicaFondo(): void {
    if (!this.musicaFondo) return;
    this.musicaFondo.pause();
    this.atenuador.olvidar(this.musicaFondo);
    this.musicaFondo = null;
  }

  // ── Avisos ─────────────────────────────────────────────────────────────

  private refrescarAvisos(): void {
    this.api.publicoAvisos(this.codigo()).subscribe({ next: a => this.avisos.set(a), error: () => {} });
  }

  /** Un aviso emitido desde administración: el de pantalla completa toma el televisor ya. */
  private recibirAviso(a: Aviso): void {
    if (!a || !a.id) return;
    this.avisos.update(l => [a, ...l.filter(x => x.id !== a.id)].sort((x, y) => x.orden - y.orden));
    if (a.modo === 'PANTALLA_COMPLETA') { this.ultimoAviso.set(a.id, Date.now()); this.mostrarAviso(a); }
  }

  /** Cada 20 s: un aviso de pantalla completa con intervalo al que le toque. */
  private revisarAvisos(): void {
    if (this.avisoPantalla()) return;
    const ahora = Date.now();
    for (const a of this.avisos().filter(x => x.modo === 'PANTALLA_COMPLETA' && x.intervalo_min)) {
      if (!this.ultimoAviso.has(a.id)) { this.ultimoAviso.set(a.id, ahora); continue; }
      if (ahora - (this.ultimoAviso.get(a.id) ?? 0) < (a.intervalo_min ?? 0) * 60_000) continue;
      this.ultimoAviso.set(a.id, ahora);
      this.mostrarAviso(a);
      return;
    }
  }

  private mostrarAviso(a: Aviso): void {
    if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
    this.audioAviso?.pause();
    this.avisoPantalla.set(a);
    const cerrar = () => { this.avisoPantalla.set(null); this.audioAviso = null; };
    this.temporizadorAviso = setTimeout(cerrar, Math.max(3, a.duracion_seg) * 1000);
    const url = a.audio_url ? this.api.urlAudio(a.audio_url) : null;
    if (url && this.audioDesbloqueado()) {
      this.atenuador.bajar(this.vista()?.voz_marca?.atenuar_volumen ?? 20);
      const audio = new Audio(url);
      this.audioAviso = audio;
      const fin = () => this.atenuador.subir();
      audio.onended = fin;
      audio.onerror = fin;
      audio.play().catch(fin);
    }
  }

  private hablarNavegador(t: Turno, fin: () => void): void {
    if (typeof speechSynthesis === 'undefined') { fin(); return; }
    const v = this.vista()!;
    // Un puesto móvil (apoyo en pasillo o sala) no tiene a dónde "dirigirse": el asesor va.
    const plantilla = t.punto_tipo === 'MOVIL'
      ? 'Turno {codigo}, un asesor lo atenderá en {area}'
      : (v.voz_plantilla || 'Turno {codigo}, diríjase a {punto}');
    const frase = plantilla
      .replace('{codigo}', deletrear(t.codigo)).replace('{punto}', t.punto_nombre ?? '')
      .replace('{servicio}', t.servicio_nombre ?? '').replace('{area}', t.area_nombre ?? t.punto_nombre?.replace(/^Apoyo /, '') ?? 'la sala').replace('{nombre}', t.nombre ?? '');
    const u = new SpeechSynthesisUtterance(frase);
    u.lang = 'es-CO'; u.rate = 0.92;
    const voz = speechSynthesis.getVoices().find(x => x.lang.startsWith('es-CO')) ?? speechSynthesis.getVoices().find(x => x.lang.startsWith('es'));
    if (voz) u.voice = voz;
    u.onend = u.onerror = fin;
    speechSynthesis.speak(u);
  }

  // ── Perifoneo ──────────────────────────────────────────────────────────

  /** Cada 20 s: si a alguna pieza con intervalo le toca y está en su horario, suena por encima de todo. */
  private revisarPerifoneo(): void {
    if (this.perifoneo() || !this.audioDesbloqueado()) return;
    const ahora = Date.now();
    const candidatas = [...this.piezas(), ...Object.values(this.diseno()?.playlists ?? {}).flat()]
      .filter(p => p.tipo === 'AUDIO' && p.intervalo_min && p.activo && this.api.urlMedia(p));
    for (const p of candidatas) {
      if (!this.ultimoPerifoneo.has(p.id)) { this.ultimoPerifoneo.set(p.id, ahora); continue; }
      if (!this.enHorario(p)) continue;
      if (ahora - (this.ultimoPerifoneo.get(p.id) ?? 0) < (p.intervalo_min ?? 0) * 60_000) continue;
      this.ultimoPerifoneo.set(p.id, ahora);
      this.perifonear(p);
      return;
    }
  }

  private enHorario(p: Media): boolean {
    if (!p.horario_json) return true;
    try {
      const h = JSON.parse(p.horario_json) as { dias?: number[]; desde?: string; hasta?: string };
      const d = new Date();
      const dia = d.getDay() === 0 ? 7 : d.getDay();
      if (h.dias?.length && !h.dias.includes(dia)) return false;
      const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (h.desde && hhmm < h.desde) return false;
      if (h.hasta && hhmm > h.hasta) return false;
      return true;
    } catch { return true; }
  }

  private perifonear(p: Media): void {
    const url = this.api.urlMedia(p);
    if (!url) return;
    this.perifoneo.set(p);
    const inicio = Date.now();
    this.atenuador.bajar(this.vista()?.voz_marca?.atenuar_volumen ?? 20);
    const terminar = () => {
      this.atenuador.subir();
      this.camaPerifoneo?.pause(); this.camaPerifoneo = null; this.audioPerifoneo = null;
      this.perifoneo.set(null);
      this.api.publicoEmision(this.codigo(), p.id, Math.round((Date.now() - inicio) / 1000)).subscribe({ error: () => {} });
    };
    if (p.cama_media_id) {
      this.camaPerifoneo = new Audio(this.api.urlMedia({ url: `/api/v1/public/turnos/media/${p.cama_media_id}/archivo` }) ?? '');
      this.camaPerifoneo.loop = true;
      this.camaPerifoneo.volume = Math.max(0, Math.min(1, (p.cama_volumen ?? 25) / 100));
      this.camaPerifoneo.play().catch(() => {});
    }
    this.audioPerifoneo = new Audio(url);
    this.audioPerifoneo.onended = terminar;
    this.audioPerifoneo.onerror = terminar;
    this.audioPerifoneo.play().catch(terminar);
  }

  /** Un clic en cualquier parte desbloquea el audio (los navegadores lo exigen). */
  desbloquearAudio(): void {
    this.campanilla();
    if (this.musicaFondo && this.musicaFondo.paused) this.musicaFondo.play().catch(() => {});
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // ── Rotación de piezas ─────────────────────────────────────────────────

  private programarSiguiente(p: Media | null): void {
    if (this.temporizadorPieza) clearTimeout(this.temporizadorPieza);
    if (!p) return;
    this.inicioPieza = Date.now();
    // Un video propio avisa al terminar (videoTermino); lo demás va por duración.
    if (p.tipo === 'VIDEO' && this.urlPieza()) {
      this.temporizadorPieza = setTimeout(() => this.siguientePieza(), Math.max(5, p.duracion_seg) * 1000 + 15_000);
      return;
    }
    this.temporizadorPieza = setTimeout(() => this.siguientePieza(), Math.max(3, p.duracion_seg) * 1000);
  }

  videoTermino(): void { this.siguientePieza(); }
  videoFallo(): void { this.siguientePieza(); }

  private siguientePieza(): void {
    const p = this.pieza();
    if (p) {
      const seg = Math.round((Date.now() - this.inicioPieza) / 1000);
      this.api.publicoEmision(this.codigo(), p.id, seg).subscribe({ error: () => {} });
    }
    const n = this.piezas().length;
    if (!n) return;
    this.indice.update(i => (i + 1) % n);
    if (this.indice() === 0 && n === 1) this.programarSiguiente(this.pieza());
  }

  nombreCorto(t: Turno): string { return t.nombre ?? ''; }

  /** Cama musical de una pieza de audio (otra pieza AUDIO marcada como cama). */
  urlCama(p: Media): string | null {
    return p.cama_media_id ? this.api.urlMedia({ url: `/api/v1/public/turnos/media/${p.cama_media_id}/archivo` }) : null;
  }
}

/** "A-014" → "A, cero catorce": la voz lee mejor los dígitos separados de la letra. */
export function deletrear(codigo: string): string {
  const m = /^([A-Z]+)-?(\d+)$/i.exec(codigo);
  if (!m) return codigo;
  const letras = m[1].toUpperCase().split('').join(' ');
  const n = parseInt(m[2], 10);
  return `${letras}, ${n}`;
}
