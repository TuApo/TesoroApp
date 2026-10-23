import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { CampoForm, abrirFormulario, confirmar } from '../../components/dialogos/formulario-dialogo';
import { abrirInfo } from '../../components/dialogos/info-dialogo';
import { PttBoton } from '../../components/ptt-boton/ptt-boton';
import {
  Agente, Audio, Camara, NOMBRE_TIPO_AUDIO, Parlante, Sede, TipoAudio, TipoParlante, Transcripcion, Voz,
} from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { SesionWebrtc, reproducirWhep } from '../../services/webrtc.util';
import { cronometro, fechaHora, hace, hora } from '../../utils/formato';

const TIPOS_AUDIO: TipoAudio[] = ['LOCUCION', 'EFECTO', 'FONDO', 'SUBIDO', 'MEZCLA'];
const NOMBRE_TIPO_PARLANTE: Record<TipoParlante, string> = { NAVEGADOR: 'Navegador (modo quiosco)', CAMARA: 'Cámara con parlante', AGENTE: 'Agente de sitio' };

/**
 * Audio y parlantes: los parlantes de las sedes con su estado en vivo, la biblioteca de audios,
 * el creador de locuciones con IA (voz + efecto + fondo), reproducir en un parlante, hablar
 * por él (PTT), escuchar el micrófono de la sede y leer lo que se transcribió.
 */
