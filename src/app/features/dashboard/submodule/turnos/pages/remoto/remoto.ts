import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import {
  AtencionPersona, IceConfig, LecturaFormulario, PersonaContratacion, Turno, TurnoRemoto, TurnosService,
} from '../../service/turnos.service';
import { Videollamada } from '../../service/videollamada';
import { AnalisisCandidato, AnalisisIaService } from '../../../hiring/service/analisis-ia/analisis-ia.service';
import { PermissionsService } from '../../../../../../core/services/permissions.service';

interface Verificacion { etiqueta: string; ok: boolean | null; detalle: string | null; }
interface OpcionProceso { etiqueta: string; icono: string; ayuda: string; accion: () => void; primaria?: boolean; }

/**
 * Atención remota: una oficina desocupada atiende por videollamada la entrevista, la
 * selección o la contratación de alguien que espera en otra oficina.
 *
 * <p>A la izquierda, lo que espera en cualquier oficina y se puede atender de lejos. Al
 * tomar un turno la sala de esa oficina lo canta y la persona ve en su celular el botón
 * para unirse. Aquí queda la videollamada, sus datos de contratación, la validación de lo
 * que le falta, el resumen con IA del expediente y las opciones del proceso, que abren el
 * pipeline de esa persona en el mismo espacio (como caso, para volver a la llamada).
 * El turno queda marcado como remoto y con quién lo atendió: es la etiqueta que después
 * ve contratación.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-remoto',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './remoto.html',
  styleUrls: ['../../styles/turnos-comun.css', './remoto.css'],
})
export class AtencionRemota implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private analisis = inject(AnalisisIaService);
  private router = inject(Router);
  private permisos = inject(PermissionsService);
  private destroyRef = inject(DestroyRef);

  readonly cola = signal<TurnoRemoto[]>([]);
  readonly cargando = signal(false);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly soloOtras = signal(true);

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
  readonly cerrandoCon = signal<'NO_SE_PRESENTO' | 'CANCELADO' | null>(null);
  motivoCierre = '';
  readonly ahora = this.ctx.ahora;

  readonly colaVisible = computed(() => this.soloOtras() ? this.cola().filter(c => !c.es_mi_oficina) : this.cola());
  readonly enMiOficina = computed(() => this.cola().filter(c => c.es_mi_oficina).length);

  readonly verificaciones = computed<Verificacion[]>(() => {
    const t = this.turno();
    if (!t) return [];
    const p = this.persona();
    const lf = this.lectura();
    const formOk = lf ? lf.listo : (t.formulario_listo ?? null);
    const formEti = lf ? lf.etiqueta : (t.formulario_etiqueta ?? null);
    return [
      { etiqueta: 'Cédula registrada', ok: !!t.documento, detalle: t.documento ? 'CC ' + t.documento : 'El turno no trae documento' },
      { etiqueta: 'Está en contratación', ok: !!p, detalle: p ? this.estadoPersona(p) : 'No aparece en contratación: regístrela desde el pipeline' },
      { etiqueta: 'Formulario de vacantes', ok: formOk, detalle: formEti },
      { etiqueta: 'Contrato', ok: p ? !!p.contrato_activo : null, detalle: p ? (p.contrato_activo ? 'Activo' + (p.codigo_contrato ? ' · ' + p.codigo_contrato : '') : (p.contratado ? 'Contratado antes' : 'Sin contrato activo')) : null },
      { etiqueta: 'Documentos cargados', ok: p ? p.documentos > 0 : null, detalle: p ? `${p.documentos} en gestión documental` : null },
      { etiqueta: 'Vacante remitida', ok: p ? !!p.vacante_cargo : null, detalle: p?.vacante_cargo ? [p.vacante_cargo, p.vacante_empresa, p.vacante_finca].filter(Boolean).join(' · ') : (p ? 'Sin vacante' : null) },
    ];
  });

  /** Lo que se puede hacer con la persona según el trámite: abre el pipeline en el mismo espacio. */
  readonly opciones = computed<OpcionProceso[]>(() => {
    const t = this.turno();
    if (!t) return [];
    const doc = t.documento;
    const nombreSrv = (t.servicio_nombre || '').toLowerCase();
    const esSeleccion = /selec|entrevist/.test(nombreSrv);
    const esContratacion = /contrat|firma/.test(nombreSrv);
    const out: OpcionProceso[] = [];
    if (doc) {
      out.push({ etiqueta: 'Entrevista y ficha', icono: 'how_to_reg', ayuda: 'Abre Selección · Entrevista de esta persona en el pipeline', primaria: esSeleccion, accion: () => this.abrirPipeline() });
      out.push({ etiqueta: 'Contratación', icono: 'assignment_turned_in', ayuda: 'Pago y transporte, datos de obra, cédula y huella', primaria: esContratacion, accion: () => this.abrirPipeline() });
      out.push({ etiqueta: 'Documentos', icono: 'folder_copy', ayuda: 'El expediente de la persona', accion: () => this.abrirPipeline() });
    } else {
      out.push({ etiqueta: 'Registrar en contratación', icono: 'person_add', ayuda: 'El turno no trae cédula: regístrela desde el pipeline', primaria: true, accion: () => this.abrirPipeline() });
    }
    if (t.formulario_url) out.push({ etiqueta: 'Formulario de vacantes', icono: 'edit_document', ayuda: 'El enlace público para que lo complete', accion: () => window.open(t.formulario_url!, '_blank', 'noopener') });
    return out;
  });

  private sondeo: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cada turno remoto nuevo trae su persona, su formulario y su historial.
    effect(() => {
      const t = this.turno();
      untracked(() => this.alCambiarTurno(t));
    });
    this.ctx.videoSenal$.pipe(takeUntilDestroyed()).subscribe(s => {
      const t = this.turno();
      const l = this.llamada();
      if (t && l && (!s.turno_id || s.turno_id === t.id)) void l.recibir(s);
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargarCola();
    this.sondeo = setInterval(() => this.cargarCola(), 15_000);
    this.destroyRef.onDestroy(() => { if (this.sondeo) clearInterval(this.sondeo); this.llamada()?.colgar(); });
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
    if (!t) { this.llamada()?.colgar(); this.llamada.set(null); return; }
    if (t.documento) {
      this.api.buscarPersonas(t.documento).subscribe({
        next: lista => this.persona.set(lista.find(p => (p.numero_documento || '').replace(/\./g, '') === t.documento!.replace(/\./g, '')) ?? lista[0] ?? null),
        error: () => this.persona.set(null),
      });
      this.api.formularioEstado(t.documento).subscribe({ next: l => this.lectura.set(l), error: () => {} });
      this.api.atencionesDePersona(t.documento).subscribe({ next: a => this.atenciones.set(a.filter(x => x.turno_id !== t.id)), error: () => {} });
    }
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
  }

  nuevaLlamada(): void {
    this.llamada.set(null);
    void this.iniciarLlamada();
  }

  finalizar(resultado: 'ATENDIDO' | 'NO_SE_PRESENTO' | 'CANCELADO'): void {
    const t = this.turno();
    if (!t) return;
    this.correr(this.api.cerrarTurno(t.id, resultado, this.motivoCierre || null), r => {
      this.llamada()?.colgar();
      this.llamada.set(null);
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

  /** Abre el pipeline de la persona como un caso, para volver a la videollamada por la pestaña. */
  abrirPipeline(): void {
    const t = this.turno();
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
    this.analisis.analizar(t.documento, null).subscribe({
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
