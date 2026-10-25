/**
 * Motor 3D de la oficina (independiente de Angular). Se carga con `await import()` desde el
 * componente para que three.js no entre en el bundle hasta que se abre la vista 3D.
 *
 * <p>Lee el MISMO dato del croquis de Turnos: las áreas (`tn_area`) y el `elementos_json` por
 * piso. El eje 2D (x, y en píxeles) se proyecta al plano del suelo (X = x, Z = y) y la altura va
 * en Y. La escala es la misma del croquis: `escalaCmPx` centímetros por píxel (2 = 1 m son 50 px).
 *
 * <p>Novedades 3D que viajan como campos opcionales del elemento (el dibujo 2D los ignora y el
 * backend los guarda tal cual): `alto3d`, `z`, `modelo`/`catalogo` y el tipo `CAMARA`, cuya
 * perspectiva se renderiza en un segundo lienzo (el previsualizador).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { Area, ElementoCroquis, PisoCroquis } from '../../service/turnos.service';
import { COLOR_TIPO } from '../../components/croquis-svg/croquis-svg';

/** Un equipo (computador/celular/activo) ubicado en el plano, coloreado por su estado. */
export interface Equipo3D {
  id: string;
  nombre: string;
  tipo: string;                 // COMPUTADOR, CELULAR, IMPRESORA…
  x: number; y: number;         // posición en píxeles del croquis
  piso?: string | null;
  estado: 'ONLINE' | 'OFFLINE' | 'INACTIVO' | 'ALERTA' | 'DESCONOCIDO';
}

type Objeto = THREE.Object3D & { userData: { elementoId?: string; equipoId?: string; tipo?: string } };

const COLOR_ESTADO: Record<Equipo3D['estado'], number> = {
  ONLINE: 0x22c55e, OFFLINE: 0x94a3b8, INACTIVO: 0xf59e0b, ALERTA: 0xef4444, DESCONOCIDO: 0x64748b,
};

/** Altura real por defecto (metros) de cada tipo de elemento, si no trae `alto3d`. */
const ALTO_POR_TIPO: Record<string, number> = {
  PARED: 2.5, MOSTRADOR: 1.1, MESA: 0.75, SILLA: 0.95, PLANTA: 1.1, VENTANA: 1.2, PUERTA: 2.1,
  MODELO3D: 1, CAMARA: 0.12, TEXTO: 0, FLECHA: 0, ICONO: 0,
};

export class EscenaOficina {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly escena = new THREE.Scene();
  private readonly camara: THREE.PerspectiveCamera;
  private readonly controles: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly loader = new GLTFLoader();
  private readonly cacheModelos = new Map<string, Promise<THREE.Object3D>>();

  /** Grupo que se vacía y rehace en cada `cargar()`. */
  private mundo = new THREE.Group();
  /** Objetos seleccionables (áreas, elementos, equipos). */
  private seleccionables: Objeto[] = [];
  private seleccionId: string | null = null;
  private marcoSeleccion: THREE.BoxHelper | null = null;

  /** Previsualizador de la cámara elegida (se engancha cuando el <canvas> aparece en el DOM). */
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewCamara: THREE.PerspectiveCamera | null = null;
  private camaraResaltada: ElementoCroquis | null = null;
  private readonly frustums = new Map<string, THREE.Group>();

  /** Modo del puntero: orbitar (OrbitControls) o mover (arrastrar en el suelo). */
  private modo: 'orbitar' | 'mover' = 'orbitar';
  private arrastrando: Objeto | null = null;
  private readonly planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** ref (endpointId) → estado en vivo, para colorear los objetos EQUIPO. */
  private estadosEquipos = new Map<string, string>();

  private anim = 0;
  private readonly m: (px: number) => number;
  private readonly escalaCmPx: number;
  /** elementoId → medio ancho/alto en px, para convertir el centro arrastrado a (x,y) esquina. */
  private readonly dims = new Map<string, { semiAncho: number; semiAlto: number }>();

