import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, forkJoin } from 'rxjs';
import Swal from 'sweetalert2';

import {
  Animacion, CalendarioCelebraciones, CatalogoCelebraciones, CelebracionDelDia, DiaCelebracion, PersonaCelebradaAdmin,
  PlantillaCelebracionAdmin, Tipografia,
} from '../../../../components/celebracion/celebracion.models';
import { CelebracionService } from '../../../../components/celebracion/celebracion.service';
import { CelebracionProbadorComponent } from '../../../../components/celebracion/celebracion-probador.component';
import { CumpleanosPersonalizacionComponent } from './cumpleanos-personalizacion.component';
import { CumpleanosVistasComponent } from './cumpleanos-vistas.component';
import {
  CumpleanosUnionService, EstadoCorreo, PadronRango, cargoDesdePadron, estadoCorreo, horaEnvio, nombrePropio, normalizarCedula,
  proximoCumple, resumenCorreoDia,
} from './cumpleanos-union.service';
import {
  ConfigCumpleanos, CumpleanosDelDia, CumpleanosService, PersonaCumpleanos,
} from '../../../nomina/service/cumpleanos/cumpleanos.service';
import { FUENTES, cargarTipografia, fechaLarga, hoyBogota } from '../../../../components/celebracion/preparar';
import { armarLocal, personasDemo, publica } from '../../../../components/celebracion/demo';

/** Qué hace cada motor, en palabras de Marketing. */
export const MOTORES: Record<Animacion, { nombre: string; icono: string; ayuda: string }> = {
  CONFETI: { nombre: 'Fiesta de confeti', icono: 'celebration', ayuda: 'Cañones de confeti desde las esquinas y la foto en un aro de colores que gira.' },
  GLOBOS: { nombre: 'Globos al cielo', icono: 'air', ayuda: 'Cielo con nubes; los globos suben por delante y por detrás de la foto.' },
  FUEGOS: { nombre: 'Fuegos artificiales', icono: 'auto_awesome', ayuda: 'Noche estrellada con ciudad y fuegos de cinco tipos. La más vistosa.' },
  GALA: { nombre: 'Gala', icono: 'diamond', ayuda: 'Marco art déco que se dibuja, destellos que caen y brillo sobre la foto. Sobria.' },
  POLAROID: { nombre: 'Álbum de fotos', icono: 'photo_library', ayuda: 'Fotos tipo polaroid que caen sobre la mesa, con cinta y garabatos a mano.' },
  PASTEL: { nombre: 'Pastel y velas', icono: 'cake', ayuda: 'Aparece un pastel, se encienden las velas, se soplan y estalla el confeti.' },
};
const TIPOGRAFIAS: Record<Tipografia, string> = {
  FESTIVA: 'Festiva (redondeada)', ELEGANTE: 'Elegante (con serifa)', MANUSCRITA: 'A mano', CONDENSADA: 'Condensada', MARCA: 'La de la plataforma',
};

interface FormPersona {
  id: string | null;
  jefe_nombre: string;
  jefe_documento: string;
  fecha: string;
  nombre: string;
  cargo: string;
  documento: string;
  dedicatoria: string;
  enfoque_x: number;
  enfoque_y: number;
  tesoro: boolean;
  tuapo_web: boolean;
  foto_actual: string | null;
  archivo: File | null;
  vista_local: string | null;
  quitar_foto: boolean;
}

/** «Agregar al padrón»: alta manual en el padrón de correos (ms-payroll) de alguien celebrado. */
interface FormAlta {
  cedula: string;
  nombre: string;
  correo: string;
  fecha_nacimiento: string;
  empresa: string;
  finca: string;
  /** El día de la celebración, para avisar si el correo sale otro día. */
  celebracion: string;
  /** Ya es un alta manual (se corrige o se quita); null = nueva. */
  existente: PersonaCumpleanos | null;
}

/** La misma validación que ms-payroll. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Marketing › Carrusel del home › Cumpleaños.
 *
 * Quién se celebra cada día, con qué foto y con qué animación. La celebración le sale a todo
 * el que entra a la plataforma, una vez al día; aquí se programa, se prueba en celular y en
 * escritorio antes de que salga, y se ve cuánta gente la vio.
 */
