import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  CargaDisponible, CruceRespuesta, DocumentoCruce, EnvioCorreosService, FilaCruce,
  PeriodoDisponible, Plantilla, TipoRef,
} from '../../service/envio-correos/envio-correos.service';
import {
  VisorDocumentoComponent, VisorDocumentoData,
} from '../../components/visor-documento/visor-documento.component';

/**
 * Nómina → Envío de correos (modelo antiguo) → Cruce por quincena.
 *
 * Responde la pregunta que hoy se contesta a ojo sobre la hoja de cálculo:
 * de la gente que va en este corte, ¿a quién le falta el archivo?
 *
 * Junta la hoja (`tabla_desprendibles`, ms-payroll) con los archivos ya
 * cargados por carpeta (ms-documents). Donde antes había un link de Drive, si
 * el documento ya está en la plataforma se muestra el interno; el enlace legacy
 * queda como respaldo para el histórico que no se va a migrar.
 */
@Component({
  selector: 'app-envio-correos-cruce',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatCardModule, MatDialogModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatPaginatorModule, MatProgressBarModule,
    MatCheckboxModule, MatSelectModule, MatTableModule, MatTooltipModule,
  ],
  templateUrl: './envio-correos-cruce.component.html',
  styleUrl: './envio-correos-cruce.component.css',
})
export class EnvioCorreosCruceComponent implements OnInit {
  private srv = inject(EnvioCorreosService);
  private titulo = inject(Title);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  /** NOMINA | LIQUIDACION: decide qué plantilla aplica al borrador. */
  readonly tipoEnvioSel = signal<'NOMINA' | 'LIQUIDACION'>('NOMINA');

  readonly cargando = signal(false);
  readonly periodos = signal<PeriodoDisponible[]>([]);
  readonly tipos = signal<TipoRef[]>([]);
  readonly datos = signal<CruceRespuesta | null>(null);

  // Filtros
  readonly periodoSel = signal<string | null>(null);
  readonly tipoSel = signal<number | null>(null);
  readonly empresaSel = signal<string | null>(null);
  readonly estadoSel = signal<string>('TODOS');
  readonly busqueda = signal<string>('');
  readonly pagina = signal(0);
  readonly tamanoPagina = signal(50);

  /**
   * Cargas elegidas. Vacío = todas las de la quincena.
   *
   * Es la pieza que faltaba: una liquidación no es un documento sino un juego
   * —liquidación, carta de retiro, certificación, cesantías— y cada pieza se
   * sube desde una CARPETA distinta. Sin poder elegir varias cargas no había
   * forma de armar el envío completo.
   */
  readonly cargasSel = signal<number[]>([]);
  readonly plantillas = signal<Plantilla[]>([]);
  readonly plantillaSel = signal<number | null>(null);
  readonly creandoBorrador = signal(false);

  readonly filas = computed<FilaCruce[]>(() => this.datos()?.content ?? []);
  readonly resumen = computed(() => this.datos()?.resumen ?? null);
  readonly advertencias = computed<string[]>(() => this.datos()?.advertencias ?? []);
  readonly cargas = computed<CargaDisponible[]>(() => this.datos()?.cargas_disponibles ?? []);
  readonly tiposPresentes = computed<string[]>(() => this.datos()?.tipos_presentes ?? []);

