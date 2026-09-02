import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  AjusteRegla, CambioDeRegla, CatalogoReglas, ConceptoRegla, ParametroTesoreria,
  Regla, SeveridadRegla, TesoreriaApiService, TipoDeRegla, TramoRegla,
} from '../../service/tesoreria-api.service';

/**
 * Parametrización de las reglas de crédito.
 *
 * <h3>Qué resuelve</h3>
 * Hasta ahora estas decisiones —los topes por antigüedad, las ventanas de espera, los
 * meses sin préstamo, los bonos por rol— estaban escritas dentro del bundle de Angular.
 * Cambiar un tope significaba tocar código, compilar y desplegar el frontend, y mientras
 * tanto nadie podía mirar en la aplicación qué política estaba vigente.
 *
 * <p>Aquí se ven todas, se editan, y sobre todo <b>se programan</b>: se puede dejar
 * cargado hoy un cambio que empieza el 1 de octubre, sin depender de que alguien se
 * acuerde ese día.
 *
 * <h3>El desglose por severidad no es cosmético</h3>
 * Una regla nueva casi nunca debe entrar bloqueando. Se estrena en ADVIERTE, se mira a
 * cuánta gente habría frenado, y solo entonces se sube a BLOQUEA. Por eso la severidad
 * está a la vista en la tabla y es lo primero que se cambia.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tesoreria-reglas',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './reglas.html',
  styleUrls: ['../../styles/tesoreria-comun.css', './reglas.css'],
})
export class ReglasTesoreria implements OnInit {

  private api = inject(TesoreriaApiService);

  readonly reglas = signal<Regla[]>([]);
  readonly catalogo = signal<CatalogoReglas | null>(null);
  readonly parametros = signal<ParametroTesoreria[]>([]);
  readonly historial = signal<CambioDeRegla[]>([]);

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);

  readonly vista = signal<'reglas' | 'parametros'>('reglas');
  readonly filtroConcepto = signal<ConceptoRegla | 'TODAS'>('TODAS');
  readonly soloVigentes = signal(false);

  /** Regla en edición. `null` = ninguna; con `codigo` vacío = alta nueva. */
  readonly editando = signal<Regla | null>(null);
  readonly viendoHistorialDe = signal<string | null>(null);

  ngOnInit(): void {
    this.cargarTodo();
  }

  // ── Datos ─────────────────────────────────────────────────────────────────

  private cargarTodo(): void {
    this.cargando.set(true);
    this.error.set(null);

    this.api.catalogoDeReglas().subscribe({
      next: c => this.catalogo.set(c),
      error: () => this.error.set('No se pudo cargar el catálogo de tipos de regla.'),
    });

    this.api.listarParametros().subscribe({
      next: p => this.parametros.set(p),
      error: () => { /* los parámetros son secundarios: la pantalla sirve sin ellos */ },
    });

    this.api.listarReglas().subscribe({
      next: r => { this.reglas.set(r); this.cargando.set(false); },
      error: () => {
        this.error.set('No se pudieron cargar las reglas. Revisa la conexión.');
        this.cargando.set(false);
      },
    });
  }

  readonly reglasFiltradas = computed(() => {
    let lista = this.reglas();
    const c = this.filtroConcepto();
    if (c !== 'TODAS') lista = lista.filter(r => r.concepto === c);
    if (this.soloVigentes()) lista = lista.filter(r => r.aplica_hoy);
    return lista;
  });

  readonly resumen = computed(() => {
    const todas = this.reglas();
    return {
      total: todas.length,
      aplicandoHoy: todas.filter(r => r.aplica_hoy).length,
      bloqueantes: todas.filter(r => r.aplica_hoy && r.severidad === 'BLOQUEA').length,
      advirtiendo: todas.filter(r => r.aplica_hoy && r.severidad === 'ADVIERTE').length,
      programadas: todas.filter(r => r.activa && !r.aplica_hoy).length,
      apagadas: todas.filter(r => !r.activa).length,
    };
  });

  tipoDe(codigo: string): TipoDeRegla | undefined {
    return this.catalogo()?.tipos.find(t => t.tipo === codigo);
  }

  // ── Edición ───────────────────────────────────────────────────────────────

  nueva(): void {
    this.editando.set({
      codigo: '', nombre: '', descripcion: '',
      concepto: 'MERCADO', tipo: 'TOPE_ANTIGUEDAD', severidad: 'ADVIERTE',
      prioridad: 100, activa: false,
      vigente_desde: null, vigente_hasta: null,
      parametros: {}, mensaje_rechazo: '',
      tramos: [], ajustes: [],
    });
  }

  editar(r: Regla): void {
    // Copia profunda: editar sobre la fila de la tabla dejaría cambios a medias visibles
    // en la lista aunque se cancele.
    this.editando.set(JSON.parse(JSON.stringify(r)));
  }

  cancelar(): void { this.editando.set(null); }

  alCambiarTipo(tipo: string): void {
    const r = this.editando();
    if (!r) return;
    const definicion = this.tipoDe(tipo);
    // Se precargan los parámetros de ejemplo solo si estaban vacíos: cambiar de tipo por
    // error no debería borrar lo que alguien ya escribió.
    const parametros = Object.keys(r.parametros ?? {}).length
      ? r.parametros
      : { ...(definicion?.parametros_ejemplo ?? {}) };
    this.editando.set({ ...r, tipo, parametros });
  }

  /** El JSON de parámetros se edita como texto: los tipos varían demasiado por regla. */
  get parametrosTexto(): string {
    const r = this.editando();
    return r ? JSON.stringify(r.parametros ?? {}, null, 2) : '{}';
  }

  set parametrosTexto(v: string) {
    const r = this.editando();
    if (!r) return;
    try {
      this.editando.set({ ...r, parametros: JSON.parse(v || '{}') });
      this.errorParametros.set(null);
    } catch {
      this.errorParametros.set('El JSON no es válido. Revisa comillas y comas.');
    }
  }

  readonly errorParametros = signal<string | null>(null);

  agregarTramo(): void {
    const r = this.editando();
    if (!r) return;
    const ultimo = r.tramos[r.tramos.length - 1];
    // El tramo nuevo arranca donde acabó el anterior: es lo que evita los huecos, que son
    // el fallo más difícil de ver (deja a una persona concreta sin tope y no se nota
    // hasta semanas después).
    const desde = ultimo?.hasta != null ? Number(ultimo.hasta) + 1 : 0;
    this.editando.set({
      ...r,
      tramos: [...r.tramos, { orden: r.tramos.length + 1, desde, hasta: null, valor: 0, etiqueta: '' }],
    });
  }

  quitarTramo(i: number): void {
    const r = this.editando();
    if (!r) return;
    this.editando.set({ ...r, tramos: r.tramos.filter((_, idx) => idx !== i) });
  }

  agregarAjuste(): void {
    const r = this.editando();
    if (!r) return;
    this.editando.set({
      ...r,
      ajustes: [...r.ajustes, {
        orden: r.ajustes.length + 1, nombre: '', tipo_sujeto: 'TODOS', sujeto: null,
        min_dias: null, max_dias: null, operacion: 'SUMA', valor: 0, excluye: null, activo: true,
      } as AjusteRegla],
    });
  }

  quitarAjuste(i: number): void {
    const r = this.editando();
    if (!r) return;
    this.editando.set({ ...r, ajustes: r.ajustes.filter((_, idx) => idx !== i) });
  }

  async guardar(): Promise<void> {
    const r = this.editando();
    if (!r) return;

    if (!r.codigo?.trim() || !r.nombre?.trim()) {
      Swal.fire({ icon: 'warning', title: 'Faltan datos',
        text: 'El código y el nombre son obligatorios.' });
      return;
    }
    if (this.errorParametros()) {
      Swal.fire({ icon: 'warning', title: 'Parámetros inválidos', text: this.errorParametros()! });
      return;
    }

    const { value: comentario, isConfirmed } = await Swal.fire({
      title: r.id ? 'Guardar cambios' : 'Crear regla',
      // El comentario es lo que dentro de seis meses explica por qué se cambió un tope.
      // Se pide siempre, y por eso queda en el historial junto al antes y el después.
      html: `<p style="text-align:left;font-size:13px;color:#5c6660;margin:0 0 10px">
               Esto cambia lo que el sistema autoriza. Deja dicho por qué: queda en el
               historial de la regla.
             </p>`,
      input: 'text',
      inputPlaceholder: 'Motivo del cambio (opcional)',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#0b6b58',
    });
    if (!isConfirmed) return;

    this.guardando.set(true);
    const cuerpo = { ...r, comentario: comentario || undefined };
    const peticion = r.id
      ? this.api.actualizarRegla(r.codigo, cuerpo)
      : this.api.crearRegla(cuerpo);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.editando.set(null);
        this.cargarTodo();
        Swal.fire({ icon: 'success', title: 'Regla guardada', timer: 1800, showConfirmButton: false });
      },
      error: e => {
        this.guardando.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudo guardar',
          text: e?.error?.error ?? 'Revisa los datos e intenta de nuevo.' });
      },
    });
  }

  async cambiarEstado(r: Regla): Promise<void> {
    const encender = !r.activa;
    const { value: comentario, isConfirmed } = await Swal.fire({
      title: encender ? `Encender «${r.nombre}»` : `Apagar «${r.nombre}»`,
      html: encender
        ? `<p style="text-align:left;font-size:13px;color:#5c6660">
             A partir de ahora esta condición se evaluará en cada solicitud.</p>`
        : `<p style="text-align:left;font-size:13px;color:#5c6660">
             Dejará de evaluarse. Nadie será rechazado por esta condición.</p>`,
      input: 'text',
      inputPlaceholder: '¿Por qué? (opcional)',
      showCancelButton: true,
      confirmButtonText: encender ? 'Encender' : 'Apagar',
      cancelButtonText: 'Volver',
      confirmButtonColor: encender ? '#0b6b58' : '#8a6420',
    });
    if (!isConfirmed) return;

    this.api.cambiarEstadoRegla(r.codigo, encender, comentario || undefined).subscribe({
      next: () => this.cargarTodo(),
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo cambiar',
        text: e?.error?.error ?? '' }),
    });
  }

  async programar(r: Regla): Promise<void> {
    const { value, isConfirmed } = await Swal.fire({
      title: `Programar «${r.nombre}»`,
      html: `
        <p style="text-align:left;font-size:13px;color:#5c6660;margin:0 0 12px">
          Deja la regla lista hoy y decide cuándo empieza a aplicar. Vacío = sin límite.
        </p>
        <label style="display:block;text-align:left;font-size:12px;font-weight:600">Aplica desde</label>
        <input id="desde" type="date" class="swal2-input" style="margin:4px 0 12px"
               value="${r.vigente_desde ?? ''}">
        <label style="display:block;text-align:left;font-size:12px;font-weight:600">Aplica hasta</label>
        <input id="hasta" type="date" class="swal2-input" style="margin:4px 0"
               value="${r.vigente_hasta ?? ''}">`,
      showCancelButton: true,
      confirmButtonText: 'Programar',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#0b6b58',
      preConfirm: () => ({
        desde: (document.getElementById('desde') as HTMLInputElement)?.value || null,
        hasta: (document.getElementById('hasta') as HTMLInputElement)?.value || null,
      }),
    });
    if (!isConfirmed || !value) return;

    this.api.programarRegla(r.codigo, value.desde, value.hasta).subscribe({
      next: () => this.cargarTodo(),
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo programar',
        text: e?.error?.error ?? '' }),
    });
  }

  async eliminar(r: Regla): Promise<void> {
    const { isConfirmed, value: comentario } = await Swal.fire({
      icon: 'warning',
      title: `Eliminar «${r.nombre}»`,
      html: `<p style="text-align:left;font-size:13px;color:#5c6660">
               Se borra la regla con sus tramos y ajustes. El historial se conserva.
               Si solo quieres que deje de aplicar, <b>apágala</b> en vez de borrarla.
             </p>`,
      input: 'text',
      inputPlaceholder: '¿Por qué se elimina?',
      inputValidator: v => (!v || !v.trim()) ? 'Di por qué se elimina' : null,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#a33328',
    });
    if (!isConfirmed) return;

    this.api.eliminarRegla(r.codigo, comentario).subscribe({
      next: () => this.cargarTodo(),
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo eliminar',
        text: e?.error?.error ?? '' }),
    });
  }

  verHistorial(r: Regla): void {
    this.viendoHistorialDe.set(r.codigo);
    this.historial.set([]);
    this.api.historialDeRegla(r.codigo).subscribe({
      next: h => this.historial.set(h),
      error: () => this.historial.set([]),
    });
  }

  cerrarHistorial(): void { this.viendoHistorialDe.set(null); }

  async editarParametro(p: ParametroTesoreria): Promise<void> {
    if (!p.editable) return;
    const { value, isConfirmed } = await Swal.fire({
      title: p.nombre,
      html: `<p style="text-align:left;font-size:13px;color:#5c6660">${p.descripcion ?? ''}</p>`,
      input: p.tipo_valor === 'BOOLEANO' ? 'select' : 'text',
      inputOptions: p.tipo_valor === 'BOOLEANO' ? { si: 'Sí', no: 'No' } : undefined,
      inputValue: p.valor,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#0b6b58',
    });
    if (!isConfirmed || value == null) return;

    this.api.actualizarParametro(p.codigo, String(value)).subscribe({
      next: () => this.api.listarParametros().subscribe(ps => this.parametros.set(ps)),
      error: e => Swal.fire({ icon: 'error', title: 'No se pudo guardar',
        text: e?.error?.error ?? '' }),
    });
  }

  // ── Presentación ──────────────────────────────────────────────────────────

  claseDeSeveridad(s: SeveridadRegla): string {
    return s === 'BLOQUEA' ? 'rojo' : s === 'ADVIERTE' ? 'ambar' : 'azul';
  }

  textoDeSeveridad(s: SeveridadRegla): string {
    return s === 'BLOQUEA' ? 'Bloquea' : s === 'ADVIERTE' ? 'Advierte' : 'Informa';
  }

  /** Lo que hace la regla ahora mismo, que no es lo mismo que si está activa. */
  estadoDe(r: Regla): { clase: string; texto: string } {
    if (!r.activa) return { clase: 'gris', texto: 'Apagada' };
    if (!r.aplica_hoy) return { clase: 'azul', texto: 'Programada' };
    return { clase: 'verde', texto: 'Aplicando' };
  }

  vigenciaDe(r: Regla): string {
    if (!r.vigente_desde && !r.vigente_hasta) return 'Sin límite';
    if (r.vigente_desde && r.vigente_hasta) return `${r.vigente_desde} → ${r.vigente_hasta}`;
    if (r.vigente_desde) return `Desde ${r.vigente_desde}`;
    return `Hasta ${r.vigente_hasta}`;
  }

  /**
   * Resumen legible de la regla, para no obligar a abrir el editor solo para saber qué
   * hace. Se arma con lo que sea que tenga: tramos, valor, meses, campos.
   */
  resumenDe(r: Regla): string {
    const p = r.parametros ?? {};
    switch (r.tipo) {
      case 'TOPE_ANTIGUEDAD': {
        const topes = r.tramos.map(t => this.pesosCortos(t.valor)).join(' · ');
        const bonos = r.ajustes.filter(a => a.activo).length;
        return `${r.tramos.length} tramos (${topes})` + (bonos ? ` · ${bonos} ajustes` : '');
      }
      case 'TOPE_FIJO':
      case 'MONTO_MAXIMO_OPERACION':
        return `Máximo ${this.pesosCortos(p['valor'])}`;
      case 'CUOTAS_MAXIMAS':
        return `Hasta ${p['valor']} cuotas`;
      case 'ANTIGUEDAD_MINIMA':
        return p['meses'] ? `Mínimo ${p['meses']} meses` : `Mínimo ${p['dias']} días`;
      case 'BLOQUEO_MES':
        return `Bloquea en ${(p['meses'] ?? []).map((m: number) => this.mes(m)).join(', ')}`;
      case 'VENTANA_INGRESO':
        return `${(p['ventanas'] ?? []).length} ventana(s) de espera`;
      case 'SIN_DEUDA_CONCEPTO':
        return `Sin deuda en ${(p['campos'] ?? []).join(', ')}`;
      case 'REQUISITO_CAMPO':
        return `${p['campo']} ${p['operador']} ${p['valor']}`;
      case 'ESTADO_PERSONA':
        return 'Activa y sin bloqueo';
      case 'PAZ_Y_SALVO_ACTIVOS':
        return p['usar_tope_padron'] ? 'Tope y paz y salvo del padrón' : 'Solo paz y salvo';
      case 'RATIO_INCAPACIDADES':
        return `Ventana de ${p['ventana_dias']} días · ${r.tramos.length} tramos de recorte`;
      default:
        return r.tipo;
    }
  }

  private pesosCortos(v: any): string {
    const n = Number(v);
    if (!isFinite(n)) return String(v ?? '—');
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  private mes(m: number): string {
    return ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
            'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m] ?? String(m);
  }

  /** Compara dos snapshots del historial y dice qué cambió, en vez de volcar el JSON. */
  diferencias(c: CambioDeRegla): string[] {
    if (!c.snapshot_antes || !c.snapshot_despues) return [];
    try {
      const antes = JSON.parse(c.snapshot_antes);
      const despues = JSON.parse(c.snapshot_despues);
      const salida: string[] = [];
      for (const clave of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
        const a = JSON.stringify(antes[clave]);
        const d = JSON.stringify(despues[clave]);
        if (a !== d) salida.push(`${clave.replace(/_/g, ' ')}: ${a ?? '—'} → ${d ?? '—'}`);
      }
      return salida;
    } catch {
      return [];
    }
  }

  trackRegla = (_: number, r: Regla) => r.codigo;
}
