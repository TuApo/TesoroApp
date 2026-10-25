import {
  CARA_SOBRE_ALTO, OJOS_DESDE_ARRIBA,
  alfaDesdeProbabilidad, calcularRecorte34, componerSobreBlanco, espejarCaja,
  mascaraCreible, medirCalidad, recorteCentrado34, redimensionarMascara, suavizarMascara,
  varianzaLaplaciano, luminancias,
} from './foto-documento.util';

/**
 * Foto tipo documento: recorte, calidad y fondo blanco.
 *
 * Lo que importa probar aquí es la GEOMETRÍA del recorte (que siempre sea 3:4
 * exacto, dentro de la imagen y con la cara donde va) y que las medidas de
 * calidad separen lo nítido de lo movido y lo claro de lo oscuro. Los umbrales
 * finos se calibran con fotos reales; esto fija el sentido de cada medida.
 */

/** Imagen RGBA de un solo gris. */
function gris(ancho: number, alto: number, v: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(ancho * alto * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = a[i + 1] = a[i + 2] = v;
    a[i + 3] = 255;
  }
  return a;
}

/** Tablero de ajedrez de casillas de `lado` píxeles. */
function tablero(ancho: number, alto: number, lado: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const v = (Math.floor(x / lado) + Math.floor(y / lado)) % 2 ? 230 : 25;
      const p = (y * ancho + x) * 4;
      a[p] = a[p + 1] = a[p + 2] = v;
      a[p + 3] = 255;
    }
  }
  return a;
}

describe('recorte 3:4', () => {
  it('sin detector: el 3:4 más grande, centrado', () => {
    expect(recorteCentrado34(1280, 720)).toEqual({ x: 370, y: 0, ancho: 540, alto: 720 });
    // Foto vertical más estrecha que 3:4: manda el ancho.
    const r = recorteCentrado34(600, 1000);
    expect(r.ancho).toBe(600);
    expect(r.alto).toBe(800);
    expect(r.y).toBe(100);
  });

  it('con la cara: 3:4 exacto, cara al ~57 % del alto y ojos al ~40 % desde arriba', () => {
    const caja = { minX: 0.42, maxX: 0.58, minY: 0.3, maxY: 0.7, ojosY: 0.45 };
    const r = calcularRecorte34(caja, 1280, 720);

    expect(r.ancho * 4).toBe(r.alto * 3);
    const altoCara = (caja.maxY - caja.minY) * 720;
    expect(altoCara / r.alto).toBeCloseTo(CARA_SOBRE_ALTO, 1);
    expect((caja.ojosY * 720 - r.y) / r.alto).toBeCloseTo(OJOS_DESDE_ARRIBA, 1);
    // Centrada en horizontal (el centro de la cara es x = 640).
    expect(Math.abs(r.x + r.ancho / 2 - 640)).toBeLessThanOrEqual(2);
  });

  it('sin la altura de los ojos, usa el centro de la cara', () => {
    const r = calcularRecorte34({ minX: 0.4, maxX: 0.6, minY: 0.3, maxY: 0.7 }, 1280, 720);
    const centro = 0.5 * 720;
    expect((centro - r.y) / r.alto).toBeCloseTo(0.445, 1);
  });

  it('nunca se sale de la imagen: se desplaza hacia dentro', () => {
    // Cara pegada al borde izquierdo y arriba.
    const r = calcularRecorte34({ minX: 0.0, maxX: 0.12, minY: 0.02, maxY: 0.35, ojosY: 0.15 }, 1280, 720);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.x + r.ancho).toBeLessThanOrEqual(1280);
    expect(r.y + r.alto).toBeLessThanOrEqual(720);
  });

  it('si la cara está muy cerca, encoge al 3:4 más grande que cabe', () => {
    const r = calcularRecorte34({ minX: 0.3, maxX: 0.7, minY: 0.05, maxY: 0.95, ojosY: 0.4 }, 1280, 720);
    expect(r.alto).toBe(720);
    expect(r.ancho).toBe(540);
    expect(r.y).toBe(0);
  });

  it('una caja degenerada cae al recorte centrado', () => {
    expect(calcularRecorte34({ minX: 0.5, maxX: 0.5, minY: 0.4, maxY: 0.4 }, 1280, 720))
      .toEqual(recorteCentrado34(1280, 720));
  });

  it('el espejo voltea la caja en horizontal y deja la vertical', () => {
    expect(espejarCaja({ minX: 0.1, maxX: 0.3, minY: 0.2, maxY: 0.6, ojosY: 0.35 }))
      .toEqual({ minX: 0.7, maxX: 0.9, minY: 0.2, maxY: 0.6, ojosY: 0.35 });
  });
});

