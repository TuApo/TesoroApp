import {
  Component, Inject, OnInit, signal, computed, inject, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { firstValueFrom, take } from 'rxjs';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';

import { swalEnDialogo } from '@/app/shared/utils/swal-en-dialogo';

import {
  CandidatoPorVacanteItem,
  RegistroProcesoContratacion,
} from '../../../hiring/service/registro-proceso-contratacion/registro-proceso-contratacion';
import {
  EtapaConResultado,
  ResultadoEtapa,
  payloadResultadoEtapa,
  pedirResultadoEtapa,
} from '../../../hiring/components/resultado-etapa/resultado-etapa.dialog';
import { HomeService } from '../../../home/service/home.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';

export interface CumplimientoDialogData {
  publicacionId: number;
  cargo?: string | null;
  finca?: string | null;
  empresa?: string | null;
  /** Área de la vacante (Publicacion.area). */
  area?: string | null;
  /** Auxilio de transporte de la vacante ('Si' | 'No'). */
  auxilio_transporte?: string | null;
  /** ¿La vacante tiene ruta? ('Si' | 'No'), derivado de las oficinas que contratan. */
  ruta?: string | null;
  req?: number;
  firm?: number;
  cumpl?: number;
}

@Component({
  selector: 'app-cumplimiento-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatMenuModule,
  ],
  templateUrl: './cumplimiento-dialog.component.html',
  styleUrl: './cumplimiento-dialog.component.css',
})
export class CumplimientoDialogComponent implements OnInit {
  private readonly gc = inject(RegistroProcesoContratacion);
  private readonly homeService = inject(HomeService);
  private readonly util = inject(UtilityServiceService);
  private readonly dialog = inject(MatDialog);

  /** Empresa fija para el formato BMC. */
  private readonly BMC_COMPANY = 'TU ALIANZA SAS';
  /** NIT del proveedor del contratista, fijo para BMC. */
  private readonly BMC_PROVEEDOR = '900864596';

  loading = signal<boolean>(true);
  working = signal<boolean>(false);
  candidatos = signal<CandidatoPorVacanteItem[]>([]);
  /**
   * Procesos seleccionados (clave = `proceso_id`).
   *
   * Antes la clave era `numero_documento`. Como la misma persona puede
   * tener varias filas de Candidato —y por tanto varios procesos— marcar
   * una casilla marcaba TODAS las suyas, y "Quitar vacante" desasignaba
   * procesos que el usuario nunca marcó. El proceso es lo que de verdad
   * se está seleccionando.
   */
  private readonly seleccion = signal<Set<string>>(new Set<string>());

  seleccionCount = computed(() => this.seleccion().size);
  total = computed(() => this.candidatos().length);
  allSelected = computed(() => this.total() > 0 && this.seleccionCount() === this.total());
  someSelected = computed(() => this.seleccionCount() > 0 && !this.allSelected());

