import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { DetalleIncidente } from '../../components/detalle-incidente/detalle-incidente';
import { CampoForm, abrirFormulario, confirmar } from '../../components/dialogos/formulario-dialogo';
import { abrirInfo } from '../../components/dialogos/info-dialogo';
import { EditorProtocolo, pasosSugeridos } from '../../components/editor-protocolo/editor-protocolo';
import { SgImagen } from '../../components/imagen-segura/imagen-segura';
import { VisorCamara } from '../../components/visor-camara/visor-camara';
import {
  Ajustes, Audio, Camara, Canal, Contacto, Dispositivo, ESTADOS_ACTIVOS, EstadoIncidente, Evento, Incidente, NOMBRE_CANAL,
  NOMBRE_ESTADO_INCIDENTE, NOMBRE_ORIGEN, NOMBRE_SEVERIDAD, NOMBRE_TIPO_CONTACTO, Parlante, PasoProtocolo, Protocolo, SEVERIDADES, Sede,
  TipoContacto,
} from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { cronometro, fechaHora, hace, tonoSeveridad } from '../../utils/formato';

type Pestana = 'incidentes' | 'eventos' | 'contactos' | 'protocolos' | 'canales';
type FiltroEstado = 'activos' | 'todos' | 'CERRADO' | 'FALSA_ALARMA';
const TIPOS_CONTACTO: TipoContacto[] = ['INTERNO', 'VIGILANCIA', 'POLICIA', 'BOMBEROS', 'AMBULANCIA', 'OTRO'];
/** Canales que se pueden probar con un destino escrito. */
const CANALES_PRUEBA: Canal[] = ['TELEGRAM', 'EMAIL', 'WHATSAPP', 'LLAMADA', 'WEBHOOK', 'APP'];

interface ProtocoloBorrador { id: string | null; nombre: string; descripcion: string; repetir_ultimo: boolean; activo: boolean; pasos: PasoProtocolo[]; }

/**
 * Alertas y protocolos: el historial de alarmas (con la ficha completa de cada una), los
 * eventos crudos, los contactos (Telegram es el canal principal: se vinculan con un código
 * o un QR), los protocolos de escalamiento y la prueba de cada canal.
 */
@Component({
  selector: 'app-seguridad-alertas',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, DetalleIncidente, EditorProtocolo, SgImagen, VisorCamara, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alertas.html',
  styleUrls: ['../../styles/seguridad-comun.css', './alertas.css'],
})
export class SeguridadAlertas {
  private readonly api = inject(SeguridadService);
  readonly vivo = inject(SeguridadVivoService);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly pestana = signal<Pestana>('incidentes');

  readonly sedes = signal<Sede[]>([]);
  readonly camaras = signal<Camara[]>([]);
  readonly contactos = signal<Contacto[]>([]);
  readonly protocolos = signal<Protocolo[]>([]);
  readonly parlantes = signal<Parlante[]>([]);
  readonly dispositivos = signal<Dispositivo[]>([]);
  readonly audios = signal<Audio[]>([]);
  readonly ajustes = signal<Ajustes | null>(null);

  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly nombreEstado = NOMBRE_ESTADO_INCIDENTE;
  readonly nombreOrigen = NOMBRE_ORIGEN;
  readonly nombreTipoContacto = NOMBRE_TIPO_CONTACTO;
  readonly nombreCanal = NOMBRE_CANAL;
  readonly severidades = SEVERIDADES;
  readonly canalesPrueba = CANALES_PRUEBA;
  readonly f = { fechaHora, hace, cronometro, tonoSeveridad };

  // ── Incidentes ───────────────────────────────────────────────────────────
  readonly filtroEstado = signal<FiltroEstado>('activos');
  readonly filtroSede = signal<string | null>(null);
  readonly filtroSev = signal<string | null>(null);
  readonly incidentes = signal<Incidente[]>([]);
  readonly totalInc = signal(0);
  readonly paginaInc = signal(0);
  readonly porPaginaInc = signal(50);
  readonly cargandoInc = signal(false);
  readonly incidenteAbierto = signal<string | null>(null);

