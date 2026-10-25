import { Injectable, inject } from '@angular/core';

import {
  Calidad, CajaRostro, FOTO_ALTO, FOTO_ANCHO, Rect,
  calcularRecorte34, medirCalidad, recorteCentrado34,
} from './foto-documento.util';
import { FondoBlancoService, ResultadoFondo } from './fondo-blanco.service';

/** Una foto tipo documento lista para revisar y subir. */
export interface FotoProcesada {
  /** JPEG 600×800 final: recortado y, si se pudo, sobre fondo blanco. */
  archivo: File;
  /** URL local del archivo final. Quien la recibe es su dueño (la revoca). */
  urlDespues: string;
  /** URL local del recorte ANTES del fondo blanco, para comparar. null si no hubo fondo. */
  urlAntes: string | null;
  /** El mismo JPEG final como data URL: es lo que se manda a la IA. */
  dataUrl: string;
  calidad: Calidad;
  fondo: ResultadoFondo;
  /** 'rostro' = recortado alrededor de la cara; 'centrado' = sin detector. */
  recorte: 'rostro' | 'centrado';
}

/** Lado mayor con el que se abre una imagen adjuntada: más no mejora un 600×800. */
const LADO_MAX_ARCHIVO = 1920;
/** Calidad JPEG de la foto final. */
const CALIDAD_JPEG = 0.9;

/**
 * Convierte un fotograma (o una imagen adjuntada) en la FOTO TIPO DOCUMENTO:
 * recorte 3:4 alrededor de la cara → medición de luz y nitidez → fondo blanco
 * → JPEG 600×800.
 *
 * Antes se guardaba el fotograma entero (1280×720, PNG de ~1,2 MB): la persona
 * salía pequeña, con la oficina detrás, y el archivo pesaba diez veces más.
 *
 * Las cuentas están en `foto-documento.util.ts`; aquí solo se pinta y se lee
 * de los canvas.
 */
@Injectable({ providedIn: 'root' })
export class FotoDocumentoService {
  private fondoBlanco = inject(FondoBlancoService);

  /** Adelanta la carga del segmentador (16 MB) mientras la persona se acomoda. */
  precargar(): void {
    void this.fondoBlanco.iniciar();
  }

  /**
   * @param fuente fotograma completo, ya volteado si la foto va en espejo.
   * @param caja   la cara en coordenadas normalizadas de `fuente`; null = recorte centrado.
   * @param avisar para ir diciendo en pantalla en qué paso va.
   */
  async procesar(
    fuente: HTMLCanvasElement,
    caja: CajaRostro | null,
    avisar: (paso: string) => void = () => {},
  ): Promise<FotoProcesada> {
    avisar('Recortando la foto…');
    const rect: Rect = caja
      ? calcularRecorte34(caja, fuente.width, fuente.height)
      : recorteCentrado34(fuente.width, fuente.height);

    const antes = lienzo(FOTO_ANCHO, FOTO_ALTO);
    const ctx = contexto(antes);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Blanco debajo: si algo del recorte quedara transparente, en el JPEG saldría negro.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, FOTO_ANCHO, FOTO_ALTO);
    ctx.drawImage(fuente, rect.x, rect.y, rect.ancho, rect.alto, 0, 0, FOTO_ANCHO, FOTO_ALTO);

    // Calidad sobre una copia a 300×400 (la escala de los umbrales) y ANTES del
    // fondo blanco: el blanco liso haría pasar por "movida" cualquier foto.
    const calidad = this.medir(antes, rect.alto);

    avisar('Poniendo el fondo blanco…');
    const despues = lienzo(FOTO_ANCHO, FOTO_ALTO);
    contexto(despues).drawImage(antes, 0, 0);
    const fondo = await this.fondoBlanco.aplicar(despues);

    const ts = new Date().toISOString().replace(/[:.]/g, '');
    const blobDespues = await aBlob(despues);
    const archivo = new File([blobDespues], `foto-${ts}.jpg`, { type: 'image/jpeg' });
    const urlAntes = fondo === 'aplicado' ? URL.createObjectURL(await aBlob(antes)) : null;

    return {
      archivo,
      urlDespues: URL.createObjectURL(archivo),
      urlAntes,
      dataUrl: await aDataUrl(blobDespues),
      calidad,
      fondo,
      recorte: caja ? 'rostro' : 'centrado',
    };
  }

  /**
   * Abre un archivo de imagen en un canvas, derecho (respeta la orientación
   * EXIF de las fotos de celular) y a lo sumo de 1920 px de lado.
   */
  async cargarArchivo(file: File): Promise<HTMLCanvasElement> {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Navegadores sin el segundo parámetro.
      bmp = await createImageBitmap(file);
    }
    try {
      const escala = Math.min(1, LADO_MAX_ARCHIVO / Math.max(bmp.width, bmp.height));
      const c = lienzo(Math.max(1, Math.round(bmp.width * escala)), Math.max(1, Math.round(bmp.height * escala)));
      const ctx = contexto(c);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return c;
    } finally {
      bmp.close();
    }
  }

  private medir(foto: HTMLCanvasElement, altoRecorte: number): Calidad {
    const chico = lienzo(FOTO_ANCHO / 2, FOTO_ALTO / 2);
    const ctx = contexto(chico);
    ctx.drawImage(foto, 0, 0, chico.width, chico.height);
    const img = ctx.getImageData(0, 0, chico.width, chico.height);
    return medirCalidad(img.data, chico.width, chico.height, altoRecorte);
  }
}

function lienzo(ancho: number, alto: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = alto;
  return c;
}

function contexto(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('El navegador no dio un contexto 2D');
  return ctx;
}

function aBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, mal) =>
    c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo codificar la foto'))), 'image/jpeg', CALIDAD_JPEG),
  );
}

function aDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => mal(fr.error);
    fr.readAsDataURL(b);
  });
}
