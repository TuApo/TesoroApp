import {
  ChangeDetectionStrategy, Component, computed, inject, input, output, signal,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';
import { mensajeDeErrorLog } from '@/app/shared/utils/mensaje-error';
import {
  esCarasCedula,
} from '../../../document-management/components/document-scan-dialog/caras-cedula.util';
import type {
  ScanDialogConfig,
} from '../../../document-management/components/document-scan-dialog/document-scan-dialog.component';
import { CedulaCamaraService, FalloCedulaCamara } from './cedula-camara.service';
import {
  CedulaArmada, PasoCedula, etiquetaPaso, mensajeFallo, porcentajePaso,
} from './cedula-camara.util';

/**
 * Botón "Tomar con cámara" del documento de identidad.
 *
 * Abre el escáner en modo cédula (detección de bordes + recorte manual de
 * respaldo), recibe frente y reverso en JPEG, los sube y deja en el expediente la
 * hoja carta al 150 % (tipo 29 CEDULA). Es autónomo para poder ponerlo donde haga
 * falta: la tarjeta de Contratación (`variante="boton"`) o la ficha de la persona
 * en Selección (`variante="compacto"`, solo icono).
 *
 * `listo` avisa con el id de la hoja; además queda en `CedulaCamaraService.ultimaArmada`
 * para que la tarjeta de Contratación se entere aunque la foto se tome en otra pestaña.
 */
@Component({
  selector: 'app-cedula-camara',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './cedula-camara.component.html',
  styleUrls: ['./cedula-camara.component.css'],
  host: { '[class.cc-host-compacto]': "variante() === 'compacto'" },
})
export class CedulaCamaraComponent {
  private readonly dialog = inject(MatDialog);
  private readonly svc = inject(CedulaCamaraService);

  /** Documento (owner_id) de la persona, tal cual (con la X de los no-CC). */
  readonly cedula = input<string | null>(null);
  /** "Cédula de ciudadanía", "Permiso por protección temporal"… (títulos y archivos). */
  readonly nombreDocumento = input<string>('Documento de identidad');
  readonly deshabilitado = input<boolean>(false);
  /** `boton`: ancho, con texto y progreso. `compacto`: solo el icono (fichas, filas). */
  readonly variante = input<'boton' | 'compacto'>('boton');
  /**
   * Muestra él mismo el "listo". Para donde el contenedor no avisa nada (la ficha);
   * la tarjeta de Contratación lo deja en false porque ya tiene su propio aviso.
   */
  readonly avisarExito = input<boolean>(false);

  /** La hoja al 150 % quedó en el expediente. */
  readonly listo = output<CedulaArmada>();
  /** true mientras sube o arma: el contenedor puede bloquear sus otros botones. */
  readonly ocupado = output<boolean>();

  readonly paso = signal<PasoCedula>('inactivo');
  readonly trabajando = computed(() => this.paso() !== 'inactivo');
  readonly etiqueta = computed(() => etiquetaPaso(this.paso()));
  readonly porcentaje = computed(() => porcentajePaso(this.paso()));
  readonly ayuda = computed(() => this.trabajando()
    ? this.etiqueta()
    : `Tomar ${this.nombreDocumento().toLowerCase()} con la cámara (frente y reverso, hoja carta al 150 %)`);

  async tomar(): Promise<void> {
    if (this.trabajando() || this.deshabilitado()) return;
    // Se congela al empezar: si mientras tanto se abre a otra persona, las caras
    // siguen yendo a la de la foto.
    const cedula = (this.cedula() ?? '').toString().trim();
    if (!cedula) {
      void Swal.fire({ icon: 'info', title: 'Sin persona',
        text: 'Busca primero a la persona para tomarle el documento.', confirmButtonText: 'Ok' });
      return;
    }

    this.paso.set('abriendo');
    let caras: unknown;
    try {
      // Carga diferida: el escáner trae jsPDF, el plugin nativo y OpenCV; no tiene
      // por qué viajar en el chunk del pipeline.
      const { DocumentScanDialogComponent } = await import(
        '@/app/features/dashboard/submodule/document-management/components/document-scan-dialog/document-scan-dialog.component');
      const data: ScanDialogConfig = {
        modo: 'cedula',
        salida: 'imagenes',
        docName: this.nombreDocumento() || 'Documento de identidad',
      };
      const ref = this.dialog.open(DocumentScanDialogComponent, {
        maxWidth: '100vw',
        maxHeight: '100vh',
        height: '100%',
        width: '100%',
        panelClass: 'full-screen-dialog',
        disableClose: true,
        autoFocus: false,
        data,
      });
      this.paso.set('inactivo');
      caras = await new Promise((resolve) => ref.afterClosed().subscribe({
        next: resolve, error: () => resolve(undefined), complete: () => resolve(undefined),
      }));
    } catch (e) {
      this.paso.set('inactivo');
      this.fallo('abriendo', mensajeDeErrorLog('cedulaCamara.abrir', e, ''));
      return;
    }
    // Cerró sin terminar (Cerrar / atrás): no es un error.
    if (!esCarasCedula(caras)) return;

    this.ocupado.emit(true);
    try {
      const armada = await this.svc.subirYArmar(cedula, caras, (p) => this.paso.set(p));
      this.listo.emit(armada);
      if (this.avisarExito()) {
        void Swal.fire({
          icon: 'success',
          title: `${this.nombreDocumento()} cargado`,
          text: 'Quedó en el expediente: frente y reverso en una hoja carta al 150 %.',
          confirmButtonText: 'Ok',
        });
      }
    } catch (e) {
      const paso = e instanceof FalloCedulaCamara ? e.paso : this.paso();
      const causa = e instanceof FalloCedulaCamara ? (e.causa ?? e) : e;
      const detalle = e instanceof FalloCedulaCamara && e.causa == null
        ? e.message
        : mensajeDeErrorLog(`cedulaCamara.${paso}`, causa, '');
      this.fallo(paso, detalle);
    } finally {
      this.paso.set('inactivo');
      this.ocupado.emit(false);
    }
  }

  private fallo(paso: PasoCedula, detalle: string): void {
    void Swal.fire({
      icon: 'error',
      title: 'No se pudo cargar el documento',
      text: mensajeFallo(paso, detalle),
      confirmButtonText: 'Ok',
    });
  }
}
