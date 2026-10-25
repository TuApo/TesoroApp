/**
 * Sonidos del chat y de las llamadas con WebAudio (sin archivos que descargar):
 * aviso de mensaje, timbre de llamada entrante, tono de "está sonando" y colgado.
 * Los navegadores exigen un gesto del usuario antes de sonar: el primer clic de la
 * sesión desbloquea el contexto (ver {@link desbloquear}).
 */
let ctx: AudioContext | null = null;

function contexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

export function desbloquear(): void {
  contexto();
}

function tono(frecuencias: number[], inicio: number, duracion: number, volumen = 0.07): void {
  const c = contexto();
  if (!c) return;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime + inicio);
  g.gain.exponentialRampToValueAtTime(volumen, c.currentTime + inicio + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + inicio + duracion);
  g.connect(c.destination);
  for (const f of frecuencias) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(c.currentTime + inicio);
    o.stop(c.currentTime + inicio + duracion + 0.05);
  }
}

/** "Pop" corto de mensaje nuevo. */
export function sonarMensaje(): void {
  tono([880], 0, 0.12, 0.06);
  tono([1320], 0.09, 0.14, 0.05);
}

export function sonarColgar(): void {
  tono([480], 0, 0.18, 0.06);
  tono([360], 0.2, 0.25, 0.06);
}

/** Bucle hasta que se llame a la función devuelta. */
function bucle(paso: () => void, cadaMs: number): () => void {
  paso();
  const t = setInterval(paso, cadaMs);
  return () => clearInterval(t);
}

/** Timbre de llamada entrante: doble repique cada 2,5 s. */
export function timbre(): () => void {
  return bucle(() => {
    tono([660, 880], 0, 0.35, 0.08);
    tono([660, 880], 0.45, 0.35, 0.08);
  }, 2500);
}

/** Lo que oye quien llama mientras suena del otro lado. */
export function tonoLlamando(): () => void {
  return bucle(() => tono([425], 0, 1.0, 0.04), 3000);
}
