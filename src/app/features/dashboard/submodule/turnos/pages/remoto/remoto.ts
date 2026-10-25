import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import {
  AnalisisConversacion, AtencionPersona, ClaveModulo, IceConfig, LecturaFormulario, PersonaContratacion, TemaConversacion, Turno, TurnoRemoto,
  TurnosService, Clasificacion,
} from '../../service/turnos.service';
import { Videollamada } from '../../service/videollamada';
import { TranscripcionEnVivo } from '../../service/transcripcion-en-vivo';
import { CierreTurno } from '../../components/cierre-turno/cierre-turno';
import { PanelTranscripcion } from '../../components/en-vivo/panel-transcripcion/panel-transcripcion';
import { TemasEnVivo } from '../../components/en-vivo/temas-en-vivo/temas-en-vivo';
import { Nombres, armarContextoExtra, armarFicha, buscarLineaDeCita, debeActualizarTemas, fusionarConversacion } from '../../components/en-vivo/en-vivo.util';
import { CapaVentanas } from '../../components/ventanas-flotantes/capa-ventanas';
import { GestorVentanas } from '../../components/ventanas-flotantes/gestor-ventanas';
import { CATALOGO_MODULOS, ORIGEN_APP, moduloPorClave, urlModulo } from '../../components/ventanas-flotantes/modulos';
import { AnalisisCandidato, AnalisisIaService } from '../../../hiring/service/analisis-ia/analisis-ia.service';
import { AsistenteIaComponent } from '../../../herramientas-ia/pages/asistente-ia/asistente-ia.component';
import { PermissionsService } from '../../../../../../core/services/permissions.service';
import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';

interface Verificacion { etiqueta: string; ok: boolean | null; detalle: string | null; }
interface OpcionProceso { etiqueta: string; icono: string; ayuda: string; accion: () => void; primaria?: boolean; }
export type PestanaLateral = 'temas' | 'persona' | 'chat';

const CLAVE_AUTO = 'tuapo.turnos.transcribir-auto';
/** Cada cuánto se mira si toca pedir temas (la regla fina está en debeActualizarTemas). */
const SONDEO_TEMAS_MS = 5_000;

