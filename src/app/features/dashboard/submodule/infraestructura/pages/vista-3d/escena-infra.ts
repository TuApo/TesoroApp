/**
 * La maqueta viva: la infraestructura de TuApo como una maqueta de arquitectura.
 *
 *  - El servidor principal es una plataforma; encima, cada zona (borde, microservicios,
 *    datos…) es un solar y cada contenedor un edificio.
 *  - Altura del edificio = memoria RESERVADA (escala logarítmica: 20 MB y 16 GB caben en
 *    la misma maqueta). El relleno sólido = la fracción de esa reserva que se USA.
 *    Sin límite, el edificio es macizo a la altura de lo que usa.
 *  - La tapa se enciende con la CPU (frío → caliente). La base dice el estado: verde,
 *    ámbar (detenido/arrancando), rojo (enfermo, reiniciando, muerto).
 *  - Los cables llevan partículas: cuántas y qué tan rápido = peticiones por segundo
 *    reales; rojas en la proporción de errores 5xx.
 *  - Cada nodo K3s que se une al clúster aparece como otra plataforma con sus pods;
 *    los equipos de la red (Server 1, NAS, Internet) son satélites.
 *
 * Nada se simula: todo sale de `aplicar(snapshot)`. Entre fotos solo se interpola.
 * three.js entra por import() dinámico desde el componente (no pesa en el bundle).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { Contenedor, Enlace, Grupo, Host, NodoK8s, Pod, Snapshot, UbicacionRemota } from '../../models/infra.models';

export type Calidad = 'alta' | 'baja';

export type Seleccion =
  | { tipo: 'contenedor'; nombre: string }
  | { tipo: 'host'; id: string }
  | { tipo: 'pod'; clave: string };

export interface InfoHover {
  titulo: string;
  lineas: string[];
  tono: 'ok' | 'warn' | 'danger' | 'neutro';
}

export interface OpcionesEscena {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  contenedor: HTMLElement;
  calidad: Calidad;
  oscuro: boolean;
  onHover: (info: InfoHover | null, x: number, y: number) => void;
  onElegir: (sel: Seleccion | null) => void;
  describir: (sel: Seleccion) => InfoHover | null;
}

export interface Filtros {
  observabilidad: boolean;
  pruebas: boolean;
}

// ── Paletas ─────────────────────────────────────────────────────────────────

interface Paleta {
  fondo: number; suelo: number; rejilla: number; rejilla2: number;
  plataforma: number; borde: number; solar: number; luzAmb: number; luzSol: number;
}
const CLARO: Paleta = {
  fondo: 0xeef2f7, suelo: 0xe4eaf2, rejilla: 0xc7d1de, rejilla2: 0xd8e0ea,
  plataforma: 0xfbfcfe, borde: 0xc4cfdd, solar: 0xf1f4f9, luzAmb: 0.95, luzSol: 1.5,
};
const OSCURO: Paleta = {
  fondo: 0x0a1120, suelo: 0x0d1729, rejilla: 0x1b2942, rejilla2: 0x132037,
  plataforma: 0x15223a, borde: 0x2a3b5c, solar: 0x1a2a46, luzAmb: 0.55, luzSol: 1.1,
};

/** Color de identidad de cada zona (paleta categórica fija, misma en toda la app). */
const COLOR_ZONA: Record<Grupo | 'k3s', number> = {
  borde: 0x2a78d6,
  nucleo: 0x4a3aa7,
  microservicio: 0x1baf7a,
  datos: 0xeb6834,
  worker: 0xe87ba4,
  'tiempo-real': 0x008300,
  frontend: 0xeda100,
  observabilidad: 0x7b8794,
  otro: 0x98a2b3,
  pruebas: 0xa0a7b4,
  k3s: 0x3987e5,
};

const NOMBRE_ZONA: Record<Grupo | 'k3s', string> = {
  borde: 'Borde', nucleo: 'Núcleo', microservicio: 'Microservicios', datos: 'Datos', worker: 'Workers',
  'tiempo-real': 'Voz y video', frontend: 'Frontends', observabilidad: 'Observabilidad', otro: 'Otros',
  pruebas: 'Fuera de producción', k3s: 'K3s',
};

const ORDEN_ZONAS: (Grupo | 'k3s')[] = [
  'borde', 'nucleo', 'frontend', 'microservicio', 'datos', 'worker', 'tiempo-real', 'k3s', 'observabilidad', 'otro', 'pruebas',
];

const COLOR_FLUJO: Record<Enlace['tipo'], number> = {
  http: 0x3987e5, db: 0xeb6834, kafka: 0x9085e9, cache: 0x1baf7a, media: 0xd55181, red: 0x8a94a6,
};

const ESTADO_COLOR = { ok: 0x0ca30c, warn: 0xfab219, danger: 0xd03b3b, neutro: 0x8a94a6 };

const CELDA = 2.7;      // separación entre edificios
const LADO = 1.55;      // planta del edificio
const ALTO_PLATAFORMA = 1.2;
const MAX_PARTICULAS = 900;

// ── Tipos internos ─────────────────────────────────────────────────────────

interface EdificioRT {
  c: Contenedor;
  grupo: THREE.Group;
  marco: THREE.LineSegments;
  relleno: THREE.Mesh;
  tapa: THREE.Mesh;
  base: THREE.Mesh;
  matRelleno: THREE.MeshStandardMaterial;
  matTapa: THREE.MeshStandardMaterial;
  matBase: THREE.MeshStandardMaterial;
  matMarco: THREE.LineBasicMaterial;
  rotulo: HTMLDivElement;
  // Objetivos y valores actuales (se interpolan entre fotos).
  pos: THREE.Vector3; posObj: THREE.Vector3;
  alto: number; altoObj: number;
  lleno: number; llenoObj: number;
  calor: number; calorObj: number;
  escala: number; escalaObj: number;
  tono: keyof typeof ESTADO_COLOR;
  saliendo: boolean;
}

interface PlataformaRT {
  id: string;
  grupo: THREE.Group;
  losa: THREE.Mesh;
  rotulo: HTMLDivElement;
  ancla: THREE.Vector3;
  ancho: number; fondo: number;
  centro: THREE.Vector3;
  centroObj: THREE.Vector3;
  escala: number; escalaObj: number;
  saliendo: boolean;
  tipo: 'servidor' | 'nodo' | 'satelite';
}

interface SolarRT {
  clave: string;
  malla: THREE.Mesh;
  franja: THREE.Mesh;
  rotulo: HTMLDivElement;
  ancla: THREE.Vector3;
}

interface PodRT {
  p: Pod;
  malla: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3; posObj: THREE.Vector3;
  escala: number; escalaObj: number;
  saliendo: boolean;
}

interface FlujoRT {
  clave: string;
  e: Enlace;
  curva: THREE.QuadraticBezierCurve3;
  linea: THREE.Line;
  mat: THREE.LineBasicMaterial;
  n: number;
  velocidad: number;
  errFrac: number;
  fase: number;
}

