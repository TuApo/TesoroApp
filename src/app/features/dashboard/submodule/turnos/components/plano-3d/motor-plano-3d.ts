/**
 * Motor 3D del plano de la oficina. Lo usan el editor del croquis (modo 'editor': colocar,
 * mover, girar, redimensionar y dibujar paredes) y el televisor de la sala (modo 'tv': solo
 * mirar, con el puesto del llamado iluminado). Independiente de Angular; se carga con
 * `await import()` para que three.js no pese en el bundle de quien no lo abre.
 *
 * <p>DATOS: los mismos del croquis 2D. El eje 2D (x, y en píxeles) se proyecta al suelo
 * (X = x, Z = y) en metros con la escala `cm por px`; la altura va en Y. Un objeto del croquis
 * guarda la esquina superior izquierda de su caja SIN rotar y gira alrededor de su centro: aquí
 * cada objeto es un grupo en su centro con `rotation.y = -grados` (el SVG gira en sentido
 * horario con la y hacia abajo).
 *
 * <p>INCREMENTAL: cada objeto lleva una firma de sus datos; `cargar()` solo rehace lo que
 * cambió. Así arrastrar un mueble no reconstruye la oficina ni mueve la cámara.
 *
 * <p>Licencia: geometría propia hecha con primitivas de three.js (MIT). No usa nada de la
 * "oficina de agentes" de herramientas-ia (PolyForm Noncommercial).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import type { Area, ElementoCroquis, MetaArea, PisoCroquis } from '../../service/turnos.service';

export type ModoMotor = 'editor' | 'tv' | 'vista';
export type Calidad3D = 'alta' | 'baja';
export type VistaCamara = 'iso' | 'planta' | 'frente';

export interface SeleccionPlano { tipo: 'area' | 'elemento'; id: string }

/** Lo que cambia al mover, girar o redimensionar (en px del croquis). */
export interface CambioPlano { x?: number; y?: number; ancho?: number; alto?: number; rotacion?: number }

export interface DatosPlano {
  pisos: PisoCroquis[];
  areas: Area[];
  meta: Record<string, MetaArea>;
  escala: number;            // cm por px
  pisoId: string;
  fondo?: string | null;
}

/** Lo que el televisor ilumina al cantar un turno. */
export interface DestinoPlano {
  areaId: string;
  indice?: number | null;    // escritorio dentro de un área compartida (1..capacidad)
  titulo?: string | null;    // "A-12"
  subtitulo?: string | null; // "Puesto 3 · al fondo a la derecha"
}

export interface OpcionesMotor {
  modo: ModoMotor;
  calidad: Calidad3D;
  oscuro: boolean;
  hud: HTMLElement;
  onSeleccion?: (sel: SeleccionPlano | null) => void;
  /** Mover, girar o redimensionar terminó: `patch` en píxeles del croquis. */
  onCambio?: (sel: SeleccionPlano, patch: CambioPlano) => void;
  /** Con una herramienta activa, el clic en el suelo coloca (x, y = CENTRO en px). */
  onColocar?: (tipo: string, x: number, y: number) => void;
  /** Herramienta pared: un tramo de (x1,y1) a (x2,y2) en px. */
  onPared?: (x1: number, y1: number, x2: number, y2: number) => void;
  onHover?: (sel: SeleccionPlano | null) => void;
  /** Clic en una cámara ligada a Seguridad (`ref`): quien contiene abre su video en vivo. */
  onElegirCamara?: (ref: string, id: string) => void;
}

/** Estados de seguridad que colorean puertas, ventanas, cámaras y equipos ligados por `ref`. */
const COLOR_SEGURIDAD: Record<string, number> = {
  CERRADO: 0x22c55e, ABIERTO: 0xf59e0b, ALARMA: 0xef4444, EN_LINEA: 0x22c55e, ONLINE: 0x22c55e,
  FUERA_DE_LINEA: 0x94a3b8, OFFLINE: 0x94a3b8, DESCONOCIDO: 0x64748b,
};

// ── Constantes de aspecto ────────────────────────────────────────────────────

const ALTURA_PISO = 2.7;
const COLOR_AREA: Record<string, number> = {
  RECEPCION: 0x2b59f0, MODULO: 0x4e8a12, VENTANILLA: 0x1d4ed8, PUESTO: 0x3f7a0e, OFICINA: 0x6d28d9,
  AREA_ATENCION: 0xc2410c, SALA_ESPERA: 0x64748b, PASILLO: 0x94a3b8, BANO: 0x0369a1, SALIDA: 0xb91c1c,
  ENTRADA: 0x166534, ESCALERA: 0x92400e, ASCENSOR: 0x92400e, OTRO: 0x475569,
};
const COLOR_ESTADO_EQUIPO: Record<string, number> = {
  ONLINE: 0x22c55e, OFFLINE: 0x94a3b8, INACTIVO: 0xf59e0b, ALERTA: 0xef4444, DESCONOCIDO: 0x64748b,
};
/** Tamaño por defecto (m) de la vista previa al colocar, por herramienta. */
const TAMANO_FANTASMA: Record<string, [number, number]> = {
  PUERTA: [0.9, 0.9], VENTANA: [1.5, 0.15], SILLA: [0.55, 0.55], SILLA2: [1.1, 0.55], SILLA3: [1.65, 0.55], SILLA4: [2.2, 0.55],
  MOSTRADOR: [2.4, 0.7], MESA: [1.6, 0.8], FLECHA: [2, 0.4], TEXTO: [3, 0.5], PLANTA: [0.6, 0.6], ICONO: [0.6, 0.6],
  LUZ: [0.4, 0.4], ARCHIVADOR: [0.5, 0.6], ESTANTE: [1.2, 0.4], SOFA: [1.8, 0.8], PANTALLA: [1.2, 0.12],
  CAMARA: [0.3, 0.3], EQUIPO: [1.2, 0.7], MODELO3D: [1, 1],
};
const MAX_LUCES_REALES = 10;

type Obj = THREE.Object3D & { userData: { sel?: SeleccionPlano } };

interface Registro {
  sel: SeleccionPlano;
  grupo: THREE.Group;
  firma: string;
  /** Medidas en m (para gizmos y encuadre). */
  w: number; d: number; h: number;
  cx: number; cz: number; rot: number;
  bloqueado: boolean;
  rotulo?: HTMLDivElement;
  anclaRotulo?: THREE.Vector3;
}

interface LuzViva { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; luz: THREE.PointLight | null; modo: string; base: number; areaId: string | null; fase: number }

