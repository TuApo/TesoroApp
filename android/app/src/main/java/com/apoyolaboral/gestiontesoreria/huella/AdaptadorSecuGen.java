package com.apoyolaboral.gestiontesoreria.huella;

import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * SECUGEN — FDx SDK Pro para Android
 *
 * Cubre la familia Hamster (Air, IV, Plus, Pro V2, Pro 10, Pro 20, Pro 30, Duo,
 * Trio) y los modulos U10/U20/U30. Es la familia mas ancha con soporte Android
 * de una sola casa, y el SDK se descarga sin costo del fabricante.
 *
 * ── QUE HAY QUE PONER PARA QUE ESTO FUNCIONE ──────────────────────────────
 *   1. El .jar del SDK en `android/app/libs/`.
 *   2. Las librerias nativas (.so) en `android/app/src/main/jniLibs/<abi>/`.
 *      Sin ellas la clase carga pero revienta al inicializar.
 * Nada mas: no hay que tocar ni el plugin ni la aplicacion web.
 *
 * ── POR QUE POR REFLEXION ─────────────────────────────────────────────────
 * Para que el APK compile HOY, sin el SDK. Si estas clases se llamaran de
 * forma directa, el proyecto no compilaria hasta tener el .jar del fabricante,
 * y entonces nadie podria tocar nada del resto de la aplicacion mientras tanto.
 * Con reflexion, si el .jar no esta, `sdkPresente()` dice que no y el plugin
 * informa "sin lector" con normalidad.
 *
 * ⚠️ VERIFICAR CONTRA EL SDK QUE DESCARGUEN: los nombres de abajo son los de
 * la API publica de FDx SDK Pro, pero el fabricante los ha movido entre
 * versiones. Estan todos juntos aqui arriba justo para eso: si algo no casa,
 * se corrige en estas cinco constantes y no hay que tocar nada mas.
 */
final class AdaptadorSecuGen implements LectorHuella {

    private static final String CLASE_LIB   = "SecuGen.FDxSDKPro.JSGFPLib";
    private static final String CLASE_INFO  = "SecuGen.FDxSDKPro.SGDeviceInfoParam";
    private static final String METODO_INIT = "Init";
    private static final String METODO_ABRIR = "OpenDevice";
    private static final String METODO_IMAGEN = "GetImage";

    /** SG_DEV_AUTO: que el SDK descubra el modelo conectado. */
    private static final int DISPOSITIVO_AUTO = 0xFF;

    private Object lib;
    private int ancho;
    private int alto;

    @Override public String marca() { return "SecuGen"; }

    /** 0x1162, segun el registro oficial de identificadores USB. */
    @Override public int vendorId() { return 0x1162; }

