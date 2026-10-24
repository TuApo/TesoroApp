import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { Oficina, TurnosService } from '../../../turnos/service/turnos.service';
import { CampoForm, abrirFormulario, confirmar } from '../../components/dialogos/formulario-dialogo';
import { abrirInfo } from '../../components/dialogos/info-dialogo';
import {
  Agente, Camara, EquipoDescubierto, Grabador, Grupo, MarcaGrabador, ModoGrabacion, Mosaico, NOMBRE_MARCA, Sede,
} from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { fechaHora, hace } from '../../utils/formato';

export type SeccionCatalogo = 'sedes' | 'agentes' | 'grabadores' | 'camaras' | 'grupos' | 'mosaicos';

const MARCAS: MarcaGrabador[] = ['DAHUA', 'HIKVISION', 'UNIVIEW', 'ZKTECO', 'EZVIZ_IMOU', 'ONVIF', 'RTSP'];
const NOMBRE_GRABACION: Record<ModoGrabacion, string> = { NINGUNA: 'Sin grabación central', EVENTOS: 'Solo eventos', CONTINUA: 'Continua' };
const DISPOSICIONES = ['1x1', '2x2', '3x3', '4x4', '1+5', '1+7'];

/** Marca a partir de lo que vio el agente en la red (MAC/puertos), para prellenar un grabador. */
function marcaDescubierta(e: EquipoDescubierto): MarcaGrabador {
  const m = (e.marca ?? '').toUpperCase();
  return (MARCAS.find((x) => m.includes(x.split('_')[0])) ?? (e.puertos.includes(554) ? 'RTSP' : 'ONVIF'));
}

/**
 * Catálogos de configuración (sedes, agentes de sitio, grabadores, cámaras, grupos y
 * mosaicos). Un solo componente para compartir las listas que se cruzan en los formularios
 * (una cámara pide su sede, su grabador y su grupo). Crear/editar/borrar es de administrador:
 * un 403 del backend trae el mensaje en español y se muestra tal cual.
 */