export class MotorPlano3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly escena = new THREE.Scene();
  private readonly camara: THREE.PerspectiveCamera;
  private readonly controles: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly puntero = new THREE.Vector2();
  private readonly reloj = new THREE.Clock();
  private readonly loader = new GLTFLoader();
  private readonly cacheModelos = new Map<string, Promise<THREE.Object3D>>();
  private readonly planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly mundo = new THREE.Group();
  private readonly capaGizmos = new THREE.Group();
  private luzAmb!: THREE.HemisphereLight;
  private sol!: THREE.DirectionalLight;
  private suelo: THREE.Mesh | null = null;
  private rejilla: THREE.GridHelper | null = null;
  private firmaSuelo = '';

  private datos: DatosPlano | null = null;
  private readonly registros = new Map<string, Registro>();
  private luces: LuzViva[] = [];
  private flechasEscalera: { mesh: THREE.Mesh; curva: (t: number) => THREE.Vector3; fase: number; vel: number }[] = [];
  private indicadores: { mat: THREE.MeshStandardMaterial; fase: number }[] = [];
  private balizasEquipo = new Map<string, THREE.MeshStandardMaterial[]>();
  private estadosEquipos = new Map<string, string>();
  private estadosSeguridad = new Map<string, string>();
  /** Materiales que parpadean en rojo mientras su objeto esté en ALARMA. */
  private alarmas: THREE.MeshStandardMaterial[] = [];

  // Interacción
  private seleccion: SeleccionPlano | null = null;
  private hover: SeleccionPlano | null = null;
  private herramienta: string | null = null;
  private fantasma: THREE.Mesh | null = null;
  private paredInicio: THREE.Vector3 | null = null;
  private paredGuia: THREE.Mesh | null = null;
  private arrastre: { tipo: 'mover' | 'rotar' | 'escalar'; reg: Registro; inicio: THREE.Vector3; cx: number; cz: number; rot: number; ang0: number; opuesto?: THREE.Vector3; nw?: number; nd?: number } | null = null;
  private bajada: { x: number; y: number } | null = null;
  private anillo: THREE.Mesh | null = null;
  private asa: THREE.Mesh | null = null;
  private marco: THREE.LineSegments | null = null;
  private ajustar = true;
  /** Paredes a media altura (editor): dejan ver y elegir lo que hay detrás. */
  private paredesBajas = false;

  // Llamado (televisor)
  private destino: DestinoPlano | null = null;
  private resalte: THREE.Group | null = null;
  private rotuloDestino: HTMLDivElement | null = null;
  private anclaDestino = new THREE.Vector3();
  private vuelo: { desde: THREE.Vector3; hasta: THREE.Vector3; tDesde: THREE.Vector3; tHasta: THREE.Vector3; t0: number; dur: number } | null = null;
  private encuadreInicial = false;

  // Cámara de vigilancia: previsualización de su perspectiva
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewCamara: THREE.PerspectiveCamera | null = null;
  private camaraPrevista: string | null = null;
  private frustums = new Map<string, THREE.Mesh>();

  private anim = 0;
  private enMarcha = false;
  private readonly obs: ResizeObserver;
  private readonly lienzo: HTMLCanvasElement;

  constructor(private readonly contenedor: HTMLElement, private opts: OpcionesMotor) {
    this.renderer = new THREE.WebGLRenderer({ antialias: opts.calidad === 'alta', alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.calidad === 'alta' ? 2 : 1));
    this.renderer.shadowMap.enabled = opts.calidad === 'alta' && opts.modo !== 'tv';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.lienzo = this.renderer.domElement;
    Object.assign(this.lienzo.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none', outline: 'none' });
    this.lienzo.tabIndex = 0;
    contenedor.appendChild(this.lienzo);

    this.camara = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.camara.position.set(14, 16, 18);
    this.controles = new OrbitControls(this.camara, this.lienzo);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.09;
    this.controles.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controles.minDistance = 2;
    this.controles.maxDistance = 160;
    this.controles.screenSpacePanning = false;
    if (opts.modo === 'tv') { this.controles.enabled = false; this.controles.autoRotate = true; this.controles.autoRotateSpeed = 0.25; }

    this.escena.add(this.mundo, this.capaGizmos);
    this.montarLuces();
    this.aplicarTema();

    this.lienzo.addEventListener('pointerdown', this.alBajar);
    this.lienzo.addEventListener('pointermove', this.alMover);
    window.addEventListener('pointerup', this.alSubir);
    this.lienzo.addEventListener('pointerleave', this.alSalir);
    this.lienzo.addEventListener('dblclick', this.alDobleClic);
    this.lienzo.addEventListener('contextmenu', this.alMenu);
    document.addEventListener('visibilitychange', this.alVisibilidad);
    this.obs = new ResizeObserver(() => this.redimensionar());
    this.obs.observe(contenedor);
    this.redimensionar();
    this.arrancar();
  }

  // ════════════════════════════════════════════════════════════════════════
  // API
  // ════════════════════════════════════════════════════════════════════════

  get canvas(): HTMLCanvasElement { return this.lienzo; }

  cargar(d: DatosPlano): void {
    const cambioPiso = this.datos?.pisoId !== d.pisoId;
    this.datos = d;
    const piso = this.pisoActual();
    if (!piso) return;
    this.construirSuelo(piso);
    const vivos = new Set<string>();

    for (const a of this.areasDelPiso()) {
      const meta = d.meta[a.id] ?? {};
      const firma = JSON.stringify([a, meta, d.escala, piso.altura3d, this.opts.oscuro]);
      vivos.add(a.id);
      const r = this.registros.get(a.id);
      if (r && r.firma === firma) continue;
      if (r) this.quitar(r);
      this.registros.set(a.id, this.construirArea(a, meta, firma));
    }
    for (const e of piso.elementos ?? []) {
      const firma = JSON.stringify([e, d.escala, piso.altura3d, this.estadosEquipos.get(e.ref ?? '') ?? null, this.estadosSeguridad.get(e.ref ?? '') ?? null, e.tipo === 'PARED' && this.paredesBajas]);
      vivos.add(e.id);
      const r = this.registros.get(e.id);
      if (r && r.firma === firma) continue;
      if (r) this.quitar(r);
      this.registros.set(e.id, this.construirElemento(e, firma));
    }
    for (const [id, r] of [...this.registros]) {
      if (!vivos.has(id)) { this.quitar(r); this.registros.delete(id); }
    }
    this.recontarLuces();
    if (this.seleccion && !this.registros.has(this.seleccion.id)) this.seleccion = null;
    this.actualizarGizmos();
    if (this.destino) this.montarResalte();
    if (cambioPiso || !this.encuadreInicial) { this.encuadreInicial = true; this.vista('iso', false); }
  }

  seleccionar(sel: SeleccionPlano | null, enfocar = false): void {
    this.seleccion = sel && this.registros.has(sel.id) ? sel : null;
    this.actualizarGizmos();
    if (sel && enfocar) this.enfocar(sel.id);
  }

  /** Herramienta activa (tipo de área o mueble, 'PARED' dibuja tramos) o null = seleccionar. */
  usarHerramienta(tipo: string | null, tamanoM?: [number, number]): void {
    this.herramienta = tipo;
    this.paredInicio = null;
    this.limpiarFantasma();
    if (tipo && tipo !== 'PARED') {
      const [w, d] = tamanoM ?? TAMANO_FANTASMA[tipo] ?? [1.2, 1.2];
      const mat = new THREE.MeshBasicMaterial({ color: 0x2b59f0, transparent: true, opacity: 0.35, depthWrite: false });
      this.fantasma = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mat);
      this.fantasma.visible = false;
      this.capaGizmos.add(this.fantasma);
    }
    this.lienzo.style.cursor = tipo ? 'crosshair' : '';
  }

  ajustarACuadricula(v: boolean): void { this.ajustar = v; }

  /** Ilumina a dónde tiene que ir quien fue llamado; null apaga y vuelve a la vista general. */
  resaltar(destino: DestinoPlano | null): void {
    const mismo = JSON.stringify(destino) === JSON.stringify(this.destino);
    this.destino = destino;
    if (mismo && this.resalte) return;
    this.montarResalte();
    if (destino) {
      const r = this.registros.get(destino.areaId);
      // Centrado en el destino pero sin perder la oficina de vista: quien mira el TV tiene que
      // ubicar el puesto respecto a la entrada, no ver solo un rectángulo iluminado.
      const piso = this.pisoActual();
      const c = piso ? this.cajaContenido(piso) : null;
      const contexto = c ? this.distanciaPara(c.x1 - c.x0, c.z1 - c.z0) * 0.72 : 0;
      if (r) this.volarA(new THREE.Vector3(this.anclaDestino.x, 0, this.anclaDestino.z), Math.max(7, Math.max(r.w, r.d) * 2.6, contexto));
      this.controles.autoRotate = false;
    } else if (this.opts.modo === 'tv') {
      this.vista('iso', true);
      this.controles.autoRotate = true;
    }
  }

  setEstadosEquipos(mapa: Map<string, string>): void {
    this.estadosEquipos = mapa;
    if (this.datos) this.cargar(this.datos);
  }

  /** Estado en vivo de Seguridad por `ref` (puertas, ventanas, cámaras): ABIERTO, CERRADO, ALARMA… */
  setEstadosSeguridad(mapa: Map<string, string>): void {
    this.estadosSeguridad = mapa;
    if (this.datos) this.cargar(this.datos);
  }

  setParedesBajas(v: boolean): void {
    if (v === this.paredesBajas) return;
    this.paredesBajas = v;
    if (this.datos) this.cargar(this.datos);
  }

  setTema(oscuro: boolean): void {
    if (oscuro === this.opts.oscuro) return;
    this.opts = { ...this.opts, oscuro };
    this.aplicarTema();
    this.firmaSuelo = '';
    if (this.datos) this.cargar(this.datos);
  }

  setCalidad(c: Calidad3D): void {
    this.opts = { ...this.opts, calidad: c };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, c === 'alta' ? 2 : 1));
    this.renderer.shadowMap.enabled = c === 'alta' && this.opts.modo !== 'tv';
    this.sol.castShadow = this.renderer.shadowMap.enabled;
    this.redimensionar();
  }

  /**
   * Encuadra lo que hay en el piso (no el piso entero: una oficina de 24 × 16 m con todo en
   * una esquina quedaba diminuta). Si el piso está vacío, encuadra el piso.
   */
  vista(v: VistaCamara, animar = true): void {
    const piso = this.pisoActual();
    if (!piso) return;
    const c = this.cajaContenido(piso);
    const w = c.x1 - c.x0, d = c.z1 - c.z0;
    const centro = new THREE.Vector3((c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2);
    const dist = this.distanciaPara(w, d) * (v === 'planta' ? 0.9 : this.opts.modo === 'tv' ? 0.85 : 0.78);
    const dir = v === 'planta' ? new THREE.Vector3(0, 1, 0.0005) : v === 'frente' ? new THREE.Vector3(0, 0.42, 0.9) : new THREE.Vector3(0.45, 0.72, 0.72);
    const pos = centro.clone().addScaledVector(dir.normalize(), Math.max(6, dist));
    if (animar) this.vuelo = { desde: this.camara.position.clone(), hasta: pos, tDesde: this.controles.target.clone(), tHasta: centro, t0: performance.now(), dur: 700 };
    else { this.camara.position.copy(pos); this.controles.target.copy(centro); this.controles.update(); }
  }

  /** Distancia de cámara para que un rectángulo de w × d m quepa en el lado más estrecho del lienzo. */
  private distanciaPara(w: number, d: number): number {
    const mitadV = THREE.MathUtils.degToRad(this.camara.fov) / 2;
    const mitadH = Math.atan(Math.tan(mitadV) * this.camara.aspect);
    return Math.hypot(w, d) / 2 / Math.sin(Math.min(mitadV, mitadH));
  }

  /** Rectángulo (m) que ocupa lo dibujado en el piso, con 1 m de aire; el piso entero si no hay nada. */
  private cajaContenido(piso: PisoCroquis): { x0: number; z0: number; x1: number; z1: number } {
    const W = this.m(piso.ancho), D = this.m(piso.alto);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of this.registros.values()) {
      const rad = THREE.MathUtils.degToRad(r.rot || 0);
      const hx = (Math.abs(Math.cos(rad)) * r.w + Math.abs(Math.sin(rad)) * r.d) / 2;
      const hz = (Math.abs(Math.sin(rad)) * r.w + Math.abs(Math.cos(rad)) * r.d) / 2;
      x0 = Math.min(x0, r.cx - hx); x1 = Math.max(x1, r.cx + hx);
      z0 = Math.min(z0, r.cz - hz); z1 = Math.max(z1, r.cz + hz);
    }
    if (!Number.isFinite(x0)) return { x0: 0, z0: 0, x1: W, z1: D };
    const minimo = 6;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = Math.max(minimo, x1 - x0 + 2), d = Math.max(minimo, z1 - z0 + 2);
    return { x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 };
  }

  enfocar(id: string): void {
    const r = this.registros.get(id);
    if (!r) return;
    this.volarA(new THREE.Vector3(r.cx, 0, r.cz), Math.max(4, Math.max(r.w, r.d) * 3));
  }

  /** Lienzo donde se dibuja lo que ve una cámara de vigilancia (o null para soltarlo). */
  usarPreview(canvas: HTMLCanvasElement | null): void {
    this.previewRenderer?.dispose();
    this.previewRenderer = null;
    if (!canvas) return;
    this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.previewCamara = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
  }

  previsualizarCamara(id: string | null): void {
    this.camaraPrevista = id;
    for (const [k, f] of this.frustums) f.visible = k === id;
  }

  pausar(): void { this.enMarcha = false; cancelAnimationFrame(this.anim); }
  arrancar(): void {
    if (this.enMarcha) return;
    this.enMarcha = true;
    this.reloj.getDelta();
    const bucle = () => { if (!this.enMarcha) return; this.anim = requestAnimationFrame(bucle); this.tic(); };
    this.anim = requestAnimationFrame(bucle);
  }

  redimensionar(): void {
    const r = this.contenedor.getBoundingClientRect();
    const w = Math.max(10, r.width), h = Math.max(10, r.height);
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    if (this.previewRenderer) {
      const c = this.previewRenderer.domElement;
      this.previewRenderer.setSize(c.clientWidth || 320, c.clientHeight || 180, false);
      if (this.previewCamara) { this.previewCamara.aspect = (c.clientWidth || 16) / (c.clientHeight || 9); this.previewCamara.updateProjectionMatrix(); }
    }
  }

  destruir(): void {
    this.pausar();
    this.obs.disconnect();
    this.lienzo.removeEventListener('pointerdown', this.alBajar);
    this.lienzo.removeEventListener('pointermove', this.alMover);
    window.removeEventListener('pointerup', this.alSubir);
    this.lienzo.removeEventListener('pointerleave', this.alSalir);
    this.lienzo.removeEventListener('dblclick', this.alDobleClic);
    this.lienzo.removeEventListener('contextmenu', this.alMenu);
    document.removeEventListener('visibilitychange', this.alVisibilidad);
    this.controles.dispose();
    for (const r of this.registros.values()) this.quitar(r);
    this.registros.clear();
    this.escena.traverse(o => liberar(o));
    this.previewRenderer?.dispose();
    this.renderer.dispose();
    this.lienzo.remove();
    this.opts.hud.innerHTML = '';
  }

  // ════════════════════════════════════════════════════════════════════════
  // Construcción
  // ════════════════════════════════════════════════════════════════════════

  private m(px: number): number { return (px * (this.datos?.escala || 2)) / 100; }
  private px(m: number): number { return (m * 100) / (this.datos?.escala || 2); }
  private pisoActual(): PisoCroquis | undefined {
    const d = this.datos;
    return d ? d.pisos.find(p => p.id === d.pisoId) ?? d.pisos[0] : undefined;
  }
  private altura(): number { return this.pisoActual()?.altura3d || ALTURA_PISO; }
  private areasDelPiso(): Area[] {
    const d = this.datos!, piso = this.pisoActual()!;
    const primero = d.pisos[0]?.id === piso.id;
    return d.areas.filter(a => a.activa !== false && (a.piso === piso.id || (!a.piso && primero) || (!!a.piso && !d.pisos.some(p => p.id === a.piso) && primero)));
  }

  private montarLuces(): void {
    this.luzAmb = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.95);
    this.sol = new THREE.DirectionalLight(0xffffff, 1.05);
    this.sol.position.set(18, 26, 12);
    this.sol.castShadow = this.renderer.shadowMap.enabled;
    this.sol.shadow.mapSize.set(2048, 2048);
    const c = this.sol.shadow.camera;
    c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.far = 120;
    this.sol.shadow.bias = -0.0004;
    this.escena.add(this.luzAmb, this.sol, this.sol.target);
  }

  private aplicarTema(): void {
    const oscuro = this.opts.oscuro || this.opts.modo === 'tv';
    this.escena.background = new THREE.Color(oscuro ? 0x0b1222 : 0xeef2f7);
    this.luzAmb.intensity = oscuro ? 0.62 : 0.95;
    this.sol.intensity = oscuro ? 0.75 : 1.05;
  }

  /** Suelo del piso con huecos donde hay escaleras que bajan. */
  private construirSuelo(piso: PisoCroquis): void {
    const bajan = this.areasDelPiso().filter(a => a.tipo === 'ESCALERA' && (this.datos!.meta[a.id]?.sentido === 'BAJA'));
    const firma = JSON.stringify([piso.ancho, piso.alto, this.datos!.escala, this.datos!.fondo, bajan.map(a => [a.x, a.y, a.ancho, a.alto, a.rotacion]), this.opts.oscuro]);
    if (firma === this.firmaSuelo) return;
    this.firmaSuelo = firma;
    if (this.suelo) { this.mundo.remove(this.suelo); liberar(this.suelo); }
    if (this.rejilla) { this.mundo.remove(this.rejilla); liberar(this.rejilla); }
    const w = this.m(piso.ancho), d = this.m(piso.alto);
    const forma = new THREE.Shape();
    forma.moveTo(0, 0); forma.lineTo(w, 0); forma.lineTo(w, d); forma.lineTo(0, d); forma.lineTo(0, 0);
    for (const a of bajan) {
      const hueco = new THREE.Path();
      const pts = this.esquinas(a).map(p => new THREE.Vector2(p.x, p.z));
      hueco.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) hueco.lineTo(pts[i].x, pts[i].y);
      hueco.lineTo(pts[0].x, pts[0].y);
      forma.holes.push(hueco);
    }
    const geo = new THREE.ShapeGeometry(forma);
    geo.rotateX(Math.PI / 2); // forma en XY → suelo en XZ (y hacia +Z)
    const oscuro = this.opts.oscuro || this.opts.modo === 'tv';
    const color = this.datos!.fondo && !oscuro ? new THREE.Color(this.datos!.fondo) : new THREE.Color(oscuro ? 0x1a2740 : 0xf8fafc);
    this.suelo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }));
    this.suelo.receiveShadow = true;
    this.suelo.name = 'suelo';
    this.mundo.add(this.suelo);
    const tam = Math.ceil(Math.max(w, d));
    this.rejilla = new THREE.GridHelper(tam, tam, oscuro ? 0x2e4266 : 0xcbd5e1, oscuro ? 0x22314f : 0xe2e8f0);
    this.rejilla.position.set(tam / 2, 0.003, tam / 2);
    const mr = this.rejilla.material as THREE.Material;
    mr.transparent = true; mr.opacity = this.opts.modo === 'tv' ? 0.35 : 0.8;
    this.mundo.add(this.rejilla);
  }

  /** Esquinas de la caja rotada (en m, plano XZ) de un objeto del croquis. */
  private esquinas(o: { x: number; y: number; ancho: number; alto: number; rotacion?: number | null }): THREE.Vector3[] {
    const cx = this.m(o.x + o.ancho / 2), cz = this.m(o.y + o.alto / 2);
    const hw = this.m(o.ancho) / 2, hd = this.m(o.alto) / 2;
    const r = ((o.rotacion || 0) * Math.PI) / 180;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) =>
      new THREE.Vector3(cx + lx * Math.cos(r) - lz * Math.sin(r), 0, cz + lx * Math.sin(r) + lz * Math.cos(r)));
  }

  private nuevoRegistro(sel: SeleccionPlano, o: { x: number; y: number; ancho: number; alto: number; rotacion?: number | null }, firma: string, h: number, bloqueado = false): Registro {
    const g = new THREE.Group();
    const cx = this.m(o.x + o.ancho / 2), cz = this.m(o.y + o.alto / 2);
    g.position.set(cx, 0, cz);
    g.rotation.y = -THREE.MathUtils.degToRad(o.rotacion || 0);
    g.userData = { sel };
    this.mundo.add(g);
    return { sel, grupo: g, firma, w: this.m(o.ancho), d: this.m(o.alto), h, cx, cz, rot: o.rotacion || 0, bloqueado };
  }

  // ── Áreas ──────────────────────────────────────────────────────────────

  private construirArea(a: Area, meta: MetaArea, firma: string): Registro {
    const r = this.nuevoRegistro({ tipo: 'area', id: a.id }, a, firma, 0.05);
    const color = new THREE.Color(a.color || colorHex(COLOR_AREA[a.tipo] ?? 0x2b59f0));
    const w = r.w, d = r.d;
    const oscuro = this.opts.oscuro || this.opts.modo === 'tv';
    // Suelo del área: translúcido para que lo que hay encima se vea.
    const geo = a.forma === 'CIRCULO' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 40) : new THREE.BoxGeometry(1, 1, 1);
    const pad = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: oscuro ? 0.32 : 0.22, roughness: 0.8, depthWrite: false }));
    pad.scale.set(w, 0.02, d);
    pad.position.y = 0.011;
    pad.name = 'pad';
    r.grupo.add(pad);
    // Borde: listón bajo de color (se lee desde cualquier ángulo).
    if (a.forma !== 'CIRCULO') {
      const t = 0.05, hb = 0.08;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: oscuro ? 0.25 : 0.05 });
      for (const [sx, sz, px, pz] of [[w, t, 0, -d / 2], [w, t, 0, d / 2], [t, d, -w / 2, 0], [t, d, w / 2, 0]] as const) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(sx, hb, sz), mat);
        b.position.set(px, hb / 2, pz);
        b.name = 'borde';
        r.grupo.add(b);
      }
    }
    if (a.tipo === 'ESCALERA') this.escalera(r, meta, color);
    if (a.tipo === 'ASCENSOR') this.ascensor(r, color);
    // Rótulo HTML (nítido a cualquier zoom).
    r.rotulo = this.rotulo('area', `<b>${esc(a.nombre)}</b>${a.capacidad ? `<span>${a.capacidad > 1 ? `×${a.capacidad} puestos` : '1 puesto'}${a.movil ? ' · móvil' : ''}</span>` : ''}${this.textoEscalera(a, meta)}`, colorCss(color));
    r.anclaRotulo = new THREE.Vector3(0, a.tipo === 'ESCALERA' && (meta.sentido ?? 'SUBE') !== 'BAJA' ? this.altura() * 0.55 : 0.5, 0);
    return r;
  }

  private textoEscalera(a: Area, meta: MetaArea): string {
    if (a.tipo !== 'ESCALERA' && a.tipo !== 'ASCENSOR') return '';
    const piso = meta.conecta_piso ? this.datos!.pisos.find(p => p.id === meta.conecta_piso) : null;
    const s = meta.sentido ?? (a.tipo === 'ESCALERA' ? 'SUBE' : null);
    if (!s && !piso) return '';
    const flecha = s === 'BAJA' ? '↓' : s === 'AMBOS' ? '↕' : '↑';
    const verbo = s === 'BAJA' ? 'Baja' : s === 'AMBOS' ? 'Sube y baja' : 'Sube';
    return `<i>${flecha} ${verbo}${piso ? ` a ${esc(piso.nombre)}` : ''}</i>`;
  }

  /** Peldaños reales: suben hasta la altura del piso o bajan por un hueco del suelo. Flechas animadas. */
  private escalera(r: Registro, meta: MetaArea, color: THREE.Color): void {
    const sentido = meta.sentido ?? 'SUBE';
    const largoEnX = r.w >= r.d;
    const largo = largoEnX ? r.w : r.d, ancho = largoEnX ? r.d : r.w;
    const n = Math.max(4, Math.min(18, Math.round(largo / 0.28)));
    const huella = largo / n;
    const alto = this.altura();
    const contrahuella = alto / n;
    const matPaso = new THREE.MeshStandardMaterial({ color: this.opts.oscuro || this.opts.modo === 'tv' ? 0x8a7a5c : 0xe7dcc4, roughness: 0.75 });
    const matBorde = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const baja = sentido === 'BAJA';
    for (let i = 0; i < n; i++) {
      // SUBE: el peldaño i llega a (i+1)·contrahuella. BAJA: el i queda a -(i+1)·contrahuella (en el hueco).
      const h = (i + 1) * contrahuella;
      const geo = new THREE.BoxGeometry(largoEnX ? huella : ancho * 0.94, baja ? contrahuella : h, largoEnX ? ancho * 0.94 : huella);
      const paso = new THREE.Mesh(geo, matPaso);
      const pos = -largo / 2 + huella * (i + 0.5);
      const y = baja ? -h + contrahuella / 2 : h / 2;
      if (largoEnX) paso.position.set(pos, y, 0); else paso.position.set(0, y, pos);
      paso.castShadow = true; paso.receiveShadow = true;
      paso.name = 'paso';
      r.grupo.add(paso);
      // Nariz del peldaño en el color del área (se lee la escalera de lejos).
      const nariz = new THREE.Mesh(new THREE.BoxGeometry(largoEnX ? 0.03 : ancho * 0.94, 0.025, largoEnX ? ancho * 0.94 : 0.03), matBorde);
      const yN = baja ? -h + contrahuella : h;
      const pN = pos + huella / 2;
      if (largoEnX) nariz.position.set(pN, yN + 0.012, 0); else nariz.position.set(0, yN + 0.012, pN);
      r.grupo.add(nariz);
    }
    if (baja) {
      // Paredes del hueco para que se lea como bajada.
      const matHueco = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9, side: THREE.DoubleSide });
      const prof = alto;
      for (const [sx, sz, px, pz] of [[r.w, 0.02, 0, -r.d / 2], [r.w, 0.02, 0, r.d / 2], [0.02, r.d, -r.w / 2, 0], [0.02, r.d, r.w / 2, 0]] as const) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(sx, prof, sz), matHueco);
        p.position.set(px, -prof / 2, pz);
        r.grupo.add(p);
      }
    }
    // Flechas que caminan por la escalera en su sentido (AMBOS: dos carriles).
    const carriles = sentido === 'AMBOS' ? [-0.22, 0.22] : [0];
    carriles.forEach((desplaza, k) => {
      const subiendo = sentido === 'SUBE' || (sentido === 'AMBOS' && k === 0);
      for (let j = 0; j < 3; j++) {
        const flecha = new THREE.Mesh(new THREE.ConeGeometry(Math.min(0.18, ancho * 0.18), 0.32, 3),
          new THREE.MeshStandardMaterial({ color: 0x9bd441, emissive: 0x9bd441, emissiveIntensity: 0.9 }));
        const curva = (t: number) => {
          const s = -largo / 2 + largo * t;
          const y = baja ? -alto * t + 0.25 : alto * t + 0.25;
          const lat = ancho * desplaza;
          return largoEnX ? new THREE.Vector3(s, y, lat) : new THREE.Vector3(lat, y, s);
        };
        // El cono apunta +Y: lo acostamos en el sentido de avance.
        const q = new THREE.Quaternion();
        const dir = curva(0.6).sub(curva(0.4)).normalize();
        if (!subiendo) dir.negate();
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        flecha.quaternion.copy(q);
        flecha.name = 'flecha';
        r.grupo.add(flecha);
        this.flechasEscalera.push({ mesh: flecha, curva: subiendo ? curva : (t: number) => curva(1 - t), fase: j / 3, vel: 0.28 });
      }
    });
  }

  private ascensor(r: Registro, color: THREE.Color): void {
    const alto = this.altura() * 0.92;
    const cabina = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.94, alto, r.d * 0.94),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.55, roughness: 0.35 }));
    cabina.position.y = alto / 2;
    cabina.castShadow = true;
    r.grupo.add(cabina);
    const puerta = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.5, alto * 0.78, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.25 }));
    puerta.position.set(0, alto * 0.39, r.d * 0.47 + 0.012);
    r.grupo.add(puerta);
    for (const [k, y] of [[0, alto * 0.86], [1, alto * 0.94]] as const) {
      const mat = new THREE.MeshStandardMaterial({ color, emissive: 0x9bd441, emissiveIntensity: 0.4 });
      const ind = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 3), mat);
      ind.position.set(r.w * 0.3, y, r.d * 0.47 + 0.03);
      if (k === 0) ind.rotation.z = Math.PI;
      r.grupo.add(ind);
      this.indicadores.push({ mat, fase: k * 0.5 });
    }
    r.h = alto;
  }

  // ── Elementos ──────────────────────────────────────────────────────────

  private construirElemento(e: ElementoCroquis, firma: string): Registro {
    const altPiso = this.altura();
    const r = this.nuevoRegistro({ tipo: 'elemento', id: e.id }, e, firma, 0.5, !!e.bloqueado);
    const w = Math.max(0.03, r.w), d = Math.max(0.03, r.d);
    const g = r.grupo;
    const col = (def: number) => new THREE.Color(e.color || colorHex(def));
    const std = (c: THREE.Color | number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, ...extra });
    const caja = (sx: number, sy: number, sz: number, mat: THREE.Material, x = 0, y = sy / 2, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    };
    const z0 = e.z ?? 0;
    switch (e.tipo) {
      case 'PARED': {
        const h = Math.min(e.alto3d ?? altPiso, altPiso) * (this.paredesBajas ? 0.4 : 1);
        const oscuro = this.opts.oscuro || this.opts.modo === 'tv';
        caja(w, h, d, std(e.color ? col(0) : new THREE.Color(oscuro ? 0x9fb0c8 : 0xe5e7eb), { roughness: 0.9 }));
        caja(w + 0.005, 0.02, d + 0.005, std(col(0x334155)), 0, h + 0.01);
        r.h = h;
        break;
      }
      case 'PUERTA': {
        const hp = e.alto3d ?? 2.1;
        const marco = std(col(0x475569));
        caja(0.06, hp, 0.1, marco, -w / 2 + 0.03, hp / 2, d / 2);
        caja(0.06, hp, 0.1, marco, w / 2 - 0.03, hp / 2, d / 2);
        caja(w, 0.08, 0.1, marco, 0, hp - 0.04, d / 2);
        // Hoja abierta 70° hacia adentro, con la bisagra a la izquierda (como el arco del 2D).
        const hoja = new THREE.Group();
        const estadoP = e.ref ? this.estadosSeguridad.get(e.ref) : undefined;
        const matHoja = std(estadoP ? COLOR_SEGURIDAD[estadoP] ?? 0xc9a77a : 0xc9a77a, { roughness: 0.5 });
        if (estadoP === 'ALARMA') this.alarmas.push(matHoja);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, hp - 0.1, 0.04), matHoja);
        panel.position.set((w - 0.08) / 2, (hp - 0.1) / 2, 0);
        panel.castShadow = true;
        hoja.add(panel);
        hoja.position.set(-w / 2 + 0.04, 0, d / 2);
        hoja.rotation.y = THREE.MathUtils.degToRad(estadoP === 'CERRADO' ? 0 : 70);
        g.add(hoja);
        r.h = hp;
        break;
      }
      case 'VENTANA': {
        const antepecho = 0.9, hv = Math.min(1.3, altPiso - antepecho - 0.2);
        const muro = std(new THREE.Color(this.opts.oscuro || this.opts.modo === 'tv' ? 0x9fb0c8 : 0xe5e7eb), { roughness: 0.9 });
        caja(w, antepecho, d, muro);
        caja(w, altPiso - antepecho - hv, d, muro, 0, antepecho + hv + (altPiso - antepecho - hv) / 2);
        const estadoV = e.ref ? this.estadosSeguridad.get(e.ref) : undefined;
        const vidrio = new THREE.MeshPhysicalMaterial({ color: estadoV ? COLOR_SEGURIDAD[estadoV] ?? 0xbae6fd : 0xbae6fd, transparent: true, opacity: estadoV ? 0.55 : 0.35, roughness: 0.05, metalness: 0.1,
          emissive: estadoV ? COLOR_SEGURIDAD[estadoV] ?? 0 : 0, emissiveIntensity: estadoV ? 0.25 : 0 });
        if (estadoV === 'ALARMA') this.alarmas.push(vidrio);
        caja(w, hv, Math.max(0.02, d * 0.3), vidrio, 0, antepecho + hv / 2);
        r.h = altPiso;
        break;
      }
      case 'MESA': {
        const h = e.alto3d ?? 0.75;
        const madera = std(col(0xcbd5e1), { roughness: 0.55 });
        caja(w, 0.04, d, madera, 0, h - 0.02);
        const pata = std(0x475569, { metalness: 0.4 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) caja(0.05, h - 0.04, 0.05, pata, sx * (w / 2 - 0.06), (h - 0.04) / 2, sz * (d / 2 - 0.06));
        r.h = h;
        break;
      }
      case 'SILLA': {
        const n = Math.max(1, Math.min(4, e.cantidad || 1));
        const ws = w / n;
        const tela = std(col(0x94a3b8), { roughness: 0.85 });
        const metal = std(0x334155, { metalness: 0.5 });
        caja(w, 0.04, Math.min(0.08, d * 0.15), metal, 0, 0.36, d / 2 - 0.05);
        for (let i = 0; i < n; i++) {
          const x = -w / 2 + ws * (i + 0.5);
          caja(ws * 0.86, 0.07, d * 0.62, tela, x, 0.45, d * 0.12);
          caja(ws * 0.86, 0.42, 0.06, tela, x, 0.7, -d / 2 + 0.06);
          caja(0.04, 0.42, 0.04, metal, x, 0.21, d * 0.12);
        }
        r.h = 0.92;
        break;
      }
      case 'MOSTRADOR': {
        const h = e.alto3d ?? 1.1;
        caja(w, h, d, std(col(0xcbd5e1), { roughness: 0.5 }));
        caja(w + 0.04, 0.04, d + 0.06, std(0x64748b, { roughness: 0.4 }), 0, h + 0.02);
        r.h = h;
        break;
      }
      case 'PLANTA': {
        const maceta = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.24, 0.4, 16), std(0x9a6b3f));
        maceta.position.y = 0.2; maceta.castShadow = true; g.add(maceta);
        const copa = new THREE.Mesh(new THREE.IcosahedronGeometry(w * 0.48, 1), std(col(0x5e9a1f), { flatShading: true }));
        copa.position.y = 0.4 + w * 0.42; copa.castShadow = true; g.add(copa);
        r.h = 0.4 + w * 0.9;
        break;
      }
      case 'ARCHIVADOR': {
        const h = e.alto3d ?? 1.3;
        const cuerpo = std(col(0x94a3b8), { metalness: 0.4, roughness: 0.4 });
        caja(w, h, d, cuerpo);
        const cajones = 4;
        for (let i = 0; i < cajones; i++) {
          const y = (h / cajones) * (i + 0.5);
          caja(w * 0.9, 0.012, 0.012, std(0x334155), 0, y + h / cajones * 0.38, d / 2 + 0.006);
          caja(w * 0.3, 0.025, 0.02, std(0xe2e8f0, { metalness: 0.8, roughness: 0.2 }), 0, y, d / 2 + 0.012);
        }
        r.h = h;
        break;
      }
      case 'ESTANTE': {
        const h = e.alto3d ?? 1.8;
        const madera = std(col(0xd6b98c), { roughness: 0.6 });
        caja(0.03, h, d, madera, -w / 2 + 0.015);
        caja(0.03, h, d, madera, w / 2 - 0.015);
        caja(w, h, 0.02, madera, 0, h / 2, -d / 2 + 0.01);
        for (let i = 0; i <= 4; i++) caja(w, 0.025, d, madera, 0, (h / 4) * i + 0.0125);
        const colores = [0x2b59f0, 0xeb6834, 0x1baf7a, 0xeda100];
        for (let i = 0; i < 3; i++) for (let k = 0; k < 5; k++) {
          caja(w * 0.08, h / 4 * 0.7, d * 0.7, std(colores[(i + k) % 4]), -w / 2 + w * (0.15 + k * 0.16), (h / 4) * i + 0.025 + (h / 4) * 0.35, 0);
        }
        r.h = h;
        break;
      }
      case 'SOFA': {
        const tela = std(col(0x7c9cc9), { roughness: 0.9 });
        caja(w, 0.42, d, tela);
        caja(w, 0.45, d * 0.25, tela, 0, 0.42 + 0.22, -d / 2 + d * 0.125);
        caja(0.14, 0.25, d, tela, -w / 2 + 0.07, 0.42 + 0.12);
        caja(0.14, 0.25, d, tela, w / 2 - 0.07, 0.42 + 0.12);
        r.h = 0.9;
        break;
      }
      case 'PANTALLA': {
        const alto = Math.max(0.4, w * 0.56);
        const y = (e.z ?? 1.4) + alto / 2;
        caja(w, alto, 0.05, std(col(0x0f172a), { roughness: 0.3 }), 0, y, 0);
        const pantalla = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, alto * 0.88),
          new THREE.MeshStandardMaterial({ color: 0x0b2540, emissive: 0x38bdf8, emissiveIntensity: 0.55 }));
        pantalla.position.set(0, y, 0.027);
        g.add(pantalla);
        if (!e.z) caja(0.06, y - alto / 2, 0.06, std(0x334155), 0, (y - alto / 2) / 2, -0.03);
        r.h = y + alto / 2;
        break;
      }
      case 'LUZ': {
        const alto = e.z || altPiso - 0.08;
        const colorLuz = new THREE.Color(e.color || '#FFE8A3');
        const base = e.intensidad ?? 0.7;
        const mat = new THREE.MeshStandardMaterial({ color: colorLuz, emissive: colorLuz, emissiveIntensity: e.luz_modo === 'APAGADA' ? 0 : 1.2 * base });
        const bombillo = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.08, Math.min(w, d) / 2), 20, 14), mat);
        bombillo.position.y = alto;
        g.add(bombillo);
        const cable = caja(0.012, altPiso - alto + 0.02, 0.012, std(0x334155), 0, alto + (altPiso - alto) / 2);
        cable.castShadow = false;
        // Halo en el suelo: se nota aunque no haya luz real (equipos sin GPU o más de 10 lámparas).
        const halo = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32),
          new THREE.MeshBasicMaterial({ color: colorLuz, transparent: true, opacity: 0.12 * base, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.rotation.x = -Math.PI / 2; halo.position.y = 0.015;
        g.add(halo);
        const luz: LuzViva = { mesh: bombillo, mat, luz: null, modo: e.luz_modo ?? 'FIJA', base, areaId: null, fase: Math.random() };
        (bombillo.userData as Record<string, unknown>)['halo'] = halo;
        (bombillo.userData as Record<string, unknown>)['colorLuz'] = colorLuz;
        this.luces.push(luz);
        r.h = alto;
        break;
      }
      case 'TEXTO':
      case 'ICONO': {
        const plano = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0 }));
        plano.rotation.x = -Math.PI / 2; plano.position.y = 0.02;
        g.add(plano);
        r.rotulo = this.rotulo(e.tipo === 'TEXTO' ? 'texto' : 'icono', e.tipo === 'TEXTO' ? esc(e.texto || 'Texto') : `<span class="material-icons">${esc(e.icono || 'place')}</span>`, e.color || '');
        r.anclaRotulo = new THREE.Vector3(0, 0.05, 0);
        r.h = 0.05;
        break;
      }
      case 'FLECHA': {
        const mat = new THREE.MeshStandardMaterial({ color: col(0x2b59f0), emissive: col(0x2b59f0), emissiveIntensity: 0.35 });
        const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 0.02, Math.max(0.06, d * 0.35)), mat);
        cuerpo.position.set(-w * 0.11, 0.015, 0);
        const punta = new THREE.Mesh(new THREE.ConeGeometry(Math.max(0.1, d * 0.5), w * 0.22, 3), mat);
        punta.rotation.z = -Math.PI / 2; punta.position.set(w * 0.39, 0.02, 0);
        punta.scale.set(1, 1, 0.12);
        g.add(cuerpo, punta);
        r.h = 0.04;
        break;
      }
      case 'CAMARA': {
        const alto = z0 || e.alto3d || 2.4;
        const estadoC = e.ref ? this.estadosSeguridad.get(e.ref) : undefined;
        const mat = std(estadoC ? new THREE.Color(colorHex(COLOR_SEGURIDAD[estadoC] ?? 0xf59e0b)) : col(0xf59e0b), { metalness: 0.3, roughness: 0.5,
          emissive: estadoC ? COLOR_SEGURIDAD[estadoC] ?? 0 : 0, emissiveIntensity: estadoC ? 0.35 : 0 });
        if (estadoC === 'ALARMA') this.alarmas.push(mat);
        const cuerpo = caja(0.24, 0.14, 0.14, mat, 0, alto, 0);
        cuerpo.rotation.z = THREE.MathUtils.degToRad(e.inclinacion ?? -20);
        const lente = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.08, 14), std(0x1e293b));
        lente.rotation.z = Math.PI / 2; lente.position.set(0.15, alto, 0);
        g.add(lente);
        caja(0.03, altPiso - alto, 0.03, std(0x475569), 0, alto + (altPiso - alto) / 2);
        // Cono de visión (se ve al previsualizar la cámara).
        const fov = e.fov ?? 70, alcance = e.alcance ?? 8;
        const cono = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * alcance, alcance, 24, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
        const cg = new THREE.Group();
        cono.rotation.z = Math.PI / 2; cono.position.x = alcance / 2;
        cg.add(cono);
        cg.position.y = alto;
        cg.rotation.z = THREE.MathUtils.degToRad(e.inclinacion ?? -20);
        cg.visible = this.camaraPrevista === e.id;
        g.add(cg);
        this.frustums.set(e.id, cono.parent as unknown as THREE.Mesh);
        r.h = alto;
        break;
      }
      case 'EQUIPO': {
        const estado = (e.ref && this.estadosEquipos.get(e.ref)) || 'DESCONOCIDO';
        const c = COLOR_ESTADO_EQUIPO[estado] ?? COLOR_ESTADO_EQUIPO['DESCONOCIDO'];
        caja(Math.max(w, 0.5), 0.04, Math.max(d, 0.4), std(0xcbd5e1), 0, 0.74);
        for (const sx of [-1, 1]) caja(0.04, 0.72, Math.max(d, 0.4) * 0.9, std(0x475569), sx * (Math.max(w, 0.5) / 2 - 0.03), 0.36);
        const pantalla = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: estado === 'ONLINE' ? 0.6 : 0.12 });
        caja(Math.min(0.6, w * 0.6), 0.34, 0.03, pantalla, 0, 1.02, -d * 0.18);
        const baliza = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 });
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), baliza);
        b.position.set(Math.min(0.6, w * 0.6) / 2, 1.25, -d * 0.18);
        g.add(b);
        if (e.ref) this.balizasEquipo.set(e.ref, [pantalla, baliza]);
        r.h = 1.3;
        break;
      }
      case 'MODELO3D': {
        const h = e.alto3d ?? 1;
        const fantasma = caja(w, h, d, new THREE.MeshStandardMaterial({ color: 0x94a3b8, wireframe: true }));
        if (e.modelo) this.cargarModelo(e.modelo, g, fantasma, w, h, d);
        r.h = h;
        break;
      }
      default: {
        caja(w, 0.4, d, std(col(0x94a3b8)));
        r.h = 0.4;
      }
    }
    if (z0 && e.tipo !== 'CAMARA' && e.tipo !== 'LUZ' && e.tipo !== 'PANTALLA') g.position.y = z0;
    g.traverse(o => { (o as Obj).userData.sel = r.sel; });
    return r;
  }

  private cargarModelo(url: string, g: THREE.Group, fantasma: THREE.Mesh, w: number, h: number, d: number): void {
    let p = this.cacheModelos.get(url);
    if (!p) {
      p = new Promise<THREE.Object3D>((res, rej) => this.loader.load(url, gltf => res(gltf.scene), undefined, rej));
      this.cacheModelos.set(url, p);
    }
    p.then(plantilla => {
      if (!g.parent) return;
      const modelo = plantilla.clone(true);
      const caja = new THREE.Box3().setFromObject(modelo);
      const tam = caja.getSize(new THREE.Vector3());
      const s = Math.min(w / (tam.x || 1), h / (tam.y || 1), d / (tam.z || 1));
      modelo.scale.setScalar(isFinite(s) && s > 0 ? s : 1);
      const c2 = new THREE.Box3().setFromObject(modelo);
      modelo.position.y -= c2.min.y;
      modelo.traverse(o => { (o as THREE.Mesh).castShadow = true; (o as Obj).userData.sel = (g as Obj).userData.sel; });
      g.remove(fantasma); liberar(fantasma);
      g.add(modelo);
    }).catch(() => { /* URL inválida: queda la caja de alambre */ });
  }

  private quitar(r: Registro): void {
    this.mundo.remove(r.grupo);
    this.luces = this.luces.filter(l => !r.grupo.getObjectById(l.mesh.id));
    this.flechasEscalera = this.flechasEscalera.filter(f => !r.grupo.getObjectById(f.mesh.id));
    this.indicadores = this.indicadores.filter(i => !esDe(r.grupo, i.mat));
    this.frustums.delete(r.sel.id);
    this.alarmas = this.alarmas.filter(m => !esDe(r.grupo, m));
    liberar(r.grupo);
    r.rotulo?.remove();
  }

  /** Solo las 10 lámparas más grandes tienen luz real (rendimiento); las demás brillan y proyectan halo. */
  private recontarLuces(): void {
    for (const l of this.luces) {
      if (l.luz) { l.luz.parent?.remove(l.luz); l.luz.dispose(); l.luz = null; }
    }
    const areas = this.datos ? this.areasDelPiso() : [];
    this.luces.forEach((l, i) => {
      const p = l.mesh.getWorldPosition(new THREE.Vector3());
      const a = areas.find(ar => dentro(this.esquinas(ar), p));
      l.areaId = a?.id ?? null;
      if (i < MAX_LUCES_REALES && this.opts.calidad === 'alta') {
        const color = (l.mesh.userData as Record<string, unknown>)['colorLuz'] as THREE.Color;
        l.luz = new THREE.PointLight(color, 0, 7, 1.6);
        l.luz.position.copy(l.mesh.position);
        l.mesh.parent?.add(l.luz);
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Llamado: baliza, anillos y luces del área
  // ════════════════════════════════════════════════════════════════════════

  private montarResalte(): void {
    if (this.resalte) { this.escena.remove(this.resalte); liberar(this.resalte); this.resalte = null; }
    this.rotuloDestino?.remove(); this.rotuloDestino = null;
    const dst = this.destino;
    if (!dst || !this.datos) return;
    const area = this.datos.areas.find(a => a.id === dst.areaId);
    const reg = this.registros.get(dst.areaId);
    if (!area || !reg) return;
    if (this.datos.meta[area.id]?.luz_llamado === false) return;
    // Posición del escritorio dentro del área compartida.
    const cap = Math.max(1, area.capacidad || 1);
    let lx = 0, lz = 0;
    if (dst.indice && cap > 1) {
      const t = (Math.min(cap, dst.indice) - 0.5) / cap - 0.5;
      if (reg.w >= reg.d) lx = t * reg.w; else lz = t * reg.d;
    }
    const r = ((area.rotacion || 0) * Math.PI) / 180;
    const x = reg.cx + lx * Math.cos(r) - lz * Math.sin(r), z = reg.cz + lx * Math.sin(r) + lz * Math.cos(r);
    this.anclaDestino.set(x, 0, z);
    const g = new THREE.Group();
    const verde = 0x9bd441;
    const columna = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 4.2, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: verde, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    columna.position.y = 2.1; columna.name = 'columna';
    g.add(columna);
    for (let i = 0; i < 2; i++) {
      const anillo = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 48),
        new THREE.MeshBasicMaterial({ color: verde, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      anillo.rotation.x = -Math.PI / 2; anillo.position.y = 0.03; anillo.name = `anillo${i}`;
      g.add(anillo);
    }
    const pin = new THREE.Group();
    const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), new THREE.MeshStandardMaterial({ color: verde, emissive: verde, emissiveIntensity: 0.9 }));
    cabeza.position.y = 0.42;
    const punta = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 20), new THREE.MeshStandardMaterial({ color: verde, emissive: verde, emissiveIntensity: 0.9 }));
    punta.rotation.x = Math.PI; punta.position.y = 0.1;
    pin.add(cabeza, punta);
    pin.position.y = 2.4; pin.name = 'pin';
    g.add(pin);
    const luzPin = new THREE.PointLight(verde, 6, 6, 1.4);
    luzPin.position.y = 1.4; luzPin.name = 'luzPin';
    g.add(luzPin);
    g.position.set(x, 0, z);
    this.escena.add(g);
    this.resalte = g;
    if (dst.titulo || dst.subtitulo) {
      this.rotuloDestino = this.rotulo('destino', `${dst.titulo ? `<b>${esc(dst.titulo)}</b>` : ''}${dst.subtitulo ? `<span>${esc(dst.subtitulo)}</span>` : ''}`, '#9BD441');
    }
  }

  private volarA(objetivo: THREE.Vector3, dist: number): void {
    const dir = this.camara.position.clone().sub(this.controles.target).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 1);
    dir.normalize();
    const hasta = objetivo.clone().addScaledVector(dir, dist * 0.7).setY(dist * 0.75);
    this.vuelo = { desde: this.camara.position.clone(), hasta, tDesde: this.controles.target.clone(), tHasta: objetivo.clone(), t0: performance.now(), dur: 1100 };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Gizmos del editor
  // ════════════════════════════════════════════════════════════════════════

  private actualizarGizmos(): void {
    for (const o of [this.anillo, this.asa, this.marco]) if (o) { this.capaGizmos.remove(o); liberar(o); }
    this.anillo = this.asa = null; this.marco = null;
    const s = this.seleccion;
    const r = s ? this.registros.get(s.id) : null;
    if (!r || this.opts.modo !== 'editor') return;
    // Marco de la selección
    const caja = new THREE.Box3().setFromObject(r.grupo);
    if (!caja.isEmpty()) {
      const helper = new THREE.Box3Helper(caja, new THREE.Color(0x2b59f0));
      this.marco = helper as unknown as THREE.LineSegments;
      this.capaGizmos.add(helper);
    }
    if (r.bloqueado) return;
    // Anillo para girar (en el suelo, alrededor del objeto)
    const radio = Math.max(0.45, Math.hypot(r.w, r.d) / 2 + 0.3);
    this.anillo = new THREE.Mesh(new THREE.TorusGeometry(radio, 0.045, 10, 64),
      new THREE.MeshBasicMaterial({ color: 0x2b59f0, transparent: true, opacity: 0.85, depthTest: false }));
    this.anillo.rotation.x = Math.PI / 2;
    this.anillo.position.set(r.cx, 0.06, r.cz);
    this.anillo.renderOrder = 10;
    this.anillo.name = 'gizmo-rotar';
    this.capaGizmos.add(this.anillo);
    // Asa para redimensionar (esquina +w/+d local)
    const rad = ((r.rot || 0) * Math.PI) / 180;
    const lx = r.w / 2, lz = r.d / 2;
    this.asa = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    const anilloAsa = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2b59f0, depthTest: false, transparent: true, opacity: 0.9 }));
    this.asa.add(anilloAsa);
    this.asa.position.set(r.cx + lx * Math.cos(rad) - lz * Math.sin(rad), 0.12, r.cz + lx * Math.sin(rad) + lz * Math.cos(rad));
    this.asa.renderOrder = 11;
    this.asa.name = 'gizmo-escalar';
    this.capaGizmos.add(this.asa);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Entrada
  // ════════════════════════════════════════════════════════════════════════

  private rayo(ev: PointerEvent | MouseEvent): void {
    const r = this.lienzo.getBoundingClientRect();
    this.puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.puntero, this.camara);
  }

  private enSuelo(ev: PointerEvent | MouseEvent): THREE.Vector3 | null {
    this.rayo(ev);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.planoSuelo, p) ? p : null;
  }

  private snap(v: number): number { return this.ajustar ? Math.round(v / 0.1) * 0.1 : v; }

  private tocar(ev: PointerEvent | MouseEvent): SeleccionPlano | null {
    this.rayo(ev);
    const hits = this.raycaster.intersectObjects(this.mundo.children, true);
    // Primero los muebles/paredes (encima); si no, el área.
    let area: SeleccionPlano | null = null;
    for (const h of hits) {
      const sel = (h.object as Obj).userData.sel;
      if (!sel) continue;
      if (sel.tipo === 'elemento') return sel;
      area ??= sel;
    }
    return area;
  }

  private readonly alBajar = (ev: PointerEvent) => {
    if (this.opts.modo === 'vista') { this.bajada = { x: ev.clientX, y: ev.clientY }; return; }
    if (this.opts.modo !== 'editor') return;
    this.lienzo.focus();
    this.bajada = { x: ev.clientX, y: ev.clientY };
    if (ev.button !== 0) return;
    // ¿Gizmo?
    this.rayo(ev);
    const giz = this.raycaster.intersectObjects([this.asa, this.anillo].filter(Boolean) as THREE.Object3D[], true)[0];
    const s = this.seleccion ? this.registros.get(this.seleccion.id) : null;
    const p = this.enSuelo(ev);
    if (giz && s && p) {
      const esAsa = giz.object === this.asa || giz.object.parent === this.asa;
      const rad = ((s.rot || 0) * Math.PI) / 180;
      const opuesto = new THREE.Vector3(s.cx - (s.w / 2) * Math.cos(rad) + (s.d / 2) * Math.sin(rad), 0, s.cz - (s.w / 2) * Math.sin(rad) - (s.d / 2) * Math.cos(rad));
      this.arrastre = { tipo: esAsa ? 'escalar' : 'rotar', reg: s, inicio: p, cx: s.cx, cz: s.cz, rot: s.rot, ang0: Math.atan2(p.z - s.cz, p.x - s.cx), opuesto };
      this.controles.enabled = false;
      return;
    }
    if (this.herramienta) return; // la herramienta actúa al soltar (clic)
    const sel = this.tocar(ev);
    if (sel && p) {
      const r = this.registros.get(sel.id)!;
      this.seleccion = sel;
      this.actualizarGizmos();
      this.opts.onSeleccion?.(sel);
      this.avisarCamara(sel);
      if (!r.bloqueado) {
        this.arrastre = { tipo: 'mover', reg: r, inicio: p, cx: r.cx, cz: r.cz, rot: r.rot, ang0: 0 };
        this.controles.enabled = false;
      }
    }
  };

  private readonly alMover = (ev: PointerEvent) => {
    if (this.opts.modo === 'tv') return;
    if (this.opts.modo === 'vista') {
      const sel = this.tocar(ev);
      if (sel?.id !== this.hover?.id) { this.pintarHover(this.hover, false); this.hover = sel; this.pintarHover(sel, true); this.lienzo.style.cursor = sel ? 'pointer' : ''; }
      return;
    }
    if (this.opts.modo !== 'editor') return;
    const p = this.enSuelo(ev);
    const a = this.arrastre;
    if (a && p) {
      const g = a.reg.grupo;
      if (a.tipo === 'mover') {
        const nx = this.snap(a.cx + (p.x - a.inicio.x)), nz = this.snap(a.cz + (p.z - a.inicio.z));
        g.position.x = nx; g.position.z = nz;
        a.reg.cx = nx; a.reg.cz = nz;
      } else if (a.tipo === 'rotar') {
        let grados = a.rot + THREE.MathUtils.radToDeg(Math.atan2(p.z - a.cz, p.x - a.cx) - a.ang0);
        if (!ev.altKey) grados = Math.round(grados / 15) * 15;
        grados = ((grados + 180) % 360 + 360) % 360 - 180;
        g.rotation.y = -THREE.MathUtils.degToRad(grados);
        a.reg.rot = grados;
      } else if (a.opuesto) {
        const rad = ((a.reg.rot || 0) * Math.PI) / 180;
        const vx = p.x - a.opuesto.x, vz = p.z - a.opuesto.z;
        const lw = Math.max(0.1, this.snap(vx * Math.cos(rad) + vz * Math.sin(rad)));
        const ld = Math.max(0.05, this.snap(-vx * Math.sin(rad) + vz * Math.cos(rad)));
        const cx = a.opuesto.x + (lw / 2) * Math.cos(rad) - (ld / 2) * Math.sin(rad);
        const cz = a.opuesto.z + (lw / 2) * Math.sin(rad) + (ld / 2) * Math.cos(rad);
        g.position.x = cx; g.position.z = cz;
        g.scale.set(lw / Math.max(0.01, a.reg.w), 1, ld / Math.max(0.01, a.reg.d));
        a.nw = lw; a.nd = ld;
        a.reg.cx = cx; a.reg.cz = cz;
      }
      this.actualizarGizmosPosicion();
      return;
    }
    if (this.herramienta && p) {
      if (this.herramienta === 'PARED') {
        this.guiaPared(p, ev.altKey);
      } else if (this.fantasma) {
        this.fantasma.visible = true;
        this.fantasma.position.set(this.snap(p.x), 0.04, this.snap(p.z));
      }
      return;
    }
    // Hover
    const sel = this.tocar(ev);
    if (sel?.id !== this.hover?.id) {
      this.pintarHover(this.hover, false);
      this.hover = sel;
      this.pintarHover(sel, true);
      this.lienzo.style.cursor = sel ? (this.registros.get(sel.id)?.bloqueado ? 'pointer' : 'grab') : '';
      this.opts.onHover?.(sel);
    }
  };

  private readonly alSubir = (ev: PointerEvent) => {
    const b = this.bajada;
    if (this.opts.modo === 'vista') {
      this.bajada = null;
      if (!b || Math.hypot(ev.clientX - b.x, ev.clientY - b.y) >= 5 || ev.button !== 0) return;
      const sel = this.tocar(ev);
      this.seleccion = sel;
      this.opts.onSeleccion?.(sel);
      this.avisarCamara(sel);
      return;
    }
    if (this.opts.modo !== 'editor') return;
    this.bajada = null;
    const fueClic = !!b && Math.hypot(ev.clientX - b.x, ev.clientY - b.y) < 5;
    const a = this.arrastre;
    if (a) {
      this.arrastre = null;
      this.controles.enabled = true;
      const reg = a.reg;
      if (a.tipo === 'mover' && !fueClic) {
        this.opts.onCambio?.(reg.sel, { x: Math.round(this.px(reg.cx - reg.w / 2)), y: Math.round(this.px(reg.cz - reg.d / 2)) });
      } else if (a.tipo === 'rotar') {
        this.opts.onCambio?.(reg.sel, { rotacion: Math.round(reg.rot) });
      } else if (a.tipo === 'escalar') {
        const ext = a;
        if (ext.nw && ext.nd) {
          reg.grupo.scale.set(1, 1, 1);
          this.opts.onCambio?.(reg.sel, {
            ancho: Math.round(this.px(ext.nw)), alto: Math.round(this.px(ext.nd)),
            x: Math.round(this.px(reg.cx - ext.nw / 2)), y: Math.round(this.px(reg.cz - ext.nd / 2)),
          });
        }
      }
      return;
    }
    if (!fueClic || ev.button !== 0) return;
    const p = this.enSuelo(ev);
    if (this.herramienta && p) {
      if (this.herramienta === 'PARED') {
        const fin = this.puntoPared(p, ev.altKey);
        if (!this.paredInicio) { this.paredInicio = fin; return; }
        if (fin.distanceTo(this.paredInicio) > 0.15) {
          this.opts.onPared?.(this.px(this.paredInicio.x), this.px(this.paredInicio.z), this.px(fin.x), this.px(fin.z));
          this.paredInicio = fin; // encadena: el siguiente tramo arranca aquí
        }
        return;
      }
      this.opts.onColocar?.(this.herramienta, this.px(this.snap(p.x)), this.px(this.snap(p.z)));
      return;
    }
    // Clic en vacío: deselecciona
    if (!this.tocar(ev)) {
      this.seleccion = null;
      this.actualizarGizmos();
      this.opts.onSeleccion?.(null);
    }
  };

  private avisarCamara(sel: SeleccionPlano | null): void {
    if (!sel || sel.tipo !== 'elemento' || !this.opts.onElegirCamara) return;
    const e = this.pisoActual()?.elementos.find(x => x.id === sel.id);
    if (e?.tipo === 'CAMARA' && e.ref) this.opts.onElegirCamara(e.ref, e.id);
  }

  private readonly alSalir = () => {
    if (this.fantasma) this.fantasma.visible = false;
    this.pintarHover(this.hover, false);
    this.hover = null;
  };

  /** Doble clic o clic derecho: termina la cadena de paredes. */
  private readonly alDobleClic = () => { this.paredInicio = null; this.limpiarGuia(); };
  private readonly alMenu = (ev: MouseEvent) => {
    if (this.herramienta === 'PARED' && this.paredInicio) { ev.preventDefault(); this.paredInicio = null; this.limpiarGuia(); }
  };

  private readonly alVisibilidad = () => { if (document.hidden) this.pausar(); else this.arrancar(); };

  /** Fin del tramo: a 10 cm y, sin Alt, con ángulos de 15° desde el inicio. */
  private puntoPared(p: THREE.Vector3, libre: boolean): THREE.Vector3 {
    const fin = new THREE.Vector3(this.snap(p.x), 0, this.snap(p.z));
    const ini = this.paredInicio;
    if (!ini || libre) return fin;
    const ang = Math.atan2(fin.z - ini.z, fin.x - ini.x);
    const largo = Math.hypot(fin.x - ini.x, fin.z - ini.z);
    const a = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    return new THREE.Vector3(this.snap(ini.x + Math.cos(a) * largo), 0, this.snap(ini.z + Math.sin(a) * largo));
  }

  private guiaPared(p: THREE.Vector3, libre: boolean): void {
    const fin = this.puntoPared(p, libre);
    if (!this.paredInicio) {
      if (!this.fantasma) {
        this.fantasma = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 16), new THREE.MeshBasicMaterial({ color: 0x2b59f0, transparent: true, opacity: 0.6 }));
        this.capaGizmos.add(this.fantasma);
      }
      this.fantasma.visible = true;
      this.fantasma.position.set(fin.x, 0.15, fin.z);
      return;
    }
    const ini = this.paredInicio;
    const largo = ini.distanceTo(fin);
    if (!this.paredGuia) {
      this.paredGuia = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x2b59f0, transparent: true, opacity: 0.45, depthWrite: false }));
      this.capaGizmos.add(this.paredGuia);
    }
    const h = this.altura();
    this.paredGuia.scale.set(Math.max(0.01, largo), h, 0.15);
    this.paredGuia.position.set((ini.x + fin.x) / 2, h / 2, (ini.z + fin.z) / 2);
    this.paredGuia.rotation.y = -Math.atan2(fin.z - ini.z, fin.x - ini.x);
    if (this.fantasma) this.fantasma.position.set(fin.x, 0.15, fin.z);
    this.opts.hud.querySelector('.rot-medida')?.remove();
    const medida = this.rotulo('medida', `${largo.toFixed(2).replace('.', ',')} m`, '#2B59F0');
    medida.dataset['x'] = String((ini.x + fin.x) / 2); medida.dataset['z'] = String((ini.z + fin.z) / 2);
  }

  private limpiarGuia(): void {
    if (this.paredGuia) { this.capaGizmos.remove(this.paredGuia); liberar(this.paredGuia); this.paredGuia = null; }
    this.opts.hud.querySelector('.rot-medida')?.remove();
  }

  private limpiarFantasma(): void {
    if (this.fantasma) { this.capaGizmos.remove(this.fantasma); liberar(this.fantasma); this.fantasma = null; }
    this.limpiarGuia();
  }

  private actualizarGizmosPosicion(): void {
    const s = this.seleccion ? this.registros.get(this.seleccion.id) : null;
    if (!s) return;
    if (this.anillo) this.anillo.position.set(s.cx, 0.06, s.cz);
    if (this.asa) {
      const rad = ((s.rot || 0) * Math.PI) / 180;
      const ext = this.arrastre;
      const lx = (ext?.nw ?? s.w) / 2, lz = (ext?.nd ?? s.d) / 2;
      this.asa.position.set(s.cx + lx * Math.cos(rad) - lz * Math.sin(rad), 0.12, s.cz + lx * Math.sin(rad) + lz * Math.cos(rad));
    }
    if (this.marco) { const b = (this.marco as unknown as THREE.Box3Helper).box; b.setFromObject(s.grupo); }
  }

  private pintarHover(sel: SeleccionPlano | null, on: boolean): void {
    if (!sel) return;
    const r = this.registros.get(sel.id);
    if (!r) return;
    r.grupo.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !('emissive' in m) || (o.name === 'flecha')) return;
      const ud = m.userData as { e0?: number; i0?: number };
      if (on) {
        if (ud.e0 === undefined) { ud.e0 = m.emissive.getHex(); ud.i0 = m.emissiveIntensity; }
        m.emissive.setHex(0x2b59f0); m.emissiveIntensity = 0.35;
      } else if (ud.e0 !== undefined) {
        m.emissive.setHex(ud.e0); m.emissiveIntensity = ud.i0 ?? 0;
        delete ud.e0; delete ud.i0;
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Bucle
  // ════════════════════════════════════════════════════════════════════════

  private tic(): void {
    const t = this.reloj.getElapsedTime();
    if (this.vuelo) {
      const v = this.vuelo;
      const u = Math.min(1, (performance.now() - v.t0) / v.dur);
      const k = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      this.camara.position.lerpVectors(v.desde, v.hasta, k);
      this.controles.target.lerpVectors(v.tDesde, v.tHasta, k);
      if (u >= 1) this.vuelo = null;
    }
    this.controles.update();

    // Flechas de escalera
    for (const f of this.flechasEscalera) {
      const u = (t * f.vel + f.fase) % 1;
      f.mesh.position.copy(f.curva(u));
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 1; mat.emissiveIntensity = 0.5 + Math.sin(u * Math.PI) * 0.7;
    }
    for (const i of this.indicadores) i.mat.emissiveIntensity = 0.2 + Math.max(0, Math.sin((t * 0.8 + i.fase) * Math.PI * 2)) * 1.2;
    const alarma = (t * 2.5) % 1 < 0.5;
    for (const m of this.alarmas) { m.emissive.setHex(0xef4444); m.emissiveIntensity = alarma ? 1.4 : 0.05; }

    // Lámparas: su modo, y parpadeo rápido si están en el área del llamado
    const llamado = this.destino?.areaId ?? null;
    for (const l of this.luces) {
      let f = l.modo === 'APAGADA' ? 0 : l.modo === 'PARPADEO' ? ((t + l.fase) % 1 < 0.5 ? 1 : 0.05)
        : l.modo === 'RESPIRA' ? 0.25 + 0.75 * (0.5 + 0.5 * Math.sin((t + l.fase) * 2.1)) : 1;
      if (llamado && l.areaId === llamado) f = (t * 3) % 1 < 0.5 ? 1.4 : 0.1;
      l.mat.emissiveIntensity = 1.3 * l.base * f;
      if (l.luz) l.luz.intensity = 6 * l.base * f;
      const halo = (l.mesh.userData as Record<string, unknown>)['halo'] as THREE.Mesh | undefined;
      if (halo) (halo.material as THREE.MeshBasicMaterial).opacity = 0.14 * l.base * f;
    }

    // Resalte del llamado
    if (this.resalte) {
      const pulso = 0.5 + 0.5 * Math.sin(t * 6);
      const col = this.resalte.getObjectByName('columna') as THREE.Mesh | undefined;
      if (col) (col.material as THREE.MeshBasicMaterial).opacity = 0.15 + pulso * 0.3;
      for (let i = 0; i < 2; i++) {
        const a = this.resalte.getObjectByName(`anillo${i}`) as THREE.Mesh | undefined;
        if (!a) continue;
        const u = (t * 0.8 + i * 0.5) % 1;
        a.scale.setScalar(1 + u * 5);
        (a.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - u);
      }
      const pin = this.resalte.getObjectByName('pin');
      if (pin) { pin.position.y = 2.4 + Math.sin(t * 3.5) * 0.18; pin.rotation.y = t * 1.5; }
      const luz = this.resalte.getObjectByName('luzPin') as THREE.PointLight | undefined;
      if (luz) luz.intensity = 3 + pulso * 7;
      // El área llamada late en su color
      const reg = this.destino ? this.registros.get(this.destino.areaId) : null;
      reg?.grupo.traverse(o => {
        if (o.name !== 'borde' && o.name !== 'pad') return;
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (o.name === 'borde') m.emissiveIntensity = 0.3 + pulso * 1.4;
        else m.opacity = 0.25 + pulso * 0.35;
      });
    }

    this.renderer.render(this.escena, this.camara);
    if (this.previewRenderer && this.previewCamara && this.camaraPrevista) this.renderPreview();
    this.actualizarHud();
  }

  private renderPreview(): void {
    const r = this.registros.get(this.camaraPrevista!);
    const e = this.pisoActual()?.elementos.find(x => x.id === this.camaraPrevista);
    if (!r || !e || !this.previewCamara || !this.previewRenderer) return;
    const alto = (e.z || e.alto3d || 2.4);
    const yaw = -THREE.MathUtils.degToRad(e.rotacion || 0);
    const pitch = THREE.MathUtils.degToRad(e.inclinacion ?? -20);
    this.previewCamara.fov = e.fov ?? 70;
    this.previewCamara.far = (e.alcance ?? 8) * 1.4;
    this.previewCamara.position.set(r.cx, alto, r.cz);
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.sin(yaw) * Math.cos(pitch));
    this.previewCamara.lookAt(r.cx + dir.x, alto + dir.y, r.cz + dir.z);
    this.previewCamara.updateProjectionMatrix();
    const vis = this.capaGizmos.visible;
    this.capaGizmos.visible = false;
    this.previewRenderer.render(this.escena, this.previewCamara);
    this.capaGizmos.visible = vis;
  }

  // ── HUD: rótulos HTML ──────────────────────────────────────────────────

  private rotulo(clase: string, html: string, color: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = `rot rot-${clase}`;
    d.innerHTML = html;
    if (color) d.style.setProperty('--c', color);
    this.opts.hud.appendChild(d);
    return d;
  }

  private readonly tmp = new THREE.Vector3();
  /** Pone el rótulo sobre el punto 3D; devuelve dónde quedó en pantalla (o null si no se ve). */
  private proyectar(v: THREE.Vector3, el: HTMLElement, visible = true): [number, number] | null {
    if (!visible) { el.style.display = 'none'; return null; }
    this.tmp.copy(v).project(this.camara);
    if (this.tmp.z > 1 || this.tmp.z < -1) { el.style.display = 'none'; return null; }
    const w = this.lienzo.clientWidth, h = this.lienzo.clientHeight;
    const x = (this.tmp.x * 0.5 + 0.5) * w, y = (-this.tmp.y * 0.5 + 0.5) * h;
    el.style.display = '';
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    return [x, y];
  }

  /** Tamaño en pantalla de un rótulo; se mide una vez (cada rótulo nuevo es otro elemento). */
  private readonly medidasRotulo = new WeakMap<HTMLElement, [number, number]>();
  private medirRotulo(el: HTMLElement): [number, number] {
    let t = this.medidasRotulo.get(el);
    if (!t) { t = [el.offsetWidth, el.offsetHeight]; if (t[0]) this.medidasRotulo.set(el, t); }
    return t;
  }

  private actualizarHud(): void {
    const dist = this.camara.position.distanceTo(this.controles.target);
    const enTv = this.opts.modo === 'tv';
    const rotulosArea: { el: HTMLElement; x: number; y: number; peso: number }[] = [];
    for (const r of this.registros.values()) {
      if (!r.rotulo || !r.anclaRotulo) continue;
      const v = r.anclaRotulo.clone().applyQuaternion(r.grupo.quaternion).add(r.grupo.position);
      const esArea = r.sel.tipo === 'area';
      const ver = esArea ? (!enTv || dist < 30 || this.destino?.areaId === r.sel.id) : dist < 40;
      const p = this.proyectar(v, r.rotulo, ver);
      r.rotulo.classList.toggle('rot--sel', this.seleccion?.id === r.sel.id);
      r.rotulo.classList.toggle('rot--llamado', this.destino?.areaId === r.sel.id);
      if (p && esArea) {
        const peso = this.destino?.areaId === r.sel.id ? 1e9 : this.seleccion?.id === r.sel.id ? 1e8 : this.hover?.id === r.sel.id ? 1e7 : r.w * r.d;
        rotulosArea.push({ el: r.rotulo, x: p[0], y: p[1], peso });
      }
    }
    // Rótulos de áreas que se pisan: queda el que más importa (el llamado, el elegido, el que
    // está bajo el ratón, el área más grande). Al acercar la cámara aparecen los demás.
    rotulosArea.sort((a, b) => b.peso - a.peso);
    const ocupados: [number, number, number, number][] = [];
    if (this.rotuloDestino && this.resalte) {
      const p = this.proyectar(this.tmp.set(this.anclaDestino.x, 3.1, this.anclaDestino.z).clone(), this.rotuloDestino);
      // El cartel cuelga hacia arriba de su punto: si la cámara lo deja fuera, se baja al borde.
      // Va primero: ningún rótulo de área lo tapa.
      if (p) {
        const [w, h] = this.medirRotulo(this.rotuloDestino);
        const ancho = this.lienzo.clientWidth;
        const x = Math.min(Math.max(p[0], w / 2 + 8), ancho - w / 2 - 8), y = Math.max(p[1], h + 8);
        this.rotuloDestino.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        ocupados.push([x - w / 2, y - h, x + w / 2, y]);
      }
    }
    for (const c of rotulosArea) {
      const [w, h] = this.medirRotulo(c.el);
      const caja: [number, number, number, number] = [c.x - w / 2 - 2, c.y - h - 2, c.x + w / 2 + 2, c.y + 2];
      if (ocupados.some(o => caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) c.el.style.display = 'none';
      else ocupados.push(caja);
    }
    const medida = this.opts.hud.querySelector('.rot-medida') as HTMLElement | null;
    if (medida) this.proyectar(new THREE.Vector3(+medida.dataset['x']!, 0.2, +medida.dataset['z']!), medida);
  }
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function liberar(o: THREE.Object3D): void {
  o.traverse(x => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(z => z.dispose()); else mat?.dispose?.();
  });
}

function esDe(g: THREE.Object3D, mat: THREE.Material): boolean {
  let si = false;
  g.traverse(o => { if ((o as THREE.Mesh).material === mat) si = true; });
  return si;
}

function dentro(poly: THREE.Vector3[], p: THREE.Vector3): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

function colorHex(n: number): string { return `#${n.toString(16).padStart(6, '0')}`; }
function colorCss(c: THREE.Color): string { return `#${c.getHexString()}`; }
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
