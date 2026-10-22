import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import Swal from 'sweetalert2';

import { OrdenesService } from '../../ordenes/ordenes.service';
import { VistaArchivoComponent } from '../../ordenes/vista-archivo.component';
import {
  ArchivoOrden, DetalleOrden, ETIQUETA_ESTADO, Ejecucion, Entregable, FlujoResumen, ICONO_PASO,
  MetadatosVersion, NOMBRE_PASO, Paso, TIPOS_EVIDENCIA, ejecucionActiva, etiquetaTipo, iconoTipo,
} from '../../ordenes/ordenes.models';

type TipoDialogo = 'generar' | 'version' | 'evidencia' | 'directa' | 'cambios' | 'rehacer' | 'insumo' | 'cancelar' | 'reabrir';

interface Dialogo {
  tipo: TipoDialogo;
  entregable?: Entregable;
  archivo?: ArchivoOrden;
  ejecucion?: Ejecucion;
}

/**
 * Una orden de servicio por dentro.
 *
 * <p>Cada entregable es una tarjeta con sus versiones (la ultima a la vista), lo que se
 * produjo por el camino (intermedios), su evidencia y la generacion en curso con sus pasos.
 * Iterar es siempre lo mismo: elegir una version, decir que cambiar y lanzar un flujo con
 * esa version como base — la nueva queda relacionada con la anterior.
 *
 * <p>Mientras haya una generacion activa la pantalla consulta cada 3 s; cuando cambia de
 * estado recarga el detalle entero (versiones nuevas, estados derivados).
 */
@Component({
  selector: 'app-mk-orden-detalle',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, VistaArchivoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orden-detalle.component.html',
  styleUrls: ['../../ordenes/ordenes-comun.css', './orden-detalle.component.css'],
})
export class OrdenDetalleComponent implements OnInit, OnDestroy {
  private readonly api = inject(OrdenesService);
  private readonly ruta = inject(ActivatedRoute);

  readonly etiqueta = ETIQUETA_ESTADO;
  readonly iconoTipo = iconoTipo;
  readonly etiquetaTipo = etiquetaTipo;
  readonly iconoPaso = ICONO_PASO;
  readonly nombrePaso = NOMBRE_PASO;
  readonly tiposEvidencia = TIPOS_EVIDENCIA;

  readonly id = signal('');
  readonly cargando = signal(true);
  readonly det = signal<DetalleOrden | null>(null);
  readonly flujos = signal<FlujoResumen[]>([]);
  readonly seleccion = signal<Record<string, string>>({});
  readonly fuenteDe = signal<string | null>(null);
  readonly pasoAbierto = signal<string | null>(null);
  readonly historialAbierto = signal<Record<string, boolean>>({});
  readonly dialogo = signal<Dialogo | null>(null);
  readonly enviando = signal(false);

  comentario = '';
  // campos de los dialogos
  flujoId = '';
  baseId: string | null = null;
  instrucciones = '';
  archivo: File | null = null;
  texto = '';
  descripcion = '';
  url = '';
  tipoEvidencia = 'PUBLICACION';
  evidenciaArchivo: File | null = null;
  evidenciaUrl = '';
  nota = '';
  desde: string | null = null;

  private sondeo: ReturnType<typeof setInterval> | null = null;
  private firma = '';

  readonly orden = computed(() => this.det()?.orden ?? null);
  readonly permisos = computed(() => this.det()?.permisos);

  /** Todos los archivos de la orden por id: para nombrar la base de una ejecucion o el resultado de un paso. */
  readonly archivos = computed(() => {
    const d = this.det();
    const m = new Map<string, ArchivoOrden>();
    if (!d) return m;
    for (const a of d.insumos) m.set(a.id, a);
    for (const a of d.evidencias_generales) m.set(a.id, a);
    for (const e of d.entregables) for (const a of [...e.versiones, ...e.intermedios, ...e.evidencias]) m.set(a.id, a);
    return m;
  });

  readonly hayActivas = computed(() => (this.det()?.ejecuciones ?? []).some(ejecucionActiva));

  ngOnInit(): void {
    this.id.set(this.ruta.snapshot.paramMap.get('id') ?? '');
    this.cargar();
    this.api.flujos().subscribe({ next: (f) => this.flujos.set(f), error: () => {} });
    this.sondeo = setInterval(() => this.consultar(), 3000);
  }

  ngOnDestroy(): void {
    if (this.sondeo) clearInterval(this.sondeo);
  }

  cargar(): void {
    this.api.detalle(this.id()).subscribe({
      next: (d) => { this.det.set(d); this.firma = this.firmaDe(d.ejecuciones); this.cargando.set(false); },
      error: (e) => {
        this.cargando.set(false);
        Swal.fire({ icon: 'error', title: e?.status === 404 ? 'La orden no existe o no tienes acceso' : 'No se pudo cargar la orden' });
      },
    });
  }