@Component({
  selector: 'app-cumpleanos-admin',
  standalone: true,
  imports: [FormsModule, RouterLink, MatIconModule, CelebracionProbadorComponent, CumpleanosPersonalizacionComponent, CumpleanosVistasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cumpleanos-admin.component.html',
  styleUrls: ['../banners/pestanas-banners.css', './cumpleanos-admin.component.css'],
})
export class CumpleanosAdminComponent implements OnInit {
  private readonly api = inject(CelebracionService);
  private readonly union = inject(CumpleanosUnionService);
  private readonly correos = inject(CumpleanosService);
  private readonly ruta = inject(ActivatedRoute);
  /** Qué parte del módulo es esta pantalla (lo dice la ruta): el calendario o las plantillas. */
  readonly vista: 'calendario' | 'plantillas' = this.ruta.snapshot.data['vista'] === 'plantillas' ? 'plantillas' : 'calendario';

  readonly motores = MOTORES;
  readonly listaMotores = Object.keys(MOTORES) as Animacion[];
  readonly tipografias = TIPOGRAFIAS;
  readonly listaTipografias = Object.keys(TIPOGRAFIAS) as Tipografia[];
  readonly fuentes = FUENTES;

  readonly cargando = signal(true);
  readonly sinPermiso = signal(false);
  readonly calendario = signal<CalendarioCelebraciones | null>(null);
  readonly plantillas = signal<PlantillaCelebracionAdmin[]>([]);
  readonly catalogo = signal<CatalogoCelebraciones | null>(null);
  readonly verPasados = signal(false);
  readonly guardando = signal(false);
  readonly persona = signal<FormPersona | null>(null);
  readonly plantillaForm = signal<(Partial<PlantillaCelebracionAdmin> & { nueva?: boolean }) | null>(null);
  readonly probando = signal<{ base: CelebracionDelDia; textos: { titulo: string | null; mensaje: string | null } | null } | null>(null);
  readonly textosAbiertos = signal<string | null>(null);
  /** Panel «Personalizar a…» abierto. */
  readonly personalizando = signal<PersonaCelebradaAdmin | null>(null);
  private personaPedida: string | null = null;
  readonly estadosIa: Record<string, string> = {
    SOLICITADA: 'IA en cola', GENERANDO: 'IA generando', LISTA: 'IA lista: revisar', APROBADA: 'Fondo propio ✓',
  };
  /** Panel «Quién la vio» abierto (el día). */
  readonly viendoVistas = signal<DiaCelebracion | null>(null);

  // ── correo de cumpleaños (padrón de ms-payroll), unido al calendario ──────
  /** Del padrón se muestran los días de la última semana y el próximo mes. */
  static readonly DIAS_PADRON = 30;
  readonly padron = signal<PadronRango | null>(null);
  readonly cfgCorreo = signal<ConfigCumpleanos | null>(null);
  readonly activosPadron = signal<number | null>(null);
  readonly detallesPadron = signal<Record<string, CumpleanosDelDia | null>>({});
  readonly padronAbiertos = signal<ReadonlySet<string>>(new Set());
  readonly celebrando = signal<string | null>(null);
  private padronPedido: string | null = null;
  /** Formulario «Agregar al padrón» abierto. */
  readonly alta = signal<FormAlta | null>(null);
  readonly guardandoAlta = signal(false);

  readonly textoTitulo = signal('');
  readonly textoMensaje = signal('');

  readonly hoy = signal(hoyBogota());
  readonly plantillasActivas = computed(() => this.plantillas().filter((p) => p.activo));
  /**
   * Los días de la celebración MÁS los días en que alguien del padrón de correos cumple
   * (aunque nadie esté programado en la plataforma): un solo calendario para las dos cosas.
   */
  readonly todos = computed(() => {
    const c = this.calendario();
    if (!c) return [];
    const mapa = new Map(c.dias.map((d) => [d.fecha, d] as const));
    for (const f of this.padron()?.dias.keys() ?? []) if (!mapa.has(f)) mapa.set(f, diaVacio(f, this.hoy()));
    return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  });
  readonly dias = computed(() => this.todos().filter((d) => this.verPasados() || !d.pasado));
  readonly pasados = computed(() => this.todos().filter((d) => d.pasado).length);
  readonly hoyDia = computed(() => this.calendario()?.dias.find((d) => d.es_hoy) ?? null);
  readonly proximos = computed(() => (this.calendario()?.dias ?? []).filter((d) => !d.pasado && d.personas.length).length);

  ngOnInit(): void {
    this.cargar();
    // Enlaces desde el tablero y la pantalla de IA: ?nuevo=AAAA-MM-DD abre el formulario y
    // ?persona=<id> abre el panel de personalización de esa persona.
    const q = this.ruta.snapshot.queryParamMap;
    if (q.get('nuevo') !== null) this.nueva(/^\d{4}-\d{2}-\d{2}$/.test(q.get('nuevo') ?? '') ? q.get('nuevo')! : undefined);
    this.personaPedida = q.get('persona');
    // ?padron=AAAA-MM-DD (desde Correos): abre la lista del padrón de ese día.
    this.padronPedido = q.get('padron');
    // Las tipografías de las plantillas, para que las muestras se vean con su letra.
    for (const t of this.listaTipografias) void cargarTipografia(t, 4000);
  }

  cargar(): void {
    this.cargando.set(true);
    this.hoy.set(hoyBogota());
    const desde = sumarDias(this.hoy(), -30);
    const hasta = sumarDias(this.hoy(), 120);
    this.api.calendario(desde, hasta).subscribe({
      next: (c) => {
        this.calendario.set(c);
        this.cargando.set(false);
        this.cargarCorreos(c);
        if (this.personaPedida) {
          const p = c.dias.flatMap((d) => d.personas).find((x) => x.id === this.personaPedida);
          this.personaPedida = null;
          if (p) this.personalizando.set(p);
        }
      },
      error: (e: HttpErrorResponse) => { this.cargando.set(false); if (e.status === 403) this.sinPermiso.set(true); },
    });
    this.api.plantillas().subscribe({ next: (p) => this.plantillas.set(p), error: () => undefined });
    if (!this.catalogo()) this.api.catalogo().subscribe({ next: (c) => this.catalogo.set(c), error: () => undefined });
  }

  // ── correo de cumpleaños ──────────────────────────────────────────────────

  /**
   * Lo del padrón de correos para el mismo calendario: qué días cumple alguien del padrón,
   * la hora del envío y, para los días con gente celebrada que tiene cédula, el detalle (para
   * decir de cada una si le llega el correo). Pocas peticiones: una por mes + una por día.
   */
  private cargarCorreos(c: CalendarioCelebraciones): void {
    this.union.olvidar();
    const desde = sumarDias(this.hoy(), -7);
    const hasta = sumarDias(this.hoy(), CumpleanosAdminComponent.DIAS_PADRON);
    forkJoin({ rango: this.union.padronEntre(desde, hasta), cfg: this.union.config(), activos: this.union.activosEnPadron() })
      .subscribe(({ rango, cfg, activos }) => {
        this.padron.set(rango);
        this.cfgCorreo.set(cfg);
        this.activosPadron.set(activos);
        if (!rango.disponible) return;
        const conCedula = c.dias.filter((d) => rango.dias.has(d.fecha) && d.personas.some((p) => normalizarCedula(p.documento)));
        for (const d of conCedula) this.cargarDetalle(d.fecha);
        if (this.padronPedido) {
          const f = this.padronPedido;
          this.padronPedido = null;
          if (rango.dias.has(f)) { if (f < this.hoy()) this.verPasados.set(true); this.alternarPadron(f); }
        }
      });
  }

  private cargarDetalle(fecha: string, refrescar = false): void {
    this.union.delDia(fecha, refrescar).subscribe((det) => this.detallesPadron.update((m) => ({ ...m, [fecha]: det })));
  }

  padronDe(fecha: string) { return this.padron()?.dias.get(fecha) ?? null; }

  /** Ya se preguntó el detalle de ese día (null = ms-payroll no respondió). */
  consultado(fecha: string): boolean { return Object.prototype.hasOwnProperty.call(this.detallesPadron(), fecha); }

  correoDe(p: PersonaCelebradaAdmin, fecha: string): EstadoCorreo | null {
    return estadoCorreo(p.documento, fecha, this.hoy(), this.padron(), this.detallesPadron()[fecha], this.cfgCorreo());
  }

  resumenPadron(fecha: string): string {
    const d = this.padronDe(fecha);
    return d ? resumenCorreoDia(d, fecha, this.hoy(), this.cfgCorreo()) : '';
  }

  alternarPadron(fecha: string): void {
    const s = new Set(this.padronAbiertos());
    if (s.has(fecha)) s.delete(fecha);
    else { s.add(fecha); if (!(fecha in this.detallesPadron())) this.cargarDetalle(fecha); }
    this.padronAbiertos.set(s);
  }

  /** Del padrón de ese día, quién ya está en la celebración (por cédula). */
  yaCelebrado(d: DiaCelebracion, q: PersonaCumpleanos): boolean {
    const doc = normalizarCedula(q.cedula);
    return !!doc && d.personas.some((p) => normalizarCedula(p.documento) === doc);
  }

  porCelebrar(d: DiaCelebracion): PersonaCumpleanos[] {
    return (this.detallesPadron()[d.fecha]?.personas ?? []).filter((q) => q.nombre && !this.yaCelebrado(d, q));
  }

  nombrePadron(q: PersonaCumpleanos): string { return q.nombre ? nombrePropio(q.nombre) : q.cedula; }
  cargoPadron(q: PersonaCumpleanos): string | null { return cargoDesdePadron(q); }

  /** Pasa a alguien del padrón a la celebración de la plataforma (sin foto: Marketing la agrega después). */
  celebrar(q: PersonaCumpleanos, d: DiaCelebracion): void {
    if (!q.nombre) return;
    this.celebrando.set(q.cedula);
    this.api.crear({ fecha: d.fecha, nombre: nombrePropio(q.nombre), documento: q.cedula, cargo: cargoDesdePadron(q), superficies: ['TESORO'] })
      .subscribe({
        next: () => { this.celebrando.set(null); this.cargar(); },
        error: (e: HttpErrorResponse) => {
          this.celebrando.set(null);
          Swal.fire('No se pudo agregar', e.error?.error || 'Intenta de nuevo en un momento.', 'error');
        },
      });
  }

  async celebrarTodos(d: DiaCelebracion): Promise<void> {
    const lista = this.porCelebrar(d);
    if (!lista.length) return;
    const r = await Swal.fire({
      icon: 'question', title: `¿Celebrar a ${lista.length} en la plataforma?`,
      text: `Salen juntos el ${fechaLarga(d.fecha)} a todo el que entre, con sus iniciales hasta que les pongas foto.`,
      showCancelButton: true, confirmButtonText: 'Sí, celebrarlos', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.celebrando.set('*');
    let fallas = 0;
    for (const q of lista) {
      try {
        await firstValueFrom(this.api.crear({ fecha: d.fecha, nombre: nombrePropio(q.nombre!), documento: q.cedula,
          cargo: cargoDesdePadron(q), superficies: ['TESORO'] }));
      } catch { fallas++; }
    }
    this.celebrando.set(null);
    this.cargar();
    if (fallas) Swal.fire('Algunos no se agregaron', `${fallas} de ${lista.length} fallaron. Intenta de nuevo.`, 'warning');
  }

  // ── agregar al padrón de correos (alta manual) ────────────────────────────

  /**
   * Abre «Agregar al padrón» para alguien celebrado que no está en el padrón (o para corregir
   * su alta manual). La cédula y el nombre ya los tiene la celebración; se piden el correo y la
   * fecha de nacimiento completa (el año cuenta para la edad del correo).
   */
  abrirAlta(p: PersonaCelebradaAdmin, fecha: string, co: EstadoCorreo): void {
    const doc = normalizarCedula(p.documento);
    if (!doc) return;
    const e = co.accion === 'corregir' ? co.persona ?? null : null;
    this.alta.set({
      cedula: doc, nombre: e?.nombre || p.nombre, correo: e?.correo ?? '', fecha_nacimiento: e?.fecha_nacimiento ?? '',
      empresa: e?.empresa ?? '', finca: e?.finca ?? '', celebracion: fecha, existente: e,
    });
  }

  campoAlta<K extends keyof FormAlta>(k: K, v: FormAlta[K]): void {
    this.alta.update((f) => (f ? { ...f, [k]: v } : f));
  }

  correoValido(c: string): boolean { return EMAIL.test(c.trim()); }

  /** Qué día le sale el correo con la fecha escrita (null si falta). */
  proximoCorreo(f: FormAlta): string | null { return proximoCumple(f.fecha_nacimiento, this.hoy()); }

  /** El correo sale el día de su cumpleaños; si la celebración es otro día, se avisa. */
  otroDia(f: FormAlta): boolean {
    const n = f.fecha_nacimiento;
    return /^\d{4}-\d{2}-\d{2}$/.test(n) && n.slice(5) !== f.celebracion.slice(5);
  }

  async guardarAlta(): Promise<void> {
    const f = this.alta();
    if (!f || !f.nombre.trim() || !this.correoValido(f.correo) || !f.fecha_nacimiento) return;
    this.guardandoAlta.set(true);
    try {
      const p = await firstValueFrom(this.correos.altaManual({
        cedula: f.cedula, nombre: f.nombre.trim(), correo: f.correo.trim(), fecha_nacimiento: f.fecha_nacimiento,
        empresa: f.empresa || null, finca: f.finca.trim() || null,
      }));
      this.guardandoAlta.set(false);
      this.alta.set(null);
      const cuando = proximoCumple(p.fecha_nacimiento ?? f.fecha_nacimiento, this.hoy());
      // Si cumple hoy y el lote de hoy ya salió, ese envío no la incluyó: se dice ya.
      const hoyYaSalio = cuando === this.hoy()
        && !!(await firstValueFrom(this.union.delDia(this.hoy(), true)))?.ya_enviado;
      const cfg = this.cfgCorreo();
      const primer = f.nombre.trim().split(/\s+/)[0];
      const texto = hoyYaSalio
        ? `El correo de hoy ya había salido, así que este año no le llega solo: mándaselo desde Correos › Probar. Desde el próximo año le llega a ${p.correo}.`
        : `${cuando ? `Le llega el ${fechaLarga(cuando)}` : 'Le llega el día de su cumpleaños'}` +
          (cfg?.auto_activo ? ` a las ${horaEnvio(cfg)}, a ${p.correo}.`
            : cfg ? ` a ${p.correo}, pero el envío automático está apagado: solo sale si alguien lo manda a mano.` : ` a ${p.correo}.`) +
          ' El Excel de RRHH no la saca del padrón.';
      Swal.fire({ icon: hoyYaSalio ? 'warning' : 'success', title: `${primer} quedó en el padrón de correos`, text: texto });
      this.cargarCorreos(this.calendario()!);
    } catch (e) {
      this.guardandoAlta.set(false);
      const err = e as HttpErrorResponse;
      Swal.fire(err.status === 409 ? 'Ya está en el padrón' : 'No se pudo agregar', err.error?.error || 'Intenta de nuevo en un momento.',
        err.status === 409 ? 'info' : 'error');
    }
  }

  /** Quita el alta manual: deja de recibir el correo (queda inactiva en el padrón, no se borra). */
  async quitarAlta(): Promise<void> {
    const f = this.alta();
    if (!f?.existente) return;
    const r = await Swal.fire({
      icon: 'question', title: `¿Sacar a ${f.nombre.split(' ')[0]} del padrón de correos?`,
      text: 'Ya no le llegará el correo de cumpleaños. La celebración en la plataforma sigue igual.',
      showCancelButton: true, confirmButtonText: 'Sí, sacarla', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.guardandoAlta.set(true);
    try {
      await firstValueFrom(this.correos.quitarAltaManual(f.cedula));
      this.guardandoAlta.set(false);
      this.alta.set(null);
      this.cargarCorreos(this.calendario()!);
    } catch (e) {
      this.guardandoAlta.set(false);
      Swal.fire('No se pudo quitar', (e as HttpErrorResponse).error?.error || 'Intenta de nuevo en un momento.', 'error');
    }
  }

  // ── presentación ──────────────────────────────────────────────────────────

  fechaLarga(f: string): string { return fechaLarga(f); }

  relativo(f: string): string {
    const n = diasEntre(this.hoy(), f);
    if (n === 0) return 'Hoy';
    if (n === 1) return 'Mañana';
    if (n === -1) return 'Ayer';
    return n > 0 ? `En ${n} días` : `Hace ${-n} días`;
  }

  urlFoto(u: string | null | undefined): string { return this.api.urlFoto(u); }

  /** El póster horizontal del fondo animado de una plantilla (o de su juego elegido en el formulario). */
  posterDe(p: Partial<PlantillaCelebracionAdmin>): string | null {
    if (p.fondo?.imagen_h && (p.fondo_nombre === undefined || p.fondo_nombre === this.nombreFondo(p.fondo))) {
      return this.api.urlFoto(p.fondo.imagen_h);
    }
    if (!p.fondo_nombre) return null;
    return this.api.urlFoto(`/api/v1/public/marketing/celebraciones/fondos/${p.fondo_nombre}-h.jpg?v=1`);
  }

  private nombreFondo(f: { imagen_h: string }): string {
    const m = /fondos\/([a-z0-9_]+)-h\.jpg/.exec(f.imagen_h);
    return m ? m[1] : '';
  }

  /** «confeti_marca» → el nombre de la plantilla de fábrica que lo trae. */
  etiquetaFondo(f: string): string {
    return this.plantillas().find((p) => p.sistema && p.fondo_nombre === f)?.nombre ?? f.replace(/_/g, ' ');
  }

  iniciales(n: string): string {
    const p = (n || '').trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length > 2 ? 2 : 1][0] : '')).toUpperCase();
  }

  muestra(p: Partial<PlantillaCelebracionAdmin>): Record<string, string> {
    const t = (p.tipografia ?? 'FESTIVA') as Tipografia;
    const poster = this.posterDe(p);
    return {
      '--m-poster': poster ? `url("${poster}")` : 'none',
      '--m-fondo': p.color_fondo ?? '#1E44C8', '--m-fondo-2': p.color_fondo_2 ?? '#0B1640', '--m-texto': p.color_texto ?? '#FFFFFF',
      '--m-acento': p.color_acento ?? '#FFC83D', '--m-acento-2': p.color_acento_2 ?? '#5EE7FF',
      '--m-fuente': (FUENTES[t] ?? FUENTES.FESTIVA).familia,
    };
  }

  // ── probar ────────────────────────────────────────────────────────────────

  /** Lo que el servidor serviría hoy, tal cual (incluida la plantilla que toca). */
  probarHoy(): void {
    this.api.vistaPrevia({ fecha: this.hoy() }).subscribe({
      next: (d) => {
        if (!d.personas.length) {
          Swal.fire({ icon: 'info', title: 'Hoy no hay cumpleañeros',
            text: 'Te muestro cómo se vería con una persona de muestra. Agrega a alguien para hoy y vuelve a probar.' });
          const p = this.plantillasActivas()[0] ?? this.plantillas()[0];
          if (p) this.abrirProbador({ ...armarLocal({ fecha: this.hoy(), plantilla: p, personas: personasDemo(1) }) });
          return;
        }
        const dia = this.hoyDia();
        this.abrirProbador(d, dia ? { titulo: dia.titulo, mensaje: dia.mensaje } : null);
      },
      error: () => Swal.fire('No se pudo cargar la vista previa', 'Intenta de nuevo en un momento.', 'error'),
    });
  }

  probarDia(d: DiaCelebracion): void {
    const p = this.plantillas().find((x) => x.id === d.plantilla_efectiva?.id) ?? this.plantillasActivas()[0];
    if (!p) return;
    const base = armarLocal({
      fecha: d.fecha, plantilla: p, personas: d.personas.length ? d.personas : personasDemo(1),
      titulo: d.titulo, mensaje: d.mensaje,
    });
    if (!d.personas.length) base.personas = [];
    this.abrirProbador(base, { titulo: d.titulo, mensaje: d.mensaje });
  }

  probarPlantilla(p: Partial<PlantillaCelebracionAdmin>): void {
    const completa = { ...PLANTILLA_VACIA, ...p, id: p.id || 'sin-guardar' } as PlantillaCelebracionAdmin;
    const lista = p.id ? this.plantillas() : [completa, ...this.plantillas()];
    const proximo = (this.calendario()?.dias ?? []).find((d) => !d.pasado && d.personas.length);
    const base = armarLocal({ fecha: proximo?.fecha ?? this.hoy(), plantilla: completa, personas: proximo?.personas ?? [] });
    base.plantilla = publica(completa);
    this.probando.set(null);
    queueMicrotask(() => this.probando.set({ base, textos: null }));
    this.listaProbador.set(lista);
  }

  readonly listaProbador = signal<PlantillaCelebracionAdmin[] | null>(null);

  private abrirProbador(base: CelebracionDelDia, textos: { titulo: string | null; mensaje: string | null } | null = null): void {
    this.listaProbador.set(null);
    this.probando.set({ base, textos });
  }

  /** El flujo real: olvida que ya la vi hoy y el shell vuelve a preguntar como en mi primer ingreso. */
  simularIngreso(): void {
    this.api.olvidarVista().subscribe({
      next: () => {
        if (!this.hoyDia()?.personas.length) {
          Swal.fire({ icon: 'info', title: 'Listo, pero hoy no hay nadie',
            text: 'La celebración solo sale los días que hay cumpleañeros. Agrega a alguien para hoy y vuelve a intentarlo.' });
          return;
        }
        this.api.revisarAhora$.next();
      },
      error: () => Swal.fire('No se pudo reiniciar', 'Intenta de nuevo en un momento.', 'error'),
    });
  }

  // ── día ────────────────────────────────────────────────────────────────────

  elegirPlantilla(d: DiaCelebracion, id: string): void {
    this.api.guardarDia(d.fecha, { plantilla_id: id || null, titulo: d.titulo, mensaje: d.mensaje }).subscribe({
      next: () => this.cargar(),
      error: (e: HttpErrorResponse) => Swal.fire('No se pudo guardar', e.error?.error || 'Intenta de nuevo.', 'error'),
    });
  }

  abrirTextos(d: DiaCelebracion): void {
    if (this.textosAbiertos() === d.fecha) { this.textosAbiertos.set(null); return; }
    this.textosAbiertos.set(d.fecha);
    this.textoTitulo.set(d.titulo ?? '');
    this.textoMensaje.set(d.mensaje ?? '');
  }

  guardarTextos(d: DiaCelebracion): void {
    this.api.guardarDia(d.fecha, {
      plantilla_id: d.plantilla_id, titulo: this.textoTitulo().trim() || null, mensaje: this.textoMensaje().trim() || null,
    }).subscribe({
      next: () => { this.textosAbiertos.set(null); this.cargar(); },
      error: (e: HttpErrorResponse) => Swal.fire('No se pudo guardar', e.error?.error || 'Intenta de nuevo.', 'error'),
    });
  }

  // ── personas ──────────────────────────────────────────────────────────────

  nueva(fecha?: string): void {
    this.persona.set({
      id: null, jefe_nombre: '', jefe_documento: '', fecha: fecha ?? sumarDias(this.hoy(), 1), nombre: '', cargo: '', documento: '', dedicatoria: '',
      enfoque_x: 50, enfoque_y: 40, tesoro: true, tuapo_web: false, foto_actual: null, archivo: null, vista_local: null, quitar_foto: false,
    });
  }

  editar(p: PersonaCelebradaAdmin): void {
    this.persona.set({
      id: p.id, jefe_nombre: p.jefe_nombre ?? '', jefe_documento: p.jefe_documento ?? '',
      fecha: p.fecha, nombre: p.nombre, cargo: p.cargo ?? '', documento: p.documento ?? '', dedicatoria: p.dedicatoria ?? '',
      enfoque_x: p.enfoque_x, enfoque_y: p.enfoque_y, tesoro: p.superficies.includes('TESORO'), tuapo_web: p.superficies.includes('TUAPO_WEB'),
      foto_actual: p.foto_url ? this.api.urlFoto(p.foto_url) : null, archivo: null, vista_local: null, quitar_foto: false,
    });
  }

  campo<K extends keyof FormPersona>(k: K, v: FormPersona[K]): void {
    this.persona.update((f) => (f ? { ...f, [k]: v } : f));
  }

  async elegirFoto(ev: Event | DragEvent): Promise<void> {
    const archivo = ev instanceof DragEvent ? ev.dataTransfer?.files?.[0] : (ev.target as HTMLInputElement).files?.[0];
    if (ev instanceof DragEvent) ev.preventDefault();
    if (!archivo) return;
    const max = (this.catalogo()?.limites.max_foto_mb ?? 8) * 1048576;
    const minLado = this.catalogo()?.limites.min_lado_foto ?? 320;
    if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
      Swal.fire('Formato no admitido', 'Sube la foto en JPG, PNG o WEBP. Las HEIC del iPhone hay que exportarlas o tomarles captura.', 'warning');
      return;
    }
    if (archivo.size > max) {
      Swal.fire('La foto pesa mucho', `Máximo ${max / 1048576} MB. Expórtala en JPG con calidad 80.`, 'warning');
      return;
    }
    const url = URL.createObjectURL(archivo);
    const medidas = await new Promise<{ w: number; h: number }>((r) => {
      const img = new Image();
      img.onload = () => r({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => r({ w: 0, h: 0 });
      img.src = url;
    });
    if (Math.min(medidas.w, medidas.h) < minLado) {
      URL.revokeObjectURL(url);
      Swal.fire('La foto es muy pequeña', `Mide ${medidas.w} × ${medidas.h} px y se vería borrosa. Usa una de al menos ${minLado} px por lado.`, 'warning');
      return;
    }
    const previa = this.persona()?.vista_local;
    if (previa) URL.revokeObjectURL(previa);
    this.persona.update((f) => (f ? { ...f, archivo, vista_local: url, quitar_foto: false, enfoque_x: 50, enfoque_y: 40 } : f));
  }

  /** Toca la cara en la foto completa: ese punto queda en el centro del marco. */
  enfocar(ev: MouseEvent): void {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const x = Math.round(((ev.clientX - r.left) / r.width) * 100);
    const y = Math.round(((ev.clientY - r.top) / r.height) * 100);
    this.persona.update((f) => (f ? { ...f, enfoque_x: Math.max(0, Math.min(100, x)), enfoque_y: Math.max(0, Math.min(100, y)) } : f));
  }

  fotoForm(f: FormPersona): string | null {
    if (f.quitar_foto) return null;
    return f.vista_local ?? f.foto_actual;
  }

  cerrarPersona(): void {
    const v = this.persona()?.vista_local;
    if (v) URL.revokeObjectURL(v);
    this.persona.set(null);
  }

  async guardarPersona(): Promise<void> {
    const f = this.persona();
    if (!f || !f.nombre.trim()) return;
    // El backend ya admite el Portal Tu Apo (TUAPO_WEB), pero el Portal todavía no tiene el
    // lanzador: hasta que lo tenga, se conserva lo que traiga y se asegura la plataforma.
    const superficies = [f.tesoro ? 'TESORO' : '', f.tuapo_web ? 'TUAPO_WEB' : ''].filter(Boolean);
    if (!superficies.includes('TESORO')) superficies.unshift('TESORO');
    this.guardando.set(true);
    const cuerpo = {
      fecha: f.fecha, nombre: f.nombre, cargo: f.cargo, documento: f.documento, dedicatoria: f.dedicatoria,
      enfoque_x: f.enfoque_x, enfoque_y: f.enfoque_y, superficies, jefe_nombre: f.jefe_nombre, jefe_documento: f.jefe_documento,
    };
    try {
      const guardada = await firstValueFrom(f.id ? this.api.editar(f.id, cuerpo) : this.api.crear(cuerpo));
      if (f.archivo) await firstValueFrom(this.api.subirFoto(guardada.id, f.archivo));
      else if (f.quitar_foto && f.foto_actual) await firstValueFrom(this.api.quitarFoto(guardada.id));
      this.guardando.set(false);
      this.cerrarPersona();
      this.cargar();
      const sinFoto = !f.archivo && (!f.foto_actual || f.quitar_foto);
      Swal.fire({
        icon: 'success', title: f.id ? 'Cambios guardados' : `${f.nombre.split(' ')[0]} quedó programada`,
        text: `Sale el ${fechaLarga(f.fecha)} a todo el que entre a la plataforma.${sinFoto ? ' Sin foto sale con sus iniciales.' : ''}`,
        timer: 3200, showConfirmButton: false,
      });
    } catch (e) {
      this.guardando.set(false);
      const err = e as HttpErrorResponse;
      Swal.fire('No se pudo guardar', err.error?.error || 'Intenta de nuevo en un momento.', 'error');
      // Si la persona sí se creó y falló la foto, que se vea en la lista.
      this.cargar();
    }
  }

  quitar(p: PersonaCelebradaAdmin): void {
    Swal.fire({
      icon: 'question', title: `¿Quitar a ${p.primer_nombre}?`, text: `Ya no saldrá en la celebración del ${fechaLarga(p.fecha)}.`,
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.api.quitar(p.id).subscribe({ next: () => this.cargar(), error: () => Swal.fire('No se pudo quitar', 'Intenta de nuevo.', 'error') });
    });
  }

  // ── plantillas ────────────────────────────────────────────────────────────

  nuevaPlantilla(base?: PlantillaCelebracionAdmin): void {
    const b = base ?? this.plantillas()[0] ?? PLANTILLA_VACIA;
    this.plantillaForm.set({
      ...b, id: undefined, codigo: undefined, sistema: false, activo: true, nueva: true,
      nombre: base ? `${base.nombre} (variante)` : '', descripcion: base?.descripcion ?? '',
    });
  }

  editarPlantilla(p: PlantillaCelebracionAdmin): void { this.plantillaForm.set({ ...p }); }

  campoPlantilla<K extends keyof PlantillaCelebracionAdmin>(k: K, v: PlantillaCelebracionAdmin[K]): void {
    this.plantillaForm.update((p) => (p ? { ...p, [k]: v } : p));
  }

  guardarPlantilla(): void {
    const p = this.plantillaForm();
    if (!p?.nombre?.trim()) return;
    this.guardando.set(true);
    const { nueva, id, codigo, sistema, ...cuerpo } = p;
    void codigo; void sistema;
    const req = nueva || !id ? this.api.crearPlantilla(cuerpo) : this.api.editarPlantilla(id, cuerpo);
    req.subscribe({
      next: () => { this.guardando.set(false); this.plantillaForm.set(null); this.cargar(); },
      error: (e: HttpErrorResponse) => {
        this.guardando.set(false);
        Swal.fire('No se pudo guardar', e.error?.error || 'Intenta de nuevo.', 'error');
      },
    });
  }

  /** «Ver cómo queda» desde el panel: el probador con el día de esa persona. */
  probarPersona(p: PersonaCelebradaAdmin): void {
    const d = this.calendario()?.dias.find((x) => x.fecha === p.fecha);
    this.personalizando.set(null);
    if (d) this.probarDia(d);
  }

  nombreDia(d: DiaCelebracion): string {
    return d.rotacion ? `Automática · toca ${d.plantilla_efectiva?.nombre ?? '—'}` : (d.plantilla_efectiva?.nombre ?? '—');
  }
}

const PLANTILLA_VACIA: PlantillaCelebracionAdmin = {
  id: '', codigo: '', nombre: '', animacion: 'CONFETI', tipografia: 'FESTIVA',
  color_fondo: '#1E44C8', color_fondo_2: '#0B1640', color_texto: '#FFFFFF', color_acento: '#FFC83D', color_acento_2: '#5EE7FF',
  duracion_segundos: 8, titulo: '¡Feliz cumpleaños!', mensaje: 'Hoy celebramos a {{nombres}}.',
  mensaje_personal: '{{nombre}}, todo el equipo te desea un feliz cumpleaños.', orden: 500, sistema: false, activo: true,
};

/** Un día que solo existe porque alguien del padrón cumple: sin nadie programado aún. */
function diaVacio(fecha: string, hoy: string): DiaCelebracion {
  return {
    fecha, es_hoy: fecha === hoy, pasado: fecha < hoy, plantilla_id: null, plantilla_efectiva: null, rotacion: true,
    titulo: null, mensaje: null, vistas: 0, cerradas_antes: 0, personas: [],
  };
}

function sumarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n, 12));
  return f.toISOString().slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
