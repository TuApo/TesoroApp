import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { ETIQUETA_ROSTRO, ETIQUETA_VISITA, Tablero, Tarea, Visita } from '../../campo.models';
import { AvisoUbicacionComponent } from '../../components/aviso-ubicacion/aviso-ubicacion.component';
import { MapaCampoComponent } from '../../components/mapa-campo/mapa-campo.component';
import { CampoApiService } from '../../services/campo-api.service';
import { PersonalService } from '../../services/personal.service';
import { CoordinadoresFormulariosService } from '../../../coordinadores/services/coordinadores-formularios.service';
import { PlacementService } from '../../../dynamic-forms/services/placement.service';
import { DynamicFormService } from '../../../dynamic-forms/services/dynamic-form.service';
import { FormulariosOfflineService } from '../../../dynamic-forms/services/formularios-offline.service';
import { CampoService, haceCuanto, horaCorta, mensajeDe } from '../../services/campo.service';
import { distanciaM, esNativo, plataforma } from '../../services/dispositivo';

/** Un acceso del inicio. */
interface Acceso { ruta: string; icono: string; nombre: string; detalle: string; soloSupervisa?: boolean; soloAdmin?: boolean }

const ACCESOS: readonly Acceso[] = [
  { ruta: '/dashboard/campo/personal', icono: 'groups', nombre: 'Mi personal', detalle: 'Tu gente, también sin señal' },
  { ruta: '/dashboard/campo/radio', icono: 'settings_input_antenna', nombre: 'Radio', detalle: 'Pulsa para hablar con el equipo' },
  { ruta: '/dashboard/campo/agenda', icono: 'calendar_month', nombre: 'Agenda', detalle: 'Visitas programadas' },
  { ruta: '/dashboard/campo/tareas', icono: 'task_alt', nombre: 'Tareas', detalle: 'Lo que te asignaron' },
  { ruta: '/dashboard/campo/mapa', icono: 'map', nombre: 'Mapa en vivo', detalle: 'Dónde está cada coordinador', soloSupervisa: true },
  { ruta: '/dashboard/campo/revision', icono: 'how_to_reg', nombre: 'Revisión', detalle: 'Selfies y alertas de marcación', soloSupervisa: true },
  { ruta: '/dashboard/campo/equipo', icono: 'account_tree', nombre: 'Equipo', detalle: 'Jerarquía y zonas', soloSupervisa: true },
  { ruta: '/dashboard/campo/fincas', icono: 'agriculture', nombre: 'Fincas y QR', detalle: 'Ubicación, geocerca y carteles', soloSupervisa: true },
  { ruta: '/dashboard/campo/historico', icono: 'history', nombre: 'Histórico de visitas', detalle: 'Informes diarios desde 2023' },
  { ruta: '/dashboard/campo/indicadores', icono: 'insights', nombre: 'Formularios', detalle: 'Indicadores y pendientes' },
];

/**
 * Inicio de Coordinadores (`/dashboard/coordinadores`): la jornada del coordinador de
 * campo, pensada para el teléfono y para trabajar sin señal.
 *
 *  · Arriba, lo único que importa al llegar a una finca: registrar llegada o salida.
 *  · Hoy: las visitas programadas (con "cómo llegar") y las tareas pendientes.
 *  · Estado del teléfono: señal, lo que espera por enviarse y si el mapa de sus fincas ya
 *    está descargado para usarlo sin internet.
 *  · Supervisores y administración ven además el resumen en vivo de su equipo.
 */
