# SDK del lector de huella

Esta carpeta esta vacia a proposito. Los SDK de lectores biometricos son
propietarios: hay que descargarlos del fabricante (registro gratuito) y no se
pueden versionar aqui.

## Que poner, segun el lector que compren

### SecuGen (familia Hamster) — FDx SDK Pro for Android
1. El `.jar` del SDK → `android/app/libs/`
2. Las librerias nativas → `android/app/src/main/jniLibs/<abi>/*.so`
   (al menos `arm64-v8a`; `armeabi-v7a` si hay telefonos viejos)

### DigitalPersona / HID — U.are.U SDK for Android
1. El `.aar` o `.jar` → `android/app/libs/`
2. Las librerias nativas → `android/app/src/main/jniLibs/<abi>/*.so`

No hace falta tocar nada mas: `AdaptadorSecuGen` y `AdaptadorDigitalPersona`
resuelven las clases del SDK por reflexion y se activan solos en cuanto la
libreria esta dentro del APK. Sin ellas la aplicacion compila igual y el lector
sale como "no disponible".

## Al integrar, verificar

Los nombres de clases y metodos de los adaptadores estan agrupados en las
constantes del principio de cada archivo. El fabricante los ha movido entre
versiones: si el SDK descargado no casa, se corrigen ahi y no hay que tocar
nada mas del proyecto.

Despues: `sudo /var/www/produccion/deploy-tesoro.sh apk`
