package com.apoyolaboral.gestiontesoreria.huella;

import android.content.Context;
import android.hardware.usb.UsbDevice;

/**
 * LO QUE TIENE QUE SABER HACER UN LECTOR, SEA DE QUIEN SEA
 *
 * Cada fabricante trae su propio SDK y ninguno se parece al otro, pero el
 * plugin solo necesita tres cosas de todos ellos: abrir, capturar y cerrar.
 * Esa es toda la superficie que cruza esta interfaz.
 *
 * Anadir una marca nueva es escribir un adaptador y registrarlo en
 * {@link HuellaLectorPlugin}: ni el plugin ni la aplicacion web se enteran.
 */
public interface LectorHuella {

    /** Nombre del fabricante, para los mensajes y la trazabilidad. */
    String marca();

    /** Identificador USB del fabricante, para reconocer sus lectores. */
    int vendorId();

    /**
     * Esta el SDK de esta marca dentro del APK? Los adaptadores resuelven sus
     * clases por reflexion, asi que esto es literalmente "existe la clase?".
     * Sin el .jar/.aar del fabricante en `app/libs/` devuelve false y el plugin
     * sigue con el resto: la aplicacion compila y arranca igual.
     */
    boolean sdkPresente();

    /**
     * Abre el lector ya autorizado por el usuario. Lanza {@link HuellaException}
     * con un motivo legible si el SDK no arranca o el aparato no responde.
     */
    void abrir(Context contexto, UsbDevice dispositivo) throws HuellaException;

    /**
     * Captura una huella. Bloquea hasta que la persona pone el dedo o se agota
     * el tiempo, asi que NUNCA se llama desde el hilo principal.
     *
     * @param msEspera tiempo maximo esperando el dedo.
     */
    ImagenHuella capturar(int msEspera) throws HuellaException;

    /** Suelta el lector. Debe poder llamarse dos veces sin romperse. */
    void cerrar();

    /** Imagen cruda tal como la entrega el SDK: un byte por pixel, gris. */
    final class ImagenHuella {
        public final byte[] gris;
        public final int ancho;
        public final int alto;
        /** Calidad 0..100 si el SDK la reporta; -1 si no la da. */
        public final int calidad;

        public ImagenHuella(byte[] gris, int ancho, int alto, int calidad) {
            this.gris = gris;
            this.ancho = ancho;
            this.alto = alto;
            this.calidad = calidad;
        }
    }

    /** Fallo con un motivo que se le puede ensenar a quien esta contratando. */
    class HuellaException extends Exception {
        public HuellaException(String mensaje) { super(mensaje); }
        public HuellaException(String mensaje, Throwable causa) { super(mensaje, causa); }
    }
}
