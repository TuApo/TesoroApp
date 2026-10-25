import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { SalaEnVivo } from './sala-en-vivo';

const REMOTO = Symbol('remoto');

function aBase64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function deBase64(b: string): Uint8Array {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export { aBase64, deBase64 };

/**
 * Un documento Yjs compartido por la sala de LiveKit (el código de un archivo, una pizarra).
 *
 * <p>Tres caminos, y los tres hacen falta:
 * <ul>
 *   <li><b>Cambios en vivo</b>: cada edición local sale como update por el tópico del
 *       documento; al llegar se aplica con origen REMOTO para no reenviarla.</li>
 *   <li><b>Quien entra tarde</b>: arranca con el estado guardado en el servidor (si lo hay) y
 *       pide a la sala lo que le falte mandando su vector de estado; responde UNA sola persona
 *       (quien dirige, o la de identidad menor), para no recibir N copias.</li>
 *   <li><b>Que no se pierda</b>: quien responde las sincronizaciones también guarda la foto
 *       completa en el servidor cada tanto (y al salir), vía `guardar`.</li>
 * </ul>
 * Yjs fusiona sin conflictos, así que recibir dos veces lo mismo o en otro orden no rompe nada.
 */
export class YjsSala {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private bajas: (() => void)[] = [];
  private sucio = false;
  private temporizador: ReturnType<typeof setInterval> | null = null;

  constructor(
    private sala: SalaEnVivo,
    private id: string,
    private opciones: {
      estadoInicial?: string | null;
      /** true = esta persona dirige: responde sincronizaciones y guarda. */
      responsable: () => boolean;
      guardar: (estadoBase64: string, doc: Y.Doc) => Promise<void>;
      usuario: { nombre: string; color: string };
    },
  ) {
    if (opciones.estadoInicial) {
      try { Y.applyUpdate(this.doc, deBase64(opciones.estadoInicial), REMOTO); } catch { /* estado ilegible: se empieza vacío */ }
    }
    this.awareness.setLocalStateField('user', { name: opciones.usuario.nombre, color: opciones.usuario.color, colorLight: opciones.usuario.color + '33' });

    this.doc.on('update', (u: Uint8Array, origen: unknown) => {
      this.sucio = true;
      if (origen === REMOTO) return;
      const b = aBase64(u);
      if (b.length > 12_000) this.sala.enviarTexto(`yjs-u:${this.id}`, b);
      else this.sala.enviar(`yjs:${this.id}`, { u: b });
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origen: unknown) => {
      if (origen === REMOTO) return;
      const cambiados = [...added, ...updated, ...removed];
      this.sala.enviar(`yjs-aw:${this.id}`, { a: aBase64(encodeAwarenessUpdate(this.awareness, cambiados)) }, { confiable: false });
    });

    this.bajas.push(
      this.sala.on(`yjs:${this.id}`, d => this.aplicar(d?.u)),
      this.sala.onTexto(`yjs-u:${this.id}`, t => this.aplicar(t)),
      this.sala.on(`yjs-aw:${this.id}`, d => {
        try { applyAwarenessUpdate(this.awareness, deBase64(d.a), REMOTO); } catch { /* ignorar */ }
      }),
      // Alguien pide sincronizarse: le respondo solo si me toca.
      this.sala.on(`yjs-sv:${this.id}`, (d, de) => {
        if (!de || !this.meToca()) return;
        const falta = Y.encodeStateAsUpdate(this.doc, deBase64(d.sv));
        this.sala.enviarTexto(`yjs-u:${this.id}`, aBase64(falta), [de]);
      }),
    );
    // Pido lo que me falte a la sala.
    this.sala.enviar(`yjs-sv:${this.id}`, { sv: aBase64(Y.encodeStateVector(this.doc)) });
    this.temporizador = setInterval(() => this.guardarSiToca(), 20_000);
  }

  private aplicar(b: string | undefined): void {
    if (!b) return;
    try { Y.applyUpdate(this.doc, deBase64(b), REMOTO); } catch { /* update ilegible */ }
  }

  /** Responde quien dirige; si nadie dirige (sala de equipo), la identidad menor de las conectadas. */
  private meToca(): boolean {
    if (this.opciones.responsable()) return true;
    const todas = [this.sala.identidad, ...this.sala.identidades()].sort();
    return todas[0] === this.sala.identidad;
  }

  async guardarSiToca(forzar = false): Promise<void> {
    if (!this.sucio && !forzar) return;
    if (!this.meToca()) return;
    this.sucio = false;
    try {
      await this.opciones.guardar(aBase64(Y.encodeStateAsUpdate(this.doc)), this.doc);
    } catch {
      this.sucio = true;
    }
  }

  async cerrar(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.guardarSiToca();
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'cierre');
    this.bajas.forEach(f => f());
    this.awareness.destroy();
    this.doc.destroy();
  }
}