  readonly columnasInc: ColumnaTabla<Incidente>[] = [
    { id: 'captura', header: '', valor: () => '', ordenable: false, filtrable: false, copiable: false, ancho: '96px', tarjeta: 'oculto' },
    { id: 'titulo', header: 'Alarma', valor: (i) => i.titulo, tarjeta: 'titulo' },
    { id: 'severidad', header: 'Severidad', valor: (i) => NOMBRE_SEVERIDAD[i.severidad], tarjeta: 'badge',
      badge: (i) => ({ texto: NOMBRE_SEVERIDAD[i.severidad], tono: tonoSeveridad(i.severidad) }) },
    { id: 'estado', header: 'Estado', valor: (i) => NOMBRE_ESTADO_INCIDENTE[i.estado],
      badge: (i) => ({ texto: NOMBRE_ESTADO_INCIDENTE[i.estado], tono: i.estado === 'ABIERTO' || i.estado === 'NOTIFICANDO' ? 'danger' : ESTADOS_ACTIVOS.includes(i.estado) ? 'warn' : 'ok' }) },
    { id: 'sede', header: 'Sede', valor: (i) => i.sede_nombre, tarjeta: 'subtitulo' },
    { id: 'reconocido', header: 'Reconocida por', prioridad: 2, valor: (i) => i.reconocido_por_nombre ?? '',
      formato: (i) => (i.reconocido_por_nombre ? `${i.reconocido_por_nombre} · ${fechaHora(i.reconocido_en)}` : '—') },
    { id: 'tiempo', header: 'Tiempo a reconocer', align: 'right', prioridad: 3, valor: (i) => this.segReconocer(i) ?? '',
      formato: (i) => { const s = this.segReconocer(i); return s == null ? '—' : cronometro(s); } },
    { id: 'creado', header: 'Abierta', valor: (i) => i.creado_en, formato: (i) => fechaHora(i.creado_en), tarjeta: 'meta' },
  ];
  readonly idInc = (i: Incidente) => i.id;

  // ── Eventos ──────────────────────────────────────────────────────────────
  readonly evSede = signal<string | null>(null);
  readonly evCamara = signal<string | null>(null);
  readonly evTipo = signal('');
  readonly evSev = signal<string | null>(null);
  readonly evDesde = signal('');
  readonly evHasta = signal('');
  readonly eventos = signal<Evento[]>([]);
  readonly totalEv = signal(0);
  readonly paginaEv = signal(0);
  readonly porPaginaEv = signal(50);
  readonly cargandoEv = signal(false);
  readonly columnasEv: ColumnaTabla<Evento>[] = [
    { id: 'captura', header: '', valor: () => '', ordenable: false, filtrable: false, copiable: false, ancho: '96px', tarjeta: 'oculto' },
    { id: 'titulo', header: 'Evento', valor: (e) => e.titulo, tarjeta: 'titulo' },
    { id: 'severidad', header: 'Severidad', valor: (e) => NOMBRE_SEVERIDAD[e.severidad], tarjeta: 'badge',
      badge: (e) => ({ texto: NOMBRE_SEVERIDAD[e.severidad], tono: tonoSeveridad(e.severidad) }) },
    { id: 'origen', header: 'Origen', valor: (e) => NOMBRE_ORIGEN[e.origen] ?? e.origen, prioridad: 2 },
    { id: 'tipo', header: 'Tipo', valor: (e) => e.tipo, prioridad: 2 },
    { id: 'donde', header: 'Dónde', valor: (e) => [e.sede_nombre, e.camara_nombre, e.dispositivo_nombre].filter(Boolean).join(' · '), tarjeta: 'subtitulo' },
    { id: 'cuando', header: 'Cuándo', valor: (e) => e.ocurrido_en, formato: (e) => fechaHora(e.ocurrido_en), tarjeta: 'meta' },
  ];
  readonly idEv = (e: Evento) => e.id;
  readonly camarasEv = computed(() => this.camaras().filter((c) => !this.evSede() || c.sede_id === this.evSede()));