  // Callbacks hacia Angular
  onSeleccion: (sel: { tipo: 'elemento' | 'area' | 'equipo'; id: string } | null) => void = () => {};
  onCambio: (id: string, patch: Partial<ElementoCroquis>) => void = () => {};

  constructor(
    private readonly contenedor: HTMLElement,
    previewCanvas: HTMLCanvasElement | null,
    escalaCmPx: number,
  ) {
    this.escalaCmPx = escalaCmPx || 2;
    this.m = (px: number) => (px * this.escalaCmPx) / 100;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.contenedor.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.escena.background = null;
    this.escena.add(this.mundo);

    this.camara = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camara.position.set(12, 14, 16);

    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.maxPolarAngle = Math.PI / 2 - 0.02; // no bajar del suelo
    this.controles.target.set(0, 0, 0);

    this.luces();

    if (previewCanvas) this.usarPreview(previewCanvas);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);

    this.redimensionar();
    this.bucle();
  }

  // ── Construcción de la escena por piso ────────────────────────────────

  cargar(piso: PisoCroquis, areas: Area[], equipos: Equipo3D[], reencuadrar = true): void {
    this.escena.remove(this.mundo);
    this.mundo.traverse(o => this.liberar(o));
    this.mundo = new THREE.Group();
    this.seleccionables = [];
    this.frustums.clear();
    this.marcoSeleccion = null;

    const anchoM = this.m(piso.ancho || 1200);
    const fondoM = this.m(piso.alto || 800);

    // Suelo + rejilla, con el origen en una esquina (todo en el cuadrante +X/+Z).
    const suelo = new THREE.Mesh(
      new THREE.PlaneGeometry(anchoM, fondoM),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.95, metalness: 0 }),
    );
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.set(anchoM / 2, 0, fondoM / 2);
    suelo.receiveShadow = true;
    this.mundo.add(suelo);
    const rejilla = new THREE.GridHelper(Math.max(anchoM, fondoM), Math.max(anchoM, fondoM));
    (rejilla.material as THREE.Material).opacity = 0.18;
    (rejilla.material as THREE.Material).transparent = true;
    rejilla.position.set(anchoM / 2, 0.01, fondoM / 2);
    this.mundo.add(rejilla);

    const alturaPiso = piso.altura3d ?? 2.7;

    for (const a of areas.filter(a => a.activa !== false)) this.construirArea(a);
    for (const e of piso.elementos || []) this.construirElemento(e, alturaPiso);
    for (const q of equipos) this.construirEquipo(q);

    this.escena.add(this.mundo);

    // Encauzar la cámara al centro del piso solo al entrar o al cambiar de piso (no en cada edición).
    if (reencuadrar) {
      this.controles.target.set(anchoM / 2, 0, fondoM / 2);
      this.camara.position.set(anchoM / 2 + Math.max(8, anchoM * 0.6), Math.max(10, alturaPiso * 4), fondoM + Math.max(8, fondoM * 0.5));
      this.controles.update();
    }

    if (this.seleccionId) this.seleccionar(this.seleccionId); // conserva selección tras rebuild
  }

  private construirArea(a: Area): void {
    const w = this.m(a.ancho), d = this.m(a.alto);
    const col = new THREE.Color((a.color || COLOR_TIPO[a.tipo]?.borde || '#2b59f0'));
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.04, d),
      new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.35, roughness: 1 }),
    ) as Objeto;
    pad.position.set(this.m(a.x + a.ancho / 2), 0.02, this.m(a.y + a.alto / 2));
    pad.rotation.y = -THREE.MathUtils.degToRad(a.rotacion || 0);
    pad.userData = { elementoId: a.id, tipo: 'AREA' };
    this.mundo.add(pad);
    this.seleccionables.push(pad);

    const etiqueta = this.sprite(a.nombre + (a.codigo ? ` · ${a.codigo}` : ''), '#0f172a');
    etiqueta.position.set(pad.position.x, 1.2, pad.position.z);
    this.mundo.add(etiqueta);
  }

  private construirElemento(e: ElementoCroquis, alturaPiso: number): void {
    const w = this.m(e.ancho), d = this.m(e.alto);
    const h = e.alto3d ?? ALTO_POR_TIPO[e.tipo] ?? 1;
    const cx = this.m(e.x + e.ancho / 2), cz = this.m(e.y + e.alto / 2);
    const rotY = -THREE.MathUtils.degToRad(e.rotacion || 0);
    const col = e.color ? new THREE.Color(e.color) : null;

    let obj: Objeto | null = null;
    switch (e.tipo) {
      case 'PARED':
        obj = this.caja(w, Math.min(h, alturaPiso), d, (col ?? new THREE.Color(0x334155)), 0.9);
        break;
      case 'MOSTRADOR':
        obj = this.caja(w, h, d, col ?? new THREE.Color(0xcbd5e1), 0.6);
        break;
      case 'MESA':
        obj = this.mesa(w, d, h, col ?? new THREE.Color(0xcbd5e1));
        break;
      case 'SILLA':
        obj = this.sillas(w, d, Math.max(1, Math.min(4, e.cantidad || 1)), col ?? new THREE.Color(0x94a3b8));
        break;
      case 'PLANTA':
        obj = this.planta(Math.max(w, 0.4), h);
        break;
      case 'PUERTA':
        obj = this.caja(w, h, Math.max(d, 0.05), col ?? new THREE.Color(0x8b5e3c), 0.7);
        break;
      case 'VENTANA':
        obj = this.caja(w, h, Math.max(d, 0.05), new THREE.Color(0x7dd3fc), 0.2, 0.45);
        break;
      case 'TEXTO':
        obj = this.sprite(e.texto || 'Texto', (e.color || '#0f172a')) as unknown as Objeto;
        break;
      case 'ICONO':
        obj = this.sprite(e.icono || '◆', (e.color || '#44526a')) as unknown as Objeto;
        break;
      case 'FLECHA':
        obj = this.flecha(w, col ?? new THREE.Color(0x2b59f0));
        break;
      case 'CAMARA':
        obj = this.camaraGizmo(e);
        break;
      case 'MODELO3D':
        obj = this.placeholder(w, h, d);
        if (e.modelo) this.cargarModelo(e, w, h, d);
        break;
      case 'EQUIPO':
        obj = this.equipoMarker(this.estadosEquipos.get(e.ref || '') || 'DESCONOCIDO', w, d);
        break;
      default:
        obj = this.caja(w, h, d, new THREE.Color(0xcbd5e1), 0.8);
    }
    if (!obj) return;

    const baseY = (e.z ?? 0) + (e.tipo === 'TEXTO' || e.tipo === 'ICONO' ? 1.4 : 0);
    obj.position.set(cx, baseY, cz);
    obj.rotation.y = rotY;
    obj.userData = { elementoId: e.id, tipo: e.tipo };
    obj.traverse(o => { (o as Objeto).userData = obj!.userData; });
    this.dims.set(e.id, { semiAncho: e.ancho / 2, semiAlto: e.alto / 2 });
    this.mundo.add(obj);
    this.seleccionables.push(obj);

    if (e.tipo === 'CAMARA') this.frustum(e, cx, cz);
  }

  private construirEquipo(q: Equipo3D): void {
    const grupo = new THREE.Group() as Objeto;
    const color = COLOR_ESTADO[q.estado] ?? COLOR_ESTADO.DESCONOCIDO;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.08, 20),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: q.estado === 'ONLINE' ? 0.5 : 0.1 }),
    );
    base.position.y = 0.04;
    const poste = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.9, 10),
      new THREE.MeshStandardMaterial({ color: 0x475569 }),
    );
    poste.position.y = 0.5;
    const baliza = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 20),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, transparent: true, opacity: 0.95 }),
    );
    baliza.position.y = 1;
    grupo.add(base, poste, baliza);
    grupo.position.set(this.m(q.x), 0, this.m(q.y));
    grupo.userData = { equipoId: q.id, tipo: 'EQUIPO' };
    grupo.traverse(o => { (o as Objeto).userData = grupo.userData; });
    this.mundo.add(grupo);
    this.seleccionables.push(grupo);

    const etiqueta = this.sprite(`${q.nombre}`, '#0f172a');
    etiqueta.position.set(grupo.position.x, 1.5, grupo.position.z);
    etiqueta.scale.multiplyScalar(0.8);
    this.mundo.add(etiqueta);
  }

  // ── Primitivas de geometría (propias; no se reusa la oficina PolyForm NC) ──

  private caja(w: number, h: number, d: number, color: THREE.Color, rough = 0.8, opacity = 1): Objeto {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, transparent: opacity < 1, opacity });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.05), Math.max(h, 0.02), Math.max(d, 0.05)), mat) as Objeto;
    mesh.position.y = h / 2;
    mesh.castShadow = true;
    const g = new THREE.Group() as Objeto;
    g.add(mesh);
    return g;
  }

  private mesa(w: number, d: number, h: number, color: THREE.Color): Objeto {
    const g = new THREE.Group() as Objeto;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const tabla = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mat);
    tabla.position.y = h;
    tabla.castShadow = true;
    g.add(tabla);
    const patas = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [sx, sz] of patas) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), mat);
      p.position.set((sx * (w / 2 - 0.08)), h / 2, (sz * (d / 2 - 0.08)));
      p.castShadow = true;
      g.add(p);
    }
    return g;
  }

  private sillas(w: number, d: number, cantidad: number, color: THREE.Color): Objeto {
    const g = new THREE.Group() as Objeto;
    const anchoUna = w / cantidad;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    for (let i = 0; i < cantidad; i++) {
      const s = new THREE.Group();
      const asiento = new THREE.Mesh(new THREE.BoxGeometry(anchoUna * 0.8, 0.08, d * 0.8), mat);
      asiento.position.y = 0.45; asiento.castShadow = true;
      const espaldar = new THREE.Mesh(new THREE.BoxGeometry(anchoUna * 0.8, 0.5, 0.07), mat);
      espaldar.position.set(0, 0.7, -d * 0.35); espaldar.castShadow = true;
      s.add(asiento, espaldar);
      s.position.x = -w / 2 + anchoUna * (i + 0.5);
      g.add(s);
    }
    return g;
  }

  private planta(diam: number, h: number): Objeto {
    const g = new THREE.Group() as Objeto;
    const maceta = new THREE.Mesh(
      new THREE.CylinderGeometry(diam * 0.35, diam * 0.28, h * 0.3, 16),
      new THREE.MeshStandardMaterial({ color: 0x9a6b4f, roughness: 0.9 }),
    );
    maceta.position.y = h * 0.15; maceta.castShadow = true;
    const follaje = new THREE.Mesh(
      new THREE.SphereGeometry(diam * 0.5, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x5e8f17, roughness: 1 }),
    );
    follaje.position.y = h * 0.65; follaje.castShadow = true;
    g.add(maceta, follaje);
    return g;
  }

  private flecha(largo: number, color: THREE.Color): Objeto {
    const g = new THREE.Group() as Objeto;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, largo * 0.7, 10), mat);
    cuerpo.rotation.z = Math.PI / 2; cuerpo.position.set(-largo * 0.15, 0.05, 0);
    const punta = new THREE.Mesh(new THREE.ConeGeometry(0.15, largo * 0.3, 12), mat);
    punta.rotation.z = -Math.PI / 2; punta.position.set(largo * 0.35, 0.05, 0);
    g.add(cuerpo, punta);
    return g;
  }

  private placeholder(w: number, h: number, d: number): Objeto {
    const g = new THREE.Group() as Objeto;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(w, 0.2), Math.max(h, 0.2), Math.max(d, 0.2)),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, wireframe: true }),
    );
    mesh.position.y = Math.max(h, 0.2) / 2;
    g.add(mesh);
    return g;
  }

  /** Marca de un equipo en el plano: un monitor sobre un escritorio + una baliza del estado en vivo. */
  private equipoMarker(estado: string, w: number, d: number): Objeto {
    const g = new THREE.Group() as Objeto;
    const color = (COLOR_ESTADO as Record<string, number>)[estado] ?? COLOR_ESTADO.DESCONOCIDO;
    const gris = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });
    const escritorio = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.4), 0.04, Math.max(d, 0.4)),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1 }));
    escritorio.position.y = 0.72; escritorio.castShadow = true;
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.4) * 0.6, 0.3, 0.03),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: estado === 'ONLINE' ? 0.5 : 0.08 }));
    monitor.position.set(0, 0.95, -d * 0.2); monitor.castShadow = true;
    const pie = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), gris);
    pie.position.set(0, 0.82, -d * 0.2);
    const baliza = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }));
    baliza.position.set(0, 1.2, -d * 0.2);
    g.add(escritorio, monitor, pie, baliza);
    return g;
  }

  /** Actualiza el mapa ref→estado; el componente rehace la escena para recolorear los equipos. */
  setEstados(map: Map<string, string>): void {
    this.estadosEquipos = map || new Map();
  }

  private camaraGizmo(e: ElementoCroquis): Objeto {
    const g = new THREE.Group() as Objeto;
    const mat = new THREE.MeshStandardMaterial({ color: (e.color || '#f59e0b'), metalness: 0.3, roughness: 0.5 });
    const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.14), mat);
    const lente = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 16), mat);
    lente.rotation.z = Math.PI / 2; lente.position.x = 0.16; // mira hacia +X local
    const soporte = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x475569 }));
    soporte.position.y = 0.12;
    g.add(cuerpo, lente, soporte);
    const alto = (e.z ?? 0) || (e.alto3d ?? 2.4);
    g.position.y = alto; // se re-posiciona en construirElemento, pero la cámara cuelga alto
    return g;
  }

  // ── Cámaras: frustum en la escena + previsualización ──────────────────

  private frustum(e: ElementoCroquis, cx: number, cz: number): void {
    const fov = e.fov ?? 70, alcance = e.alcance ?? 8;
    const altura = (e.z ?? 0) || (e.alto3d ?? 2.4);
    const geo = new THREE.ConeGeometry(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * alcance, alcance, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
    const cono = new THREE.Mesh(geo, mat);
    // El cono apunta +Y por defecto; lo giramos para que apunte +X (dirección de la cámara) y lo centramos.
    cono.rotation.z = -Math.PI / 2;
    cono.position.x = alcance / 2;
    const grupo = new THREE.Group();
    grupo.add(cono);
    grupo.position.set(cx, altura, cz);
    grupo.rotation.y = -THREE.MathUtils.degToRad(e.rotacion || 0);
    grupo.rotation.z = THREE.MathUtils.degToRad(e.inclinacion ?? 0);
    grupo.visible = false; // se muestra al resaltar la cámara
    this.mundo.add(grupo);
    this.frustums.set(e.id, grupo);
  }

  /** Engancha (o reengancha) el lienzo del previsualizador cuando aparece en el DOM. Idempotente. */
  usarPreview(canvas: HTMLCanvasElement): void {
    if (this.previewRenderer && this.previewCanvas === canvas) return;
    this.previewRenderer?.dispose();
    this.previewCanvas = canvas;
    this.previewRenderer = new THREE.WebGLRenderer({ antialias: true, canvas });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewCamara = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 200);
    this.redimensionar();
    if (this.camaraResaltada) this.colocarPreview(this.camaraResaltada);
  }

  resaltarCamara(e: ElementoCroquis | null): void {
    this.camaraResaltada = e;
    for (const [id, g] of this.frustums) g.visible = !!e && e.id === id;
    if (e) this.colocarPreview(e);
  }

  private colocarPreview(e: ElementoCroquis): void {
    if (!this.previewCamara) return;
    const cx = this.m(e.x + e.ancho / 2), cz = this.m(e.y + e.alto / 2);
    const altura = (e.z ?? 0) || (e.alto3d ?? 2.4);
    this.previewCamara.fov = e.fov ?? 70;
    this.previewCamara.far = (e.alcance ?? 8) * 1.6;
    this.previewCamara.position.set(cx, altura, cz);
    const yaw = -THREE.MathUtils.degToRad(e.rotacion || 0);
    const pitch = THREE.MathUtils.degToRad(e.inclinacion ?? 0);
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    this.previewCamara.lookAt(cx + dir.x * 5, altura + dir.y * 5, cz + dir.z * 5);
    this.previewCamara.updateProjectionMatrix();
  }

  // ── Selección / interacción ───────────────────────────────────────────

  setModo(modo: 'orbitar' | 'mover'): void {
    this.modo = modo;
    this.controles.enabled = modo === 'orbitar';
  }

  seleccionar(id: string | null): void {
    this.seleccionId = id;
    if (this.marcoSeleccion) { this.mundo.remove(this.marcoSeleccion); this.marcoSeleccion.geometry.dispose(); this.marcoSeleccion = null; }
    if (!id) return;
    const obj = this.seleccionables.find(o => o.userData.elementoId === id || o.userData.equipoId === id);
    if (!obj) return;
    this.marcoSeleccion = new THREE.BoxHelper(obj, 0x2b59f0);
    this.mundo.add(this.marcoSeleccion);
  }

  /** Mueve/ajusta el objeto seleccionado desde los controles de Angular, sin rehacer la escena. */
  actualizarElemento(id: string, patch: Partial<ElementoCroquis>): void {
    const obj = this.seleccionables.find(o => o.userData.elementoId === id);
    if (!obj) return;
    if (patch.rotacion != null) obj.rotation.y = -THREE.MathUtils.degToRad(patch.rotacion);
    if (patch.z != null) obj.position.y = patch.z;
    if ((obj.userData.tipo === 'CAMARA') && (patch.fov != null || patch.alcance != null || patch.inclinacion != null || patch.rotacion != null || patch.z != null)) {
      // Rehacer frustum y preview de esa cámara.
      const g = this.frustums.get(id);
      if (g) { this.mundo.remove(g); this.frustums.delete(id); }
      const e = this.camaraResaltada && this.camaraResaltada.id === id ? { ...this.camaraResaltada, ...patch } : null;
      if (e) { this.camaraResaltada = e; this.frustum(e, obj.position.x, obj.position.z); this.frustums.get(id)!.visible = true; this.colocarPreview(e); }
    }
    if (this.marcoSeleccion) this.marcoSeleccion.update();
  }

  private readonly puntero = new THREE.Vector2();
  private picar(ev: PointerEvent): Objeto | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.puntero, this.camara);
    const hits = this.raycaster.intersectObjects(this.seleccionables, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !(o as Objeto).userData?.elementoId && !(o as Objeto).userData?.equipoId) o = o.parent;
      if (!o) continue;
      const id = (o as Objeto).userData.elementoId ?? (o as Objeto).userData.equipoId;
      // Devolver siempre el objeto raíz (el que está en seleccionables), no un hijo de malla.
      return this.seleccionables.find(s => s.userData.elementoId === id || s.userData.equipoId === id) ?? (o as Objeto);
    }
    return null;
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    const obj = this.picar(ev);
    if (obj) {
      const sel = obj.userData.equipoId
        ? { tipo: 'equipo' as const, id: obj.userData.equipoId }
        : { tipo: (obj.userData.tipo === 'AREA' ? 'area' : 'elemento') as 'area' | 'elemento', id: obj.userData.elementoId! };
      this.seleccionar(sel.id);
      this.onSeleccion(sel);
      if (this.modo === 'mover' && obj.userData.elementoId) { this.arrastrando = obj; this.controles.enabled = false; }
    } else {
      this.seleccionar(null);
      this.onSeleccion(null);
    }
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.arrastrando) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.puntero, this.camara);
    const destino = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.planoSuelo, destino)) {
      this.arrastrando.position.x = destino.x;
      this.arrastrando.position.z = destino.z;
      if (this.marcoSeleccion) this.marcoSeleccion.update();
    }
  };

  private readonly onPointerUp = (): void => {
    if (this.arrastrando) {
      const obj = this.arrastrando;
      const id = obj.userData.elementoId!;
      const dim = this.dims.get(id) ?? { semiAncho: 0, semiAlto: 0 };
      // El objeto se mueve por su CENTRO; el croquis guarda la esquina superior izquierda.
      const centroX = Math.round((obj.position.x * 100) / this.escalaCmPx);
      const centroY = Math.round((obj.position.z * 100) / this.escalaCmPx);
      this.onCambio(id, { x: centroX - dim.semiAncho, y: centroY - dim.semiAlto });
      this.arrastrando = null;
    }
    this.controles.enabled = this.modo === 'orbitar';
  };

  // ── Modelos glTF de APIs públicas ─────────────────────────────────────

  private cargarModelo(e: ElementoCroquis, w: number, h: number, d: number): void {
    const url = e.modelo!;
    let prom = this.cacheModelos.get(url);
    if (!prom) {
      prom = new Promise<THREE.Object3D>((res, rej) => this.loader.load(url, g => res(g.scene), undefined, rej));
      this.cacheModelos.set(url, prom);
    }
    prom.then(plantilla => {
      const obj = this.seleccionables.find(o => o.userData.elementoId === e.id);
      if (!obj) return;
      const modelo = plantilla.clone(true);
      // Escalar el modelo para que quepa en la caja w×h×d.
      const caja = new THREE.Box3().setFromObject(modelo);
      const tam = caja.getSize(new THREE.Vector3());
      const escala = Math.min(w / (tam.x || 1), h / (tam.y || 1), d / (tam.z || 1));
      modelo.scale.setScalar(isFinite(escala) && escala > 0 ? escala : 1);
      modelo.traverse(o => { (o as THREE.Mesh).castShadow = true; (o as Objeto).userData = obj.userData; });
      obj.clear(); // quitar el placeholder
      obj.add(modelo);
    }).catch(() => { /* URL inválida: queda el placeholder wireframe */ });
  }

  // ── Infraestructura ───────────────────────────────────────────────────

  private luces(): void {
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9));
    const sol = new THREE.DirectionalLight(0xffffff, 1.1);
    sol.position.set(20, 30, 10);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    sol.shadow.camera.left = -40; sol.shadow.camera.right = 40;
    sol.shadow.camera.top = 40; sol.shadow.camera.bottom = -40;
    this.escena.add(sol);
  }

  private sprite(texto: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fuente = 48;
    ctx.font = `700 ${fuente}px Manrope, system-ui, sans-serif`;
    const w = Math.max(64, ctx.measureText(texto).width + 32);
    canvas.width = w; canvas.height = 72;
    ctx.font = `700 ${fuente}px Manrope, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    this.redondeado(ctx, 0, 0, w, 72, 14); ctx.fill();
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(texto, w / 2, 38);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set((w / 72) * 0.9, 0.9, 1);
    return sp;
  }

  private redondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  redimensionar(): void {
    const w = this.contenedor.clientWidth || 640, h = this.contenedor.clientHeight || 480;
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    if (this.previewRenderer && this.previewCanvas) {
      const pw = this.previewCanvas.clientWidth || 320, ph = this.previewCanvas.clientHeight || 180;
      this.previewRenderer.setSize(pw, ph, false);
      if (this.previewCamara) { this.previewCamara.aspect = pw / ph; this.previewCamara.updateProjectionMatrix(); }
    }
  }

  private readonly bucle = (): void => {
    this.anim = requestAnimationFrame(this.bucle);
    this.controles.update();
    this.renderer.render(this.escena, this.camara);
    if (this.previewRenderer && this.previewCamara && this.camaraResaltada) {
      this.previewRenderer.render(this.escena, this.previewCamara);
    }
  };

  private liberar(o: THREE.Object3D): void {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose());
    else if (mat) mat.dispose();
  }

  destruir(): void {
    cancelAnimationFrame(this.anim);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.mundo.traverse(o => this.liberar(o));
    this.controles.dispose();
    this.renderer.dispose();
    this.previewRenderer?.dispose();
    this.renderer.domElement.remove();
  }
}
