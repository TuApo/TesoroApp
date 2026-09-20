/**
 * Submodulo "Alertas de incapacidades" (reunion 2026-09-07): bandeja de las alertas que el
 * motor de reglas ya persistia (180/540, proximas a 180, prescritas, traslapes, falsedad) y que
 * nadie mostraba. Se filtran, se atienden/descartan con nota y se ve a quien van dirigidas.
 *
 * FALSEDAD -> CONTRATACION: el bloqueo automatico del trabajador en la base de contratacion se
 * coordinara con Ivan; por instruccion expresa aqui SOLO se muestra la alerta marcada, no se toca
 * nada de contratacion.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import Swal from 'sweetalert2';

import { ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent, TonoBadge } from '../../../../../../shared/components/tabla-estandar';
import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import {
  AlertaBandeja,
  AlertasResumen,
  DestinoAlertaIncapacidad,
  ETIQUETA_DESTINO_ALERTA,
  ETIQUETA_ESTADO_ALERTA,
  ETIQUETA_TIPO_ALERTA,
  EstadoAlertaIncapacidad,
  FiltrosAlertas,
  TipoAlertaIncapacidad,
} from '../../models/incapacidad-gestion.model';
import { FilaInformeUmbral, InformeUmbral } from '../../models/incapacidad-v2.model';
import { DialogoInformeUmbralComponent } from '../consulta-incapacidades/dialogos/dialogo-informe-umbral/dialogo-informe-umbral.component';
import {
  aFecha,
  fechaTexto,
  mensajeDeError,
  tonoDeChip,
} from '../informes-incapacidades/informes-incapacidades.component';

/** Clase del chip por tipo de alerta (color = gravedad). */
export function claseTipoAlerta(tipo: TipoAlertaIncapacidad): string {
  switch (tipo) {
    case 'INCAPACIDAD_FALSA': return 'ges-chip-peligro';
    case 'MAS_DE_180_DIAS':
    case 'MAS_DE_540_DIAS': return 'ges-chip-morado';
    case 'PROXIMO_A_180':
    case 'PRESCRITA': return 'ges-chip-aviso';
    default: return 'ges-chip-info';
  }
}

/** Tono del chip por tramo de los umbrales 180 / 540 (mismos colores que antes). */
function tonoTramo(tramo: FilaInformeUmbral['tramo']): TonoBadge {
  switch (tramo) {
    case 'SUPERA_180': return 'danger';
    case 'PROXIMO_180': return 'warn';
    case 'SUPERA_540':
    case 'PROXIMO_540': return 'violet';
    default: return 'neutro';
  }
}

export function claseEstadoAlerta(estado: EstadoAlertaIncapacidad): string {
  switch (estado) {
    case 'ATENDIDA':
    case 'NOTIFICADA': return 'ges-chip-ok';
    case 'DESCARTADA': return 'ges-chip-neutro';
    default: return 'ges-chip-aviso';
  }
}