@Component({
  selector: 'app-seguridad-audio',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, PttBoton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audio.html',
  styleUrls: ['../../styles/seguridad-comun.css', './audio.css'],
})
export class SeguridadAudio {
  private readonly api = inject(SeguridadService);
  readonly vivo = inject(SeguridadVivoService);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);

  readonly sedes = signal<Sede[]>([]);
  readonly camaras = signal<Camara[]>([]);
  readonly agentes = signal<Agente[]>([]);
  readonly parlantes = signal<Parlante[]>([]);
  readonly audios = signal<Audio[]>([]);
  readonly voces = signal<Voz[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly nombreTipoAudio = NOMBRE_TIPO_AUDIO;
  readonly nombreTipoParlante = NOMBRE_TIPO_PARLANTE;
  readonly tiposAudio = TIPOS_AUDIO;
  readonly f = { fechaHora, hace, hora, cronometro };

  // ── Biblioteca ───────────────────────────────────────────────────────────
  readonly filtroTipo = signal<TipoAudio | null>(null);
  readonly audiosFiltrados = computed(() => {
    const t = this.filtroTipo();
    return this.audios().filter((a) => !t || a.tipo === t);
  });
  readonly fondos = computed(() => this.audios().filter((a) => a.tipo === 'FONDO'));
  readonly sonando = signal<string | null>(null);
  private reproductor: HTMLAudioElement | null = null;
  private urlSonando: string | null = null;

  // ── Creador de locución ──────────────────────────────────────────────────
  texto = '';
  nombre = '';
  vozId: string | null = null;
  efectoPrompt = '';
  fondoId: string | null = null;
  readonly volumenFondo = signal(0.25);
  guardarEnBiblioteca = true;
  readonly generando = signal(false);
  readonly ultimoGenerado = signal<Audio | null>(null);
  readonly errorCreador = signal<string | null>(null);

  // Efecto suelto
  efectoNombre = '';
  efectoSolo = '';
  efectoDuracion: number | null = null;

  // ── Reproducir en parlante ───────────────────────────────────────────────
  readonly destinos = signal<Set<string>>(new Set());
  audioAEnviar: string | null = null;
  textoAEnviar = '';
  repetir = 1;
  readonly volumenEnvio = signal<number | null>(null);
  readonly enviando = signal(false);

  // ── Escuchar micrófono ───────────────────────────────────────────────────
  readonly salidaEscucha = viewChild<ElementRef<HTMLAudioElement>>('escucha');
  readonly escuchando = signal<string | null>(null);
  readonly conectandoEscucha = signal<string | null>(null);
  private sesionEscucha: SesionWebrtc | null = null;

  // ── Transcripciones ──────────────────────────────────────────────────────
  readonly transcDe = signal<Parlante | null>(null);
  readonly transcripciones = signal<Transcripcion[]>([]);
  readonly cargandoTransc = signal(false);

  constructor() {
    this.cargar();
    this.api.sedes().subscribe({ next: (s) => this.sedes.set(s), error: () => {} });
    this.api.camaras().subscribe({ next: (c) => this.camaras.set(c), error: () => {} });
    this.api.agentes().subscribe({ next: (a) => this.agentes.set(a), error: () => {} });
    this.api.voces().subscribe({ next: (v) => { this.voces.set(v); this.vozId ??= v[0]?.voice_id ?? null; }, error: () => {} });
    inject(DestroyRef).onDestroy(() => { this.pararPreescucha(); this.dejarDeEscuchar(); });
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.parlantes().subscribe({
      next: (p) => { this.parlantes.set([...p].sort((a, b) => `${a.sede_nombre} ${a.nombre}`.localeCompare(`${b.sede_nombre} ${b.nombre}`))); this.cargando.set(false); this.error.set(null); },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudieron leer los parlantes.')); },
    });
    this.cargarAudios();
  }

  cargarAudios(): void {
    this.api.audios().subscribe({
      next: (a) => this.audios.set([...a].sort((x, y) => (y.creado_en || '').localeCompare(x.creado_en || ''))),
      error: () => {},
    });
  }

  enLinea(p: Parlante): boolean { return this.vivo.parlantes().get(p.id)?.en_linea ?? p.en_linea; }

  // ── Parlantes: alta / edición ────────────────────────────────────────────
  private camposParlante(): CampoForm[] {
    return [
      { clave: 'sede_id', etiqueta: 'Sede', tipo: 'seleccion', requerido: true, opciones: this.sedes().map((s) => ({ valor: s.id, texto: s.nombre })) },
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, placeholder: 'Ej.: Parlante de la entrada' },
      { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', requerido: true,
        opciones: (Object.keys(NOMBRE_TIPO_PARLANTE) as TipoParlante[]).map((t) => ({ valor: t, texto: NOMBRE_TIPO_PARLANTE[t] })),
        ayuda: 'Navegador: cualquier PC o TV con el enlace del parlante abierto. Cámara: una cámara con audio bidireccional.' },
      { clave: 'camara_id', etiqueta: 'Cámara', tipo: 'seleccion', visible: (v) => v['tipo'] === 'CAMARA', requeridoSi: (v) => v['tipo'] === 'CAMARA',
        opciones: this.camaras().filter((c) => c.audio_bidireccional).map((c) => ({ valor: c.id, texto: `${c.sede_nombre} · ${c.nombre}` })) },
      { clave: 'agente_id', etiqueta: 'Agente de sitio', tipo: 'seleccion', visible: (v) => v['tipo'] === 'AGENTE', requeridoSi: (v) => v['tipo'] === 'AGENTE',
        opciones: this.agentes().map((a) => ({ valor: a.id, texto: `${a.nombre} · ${a.sede_nombre}` })) },
      { clave: 'volumen', etiqueta: 'Volumen', tipo: 'rango', min: 0, max: 100, paso: 5, ancho: true },
      { clave: 'microfono', etiqueta: 'Publicar el micrófono de la sede', tipo: 'booleano', ayuda: 'Permite escucharlo desde el centro.' },
      { clave: 'transcribir', etiqueta: 'Transcribir lo que se oye', tipo: 'booleano', visible: (v) => !!v['microfono'],
        ayuda: 'Las palabras clave ("auxilio", "robo"…) disparan una alarma.' },
      { clave: 'croquis_elemento_ref', etiqueta: 'Elemento del croquis', tipo: 'texto' },
      { clave: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
    ];
  }

  async editarParlante(p: Parlante | null): Promise<void> {
    const r = await abrirFormulario<Parlante>(this.dialog, {
      titulo: p ? `Editar ${p.nombre}` : 'Nuevo parlante', icono: 'speaker', campos: this.camposParlante(),
      valores: p ? { ...p } : { tipo: 'NAVEGADOR', volumen: 80, activo: true, sede_id: this.sedes()[0]?.id ?? null },
      guardar: (v) => this.api.guardarParlante(p?.id ?? null, v as Partial<Parlante>),
    });
    if (!r) return;
    this.acciones.aviso('Parlante guardado.');
    this.cargar();
    if (!p && (r as Parlante).id && (r as Parlante).tipo === 'NAVEGADOR') await this.enlace(r as Parlante);
  }

  async borrarParlante(p: Parlante): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: `Borrar ${p.nombre}`, peligro: true, boton: 'Borrar', texto: 'El enlace del parlante deja de funcionar.' });
    if (!ok) return;
    try { await firstValueFrom(this.api.borrarParlante(p.id)); this.acciones.aviso('Parlante borrado.'); this.cargar(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar.'), true); }
  }

  /** Genera (o regenera) el token del parlante y muestra el enlace del modo quiosco con su QR. */
  async enlace(p: Parlante): Promise<void> {
    if (p.url_publica && !(await confirmar(this.dialog, {
      titulo: 'Nuevo enlace del parlante', boton: 'Generar', icono: 'link',
      texto: 'Se genera un enlace nuevo y el anterior deja de funcionar: hay que abrir el nuevo en el equipo del parlante.',
    }))) return;
    try {
      const t = await firstValueFrom(this.api.tokenParlante(p.id));
      abrirInfo(this.dialog, {
        titulo: `Enlace de ${p.nombre}`, icono: 'speaker',
        descripcion: 'Abra este enlace en el equipo de la sede (PC, TV o tableta con parlantes) y déjelo a pantalla completa. La primera vez hay que tocar "Activar audio".',
        aviso: { tono: 'warn', texto: 'El enlace lleva la credencial del parlante: se muestra completo solo ahora. Quien lo tenga puede reproducir lo que el centro envíe.' },
        enlace: { texto: 'Abrir el parlante', url: t.url, icono: 'open_in_new' },
        qr: t.url,
        bloques: [{ etiqueta: 'Enlace', valor: t.url }, { etiqueta: 'Código', valor: t.codigo, grande: true }],
      });
      this.cargar();
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo generar el enlace.'), true); }
  }

  async detener(p: Parlante): Promise<void> {
    try { await firstValueFrom(this.api.detener(p.id)); this.acciones.aviso(`Se detuvo ${p.nombre}.`); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo detener.'), true); }
  }

  // ── Escuchar el micrófono de la sede ─────────────────────────────────────
  async escuchar(p: Parlante): Promise<void> {
    if (this.escuchando() === p.id) { this.dejarDeEscuchar(); return; }
    this.dejarDeEscuchar();
    this.conectandoEscucha.set(p.id);
    try {
      const s = await firstValueFrom(this.api.escuchar(p.id));
      if (!s.whep_url) throw new Error('El servidor no entregó la dirección del micrófono.');
      const ses = await reproducirWhep(s.whep_url, s.token, { video: false, audio: true, timeoutMs: 8000,
        alEstado: (e) => { if (e === 'failed' || e === 'closed') this.dejarDeEscuchar(); } });
      this.sesionEscucha = ses;
      const el = this.salidaEscucha()?.nativeElement;
      if (el) { el.srcObject = ses.stream; el.muted = false; await el.play().catch(() => {}); }
      this.escuchando.set(p.id);
    } catch (e) {
      this.acciones.aviso((e as { status?: number })?.status ? mensajeDeError(e, 'No se pudo abrir el micrófono.') : (e as Error)?.message || 'No se pudo abrir el micrófono.', true);
    } finally { this.conectandoEscucha.set(null); }
  }

  dejarDeEscuchar(): void {
    this.sesionEscucha?.cerrar();
    this.sesionEscucha = null;
    const el = this.salidaEscucha()?.nativeElement;
    if (el) el.srcObject = null;
    this.escuchando.set(null);
  }

  // ── Transcripciones ──────────────────────────────────────────────────────
  verTranscripciones(p: Parlante): void {
    this.transcDe.set(p);
    this.cargandoTransc.set(true);
    this.api.transcripciones(p.id, 100).subscribe({
      next: (t) => { this.transcripciones.set([...t].sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''))); this.cargandoTransc.set(false); },
      error: (e) => { this.cargandoTransc.set(false); this.transcripciones.set([]); this.acciones.aviso(mensajeDeError(e, 'No se pudieron leer las transcripciones.'), true); },
    });
  }

  // ── Biblioteca ───────────────────────────────────────────────────────────
  async preescuchar(a: Audio): Promise<void> {
    if (this.sonando() === a.id) { this.pararPreescucha(); return; }
    this.pararPreescucha();
    this.sonando.set(a.id);
    try {
      const b = await firstValueFrom(this.api.archivoAudio(a.id));
      if (this.sonando() !== a.id) return;
      this.urlSonando = URL.createObjectURL(b);
      this.reproductor = new window.Audio(this.urlSonando);
      this.reproductor.onended = () => this.pararPreescucha();
      await this.reproductor.play();
    } catch (e) {
      this.pararPreescucha();
      this.acciones.aviso(mensajeDeError(e, 'No se pudo reproducir el audio.'), true);
    }
  }

  pararPreescucha(): void {
    try { this.reproductor?.pause(); } catch { /* nada */ }
    this.reproductor = null;
    if (this.urlSonando) { URL.revokeObjectURL(this.urlSonando); this.urlSonando = null; }
    this.sonando.set(null);
  }

  async borrarAudio(a: Audio): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: `Borrar "${a.nombre}"`, peligro: true, boton: 'Borrar', texto: 'Los protocolos que lo usen dejarán de reproducirlo.' });
    if (!ok) return;
    try { await firstValueFrom(this.api.borrarAudio(a.id)); this.audios.update((l) => l.filter((x) => x.id !== a.id)); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar el audio.'), true); }
  }

  async subir(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!archivo.type.startsWith('audio/')) { this.acciones.aviso('El archivo debe ser de audio (MP3, WAV, OGG…).', true); return; }
    const r = await abrirFormulario<Audio>(this.dialog, {
      titulo: 'Subir audio', icono: 'upload', ancho: '480px', descripcion: archivo.name,
      campos: [
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, ancho: true },
        { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', requerido: true, ancho: true,
          opciones: (['SUBIDO', 'FONDO', 'EFECTO'] as TipoAudio[]).map((t) => ({ valor: t, texto: NOMBRE_TIPO_AUDIO[t] })),
          ayuda: 'Fondo: música o ambiente para mezclar bajo una locución.' },
      ],
      valores: { nombre: archivo.name.replace(/\.[^.]+$/, ''), tipo: 'SUBIDO' },
      guardar: (v) => this.api.subirAudio(archivo, v['nombre'], v['tipo']),
    });
    if (r) { this.acciones.aviso('Audio subido.'); this.cargarAudios(); }
  }

  // ── Creador ──────────────────────────────────────────────────────────────
  async generarLocucion(): Promise<void> {
    const texto = this.texto.trim();
    if (!texto) { this.errorCreador.set('Escriba lo que debe decir la voz.'); return; }
    this.generando.set(true);
    this.errorCreador.set(null);
    try {
      const a = await firstValueFrom(this.api.locucion({
        nombre: this.nombre.trim() || texto.slice(0, 48), texto, voz_id: this.vozId, efecto_prompt: this.efectoPrompt.trim() || null,
        fondo_audio_id: this.fondoId, volumen_fondo: this.fondoId ? this.volumenFondo() : undefined, guardar: this.guardarEnBiblioteca,
      }));
      this.ultimoGenerado.set(a);
      if (this.guardarEnBiblioteca) this.cargarAudios();
      await this.preescuchar(a);
    } catch (e) { this.errorCreador.set(mensajeDeError(e, 'No se pudo generar la locución.')); }
    finally { this.generando.set(false); }
  }

  async generarEfecto(): Promise<void> {
    const prompt = this.efectoSolo.trim();
    if (!prompt) { this.errorCreador.set('Describa el efecto (en inglés funciona mejor: "loud police siren").'); return; }
    this.generando.set(true);
    this.errorCreador.set(null);
    try {
      const a = await firstValueFrom(this.api.efecto({ nombre: this.efectoNombre.trim() || prompt.slice(0, 48), prompt, duracion_seg: this.efectoDuracion || null }));
      this.ultimoGenerado.set(a);
      this.cargarAudios();
      await this.preescuchar(a);
    } catch (e) { this.errorCreador.set(mensajeDeError(e, 'No se pudo generar el efecto.')); }
    finally { this.generando.set(false); }
  }

  usarEnEnvio(a: Audio): void { this.audioAEnviar = a.id; this.textoAEnviar = ''; this.acciones.aviso(`"${a.nombre}" listo para enviar: elija los parlantes abajo.`); }

  // ── Enviar a parlantes ───────────────────────────────────────────────────
  alternarDestino(id: string): void {
    this.destinos.update((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  }

  async enviar(): Promise<void> {
    const ids = [...this.destinos()];
    if (!ids.length) { this.acciones.aviso('Elija al menos un parlante.', true); return; }
    const texto = this.textoAEnviar.trim();
    if (!this.audioAEnviar && !texto) { this.acciones.aviso('Elija un audio de la biblioteca o escriba un texto.', true); return; }
    this.enviando.set(true);
    let ok = 0;
    const fallos: string[] = [];
    for (const id of ids) {
      const p = this.parlantes().find((x) => x.id === id);
      try {
        const r = await firstValueFrom(this.api.reproducir(id, {
          ...(this.audioAEnviar && !texto ? { audio_id: this.audioAEnviar } : { texto, voz_id: this.vozId }),
          repetir: Math.max(1, Number(this.repetir) || 1), volumen: this.volumenEnvio() ?? undefined,
        }));
        if (r.ok) ok++; else fallos.push(`${p?.nombre ?? id}: ${r.mensaje}`);
      } catch (e) { fallos.push(`${p?.nombre ?? id}: ${mensajeDeError(e, 'error')}`); }
    }
    this.enviando.set(false);
    this.acciones.aviso(fallos.length ? `Enviado a ${ok}. Sin éxito: ${fallos.join(' · ')}` : `Enviado a ${ok} parlante(s).`, fallos.length > 0);
  }
}