interface Onda {
  malla: THREE.Mesh;
  t0: number;
}

export class EscenaInfra {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly escena = new THREE.Scene();
  private readonly camara: THREE.PerspectiveCamera;
  private readonly controles: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly puntero = new THREE.Vector2(-9, -9);
  private readonly reloj = new THREE.Clock();
  private paleta: Paleta;
  private oscuro: boolean;
  private calidad: Calidad;

  private readonly mundo = new THREE.Group();
  private suelo!: THREE.Mesh;
  private rejilla!: THREE.GridHelper;
  private luzAmb!: THREE.HemisphereLight;
  private luzSol!: THREE.DirectionalLight;

  private readonly geoCaja = new THREE.BoxGeometry(1, 1, 1);
  private readonly geoMarco = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private readonly geoPod = new THREE.CylinderGeometry(0.42, 0.42, 1, 6);
  private readonly geoParticula = new THREE.SphereGeometry(0.13, 8, 6);
  private readonly geoAnillo = new THREE.RingGeometry(0.9, 1.15, 40);

  private readonly edificios = new Map<string, EdificioRT>();
  private readonly plataformas = new Map<string, PlataformaRT>();
  private readonly solares = new Map<string, SolarRT>();
  private readonly pods = new Map<string, PodRT>();
  private readonly flujos = new Map<string, FlujoRT>();
  private readonly ondas: Onda[] = [];
  private particulas!: THREE.InstancedMesh;
  private readonly colorParticula = new THREE.Color();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpV = new THREE.Vector3();

  /** Posición de "anclaje" de cada nodo del grafo (contenedor, host, internet) para los cables. */
  private readonly anclas = new Map<string, THREE.Vector3>();

  private ultimo: Snapshot | null = null;
  private filtros: Filtros = { observabilidad: true, pruebas: false };
  private verFlujos = true;
  private verEtiquetas = false;
  private enMarcha = false;
  private frame = 0;
  private hover: { sel: Seleccion; obj: THREE.Object3D } | null = null;
  private elegido: Seleccion | null = null;
  private encuadreHecho = false;
  private vueloObjetivo: { target: THREE.Vector3; pos: THREE.Vector3; t0: number } | null = null;
  private readonly obs: ResizeObserver;
  private readonly desechables: { dispose(): void }[] = [];
  private bajada: { x: number; y: number } | null = null;

