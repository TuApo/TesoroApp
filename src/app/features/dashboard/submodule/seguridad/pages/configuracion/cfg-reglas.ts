import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { confirmar } from '../../components/dialogos/formulario-dialogo';
import { EditorHorario, HORARIO_FUERA_LABORAL } from '../../components/editor-horario/editor-horario';
import {
  Camara, Dispositivo, EstadoDispositivo, NOMBRE_ESTADO_DISPOSITIVO, NOMBRE_SEVERIDAD, NOMBRE_TIPO_REGLA, Protocolo, Regla, SEVERIDADES, Sede,
  Severidad, TipoRegla, TramoHorario, Zona,
} from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { tonoSeveridad } from '../../utils/formato';

const TIPOS: TipoRegla[] = ['INTRUSION', 'CRUCE_LINEA', 'AFORO', 'MERODEO', 'AGLOMERACION', 'ROSTRO_ALERTA', 'ROSTRO_DESCONOCIDO', 'VEHICULO',
  'SIN_SENAL', 'MANIPULACION', 'PALABRA_CLAVE', 'DISPOSITIVO'];
const AYUDA_TIPO: Record<TipoRegla, string> = {
  INTRUSION: 'Alguien (o un vehículo) entra a la zona mientras la regla está armada. Lo típico: fuera del horario laboral.',
  CRUCE_LINEA: 'Alguien cruza la línea en el sentido elegido.',
  AFORO: 'Hay más personas que la capacidad en la zona (o en toda la cámara).',
  MERODEO: 'Una persona se queda en la zona más de N segundos.',
  AGLOMERACION: 'Se juntan N personas o más en la zona.',
  ROSTRO_ALERTA: 'Aparece una persona de la lista de ALERTA.',
  ROSTRO_DESCONOCIDO: 'Aparece un rostro que no está enrolado (no se guarda su rostro).',
  VEHICULO: 'Se detecta un vehículo en la zona.',
  SIN_SENAL: 'La cámara deja de enviar video por más de N segundos.',
  MANIPULACION: 'Tapan, mueven o desenfocan la cámara.',
  PALABRA_CLAVE: 'El micrófono de la sede oye una palabra clave (Ajustes → palabras clave).',
  DISPOSITIVO: 'Un dispositivo cambia a un estado (puerta abierta, botón de pánico, humo…).',
};
const CON_ZONA: TipoRegla[] = ['INTRUSION', 'CRUCE_LINEA', 'AFORO', 'MERODEO', 'AGLOMERACION', 'VEHICULO'];
const CON_CLASES: TipoRegla[] = ['INTRUSION', 'CRUCE_LINEA', 'MERODEO', 'AGLOMERACION', 'VEHICULO'];
const CON_CAMARA: TipoRegla[] = [...CON_ZONA, 'ROSTRO_ALERTA', 'ROSTRO_DESCONOCIDO', 'SIN_SENAL', 'MANIPULACION'];
const CLASES = [{ v: 'persona', t: 'Personas' }, { v: 'vehiculo', t: 'Vehículos' }, { v: 'moto', t: 'Motos' }, { v: 'bicicleta', t: 'Bicicletas' }];
const ESTADOS_DISP: EstadoDispositivo[] = ['ALARMA', 'ABIERTO', 'CERRADO', 'DESBLOQUEADO', 'BLOQUEADO', 'ACTIVO', 'INACTIVO'];

interface Borrador {
  id: string | null; nombre: string; tipo: TipoRegla; sede_id: string | null; camara_id: string | null; zona_id: string | null;
  severidad: Severidad; protocolo_id: string | null; enfriamiento_seg: number; activo: boolean;
  clases: string[]; confianza: number; capacidad: number | null; segundos: number | null; personas: number | null;
  dispositivo_id: string | null; estado: EstadoDispositivo | null;
  otros: Record<string, unknown>;
}

/**
 * Reglas: qué dispara una alarma, dónde, con qué severidad, con qué protocolo y CUÁNDO está
 * armada (horario semanal, con tramos que cruzan la medianoche). Sin horario = siempre armada.
 */
