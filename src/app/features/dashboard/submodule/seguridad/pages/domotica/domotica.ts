import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { leerMetaAreas, leerPisos } from '../../../turnos/components/croquis-svg/croquis-svg';
import { Plano3d } from '../../../turnos/components/plano-3d/plano-3d';
import { Area, MetaArea, PisoCroquis, TurnosService } from '../../../turnos/service/turnos.service';
import { CampoForm, OpcionForm, abrirFormulario, confirmar } from '../../components/dialogos/formulario-dialogo';
import { abrirInfo } from '../../components/dialogos/info-dialogo';
import { VisorCamara } from '../../components/visor-camara/visor-camara';
import {
  Acceso, AccionDispositivo, AccionRegistrada, Agente, Camara, CampoIntegracion, Dispositivo, EstadoDispositivo, ICONO_ACCION,
  ICONO_TIPO_DISPOSITIVO, Integracion, NOMBRE_ACCION, NOMBRE_ESTADO_DISPOSITIVO, NOMBRE_TIPO_DISPOSITIVO, Sede, TipoDispositivo,
} from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { copiarTexto, fechaHora, hace } from '../../utils/formato';

type Vista = 'dispositivos' | 'accesos' | 'plano' | 'asistente';
const TIPOS: TipoDispositivo[] = ['PUERTA', 'CERRADURA', 'VENTANA', 'CAJA_FUERTE', 'BOTON_PANICO', 'SIRENA', 'SENSOR_MOVIMIENTO', 'SENSOR_HUMO', 'RELE', 'LECTOR_ACCESO', 'OTRO'];
const NOMBRE_CATEGORIA: Record<string, string> = { VIDEO: 'Video', ACCESO: 'Control de acceso', DOMOTICA: 'Domótica', ALERTAS: 'Alertas', AUDIO: 'Audio' };
const NOMBRE_DIFICULTAD: Record<string, string> = { FACIL: 'Fácil', MEDIA: 'Media', AVANZADA: 'Avanzada' };

/** Tono del chip de estado de un dispositivo. */
export function tonoEstadoDispositivo(e: EstadoDispositivo): 'ok' | 'warn' | 'danger' | 'info' | 'neutro' {
  switch (e) {
    case 'ALARMA': return 'danger';
    case 'ABIERTO': case 'DESBLOQUEADO': return 'warn';
    case 'CERRADO': case 'BLOQUEADO': return 'ok';
    case 'ACTIVO': return 'info';
    default: return 'neutro';
  }
}

/** Campo de una integración (catálogo del backend) → campo del formulario del módulo. */
function campoDeIntegracion(c: CampoIntegracion): CampoForm {
  const opciones: OpcionForm[] | undefined = c.opciones?.map((o) => (typeof o === 'string' ? { valor: o, texto: o } : { valor: o.valor, texto: o.texto }));
  const tipo = c.tipo === 'numero' ? 'numero' : c.tipo === 'clave' ? 'clave' : c.tipo === 'seleccion' ? 'seleccion' : c.tipo === 'booleano' ? 'booleano' : 'texto';
  return { clave: `cfg_${c.clave}`, etiqueta: c.etiqueta, tipo, requerido: c.requerido, ayuda: c.ayuda, opciones };
}

/**
 * Domótica y accesos: puertas, cerraduras, ventanas, cajas fuertes, botones de pánico, sirenas y
 * sensores con su estado en vivo y el mando (cada acción queda auditada con quién y por qué);
 * las marcaciones de los lectores ZKTeco; el plano 3D de la sede con puertas y cámaras
 * coloreadas por estado; y el asistente "Agregar integración", que lee el catálogo
 * `/integraciones` del backend (pasos, enlaces y campos) para conectar un equipo sin manual.
 */