  constructor(
    public dialogRef: MatDialogRef<CumplimientoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CumplimientoDialogData,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  /**
   * Carga la lista de candidatos de la vacante.
   * @param silent si es true no muestra el estado "Cargando…" (refresco en
   *   segundo plano tras una acción optimista, para no parpadear la tabla).
   */
  private cargar(silent = false): void {
    if (!silent) this.loading.set(true);
    this.gc.getCandidatosPorVacante(this.data.publicacionId)
      .pipe(take(1))
      .subscribe({
        next: (rows) => {
          this.candidatos.set(Array.isArray(rows) ? rows : []);
          // Mantener sólo selecciones que sigan presentes.
          const vivas = new Set(this.candidatos().map((c) => String(c.proceso_id)));
          const sel = new Set([...this.seleccion()].filter((c) => vivas.has(c)));
          this.seleccion.set(sel);
          this.loading.set(false);
        },
        error: () => {
          if (!silent) this.candidatos.set([]);
          this.loading.set(false);
          if (!silent) Swal.fire({ ...swalEnDialogo(), title: 'Error', text: 'No se pudieron cargar los candidatos de la vacante.', icon: 'error' });
        },
      });
  }

  // ───────── Selección ─────────
  isSelected(c: CandidatoPorVacanteItem): boolean {
    return this.seleccion().has(String(c.proceso_id));
  }

  toggle(c: CandidatoPorVacanteItem, checked: boolean): void {
    const sel = new Set(this.seleccion());
    const key = String(c.proceso_id);
    if (checked) sel.add(key); else sel.delete(key);
    this.seleccion.set(sel);
  }

  toggleAll(checked: boolean): void {
    this.seleccion.set(checked ? new Set(this.candidatos().map((c) => String(c.proceso_id))) : new Set());
  }

  /** Candidatos sobre los que actúan los botones: seleccionados, o todos si no hay selección. */
  private objetivo(): CandidatoPorVacanteItem[] {
    const sel = this.seleccion();
    if (!sel.size) return this.candidatos();
    return this.candidatos().filter((c) => sel.has(String(c.proceso_id)));
  }

  nombreMostrar(c: CandidatoPorVacanteItem): string {
    if (c.apellidos_nombres) return c.apellidos_nombres;
    const ap = [c.primer_apellido, c.segundo_apellido].filter(Boolean).join(' ').trim();
    const no = [c.primer_nombre, c.segundo_nombre].filter(Boolean).join(' ').trim();
    return [ap, no].filter(Boolean).join(', ') || '—';
  }

  /** Nombre legible en orden natural y capitalizado: "Elizabeth Sotelo Sarmiento". */
  nombreBonito(c: CandidatoPorVacanteItem): string {
    const parts = [c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido]
      .map((p) => this.titleCase(p))
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
    return this.titleCase(this.nombreMostrar(c)) || '—';
  }

  /** Iniciales para el avatar (primer nombre + primer apellido). */
  iniciales(c: CandidatoPorVacanteItem): string {
    const a = (c.primer_nombre || c.primer_apellido || '').trim();
    const b = (c.primer_apellido || c.segundo_nombre || '').trim();
    const f = a ? a[0] : '';
    const s = b && b !== a ? b[0] : '';
    return (f + s).toUpperCase() || '?';
  }

  /** Clase de color del chip de etapa. */
  etapaClass(etapa: string | null | undefined): string {
    const e = (etapa || '').toLowerCase();
    if (e.includes('no pas')) return 'etapa-nopaso';
    if (e.includes('no se present')) return 'etapa-nopresento';   // antes de 'prueba'
    if (e.includes('ingres')) return 'etapa-ingreso';
    if (e.includes('contrat')) return 'etapa-contratado';
    if (e.includes('exam')) return 'etapa-examenes';
    if (e.includes('autoriz')) return 'etapa-autorizado';
    if (e.includes('prueba')) return 'etapa-prueba';
    if (e.includes('entrevist')) return 'etapa-entrevistado';
    if (e.includes('pre')) return 'etapa-prereg';
    return 'etapa-asignado';
  }

  /** Tooltip con fecha + motivo de "no pasó la prueba técnica". */
  noPasoTooltip(c: CandidatoPorVacanteItem): string {
    const partes: string[] = [];
    if (c.no_paso_prueba_tecnica_at) partes.push(`Fecha: ${this.fmtFecha(c.no_paso_prueba_tecnica_at)}`);
    if (c.motivo_no_paso_prueba_tecnica) partes.push(`Motivo: ${c.motivo_no_paso_prueba_tecnica}`);
    return partes.join('\n') || 'No pasó la prueba técnica';
  }

  // ───────── Resultado de prueba técnica / examen médico ─────────
  // Se registra desde aquí con el MISMO diálogo del pipeline (mismo texto,
  // mismos campos, motivo obligatorio en "no pasó" y "no se presentó").

  /** Resultado ya registrado de la etapa, para precargar el diálogo. */
  resultadoDe(c: CandidatoPorVacanteItem, etapa: EtapaConResultado): ResultadoEtapa | 'sin_resultado' {
    if (etapa === 'prueba') {
      if (c.no_paso_prueba_tecnica === true) return 'no_paso';
      if (c.no_se_presento_prueba_tecnica === true) return 'no_se_presento';
      if ((c as any).paso_prueba_tecnica === true) return 'paso';
      return 'sin_resultado';
    }
    if (c.no_paso_examen_medico === true) return 'no_paso';
    if (c.no_se_presento_examen_medico === true) return 'no_se_presento';
    if (c.paso_examen_medico === true) return 'paso';
    return 'sin_resultado';
  }

  etiquetaResultado(c: CandidatoPorVacanteItem, etapa: EtapaConResultado): string {
    switch (this.resultadoDe(c, etapa)) {
      case 'paso': return 'Pasó';
      case 'no_paso': return 'No pasó';
      case 'no_se_presento': return 'No se presentó';
      default: return 'Sin resultado';
    }
  }

  /** Color del botón según el resultado, para leerlo de un vistazo. */
  claseResultado(c: CandidatoPorVacanteItem, etapa: EtapaConResultado): string {
    switch (this.resultadoDe(c, etapa)) {
      case 'paso': return 'res-ok';
      case 'no_paso': return 'res-mal';
      case 'no_se_presento': return 'res-noshow';
      default: return 'res-vacio';
    }
  }

  /**
   * Ambos resultados se pueden registrar SIEMPRE.
   *
   * Antes se ofrecían solo si la persona estaba en esa etapa, y eso dejaba en
   * "—" a los que ya iban más adelante (un contratado no podía corregir el
   * resultado de su examen). Son marcadores de outcome: no avanzan ni bloquean
   * el pipeline, así que no hay razón para esconderlos.
   */
  puedeRegistrar(_c: CandidatoPorVacanteItem, _etapa: EtapaConResultado): boolean {
    return true;
  }

  async registrarResultado(c: CandidatoPorVacanteItem, etapa: EtapaConResultado): Promise<void> {
    const procesoId = c.proceso_id;
    if (procesoId == null) {
      Swal.fire({ ...swalEnDialogo(), title: 'Sin proceso', text: 'Esta fila no tiene proceso asociado.', icon: 'info' });
      return;
    }

    const elegido = await pedirResultadoEtapa(
      this.dialog,
      etapa,
      {
        resultado: this.resultadoDe(c, etapa),
        motivoNoPaso: etapa === 'prueba' ? c.motivo_no_paso_prueba_tecnica : c.motivo_no_paso_examen_medico,
        motivoNoSePresento: etapa === 'prueba'
          ? c.motivo_no_se_presento_prueba_tecnica
          : c.motivo_no_se_presento_examen_medico,
      },
      this.nombreBonito(c),
    );
    if (!elegido) return;

    // Optimista: la fila cambia YA, sin esperar al backend ni al refresco.
    // El signal necesita un array nuevo con un objeto nuevo para repintar.
    const antes = this.candidatos();
    this.aplicarLocal(c, etapa, elegido);

    this.working.set(true);
    try {
      // Por `proceso_id` y no por cédula: update-by-document re-resuelve a la
      // ÚLTIMA entrevista del candidato y con varios procesos marcaría el que
      // no es (mismo motivo por el que "Quitar vacante" ya usa proceso_id).
      await firstValueFrom(
        this.gc.patchProceso(procesoId, payloadResultadoEtapa(etapa, elegido.resultado, elegido.motivo) as any),
      );
      this.cambios = true;
      // La etapa (el chip de la izquierda) la calcula el backend, así que se
      // refresca en segundo plano; lo visual ya cambió arriba.
      this.cargar(true);
      Swal.fire({
        ...swalEnDialogo(),
        toast: true, position: 'top-end', icon: 'success', timer: 2200,
        showConfirmButton: false, timerProgressBar: true,
        title: `Resultado registrado: ${this.etiquetaResultado(this.filaDe(c.proceso_id) ?? c, etapa)}`,
      });
    } catch (err: any) {
      console.error('[registrarResultado]', err);
      this.candidatos.set(antes);   // revierte lo optimista si el guardado falló
      Swal.fire({
        ...swalEnDialogo(),
        icon: 'error', title: 'Error',
        text: err?.error?.detail || 'No se pudo registrar el resultado.',
      });
    } finally {
      this.working.set(false);
    }
  }

  private filaDe(procesoId: number | null | undefined): CandidatoPorVacanteItem | undefined {
    return this.candidatos().find(x => x.proceso_id === procesoId);
  }

  /** Escribe el resultado en la fila en memoria para que la tabla repinte ya. */
  private aplicarLocal(
    c: CandidatoPorVacanteItem,
    etapa: EtapaConResultado,
    elegido: { resultado: ResultadoEtapa; motivo: string },
  ): void {
    const sufijo = etapa === 'prueba' ? 'prueba_tecnica' : 'examen_medico';
    const { resultado, motivo } = elegido;
    const parche: Record<string, unknown> = {
      [`paso_${sufijo}`]: resultado === 'paso',
      [`no_paso_${sufijo}`]: resultado === 'no_paso',
      [`no_se_presento_${sufijo}`]: resultado === 'no_se_presento',
      [`motivo_no_paso_${sufijo}`]: resultado === 'no_paso' ? motivo : null,
      [`motivo_no_se_presento_${sufijo}`]: resultado === 'no_se_presento' ? motivo : null,
    };
    // La etapa también se adelanta para que el chip no quede diciendo lo viejo
    // mientras llega el refresco.
    if (etapa === 'prueba') {
      parche['etapa'] = resultado === 'paso' ? 'Pasó prueba'
        : resultado === 'no_paso' ? 'No pasó prueba'
          : 'No se presentó';
    }
    this.candidatos.set(
      this.candidatos().map(x => (x.proceso_id === c.proceso_id ? { ...x, ...parche } : x)),
    );
  }

  /** Cuántas personas faltan para completar la vacante. */
  faltan(): number {
    return Math.max(0, (Number(this.data.req) || 0) - (Number(this.data.firm) || 0));
  }

  /** Clase de color de la barra/píldora de cumplimiento según el porcentaje. */
  cumplTono(): string {
    const pct = Number(this.data.cumpl) || 0;
    if (pct >= 100) return 'tono-ok';
    if (pct >= 70) return 'tono-warn';
    return 'tono-low';
  }

  private titleCase(s: string | null | undefined): string {
    if (!s) return '';
    return String(s).toLowerCase().replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()).trim();
  }

