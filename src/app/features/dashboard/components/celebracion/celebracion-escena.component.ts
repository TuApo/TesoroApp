import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input,
  output, signal, viewChild,
} from '@angular/core';
import { CelebracionDelDia, PersonaCelebrada, PlantillaCelebracion, Tipografia } from './celebracion.models';
import { CelebracionService } from './celebracion.service';
import { Fiesta, TipoFuego, tono } from './particulas';
import { FUENTES, fechaLarga } from './preparar';

/** Si una celebración llegara sin plantilla (todas apagadas), se ve con esta. */
const RESPALDO: PlantillaCelebracion = {
  id: '', codigo: 'RESPALDO', nombre: 'Confeti', animacion: 'CONFETI', tipografia: 'FESTIVA',
  color_fondo: '#1E44C8', color_fondo_2: '#0B1640', color_texto: '#FFFFFF', color_acento: '#FFC83D',
  color_acento_2: '#5EE7FF', duracion_segundos: 8,
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * La escena de la celebración de cumpleaños: 5 a 10 segundos, se cierra sola, con la X,
 * con Escape o tocando fuera.
 *
 * Seis motores (CONFETI, GLOBOS, FUEGOS, GALA, POLAROID, PASTEL); cada plantilla de
 * Marketing es uno de ellos con sus colores y su tipografía. Todo el tamaño sale de
 * container queries sobre la propia escena (`cqmin`, `cqw`): por eso la misma escena se ve
 * bien a pantalla completa en un celular, en un televisor, y dentro del marco de celular
 * del probador de Marketing.
 *
 * Con «reducir movimiento» activado en el sistema no hay partículas ni piezas volando: sale
 * la tarjeta quieta con un fundido, y dura un poco menos.
 */
@Component({
  selector: 'app-celebracion-escena',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './celebracion-escena.component.html',
  styleUrl: './celebracion-escena.component.css',
  host: { '[class.cel-host--marco]': "modo() === 'marco'" },
})
export class CelebracionEscenaComponent {
  readonly datos = input.required<CelebracionDelDia>();
  /** `pantalla`: encima de todo (fixed). `marco`: llena su contenedor (el probador). */
  readonly modo = input<'pantalla' | 'marco'>('pantalla');
  /** En el probador no se cierra al terminar: ofrece repetir. */
  readonly sinCierreAutomatico = input(false);

  readonly cerrada = output<{ antes: boolean }>();
  readonly repetir = output<void>();

  private readonly api = inject(CelebracionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly raiz = viewChild.required<ElementRef<HTMLElement>>('raiz');
  private readonly lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');

  readonly saliendo = signal(false);
  readonly soplado = signal(false);
  readonly terminado = signal(false);
  /** Varias personas: la que está ahora al centro (o null entre una y otra). */
  readonly turno = signal<{ p: PersonaCelebrada; i: number } | null>(null);
  /** El cierre: todas en su puesto, la ola y el mensaje. */
  readonly final = signal(false);
  readonly videoListo = signal(false);
  /** h = horizontal, v = vertical: qué fondo animado toca. Se mide la escena al arrancar. */
  readonly orientacion = signal<'h' | 'v'>(
    typeof window !== 'undefined' && window.innerWidth < window.innerHeight ? 'v' : 'h');
  private muerta = false;
  readonly reducido = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  private fiesta: Fiesta | null = null;
  private observador: ResizeObserver | null = null;
  private relojes: ReturnType<typeof setTimeout>[] = [];
  private foco: Element | null = null;
  private overflowPrevio = '';
  private cerrando = false;
  private readonly alTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.cerrar(true); } };

  readonly plantilla = computed(() => this.datos().plantilla ?? RESPALDO);
  readonly anim = computed(() => this.plantilla().animacion);
  readonly personas = computed(() => this.datos().personas ?? []);
  readonly grupo = computed(() => {
    const n = this.personas().length;
    return n <= 1 ? 'n1' : n <= 3 ? 'n2' : n <= 6 ? 'n4' : 'n7';
  });

  /**
   * De 2 a 8 personas, cada una pasa al centro con su momento y luego vuela a su puesto. Con
   * más no cabe en 10 s: entran todas en cascada.
   */
  readonly secuencia = computed(() => !this.reducido && this.personas().length >= 2 && this.personas().length <= 8);
  /** Segundos de cada persona en el centro (entrada + pausa + vuelo). */
  readonly paso = computed(() => [0, 0, 1.55, 1.35, 1.15, 1.0, 0.9, 0.82, 0.76][this.personas().length] ?? 0.76);

  /** 5 a 10 s; con muchas personas un poco más (hay más que mirar), nunca más de 10. */
  readonly duracion = computed(() => {
    const n = this.personas().length;
    let d = Math.max(5, Math.min(10, this.plantilla().duracion_segundos || 8));
    if (this.secuencia()) d = Math.max(d, INICIO_TURNOS + n * this.paso() + FINAL);
    else if (n >= 9) d += 2;
    // Una sola persona con mensaje de su jefe: un poco más para alcanzar a leerlo.
    else if (n === 1 && this.personas()[0].mensaje_jefe) d += 1.5;
    d = Math.min(10, Math.ceil(d * 10) / 10);
    return this.reducido ? Math.min(d, 7) : d;
  });

  /**
   * El fondo de la escena en su orientación: el PROPIO de la persona si es una sola y tiene
   * uno aprobado (hecho con IA a partir de lo que eligió su equipo), si no el de la plantilla.
   */
  readonly medio = computed<{ video: string | null; imagen: string } | null>(() => {
    const o = this.orientacion();
    const personas = this.personas();
    const propio = personas.length === 1 ? personas[0].fondo : null;
    if (propio) {
      const v = o === 'h' ? propio.video_h : propio.video_v;
      return { video: v ? this.api.urlFoto(v) : null, imagen: this.api.urlFoto(o === 'h' ? propio.imagen_h : propio.imagen_v) };
    }
    const f = this.plantilla().fondo;
    if (!f) return null;
    return { video: this.api.urlFoto(o === 'h' ? f.video_h : f.video_v), imagen: this.api.urlFoto(o === 'h' ? f.imagen_h : f.imagen_v) };
  });

  /** Varias personas: el fondo propio de cada una, para cambiar a él durante su turno. */
  readonly fondosTurno = computed(() => {
    if (this.personas().length < 2) return [];
    const o = this.orientacion();
    return this.personas().map((p, i) => {
      const f = p.fondo;
      if (!f) return null;
      const v = o === 'h' ? f.video_h : f.video_v;
      return { i, imagen: this.api.urlFoto(o === 'h' ? f.imagen_h : f.imagen_v), video: v ? this.api.urlFoto(v) : null };
    }).filter((x): x is { i: number; imagen: string; video: string | null } => !!x);
  });
  /** Índice de la persona cuyo fondo se ve ahora (−1 = el de la plantilla). */
  readonly fondoActivo = signal(-1);

  readonly lienzoAlFrente = computed(() => ['CONFETI', 'POLAROID', 'PASTEL'].includes(this.anim()));

  readonly clases = computed(() => [
    'cel',
    `cel--${this.anim().toLowerCase()}`,
    `cel--${this.grupo()}`,
    `cel--letra-${(this.plantilla().tipografia || 'FESTIVA').toLowerCase()}`,
    this.modo() === 'marco' ? 'cel--marco' : 'cel--pantalla',
    this.saliendo() ? 'cel--saliendo' : '',
    this.reducido ? 'cel--quieta' : '',
    this.datos().es_cumpleanero ? 'cel--suya' : '',
    this.medio() ? 'cel--con-medio' : '',
    `cel--o-${this.orientacion()}`,
    this.secuencia() ? 'cel--secuencia' : '',
    this.turno() ? 'cel--en-turno' : '',
    this.final() ? 'cel--final' : '',
  ].filter(Boolean).join(' '));

  readonly vars = computed(() => {
    const p = this.plantilla();
    const t = (p.tipografia || 'FESTIVA') as Tipografia;
    return {
      '--c-fondo': p.color_fondo,
      '--c-fondo-2': p.color_fondo_2,
      '--c-texto': p.color_texto,
      '--c-acento': p.color_acento,
      '--c-acento-2': p.color_acento_2,
      '--c-acento-claro': tono(p.color_acento, 0.45),
      '--c-acento-oscuro': tono(p.color_acento, -0.3),
      '--c-fondo-claro': tono(p.color_fondo, 0.18),
      '--g0': p.color_acento,
      '--g1': p.color_acento_2,
      '--g2': tono(p.color_acento, 0.4),
      '--g3': tono(p.color_acento_2, 0.35),
      '--g4': tono(p.color_acento, -0.2),
      '--fuente': (FUENTES[t] ?? FUENTES.FESTIVA).familia,
      '--dur': `${this.duracion()}s`,
      '--cols': String(columnas(this.personas().length, false)),
      '--cols-movil': String(columnas(this.personas().length, true)),
    } as Record<string, string>;
  });

  readonly palabrasTitulo = computed(() => (this.datos().titulo || '¡Feliz cumpleaños!').split(/\s+/).filter(Boolean));
  /** Letras agrupadas por palabra: así el renglón solo se parte entre palabras, nunca dentro. */
  readonly palabrasNombre = computed(() => {
    let k = 0;
    return (this.personas()[0]?.nombre ?? '').split(/\s+/).filter(Boolean)
      .map((w) => Array.from(w).map((l) => ({ l, i: k++ })));
  });
  /** En celular se esconde `pre` y queda solo la fecha (si no, parte en dos renglones). */
  readonly ceja = computed(() => {
    const d = this.datos();
    if (d.es_cumpleanero && d.saludo_personal) return { pre: '', texto: d.saludo_personal };
    const f = fechaLarga(d.fecha);
    return f ? { pre: 'Celebración del día · ', texto: f } : { pre: '', texto: 'Celebración del día' };
  });
  readonly mensaje = computed(() => {
    const d = this.datos();
    return (d.es_cumpleanero && d.mensaje_personal) ? d.mensaje_personal : (d.mensaje || '');
  });
  /** Lista de 0 o 1 para pintar el turno con @for por índice: cada persona estrena elemento. */
  readonly turnoLista = computed(() => { const t = this.turno(); return t ? [t] : []; });
  readonly nombresAccesibles = computed(() => this.personas().map((p) => p.nombre).join(', '));

  // ── decorado (al azar, una vez por escena) ────────────────────────────────

  readonly nubes = Array.from({ length: 5 }, (_, i) => ({
    top: 6 + i * 15 + rnd(-4, 4), escala: rnd(0.7, 1.4), retraso: -rnd(0, 40), vuelta: rnd(38, 64),
  }));
  readonly globosAtras = Array.from({ length: 15 }, (_, i) => ({
    x: (i / 15) * 100 + rnd(-3, 3), tam: rnd(7, 12), retraso: rnd(0, 2.6), subida: rnd(6.5, 9.5),
    vaiven: -rnd(0, 3), color: i % 5, opacidad: rnd(0.55, 0.85),
  }));
  /** Los de adelante pasan por los bordes: dan profundidad sin tapar ninguna cara. */
  readonly globosFrente = [
    { x: 2, tam: 15, retraso: 0.9, subida: 6.2, vaiven: -1.2, color: 0 },
    { x: 97, tam: 16, retraso: 0.3, subida: 6.8, vaiven: -0.4, color: 1 },
  ];
  readonly estrellas = Array.from({ length: 70 }, () => ({
    x: rnd(0, 100), y: rnd(0, 72), t: rnd(1, 2.6).toFixed(1), retraso: -rnd(0, 4),
  }));
  readonly ciudad = crearCiudad();
  readonly esquinas = ['si', 'sd', 'ii', 'id'];
  readonly banderines = crearBanderines();
  readonly velas = [{ x: 126, retraso: 1.05 }, { x: 150, retraso: 1.15 }, { x: 174, retraso: 1.25 }];
  readonly granas = [
    granasEn(44, 236, 212, 34, 14), granasEn(76, 172, 148, 26, 10), granasEn(106, 118, 88, 18, 6),
  ];

  constructor() {
    afterNextRender(() => this.arrancar());
    this.destroyRef.onDestroy(() => this.limpiar());
  }

  fotoUrl(p: PersonaCelebrada): string { return this.api.urlFoto(p.foto_url); }

  iniciales(nombre: string): string {
    const partes = (nombre || '').trim().split(/\s+/).filter(Boolean);
    return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length > 2 ? 2 : 1][0] : '')).toUpperCase();
  }

  /** Polaroids torcidas, cada una a su manera. */
  inclinacion(i: number): number { return [-6, 5, -3, 7, -5, 3, -7, 4][i % 8]; }

  /** Tocar fuera de la tarjeta cierra; en el marco del probador no (se toca para mirar). */
  tocarFondo(): void {
    if (this.modo() === 'pantalla') this.cerrar(true);
  }

  /** El video no arranca solo en todos los navegadores aunque lleve autoplay: se le insiste. */
  alCargarVideo(v: HTMLVideoElement): void {
    v.muted = true;
    void v.play().catch(() => undefined);
  }

  cerrar(antes: boolean): void {
    if (this.cerrando) return;
    this.cerrando = true;
    this.saliendo.set(true);
    this.reloj(() => this.cerrada.emit({ antes }), 260);
  }

  // ── arranque y línea de tiempo ─────────────────────────────────────────────

  private reloj(fn: () => void, ms: number): void {
    this.relojes.push(setTimeout(fn, ms));
  }

  private arrancar(): void {
    const raiz = this.raiz().nativeElement;
    const r0 = raiz.getBoundingClientRect();
    this.orientacion.set(r0.width >= r0.height * 1.05 ? 'h' : 'v');
    if (this.modo() === 'pantalla') {
      this.foco = document.activeElement;
      this.overflowPrevio = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', this.alTeclado);
      // El foco va al diálogo (lo anuncia el lector de pantalla) y no al botón: así no sale
      // el anillo de foco sobre «Cerrar» al abrir. Con Tab se llega al botón.
      raiz.focus({ preventScroll: true });
    }

    const d = this.duracion();
    if (!this.reducido) {
      try {
        this.fiesta = new Fiesta(this.lienzo().nativeElement, {
          paleta: this.paletaParticulas(), estelas: this.anim() === 'FUEGOS',
        });
      } catch {
        this.fiesta = null;
      }
    }
    if (this.fiesta) {
      const f = this.fiesta;
      const medir = () => { const r = raiz.getBoundingClientRect(); f.medir(r.width, r.height); };
      medir();
      this.observador = new ResizeObserver(medir);
      this.observador.observe(raiz);
      this.programar(f, d);
      f.iniciar();
    }
    if (this.secuencia()) {
      void this.correrTurnos(d);
    } else {
      this.reloj(() => this.final.set(true), Math.max(2.2, d - 3.4) * 1000);
      if (this.anim() === 'PASTEL') {
        const soplo = Math.max(2.8, Math.min(4, d * 0.42));
        this.reloj(() => this.soplar(), soplo * 1000);
      }
    }

    // Desvanecido final y cierre.
    if (this.sinCierreAutomatico()) {
      this.reloj(() => this.terminado.set(true), d * 1000);
    } else {
      this.reloj(() => this.cerrar(false), (d - 0.3) * 1000);
    }
  }

  private paletaParticulas(): string[] {
    const p = this.plantilla();
    if (this.anim() === 'FUEGOS') return [p.color_acento, p.color_acento_2, '#7FD8FF', '#B98CFF', '#FFFFFF', '#7CFFB2', '#FF8A5B'];
    if (this.anim() === 'GALA') return [p.color_acento, p.color_acento_2, '#FFF7D6'];
    return [p.color_acento, p.color_acento_2, tono(p.color_acento, 0.45), tono(p.color_acento_2, 0.4),
      tono(p.color_acento, -0.22), tono(p.color_acento_2, -0.25)];
  }

  /** Centro de un elemento de la escena, en coordenadas del lienzo. */
  private centro(el: Element | null): { x: number; y: number } | null {
    if (!el) return null;
    const base = this.raiz().nativeElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
  }

  private programar(f: Fiesta, d: number): void {
    const p = this.plantilla();
    const raiz = this.raiz().nativeElement;
    switch (this.anim()) {
      case 'CONFETI':
        f.en(0.35, () => f.canon(0, f.h, -62, 34, 150, 1.8))
          .en(0.42, () => f.canon(f.w, f.h, -118, 34, 150, 1.8))
          .en(2.3, () => f.canon(0, f.h * 0.9, -55, 30, 70, 1.45))
          .en(2.36, () => f.canon(f.w, f.h * 0.9, -125, 30, 70, 1.45))
          .durante(1, d - 1.6, 26 * Math.max(0.45, f.densidad), () => f.lluvia(1));
        break;
      case 'GLOBOS':
        f.durante(0.9, d - 2, 12 * Math.max(0.5, f.densidad), () => f.lluvia(1));
        break;
      case 'FUEGOS': {
        // Con el video de fondo (que ya trae fuegos) el lienzo solo pone unos cuantos al frente.
        const conVideo = !!this.medio();
        const tipos: TipoFuego[] = ['PEONIA', 'ANILLO', 'CRISANTEMO', 'SAUCE', 'PEONIA', 'PALMERA', 'CRISANTEMO', 'ANILLO'];
        const guion: [number, number, number][] = [
          [0.25, 0.3, 0.32], [0.7, 0.72, 0.24], [1.2, 0.5, 0.16], [1.75, 0.16, 0.28],
          [2.2, 0.86, 0.2], [2.85, 0.38, 0.22], [3.35, 0.64, 0.3], [3.9, 0.2, 0.18],
        ];
        guion.forEach(([t, x, y], i) => { if (t < d - 2.2 && (!conVideo || i % 2 === 0)) f.en(t, () => f.cohete(x, y, tipos[i])); });
        for (let t = 4.4; t < d - 2.4; t += conVideo ? rnd(0.9, 1.3) : rnd(0.45, 0.7)) {
          const x = rnd(0.12, 0.88), y = rnd(0.14, 0.34), tipo = tipos[(Math.random() * tipos.length) | 0];
          f.en(t, () => f.cohete(x, y, tipo));
        }
        // Final: tres a la vez.
        f.en(d - 2.2, () => { f.cohete(0.22, 0.24, 'SAUCE'); f.cohete(0.5, 0.16, 'CRISANTEMO'); f.cohete(0.78, 0.24, 'SAUCE'); });
        break;
      }
      case 'GALA':
        if (!this.medio()) f.en(0.05, () => f.bokeh(16, [p.color_acento, p.color_acento_2, '#FFFFFF']));
        f.durante(0.2, d - 0.8, (this.medio() ? 10 : 22) * Math.max(0.5, f.densidad), () => f.destello([p.color_acento, p.color_acento_2, '#FFF7D6']))
          .en(1.5, () => {
            const c = this.centro(raiz.querySelector('.cel-titular'));
            if (c) f.chisporroteo(c.x, c.y, 40, [p.color_acento, p.color_acento_2, '#FFFFFF']);
          });
        break;
      case 'POLAROID':
        if (!this.secuencia()) this.personas().forEach((_, i) => {
          const t = 0.35 + Math.min(i, 7) * 0.2 + 0.62;
          f.en(t, () => {
            const c = this.centro(raiz.querySelectorAll('.cel-persona')[i] ?? null);
            if (c) f.estallido(c.x, c.y, 18, 0.45);
          });
        });
        f.durante(1.6, d - 2, 10, () => f.lluvia(1));
        break;
      case 'PASTEL':
        // El confeti y el humo los dispara soplar().
        break;
    }
  }

  private soplar(): void {
    this.soplado.set(true);
    const f = this.fiesta;
    if (!f) return;
    const raiz = this.raiz().nativeElement;
    raiz.querySelectorAll('.pa-llama').forEach((l) => {
      const c = this.centro(l);
      if (c) f.humo(c.x, c.y - 4, 7);
    });
    // Con video, el pastel es el del fondo: abajo a la izquierda (horizontal) o abajo al centro.
    const torta = this.medio()
      ? (this.orientacion() === 'h' ? { x: f.w * 0.21, y: f.h * 0.5 } : { x: f.w * 0.5, y: f.h * 0.78 })
      : this.centro(raiz.querySelector('.pa-pastel svg'));
    if (torta) {
      f.canon(torta.x, torta.y, -70, 40, 90, 1.5);
      f.canon(torta.x, torta.y, -110, 40, 90, 1.5);
    }
    f.durante(f.segundos + 0.4, f.segundos + 2.4, 28 * Math.max(0.45, f.densidad), () => f.lluvia(1));
  }

  // ── varias personas: cada una al centro y luego a su puesto ─────────────────

  private esperar(ms: number): Promise<void> {
    return new Promise((r) => this.reloj(r, ms));
  }

  private trasPintar(): Promise<void> {
    return new Promise((r) => afterNextRender(() => r(), { injector: this.injector }));
  }

  /** Escala de la escena en pantalla (el probador la muestra reducida). */
  private escala(): number {
    const raiz = this.raiz().nativeElement;
    return raiz.offsetWidth ? raiz.getBoundingClientRect().width / raiz.offsetWidth : 1;
  }

  private async correrTurnos(d: number): Promise<void> {
    const raiz = this.raiz().nativeElement;
    const personas = this.personas();
    const paso = this.paso();
    await this.esperar(INICIO_TURNOS * 1000);
    for (let i = 0; i < personas.length; i++) {
      if (this.muerta || this.cerrando) return;
      this.turno.set({ p: personas[i], i });
      this.fondoActivo.set(personas[i].fondo ? i : -1);
      await this.trasPintar();
      const el = raiz.querySelector<HTMLElement>('.cel-turno');
      const destino = raiz.querySelectorAll<HTMLElement>('.cel-persona')[i];
      if (!el || !destino) continue;
      this.ubicarTurno(el);
      this.entrada(el);
      const c = this.centro(el.querySelector('.cel-marco'));
      if (c) this.rafagaTurno(c.x, c.y);
      await this.esperar(Math.max(250, (paso - VUELO) * 1000));
      if (this.muerta || this.cerrando) return;
      await this.volar(el, destino);
      destino.classList.add('cel-persona--llego');
      const llegada = this.centro(destino.querySelector('.cel-marco'));
      if (llegada) this.fiesta?.estallido(llegada.x, llegada.y, 12, 0.32);
      this.turno.set(null);
    }
    if (this.muerta || this.cerrando) return;
    this.fondoActivo.set(-1);
    this.final.set(true);
    this.rafagaFinal();
    void d;
  }

  /**
   * La tarjeta grande va al centro del espacio de la cuadrícula, siempre DEBAJO del título
   * (no lo tapa) y sin salirse por abajo: si no cabe, se encoge la foto.
   */
  private ubicarTurno(el: HTMLElement): void {
    const raiz = this.raiz().nativeElement;
    const k = this.escala();
    const base = raiz.getBoundingClientRect();
    const altoEscena = base.height / k;
    const titulo = raiz.querySelector('.cel-titular')?.getBoundingClientRect();
    const minArriba = titulo ? (titulo.bottom - base.top) / k + 10 : 12;
    let alto = el.getBoundingClientRect().height / k;
    const disponible = altoEscena - minArriba - 16;
    if (alto > disponible) {
      const foto = (el.querySelector('.cel-marco')?.getBoundingClientRect().width ?? 0) / k;
      if (foto) {
        el.style.setProperty('--foto', `${Math.max(90, foto - (alto - disponible))}px`);
        alto = el.getBoundingClientRect().height / k;
      }
    }
    const grid = raiz.querySelector('.cel-personas')?.getBoundingClientRect();
    let cy = grid ? (grid.top - base.top + grid.height / 2) / k : altoEscena * 0.58;
    cy = Math.max(cy, minArriba + alto / 2);
    cy = Math.min(cy, altoEscena - alto / 2 - 12);
    el.style.left = `${(base.width / k) / 2}px`;
    el.style.top = `${cy}px`;
  }

  /** La entrada de cada plantilla. */
  private entrada(el: HTMLElement): void {
    const altoEscena = this.raiz().nativeElement.offsetHeight || 800;
    const rebote = 'cubic-bezier(.34,1.56,.64,1)';
    let k: Keyframe[];
    let o: KeyframeAnimationOptions = { duration: 620, easing: rebote };
    switch (this.anim()) {
      case 'GLOBOS':
        k = [{ transform: `translateY(${altoEscena * 0.55}px) rotate(-6deg)`, opacity: 0 },
          { transform: 'translateY(-14px) rotate(3deg)', opacity: 1, offset: 0.75 }, { transform: 'none', opacity: 1 }];
        o = { duration: 760, easing: 'cubic-bezier(.22,.9,.3,1)' };
        break;
      case 'FUEGOS':
        k = [{ transform: 'scale(.55)', opacity: 0, filter: 'brightness(3) blur(8px)' },
          { transform: 'scale(1.06)', opacity: 1, filter: 'brightness(1.4) blur(0)', offset: 0.6 }, { transform: 'none', opacity: 1, filter: 'none' }];
        o = { duration: 640, easing: 'ease-out' };
        break;
      case 'GALA':
        k = [{ transform: 'perspective(1000px) rotateY(-100deg) scale(.9)', opacity: 0 },
          { transform: 'perspective(1000px) rotateY(10deg)', opacity: 1, offset: 0.72 }, { transform: 'perspective(1000px) rotateY(0)', opacity: 1 }];
        o = { duration: 760, easing: 'cubic-bezier(.2,.8,.2,1)' };
        break;
      case 'POLAROID':
        k = [{ transform: `translateY(${-altoEscena * 0.6}px) rotate(-24deg) scale(1.15)`, opacity: 0 },
          { transform: 'translateY(12px) rotate(4deg)', opacity: 1, offset: 0.7 }, { transform: 'rotate(-2deg)', opacity: 1 }];
        o = { duration: 700, easing: 'cubic-bezier(.3,1.25,.5,1)', fill: 'forwards' };
        break;
      case 'PASTEL':
        k = [{ transform: 'scale(.3) translateY(60px)', opacity: 0 }, { transform: 'scale(1.07)', opacity: 1, offset: 0.65 },
          { transform: 'none', opacity: 1 }];
        break;
      default: // CONFETI
        k = [{ transform: 'scale(.2) rotate(-14deg)', opacity: 0 }, { transform: 'scale(1.08) rotate(2deg)', opacity: 1, offset: 0.7 },
          { transform: 'none', opacity: 1 }];
    }
    el.animate(k, o);
  }

  private rafagaTurno(x: number, y: number): void {
    const f = this.fiesta;
    if (!f) return;
    const p = this.plantilla();
    switch (this.anim()) {
      case 'FUEGOS': f.fuegoEn(x, y - 20, ['PEONIA', 'CRISANTEMO', 'ANILLO'][(Math.random() * 3) | 0] as TipoFuego); break;
      case 'GALA': f.chisporroteo(x, y, 46, [p.color_acento, p.color_acento_2, '#FFFFFF']); break;
      case 'GLOBOS': f.estallido(x, y, 26, 0.5); break;
      case 'POLAROID': f.estallido(x, y, 22, 0.45); break;
      default: f.estallido(x, y, 46, 0.75);
    }
  }

  private rafagaFinal(): void {
    const f = this.fiesta;
    if (!f) return;
    const p = this.plantilla();
    switch (this.anim()) {
      case 'FUEGOS':
        f.cohete(0.2, 0.22, 'SAUCE'); f.cohete(0.5, 0.14, 'CRISANTEMO'); f.cohete(0.8, 0.22, 'SAUCE');
        break;
      case 'GALA': {
        const c = this.centro(this.raiz().nativeElement.querySelector('.cel-titular'));
        if (c) f.chisporroteo(c.x, c.y, 60, [p.color_acento, p.color_acento_2, '#FFFFFF']);
        f.durante(f.segundos, f.segundos + 1.6, 30, () => f.destello([p.color_acento, p.color_acento_2, '#FFF7D6']));
        break;
      }
      case 'PASTEL':
        this.soplar();
        break;
      case 'POLAROID':
        this.raiz().nativeElement.querySelectorAll('.cel-persona').forEach((li) => {
          const c = this.centro(li);
          if (c) f.estallido(c.x, c.y, 10, 0.35);
        });
        break;
      default:
        f.canon(0, f.h, -62, 34, 110, 1.7);
        f.canon(f.w, f.h, -118, 34, 110, 1.7);
    }
  }

  /** FLIP: del centro a su puesto en la cuadrícula, encogiéndose hasta el tamaño final. */
  private volar(el: HTMLElement, destino: HTMLElement): Promise<void> {
    const k = this.escala();
    const desde = el.querySelector('.cel-marco')?.getBoundingClientRect();
    const hasta = destino.querySelector('.cel-marco')?.getBoundingClientRect();
    if (!desde || !hasta || !desde.width) return Promise.resolve();
    const caja = el.getBoundingClientRect();
    el.style.transformOrigin = `${(desde.left - caja.left + desde.width / 2) / k}px ${(desde.top - caja.top + desde.height / 2) / k}px`;
    const dx = (hasta.left + hasta.width / 2 - (desde.left + desde.width / 2)) / k;
    const dy = (hasta.top + hasta.height / 2 - (desde.top + desde.height / 2)) / k;
    const s = hasta.width / desde.width;
    el.querySelector('.cel-turno__pie')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    el.querySelector('.cel-turno__halo')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    const giro = this.anim() === 'POLAROID' ? ` rotate(${this.inclinacion(Number(destino.style.getPropertyValue('--i')) || 0) + 2}deg)` : '';
    const a = el.animate(
      [{ transform: getComputedStyle(el).transform === 'none' ? 'none' : getComputedStyle(el).transform },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})${giro}` }],
      { duration: VUELO * 1000, easing: 'cubic-bezier(.6,0,.25,1)', fill: 'forwards' });
    return a.finished.then(() => undefined, () => undefined);
  }

  private limpiar(): void {
    this.muerta = true;
    this.relojes.forEach(clearTimeout);
    this.relojes = [];
    this.observador?.disconnect();
    this.fiesta?.detener();
    this.fiesta = null;
    if (this.modo() === 'pantalla' && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.alTeclado);
      document.body.style.overflow = this.overflowPrevio;
      if (this.foco instanceof HTMLElement && document.contains(this.foco)) this.foco.focus({ preventScroll: true });
    }
  }
}

/** Segundos antes de la primera persona (deja entrar el título). */
const INICIO_TURNOS = 0.9;
/** Segundos del vuelo al puesto. */
const VUELO = 0.42;
/** Segundos del cierre: la ola, el mensaje y la ráfaga final. */
const FINAL = 2.6;

/** Columnas de la cuadrícula de personas: filas parejas, nunca una persona sola abajo. */
function columnas(n: number, movil: boolean): number {
  if (n <= 1) return 1;
  if (movil) return n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : n === 9 ? 3 : 4;
  return n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : 6;
}

/** Una silueta de ciudad al azar (edificios con azoteas distintas) y sus ventanas. */
function crearCiudad(): { silueta: string; ventanas: { x: number; y: number; retraso: number }[] } {
  let x = 0;
  let d = 'M0 160 ';
  const ventanas: { x: number; y: number; retraso: number }[] = [];
  while (x < 1000) {
    const ancho = rnd(34, 82);
    const alto = rnd(36, 128);
    const techo = 160 - alto;
    d += `L${x.toFixed(0)} ${techo.toFixed(0)} `;
    if (Math.random() < 0.25) {
      // Torre con antena.
      const m = x + ancho / 2;
      d += `L${(m - 4).toFixed(0)} ${techo.toFixed(0)} L${m.toFixed(0)} ${(techo - 22).toFixed(0)} L${(m + 4).toFixed(0)} ${techo.toFixed(0)} `;
    }
    d += `L${(x + ancho).toFixed(0)} ${techo.toFixed(0)} `;
    for (let wy = techo + 10; wy < 150; wy += 14) {
      for (let wx = x + 8; wx < x + ancho - 10; wx += 13) {
        if (Math.random() < 0.3) ventanas.push({ x: Math.round(wx), y: Math.round(wy), retraso: rnd(0.2, 4) });
      }
    }
    x += ancho + rnd(-2, 6);
  }
  d += 'L1000 160 Z';
  return { silueta: d, ventanas: ventanas.slice(0, 140) };
}

/** Banderines colgando de una cuerda curva (la misma curva del SVG). */
function crearBanderines(): { d: string; i: number; retraso: number }[] {
  const curva = (t: number) => {
    // Q(250,70) de 0 a 500 y su reflejo de 500 a 1000 (T): aproximación por tramos.
    if (t <= 0.5) {
      const u = t / 0.5;
      return (1 - u) * (1 - u) * 18 + 2 * (1 - u) * u * 70 + u * u * 22;
    }
    const u = (t - 0.5) / 0.5;
    return (1 - u) * (1 - u) * 22 + 2 * (1 - u) * u * -26 + u * u * 18;
  };
  const r: { d: string; i: number; retraso: number }[] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.15) / n, t1 = (i + 0.85) / n;
    const x0 = t0 * 1000, x1 = t1 * 1000, y0 = curva(t0), y1 = curva(t1);
    const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2 + 46;
    r.push({ d: `M${x0.toFixed(0)} ${y0.toFixed(0)} L${x1.toFixed(0)} ${y1.toFixed(0)} L${xm.toFixed(0)} ${ym.toFixed(0)} Z`, i, retraso: -rnd(0, 2) });
  }
  return r;
}

/** Granas de colores sobre un piso del pastel. */
function granasEn(x: number, y: number, ancho: number, alto: number, n: number) {
  return Array.from({ length: n }, () => ({
    x: Math.round(x + rnd(6, ancho - 6)), y: Math.round(y + rnd(4, alto - 4)), r: Math.round(rnd(0, 180)), c: (Math.random() * 5) | 0,
  }));
}
