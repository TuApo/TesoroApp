/**
 * Motor de partículas de la celebración: confeti, fuegos artificiales, destellos dorados,
 * bokeh y humo, todo en UN canvas y UN requestAnimationFrame.
 *
 * Sin librerías a propósito: canvas-confetti o tsParticles pesan más que toda la escena y
 * no hacen fuegos con estela ni humo. Las velocidades y la gravedad van en fracciones del
 * ALTO del lienzo, así que la misma ráfaga se ve igual en un celular que en un televisor.
 *
 * Presupuesto: un tope de piezas vivas que baja con el área (en un celular de gama baja
 * 900 piezas con sombra hacen tartamudear la animación) y un devicePixelRatio de 2 como
 * mucho.
 */

type Forma = 0 | 1 | 2 | 3; // rectángulo, círculo, cinta, estrella de 4 puntas

interface Pieza {
  x: number; y: number; vx: number; vy: number;
  ancho: number; alto: number; color: string; forma: Forma;
  giro: number; vgiro: number; fase: number; vfase: number;
  vaiven: number; avaiven: number;
  vida: number; alfa: number; brillo: boolean;
  /** Arrastre propio: el destello dorado cae más despacio que el confeti. */
  arrastre: number; gravedad: number;
}

interface Chispa {
  x: number; y: number; px: number; py: number; vx: number; vy: number;
  vida: number; vidaMax: number; color: string; tam: number;
  arrastre: number; gravedad: number; parpadeo: boolean;
  /** Segundos hasta partirse en cuatro (crisantemo con "crossette"). <0 = no se parte. */
  partir: number;
}

interface Cohete {
  x: number; y: number; vx: number; vy: number; objetivo: number; color: string; tipo: TipoFuego;
  estela: { x: number; y: number }[];
}

interface Burbuja { x: number; y: number; r: number; vx: number; vy: number; color: string; alfa: number; fase: number; vfase: number }

interface Humo { x: number; y: number; r: number; vx: number; vy: number; vida: number; vidaMax: number }

export type TipoFuego = 'PEONIA' | 'ANILLO' | 'SAUCE' | 'CRISANTEMO' | 'PALMERA';

interface Emisor { desde: number; hasta: number; porSegundo: number; acumulado: number; fn: () => void }

export interface OpcionesFiesta {
  /** Colores de la marca/plantilla. Se mezclan con blancos y dorados. */
  paleta: string[];
  /** true = el lienzo se desvanece en vez de borrarse: deja estela (fuegos artificiales). */
  estelas?: boolean;
}

const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const elegir = <T>(l: readonly T[]): T => l[(Math.random() * l.length) | 0];

export class Fiesta {
  private readonly ctx: CanvasRenderingContext2D;
  private ancho = 0;
  private alto = 0;
  private dpr = 1;
  /** 1 = un escritorio de 1440×900. Escala cuántas piezas se lanzan. */
  densidad = 1;
  private tope = 900;

  private piezas: Pieza[] = [];
  private chispas: Chispa[] = [];
  private cohetes: Cohete[] = [];
  private burbujas: Burbuja[] = [];
  private humos: Humo[] = [];
  private emisores: Emisor[] = [];
  private agenda: { t: number; fn: () => void }[] = [];

  private raf = 0;
  private t = 0;
  private ultimo = 0;
  private corriendo = false;
  private sprite: HTMLCanvasElement | null = null;

  constructor(private readonly lienzo: HTMLCanvasElement, private readonly op: OpcionesFiesta) {
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('sin canvas 2d');
    this.ctx = ctx;
  }

  /** Tiempo de la animación en segundos (para que la escena sincronice el DOM con el lienzo). */
  get segundos(): number { return this.t; }
  get w(): number { return this.ancho; }
  get h(): number { return this.alto; }

  medir(ancho: number, alto: number): void {
    const movil = Math.min(ancho, alto) < 600;
    this.dpr = Math.min(window.devicePixelRatio || 1, movil ? 1.5 : 2);
    this.ancho = Math.max(1, ancho);
    this.alto = Math.max(1, alto);
    this.lienzo.width = Math.round(this.ancho * this.dpr);
    this.lienzo.height = Math.round(this.alto * this.dpr);
    this.densidad = Math.max(0.35, Math.min(1.25, (this.ancho * this.alto) / (1440 * 900)));
    this.tope = Math.round(movil ? 420 : 900 * Math.min(1, this.densidad + 0.2));
  }

  /** Ejecuta `fn` a los `t` segundos de empezar. */
  en(t: number, fn: () => void): this {
    this.agenda.push({ t, fn });
    this.agenda.sort((a, b) => a.t - b.t);
    return this;
  }

