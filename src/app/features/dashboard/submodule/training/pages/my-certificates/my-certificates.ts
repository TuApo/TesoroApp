import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { TrainingS, Certificado } from '../../service/training-s';
import { TrainingOffline } from '../../service/training-offline';

/**
 * "Mis certificados".
 *
 * El listado se cachea como cualquier GET, así que se puede consultar sin señal. La DESCARGA
 * del PDF no: el archivo se genera en el servidor en el momento y no tiene sentido fingir que
 * está disponible offline. Cuando no hay red se dice, en vez de dejar un botón que no hace nada.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-my-certificates',
  imports: [CommonModule, MatIconModule],
  templateUrl: './my-certificates.html',
  styleUrl: './my-certificates.css'
})
export class MyCertificates implements OnInit {
  private api = inject(TrainingS);
  private router = inject(Router);
  readonly offline = inject(TrainingOffline);

  readonly certificados = signal<Certificado[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly descargando = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.certificados.set(await this.api.misCertificados());
    } catch {
      this.error.set('No pudimos cargar tus certificados. Intenta de nuevo con conexión.');
    } finally {
      this.cargando.set(false);
    }
  }

  volver(): void {
    this.router.navigate(['/dashboard/capacitaciones']);
  }

  estado(c: Certificado): string {
    if (c.anulado) return 'Anulado';
    if (c.vencido) return 'Vencido';
    return 'Vigente';
  }

  clase(c: Certificado): string {
    if (c.anulado) return 'estado-mal';
    if (c.vencido) return 'estado-atencion';
    return 'estado-ok';
  }

  async descargar(c: Certificado): Promise<void> {
    if (!this.offline.enLinea) {
      Swal.fire('Necesitas conexión',
        'El certificado se genera en el momento, así que hace falta internet para descargarlo.',
        'info');
      return;
    }
    this.descargando.set(c.id);
    try {
      const blob = await this.api.descargarCertificado(c.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificado-${c.codigo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      Swal.fire('No se pudo descargar',
        'Vuelve a intentarlo en un momento. Si sigue fallando, avisa a tu coordinador.',
        'error');
    } finally {
      this.descargando.set(null);
    }
  }
}
