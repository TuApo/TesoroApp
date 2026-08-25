import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { catchError, of, take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SharedModule } from '@/app/shared/shared.module';
import { MatIconModule } from '@angular/material/icon';
import { PDFDocument } from 'pdf-lib';
import Swal from 'sweetalert2';

import { ElectronWindowService } from '@/app/core/services/electron-window.service';

import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { VacantesService } from '../../service/vacantes/vacantes.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';
import { procesoDelContrato, procesoVigente } from '../../pages/recruitment-pipeline/contrato.rules';
import {
  DOCUMENTOS_PAQUETE,
  TYPE_ID_POR_TITULO,
  esSoloSubir,
} from '../../shared/paquete-documental.data';
import { isDocumentoVisible } from '../generate-contracting-documents/documentos-por-empresa.config';

/** Un documento del paquete y en qué va. */
export interface ItemPaquete {
  titulo: string;
  /** `true` = llega de fuera y hay que subirlo; `false` = lo genera la plataforma. */
  soloSubir: boolean;
  /** Ya está en el expediente. */
  listo: boolean;
  /** Tipo con el que lo guarda gestión documental; `null` si aún no tiene. */
  typeId: number | null;
  /** URL del archivo cuando ya está subido, para poder abrirlo. */
  fileUrl: string | null;
}

/**
 * El paquete documental del día, de un vistazo.
 *
 * Qué documentos le tocan a ESTA persona depende de la empresa usuaria y la
 * finca de su vacante, así que la lista no es fija: se resuelve con las mismas
 * reglas que usa el generador (`documentos-por-empresa.config`) y sobre la
 * misma lista de títulos (`shared/paquete-documental.data`). Aquí no se
 * genera ni se sube nada —eso es la pantalla de generación, que son catorce
 * mil líneas—: esto dice QUÉ falta para cerrar el paquete y lleva allá.
 */