  /** Llama a `fn` `porSegundo` veces por segundo entre `desde` y `hasta`. */
  durante(desde: number, hasta: number, porSegundo: number, fn: () => void): this {
    this.emisores.push({ desde, hasta, porSegundo, acumulado: 0, fn });
    return this;
  }

  iniciar(): void {
    if (this.corriendo) return;
    this.corriendo = true;
    this.ultimo = performance.now();
    const paso = (ahora: number) => {
      if (!this.corriendo) return;
      // Tope de 50 ms: al volver de otra pestaña no puede dar un salto de varios segundos.
      const dt = Math.min(0.05, (ahora - this.ultimo) / 1000);
      this.ultimo = ahora;
      this.avanzar(dt);
      this.dibujar();
      this.raf = requestAnimationFrame(paso);
    };
    this.raf = requestAnimationFrame(paso);
  }

  detener(): void {
    this.corriendo = false;
    cancelAnimationFrame(this.raf);
    this.piezas = []; this.chispas = []; this.cohetes = []; this.burbujas = []; this.humos = [];
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.lienzo.width, this.lienzo.height);
  }

  // ── confeti ────────────────────────────────────────────────────────────────

  private colorPieza(): string {
    return Math.random() < 0.14 ? elegir(['#FFFFFF', '#FFE08A', '#FFD34D']) : elegir(this.op.paleta);
  }

  private hayCupo(n: number): number {
    return Math.max(0, Math.min(n, this.tope - this.piezas.length));
  }

  /**
   * Un cañonazo desde (x, y) hacia `angulo` (grados, 0 = derecha, -90 = arriba) con una
   * `apertura` en grados. `fuerza` en altos de lienzo por segundo.
   */
  canon(x: number, y: number, angulo: number, apertura: number, n: number, fuerza = 1.6): void {
    const h = this.alto;
    const total = this.hayCupo(Math.round(n * this.densidad));
    for (let i = 0; i < total; i++) {
      const a = ((angulo + rnd(-apertura / 2, apertura / 2)) * Math.PI) / 180;
      const v = rnd(0.55, 1) * fuerza * h;
      this.piezas.push(this.pieza(x + rnd(-8, 8), y + rnd(-8, 8), Math.cos(a) * v, Math.sin(a) * v));
    }
  }

  /** Estallido en todas direcciones (velas sopladas, una polaroid que aterriza). */
  estallido(x: number, y: number, n: number, fuerza = 0.9): void {
    const total = this.hayCupo(Math.round(n * Math.max(0.6, this.densidad)));
    for (let i = 0; i < total; i++) {
      const a = rnd(0, TAU);
      const v = rnd(0.25, 1) * fuerza * this.alto;
      this.piezas.push(this.pieza(x, y, Math.cos(a) * v, Math.sin(a) * v - 0.25 * this.alto));
    }
  }

  /** Confeti que cae desde arriba de la pantalla. */
  lluvia(n = 1): void {
    const total = this.hayCupo(n);
    for (let i = 0; i < total; i++) {
      const p = this.pieza(rnd(-20, this.ancho + 20), rnd(-60, -10), rnd(-30, 30), rnd(40, 120));
      this.piezas.push(p);
    }
  }

  private pieza(x: number, y: number, vx: number, vy: number): Pieza {
    const escala = Math.max(0.7, Math.min(1.25, this.alto / 900));
    const forma = elegir([0, 0, 0, 1, 2, 2, 3] as Forma[]);
    const largo = forma === 2 ? rnd(14, 24) : rnd(7, 13);
    return {
      x, y, vx, vy, forma, color: this.colorPieza(),
      ancho: (forma === 2 ? rnd(3, 4.5) : rnd(6, 11)) * escala,
      alto: largo * escala,
      giro: rnd(0, TAU), vgiro: rnd(-7, 7), fase: rnd(0, TAU), vfase: rnd(5, 13),
      vaiven: rnd(0, TAU), avaiven: rnd(18, 46) * escala,
      vida: 0, alfa: 1, brillo: Math.random() < 0.08,
      arrastre: rnd(2.2, 3), gravedad: 0.52,
    };
  }

  // ── destellos dorados y bokeh (gala) ───────────────────────────────────────

  /** Brillo dorado que cae despacio girando y titilando. */
  destello(colores: string[]): void {
    if (this.piezas.length >= this.tope) return;
    const escala = Math.max(0.7, Math.min(1.25, this.alto / 900));
    const t = rnd(3, 7.5) * escala;
    this.piezas.push({
      x: rnd(0, this.ancho), y: rnd(-30, -6), vx: rnd(-12, 12), vy: rnd(30, 80),
      forma: Math.random() < 0.55 ? 3 : 1, color: elegir(colores),
      ancho: t, alto: t, giro: rnd(0, TAU), vgiro: rnd(-2.5, 2.5), fase: rnd(0, TAU), vfase: rnd(3, 7),
      vaiven: rnd(0, TAU), avaiven: rnd(8, 22), vida: 0, alfa: 1, brillo: true,
      arrastre: 0.8, gravedad: 0.03,
    });
  }

  /** Círculos desenfocados que suben despacio: la luz de un salón. */
  bokeh(n: number, colores: string[]): void {
    const total = Math.round(n * Math.max(0.5, this.densidad));
    for (let i = 0; i < total; i++) {
      this.burbujas.push({
        x: rnd(0, this.ancho), y: rnd(0, this.alto), r: rnd(18, 72) * Math.max(0.7, this.alto / 900),
        vx: rnd(-6, 6), vy: rnd(-18, -5), color: elegir(colores), alfa: rnd(0.05, 0.16),
        fase: rnd(0, TAU), vfase: rnd(0.4, 1.2),
      });
    }
  }

  /** Chispitas que salen de un punto (alrededor del titular, al terminar de escribirse). */
  chisporroteo(x: number, y: number, n: number, colores: string[]): void {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU);
      const v = rnd(0.05, 0.22) * this.alto;
      this.chispas.push({
        x, y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: 0, vidaMax: rnd(0.5, 1.1),
        color: elegir(colores), tam: rnd(1.2, 2.4), arrastre: 2.2, gravedad: 0.05, parpadeo: true, partir: -1,
      });
    }
  }

  // ── fuegos artificiales ────────────────────────────────────────────────────

  /** Lanza un cohete desde abajo en `xFrac` (0-1) que estalla a `yFrac` (0 = arriba). */
  cohete(xFrac: number, yFrac: number, tipo: TipoFuego, color?: string): void {
    const g = 0.5 * this.alto;
    const x = xFrac * this.ancho;
    const objetivo = Math.max(0.08, yFrac) * this.alto;
    const dy = this.alto - objetivo;
    this.cohetes.push({
      x, y: this.alto + 6, vx: rnd(-0.03, 0.03) * this.alto, vy: -Math.sqrt(2 * g * dy) * 1.02,
      objetivo, tipo, color: color ?? elegir(this.op.paleta), estela: [],
    });
  }

  /** Un fuego artificial que estalla ya en (x, y), sin cohete (la entrada de una persona). */
  fuegoEn(x: number, y: number, tipo: TipoFuego, color?: string): void {
    this.estallar({ x, y, vx: 0, vy: 0, objetivo: y, tipo, color: color ?? elegir(this.op.paleta), estela: [] });
  }

  private estallar(c: Cohete): void {
    const h = this.alto;
    const dorado = ['#FFD27A', '#FFE7A8', '#FFC14D'];
    const otro = elegir(this.op.paleta.filter((x) => x !== c.color).concat(['#FFFFFF']));
    const nBase = Math.round((this.densidad < 0.6 ? 55 : 85) * Math.min(1.2, 0.6 + this.densidad));
    const chispa = (a: number, v: number, color: string, extra: Partial<Chispa> = {}) => {
      this.chispas.push({
        x: c.x, y: c.y, px: c.x, py: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        vida: 0, vidaMax: rnd(1.1, 1.8), color, tam: rnd(1.4, 2.4), arrastre: 1.25, gravedad: 0.22,
        parpadeo: Math.random() < 0.3, partir: -1, ...extra,
      });
    };
    switch (c.tipo) {
      case 'ANILLO': {
        const n = Math.round(nBase * 0.8);
        const v = 0.27 * h;
        const inclinacion = rnd(0.45, 1);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          this.chispas.push({
            x: c.x, y: c.y, px: c.x, py: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * inclinacion,
            vida: 0, vidaMax: rnd(1.2, 1.6), color: c.color, tam: 2, arrastre: 1.2, gravedad: 0.2, parpadeo: false, partir: -1,
          });
        }
        for (let i = 0; i < n / 3; i++) chispa(rnd(0, TAU), rnd(0.02, 0.09) * h, '#FFFFFF', { vidaMax: 0.9 });
        break;
      }
      case 'SAUCE':
        for (let i = 0; i < nBase; i++) {
          chispa(rnd(0, TAU), rnd(0.1, 0.24) * h, elegir(dorado),
            { vidaMax: rnd(2.2, 3), arrastre: 0.95, gravedad: 0.17, tam: rnd(1.2, 2), parpadeo: true });
        }
        break;
      case 'CRISANTEMO':
        for (let i = 0; i < nBase; i++) {
          chispa(rnd(0, TAU), rnd(0.16, 0.3) * h, i % 2 ? c.color : otro, { partir: Math.random() < 0.18 ? rnd(0.45, 0.7) : -1 });
        }
        break;
      case 'PALMERA':
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU + rnd(-0.1, 0.1);
          for (let k = 0; k < 7; k++) {
            chispa(a + rnd(-0.04, 0.04), (0.18 + k * 0.018) * h, elegir(dorado), { vidaMax: rnd(1.6, 2.2), arrastre: 1, tam: 2.2 });
          }
        }
        break;
      default: // PEONIA
        for (let i = 0; i < nBase; i++) chispa(rnd(0, TAU), Math.sqrt(Math.random()) * 0.3 * h, c.color);
        for (let i = 0; i < nBase / 4; i++) chispa(rnd(0, TAU), rnd(0.05, 0.14) * h, otro, { vidaMax: 1 });
    }
    // Destello del estallido: un círculo blanco que dura un instante.
    this.burbujas.push({ x: c.x, y: c.y, r: 0.06 * h, vx: 0, vy: 0, color: '#FFFFFF', alfa: 0.55, fase: -1, vfase: 0 });
  }

  // ── humo (velas sopladas) ──────────────────────────────────────────────────

  humo(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      this.humos.push({
        x: x + rnd(-3, 3), y: y - i * 3, r: rnd(4, 7), vx: rnd(-8, 8), vy: rnd(-46, -28),
        vida: -i * 0.07, vidaMax: rnd(0.9, 1.4),
      });
    }
  }

  // ── bucle ──────────────────────────────────────────────────────────────────

  private avanzar(dt: number): void {
    this.t += dt;
    while (this.agenda.length && this.agenda[0].t <= this.t) this.agenda.shift()!.fn();
    for (const e of this.emisores) {
      if (this.t < e.desde || this.t > e.hasta) continue;
      e.acumulado += e.porSegundo * dt;
      while (e.acumulado >= 1) { e.acumulado -= 1; e.fn(); }
    }

    const h = this.alto;
    const vivas: Pieza[] = [];
    for (const p of this.piezas) {
      const k = Math.exp(-p.arrastre * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.gravedad * h * dt;
      p.vaiven += dt * 2.4;
      // El vaivén solo se nota cuando ya cae despacio, como un papel de verdad.
      const lento = Math.max(0, 1 - Math.abs(p.vy) / (0.6 * h));
      p.x += (p.vx + Math.sin(p.vaiven) * p.avaiven * lento) * dt;
      p.y += p.vy * dt;
      p.giro += p.vgiro * dt;
      p.fase += p.vfase * dt;
      p.vida += dt;
      if (p.y > h + 40 || p.x < -80 || p.x > this.ancho + 80) continue;
      vivas.push(p);
    }
    this.piezas = vivas;

    const cohetes: Cohete[] = [];
    for (const c of this.cohetes) {
      c.estela.push({ x: c.x, y: c.y });
      if (c.estela.length > 10) c.estela.shift();
      c.vy += 0.5 * h * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.y <= c.objetivo || c.vy >= -0.04 * h) this.estallar(c);
      else cohetes.push(c);
    }
    this.cohetes = cohetes;

    const chispas: Chispa[] = [];
    for (const s of this.chispas) {
      s.px = s.x; s.py = s.y;
      const k = Math.exp(-s.arrastre * dt);
      s.vx *= k;
      s.vy = s.vy * k + s.gravedad * h * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vida += dt;
      if (s.partir > 0 && s.vida >= s.partir) {
        s.partir = -1;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + rnd(0, 0.6);
          const v = 0.08 * h;
          chispas.push({ ...s, px: s.x, py: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: 0, vidaMax: 0.7, tam: 1.4, color: '#FFFFFF' });
        }
        continue;
      }
      if (s.vida < s.vidaMax) chispas.push(s);
    }
    this.chispas = chispas;

    const burbujas: Burbuja[] = [];
    for (const b of this.burbujas) {
      if (b.fase < 0) {
        // Destello de estallido: se apaga en ~0.2 s.
        b.alfa -= dt * 3;
        if (b.alfa > 0) burbujas.push(b);
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.fase += b.vfase * dt;
      if (b.y < -b.r) b.y = this.alto + b.r;
      burbujas.push(b);
    }
    this.burbujas = burbujas;

    this.humos = this.humos.filter((m) => {
      m.vida += dt;
      if (m.vida < 0) return true;
      m.x += m.vx * dt + Math.sin(m.vida * 3 + m.r) * 6 * dt;
      m.y += m.vy * dt;
      m.r += 10 * dt;
      return m.vida < m.vidaMax;
    });
  }

  private dibujar(): void {
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (this.op.estelas) {
      // Se borra a medias: lo de antes se desvanece y deja la estela del fuego artificial.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.fillRect(0, 0, this.ancho, this.alto);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, this.ancho, this.alto);
    }

    // Bokeh y destellos de estallido.
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.burbujas) {
      const a = b.fase < 0 ? b.alfa : b.alfa * (0.65 + 0.35 * Math.sin(b.fase));
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, hexA(b.color, a));
      g.addColorStop(0.7, hexA(b.color, a * 0.55));
      g.addColorStop(1, hexA(b.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }

    // Cohetes subiendo.
    for (const c of this.cohetes) {
      ctx.strokeStyle = hexA('#FFE7B0', 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath();
      c.estela.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      ctx.fillStyle = '#FFF6DA';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.4, 0, TAU);
      ctx.fill();
    }

    // Chispas: una línea desde la posición anterior (velocidad visible) y un halo suave.
    ctx.lineCap = 'round';
    for (const s of this.chispas) {
      let a = 1 - s.vida / s.vidaMax;
      if (s.parpadeo) a *= 0.55 + 0.45 * Math.sin(s.vida * 38 + s.x);
      if (a <= 0.02) continue;
      ctx.strokeStyle = hexA(s.color, a);
      ctx.lineWidth = s.tam;
      ctx.beginPath();
      ctx.moveTo(s.px, s.py);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.fillStyle = hexA(s.color, a * 0.16);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.tam * 3.2, 0, TAU);
      ctx.fill();
    }

    // Humo: gris translúcido que sube y se abre.
    ctx.globalCompositeOperation = 'source-over';
    for (const m of this.humos) {
      if (m.vida < 0) continue;
      const a = 0.2 * (1 - m.vida / m.vidaMax);
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, `rgba(165,160,170,${a})`);
      g.addColorStop(1, 'rgba(165,160,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
    }

    // Confeti y destellos: giro + volteo (escala en Y por el coseno de la fase), que es lo
    // que hace que un papelito parezca dar vueltas en el aire y no deslizarse plano.
    for (const p of this.piezas) {
      const volteo = Math.cos(p.fase);
      const c = Math.cos(p.giro);
      const s = Math.sin(p.giro);
      ctx.setTransform(c * d, s * d, -s * volteo * d, c * volteo * d, p.x * d, p.y * d);
      const brillo = p.brillo ? 0.55 + 0.45 * Math.sin(p.vida * 9 + p.x) : 1;
      ctx.globalAlpha = Math.max(0.15, (0.7 + 0.3 * Math.abs(volteo)) * brillo);
      ctx.fillStyle = p.color;
      switch (p.forma) {
        case 1:
          ctx.beginPath();
          ctx.arc(0, 0, p.ancho / 2, 0, TAU);
          ctx.fill();
          break;
        case 2:
          // Cinta: una tira ondulada.
          ctx.beginPath();
          ctx.moveTo(-p.alto / 2, 0);
          ctx.quadraticCurveTo(-p.alto / 4, -p.ancho * 2, 0, 0);
          ctx.quadraticCurveTo(p.alto / 4, p.ancho * 2, p.alto / 2, 0);
          ctx.lineWidth = p.ancho;
          ctx.strokeStyle = p.color;
          ctx.stroke();
          break;
        case 3: {
          const r = p.ancho;
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.quadraticCurveTo(r * 0.18, -r * 0.18, r, 0);
          ctx.quadraticCurveTo(r * 0.18, r * 0.18, 0, r);
          ctx.quadraticCurveTo(-r * 0.18, r * 0.18, -r, 0);
          ctx.quadraticCurveTo(-r * 0.18, -r * 0.18, 0, -r);
          ctx.fill();
          break;
        }
        default:
          ctx.fillRect(-p.ancho / 2, -p.alto / 2, p.ancho, p.alto);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
}

/** '#RRGGBB' + alfa → 'rgba(...)'. Acepta también '#RGB'. */
export function hexA(hex: string, a: number): string {
  let h = (hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Aclara (+) u oscurece (−) un color en una fracción (−1 a 1). */
export function tono(hex: string, f: number): string {
  let h = (hex || '#888888').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  const mezcla = (c: number) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  const r = mezcla((n >> 16) & 255), g = mezcla((n >> 8) & 255), b = mezcla(n & 255);
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
}
