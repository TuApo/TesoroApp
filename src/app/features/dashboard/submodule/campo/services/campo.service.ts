import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { NetworkStatusService } from '../../../../../core/services/network-status.service';
import { obtenerUsuarioActual } from '../../../../../core/utils/usuario-actual';
import { ChatStoreService } from '../../comunicaciones/service/chat-store.service';
import {
  ElementoCola, Finca, FuenteUbicacion, Marcacion, MarcacionPendiente, Paquete, TipoMarcacion, Visita,
} from '../campo.models';
import { CampoApiService } from './campo-api.service';
import { CampoLocal } from './campo-local';
import {
  bateria, dentro, descripcionDispositivo, distanciaM, leerQr, plataforma, posicionActual, red, sha256Hex, uuid,
} from './dispositivo';

/** Resultado de validar un QR en el teléfono (también sin señal). */
export interface QrLocal { finca: Finca | null; valido: boolean; motivo: string | null }

/**
 * El estado del trabajo de campo en ESTE teléfono, pensado para funcionar sin señal:
 *
 *  · El paquete (fincas, agenda, tareas, canales) se guarda en IndexedDB y se refresca
 *    cuando hay red y cuando el servidor avisa (SSE `campo-agenda`).
 *  · Marcaciones, cierres de tarea y transmisiones de radio entran a una cola local con su
 *    hora real y se mandan en orden al volver la señal. El id lo pone el teléfono: un
 *    reenvío no duplica.
 *  · Con la app abierta manda su posición cada `intervalo_posicion_seg`; sin señal la
 *    guarda y la entrega toda junta después.
 *
 * Se inicia desde el inicio de Coordinadores y vive mientras dure la sesión.
 */
@Injectable({ providedIn: 'root' })
export class CampoService {
  private readonly api = inject(CampoApiService);
  private readonly red = inject(NetworkStatusService);
  private readonly chat = inject(ChatStoreService);

  readonly paquete = signal<Paquete | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly cola = signal<ElementoCola[]>([]);
  readonly puntosPendientes = signal(0);
  readonly sincronizando = signal(false);
  readonly ultimaSincronizacion = signal<number | null>(null);
  readonly ultimaPosicion = signal<{ lat: number; lon: number; precision_m: number | null; capturado_ms: number } | null>(null);
  readonly errorUbicacion = signal<string | null>(null);
  /**
   * Consentimiento del aviso de ubicación (política de datos de usuario de Google Play):
   * null = aún no ha respondido, true = acepta, false = no acepta. Sin un sí, la app no
   * toma ni manda la posición; la marcación sigue funcionando, sin ubicación.
   */
  readonly consentimientoUbicacion = signal<boolean | null>(leerConsentimiento());
  /** Marcaciones que llegaron al servidor en esta sesión (para ver su validación de rostro). */
  readonly recientes = signal<Marcacion[]>([]);

  readonly enLinea = computed(() => this.red.onlineStatus());
  readonly canalVivo = computed(() => this.chat.estadoCanal() === 'conectado');
  readonly perfil = computed(() => this.paquete()?.perfil ?? 'COORDINADOR');
  readonly supervisa = computed(() => this.perfil() !== 'COORDINADOR');
  readonly fincas = computed(() => this.paquete()?.fincas ?? []);
  readonly misFincas = computed(() => this.fincas().filter(f => f.mia));
  readonly marcacionAbierta = computed<MarcacionPendiente | Marcacion | null>(() => {
    // La última entrada sin salida: primero lo que espera en la cola, luego lo que dice el servidor.
    const enCola = [...this.cola()].reverse().find(e => e.tipo === 'marcacion');
    if (enCola && enCola.tipo === 'marcacion') return enCola.datos.tipo === 'ENTRADA' ? enCola.datos : null;
    return this.paquete()?.marcacion_abierta ?? null;
  });
  readonly agendaHoy = computed<Visita[]>(() => {
    const hoy = hoyIso();
    return (this.paquete()?.agenda ?? []).filter(v => v.fecha === hoy && v.estado !== 'CANCELADA');
  });
  readonly proximas = computed<Visita[]>(() => {
    const hoy = hoyIso();
    return (this.paquete()?.agenda ?? []).filter(v => v.fecha > hoy && v.estado === 'PROGRAMADA').slice(0, 8);
  });
  readonly tareasPendientes = computed(() => {
    const cerradasEnCola = new Set(this.cola().filter(e => e.tipo === 'tarea').map(e => e.tipo === 'tarea' ? e.datos.tarea_id : 0));
    return (this.paquete()?.tareas ?? []).filter(t => t.estado === 'PENDIENTE' && !cerradasEnCola.has(t.id));
  });

