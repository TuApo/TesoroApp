import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ArchivosNativos } from '../../../../../core/nativo/archivos-nativos';
import { CicloNativoService } from '../../../../../core/nativo/ciclo-nativo.service';
import { notificarLocal } from '../../../../../core/nativo/nativo';
import { NetworkStatusService } from '../../../../../core/services/network-status.service';
import { obtenerUsuarioActual } from '../../../../../core/utils/usuario-actual';
import { DocumentRef } from '../../../../../shared/components/forms/field.model';
import { FormStructure, SubmissionPayload } from '../models/dynamic-forms.models';
import { RouteResolution } from '../models/placement.models';
import { MediaOffloadService } from './media-offload.service';
import { SubmissionService } from './submission.service';

/** Una respuesta llenada sin señal, esperando en el teléfono. */
export interface EnvioPendiente {
  id: string;
  form_id: number;
  version_id: number;
  form_nombre: string;
  payload: SubmissionPayload;
  creado_ms: number;
  intentos: number;
  error?: string | null;
}

/** Lo que el teléfono recuerda de un formulario para abrirlo sin señal. */
interface FormularioGuardado { estructura: FormStructure; guardado_ms: number }

interface Indice {
  rutas: Record<string, RouteResolution>;
  formularios: Record<string, { nombre: string; guardado_ms: number }>;
}

/** Borrador local de un formulario (se guarda solo mientras se llena). */
export interface BorradorLocal { version_id: number; values: Record<string, Record<string, unknown>>; paso: number; guardado_ms: number }

/**
 * Formularios dinámicos SIN SEÑAL en el teléfono (APK) y en el navegador.
 *
 *  · Cada formulario que se abre con red (o que se descarga al «preparar» la jornada) deja en
 *    el teléfono su estructura y su ruta del menú: sin señal se abre igual.
 *  · Mientras se llena, lo escrito se guarda solo como borrador LOCAL (no se pierde si la app
 *    se cierra).
 *  · Sin señal, las fotos, firmas y archivos quedan como archivos de la app (carpeta privada,
 *    Filesystem nativo) y la respuesta entra a una cola con un id propio.
 *  · Al volver la señal: se suben los adjuntos a ms-documents, se reemplazan las referencias
 *    locales por las reales y se envía con `client_request_id` — un reenvío no duplica.
 *
 * Todo está separado por usuario (un teléfono compartido no mezcla respuestas).
 */
@Injectable({ providedIn: 'root' })
export class FormulariosOfflineService {
  private readonly submissions = inject(SubmissionService);
  private readonly media = inject(MediaOffloadService);
  private readonly ciclo = inject(CicloNativoService);
  private readonly red = inject(NetworkStatusService);

  readonly pendientes = signal<EnvioPendiente[]>([]);
  readonly sincronizando = signal(false);
  readonly conError = computed(() => this.pendientes().filter(p => p.error));
  readonly enLinea = computed(() => this.red.onlineStatus() && this.ciclo.conRed());

  private iniciado = false;
  private indice: Indice | null = null;
  /** local_id → URL de objeto, para previsualizar lo capturado sin señal. */
  private readonly urlsLocales = new Map<string, string>();

  private get usuario(): string { return obtenerUsuarioActual().id || 'anonimo'; }

  iniciar(): void {
    if (this.iniciado || typeof window === 'undefined') return;
    this.iniciado = true;
    this.ciclo.iniciar();
    void this.cargarPendientes();
    this.ciclo.momentoDeSincronizar$.subscribe(() => void this.sincronizar());
    this.red.isOnline$.subscribe(v => { if (v) void this.sincronizar(); });
    setInterval(() => { if (this.enLinea()) void this.sincronizar(); }, 90_000);
  }

  // ─── Estructuras y rutas guardadas ───────────────────────────────────────

  private async leerIndice(): Promise<Indice> {
    this.indice ??= (await ArchivosNativos.leerJson<Indice>(this.usuario, 'formularios/indice.json')) ?? { rutas: {}, formularios: {} };
    return this.indice;
  }