/**
 * Atención remota: una oficina desocupada atiende por videollamada la entrevista, la
 * selección o la contratación de alguien que espera en otra oficina.
 *
 * <p>A la izquierda, lo que espera en cualquier oficina y se puede atender de lejos (se pliega
 * a una tira mientras se atiende). Al tomar un turno la sala de esa oficina lo canta y la
 * persona ve en su celular el botón para unirse. En el centro queda la videollamada y, debajo,
 * la TRANSCRIPCIÓN EN VIVO: quién dice qué (el canal lo sabe: micrófono propio = asesor,
 * audio de la llamada = persona) y el minuto. A la derecha, en pestañas: los TEMAS que salen
 * de lo conversado cruzado con la ficha, la PERSONA (validación, expediente, opciones del
 * proceso) y un CHAT IA que sabe de quién se habla y qué se ha dicho.
 *
 * <p>Si algo hay que hacerlo en un módulo (cambiar la forma de pago, subir un documento), se
 * abre como VENTANA FLOTANTE encima de la llamada: se mueve, se minimiza a pestaña y se vuelve
 * a poner grande, sin colgar. El turno queda marcado como remoto y con quién lo atendió.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-remoto',
  imports: [CommonModule, FormsModule, MatIconModule, MatMenuModule, CierreTurno, PanelTranscripcion, TemasEnVivo, CapaVentanas, AsistenteIaComponent],
  providers: [TranscripcionEnVivo, GestorVentanas],
  templateUrl: './remoto.html',
  styleUrls: ['../../styles/turnos-comun.css', './remoto.css'],
})
export class AtencionRemota implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private analisisIa = inject(AnalisisIaService);
  private router = inject(Router);
  private permisos = inject(PermissionsService);
  private destroyRef = inject(DestroyRef);
  readonly trans = inject(TranscripcionEnVivo);
  readonly ventanas = inject(GestorVentanas);
  private origen = inject(ORIGEN_APP);

  readonly cola = signal<TurnoRemoto[]>([]);
  readonly cargando = signal(false);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly soloOtras = signal(true);
  /** Mientras se atiende, la cola se pliega a una tira; esto la despliega encima. */
  readonly colaAbierta = signal(false);

  /** Mi turno remoto en curso (el que estoy atendiendo por videollamada). */
  readonly turno = computed<Turno | null>(() => { const t = this.ctx.turnoActual(); return t?.remoto ? t : null; });
  readonly persona = signal<PersonaContratacion | null>(null);
  readonly lectura = signal<LecturaFormulario | null>(null);
  readonly atenciones = signal<AtencionPersona[]>([]);
  readonly resumen = signal<AnalisisCandidato | null>(null);
  readonly analizando = signal(false);
  readonly errorIa = signal<string | null>(null);
  readonly llamada = signal<Videollamada | null>(null);
  readonly ice = signal<IceConfig | null>(null);
  readonly cerrandoCon = signal<'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO' | null>(null);
  motivoCierre = '';
  /** Catálogo de cómo terminó la atención: obligatorio (con nota) para finalizar. */
  readonly clasificaciones = signal<Clasificacion[]>([]);
  readonly ahora = this.ctx.ahora;

  // ── En vivo ──
  readonly pestana = signal<PestanaLateral>('temas');
  /** El chat se crea la primera vez que se abre y luego se conserva (no se pierde la conversación). */
  readonly chatVisto = signal(false);
  readonly transcribirAuto = signal(leerAuto());
  readonly analisis = signal<AnalisisConversacion | null>(null);
  readonly temasCargando = signal(false);
  readonly temasError = signal<string | null>(null);
  readonly resaltada = signal<string | null>(null);
  private ultimaSolicitudTemas: number | null = null;
  private lineasEnUltima = 0;
  /** Sugerencias que el asesor cerró: no se vuelven a proponer en este turno. */
  private descartadas = new Set<string>();

  readonly colaVisible = computed(() => this.soloOtras() ? this.cola().filter(c => !c.es_mi_oficina) : this.cola());
  readonly enMiOficina = computed(() => this.cola().filter(c => c.es_mi_oficina).length);

  readonly enLlamada = computed(() => this.llamada()?.estado() === 'conectada');
  readonly nombres = computed<Nombres>(() => {
    const t = this.turno();
    const p = this.persona();
    const asesor = (t?.atendido_por_nombre || obtenerUsuarioActual().nombreCompleto || '').trim();
    const np = p ? this.nombreDe(p) : '';
    return { ASESOR: asesor || 'Asesor', PERSONA: np && np !== 'Sin nombre' ? np : (t?.nombre?.trim() || 'Persona') };
  });
  readonly conversacion = computed(() => fusionarConversacion(this.trans.lineas(), this.trans.parciales()));
  /** Frases que la IA ya leyó (las siguientes cuentan como "nuevas" en Temas). */
  private readonly lineasVistasPorIa = signal(0);
  readonly frasesNuevas = computed(() => Math.max(0, this.trans.lineas().length - this.lineasVistasPorIa()));
  /** Lo que el chat IA sabe de la llamada (cola de la transcripción + temas), ≤ 3 800 caracteres. */
  readonly contextoChat = computed(() => armarContextoExtra({
    lineas: this.trans.lineas(), temas: this.analisis()?.temas ?? [], resumen: this.analisis()?.resumen ?? null, nombres: this.nombres(),
  }));
  /** Módulos del catálogo que este usuario puede abrir (según su árbol de permisos). */
  readonly modulosMenu = computed(() => CATALOGO_MODULOS.map(m => ({ ...m, permitido: this.permisos.canReadRoute(m.ruta) })));
  readonly permitidos = computed<ReadonlySet<string>>(() => new Set(this.modulosMenu().filter(m => m.permitido).map(m => m.clave)));

  /** La nota de cierre propuesta: lo conversado (si hay) y si no, el resumen del expediente. */
  readonly resumenParaNota = computed(() => {
    const conversado = this.analisis()?.resumen?.trim();
    if (conversado) return conversado.slice(0, 600);
    const r = this.resumen() as unknown as { resumen?: string | null; conclusion?: string | null; texto?: string | null } | null;
    const t = r?.resumen ?? r?.conclusion ?? r?.texto ?? '';
    return typeof t === 'string' ? t.slice(0, 600) : '';
  });

  readonly verificaciones = computed<Verificacion[]>(() => {
    const t = this.turno();
    if (!t) return [];
    const p = this.persona();
    const lf = this.lectura();
    const formOk = lf ? lf.listo : (t.formulario_listo ?? null);
    const formEti = lf ? lf.etiqueta : (t.formulario_etiqueta ?? null);
    return [
      { etiqueta: 'Cédula registrada', ok: !!t.documento, detalle: t.documento ? 'CC ' + t.documento : 'El turno no trae documento' },
      { etiqueta: 'Está en contratación', ok: !!p, detalle: p ? this.estadoPersona(p) : 'No aparece en contratación: regístrela desde el proceso de contratación' },
      { etiqueta: 'Formulario de vacantes', ok: formOk, detalle: formEti },
      { etiqueta: 'Contrato', ok: p ? !!p.contrato_activo : null, detalle: p ? (p.contrato_activo ? 'Activo' + (p.codigo_contrato ? ' · ' + p.codigo_contrato : '') : (p.contratado ? 'Contratado antes' : 'Sin contrato activo')) : null },
      { etiqueta: 'Documentos cargados', ok: p ? p.documentos > 0 : null, detalle: p ? `${p.documentos} en gestión documental` : null },
      { etiqueta: 'Vacante remitida', ok: p ? !!p.vacante_cargo : null, detalle: p?.vacante_cargo ? [p.vacante_cargo, p.vacante_empresa, p.vacante_finca].filter(Boolean).join(' · ') : (p ? 'Sin vacante' : null) },
    ];
  });

  /** Lo que se puede hacer con la persona según el trámite: abre el módulo en ventana flotante, sin colgar. */
  readonly opciones = computed<OpcionProceso[]>(() => {
    const t = this.turno();
    if (!t) return [];
    const doc = t.documento;
    const nombreSrv = (t.servicio_nombre || '').toLowerCase();
    const esSeleccion = /selec|entrevist/.test(nombreSrv);
    const esContratacion = /contrat|firma/.test(nombreSrv);
    const out: OpcionProceso[] = [];
    if (doc) {
      out.push({ etiqueta: 'Entrevista y ficha', icono: 'how_to_reg', ayuda: 'Abre el proceso de contratación de esta persona en una ventana encima de la llamada', primaria: esSeleccion || !esContratacion, accion: () => this.abrirModulo('pipeline', 'Entrevista y ficha') });
      out.push({ etiqueta: 'Contratación', icono: 'assignment_turned_in', ayuda: 'Pago y transporte, datos de obra, cédula y huella (en el proceso de contratación)', primaria: esContratacion, accion: () => this.abrirModulo('pipeline', 'Contratación') });
      out.push({ etiqueta: 'Documentos', icono: 'folder_copy', ayuda: 'El expediente de la persona en gestión documental', accion: () => this.abrirModulo('documentos') });
    } else {
      out.push({ etiqueta: 'Registrar en contratación', icono: 'person_add', ayuda: 'El turno no trae cédula: regístrela desde el proceso de contratación', primaria: true, accion: () => this.abrirModulo('pipeline', 'Registrar a la persona') });
    }
    if (t.formulario_url) out.push({ etiqueta: 'Formulario de vacantes', icono: 'edit_document', ayuda: 'El enlace público para que lo complete', accion: () => window.open(t.formulario_url!, '_blank', 'noopener') });
    return out;
  });

  private sondeo: ReturnType<typeof setInterval> | null = null;
  private sondeoTemas: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cada turno remoto nuevo trae su persona, su formulario, su historial y lo ya transcrito.
    effect(() => {
      const t = this.turno();
      untracked(() => this.alCambiarTurno(t));
    });
    this.ctx.videoSenal$.pipe(takeUntilDestroyed()).subscribe(s => {
      const t = this.turno();
      const l = this.llamada();
      if (t && l && (!s.turno_id || s.turno_id === t.id)) void l.recibir(s);
    });
    // La transcripción arranca sola cuando la llamada conecta (si el asesor no la apagó) y se
    // cierra al colgar o si la llamada se cae.
    effect(() => {
      const l = this.llamada();
      const estado = l?.estado();
      const auto = this.transcribirAuto();
      untracked(() => {
        if (!l || !this.turno()) return;
        if (estado === 'conectada' && auto && !this.trans.turnoId()) void this.iniciarTranscripcion();
        else if ((estado === 'terminada' || estado === 'error') && this.trans.turnoId()) void this.trans.detener();
      });
    });
    // Un tema que pide un módulo aparece como pestaña flotante minimizada (sin duplicar).
    effect(() => {
      const a = this.analisis();
      untracked(() => this.sugerirVentanas(a?.temas ?? []));
    });
    this.ventanas.cerradas$.pipe(takeUntilDestroyed()).subscribe(v => this.descartadas.add(v.id));
  }

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargarCola();
    this.sondeo = setInterval(() => this.cargarCola(), 15_000);
    this.sondeoTemas = setInterval(() => this.quizaActualizarTemas(), SONDEO_TEMAS_MS);
    this.destroyRef.onDestroy(() => {
      if (this.sondeo) clearInterval(this.sondeo);
      if (this.sondeoTemas) clearInterval(this.sondeoTemas);
      this.llamada()?.colgar();
      void this.trans.detener();
    });
  }

  private ultimoTurnoId: string | null = null;
  private alCambiarTurno(t: Turno | null): void {
    if (t?.id === this.ultimoTurnoId) return;
    this.ultimoTurnoId = t?.id ?? null;
    this.resumen.set(null);
    this.errorIa.set(null);
    this.persona.set(null);
    this.lectura.set(null);
    this.atenciones.set([]);
    this.trans.reiniciar();
    this.ventanas.cerrarTodas();
    this.analisis.set(null);
    this.temasError.set(null);
    this.resaltada.set(null);
    this.descartadas.clear();
    this.ultimaSolicitudTemas = null;
    this.lineasEnUltima = 0;
    this.lineasVistasPorIa.set(0);
    this.pestana.set('temas');
    this.chatVisto.set(false);
    this.colaAbierta.set(false);
    if (!t) { this.llamada()?.colgar(); this.llamada.set(null); return; }
    if (t.documento) {
      this.api.buscarPersonas(t.documento).subscribe({
        next: lista => this.persona.set(lista.find(p => (p.numero_documento || '').replace(/\./g, '') === t.documento!.replace(/\./g, '')) ?? lista[0] ?? null),
        error: () => this.persona.set(null),
      });
      this.api.formularioEstado(t.documento).subscribe({ next: l => this.lectura.set(l), error: () => {} });
      this.api.atencionesDePersona(t.documento).subscribe({ next: a => this.atenciones.set(a.filter(x => x.turno_id !== t.id)), error: () => {} });
    }
    // Lo ya transcrito de este turno (si se recargó la página o se volvió a llamar).
    void this.trans.cargar(t.id).then(r => {
      if (this.turno()?.id !== t.id || !r) return;
      if (r.analisis) this.analisis.set(r.analisis);
      this.lineasEnUltima = r.lineas?.length ?? 0;
      this.lineasVistasPorIa.set(r.analisis ? this.lineasEnUltima : 0);
    });
  }

  cargarCola(): void {
    this.cargando.set(true);
    this.api.colaRemota().subscribe({
      next: c => { this.cola.set(c); this.cargando.set(false); this.error.set(null); },
      error: e => { this.cargando.set(false); this.error.set(e?.status === 403 ? 'Su rol no atiende turnos de otras oficinas por videollamada' : 'No se pudo cargar la cola remota'); },
    });
  }

  tomar(c: TurnoRemoto): void {
    this.correr(this.api.tomarRemoto(c.turno.id), t => {
      this.ctx.aplicarTurno(t);
      this.ctx.refrescarEstado();
      this.aviso.set(`${t.codigo} llamado por videollamada: la sala de ${c.oficina_nombre || 'la oficina'} lo anunció y la persona verá el botón en su celular`);
      this.cargarCola();
    });
  }

  rellamar(): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.tomarRemoto(t.id), r => { this.ctx.aplicarTurno(r); this.aviso.set('Vuelto a llamar'); });
  }

  async iniciarLlamada(): Promise<void> {
    const t = this.turno();
    if (!t || this.llamada()) return;
    this.error.set(null);
    let ice = this.ice();
    if (!ice) {
      try { ice = await new Promise<IceConfig>((res, rej) => this.api.iceRemoto().subscribe({ next: res, error: rej })); this.ice.set(ice); }
      catch { ice = { ice_servers: [{ urls: ['stun:stun.l.google.com:19302'] }], tiene_turn: false }; }
    }
    const l = new Videollamada(ice.ice_servers, s => this.api.senalRemoto(t.id, s).subscribe({ error: () => {} }));
    this.llamada.set(l);
    await l.llamar();
  }

  colgar(): void {
    this.llamada()?.colgar();
    void this.trans.detener();
  }

  nuevaLlamada(): void {
    void this.trans.detener();
    this.llamada.set(null);
    void this.iniciarLlamada();
  }

  // ── Transcripción ──

  async iniciarTranscripcion(): Promise<void> {
    const t = this.turno();
    const l = this.llamada();
    if (!t || !l) return;
    await this.trans.iniciar(t.id, l.local(), l.remoto());
  }

  alternarAuto(valor: boolean): void {
    this.transcribirAuto.set(valor);
    try { setLocalStorageItem(CLAVE_AUTO, valor ? '1' : '0'); } catch { /* sin storage */ }
  }

  // ── Temas ──

  private quizaActualizarTemas(): void {
    const t = this.turno();
    if (!t || !this.trans.turnoId()) return;
    if (debeActualizarTemas({
      ahora: Date.now(), ultimaSolicitud: this.ultimaSolicitudTemas, lineasEnUltima: this.lineasEnUltima,
      lineasActuales: this.trans.lineas().length, enCurso: this.temasCargando(),
    })) void this.actualizarTemas();
  }

  /** Pide los temas con lo conversado hasta ahora (primero se asegura de que lo dicho quedó guardado). */
  async actualizarTemas(): Promise<void> {
    const t = this.turno();
    if (!t || this.temasCargando()) return;
    this.temasCargando.set(true);
    this.temasError.set(null);
    this.ultimaSolicitudTemas = Date.now();
    const lineas = this.trans.lineas().length;
    this.lineasEnUltima = lineas;
    await this.trans.vaciarGuardado();
    const ficha = armarFicha({
      turno: t, persona: this.persona(), lectura: this.lectura(), atenciones: this.atenciones(),
      resumenExpediente: (this.resumen() as unknown as { resumen?: string | null } | null)?.resumen ?? null,
    });
    this.api.temasDeConversacion(t.id, ficha).subscribe({
      next: r => {
        if (this.turno()?.id !== t.id) return;
        this.temasCargando.set(false);
        // Si la IA falló, el backend devuelve el último análisis bueno con `error`.
        if (r) this.analisis.set({ ...r, temas: r.temas ?? [] });
        this.temasError.set(r?.error ? r.error : null);
        this.lineasVistasPorIa.set(lineas);
      },
      error: e => {
        this.temasCargando.set(false);
        const cuerpo = e?.error as { error?: string; message?: string } | null;
        this.temasError.set(cuerpo?.error || cuerpo?.message || (e?.status === 503 ? 'El análisis de temas no está disponible ahora' : 'No se pudieron leer los temas; se reintenta con las próximas frases'));
      },
    });
  }

  private sugerirVentanas(temas: TemaConversacion[]): void {
    const t = this.turno();
    if (!t) return;
    for (const tema of temas) {
      const m = moduloPorClave(tema.modulo);
      if (!m || !this.permitidos().has(m.clave)) continue;
      const id = `${m.clave}|${(tema.clave ?? '').trim() || 'manual'}`;
      if (this.descartadas.has(id)) continue;
      this.ventanas.abrir(this.apertura(m.clave, tema.accion || tema.titulo, tema.clave), { minimizada: true });
    }
  }

  abrirModuloDeTema(tema: TemaConversacion): void {
    if (!tema.modulo) return;
    this.ventanas.abrir(this.apertura(tema.modulo, tema.accion || tema.titulo, tema.clave));
  }

  /** Abre un módulo del catálogo en ventana flotante (menú "Abrir módulo" y opciones del proceso). */
  abrirModulo(clave: ClaveModulo, subtitulo?: string | null): void {
    this.ventanas.abrir(this.apertura(clave, subtitulo ?? null, null));
  }

  private apertura(clave: ClaveModulo, subtitulo: string | null, temaClave: string | null) {
    const m = moduloPorClave(clave)!;
    const cedula = this.turno()?.documento ?? null;
    const base = this.origen;
    return {
      modulo: clave, temaClave, titulo: m.etiqueta, icono: m.icono,
      subtitulo: subtitulo || (this.nombres().PERSONA !== 'Persona' ? this.nombres().PERSONA : null),
      url: urlModulo(m, cedula, base, true), urlExterna: urlModulo(m, cedula, base, false),
    };
  }

  irACita(tema: TemaConversacion): void {
    const clave = buscarLineaDeCita(this.trans.lineas(), tema.cita, tema.at_ms);
    if (!clave) return;
    // Se limpia primero para que tocar dos veces la misma cita vuelva a llevar a ella.
    this.resaltada.set(null);
    setTimeout(() => this.resaltada.set(clave));
  }

  elegirPestana(p: PestanaLateral): void {
    this.pestana.set(p);
    if (p === 'chat') this.chatVisto.set(true);
  }

  /** Flechas izquierda/derecha entre pestañas (patrón de pestañas accesibles). */
  tecladoPestanas(ev: KeyboardEvent): void {
    const orden: PestanaLateral[] = ['temas', 'persona', 'chat'];
    const i = orden.indexOf(this.pestana());
    const j = ev.key === 'ArrowRight' ? (i + 1) % 3 : ev.key === 'ArrowLeft' ? (i + 2) % 3 : -1;
    if (j < 0) return;
    ev.preventDefault();
    this.elegirPestana(orden[j]);
    (ev.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-pestana="${orden[j]}"]`)?.focus();
  }

  /** Finalizar exige clasificación y nota: primero se abre el formulario y luego llega aquí con los dos datos. */
  finalizar(resultado: 'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO', cierre?: { clasificacion: string; nota: string }): void {
    const t = this.turno();
    if (!t) return;
    if (resultado === 'ATENDIDO' && !cierre) {
      if (!this.clasificaciones().length) this.api.clasificaciones().subscribe({ next: l => this.clasificaciones.set(l), error: () => {} });
      this.cerrandoCon.set('ATENDIDO');
      return;
    }
    this.correr(this.api.cerrarTurno(t.id, resultado, this.motivoCierre || null, cierre?.nota ?? null, cierre?.clasificacion ?? null), r => {
      this.llamada()?.colgar();
      this.llamada.set(null);
      void this.trans.detener();
      this.ventanas.cerrarTodas();
      this.cerrandoCon.set(null);
      this.motivoCierre = '';
      this.ctx.aplicarTurno(r);
      this.ctx.refrescarEstado();
      this.aviso.set(resultado === 'ATENDIDO' ? `${t.codigo} atendido por videollamada` : 'Turno cerrado');
      // Contratación también se entera de que se atendió (mismo endpoint que el pipeline).
      if (resultado === 'ATENDIDO' && t.documento) this.api.marcarAtendidoEnContratacion(t.documento).subscribe({ error: () => {} });
      this.cargarCola();
    });
  }

  /**
   * Abre el pipeline de la persona como un caso, en la pantalla completa. Salir de aquí cuelga
   * la videollamada, así que con la llamada en curso se pregunta antes (lo normal es la ventana).
   */
  abrirPipelineComoCaso(): void {
    const t = this.turno();
    if (this.llamada() && this.llamada()!.estado() !== 'terminada' && this.llamada()!.estado() !== 'error'
        && !confirm('Salir de Atención remota cuelga la videollamada. ¿Abrir el proceso de contratación como caso de todos modos?')) return;
    if (!t?.documento) { this.router.navigate(['/dashboard/hiring/recruitment-pipeline']); return; }
    const doc = t.documento;
    this.api.abrirCaso({
      turno_id: t.id, oficina_id: t.oficina_id, documento: doc, persona_nombre: t.nombre,
      motivo: 'Atención remota · ' + (t.servicio_nombre || ''), activar: true,
    }).subscribe({
      next: c => { this.ctx.aplicarCaso(c); this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: c.id } : p)); },
      error: () => {},
      complete: () => this.router.navigate(['/dashboard/hiring/recruitment-pipeline'], { queryParams: { cedula: doc } }),
    });
  }

  generarResumen(): void {
    const t = this.turno();
    if (!t?.documento) return;
    this.analizando.set(true);
    this.errorIa.set(null);
    this.analisisIa.analizar(t.documento, null).subscribe({
      next: r => { this.resumen.set(r); this.analizando.set(false); },
      error: e => { this.analizando.set(false); this.errorIa.set(e?.error?.message || 'La IA no pudo analizar el expediente ahora'); },
    });
  }

  // ── Texto ──

  estadoPersona(p: PersonaContratacion): string {
    if (p.contrato_activo) return 'Contrato activo' + (p.codigo_contrato ? ' · ' + p.codigo_contrato : '');
    if (p.contratado) return 'Contratado antes';
    if (p.proceso_id) return 'En proceso de contratación';
    return 'Registrada';
  }

  nombreDe(p: PersonaContratacion): string {
    return (p.nombre || [p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido].filter(Boolean).join(' ')).trim() || 'Sin nombre';
  }

  espera(seg: number): string {
    const m = Math.floor(seg / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  tiempoTurno(t: Turno): string {
    const desde = t.iniciado_en || t.llamado_en || t.creado_en;
    const seg = Math.max(0, Math.floor((this.ahora() - new Date(desde).getTime()) / 1000));
    return seg < 60 ? `${seg} s` : `${Math.floor(seg / 60)} min`;
  }

  estadoTexto(t: Turno): string {
    return ({ LLAMADO: 'Llamado · esperando a que se conecte', EN_ATENCION: 'En videollamada', ATENDIDO: 'Atendido' } as Record<string, string>)[t.estado] ?? t.estado;
  }

  estadoLlamada(l: Videollamada): string {
    return ({ conectada: 'Conectada', llamando: 'Llamando…', preparando: 'Preparando cámara…', error: 'Error', terminada: 'Terminada', lista: 'Lista' } as Record<string, string>)[l.estado()] ?? l.estado();
  }

  fecha(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private correr<T>(obs: Observable<T>, ok: (v: T) => void): void {
    this.ocupado.set(true);
    this.error.set(null);
    obs.subscribe({
      next: v => { this.ocupado.set(false); ok(v); setTimeout(() => this.aviso.set(null), 3500); },
      error: e => {
        this.ocupado.set(false);
        const err = (e as { error?: { message?: string; error?: string } })?.error;
        this.error.set(err?.message || err?.error || 'No se pudo completar la acción');
        setTimeout(() => this.error.set(null), 4000);
      },
    });
  }
}

function leerAuto(): boolean {
  try { return getLocalStorageItem(CLAVE_AUTO) !== '0'; } catch { return true; }
}