  // ── Contactos ────────────────────────────────────────────────────────────
  readonly cargandoContactos = signal(false);
  readonly columnasContactos: ColumnaTabla<Contacto>[] = [
    { id: 'nombre', header: 'Nombre', valor: (c) => c.nombre, tarjeta: 'titulo' },
    { id: 'tipo', header: 'Tipo', valor: (c) => NOMBRE_TIPO_CONTACTO[c.tipo], tarjeta: 'badge',
      badge: (c) => ({ texto: NOMBRE_TIPO_CONTACTO[c.tipo], tono: c.tipo === 'INTERNO' ? 'info' : c.tipo === 'POLICIA' ? 'violet' : 'neutro' }) },
    { id: 'telegram', header: 'Telegram', valor: (c) => (c.telegram_vinculado || c.telegram_chat ? 'Vinculado' : 'Sin vincular'),
      badge: (c) => (c.telegram_vinculado || c.telegram_chat ? { texto: 'Vinculado', tono: 'ok', icono: 'send' } : { texto: 'Sin vincular', tono: 'warn' }) },
    { id: 'telefono', header: 'Teléfono', valor: (c) => c.telefono ?? '', tarjeta: 'subtitulo' },
    { id: 'email', header: 'Correo', prioridad: 2, valor: (c) => c.email ?? '' },
    { id: 'whatsapp', header: 'WhatsApp', prioridad: 3, valor: (c) => c.whatsapp ?? '' },
    { id: 'sede', header: 'Sede', prioridad: 2, valor: (c) => this.sedes().find((s) => s.id === c.sede_id)?.nombre ?? 'Todas', tarjeta: 'meta' },
    { id: 'activo', header: 'Activo', prioridad: 3, valor: (c) => c.activo },
  ];
  readonly idContacto = (c: Contacto) => c.id;

  // ── Protocolos ───────────────────────────────────────────────────────────
  readonly editando = signal<ProtocoloBorrador | null>(null);
  readonly pasosEdit = signal<PasoProtocolo[]>([]);
  readonly guardandoProt = signal(false);
  readonly errorProt = signal<string | null>(null);

  // ── Canales ──────────────────────────────────────────────────────────────
  canalPrueba: Canal = 'TELEGRAM';
  destinoPrueba = '';
  readonly probando = signal(false);
  readonly resultadoPrueba = signal<{ ok: boolean; mensaje: string } | null>(null);

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    const p = q.get('tab') as Pestana | null;
    if (p && ['incidentes', 'eventos', 'contactos', 'protocolos', 'canales'].includes(p)) this.pestana.set(p);
    const inc = q.get('incidente');
    if (inc) this.incidenteAbierto.set(inc);

