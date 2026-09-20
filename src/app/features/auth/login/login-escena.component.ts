import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, viewChild,
} from '@angular/core';

import { CIUDADES, CONTORNO_COLOMBIA } from './login-escena.datos';

/**
 * Mapa 3D de Colombia con la red de ciudades del lado izquierdo del login.
 *
 * Es ILUSTRATIVO: los pulsos que viajan entre ciudades no representan eventos
 * reales (antes del login no hay token para consultar nada), por eso no lleva
 * etiquetas ni cifras que se puedan leer como datos.
 *
 * `three` se importa bajo demanda: queda en su propio chunk y solo se descarga
 * en el navegador (la app tiene SSR). Al destruir el componente se liberan la
 * GPU, el bucle de animación y los listeners.
 */
@Component({
  selector: 'app-login-escena',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #lienzo class="escena" aria-hidden="true"></canvas>`,
  styles: [`
    :host { position: absolute; inset: 0; display: block; pointer-events: none; }
    .escena { width: 100%; height: 100%; display: block; }
  `],
})
export class LoginEscenaComponent {
  private readonly lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zona = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private limpiar: (() => void) | null = null;
  private destruido = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destruido = true;
      this.limpiar?.();
    });
    afterNextRender(() => {
      // Fuera de Angular: el bucle de 60 fps no debe disparar detección de cambios.
      this.zona.runOutsideAngular(() => void this.montar());
    });
  }

  private async montar(): Promise<void> {
    let THREE: typeof import('three');
    try {
      THREE = await import('three');
    } catch {
      return; // sin WebGL/three: queda el degradado lima de fondo
    }
    if (this.destruido) return;

    const canvas = this.lienzo().nativeElement;
    const escenario = (this.host.nativeElement as HTMLElement).parentElement as HTMLElement;
    let renderer: import('three').WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return; // WebGL deshabilitado (algunos equipos corporativos)
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const FOV = 38;
    const CAMZ = 16;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, CAMZ);

    const BLANCO = new THREE.Color('#ffffff');
    const AZUL = new THREE.Color('#2B59F0');
    const K = 0.55, LON0 = -73.2, LAT0 = 4.2, TOP = 0.28;
    const P = (lon: number, lat: number, z = TOP) => new THREE.Vector3((lon - LON0) * K, (lat - LAT0) * K, z);

    const holder = new THREE.Group();
    scene.add(holder);
    const root = new THREE.Group();
    holder.add(root);
    const BASE_RX = -0.42, BASE_RZ = -0.06;
    root.rotation.set(BASE_RX, 0, BASE_RZ);

    const desechables: { dispose(): void }[] = [];
    const guardar = <T extends { dispose(): void }>(x: T): T => { desechables.push(x); return x; };

    // ── Mapa extruido ─────────────────────────────────────────────────────
    const shape = new THREE.Shape(CONTORNO_COLOMBIA.map(([lo, la]) => new THREE.Vector2((lo - LON0) * K, (la - LAT0) * K)));
    const ext = guardar(new THREE.ExtrudeGeometry(shape, { depth: TOP, bevelEnabled: false }));
    const tapa = guardar(new THREE.MeshBasicMaterial({ color: BLANCO, transparent: true, opacity: 0.2, depthWrite: false }));
    const lado = guardar(new THREE.MeshBasicMaterial({ color: new THREE.Color('#6DA71C'), transparent: true, opacity: 0.95 }));
    root.add(new THREE.Mesh(ext, [tapa, lado]));

    const linea = (pts: import('three').Vector3[], opacidad: number) => {
      const g = guardar(new THREE.BufferGeometry().setFromPoints(pts));
      const m = guardar(new THREE.LineBasicMaterial({ color: BLANCO, transparent: true, opacity: opacidad }));
      root.add(new THREE.Line(g, m));
    };
    const borde = CONTORNO_COLOMBIA.map(([lo, la]) => P(lo, la, TOP + 0.002));
    borde.push(borde[0].clone());
    linea(borde, 0.95);
    const base = CONTORNO_COLOMBIA.map(([lo, la]) => P(lo, la, 0));
    base.push(base[0].clone());
    linea(base, 0.35);

    const sombra = new THREE.Mesh(
      guardar(new THREE.ShapeGeometry(shape)),
      guardar(new THREE.MeshBasicMaterial({ color: new THREE.Color('#3F6E0A'), transparent: true, opacity: 0.18, depthWrite: false })),
    );
    sombra.position.set(0.18, -0.22, -0.5);
    root.add(sombra);

    // ── Retícula de puntos dentro del país ───────────────────────────────
    const poly = CONTORNO_COLOMBIA;
    const dentro = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const puntos: number[] = [];
    for (let lo = -79.2; lo < -66.8; lo += 0.26) {
      for (let la = -4.3; la < 12.6; la += 0.26) if (dentro(lo, la)) puntos.push(...P(lo, la, TOP + 0.004).toArray());
    }
    const dg = guardar(new THREE.BufferGeometry());
    dg.setAttribute('position', new THREE.Float32BufferAttribute(puntos, 3));
    root.add(new THREE.Points(dg, guardar(new THREE.PointsMaterial({ color: BLANCO, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }))));

    // ── Textura de brillo ────────────────────────────────────────────────
    const gc = document.createElement('canvas');
    gc.width = gc.height = 64;
    const gx = gc.getContext('2d')!;
    const grd = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = grd;
    gx.fillRect(0, 0, 64, 64);
    const texBrillo = guardar(new THREE.CanvasTexture(gc));
    const brillo = (size: number, opacidad = 1) => {
      const sp = new THREE.Sprite(guardar(new THREE.SpriteMaterial({ map: texBrillo, color: BLANCO, transparent: true, opacity: opacidad, depthWrite: false })));
      sp.scale.setScalar(size);
      return sp;
    };

    // ── Ciudades ─────────────────────────────────────────────────────────
    const esfera = guardar(new THREE.SphereGeometry(1, 16, 16));
    const ciudades = CIUDADES.map(([, lo, la, w]) => {
      const pos = P(lo, la);
      const g = new THREE.Group();
      g.position.copy(pos);
      root.add(g);
      const r = 0.05 + w * 0.022;
      const punto = new THREE.Mesh(esfera, guardar(new THREE.MeshBasicMaterial({ color: AZUL })));
      punto.scale.setScalar(r);
      punto.position.z = r * 0.6;
      g.add(punto);
      const h = 0.12 + w * 0.12;
      const pilar = new THREE.Mesh(
        guardar(new THREE.CylinderGeometry(0.012, 0.012, h, 6)),
        guardar(new THREE.MeshBasicMaterial({ color: BLANCO, transparent: true, opacity: 0.7 })),
      );
      pilar.rotation.x = Math.PI / 2;
      pilar.position.z = h / 2;
      g.add(pilar);
      const halo = brillo(r * 5, 0);
      halo.position.z = r;
      g.add(halo);
      const anillo = new THREE.Mesh(
        guardar(new THREE.RingGeometry(0.85, 1, 48)),
        guardar(new THREE.MeshBasicMaterial({ color: BLANCO, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })),
      );
      anillo.position.z = 0.005;
      g.add(anillo);
      const aro = new THREE.Mesh(
        guardar(new THREE.RingGeometry(r * 1.5, r * 1.9, 32)),
        guardar(new THREE.MeshBasicMaterial({ color: AZUL, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })),
      );
      aro.position.z = 0.004;
      g.add(aro);
      return { w, pos, g, punto, pilar, halo, anillo, r, destello: 0, onda: -1, fase: Math.random() * 6.28 };
    });

    // ── Red base ─────────────────────────────────────────────────────────
    const arco = (a: import('three').Vector3, b: import('three').Vector3) => {
      const d = a.distanceTo(b);
      const m = a.clone().add(b).multiplyScalar(0.5);
      m.z += 0.35 + d * 0.28;
      return new THREE.QuadraticBezierCurve3(a.clone(), m, b.clone());
    };
    const aristas = new Set<string>();
    const pares: [number, number][] = [];
    const unir = (i: number, j: number) => {
      const k = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (i === j || aristas.has(k)) return;
      aristas.add(k);
      pares.push([i, j]);
    };
    ciudades.forEach((c, i) => {
      const cerca = ciudades
        .map((d, j) => [j, c.pos.distanceTo(d.pos)] as const)
        .filter(([j]) => j !== i)
        .sort((a, b) => a[1] - b[1]);
      unir(i, cerca[0][0]);
      unir(i, cerca[1][0]);
      if (c.w >= 1.2) unir(0, i);
    });
    const matRed = guardar(new THREE.LineBasicMaterial({ color: BLANCO, transparent: true, opacity: 0.32, depthWrite: false }));
    pares.forEach(([i, j]) => {
      root.add(new THREE.Line(guardar(new THREE.BufferGeometry().setFromPoints(arco(ciudades[i].pos, ciudades[j].pos).getPoints(40))), matRed));
    });

    // ── Encaje en pantalla ───────────────────────────────────────────────
    let W = 1, H = 1;
    const areaMapa = () => escenario.querySelector<HTMLElement>('[data-area-mapa]');
    const rectObjetivo = () => {
      const angosto = window.innerWidth <= 960;
      if (angosto) {
        return W < 600
          ? { x0: -W * 0.14, y0: 48, x1: W * 1.14, y1: H * 0.8 }
          : { x0: W * 0.04, y0: 64, x1: W * 0.96, y1: H * 0.9 };
      }
      const sr = escenario.getBoundingClientRect();
      const r = areaMapa()?.getBoundingClientRect();
      if (!r || r.height < 40) return { x0: W * 0.05, y0: H * 0.1, x1: W * 0.95, y1: H * 0.6 };
      return { x0: r.left - sr.left + 10, y0: r.top - sr.top + 10, x1: r.right - sr.left, y1: r.bottom - sr.top - 4 };
    };
    const redimensionar = () => {
      W = escenario.clientWidth || 1;
      H = escenario.clientHeight || 1;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      holder.position.set(0, 0, 0);
      holder.scale.setScalar(1);
      root.rotation.set(BASE_RX, 0, BASE_RZ);
      holder.updateMatrixWorld(true);
      const caja = new THREE.Box3().setFromObject(root);
      const tam = caja.getSize(new THREE.Vector3());
      const centro = caja.getCenter(new THREE.Vector3());
      const upp = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMZ) / H;
      const r = rectObjetivo();
      const sc = Math.min(((r.x1 - r.x0) * upp) / tam.x, ((r.y1 - r.y0) * upp) / tam.y) * 0.98;
      const cx = ((r.x0 + r.x1) / 2 - W / 2) * upp;
      const cy = -((r.y0 + r.y1) / 2 - H / 2) * upp;
      holder.scale.setScalar(sc);
      holder.position.set(cx - centro.x * sc, cy - centro.y * sc, 0);
    };
    redimensionar();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(redimensionar) : null;
    ro?.observe(escenario);
    window.addEventListener('resize', redimensionar);
    document.fonts?.ready.then(() => !this.destruido && redimensionar());

    const raton = { x: 0, y: 0 };
    const alMover = (e: PointerEvent) => {
      raton.x = e.clientX / window.innerWidth - 0.5;
      raton.y = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('pointermove', alMover);

    // ── Pulsos (ilustrativos) ────────────────────────────────────────────
    type Activo = { t: number; update(t: number): boolean };
    const activos: Activo[] = [];
    const elegir = () => {
      const total = ciudades.reduce((a, c) => a + c.w, 0);
      let r = Math.random() * total;
      for (const c of ciudades) { r -= c.w; if (r <= 0) return c; }
      return ciudades[0];
    };
    const estallar = (c: (typeof ciudades)[number]) => { c.onda = 0; c.destello = 1; };
    const viaje = () => {
      const a = elegir();
      let b = elegir();
      while (b === a) b = elegir();
      const curva = arco(a.pos, b.pos);
      const geo = new THREE.BufferGeometry().setFromPoints(curva.getPoints(80));
      geo.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({ color: AZUL, transparent: true, opacity: 1, depthWrite: false });
      const trazo = new THREE.Line(geo, mat);
      root.add(trazo);
      const cabeza = new THREE.Mesh(esfera, new THREE.MeshBasicMaterial({ color: BLANCO }));
      cabeza.scale.setScalar(0.07);
      root.add(cabeza);
      const hb = brillo(0.6, 0.9);
      hb.scale.setScalar(9);
      cabeza.add(hb);
      a.destello = 1;
      const dur = 1.7;
      let llego = false;
      activos.push({ t: 0, update(t) {
        const p = Math.min(t / dur, 1);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        geo.setDrawRange(0, Math.floor(e * 81));
        cabeza.position.copy(curva.getPoint(e));
        if (p >= 1 && !llego) { llego = true; cabeza.visible = false; estallar(b); }
        if (t > dur) mat.opacity = Math.max(0, 1 - (t - dur) / 1.2);
        if (t > dur + 1.2) {
          root.remove(trazo); root.remove(cabeza);
          geo.dispose(); mat.dispose(); (cabeza.material as import('three').Material).dispose();
          return false;
        }
        return true;
      } });
    };
    const llegada = () => {
      const c = elegir();
      const gota = new THREE.Mesh(esfera, new THREE.MeshBasicMaterial({ color: BLANCO }));
      gota.scale.setScalar(0.06);
      const gb = brillo(0.6, 0.9);
      gb.scale.setScalar(10);
      gota.add(gb);
      const estela = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 1, 6),
        new THREE.MeshBasicMaterial({ color: BLANCO, transparent: true, opacity: 0.6 }),
      );
      estela.rotation.x = Math.PI / 2;
      c.g.add(gota);
      c.g.add(estela);
      const dur = 1.1;
      let llego = false;
      activos.push({ t: 0, update(t) {
        const p = Math.min(t / dur, 1);
        const z = 3.2 * (1 - p * p) + c.r;
        gota.position.z = z;
        estela.scale.y = Math.max(0.01, (3.2 - z) * 0.5 + 0.2);
        estela.position.z = z + estela.scale.y / 2;
        (estela.material as import('three').MeshBasicMaterial).opacity = 0.6 * (1 - p);
        if (p >= 1 && !llego) {
          llego = true;
          c.g.remove(gota); c.g.remove(estela);
          (gota.material as import('three').Material).dispose();
          estela.geometry.dispose(); (estela.material as import('three').Material).dispose();
          estallar(c);
        }
        return t < dur + 0.05;
      } });
    };

    const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let proximo = 1.2;
    const inicio = performance.now();
    let ultimo = 0;
    let raf = 0;
    const cuadro = () => {
      const t = (performance.now() - inicio) / 1000;
      const dt = Math.min(t - ultimo, 0.05);
      ultimo = t;
      root.rotation.x += (BASE_RX + raton.y * 0.12 - root.rotation.x) * 0.05;
      root.rotation.y += (raton.x * 0.22 + Math.sin(t * 0.25) * 0.05 - root.rotation.y) * 0.05;
      if (!reducido && t > proximo) {
        if (Math.random() < 0.4) llegada(); else viaje();
        proximo = t + 0.9 + Math.random() * 1.1;
      }
      for (let i = activos.length - 1; i >= 0; i--) {
        const a = activos[i];
        a.t += dt;
        if (!a.update(a.t)) activos.splice(i, 1);
      }
      for (const c of ciudades) {
        c.destello = Math.max(0, c.destello - dt * 0.8);
        const respira = 0.5 + Math.sin(t * 2 + c.fase) * 0.5;
        (c.halo.material as import('three').SpriteMaterial).opacity = 0.15 * respira + c.destello * 0.9;
        c.halo.scale.setScalar(c.r * (5 + c.destello * 6));
        c.punto.scale.setScalar(c.r * (1 + c.destello * 0.5));
        (c.pilar.material as import('three').MeshBasicMaterial).opacity = 0.5 + c.destello * 0.5;
        if (c.onda >= 0) {
          c.onda += dt;
          const p = c.onda / 1.1;
          c.anillo.scale.setScalar(0.1 + p * 0.9);
          (c.anillo.material as import('three').MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - p));
          if (p >= 1) c.onda = -1;
        }
      }
      renderer.render(scene, camera);
      if (!reducido && !document.hidden) raf = requestAnimationFrame(cuadro);
    };
    // Pestaña oculta: se detiene el bucle y se reanuda al volver.
    const alCambiarVisibilidad = () => {
      if (!document.hidden && !reducido && !this.destruido) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(cuadro);
      }
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    cuadro();

    this.limpiar = () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', redimensionar);
      window.removeEventListener('pointermove', alMover);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      for (const d of desechables) d.dispose();
      renderer.dispose();
    };
  }
}