  async guardarRuta(ruta: string, r: RouteResolution): Promise<void> {
    const i = await this.leerIndice();
    i.rutas[ruta] = r;
    await ArchivosNativos.guardarJson(this.usuario, 'formularios/indice.json', i);
  }

  async rutaGuardada(ruta: string): Promise<RouteResolution | null> {
    return (await this.leerIndice()).rutas[ruta] ?? null;
  }

  async guardarEstructura(st: FormStructure): Promise<void> {
    const id = st.form_id ?? (st as any).form?.id;
    if (!id) return;
    await ArchivosNativos.guardarJson(this.usuario, `formularios/estructura-${id}.json`, { estructura: st, guardado_ms: Date.now() } satisfies FormularioGuardado);
    const i = await this.leerIndice();
    i.formularios[String(id)] = { nombre: st.form_name ?? `Formulario ${id}`, guardado_ms: Date.now() };
    await ArchivosNativos.guardarJson(this.usuario, 'formularios/indice.json', i);
  }

  async estructuraGuardada(formId: number): Promise<FormStructure | null> {
    return (await ArchivosNativos.leerJson<FormularioGuardado>(this.usuario, `formularios/estructura-${formId}.json`))?.estructura ?? null;
  }

  async formulariosGuardados(): Promise<{ id: number; nombre: string; guardado_ms: number }[]> {
    const i = await this.leerIndice();
    return Object.entries(i.formularios).map(([id, v]) => ({ id: Number(id), ...v }));
  }

  // ─── Borrador local ─────────────────────────────────────────────────────

  guardarBorrador(formId: number, b: BorradorLocal): Promise<void> {
    return ArchivosNativos.guardarJson(this.usuario, `formularios/borrador-${formId}.json`, b);
  }

  borrador(formId: number): Promise<BorradorLocal | null> {
    return ArchivosNativos.leerJson<BorradorLocal>(this.usuario, `formularios/borrador-${formId}.json`);
  }

  async borrarBorrador(formId: number): Promise<void> {
    await ArchivosNativos.borrar(this.usuario, `formularios/borrador-${formId}.json`);
  }

  // ─── Adjuntos capturados sin señal ──────────────────────────────────────

  /** Guarda el archivo en el teléfono y devuelve una referencia local (document_id negativo). */
  async adjuntoLocal(file: File): Promise<DocumentRef> {
    const local_id = crypto.randomUUID();
    await ArchivosNativos.guardar(this.usuario, `formularios/adjuntos/${local_id}`, file);
    await ArchivosNativos.guardarJson(this.usuario, `formularios/adjuntos/${local_id}.json`, { nombre: file.name, mime: file.type });
    this.urlsLocales.set(local_id, URL.createObjectURL(file));
    return {
      source: 'ms-documents', document_id: -Math.floor(Math.random() * 1e9) - 1, filename: file.name,
      mime_type: file.type || 'application/octet-stream', size: file.size, local_id,
    };
  }

  /** URL para ver un adjunto local (la foto recién tomada sin señal). */
  urlLocal(ref: DocumentRef): string | null {
    return ref.local_id ? this.urlsLocales.get(ref.local_id) ?? null : null;
  }

  // ─── Cola de envíos ─────────────────────────────────────────────────────

  private async cargarPendientes(): Promise<void> {
    this.pendientes.set((await ArchivosNativos.leerJson<EnvioPendiente[]>(this.usuario, 'formularios/pendientes.json')) ?? []);
  }

  private async guardarPendientes(l: EnvioPendiente[]): Promise<void> {
    this.pendientes.set(l);
    await ArchivosNativos.guardarJson(this.usuario, 'formularios/pendientes.json', l);
  }

