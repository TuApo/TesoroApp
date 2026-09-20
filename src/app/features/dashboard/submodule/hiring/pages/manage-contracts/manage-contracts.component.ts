import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SelectionModel } from '@angular/cdk/collections';
import Swal from 'sweetalert2';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';

interface ActivoRow {
  numero_documento: string;
  nombres: string;
  apellidos: string;
  oficina: string;
  codigo_contrato: string;
  centro_costos: string;
  fecha_ingreso: string;
}

@Component({
  selector: 'app-manage-contracts',
  standalone: true,
  imports: [
    CommonModule, 
    MatCardModule, 
    MatButtonModule, 
    MatIconModule, 
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './manage-contracts.component.html',
  styleUrls: ['./manage-contracts.component.css']
})
export class ManageContractsComponent implements OnInit {
  private http = inject(HttpClient);
  private registroProceso = inject(RegistroProcesoContratacion);
  
  loading = signal<boolean>(true);
  dataSource = signal<ActivoRow[]>([]);
  /** Casillas de la tabla estándar para la baja masiva (la tabla marca/desmarca todo lo filtrado). */
  selection = new SelectionModel<ActivoRow>(true, []);

  readonly columnas: ColumnaTabla<ActivoRow>[] = [
    { id: 'numero_documento', header: 'Cédula', valor: (r) => r.numero_documento, tarjeta: 'subtitulo' },
    { id: 'nombres', header: 'Candidato', valor: (r) => `${r.nombres ?? ''} ${r.apellidos ?? ''}`.trim(),
      tarjeta: 'titulo', minAncho: '180px' },
    { id: 'oficina', header: 'Oficina', valor: (r) => r.oficina ?? '', tarjeta: 'badge' },
    { id: 'centro_costos', header: 'Centro Costo', valor: (r) => r.centro_costos ?? '',
      formato: (r) => r.centro_costos || 'N/A', prioridad: 2, tarjeta: 'cuerpo' },
    { id: 'fecha_ingreso', header: 'Ingreso', valor: (r) => this.fechaIngreso(r), tarjeta: 'meta',
      formato: (r) => {
        const d = this.fechaIngreso(r);
        return d
          ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
          : 'Sin fecha';
      } },
  ];
  readonly idFila = (r: ActivoRow) => r.codigo_contrato || r.numero_documento;

  /**
   * Fecha de ingreso como Date local con el día en UTC (lo mismo que pintaba
   * `date:'dd/MM/yyyy':'UTC'`): así el orden, los filtros y la copia a Excel
   * no corren el día por la zona horaria.
   */
  private fechaIngreso(r: ActivoRow): Date | null {
    if (!r.fecha_ingreso) return null;
    const d = new Date(r.fecha_ingreso);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  ngOnInit() {
    this.cargarContratosActivos();
  }

  async cargarContratosActivos() {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<{ok: boolean, data: ActivoRow[]}>(`${environment.apiUrl}/gestion_contratacion/contratacion/activos/`));
      this.dataSource.set(res.data);
    } catch(err) {
      console.error(err);
      Swal.fire('Error', 'No se pudieron cargar los contratos activos', 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async darBajaMasiva() {
    if (this.selection.selected.length === 0) {
      Swal.fire('Aviso', 'Seleccione al menos un contrato para dar de baja', 'info');
      return;
    }

    const { value: formValues } = await Swal.fire({
      title: 'Baja Masiva de Contratos',
      html: `
        <div style="text-align: left; margin-bottom: 8px;">
          <label>Candidatos seleccionados: <b>${this.selection.selected.length}</b></label>
        </div>
        <div style="text-align: left; margin-bottom: 8px;">
          <label>Fecha de Retiro General:</label>
          <input type="date" id="swal-fecha-baja-masiva" class="swal2-input" value="${new Date().toISOString().split('T')[0]}">
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Confirmar Bajas',
      confirmButtonColor: '#d33',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const d = (document.getElementById('swal-fecha-baja-masiva') as HTMLInputElement).value;
        if (!d) Swal.showValidationMessage('La fecha es obligatoria');
        return d;
      }
    });

    if (formValues) {
      Swal.fire({ title: 'Procesando Bajas...', html: 'No cierre esta ventana.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      
      const errores: string[] = [];
      let exitosos = 0;

      // Executing in chunks/sequential or parallel (Promise.allSettled)
      const requests = this.selection.selected.map(cand => {
        const payload = {
          numero_documento: cand.numero_documento,
          contrato_detalle: {
            contrato_activo: false,
            fecha_retiro: formValues
          }
        };
        // Using Promise to capture individual errors
        return firstValueFrom(this.registroProceso.updateProcesoByDocumento(payload as any))
          .then(() => { exitosos++; })
          .catch(() => { errores.push(cand.numero_documento); });
      });

      await Promise.allSettled(requests);

      if (errores.length === 0) {
        Swal.fire('¡Proceso completado!', `Se dieron de baja ${exitosos} contratos exitosamente.`, 'success');
      } else {
        Swal.fire('Advertencia', `Se dieron de baja ${exitosos} contratos, pero hubo error en ${errores.length} registros (${errores.join(', ')}).`, 'warning');
      }
      
      this.selection.clear();
      this.cargarContratosActivos();
    }
  }
}