@Component({
  selector: 'app-seguridad-domotica',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, MatSlideToggleModule, Plano3d, VisorCamara, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './domotica.html',
  styleUrls: ['../../styles/seguridad-comun.css', './domotica.css'],
})
export class SeguridadDomotica {
  private readonly api = inject(SeguridadService);
  private readonly turnos = inject(TurnosService);
  readonly vivo = inject(SeguridadVivoService);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);

  readonly vista = signal<Vista>('dispositivos');

  readonly sedes = signal<Sede[]>([]);
  readonly camaras = signal<Camara[]>([]);
  readonly agentes = signal<Agente[]>([]);
  readonly dispositivos = signal<Dispositivo[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  // Filtros
  readonly sedeId = signal<string | null>(null);
  readonly tipo = signal<TipoDispositivo | null>(null);
  readonly busqueda = signal('');
  readonly enMando = signal<string | null>(null);

  readonly nombreTipo = NOMBRE_TIPO_DISPOSITIVO;
  readonly iconoTipo = ICONO_TIPO_DISPOSITIVO;
  readonly nombreEstado = NOMBRE_ESTADO_DISPOSITIVO;
  readonly nombreAccion = NOMBRE_ACCION;
  readonly iconoAccion = ICONO_ACCION;
  readonly nombreCategoria = NOMBRE_CATEGORIA;
  readonly nombreDificultad = NOMBRE_DIFICULTAD;
  readonly tipos = TIPOS;
  readonly f = { fechaHora, hace, tono: tonoEstadoDispositivo };

  readonly filtrados = computed(() => {
    const s = this.sedeId(), t = this.tipo(), q = this.busqueda().trim().toLowerCase();
    return this.dispositivos()
      .filter((d) => (!s || d.sede_id === s) && (!t || d.tipo === t))
      .filter((d) => !q || `${d.nombre} ${d.sede_nombre} ${NOMBRE_TIPO_DISPOSITIVO[d.tipo]} ${d.integracion}`.toLowerCase().includes(q));
  });
  /** Agrupados por sede, con los que están en alarma o abiertos primero. */
  readonly porSede = computed(() => {
    const m = new Map<string, { sede: string; items: Dispositivo[] }>();
    for (const d of this.filtrados()) {
      if (!m.has(d.sede_id)) m.set(d.sede_id, { sede: d.sede_nombre, items: [] });
      m.get(d.sede_id)!.items.push(d);
    }
    const peso = (d: Dispositivo) => { const e = this.estado(d); return e === 'ALARMA' ? 0 : e === 'ABIERTO' || e === 'DESBLOQUEADO' ? 1 : 2; };
    return [...m.values()].map((g) => ({ ...g, items: g.items.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre)) }))
      .sort((a, b) => a.sede.localeCompare(b.sede));
  });
  readonly resumen = computed(() => {
    const l = this.dispositivos();
    return {
      total: l.length,
      alarma: l.filter((d) => this.estado(d) === 'ALARMA').length,
      abiertos: l.filter((d) => ['ABIERTO', 'DESBLOQUEADO'].includes(this.estado(d))).length,
      fuera: l.filter((d) => !this.enLinea(d)).length,
    };
  });

  // ── Historial de acciones de un dispositivo ─────────────────────────────
  readonly historialDe = signal<Dispositivo | null>(null);
  readonly historial = signal<AccionRegistrada[]>([]);
  readonly cargandoHistorial = signal(false);

  // ── Marcaciones (paginado en el servidor) ───────────────────────────────
  readonly accesos = signal<Acceso[]>([]);
  readonly totalAccesos = signal(0);
  readonly paginaAccesos = signal(0);
  readonly porPaginaAccesos = signal(50);
  readonly cargandoAccesos = signal(false);
  readonly filtroDisp = signal<string | null>(null);
  readonly filtroDesde = signal('');
  readonly filtroHasta = signal('');
  readonly lectores = computed(() => this.dispositivos().filter((d) => d.tipo === 'LECTOR_ACCESO' || d.integracion === 'ZKTECO_PUSH'));
  readonly columnasAccesos: ColumnaTabla<Acceso>[] = [
    { id: 'cuando', header: 'Cuándo', valor: (a) => a.ocurrido_en, formato: (a) => fechaHora(a.ocurrido_en), tarjeta: 'meta' },
    { id: 'nombre', header: 'Persona', valor: (a) => a.nombre ?? '', tarjeta: 'titulo' },
    { id: 'documento', header: 'Documento', valor: (a) => a.documento ?? '', tarjeta: 'subtitulo' },
    { id: 'dispositivo', header: 'Lector', valor: (a) => a.dispositivo_nombre },
    { id: 'metodo', header: 'Método', prioridad: 2, valor: (a) => a.metodo ?? '' },
    { id: 'resultado', header: 'Resultado', valor: (a) => a.resultado ?? '', tarjeta: 'badge',
      badge: (a) => (a.resultado ? { texto: a.resultado, tono: /ok|permit|aceptad|autoriz/i.test(a.resultado) ? 'ok' : /deneg|rechaz|error|fall/i.test(a.resultado) ? 'danger' : 'neutro' } : null) },
  ];
  readonly idAcceso = (a: Acceso) => a.id;

  // ── Plano 3D ─────────────────────────────────────────────────────────────
  readonly sedesConPlano = computed(() => this.sedes().filter((s) => !!s.oficina_ref));
  readonly sedePlano = signal<string | null>(null);
  readonly pisos = signal<PisoCroquis[]>([]);
  readonly areas = signal<Area[]>([]);
  readonly meta = signal<Record<string, MetaArea>>({});
  readonly escala = signal(2);
  readonly pisoId = signal<string | null>(null);
  readonly errorPlano = signal<string | null>(null);
  readonly cargandoPlano = signal(false);
  readonly sin3d = signal<string | null>(null);
  readonly camaraVista = signal<string | null>(null);
  readonly mapaCamaras = computed(() => new Map(this.camaras().map((c) => [c.id, c])));
  /** Estado por `ref` del croquis: puertas/ventanas por id de dispositivo (o su ref), cámaras por id. */
  readonly estadosPlano = computed(() => {
    const m = new Map<string, string>();
    for (const d of this.dispositivos()) {
      const e = this.estado(d);
      m.set(d.id, e);
      if (d.croquis_elemento_ref) m.set(d.croquis_elemento_ref, e);
    }
    const vivoCam = this.vivo.camaras();
    for (const c of this.camaras()) {
      const e = vivoCam.get(c.id)?.estado ?? c.estado;
      m.set(c.id, e);
      if (c.croquis_elemento_ref) m.set(c.croquis_elemento_ref, e);
    }
    return m;
  });

  // ── Asistente de integración ─────────────────────────────────────────────
  readonly integraciones = signal<Integracion[]>([]);
  readonly cargandoIntegraciones = signal(false);
  readonly categoriaFiltro = signal<string | null>(null);
  readonly integracion = signal<Integracion | null>(null);
  readonly paso = signal<1 | 2 | 3>(1);
  readonly pasosHechos = signal<Set<number>>(new Set());
  readonly categorias = computed(() => [...new Set(this.integraciones().map((i) => i.categoria))]);
  readonly integracionesFiltradas = computed(() => {
    const c = this.categoriaFiltro();
    return this.integraciones().filter((i) => !c || i.categoria === c);
  });

  constructor() {
    this.cargar();
    this.api.sedes().subscribe({
      next: (s) => {
        this.sedes.set(s);
        const conPlano = s.find((x) => !!x.oficina_ref);
        if (conPlano && !this.sedePlano()) this.sedePlano.set(conPlano.id);
      },
      error: () => {},
    });
    this.api.camaras().subscribe({ next: (c) => this.camaras.set(c), error: () => {} });
    this.api.agentes().subscribe({ next: (a) => this.agentes.set(a), error: () => {} });
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.dispositivos().subscribe({
      next: (d) => { this.dispositivos.set(d); this.cargando.set(false); this.error.set(null); },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudieron leer los dispositivos.')); },
    });
  }

  ir(v: Vista): void {
    this.vista.set(v);
    if (v === 'accesos' && !this.accesos().length) this.cargarAccesos();
    if (v === 'plano' && !this.pisos().length) this.cargarPlano();
    if (v === 'asistente' && !this.integraciones().length) this.cargarIntegraciones();
  }

  estado(d: Dispositivo): EstadoDispositivo { return this.vivo.dispositivos().get(d.id)?.estado ?? d.estado; }
  enLinea(d: Dispositivo): boolean { return this.vivo.dispositivos().get(d.id)?.en_linea ?? d.en_linea; }
  bateria(d: Dispositivo): number | null { return this.vivo.dispositivos().get(d.id)?.bateria ?? d.bateria; }

  // ── Mando ────────────────────────────────────────────────────────────────
  /**
   * Toda acción pide confirmación. Si el dispositivo exige confirmación, el motivo es obligatorio
   * (lo resuelve AccionesSeguridad, igual que en el centro de monitoreo); si no, es opcional.
   */
  async mandar(d: Dispositivo, a: AccionDispositivo): Promise<void> {
    this.enMando.set(`${d.id}|${a}`);
    try {
      if (d.requiere_confirmacion) { await this.acciones.accionar(d, a); return; }
      const r = await confirmar(this.dialog, {
        titulo: `${NOMBRE_ACCION[a]}: ${d.nombre}`, icono: ICONO_ACCION[a], boton: NOMBRE_ACCION[a],
        peligro: a === 'ABRIR' || a === 'DESBLOQUEAR' || (d.tipo === 'SIRENA' && a === 'ACTIVAR'),
        texto: `${d.sede_nombre}. La acción queda registrada con su nombre.`, motivo: 'Motivo (opcional)',
      });
      if (!r) return;
      const res = await firstValueFrom(this.api.accionDispositivo(d.id, a, r.motivo || null));
      this.acciones.aviso(res.ok ? (res.mensaje || `${NOMBRE_ACCION[a]}: hecho.`) : (res.mensaje || 'El dispositivo no respondió.'), !res.ok);
      if (res.estado) this.dispositivos.update((l) => l.map((x) => (x.id === d.id ? { ...x, estado: res.estado!, estado_en: new Date().toISOString() } : x)));
    } catch (e) {
      this.acciones.aviso(mensajeDeError(e, 'No se pudo accionar el dispositivo.'), true);
    } finally {
      this.enMando.set(null);
      if (this.historialDe()?.id === d.id) this.verHistorial(d);
    }
  }

  verHistorial(d: Dispositivo): void {
    this.historialDe.set(d);
    this.cargandoHistorial.set(true);
    this.api.accionesDispositivo(d.id).subscribe({
      next: (h) => { this.historial.set([...h].sort((a, b) => (b.creado_en || '').localeCompare(a.creado_en || ''))); this.cargandoHistorial.set(false); },
      error: (e) => { this.cargandoHistorial.set(false); this.historial.set([]); this.acciones.aviso(mensajeDeError(e, 'No se pudo leer el historial.'), true); },
    });
  }

  // ── Alta / edición manual ───────────────────────────────────────────────
  private camposBase(integracion: Integracion | null, d: Dispositivo | null): CampoForm[] {
    const tiposPermitidos = integracion?.tipos_dispositivo?.length ? integracion.tipos_dispositivo : TIPOS;
    return [
      { clave: 'sede_id', etiqueta: 'Sede', tipo: 'seleccion', requerido: true, opciones: this.sedes().map((s) => ({ valor: s.id, texto: s.nombre })) },
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, placeholder: 'Ej.: Puerta principal' },
      { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', requerido: true, opciones: tiposPermitidos.map((t) => ({ valor: t, texto: NOMBRE_TIPO_DISPOSITIVO[t] })) },
      ...(integracion ? [] : [{ clave: 'integracion', etiqueta: 'Integración', tipo: 'seleccion', requerido: true,
        opciones: (['SHELLY', 'HOME_ASSISTANT', 'MQTT', 'ZKTECO_PUSH', 'DAHUA_ALARMA', 'HIKVISION_ALARMA', 'TTLOCK', 'TUYA', 'WEBHOOK', 'AGENTE'] as const)
          .map((i) => ({ valor: i, texto: i.replace('_', ' ') })) } as CampoForm]),
      { clave: 'agente_id', etiqueta: 'Agente de sitio', tipo: 'seleccion', ayuda: 'Si el equipo solo se alcanza desde la red de la sede.',
        opciones: this.agentes().map((a) => ({ valor: a.id, texto: `${a.nombre} · ${a.sede_nombre}` })) },
      { clave: 'camara_id', etiqueta: 'Cámara que lo ve', tipo: 'seleccion', ayuda: 'Para mostrar el video junto a la alarma.',
        opciones: this.camaras().map((c) => ({ valor: c.id, texto: `${c.sede_nombre} · ${c.nombre}` })) },
      { clave: 'croquis_elemento_ref', etiqueta: 'Elemento del croquis', tipo: 'texto', ayuda: 'Id de la puerta o ventana en el plano de la oficina (opcional).' },
      { clave: 'requiere_confirmacion', etiqueta: 'Pedir motivo antes de accionarlo', tipo: 'booleano', ancho: true,
        ayuda: 'Recomendado para puertas, cerraduras y cajas fuertes: nadie abre sin dejar escrito por qué.' },
      { clave: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
      ...(d && !integracion ? [{ clave: 'config_json', etiqueta: 'Configuración (JSON)', tipo: 'area', ancho: true, seccion: 'Avanzado',
        ayuda: 'Parámetros propios de la integración.' } as CampoForm,
      { clave: 'secreto', etiqueta: 'Secreto / clave del equipo', tipo: 'clave', guardado: d.tiene_secreto } as CampoForm] : []),
    ];
  }

  async editar(d: Dispositivo): Promise<void> {
    const r = await abrirFormulario<Dispositivo>(this.dialog, {
      titulo: `Editar ${d.nombre}`, icono: this.iconoTipo[d.tipo],
      campos: this.camposBase(null, d),
      valores: { ...d, config_json: JSON.stringify(d.config ?? {}, null, 2) },
      validar: (v) => { try { JSON.parse(v['config_json'] || '{}'); return null; } catch { return 'La configuración no es un JSON válido.'; } },
      guardar: (v) => {
        const { config_json, ...resto } = v;
        return this.api.guardarDispositivo(d.id, { ...resto, config: JSON.parse(config_json || '{}') });
      },
    });
    if (r) { this.acciones.aviso('Dispositivo guardado.'); this.cargar(); }
  }

  async borrar(d: Dispositivo): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: `Borrar ${d.nombre}`, peligro: true, boton: 'Borrar', texto: 'Se borra el dispositivo; su historial de acciones queda en la auditoría.' });
    if (!ok) return;
    try { await firstValueFrom(this.api.borrarDispositivo(d.id)); this.acciones.aviso('Dispositivo borrado.'); this.cargar(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar.'), true); }
  }

  async copiarWebhook(d: Dispositivo): Promise<void> {
    if (!d.webhook_url) return;
    this.acciones.aviso(await copiarTexto(d.webhook_url) ? 'Dirección del webhook copiada.' : 'No se pudo copiar.');
  }

  // ── Marcaciones ─────────────────────────────────────────────────────────
  cargarAccesos(): void {
    this.cargandoAccesos.set(true);
    this.api.accesos({
      dispositivo_id: this.filtroDisp(),
      desde: this.filtroDesde() ? `${this.filtroDesde()}T00:00:00` : null, hasta: this.filtroHasta() ? `${this.filtroHasta()}T23:59:59` : null,
      limit: this.porPaginaAccesos(), offset: this.paginaAccesos() * this.porPaginaAccesos(),
    }).subscribe({
      next: (p) => { this.accesos.set(p.results ?? []); this.totalAccesos.set(p.count ?? 0); this.cargandoAccesos.set(false); },
      error: (e) => { this.cargandoAccesos.set(false); this.acciones.aviso(mensajeDeError(e, 'No se pudieron leer las marcaciones.'), true); },
    });
  }
  filtrarAccesos(): void { this.paginaAccesos.set(0); this.cargarAccesos(); }
  paginarAccesos(e: { pagina: number; porPagina: number }): void { this.paginaAccesos.set(e.pagina); this.porPaginaAccesos.set(e.porPagina); this.cargarAccesos(); }

  // ── Plano 3D ─────────────────────────────────────────────────────────────
  cargarPlano(id: string | null = this.sedePlano()): void {
    this.sedePlano.set(id);
    this.errorPlano.set(null);
    this.pisos.set([]);
    const sede = this.sedes().find((s) => s.id === id);
    if (!sede?.oficina_ref) return;
    this.cargandoPlano.set(true);
    this.turnos.croquis(sede.oficina_ref).subscribe({
      next: (c) => {
        this.cargandoPlano.set(false);
        if (!c) { this.errorPlano.set('La oficina de esta sede aún no tiene croquis publicado. Se dibuja en Turnos → Oficinas.'); return; }
        const pisos = leerPisos(c);
        this.pisos.set(pisos);
        this.areas.set(c.areas ?? []);
        this.meta.set(leerMetaAreas(c.elementos_json));
        this.escala.set(Number(c.escala_cm_px) || 2);
        this.pisoId.set(pisos[0]?.id ?? null);
      },
      error: (e) => { this.cargandoPlano.set(false); this.errorPlano.set(mensajeDeError(e, 'No se pudo leer el croquis de la oficina.')); },
    });
  }

  // ── Asistente ────────────────────────────────────────────────────────────
  cargarIntegraciones(): void {
    this.cargandoIntegraciones.set(true);
    this.api.integraciones().subscribe({
      next: (l) => { this.integraciones.set(l.filter((i) => i.categoria !== 'VIDEO')); this.cargandoIntegraciones.set(false); },
      error: (e) => { this.cargandoIntegraciones.set(false); this.acciones.aviso(mensajeDeError(e, 'No se pudo leer el catálogo de integraciones.'), true); },
    });
  }

  elegirIntegracion(i: Integracion): void {
    this.integracion.set(i);
    this.paso.set(2);
    this.pasosHechos.set(new Set());
  }

  marcarPaso(n: number): void {
    this.pasosHechos.update((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  }

  reiniciarAsistente(): void { this.integracion.set(null); this.paso.set(1); }

  /** Paso 3: el formulario con los campos propios de la integración. */
  async crearDesdeIntegracion(): Promise<void> {
    const i = this.integracion();
    if (!i) return;
    const camposInt = (i.campos ?? []).map(campoDeIntegracion);
    if (camposInt.length) camposInt[0] = { ...camposInt[0], seccion: `Datos de ${i.nombre}` };
    const claves = (i.campos ?? []).filter((c) => c.tipo === 'clave');
    const r = await abrirFormulario<Dispositivo>(this.dialog, {
      titulo: `Agregar ${i.nombre}`, icono: 'add_link', ancho: '720px', textoGuardar: 'Agregar dispositivo',
      descripcion: i.descripcion,
      campos: [...this.camposBase(i, null), ...camposInt],
      valores: {
        sede_id: this.sedeId() ?? this.sedes()[0]?.id ?? null, tipo: i.tipos_dispositivo?.[0] ?? null, activo: true,
        requiere_confirmacion: (i.tipos_dispositivo ?? []).some((t) => ['PUERTA', 'CERRADURA', 'CAJA_FUERTE'].includes(t)),
      },
      guardar: (v) => {
        const config: Record<string, unknown> = {};
        const secretos: Record<string, unknown> = {};
        for (const c of i.campos ?? []) {
          const val = v[`cfg_${c.clave}`];
          if (val === undefined || val === null || val === '') continue;
          if (c.tipo === 'clave') secretos[c.clave] = val; else config[c.clave] = val;
        }
        // Un solo campo secreto va tal cual; varios, como JSON (el backend lo cifra completo).
        const secreto = claves.length === 1 ? (secretos[claves[0].clave] as string | undefined)
          : Object.keys(secretos).length ? JSON.stringify(secretos) : undefined;
        return this.api.guardarDispositivo(null, {
          sede_id: v['sede_id'], nombre: v['nombre'], tipo: v['tipo'], integracion: i.id as Dispositivo['integracion'],
          agente_id: v['agente_id'] ?? null, camara_id: v['camara_id'] ?? null, croquis_elemento_ref: v['croquis_elemento_ref'] ?? null,
          requiere_confirmacion: !!v['requiere_confirmacion'], activo: v['activo'] !== false, config, secreto,
        });
      },
    });
    if (!r) return;
    const d = r as Dispositivo;
    this.cargar();
    if (d.webhook_url) {
      abrirInfo(this.dialog, {
        titulo: 'Dispositivo agregado', icono: 'task_alt',
        descripcion: `${d.nombre} quedó registrado. Configure el equipo para que avise a esta dirección cuando cambie de estado:`,
        bloques: [{ etiqueta: 'Dirección del webhook', valor: d.webhook_url }],
        nota: 'La dirección lleva un token propio: no la publique. Si se filtra, borre el dispositivo y créelo de nuevo.',
      });
    } else {
      this.acciones.aviso('Dispositivo agregado.');
    }
    this.reiniciarAsistente();
    this.vista.set('dispositivos');
  }

  async nuevoManual(): Promise<void> {
    const r = await abrirFormulario<Dispositivo>(this.dialog, {
      titulo: 'Nuevo dispositivo', icono: 'add', campos: this.camposBase(null, null),
      valores: { sede_id: this.sedeId() ?? this.sedes()[0]?.id ?? null, activo: true, integracion: 'WEBHOOK' },
      guardar: (v) => this.api.guardarDispositivo(null, { ...v, config: {} }),
    });
    if (r) { this.acciones.aviso('Dispositivo agregado.'); this.cargar(); }
  }
}
