#!/usr/bin/env bash
# Arma el ZIP que se envía a las oficinas.
# El mock de desarrollo NO viaja: sólo lo que se instala en un equipo.
set -euo pipefail
aqui="$(cd "$(dirname "$0")" && pwd)"
exe="$aqui/../csharp/UareUSampleCSharp_CaptureOnly.exe"
salida="${1:-$aqui/agente-huella-tuapo.zip}"

[ -f "$exe" ] || { echo "No está el ejecutable de captura en $exe" >&2; exit 1; }

# ── La version manda, y se sincroniza sola ─────────────────────────────────
#
# El numero vive en el archivo VERSION y se INYECTA en setup.ps1 al empaquetar.
# Antes estaba escrito a mano dentro del script y me lo deje sin subir: la marca
# del equipo coincidia con la del paquete nuevo, el instalador dijo "ya esta" y
# no copio nada. Una version que hay que acordarse de cambiar es una version
# que algun dia no se cambia.
VERSION="$(tr -d ' \n\r' < "$aqui/VERSION" 2>/dev/null || echo 0)"
[ -n "$VERSION" ] || { echo "Falta el archivo VERSION" >&2; exit 1; }
sed -i "s/^\(\$VERSION_PAQUETE = \)'[^']*'/\1'$VERSION'/" "$aqui/setup.ps1"
grep -q "VERSION_PAQUETE = '$VERSION'" "$aqui/setup.ps1" || {
  echo "No se pudo fijar la version en setup.ps1" >&2; exit 1; }
echo "  version del paquete: $VERSION"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
dest="$tmp/agente-huella"
mkdir -p "$dest"
cp "$aqui/huellero-agente.ps1" "$aqui/capturador.ps1" "$aqui/capturador-nativo.ps1" \
   "$aqui/shim-nativo.cs" "$aqui/setup.ps1" "$aqui/INSTALAR.cmd" "$aqui/DESINSTALAR.cmd" \
   "$aqui/crear-paquete.ps1" "$aqui/CREAR-PAQUETE.cmd" \
   "$aqui/VER-LOG.cmd" "$aqui/ESTADO.cmd" \
   "$aqui/LEEME.md" "$aqui/INSTALACION.md" "$dest/"
cp "$exe" "$dest/"

# BOM obligatorio en los scripts: PowerShell 5.1 lee un .ps1 sin BOM con la
# pagina de codigos ANSI del sistema, y cada caracter acentuado se parte en
# bytes que pueden romper una cadena. Nos costo una etapa entera: un guion
# largo dentro de un mensaje hizo que Windows ejecutara TIMEOUT.EXE.
for f in "$dest"/*.ps1 "$dest"/*.cs; do
  [ -f "$f" ] || continue
  if ! head -c3 "$f" | od -An -tx1 | grep -q "ef bb bf"; then
    printf '\xef\xbb\xbf' | cat - "$f" > "$f.bom" && mv "$f.bom" "$f"
    echo "  BOM anadido a $(basename "$f")"
  fi
done

# Las DLL del fabricante NO estan en el repositorio: son binarios licenciados.
# Si alguien las deja en `runtime/`, viajan en el ZIP y el paquete queda
# autocontenido; si no, el ZIP sale sin ellas y hay que copiarlas por puesto.
# El driver, si esta, viaja entero: el instalador lo aplica con pnputil.
if [ -d "$aqui/driver" ] && [ -n "$(find "$aqui/driver" -type f ! -name 'LEEME.txt' 2>/dev/null)" ]; then
  mkdir -p "$dest/driver"
  find "$aqui/driver" -type f ! -name 'LEEME.txt' -exec cp {} "$dest/driver/" \;
  echo "  driver: incluido ($(find "$dest/driver" -type f | wc -l) archivo(s))"
else
  echo "  AVISO: sin driver en driver/ - el equipo destino debe tenerlo ya instalado."
fi

if [ -d "$aqui/runtime" ] && [ -n "$(find "$aqui/runtime" -iname '*.dll' 2>/dev/null)" ]; then
  copiadas=$(find "$aqui/runtime" -maxdepth 1 -iname '*.dll' -exec cp {} "$dest/" \; -print | wc -l)
  echo "  runtime: $copiadas DLL incluidas -> el ZIP es AUTOCONTENIDO"
else
  echo "  AVISO: no hay carpeta runtime/ — el ZIP viaja SIN las DLL del lector."
  echo "         Copia dpfpdd.dll, dpfj.dll, dpfpdd_4k.dll, dpfpdd_ptapi.dll y tfm.dll"
  echo "         a $aqui/runtime/ y vuelve a empaquetar para un ZIP autocontenido."
fi

# `zip` no está instalado en el servidor; Python sí, y siempre.
rm -f "$salida"
python3 -c "
import shutil, sys, zipfile
shutil.make_archive(sys.argv[1].removesuffix('.zip'), 'zip', sys.argv[2])
for i in zipfile.ZipFile(sys.argv[1]).infolist():
    print(f'  {i.filename:44} {i.file_size:>9,} bytes')
" "$salida" "$tmp"
echo "Listo: $salida"