  /** Sólo las filas seleccionadas (acción destructiva: nunca asume "todas"). */
  private seleccionados(): CandidatoPorVacanteItem[] {
    const sel = this.seleccion();
    return this.candidatos().filter((c) => sel.has(String(c.proceso_id)));
  }

  // ───────── Quitar vacante ─────────
  async quitarVacante(): Promise<void> {
    // A diferencia de las descargas, esta acción NO asume "todas": exige
    // selección explícita para evitar desasignaciones masivas accidentales.
    const objetivo = this.seleccionados();
    if (!objetivo.length) {
      Swal.fire({
        ...swalEnDialogo(),
        title: 'Selecciona personas',
        text: 'Marca las casillas de las personas a las que quieres quitar la vacante.',
        icon: 'info',
      });
      return;
    }

    const total = objetivo.length;
    const confirm = await Swal.fire({
        ...swalEnDialogo(),
      title: `¿Quitar la vacante a ${total} persona(s)?`,
      html: 'La vacante y los datos de remisión quedarán sin asignar para esas personas. Esta acción no borra al candidato.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    });
    if (!confirm.isConfirmed) return;

    this.working.set(true);

    let done = 0;
    let ok = 0;
    const fallidas: string[] = [];

    const pintarProgreso = () => {
      const el = Swal.getHtmlContainer();
      if (el) el.innerHTML = `<b>${done}</b> / ${total}`;
    };

    Swal.fire({
        ...swalEnDialogo(),
      title: 'Quitando vacante…',
      html: `0 / ${total}`,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    // Concurrencia limitada: rápido sin saturar el backend con 400 PATCH a la vez.
    const CONCURRENCIA = 6;
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (idx < objetivo.length) {
        const c = objetivo[idx++];
        // Se desasigna por el proceso EXACTO que muestra el diálogo (`proceso_id`,
        // que además es el `track` de la tabla). Antes se quitaba por
        // `numero_documento` y el backend (update-by-document) lo re-resolvía a la
        // ÚLTIMA entrevista del candidato; con cédulas duplicadas (mismo número,
        // distinto tipo_doc) o varios procesos, limpiaba OTRO proceso y la persona
        // seguía apareciendo en la vacante. Con `proceso_id` se desasigna siempre
        // el proceso correcto vía PATCH /procesos/<id>/ (publicacion es nullable).
        const procesoId = c.proceso_id;
        if (procesoId == null) {
          fallidas.push(String(c.numero_documento));
          done++;
          pintarProgreso();
          continue;
        }
        try {
          await firstValueFrom(
            this.gc.patchProceso(procesoId, {
              publicacion: null,
              vacante_tipo: null,
              vacante_salario: null,
              vacante_fecha_prueba: null,
              prueba_tecnica: false,
              autorizado: false,
            }),
          );
          ok++;
        } catch {
          fallidas.push(String(c.numero_documento));
        } finally {
          done++;
          pintarProgreso();
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCIA, objetivo.length) }, () => worker()),
    );

    this.working.set(false);
    Swal.close();

    // Actualización OPTIMISTA: quitamos ya mismo de la tabla a quienes sí se
    // removieron, sin esperar al backend ni a que el usuario cierre un modal.
    // `fallidas` viene por CÉDULA (es lo que se le manda al backend), pero la
    // tabla y la selección se indexan por `proceso_id`. Se traduce una sola vez
    // para no volver a mezclar las dos claves.
    const fallidasSet = new Set(fallidas);
    const removidos = objetivo.filter((c) => !fallidasSet.has(String(c.numero_documento)));
    const removidosProcesos = new Set(removidos.map((c) => String(c.proceso_id)));

    if (removidosProcesos.size) {
      // Bajar los KPIs del encabezado (Firmados / Cumplimiento %) en el acto:
      // quitar a un contratado reduce los firmados de la vacante.
      const firmRemovidos = removidos.filter((c) => {
        const e = (c.etapa || '').toLowerCase();
        return e.includes('contrat') || e.includes('ingres');
      }).length;
      if (firmRemovidos && this.data.firm != null) {
        this.data.firm = Math.max(0, (Number(this.data.firm) || 0) - firmRemovidos);
        const req = Number(this.data.req) || 0;
        this.data.cumpl = req ? Math.min(100, Math.round((this.data.firm / req) * 100)) : 0;
      }

      this.candidatos.set(
        this.candidatos().filter((c) => !removidosProcesos.has(String(c.proceso_id))),
      );
      this.seleccion.set(
        new Set([...this.seleccion()].filter((id) => !removidosProcesos.has(id))),
      );
      this.cambios = true;
    }

    // Feedback NO bloqueante (toast): no frena el refresco ni tapa la tabla.
    Swal.fire({
        ...swalEnDialogo(),
      toast: true,
      position: 'top-end',
      icon: fallidas.length ? 'warning' : 'success',
      title: fallidas.length
        ? `Quitada a ${ok} de ${total}. Fallaron ${fallidas.length}.`
        : `Vacante quitada a ${ok} persona(s).`,
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
    });

    // Reconciliación autoritativa en segundo plano (sin parpadeo de "Cargando…").
    this.cargar(true);
  }

  /** Marca que hubo cambios para que el componente padre refresque al cerrar. */
  cambios = false;

  cerrar(): void {
    this.dialogRef.close(this.cambios);
  }

  // ───────── Descargar base (igual que home: candidatos-excel) ─────────
  async descargarBase(): Promise<void> {
    const objetivo = this.objetivo();
    const cedulas = objetivo.map((c) => String(c.numero_documento)).filter(Boolean);
    if (!cedulas.length) {
      Swal.fire({ ...swalEnDialogo(), title: 'Sin candidatos', text: 'No hay cédulas para descargar.', icon: 'info' });
      return;
    }

    this.working.set(true);
    Swal.fire({ title: 'Generando base...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const persona = this.nombreUsuario();
      const res = await firstValueFrom(this.homeService.descargarCandidatosExcel(cedulas, persona));
      if (!res.body) throw new Error('Respuesta vacía');
      const filename = `base_vacante_${this.data.publicacionId}.xlsx`;
      this.homeService.saveBlob(res.body, filename);
      Swal.close();
    } catch (err: any) {
      Swal.close();
      Swal.fire(
        'Error',
        err?.status === 0 ? 'No se pudo contactar el servidor.' : 'Falló la descarga de la base.',
        'error',
      );
    } finally {
      this.working.set(false);
    }
  }

  // ───────── Descargar BMC (cliente, formato fijo) ─────────
  descargarBmc(): void {
    const objetivo = this.objetivo();
    if (!objetivo.length) {
      Swal.fire({ ...swalEnDialogo(), title: 'Sin candidatos', text: 'No hay candidatos para exportar.', icon: 'info' });
      return;
    }

    const headers = [
      'Company', 'Proveedor del contratista', 'Número de personal',
      'Primer nombre', 'Segundo nombre', 'Primer apellido', 'Segundo apellido',
      'Fecha inicial del empleo', 'Fecha final del empleo', 'Direccion',
      'Descripción de teléfono principal', 'Teléfono principal',
      'GENERO', 'Fecha de nacimiento', 'Estado civil', 'Formación',
    ];

    const rows = objetivo.map((c) => ({
      'Company': this.BMC_COMPANY,
      'Proveedor del contratista': this.BMC_PROVEEDOR,
      'Número de personal': String(c.numero_documento ?? ''),
      'Primer nombre': c.primer_nombre ?? '',
      'Segundo nombre': c.segundo_nombre ?? '',
      'Primer apellido': c.primer_apellido ?? '',
      'Segundo apellido': c.segundo_apellido ?? '',
      'Fecha inicial del empleo': this.fmtFecha(c.fecha_ingreso),
      'Fecha final del empleo': '',
      'Direccion': c.direccion ?? '',
      'Descripción de teléfono principal': (c.celular || c.whatsapp) ? 'CELULAR' : '',
      'Teléfono principal': c.celular || c.whatsapp || '',
      'GENERO': c.sexo ?? '',
      'Fecha de nacimiento': this.fmtFecha(c.fecha_nacimiento),
      'Estado civil': c.estado_civil ?? '',
      'Formación': c.formacion ?? '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BMC');
    XLSX.writeFile(wb, `BMC_vacante_${this.data.publicacionId}.xlsx`);
  }

  // ───────── Descargar formatos por finca (cliente, generados desde 0) ─────────
  //
  // Los encabezados replican los formatos que envía cada finca, PERO el Excel se
  // arma desde cero con XLSX; NO se leen los archivos de ejemplo. El endpoint
  // `candidatos-por-vacante` ya trae los datos del candidato (RH, correo, lugar de
  // expedición/nacimiento, EPS, AFP, cesantías, salario, calzado, contacto de
  // emergencia, n° de hijos, etc.); se mapea cada uno a su columna. Lo que el
  // sistema no guarda (supervisor, gerente, tallas de overol, ruta, paradero…)
  // queda en blanco para diligenciar a mano.

  /** ARL de la empresa (constante: todos los formatos de las fincas la traen fija). */
  private readonly ARL_FIJA = 'SURA';

  /** FLORES DEL RIO — encabezado simple (hoja "base rio"). */
  descargarFlores(): void {
    const objetivo = this.objetivo();
    if (!objetivo.length) { Swal.fire({ ...swalEnDialogo(), title: 'Sin candidatos', text: 'No hay candidatos para exportar.', icon: 'info' }); return; }

    const headers = [
      'u', 'CONTRATO', 'UNIDAD', 'AREA', 'CEDULA', 'EXP', 'NOMBRE', 'AUXILIO', 'RUTA',
      'PARADERO', 'GENERO', 'CARGO', 'NIVEL DE CARGO', 'JEFE INMEDIATO', 'CENTRO DE COSTO',
      'FECHA INGRESO', 'ANTIGÜEDAD (dias)', 'AFP', 'EPS', 'FECHA NACIMIENTO', 'EDAD',
      'CIUDAD DE NACIMIENTO', 'NUMERO TELEFONICO', 'DIRECCIÓN CASA ', 'CORREO ELECTRONICO',
      'CONTACTO DE EMERGENCIA',
    ];
    const filas = objetivo.map((c) => [
      'TU ALIANZA', '', '', this.data.area ?? '', String(c.numero_documento ?? ''),
      c.lugar_expedicion ?? '', this.nombreCompleto(c), this.data.auxilio_transporte ?? '', this.data.ruta ?? '',
      c.municipio ?? '', c.sexo ?? '', this.data.cargo ?? '', '', '', this.data.finca ?? '',
      this.fmtFecha(c.fecha_ingreso), this.antiguedadDias(c.fecha_ingreso), c.afp ?? '', c.eps ?? '',
      this.fmtFecha(c.fecha_nacimiento), this.edad(c.fecha_nacimiento), c.lugar_nacimiento ?? '',
      this.telefono(c), c.direccion ?? '', c.email ?? '', c.contacto_emergencia ?? '',
    ]);
    this.generarExcel({ hoja: 'base rio', columnas: headers, datos: filas, filename: this.nombreArchivo('FLORES_DEL_RIO') });
  }

  /** SAGARO — encabezado simple (hoja "formato de ingresos"). */
  descargarSagaro(): void {
    const objetivo = this.objetivo();
    if (!objetivo.length) { Swal.fire({ ...swalEnDialogo(), title: 'Sin candidatos', text: 'No hay candidatos para exportar.', icon: 'info' }); return; }

    const headers = [
      'CEDULA', 'FECHA EXPEDICION DE DOCUMENTO', 'LUGAR DE EXPEDICION', 'PRIMER NOMBRE',
      'SEGUNDO NOMBRE', 'PRIMER APELLIDO', 'SEGUNDO APELLIDO', 'LUGAR DE NACIMIENTO',
      'FECHA DE NACIMIENTO', 'NACIONALIDAD', 'DIRECCIÓN', 'CIUDAD', 'LOCALIDAD', 'BARRIO',
      'N° HIJOS', 'GRUPO SANGUINEO', 'EPS', 'PENSION', 'CESANTIAS', 'ARL', 'CELULAR', 'EMAIL',
      'FECHA DE INGRESO', 'SALARIO', 'TALLA BOTAS', 'TALLA OVEROL',
    ];
    const filas = objetivo.map((c) => [
      String(c.numero_documento ?? ''), this.fmtFecha(c.fecha_expedicion), c.lugar_expedicion ?? '',
      c.primer_nombre ?? '', c.segundo_nombre ?? '', c.primer_apellido ?? '', c.segundo_apellido ?? '',
      c.lugar_nacimiento ?? '', this.fmtFecha(c.fecha_nacimiento), 'COLOMBIANO', c.direccion ?? '',
      c.municipio ?? '', '', c.barrio ?? '', this.numHijos(c), c.rh ?? '', c.eps ?? '', c.afp ?? '',
      c.cesantias ?? '', this.ARL_FIJA, this.telefono(c), c.email ?? '', this.fmtFecha(c.fecha_ingreso),
      this.salarioTexto(c), this.calzado(c), this.tallaOverol(c),
    ]);
    this.generarExcel({ hoja: 'formato de ingresos', columnas: headers, datos: filas, filename: this.nombreArchivo('SAGARO') });
  }

  /** HATO — doble encabezado (grupos de fecha con celdas combinadas). Fecha: DIA/MES/AÑO. */
  descargarHato(): void {
    const objetivo = this.objetivo();
    if (!objetivo.length) { Swal.fire({ ...swalEnDialogo(), title: 'Sin candidatos', text: 'No hay candidatos para exportar.', icon: 'info' }); return; }

    const columnas = [
      'NO', 'TIPO DOCUMENTO', 'NUMERO DE DOCUEMNTO', 'NOMBRE COMPLETO',
      'DIA', 'MES', 'AÑO', 'EXPEDIDA EN', 'DIA', 'MES', 'AÑO', 'RH+', 'LUGAR NACIMIENTO',
      'EDAD', 'GENERO', 'ESCOLARIDAD', 'TELEFONO', 'CORREO ELECTRONICO', 'DIRECCION', 'BARRIO',
      'PARADERO', 'LUGAR DE RESIDENCIA', 'SI', 'NO', 'EPS', 'ARL', 'PENSIÓN ', 'CESANTIAS',
      'CALZADO', 'TALLA OVEROL', 'EMPRESA', 'FINCA', 'AREA', 'SUPERVISOR', 'GERENTE',
      'CENTRO DE COSTO', 'CARGO', 'TRAB SOCIAL',
    ];
    const grupos = [
      { label: 'FECHA DE EXPEDICION', desde: 4, hasta: 6 },
      { label: 'FECHA DE NACIMIENTO', desde: 8, hasta: 10 },
      { label: 'SUBSIDIO DE TRANSPORTE', desde: 22, hasta: 23 },
    ];
    const filas = objetivo.map((c, i) => {
      const nac = this.partesFecha(c.fecha_nacimiento);
      const exp = this.partesFecha(c.fecha_expedicion);
      return [
        i + 1, c.tipo_doc ?? '', String(c.numero_documento ?? ''), this.nombreCompleto(c),
        exp.dia, exp.mes, exp.anio, c.lugar_expedicion ?? '', nac.dia, nac.mes, nac.anio,
        c.rh ?? '', c.lugar_nacimiento ?? '', this.edad(c.fecha_nacimiento),
        c.sexo ?? '', c.formacion ?? '', this.telefono(c), c.email ?? '', c.direccion ?? '', c.barrio ?? '',
        c.municipio ?? '', c.municipio ?? '', this.subsidio('Si'), this.subsidio('No'),
        c.eps ?? '', this.ARL_FIJA, c.afp ?? '', c.cesantias ?? '',
        this.calzado(c), this.tallaOverol(c), this.data.empresa ?? '', this.data.finca ?? '',
        this.data.area ?? '', '', '', this.data.finca ?? '', this.data.cargo ?? '', '',
      ];
    });
    this.generarExcel({ hoja: 'INGRESOS', columnas, grupos, datos: filas, filename: this.nombreArchivo('HATO') });
  }

  /** SAN CARLOS — doble encabezado. Fecha: AÑO/MES/DIA; nombre en APELLIDO 1/2 + NOMBRES. */
  descargarSanCarlos(): void {
    const objetivo = this.objetivo();
    if (!objetivo.length) { Swal.fire({ ...swalEnDialogo(), title: 'Sin candidatos', text: 'No hay candidatos para exportar.', icon: 'info' }); return; }

    const columnas = [
      'No', 'TIPO DOCUMENTO', 'CEDULA', 'APELLIDO 1', 'APELLIDO 2', 'NOMBRES ',
      'AÑO', 'MES', 'DIA', 'EXPEDIDA EN', 'AÑO', 'MES', 'DIA', 'RH+', 'LUGAR NACIMIENTO',
      'EDAD', 'GENERO', 'ESCOLARIDAD', 'TELEFONO', 'CORREO ELECTRONICO', 'DIRECCION', 'BARRIO',
      'PARADERO', 'LUGAR DE RESIDENCIA', 'SI', 'NO', 'EPS', 'ARL', 'PENSIÓN ', 'CESANTIAS',
      'CALZADO', 'TALLA OVEROL', 'EMPRESA', 'FINCA', 'AREA', 'SUPERVISOR', 'GERENTE',
      'CENTRO DE COSTO', 'CARGO', 'TRAB SOCIAL',
    ];
    const grupos = [
      { label: 'FECHA DE EXPEDICION', desde: 6, hasta: 8 },
      { label: 'FECHA DE NACIMIENTO', desde: 10, hasta: 12 },
      { label: 'SUBSIDIO DE TRANSPORTE', desde: 24, hasta: 25 },
    ];
    const filas = objetivo.map((c, i) => {
      const nac = this.partesFecha(c.fecha_nacimiento);
      const exp = this.partesFecha(c.fecha_expedicion);
      const nombres = [c.primer_nombre, c.segundo_nombre].filter(Boolean).join(' ').trim();
      return [
        i + 1, c.tipo_doc ?? '', String(c.numero_documento ?? ''), c.primer_apellido ?? '',
        c.segundo_apellido ?? '', nombres, exp.anio, exp.mes, exp.dia, c.lugar_expedicion ?? '',
        nac.anio, nac.mes, nac.dia, c.rh ?? '', c.lugar_nacimiento ?? '',
        this.edad(c.fecha_nacimiento), c.sexo ?? '', c.formacion ?? '', this.telefono(c), c.email ?? '',
        c.direccion ?? '', c.barrio ?? '', c.municipio ?? '', c.municipio ?? '', this.subsidio('Si'), this.subsidio('No'),
        c.eps ?? '', this.ARL_FIJA, c.afp ?? '', c.cesantias ?? '', this.calzado(c), this.tallaOverol(c),
        this.data.empresa ?? '', this.data.finca ?? '', this.data.area ?? '', '', '', this.data.finca ?? '',
        this.data.cargo ?? '', '',
      ];
    });
    this.generarExcel({ hoja: 'FORMATO INGRESOS', columnas, grupos, datos: filas, filename: this.nombreArchivo('SAN_CARLOS') });
  }

  // ───────── Helpers de formato ─────────

  /**
   * Genera el .xlsx del formato con exceljs (soporta estilos, a diferencia de xlsx):
   * encabezados AMARILLOS, en negrita, centrados y con bordes, además del autofiltro,
   * para que salga igual que los formatos originales de las fincas.
   *
   * - `columnas`: los nombres de columna (una sola fila de encabezado).
   * - `grupos` (opcional): activa el doble encabezado. Cada grupo (p. ej. FECHA DE
   *   EXPEDICION sobre DIA/MES/AÑO) va como celda combinada horizontal en la fila
   *   superior; las columnas sueltas se combinan verticalmente (fila 1-2) con su
   *   nombre ARRIBA para que se vea (Excel muestra la celda superior-izquierda del
   *   merge; ese fue el bug de la versión con xlsx: el nombre quedaba en la fila de
   *   abajo y el merge lo ocultaba).
   */
  private async generarExcel(opts: {
    hoja: string;
    columnas: string[];
    grupos?: Array<{ label: string; desde: number; hasta: number }>;
    datos: any[][];
    filename: string;
  }): Promise<void> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(opts.hoja);

    const grupos = opts.grupos ?? [];
    const dobleEncabezado = grupos.length > 0;
    let filasEncabezado = 1;

    if (dobleEncabezado) {
      const enGrupo = new Map<number, boolean>(); // col -> esInicioDeGrupo
      for (const g of grupos) for (let c = g.desde; c <= g.hasta; c++) enGrupo.set(c, c === g.desde);

      const fila0: any[] = [];
      const fila1: any[] = [];
      for (let c = 0; c < opts.columnas.length; c++) {
        if (enGrupo.has(c)) {
          fila1[c] = opts.columnas[c];  // sub-encabezado (DIA/MES/AÑO)
          fila0[c] = enGrupo.get(c) ? (grupos.find((g) => g.desde === c)!.label) : '';
        } else {
          fila0[c] = opts.columnas[c];  // nombre ARRIBA (visible en el merge vertical)
          fila1[c] = '';
        }
      }
      ws.addRow(fila0);
      ws.addRow(fila1);
      filasEncabezado = 2;

      for (const g of grupos) ws.mergeCells(1, g.desde + 1, 1, g.hasta + 1);        // horizontal
      for (let c = 0; c < opts.columnas.length; c++) {
        if (!enGrupo.has(c)) ws.mergeCells(1, c + 1, 2, c + 1);                      // vertical
      }
    } else {
      ws.addRow(opts.columnas);
    }

    // Estilo de las filas de encabezado.
    for (let r = 1; r <= filasEncabezado; r++) {
      ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        cell.font = { bold: true, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin' }, left: { style: 'thin' },
          bottom: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    }

    for (const fila of opts.datos) ws.addRow(fila);

    // Anchos de columna razonables (más ancho para nombres/correos/direcciones).
    const anchos = /NOMBRE|CORREO|DIRECC|APELLIDO|LUGAR|EMPRESA|FINCA|AREA|CARGO|CENTRO|EMAIL/;
    opts.columnas.forEach((nombre, i) => {
      ws.getColumn(i + 1).width = anchos.test(String(nombre).toUpperCase())
        ? 22
        : Math.min(Math.max(String(nombre).length + 2, 8), 16);
    });

    // Autofiltro sobre la fila de columnas (como en el formato original de San Carlos).
    ws.autoFilter = {
      from: { row: filasEncabezado, column: 1 },
      to: { row: filasEncabezado, column: opts.columnas.length },
    };

    const buffer = await wb.xlsx.writeBuffer();
    const { saveAs } = await import('file-saver');
    saveAs(new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), opts.filename);
  }

  private nombreArchivo(prefijo: string): string {
    return `${prefijo}_vacante_${this.data.publicacionId}.xlsx`;
  }

  /** YYYY-MM-DD → { dia, mes, anio } (sin ceros a la izquierda). Vacío si no hay fecha. */
  private partesFecha(iso: string | null | undefined): { dia: string; mes: string; anio: string } {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return { dia: '', mes: '', anio: '' };
    return { dia: String(+m[3]), mes: String(+m[2]), anio: m[1] };
  }

  /** Edad en años a partir de la fecha de nacimiento ISO. Vacío si no es válida. */
  private edad(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return '';
    const hoy = new Date();
    let e = hoy.getFullYear() - +m[1];
    const dm = hoy.getMonth() + 1 - +m[2];
    if (dm < 0 || (dm === 0 && hoy.getDate() < +m[3])) e--;
    return e >= 0 && e < 120 ? String(e) : '';
  }

  private telefono(c: CandidatoPorVacanteItem): string {
    return c.celular || c.whatsapp || '';
  }

  private nombreCompleto(c: CandidatoPorVacanteItem): string {
    return [c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido]
      .filter(Boolean).join(' ').trim();
  }

  /** N° de hijos como texto ('0' si no hay dato, para no dejar la celda vacía). */
  private numHijos(c: CandidatoPorVacanteItem): string {
    return String(c.num_hijos ?? 0);
  }

  /** Talla de calzado; vacío si no hay. */
  private calzado(c: CandidatoPorVacanteItem): string {
    return c.calzado != null ? String(c.calzado) : '';
  }

  /** Talla de overol (= camisa de la dotación); vacío si no hay. */
  private tallaOverol(c: CandidatoPorVacanteItem): string {
    return c.talla_overol != null ? String(c.talla_overol) : '';
  }

  /** Marca 'X' en la columna SI/NO del subsidio según el auxilio de la vacante. */
  private subsidio(cual: 'Si' | 'No'): string {
    const aux = String(this.data.auxilio_transporte ?? '').trim().toLowerCase();
    if (!aux) return '';
    return (cual === 'Si') === (aux === 'si') ? 'X' : '';
  }

  /** Salario con separador de miles ("1.750.905"); vacío si no hay. */
  private salarioTexto(c: CandidatoPorVacanteItem): string {
    const raw = String(c.salario ?? '').trim();
    if (!raw) return '';
    const n = Number(raw.replace(/[^\d]/g, ''));
    return Number.isFinite(n) && n > 0 ? n.toLocaleString('es-CO') : raw;
  }

  /** Antigüedad en días desde la fecha de ingreso hasta hoy; vacío si no hay. */
  private antiguedadDias(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return '';
    const ingreso = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(ingreso.getTime())) return '';
    const dias = Math.floor((Date.now() - ingreso.getTime()) / 86400000);
    return dias >= 0 ? String(dias) : '';
  }

  // ───────── Helpers ─────────
  /** YYYY-MM-DD → DD/MM/YYYY (deja vacío si no hay fecha válida). */
  private fmtFecha(iso: string | null | undefined): string {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso);
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  private nombreUsuario(): string {
    try {
      const u: any = this.util.getUser();
      const n = `${u?.datos_basicos?.nombres ?? ''} ${u?.datos_basicos?.apellidos ?? ''}`.trim();
      return n || (u?.correo_electronico ?? '');
    } catch {
      return '';
    }
  }
}