    @Override public boolean sdkPresente() {
        try {
            Class.forName(CLASE_LIB);
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    @Override
    public void abrir(Context contexto, UsbDevice dispositivo) throws HuellaException {
        try {
            UsbManager usb = (UsbManager) contexto.getSystemService(Context.USB_SERVICE);
            Class<?> claseLib = Class.forName(CLASE_LIB);
            // JSGFPLib recibe el UsbManager: el SDK abre el aparato por su cuenta
            // sobre el permiso que ya concedio la persona.
            lib = claseLib.getConstructor(UsbManager.class).newInstance(usb);

            invocarEsperandoCero(claseLib, METODO_INIT, new Class<?>[]{ long.class },
                    new Object[]{ (long) DISPOSITIVO_AUTO }, "iniciar el SDK");
            invocarEsperandoCero(claseLib, METODO_ABRIR, new Class<?>[]{ long.class },
                    new Object[]{ 0L }, "abrir el lector");

            leerTamanoImagen(claseLib);
        } catch (HuellaException e) {
            throw e;
        } catch (Throwable e) {
            throw new HuellaException("No se pudo iniciar el lector SecuGen: " + e, e);
        }
    }

    /**
     * El tamano de la imagen depende del modelo (no es el mismo en un Hamster
     * Pro 20 que en un Trio), asi que se pregunta en vez de codificarlo.
     */
    private void leerTamanoImagen(Class<?> claseLib) throws Exception {
        Class<?> claseInfo = Class.forName(CLASE_INFO);
        Object info = claseInfo.getConstructor().newInstance();
        Method getInfo = claseLib.getMethod("GetDeviceInfo", claseInfo);
        getInfo.invoke(lib, info);

        ancho = leerEntero(claseInfo, info, "imageWidth");
        alto = leerEntero(claseInfo, info, "imageHeight");
        if (ancho <= 0 || alto <= 0) {
            throw new HuellaException("El lector no informo el tamano de la imagen.");
        }
    }

    private static int leerEntero(Class<?> clase, Object obj, String campo) throws Exception {
        Field f = clase.getField(campo);
        Object v = f.get(obj);
        return v instanceof Number ? ((Number) v).intValue() : 0;
    }

    /** Los metodos del SDK devuelven 0 cuando todo fue bien y un codigo si no. */
    private void invocarEsperandoCero(Class<?> clase, String metodo, Class<?>[] tipos,
                                      Object[] args, String queHacia) throws Exception {
        Method m = buscarMetodo(clase, metodo, tipos);
        Object r = m.invoke(lib, args);
        long codigo = r instanceof Number ? ((Number) r).longValue() : 0;
        if (codigo != 0) {
            throw new HuellaException("El lector fallo al " + queHacia + " (codigo " + codigo + ").");
        }
    }

    /**
     * El SDK ha declarado estos metodos como `int` en unas versiones y `long`
     * en otras. Se prueban las dos antes de rendirse.
     */
    private static Method buscarMetodo(Class<?> clase, String nombre, Class<?>[] tipos)
            throws NoSuchMethodException {
        try {
            return clase.getMethod(nombre, tipos);
        } catch (NoSuchMethodException e) {
            Class<?>[] alternativos = new Class<?>[tipos.length];
            for (int i = 0; i < tipos.length; i++) {
                alternativos[i] = tipos[i] == long.class ? int.class : tipos[i];
            }
            return clase.getMethod(nombre, alternativos);
        }
    }

    @Override
    public ImagenHuella capturar(int msEspera) throws HuellaException {
        if (lib == null) throw new HuellaException("El lector no esta abierto.");
        try {
            byte[] buffer = new byte[ancho * alto];
            Class<?> clase = lib.getClass();

            // GetImageEx espera al dedo y ademas devuelve calidad; GetImage
            // captura lo que haya en el cristal ahora mismo. Se prefiere la
            // primera y se cae a la segunda en los SDK que no la traen.
            try {
                Method ex = clase.getMethod("GetImageEx", long.class, byte[].class, long.class);
                Object r = ex.invoke(lib, (long) msEspera, buffer, 50L);
                long codigo = r instanceof Number ? ((Number) r).longValue() : 0;
                if (codigo != 0) {
                    throw new HuellaException("No se capturo la huella (codigo " + codigo + "). "
                            + "Pide a la persona que apoye bien el dedo y reintenta.");
                }
            } catch (NoSuchMethodException sinEx) {
                invocarEsperandoCero(clase, METODO_IMAGEN, new Class<?>[]{ byte[].class },
                        new Object[]{ buffer }, "capturar la huella");
            }

            return new ImagenHuella(buffer, ancho, alto, calidadDe(buffer));
        } catch (HuellaException e) {
            throw e;
        } catch (Throwable e) {
            throw new HuellaException("Fallo la captura en el lector SecuGen: " + e, e);
        }
    }

    /** La calidad que reporta el SDK, si esta disponible; -1 si no. */
    private int calidadDe(byte[] imagen) {
        try {
            Method m = lib.getClass().getMethod("GetImageQuality",
                    long.class, long.class, byte[].class, int[].class);
            int[] salida = new int[1];
            m.invoke(lib, (long) ancho, (long) alto, imagen, salida);
            return salida[0];
        } catch (Throwable e) {
            return -1;
        }
    }

    @Override
    public void cerrar() {
        if (lib == null) return;
        try {
            lib.getClass().getMethod("CloseDevice").invoke(lib);
        } catch (Throwable ignorado) {
            // Cerrar es best-effort: si el aparato ya se desconecto, da igual.
        }
        lib = null;
    }
}