    this.api.sedes().subscribe({ next: (s) => this.sedes.set(s), error: () => {} });
    this.api.camaras().subscribe({ next: (c) => this.camaras.set(c), error: () => {} });
    this.api.ajustes().subscribe({ next: (a) => this.ajustes.set(a), error: () => {} });
    this.cargarContactos();
    this.cargarProtocolos();
    this.api.parlantes().subscribe({ next: (x) => this.parlantes.set(x), error: () => {} });
    this.api.dispositivos().subscribe({ next: (x) => this.dispositivos.set(x), error: () => {} });
    this.api.audios().subscribe({ next: (x) => this.audios.set(x), error: () => {} });
    this.cargarIncidentes();
    if (this.pestana() === 'eventos') this.cargarEventos();
  }

  ir(p: Pestana): void {
    this.pestana.set(p);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: p }, queryParamsHandling: 'merge', replaceUrl: true });
    if (p === 'eventos' && !this.eventos().length) this.cargarEventos();
    if (p === 'incidentes') this.cargarIncidentes();
  }

  // ── Incidentes ───────────────────────────────────────────────────────────
  segReconocer(i: Incidente): number | null {
    if (!i.reconocido_en) return null;
    return Math.max(0, (new Date(i.reconocido_en).getTime() - new Date(i.creado_en).getTime()) / 1000);
  }

  cargarIncidentes(): void {
    const e = this.filtroEstado();
    const estado = e === 'activos' ? ESTADOS_ACTIVOS.join(',') : e === 'todos' ? null : (e as EstadoIncidente);
    this.cargandoInc.set(true);
    this.api.incidentes({ estado, sede_id: this.filtroSede(), severidad: this.filtroSev(), limit: this.porPaginaInc(), offset: this.paginaInc() * this.porPaginaInc() }).subscribe({
      next: (p) => { this.incidentes.set(p.results ?? []); this.totalInc.set(p.count ?? 0); this.cargandoInc.set(false); },
      error: (err) => { this.cargandoInc.set(false); this.acciones.aviso(mensajeDeError(err, 'No se pudieron leer las alarmas.'), true); },
    });
  }
  filtrarIncidentes(): void { this.paginaInc.set(0); this.cargarIncidentes(); }
  paginarInc(e: { pagina: number; porPagina: number }): void { this.paginaInc.set(e.pagina); this.porPaginaInc.set(e.porPagina); this.cargarIncidentes(); }

  abrirIncidente(id: string): void {
    this.incidenteAbierto.set(id);
    this.router.navigate([], { relativeTo: this.route, queryParams: { incidente: id }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  cerrarDetalle(): void {
    this.incidenteAbierto.set(null);
    this.router.navigate([], { relativeTo: this.route, queryParams: { incidente: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (this.pestana() === 'incidentes') this.cargarIncidentes();
  }
  readonly camaraVista = signal<string | null>(null);
  readonly mapaCamaras = computed(() => new Map(this.camaras().map((c) => [c.id, c])));
  verCamara(id: string): void { this.camaraVista.set(id); }

  // ── Eventos ──────────────────────────────────────────────────────────────
  cargarEventos(): void {
    this.cargandoEv.set(true);
    this.api.eventos({
      sede_id: this.evSede(), camara_id: this.evCamara(), tipo: this.evTipo().trim() || null, severidad: this.evSev(),
      desde: this.evDesde() ? `${this.evDesde()}T00:00:00` : null, hasta: this.evHasta() ? `${this.evHasta()}T23:59:59` : null,
      limit: this.porPaginaEv(), offset: this.paginaEv() * this.porPaginaEv(),
    }).subscribe({
      next: (p) => { this.eventos.set(p.results ?? []); this.totalEv.set(p.count ?? 0); this.cargandoEv.set(false); },
      error: (e) => { this.cargandoEv.set(false); this.acciones.aviso(mensajeDeError(e, 'No se pudieron leer los eventos.'), true); },
    });
  }
  filtrarEventos(): void { this.paginaEv.set(0); this.cargarEventos(); }
  paginarEv(e: { pagina: number; porPagina: number }): void { this.paginaEv.set(e.pagina); this.porPaginaEv.set(e.porPagina); this.cargarEventos(); }
  clicEvento(e: Evento): void { if (e.incidente_id) this.abrirIncidente(e.incidente_id); }

  // ── Contactos ────────────────────────────────────────────────────────────
  cargarContactos(): void {
    this.cargandoContactos.set(true);
    this.api.contactos().subscribe({
      next: (c) => { this.contactos.set([...c].sort((a, b) => a.nombre.localeCompare(b.nombre))); this.cargandoContactos.set(false); },
      error: (e) => { this.cargandoContactos.set(false); this.acciones.aviso(mensajeDeError(e, 'No se pudieron leer los contactos.'), true); },
    });
  }

  private camposContacto(): CampoForm[] {
    return [
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, ancho: true },
      { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', requerido: true, opciones: TIPOS_CONTACTO.map((t) => ({ valor: t, texto: NOMBRE_TIPO_CONTACTO[t] })) },
      { clave: 'sede_id', etiqueta: 'Sede', tipo: 'seleccion', ayuda: 'Vacío = recibe alarmas de todas las sedes.',
        opciones: this.sedes().map((s) => ({ valor: s.id, texto: s.nombre })) },
      { clave: 'telefono', etiqueta: 'Teléfono (llamadas)', tipo: 'texto', placeholder: '+57 300 000 0000' },
      { clave: 'whatsapp', etiqueta: 'WhatsApp', tipo: 'texto', placeholder: '+57 300 000 0000' },
      { clave: 'email', etiqueta: 'Correo', tipo: 'texto' },
      { clave: 'telegram_chat', etiqueta: 'Chat de Telegram', tipo: 'texto', ayuda: 'Se llena solo al vincular con el código. Solo escríbalo si ya lo conoce.' },
      { clave: 'usuario_ref', etiqueta: 'Usuario de la plataforma', tipo: 'texto', ayuda: 'Documento o id del usuario, para avisos dentro de la app.' },
      { clave: 'notas', etiqueta: 'Notas', tipo: 'area', ancho: true },
      { clave: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
    ];
  }

  async editarContacto(c: Contacto | null): Promise<void> {
    const r = await abrirFormulario<Contacto>(this.dialog, {
      titulo: c ? `Editar ${c.nombre}` : 'Nuevo contacto', icono: 'contact_phone', campos: this.camposContacto(),
      valores: c ? { ...c } : { tipo: 'INTERNO', activo: true },
      validar: (v) => (v['email'] && !/^\S+@\S+\.\S+$/.test(v['email']) ? 'El correo no parece válido.' : null),
      guardar: (v) => this.api.guardarContacto(c?.id ?? null, v as Partial<Contacto>),
    });
    if (!r) return;
    this.acciones.aviso('Contacto guardado.');
    this.cargarContactos();
    const nuevo = r as Contacto;
    if (!c && nuevo.id && !nuevo.telegram_chat) {
      const si = await confirmar(this.dialog, { titulo: 'Vincular Telegram', icono: 'send', boton: 'Vincular ahora',
        texto: 'Telegram es el canal principal de las alarmas (llega con foto y botones para reconocer). ¿Generar el código para que la persona lo vincule?' });
      if (si) await this.vincularTelegram(nuevo);
    }
  }

  async borrarContacto(c: Contacto): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: `Borrar ${c.nombre}`, peligro: true, boton: 'Borrar', texto: 'Deja de recibir alarmas. Los protocolos que lo nombran lo saltan.' });
    if (!ok) return;
    try { await firstValueFrom(this.api.borrarContacto(c.id)); this.acciones.aviso('Contacto borrado.'); this.cargarContactos(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar.'), true); }
  }

  async vincularTelegram(c: Contacto): Promise<void> {
    try {
      const v = await firstValueFrom(this.api.vincularTelegram(c.id));
      abrirInfo(this.dialog, {
        titulo: `Vincular Telegram · ${c.nombre}`, icono: 'send',
        descripcion: 'La persona abre el enlace (o escanea el QR con el celular) y toca "Iniciar" en el bot. Para un grupo: agregue el bot al grupo y escriba ahí /vincular seguido del código.',
        enlace: { texto: 'Abrir en Telegram', url: v.enlace, icono: 'send' },
        qr: v.enlace,
        bloques: [{ etiqueta: 'Código', valor: v.codigo, grande: true }, { etiqueta: 'Enlace', valor: v.enlace }],
        pasosTitulo: 'Instrucciones', pasos: v.instrucciones,
        nota: v.expira_en ? `El código vence ${fechaHora(v.expira_en)}. Al vincularse, el contacto queda marcado como "Vinculado" (actualice la lista).` : undefined,
      });
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo generar el código de Telegram.'), true); }
  }

  async desvincularTelegram(c: Contacto): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: 'Desvincular Telegram', peligro: true, boton: 'Desvincular', texto: `${c.nombre} deja de recibir alarmas por Telegram.` });
    if (!ok) return;
    try { await firstValueFrom(this.api.desvincularTelegram(c.id)); this.acciones.aviso('Telegram desvinculado.'); this.cargarContactos(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo desvincular.'), true); }
  }

  /** Prueba por el canal que tenga el contacto (pregunta cuál si tiene varios). */
  async probarContacto(c: Contacto): Promise<void> {
    const opciones: { canal: Canal; destino: string }[] = [];
    if (c.telegram_chat || c.telegram_vinculado) opciones.push({ canal: 'TELEGRAM', destino: c.telegram_chat ?? c.id });
    if (c.email) opciones.push({ canal: 'EMAIL', destino: c.email });
    if (c.whatsapp) opciones.push({ canal: 'WHATSAPP', destino: c.whatsapp });
    if (c.telefono) opciones.push({ canal: 'LLAMADA', destino: c.telefono });
    if (!opciones.length) { this.acciones.aviso('Este contacto no tiene ningún canal para probar.', true); return; }
    const r = await abrirFormulario<Record<string, any>>(this.dialog, {
      titulo: `Probar aviso a ${c.nombre}`, icono: 'science', ancho: '440px', textoGuardar: 'Enviar prueba',
      descripcion: 'Se envía un mensaje de prueba (no abre ninguna alarma).',
      campos: [{ clave: 'i', etiqueta: 'Canal', tipo: 'seleccion', requerido: true, ancho: true,
        opciones: opciones.map((o, i) => ({ valor: i, texto: `${NOMBRE_CANAL[o.canal]} → ${o.destino}` })) }],
      valores: { i: 0 },
    });
    if (!r) return;
    const o = opciones[Number(r['i'])];
    await this.probar(o.canal, o.destino);
  }

  // ── Protocolos ───────────────────────────────────────────────────────────
  cargarProtocolos(): void {
    this.api.protocolos().subscribe({ next: (p) => this.protocolos.set([...p].sort((a, b) => a.nombre.localeCompare(b.nombre))), error: () => {} });
  }

  editarProtocolo(p: Protocolo | null): void {
    this.errorProt.set(null);
    this.editando.set(p
      ? { id: p.id, nombre: p.nombre, descripcion: p.descripcion ?? '', repetir_ultimo: p.repetir_ultimo, activo: p.activo, pasos: p.pasos }
      : { id: null, nombre: '', descripcion: '', repetir_ultimo: true, activo: true, pasos: pasosSugeridos() });
    this.pasosEdit.set(JSON.parse(JSON.stringify(p ? p.pasos : pasosSugeridos())) as PasoProtocolo[]);
  }

  campoProt<K extends keyof ProtocoloBorrador>(k: K, v: ProtocoloBorrador[K]): void {
    const e = this.editando();
    if (e) this.editando.set({ ...e, [k]: v });
  }

  totalProtocolo(p: { pasos: PasoProtocolo[] }): string {
    const t = p.pasos.reduce((s, x) => s + Math.max(0, Number(x.espera_seg) || 0), 0);
    return t ? cronometro(t) : '0 s';
  }

  async guardarProtocolo(): Promise<void> {
    const e = this.editando();
    if (!e) return;
    const pasos = this.pasosEdit();
    if (!e.nombre.trim()) { this.errorProt.set('Póngale un nombre al protocolo.'); return; }
    if (!pasos.length) { this.errorProt.set('Agregue al menos un paso.'); return; }
    const vacio = pasos.findIndex((p) => !p.canales.length);
    if (vacio >= 0) { this.errorProt.set(`El paso ${vacio + 1} no tiene canales: elija por dónde avisar.`); return; }
    this.guardandoProt.set(true);
    this.errorProt.set(null);
    try {
      await firstValueFrom(this.api.guardarProtocolo(e.id, {
        nombre: e.nombre.trim(), descripcion: e.descripcion.trim() || null, repetir_ultimo: e.repetir_ultimo, activo: e.activo,
        pasos: pasos.map((p, i) => ({ ...p, orden: i + 1, espera_seg: Math.max(0, Number(p.espera_seg) || 0) })),
      }));
      this.acciones.aviso('Protocolo guardado.');
      this.editando.set(null);
      this.cargarProtocolos();
    } catch (err) { this.errorProt.set(mensajeDeError(err, 'No se pudo guardar el protocolo.')); }
    finally { this.guardandoProt.set(false); }
  }

  async borrarProtocolo(p: Protocolo): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: `Borrar "${p.nombre}"`, peligro: true, boton: 'Borrar', texto: 'Las reglas que lo usan pasarán al protocolo por defecto.' });
    if (!ok) return;
    try { await firstValueFrom(this.api.borrarProtocolo(p.id)); this.acciones.aviso('Protocolo borrado.'); this.cargarProtocolos(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar.'), true); }
  }

  readonly nombreCanalDe = (c: Canal): string => NOMBRE_CANAL[c];

  // ── Canales ──────────────────────────────────────────────────────────────
  async probar(canal: Canal = this.canalPrueba, destino: string = this.destinoPrueba): Promise<void> {
    if (!destino.trim()) { this.acciones.aviso('Escriba el destino de la prueba.', true); return; }
    this.probando.set(true);
    this.resultadoPrueba.set(null);
    try {
      const r = await firstValueFrom(this.api.probarCanal(canal, destino.trim()));
      this.resultadoPrueba.set(r);
      this.acciones.aviso(r.ok ? `Prueba enviada por ${NOMBRE_CANAL[canal]}.` : r.mensaje || 'La prueba falló.', !r.ok);
    } catch (e) {
      const m = mensajeDeError(e, 'La prueba falló.');
      this.resultadoPrueba.set({ ok: false, mensaje: m });
      this.acciones.aviso(m, true);
    } finally { this.probando.set(false); }
  }

  ayudaDestino(): string {
    switch (this.canalPrueba) {
      case 'TELEGRAM': return 'chat_id del contacto o grupo (aparece al vincularlo)';
      case 'EMAIL': return 'correo@empresa.com';
      case 'WHATSAPP': case 'LLAMADA': return '+57 300 000 0000';
      case 'WEBHOOK': return 'https://… (vacío no sirve)';
      default: return 'usuario (documento o id)';
    }
  }
}