  /** Solo pide las ejecuciones; si alguna cambio de estado o de paso, recarga todo. */
  private consultar(): void {
    if (!this.hayActivas() || this.dialogo()) return;
    this.api.ejecuciones(this.id()).subscribe({
      next: (lista) => {
        const d = this.det();
        if (!d) return;
        const firma = this.firmaDe(lista);
        if (firma !== this.firma) this.cargar();
        else this.det.set({ ...d, ejecuciones: lista });
      },
      error: () => {},
    });
  }

  private firmaDe(lista: Ejecucion[]): string {
    return lista.map((e) => e.id + e.estado + e.pasos.map((p) => p.estado).join('')).join('|');
  }

  // ── lectura ───────────────────────────────────────────────────────────────

  ejecucionesDe(e: Entregable): Ejecucion[] {
    return (this.det()?.ejecuciones ?? []).filter((x) => x.entregable_id === e.id);
  }

  activaDe(e: Entregable): Ejecucion | null {
    return this.ejecucionesDe(e).find(ejecucionActiva) ?? null;
  }

  ultimaFallidaDe(e: Entregable): Ejecucion | null {
    const lista = this.ejecucionesDe(e);
    return lista.length && lista[0].estado === 'ERROR' ? lista[0] : null;
  }

  versionMostrada(e: Entregable): ArchivoOrden | null {
    const id = this.seleccion()[e.id];
    return e.versiones.find((v) => v.id === id) ?? e.versiones[e.versiones.length - 1] ?? null;
  }

  elegirVersion(e: Entregable, v: ArchivoOrden): void {
    this.seleccion.set({ ...this.seleccion(), [e.id]: v.id });
    this.fuenteDe.set(null);
  }

  meta(v: ArchivoOrden): MetadatosVersion {
    return (v.metadatos ?? {}) as MetadatosVersion;
  }

  modelosDe(v: ArchivoOrden): string {
    const pasos = this.meta(v).pasos ?? [];
    const m = [...new Set(pasos.filter((p) => p.modelo && p.proveedor !== 'RENDER').map((p) => p.modelo))];
    return m.join(' · ');
  }

  nombreArchivo(id: string | null): string {
    if (!id) return '';
    const a = this.archivos().get(id);
    if (!a) return 'archivo';
    return a.rol === 'VERSION' ? `versión ${a.numero}` : (a.nombre ?? 'archivo');
  }

  archivoDe(id: string | null): ArchivoOrden | null {
    return id ? this.archivos().get(id) ?? null : null;
  }

  resumenSalida(p: Paso): string | null {
    const s = p.salida;
    if (!s) return null;
    if (typeof s['texto'] === 'string') return (s['texto'] as string).slice(0, 500);
    if (s['json']) return JSON.stringify(s['json'], null, 2).slice(0, 800);
    if (typeof s['html'] === 'string') return `HTML de ${(s['html'] as string).length.toLocaleString()} caracteres`;
    if (s['paginas']) return `${s['paginas']} páginas`;
    if (typeof s['mensaje'] === 'string') return s['mensaje'] as string;
    return null;
  }

