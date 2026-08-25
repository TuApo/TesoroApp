import {
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { QrScannerComponent } from '../../components/qr-scanner/qr-scanner.component';
import { CarnetService } from '../../services/carnet.service';
import {
  AccesoRelacionado,
  Carnet,
  EscaneoCarnet,
  ResultadoVerificacion,
} from '../../models/carnet.model';

/**
 * Panel de identificación de personal.
 *
 * PARA QUÉ SIRVE — alguien de administración, portería o cualquier área a la que se le asigne
 * el módulo escanea el carné (o teclea la cédula) y ve DE UN GOLPE quién es esa persona: foto,
 * documento, cargo, finca, fecha de ingreso y seguridad social. Desde ahí salta al módulo
 * donde se continúa el trámite en vez de volver al menú y buscar la cédula otra vez.
 *
 * QUIÉN LO VE — el módulo se asigna por el árbol de permisos de db_admin, igual que el resto.
 * No hay una lista de roles metida en el código: eso obligaría a un despliegue cada vez que
 * otra área necesite identificar personal, que es justo lo que se pidió evitar.
 *
 * QUEDA RASTRO — cada consulta, por QR o tecleada, se registra en `carnet_escaneo` con quién
 * miró y cuándo. La ficha de una persona incluye sus últimas verificaciones.
 */
@Component({
  selector: 'app-identificar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule, QrScannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './identificar.component.html',
  styleUrl: './identificar.component.css',
})
export class IdentificarComponent {
  private readonly carnets = inject(CarnetService);
  private readonly router = inject(Router);

  @ViewChild(QrScannerComponent) escaner?: QrScannerComponent;

  readonly cedula = signal('');
  readonly carnet = signal<Carnet | null>(null);
  readonly foto = signal<string | null>(null);
  readonly historial = signal<EscaneoCarnet[]>([]);

  readonly buscando = signal(false);
  readonly error = signal('');

  /** Veredicto de la última verificación por QR. null cuando la consulta fue por cédula. */
  readonly verificacion = signal<{ valido: boolean; resultado: ResultadoVerificacion; mensaje: string } | null>(null);

  readonly iniciales = computed(() => {
    const partes = (this.carnet()?.nombreCompleto ?? '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '·';
    return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
  });

  /**
   * A dónde se puede saltar con la persona ya identificada. La cédula viaja como query param:
   * los módulos que todavía no la leen la ignoran sin romperse, y en los que sí ahorra volver
   * a teclearla.
   */
  readonly accesos: AccesoRelacionado[] = [
    {
      etiqueta: 'Incapacidades',
      descripcion: 'Radicar o consultar incapacidades',
      icono: 'medical_services',
      ruta: '/dashboard/disabilities/formulario',
      color: '#dc2626',
    },
    {
      etiqueta: 'Préstamo de mercado',
      descripcion: 'Cargar mercado del trabajador',
      icono: 'shopping_basket',
      ruta: '/dashboard/market/load-market',
      color: '#16a34a',
    },
    {
      etiqueta: 'Préstamo de dinero',
      descripcion: 'Calamidad y préstamos',
      icono: 'payments',
      ruta: '/dashboard/money-loan/emergency-loan',
      color: '#d97706',
    },
    {
      etiqueta: 'Tesorería',
      descripcion: 'Gestión de trabajadores',
      icono: 'account_balance',
      ruta: '/dashboard/treasury/manage-workers',
      color: '#1d5aa8',
    },
    {
      etiqueta: 'Traslados EPS',
      descripcion: 'Procesar traslado de EPS',
      icono: 'swap_horiz',
      ruta: '/dashboard/eps-transfers/process-transfers',
      color: '#0d9488',
    },
    {
      etiqueta: 'Mercancía',
      descripcion: 'Comercializadora',
      icono: 'inventory_2',
      ruta: '/dashboard/merchandise/edit-merchandise',
      color: '#7c3aed',
    },
    {
      etiqueta: 'Documentos',
      descripcion: 'Buscar documentos de la persona',
      icono: 'folder_shared',
      ruta: '/dashboard/document-management/search-documents',
      color: '#475569',
    },
    {
      etiqueta: 'Contratación',
      descripcion: 'Reportes y proceso de contratación',
      icono: 'how_to_reg',
      ruta: '/dashboard/hiring/hiring-report',
      color: '#0ea5e9',
    },
  ];

  // ─────────────────────── entradas ───────────────────────

  /** Llega del lector de QR. */
  onQrLeido(token: string): void {
    this.buscando.set(true);
    this.error.set('');
    this.carnets.verificar(token).subscribe({
      next: v => {
        this.verificacion.set({ valido: v.valido, resultado: v.resultado, mensaje: v.mensaje });
        this.buscando.set(false);
        if (v.carnet) {
          this.aplicarCarnet(v.carnet);
        } else {
          // Firma rota o ficha borrada: se limpia la ficha anterior para no dejar en pantalla
          // los datos de la ÚLTIMA persona válida junto a un aviso de carné falso.
          this.carnet.set(null);
          this.foto.set(null);
          this.historial.set([]);
        }
      },
      error: err => {
        this.buscando.set(false);
        this.error.set(this.mensajeError(err));
      },
    });
  }

  /** Búsqueda por cédula tecleada. */
  buscarPorCedula(): void {
    const doc = this.cedula().trim();
    if (!doc) return;
    this.buscando.set(true);
    this.error.set('');
    this.verificacion.set(null);
    this.carnets.porCedula(doc).subscribe({
      next: c => {
        this.buscando.set(false);
        this.aplicarCarnet(c);
      },
      error: err => {
        this.buscando.set(false);
        this.carnet.set(null);
        this.foto.set(null);
        this.historial.set([]);
        this.error.set(this.mensajeError(err));
      },
    });
  }

  limpiar(): void {
    this.carnet.set(null);
    this.foto.set(null);
    this.historial.set([]);
    this.verificacion.set(null);
    this.error.set('');
    this.cedula.set('');
  }

  irA(acceso: AccesoRelacionado): void {
    const doc = this.carnet()?.cedula;
    this.escaner?.detener();
    this.router.navigate([acceso.ruta], doc ? { queryParams: { cedula: doc } } : {});
  }

  // ─────────────────────── presentación ───────────────────────

  /** Color y texto del sello de verificación. */
  get selloVerificacion(): { texto: string; icono: string; clase: string } | null {
    const v = this.verificacion();
    if (!v) return null;
    switch (v.resultado) {
      case 'VALIDO':
        return { texto: 'Carné válido', icono: 'verified', clase: 'is-ok' };
      case 'VENCIDO':
        return { texto: 'Carné auténtico pero vencido', icono: 'schedule', clase: 'is-warn' };
      case 'NO_ENCONTRADO':
        return { texto: 'Firmado, pero sin ficha activa', icono: 'person_off', clase: 'is-warn' };
      default:
        return { texto: 'Carné NO válido', icono: 'gpp_bad', clase: 'is-bad' };
    }
  }

  etiquetaEstado(c: Carnet): string {
    return c.estado === 'ACTIVO' ? 'ACTIVO' : c.estado === 'RETIRADO' ? 'RETIRADO' : 'SIN CONTRATO';
  }

  fecha(iso: string): string {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    // Local a propósito: `new Date('2025-01-15')` es UTC y en Colombia pinta el día anterior.
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fechaHora(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO', { hour12: false });
  }

  /** Antigüedad legible; en fincas es lo primero que preguntan tras identificar a alguien. */
  antiguedad(fechaIngreso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIngreso ?? '');
    if (!m) return '';
    const ingreso = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const dias = Math.floor((Date.now() - ingreso.getTime()) / 86_400_000);
    if (dias < 0) return '';
    if (dias < 31) return `${dias} día${dias === 1 ? '' : 's'}`;
    const meses = Math.floor(dias / 30.44);
    if (meses < 12) return `${meses} mes${meses === 1 ? '' : 'es'}`;
    const anios = Math.floor(meses / 12);
    const resto = meses % 12;
    return resto ? `${anios} año${anios === 1 ? '' : 's'} y ${resto} mes${resto === 1 ? '' : 'es'}`
                 : `${anios} año${anios === 1 ? '' : 's'}`;
  }

  val(v: string | undefined | null): string {
    const s = (v ?? '').trim();
    return s ? s : '—';
  }

  // ─────────────────────── interno ───────────────────────

  private aplicarCarnet(c: Carnet): void {
    this.carnet.set(c);
    this.cedula.set(c.cedula);
    this.foto.set(null);
    if (c.fotoUrl) {
      void this.carnets.fotoDataUrl(c.fotoUrl).then(f => this.foto.set(f));
    }
    this.carnets.historial(c.cedula).subscribe(h => this.historial.set(h));
  }

  private mensajeError(err: any): string {
    if (err?.status === 404) return 'No se encontró ninguna ficha para esa cédula.';
    if (err?.status === 503) {
      return 'El carné digital no está configurado en el servidor. Avisa a soporte.';
    }
    return err?.error?.error || 'No se pudo consultar. Revisa la conexión e inténtalo de nuevo.';
  }
}
