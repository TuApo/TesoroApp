import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal,
} from '@angular/core';
import { take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { SharedModule } from '@/app/shared/shared.module';
import { MatIconModule } from '@angular/material/icon';
import { PDFDocument } from 'pdf-lib';
import Swal from 'sweetalert2';

import { ElectronWindowService } from '@/app/core/services/electron-window.service';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import {
  ORDEN_PAQUETE_COMPLETO, ORDEN_PAQUETE_FINCA, indiceEnOrden, tituloDeTipo,
} from '../../shared/orden-empalme.data';

/** Un archivo del expediente, colocado en el empalme. */
export interface DocEmpalme {
  /** Id del documento en gestión documental; la clave de la fila. */
  id: string;
  typeId: number;
  titulo: string;
  /** Nombre con el que se guardó el archivo. */
  archivo: string;
  url: string;
  fecha: string | null;
  /** Entra en el PDF final. */
  incluido: boolean;
}

/**
 * ORGANIZACIÓN DE EMPALME
 *
 * El expediente de una persona son treinta archivos sueltos; quien lo recibe
 * —la empresa usuaria, el archivo físico, una auditoría— lo quiere como UN
 * PDF y en el orden en que se revisa. Eso ya existía para lotes de cédulas en
 * "Buscar documentos" (el diálogo de orden y unión); aquí es lo mismo para la
 * persona que se tiene delante, sin salir del pipeline.
 *
 * El orden por defecto NO se decide aquí: sale de `shared/orden-empalme.data`,
 * el mismo que usa el empalme en lote. Se puede reordenar arrastrando y
 * quitar lo que no vaya, y el PDF se arma en el navegador (pdf-lib) para no
 * cargar al backend con un trabajo de una sola persona.
 */
@Component({
  selector: 'app-empalme-documentos',
  standalone: true,
  imports: [SharedModule, MatIconModule, DragDropModule],
  templateUrl: './empalme-documentos.component.html',
  styleUrls: ['./empalme-documentos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpalmeDocumentosComponent {
  candidatoSeleccionado = input<any | null>(null);
  /** Cédula ya resuelta por el pipeline (el registro puede traerla vacía). */
  cedula = input<string | null>(null);
  /** Sube con cada consulta nueva del buscador: obliga a releer el expediente. */
  consultaSeq = input<number>(0);

  private readonly docsSrv = inject(GestionDocumentalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly ventanas = inject(ElectronWindowService);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly uniendo = signal(false);

  /** Las filas, en el orden en que quedará el PDF. */
  readonly docs = signal<DocEmpalme[]>([]);

  /** Cédula con la que se trabaja. */
  readonly cedulaEfectiva = computed<string>(() => {
    const explicita = (this.cedula() ?? '').toString().trim();
    if (explicita) return explicita;
    const cand = this.candidatoSeleccionado();
    return cand?.numero_documento ? String(cand.numero_documento).trim() : '';
  });

  /** Clave del último expediente leído, para no releerlo en cada refresco. */
  private leidoPara: string | null = null;

  constructor() {
    effect(() => {
      const ced = this.cedulaEfectiva();
      const clave = ced ? `${ced}#${this.consultaSeq()}` : null;
      if (clave === this.leidoPara) return;
      this.leidoPara = clave;
      this.docs.set([]);
      this.cerrarVisor();
      if (ced) this.cargar(ced);
    });
  }

  private cargar(cedula: string): void {
    this.cargando.set(true);
    this.error.set(null);

    this.docsSrv.getDocuments(cedula)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r: unknown) => {
          const lista = Array.isArray(r)
            ? r
            : ((r as Record<string, unknown>)?.['results'] as unknown[]) ?? [];

          const filas: DocEmpalme[] = [];
          const vistos = new Set<string>();
          for (const d of lista as Array<Record<string, unknown>>) {
            const url = String(d?.['file_url'] ?? '').trim();
            if (!url) continue;
            const typeId = Number(d?.['type']);
            const archivo = String(d?.['title'] ?? d?.['fileName'] ?? '').trim();
            // El id del documento manda; sin él, la URL: un mismo tipo puede
            // traer varios archivos (las referencias) y no se pueden fundir.
            const id = String(d?.['id'] ?? url);
            if (vistos.has(id)) continue;
            vistos.add(id);
            filas.push({
              id,
              typeId: Number.isFinite(typeId) ? typeId : -1,
              titulo: tituloDeTipo(typeId, archivo),
              archivo,
              url,
              fecha: (d?.['uploaded_at'] as string) ?? null,
              incluido: true,
            });
          }

          this.docs.set(this.ordenarPor(filas, ORDEN_PAQUETE_COMPLETO, false));
          this.cargando.set(false);
        },
        error: () => {
          this.error.set('No se pudo leer el expediente. Reintenta en un momento.');
          this.cargando.set(false);
        },
      });
  }

  /**
   * Reordena por un paquete. `restringir` deja marcados SOLO los tipos del
   * paquete: es lo que distingue "ponme el orden" de "dame solo estos".
   */
  private ordenarPor(
    filas: readonly DocEmpalme[],
    orden: readonly number[],
    restringir: boolean,
  ): DocEmpalme[] {
    return [...filas]
      .map((f, i) => ({ f, i }))
      .sort((a, b) => {
        const ia = indiceEnOrden(orden, a.f.typeId);
        const ib = indiceEnOrden(orden, b.f.typeId);
        // Empate = mismo tipo o los dos fuera del paquete: se respeta el orden
        // en que llegaron, que es el de subida.
        return ia !== ib ? ia - ib : a.i - b.i;
      })
      .map(({ f }) => (restringir
        ? { ...f, incluido: orden.includes(f.typeId) }
        : f));
  }

  // ── Reordenar y elegir ───────────────────────────────────────────────────

  soltar(ev: CdkDragDrop<DocEmpalme[]>): void {
    const arr = [...this.docs()];
    moveItemInArray(arr, ev.previousIndex, ev.currentIndex);
    this.docs.set(arr);
  }

  alternar(id: string): void {
    this.docs.update((arr) =>
      arr.map((d) => (d.id === id ? { ...d, incluido: !d.incluido } : d)));
  }

  marcarTodos(incluido: boolean): void {
    this.docs.update((arr) => arr.map((d) => ({ ...d, incluido })));
  }

  paqueteCompleto(): void {
    this.docs.set(this.ordenarPor(this.docs(), ORDEN_PAQUETE_COMPLETO, true));
  }

  paqueteFinca(): void {
    this.docs.set(this.ordenarPor(this.docs(), ORDEN_PAQUETE_FINCA, true));
  }

  /** Vuelve al orden con el que se abrió: paquete completo, todo marcado. */
  restablecer(): void {
    this.docs.set(this.ordenarPor(
      this.docs().map((d) => ({ ...d, incluido: true })),
      ORDEN_PAQUETE_COMPLETO,
      false,
    ));
  }

  recargar(): void {
    this.leidoPara = null;
    const ced = this.cedulaEfectiva();
    if (ced) this.cargar(ced);
  }

  // ── Cuentas ──────────────────────────────────────────────────────────────

  readonly total = computed(() => this.docs().length);
  readonly incluidos = computed(() => this.docs().filter((d) => d.incluido));
  readonly seleccionados = computed(() => this.incluidos().length);

  /** Posición que ocupará en el PDF; vacío si no entra. */
  posicion(id: string): string {
    const i = this.incluidos().findIndex((d) => d.id === id);
    return i === -1 ? '' : String(i + 1);
  }

  // ── Visor ────────────────────────────────────────────────────────────────

  readonly visorSrc = signal<SafeResourceUrl | null>(null);
  readonly visorTitulo = signal<string>('');
  private visorUrl: string | null = null;
  /** URL del PDF empalmado en memoria, para revocarla al cerrar. */
  private blobUrl: string | null = null;

  ver(d: DocEmpalme): void {
    this.abrirVisor(d.url, d.archivo || d.titulo);
  }

  private abrirVisor(url: string, titulo: string): void {
    this.visorUrl = url;
    this.visorTitulo.set(titulo);
    this.visorSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(encodeURI(url)));
  }

  cerrarVisor(): void {
    this.visorSrc.set(null);
    this.visorTitulo.set('');
    this.visorUrl = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  abrirFuera(): void {
    if (this.visorUrl) this.ventanas.openExternal(this.visorUrl);
  }

  descargarDelVisor(): void {
    if (!this.visorUrl) return;
    this.bajarArchivo(this.visorUrl, this.visorTitulo() || 'documento');
  }

  private bajarArchivo(url: string, nombre: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── El empalme ───────────────────────────────────────────────────────────

  /** Nombre del PDF final: cédula y fecha, que es como se archiva. */
  private nombreSalida(): string {
    const ced = this.cedulaEfectiva() || 'expediente';
    const hoy = new Date().toISOString().slice(0, 10);
    return `Empalme_${ced}_${hoy}.pdf`;
  }

  unirYDescargar(): void {
    void this.unir(true);
  }

  unirYVer(): void {
    void this.unir(false);
  }

  /**
   * Arma el PDF con lo marcado, en el orden de la lista.
   *
   * Se descarga por bloques —quince conexiones a la vez ahogan al navegador—
   * pero se anexa SIEMPRE en el orden de la lista: el orden es justo lo que se
   * viene de decidir arriba. Los formularios se aplanan antes de copiarse, o
   * los campos rellenados (la huella, las firmas) se pierden al fundir.
   */
  private async unir(descargar: boolean): Promise<void> {
    const elegidos = this.incluidos();
    if (!elegidos.length || this.uniendo()) return;

    this.uniendo.set(true);
    Swal.fire({
      title: 'Empalmando documentos',
      text: `Descargando y uniendo ${elegidos.length} archivo(s)…`,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const final = await PDFDocument.create();
      final.setTitle(`Empalme ${this.cedulaEfectiva()}`);
      final.setCreator('TesoroApp');

      const BLOQUE = 8;
      const fallidos: string[] = [];
      let anexados = 0;

      for (let i = 0; i < elegidos.length; i += BLOQUE) {
        const bloque = elegidos.slice(i, i + BLOQUE);
        Swal.update({
          text: `Documentos ${i + 1}–${Math.min(i + BLOQUE, elegidos.length)}`
              + ` de ${elegidos.length}`,
        });

        const bajados = await Promise.allSettled(bloque.map(async (d) => {
          const res = await fetch(d.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return {
            doc: d,
            tipo: res.headers.get('content-type') || '',
            buffer: await res.arrayBuffer(),
          };
        }));

        // Secuencial y en el orden del bloque: `allSettled` conserva el orden
        // de entrada, así que el PDF sale como está en pantalla.
        for (let j = 0; j < bajados.length; j++) {
          const r = bajados[j];
          if (r.status !== 'fulfilled') {
            fallidos.push(bloque[j].titulo);
            continue;
          }
          const { doc, tipo, buffer } = r.value;
          try {
            const esImagen = tipo.includes('image/')
              || /\.(jpe?g|png)$/i.test(doc.url);
            if (esImagen) {
              const png = tipo.includes('png') || /\.png$/i.test(doc.url);
              const img = png
                ? await final.embedPng(buffer)
                : await final.embedJpg(buffer);
              const page = final.addPage([img.width, img.height]);
              page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
            } else {
              const origen = await PDFDocument.load(buffer, { ignoreEncryption: true });
              try {
                origen.getForm().flatten();
              } catch {
                // Sin formulario, o con campos que pdf-lib no sabe aplanar: se
                // copia igual, que es mejor que perder el documento entero.
              }
              const paginas = await final.copyPages(origen, origen.getPageIndices());
              for (const p of paginas) final.addPage(p);
            }
            anexados++;
          } catch {
            fallidos.push(doc.titulo);
          }
        }
      }

      if (!anexados) {
        Swal.fire({
          icon: 'error',
          title: 'No se pudo empalmar',
          text: 'Ninguno de los archivos se pudo leer. Revisa que abran uno a uno.',
        });
        return;
      }

      Swal.update({ text: 'Cerrando el PDF…' });
      const bytes = await final.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });

      if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = URL.createObjectURL(blob);

      Swal.close();

      if (descargar) {
        const url = this.blobUrl;
        this.bajarArchivo(url, this.nombreSalida());
        // El navegador ya tiene el archivo: la URL en memoria solo hace falta
        // hasta que termine de guardarlo.
        setTimeout(() => {
          if (this.blobUrl === url) {
            URL.revokeObjectURL(url);
            this.blobUrl = null;
          }
        }, 30_000);
      } else {
        this.abrirVisor(this.blobUrl, this.nombreSalida());
      }

      if (fallidos.length) {
        Swal.fire({
          icon: 'warning',
          title: `Quedaron fuera ${fallidos.length} documento(s)`,
          html: `No se pudieron leer:<br><b>${fallidos.join('<br>')}</b>`
              + '<br><br>El resto sí quedó en el PDF.',
        });
      }
    } catch (e: unknown) {
      console.error('[empalme] Falló la unión:', e);
      Swal.fire({
        icon: 'error',
        title: 'Error al empalmar',
        text: (e as Error)?.message || 'No se pudo armar el PDF. Reintenta.',
      });
    } finally {
      this.uniendo.set(false);
    }
  }
}