  json(v: unknown): string {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  espec(e: Entregable): string {
    const s = e.especificacion;
    if (!s) return '';
    return Object.entries(s).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ');
  }

  flujosPara(e: Entregable): FlujoResumen[] {
    return [...this.flujos()].sort((a, b) =>
      Number(b.tipo_entregable === e.tipo) - Number(a.tipo_entregable === e.tipo) || a.orden - b.orden);
  }

  flujo(): FlujoResumen | null { return this.flujos().find((f) => f.id === this.flujoId) ?? null; }

  /** Archivos que pueden ser base del flujo elegido, segun lo que acepta. */
  basesPara(f: FlujoResumen | null): ArchivoOrden[] {
    const d = this.det();
    if (!d || !f) return [];
    const todos = [...this.archivos().values()].filter((a) => a.rol !== 'EVIDENCIA' && (a.tiene_contenido));
    const mime = (a: ArchivoOrden) => (a.mime || (a.texto ? 'text/plain' : '')).split(';')[0];
    const ok = (a: ArchivoOrden) => {
      switch (f.entrada) {
        case 'IMAGEN': return mime(a).startsWith('image/');
        case 'VIDEO': return mime(a).startsWith('video/');
        case 'AUDIO': return mime(a).startsWith('audio/');
        case 'DOCUMENTO': return mime(a) === 'application/pdf' || mime(a).startsWith('text/') || mime(a) === 'application/json';
        default: return true;
      }
    };
    return todos.filter(ok).sort((a, b) => (b.creado_en || '').localeCompare(a.creado_en || ''));
  }

  etiquetaBase(a: ArchivoOrden): string {
    const ent = this.det()?.entregables.find((e) => e.id === a.entregable_id);
    const donde = ent ? ` · ${ent.titulo}` : '';
    if (a.rol === 'VERSION') return `Versión ${a.numero}${donde} (${a.mime ?? 'texto'})`;
    if (a.rol === 'INSUMO') return `Insumo: ${a.nombre}`;
    return `Intermedio: ${a.nombre}${donde}`;
  }

  // ── dialogos ──────────────────────────────────────────────────────────────

  abrir(tipo: TipoDialogo, extra: Omit<Dialogo, 'tipo'> = {}): void {
    this.instrucciones = ''; this.archivo = null; this.texto = ''; this.descripcion = ''; this.url = '';
    this.tipoEvidencia = 'PUBLICACION'; this.evidenciaArchivo = null; this.evidenciaUrl = ''; this.nota = '';
    this.desde = null; this.baseId = null; this.flujoId = '';
    if (tipo === 'generar' && extra.entregable) {
      const e = extra.entregable;
      const lista = this.flujosPara(e);
      if (extra.archivo) {
        // Iterar sobre un archivo: se propone un flujo que edite ese tipo, o el del entregable.
        this.baseId = extra.archivo.id;
        const mime = extra.archivo.mime || '';
        const editor = lista.find((f) => f.entrada === 'DOCUMENTO' && (mime === 'application/pdf' || mime.startsWith('text/')))
          ?? lista.find((f) => f.entrada === 'IMAGEN' && mime.startsWith('image/') && f.tipo_entregable === e.tipo)
          ?? lista.find((f) => f.tipo_entregable === e.tipo && f.entrada === 'NINGUNA');
        this.flujoId = editor?.id ?? lista[0]?.id ?? '';
        if (extra.archivo.revision === 'RECHAZADA' && extra.archivo.revision_nota) this.instrucciones = extra.archivo.revision_nota;
      } else {
        this.flujoId = (e.flujo_id && lista.some((f) => f.id === e.flujo_id) ? e.flujo_id : lista[0]?.id) ?? '';
      }
    }
    if (tipo === 'rehacer' && extra.ejecucion) {
      const p = extra.ejecucion.pasos.find((x) => x.estado === 'ESPERANDO_REVISION' || x.estado === 'ERROR');
      const previo = p ? extra.ejecucion.pasos.filter((x) => x.indice < p.indice && x.tipo !== 'REVISION').pop() : null;
      this.desde = previo?.clave ?? null;
      this.instrucciones = extra.ejecucion.instrucciones ?? '';
    }
    this.dialogo.set({ tipo, ...extra });
  }

  cerrar(): void { if (!this.enviando()) this.dialogo.set(null); }

  elegirArchivo(ev: Event, cual: 'archivo' | 'evidencia'): void {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    if (f && f.size > 100 * 1024 * 1024) {
      Swal.fire({ icon: 'warning', title: 'El archivo pasa de 100 MB' });
      (ev.target as HTMLInputElement).value = '';
      return;
    }
    if (cual === 'archivo') this.archivo = f; else this.evidenciaArchivo = f;
  }

  enviar(): void {
    const d = this.dialogo();
    if (!d) return;
    const id = this.id();
    const e = d.entregable;
    let llamada: Observable<unknown>;
    switch (d.tipo) {
      case 'generar':
        if (!this.flujoId) return this.avisar('Elige un flujo');
        if (this.flujo()?.entrada !== 'NINGUNA' && !this.baseId) return this.avisar('Este flujo edita un archivo: elige cuál');
        llamada = this.api.generar(id, e!.id, this.flujoId, this.baseId, this.instrucciones);
        break;
      case 'version':
        if (!this.archivo && !this.texto.trim()) return this.avisar('Sube un archivo o escribe el texto');
        llamada = this.api.version(id, e!.id, { archivo: this.archivo, texto: this.texto, descripcion: this.descripcion, padre_id: this.baseId });
        break;
      case 'evidencia':
        if (!this.archivo && !this.url.trim()) return this.avisar('Sube un archivo o pega el enlace');
        llamada = this.api.evidencia(id, e!.id, { archivo: this.archivo, url: this.url.trim(), tipo: this.tipoEvidencia, descripcion: this.descripcion });
        break;
      case 'directa':
        if (!this.archivo && !this.texto.trim()) return this.avisar('Sube el archivo final o escribe el texto');
        if (!this.evidenciaArchivo && !this.evidenciaUrl.trim()) return this.avisar('Falta la evidencia');
        llamada = this.api.entregaDirecta(id, e!.id, {
          archivo: this.archivo, texto: this.texto, descripcion: this.descripcion,
          evidencia: this.evidenciaArchivo, evidencia_url: this.evidenciaUrl.trim(), evidencia_tipo: this.tipoEvidencia,
        });
        break;
      case 'cambios':
        if (!this.nota.trim()) return this.avisar('Di qué hay que cambiar');
        llamada = this.api.revisar(id, d.archivo!.id, false, this.nota.trim());
        break;
      case 'rehacer':
        llamada = this.api.rehacer(d.ejecucion!.id, this.desde, this.instrucciones);
        break;
      case 'insumo':
        if (!this.archivo && !this.url.trim() && !this.texto.trim()) return this.avisar('Sube un archivo, pega un enlace o escribe un texto');
        llamada = this.api.insumo(id, { archivo: this.archivo, url: this.url.trim(), texto: this.texto, descripcion: this.descripcion,
          nombre: this.archivo ? undefined : (this.descripcion || undefined) });
        break;
      case 'cancelar':
        llamada = this.api.cancelar(id, this.nota.trim());
        break;
      case 'reabrir':
        if (!this.nota.trim()) return this.avisar('Di qué hay que cambiar');
        llamada = this.api.reabrir(id, e!.id, this.nota.trim());
        break;
    }
    this.enviando.set(true);
    llamada.subscribe({
      next: () => { this.enviando.set(false); this.dialogo.set(null); this.cargar(); },
      error: (err) => { this.enviando.set(false); this.mostrarError(err); },
    });
  }

  // ── acciones directas ─────────────────────────────────────────────────────

  aprobar(v: ArchivoOrden): void {
    this.api.revisar(this.id(), v.id, true).subscribe({ next: () => this.cargar(), error: (e) => this.mostrarError(e) });
  }

  entregar(e: Entregable): void {
    this.api.entregar(this.id(), e.id).subscribe({
      next: () => { this.cargar(); Swal.fire({ icon: 'success', title: 'Entregado', timer: 1400, showConfirmButton: false }); },
      error: (err) => this.mostrarError(err),
    });
  }

  continuar(ej: Ejecucion): void {
    this.api.continuar(ej.id).subscribe({ next: () => this.cargar(), error: (e) => this.mostrarError(e) });
  }

  async cancelarEjecucion(ej: Ejecucion): Promise<void> {
    const r = await Swal.fire({ icon: 'question', title: '¿Cancelar la generación?', text: 'Lo que ya se produjo queda guardado.',
      showCancelButton: true, confirmButtonText: 'Sí, cancelar', cancelButtonText: 'No' });
    if (!r.isConfirmed) return;
    this.api.cancelarEjecucion(ej.id).subscribe({ next: () => this.cargar(), error: (e) => this.mostrarError(e) });
  }

  tomar(): void {
    this.api.tomar(this.id()).subscribe({ next: () => this.cargar(), error: (e) => this.mostrarError(e) });
  }

  reactivar(): void {
    this.api.reactivar(this.id()).subscribe({ next: () => this.cargar(), error: (e) => this.mostrarError(e) });
  }

  async retirar(a: ArchivoOrden): Promise<void> {
    const r = await Swal.fire({ icon: 'warning', title: `¿Retirar «${a.nombre}»?`, showCancelButton: true,
      confirmButtonText: 'Retirar', cancelButtonText: 'No' });
    if (!r.isConfirmed) return;
    this.api.retirar(this.id(), a.id).subscribe({ next: () => this.cargar(), error: (e) => this.mostrarError(e) });
  }

  comentar(): void {
    const t = this.comentario.trim();
    if (!t) return;
    this.api.comentar(this.id(), t).subscribe({ next: () => { this.comentario = ''; this.cargar(); }, error: (e) => this.mostrarError(e) });
  }

  descargar(a: ArchivoOrden): void {
    this.api.contenido(this.id(), a.id).subscribe({
      next: (b) => {
        const u = URL.createObjectURL(b);
        const link = document.createElement('a');
        link.href = u;
        link.download = a.nombre || 'archivo';
        link.click();
        setTimeout(() => URL.revokeObjectURL(u), 2000);
      },
      error: (e) => this.mostrarError(e),
    });
  }

  alternarHistorial(e: Entregable): void {
    this.historialAbierto.set({ ...this.historialAbierto(), [e.id]: !this.historialAbierto()[e.id] });
  }

  private avisar(t: string): void { Swal.fire({ icon: 'warning', title: t }); }

  private mostrarError(e: { error?: { error?: string }; status?: number }): void {
    Swal.fire({ icon: 'error', title: 'No se pudo', text: e?.error?.error ?? (e?.status === 413 ? 'El archivo es demasiado grande.' : 'Intenta de nuevo.') });
  }
}