@Component({
  selector: 'app-inicio-campo',
  standalone: true,
  imports: [MatIconModule, RouterLink, DecimalPipe, MapaCampoComponent, AvisoUbicacionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inicio-campo.component.html',
  styleUrls: ['../../campo-ui.css', './inicio-campo.component.css'],
})
export class InicioCampoComponent {
  readonly campo = inject(CampoService);
  private readonly api = inject(CampoApiService);
  private readonly destroy = inject(DestroyRef);
  readonly personal = inject(PersonalService);
  readonly formsOffline = inject(FormulariosOfflineService);
  private readonly formsMenu = inject(CoordinadoresFormulariosService);
  private readonly placement = inject(PlacementService);
  private readonly forms = inject(DynamicFormService);

  /** Paso en curso de «descargar todo» (null = quieto). */
  readonly preparando = signal<string | null>(null);
  readonly formulariosGuardados = signal(0);

  readonly tablero = signal<Tablero | null>(null);
  readonly descargando = signal<{ hechos: number; total: number } | null>(null);
  readonly mosaicos = signal(0);
  readonly avisoDescarga = signal<string | null>(null);
  readonly ahora = signal(Date.now());

  readonly etiquetaVisita = ETIQUETA_VISITA;
  readonly etiquetaRostro = ETIQUETA_ROSTRO;
  readonly horaCorta = horaCorta;

  readonly saludo = computed(() => {
    const h = Number(new Intl.DateTimeFormat('es-CO', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' }).format(this.ahora()));
    const nombre = (this.campo.paquete()?.nombre ?? '').split(' ')[0];
    const parte = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    return nombre ? `${parte}, ${capital(nombre)}` : parte;
  });

  readonly fecha = computed(() => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' })
    .format(this.ahora()));

  readonly abierta = this.campo.marcacionAbierta;

  readonly fincaAbierta = computed(() => {
    const a = this.abierta();
    if (!a) return null;
    return this.campo.fincas().find(f => f.id === a.finca_id)?.nombre ?? ('finca_nombre' in a ? a.finca_nombre : null) ?? 'la finca';
  });

  readonly accesos = computed(() => ACCESOS.filter(a => !a.soloSupervisa || this.campo.supervisa()));

  readonly visitasHoy = computed(() => {
    const p = this.campo.ultimaPosicion();
    return this.campo.agendaHoy().map(v => ({
      ...v,
      distanciaKm: p && v.finca_lat != null && v.finca_lon != null ? distanciaM(p.lat, p.lon, v.finca_lat, v.finca_lon) / 1000 : null,
    }));
  });

  readonly pendientesCola = computed(() => this.campo.cola().length);
  readonly conError = computed(() => this.campo.cola().filter(e => e.error).length);
  readonly paqueteHace = computed(() => haceCuanto(this.campo.paquete()?.generado_ms));

  readonly mapaListo = computed(() => this.mosaicos() > 30);

  /** Llegadas de hoy del equipo (supervisión). */
  readonly llegadasHoy = computed(() => {
    const t = this.tablero();
    if (!t) return [];
    const inicio = inicioDeHoyMs();
    return t.personas.filter(p => p.ultima_marcacion && p.ultima_marcacion.capturado_ms >= inicio)
      .sort((a, b) => b.ultima_marcacion!.capturado_ms - a.ultima_marcacion!.capturado_ms).slice(0, 8);
  });

  readonly marcadoresEquipo = computed(() => (this.tablero()?.personas ?? [])
    .filter(p => p.lat != null && p.lon != null)
    .map(p => ({
      id: p.usuario_id, lat: p.lat!, lon: p.lon!, tipo: 'persona' as const, iniciales: iniciales(p.nombre), etiqueta: p.nombre,
      color: p.conexion === 'EN_LINEA' ? '#16A34A' : p.conexion === 'RECIENTE' ? '#65A30D' : '#DC2626',
      tenue: p.conexion === 'SIN_SENAL', pulso: p.conexion === 'EN_LINEA',
    })));

  readonly encuadreEquipo = computed<[number, number][] | null>(() => {
    const l = this.marcadoresEquipo().map(m => [m.lat, m.lon] as [number, number]);
    return l.length ? l : null;
  });

  constructor() {
    this.campo.iniciar();
    this.formsOffline.iniciar();
    void this.personal.cargarLocal();
    void this.formsOffline.formulariosGuardados().then(l => this.formulariosGuardados.set(l.length));
    void MapaCampoComponent.mosaicosGuardados().then(n => this.mosaicos.set(n));
    const reloj = setInterval(() => this.ahora.set(Date.now()), 60_000);
    this.destroy.onDestroy(() => clearInterval(reloj));
    void this.campo.esperar().then(() => this.cargarTablero());
    const sub = this.campo.eventos$.subscribe(e => {
      if (e.nombre === 'campo-marcacion' && this.campo.supervisa()) void this.cargarTablero();
    });
    this.destroy.onDestroy(() => sub.unsubscribe());
  }

  async cargarTablero(): Promise<void> {
    if (!this.campo.supervisa() || !this.campo.enLinea()) return;
    try { this.tablero.set(await firstValueFrom(this.api.tablero())); } catch { /* el resto del inicio sigue */ }
  }

  async actualizar(): Promise<void> {
    await this.campo.sincronizar();
    await this.campo.refrescar();
    await this.cargarTablero();
  }

  /** Abre la app de mapas del teléfono con la ruta a la finca. */
  comoLlegar(v: Visita): void {
    if (v.finca_lat == null || v.finca_lon == null) return;
    const destino = `${v.finca_lat},${v.finca_lon}`;
    if (esNativo() && plataforma() === 'android') {
      window.location.href = `geo:${destino}?q=${destino}(${encodeURIComponent(v.finca_nombre)})`;
      return;
    }
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destino}`, '_blank', 'noopener');
  }

  async hecha(t: Tarea): Promise<void> {
    await this.campo.cerrarTarea(t.id, 'HECHA');
  }

  /** Baja el mapa alrededor de sus fincas y de su agenda para verlo sin señal. */
  async descargarMapa(): Promise<void> {
    const p = this.campo.paquete();
    if (!p || this.descargando()) return;
    const puntos = new Map<string, [number, number]>();
    for (const f of p.fincas) if (f.mia && f.lat != null && f.lon != null) puntos.set(`f${f.id}`, [f.lat, f.lon]);
    for (const v of p.agenda) if (v.finca_lat != null && v.finca_lon != null) puntos.set(`f${v.finca_id}`, [v.finca_lat, v.finca_lon]);
    const pos = this.campo.ultimaPosicion();
    if (pos) puntos.set('yo', [pos.lat, pos.lon]);
    if (!puntos.size) { this.avisoDescarga.set('Tus fincas aún no están ubicadas en el mapa: pídele a tu supervisor que las ubique.'); return; }
    this.avisoDescarga.set(null);
    this.descargando.set({ hechos: 0, total: 1 });
    try {
      const nuevos = await MapaCampoComponent.descargarZona(p.config.tiles_url, [...puntos.values()], 2.5, [11, 12, 13, 14, 15, 16],
        p.config.tiles_max_descarga || 600, (h, t) => this.descargando.set({ hechos: h, total: t }));
      this.mosaicos.set(await MapaCampoComponent.mosaicosGuardados());
      this.avisoDescarga.set(nuevos ? `Listo: ${nuevos} partes nuevas del mapa guardadas en el teléfono.` : 'El mapa de tus fincas ya estaba guardado.');
    } catch (e) {
      this.avisoDescarga.set(mensajeDe(e, 'No se pudo descargar el mapa'));
    } finally {
      this.descargando.set(null);
    }
  }

  /**
   * Deja el teléfono listo para la jornada sin señal: paquete de campo (fincas, agenda,
   * tareas), lista del personal, los formularios del menú (ruta + estructura) y el mapa.
   */
  async prepararSinSenal(): Promise<void> {
    if (this.preparando() || !this.campo.enLinea()) return;
    try {
      this.preparando.set('Fincas, agenda y tareas…');
      await this.campo.sincronizar();
      await this.campo.refrescar();
      this.preparando.set('Tu personal…');
      await this.personal.descargar();
      const lista = this.formsMenu.formulariosDelMenu().formularios;
      let n = 0;
      for (const f of lista) {
        this.preparando.set(`Formularios ${++n}/${lista.length}…`);
        const r = await firstValueFrom(this.placement.resolveRoute(f.rutaRelativa)).catch(() => null);
        const id = (r as any)?.form_id;
        if (!id) continue;
        const st = await firstValueFrom(this.forms.structure(id)).catch(() => null);
        if (st) await this.formsOffline.guardarEstructura(st);
      }
      this.formulariosGuardados.set((await this.formsOffline.formulariosGuardados()).length);
      this.preparando.set('Mapa de tus fincas…');
      await this.descargarMapa();
      this.avisoDescarga.set('Listo: puedes trabajar sin señal. Lo que hagas se enviará solo al volver la conexión.');
    } finally {
      this.preparando.set(null);
    }
  }

  hace(ms: number | null | undefined): string { return haceCuanto(ms); }
  iniciales(n: string): string { return iniciales(n); }
}

function capital(s: string): string { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; }

function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function inicioDeHoyMs(): number {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  return Date.parse(`${hoy}T00:00:00-05:00`);
}
