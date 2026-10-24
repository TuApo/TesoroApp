/**
 * Lo nativo del dispositivo, sin plugins nuevos: en el APK (Capacitor 7) la WebView ya da
 * GPS, cámara, micrófono, vibración y red con las APIs estándar —los permisos
 * ACCESS_FINE_LOCATION, CAMERA y RECORD_AUDIO están en el AndroidManifest—, y si algún día se
 * instala @capacitor/geolocation o @capacitor/haptics se usan solos (se detectan en
 * `Capacitor.Plugins`), sin cambiar este código.
 */

import { Capacitor } from '@capacitor/core';

export interface Posicion { lat: number; lon: number; precision_m: number | null; capturado_ms: number; fuente: 'GPS' | 'RED' }

const plugins = (): Record<string, any> => ((Capacitor as any)?.Plugins ?? {}) as Record<string, any>;

export function plataforma(): string {
  try {
    const p = Capacitor.getPlatform();
    if (p !== 'web') return p;
  } catch { /* web */ }
  if (typeof window !== 'undefined' && (window as any).electron) return 'electron';
  return /Mobi|Android|iPhone/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent) ? 'web-movil' : 'web';
}

export function esNativo(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function descripcionDispositivo(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/) || ua.match(/(iPhone|iPad)/);
  return `${plataforma()} · ${m ? m[1].trim() : (ua.split(') ')[0] || '').slice(0, 80)}`.slice(0, 160);
}

/**
 * Posición actual. El GPS no necesita internet: funciona en modo avión. Primero alta
 * precisión (GPS); si no responde a tiempo, la de la red/wifi.
 */
export async function posicionActual(timeoutMs = 20_000): Promise<Posicion> {
  const geo = plugins()['Geolocation'];
  if (geo?.getCurrentPosition && esNativo()) {
    try {
      const p = await geo.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 });
      return { lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy ?? 0) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'GPS' };
    } catch { /* cae a la web */ }
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('Este dispositivo no tiene ubicación');
  const pedir = (alta: boolean, t: number) => new Promise<GeolocationPosition>((ok, mal) =>
    navigator.geolocation.getCurrentPosition(ok, mal, { enableHighAccuracy: alta, timeout: t, maximumAge: alta ? 15_000 : 120_000 }));
  try {
    const p = await pedir(true, timeoutMs);
    return { lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'GPS' };
  } catch (e: any) {
    if (e?.code === 1) throw new Error('Permiso de ubicación denegado. Actívalo en los ajustes del teléfono.');
    const p = await pedir(false, 10_000);
    return { lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'RED' };
  }
}

/** Sigue la posición mientras la pantalla esté abierta. Devuelve cómo dejar de seguirla. */
export function seguirPosicion(cb: (p: Posicion) => void, error?: (e: unknown) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return () => undefined;
  const id = navigator.geolocation.watchPosition(
    p => cb({ lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'GPS' }),
    e => error?.(e), { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 });
  return () => navigator.geolocation.clearWatch(id);
}

export async function bateria(): Promise<number | null> {
  try {
    const b = await (navigator as any).getBattery?.();
    return b ? Math.round(b.level * 100) : null;
  } catch { return null; }
}

/** Tipo de red: 'sin-red', 'wifi', '4g', '3g', '2g' o 'en-linea' cuando no se sabe más. */
export function red(): string {
  if (typeof navigator === 'undefined') return 'en-linea';
  if (!navigator.onLine) return 'sin-red';
  const c = (navigator as any).connection;
  if (c?.type === 'wifi') return 'wifi';
  return c?.effectiveType || 'en-linea';
}

export function vibrar(patron: number | number[] = 40): void {
  const h = plugins()['Haptics'];
  if (h?.vibrate && esNativo()) { h.vibrate({ duration: Array.isArray(patron) ? patron[0] : patron }).catch(() => undefined); return; }
  try { navigator.vibrate?.(patron); } catch { /* no vibra */ }
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** SHA-256 en hex (para validar la huella del QR sin señal). */
export async function sha256Hex(texto: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Distancia en metros (haversine), la misma cuenta que hace el servidor. */
export function distanciaM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_008.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function dentro(distancia: number, radioM: number, precisionM: number | null): boolean {
  const holgura = precisionM == null ? 0 : Math.min(Math.max(precisionM, 0), radioM / 2);
  return distancia <= radioM + holgura;
}

/** Lo que trae un QR de finca (`…/campo/qr?f=<id>&t=<token>`), o null. */
export function leerQr(texto: string | null | undefined): { fincaId: number; token: string } | null {
  if (!texto) return null;
  try {
    const u = new URL(texto.trim());
    if (!u.pathname.endsWith('/campo/qr')) return null;
    const f = Number(u.searchParams.get('f'));
    const t = u.searchParams.get('t');
    return Number.isFinite(f) && f > 0 && t ? { fincaId: f, token: t } : null;
  } catch { return null; }
}

/** Reduce una imagen a JPEG de máximo `max` px (las selfies viajan livianas por 3G). */
export async function aJpeg(fuente: HTMLCanvasElement | HTMLVideoElement | ImageBitmap, max = 900, calidad = 0.82, espejo = false): Promise<Blob> {
  const w = 'videoWidth' in fuente ? fuente.videoWidth : fuente.width;
  const h = 'videoHeight' in fuente ? fuente.videoHeight : fuente.height;
  const f = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * f);
  c.height = Math.round(h * f);
  const g = c.getContext('2d')!;
  if (espejo) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(fuente as CanvasImageSource, 0, 0, c.width, c.height);
  return new Promise((ok, mal) => c.toBlob(b => b ? ok(b) : mal(new Error('No se pudo comprimir')), 'image/jpeg', calidad));
}
