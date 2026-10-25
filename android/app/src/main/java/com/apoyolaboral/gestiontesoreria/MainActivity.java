package com.apoyolaboral.gestiontesoreria;

import android.os.Bundle;

import com.apoyolaboral.gestiontesoreria.huella.HuellaLectorPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ANTES de super.onCreate: el puente de Capacitor se construye ahi, y un
        // plugin registrado despues no existe para la aplicacion web.
        registerPlugin(HuellaLectorPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
