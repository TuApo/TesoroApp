#!/usr/bin/env python3
"""Verifica el .apk/.aab recién firmados contra lo que exige Google Play y deja
verificacion.json (lo lee Infraestructura › DevOps › Integridad).

Uso: verificar-android.py <apk> <aab> <capacitor.config.json> <salida.json>
Requiere ANDROID_HOME con build-tools 35+ (aapt2, apksigner, zipalign -P).
"""
import datetime
import glob
import json
import os
import re
import struct
import subprocess
import sys
import zipfile

apk, aab, cap_cfg, salida = sys.argv[1:5]
TARGET_MIN = 36          # Play rechazó la 12.2.3 con targetSdk 35 (24-oct-2026): pide 36
SENSIBLES = {
    "android.permission.ACCESS_BACKGROUND_LOCATION": "Requiere declaración y vídeo en Play Console",
    "android.permission.REQUEST_INSTALL_PACKAGES": "Play lo rechaza salvo apps que instalan paquetes",
    "android.permission.READ_SMS": "Restringido por Play",
    "android.permission.READ_CALL_LOG": "Restringido por Play",
    "android.permission.MANAGE_EXTERNAL_STORAGE": "Requiere declaración de acceso a todos los archivos",
    "android.permission.QUERY_ALL_PACKAGES": "Requiere declaración",
    "android.permission.SYSTEM_ALERT_WINDOW": "Revisar uso",
}

bt = sorted(glob.glob(os.path.join(os.environ.get("ANDROID_HOME", "/usr/local/lib/android/sdk"), "build-tools", "*")))[-1]
herr = lambda n: os.path.join(bt, n)
chequeos = []


def chequeo(clave, nombre, ok, detalle, aviso=False):
    chequeos.append({"clave": clave, "nombre": nombre, "estado": "OK" if ok else ("AVISO" if aviso else "ERROR"), "detalle": detalle})


def correr(*args):
    r = subprocess.run(args, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


# ── Manifiesto (aapt2 badging) ──────────────────────────────────────────────
_, badging = correr(herr("aapt2"), "dump", "badging", apk)
m = lambda pat: (re.search(pat, badging) or [None, None])[1]
paquete = m(r"package: name='([^']+)'")
version = m(r"versionName='([^']+)'")
code = int(m(r"versionCode='(\d+)'") or 0)
target = int(m(r"targetSdkVersion:'(\d+)'") or 0)
minimo = int(m(r"(?:minSdkVersion|sdkVersion):'(\d+)'") or 0)
permisos = sorted(set(re.findall(r"uses-permission: name='([^']+)'", badging)))
depurable = "application-debuggable" in badging

chequeo("target_sdk", "targetSdk", target >= TARGET_MIN, f"targetSdk {target} (Play exige ≥ {TARGET_MIN})")
chequeo("min_sdk", "minSdk", minimo >= 24, f"minSdk {minimo}")
chequeo("depurable", "Compilación de release", not depurable, "android:debuggable desactivado" if not depurable else "¡La app es depurable!")
sens = [f"{p.split('.')[-1]}: {SENSIBLES[p]}" for p in permisos if p in SENSIBLES]
chequeo("permisos", "Permisos sensibles", not sens, "; ".join(sens) if sens else f"{len(permisos)} permisos, ninguno restringido por Play", aviso=True)

# ── Firma ───────────────────────────────────────────────────────────────────
rc, firma = correr(herr("apksigner"), "verify", "--verbose", "--print-certs", apk)
sha = (re.search(r"certificate SHA-256 digest: ([0-9a-f]+)", firma) or [None, None])[1]
v2 = "Verified using v2 scheme (APK Signature Scheme v2): true" in firma
v3 = "Verified using v3 scheme (APK Signature Scheme v3): true" in firma
chequeo("firma", "Firma del APK", rc == 0 and (v2 or v3), f"v2={v2} v3={v3} · SHA-256 {sha[:16]}…" if sha else firma.strip()[:200])

# ── Páginas de 16 KB ────────────────────────────────────────────────────────
rc, _ = correr(herr("zipalign"), "-c", "-P", "16", "4", apk)
mal = []
with zipfile.ZipFile(apk) as z:
    for n in z.namelist():
        if not n.endswith(".so") or "/arm64-v8a/" not in n and "/x86_64/" not in n:
            continue
        b = z.read(n)
        if b[:4] != b"\x7fELF" or b[4] != 2:
            continue
        phoff, = struct.unpack_from("<Q", b, 0x20)
        phentsize, phnum = struct.unpack_from("<HH", b, 0x36)
        for i in range(phnum):
            off = phoff + i * phentsize
            ptype, = struct.unpack_from("<I", b, off)
            if ptype == 1:  # PT_LOAD
                align, = struct.unpack_from("<Q", b, off + 0x30)
                if align < 16384:
                    mal.append(f"{n.split('/')[-1]} ({align})")
                    break
chequeo("pagina_16k", "Páginas de 16 KB", rc == 0 and not mal,
        "zip y bibliotecas nativas alineadas a 16 KB" if rc == 0 and not mal else f"zipalign={rc} · sin alinear: {', '.join(mal[:6])}")

# ── Configuración de Capacitor ──────────────────────────────────────────────
try:
    cfg = json.load(open(cap_cfg))
except Exception:
    cfg = {}
host = cfg.get("server", {}).get("hostname")
esquema = cfg.get("server", {}).get("androidScheme", "https")
chequeo("origen", "Origen de la app", host == "tesoro.tuapo.co" and esquema == "https",
        f"{esquema}://{host or 'localhost'} (el API solo acepta *.tuapo.co)")
chequeo("cleartext", "Tráfico sin cifrar", not cfg.get("server", {}).get("cleartext"),
        "cleartext desactivado" if not cfg.get("server", {}).get("cleartext") else "server.cleartext=true")

# ── Paquetes ────────────────────────────────────────────────────────────────
tam_aab = os.path.getsize(aab) if os.path.exists(aab) else 0
chequeo("aab", "Android App Bundle", tam_aab > 0 and tam_aab < 200 * 1024 * 1024,
        f"{tam_aab / 1048576:.1f} MB (Play admite hasta 200 MB de descarga base)")

json.dump({
    "plataforma": "android",
    "paquete": paquete,
    "version": version,
    "version_code": code,
    "target_sdk": target,
    "min_sdk": minimo,
    "permisos": permisos,
    "certificado_sha256": sha,
    "apk_mb": round(os.path.getsize(apk) / 1048576, 1),
    "aab_mb": round(tam_aab / 1048576, 1),
    "capacitor": {"hostname": host, "android_scheme": esquema, "app_id": cfg.get("appId")},
    "commit": os.environ.get("GITHUB_SHA"),
    "rama": os.environ.get("GITHUB_REF_NAME"),
    "run": os.environ.get("GITHUB_RUN_NUMBER"),
    "fecha": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "chequeos": chequeos,
}, open(salida, "w"), ensure_ascii=False, indent=2)

errores = [c for c in chequeos if c["estado"] == "ERROR"]
for c in chequeos:
    print(f"[{c['estado']:5}] {c['nombre']}: {c['detalle']}")
if errores:
    print(f"::error::{len(errores)} chequeos de integridad fallaron")
    sys.exit(1)