@Component({
  selector: 'app-alertas-incapacidades',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatTabsModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './alertas-incapacidades.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './alertas-incapacidades.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertasIncapacidadesComponent implements OnInit {
  private readonly srv = inject(IncapacidadGestionService);
  private readonly dialogo = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly tipos = Object.entries(ETIQUETA_TIPO_ALERTA) as [TipoAlertaIncapacidad, string][];
  readonly destinos = Object.entries(ETIQUETA_DESTINO_ALERTA) as [DestinoAlertaIncapacidad, string][];
  readonly estados = Object.entries(ETIQUETA_ESTADO_ALERTA) as [EstadoAlertaIncapacidad, string][];

  filtros: FiltrosAlertas = { estado: 'PENDIENTE', destino: '', tipo: '', cedula: '' };
  readonly page = signal(0);
  readonly size = signal(25);
  readonly total = signal(0);
  readonly filas = signal<AlertaBandeja[]>([]);
  readonly resumen = signal<AlertasResumen | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly tab = signal(0);

  /** Umbrales 180/540 en vivo (pestana propia). */
  readonly umbral = signal<InformeUmbral | null>(null);
  readonly cargandoUmbral = signal(false);
  margenUmbral = 30;

  readonly rutaConsulta = '/dashboard/disabilities/consulta';
  readonly claseTipo = claseTipoAlerta;
  readonly claseEstado = claseEstadoAlerta;

  readonly filasFalsedad = computed(() => this.filas().filter((f) => f.paraContratacion));

  /**
   * La tabla de la bandeja guarda su propia pagina. Se le sincroniza la que se
   * pidio al backend: al filtrar (vuelve a la 1) y al volver a la pestana,
   * donde la tabla se crea de nuevo (el contenido de la pestana es perezoso).
   */
  private readonly tablaBandeja = viewChild<TablaEstandarComponent<AlertaBandeja>>('tablaBandeja');
  private readonly sincronizarPagina = effect(() => {
    const tabla = this.tablaBandeja();
    const pagina = this.page();
    if (tabla) untracked(() => tabla.pagina.set(pagina));
  });

  /**
   * Bandeja en modo servidor: la pagina va al backend y el endpoint no ordena
   * ni busca texto libre (el filtro de cedula es de negocio y queda arriba).
   */
  readonly columnasBandeja: ColumnaTabla<AlertaBandeja>[] = [
    { id: 'alerta', header: 'Alerta', ordenable: false, tarjeta: 'badge',
      valor: (f) => f.tipoEtiqueta,
      badge: (f) => ({ texto: f.tipoEtiqueta, tono: tonoDeChip(claseTipoAlerta(f.tipo)) }) },
    { id: 'destino', header: 'Dirigida a', ordenable: false, tarjeta: 'meta',
      valor: (f) => f.destinoEtiqueta },
    { id: 'persona', header: 'Persona', ordenable: false, tarjeta: 'titulo', minAncho: '180px',
      valor: (f) => f.nombreCompleto },
    { id: 'incapacidad', header: 'Incapacidad', ordenable: false, tarjeta: 'subtitulo', interactiva: true,
      valor: (f) => f.codigoConsecutivo || '#' + f.incapacidadId },
    { id: 'mensaje', header: 'Mensaje', ordenable: false, prioridad: 2, tarjeta: 'cuerpo', minAncho: '220px',
      valor: (f) => f.mensaje ?? '' },
    { id: 'estado', header: 'Estado', ordenable: false, tarjeta: 'badge',
      valor: (f) => f.estadoEtiqueta },
    { id: 'creada', header: 'Creada', ordenable: false, prioridad: 2, tarjeta: 'meta',
      valor: (f) => fechaTexto(f.creadaEn, 'dd/MM/yyyy HH:mm') },
  ];

  readonly idAlerta = (f: AlertaBandeja) => f.id;
  /** Falsedad dirigida a contratacion: la fila queda marcada. */
  readonly claseAlerta = (f: AlertaBandeja) => (f.paraContratacion ? 'te-fila--peligro' : '');

  /** Proximos a 180 / 540: todo en cliente (el informe llega completo). */
  readonly columnasUmbral: ColumnaTabla<FilaInformeUmbral>[] = [
    { id: 'cedula', header: 'Cedula', valor: (f) => f.cedula, tarjeta: 'subtitulo' },
    { id: 'nombre', header: 'Nombre', valor: (f) => f.nombreCompleto, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'empresa', header: 'Empresa', valor: (f) => f.empresa ?? '', formato: (f) => f.empresa || '—', tarjeta: 'cuerpo' },
    { id: 'eps', header: 'EPS', valor: (f) => f.eps ?? '', formato: (f) => f.eps || '—', prioridad: 2, tarjeta: 'meta' },
    { id: 'diagnostico', header: 'Diagnostico', valor: (f) => f.codigoDiagnostico ?? '',
      formato: (f) => f.codigoDiagnostico || '—', prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'dias', header: 'Dias acum.', valor: (f) => f.diasAcumulados, align: 'right', tarjeta: 'meta' },
    { id: 'fin', header: 'Fin ultima', valor: (f) => aFecha(f.fechaFinUltima),
      formato: (f) => fechaTexto(f.fechaFinUltima), copiaTexto: (f) => fechaTexto(f.fechaFinUltima),
      prioridad: 2, tarjeta: 'meta' },
    { id: 'tramo', header: 'Tramo', valor: (f) => f.tramoEtiqueta, tarjeta: 'badge',
      badge: (f) => ({ texto: f.tramoEtiqueta, tono: tonoTramo(f.tramo) }) },
  ];

  readonly idUmbral = (f: FilaInformeUmbral) => f.incapacidadId;

  ngOnInit(): void {
    this.cargarResumen();
    this.cargar();
    this.cargarUmbral();
  }

  cargarResumen(): void {
    this.srv.alertasResumen().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => this.resumen.set(r),
      error: () => this.resumen.set(null),
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.srv
      .alertas(this.filtros, this.page(), this.size())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => {
          this.filas.set(p.content);
          this.total.set(p.totalElements);
          this.cargando.set(false);
        },
        error: (e: unknown) => {
          this.cargando.set(false);
          this.error.set(mensajeDeError(e, 'No se pudo cargar la bandeja de alertas.'));
        },
      });
  }

  cargarUmbral(): void {
    this.cargandoUmbral.set(true);
    this.srv.proximosUmbral(this.margenUmbral).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (u) => { this.umbral.set(u); this.cargandoUmbral.set(false); },
      error: () => { this.umbral.set(null); this.cargandoUmbral.set(false); },
    });
  }

  filtrar(): void {
    this.page.set(0);
    this.cargar();
  }

  /** Clic en un KPI = filtro rapido. */
  filtroRapido(tipo: TipoAlertaIncapacidad | '', destino: DestinoAlertaIncapacidad | ''): void {
    this.filtros = { estado: 'PENDIENTE', tipo, destino, cedula: '' };
    this.filtrar();
  }

  paginar(e: { pagina: number; porPagina: number }): void {
    this.page.set(e.pagina);
    this.size.set(e.porPagina);
    this.cargar();
  }

  abrirInformeUmbral(): void {
    this.dialogo.open(DialogoInformeUmbralComponent, {
      width: '1000px', maxWidth: '95vw', maxHeight: '92vh', autoFocus: false, panelClass: 'disab-dialogo',
    });
  }

  /** Atender / descartar con nota (SweetAlert2, mismo patron que la consulta). */
  atender(fila: AlertaBandeja, estado: EstadoAlertaIncapacidad): void {
    const titulo = estado === 'ATENDIDA' ? 'Marcar como atendida' : estado === 'DESCARTADA' ? 'Descartar alerta' : 'Reabrir alerta';
    void Swal.fire({
      icon: estado === 'DESCARTADA' ? 'warning' : 'question',
      title: titulo,
      html:
        `<p style="margin:0 0 8px"><b>${escapar(fila.tipoEtiqueta)}</b> · ${escapar(fila.nombreCompleto)} (CC ${escapar(fila.cedula)})</p>` +
        `<p style="margin:0;font-size:13px;color:#64748b">${escapar(fila.mensaje ?? '')}</p>`,
      input: 'textarea',
      inputLabel: 'Nota (opcional)',
      inputPlaceholder: 'Que se hizo o por que se descarta',
      inputValue: fila.nota ?? '',
      showCancelButton: true,
      confirmButtonText: titulo,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: estado === 'DESCARTADA' ? '#c62828' : '#1976d2',
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.srv
        .atenderAlerta(fila.id, estado, typeof r.value === 'string' ? r.value : undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => { this.cargarResumen(); this.cargar(); },
          error: (e: unknown) => void Swal.fire({ icon: 'error', title: 'No se pudo actualizar', text: mensajeDeError(e, 'Intente de nuevo.') }),
        });
    });
  }
}

function escapar(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
