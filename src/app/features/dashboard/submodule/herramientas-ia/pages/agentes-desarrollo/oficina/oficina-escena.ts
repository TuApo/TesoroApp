/**
 * La escena: monta la oficina isometrica y la mantiene al dia con lo que dice
 * el puente. Port de `src/main.js` de agents-office, con tres diferencias que
 * importan:
 *
 *  1. Vive dentro de un contenedor, no de la ventana. Nada de `innerWidth`:
 *     el panel de Angular manda, y un `ResizeObserver` la sigue.
 *  2. No simula: los agentes se mueven porque hay tareas de verdad. El estado
 *     lo pone `aplicar()` con lo que devuelve /ia/agentes/estado.
 *  3. El bucle se para solo cuando la pestaña no se ve o el componente muere.
 *     Una escena 3D corriendo de fondo en una plataforma de RRHH es una fuga
 *     de bateria, no una animacion.
 *
 * No trae DOM propio salvo las chapitas de nombre, que son HTML sobre el canvas
 * (texto nitido a cualquier zoom, y clicables).
 */
import * as THREE from 'three';

import {
  Cerebro, Escritorio, Holo, ModoTrabajo,
  limpiarCaches, makeCerebro, makeChair, makeDesk, makeHolo, makePerson, makePlant,
  makePlinth, makeWalkway, makeWarnSprite, poseWork,
} from './builders';
import {
  DeptoPlano, EstadoPuesto, EstadoVivo, PlanoOficina, PuestoPlano, PuestoVivo,
  TONO_CEREBRO, posicionPuesto,
} from './oficina-plano';

export type Calidad = 'alta' | 'media' | 'baja';

export interface OpcionesEscena {
  canvas: HTMLCanvasElement;
  /** Capa HTML por encima del canvas donde van las chapitas y los rotulos. */
  hud: HTMLElement;
  /** El elemento que manda el tamaño (el hueco de la pestaña). */
  contenedor: HTMLElement;
  calidad?: Calidad;
  /** Click en un agente. */
  onAgente?: (clave: string) => void;
  /** Entrar o salir del foco de un departamento (null = vista general). */
  onDepto?: (clave: string | null) => void;
  /** Click en un nodo del cerebro (documento del modulo Conocimiento). */
  onDocumento?: (id: number, nombre: string) => void;
}

interface PuestoRT {
  p: PuestoPlano;
  depto: DeptoPlano;
  persona: THREE.Group;
  escritorio: Escritorio;
  aviso: THREE.Sprite;
  holo: Holo | null;
  chapa: HTMLDivElement;
  asiento: THREE.Vector3;
  giroAsiento: number;
  estado: EstadoPuesto;
  modo: ModoTrabajo;
  proxModo: number;
  fase: number;
  pintado: string;
  /** Tamaño real de la chapita. En display:none mide 0, y sin esto no colisiona con nada. */
  tam: { w: number; h: number } | null;
}

interface DeptoRT {
  d: DeptoPlano;
  group: THREE.Group;
  rotulo: HTMLDivElement;
  anclaRotulo: THREE.Vector3;
  az: number;
}

const FR = 42;                 // media altura del frustum a zoom 1
const CAM_DIST = 220;
const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
const UPV = new THREE.Vector3(0, 1, 0);
const ANG_PUESTO = Math.PI / 4; // la estacion gira 45° para que el monitor mire a camara
const PERIODO_BARRIDO = 16000;
const ZOOM_MIN = 0.28;
const ZOOM_MAX = 5.2;

