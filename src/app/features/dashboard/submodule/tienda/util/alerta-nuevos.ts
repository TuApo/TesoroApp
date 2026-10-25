/**
 * Aviso de "llegó algo nuevo" para las pantallas de logística (cola de alistamiento y bolsa
 * de domicilios): un timbre corto sintetizado, vibración y, si la persona lo permitió, una
 * notificación del sistema cuando la pestaña no está a la vista.
 */
let ctx: AudioContext | null = null;

export function timbre(): void {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.16);
    }
  } catch { /* sin audio: solo vibra */ }
  navigator.vibrate?.([120, 80, 120]);
}

export function pedirPermisoAvisos(): void {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* opcional */ }
}

export function avisar(titulo: string, cuerpo: string): void {
  timbre();
  try {
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(titulo, { body: cuerpo, tag: 'tuapo-logistica', icon: '/favicon.ico' });
    }
  } catch { /* algunos navegadores móviles solo dejan notificar desde el service worker */ }
}

/** Abre un PDF (Blob) en una pestaña nueva; si el navegador lo bloquea, lo descarga. */
export function abrirPdf(pdf: Blob, nombre: string): void {
  const url = URL.createObjectURL(pdf);
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** "hace 12 min", "hace 2 h". */
export function hace(minutos: number | null | undefined): string {
  if (minutos == null || isNaN(+minutos)) return '';
  const m = Math.max(0, Math.round(+minutos));
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `hace ${h} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `hace ${Math.floor(h / 24)} d`;
}

/**
 * Las fechas de las consultas de logística salen de MySQL en UTC sin zona
 * ("2026-10-15T16:05:37"); sin la Z el navegador las leería como hora de Bogotá.
 */
export function utc(s: string | null | undefined): string | null {
  if (!s) return null;
  return /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
}

export function minutosDesde(s: string | null | undefined): number | null {
  const t = Date.parse(utc(s) ?? '');
  return isNaN(t) ? null : (Date.now() - t) / 60_000;
}