@Component({
  selector: 'sg-cfg-catalogos',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cfg-catalogos.html',
  styleUrls: ['../../styles/seguridad-comun.css', './configuracion.css'],
})
export class CfgCatalogos {
  private readonly api = inject(SeguridadService);
  private readonly turnos = inject(TurnosService);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);

  readonly seccion = input.required<SeccionCatalogo>();
  /** Pide a la pantalla abrir las zonas de una cámara. */
  readonly irAZonas = output<string>();

  readonly sedes = signal<Sede[]>([]);
  readonly agentes = signal<Agente[]>([]);
  readonly grabadores = signal<Grabador[]>([]);
  readonly camaras = signal<Camara[]>([]);
  readonly grupos = signal<Grupo[]>([]);
  readonly mosaicos = signal<Mosaico[]>([]);
  readonly oficinas = signal<Oficina[]>([]);
  readonly cargando = signal(true);
  readonly ocupado = signal<string | null>(null);

  readonly filtroSedeCam = signal<string | null>(null);
  readonly filtroGrupoCam = signal<string | null>(null);
  readonly camarasFiltradas = computed(() => this.camaras().filter((c) =>
    (!this.filtroSedeCam() || c.sede_id === this.filtroSedeCam()) && (!this.filtroGrupoCam() || c.grupo_id === this.filtroGrupoCam())));

  readonly nombreMarca = NOMBRE_MARCA;

  // ── Columnas ─────────────────────────────────────────────────────────────
  readonly colSedes: ColumnaTabla<Sede>[] = [
    { id: 'nombre', header: 'Sede', valor: (s) => s.nombre, tarjeta: 'titulo' },
    { id: 'ciudad', header: 'Ciudad', valor: (s) => s.ciudad ?? '', tarjeta: 'subtitulo' },
    { id: 'direccion', header: 'Dirección', prioridad: 2, valor: (s) => s.direccion ?? '' },
    { id: 'oficina', header: 'Oficina (croquis)', prioridad: 2, valor: (s) => this.nombreOficina(s.oficina_ref) },
    { id: 'policia', header: 'Policía del cuadrante', prioridad: 2, valor: (s) => [s.policia_nombre, s.policia_telefono].filter(Boolean).join(' · ') },
    { id: 'camaras', header: 'Cámaras', align: 'right', valor: (s) => s.camaras ?? 0, formato: (s) => `${s.camaras_en_linea ?? 0}/${s.camaras ?? 0}` },
    { id: 'incidentes', header: 'Alarmas abiertas', align: 'right', prioridad: 3, valor: (s) => s.incidentes_abiertos ?? 0 },
    { id: 'activo', header: 'Activa', prioridad: 3, valor: (s) => s.activo },
  ];
  readonly colAgentes: ColumnaTabla<Agente>[] = [
    { id: 'nombre', header: 'Agente', valor: (a) => a.nombre, tarjeta: 'titulo' },
    { id: 'sede', header: 'Sede', valor: (a) => a.sede_nombre, tarjeta: 'subtitulo' },
    { id: 'estado', header: 'Estado', valor: (a) => a.estado, tarjeta: 'badge',
      badge: (a) => ({ texto: a.estado === 'EN_LINEA' ? 'En línea' : a.estado === 'NUNCA' ? 'Nunca conectado' : 'Fuera de línea',
        tono: a.estado === 'EN_LINEA' ? 'ok' : a.estado === 'NUNCA' ? 'neutro' : 'danger' }) },
    { id: 'ultima', header: 'Última conexión', valor: (a) => a.ultima_conexion ?? '', formato: (a) => (a.ultima_conexion ? hace(a.ultima_conexion) : '—'), tarjeta: 'meta' },
    { id: 'version', header: 'Versión', prioridad: 3, valor: (a) => a.version ?? '' },
    { id: 'ip', header: 'IP pública / LAN', prioridad: 2, valor: (a) => [a.ip_publica, a.ip_lan].filter(Boolean).join(' / ') },
    { id: 'descubiertos', header: 'Equipos vistos', align: 'right', prioridad: 2, valor: (a) => a.descubiertos?.length ?? 0 },
  ];
  readonly colGrabadores: ColumnaTabla<Grabador>[] = [
    { id: 'nombre', header: 'Grabador', valor: (g) => g.nombre, tarjeta: 'titulo' },
    { id: 'sede', header: 'Sede', valor: (g) => g.sede_nombre, tarjeta: 'subtitulo' },
    { id: 'marca', header: 'Marca / tipo', valor: (g) => `${NOMBRE_MARCA[g.marca]} · ${g.tipo}${g.modelo ? ` ${g.modelo}` : ''}` },
    { id: 'conexion', header: 'Conexión', prioridad: 2, valor: (g) => (g.conexion === 'AGENTE' ? 'Por agente de sitio' : `Directa · ${g.host ?? ''}`) },
    { id: 'estado', header: 'Estado', valor: (g) => g.estado, tarjeta: 'badge',
      badge: (g) => ({ texto: g.estado === 'EN_LINEA' ? 'En línea' : g.estado === 'FUERA_DE_LINEA' ? 'Fuera de línea' : 'Sin dato',
        tono: g.estado === 'EN_LINEA' ? 'ok' : g.estado === 'FUERA_DE_LINEA' ? 'danger' : 'neutro' }) },
    { id: 'camaras', header: 'Cámaras', align: 'right', valor: (g) => g.camaras ?? 0, formato: (g) => `${g.camaras ?? 0}${g.canales ? ` / ${g.canales} canales` : ''}` },
    { id: 'contacto', header: 'Último contacto', prioridad: 3, valor: (g) => g.ultimo_contacto ?? '', formato: (g) => fechaHora(g.ultimo_contacto), tarjeta: 'meta' },
  ];
  readonly colCamaras: ColumnaTabla<Camara>[] = [
    { id: 'nombre', header: 'Cámara', valor: (c) => c.nombre, tarjeta: 'titulo' },
    { id: 'sede', header: 'Sede', valor: (c) => c.sede_nombre, tarjeta: 'subtitulo' },
    { id: 'grabador', header: 'Grabador · canal', prioridad: 2, valor: (c) => (c.grabador_nombre ? `${c.grabador_nombre} · ${c.canal ?? '—'}` : 'URL propia') },
    { id: 'grupo', header: 'Grupo', prioridad: 2, valor: (c) => c.grupo_nombre ?? '' },
    { id: 'estado', header: 'Estado', valor: (c) => c.estado, tarjeta: 'badge',
      badge: (c) => ({ texto: c.estado === 'EN_LINEA' ? 'En línea' : c.estado === 'FUERA_DE_LINEA' ? 'Sin señal' : 'Sin dato',
        tono: c.estado === 'EN_LINEA' ? 'ok' : c.estado === 'FUERA_DE_LINEA' ? 'danger' : 'neutro' }) },
    { id: 'grabacion', header: 'Grabación', prioridad: 2, valor: (c) => NOMBRE_GRABACION[c.grabacion] ?? c.grabacion },
    { id: 'ia', header: 'Analítica IA', prioridad: 2, valor: (c) => c.analitica_activa,
      badge: (c) => (c.analitica_activa ? { texto: `IA · ${c.fps_analisis ?? '—'} fps`, tono: 'violet' } : null) },
    { id: 'extras', header: 'Funciones', prioridad: 3, valor: (c) => [c.ptz ? 'PTZ' : '', c.audio_bidireccional ? 'Audio' : ''].filter(Boolean).join(', ') },
    { id: 'activo', header: 'Activa', prioridad: 3, valor: (c) => c.activo },
  ];
  readonly colGrupos: ColumnaTabla<Grupo>[] = [
    { id: 'nombre', header: 'Grupo', valor: (g) => g.nombre, tarjeta: 'titulo',
      badge: (g) => ({ texto: g.nombre, tono: 'neutro', fondo: g.color ?? undefined, color: g.color ? '#fff' : undefined }) },
    { id: 'descripcion', header: 'Descripción', valor: (g) => g.descripcion ?? '', tarjeta: 'cuerpo' },
    { id: 'camaras', header: 'Cámaras', align: 'right', valor: (g) => g.camaras ?? 0 },
    { id: 'orden', header: 'Orden', align: 'right', prioridad: 3, valor: (g) => g.orden ?? 0 },
  ];
  readonly colMosaicos: ColumnaTabla<Mosaico>[] = [
    { id: 'nombre', header: 'Mosaico', valor: (m) => m.nombre, tarjeta: 'titulo' },
    { id: 'disposicion', header: 'Disposición', valor: (m) => m.disposicion },
    { id: 'celdas', header: 'Cámaras', align: 'right', valor: (m) => (m.celdas ?? []).filter((c) => c.camara_id).length },
    { id: 'compartido', header: 'Compartido', valor: (m) => m.compartido },
    { id: 'rotacion', header: 'Rota cada', align: 'right', prioridad: 2, valor: (m) => m.rotacion_seg ?? 0, formato: (m) => (m.rotacion_seg ? `${m.rotacion_seg} s` : 'No rota') },
    { id: 'orden', header: 'Orden', align: 'right', prioridad: 3, valor: (m) => m.orden ?? 0 },
  ];
  readonly porId = (x: { id: string }) => x.id;

  constructor() {
    this.cargarTodo();
    this.turnos.oficinas(true).subscribe({ next: (o) => this.oficinas.set(o), error: () => {} });
  }

  cargarTodo(): void {
    this.cargando.set(true);
    let pendientes = 6;
    const fin = () => { if (--pendientes <= 0) this.cargando.set(false); };
    const orden = <T extends { nombre: string }>(l: T[]) => [...l].sort((a, b) => a.nombre.localeCompare(b.nombre));
    this.api.sedes().subscribe({ next: (x) => { this.sedes.set(orden(x)); fin(); }, error: (e) => { fin(); this.avisoError(e); } });
    this.api.agentes().subscribe({ next: (x) => { this.agentes.set(orden(x)); fin(); }, error: () => fin() });
    this.api.grabadores().subscribe({ next: (x) => { this.grabadores.set(orden(x)); fin(); }, error: () => fin() });
    this.api.camaras().subscribe({ next: (x) => { this.camaras.set([...x].sort((a, b) => `${a.sede_nombre}${a.orden ?? 0}${a.nombre}`.localeCompare(`${b.sede_nombre}${b.orden ?? 0}${b.nombre}`))); fin(); }, error: () => fin() });
    this.api.grupos().subscribe({ next: (x) => { this.grupos.set([...x].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))); fin(); }, error: () => fin() });
    this.api.mosaicos().subscribe({ next: (x) => { this.mosaicos.set([...x].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))); fin(); }, error: () => fin() });
  }

  private avisoError(e: unknown): void { this.acciones.aviso(mensajeDeError(e, 'No se pudo leer la configuración.'), true); }

  nombreOficina(id: string | null): string {
    if (!id) return '';
    return this.oficinas().find((o) => o.id === id)?.nombre ?? id;
  }

  private opSedes() { return this.sedes().map((s) => ({ valor: s.id, texto: s.nombre })); }

  private async borrarGenerico(nombre: string, texto: string, accion: () => Observable<unknown>): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: `Borrar ${nombre}`, peligro: true, boton: 'Borrar', texto });
    if (!ok) return;
    try { await firstValueFrom(accion()); this.acciones.aviso('Borrado.'); this.cargarTodo(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar.'), true); }
  }

  // ── Sedes ────────────────────────────────────────────────────────────────
  async editarSede(s: Sede | null): Promise<void> {
    const campos: CampoForm[] = [
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
      { clave: 'ciudad', etiqueta: 'Ciudad', tipo: 'texto' },
      { clave: 'direccion', etiqueta: 'Dirección', tipo: 'texto', ancho: true, ayuda: 'Se incluye en los avisos a la policía.' },
      this.oficinas().length
        ? { clave: 'oficina_ref', etiqueta: 'Oficina de Turnos (croquis)', tipo: 'seleccion', ancho: true,
            opciones: this.oficinas().map((o) => ({ valor: o.id, texto: o.nombre })), ayuda: 'Para ver cámaras y puertas en el plano 3D de la oficina.' }
        : { clave: 'oficina_ref', etiqueta: 'Id de la oficina de Turnos', tipo: 'texto', ancho: true },
      { clave: 'lat', etiqueta: 'Latitud', tipo: 'numero', paso: 0.000001 },
      { clave: 'lng', etiqueta: 'Longitud', tipo: 'numero', paso: 0.000001 },
      { clave: 'policia_nombre', etiqueta: 'Policía del cuadrante', tipo: 'texto', seccion: 'Apoyo externo', placeholder: 'Cuadrante 12 · Estación Norte' },
      { clave: 'policia_telefono', etiqueta: 'Teléfono del cuadrante', tipo: 'texto', placeholder: '+57 3xx xxx xxxx' },
      { clave: 'activo', etiqueta: 'Activa', tipo: 'booleano' },
    ];
    const r = await abrirFormulario(this.dialog, {
      titulo: s ? `Editar ${s.nombre}` : 'Nueva sede', icono: 'location_on', campos, valores: s ? { ...s } : { activo: true },
      guardar: (v) => this.api.guardarSede(s?.id ?? null, v as Partial<Sede>),
    });
    if (r) { this.acciones.aviso('Sede guardada.'); this.cargarTodo(); }
  }
  borrarSede(s: Sede): void { void this.borrarGenerico(s.nombre, 'Solo se puede borrar una sede sin cámaras ni dispositivos.', () => this.api.borrarSede(s.id)); }

  // ── Agentes ──────────────────────────────────────────────────────────────
  async editarAgente(a: Agente | null): Promise<void> {
    const r = await abrirFormulario<Agente>(this.dialog, {
      titulo: a ? `Editar ${a.nombre}` : 'Nuevo agente de sitio', icono: 'router',
      descripcion: a ? undefined : 'Un agente es un equipo pequeño en la sede (mini PC, Raspberry o un PC encendido) que lleva el video y los dispositivos al servidor sin abrir puertos en el router.',
      campos: [
        { clave: 'sede_id', etiqueta: 'Sede', tipo: 'seleccion', requerido: true, opciones: this.opSedes() },
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, placeholder: 'Ej.: Mini PC recepción' },
      ],
      valores: a ? { ...a } : { sede_id: this.sedes()[0]?.id ?? null },
      guardar: (v) => this.api.guardarAgente(a?.id ?? null, v as Partial<Agente>),
    });
    if (!r) return;
    this.acciones.aviso('Agente guardado.');
    this.cargarTodo();
    if (!a && (r as Agente).id) await this.instalarAgente(r as Agente, true);
  }

  /** Genera el token (se ve UNA vez) y el paquete para instalar el agente en la sede. */
  async instalarAgente(a: Agente, nuevo = false): Promise<void> {
    if (!nuevo && a.estado !== 'NUNCA') {
      const ok = await confirmar(this.dialog, { titulo: 'Nuevo token del agente', boton: 'Generar', icono: 'key', peligro: true,
        texto: 'El token anterior deja de servir: el agente instalado se desconecta hasta que se le ponga el nuevo .env.' });
      if (!ok) return;
    }
    this.ocupado.set(a.id);
    try {
      const t = await firstValueFrom(this.api.tokenAgente(a.id));
      abrirInfo(this.dialog, {
        titulo: `Instalar ${a.nombre}`, icono: 'router',
        aviso: { tono: 'warn', texto: 'El token se muestra SOLO ahora (el servidor guarda únicamente su huella). Descargue los archivos antes de cerrar.' },
        bloques: [
          { etiqueta: 'Token del agente', valor: t.token },
          { etiqueta: 'docker-compose.yml', valor: t.compose_yaml, archivo: 'docker-compose.yml' },
          { etiqueta: '.env', valor: t.env_file, archivo: 'agente.env' },
        ],
        pasosTitulo: 'Instalación', pasos: t.instrucciones,
        nota: 'Guarde agente.env como ".env" junto al docker-compose.yml en el equipo de la sede.',
      });
      this.cargarTodo();
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo generar el token.'), true); }
    finally { this.ocupado.set(null); }
  }

  verDescubiertos(a: Agente): void {
    const l = a.descubiertos ?? [];
    abrirInfo(this.dialog, {
      titulo: `Equipos vistos por ${a.nombre}`, icono: 'lan',
      descripcion: l.length ? 'Lo que el agente encontró en la red de la sede. Puertos 554 (RTSP) y 80/37777/8000 suelen ser grabadores o cámaras.' : 'El agente aún no reporta equipos en su red.',
      bloques: l.map((e) => ({ etiqueta: `${e.ip}${e.marca ? ` · ${e.marca}` : ''}`, valor: `MAC ${e.mac ?? '—'} · puertos ${e.puertos.join(', ') || '—'}` })),
    });
  }

  async grabadorDesde(a: Agente, e: EquipoDescubierto): Promise<void> {
    await this.editarGrabador(null, {
      sede_id: a.sede_id, conexion: 'AGENTE', agente_id: a.id, host: e.ip, marca: marcaDescubierta(e), tipo: 'DVR',
      puerto_rtsp: e.puertos.includes(554) ? 554 : null, puerto_http: e.puertos.includes(80) ? 80 : null, nombre: `${e.marca ?? 'Grabador'} ${e.ip}`,
    });
  }
  borrarAgente(a: Agente): void { void this.borrarGenerico(a.nombre, 'El agente deja de conectarse; los grabadores que dependen de él quedan sin video.', () => this.api.borrarAgente(a.id)); }

  // ── Grabadores ───────────────────────────────────────────────────────────
  async editarGrabador(g: Grabador | null, prellenado?: Partial<Grabador>): Promise<void> {
    const campos: CampoForm[] = [
      { clave: 'sede_id', etiqueta: 'Sede', tipo: 'seleccion', requerido: true, opciones: this.opSedes() },
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, placeholder: 'Ej.: DVR principal' },
      { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', requerido: true, opciones: [
        { valor: 'DVR', texto: 'DVR (cámaras análogas)' }, { valor: 'NVR', texto: 'NVR (cámaras IP)' }, { valor: 'CAMARA_IP', texto: 'Cámara IP sola' }] },
      { clave: 'marca', etiqueta: 'Marca', tipo: 'seleccion', requerido: true, opciones: MARCAS.map((m) => ({ valor: m, texto: NOMBRE_MARCA[m] })) },
      { clave: 'modelo', etiqueta: 'Modelo', tipo: 'texto' },
      { clave: 'serial', etiqueta: 'Serial', tipo: 'texto' },
      { clave: 'conexion', etiqueta: 'Conexión', tipo: 'seleccion', requerido: true, seccion: 'Conexión', opciones: [
        { valor: 'DIRECTA', texto: 'Directa (el servidor alcanza el equipo: LAN, VPN o IP pública)' },
        { valor: 'AGENTE', texto: 'Por agente de sitio (la sede está detrás de NAT)' }], ancho: true },
      { clave: 'agente_id', etiqueta: 'Agente de sitio', tipo: 'seleccion', visible: (v) => v['conexion'] === 'AGENTE', requeridoSi: (v) => v['conexion'] === 'AGENTE',
        opciones: this.agentes().map((a) => ({ valor: a.id, texto: `${a.nombre} · ${a.sede_nombre}` })), ancho: true },
      { clave: 'host', etiqueta: 'IP o dominio', tipo: 'texto', requerido: true, ayuda: 'Con agente: la IP del equipo dentro de la red de la sede.' },
      { clave: 'puerto_rtsp', etiqueta: 'Puerto RTSP', tipo: 'numero', min: 1, max: 65535, placeholder: '554' },
      { clave: 'puerto_http', etiqueta: 'Puerto HTTP', tipo: 'numero', min: 1, max: 65535, placeholder: '80' },
      { clave: 'canales', etiqueta: 'Canales', tipo: 'numero', min: 1, max: 256, ayuda: 'Cuántas cámaras admite (4, 8, 16…).' },
      { clave: 'usuario', etiqueta: 'Usuario', tipo: 'texto', seccion: 'Credenciales', ayuda: 'Mejor un usuario de solo lectura creado para esto.' },
      { clave: 'clave', etiqueta: 'Clave', tipo: 'clave', guardado: !!g?.tiene_clave },
      { clave: 'notas', etiqueta: 'Notas', tipo: 'area', ancho: true },
      { clave: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
    ];
    const r = await abrirFormulario<Grabador>(this.dialog, {
      titulo: g ? `Editar ${g.nombre}` : 'Nuevo grabador', icono: 'dns', campos, ancho: '720px',
      valores: g ? { ...g } : { tipo: 'DVR', marca: 'DAHUA', conexion: 'DIRECTA', puerto_rtsp: 554, puerto_http: 80, activo: true, sede_id: this.sedes()[0]?.id ?? null, ...prellenado },
      guardar: (v) => this.api.guardarGrabador(g?.id ?? null, { ...v, agente_id: v['conexion'] === 'AGENTE' ? v['agente_id'] : null }),
    });
    if (!r) return;
    this.acciones.aviso('Grabador guardado.');
    this.cargarTodo();
    const nuevo = r as Grabador;
    if (!g && nuevo.id) {
      const si = await confirmar(this.dialog, { titulo: 'Crear las cámaras', icono: 'video_call', boton: 'Crear cámaras',
        texto: `¿Crear de una vez una cámara por cada canal${nuevo.canales ? ` (${nuevo.canales})` : ''}? Después se les pone nombre.` });
      if (si) await this.descubrir(nuevo, false);
    }
  }

  async probar(g: Grabador): Promise<void> {
    this.ocupado.set(g.id);
    try {
      const r = await firstValueFrom(this.api.probarGrabador(g.id));
      this.acciones.aviso(r.ok ? `Conectó${r.latencia_ms != null ? ` en ${r.latencia_ms} ms` : ''}. ${r.mensaje ?? ''}` : `No conectó: ${r.mensaje}`, !r.ok);
      this.cargarTodo();
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo probar el grabador.'), true); }
    finally { this.ocupado.set(null); }
  }

  async descubrir(g: Grabador, preguntar = true): Promise<void> {
    let canales: number | null = g.canales ?? null;
    if (preguntar || !canales) {
      const r = await abrirFormulario<Record<string, any>>(this.dialog, {
        titulo: `Crear cámaras de ${g.nombre}`, icono: 'video_call', ancho: '440px', textoGuardar: 'Crear',
        descripcion: 'Se crea una cámara por canal (1..N). Las que ya existen no se duplican.',
        campos: [{ clave: 'canales', etiqueta: 'Número de canales', tipo: 'numero', requerido: true, min: 1, max: 256, ancho: true }],
        valores: { canales: canales ?? 4 },
      });
      if (!r) return;
      canales = Number(r['canales']);
    }
    this.ocupado.set(g.id);
    try {
      const r = await firstValueFrom(this.api.descubrirCanales(g.id, canales));
      this.acciones.aviso(`Cámaras creadas: ${r.creadas} · ya existían: ${r.existentes}.`);
      this.cargarTodo();
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudieron crear las cámaras.'), true); }
    finally { this.ocupado.set(null); }
  }
  borrarGrabador(g: Grabador): void { void this.borrarGenerico(g.nombre, 'Se borran también sus cámaras (y sus zonas y reglas).', () => this.api.borrarGrabador(g.id)); }

  // ── Cámaras ──────────────────────────────────────────────────────────────
  async editarCamara(c: Camara | null): Promise<void> {
    const campos: CampoForm[] = [
      { clave: 'sede_id', etiqueta: 'Sede', tipo: 'seleccion', requerido: true, opciones: this.opSedes() },
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, placeholder: 'Ej.: Caja 1' },
      { clave: 'grabador_id', etiqueta: 'Grabador', tipo: 'seleccion', opciones: this.grabadores().map((g) => ({ valor: g.id, texto: `${g.nombre} · ${g.sede_nombre}` })),
        ayuda: 'Vacío = cámara con URL propia.' },
      { clave: 'canal', etiqueta: 'Canal', tipo: 'numero', min: 1, visible: (v) => !!v['grabador_id'], requeridoSi: (v) => !!v['grabador_id'] },
      { clave: 'grupo_id', etiqueta: 'Grupo', tipo: 'seleccion', opciones: this.grupos().map((g) => ({ valor: g.id, texto: g.nombre })) },
      { clave: 'ubicacion', etiqueta: 'Ubicación', tipo: 'texto', placeholder: 'Ej.: Entrada principal, mira a la calle' },
      { clave: 'url_principal', etiqueta: 'URL RTSP principal', tipo: 'texto', ancho: true, seccion: 'URLs propias (solo sin grabador o para forzar)',
        requeridoSi: (v) => !v['grabador_id'], placeholder: 'rtsp://usuario:clave@ip:554/…', ayuda: 'Al guardar, la clave se enmascara al mostrarla.' },
      { clave: 'url_secundaria', etiqueta: 'URL RTSP secundaria (sub)', tipo: 'texto', ancho: true },
      { clave: 'grabacion', etiqueta: 'Grabación central', tipo: 'seleccion', requerido: true, seccion: 'Grabación e IA',
        opciones: (Object.keys(NOMBRE_GRABACION) as ModoGrabacion[]).map((m) => ({ valor: m, texto: NOMBRE_GRABACION[m] })) },
      { clave: 'retencion_dias', etiqueta: 'Retención (días)', tipo: 'numero', min: 1, ayuda: 'Vacío = la de Ajustes.' },
      { clave: 'analitica_activa', etiqueta: 'Analítica IA (personas, zonas, rostros)', tipo: 'booleano' },
      { clave: 'fps_analisis', etiqueta: 'Cuadros por segundo a analizar', tipo: 'numero', min: 1, max: 15, visible: (v) => !!v['analitica_activa'],
        ayuda: 'Sin GPU, 1–2 fps por cámara. Más fps = más carga del servidor.' },
      { clave: 'ptz', etiqueta: 'Mueve y hace zoom (PTZ)', tipo: 'booleano', seccion: 'Funciones' },
      { clave: 'audio_bidireccional', etiqueta: 'Tiene parlante (audio bidireccional)', tipo: 'booleano' },
      { clave: 'croquis_oficina_ref', etiqueta: 'Oficina del croquis', tipo: 'seleccion', opciones: this.oficinas().map((o) => ({ valor: o.id, texto: o.nombre })) },
      { clave: 'croquis_elemento_ref', etiqueta: 'Elemento del croquis', tipo: 'texto', ayuda: 'Id del elemento "Cámara" en el plano.' },
      { clave: 'orden', etiqueta: 'Orden', tipo: 'numero' },
      { clave: 'activo', etiqueta: 'Activa', tipo: 'booleano' },
    ];
    const r = await abrirFormulario(this.dialog, {
      titulo: c ? `Editar ${c.nombre}` : 'Nueva cámara', icono: 'videocam', campos, ancho: '720px',
      valores: c ? { ...c } : { grabacion: 'EVENTOS', activo: true, analitica_activa: false, fps_analisis: 2, sede_id: this.filtroSedeCam() ?? this.sedes()[0]?.id ?? null },
      guardar: (v) => this.api.guardarCamara(c?.id ?? null, { ...v, canal: v['grabador_id'] ? v['canal'] : null } as Partial<Camara>),
    });
    if (r) { this.acciones.aviso('Cámara guardada.'); this.cargarTodo(); }
  }
  borrarCamara(c: Camara): void { void this.borrarGenerico(c.nombre, 'Se borran sus zonas, reglas y la grabación central.', () => this.api.borrarCamara(c.id)); }

  // ── Grupos ───────────────────────────────────────────────────────────────
  async editarGrupo(g: Grupo | null): Promise<void> {
    const r = await abrirFormulario(this.dialog, {
      titulo: g ? `Editar ${g.nombre}` : 'Nuevo grupo de cámaras', icono: 'label', ancho: '480px',
      campos: [
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, ancho: true, placeholder: 'Ej.: Cajas, Exteriores' },
        { clave: 'descripcion', etiqueta: 'Descripción', tipo: 'area', ancho: true },
        { clave: 'color', etiqueta: 'Color', tipo: 'color' },
        { clave: 'orden', etiqueta: 'Orden', tipo: 'numero' },
      ],
      valores: g ? { ...g } : { color: '#2b59f0', orden: this.grupos().length },
      guardar: (v) => this.api.guardarGrupo(g?.id ?? null, v as Partial<Grupo>),
    });
    if (r) { this.acciones.aviso('Grupo guardado.'); this.cargarTodo(); }
  }
  borrarGrupo(g: Grupo): void { void this.borrarGenerico(g.nombre, 'Las cámaras del grupo quedan sin grupo.', () => this.api.borrarGrupo(g.id)); }

  // ── Mosaicos ─────────────────────────────────────────────────────────────
  async editarMosaico(m: Mosaico | null): Promise<void> {
    const r = await abrirFormulario(this.dialog, {
      titulo: m ? `Editar ${m.nombre}` : 'Nuevo mosaico', icono: 'grid_view', ancho: '480px',
      descripcion: 'Las cámaras de cada celda se acomodan arrastrándolas en el Centro de monitoreo y se guardan desde allí.',
      campos: [
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, ancho: true },
        { clave: 'disposicion', etiqueta: 'Disposición', tipo: 'seleccion', requerido: true, opciones: DISPOSICIONES.map((d) => ({ valor: d, texto: d })) },
        { clave: 'rotacion_seg', etiqueta: 'Rotar cada (s)', tipo: 'numero', min: 0, ayuda: '0 = no rota.' },
        { clave: 'compartido', etiqueta: 'Compartido con todos los operadores', tipo: 'booleano', ancho: true },
        { clave: 'orden', etiqueta: 'Orden', tipo: 'numero' },
      ],
      valores: m ? { ...m } : { disposicion: '2x2', rotacion_seg: 0, compartido: true, orden: this.mosaicos().length },
      guardar: (v) => this.api.guardarMosaico(m?.id ?? null, { ...v, celdas: m?.celdas ?? [] } as Partial<Mosaico>),
    });
    if (r) { this.acciones.aviso('Mosaico guardado.'); this.cargarTodo(); }
  }
  borrarMosaico(m: Mosaico): void { void this.borrarGenerico(m.nombre, 'Solo se borra la disposición guardada.', () => this.api.borrarMosaico(m.id)); }
}
