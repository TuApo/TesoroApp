/**
 * Constructores de la oficina 3D — port de `src/builders.js` de agents-office
 * (ajsahni/agents-office, PolyForm Noncommercial 1.0.0: uso interno permitido,
 * no se puede vender ni construir un producto de pago encima).
 *
 * Es geometria pura de Three.js: ni DOM de la app ni Angular. Lo unico que toca
 * del navegador es <canvas> 2D para las texturas (pantallas, rotulos, holos).
 *
 * Cambios respecto al original:
 *  - TypeScript estricto y materiales/geometrias cacheados por clave.
 *  - `makeCerebro` sustituye al `makeNeuralBrain` procedural: los nodos son los
 *    documentos REALES del modulo Conocimiento y las aristas, los modulos que
 *    comparten.
 *  - `castShadow` recortado (solo bultos grandes): con 81 escritorios el mapa de
 *    sombras era el cuello de botella.
 */
import * as THREE from 'three';

import { hashTexto } from './oficina-util';
import type { NodoCerebro } from './oficina-util';

export const PLINTH_H = 2.6;
const WHITE = '#F7F7F2';

// ── Cacheo: 81 escritorios comparten un puñado de materiales y geometrias ────

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: string;
  ei?: number;
}

export function mat(color: string, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.85,
      metalness: opts.metal ?? 0.02,
      ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 1 } : {}),
    });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.ExtrudeGeometry>();

