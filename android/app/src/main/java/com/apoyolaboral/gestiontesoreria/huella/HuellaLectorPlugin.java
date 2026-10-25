package com.apoyolaboral.gestiontesoreria.huella;

import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LECTOR DE HUELLA CONECTADO AL CELULAR POR OTG
 *
 * Es el lado Android de `EstrategiaNativaAndroid`, en
 * `hiring/service/huella/estrategias.ts`. El contrato es el que esa estrategia
 * ya espera, y no debe cambiar sin cambiar tambien alli:
 *
 *   disponible() -> { disponible: boolean, dispositivo?: string }
 *   capturar()   -> { imagenBase64: string, calidad?: number, dispositivo?: string }
 *
 * Un fallo se devuelve con `call.reject(mensaje)`, y el mensaje se le ensena
 * tal cual a quien esta contratando: tiene que decir que hacer, no un codigo.
 *
 * ── QUE HACE Y QUE NO ─────────────────────────────────────────────────────
 * Este plugin resuelve todo lo que es igual para cualquier marca —encontrar el
 * lector, conseguir el permiso USB, sacar la captura del hilo principal,
 * convertir a PNG— y delega en un {@link LectorHuella} lo unico que cambia
 * entre fabricantes. Sin ningun SDK dentro del APK sigue compilando y
 * arrancando: responde "no disponible" y la pantalla ofrece adjuntar la imagen.
 */
@CapacitorPlugin(name = "HuellaLector")
public class HuellaLectorPlugin extends Plugin {

    /**
     * Adaptadores por orden de preferencia. Anadir una marca es anadir una
     * linea aqui; el primero cuyo SDK este dentro del APK es el que manda.
     */
    private final LectorHuella[] adaptadores = new LectorHuella[]{
            new AdaptadorSecuGen(),
            new AdaptadorDigitalPersona(),
    };

    /**
     * La captura bloquea hasta que la persona pone el dedo. En el hilo
     * principal eso congela la aplicacion entera y Android acaba matandola por
     * ANR, asi que va siempre en un hilo aparte.
     */
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();

    /** Espera al dedo. Suficiente para colocarlo sin que parezca colgado. */
    private static final int MS_ESPERA_DEDO = 15000;
    /** Espera a que la persona conteste el dialogo de permiso del sistema. */
    private static final int MS_ESPERA_PERMISO = 30000;

    @PluginMethod
    public void disponible(final PluginCall call) {
        hilo.execute(new Runnable() {
            @Override public void run() {
                JSObject res = new JSObject();
                LectorHuella adaptador = adaptadorConSdk();
                if (adaptador == null) {
                    // Sin SDK no hay nada que hacer, ni siquiera mirar el USB.
                    res.put("disponible", false);
                    res.put("motivo", "sin-sdk");
                    call.resolve(res);
                    return;
                }
                UsbDevice dispositivo = buscar(adaptador);
                res.put("disponible", dispositivo != null);
                if (dispositivo != null) {
                    res.put("dispositivo", nombreDe(adaptador, dispositivo));
                } else {
                    res.put("motivo", "sin-lector");
                }
                call.resolve(res);
            }
        });
    }

    @PluginMethod
    public void capturar(final PluginCall call) {
        hilo.execute(new Runnable() {
            @Override public void run() {
                LectorHuella adaptador = adaptadorConSdk();
                if (adaptador == null) {
                    call.reject("Esta version de la aplicacion no trae el software del lector.");
                    return;
                }

                UsbDevice dispositivo = buscar(adaptador);
                if (dispositivo == null) {
                    call.reject("No hay ningun lector conectado. Revisa el cable OTG.");
                    return;
                }

                Context contexto = getContext();
                UsbManager usb = (UsbManager) contexto.getSystemService(Context.USB_SERVICE);
                if (!PermisoUsb.asegurar(contexto, usb, dispositivo, MS_ESPERA_PERMISO)) {
                    call.reject("Falta autorizar el lector. Vuelve a intentar y acepta el "
                            + "aviso del sistema.");
                    return;
                }

                try {
                    adaptador.abrir(contexto, dispositivo);
                    LectorHuella.ImagenHuella imagen = adaptador.capturar(MS_ESPERA_DEDO);
                    String png = ImagenGris.aPngBase64(imagen.gris, imagen.ancho, imagen.alto);

                    JSObject res = new JSObject();
                    res.put("imagenBase64", png);
                    res.put("dispositivo", nombreDe(adaptador, dispositivo));
                    if (imagen.calidad >= 0) res.put("calidad", imagen.calidad);
                    call.resolve(res);
                } catch (LectorHuella.HuellaException e) {
                    call.reject(e.getMessage());
                } catch (Throwable e) {
                    call.reject("Error inesperado del lector: " + e);
                } finally {
                    // Siempre: dejar el lector tomado impide la siguiente captura
                    // y obliga a reiniciar la aplicacion.
                    adaptador.cerrar();
                }
            }
        });
    }

    /** El primer adaptador cuyo SDK viaje dentro del APK. */
    private LectorHuella adaptadorConSdk() {
        for (LectorHuella a : adaptadores) {
            if (a.sdkPresente()) return a;
        }
        return null;
    }

    private UsbDevice buscar(LectorHuella adaptador) {
        UsbManager usb = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        return PermisoUsb.buscarLector(usb, new int[]{ adaptador.vendorId() });
    }

    private static String nombreDe(LectorHuella adaptador, UsbDevice dispositivo) {
        String producto = dispositivo.getProductName();
        return producto != null && !producto.isEmpty()
                ? producto
                : adaptador.marca() + " (USB " + dispositivo.getDeviceId() + ")";
    }

    @Override
    protected void handleOnDestroy() {
        hilo.shutdownNow();
        super.handleOnDestroy();
    }
}
