/**
 * Lo nativo del teléfono vía plugins de Capacitor 7, en UN solo lugar.
 *
 * En el APK cada función usa el plugin nativo (GPS del sistema, cámara del sistema, lector de
 * QR de ML Kit, archivos en la carpeta privada de la app, estado de red del sistema,
 * vibración, notificaciones locales). En el navegador y en Electron cae a la API web
 * equivalente, así la misma pantalla sirve en las tres plataformas.
 *
 * Los plugins se importan con `import()` dinámico: el bundle web no carga código nativo que
 * no va a usar y el primer render del login no paga por ellos.
 */

import { Capacitor } from '@capacitor/core';

export function esNativo(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function plataformaNativa(): 'android' | 'ios' | 'web' {
  try { return Capacitor.getPlatform() as 'android' | 'ios' | 'web'; } catch { return 'web'; }
}

// ─── Ubicación ──────────────────────────────────────────────────────────────

export interface PosicionNativa { lat: number; lon: number; precision_m: number | null; capturado_ms: number; fuente: 'GPS' | 'RED' }

export class UbicacionDenegada extends Error {}

/**
 * Posición actual. En el APK usa el GPS del sistema (funciona sin internet) y pide el permiso
 * con el diálogo nativo; si en alta precisión no responde a tiempo, acepta la de red.
 */
export async function posicionNativa(timeoutMs = 20_000): Promise<PosicionNativa> {
  if (esNativo()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    let permiso = await Geolocation.checkPermissions().catch(() => null);
    if (permiso?.location !== 'granted') permiso = await Geolocation.requestPermissions({ permissions: ['location'] }).catch(() => null);
    if (permiso && permiso.location === 'denied') throw new UbicacionDenegada('Permiso de ubicación denegado. Actívalo en Ajustes › Apps › Gestión Tesorería › Permisos.');
    try {
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 });
      return { lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'GPS' };
    } catch {
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 });
      return { lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'RED' };
    }
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('Este dispositivo no tiene ubicación');
  const pedir = (alta: boolean, t: number) => new Promise<GeolocationPosition>((ok, mal) =>
    navigator.geolocation.getCurrentPosition(ok, mal, { enableHighAccuracy: alta, timeout: t, maximumAge: alta ? 15_000 : 120_000 }));
  try {
    const p = await pedir(true, timeoutMs);
    return { lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'GPS' };
  } catch (e: any) {
    if (e?.code === 1) throw new UbicacionDenegada('Permiso de ubicación denegado. Actívalo en los ajustes del navegador.');
    const p = await pedir(false, 10_000);
    return { lat: p.coords.latitude, lon: p.coords.longitude, precision_m: Math.round(p.coords.accuracy) || null, capturado_ms: p.timestamp || Date.now(), fuente: 'RED' };
  }
}

// ─── Cámara y QR ────────────────────────────────────────────────────────────

/**
 * Foto con la cámara del sistema (APK). null = no es nativo (la pantalla usa su visor web) o
 * la persona canceló. Se devuelve JPEG ya reducido.
 */
export async function fotoNativa(opc: { frontal?: boolean; maxLado?: number; calidad?: number } = {}): Promise<Blob | null> {
  if (!esNativo()) return null;
  const { Camera, CameraResultType, CameraSource, CameraDirection } = await import('@capacitor/camera');
  try {
    const f = await Camera.getPhoto({
      source: CameraSource.Camera, resultType: CameraResultType.Uri, quality: opc.calidad ?? 80,
      width: opc.maxLado ?? 1200, height: opc.maxLado ?? 1200, correctOrientation: true,
      direction: opc.frontal ? CameraDirection.Front : CameraDirection.Rear, saveToGallery: false,
    });
    if (!f.webPath) return null;
    return await (await fetch(f.webPath)).blob();
  } catch (e: any) {
    if (/cancel/i.test(String(e?.message ?? e))) return null;
    throw e;
  }
}

/**
 * Lee un QR con el lector nativo de ML Kit (pantalla completa del sistema). null = no es
 * nativo o no hay lector (la pantalla usa su visor web) o la persona canceló.
 */
export async function leerQrNativo(): Promise<string | null | undefined> {
  if (!esNativo()) return undefined;
  try {
    const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
    const { supported } = await BarcodeScanner.isSupported();
    if (!supported) return undefined;
    const perm = await BarcodeScanner.requestPermissions();
    if (perm.camera !== 'granted' && perm.camera !== 'limited') throw new Error('Permiso de cámara denegado. Actívalo en los ajustes del teléfono.');
    const r = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    return r.barcodes?.[0]?.rawValue ?? null;
  } catch (e: any) {
    if (/cancel/i.test(String(e?.message ?? e))) return null;
    if (/permiso/i.test(String(e?.message))) throw e;
    return undefined;
  }
}

// ─── Vibración, dispositivo, notificaciones ─────────────────────────────────

export function vibrarNativo(ms: number | number[] = 40): void {
  if (esNativo()) {
    void import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) =>
      Array.isArray(ms) ? Haptics.vibrate({ duration: ms[0] }) : Haptics.impact({ style: ms > 60 ? ImpactStyle.Heavy : ImpactStyle.Medium }))
      .catch(() => undefined);
    return;
  }
  try { navigator.vibrate?.(ms); } catch { /* no vibra */ }
}

export async function infoDispositivo(): Promise<{ descripcion: string; bateria: number | null }> {
  if (esNativo()) {
    try {
      const { Device } = await import('@capacitor/device');
      const [i, b] = await Promise.all([Device.getInfo(), Device.getBatteryInfo().catch(() => null)]);
      return {
        descripcion: `${i.platform} ${i.osVersion} · ${i.manufacturer} ${i.model}`.slice(0, 160),
        bateria: b?.batteryLevel != null ? Math.round(b.batteryLevel * 100) : null,
      };
    } catch { /* cae a web */ }
  }
  let bateria: number | null = null;
  try { const b = await (navigator as any).getBattery?.(); bateria = b ? Math.round(b.level * 100) : null; } catch { /* sin batería */ }
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return { descripcion: `web · ${(ua.split(') ')[0] || '').slice(0, 120)}`, bateria };
}

let permisoNotif: boolean | null = null;

/** Aviso local (bandeja del sistema en el APK). Silencioso si no hay permiso. */
export async function notificarLocal(titulo: string, cuerpo: string): Promise<void> {
  if (!esNativo()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (permisoNotif === null) {
      const p = await LocalNotifications.requestPermissions();
      permisoNotif = p.display === 'granted';
    }
    if (!permisoNotif) return;
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2_000_000_000), title: titulo, body: cuerpo }] });
  } catch { /* sin aviso */ }
}