/** Prisma de esquinas redondeadas por extrusion. Origen al centro, extruye en +Y. */
export function rboxGeo(w: number, d: number, h: number, r = 0.35): THREE.ExtrudeGeometry {
  const key = `${w}|${d}|${h}|${r}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  geoCache.set(key, g);
  return g;
}

export function rbox(
  w: number,
  d: number,
  h: number,
  color: string | THREE.Material,
  r?: number,
  sombra = true,
): THREE.Mesh {
  const m = new THREE.Mesh(rboxGeo(w, d, h, r), typeof color === 'string' ? mat(color) : color);
  m.castShadow = sombra;
  m.receiveShadow = true;
  return m;
}

/** Libera geometrias y materiales cacheados. Se llama al destruir la escena. */
export function limpiarCaches(): void {
  for (const g of geoCache.values()) g.dispose();
  for (const m of matCache.values()) m.dispose();
  geoCache.clear();
  matCache.clear();
}

// ── Plinto: la tarima flotante de cada departamento ─────────────────────────

export function makePlinth(w: number, d: number, floorColor: string): THREE.Group {
  const g = new THREE.Group();
  const body = rbox(w, d, PLINTH_H, WHITE, 0.9);
  body.position.y = -PLINTH_H;
  body.userData['part'] = 'plinth';
  g.add(body);
  const floor = rbox(w - 0.7, d - 0.7, 0.12, floorColor, 0.7, false);
  floor.position.y = 0;
  floor.userData['part'] = 'floor';
  floor.userData['chip'] = floorColor;
  g.add(floor);
  return g;
}

// ── Rotulo del departamento, tumbado en el suelo del plinto ─────────────────

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('El navegador no da contexto 2D para las texturas de la oficina');
  return x;
}

export function makeFloorTitle(text: string, inkColor: string, width: number): THREE.Mesh {
  const c = document.createElement('canvas');
  const W = 1024;
  const H = 192;
  c.width = W;
  c.height = H;
  const x = ctx2d(c);
  x.clearRect(0, 0, W, H);
  x.font = '700 92px Georgia, "Times New Roman", serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const sp = 14;
  let total = 0;
  for (const ch of text) total += x.measureText(ch).width + sp;
  let cx0 = (W - total + sp) / 2;
  x.fillStyle = inkColor;
  for (const ch of text) {
    const cw = x.measureText(ch).width;
    x.fillText(ch, cx0 + cw / 2, H / 2 + 6);
    cx0 += cw + sp;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const h = width * (H / W);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.14;
  return m;
}

// ── Escritorio: tablero de madera, monitor con pantalla viva, silla ─────────

export interface JuegoPantalla {
  tex: THREE.CanvasTexture;
  dibujar(titulo: string, lineas: string[], chip: string): void;
}

/**
 * La pantalla del monitor. `dibujar` la repinta: es la que cuenta si el agente
 * esta trabajando, en cola o parado, y que herramienta acaba de usar.
 */
export function makeDeskScreenTexture(chip: string): JuegoPantalla {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const x = ctx2d(c);
  const dibujar = (titulo: string, lineas: string[], chipAhora: string) => {
    x.fillStyle = '#FDFFF8';
    x.fillRect(0, 0, 256, 160);
    x.fillStyle = chipAhora;
    x.fillRect(0, 0, 256, 26);
    x.fillStyle = '#151414';
    x.font = 'bold 15px Menlo, monospace';
    x.fillText(titulo.length > 26 ? titulo.slice(0, 26) + '…' : titulo, 10, 18);
    x.font = '13px Menlo, monospace';
    lineas.slice(0, 4).forEach((l, i) => {
      x.fillStyle = i === lineas.length - 1 ? '#1E9070' : 'rgba(21,20,20,.78)';
      x.fillText(l.length > 30 ? l.slice(0, 30) + '…' : l, 10, 48 + i * 22);
    });
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  dibujar('○ en reposo', ['▸ …', '▸ …', '▸ …'], chip);
  return { tex, dibujar };
}

export interface Escritorio {
  group: THREE.Group;
  pantalla: JuegoPantalla;
}

export function makeDesk(chip: string): Escritorio {
  const g = new THREE.Group();
  const top = rbox(5.2, 2.6, 0.22, '#DCC29A', 0.18);
  top.position.y = 2.1;
  g.add(top);
  const ped1 = rbox(0.9, 2.2, 1.9, WHITE, 0.12, false);
  ped1.position.set(-2.0, 0.1, 0);
  g.add(ped1);
  const ped2 = rbox(0.9, 2.2, 1.9, WHITE, 0.12, false);
  ped2.position.set(2.0, 0.1, 0);
  g.add(ped2);

  const pantalla = makeDeskScreenTexture(chip);
  const monBack = rbox(2.3, 0.14, 1.5, '#26262A', 0.08, false);
  monBack.position.set(0, 2.75, -0.85);
  g.add(monBack);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 1.3),
    new THREE.MeshBasicMaterial({ map: pantalla.tex }),
  );
  screen.position.set(0, 3.5, -0.77);
  g.add(screen);
  const stand = rbox(0.16, 0.16, 0.45, '#3A3A3E', 0.05, false);
  stand.position.set(0, 2.32, -0.9);
  g.add(stand);

  const kb = rbox(1.5, 0.5, 0.07, '#EFEFEA', 0.06, false);
  kb.position.set(0, 2.22, 0.35);
  g.add(kb);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.3, 10), mat(chip));
  mug.position.set(1.9, 2.36, 0.4);
  g.add(mug);
  return { group: g, pantalla };
}

export function makeChair(): THREE.Group {
  const g = new THREE.Group();
  const seat = rbox(1.3, 1.2, 0.22, '#8E998B', 0.35, false);
  seat.position.y = 1.25;
  g.add(seat);
  const back = rbox(1.25, 0.2, 1.35, '#7C8779', 0.3, false);
  back.position.set(0, 1.5, 0.62);
  g.add(back);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 6), mat('#55555A'));
  pole.position.y = 0.82;
  g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.1, 8), mat('#55555A'));
  base.position.y = 0.4;
  g.add(base);
  return g;
}

// ── Persona ─────────────────────────────────────────────────────────────────

export interface PersonaOpts {
  hair: string;
  skin: string;
  chip: string;
  lead?: boolean;
}

interface PoseCur {
  shLx: number; shLz: number;
  shRx: number; shRz: number;
  headRx: number; headRy: number;
  torsoRx: number; posY: number; standK: number;
}

interface PersonaUD {
  legs: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  shL: THREE.Group;
  shR: THREE.Group;
  torso: THREE.Mesh;
  headG: THREE.Group;
  S: number;
  cur: PoseCur | null;
  glanceDir: number;
}

/** Muñeco estilizado: cabeza grande, hombros con pivote y piernas que se ocultan al sentarse. */
export function makePerson({ hair, skin, chip, lead }: PersonaOpts): THREE.Group {
  const g = new THREE.Group();
  const S = lead ? 1.12 : 1;
  const shirtCol = lead ? '#2B3245' : chip;
  const shirt = mat(shirtCol, { rough: 0.9 });
  const skinM = mat(skin, { rough: 0.7 });
  const hairM = mat(hair, { rough: 0.95 });
  const pantsM = mat('#3E4048', { rough: 0.95 });

  const legs = new THREE.Group();
  const legGeo = new THREE.CapsuleGeometry(0.16 * S, 0.75 * S, 2, 6);
  const legL = new THREE.Mesh(legGeo, pantsM);
  legL.position.set(-0.2 * S, 0.6 * S, 0);
  const legR = new THREE.Mesh(legGeo, pantsM);
  legR.position.set(0.2 * S, 0.6 * S, 0);
  legs.add(legL, legR);
  g.add(legs);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42 * S, 0.85 * S, 3, 10), shirt);
  torso.position.y = 1.75 * S;
  torso.castShadow = true;
  g.add(torso);

  if (lead) {
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.11 * S, 0.55 * S, 4), mat(chip));
    tie.rotation.x = Math.PI;
    tie.position.set(0, 1.85 * S, 0.4 * S);
    g.add(tie);
    const pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.06 * S, 6, 6),
      mat('#E5C158', { metal: 0.8, rough: 0.3, emissive: '#8a6d1f', ei: 0.4 }),
    );
    pin.position.set(0.26 * S, 2.05 * S, 0.38 * S);
    g.add(pin);
  }

  const armGeo = new THREE.CapsuleGeometry(0.155 * S, 0.62 * S, 2, 6);
  const armL = new THREE.Mesh(armGeo, shirt);
  const armR = new THREE.Mesh(armGeo, shirt);
  const shL = new THREE.Group();
  shL.position.set(-0.5 * S, 2.1 * S, 0);
  armL.position.y = -0.42 * S;
  shL.add(armL);
  const shR = new THREE.Group();
  shR.position.set(0.5 * S, 2.1 * S, 0);
  armR.position.y = -0.42 * S;
  shR.add(armR);
  g.add(shL, shR);

  const headG = new THREE.Group();
  headG.position.y = 2.75 * S;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5 * S, 14, 12), skinM);
  head.position.y = 0.25 * S;
  head.castShadow = true;
  headG.add(head);
  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.54 * S, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hairM,
  );
  hairMesh.position.y = 0.31 * S;
  headG.add(hairMesh);
  g.add(headG);

  const ud: PersonaUD = { legs, legL, legR, shL, shR, torso, headG, S, cur: null, glanceDir: 0 };
  g.userData['persona'] = ud;
  return g;
}

function personaUD(g: THREE.Group): PersonaUD {
  return g.userData['persona'] as PersonaUD;
}

export type ModoTrabajo =
  | 'type' | 'read' | 'phone' | 'glance' | 'sip' | 'spin'
  | 'stretch' | 'wave' | 'cheer' | 'slump';

/**
 * Poses sentadas, mezcladas suavemente entre modos.
 * OJO: la camara ve a los agentes POR DETRAS — las poses tienen que leerse como
 * siluetas de espalda. El signo de z abre los brazos hacia fuera de la cabeza.
 */
export function poseWork(g: THREE.Group, mode: ModoTrabajo, t: number, dt: number): void {
  const u = personaUD(g);
  const tg: PoseCur = {
    shLx: -1.05, shLz: 0.25, shRx: -1.05, shRz: -0.25,
    headRx: 0.04, headRy: 0, torsoRx: 0, posY: 0.55, standK: 0,
  };
  switch (mode) {
    case 'type':
      tg.shLx = -1.05 + Math.sin(t / 170) * 0.12;
      tg.shRx = -1.05 + Math.sin(t / 140 + 1.3) * 0.14;
      tg.headRx = 0.07 + Math.sin(t / 380) * 0.05;
      break;
    case 'read':
      tg.shLx = -0.3; tg.shLz = -0.35; tg.shRx = -0.3; tg.shRz = 0.35;
      tg.torsoRx = -0.12;
      tg.headRx = 0.18 + Math.sin(t / 650) * 0.05;
      break;
    case 'phone':
      tg.shRx = -2.3; tg.shRz = 0.55; tg.shLx = -0.4; tg.shLz = -0.2;
      tg.headRy = -0.18;
      tg.headRx = 0.05 + (Math.sin(t / 330) > 0.55 ? 0.09 : 0);
      break;
    case 'glance':
      tg.shLx = -0.9; tg.shRx = -0.9;
      tg.headRy = u.glanceDir || 0.55;
      break;
    case 'sip':
      tg.shRx = -2.0; tg.shRz = 0.5; tg.shLx = -0.6; tg.headRx = -0.12;
      break;
    case 'spin':
      tg.shLx = -0.7; tg.shLz = -0.55; tg.shRx = -0.7; tg.shRz = 0.55;
      tg.headRx = -0.05;
      break;
    case 'stretch':
      tg.standK = 1; tg.posY = 0.12;
      tg.shLx = -2.6; tg.shLz = -0.75; tg.shRx = -2.6; tg.shRz = 0.75;
      tg.headRx = -0.15; tg.torsoRx = -0.05;
      break;
    case 'wave':
      tg.standK = 1; tg.posY = 0.12;
      tg.shRx = -2.6; tg.shRz = 0.55 + Math.sin(t / 150) * 0.4;
      tg.shLx = -0.3; tg.shLz = -0.25;
      tg.headRx = -0.05;
      break;
    case 'cheer':
      tg.standK = 1;
      tg.posY = 0.12 + Math.abs(Math.sin(t / 150)) * 0.16;
      tg.shLx = -2.7; tg.shLz = -0.85 + Math.sin(t / 190) * 0.12;
      tg.shRx = -2.7; tg.shRz = 0.85 - Math.sin(t / 190) * 0.12;
      tg.headRx = -0.2;
      break;
    case 'slump':
      tg.shLx = -0.2; tg.shLz = -0.3; tg.shRx = -0.2; tg.shRz = 0.3;
      tg.headRx = 0.45; tg.posY = 0.5;
      break;
  }
  if (!u.cur) u.cur = { ...tg };
  const cur = u.cur;
  const k = 1 - Math.exp(-(dt || 0.016) * 7);
  (Object.keys(tg) as (keyof PoseCur)[]).forEach((key) => {
    cur[key] += (tg[key] - cur[key]) * k;
  });
  u.shL.rotation.x = cur.shLx;
  u.shL.rotation.z = cur.shLz;
  u.shR.rotation.x = cur.shRx;
  u.shR.rotation.z = cur.shRz;
  u.headG.rotation.x = cur.headRx;
  u.headG.rotation.y = cur.headRy;
  u.torso.rotation.x = cur.torsoRx;
  u.legs.visible = cur.standK > 0.4;
  g.position.y = cur.posY + Math.sin(t / 460) * 0.02;
}

export function posePerson(g: THREE.Group, pose: 'walk' | 'stand', t = 0): void {
  const u = personaUD(g);
  u.cur = null;
  u.headG.rotation.x = 0;
  u.headG.rotation.y = 0;
  if (pose === 'walk') {
    u.legs.visible = true;
    const sw = Math.sin(t / 110);
    g.position.y = Math.abs(Math.cos(t / 110)) * 0.08;
    u.legL.rotation.x = sw * 0.55;
    u.legR.rotation.x = -sw * 0.55;
    u.shL.rotation.x = -sw * 0.45;
    u.shR.rotation.x = sw * 0.45;
    u.shL.rotation.z = 0.08;
    u.shR.rotation.z = -0.08;
  } else {
    u.legs.visible = true;
    g.position.y = 0;
    u.legL.rotation.x = 0;
    u.legR.rotation.x = 0;
    u.shL.rotation.x = -0.15 + Math.sin(t / 500) * 0.05;
    u.shR.rotation.x = -0.15 - Math.sin(t / 500) * 0.05;
    u.shL.rotation.z = 0.15;
    u.shR.rotation.z = -0.15;
    u.headG.rotation.y = Math.sin(t / 900) * 0.12;
  }
}

export function fijarMirada(g: THREE.Group, dir: number): void {
  personaUD(g).glanceDir = dir;
}

// ── Holograma: el panel de cristal flotante sobre el agente que trabaja ──────

function roundRect(x: CanvasRenderingContext2D, a: number, b: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}

export interface Holo {
  mesh: THREE.Mesh;
  dibujar(titulo: string, lineas: string[]): void;
  dispose(): void;
}

export function makeHolo(agentName: string, chip: string, lineas: string[]): Holo {
  const c = document.createElement('canvas');
  const W = 512;
  const H = 320;
  c.width = W;
  c.height = H;
  const x = ctx2d(c);
  const dibujar = (titulo: string, ls: string[]) => {
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(253,255,248,0.93)';
    roundRect(x, 6, 6, W - 12, H - 12, 26);
    x.fill();
    x.strokeStyle = chip;
    x.lineWidth = 5;
    roundRect(x, 6, 6, W - 12, H - 12, 26);
    x.stroke();
    x.fillStyle = chip;
    x.beginPath();
    x.arc(40, 44, 11, 0, 7);
    x.fill();
    x.fillStyle = '#151414';
    x.font = '700 27px Georgia, serif';
    x.fillText(titulo.length > 22 ? titulo.slice(0, 22) + '…' : titulo, 62, 54);
    x.strokeStyle = 'rgba(21,20,20,0.12)';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(28, 76);
    x.lineTo(W - 28, 76);
    x.stroke();
    x.font = '20px Menlo, monospace';
    const vis = ls.slice(-5);
    vis.forEach((l, i) => {
      x.fillStyle = i === vis.length - 1 ? '#1E9070' : 'rgba(21,20,20,0.72)';
      x.fillText(l.length > 40 ? l.slice(0, 40) + '…' : l, 30, 116 + i * 36);
    });
    x.fillStyle = '#151414';
    x.fillRect(30, 116 + vis.length * 36 - 16, 12, 20);
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  dibujar(agentName, lineas);
  const material = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.96, depthWrite: false, side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(4.8, 3.0);
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    dibujar,
    dispose: () => { tex.dispose(); material.dispose(); geometry.dispose(); },
  };
}

// ── Atrezzo ─────────────────────────────────────────────────────────────────

export function makePlant(): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.8, 8), mat('#B96A4B'));
  pot.position.y = 0.4;
  pot.castShadow = true;
  g.add(pot);
  const foliage = mat('#5F8A5C', { rough: 1 });
  const foliage2 = mat('#6F9B68', { rough: 1 });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.42 + Math.sin(i * 7) * 0.12, 8, 6),
      i % 2 ? foliage : foliage2,
    );
    s.position.set(Math.sin(i * 2.4) * 0.35, 1.15 + i * 0.28, Math.cos(i * 2.4) * 0.35);
    g.add(s);
  }
  return g;
}

export function makeServerRack(chip: string): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(1.6, 1.2, 3.4, '#232326', 0.14));
  for (let r = 0; r < 5; r++) {
    const slot = rbox(1.3, 0.06, 0.3, '#2E2E33', 0.04, false);
    slot.position.set(0, 0.5 + r * 0.6, 0.62);
    g.add(slot);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 5, 4),
      mat(r % 2 ? chip : '#E69393', { emissive: r % 2 ? chip : '#E69393', ei: 2.2 }),
    );
    led.position.set(0.45, 0.65 + r * 0.6, 0.64);
    g.add(led);
  }
  return g;
}

export function makeMeetingTable(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.2, 24), mat('#EFEADF'));
  top.position.y = 1.9;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.9, 10), mat('#C9C4B8'));
  leg.position.y = 0.95;
  g.add(leg);
  return g;
}

/** Aviso pulsante ⚠ para la tarea que fallo o esta bloqueada. */
export function makeWarnSprite(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = ctx2d(c);
  x.beginPath();
  x.moveTo(64, 12);
  x.lineTo(120, 112);
  x.lineTo(8, 112);
  x.closePath();
  x.fillStyle = '#F2B84B';
  x.fill();
  x.lineWidth = 7;
  x.strokeStyle = '#151414';
  x.lineJoin = 'round';
  x.stroke();
  x.fillStyle = '#151414';
  x.font = '900 64px Inter, sans-serif';
  x.textAlign = 'center';
  x.fillText('!', 64, 98);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(2.6, 2.6, 1);
  return s;
}

/** Pasarela entre dos puntos del plano XZ (departamento → cerebro). */
export function makeWalkway(from: [number, number], to: [number, number]): THREE.Mesh {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const g = rbox(len, 3.2, 0.35, '#EFEFE8', 0.16, false);
  g.position.set((from[0] + to[0]) / 2, -0.35, (from[1] + to[1]) / 2);
  g.rotation.y = -Math.atan2(dz, dx);
  return g;
}

// ── El Cerebro: el grafo REAL del modulo Conocimiento ────────────────────────

export interface Cerebro {
  group: THREE.Group;
  /** Nodos en coordenadas locales, para el raycast de "que documento es este". */
  nodos: { id: number; nombre: string; pos: THREE.Vector3 }[];
  tick(t: number, dt: number, barrido: { theta: number; fuerza: number; col: string }): void;
  dispose(): void;
}

/**
 * Nube de conocimiento: un nodo por documento, aristas entre documentos que
 * comparten modulo. Si el modulo Conocimiento no responde o esta vacio, cae a
 * una malla de relleno para que el centro no quede desnudo.
 */
export function makeCerebro(docs: NodoCerebro[], radio = 5.2): Cerebro {
  const g = new THREE.Group();
  const dummy = new THREE.Object3D();
  const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;

  const reales = docs.slice(0, 260);
  const N = Math.max(reales.length, 1);

  const nodos: { id: number; nombre: string; pos: THREE.Vector3; big: boolean; col: THREE.Color }[] = [];
  const PAL = ['#2E8B57', '#C8A438', '#C2574F', '#5A6ACF', '#4C7A57', '#D9A05B'];
  for (let i = 0; i < N; i++) {
    const d = reales[i];
    const dir = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
    const p = dir.multiplyScalar(radio * (0.12 + 0.7 * Math.cbrt(Math.random())));
    p.y *= 0.7;
    const big = d ? d.peso > 1 : Math.random() < 0.3;
    nodos.push({
      id: d ? d.id : -i,
      nombre: d ? d.nombre : '—',
      pos: p,
      big,
      col: new THREE.Color(d && d.modulos.length ? PAL[hashTexto(d.modulos[0]) % PAL.length] : '#454540'),
    });
  }

  const nodeGeo = new THREE.SphereGeometry(0.16, 6, 5);
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(nodeGeo, nodeMat, N);
  const colBase: THREE.Color[] = [];
  nodos.forEach((n, i) => {
    dummy.position.copy(n.pos);
    dummy.scale.setScalar(n.big ? 2.0 : 1.15);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, n.col);
    colBase.push(n.col.clone());
  });
  g.add(inst);

  // Aristas: documentos que comparten al menos un modulo. Sin modulos, vecinos cercanos.
  const porModulo = new Map<string, number[]>();
  reales.forEach((d, i) => {
    for (const m of d.modulos) {
      const l = porModulo.get(m) ?? [];
      l.push(i);
      porModulo.set(m, l);
    }
  });
  const pares = new Set<string>();
  const aristas: [THREE.Vector3, THREE.Vector3][] = [];
  for (const idxs of porModulo.values()) {
    for (let a = 0; a < idxs.length; a++) {
      // Un modulo con 40 documentos no debe dar 780 aristas: encadena en anillo.
      const b = idxs[(a + 1) % idxs.length];
      if (idxs[a] === b) continue;
      const k = idxs[a] < b ? `${idxs[a]}-${b}` : `${b}-${idxs[a]}`;
      if (pares.has(k)) continue;
      pares.add(k);
      aristas.push([nodos[idxs[a]].pos, nodos[b].pos]);
    }
  }
  if (!aristas.length) {
    for (const n of nodos) {
      const cerca = nodos
        .filter((m) => m !== n)
        .sort((a, b) => a.pos.distanceToSquared(n.pos) - b.pos.distanceToSquared(n.pos));
      for (let j = 0; j < (n.big ? 4 : 2); j++) if (cerca[j]) aristas.push([n.pos, cerca[j].pos]);
    }
  }

  const epos = new Float32Array(aristas.length * 6);
  aristas.forEach(([a, b], i) => epos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6));
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  const emat = new THREE.LineBasicMaterial({ color: 0x3a3a38, transparent: true, opacity: 0.3 });
  g.add(new THREE.LineSegments(egeo, emat));

  // Pulsos: señales viajando por el grafo, para que el cerebro se vea vivo.
  const pulsos: { m: THREE.Mesh; arista: [THREE.Vector3, THREE.Vector3]; t: number; vel: number }[] = [];
  if (aristas.length) {
    const pgeo = new THREE.SphereGeometry(0.09, 5, 4);
    for (let i = 0; i < Math.min(14, aristas.length); i++) {
      const col = PAL[i % PAL.length];
      const m = new THREE.Mesh(pgeo, mat(col, { emissive: col, ei: 2 }));
      g.add(m);
      pulsos.push({
        m,
        arista: aristas[Math.floor(Math.random() * aristas.length)],
        t: Math.random(),
        vel: 0.25 + Math.random() * 0.5,
      });
    }
  }

  const tmp = new THREE.Color();
  const barridoCol = new THREE.Color();
  const tick = (t: number, dt: number, barrido: { theta: number; fuerza: number; col: string }) => {
    g.rotation.y = t * 0.00005;
    if (barrido.fuerza > 0.01) {
      barridoCol.set(barrido.col);
      for (let i = 0; i < N; i++) {
        const n = nodos[i];
        const az = Math.atan2(n.pos.z, n.pos.x);
        const d = Math.atan2(Math.sin(az - barrido.theta), Math.cos(az - barrido.theta));
        let sk = Math.max(0, 1 - Math.abs(d) / 0.62);
        sk = sk * sk * (3 - 2 * sk) * barrido.fuerza;
        tmp.copy(colBase[i]);
        if (sk > 0.01) tmp.lerp(barridoCol, 0.7 * sk);
        inst.setColorAt(i, tmp);
      }
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
    for (const p of pulsos) {
      p.t += dt * p.vel;
      if (p.t >= 1) {
        p.t = 0;
        p.arista = aristas[Math.floor(Math.random() * aristas.length)];
      }
      p.m.position.lerpVectors(p.arista[0], p.arista[1], p.t);
    }
  };

  return {
    group: g,
    nodos: nodos.map((n) => ({ id: n.id, nombre: n.nombre, pos: n.pos })),
    tick,
    dispose: () => {
      nodeGeo.dispose();
      nodeMat.dispose();
      inst.dispose();
      egeo.dispose();
      emat.dispose();
    },
  };
}
