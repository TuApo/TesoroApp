/**
 * Cliente SSE sobre `fetch`.
 *
 * <p>POR QUÉ NO `EventSource`: no admite cabeceras, y el JWT de esta plataforma viaja en
 * `Authorization`. Meter el token en la URL lo dejaría en el historial del navegador, en
 * los logs de Caddy y del gateway, y en cualquier captura de pantalla. Con `fetch` en
 * streaming el token va donde va siempre y el canal sigue siendo HTTP normal.
 *
 * <p>RECONEXIÓN: el servidor cierra el canal a los 30 minutos (timeout del emisor) y
 * Caddy puede cortarlo antes si la red parpadea. Aquí se reconecta solo, con espera
 * creciente hasta 30 s, y `onEstado` avisa para que la pantalla pinte "reconectando".
 * Los canales públicos (televisor, celular) pasan `token: null` y funcionan igual.
 */
export interface ConexionSse {
  cerrar(): void;
}

export interface OpcionesSse {
  /** Token con esquema (`Bearer …`) o null para la superficie pública. */
  token: string | null;
  onEvento: (nombre: string, datos: unknown) => void;
  onEstado?: (estado: 'conectando' | 'conectado' | 'reconectando' | 'cerrado') => void;
}

export function conectarSse(url: string, opciones: OpcionesSse): ConexionSse {
  let cerrado = false;
  let controlador: AbortController | null = null;
  let intento = 0;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const avisar = (e: 'conectando' | 'conectado' | 'reconectando' | 'cerrado') => opciones.onEstado?.(e);

  const programarReconexion = () => {
    if (cerrado) return;
    intento++;
    const espera = Math.min(30_000, 1_000 * Math.pow(2, Math.min(intento, 5)));
    avisar('reconectando');
    temporizador = setTimeout(abrir, espera);
  };

  const procesarBloque = (bloque: string) => {
    // Un bloque SSE: líneas "event:" y "data:" separadas por saltos; termina en línea vacía.
    let nombre = 'message';
    const datos: string[] = [];
    for (const linea of bloque.split(/\r?\n/)) {
      if (!linea || linea.startsWith(':')) continue;      // comentario / latido
      const idx = linea.indexOf(':');
      const campo = idx < 0 ? linea : linea.slice(0, idx);
      const valor = idx < 0 ? '' : linea.slice(idx + 1).replace(/^ /, '');
      if (campo === 'event') nombre = valor;
      else if (campo === 'data') datos.push(valor);
    }
    if (!datos.length) return;
    const crudo = datos.join('\n');
    let parseado: unknown = crudo;
    try { parseado = JSON.parse(crudo); } catch { /* texto plano */ }
    opciones.onEvento(nombre, parseado);
  };

  const abrir = async () => {
    if (cerrado) return;
    controlador = new AbortController();
    avisar(intento === 0 ? 'conectando' : 'reconectando');
    try {
      const cabeceras: Record<string, string> = { Accept: 'text/event-stream' };
      if (opciones.token) cabeceras['Authorization'] = opciones.token;
      const respuesta = await fetch(url, { headers: cabeceras, signal: controlador.signal, cache: 'no-store' });
      if (!respuesta.ok || !respuesta.body) throw new Error(`SSE ${respuesta.status}`);
      intento = 0;
      avisar('conectado');
      const lector = respuesta.body.getReader();
      const decodificador = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        buffer += decodificador.decode(value, { stream: true });
        let corte: number;
        while ((corte = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const bloque = buffer.slice(0, corte);
          buffer = buffer.slice(corte).replace(/^\r?\n\r?\n/, '');
          procesarBloque(bloque);
        }
      }
      // El servidor cerró (timeout normal): se vuelve a abrir enseguida.
      if (!cerrado) { intento = 0; programarReconexion(); }
    } catch (e) {
      if (cerrado) return;
      programarReconexion();
    }
  };

  abrir();

  return {
    cerrar() {
      cerrado = true;
      if (temporizador) clearTimeout(temporizador);
      try { controlador?.abort(); } catch { /* ya cerrado */ }
      avisar('cerrado');
    },
  };
}

/** El token tal como lo guarda el login, con el esquema que exige el backend. */
export function tokenActual(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    let raw = localStorage.getItem('token') || localStorage.getItem('Authorization');
    if (!raw) {
      const u = localStorage.getItem('user');
      if (u) {
        const user = JSON.parse(u);
        raw = user?.token || user?.jwt || user?.access_token || user?.accessToken || null;
      }
    }
    if (!raw) return null;
    return raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
  } catch {
    return null;
  }
}