describe('calidad', () => {
  it('una imagen plana no tiene bordes: sale "movida"', () => {
    const c = medirCalidad(gris(300, 400, 128), 300, 400);
    expect(c.brillo).toBe(128);
    expect(c.nitidez).toBe(0);
    expect(c.avisos).toEqual(['movida']);
  });

  it('oscura avisa poca luz y quemada avisa demasiada luz', () => {
    expect(medirCalidad(gris(300, 400, 30), 300, 400).avisos).toContain('poca-luz');
    expect(medirCalidad(gris(300, 400, 245), 300, 400).avisos).toContain('mucha-luz');
  });

  it('con bordes marcados y luz media no avisa nada', () => {
    const c = medirCalidad(tablero(300, 400, 3), 300, 400);
    expect(c.avisos).toEqual([]);
    expect(c.nitidez).toBeGreaterThan(1000);
  });

  it('lo desenfocado mide menos nitidez que lo nítido', () => {
    const nitido = tablero(120, 160, 4);
    const lumN = luminancias(nitido, 120, 160);
    const borroso = suavizarMascara(lumN, 120, 160, 3);
    expect(varianzaLaplaciano(borroso, 120, 160)).toBeLessThan(varianzaLaplaciano(lumN, 120, 160) / 4);
  });

  it('un recorte de muy pocos píxeles avisa que se ve pequeña', () => {
    expect(medirCalidad(tablero(300, 400, 3), 300, 400, 200).avisos).toEqual(['baja-resolucion']);
    expect(medirCalidad(tablero(300, 400, 3), 300, 400, 600).avisos).toEqual([]);
  });
});

describe('fondo blanco', () => {
  it('la rampa va de 0 a 1 sin saltos', () => {
    expect(alfaDesdeProbabilidad(0)).toBe(0);
    expect(alfaDesdeProbabilidad(0.3)).toBe(0);
    expect(alfaDesdeProbabilidad(0.5)).toBeCloseTo(0.5, 5);
    expect(alfaDesdeProbabilidad(0.7)).toBe(1);
    expect(alfaDesdeProbabilidad(1)).toBe(1);
    let antes = -1;
    for (let p = 0; p <= 1; p += 0.05) {
      const a = alfaDesdeProbabilidad(p);
      expect(a).toBeGreaterThanOrEqual(antes);
      antes = a;
    }
  });

  it('sin persona todo queda blanco; con persona entera no cambia nada', () => {
    const fondo = componerSobreBlanco(gris(10, 10, 60), new Float32Array(100).fill(0), 10, 10);
    expect(Array.from(fondo.slice(0, 4))).toEqual([255, 255, 255, 255]);

    const persona = componerSobreBlanco(gris(10, 10, 60), new Float32Array(100).fill(1), 10, 10);
    expect(Array.from(persona.slice(0, 4))).toEqual([60, 60, 60, 255]);
  });

  it('el borde queda suavizado, no cortado a tijera', () => {
    // Mitad izquierda persona, mitad derecha fondo.
    const ancho = 20;
    const prob = new Float32Array(ancho * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < ancho / 2; x++) prob[y * ancho + x] = 1;
    const out = componerSobreBlanco(gris(ancho, 4, 0), prob, ancho, 4, 2);
    const valor = (x: number) => out[(1 * ancho + x) * 4];
    expect(valor(0)).toBe(0);          // dentro de la persona
    expect(valor(ancho - 1)).toBe(255); // fondo
    expect(valor(9)).toBeGreaterThan(0); // en el borde: gris intermedio
    expect(valor(9)).toBeLessThan(255);
    expect(valor(10)).toBeGreaterThan(0);
    expect(valor(10)).toBeLessThan(255);
  });

  it('remuestrea la máscara del modelo al tamaño de la foto', () => {
    const m = new Float32Array([0, 1, 0, 1]); // 2×2
    const r = redimensionarMascara(m, 2, 2, 4, 4);
    expect(r.length).toBe(16);
    expect(r[0]).toBe(0);
    expect(r[3]).toBe(1);
    for (const v of Array.from(r)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Array.from(redimensionarMascara(m, 2, 2, 2, 2))).toEqual([0, 1, 0, 1]);
  });

  it('una máscara vacía o total no se usa', () => {
    expect(mascaraCreible(new Float32Array(100).fill(0))).toBeFalse();
    expect(mascaraCreible(new Float32Array(100).fill(1))).toBeFalse();
    const media = new Float32Array(100);
    media.fill(1, 0, 50);
    expect(mascaraCreible(media)).toBeTrue();
  });
});