export class OficinaEscena {
  private readonly opts: OpcionesEscena;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);

  private readonly vista = { target: new THREE.Vector3(0, 0, 0), zoom: 0.8, arc: 0 };
  private tween: {
    t0: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3;
    fromZ: number; toZ: number; arc: number; alAcabar?: () => void;
  } | null = null;

  private readonly puestos = new Map<string, PuestoRT>();
  private readonly deptos = new Map<string, DeptoRT>();
  private cerebro: Cerebro | null = null;
  private cerebroGroup: THREE.Group | null = null;

  private readonly blancosPersona: THREE.Object3D[] = [];
  private readonly blancosPlinto: THREE.Object3D[] = [];
  private readonly desechables: { dispose(): void }[] = [];

  private enfocado: string | null = null;
  private atenuar = 0;
  private atenuarObjetivo = 0;
  private readonly atenuados: { mesh: THREE.Mesh | THREE.Line | THREE.Sprite; orig: THREE.Material }[] = [];
  private readonly cacheAtenuado = new Map<string, THREE.Material>();

  private readonly ray = new THREE.Raycaster();
  private readonly planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private arrastre: { x: number; y: number; movido: boolean } | null = null;

  private rafId = 0;
  private ultimo = 0;
  private vivo = true;
  private oscuro = false;
  private calidad: Calidad;
  private readonly ro: ResizeObserver;
  /** Caja del mundo construido; de aqui sale el encuadre de la vista general. */
  private limites = new THREE.Box3(new THREE.Vector3(-40, 0, -40), new THREE.Vector3(40, 9, 40));

  private readonly v3 = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(opts: OpcionesEscena) {
    this.opts = opts;
    this.calidad = opts.calidad ?? 'alta';

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas, antialias: this.calidad !== 'baja', alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.calidad === 'alta' ? 2 : 1.35));
    this.renderer.shadowMap.enabled = this.calidad === 'alta';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.luces();

    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(opts.contenedor);

    this.escuchar();
    this.redimensionar();
  }

  // ── Montaje ───────────────────────────────────────────────────────────────

  private luces(): void {
    this.scene.add(new THREE.HemisphereLight(0xfdfff8, 0xd8d4c8, 0.9));
    const key = new THREE.DirectionalLight(0xfff1dd, 2.1);
    key.position.set(-60, 90, 20);
    if (this.calidad === 'alta') {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -140;
      key.shadow.camera.right = 140;
      key.shadow.camera.top = 140;
      key.shadow.camera.bottom = -140;
      key.shadow.camera.far = 400;
      key.shadow.bias = -0.0006;
    }
    this.scene.add(key);

    const geo = new THREE.PlaneGeometry(700, 700);
    const matSombra = new THREE.ShadowMaterial({ opacity: 0.13 });
    const suelo = new THREE.Mesh(geo, matSombra);
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.y = -7;
    suelo.receiveShadow = true;
    this.scene.add(suelo);
    this.desechables.push(geo, matSombra);
  }

  /** Levanta la oficina entera. Llamar de nuevo la tira y la vuelve a montar. */
  construir(plano: PlanoOficina): void {
    this.vaciar();

    // La caja se arma de los plintos, no de un radio: los departamentos no son
    // cuadrados ni estan a la misma distancia, y encuadrar por radio dejaba
    // media pantalla vacia.
    this.limites.makeEmpty();
    for (const d of plano.deptos) {
      this.limites.expandByPoint(new THREE.Vector3(d.pos[0] - d.w / 2, 0, d.pos[1] - d.d / 2));
      this.limites.expandByPoint(new THREE.Vector3(d.pos[0] + d.w / 2, 9, d.pos[1] + d.d / 2));
    }
    if (this.limites.isEmpty()) this.limites.set(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 9, 20));

    // ── Cerebro al centro ──
    const gc = new THREE.Group();
    const plintoC = makePlinth(16, 16, TONO_CEREBRO.floor);
    plintoC.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.userData['depto'] = 'cerebro';
        this.blancosPlinto.push(o);
      }
    });
    gc.add(plintoC);
    const cerebro = makeCerebro(plano.cerebro.nodos, 6.8);
    cerebro.group.position.y = 6.4;
    cerebro.group.traverse((o) => { o.userData['depto'] = 'nucleo'; });
    gc.add(cerebro.group);
    const mata = makePlant();
    mata.position.set(6.2, 0.12, -5.8);
    mata.traverse((o) => { o.userData['depto'] = 'cerebro'; });
    gc.add(mata);
    this.scene.add(gc);
    this.cerebro = cerebro;
    this.cerebroGroup = cerebro.group;
    this.desechables.push(cerebro);

    this.rotuloCerebro(plano);

    // ── Departamentos ──
    for (const d of plano.deptos) {
      const g = new THREE.Group();
      g.position.set(d.pos[0], 0, d.pos[1]);
      const plinto = makePlinth(d.w, d.d, d.tono.floor);
      plinto.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.userData['depto'] = d.clave;
          this.blancosPlinto.push(o);
        }
      });
      g.add(plinto);
      this.scene.add(g);

      // Pasarela del departamento al cerebro.
      const largo = Math.hypot(d.pos[0], d.pos[1]);
      const ux = d.pos[0] / largo;
      const uz = d.pos[1] / largo;
      const desde: [number, number] = [d.pos[0] - ux * (d.d / 2), d.pos[1] - uz * (d.d / 2)];
      const hasta: [number, number] = [ux * 7.2, uz * 7.2];
      const pasarela = makeWalkway(desde, hasta);
      pasarela.userData['depto'] = d.clave;
      this.scene.add(pasarela);

      const mata2 = makePlant();
      mata2.position.set(d.pos[0] + ux * (d.w / 2 - 1.6), 0.12, d.pos[1] + uz * (d.d / 2 - 1.6));
      mata2.traverse((o) => { o.userData['depto'] = d.clave; });
      this.scene.add(mata2);

      const rotulo = this.crearRotulo(d);
      this.deptos.set(d.clave, {
        d,
        group: g,
        rotulo,
        // La esquina mas alta en pantalla: en isometrica lo de arriba es -(x+z).
        // Anclar al centro dejaba el rotulo encima de los escritorios al enfocar.
        anclaRotulo: new THREE.Vector3(d.pos[0] - d.w / 2, 6.5, d.pos[1] - d.d / 2),
        az: Math.atan2(d.pos[1], d.pos[0]),
      });

      for (const p of d.puestos) this.montarPuesto(p, d);
    }

    this.vistaGeneral(false);
  }

  private montarPuesto(p: PuestoPlano, d: DeptoPlano): void {
    const [wx, wz] = posicionPuesto(d, p);
    const base = new THREE.Vector3(wx, 0.12, wz);
    const gira = (v: THREE.Vector3) => v.applyAxisAngle(UPV, ANG_PUESTO);

    const estacion = new THREE.Group();
    estacion.position.copy(base);
    estacion.rotation.y = ANG_PUESTO;
    const escritorio = makeDesk(d.tono.chip);
    estacion.add(escritorio.group);
    const silla = makeChair();
    silla.position.set(0, 0, 1.75);
    estacion.add(silla);
    estacion.traverse((o) => { o.userData['depto'] = d.clave; });
    this.scene.add(estacion);

    const persona = makePerson({ hair: p.pelo, skin: p.piel, chip: d.tono.chip, lead: p.lead });
    persona.position.copy(base).add(gira(new THREE.Vector3(0, 0, 1.7)));
    persona.rotation.y = ANG_PUESTO + Math.PI;
    persona.traverse((o) => {
      o.userData['depto'] = d.clave;
      if (o instanceof THREE.Mesh) {
        o.userData['agente'] = p.clave;
        this.blancosPersona.push(o);
      }
    });
    this.scene.add(persona);

    const aviso = makeWarnSprite();
    aviso.visible = false;
    aviso.position.copy(persona.position).setY(7.2);
    aviso.userData['depto'] = d.clave;
    this.scene.add(aviso);

    const chapa = document.createElement('div');
    chapa.className = 'of-chapa';
    chapa.dataset['agente'] = p.clave;
    chapa.innerHTML = (p.lead ? '<span class="of-estrella">★</span>' : '') + escapar(p.nombre);
    chapa.addEventListener('click', (e) => {
      e.stopPropagation();
      this.opts.onAgente?.(p.clave);
    });
    this.opts.hud.appendChild(chapa);

    this.puestos.set(p.clave, {
      p, depto: d, persona, escritorio, aviso, holo: null, chapa,
      asiento: persona.position.clone(),
      giroAsiento: ANG_PUESTO + Math.PI,
      estado: 'reposo',
      modo: 'read',
      proxModo: 0,
      fase: Math.random() * 6000,
      pintado: '',
      tam: null,
    });
  }

  private crearRotulo(d: DeptoPlano): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'of-rotulo';
    el.style.setProperty('--chip', d.tono.chip);
    el.style.setProperty('--ink', d.tono.ink);
    el.innerHTML = `<b>${escapar(d.nombre)}</b><span class="of-rotulo-n">${d.puestos.length}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.enfocar(this.enfocado === d.clave ? null : d.clave);
    });
    this.opts.hud.appendChild(el);
    return el;
  }

  private rotuloCerebro(plano: PlanoOficina): void {
    const el = document.createElement('div');
    el.className = 'of-rotulo of-rotulo-cerebro';
    el.style.setProperty('--chip', TONO_CEREBRO.chip);
    el.style.setProperty('--ink', TONO_CEREBRO.ink);
    const n = plano.cerebro.nodos.length;
    el.innerHTML = `<b>CONOCIMIENTO</b><span class="of-rotulo-n">${n}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.enfocar(this.enfocado === 'cerebro' ? null : 'cerebro');
    });
    this.opts.hud.appendChild(el);
    this.deptos.set('cerebro', {
      d: {
        clave: 'cerebro', nombre: 'CONOCIMIENTO', tono: TONO_CEREBRO,
        pos: [0, 0], w: 16, d: 16, cols: 1, puestos: [],
      },
      group: new THREE.Group(),
      rotulo: el,
      anclaRotulo: new THREE.Vector3(-8, 11, -8),
      az: 0,
    });
  }

  // ── Estado vivo ───────────────────────────────────────────────────────────

  /** Cruza lo que devuelve el puente con los muñecos. Barato: solo repinta lo que cambio. */
  aplicar(vivo: EstadoVivo): void {
    for (const rt of this.puestos.values()) {
      const v: PuestoVivo | undefined = vivo.puestos.get(rt.p.clave);
      const estado: EstadoPuesto = v?.estado ?? 'reposo';
      const firma = estado + '|' + (v?.titulo ?? '') + '|' + (v?.lineas.join('¦') ?? '');

      if (rt.estado !== estado) {
        rt.estado = estado;
        rt.proxModo = 0;
        rt.aviso.visible = estado === 'error';
        rt.chapa.classList.toggle('trabajando', estado === 'trabajando');
        rt.chapa.classList.toggle('encola', estado === 'en_cola');
        rt.chapa.classList.toggle('malo', estado === 'error');
      }

      if (firma !== rt.pintado) {
        rt.pintado = firma;
        rt.escritorio.pantalla.dibujar(
          v?.titulo ?? '○ en reposo',
          v?.lineas ?? ['▸ …'],
          rt.depto.tono.chip,
        );
        this.sincronizarHolo(rt, v ?? null);
      }
    }
  }

  /** El holo flotante solo existe mientras el agente trabaja: es lo que se lee de lejos. */
  private sincronizarHolo(rt: PuestoRT, v: PuestoVivo | null): void {
    const debe = v?.estado === 'trabajando';
    if (debe && !rt.holo) {
      const holo = makeHolo(rt.p.nombre, rt.depto.tono.chip, v?.lineas ?? []);
      holo.mesh.position.copy(rt.asiento).setY(8.6);
      holo.mesh.rotation.y = ANG_PUESTO;
      holo.mesh.userData['depto'] = rt.depto.clave;
      this.scene.add(holo.mesh);
      rt.holo = holo;
    } else if (!debe && rt.holo) {
      this.scene.remove(rt.holo.mesh);
      rt.holo.dispose();
      rt.holo = null;
    }
    if (rt.holo && v) rt.holo.dibujar(rt.p.nombre, v.lineas);
  }

  // ── Camara ────────────────────────────────────────────────────────────────

  private aplicarCamara(): void {
    const { clientWidth: w, clientHeight: h } = this.opts.contenedor;
    const aspect = (w || 1) / (h || 1);
    this.camera.left = -FR * aspect;
    this.camera.right = FR * aspect;
    this.camera.top = FR;
    this.camera.bottom = -FR;
    this.camera.zoom = this.vista.zoom;
    const iso = ISO.clone();
    if (this.vista.arc) iso.applyAxisAngle(UPV, this.vista.arc);
    this.camera.position.copy(this.vista.target).addScaledVector(iso, CAM_DIST);
    this.camera.lookAt(this.vista.target);
    this.camera.updateProjectionMatrix();
  }

  /** Easing de la casa: cubic-bezier(0.2, 0.8, 0.2, 1). */
  private static bezier(t: number): number {
    const cx = 3 * 0.2;
    const bx = 3 * (0.2 - 0.2) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * 0.8;
    const by = 3 * (1 - 0.8) - cy;
    const ay = 1 - cy - by;
    let u = t;
    for (let i = 0; i < 5; i++) {
      const x = ((ax * u + bx) * u + cx) * u - t;
      const dx = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(dx) < 1e-6) break;
      u -= x / dx;
    }
    return ((ay * u + by) * u + cy) * u;
  }

  private volarA(destino: THREE.Vector3, zoom: number, dur = 800, arc = 0, alAcabar?: () => void): void {
    this.tween = {
      t0: performance.now(), dur,
      fromT: this.vista.target.clone(), toT: destino.clone(),
      fromZ: this.vista.zoom, toZ: zoom, arc, alAcabar,
    };
  }

  private tickTween(ahora: number): void {
    const tw = this.tween;
    if (!tw) return;
    const k = Math.min(1, (ahora - tw.t0) / tw.dur);
    const e = OficinaEscena.bezier(k);
    this.vista.target.lerpVectors(tw.fromT, tw.toT, e);
    this.vista.zoom = tw.fromZ + (tw.toZ - tw.fromZ) * e;
    this.vista.arc = Math.sin(e * Math.PI) * tw.arc;
    if (k >= 1) {
      const cb = tw.alAcabar;
      this.vista.arc = 0;
      this.tween = null;
      cb?.();
    }
  }

  /**
   * Encuadra la oficina entera. En isometrica el mundo se proyecta como un rombo
   * mas ancho que alto, asi que el zoom no sale de un radio: se lleva la caja
   * del mundo al espacio de la camara y se mide alli.
   */
  vistaGeneral(volando = true): void {
    this.enfocado = null;
    this.atenuarObjetivo = 0;
    this.opts.onDepto?.(null);
    const destino = this.limites.getCenter(new THREE.Vector3());
    destino.y = 0;
    if (volando) this.volarA(destino, this.zoomQueEncuadra(destino), 700);
    else {
      this.vista.target.copy(destino);
      this.vista.zoom = this.zoomQueEncuadra(destino);
      this.aplicarCamara();
    }
  }

  private zoomQueEncuadra(centro: THREE.Vector3): number {
    const w = this.opts.contenedor.clientWidth || 1;
    const h = this.opts.contenedor.clientHeight || 1;
    const aspect = w / h;

    // Orientacion de la camara mirando al centro (no depende del zoom).
    // Matrix4.lookAt escribe solo la rotacion (sin traslacion), y una rotacion
    // ortonormal se invierte transponiendola.
    const ojo = centro.clone().addScaledVector(ISO, CAM_DIST);
    const inv = new THREE.Matrix4().lookAt(ojo, centro, UPV).transpose();

    const min = this.limites.min;
    const max = this.limites.max;
    let ex = 1;
    let ey = 1;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z)
        .sub(centro)
        .applyMatrix4(inv);
      ex = Math.max(ex, Math.abs(p.x));
      ey = Math.max(ey, Math.abs(p.y));
    }
    // 0.94 deja un respiro para los rotulos, que van por encima del borde.
    const z = Math.min((FR * aspect) / ex, FR / ey) * 0.94;
    return clamp(z, ZOOM_MIN, 1.6);
  }

  enfocar(clave: string | null): void {
    if (!clave) {
      this.vistaGeneral();
      return;
    }
    const rt = this.deptos.get(clave);
    if (!rt) return;
    this.enfocado = clave;
    this.atenuarObjetivo = 1;
    this.aplicarAtenuado(clave);
    this.opts.onDepto?.(clave);
    const destino = new THREE.Vector3(rt.d.pos[0], 0, rt.d.pos[1]);
    const holgura = Math.max(rt.d.w, rt.d.d) * 0.75 + 6;
    this.volarA(destino, clamp(FR / holgura, 0.9, 3.2), 800, 0.22);
  }

  /** Centra la camara en un agente concreto sin cambiar el foco de departamento. */
  irAAgente(clave: string): void {
    const rt = this.puestos.get(clave);
    if (!rt) return;
    if (this.enfocado !== rt.depto.clave) {
      this.enfocado = rt.depto.clave;
      this.atenuarObjetivo = 1;
      this.aplicarAtenuado(rt.depto.clave);
      this.opts.onDepto?.(rt.depto.clave);
    }
    this.volarA(rt.asiento.clone().setY(0), 2.4, 750, 0.18);
    rt.chapa.classList.add('senalado');
    setTimeout(() => rt.chapa.classList.remove('senalado'), 2400);
  }

  paso(f: number): void {
    this.tween = null;
    this.vista.zoom = clamp(this.vista.zoom * f, ZOOM_MIN, ZOOM_MAX);
    this.aplicarCamara();
  }

  // ── Atenuado del resto de la escena al enfocar ─────────────────────────────

  private gemeloAtenuado(m: THREE.Material): THREE.Material {
    const hit = this.cacheAtenuado.get(m.uuid);
    if (hit) return hit;
    const d = m.clone();
    const dc = d as THREE.Material & { color?: THREE.Color };
    const mc = m as THREE.Material & { color?: THREE.Color };
    if (dc.color && mc.color) {
      const l = (mc.color.r + mc.color.g + mc.color.b) / 3;
      dc.color.setRGB(l * 0.4 + 0.1, l * 0.4 + 0.1, l * 0.38 + 0.09);
    }
    d.userData['base'] = mc.color?.clone();
    d.userData['dim'] = dc.color?.clone();
    this.cacheAtenuado.set(m.uuid, d);
    this.desechables.push(d);
    return d;
  }

  private aplicarAtenuado(clave: string): void {
    this.restaurarAtenuado();
    this.scene.traverse((o) => {
      const esVisual = o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite;
      if (!esVisual) return;
      const material = (o as THREE.Mesh).material;
      if (!material || Array.isArray(material) || material instanceof THREE.ShadowMaterial) return;
      const depto = o.userData['depto'] as string | undefined;
      if (!depto || depto === clave) return;
      if (clave === 'cerebro' && depto === 'nucleo') return;
      this.atenuados.push({ mesh: o as THREE.Mesh, orig: material });
      (o as THREE.Mesh).material = this.gemeloAtenuado(material);
    });
  }

  private restaurarAtenuado(): void {
    for (const s of this.atenuados) (s.mesh as THREE.Mesh).material = s.orig;
    this.atenuados.length = 0;
  }

  private tickAtenuado(dt: number): void {
    this.atenuar += (this.atenuarObjetivo - this.atenuar) * (1 - Math.exp(-dt * 5));
    if (this.atenuarObjetivo === 0 && this.atenuar < 0.02 && this.atenuados.length) this.restaurarAtenuado();
    for (const m of this.cacheAtenuado.values()) {
      const base = m.userData['base'] as THREE.Color | undefined;
      const dim = m.userData['dim'] as THREE.Color | undefined;
      const mc = m as THREE.Material & { color?: THREE.Color };
      if (base && dim && mc.color) mc.color.copy(base).lerp(dim, this.atenuar);
    }
  }

  // ── Barrido: el cerebro "piensa" en un departamento cada vez ───────────────

  private tickBarrido(ahora: number): { theta: number; fuerza: number; col: string } {
    const on = !this.enfocado || this.enfocado === 'cerebro' ? 1 : 1 - this.atenuar;
    const theta = ((ahora % PERIODO_BARRIDO) / PERIODO_BARRIDO) * Math.PI * 2;
    let domS = 0;
    let domCol = '#FFFFFF';
    for (const rt of this.deptos.values()) {
      if (rt.d.clave === 'cerebro') continue;
      const d = Math.atan2(Math.sin(theta - rt.az), Math.cos(theta - rt.az));
      let s = Math.max(0, 1 - Math.abs(d) / 0.7);
      s = s * s * (3 - 2 * s) * on;
      if (s > domS) {
        domS = s;
        domCol = rt.d.tono.chip;
      }
      const brilla = s > 0.55;
      if (brilla !== rt.rotulo.classList.contains('barrido')) {
        rt.rotulo.classList.toggle('barrido', brilla);
      }
    }
    return { theta, fuerza: domS, col: domCol };
  }

  // ── Poses ─────────────────────────────────────────────────────────────────

  private static readonly MODOS_REPOSO: ModoTrabajo[] = ['read', 'glance', 'sip', 'spin', 'stretch'];
  private static readonly MODOS_TRABAJO: ModoTrabajo[] = ['type', 'type', 'type', 'read', 'phone'];

  private tickPoses(ahora: number, dt: number): void {
    for (const rt of this.puestos.values()) {
      if (ahora >= rt.proxModo) {
        const lote = rt.estado === 'trabajando'
          ? OficinaEscena.MODOS_TRABAJO
          : rt.estado === 'error'
            ? (['wave'] as ModoTrabajo[])
            : rt.estado === 'en_cola'
              ? (['read', 'glance', 'sip'] as ModoTrabajo[])
              : OficinaEscena.MODOS_REPOSO;
        rt.modo = lote[Math.floor(Math.random() * lote.length)];
        // Trabajando se cambia de postura mas seguido: la oficina tiene que latir.
        const base = rt.estado === 'trabajando' ? 2600 : 6000;
        rt.proxModo = ahora + base + Math.random() * base;
      }
      poseWork(rt.persona, rt.modo, ahora + rt.fase, dt);
      if (rt.aviso.visible) {
        rt.aviso.material.opacity = 0.65 + 0.35 * Math.sin(ahora / 260);
      }
      if (rt.holo) {
        rt.holo.mesh.position.y = 8.6 + Math.sin((ahora + rt.fase) / 900) * 0.14;
      }
    }
  }

  // ── Chapitas y rotulos sobre el canvas ────────────────────────────────────

  private aPantalla(p: THREE.Vector3): [number, number] {
    const { clientWidth: w, clientHeight: h } = this.opts.contenedor;
    this.v3.copy(p).project(this.camera);
    return [(this.v3.x * 0.5 + 0.5) * w, (-this.v3.y * 0.5 + 0.5) * h];
  }

  private tickHud(): void {
    const { clientWidth: W, clientHeight: H } = this.opts.contenedor;
    const z = this.vista.zoom;

    // Los rotulos van PRIMERO: mandan sobre las chapitas. Con 22 departamentos en
    // corona se pisaban unos a otros y tapaban nombres de agente, y un rotulo a
    // medias es peor que no ponerlo.
    const ocupado: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const escalaRot = 1.02 - 0.3 * suave(1.2, 2.6, z);
    const rotulos = [...this.deptos.values()]
      .map((rt) => {
        const [sx, sy] = this.aPantalla(rt.anclaRotulo);
        return { rt, sx, sy };
      })
      .sort((a, b) => a.sy - b.sy);

    for (const { rt, sx: sx0, sy: sy0 } of rotulos) {
      const bw = rt.rotulo.offsetWidth * escalaRot;
      const bh = rt.rotulo.offsetHeight * escalaRot;

      // Fuera de pantalla no se pinta: arrimarlo al borde amontonaba etiquetas de
      // departamentos que no se estan viendo.
      if (sx0 < -bw || sx0 > W + bw || sy0 < -bh || sy0 > H + bh) {
        rt.rotulo.style.display = 'none';
        continue;
      }
      rt.rotulo.style.display = '';

      let sx = clamp(sx0, bw / 2 + 6, W - bw / 2 - 6);
      let sy = clamp(sy0, bh + 6, H - 6);

      // Empuja hacia arriba mientras choque con uno ya colocado.
      for (let intento = 0; intento < 14; intento++) {
        const caja = { x0: sx - bw / 2, y0: sy - bh, x1: sx + bw / 2, y1: sy };
        const choque = ocupado.find((o) => solapa(o, caja));
        if (!choque) break;
        sy = choque.y0 - 3;
        if (sy < bh + 6) {
          sx = sx < W / 2 ? sx + bw * 0.55 : sx - bw * 0.55;
          sy = clamp(sy0, bh + 6, H - 6);
        }
      }
      ocupado.push({ x0: sx - bw / 2, y0: sy - bh, x1: sx + bw / 2, y1: sy });

      rt.rotulo.style.transform =
        `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${escalaRot.toFixed(3)})`;
      const apagado = this.enfocado && this.enfocado !== rt.d.clave;
      rt.rotulo.style.opacity = apagado ? String(1 - 0.7 * this.atenuar) : '1';
    }

    const escalaChapa = 0.6 + 0.4 * suave(0.9, 2.2, z);
    // Con 81 chapitas a la vez no se lee nada: de lejos solo quedan los que trabajan.
    const soloActivos = z < 1.15;

    for (const rt of this.puestos.values()) {
      const p = rt.persona.position;
      const alto = 5.9 * (rt.p.lead ? 1.12 : 1);
      const [sx, sy] = this.aPantalla(this.v3.set(p.x, p.y + alto, p.z).clone());
      const fuera = sx < -80 || sx > W + 80 || sy < -40 || sy > H + 40;
      if (fuera || (soloActivos && rt.estado === 'reposo')) {
        if (rt.chapa.style.display !== 'none') rt.chapa.style.display = 'none';
        continue;
      }

      // Una chapita nunca se come un rotulo de departamento. La primera vez que
      // aparece hay que medirla ya visible: oculta mide 0 y no chocaria con nada.
      if (!rt.tam) {
        rt.chapa.style.display = 'block';
        rt.tam = { w: rt.chapa.offsetWidth, h: rt.chapa.offsetHeight };
      } else {
        const cw = rt.tam.w * escalaChapa;
        const ch = rt.tam.h * escalaChapa;
        const caja = { x0: sx - cw / 2, y0: sy - ch, x1: sx + cw / 2, y1: sy };
        if (ocupado.some((o) => solapa(o, caja))) {
          if (rt.chapa.style.display !== 'none') rt.chapa.style.display = 'none';
          continue;
        }
        ocupado.push(caja);
      }

      rt.chapa.style.display = 'block';
      rt.chapa.style.transform =
        `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${escalaChapa.toFixed(3)})`;
      const apagado = this.enfocado && this.enfocado !== 'cerebro' && rt.depto.clave !== this.enfocado;
      rt.chapa.style.opacity = apagado ? String(1 - 0.85 * this.atenuar) : '1';
    }
  }

  // ── Interaccion ───────────────────────────────────────────────────────────

  private readonly onRueda = (e: WheelEvent): void => {
    e.preventDefault();
    this.tween = null;
    this.vista.arc = 0;
    const [nx, ny] = this.normalizado(e.clientX, e.clientY);
    const antes = this.enSuelo(nx, ny);
    this.vista.zoom = clamp(this.vista.zoom * Math.exp(-e.deltaY * 0.0032), ZOOM_MIN, ZOOM_MAX);
    this.aplicarCamara();
    const despues = this.enSuelo(nx, ny);
    if (antes && despues) this.vista.target.add(antes.sub(despues));
    if (this.vista.zoom < 1.1 && this.enfocado && this.enfocado !== 'cerebro') {
      this.enfocado = null;
      this.atenuarObjetivo = 0;
      this.opts.onDepto?.(null);
    }
  };

  private readonly onDown = (e: PointerEvent): void => {
    this.arrastre = { x: e.clientX, y: e.clientY, movido: false };
  };

  private readonly onMove = (e: PointerEvent): void => {
    const dr = this.arrastre;
    if (!dr) return;
    if (Math.abs(e.clientX - dr.x) + Math.abs(e.clientY - dr.y) > 4) dr.movido = true;
    if (!dr.movido) return;
    this.tween = null;
    const a = this.enSuelo(...this.normalizado(dr.x, dr.y));
    const b = this.enSuelo(...this.normalizado(e.clientX, e.clientY));
    if (a && b) this.vista.target.add(a.sub(b));
    dr.x = e.clientX;
    dr.y = e.clientY;
  };

  private readonly onUp = (e: PointerEvent): void => {
    const eraArrastre = this.arrastre?.movido ?? false;
    this.arrastre = null;
    if (eraArrastre || e.target !== this.opts.canvas) return;

    const [nx, ny] = this.normalizado(e.clientX, e.clientY);
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);

    const gente = this.ray.intersectObjects(this.blancosPersona, false);
    if (gente.length) {
      const clave = gente[0].object.userData['agente'] as string;
      this.opts.onAgente?.(clave);
      return;
    }

    if (this.cerebroGroup && this.opts.onDocumento) {
      const doc = this.documentoBajo();
      if (doc) {
        this.opts.onDocumento(doc.id, doc.nombre);
        return;
      }
    }

    const plintos = this.ray.intersectObjects(this.blancosPlinto, false);
    if (plintos.length) {
      const dk = plintos[0].object.userData['depto'] as string;
      this.enfocar(dk === this.enfocado ? null : dk);
    }
  };

  /** El nodo del cerebro mas cercano al rayo, si el rayo pasa lo bastante cerca. */
  private documentoBajo(): { id: number; nombre: string } | null {
    if (!this.cerebro || !this.cerebroGroup) return null;
    let mejor: { id: number; nombre: string } | null = null;
    let mejorD = 0.9;
    const mundo = new THREE.Vector3();
    for (const n of this.cerebro.nodos) {
      mundo.copy(n.pos);
      this.cerebroGroup.localToWorld(mundo);
      const d = this.ray.ray.distanceToPoint(mundo);
      if (d < mejorD) {
        mejorD = d;
        mejor = { id: n.id, nombre: n.nombre };
      }
    }
    return mejor && mejor.id >= 0 ? mejor : null;
  }

  private normalizado(cx: number, cy: number): [number, number] {
    const r = this.opts.canvas.getBoundingClientRect();
    return [((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1];
  }

  private enSuelo(nx: number, ny: number): THREE.Vector3 | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.planoSuelo, p) ? p : null;
  }

  private escuchar(): void {
    this.opts.canvas.addEventListener('wheel', this.onRueda, { passive: false });
    this.opts.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    document.addEventListener('visibilitychange', this.onVisibilidad);
  }

  private readonly onVisibilidad = (): void => {
    // Ni un frame con la pestaña de fondo. El panel ya deja de sondear tambien.
    if (document.hidden) this.pausar();
    else this.reanudar();
  };

  // ── Modo oscuro ───────────────────────────────────────────────────────────

  modoOscuro(on: boolean): void {
    if (this.oscuro === on) return;
    this.oscuro = on;
    const OSC = { plinto: 0x2c2d2b, pasarela: 0x303230 };
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material;
      if (Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial)) return;
      const parte = o.userData['part'] as string | undefined;
      if (parte === 'plinth') {
        if (!m.userData['claro']) m.userData['claro'] = m.color.clone();
        m.color.copy(on ? this.col.setHex(OSC.plinto) : (m.userData['claro'] as THREE.Color));
      } else if (parte === 'floor') {
        const chip = o.userData['chip'] as string | undefined;
        if (!m.userData['claro']) m.userData['claro'] = m.color.clone();
        if (on && chip) m.color.copy(this.col.set(chip).multiplyScalar(0.32));
        else m.color.copy(m.userData['claro'] as THREE.Color);
      }
    });
    this.renderer.setClearColor(0x000000, 0);
  }

  cambiarCalidad(c: Calidad): void {
    if (this.calidad === c) return;
    this.calidad = c;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, c === 'alta' ? 2 : 1.35));
    this.renderer.shadowMap.enabled = c === 'alta';
    this.scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) o.castShadow = c === 'alta';
    });
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ── Bucle ─────────────────────────────────────────────────────────────────

  arrancar(): void {
    if (this.rafId) return;
    this.vivo = true;
    this.ultimo = performance.now();
    const paso = (ahora: number) => {
      if (!this.vivo) return;
      this.rafId = requestAnimationFrame(paso);
      const dt = Math.min(0.05, (ahora - this.ultimo) / 1000);
      this.ultimo = ahora;
      this.tickTween(ahora);
      this.tickAtenuado(dt);
      this.tickPoses(ahora, dt);
      const barrido = this.tickBarrido(ahora);
      this.cerebro?.tick(ahora, dt, barrido);
      this.aplicarCamara();
      this.tickHud();
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(paso);
  }

  pausar(): void {
    this.vivo = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  reanudar(): void {
    if (!this.rafId) this.arrancar();
  }

  redimensionar(): void {
    const { clientWidth: w, clientHeight: h } = this.opts.contenedor;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.aplicarCamara();
  }

  // ── Desmontaje ────────────────────────────────────────────────────────────

  private vaciar(): void {
    this.restaurarAtenuado();
    for (const rt of this.puestos.values()) {
      rt.chapa.remove();
      if (rt.holo) {
        this.scene.remove(rt.holo.mesh);
        rt.holo.dispose();
      }
      rt.escritorio.pantalla.tex.dispose();
      const avisoMat = rt.aviso.material;
      avisoMat.map?.dispose();
      avisoMat.dispose();
    }
    for (const rt of this.deptos.values()) rt.rotulo.remove();
    this.puestos.clear();
    this.deptos.clear();
    this.blancosPersona.length = 0;
    this.blancosPlinto.length = 0;
    this.cacheAtenuado.clear();

    // Se quita todo menos luces y el recogedor de sombras.
    const fuera = this.scene.children.filter(
      (o) => !(o instanceof THREE.Light) && !(o instanceof THREE.Mesh && o.material instanceof THREE.ShadowMaterial),
    );
    for (const o of fuera) this.scene.remove(o);
    this.cerebro?.dispose();
    this.cerebro = null;
    this.cerebroGroup = null;
  }

  destruir(): void {
    this.pausar();
    this.ro.disconnect();
    this.opts.canvas.removeEventListener('wheel', this.onRueda);
    this.opts.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('visibilitychange', this.onVisibilidad);
    this.vaciar();
    for (const d of this.desechables) d.dispose();
    this.desechables.length = 0;
    limpiarCaches();
    this.renderer.dispose();
  }
}

// ── Utiles ──────────────────────────────────────────────────────────────────

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function suave(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

interface Caja { x0: number; y0: number; x1: number; y1: number }

function solapa(a: Caja, b: Caja): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function escapar(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
