#!/usr/bin/env python3
"""
AGENTE DE HUELLA FALSO — solo para desarrollo.

Habla exactamente el mismo contrato que `huellero-agente.ps1`, pero devuelve
siempre la misma imagen de prueba. Sirve para dos cosas:

  1. Verificar el camino web completo (navegador -> agente -> pantalla de
     contratacion) desde cualquier maquina, sin Windows y sin lector.
  2. Comprobar que las cabeceras CORS y de Private Network Access son las que
     el navegador exige, que es donde se cae este tipo de integracion.

NO se distribuye a las oficinas: no viaja en el ZIP del agente.

    python3 dev/agente-mock.py [--puerto 52181]
"""
import argparse
import base64
import json
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer

ORIGENES = {
    'https://tesoro.tuapo.co',
    'http://localhost:4200',
    'http://127.0.0.1:4200',
}


def png_de_prueba(ancho=160, alto=200):
    """PNG en escala de grises con unas bandas, para distinguirlo de una huella real."""
    filas = b''
    for y in range(alto):
        fila = bytearray([0])  # filtro None
        for x in range(ancho):
            fila.append(120 + (40 if ((x + y) // 8) % 2 else 0))
        filas += bytes(fila)

    def trozo(tipo, datos):
        c = tipo + datos
        return len(datos).to_bytes(4, 'big') + c + zlib.crc32(c).to_bytes(4, 'big')

    ihdr = ancho.to_bytes(4, 'big') + alto.to_bytes(4, 'big') + bytes([8, 0, 0, 0, 0])
    return (b'\x89PNG\r\n\x1a\n'
            + trozo(b'IHDR', ihdr)
            + trozo(b'IDAT', zlib.compress(filas))
            + trozo(b'IEND', b''))


IMAGEN_B64 = base64.b64encode(png_de_prueba()).decode()


class Agente(BaseHTTPRequestHandler):
    server_version = 'HuelleroMock/1.0'

    def _cors(self):
        origen = self.headers.get('Origin')
        if origen and origen in ORIGENES:
            self.send_header('Access-Control-Allow-Origin', origen)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '600')
        if self.headers.get('Access-Control-Request-Private-Network'):
            self.send_header('Access-Control-Allow-Private-Network', 'true')

    def _json(self, codigo, objeto):
        cuerpo = json.dumps(objeto).encode()
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(cuerpo)

    def _origen_ok(self):
        origen = self.headers.get('Origin')
        return (origen is None) or (origen in ORIGENES)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if not self._origen_ok():
            return self._json(403, {'error': 'origen-no-autorizado'})
        if self.path.split('?')[0] == '/ping':
            return self._json(200, {'ok': True, 'dispositivo': 'U.are.U 4500 (simulado)',
                                    'version': '3.0', 'motor': 'dpfpdd', 'sdk': True, 'reader': True})
        self._json(404, {'error': 'ruta-desconocida'})

    def do_POST(self):
        if not self._origen_ok():
            return self._json(403, {'error': 'origen-no-autorizado'})
        if self.path.split('?')[0] == '/capturar':
            return self._json(200, {'imagenBase64': IMAGEN_B64,
                                    'dispositivo': 'U.are.U 4500 (simulado)',
                                    'motor': 'dpfpdd', 'width': 357, 'height': 392,
                                    'dpi': 500, 'calidad': 0})
        self._json(404, {'error': 'ruta-desconocida'})

    def log_message(self, formato, *args):
        print('  %s' % (formato % args))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--puerto', type=int, default=52181)
    args = ap.parse_args()
    print(f'Agente FALSO de huella en http://127.0.0.1:{args.puerto}  (Ctrl+C para salir)')
    HTTPServer(('127.0.0.1', args.puerto), Agente).serve_forever()
