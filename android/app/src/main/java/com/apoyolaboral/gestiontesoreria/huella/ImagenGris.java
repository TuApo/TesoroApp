package com.apoyolaboral.gestiontesoreria.huella;

import android.graphics.Bitmap;
import android.util.Base64;

import java.io.ByteArrayOutputStream;

/**
 * DE LO QUE ENTREGA EL LECTOR A LO QUE ESPERA LA PANTALLA
 *
 * Todos los SDK devuelven lo mismo: un array con un byte por pixel en escala de
 * grises, sin cabecera ni formato. La pantalla de contratacion espera un PNG en
 * base64 —el mismo que hoy devuelve el ejecutable de Windows— porque de ahi
 * salen tanto la vista previa como el archivo que se sube a biometria.
 *
 * El PNG se genera en ARGB_8888 y no en ALPHA_8: un bitmap de solo alfa se
 * comprime a un PNG que muchos visores pintan en negro, y la huella acabaria
 * invisible dentro de los documentos de contratacion.
 */
final class ImagenGris {

    private ImagenGris() {}

    static String aPngBase64(byte[] gris, int ancho, int alto) throws LectorHuella.HuellaException {
        if (gris == null || ancho <= 0 || alto <= 0 || gris.length < ancho * alto) {
            throw new LectorHuella.HuellaException("El lector devolvio una imagen incompleta.");
        }

        int[] pixeles = new int[ancho * alto];
        for (int i = 0; i < pixeles.length; i++) {
            int v = gris[i] & 0xFF;                       // el byte de Java viene con signo
            pixeles[i] = 0xFF000000 | (v << 16) | (v << 8) | v;
        }

        Bitmap bitmap = Bitmap.createBitmap(pixeles, ancho, alto, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream salida = new ByteArrayOutputStream();
        try {
            // PNG es sin perdida: una huella comprimida con JPEG pierde justo el
            // detalle de las crestas, que es lo unico que importa aqui.
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, salida);
        } finally {
            bitmap.recycle();
        }
        return Base64.encodeToString(salida.toByteArray(), Base64.NO_WRAP);
    }
}