@Component({
  selector: 'sg-cfg-reglas',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, EditorHorario, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cfg-reglas.html',
  styleUrls: ['../../styles/seguridad-comun.css', './configuracion.css'],
})
export class CfgReglas {
  private readonly api = inject(SeguridadService);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);

  readonly reglas = signal<Regla[]>([]);
  readonly sedes = signal<Sede[]>([]);
  readonly camaras = signal<Camara[]>([]);
  readonly protocolos = signal<Protocolo[]>([]);
  readonly dispositivos = signal<Dispositivo[]>([]);
  readonly zonas = signal<Zona[]>([]);
  readonly cargando = signal(true);

  readonly borrador = signal<Borrador | null>(null);
  readonly horario = signal<TramoHorario[]>([]);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly tipos = TIPOS;
  readonly nombreTipo = NOMBRE_TIPO_REGLA;
  readonly ayudaTipo = AYUDA_TIPO;
  readonly severidades = SEVERIDADES;
  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly clases = CLASES;
  readonly estadosDisp = ESTADOS_DISP;
  readonly nombreEstadoDisp = NOMBRE_ESTADO_DISPOSITIVO;

  readonly usaZona = computed(() => { const b = this.borrador(); return !!b && CON_ZONA.includes(b.tipo); });
  readonly usaClases = computed(() => { const b = this.borrador(); return !!b && CON_CLASES.includes(b.tipo); });
  readonly usaCamara = computed(() => { const b = this.borrador(); return !!b && CON_CAMARA.includes(b.tipo); });
  readonly camarasSede = computed(() => { const b = this.borrador(); return this.camaras().filter((c) => !b?.sede_id || c.sede_id === b.sede_id); });
  readonly dispositivosSede = computed(() => { const b = this.borrador(); return this.dispositivos().filter((d) => !b?.sede_id || d.sede_id === b.sede_id); });
  readonly zonasValidas = computed(() => {
    const b = this.borrador();
    if (!b) return [];
    return this.zonas().filter((z) => (b.tipo === 'CRUCE_LINEA' ? z.tipo === 'LINEA' : z.tipo === 'ZONA'));
  });

  readonly columnas: ColumnaTabla<Regla>[] = [
    { id: 'nombre', header: 'Regla', valor: (r) => r.nombre, tarjeta: 'titulo' },
    { id: 'tipo', header: 'Tipo', valor: (r) => NOMBRE_TIPO_REGLA[r.tipo], tarjeta: 'subtitulo' },
    { id: 'donde', header: 'Dónde', prioridad: 2, valor: (r) => this.donde(r) },
    { id: 'severidad', header: 'Severidad', valor: (r) => NOMBRE_SEVERIDAD[r.severidad], tarjeta: 'badge',
      badge: (r) => ({ texto: NOMBRE_SEVERIDAD[r.severidad], tono: tonoSeveridad(r.severidad) }) },
    { id: 'horario', header: 'Horario', prioridad: 2, valor: (r) => (r.horario?.length ? `${r.horario.length} tramo(s)` : '24/7') },
    { id: 'armada', header: 'Ahora', valor: (r) => (!r.activo ? 'Apagada' : r.armada_ahora ? 'Armada' : 'Desarmada'),
      badge: (r) => (!r.activo ? { texto: 'Apagada', tono: 'neutro' } : r.armada_ahora ? { texto: 'Armada', tono: 'info', icono: 'shield_lock' } : { texto: 'Desarmada', tono: 'neutro' }) },
    { id: 'protocolo', header: 'Protocolo', prioridad: 3, valor: (r) => this.protocolos().find((p) => p.id === r.protocolo_id)?.nombre ?? 'Por defecto' },
  ];
  readonly porId = (r: Regla) => r.id;

  constructor() {
    this.cargar();
    this.api.sedes().subscribe({ next: (s) => this.sedes.set(s), error: () => {} });
    this.api.camaras().subscribe({ next: (c) => this.camaras.set(c), error: () => {} });
    this.api.protocolos().subscribe({ next: (p) => this.protocolos.set(p), error: () => {} });
    this.api.dispositivos().subscribe({ next: (d) => this.dispositivos.set(d), error: () => {} });
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.reglas().subscribe({
      next: (r) => { this.reglas.set([...r].sort((a, b) => a.nombre.localeCompare(b.nombre))); this.cargando.set(false); },
      error: (e) => { this.cargando.set(false); this.acciones.aviso(mensajeDeError(e, 'No se pudieron leer las reglas.'), true); },
    });
  }

  donde(r: Regla): string {
    const c = this.camaras().find((x) => x.id === r.camara_id);
    if (c) return `${c.sede_nombre} · ${c.nombre}`;
    return this.sedes().find((s) => s.id === r.sede_id)?.nombre ?? 'Todas las sedes';
  }

  private num(v: unknown): number | null { const n = Number(v); return v === null || v === undefined || v === '' || Number.isNaN(n) ? null : n; }

  editar(r: Regla | null): void {
    this.error.set(null);
    const p = (r?.parametros ?? {}) as Record<string, unknown>;
    const { clases, confianza, capacidad, segundos, personas, dispositivo_id, estado, ...otros } = p;
    this.borrador.set({
      id: r?.id ?? null, nombre: r?.nombre ?? '', tipo: r?.tipo ?? 'INTRUSION', sede_id: r?.sede_id ?? this.sedes()[0]?.id ?? null,
      camara_id: r?.camara_id ?? null, zona_id: r?.zona_id ?? null, severidad: r?.severidad ?? 'ALTA', protocolo_id: r?.protocolo_id ?? null,
      enfriamiento_seg: r?.enfriamiento_seg ?? 120, activo: r?.activo ?? true,
      clases: Array.isArray(clases) ? (clases as string[]) : ['persona'], confianza: this.num(confianza) ?? 0.5,
      capacidad: this.num(capacidad), segundos: this.num(segundos), personas: this.num(personas),
      dispositivo_id: (dispositivo_id as string) ?? null, estado: (estado as EstadoDispositivo) ?? null, otros,
    });
    this.horario.set(r ? r.horario ?? [] : HORARIO_FUERA_LABORAL.map((t) => ({ ...t, dias: [...t.dias] })));
    this.zonas.set([]);
    if (r?.camara_id) this.cargarZonas(r.camara_id);
  }

  campo<K extends keyof Borrador>(k: K, v: Borrador[K]): void {
    const b = this.borrador();
    if (!b) return;
    const n = { ...b, [k]: v };
    if (k === 'sede_id') { n.camara_id = null; n.zona_id = null; this.zonas.set([]); }
    if (k === 'camara_id') { n.zona_id = null; this.zonas.set([]); if (v) this.cargarZonas(v as string); }
    if (k === 'tipo') n.zona_id = null;
    this.borrador.set(n);
  }

  alternarClase(c: string): void {
    const b = this.borrador();
    if (!b) return;
    this.campo('clases', b.clases.includes(c) ? b.clases.filter((x) => x !== c) : [...b.clases, c]);
  }

  private cargarZonas(camaraId: string): void {
    this.api.zonas(camaraId).subscribe({ next: (z) => this.zonas.set(z), error: () => this.zonas.set([]) });
  }

  private validar(b: Borrador): string | null {
    if (!b.nombre.trim()) return 'Póngale un nombre a la regla.';
    if (CON_CAMARA.includes(b.tipo) && !b.camara_id) return 'Elija la cámara.';
    if ((b.tipo === 'INTRUSION' || b.tipo === 'CRUCE_LINEA' || b.tipo === 'MERODEO') && !b.zona_id) {
      return b.tipo === 'CRUCE_LINEA' ? 'Elija la línea de conteo (se dibuja en la pestaña Zonas).' : 'Elija la zona (se dibuja en la pestaña Zonas).';
    }
    if (b.tipo === 'AFORO' && !b.capacidad && !this.zonas().find((z) => z.id === b.zona_id)?.capacidad) return 'Indique la capacidad (o use una zona que la tenga).';
    if (b.tipo === 'AGLOMERACION' && !b.personas) return 'Indique cuántas personas se consideran aglomeración.';
    if ((b.tipo === 'MERODEO' || b.tipo === 'SIN_SENAL') && !b.segundos) return 'Indique los segundos.';
    if (b.tipo === 'DISPOSITIVO' && (!b.dispositivo_id || !b.estado)) return 'Elija el dispositivo y el estado que dispara la alarma.';
    if (CON_CLASES.includes(b.tipo) && !b.clases.length) return 'Elija al menos un tipo de objeto a detectar.';
    return null;
  }

  async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    const m = this.validar(b);
    if (m) { this.error.set(m); return; }
    const parametros: Record<string, unknown> = { ...b.otros };
    if (CON_CLASES.includes(b.tipo)) parametros['clases'] = b.clases;
    if (CON_CAMARA.includes(b.tipo) && b.tipo !== 'SIN_SENAL') parametros['confianza'] = b.confianza;
    if (b.tipo === 'AFORO' && b.capacidad) parametros['capacidad'] = b.capacidad;
    if ((b.tipo === 'MERODEO' || b.tipo === 'SIN_SENAL') && b.segundos) parametros['segundos'] = b.segundos;
    if (b.tipo === 'AGLOMERACION' && b.personas) parametros['personas'] = b.personas;
    if (b.tipo === 'DISPOSITIVO') { parametros['dispositivo_id'] = b.dispositivo_id; parametros['estado'] = b.estado; }
    this.guardando.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.guardarRegla(b.id, {
        nombre: b.nombre.trim(), tipo: b.tipo, sede_id: b.sede_id, camara_id: CON_CAMARA.includes(b.tipo) ? b.camara_id : null,
        zona_id: CON_ZONA.includes(b.tipo) ? b.zona_id : null, severidad: b.severidad, protocolo_id: b.protocolo_id,
        enfriamiento_seg: Math.max(0, Number(b.enfriamiento_seg) || 0), activo: b.activo, parametros, horario: this.horario(),
      }));
      this.acciones.aviso('Regla guardada.');
      this.borrador.set(null);
      this.cargar();
    } catch (e) { this.error.set(mensajeDeError(e, 'No se pudo guardar la regla.')); }
    finally { this.guardando.set(false); }
  }

  async borrar(r: Regla): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: `Borrar "${r.nombre}"`, peligro: true, boton: 'Borrar', texto: 'Deja de vigilar; los eventos pasados se conservan.' });
    if (!ok) return;
    try { await firstValueFrom(this.api.borrarRegla(r.id)); this.acciones.aviso('Regla borrada.'); this.cargar(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar.'), true); }
  }

  async alternar(r: Regla): Promise<void> {
    try { await firstValueFrom(this.api.guardarRegla(r.id, { ...r, activo: !r.activo })); this.cargar(); }
    catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo cambiar la regla.'), true); }
  }
}
