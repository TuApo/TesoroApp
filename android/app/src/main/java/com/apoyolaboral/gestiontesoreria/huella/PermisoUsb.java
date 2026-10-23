package com.apoyolaboral.gestiontesoreria.huella;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * EL PERMISO USB DE ANDROID, QUE ES DONDE SE CAE TODO EL MUNDO
 *
 * Conectar el lector por OTG no basta: Android exige que la persona autorice
 * expresamente que ESTA aplicacion hable con ESE aparato, y la respuesta llega
 * por un broadcast, no por un valor de retorno. Hasta que ese permiso no esta
 * concedido, cualquier SDK falla con un error que no dice nada util.
 *
 * Tres detalles que en versiones recientes de Android son obligatorios y cuya
 * ausencia solo se nota en el telefono de la oficina, nunca en el emulador:
 *
 *  · `PendingIntent` debe ser FLAG_IMMUTABLE desde Android 12. Sin eso el
 *    sistema lanza IllegalArgumentException al crear el intent.
 *  · `registerReceiver` debe declarar RECEIVER_NOT_EXPORTED desde Android 13
 *    (obligatorio con targetSdk 34+, y este proyecto compila contra 35).
 *  · La accion del intent tiene que ser unica de la aplicacion. Con una accion
 *    generica, otra app puede recibir el broadcast destinado a esta.
 *
 * Todo esto es igual para SecuGen, DigitalPersona, Futronic o Suprema: por eso
 * vive aqui y no dentro de cada adaptador.
 */
final class PermisoUsb {

    private static final String ACCION_PERMISO =
            "com.apoyolaboral.gestiontesoreria.USB_PERMISSION_HUELLA";

    private PermisoUsb() {}

    /** El primer lector conectado cuyo fabricante reconozcamos, o null. */
    static UsbDevice buscarLector(UsbManager usb, int[] vendorIds) {
        Map<String, UsbDevice> conectados = usb == null
                ? new HashMap<String, UsbDevice>() : usb.getDeviceList();
        for (UsbDevice d : conectados.values()) {
            for (int vid : vendorIds) {
                if (d.getVendorId() == vid) return d;
            }
        }
        return null;
    }

    /**
     * Pide el permiso y ESPERA la respuesta. Bloquea, asi que solo se llama
     * desde un hilo de trabajo.
     *
     * Devuelve true si quedo concedido. Si la persona no contesta dentro del
     * plazo se devuelve false en lugar de esperar para siempre: un dialogo que
     * nadie toca no puede dejar colgada la pantalla de contratacion.
     */
    static boolean asegurar(Context contexto, UsbManager usb, UsbDevice dispositivo, int msEspera) {
        if (usb.hasPermission(dispositivo)) return true;

        final AtomicBoolean concedido = new AtomicBoolean(false);
        final CountDownLatch respuesta = new CountDownLatch(1);

        BroadcastReceiver receptor = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent intent) {
                if (!ACCION_PERMISO.equals(intent.getAction())) return;
                concedido.set(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false));
                respuesta.countDown();
            }
        };

        IntentFilter filtro = new IntentFilter(ACCION_PERMISO);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            contexto.registerReceiver(receptor, filtro, Context.RECEIVER_NOT_EXPORTED);
        } else {
            contexto.registerReceiver(receptor, filtro);
        }

        try {
            int banderas = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            Intent intent = new Intent(ACCION_PERMISO).setPackage(contexto.getPackageName());
            PendingIntent pendiente = PendingIntent.getBroadcast(contexto, 0, intent, banderas);

            usb.requestPermission(dispositivo, pendiente);
            respuesta.await(msEspera, TimeUnit.MILLISECONDS);
            // Se relee del sistema: si el usuario marco "usar por defecto", el
            // permiso puede estar concedido aunque el broadcast se perdiera.
            return concedido.get() || usb.hasPermission(dispositivo);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            try { contexto.unregisterReceiver(receptor); } catch (IllegalArgumentException ignorado) { }
        }
    }
}
