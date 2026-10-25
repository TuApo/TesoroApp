import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { NgxEchartsDirective } from 'ngx-echarts';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import { AccionMasiva, ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';
import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { FichaPersona } from '../../components/ficha-persona/ficha-persona';
import {
  CorteInforme, DimensionSegmento, EstadoInforme, FilaSegmento, HistoricoUso, InformeTesoreriaApi,
  PendienteVieja, PeriodoHistorico, PeriodoUso, PersonaInforme, ResumenConcepto, SegmentoPersonas,
  SimulacionAnulacion,
} from '../../service/informe-api.service';
import { ChatIaAcceso, ContextoChatIa } from '../../../../../../shared/components/chat-ia';

type Pestana = 'capacidad' | 'uso' | 'segmentos' | 'personas';
type ListaPersonas = SegmentoPersonas | 'PENDIENTES';

interface Alerta { tono: 'critica' | 'aviso' | 'info'; titulo: string; detalle: string; }

const VERDE = '#0b6b58';
const AZUL = '#1565c0';
const AMBAR = '#c9891a';
const ROJO = '#a33328';
const GRIS = '#8a948f';

/**
 * Informe de tesorería: para mirar el estado del crédito de los activos y decidir.
 *
 * <h3>Dos fuentes, dos preguntas</h3>
 * <ul>
 *   <li><b>Capacidad</b> (pestañas Capacidad, Segmentos, Personas) sale del <i>corte</i>: la
 *       foto diaria de lo que el motor de reglas le respondería a cada activo si pidiera
 *       mercado o préstamo. Es la misma respuesta que daría la ventanilla.</li>
 *   <li><b>Uso</b> (pestaña Uso histórico) sale de las transacciones desde 2024: cuánto se
 *       ejecutó, cuánta gente, quién usó el crédito por primera vez.</li>
 * </ul>
 *
 * <h3>Para impulsar</h3>
 * La cifra a mirar es la <b>oportunidad</b>: gente con cupo de mercado aprobado que no ha
 * usado el crédito en 90 días. La lista sale en Personas → Con cupo sin usar, exportable.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tesoreria-informe',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, NgxEchartsDirective, FichaPersona, ChatIaAcceso, ...TABLA_ESTANDAR],
  providers: [provideEchartsTema()],
  templateUrl: './informe.html',
  styleUrls: ['../../styles/tesoreria-comun.css', './informe.css'],
})
export class InformeTesoreria implements OnInit {

  private api = inject(InformeTesoreriaApi);
  private sedeScope = inject(SedeScopeService);

  // ── Estado general ────────────────────────────────────────────────────────
  readonly pestana = signal<Pestana>('capacidad');
  readonly estado = signal<EstadoInforme | null>(null);
  readonly cortes = signal<CorteInforme[]>([]);
  readonly corteId = signal<number | null>(null);
  readonly cargando = signal(true);
  readonly generando = signal(false);
  readonly error = signal<string | null>(null);

  readonly corte = computed(() => this.estado()?.corte ?? null);
  readonly resumen = computed(() => this.corte()?.resumen ?? null);
  readonly nombres = computed(() => this.estado()?.nombres_reglas ?? {});
  readonly esUltimo = computed(() => {
    const c = this.corte();
    const lista = this.cortes();
    return !c || lista.length === 0 || lista[0].id === c.id;
  });

  // ── Capacidad ────────────────────────────────────────────────────────────
  readonly segCupo = signal<FilaSegmento[]>([]);
  readonly segAntiguedad = signal<FilaSegmento[]>([]);

  // ── Uso histórico ─────────────────────────────────────────────────────────
  readonly usoDesde = signal(this.primerDiaHaceMeses(12));
  readonly usoHasta = signal(this.hoy());
  readonly usoPeriodo = signal<PeriodoHistorico>('MES');
  readonly historico = signal<HistoricoUso | null>(null);
  readonly cargandoUso = signal(false);

  // ── Segmentos ─────────────────────────────────────────────────────────────
  readonly dimension = signal<DimensionSegmento>('FINCA');
  readonly segmentos = signal<FilaSegmento[]>([]);
  readonly cargandoSeg = signal(false);

  // ── Personas ──────────────────────────────────────────────────────────────
  readonly lista = signal<ListaPersonas>('OPORTUNIDAD');
  readonly motivo = signal<string>('');
  readonly personas = signal<PersonaInforme[]>([]);
  readonly pendientes = signal<PendienteVieja[]>([]);
  /** Antigüedad de «Pendientes viejas»; es también la regla de anulación aprobada el 14-oct-2026. */
  readonly diasViejas = 30;
  /** Anular en bloque libera cientos de millones de cupo: solo ADMIN y GERENCIA (el servidor lo exige igual). */
  readonly puedeAnular = this.sedeScope.tieneRol('ADMIN') || this.sedeScope.tieneRol('GERENCIA');
  readonly anulando = signal(false);
  readonly cargandoPersonas = signal(false);
  readonly fichaDoc = signal<string | null>(null);

  /** Contexto del chat de IA: el corte, la pestaña y los filtros que se ven (módulo tesoreria de ms-ai). */
  readonly contextoChat = computed<ContextoChatIa>(() => {
    const c = this.corte();
    const lista = this.lista();
    return {
      modulo: 'tesoreria.informe',
      moduloNombre: 'Tesorería › Informe',
      ruta: '/dashboard/treasury/informe',
      parametros: {
        corte_id: c?.id ?? this.corteId(),
        desde: this.usoDesde(), hasta: this.usoHasta(), periodo: this.usoPeriodo(),
        dimension: this.dimension(),
        segmento: lista === 'PENDIENTES' ? null : lista,
        documento: this.fichaDoc(),
      },
      pantalla: { pestana: this.pestana(), corte: c ? { id: c.id, resumen: this.resumen() } : null, lista, persona_abierta: this.fichaDoc() },
      sugerencias: [
        '¿Cómo está la capacidad de endeudamiento por finca?',
        '¿Quiénes tienen cupo de mercado y no lo están usando?',
        '¿Cuántas autorizaciones pendientes viejas hay y por cuánto?',
        'Hazme un informe en PDF del estado de tesorería para gerencia',
      ],
    };
  });

  private cargado = new Set<string>();

  /** Pantalla de celular: las gráficas acortan etiquetas y bajan la leyenda para no encimarse. */
  readonly angosto = signal(typeof window !== 'undefined' && window.innerWidth < 600);

  @HostListener('window:resize')
  alRedimensionar(): void {
    const a = window.innerWidth < 600;
    if (a !== this.angosto()) this.angosto.set(a);
  }

  private leyenda() {
    return this.angosto() ? { bottom: 0, type: 'scroll' } : { top: 0 };
  }

  private rejilla() {
    return this.angosto()
      ? { left: 8, right: 8, top: 16, bottom: 36, containLabel: true }
      : { left: 8, right: 8, top: 36, bottom: 8, containLabel: true };
  }

  /** En celular el nombre del eje se encima con la leyenda: se omite (el título de la tarjeta lo dice). */
  private eje(nombre: string) {
    return this.angosto() ? '' : nombre;
  }

  readonly listas: { id: ListaPersonas; texto: string; ayuda: string }[] = [
    { id: 'OPORTUNIDAD', texto: 'Con cupo sin usar', ayuda: 'Tienen cupo de mercado y no han usado el crédito en 90 días.' },
    { id: 'AGOTADOS', texto: 'Cupo agotado', ayuda: 'Elegibles cuya deuda y pendientes ya ocupan todo su tope.' },
    { id: 'SOBREENDEUDADOS', texto: 'Deuda sobre el tope', ayuda: 'Deben más que su tope de mercado.' },
    { id: 'NO_ELEGIBLES', texto: 'No elegibles', ayuda: 'Una regla les impide pedir hoy. Sin motivo: los que no pueden pedir mercado; elige un motivo para ver los de esa regla (mercado o préstamo).' },
    { id: 'BLOQUEADOS', texto: 'Bloqueados', ayuda: 'Bloqueados en tesorería.' },
    { id: 'PENDIENTES', texto: 'Pendientes viejas', ayuda: 'Autorizaciones de más de 30 días sin recoger: retienen cupo.' },
    { id: 'TODOS', texto: 'Todos los activos', ayuda: 'Todo el corte.' },
  ];
  readonly ayudaLista = computed(() => this.listas.find(l => l.id === this.lista())?.ayuda ?? '');

  ngOnInit(): void {
    this.cargarEstado(null);
    this.api.cortes().subscribe({ next: c => this.cortes.set(c), error: () => this.cortes.set([]) });
  }

  // ==================================================================
  // Carga
  // ==================================================================

  cargarEstado(corteId: number | null): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.estado(corteId).subscribe({
      next: e => {
        this.estado.set(e);
        this.corteId.set(e.corte?.id ?? null);
        this.cargando.set(false);
        // Si otra persona (o el job) está generando, la pantalla espera a que termine.
        if (e.generando && !this.generando()) { this.generando.set(true); this.esperarCorte(Date.now()); }
        this.cargado.clear();
        this.alCambiarPestana(this.pestana());
      },
      error: err => {
        this.cargando.set(false);
        this.error.set(err?.error?.error ?? 'No se pudo cargar el informe.');
      },
    });
  }

  elegirCorte(id: string): void {
    this.cargarEstado(id ? Number(id) : null);
  }

  irA(p: Pestana): void {
    this.pestana.set(p);
    this.alCambiarPestana(p);
  }

  private alCambiarPestana(p: Pestana): void {
    const clave = `${p}:${this.corteId()}`;
    if (this.cargado.has(clave)) return;
    this.cargado.add(clave);
    if (p === 'capacidad') this.cargarCapacidad();
    if (p === 'uso') this.cargarUso();
    if (p === 'segmentos') this.cargarSegmentos();
    if (p === 'personas') this.cargarPersonas();
  }

  private cargarCapacidad(): void {
    if (!this.corte()) return;
    const id = this.corteId();
    this.api.segmentos('CUPO_MERCADO', id).subscribe({ next: s => this.segCupo.set(s), error: () => this.segCupo.set([]) });
    this.api.segmentos('ANTIGUEDAD', id).subscribe({ next: s => this.segAntiguedad.set(s), error: () => this.segAntiguedad.set([]) });
  }

  cargarUso(): void {
    this.cargandoUso.set(true);
    this.api.historico(this.usoDesde(), this.usoHasta(), this.usoPeriodo()).subscribe({
      next: h => { this.historico.set(h); this.cargandoUso.set(false); },
      error: () => { this.historico.set(null); this.cargandoUso.set(false); },
    });
  }

  cargarSegmentos(): void {
    if (!this.corte()) return;
    this.cargandoSeg.set(true);
    this.api.segmentos(this.dimension(), this.corteId(), 300).subscribe({
      next: s => { this.segmentos.set(s); this.cargandoSeg.set(false); },
      error: () => { this.segmentos.set([]); this.cargandoSeg.set(false); },
    });
  }

  elegirDimension(d: DimensionSegmento): void {
    this.dimension.set(d);
    this.cargarSegmentos();
  }

  cargarPersonas(): void {
    const l = this.lista();
    this.cargandoPersonas.set(true);
    if (l === 'PENDIENTES') {
      this.api.pendientesViejas(this.diasViejas).subscribe({
        next: p => { this.pendientes.set(p); this.cargandoPersonas.set(false); },
        error: () => { this.pendientes.set([]); this.cargandoPersonas.set(false); },
      });
      return;
    }
    if (!this.corte()) { this.cargandoPersonas.set(false); return; }
    this.api.personas(l, { corteId: this.corteId(), motivo: l === 'NO_ELEGIBLES' ? this.motivo() : null }).subscribe({
      next: r => { this.personas.set(r.filas); this.cargandoPersonas.set(false); },
      error: () => { this.personas.set([]); this.cargandoPersonas.set(false); },
    });
  }

  elegirLista(l: ListaPersonas): void {
    this.lista.set(l);
    if (l !== 'NO_ELEGIBLES') this.motivo.set('');
    this.cargarPersonas();
  }

  elegirMotivo(m: string): void {
    this.motivo.set(m);
    this.cargarPersonas();
  }

  /** Desde una barra de motivos: abre la lista de no elegibles por ese motivo. */
  verMotivo(codigo: string): void {
    const agotado = codigo === 'CUPO_AGOTADO';
    this.lista.set(agotado ? 'AGOTADOS' : 'NO_ELEGIBLES');
    this.motivo.set(agotado ? '' : codigo);
    this.pestana.set('personas');
    this.cargado.add(`personas:${this.corteId()}`);
    this.cargarPersonas();
  }

  async generarCorte(): Promise<void> {
    const ok = await Swal.fire({
      icon: 'question',
      title: 'Actualizar el corte de hoy',
      html: 'Se evalúa a <b>todos los activos</b> con las reglas vigentes. Tarda alrededor de un minuto '
        + 'y puedes seguir usando la pantalla. Si ya había un corte de hoy, se reemplaza.',
      showCancelButton: true,
      confirmButtonText: 'Actualizar',
      cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;
    this.generando.set(true);
    this.api.generarCorte().subscribe({
      next: () => this.esperarCorte(Date.now()),
      error: err => {
        // 409: ya había uno en curso; se espera ese.
        if (err?.status === 409) { this.esperarCorte(Date.now()); return; }
        this.generando.set(false);
        const msg = err?.status === 403 ? 'No tienes permiso para generar el corte.'
          : err?.error?.error ?? 'No se pudo generar el corte.';
        Swal.fire({ icon: 'error', title: 'No se generó el corte', text: msg });
      },
    });
  }

  /** Consulta el estado cada 3 s hasta que el corte termine (máximo 10 minutos). */
  private esperarCorte(inicio: number): void {
    setTimeout(() => {
      this.api.estado(null).subscribe({
        next: e => {
          if (e.generando && Date.now() - inicio < 10 * 60_000) { this.esperarCorte(inicio); return; }
          this.generando.set(false);
          if (e.ultimo_error) {
            Swal.fire({ icon: 'error', title: 'El corte falló', text: e.ultimo_error });
            return;
          }
          const c = e.corte;
          Swal.fire({ icon: 'success', title: 'Corte actualizado',
            text: c ? `${this.num(c.personas_evaluadas)} activos evaluados en ${Math.round((c.duracion_ms ?? 0) / 1000)} s.` : '',
            timer: 2500, showConfirmButton: false });
          this.api.cortes().subscribe(l => this.cortes.set(l));
          this.cargarEstado(null);
        },
        error: () => this.esperarCorte(inicio),
      });
    }, 3000);
  }

  abrirFicha(doc: string): void {
    this.fichaDoc.set(doc);
  }

  // ==================================================================
  // Anular pendientes viejas
  // ==================================================================

  /**
   * «Anular todas»: vista previa del servidor → motivo → una sola llamada (un solo lote). Si
   * entre la vista previa y el clic cambió algo, el servidor responde 409 y no toca nada.
   */
  async anularTodas(): Promise<void> {
    if (this.anulando()) return;
    this.anulando.set(true);
    try {
      let sim: SimulacionAnulacion;
      try {
        sim = await firstValueFrom(this.api.simularAnulacion(this.diasViejas));
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'No se pudo calcular la vista previa', text: this.errorDe(err) });
        return;
      }
      if (!sim.autorizaciones) {
        Swal.fire({ icon: 'info', title: 'Nada que anular',
          text: `No hay autorizaciones pendientes de antes del ${sim.autorizadas_antes_de}.` });
        return;
      }
      const ok = await Swal.fire({
        icon: 'warning',
        title: `Anular ${this.num(sim.autorizaciones)} autorizaciones pendientes`,
        html: this.htmlVistaPrevia(sim),
        input: 'textarea',
        inputLabel: 'Motivo (queda escrito en cada autorización)',
        inputPlaceholder: 'Ej.: autorizaciones del sistema anterior que nunca se recogieron',
        inputValidator: v => (v ?? '').trim().length < 10 ? 'Escribe el motivo (mínimo 10 caracteres).' : null,
        showCancelButton: true,
        confirmButtonText: `Anular ${this.num(sim.autorizaciones)}`,
        cancelButtonText: 'Cancelar',
        confirmButtonColor: ROJO,
        focusCancel: true,
      });
      if (!ok.isConfirmed) return;
      try {
        const r = await firstValueFrom(this.api.anularViejas({
          dias: this.diasViejas, motivo: String(ok.value).trim(), cantidad_esperada: sim.autorizaciones,
        }));
        Swal.fire(r.anuladas
          ? { icon: 'success', title: `${this.num(r.anuladas)} autorizaciones anuladas`,
              html: `Lote <b>${r.lote}</b>. El cupo se libera ya en la ventanilla; para verlo en este informe `
                + 'pulsa <b>«Actualizar corte de hoy»</b>.' }
          : { icon: 'info', title: 'Nada que anular', text: r.mensaje ?? '' });
      } catch (err: any) {
        Swal.fire({ icon: 'error', title: err?.status === 409 ? 'Las cifras cambiaron' : 'No se anuló nada',
          text: this.errorDe(err) });
      }
      this.trasAnular();
    } finally {
      this.anulando.set(false);
    }
  }

  private htmlVistaPrevia(s: SimulacionAnulacion): string {
    const extra: string[] = [];
    if (s.en_cero) extra.push(`${this.num(s.en_cero)} en $0`);
    if (s.montos_atipicos) extra.push(`${this.num(s.montos_atipicos)} con montos imposibles (una cédula digitada en el monto)`);
    return `<p>Autorizaciones <b>pendientes</b> de antes del <b>${s.autorizadas_antes_de}</b> (más de ${s.dias} días): `
      + `<b>${this.num(s.autorizaciones)}</b> de <b>${this.num(s.personas)}</b> personas, por <b>${this.dinero(s.monto)}</b>.</p>`
      + `<p>Siguen activas <b>${this.num(s.personas_activas)}</b> de esas personas, con ${this.num(s.autorizaciones_activas)} `
      + `autorizaciones (${this.dinero(s.monto_activas)}): a ellas se les libera cupo hoy.</p>`
      + (extra.length ? `<p>Incluye ${extra.join(' y ')}.</p>` : '')
      + `<p>Van del ${s.mas_antigua ?? '—'} al ${s.mas_reciente ?? '—'}. No se borra nada: quedan <b>anuladas</b> con tu usuario, `
      + 'la fecha, el motivo y un código de lote para rastrearlas (y deshacerlo si hiciera falta).</p>';
  }

  /** Motivo de la acción sobre lo marcado; el lote agrupa todas las llamadas de esta acción. */
  private async pedirMotivo(filas: PendienteVieja[]): Promise<{ lote: string; motivo: string } | undefined> {
    const r = await Swal.fire({
      icon: 'question',
      title: 'Motivo de la anulación',
      text: `Queda escrito en cada autorización de las ${this.num(filas.length)} persona(s) marcadas.`,
      input: 'textarea',
      inputPlaceholder: 'Ej.: autorizaciones del sistema anterior que nunca se recogieron',
      inputValidator: v => (v ?? '').trim().length < 10 ? 'Escribe el motivo (mínimo 10 caracteres).' : null,
      showCancelButton: true,
      confirmButtonText: 'Seguir',
      cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return undefined;
    return { lote: this.nuevoLote(), motivo: String(r.value).trim() };
  }

  /** ANM-AAAAMMDD-HHMMSS-XXXX, el mismo formato que genera el servidor. */
  private nuevoLote(): string {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    const azar = Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
    return `ANM-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-`
      + `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${azar}`;
  }

  /** Tras anular cambian la lista y las alertas; el cupo del informe, al actualizar el corte. */
  private trasAnular(): void {
    this.cargarPersonas();
    this.api.estado(this.corteId()).subscribe({ next: e => this.estado.set(e), error: () => {} });
  }

  private errorDe(err: any): string {
    if (err?.status === 403) return 'Solo ADMIN y GERENCIA pueden anular en bloque.';
    return err?.error?.error ?? 'No hubo respuesta del servidor.';
  }

  // ==================================================================
  // Avisos
  // ==================================================================

  readonly alertas = computed<Alerta[]>(() => {
    const e = this.estado();
    if (!e) return [];
    const out: Alerta[] = [];
    const r = e.corte?.resumen;
    if (e.pendientes.viejas_30d > 0) {
      out.push({ tono: 'aviso', titulo: `${this.num(e.pendientes.viejas_30d)} autorizaciones pendientes de más de 30 días`,
        detalle: `Retienen ${this.dinero(e.pendientes.monto_viejas_30d)} de cupo de ${this.num(e.pendientes.personas_viejas_30d)} personas. `
          + `${this.num(e.pendientes.sin_vencimiento)} no tienen fecha de vencimiento, así que nunca se cierran solas. `
          + 'Revísalas en Personas → Pendientes viejas.' });
    }
    if (e.padron.activos_desactualizados > 0) {
      out.push({ tono: 'aviso', titulo: `${this.num(e.padron.activos_desactualizados)} activos no venían en la última carga de la BASE`,
        detalle: `Siguen activos con la deuda de una carga anterior (última actualización del padrón: ${e.padron.ultima_actualizacion ?? '—'}). `
          + 'Inflan el número de activos y su deuda vieja les resta cupo.' });
    }
    if (r?.reglas_omitidas?.length) {
      out.push({ tono: 'aviso', titulo: 'El corte no evaluó algunas reglas que bloquean',
        detalle: `${r.reglas_omitidas.join(', ')}: necesitan consultar otro servicio por persona. El cupo real puede ser menor.` });
    }
    if (e.pendientes.montos_atipicos > 0) {
      out.push({ tono: 'info', titulo: `${e.pendientes.montos_atipicos} autorizaciones con montos imposibles`,
        detalle: `Montos por encima de ${this.dinero(e.monto_atipico)} (probablemente cédulas digitadas en el monto). No se suman en el informe, pero sí le restan cupo a su persona.` });
    }
    return out;
  });

  // ==================================================================
  // Capacidad: gráficas
  // ==================================================================

  /**
   * Motivos por nombre visible. Mercado y préstamo tienen reglas distintas con el mismo
   * texto (p. ej. «la persona debe estar activa»): por código saldrían dos barras iguales.
   * Se guarda el código de cada concepto para abrir la lista correcta al tocar la barra.
   */
  readonly motivos = computed(() => {
    const r = this.resumen();
    type Motivo = { codigo: string; codigoPrestamo: string | null; nombre: string; mercado: number; prestamo: number };
    if (!r) return [] as Motivo[];
    const porNombre = new Map<string, Motivo>();
    const sumar = (codigo: string, n: number, concepto: 'mercado' | 'prestamo') => {
      const nombre = this.nombres()[codigo] ?? codigo;
      const m = porNombre.get(nombre) ?? { codigo, codigoPrestamo: null, nombre, mercado: 0, prestamo: 0 };
      if (concepto === 'mercado') { m.mercado += n; m.codigo = codigo; } else { m.prestamo += n; m.codigoPrestamo = codigo; if (!m.mercado) m.codigo = codigo; }
      porNombre.set(nombre, m);
    };
    Object.entries(r.mercado.motivos ?? {}).forEach(([c, n]) => sumar(c, n, 'mercado'));
    Object.entries(r.prestamo.motivos ?? {}).forEach(([c, n]) => sumar(c, n, 'prestamo'));
    return [...porNombre.values()].sort((a, b) => (b.mercado + b.prestamo) - (a.mercado + a.prestamo));
  });

  readonly opcionesMotivos = computed(() => {
    const m = [...this.motivos()].reverse();
    if (!m.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: this.leyenda(),
      grid: this.angosto() ? { left: 8, right: 16, top: 8, bottom: 36, containLabel: true }
        : { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
      xAxis: { type: 'value', splitNumber: this.angosto() ? 2 : 5 },
      yAxis: { type: 'category', data: m.map(x => this.corto(x.nombre, this.angosto() ? 20 : 34)) },
      series: [
        { name: 'Mercado', type: 'bar', data: m.map(x => x.mercado), itemStyle: { color: VERDE } },
        { name: 'Préstamo', type: 'bar', data: m.map(x => x.prestamo), itemStyle: { color: AZUL } },
      ],
    };
  });

  readonly codigosMotivos = computed(() => [...this.motivos()].reverse().map(x => x.codigo));

  clicMotivo(ev: any): void {
    const codigo = this.codigosMotivos()[ev?.dataIndex];
    if (codigo) this.verMotivo(codigo);
  }

  readonly opcionesCupo = computed(() => {
    const s = this.segCupo();
    if (!s.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => this.num(v) },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: s.map(x => x.segmento), axisLabel: { interval: 0, rotate: 20 } },
      yAxis: { type: 'value', name: 'Personas' },
      series: [{
        name: 'Personas', type: 'bar', data: s.map(x => x.personas),
        itemStyle: { color: (p: any) => p.dataIndex < 2 ? GRIS : VERDE },
        label: { show: true, position: 'top', formatter: (p: any) => this.num(p.value) },
      }],
    };
  });

  readonly opcionesAntiguedad = computed(() => {
    const s = this.segAntiguedad();
    if (!s.length) return null;
    return {
      tooltip: { trigger: 'axis' },
      legend: this.leyenda(),
      grid: this.rejilla(),
      xAxis: { type: 'category', data: s.map(x => x.segmento), axisLabel: { interval: 0, rotate: 20 } },
      yAxis: [
        { type: 'value', name: this.eje('Personas') },
        { type: 'value', name: this.eje('Usaron 90 d'), max: 100, axisLabel: { formatter: '{value} %' } },
      ],
      series: [
        { name: 'Activos', type: 'bar', data: s.map(x => x.personas), itemStyle: { color: GRIS } },
        { name: 'Con cupo de mercado', type: 'bar', data: s.map(x => x.mercado_con_cupo), itemStyle: { color: VERDE } },
        { name: '% que usó en 90 días', type: 'line', yAxisIndex: 1, smooth: true,
          data: s.map(x => x.penetracion_90d == null || x.personas < 20 ? null : +(x.penetracion_90d * 100).toFixed(1)),
          itemStyle: { color: AMBAR } },
      ],
    };
  });

  readonly cortesSerie = computed(() =>
    [...this.cortes()].filter(c => c.resumen).sort((a, b) => a.fecha_corte.localeCompare(b.fecha_corte)));

  readonly opcionesTendencia = computed(() => {
    const c = this.cortesSerie();
    if (c.length < 2) return null;
    const millones = (v: number | undefined) => v == null ? null : +(v / 1e6).toFixed(1);
    return {
      tooltip: { trigger: 'axis' },
      legend: this.leyenda(),
      grid: this.rejilla(),
      xAxis: { type: 'category', data: c.map(x => x.fecha_corte) },
      yAxis: [
        { type: 'value', name: this.eje('Millones $') },
        { type: 'value', name: this.eje('Personas') },
      ],
      series: [
        { name: 'Capacidad mercado', type: 'line', data: c.map(x => millones(x.resumen!.mercado.capacidad)), itemStyle: { color: GRIS } },
        { name: 'Cupo disponible', type: 'line', data: c.map(x => millones(x.resumen!.mercado.cupo_disponible)), itemStyle: { color: VERDE } },
        { name: 'Deuda total', type: 'line', data: c.map(x => millones(x.resumen!.deuda_total)), itemStyle: { color: ROJO } },
        { name: 'Usaron en 90 días', type: 'line', yAxisIndex: 1, data: c.map(x => x.resumen!.uso.usaron_90d), itemStyle: { color: AMBAR } },
      ],
    };
  });

  // ==================================================================
  // Uso histórico
  // ==================================================================

  readonly totalesUso = computed(() => {
    const h = this.historico();
    if (!h) return null;
    let monto = 0, ops = 0, aut = 0, anul = 0, pend = 0, nuevas = 0, mercado = 0, prestamo = 0;
    for (const p of h.periodos) {
      monto += p.total.monto_ejecutado ?? 0;
      ops += p.total.ejecutadas ?? 0;
      aut += p.total.autorizadas ?? 0;
      anul += p.total.anuladas ?? 0;
      pend += p.total.siguen_pendientes ?? 0;
      nuevas += p.total.personas_nuevas ?? 0;
      mercado += p.mercado?.monto_ejecutado ?? 0;
      prestamo += p.prestamo?.monto_ejecutado ?? 0;
    }
    const meses = h.periodos.length || 1;
    return {
      monto, ops, aut, anul, pend, nuevas, mercado, prestamo,
      ticket: ops ? monto / ops : null,
      promedioPeriodo: monto / meses,
      conversion: aut ? ops / aut : null,
    };
  });

  readonly opcionesUsoMonto = computed(() => {
    const h = this.historico();
    if (!h?.periodos.length) return null;
    const p = h.periodos;
    const m = (c?: { monto_ejecutado?: number }) => c?.monto_ejecutado ? +(c.monto_ejecutado / 1e6).toFixed(2) : 0;
    return {
      tooltip: { trigger: 'axis' },
      legend: this.leyenda(),
      grid: this.rejilla(),
      xAxis: { type: 'category', data: p.map(x => x.periodo) },
      yAxis: [{ type: 'value', name: this.eje('Millones $') }, { type: 'value', name: this.eje('Personas') }],
      series: [
        { name: 'Mercado', type: 'bar', stack: 'monto', data: p.map(x => m(x.mercado)), itemStyle: { color: VERDE } },
        { name: 'Préstamo', type: 'bar', stack: 'monto', data: p.map(x => m(x.prestamo)), itemStyle: { color: AZUL } },
        { name: 'Otro', type: 'bar', stack: 'monto', data: p.map(x => m(x.otro)), itemStyle: { color: GRIS } },
        { name: 'Personas', type: 'line', yAxisIndex: 1, smooth: true, data: p.map(x => x.total.personas ?? 0), itemStyle: { color: AMBAR } },
      ],
    };
  });

  readonly opcionesUsoPersonas = computed(() => {
    const h = this.historico();
    if (!h?.periodos.length) return null;
    const p = h.periodos;
    return {
      tooltip: { trigger: 'axis' },
      legend: this.leyenda(),
      grid: this.rejilla(),
      xAxis: { type: 'category', data: p.map(x => x.periodo) },
      yAxis: [{ type: 'value', name: this.eje('Personas') }, { type: 'value', name: this.eje('Ticket $') }],
      series: [
        { name: 'Usaron el crédito', type: 'bar', data: p.map(x => x.total.personas ?? 0), itemStyle: { color: VERDE } },
        { name: 'Por primera vez', type: 'bar', data: p.map(x => x.total.personas_nuevas ?? 0), itemStyle: { color: AMBAR } },
        { name: 'Ticket promedio', type: 'line', yAxisIndex: 1, smooth: true,
          data: p.map(x => x.total.ticket_promedio ?? null), itemStyle: { color: AZUL } },
      ],
    };
  });

  private agruparGrupos(lista: { grupo: string; monto: number; operaciones: number; personas: number }[]) {
    const m = new Map<string, { grupo: string; monto: number; operaciones: number }>();
    for (const g of lista) {
      const x = m.get(g.grupo) ?? { grupo: g.grupo, monto: 0, operaciones: 0 };
      x.monto += g.monto ?? 0;
      x.operaciones += g.operaciones ?? 0;
      m.set(g.grupo, x);
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto);
  }

  readonly opcionesSedes = computed(() => {
    const h = this.historico();
    if (!h?.por_sede.length) return null;
    const g = this.agruparGrupos(h.por_sede).slice(0, 15).reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${v} M` },
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', name: this.eje('Millones $'), splitNumber: this.angosto() ? 2 : 5 },
      yAxis: { type: 'category', data: g.map(x => this.corto(x.grupo === 'SIN SEDE' ? 'Sin sede (histórico)' : x.grupo, 24)) },
      series: [{ type: 'bar', data: g.map(x => +(x.monto / 1e6).toFixed(1)), itemStyle: { color: VERDE } }],
    };
  });

  readonly opcionesOrigen = computed(() => {
    const h = this.historico();
    if (!h?.por_origen.length) return null;
    const g = this.agruparGrupos(h.por_origen);
    return {
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${this.dinero(p.value)} (${p.percent}%)` },
      legend: { bottom: 0, type: 'scroll' },
      color: [VERDE, AMBAR, AZUL, GRIS, ROJO],
      series: [{
        type: 'pie', radius: ['40%', '68%'], center: ['50%', '45%'],
        data: g.map(x => ({ name: this.nombreOrigen(x.grupo), value: Math.round(x.monto) })),
        label: { formatter: '{d}%' },
      }],
    };
  });

  nombreOrigen(o: string): string {
    const n: Record<string, string> = {
      'SIN ORIGEN': 'Mostrador (histórico)', MOSTRADOR: 'Mostrador', FERIA: 'Feria',
      COMERCIALIZADORA: 'Comercializadora', TIENDA: 'Tienda virtual', TIENDA_ALIADA: 'Tiendas aliadas',
    };
    return n[o] ?? o;
  }

  readonly columnasUso: ColumnaTabla<PeriodoUso>[] = [
    { id: 'periodo', header: 'Periodo', valor: p => p.periodo, tarjeta: 'titulo' },
    { id: 'monto', header: 'Ejecutado', align: 'right', valor: p => p.total.monto_ejecutado ?? 0,
      formato: p => this.dinero(p.total.monto_ejecutado), copiaTexto: p => String(p.total.monto_ejecutado ?? 0) },
    { id: 'mercado', header: 'Mercado', align: 'right', prioridad: 2, valor: p => p.mercado?.monto_ejecutado ?? 0,
      formato: p => this.dinero(p.mercado?.monto_ejecutado) },
    { id: 'prestamo', header: 'Préstamo', align: 'right', prioridad: 2, valor: p => p.prestamo?.monto_ejecutado ?? 0,
      formato: p => this.dinero(p.prestamo?.monto_ejecutado) },
    { id: 'ops', header: 'Operaciones', align: 'right', valor: p => p.total.ejecutadas ?? 0, formato: p => this.num(p.total.ejecutadas) },
    { id: 'personas', header: 'Personas', align: 'right', valor: p => p.total.personas ?? 0, formato: p => this.num(p.total.personas) },
    { id: 'nuevas', header: 'Primera vez', align: 'right', prioridad: 2, valor: p => p.total.personas_nuevas ?? 0, formato: p => this.num(p.total.personas_nuevas) },
    { id: 'ticket', header: 'Ticket prom.', align: 'right', prioridad: 3, valor: p => p.total.ticket_promedio ?? 0,
      formato: p => this.dinero(p.total.ticket_promedio) },
    { id: 'aut', header: 'Autorizadas', align: 'right', prioridad: 3, valor: p => p.total.autorizadas ?? 0, formato: p => this.num(p.total.autorizadas) },
    { id: 'anul', header: 'Anuladas', align: 'right', prioridad: 3, valor: p => p.total.anuladas ?? 0, formato: p => this.num(p.total.anuladas) },
    { id: 'pend', header: 'Siguen pendientes', align: 'right', prioridad: 3, valor: p => p.total.siguen_pendientes ?? 0,
      formato: p => this.num(p.total.siguen_pendientes) },
  ];
  readonly idPeriodo = (p: PeriodoUso) => p.periodo;

  // ==================================================================
  // Segmentos
  // ==================================================================

  readonly dimensiones: { id: DimensionSegmento; texto: string }[] = [
    { id: 'FINCA', texto: 'Finca' },
    { id: 'TEMPORAL', texto: 'Temporal' },
    { id: 'ANTIGUEDAD', texto: 'Antigüedad' },
    { id: 'CUPO_MERCADO', texto: 'Tramo de cupo' },
  ];

  readonly opcionesOportunidad = computed(() => {
    const s = [...this.segmentos()].filter(x => x.oportunidad_cupo > 0)
      .sort((a, b) => b.oportunidad_cupo - a.oportunidad_cupo).slice(0, 15).reverse();
    if (!s.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: this.leyenda(),
      grid: this.angosto() ? { left: 8, right: 16, top: 8, bottom: 36, containLabel: true }
        : { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
      xAxis: { type: 'value', name: this.eje('Millones $'), splitNumber: this.angosto() ? 2 : 5 },
      yAxis: { type: 'category', data: s.map(x => this.corto(x.segmento, this.angosto() ? 16 : 26)) },
      series: [
        { name: 'Cupo sin usar (90 d)', type: 'bar', data: s.map(x => +(x.oportunidad_cupo / 1e6).toFixed(2)), itemStyle: { color: AMBAR } },
        { name: 'Cupo disponible', type: 'bar', data: s.map(x => +(x.mercado_cupo / 1e6).toFixed(2)), itemStyle: { color: VERDE } },
      ],
    };
  });

  readonly columnasSeg: ColumnaTabla<FilaSegmento>[] = [
    { id: 'segmento', header: 'Segmento', valor: s => s.segmento, tarjeta: 'titulo' },
    { id: 'personas', header: 'Activos', align: 'right', valor: s => s.personas, formato: s => this.num(s.personas) },
    { id: 'pen', header: 'Usaron 90 d', align: 'right', valor: s => s.penetracion_90d ?? 0, formato: s => this.pct(s.penetracion_90d),
      copiaTexto: s => String(s.penetracion_90d ?? '') },
    { id: 'concupo', header: 'Con cupo mercado', align: 'right', prioridad: 2, valor: s => s.mercado_con_cupo, formato: s => this.num(s.mercado_con_cupo) },
    { id: 'capacidad', header: 'Capacidad mercado', align: 'right', prioridad: 2, valor: s => s.mercado_capacidad,
      formato: s => this.dinero(s.mercado_capacidad) },
    { id: 'cupo', header: 'Cupo disponible', align: 'right', valor: s => s.mercado_cupo, formato: s => this.dinero(s.mercado_cupo) },
    { id: 'util', header: 'Utilización', align: 'right', prioridad: 2, valor: s => s.mercado_utilizacion ?? 0,
      formato: s => this.pct(s.mercado_utilizacion) },
    { id: 'opn', header: 'Sin usar (pers.)', align: 'right', prioridad: 2, valor: s => s.oportunidad_personas,
      formato: s => this.num(s.oportunidad_personas) },
    { id: 'opc', header: 'Cupo sin usar', align: 'right', valor: s => s.oportunidad_cupo, formato: s => this.dinero(s.oportunidad_cupo) },
    { id: 'prest', header: 'Con cupo préstamo', align: 'right', prioridad: 3, valor: s => s.prestamo_con_cupo, formato: s => this.num(s.prestamo_con_cupo) },
    { id: 'deuda', header: 'Deuda', align: 'right', prioridad: 3, valor: s => s.deuda, formato: s => this.dinero(s.deuda) },
    { id: 'bloq', header: 'Bloqueados', align: 'right', prioridad: 3, valor: s => s.bloqueadas, formato: s => this.num(s.bloqueadas) },
  ];
  readonly idSeg = (s: FilaSegmento) => s.segmento;

  // ==================================================================
  // Personas
  // ==================================================================

  readonly motivosNoElegible = computed(() => this.motivos()
    .filter(m => m.codigo !== 'CUPO_AGOTADO' && m.codigo !== 'SIN_TOPE'));

  readonly columnasPersonas: ColumnaTabla<PersonaInforme>[] = [
    { id: 'nombre', header: 'Nombre', valor: p => p.nombre ?? '', tarjeta: 'titulo' },
    { id: 'doc', header: 'Cédula', valor: p => p.numero_documento, tarjeta: 'subtitulo' },
    { id: 'finca', header: 'Finca', prioridad: 2, valor: p => p.finca ?? '' },
    { id: 'temporal', header: 'Temporal', prioridad: 3, valor: p => p.temporal ?? '' },
    { id: 'meses', header: 'Meses', align: 'right', prioridad: 3, valor: p => p.meses_trabajados ?? '' },
    { id: 'tope', header: 'Tope mercado', align: 'right', prioridad: 2, valor: p => p.mercado_tope ?? 0, formato: p => this.dinero(p.mercado_tope) },
    { id: 'cupo', header: 'Cupo mercado', align: 'right', valor: p => p.mercado_cupo ?? 0, formato: p => this.dinero(p.mercado_cupo) },
    { id: 'cupop', header: 'Cupo préstamo', align: 'right', prioridad: 3, valor: p => p.prestamo_cupo ?? 0, formato: p => this.dinero(p.prestamo_cupo) },
    { id: 'deuda', header: 'Deuda', align: 'right', valor: p => p.deuda_total, formato: p => this.dinero(p.deuda_total) },
    { id: 'comp', header: 'Pendiente', align: 'right', prioridad: 3, valor: p => p.comprometido, formato: p => this.dinero(p.comprometido) },
    { id: 'ultima', header: 'Último uso', prioridad: 2, valor: p => p.ultima_operacion ?? '', formato: p => p.ultima_operacion ?? 'Nunca' },
    { id: 'motivo', header: 'Motivo (mercado)', prioridad: 2, valor: p => this.textoMotivo(p.mercado_motivo),
      badge: p => p.mercado_motivo ? { texto: this.corto(this.textoMotivo(p.mercado_motivo), 30),
        tono: p.mercado_elegible ? 'warn' : 'danger' } : { texto: 'Con cupo', tono: 'ok' } },
  ];
  readonly idPersona = (p: PersonaInforme) => p.numero_documento;

  readonly columnasPendientes: ColumnaTabla<PendienteVieja>[] = [
    { id: 'nombre', header: 'Nombre', valor: p => p.nombre ?? '', tarjeta: 'titulo' },
    { id: 'doc', header: 'Cédula', valor: p => p.numero_documento, tarjeta: 'subtitulo' },
    { id: 'activo', header: 'Estado', valor: p => p.activo == null ? 'No está en el padrón' : p.activo ? 'Activo' : 'Inactivo',
      badge: p => ({ texto: p.activo == null ? 'Sin padrón' : p.activo ? 'Activo' : 'Inactivo',
        tono: p.activo ? 'ok' : 'neutro' }) },
    { id: 'n', header: 'Autorizaciones', align: 'right', valor: p => p.autorizaciones },
    { id: 'monto', header: 'Monto retenido', align: 'right', valor: p => p.monto, formato: p => this.dinero(p.monto) },
    { id: 'antigua', header: 'Más antigua', valor: p => p.mas_antigua },
    { id: 'conceptos', header: 'Conceptos', prioridad: 2, valor: p => p.conceptos },
    { id: 'atipicas', header: 'Montos imposibles', align: 'right', prioridad: 3, valor: p => p.montos_atipicos },
  ];
  readonly idPendiente = (p: PendienteVieja) => p.numero_documento;

  /**
   * Sobre las filas marcadas: una llamada por persona, todas con el mismo lote. Cada fila manda
   * cuántas autorizaciones mostraba; si cambiaron, esa persona falla (409) y las demás siguen.
   */
  readonly accionesPendientes: AccionMasiva<PendienteVieja, { lote: string; motivo: string }>[] =
    this.puedeAnular ? [{
      id: 'anular-viejas',
      etiqueta: 'Anular sus pendientes',
      icono: 'block',
      tono: 'peligro',
      preparar: filas => this.pedirMotivo(filas),
      confirmar: {
        titulo: filas => `Anular las pendientes viejas de ${this.num(filas.length)} persona(s)`,
        texto: filas => {
          const n = filas.reduce((a, f) => a + f.autorizaciones, 0);
          const m = filas.reduce((a, f) => a + (f.monto ?? 0), 0);
          return `Se anulan ${this.num(n)} autorizaciones (${this.dinero(m)}) de más de ${this.diasViejas} días sin recoger. `
            + 'No se borra nada: quedan ANULADAS con tu usuario, el motivo y un código de lote, y su cupo se libera.';
        },
        icono: 'warning',
      },
      ejecutar: (fila, ctx) => this.api.anularViejas({
        dias: this.diasViejas,
        documentos: [fila.numero_documento],
        motivo: ctx.datos!.motivo,
        cantidad_esperada: fila.autorizaciones,
        lote: ctx.datos!.lote,
      }),
      etiquetaFila: f => `${f.nombre ?? 'Sin nombre'} (${f.numero_documento})`,
      verbo: 'anulada(s)',
      alTerminar: () => this.trasAnular(),
    }] : [];

  textoMotivo(codigo: string | null): string {
    if (!codigo) return 'Con cupo';
    return this.nombres()[codigo] ?? codigo;
  }

  // ==================================================================
  // Formato
  // ==================================================================

  private fmtNum = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

  num(v: number | null | undefined): string {
    return v == null ? '—' : this.fmtNum.format(v);
  }

  dinero(v: number | null | undefined): string {
    return v == null ? '—' : '$\u00a0' + this.fmtNum.format(Math.round(v));
  }

  /** $ 1.234 M / $ 12,4 mil M: para las cifras grandes de las tarjetas. */
  compacto(v: number | null | undefined): string {
    if (v == null) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return '$\u00a0' + (v / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 2 }) + '\u00a0mil\u00a0M';
    if (a >= 1e6) return '$\u00a0' + (v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '\u00a0M';
    return this.dinero(v);
  }

  pct(v: number | null | undefined): string {
    return v == null ? '—' : (v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '\u00a0%';
  }

  proporcion(parte: number | null | undefined, total: number | null | undefined): string {
    if (!total || parte == null) return '—';
    return this.pct(parte / total);
  }

  concepto(r: ResumenConcepto | undefined | null) {
    return r ?? null;
  }

  corto(s: string, n: number): string {
    return s && s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  private hoy(): string {
    return this.fecha(new Date());
  }

  private primerDiaHaceMeses(meses: number): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - meses);
    return this.fecha(d);
  }

  private fecha(d: Date): string {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  rangoRapido(meses: number | 'todo'): void {
    this.usoDesde.set(meses === 'todo' ? '2024-01-01' : this.primerDiaHaceMeses(meses));
    this.usoHasta.set(this.hoy());
    this.cargarUso();
  }
}