  /**
   * Columnas de la tabla: las fijas más UNA POR TIPO documental presente.
   *
   * Es lo que reproduce la hoja original (Desprendibles, Certificaciones,
   * Cartas de retiro, Cesantías, Entrevista): de un vistazo se ve a quién le
   * falta QUÉ, no solo si le falta "algo".
   */
  readonly columnas = computed<string[]>(() => {
    const tipos = this.tiposPresentes();
    return [
      'cedula', 'nombre', 'finca', 'correo',
      // Con cargas elegidas: una columna por tipo. Sin ellas no hay tipos que
      // desglosar, pero seguir mostrando si la persona tiene documento o no es
      // justo lo que se viene a mirar; si no, la tabla no dice nada.
      ...(tipos.length ? tipos.map((t) => `tipo:${t}`) : ['archivo']),
      'enviado',
    ];
  });

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Cruce por quincena | Envío de correos (modelo antiguo)');
    this.cargando.set(true);
    try {
      const [periodos, tipos, plantillas] = await Promise.all([
        firstValueFrom(this.srv.periodos()),
        firstValueFrom(this.srv.tiposDisponibles()),
        firstValueFrom(this.srv.plantillas()),
      ]);
      this.periodos.set(periodos.content);
      this.tipos.set(tipos);
      this.plantillas.set(plantillas.content.filter((p) => p.activo));
      // La lista viene de la más reciente a la más antigua: arrancar en la
      // primera es lo que quiere ver quien entra a revisar el corte del día.
      if (periodos.content.length) {
        this.periodoSel.set(periodos.content[0].clave);
        await this.consultar();
      }
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudieron cargar las quincenas disponibles.');
    } finally {
      this.cargando.set(false);
    }
  }

  async consultar(reiniciarPagina = false): Promise<void> {
    const periodo = this.periodoSel();
    if (!periodo) return;
    if (reiniciarPagina) this.pagina.set(0);

    this.cargando.set(true);
    try {
      this.datos.set(await firstValueFrom(this.srv.cruce({
        periodoClave: periodo,
        typeId: this.tipoSel(),
        empresa: this.empresaSel(),
        estado: this.estadoSel(),
        q: this.busqueda().trim() || undefined,
        loteIds: this.cargasSel(),
        page: this.pagina(),
        size: this.tamanoPagina(),
      })));
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo consultar el cruce.');
    } finally {
      this.cargando.set(false);
    }
  }

  onPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex);
    this.tamanoPagina.set(e.pageSize);
    this.consultar();
  }

  /**
   * Abre el documento interno en un visor.
   *
   * NO usa `window.open(url)`: `/api/v1/documents/**` exige JWT en el gateway y
   * una navegación directa responde 401. El visor lo descarga por HttpClient
   * (con token) y lo muestra desde un object URL.
   */
  verDocumento(fila: FilaCruce): void {
    if (!fila.document_id) return;
    this.dialog.open<VisorDocumentoComponent, VisorDocumentoData>(VisorDocumentoComponent, {
      data: {
        documentId: fila.document_id,
        nombreArchivo: fila.nombre_archivo,
        cedula: fila.cedula,
        titulo: fila.nombre,
      },
      width: '900px',
      maxWidth: '95vw',
    });
  }

  /** Marca/desmarca una carga y vuelve a cruzar. */
  alternarCarga(loteId: number): void {
    this.cargasSel.update((sel) =>
      sel.includes(loteId) ? sel.filter((x) => x !== loteId) : [...sel, loteId]);
    this.consultar(true);
  }

  cargaSeleccionada(loteId: number): boolean {
    return this.cargasSel().includes(loteId);
  }

  limpiarCargas(): void {
    this.cargasSel.set([]);
    this.consultar(true);
  }

  /** Documento de esa persona para ese tipo, o null si le falta. */
  documentoDeTipo(fila: FilaCruce, tipo: string): DocumentoCruce | null {
    return fila.documentos?.find((d) => d.type_name === tipo) ?? null;
  }

  /** Nombre del tipo a partir de la clave de columna 'tipo:NOMBRE'. */
  tipoDeColumna(columna: string): string {
    return columna.startsWith('tipo:') ? columna.slice(5) : columna;
  }

  esColumnaTipo(columna: string): boolean {
    return columna.startsWith('tipo:');
  }

  verDocumentoDe(fila: FilaCruce, doc: DocumentoCruce): void {
    this.dialog.open<VisorDocumentoComponent, VisorDocumentoData>(VisorDocumentoComponent, {
      data: {
        documentId: doc.document_id,
        nombreArchivo: doc.nombre_archivo,
        cedula: fila.cedula,
        titulo: `${fila.nombre} · ${doc.type_name ?? ''}`,
      },
      width: '900px',
      maxWidth: '95vw',
    });
  }

  /**
   * Crea el BORRADOR del envío con las cargas elegidas.
   *
   * No manda nada: deja el lote en PREPARADO con sus destinatarios y adjuntos
   * resueltos, para revisarlo y dispararlo desde la pantalla de envío.
   */
  async crearBorrador(): Promise<void> {
    const periodo = this.periodoSel();
    if (!periodo) return;

    const cargas = this.cargasSel();
    const r = this.resumen();
    const confirma = await Swal.fire({
      icon: 'question',
      title: '¿Crear el borrador de envío?',
      html: `Quincena <b>${this.datos()?.periodo_etiqueta}</b>
             ${cargas.length
               ? `con <b>${cargas.length}</b> carga(s) de documentos seleccionadas`
               : 'con <b>todas</b> las cargas de la quincena'}.<br><br>
             Se prepara el envío para <b>${r?.total_personas ?? 0}</b> persona(s).
             <b>No se manda ningún correo todavía.</b>`,
      showCancelButton: true,
      confirmButtonText: 'Crear borrador',
      cancelButtonText: 'Cancelar',
    });
    if (!confirma.isConfirmed) return;

    this.creandoBorrador.set(true);
    try {
      const detalle = await firstValueFrom(this.srv.prepararLote({
        periodo_clave: periodo,
        empresa: this.empresaSel(),
        type_id: this.tipoSel(),
        tipo: this.tipoEnvioSel(),
        plantilla_id: this.plantillaSel(),
        omitir_ya_enviados: true,
        lote_ids: cargas,
      }));
      const res = await Swal.fire({
        icon: 'success',
        title: 'Borrador creado',
        html: `<b>${detalle.listos_para_enviar}</b> destinatario(s) listos.<br>
               ${detalle.advertencias.length
                 ? `<small>${detalle.advertencias.join('<br>')}</small>`
                 : ''}`,
        showCancelButton: true,
        confirmButtonText: 'Ir a enviar',
        cancelButtonText: 'Seguir aquí',
      });
      if (res.isConfirmed) this.router.navigate(['/dashboard/nomina/envio-correos/enviar']);
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo crear el borrador.');
    } finally {
      this.creandoBorrador.set(false);
    }
  }

  nombreEmpresa(v: string | null): string {
    if (v === 'APOYO_LABORAL') return 'Apoyo Laboral';
    if (v === 'ALIANZA') return 'Tu Alianza';
    return 'Ambas';
  }

  porcentaje(parte: number, total: number): number {
    return total === 0 ? 0 : Math.round((parte / total) * 100);
  }

  tamanoLegible(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private error(mensaje: string): void {
    Swal.fire({ icon: 'error', title: 'Error', text: mensaje });
  }
}