  /** Eventos de campo del canal en vivo (marcaciones, posiciones, radio) para las pantallas. */
  readonly eventos$ = new Subject<{ nombre: string; datos: any }>();

  private usuario = '';
  private iniciado = false;
  private relojPosicion: ReturnType<typeof setInterval> | null = null;
  private relojCola: ReturnType<typeof setInterval> | null = null;
  private preparado: Promise<void> = Promise.resolve();

  iniciar(): void {
    if (this.iniciado || typeof window === 'undefined') return;
    this.usuario = obtenerUsuarioActual().id;
    if (!this.usuario) return;
    this.iniciado = true;
    this.chat.iniciar();
    this.preparado = this.cargarLocal();
    void this.preparado.then(() => this.refrescar());
    this.chat.eventos$.pipe(filter(e => e.nombre.startsWith('campo-'))).subscribe(e => {
      this.eventos$.next(e);
      if (e.nombre === 'campo-agenda' || (e.nombre === 'campo-tarea' && e.datos?.asignado_a === this.usuario)) this.refrescar();
    });
    // Al volver la señal: primero la cola, después el paquete fresco.
    this.red.isOnline$.subscribe(enLinea => { if (enLinea) void this.sincronizar(); });
    this.relojCola = setInterval(() => { if (this.enLinea()) void this.sincronizar(); }, 60_000);
    window.addEventListener('online', () => void this.sincronizar());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { void this.reportarPosicion(); void this.sincronizar(); }
    });
    this.programarPosicion(120);
  }

  /** Resuelve cuando el paquete guardado en el teléfono ya está cargado (para validar un QR al abrir). */
  esperar(): Promise<void> { return this.preparado; }

  private programarPosicion(seg: number): void {
    if (this.relojPosicion) clearInterval(this.relojPosicion);
    this.relojPosicion = setInterval(() => { if (document.visibilityState === 'visible') void this.reportarPosicion(); },
      Math.max(30, seg) * 1000);
    setTimeout(() => void this.reportarPosicion(), 4000);
  }

  private async cargarLocal(): Promise<void> {
    const p = await CampoLocal.paquete(this.usuario);
    if (p && !this.paquete()) this.paquete.set(p);
    this.cola.set(await CampoLocal.cola(this.usuario));
    this.puntosPendientes.set(await CampoLocal.contarPuntos(this.usuario));
  }

  /** Paquete fresco del servidor (si no hay red, se queda el guardado). */
  async refrescar(): Promise<void> {
    if (!this.enLinea()) return;
    this.cargando.set(true);
    try {
      const p = await firstValueFrom(this.api.paquete());
      this.paquete.set(p);
      this.error.set(null);
      await CampoLocal.guardarPaquete(this.usuario, p);
      if (p.config?.intervalo_posicion_seg) this.programarPosicion(p.config.intervalo_posicion_seg);
    } catch (e) {
      if (!this.paquete()) this.error.set(mensajeDe(e, 'No se pudo cargar tu información de campo'));
    } finally {
      this.cargando.set(false);
    }
  }

  // ─── QR y marcación ─────────────────────────────────────────────────────

  /** Valida el QR contra el paquete guardado, sin red: finca conocida y huella del token. */
  async validarQr(texto: string): Promise<QrLocal> {
    const l = leerQr(texto);
    if (!l) return { finca: null, valido: false, motivo: 'Ese código no es un QR de finca de TuApo' };
    const finca = this.fincas().find(f => f.id === l.fincaId) ?? null;
    if (!finca) return { finca: null, valido: false, motivo: 'Finca desconocida en tu paquete: se validará al tener señal' };
    const h = (await sha256Hex(`${l.fincaId}|${l.token}`)).slice(0, 16);
    if (h !== finca.qr_huella) return { finca, valido: false, motivo: 'Este QR es viejo o no corresponde a la finca' };
    return { finca, valido: true, motivo: null };
  }

  /** Distancia del punto a la finca y si está dentro de su geocerca (cuenta local). */
  evaluar(finca: Finca | null, lat: number | null, lon: number | null, precision: number | null): { distancia: number | null; dentro: boolean | null } {
    if (!finca || finca.lat == null || finca.lon == null || lat == null || lon == null) return { distancia: null, dentro: null };
    const d = distanciaM(lat, lon, finca.lat, finca.lon);
    return { distancia: Math.round(d), dentro: dentro(d, finca.radio_m, precision) };
  }

  async marcar(o: {
    tipo: TipoMarcacion; finca: Finca | null; qr: string | null; qrOk: boolean | null;
    lat: number | null; lon: number | null; precision: number | null; fuente: FuenteUbicacion;
    selfie: Blob | null; nota: string | null; capturadoMs?: number;
  }): Promise<{ enviada: Marcacion | null; enCola: boolean }> {
    const ev = this.evaluar(o.finca, o.lat, o.lon, o.precision);
    const datos: MarcacionPendiente = {
      id: uuid(), finca_id: o.finca?.id ?? null, tipo: o.tipo, qr_contenido: o.qr, lat: o.lat, lon: o.lon,
      precision_m: o.precision, fuente_ubicacion: o.lat == null ? 'NINGUNA' : o.fuente, capturado_ms: o.capturadoMs ?? Date.now(),
      sin_conexion: !this.enLinea(), dispositivo: descripcionDispositivo(), bateria: await bateria(), nota: o.nota,
      finca_nombre: o.finca?.nombre ?? null, distancia_m: ev.distancia, dentro: ev.dentro, qr_ok_local: o.qrOk,
    };
    const e: ElementoCola = { id: datos.id, tipo: 'marcacion', creado_ms: Date.now(), intentos: 0, datos, selfie: o.selfie ?? undefined };
    // Primero a disco: si la app se cierra a mitad del envío, la marcación no se pierde.
    await CampoLocal.encolar(this.usuario, e);
    this.cola.update(l => [...l, e]);
    if (this.enLinea()) {
      const ok = await this.enviar(e);
      if (ok) return { enviada: this.recientes().find(m => m.id === datos.id) ?? null, enCola: false };
    }
    return { enviada: null, enCola: true };
  }

  async cerrarTarea(tareaId: number, estado: 'HECHA' | 'PENDIENTE', nota?: string | null): Promise<void> {
    const e: ElementoCola = { id: uuid(), tipo: 'tarea', creado_ms: Date.now(), intentos: 0,
      datos: { tarea_id: tareaId, estado, nota: nota ?? undefined, hecha_ms: Date.now() } };
    await CampoLocal.encolar(this.usuario, e);
    this.cola.update(l => [...l, e]);
    if (this.enLinea()) await this.enviar(e);
  }

  async encolarRadio(canalId: number, audio: Blob, duracionMs: number): Promise<boolean> {
    const e: ElementoCola = { id: uuid(), tipo: 'radio', creado_ms: Date.now(), intentos: 0,
      datos: { canal_id: canalId, duracion_ms: duracionMs, grabado_ms: Date.now() }, audio };
    await CampoLocal.encolar(this.usuario, e);
    this.cola.update(l => [...l, e]);
    return this.enLinea() ? this.enviar(e) : false;
  }

  async descartar(id: string): Promise<void> {
    await CampoLocal.quitar(id);
    this.cola.update(l => l.filter(x => x.id !== id));
  }

  /** Manda la cola en orden. Un error de red la deja para después; un rechazo del servidor queda marcado. */
  async sincronizar(): Promise<void> {
    if (!this.iniciado || this.sincronizando() || !this.enLinea()) return;
    this.sincronizando.set(true);
    try {
      for (const e of await CampoLocal.cola(this.usuario)) {
        if (e.error && e.intentos >= 3) continue;
        const ok = await this.enviar(e);
        if (!ok && !this.enLinea()) break;
      }
      await this.enviarPuntosGuardados();
      this.ultimaSincronizacion.set(Date.now());
    } finally {
      this.sincronizando.set(false);
      this.cola.set(await CampoLocal.cola(this.usuario));
    }
  }

  private async enviar(e: ElementoCola): Promise<boolean> {
    try {
      if (e.tipo === 'marcacion') {
        const m = await firstValueFrom(this.api.marcar(e.datos, e.selfie));
        this.recientes.update(l => [m, ...l.filter(x => x.id !== m.id)].slice(0, 30));
        if (m.tipo === 'ENTRADA' || m.tipo === 'SALIDA') void this.refrescar();
      } else if (e.tipo === 'tarea') {
        await firstValueFrom(this.api.estadoTarea(e.datos.tarea_id, e.datos.estado, e.datos.nota, e.datos.hecha_ms));
        this.paquete.update(p => p && ({ ...p, tareas: p.tareas.map(t => t.id === e.datos.tarea_id ? { ...t, estado: e.datos.estado as any } : t) }));
      } else {
        await firstValueFrom(this.api.transmitir(e.datos.canal_id, e.audio, e.id, e.datos.duracion_ms, e.datos.grabado_ms));
      }
      await CampoLocal.quitar(e.id);
      this.cola.update(l => l.filter(x => x.id !== e.id));
      return true;
    } catch (err) {
      const st = (err as HttpErrorResponse)?.status ?? 0;
      // 0/408/429/5xx = red o servidor ocupado: se reintenta sin marcar error.
      if (st === 0 || st === 408 || st === 429 || st >= 500 || st === 401) return false;
      const actualizado = { ...e, intentos: e.intentos + 1, error: mensajeDe(err, `Rechazado (${st})`) } as ElementoCola;
      await CampoLocal.actualizar(this.usuario, actualizado);
      this.cola.update(l => l.map(x => x.id === e.id ? actualizado : x));
      return false;
    }
  }

  // ─── Posición ───────────────────────────────────────────────────────────

  responderUbicacion(acepta: boolean): void {
    try { localStorage.setItem(CLAVE_CONSENTIMIENTO, acepta ? 'si' : 'no'); } catch { /* sin storage */ }
    this.consentimientoUbicacion.set(acepta);
    if (acepta) void this.reportarPosicion();
  }

  /** Toma la posición y la manda (o la guarda sin señal). Silenciosa: no pide permisos de golpe. */
  async reportarPosicion(): Promise<void> {
    if (!this.iniciado || this.consentimientoUbicacion() !== true) return;
    try {
      const perm = await (navigator as any).permissions?.query?.({ name: 'geolocation' }).catch(() => null);
      if (perm && perm.state === 'denied') { this.errorUbicacion.set('Ubicación bloqueada en este dispositivo'); return; }
      const p = await posicionActual(15_000);
      this.errorUbicacion.set(null);
      this.ultimaPosicion.set(p);
      const punto = { lat: p.lat, lon: p.lon, precision_m: p.precision_m, capturado_ms: p.capturado_ms };
      if (!this.enLinea()) {
        await CampoLocal.guardarPunto(this.usuario, { ...punto, sin_conexion: true });
        this.puntosPendientes.update(n => n + 1);
        return;
      }
      await this.enviarPuntosGuardados([punto]);
    } catch (e: any) {
      this.errorUbicacion.set(e?.message ?? 'Sin ubicación');
      if (this.enLinea()) {
        // Latido sin posición: igual dice que hay señal y cuánta batería queda.
        this.api.posiciones([], await bateria(), red(), plataforma()).subscribe({ error: () => undefined });
      }
    }
  }

  private async enviarPuntosGuardados(actuales: { lat: number; lon: number; precision_m: number | null; capturado_ms: number }[] = []): Promise<void> {
    const { claves, puntos } = await CampoLocal.puntos(this.usuario, 400);
    if (!puntos.length && !actuales.length) return;
    try {
      await firstValueFrom(this.api.posiciones([...puntos, ...actuales], await bateria(), red(), plataforma()));
      await CampoLocal.borrarPuntos(claves);
      this.puntosPendientes.set(await CampoLocal.contarPuntos(this.usuario));
    } catch {
      for (const a of actuales) await CampoLocal.guardarPunto(this.usuario, { ...a, sin_conexion: true });
      this.puntosPendientes.set(await CampoLocal.contarPuntos(this.usuario));
    }
  }
}

const CLAVE_CONSENTIMIENTO = 'tuapo.campo.ubicacion.consentimiento.v1';

function leerConsentimiento(): boolean | null {
  try {
    const v = localStorage.getItem(CLAVE_CONSENTIMIENTO);
    return v === 'si' ? true : v === 'no' ? false : null;
  } catch { return null; }
}

export function hoyIso(): string {
  // Fecha de Bogotá (los teléfonos del equipo están en Colombia; así no se corre de noche).
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

export function mensajeDe(e: unknown, respaldo: string): string {
  const h = e as HttpErrorResponse;
  const m = h?.error?.message || h?.error?.detail || h?.error?.error || (typeof h?.error === 'string' ? h.error : null);
  return typeof m === 'string' && m.length < 300 ? m : respaldo;
}

export function haceCuanto(ms: number | null | undefined): string {
  if (!ms) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function horaCorta(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
}

