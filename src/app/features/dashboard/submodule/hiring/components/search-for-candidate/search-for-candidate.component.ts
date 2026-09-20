import { Component, OnDestroy, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, ElementRef, ViewChild, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subject, take } from 'rxjs';
import { filter, startWith, switchMap, takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';

import { VetadosService } from '../../service/vetados/vetados.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';

import { EventEmitter, Output } from '@angular/core';
import { SharedModule } from '@/app/shared/shared.module';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { AntecedenteEstadoFuente, AntecedenteFuente, CandidatoRecienteItem, RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { DateRangeDialogComponent } from '@/app/shared/components/date-rang-dialog/date-rang-dialog.component';
import { docKey } from '@/app/shared/utils/tipo-doc.util';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-search-for-candidate',
  standalone: true,
  imports: [
    SharedModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatSelectModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './search-for-candidate.component.html',
  styleUrl: './search-for-candidate.component.css',
} )
export class SearchForCandidateComponent implements OnInit, OnDestroy {
  readonly yesNoStatusConfig: Record<string, { color: string; background: string }> = {
    'Sí': { color: '#065f46', background: '#d1fae5' },
    'No': { color: '#991b1b', background: '#fee2e2' },
  };

  /**
   * Fuentes de antecedentes que consulta el robot, en el orden que pidió el
   * operador. La abreviatura se muestra en cada chip de la tabla y el label
   * completo va en el tooltip.
   */
  readonly antecedenteFuentes: ReadonlyArray<{ key: AntecedenteFuente; label: string; abbr: string }> = [
    { key: 'contraloria', label: 'Contraloría', abbr: 'CON' },
    { key: 'adress', label: 'ADRES', abbr: 'ADR' },
    { key: 'sisben', label: 'Sisbén', abbr: 'SIS' },
    { key: 'policivo', label: 'Policivos', abbr: 'POL' },
    { key: 'procuraduria', label: 'Procuraduría', abbr: 'PRO' },
    { key: 'ofac', label: 'OFAC', abbr: 'OFA' },
  ];

  /** Texto legible para cada estado de una fuente del robot. */
  private readonly estadoFuenteLabel: Record<string, string> = {
    SIN_CONSULTAR: 'Sin consultar',
    EN_PROGRESO: 'Consultando',
    FINALIZADO: 'Listo',
    BLOQUEADO: 'Bloqueado',
    RECHAZADO_INCUMPLIMIENTO: 'Rechazado',
  };

  /* ──────────  Outputs  ────────── */
  @Output() codigoContratoChange = new EventEmitter<string>();
  @Output() cedulaSeleccionada = new EventEmitter<string>();
  @Output() nombreCompletoChange = new EventEmitter<string>();
  @Output() idInfoEntrevistaAndreaChange = new EventEmitter<number>();
  // objetos completos
  @Output() candidatoSeleccionado = new EventEmitter<any>();
  /**
   * Pide al pipeline abrir la generación masiva de carnets, mandándole las
   * cédulas que hay hoy en la cola: es el arranque más común y ahorra
   * pegarlas a mano (en el diálogo se pueden editar o pegar otras).
   */
  @Output() carnetMasivo = new EventEmitter<string[]>();

  pedirCarnetMasivo(): void {
    this.carnetMasivo.emit(
      (this.recientes ?? []).map(r => String(r.numero_documento ?? '').trim()).filter(Boolean),
    );
  }

  /* ──────────  Propiedades  ────────── */
  cedula = '';
  /** Tipo de documento seleccionado para la búsqueda (igual que el formulario web). */
  tipoDocSeleccionado = 'CC';
  readonly tiposDocumento: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'CC', label: 'C.C - Cédula de ciudadanía' },
    { value: 'CE', label: 'C.E - Cédula de extranjería' },
    { value: 'TI', label: 'T.I - Tarjeta de identidad' },
    { value: 'PEP', label: 'PEP - Permiso especial de permanencia' },
    { value: 'PPT', label: 'PPT - Permiso por protección temporal' },
    { value: 'PT', label: 'PT - Permiso temporal' },
    { value: 'PA', label: 'PA - Pasaporte' },
  ];
  observacion = '';
  mostrarObservacion = false;
  procesoValido = false;
  datosSeleccion: any = null;
  sede = '';

  /* Propiedades eliminadas tabla vetados */
  showTable = false;
  filtroCedula: string = '';

  /* Lista por orden de llegada (consultados o llenando el formulario) */
  recientes: CandidatoRecienteItem[] = [];
  recientesLoading = false;

  /**
   * Columnas de la cola en la tabla estándar. El «#» de llegada lo pone la
   * tabla (numera las filas en el orden del backend); «Atender» va en las
   * acciones de la fila.
   */
  readonly columnasRecientes: ColumnaTabla<CandidatoRecienteItem>[] = [
    { id: 'documento', header: 'Documento', tarjeta: 'subtitulo',
      valor: (r) => `${r.tipo_doc ?? ''} ${r.numero_documento ?? ''}`.trim() },
    { id: 'nombre', header: 'Apellidos Nombres', tarjeta: 'titulo', minAncho: '180px',
      valor: (r) => r.apellidos_nombres ?? '', formato: (r) => r.apellidos_nombres || '—' },
    { id: 'hora', header: 'Hora de llegada', tarjeta: 'meta',
      valor: (r) => this.horaLlegada(r.updated_at) },
    { id: 'oficina', header: 'Oficina', prioridad: 2, tarjeta: 'meta',
      valor: (r) => r.oficina ?? '', formato: (r) => r.oficina || '—' },
    { id: 'barrio', header: 'Barrio', prioridad: 3, tarjeta: 'cuerpo',
      valor: (r) => r.barrio ?? '', formato: (r) => r.barrio || '—' },
    { id: 'municipio', header: 'Municipio', prioridad: 3, tarjeta: 'cuerpo',
      valor: (r) => r.municipio ?? '', formato: (r) => r.municipio || '—' },
    { id: 'departamento', header: 'Departamento', prioridad: 3, tarjeta: 'cuerpo',
      valor: (r) => r.departamento ?? '', formato: (r) => r.departamento || '—' },
    { id: 'edad', header: 'Edad', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (r) => r.edad ?? null, formato: (r) => (r.edad != null ? String(r.edad) : '—') },
    { id: 'experiencia', header: 'Experiencia', prioridad: 2, tarjeta: 'cuerpo',
      valor: (r) => (r.tiene_experiencia ? (r.area_experiencia ? `Sí · ${r.area_experiencia}` : 'Sí') : 'No') },
    { id: 'antecedentes', header: 'Antecedentes', prioridad: 2, tarjeta: 'cuerpo',
      valor: (r) => this.antecedentesLabel(r) },
    { id: 'formulario', header: 'Formulario', tarjeta: 'badge',
      valor: (r) => (r.formulario_completo ? 'Completo' : (r.formulario_paso || 0) >= 1 ? 'Paso 1' : 'Sin iniciar') },
    { id: 'carnet', header: 'Carnet', prioridad: 2, tarjeta: 'badge',
      valor: (r) => (r.carnet_generado ? 'Generado' : 'Pendiente') },
  ];
  readonly idReciente = (r: CandidatoRecienteItem, i: number) => this.trackByRecienteId(i, r);
  /** Las ya atendidas hoy van al final y atenuadas (antes `.fila-atendida`). */
  readonly claseReciente = (r: CandidatoRecienteItem) => (r.atendido_hoy ? 'te-fila--atenuada' : '');

  /** «HH:mm» local de la llegada (lo mismo que pintaba `date:'HH:mm'`); ordena bien como texto. */
  private horaLlegada(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Cada refresco cuesta caro: `/candidatos/recientes/` consulta candidatos,
   * sus entrevistas con proceso y contrato, y el estado de los robots por
   * cédula — 0.3–0.5 s por llamada contra la MySQL remota. A 3 s eran ~1.200
   * requests/hora por cada TesoroApp abierto.
   *
   * La cola de turnos no cambia tan rápido; 15 s es de sobra y hay botón de
   * refrescar para cuando se quiere ver ya. Además se pausa si la ventana no
   * está visible (ver `startRecientesPolling`).
   */
  private readonly RECIENTES_REFRESH_MS = 15000;
  private readonly RECIENTES_LIMIT = 50;
  /* Cédulas que el usuario marcó "Atender" en este mismo render para refresco optimista. */
  private atendiendoSet = new Set<string>();

  /* Búsqueda manual por cédula: ahora es un slider inline (no un panel lateral). */
  busquedaAbierta = false;

  /**
   * Si está activo, al consultar una cédula el candidato se agrega a la cola de
   * la tabla (orden de llegada). Si está inactivo, sólo se busca y se avanza con
   * el resto del flujo sin dejar rastro en la cola del día.
   *
   * Arranca apagado a propósito: el operador debe activarlo explícitamente para
   * que la persona aparezca en la tabla del día.
   */
  encolarEnTabla = false;

  /** Ref al input de cédula del slider inline; usado para autofocus al abrir. */
  @ViewChild('busquedaInput') private busquedaInputRef?: ElementRef<HTMLInputElement>;

  /* Descarga de Excel: estado del request */
  excelDescargando = false;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private vetadosService: VetadosService,
    private utilityService: UtilityServiceService,
    private registroProcesoContratacion: RegistroProcesoContratacion,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog
  ) { }

  /* ──────────  Ciclo de vida  ────────── */
  async ngOnInit(): Promise<void> {
    await this.initUsuarioYAbreviacion();
    this.startRecientesPolling();
  }

  ngOnDestroy(): void {
    // Limpieza adicional si aplica (las suscripciones se auto-cancelan
    // por takeUntilDestroyed sin acción manual).
  }

  private async initUsuarioYAbreviacion(): Promise<void> {
    try {
      const user: any = await this.utilityService.getUser();
      this.sede = user?.sede?.nombre ?? '';
    } catch {
      this.sede = '';
    }
  }

  private startRecientesPolling(): void {
    interval(this.RECIENTES_REFRESH_MS).pipe(
      startWith(0),
      // Con la app minimizada o en otra pestaña nadie está mirando la cola:
      // seguir consultando solo carga la base. Al volver, el `interval` sigue
      // corriendo y el primer tick que caiga con la ventana visible refresca.
      filter(() => typeof document === 'undefined' || !document.hidden),
      switchMap(() => {
        this.recientesLoading = true;
        this.cdr.markForCheck();
        return this.registroProcesoContratacion.getCandidatosRecientes(
          this.RECIENTES_LIMIT,
          this.sede || undefined
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (data) => {
        this.recientes = this.dedupeRecientes(data);
        this.recientesLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.recientesLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  refrescarRecientes(): void {
    this.recientesLoading = true;
    this.cdr.markForCheck();
    this.registroProcesoContratacion
      .getCandidatosRecientes(this.RECIENTES_LIMIT, this.sede || undefined)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.recientes = this.dedupeRecientes(data);
          this.recientesLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.recientesLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  /**
   * Una fila por PERSONA (el backend ya ordena: no atendidos por llegada,
   * atendidos al final).
   *
   * La clave era el `numero_documento` crudo, así que `1002498616` y
   * `X1002498616` —la misma persona con dos filas de Candidato, 2821 casos en
   * prod— contaban como distintos y salían las dos en la lista. `docKey()`
   * quita la `X` inicial, igual que `Candidato.normalize_doc` del backend.
   */
  private dedupeRecientes(data: CandidatoRecienteItem[] | null | undefined): CandidatoRecienteItem[] {
    if (!data?.length) return [];
    const vistos = new Set<string>();
    const out: CandidatoRecienteItem[] = [];
    for (const item of data) {
      const key = docKey(item?.numero_documento);
      if (!key) {
        out.push(item);
        continue;
      }
      if (vistos.has(key)) continue;
      vistos.add(key);
      out.push(item);
    }
    return out;
  }

  seleccionarReciente(item: CandidatoRecienteItem): void {
    if (!item?.numero_documento) return;
    this.cedula = String(item.numero_documento);
    // El tipo de documento de la FILA manda: sin esto, "Atender" a un CE/PPT
    // con el selector en su default (CC) aseguraba la fila del robot bajo el
    // tipo equivocado — el mismo patrón de filas duplicadas (cedula, tipo
    // distinto) que ya causó bucles de robots y gasto de 2captcha.
    const tipoFila = String(item.tipo_doc ?? '').trim();
    if (tipoFila) this.tipoDocSeleccionado = tipoFila;

    // Optimismo: marca local y reordena al final mientras llega la respuesta del backend.
    const ced = String(item.numero_documento);
    this.atendiendoSet.add(ced);
    this.applyOptimisticAttended(ced);

    // Marca atendido en backend (tolerante a fallos: no bloquea la navegación).
    this.registroProcesoContratacion
      .markAttended({
        tipo_doc: item.tipo_doc ?? undefined,
        numero_documento: item.numero_documento,
        candidato_id: item.candidato_id,
      })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.atendiendoSet.delete(ced);
          // Refresco inmediato para reflejar el reorden real del backend
          this.refrescarRecientes();
        },
        error: () => {
          // Si falla, revertimos la marca optimista en el siguiente refresco
          this.atendiendoSet.delete(ced);
        },
      });

    this.buscarCandidato();
  }

  /** Marca optimista: pone atendido_hoy=true y mueve el item al final localmente. */
  private applyOptimisticAttended(cedula: string): void {
    const idx = this.recientes.findIndex((r) => String(r.numero_documento) === cedula);
    if (idx < 0) return;
    const item = { ...this.recientes[idx], atendido_hoy: true, atendido_at: new Date().toISOString() };
    const sinAtendidos = this.recientes.filter((r, i) => i !== idx && !r.atendido_hoy);
    const conAtendidos = this.recientes.filter((r, i) => i !== idx && r.atendido_hoy);
    this.recientes = [...sinAtendidos, ...conAtendidos, item];
    this.cdr.markForCheck();
  }

  abrirDialogExcel(): void {
    const ref = this.dialog.open(DateRangeDialogComponent, {
      width: '420px',
      autoFocus: false,
    });
    ref.afterClosed().pipe(take(1)).subscribe((res: { start: string | null; end: string | null } | undefined) => {
      if (!res || !res.start || !res.end) return;
      if (res.end < res.start) {
        Swal.fire('Rango inválido', 'La fecha "Hasta" no puede ser anterior a "Desde".', 'warning');
        return;
      }
      this.descargarExcel(res.start, res.end);
    });
  }

  private descargarExcel(start: string, end: string): void {
    this.excelDescargando = true;
    this.cdr.markForCheck();
    this.registroProcesoContratacion
      .downloadTurnosExcel({ start, end }, this.sede || undefined)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.excelDescargando = false;
          this.cdr.markForCheck();
        },
        error: async (err: any) => {
          this.excelDescargando = false;
          this.cdr.markForCheck();
          // El backend devuelve {message: "..."} como JSON cuando hay error.
          // Como el response es blob, hay que leer y parsear.
          let msg = 'No se pudo descargar el Excel.';
          const blob: Blob | null = err?.error instanceof Blob ? err.error : null;
          if (blob) {
            try {
              const text = await blob.text();
              try {
                const json = JSON.parse(text);
                if (json?.message) msg = String(json.message);
              } catch {
                if (text && text.length < 400) msg = text;
              }
            } catch {
              /* dejamos el msg por defecto */
            }
          } else if (err?.error?.message) {
            msg = String(err.error.message);
          } else if (err?.message) {
            msg = String(err.message);
          }
          const status = err?.status ?? 0;
          Swal.fire(
            'Error al descargar Excel',
            `${msg}<br><br><small>HTTP ${status}</small>`,
            'error'
          );
        }
      });
  }

  /** Toggle del slider de búsqueda inline. Al cerrar también colapsa el reporte. */
  toggleBusqueda(): void {
    this.busquedaAbierta = !this.busquedaAbierta;
    if (!this.busquedaAbierta) {
      this.mostrarObservacion = false;
    } else {
      // Esperar a que el slider termine la transición y enfocar el input.
      setTimeout(() => this.busquedaInputRef?.nativeElement?.focus(), 320);
    }
    this.cdr.markForCheck();
  }

  trackByRecienteId(_idx: number, item: CandidatoRecienteItem): number {
    return item.candidato_id;
  }

  /** Secuencia de búsquedas: la respuesta de una búsqueda vieja se descarta. */
  private _busquedaSeq = 0;

  buscarCandidato(): void {
    this.cedula = this.cedula.trim();
    if (!this.cedula) return;

    // TODO congelado al momento de disparar: si el operador busca otra cédula
    // (o toca el toggle de cola) antes de que responda esta, la respuesta
    // tardía NO debe emitir al candidato viejo ni encolarlo con el estado
    // nuevo del toggle.
    const seq = ++this._busquedaSeq;
    const cedulaBuscada = this.cedula;
    const tipoBuscado = this.tipoDocSeleccionado;
    const encolar = this.encolarEnTabla;

    // La consulta de vetados iba en un método que nada invocaba (buscarCedula):
    // una persona reportada pasaba por todo el flujo sin ninguna alerta. Corre
    // en paralelo y no bloquea la búsqueda.
    this.consultarVetados(cedulaBuscada, seq);

    // Asegura/actualiza la fila de antecedentes del robot (EstadosRobots) para
    // el tipo de documento seleccionado + cédula. Crea la fila si el Candidato
    // existe y falta, o la resetea a SIN_CONSULTAR si está vencida (>15 días),
    // igual que el formulario web. Se hace SIEMPRE al buscar, sin depender del
    // toggle de cola; tolerante a fallos.
    this.registroProcesoContratacion
      .asegurarEstadoRobot({ tipo_doc: tipoBuscado, numero_documento: cedulaBuscada })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {},
        error: (err: any) => console.warn('[asegurarEstadoRobot] no se pudo asegurar', err?.status, err?.error),
      });

    this.registroProcesoContratacion
      .getCandidatoPorDocumento(cedulaBuscada, true, tipoBuscado)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (candidato: any) => {
        // Llegó después de que el operador buscó a otra persona: ignorar.
        if (seq !== this._busquedaSeq) return;
        if (!candidato && tipoBuscado) {
          // El selector pudo quedar "pegado" del Atender anterior (CE/PPT) o
          // la persona existe con otro tipo: reintentar SIN filtro antes de
          // decir que no existe — un "No encontrado" falso invita a
          // re-registrarla y a crear justo el duplicado que queremos evitar.
          this.registroProcesoContratacion
            .getCandidatoPorDocumento(cedulaBuscada, true)
            .pipe(take(1), takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (c2: any) => {
                if (seq !== this._busquedaSeq) return;
                this.procesarResultadoBusqueda(c2, cedulaBuscada, encolar);
              },
              error: () => {
                if (seq !== this._busquedaSeq) return;
                Swal.fire('Error', 'Error al buscar el candidato.', 'error');
              },
            });
          return;
        }
        this.procesarResultadoBusqueda(candidato, cedulaBuscada, encolar);
      },
      error: () => {
        if (seq !== this._busquedaSeq) return;
        Swal.fire('Error', 'Error al buscar el candidato.', 'error');
      },
    });
  }

  private procesarResultadoBusqueda(candidato: any, cedulaBuscada: string, encolar: boolean): void {
    if (!candidato) {
      this.candidatoSeleccionado.emit(null);
      Swal.fire('No encontrado', 'No se encontró un candidato con esa cédula.', 'info');
      return;
    }
    // El selector refleja al titular REAL encontrado: así no queda pegado en
    // un tipo viejo para la siguiente búsqueda.
    const tipoReal = String(candidato?.tipo_doc || '').trim();
    if (tipoReal) this.tipoDocSeleccionado = tipoReal;

    this.candidatoSeleccionado.emit(candidato);

    // Encolar la cédula en la cola FIFO de mi sede para HOY.
    // Idempotente en backend: si ya estaba en cola hoy en esta sede, no se
    // reordena. Si no, queda al final de la cola.
    // Sólo se encola si el toggle estaba activo AL BUSCAR.
    const cedula = String(candidato?.numero_documento || cedulaBuscada || '').trim();
    const tipoDoc = tipoReal || undefined;
    if (cedula && encolar) {
      this.registroProcesoContratacion
        .encolarCandidato({ tipo_doc: tipoDoc, numero_documento: cedula })
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res: any) => {
            this.refrescarRecientes();
            // Venía de la cola de otra sede: avisamos de dónde salió, si no
            // parece que la tabla se reordenó sola.
            if (res?.accion === 'reencolada_otra_sede' && res?.oficina_anterior) {
              this.toast('info', `Estaba en la cola de ${res.oficina_anterior}. La traje a tu sede.`);
            }
          },
          error: (err: any) => {
            console.warn('[encolar] no se pudo agregar a cola', err?.status, err?.error);
            // No bloqueamos el flujo (la consulta del candidato igual procede),
            // pero el operador TIENE que enterarse: antes fallaba en silencio y
            // la persona simplemente no aparecia en la tabla.
            this.toast('error', this.mensajeErrorEncolar(err));
          },
        });
    }
  }

  /** Motivo legible del fallo al encolar. */
  private mensajeErrorEncolar(err: any): string {
    const detail = err?.error?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (err?.status === 404) return 'No se pudo poner en cola: el candidato no existe en la base.';
    if (err?.status === 0) return 'No se pudo poner en cola: sin conexion con el servidor.';
    return 'No se pudo poner en cola. Revisa con soporte.';
  }

  /** Aviso corto que no interrumpe el flujo de atencion. */
  private toast(icon: 'info' | 'error', title: string): void {
    void Swal.fire({
      toast: true,
      position: 'top-end',
      icon,
      title,
      showConfirmButton: false,
      timer: icon === 'error' ? 6000 : 4000,
      timerProgressBar: true,
    });
  }

  /** Consulta vetados y avisa. Tolerante a fallos: no frena la búsqueda. */
  private consultarVetados(cedula: string, seq: number): void {
    this.procesoValido = false;
    this.vetadosService.listarReportesVetadosPorCedula(cedula)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (vetado: any[] | null) => {
          if (seq !== this._busquedaSeq) return;
          if (!vetado?.length) return;
          this.procesarVetado(vetado);
          Swal.fire({
            icon: 'warning',
            title: 'Persona con reporte',
            text: 'Esta cédula tiene reportes en la lista de vetados. Revisa antes de continuar con el proceso.',
            confirmButtonText: 'Entendido',
          });
        },
        error: (err: any) => console.warn('[vetados] no se pudo consultar', err?.status, err?.error),
      });
  }

  /* vetados */
  private procesarVetado(vetado: any[] | null): void {
    if (!vetado?.length) return;
    this.procesoValido = true;
  }

  /* ──────────  Observación  ────────── */
  mostrarCampoObservacion(): void {
    console.log('mostrarCampoObservacion()');
    this.mostrarObservacion = true;
  }

  enviarObservacion(): void {
    if (!this.observacion.trim()) {
      Swal.fire('Error', 'Debe escribir una observación.', 'error');
      return;
    }

    this.utilityService.getUser().then((u: any) => {
      if (!u) {
        Swal.fire('Error', 'No hay usuario en sesión', 'error');
        return;
      }

      const nombre = `${u?.datos_basicos?.nombres ?? ''} ${u?.datos_basicos?.apellidos ?? ''} - ${u?.rol?.nombre ?? ''}`.trim();
      const sedeNombre = u?.sede?.nombre ?? '';

      const reporte = {
        cedula: this.cedula,
        observacion: this.observacion.trim(),
        centro_costo_carnet: '',
        reportadoPor: nombre
      };

      this.vetadosService.enviarReporte(reporte, sedeNombre).pipe(take(1)).subscribe({
        next: () => {
          Swal.fire('Éxito', 'Observación enviada.', 'success');
          this.mostrarObservacion = false;
          this.observacion = '';
        },
        error: () => Swal.fire('Error', 'No se pudo enviar la observación.', 'error')
      });
    });
  }

  /* ──────────  Antecedentes del robot  ────────── */

  /** Texto del badge general de antecedentes (columna "Antecedentes"). */
  antecedentesLabel(item: CandidatoRecienteItem): string {
    const a = item.antecedentes;
    if (!a || a.estado_general === 'NO_REGISTRADO') return 'No solicitado';
    if (a.completado || a.estado_general === 'FINALIZADO') return 'Completo';
    if (a.estado_general === 'EN_PROGRESO') return `Consultando ${a.finalizadas}/${a.total}`;
    return 'En cola';
  }

  /** Clase CSS del badge general según el estado de antecedentes. */
  antecedentesBadgeClass(item: CandidatoRecienteItem): string {
    const a = item.antecedentes;
    if (!a || a.estado_general === 'NO_REGISTRADO') return 'badge-sin-iniciar';
    if (a.completado || a.estado_general === 'FINALIZADO') return 'badge-completo';
    if (a.estado_general === 'EN_PROGRESO') return 'badge-parcial';
    return 'badge-atendido';
  }

  /** Ícono del badge general de antecedentes. */
  antecedentesIcon(item: CandidatoRecienteItem): string {
    const a = item.antecedentes;
    if (!a || a.estado_general === 'NO_REGISTRADO') return 'help_outline';
    if (a.completado || a.estado_general === 'FINALIZADO') return 'verified_user';
    if (a.estado_general === 'EN_PROGRESO') return 'sync';
    return 'schedule';
  }

  /** Estado puntual de una fuente para esta cédula. */
  fuenteEstado(item: CandidatoRecienteItem, fuente: AntecedenteFuente): AntecedenteEstadoFuente {
    return item.antecedentes?.fuentes?.[fuente] ?? null;
  }

  /** Clase CSS del chip de una fuente (color por estado). */
  fuenteChipClass(item: CandidatoRecienteItem, fuente: AntecedenteFuente): string {
    const estado = this.fuenteEstado(item, fuente);
    switch (estado) {
      case 'FINALIZADO': return 'chip-fuente-ok';
      case 'EN_PROGRESO': return 'chip-fuente-progreso';
      case 'BLOQUEADO':
      case 'RECHAZADO_INCUMPLIMIENTO': return 'chip-fuente-bloqueado';
      case 'SIN_CONSULTAR': return 'chip-fuente-pendiente';
      default: return 'chip-fuente-na';
    }
  }

  /** Tooltip por chip: "Contraloría: Listo". */
  fuenteTooltip(item: CandidatoRecienteItem, fuente: AntecedenteFuente, label: string): string {
    const estado = this.fuenteEstado(item, fuente);
    if (!estado) return `${label}: No solicitado`;
    return `${label}: ${this.estadoFuenteLabel[estado] ?? estado}`;
  }
}