  /** La respuesta queda en el teléfono; sale sola al volver la señal. */
  async encolar(st: FormStructure, payload: SubmissionPayload, id: string = crypto.randomUUID()): Promise<EnvioPendiente> {
    await this.cargarPendientes();
    const e: EnvioPendiente = {
      id, form_id: st.form_id, version_id: st.version.id, form_nombre: st.form_name ?? 'Formulario',
      payload, creado_ms: Date.now(), intentos: 0,
    };
    await this.guardarPendientes([...this.pendientes(), e]);
    if (this.enLinea()) void this.sincronizar();
    return e;
  }

  async descartar(id: string): Promise<void> {
    const e = this.pendientes().find(p => p.id === id);
    if (e) for (const ref of refsLocales(e.payload)) await this.borrarAdjunto(ref.local_id!);
    await this.guardarPendientes(this.pendientes().filter(p => p.id !== id));
  }

  async sincronizar(): Promise<number> {
    if (this.sincronizando() || !this.enLinea()) return 0;
    await this.cargarPendientes();
    if (!this.pendientes().length) return 0;
    this.sincronizando.set(true);
    let enviados = 0;
    try {
      for (const e of [...this.pendientes()]) {
        if (e.error && e.intentos >= 3) continue;
        const r = await this.enviarUno(e);
        if (r === 'ok') enviados++;
        if (r === 'sin-red') break;
      }
    } finally {
      this.sincronizando.set(false);
    }
    if (enviados) void notificarLocal('TuApo · formularios', `${enviados} formulario(s) llenados sin señal ya se enviaron.`);
    return enviados;
  }

  private async enviarUno(e: EnvioPendiente): Promise<'ok' | 'sin-red' | 'rechazado'> {
    try {
      // 1) Adjuntos del teléfono → ms-documents; la referencia local se cambia por la real.
      const payload = structuredClone(e.payload);
      for (const ref of refsLocales(payload)) {
        const blob = await ArchivosNativos.leer(this.usuario, `formularios/adjuntos/${ref.local_id}`);
        if (!blob) throw new Error(`Falta en el teléfono el archivo «${ref.filename}»`);
        const real = await firstValueFrom(this.media.upload(new File([blob], ref.filename, { type: ref.mime_type }), e.form_id));
        Object.assign(ref, real);
        delete ref.local_id;
      }
      // 2) La respuesta, con su id: si ya había llegado, el servidor devuelve la misma.
      await firstValueFrom(this.submissions.create(e.version_id, { status: 'SUBMITTED', payload, client_request_id: e.id }));
      for (const ref of refsLocales(e.payload)) await this.borrarAdjunto(ref.local_id!);
      await this.guardarPendientes(this.pendientes().filter(p => p.id !== e.id));
      return 'ok';
    } catch (err) {
      const st = (err as HttpErrorResponse)?.status ?? 0;
      if (st === 0 || st === 401 || st === 408 || st === 429 || st >= 500) return 'sin-red';
      const msg = (err as HttpErrorResponse)?.error?.detail || (err as HttpErrorResponse)?.error?.message
        || (err as Error)?.message || `Rechazado (${st})`;
      await this.guardarPendientes(this.pendientes().map(p => p.id === e.id ? { ...p, intentos: p.intentos + 1, error: String(msg).slice(0, 300) } : p));
      return 'rechazado';
    }
  }

  private async borrarAdjunto(localId: string): Promise<void> {
    await ArchivosNativos.borrar(this.usuario, `formularios/adjuntos/${localId}`);
    await ArchivosNativos.borrar(this.usuario, `formularios/adjuntos/${localId}.json`);
    const u = this.urlsLocales.get(localId);
    if (u) { URL.revokeObjectURL(u); this.urlsLocales.delete(localId); }
  }
}

/** Todas las referencias a archivos del teléfono dentro de un payload (en cualquier nivel). */
export function refsLocales(v: unknown, out: DocumentRef[] = []): DocumentRef[] {
  if (Array.isArray(v)) v.forEach(x => refsLocales(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['local_id'] === 'string' && o['source'] === 'ms-documents') out.push(o as unknown as DocumentRef);
    else Object.values(o).forEach(x => refsLocales(x, out));
  }
  return out;
}