  constructor(private readonly opts: OpcionesEscena) {
    this.oscuro = opts.oscuro;
    this.calidad = opts.calidad;
    this.paleta = this.oscuro ? OSCURO : CLARO;

    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.calidad === 'alta' ? 2 : 1));
    this.renderer.shadowMap.enabled = this.calidad === 'alta';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camara = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
    this.camara.position.set(0, 46, 62);

    this.controles = new OrbitControls(this.camara, opts.canvas);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    this.controles.maxPolarAngle = 1.38;
    this.controles.minDistance = 10;
    this.controles.maxDistance = 260;
    this.controles.autoRotateSpeed = 0.35;
    this.controles.screenSpacePanning = false;

    this.escena.add(this.mundo);
    this.montarAmbiente();

    const matP = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.particulas = new THREE.InstancedMesh(this.geoParticula, matP, MAX_PARTICULAS);
    this.particulas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particulas.count = 0;
    this.particulas.frustumCulled = false;
    this.mundo.add(this.particulas);
    this.desechables.push(matP);

    opts.canvas.addEventListener('pointermove', this.alMover);
    opts.canvas.addEventListener('pointerleave', this.alSalir);
    opts.canvas.addEventListener('pointerdown', this.alBajar);
    opts.canvas.addEventListener('pointerup', this.alSubir);
    document.addEventListener('visibilitychange', this.alVisibilidad);

    this.obs = new ResizeObserver(() => this.redimensionar());
    this.obs.observe(opts.contenedor);
    this.redimensionar();
  }

  // ── API pública ────────────────────────────────────────────────────────

  arrancar(): void {
    if (this.enMarcha) return;
    this.enMarcha = true;
    this.reloj.getDelta();
    const bucle = () => {
      if (!this.enMarcha) return;
      this.frame = requestAnimationFrame(bucle);
      this.tic();
    };
    this.frame = requestAnimationFrame(bucle);
  }

  pausar(): void {
    this.enMarcha = false;
    cancelAnimationFrame(this.frame);
  }

  configurar(c: { flujos?: boolean; etiquetas?: boolean; rotacion?: boolean; calidad?: Calidad; oscuro?: boolean }): void {
    if (c.flujos != null) {
      this.verFlujos = c.flujos;
      this.flujos.forEach((f) => (f.linea.visible = c.flujos!));
      this.particulas.visible = c.flujos;
    }
    if (c.etiquetas != null) this.verEtiquetas = c.etiquetas;
    if (c.rotacion != null) this.controles.autoRotate = c.rotacion;
    if (c.calidad && c.calidad !== this.calidad) {
      this.calidad = c.calidad;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, c.calidad === 'alta' ? 2 : 1));
      this.renderer.shadowMap.enabled = c.calidad === 'alta';
      this.luzSol.castShadow = c.calidad === 'alta';
      this.escena.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
      this.redimensionar();
    }
    if (c.oscuro != null && c.oscuro !== this.oscuro) {
      this.oscuro = c.oscuro;
      this.paleta = c.oscuro ? OSCURO : CLARO;
      this.aplicarPaleta();
    }
  }

  aplicar(s: Snapshot, filtros: Filtros): void {
    this.ultimo = s;
    this.filtros = filtros;
    this.reconstruir();
  }

  /** Onda expansiva sobre un contenedor (reinicio, OOM, caída…). */
  destello(nombre: string, severidad: string): void {
    const e = this.edificios.get(nombre);
    if (!e) return;
    const color = severidad === 'critico' || severidad === 'serio' ? ESTADO_COLOR.danger
      : severidad === 'atencion' ? ESTADO_COLOR.warn : ESTADO_COLOR.ok;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const malla = new THREE.Mesh(this.geoAnillo, mat);
    malla.rotation.x = -Math.PI / 2;
    malla.position.copy(e.pos).setY(ALTO_PLATAFORMA + 0.08);
    this.mundo.add(malla);
    this.ondas.push({ malla, t0: performance.now() });
  }

  enfocar(sel: Seleccion): void {
    const p = this.posicionDe(sel);
    if (!p) return;
    this.elegido = sel;
    const dir = this.camara.position.clone().sub(this.controles.target).normalize();
    const dist = sel.tipo === 'host' ? 34 : 18;
    this.vueloObjetivo = { target: p.clone(), pos: p.clone().addScaledVector(dir, dist), t0: performance.now() };
    this.resaltar();
  }

  vistaGeneral(): void {
    this.elegido = null;
    this.resaltar();
    const tam = this.tamMundo();
    const dist = Math.max(36, tam * 0.78);
    this.vueloObjetivo = {
      target: new THREE.Vector3(0, 0, 0),
      pos: new THREE.Vector3(0, dist * 0.62, dist * 0.82),
      t0: performance.now(),
    };
  }

  redimensionar(): void {
    const r = this.opts.contenedor.getBoundingClientRect();
    const w = Math.max(10, r.width);
    const h = Math.max(10, r.height);
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
  }

  destruir(): void {
    this.pausar();
    this.obs.disconnect();
    const c = this.opts.canvas;
    c.removeEventListener('pointermove', this.alMover);
    c.removeEventListener('pointerleave', this.alSalir);
    c.removeEventListener('pointerdown', this.alBajar);
    c.removeEventListener('pointerup', this.alSubir);
    document.removeEventListener('visibilitychange', this.alVisibilidad);
    this.controles.dispose();
    for (const e of this.edificios.values()) this.tirarEdificio(e);
    for (const p of this.plataformas.values()) this.tirarPlataforma(p);
    for (const s of this.solares.values()) this.tirarSolar(s);
    for (const p of this.pods.values()) { p.mat.dispose(); this.mundo.remove(p.malla); }
    for (const f of this.flujos.values()) this.tirarFlujo(f);
    for (const o of this.ondas) { (o.malla.material as THREE.Material).dispose(); }
    [this.geoCaja, this.geoMarco, this.geoPod, this.geoParticula, this.geoAnillo].forEach((g) => g.dispose());
    this.desechables.forEach((d) => d.dispose());
    this.opts.hud.innerHTML = '';
    this.renderer.dispose();
  }

  // ── Ambiente ───────────────────────────────────────────────────────────

  private montarAmbiente(): void {
    const p = this.paleta;
    this.escena.background = new THREE.Color(p.fondo);
    this.escena.fog = new THREE.Fog(p.fondo, 140, 420);

    this.luzAmb = new THREE.HemisphereLight(0xffffff, p.suelo, p.luzAmb);
    this.escena.add(this.luzAmb);
    this.luzSol = new THREE.DirectionalLight(0xffffff, p.luzSol);
    this.luzSol.position.set(-40, 70, 35);
    this.luzSol.castShadow = this.calidad === 'alta';
    this.luzSol.shadow.mapSize.set(2048, 2048);
    const sc = this.luzSol.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.far = 260;
    this.luzSol.shadow.bias = -0.0005;
    this.escena.add(this.luzSol);

    const matSuelo = new THREE.MeshStandardMaterial({ color: p.suelo, roughness: 1, metalness: 0 });
    this.suelo = new THREE.Mesh(new THREE.CircleGeometry(400, 64), matSuelo);
    this.suelo.rotation.x = -Math.PI / 2;
    this.suelo.position.y = -0.02;
    this.suelo.receiveShadow = true;
    this.escena.add(this.suelo);
    this.desechables.push(this.suelo.geometry, matSuelo);

    this.rejilla = new THREE.GridHelper(400, 100, p.rejilla, p.rejilla2);
    (this.rejilla.material as THREE.Material).transparent = true;
    (this.rejilla.material as THREE.Material).opacity = 0.55;
    this.escena.add(this.rejilla);
    this.desechables.push(this.rejilla.geometry, this.rejilla.material as THREE.Material);
  }

  private aplicarPaleta(): void {
    const p = this.paleta;
    (this.escena.background as THREE.Color).set(p.fondo);
    (this.escena.fog as THREE.Fog).color.set(p.fondo);
    this.luzAmb.groundColor.set(p.suelo);
    this.luzAmb.intensity = p.luzAmb;
    this.luzSol.intensity = p.luzSol;
    ((this.suelo.material) as THREE.MeshStandardMaterial).color.set(p.suelo);
    this.escena.remove(this.rejilla);
    this.rejilla.geometry.dispose();
    (this.rejilla.material as THREE.Material).dispose();
    this.rejilla = new THREE.GridHelper(400, 100, p.rejilla, p.rejilla2);
    (this.rejilla.material as THREE.Material).transparent = true;
    (this.rejilla.material as THREE.Material).opacity = 0.55;
    this.escena.add(this.rejilla);
    for (const pl of this.plataformas.values()) {
      ((pl.losa.material) as THREE.MeshStandardMaterial).color.set(pl.tipo === 'satelite' ? p.solar : p.plataforma);
    }
    for (const s of this.solares.values()) ((s.malla.material) as THREE.MeshStandardMaterial).color.set(p.solar);
    for (const e of this.edificios.values()) this.pintarEdificio(e);
  }

  // ── Reconstrucción a partir de la foto ─────────────────────────────────

  private reconstruir(): void {
    const s = this.ultimo;
    if (!s) return;
    const hostPrincipal = s.hosts.find((h) => h.origen === 'prometheus') ?? s.hosts[0];
    const idPrincipal = hostPrincipal?.id ?? 'servidor';

    // Contenedores visibles, por zona.
    const visibles = s.contenedores.filter((c) =>
      (this.filtros.pruebas || c.produccion) && (this.filtros.observabilidad || c.grupo !== 'observabilidad'));
    const porZona = new Map<Grupo | 'k3s', Contenedor[]>();
    for (const c of visibles) {
      const l = porZona.get(c.grupo) ?? [];
      l.push(c);
      porZona.set(c.grupo, l);
    }
    // Pods del nodo principal van como zona "k3s" sobre la misma plataforma.
    const podsPrincipal = s.pods.filter((p) => !p.nodo || p.nodo === idPrincipal || p.nodo === hostPrincipal?.nombre);
    const zonas = ORDEN_ZONAS.filter((z) => (z === 'k3s' ? podsPrincipal.length > 0 : porZona.has(z)));

    // Empaquetado de solares por filas ("estanterías") con ancho máximo.
    interface Caja { z: Grupo | 'k3s'; cols: number; filas: number; w: number; d: number; x: number; y: number }
    const cajas: Caja[] = zonas.map((z) => {
      const n = z === 'k3s' ? podsPrincipal.length : porZona.get(z)!.length;
      const cols = z === 'microservicio' ? Math.min(6, Math.ceil(Math.sqrt(n * 1.6))) : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(n))));
      const filas = Math.ceil(n / cols);
      const celda = z === 'k3s' ? 1.6 : CELDA;
      return { z, cols, filas, w: cols * celda + 1.4, d: filas * celda + 1.4, x: 0, y: 0 };
    });
    const maxAncho = Math.max(30, Math.sqrt(cajas.reduce((a, c) => a + c.w * c.d, 0)) * 1.35);
    let x = 0, y = 0, altoFila = 0, anchoTotal = 0;
    for (const c of cajas) {
      if (x > 0 && x + c.w > maxAncho) { y += altoFila + 1.6; x = 0; altoFila = 0; }
      c.x = x; c.y = y;
      x += c.w + 1.6;
      altoFila = Math.max(altoFila, c.d);
      anchoTotal = Math.max(anchoTotal, x - 1.6);
    }
    const fondoTotal = y + altoFila;
    const W = anchoTotal + 4;
    const D = fondoTotal + 4;
    const ox = -anchoTotal / 2;
    const oz = -fondoTotal / 2;

    // Plataforma del servidor principal.
    this.plataforma(idPrincipal, 'servidor', W, D, new THREE.Vector3(0, 0, 0),
      `${hostPrincipal?.nombre ?? 'Servidor'}`, this.textoHost(hostPrincipal));
    this.anclas.set(idPrincipal, new THREE.Vector3(0, ALTO_PLATAFORMA, -D / 2 + 1));

    // Solares y edificios.
    const zonasVivas = new Set<string>();
    const vivos = new Set<string>();
    for (const c of cajas) {
      const clave = `zona:${c.z}`;
      zonasVivas.add(clave);
      const cx = ox + c.x + c.w / 2;
      const cz = oz + c.y + c.d / 2;
      this.solar(clave, c.z, cx, cz, c.w, c.d);
      if (c.z === 'k3s') continue;
      const items = porZona.get(c.z)!.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
      items.forEach((ct, i) => {
        const col = i % c.cols;
        const fila = Math.floor(i / c.cols);
        const px = ox + c.x + 0.7 + CELDA / 2 + col * CELDA;
        const pz = oz + c.y + 0.7 + CELDA / 2 + fila * CELDA;
        this.edificio(ct, new THREE.Vector3(px, ALTO_PLATAFORMA, pz));
        vivos.add(ct.nombre);
      });
    }
    for (const [clave, sol] of this.solares) {
      if (!zonasVivas.has(clave)) { this.tirarSolar(sol); this.solares.delete(clave); }
    }
    for (const [n, e] of this.edificios) {
      if (!vivos.has(n) && !e.saliendo) { e.saliendo = true; e.escalaObj = 0; }
    }

    // Pods: los del principal sobre su solar K3s; los de otros nodos sobre su plataforma.
    const podsVivos = new Set<string>();
    const solK3s = cajas.find((c) => c.z === 'k3s');
    if (solK3s) {
      podsPrincipal.forEach((p, i) => {
        const col = i % solK3s.cols;
        const fila = Math.floor(i / solK3s.cols);
        const px = ox + solK3s.x + 0.7 + 0.8 + col * 1.6;
        const pz = oz + solK3s.y + 0.7 + 0.8 + fila * 1.6;
        this.pod(p, new THREE.Vector3(px, ALTO_PLATAFORMA, pz));
        podsVivos.add(`${p.ns}/${p.nombre}`);
      });
    }

    // Otros nodos del clúster: plataformas en arco detrás del servidor.
    const otros = s.nodos.filter((n) => n.nombre !== idPrincipal && n.nombre !== hostPrincipal?.nombre && n.ip !== hostPrincipal?.ip);
    const vivasPlat = new Set<string>([idPrincipal]);
    otros.forEach((n, i) => {
      const podsN = s.pods.filter((p) => p.nodo === n.nombre);
      const cols = Math.max(2, Math.ceil(Math.sqrt(podsN.length)));
      const w = Math.max(9, cols * 1.6 + 3);
      const d = Math.max(7, Math.ceil(podsN.length / cols) * 1.6 + 3);
      const ang = Math.PI + (otros.length === 1 ? 0 : (i / (otros.length - 1) - 0.5) * 1.6);
      const radio = Math.max(W, D) / 2 + 18;
      const centro = new THREE.Vector3(Math.sin(ang) * radio, 0, Math.cos(ang) * radio);
      const id = `nodo:${n.nombre}`;
      vivasPlat.add(id);
      this.plataforma(id, 'nodo', w, d, centro, n.nombre, this.textoNodo(n));
      this.anclas.set(n.nombre, centro.clone().setY(ALTO_PLATAFORMA));
      podsN.forEach((p, j) => {
        const col = j % cols;
        const fila = Math.floor(j / cols);
        const px = centro.x - w / 2 + 1.5 + 0.8 + col * 1.6;
        const pz = centro.z - d / 2 + 1.5 + 0.8 + fila * 1.6;
        this.pod(p, new THREE.Vector3(px, ALTO_PLATAFORMA, pz));
        podsVivos.add(`${p.ns}/${p.nombre}`);
      });
    });
    for (const [k, p] of this.pods) {
      if (!podsVivos.has(k) && !p.saliendo) { p.saliendo = true; p.escalaObj = 0; }
    }

    // Satélites: equipos de la red sondeados (Server 1, NAS) e Internet.
    const sat = s.hosts.filter((h) => h.origen === 'sonda');
    const lado = Math.max(W, D) / 2 + 14;
    sat.forEach((h, i) => {
      const id = `sat:${h.id}`;
      vivasPlat.add(id);
      let pos: THREE.Vector3;
      if (h.tipo === 'internet') pos = new THREE.Vector3(0, 0, D / 2 + 20);
      else {
        const k = i % 2 === 0 ? -1 : 1;
        pos = new THREE.Vector3(k * (W / 2 + 12), 0, -4 + Math.floor(i / 2) * 12);
      }
      this.plataforma(id, 'satelite', h.tipo === 'internet' ? 7 : 6, h.tipo === 'internet' ? 7 : 6, pos, h.nombre, this.textoHost(h));
      this.anclas.set(h.id, pos.clone().setY(h.tipo === 'internet' ? 9 : 3));
    });
    if (!this.anclas.has('internet')) this.anclas.set('internet', new THREE.Vector3(0, 9, lado));

    // Ubicaciones remotas (otras sedes, datacenters, nube): plataformas lejanas detrás del servidor,
    // en abanico, con su estado en el rótulo. Sus detalles están en la pestaña Ubicaciones.
    const remotas = s.ubicaciones ?? [];
    const radio = Math.max(W, D) / 2 + 30;
    remotas.forEach((u, i) => {
      const id = `ubi:${u.id}`;
      vivasPlat.add(id);
      const ang = remotas.length === 1 ? Math.PI : Math.PI * (0.7 + (0.6 * i) / (remotas.length - 1));
      const pos = new THREE.Vector3(Math.sin(ang) * radio, 0, Math.cos(ang) * radio);
      this.plataforma(id, 'satelite', 9, 9, pos, u.nombre, this.textoUbicacion(u));
      this.anclas.set(id, pos.clone().setY(3));
    });
    for (const [id, p] of this.plataformas) {
      if (!vivasPlat.has(id) && !p.saliendo) { p.saliendo = true; p.escalaObj = 0; }
    }

    // Anclas de los contenedores (lo alto del edificio) y cables.
    for (const e of this.edificios.values()) {
      if (!e.saliendo) this.anclas.set(e.c.nombre, e.posObj.clone().setY(ALTO_PLATAFORMA + e.altoObj + 0.3));
    }
    this.reconstruirFlujos(s.enlaces);

    if (!this.encuadreHecho) {
      this.encuadreHecho = true;
      const dist = Math.max(36, this.tamMundo() * 0.78);
      this.camara.position.set(dist * 0.18, dist * 0.62, dist * 0.78);
      this.controles.target.set(0, 0, 0);
    }
    this.resaltar();
  }

  private textoUbicacion(u: UbicacionRemota): string {
    const marca = u.estado === 'ok' ? '●' : u.estado === 'critico' ? '▲' : u.estado === 'atencion' ? '◆' : '○';
    const resp = u.respaldos ? ` · respaldos ${u.respaldos - u.respaldos_con_problema}/${u.respaldos}` : '';
    return `${marca} ${u.ciudad ? u.ciudad + ' · ' : ''}${u.en_linea}/${u.equipos} en línea${u.caidos ? ` · ${u.caidos} sin responder` : ''}${resp}`;
  }

  private tamMundo(): number {
    let r = 20;
    for (const p of this.plataformas.values()) {
      if (p.saliendo) continue;
      r = Math.max(r, p.centroObj.length() + Math.max(p.ancho, p.fondo) / 2);
    }
    return r * 2;
  }

  // ── Plataformas y solares ──────────────────────────────────────────────

  private plataforma(id: string, tipo: PlataformaRT['tipo'], w: number, d: number, centro: THREE.Vector3,
                     titulo: string, texto: string): void {
    let p = this.plataformas.get(id);
    if (!p) {
      const grupo = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: tipo === 'satelite' ? this.paleta.solar : this.paleta.plataforma, roughness: 0.85, metalness: 0.05,
      });
      const losa = new THREE.Mesh(this.geoCaja, mat);
      losa.castShadow = true;
      losa.receiveShadow = true;
      losa.userData['sel'] = { tipo: 'host', id: id.replace(/^(nodo|sat):/, '') } as Seleccion;
      grupo.add(losa);
      // Canto inferior oscuro: le da peso de "chasis".
      const matCanto = new THREE.MeshStandardMaterial({ color: tipo === 'nodo' ? COLOR_ZONA.k3s : 0x1f2a3d, roughness: 0.6 });
      const canto = new THREE.Mesh(this.geoCaja, matCanto);
      canto.name = 'canto';
      grupo.add(canto);
      this.mundo.add(grupo);
      const rotulo = this.rotulo('host');
      p = {
        id, grupo, losa, rotulo, ancla: new THREE.Vector3(), ancho: w, fondo: d,
        centro: centro.clone(), centroObj: centro.clone(), escala: 0.01, escalaObj: 1, saliendo: false, tipo,
      };
      this.plataformas.set(id, p);
    }
    p.saliendo = false;
    p.escalaObj = 1;
    p.ancho = w;
    p.fondo = d;
    p.centroObj.copy(centro);
    const alto = tipo === 'satelite' ? 0.8 : ALTO_PLATAFORMA;
    p.losa.scale.set(w, alto - 0.25, d);
    p.losa.position.set(0, 0.25 + (alto - 0.25) / 2, 0);
    const canto = p.grupo.getObjectByName('canto') as THREE.Mesh;
    canto.scale.set(w - 0.3, 0.25, d - 0.3);
    canto.position.set(0, 0.125, 0);
    p.ancla.set(0, alto + 0.4, d / 2 + 0.6);
    p.rotulo.innerHTML = `<b>${esc(titulo)}</b><span>${esc(texto)}</span>`;
  }

  private solar(clave: string, z: Grupo | 'k3s', cx: number, cz: number, w: number, d: number): void {
    let s = this.solares.get(clave);
    if (!s) {
      const mat = new THREE.MeshStandardMaterial({ color: this.paleta.solar, roughness: 0.9 });
      const malla = new THREE.Mesh(this.geoCaja, mat);
      malla.receiveShadow = true;
      const matF = new THREE.MeshStandardMaterial({ color: COLOR_ZONA[z], roughness: 0.5, emissive: COLOR_ZONA[z], emissiveIntensity: 0.15 });
      const franja = new THREE.Mesh(this.geoCaja, matF);
      this.mundo.add(malla, franja);
      const rotulo = this.rotulo('zona');
      rotulo.style.setProperty('--zona', '#' + COLOR_ZONA[z].toString(16).padStart(6, '0'));
      rotulo.textContent = NOMBRE_ZONA[z];
      s = { clave, malla, franja, rotulo, ancla: new THREE.Vector3() };
      this.solares.set(clave, s);
    }
    s.malla.scale.set(w, 0.12, d);
    s.malla.position.set(cx, ALTO_PLATAFORMA + 0.06, cz);
    s.franja.scale.set(w, 0.16, 0.22);
    s.franja.position.set(cx, ALTO_PLATAFORMA + 0.08, cz + d / 2 - 0.11);
    s.ancla.set(cx - w / 2 + 0.3, ALTO_PLATAFORMA + 0.2, cz + d / 2 + 0.2);
  }

  // ── Edificios (contenedores) ───────────────────────────────────────────

  private edificio(c: Contenedor, pos: THREE.Vector3): void {
    let e = this.edificios.get(c.nombre);
    if (!e) {
      const grupo = new THREE.Group();
      const color = COLOR_ZONA[c.grupo] ?? COLOR_ZONA.otro;
      const matRelleno = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, transparent: true, opacity: 0.95 });
      const relleno = new THREE.Mesh(this.geoCaja, matRelleno);
      relleno.castShadow = true;
      relleno.receiveShadow = true;
      const matMarco = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
      const marco = new THREE.LineSegments(this.geoMarco, matMarco);
      const matTapa = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x5ab0ff, emissiveIntensity: 0.3, roughness: 0.3 });
      const tapa = new THREE.Mesh(this.geoCaja, matTapa);
      const matBase = new THREE.MeshStandardMaterial({ color: ESTADO_COLOR.ok, emissive: ESTADO_COLOR.ok, emissiveIntensity: 0.35, roughness: 0.4 });
      const base = new THREE.Mesh(this.geoCaja, matBase);
      const sel: Seleccion = { tipo: 'contenedor', nombre: c.nombre };
      for (const m of [relleno, tapa, base]) m.userData['sel'] = sel;
      // Volumen invisible del tamaño completo: el hover acierta aunque el relleno sea bajito.
      const golpe = new THREE.Mesh(this.geoCaja, new THREE.MeshBasicMaterial({ visible: false }));
      golpe.name = 'golpe';
      golpe.userData['sel'] = sel;
      grupo.add(relleno, marco, tapa, base, golpe);
      this.mundo.add(grupo);
      const rotulo = this.rotulo('ctr');
      e = {
        c, grupo, marco, relleno, tapa, base, matRelleno, matTapa, matBase, matMarco, rotulo,
        pos: pos.clone(), posObj: pos.clone(), alto: 0.4, altoObj: 1, lleno: 0, llenoObj: 0, calor: 0, calorObj: 0,
        escala: 0.01, escalaObj: 1, tono: 'ok', saliendo: false,
      };
      this.edificios.set(c.nombre, e);
    }
    e.c = c;
    e.saliendo = false;
    e.escalaObj = 1;
    e.posObj.copy(pos);
    const mb = (b?: number) => (b ?? 0) / 1048576;
    const usado = mb(c.mem_bytes);
    const limite = c.mem_limite && c.mem_limite > 0 ? mb(c.mem_limite) : 0;
    const altoDe = (m: number) => 0.7 + 1.45 * Math.log10(1 + Math.max(0, m));
    if (c.estado !== 'running') {
      e.altoObj = limite ? altoDe(limite) : 1.6;
      e.llenoObj = 0;
    } else if (limite) {
      e.altoObj = altoDe(limite);
      e.llenoObj = Math.min(1, usado / limite);
    } else {
      e.altoObj = altoDe(usado || 16);
      e.llenoObj = 1;
    }
    e.calorObj = Math.min(1, (c.cpu_pct ?? 0) / 100);
    e.tono = tonoContenedor(c);
    e.rotulo.textContent = c.nombre.replace(/^tuapo-/, '');
    this.pintarEdificio(e);
  }

  private pintarEdificio(e: EdificioRT): void {
    const c = e.c;
    const vivo = c.estado === 'running';
    const color = COLOR_ZONA[c.grupo] ?? COLOR_ZONA.otro;
    e.matRelleno.color.set(e.tono === 'danger' ? ESTADO_COLOR.danger : color);
    e.matRelleno.opacity = vivo ? 0.95 : 0.25;
    e.matMarco.color.set(e.tono === 'danger' ? ESTADO_COLOR.danger : color);
    e.matMarco.opacity = vivo ? (this.oscuro ? 0.9 : 0.7) : 0.45;
    e.matBase.color.set(ESTADO_COLOR[e.tono]);
    e.matBase.emissive.set(ESTADO_COLOR[e.tono]);
  }

  private pod(p: Pod, pos: THREE.Vector3): void {
    const clave = `${p.ns}/${p.nombre}`;
    let r = this.pods.get(clave);
    if (!r) {
      const mat = new THREE.MeshStandardMaterial({ color: COLOR_ZONA.k3s, roughness: 0.45, metalness: 0.1 });
      const malla = new THREE.Mesh(this.geoPod, mat);
      malla.castShadow = true;
      malla.userData['sel'] = { tipo: 'pod', clave } as Seleccion;
      this.mundo.add(malla);
      r = { p, malla, mat, pos: pos.clone(), posObj: pos.clone(), escala: 0.01, escalaObj: 1, saliendo: false };
      this.pods.set(clave, r);
    }
    r.p = p;
    r.saliendo = false;
    r.escalaObj = 1;
    r.posObj.copy(pos);
    const ok = (p.fase === 'Running' || p.fase === 'Succeeded') && p.listos >= p.total;
    r.mat.color.set(ok ? colorNamespace(p.ns) : ESTADO_COLOR.danger);
    r.mat.emissive.set(ok ? 0x000000 : ESTADO_COLOR.danger);
    r.mat.emissiveIntensity = ok ? 0 : 0.5;
    const h = 0.5 + 0.35 * Math.log10(1 + (p.mem_bytes ?? 0) / 1048576);
    r.malla.userData['alto'] = h;
  }

  // ── Flujos ─────────────────────────────────────────────────────────────

  private reconstruirFlujos(enlaces: Enlace[]): void {
    const vivos = new Set<string>();
    for (const e of enlaces) {
      const a = this.anclas.get(e.origen);
      const b = this.anclas.get(e.destino);
      if (!a || !b) continue;
      const clave = `${e.origen}>${e.destino}>${e.tipo}`;
      vivos.add(clave);
      const medio = a.clone().add(b).multiplyScalar(0.5);
      const dist = a.distanceTo(b);
      medio.y = Math.max(a.y, b.y) + Math.min(14, 2 + dist * 0.28);
      let f = this.flujos.get(clave);
      if (!f) {
        const mat = new THREE.LineBasicMaterial({ color: COLOR_FLUJO[e.tipo], transparent: true, opacity: 0.35 });
        const curva = new THREE.QuadraticBezierCurve3(a.clone(), medio, b.clone());
        const geo = new THREE.BufferGeometry().setFromPoints(curva.getPoints(28));
        const linea = new THREE.Line(geo, mat);
        linea.visible = this.verFlujos;
        this.mundo.add(linea);
        f = { clave, e, curva, linea, mat, n: 0, velocidad: 0.2, errFrac: 0, fase: Math.random() };
        this.flujos.set(clave, f);
      } else {
        f.curva.v0.copy(a);
        f.curva.v1.copy(medio);
        f.curva.v2.copy(b);
        f.linea.geometry.setFromPoints(f.curva.getPoints(28));
      }
      f.e = e;
      // Partículas: log de las req/s (0,01 → 1; 1 → 6; 50 → 14). Sin tráfico, ninguna.
      const rps = e.rps ?? 0;
      const intensidad = e.intensidad ?? 0;
      if (e.tipo === 'http') {
        f.n = rps <= 0.001 ? 0 : Math.min(16, Math.max(1, Math.round(3 + 3.2 * Math.log10(rps * 10 + 1) * 2)));
        f.velocidad = 0.12 + Math.min(0.5, Math.log10(1 + rps) * 0.25);
      } else if (e.tipo === 'red') {
        f.n = intensidad > 0 ? 2 : 0;
        f.velocidad = 0.08;
      } else {
        f.n = intensidad > 0 ? Math.max(1, Math.round(intensidad * 10)) : 0;
        f.velocidad = 0.15 + intensidad * 0.3;
      }
      f.errFrac = Math.min(1, (e.err_pct ?? 0) / 100);
      f.mat.opacity = f.n > 0 ? (this.oscuro ? 0.55 : 0.45) : 0.14;
      f.mat.color.set(f.errFrac > 0.05 ? ESTADO_COLOR.danger : COLOR_FLUJO[e.tipo]);
    }
    for (const [k, f] of this.flujos) {
      if (!vivos.has(k)) { this.tirarFlujo(f); this.flujos.delete(k); }
    }
  }

  // ── Bucle ──────────────────────────────────────────────────────────────

  private tic(): void {
    const dt = Math.min(0.1, this.reloj.getDelta());
    const t = performance.now() / 1000;
    const k = 1 - Math.pow(0.0015, dt); // suavizado independiente del fps

    if (this.vueloObjetivo) {
      const v = this.vueloObjetivo;
      const u = Math.min(1, (performance.now() - v.t0) / 900);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      this.controles.target.lerp(v.target, e * 0.25 + 0.05);
      this.camara.position.lerp(v.pos, e * 0.25 + 0.05);
      if (u >= 1) this.vueloObjetivo = null;
    }
    this.controles.update();

    for (const [id, p] of this.plataformas) {
      p.escala += (p.escalaObj - p.escala) * k;
      p.centro.lerp(p.centroObj, k);
      p.grupo.position.copy(p.centro);
      p.grupo.scale.setScalar(Math.max(0.001, p.escala));
      if (p.saliendo && p.escala < 0.02) { this.tirarPlataforma(p); this.plataformas.delete(id); }
    }

    for (const [n, e] of this.edificios) {
      e.escala += (e.escalaObj - e.escala) * k;
      e.alto += (e.altoObj - e.alto) * k;
      e.lleno += (e.llenoObj - e.lleno) * k;
      e.calor += (e.calorObj - e.calor) * k;
      e.pos.lerp(e.posObj, k);
      const s = Math.max(0.001, e.escala);
      const H = Math.max(0.2, e.alto);
      const llenoH = Math.max(0.05, H * e.lleno);
      e.grupo.position.copy(e.pos);
      e.grupo.scale.set(s, s, s);
      e.marco.scale.set(LADO, H, LADO);
      e.marco.position.set(0, H / 2 + 0.22, 0);
      e.relleno.scale.set(LADO * 0.92, llenoH, LADO * 0.92);
      e.relleno.position.set(0, llenoH / 2 + 0.22, 0);
      e.relleno.visible = e.lleno > 0.01;
      e.tapa.scale.set(LADO * 0.98, 0.14, LADO * 0.98);
      e.tapa.position.set(0, H + 0.29, 0);
      e.base.scale.set(LADO + 0.25, 0.22, LADO + 0.25);
      e.base.position.set(0, 0.11, 0);
      const golpe = e.grupo.getObjectByName('golpe')!;
      golpe.scale.set(LADO, H + 0.5, LADO);
      golpe.position.set(0, (H + 0.5) / 2, 0);
      // CPU: de azul frío a naranja caliente, con un latido proporcional.
      const calor = e.calor;
      e.matTapa.emissive.setHSL(0.6 - 0.55 * calor, 0.85, 0.5);
      e.matTapa.emissiveIntensity = 0.15 + calor * 1.6 + (calor > 0.05 ? Math.sin(t * (2 + calor * 8)) * 0.15 * calor : 0);
      if (e.tono === 'danger') e.matBase.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 4)) * 0.9;
      else e.matBase.emissiveIntensity = this.oscuro ? 0.45 : 0.25;
      if (e.saliendo && e.escala < 0.02) { this.tirarEdificio(e); this.edificios.delete(n); }
    }

    for (const [kk, p] of this.pods) {
      p.escala += (p.escalaObj - p.escala) * k;
      p.pos.lerp(p.posObj, k);
      const h = (p.malla.userData['alto'] as number) ?? 0.8;
      p.malla.scale.set(Math.max(0.001, p.escala), h * Math.max(0.001, p.escala), Math.max(0.001, p.escala));
      p.malla.position.set(p.pos.x, p.pos.y + 0.12 + (h * p.escala) / 2, p.pos.z);
      if (p.saliendo && p.escala < 0.02) { p.mat.dispose(); this.mundo.remove(p.malla); this.pods.delete(kk); }
    }

    // Partículas de los flujos.
    let i = 0;
    if (this.verFlujos) {
      for (const f of this.flujos.values()) {
        for (let j = 0; j < f.n && i < MAX_PARTICULAS; j++) {
          const u = (f.fase + t * f.velocidad + j / f.n) % 1;
          f.curva.getPoint(u, this.tmpV);
          this.tmpM.makeTranslation(this.tmpV.x, this.tmpV.y, this.tmpV.z);
          this.particulas.setMatrixAt(i, this.tmpM);
          const roja = f.errFrac > 0 && (j / Math.max(1, f.n)) < f.errFrac + 0.001;
          this.colorParticula.set(roja ? ESTADO_COLOR.danger : COLOR_FLUJO[f.e.tipo]);
          if (this.oscuro) this.colorParticula.offsetHSL(0, 0, 0.12);
          this.particulas.setColorAt(i, this.colorParticula);
          i++;
        }
      }
    }
    this.particulas.count = i;
    this.particulas.instanceMatrix.needsUpdate = true;
    if (this.particulas.instanceColor) this.particulas.instanceColor.needsUpdate = true;

    // Ondas de eventos.
    for (let j = this.ondas.length - 1; j >= 0; j--) {
      const o = this.ondas[j];
      const u = (performance.now() - o.t0) / 1800;
      if (u >= 1) {
        this.mundo.remove(o.malla);
        (o.malla.material as THREE.Material).dispose();
        this.ondas.splice(j, 1);
        continue;
      }
      o.malla.scale.setScalar(1 + u * 5);
      (o.malla.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - u);
    }

    this.renderer.render(this.escena, this.camara);
    this.actualizarHud();
  }

  // ── HUD (rótulos HTML sobre el canvas) ─────────────────────────────────

  private rotulo(tipo: 'zona' | 'host' | 'ctr'): HTMLDivElement {
    const d = document.createElement('div');
    d.className = `rot rot-${tipo}`;
    this.opts.hud.appendChild(d);
    return d;
  }

  private proyectar(v: THREE.Vector3, el: HTMLElement, visible: boolean): void {
    if (!visible) { el.style.display = 'none'; return; }
    this.tmpV.copy(v).project(this.camara);
    if (this.tmpV.z > 1 || this.tmpV.z < -1) { el.style.display = 'none'; return; }
    const r = this.opts.canvas.clientWidth;
    const h = this.opts.canvas.clientHeight;
    const x = (this.tmpV.x * 0.5 + 0.5) * r;
    const y = (-this.tmpV.y * 0.5 + 0.5) * h;
    el.style.display = '';
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  private actualizarHud(): void {
    const distCam = this.camara.position.distanceTo(this.controles.target);
    for (const p of this.plataformas.values()) {
      this.tmpV.copy(p.ancla).add(p.centro);
      const w = this.tmpV.clone();
      this.proyectar(w, p.rotulo, p.escala > 0.5);
    }
    for (const s of this.solares.values()) this.proyectar(s.ancla, s.rotulo, distCam < 190);
    const elegido = this.elegido?.tipo === 'contenedor' ? this.elegido.nombre : null;
    const encima = this.hover?.sel.tipo === 'contenedor' ? this.hover.sel.nombre : null;
    for (const e of this.edificios.values()) {
      const ver = !e.saliendo && (this.verEtiquetas || e.c.nombre === elegido || e.c.nombre === encima || e.tono === 'danger');
      if (!ver) { e.rotulo.style.display = 'none'; continue; }
      this.tmpV.set(e.pos.x, e.pos.y + e.alto + 0.9, e.pos.z);
      const w = this.tmpV.clone();
      this.proyectar(w, e.rotulo, true);
      e.rotulo.classList.toggle('peligro', e.tono === 'danger');
      e.rotulo.classList.toggle('elegido', e.c.nombre === elegido);
    }
  }

  // ── Interacción ────────────────────────────────────────────────────────

  private readonly alMover = (ev: PointerEvent) => {
    const r = this.opts.canvas.getBoundingClientRect();
    this.puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const golpe = this.tocar();
    if (!golpe) {
      if (this.hover) { this.hover = null; this.opts.canvas.style.cursor = ''; this.opts.onHover(null, 0, 0); }
      return;
    }
    this.hover = golpe;
    this.opts.canvas.style.cursor = 'pointer';
    this.opts.onHover(this.opts.describir(golpe.sel), ev.clientX - r.left, ev.clientY - r.top);
  };

  private readonly alSalir = () => {
    this.hover = null;
    this.opts.onHover(null, 0, 0);
  };

  private readonly alBajar = (ev: PointerEvent) => {
    this.bajada = { x: ev.clientX, y: ev.clientY };
    this.controles.autoRotate = false;
  };

  private readonly alSubir = (ev: PointerEvent) => {
    const b = this.bajada;
    this.bajada = null;
    if (!b || Math.hypot(ev.clientX - b.x, ev.clientY - b.y) > 5) return; // fue un arrastre
    const golpe = this.tocar();
    this.elegido = golpe ? golpe.sel : null;
    this.resaltar();
    this.opts.onElegir(this.elegido);
  };

  private readonly alVisibilidad = () => {
    if (document.hidden) this.pausar();
    else this.arrancar();
  };

  private tocar(): { sel: Seleccion; obj: THREE.Object3D } | null {
    this.raycaster.setFromCamera(this.puntero, this.camara);
    const objetos: THREE.Object3D[] = [];
    for (const e of this.edificios.values()) if (!e.saliendo) objetos.push(e.grupo.getObjectByName('golpe')!);
    for (const p of this.pods.values()) if (!p.saliendo) objetos.push(p.malla);
    for (const p of this.plataformas.values()) if (!p.saliendo) objetos.push(p.losa);
    const hits = this.raycaster.intersectObjects(objetos, false);
    for (const h of hits) {
      const sel = h.object.userData['sel'] as Seleccion | undefined;
      if (sel) return { sel, obj: h.object };
    }
    return null;
  }

  private resaltar(): void {
    const nombre = this.elegido?.tipo === 'contenedor' ? this.elegido.nombre : null;
    for (const e of this.edificios.values()) {
      const atenuar = nombre != null && e.c.nombre !== nombre;
      e.matRelleno.opacity = e.c.estado !== 'running' ? 0.25 : atenuar ? 0.35 : 0.95;
      e.matMarco.opacity = atenuar ? 0.25 : (e.c.estado === 'running' ? (this.oscuro ? 0.9 : 0.7) : 0.45);
    }
  }

  private posicionDe(sel: Seleccion): THREE.Vector3 | null {
    if (sel.tipo === 'contenedor') {
      const e = this.edificios.get(sel.nombre);
      return e ? e.posObj.clone().setY(ALTO_PLATAFORMA + e.altoObj / 2) : null;
    }
    if (sel.tipo === 'pod') {
      const p = this.pods.get(sel.clave);
      return p ? p.posObj.clone() : null;
    }
    for (const [id, p] of this.plataformas) {
      if (id === sel.id || id === `nodo:${sel.id}` || id === `sat:${sel.id}`) return p.centroObj.clone().setY(ALTO_PLATAFORMA);
    }
    return null;
  }

  // ── Textos de los rótulos de host ──────────────────────────────────────

  private textoHost(h: Host | undefined): string {
    if (!h) return '';
    if (h.origen === 'prometheus') {
      return `${h.ip ?? ''} · CPU ${fmt(h.cpu_pct)} % · RAM ${fmt(h.mem_pct)} %${h.temp_c != null ? ` · ${Math.round(h.temp_c)} °C` : ''}`;
    }
    const lat = h.latencia_ms != null ? `${fmt(h.latencia_ms, 1)} ms` : 'sin respuesta';
    return `${h.ip ?? ''} · ${h.estado === 'ok' ? lat : 'NO RESPONDE'}`;
  }

  private textoNodo(n: NodoK8s): string {
    const cpu = n.cpu_uso_milli != null && n.cpu_capacidad ? `CPU ${fmt(n.cpu_uso_milli / (n.cpu_capacidad * 10))} %` : '';
    return `${n.ip ?? ''} · ${n.listo ? 'listo' : 'NO LISTO'} · ${n.pods ?? 0} pods ${cpu ? '· ' + cpu : ''}`;
  }

  // ── Limpieza ───────────────────────────────────────────────────────────

  private tirarEdificio(e: EdificioRT): void {
    this.mundo.remove(e.grupo);
    e.matRelleno.dispose(); e.matTapa.dispose(); e.matBase.dispose(); e.matMarco.dispose();
    ((e.grupo.getObjectByName('golpe') as THREE.Mesh)?.material as THREE.Material)?.dispose();
    e.rotulo.remove();
  }

  private tirarPlataforma(p: PlataformaRT): void {
    this.mundo.remove(p.grupo);
    p.grupo.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
    p.rotulo.remove();
  }

  private tirarSolar(s: SolarRT): void {
    this.mundo.remove(s.malla, s.franja);
    (s.malla.material as THREE.Material).dispose();
    (s.franja.material as THREE.Material).dispose();
    s.rotulo.remove();
  }

  private tirarFlujo(f: FlujoRT): void {
    this.mundo.remove(f.linea);
    f.linea.geometry.dispose();
    f.mat.dispose();
  }
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function tonoContenedor(c: Contenedor): keyof typeof ESTADO_COLOR {
  if (!c.produccion && c.estado !== 'running') return 'neutro';
  if (c.estado === 'running') {
    if (c.salud === 'unhealthy') return 'danger';
    if (c.salud === 'starting') return 'warn';
    return 'ok';
  }
  if (c.estado === 'exited' || c.estado === 'created' || c.estado === 'paused') return 'warn';
  return 'danger';
}

const COLORES_NS = [0x3987e5, 0x1baf7a, 0x9085e9, 0xeda100, 0xd55181, 0x199e70];
function colorNamespace(ns: string): number {
  let h = 0;
  for (let i = 0; i < ns.length; i++) h = (h * 31 + ns.charCodeAt(i)) >>> 0;
  return COLORES_NS[h % COLORES_NS.length];
}

function fmt(v: number | undefined | null, d = 0): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('es-CO', { maximumFractionDigits: d });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