@Component({
  selector: 'app-documentos-paquete',
  standalone: true,
  imports: [SharedModule, MatIconModule],
  templateUrl: './documentos-paquete.component.html',
  styleUrls: ['./documentos-paquete.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentosPaqueteComponent {
  candidatoSeleccionado = input<any | null>(null);
  /** Sube con cada consulta nueva del buscador: obliga a releer el expediente. */
  consultaSeq = input<number>(0);

  private readonly docsSrv = inject(GestionDocumentalService);
  private readonly vacantesSrv = inject(VacantesService);
  private readonly nav = inject(PipelineNavService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ventanas = inject(ElectronWindowService);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  /** Lo que ya está en el expediente, por tipo: sirve para marcar y para abrir. */
  private readonly docPorTipo = signal<ReadonlyMap<number, string>>(new Map());
  /** Código del contrato: acompaña a cada documento que se sube. */
  private codigoContratacion: string | null = null;
  /** Documento subiéndose ahora mismo (título), para bloquear su fila. */
  readonly subiendo = signal<string | null>(null);
  /** Vacante remitida: de ella dependen los documentos que aplican. */
  private readonly vacante = signal<Record<string, unknown> | null>(null);

  /** Clave del último expediente leído, para no releerlo en cada refresco. */
  private leidoPara: string | null = null;

  constructor() {
    effect(() => {
      const cand = this.candidatoSeleccionado();
      const ced = cand?.numero_documento ? String(cand.numero_documento) : null;
      const clave = ced ? `${ced}#${this.consultaSeq()}` : null;
      if (clave === this.leidoPara) return;
      this.leidoPara = clave;
      this.vacante.set(null);
      this.docPorTipo.set(new Map());
      if (ced) this.cargar(ced, cand);
    });

    // El avance del paquete alimenta el rail, igual que los demás sub-pasos.
    effect(() => {
      const items = this.items();
      this.nav.publicar('documentos', {
        hechos: items.filter((i) => i.listo).length,
        total: items.length,
      });
    });
  }

  private cargar(cedula: string, cand: unknown): void {
    this.cargando.set(true);
    this.error.set(null);

    const proc = procesoDelContrato(cand) ?? procesoVigente(cand) as Record<string, unknown> | null;
    const p = proc as Record<string, any> | null;
    this.codigoContratacion =
      p?.['contrato_codigo'] ?? p?.['contrato']?.['codigo_contrato'] ?? null;
    const vacanteId = p?.['publicacion'] ?? null;

    if (vacanteId) {
      this.vacantesSrv.obtenerVacante(String(vacanteId))
        .pipe(take(1), catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
        .subscribe((v) => this.vacante.set((v as Record<string, unknown>) ?? null));
    }

    this.docsSrv.getDocuments(cedula)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r: unknown) => {
          const lista = Array.isArray(r)
            ? r
            : ((r as Record<string, unknown>)?.['results'] as unknown[]) ?? [];
          const porTipo = new Map<number, string>();
          for (const d of lista as Array<Record<string, unknown>>) {
            const t = Number(d?.['type']);
            if (!Number.isFinite(t)) continue;
            // Se queda el primero: el backend ya devuelve el vigente de cada tipo.
            if (!porTipo.has(t)) porTipo.set(t, String(d?.['file_url'] ?? ''));
          }
          this.docPorTipo.set(porTipo);
          this.cargando.set(false);
        },
        error: () => {
          this.error.set('No se pudo leer el expediente. Reintenta o ábrelo en Generar documentación.');
          this.cargando.set(false);
        },
      });
  }

  /** Los documentos que le tocan a esta persona, con su estado. */
  readonly items = computed<ItemPaquete[]>(() => {
    const v = this.vacante();
    const ctx = {
      temporal: (v?.['temporal'] as string) ?? null,
      empresaUsuaria: (v?.['empresaUsuariaSolicita'] as string) ?? null,
      finca: (v?.['finca'] as string) ?? null,
    };
    const presentes = this.docPorTipo();

    return DOCUMENTOS_PAQUETE
      .filter((t) => isDocumentoVisible(t, ctx))
      .map((titulo) => {
        const typeId = TYPE_ID_POR_TITULO[titulo] ?? null;
        const url = typeId !== null ? presentes.get(typeId) ?? null : null;
        return {
          titulo,
          soloSubir: esSoloSubir(titulo),
          listo: typeId !== null && presentes.has(typeId),
          typeId,
          fileUrl: url || null,
        };
      });
  });

  /** Los que genera la plataforma. */
  readonly generables = computed(() => this.items().filter((i) => !i.soloSubir));
  /** Los que hay que subir. */
  readonly porSubir = computed(() => this.items().filter((i) => i.soloSubir));

  readonly listosGenerables = computed(() => this.generables().filter((i) => i.listo).length);
  readonly listosPorSubir = computed(() => this.porSubir().filter((i) => i.listo).length);

  readonly total = computed(() => this.items().length);
  readonly listos = computed(() => this.items().filter((i) => i.listo).length);
  readonly faltan = computed(() => this.total() - this.listos());
  readonly pct = computed(() => {
    const t = this.total();
    return t > 0 ? Math.round((this.listos() / t) * 100) : 0;
  });

  /**
   * Sin vacante remitida no se sabe a qué empresa va, y el filtro cae al
   * mínimo (cédula, contrato y hoja de vida). Se avisa, porque una lista de
   * tres documentos parece un paquete completo cuando no lo es.
   */
  readonly sinVacante = computed(() => !this.vacante());

  irAGenerar(): void {
    const cand = this.candidatoSeleccionado();
    const ced = cand?.numero_documento;
    if (!ced) return;
    this.router.navigate(['/dashboard/hiring/generate-contracting-documents', ced], {
      queryParams: { tipo_doc: cand?.tipo_doc || 'CC' },
    });
  }

  /** Abre el documento que ya está subido. */
  ver(item: ItemPaquete): void {
    if (!item.fileUrl) return;
    this.ventanas.openExternal(item.fileUrl);
  }

  /**
   * Sube un PDF sin salir del pipeline.
   *
   * Mismas guardas que la pantalla de generación —nombre de archivo y PDF que
   * pide contraseña— y el MISMO endpoint, con el código de contrato y el tipo
   * de documento de la persona: un documento subido desde aquí tiene que
   * quedar idéntico a uno subido desde allá, o el expediente se parte en dos
   * según por dónde se haya entrado.
   */
  async subir(evento: Event, item: ItemPaquete): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || item.typeId === null) return;

    const cand = this.candidatoSeleccionado();
    const cedula = cand?.numero_documento ? String(cand.numero_documento) : null;
    if (!cedula) return;

    if (file.name.length > 100) {
      Swal.fire('Nombre muy largo', 'El nombre del archivo no debe pasar de 100 caracteres.', 'error');
      return;
    }

    if (await this.pdfPideClave(file)) {
      Swal.fire({
        icon: 'error',
        title: 'PDF protegido',
        html: 'Este PDF está <b>protegido con contraseña</b>. No se puede subir.<br><br>'
            + 'Quítale la contraseña y vuelve a intentarlo.',
      });
      return;
    }

    this.subiendo.set(item.titulo);
    this.docsSrv
      .guardarDocumento(
        item.titulo,
        cedula,
        item.typeId,
        file,
        this.codigoContratacion ?? undefined,
        String(cand?.tipo_doc || '').trim() || undefined,
      )
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.subiendo.set(null);
          this.recargar();
        },
        error: (e: any) => {
          this.subiendo.set(null);
          Swal.fire(
            'No se pudo subir',
            e?.error?.message || e?.message || 'Inténtalo de nuevo.',
            'error',
          );
        },
      });
  }

  /**
   * ¿El PDF exige contraseña para ABRIRSE?
   *
   * Ojo con la diferencia: muchos PDF de EPS y cajas traen cifrado de solo
   * permisos (no imprimir, no editar) y se abren sin pedir nada. Esos hay que
   * dejarlos subir, así que la prueba es si el documento abre y tiene páginas,
   * no si viene cifrado.
   */
  private async pdfPideClave(file: File): Promise<boolean> {
    const esPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!esPdf) return false;
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      return doc.getPageCount() === 0;
    } catch {
      return true;
    }
  }

  recargar(): void {
    this.leidoPara = null;
    const cand = this.candidatoSeleccionado();
    const ced = cand?.numero_documento ? String(cand.numero_documento) : null;
    if (ced) this.cargar(ced, cand);
  }
}
