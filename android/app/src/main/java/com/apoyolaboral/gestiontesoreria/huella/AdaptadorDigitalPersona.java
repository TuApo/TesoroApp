package com.apoyolaboral.gestiontesoreria.huella;

import android.content.Context;
import android.hardware.usb.UsbDevice;

import java.lang.reflect.Method;

/**
 * DIGITALPERSONA / HID — U.are.U SDK para Android
 *
 * Es la opcion que no cambia de proveedor: misma marca que los lectores de
 * escritorio. Cubre la U.are.U 5160 y 5100.
 *
 * ⚠️ NO CUBRE LA 4500, que es la que hay hoy en las oficinas: el fabricante no
 * publico soporte Android para ese modelo. Este adaptador solo sirve con un
 * lector de la linea 5000.
 *
 * ── QUE HAY QUE PONER ─────────────────────────────────────────────────────
 *   1. El .aar/.jar del U.are.U SDK for Android en `android/app/libs/`.
 *   2. Sus librerias nativas en `android/app/src/main/jniLibs/<abi>/`.
 *
 * ⚠️ VERIFICAR CONTRA EL SDK DESCARGADO, igual que en el adaptador de SecuGen:
 * los nombres viven todos en las constantes de aqui arriba para que corregirlos
 * sea cambiar tres lineas.
 */
final class AdaptadorDigitalPersona implements LectorHuella {

    private static final String CLASE_GLOBAL = "com.digitalpersona.uareu.UareUGlobal";
    private static final String CLASE_FID    = "com.digitalpersona.uareu.Fid";
    private static final String CLASE_READER = "com.digitalpersona.uareu.Reader";

    /** 500 ppp: la resolucion estandar de captura para identificacion civil. */
    private static final int RESOLUCION = 500;

    private Object lector;

    @Override public String marca() { return "DigitalPersona"; }

    /** 0x05BA, segun el registro oficial de identificadores USB. */
    @Override public int vendorId() { return 0x05BA; }

    @Override public boolean sdkPresente() {
        try {
            Class.forName(CLASE_GLOBAL);
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    @Override
    public void abrir(Context contexto, UsbDevice dispositivo) throws HuellaException {
        try {
            Class<?> global = Class.forName(CLASE_GLOBAL);
            Method getColeccion = global.getMethod("GetReaderCollection", Context.class);
            Object coleccion = getColeccion.invoke(null, contexto);

            // La coleccion es una List de lectores; hay que refrescarla porque
            // se puebla al enumerar, no al construirse.
            coleccion.getClass().getMethod("GetReaders").invoke(coleccion);
            java.util.List<?> lectores = (java.util.List<?>) coleccion;
            if (lectores.isEmpty()) {
                throw new HuellaException("El SDK no encuentra ningun lector conectado.");
            }
            lector = lectores.get(0);

            Class<?> claseReader = Class.forName(CLASE_READER);
            Class<?> prioridad = Class.forName(CLASE_READER + "$Priority");
            Object exclusivo = Enum.valueOf(prioridad.asSubclass(Enum.class), "EXCLUSIVE");
            claseReader.getMethod("Open", prioridad).invoke(lector, exclusivo);
        } catch (HuellaException e) {
            throw e;
        } catch (Throwable e) {
            throw new HuellaException("No se pudo abrir el lector DigitalPersona: " + e, e);
        }
    }

    @Override
    public ImagenHuella capturar(int msEspera) throws HuellaException {
        if (lector == null) throw new HuellaException("El lector no esta abierto.");
        try {
            Class<?> claseFid = Class.forName(CLASE_FID);
            Class<?> formato = Class.forName(CLASE_FID + "$Format");
            Class<?> procesado = Class.forName(CLASE_READER + "$ImageProcessing");

            // RAW en vez de ANSI_381: aqui hace falta la imagen, no una plantilla
            // biometrica. Lo que se guarda en contratacion es un PNG visible.
            Object formatoRaw = Enum.valueOf(formato.asSubclass(Enum.class), "ANSI_381_2004");
            Object sinProceso = Enum.valueOf(procesado.asSubclass(Enum.class), "IMG_PROC_DEFAULT");

            Method capturar = Class.forName(CLASE_READER).getMethod(
                    "Capture", formato, procesado, int.class, int.class);
            Object resultado = capturar.invoke(lector, formatoRaw, sinProceso, RESOLUCION, msEspera);
            if (resultado == null) {
                throw new HuellaException("No se capturo la huella. Pide a la persona que "
                        + "apoye bien el dedo y reintenta.");
            }

            // CaptureResult.image es un Fid; su primera "view" trae los bytes.
            Object fid = resultado.getClass().getField("image").get(resultado);
            Object[] vistas = (Object[]) claseFid.getMethod("getViews").invoke(fid);
            if (vistas == null || vistas.length == 0) {
                throw new HuellaException("El lector devolvio una captura vacia.");
            }
            Object vista = vistas[0];
            Class<?> claseVista = vista.getClass();

            byte[] gris = (byte[]) claseVista.getMethod("getImageData").invoke(vista);
            int ancho = (Integer) claseVista.getMethod("getWidth").invoke(vista);
            int alto = (Integer) claseVista.getMethod("getHeight").invoke(vista);

            return new ImagenHuella(gris, ancho, alto, calidadDe(resultado));
        } catch (HuellaException e) {
            throw e;
        } catch (Throwable e) {
            throw new HuellaException("Fallo la captura en el lector DigitalPersona: " + e, e);
        }
    }

    /** El SDK reporta la calidad como enum; se traduce a "buena o no". */
    private int calidadDe(Object resultado) {
        try {
            Object q = resultado.getClass().getField("quality").get(resultado);
            return "GOOD".equals(String.valueOf(q)) ? 100 : 50;
        } catch (Throwable e) {
            return -1;
        }
    }

    @Override
    public void cerrar() {
        if (lector == null) return;
        try {
            Class.forName(CLASE_READER).getMethod("Close").invoke(lector);
        } catch (Throwable ignorado) {
            // Best-effort, igual que en el resto de adaptadores.
        }
        lector = null;
    }
}
