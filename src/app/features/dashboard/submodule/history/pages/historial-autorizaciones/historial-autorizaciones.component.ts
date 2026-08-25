import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import Swal from 'sweetalert2';
import { HistorialService } from '../../service/historial/historial.service';
import { SharedModule } from '../../../../../../shared/shared.module';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-historial-autorizaciones',
  imports: [
    SharedModule
  ],
  templateUrl: './historial-autorizaciones.component.html',
  styleUrls: ['./historial-autorizaciones.component.css']
} )
export class HistorialAutorizacionesComponent implements OnInit {

  myForm!: FormGroup;

  columns: ColumnDefinition[] = [
    { name: 'codigo_autorizacion', header: 'Código', type: 'text', filterable: true },
    { name: 'autorizacion_concepto', header: 'Concepto Aut.', type: 'text', filterable: true },
    { name: 'autorizacion_monto', header: 'Valor Autorizado', type: 'text', filterable: true },
    { name: 'autorizacion_cuotas', header: 'Cuotas Aut.', type: 'number', filterable: true },
    { name: 'autorizado_por', header: 'Autorizado Por', type: 'text', filterable: true },
    { name: 'sede_autorizacion', header: 'Sede Aut.', type: 'text', filterable: true },
    { name: 'autorizado_en', header: 'Fecha Autorizado', type: 'date', filterable: true },
    { name: 'estado', header: 'Estado', type: 'text', filterable: true },
    { name: 'codigo_ejecucion', header: 'Cod. Ejecución', type: 'text', filterable: true },
    { name: 'ejecucion_concepto', header: 'Concepto Eje.', type: 'text', filterable: true },
    { name: 'ejecucion_monto', header: 'Valor Ejecutado', type: 'text', filterable: true },
    { name: 'ejecutado_por', header: 'Ejecutado Por', type: 'text', filterable: true },
    { name: 'sede_ejecucion', header: 'Sede Eje.', type: 'text', filterable: true },
    { name: 'ejecutado_en', header: 'Fecha Ejecutado', type: 'date', filterable: true }
  ];

  dataList: any[] = [];

  // Token de consulta: descarta respuestas obsoletas cuando el usuario busca
  // un documento y, antes de que responda, busca otro (evita pintar los datos
  // del empleado equivocado por respuestas fuera de orden).
  private queryToken = 0;

  constructor(
    private historialService: HistorialService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.myForm = this.fb.group({
      numero_documento: ['', [Validators.required, Validators.pattern(/^[A-Za-z]?\d+$/)]],
    });
  }

  private trimField(fieldName: string) {
    const control = this.myForm.get(fieldName);
    if (control && control.value && typeof control.value === 'string') {
      control.setValue(control.value.trim().toUpperCase());
    }
  }

  onSubmit(): void {
    if (this.myForm.invalid) {
      this.myForm.markAllAsTouched();
      return;
    }

    this.trimField('numero_documento');
    const doc = this.myForm.value.numero_documento;

    this.buscarOperarioYTransacciones(doc);
  }

  buscarOperarioYTransacciones(numeroDocumento: string): void {
    const token = ++this.queryToken;

    Swal.fire({
      title: 'Buscando información...',
      text: 'Por favor, espera mientras se procesa la consulta.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    // 1. Validar estado del operario utilizando el nuevo servicio de tesoreria
    this.historialService.getPersonaTesoreriaStatus(numeroDocumento).subscribe({
      next: (data: any) => {
        if (token !== this.queryToken) return; // respuesta obsoleta
        if (!data || data.error) {
          this.finalizarSinResultados();
          Swal.fire({
            icon: 'error',
            title: 'Empleado no encontrado',
            text: 'Este empleado no existe, no está registrado en esta quincena o no pertenece a la empresa.',
          });
          return;
        }

        // 2. Si existe el operario, buscamos transacciones (sin importar su estado activo/inactivo/bloqueado)
        this.cargarTransacciones(numeroDocumento, token);
      },
      error: (error: any) => {
        if (token !== this.queryToken) return;
        this.finalizarSinResultados();

        let title = 'Error al buscar empleado';
        let msg = 'Hubo un problema al buscar el registro del empleado. Intente nuevamente.';

        if (error?.status === 404) {
          title = 'Empleado no registrado';
          msg = 'Este empleado no existe en la base de datos (puede que no esté registrado en la quincena actual o no pertenezca a la empresa).';
        }

        Swal.fire({
          icon: 'error',
          title: title,
          text: msg,
        });
      }
    });
  }

  cargarTransacciones(numeroDocumento: string, token: number): void {
    this.historialService.getHistorialTransaccionesPorDocumento(numeroDocumento).subscribe({
      next: (data: any) => {
        if (token !== this.queryToken) return; // respuesta obsoleta
        // En caso de que el API devuelva array o paginación { results: [] }
        const rawDataList = Array.isArray(data) ? data : (data.results || data.data || []);

        if (rawDataList.length === 0) {
          this.finalizarSinResultados();
          Swal.fire({
            icon: 'warning',
            title: 'Sin transacciones',
            text: 'No se encontraron registros de transacciones para este empleado.',
          });
          return;
        }

        // Ordenar de más reciente a más antiguo basándose en autorizado_en (con fallback a created_at)
        rawDataList.sort((a: any, b: any) => {
          const dateA = new Date(a.autorizado_en || a.created_at || 0).getTime();
          const dateB = new Date(b.autorizado_en || b.created_at || 0).getTime();
          return dateB - dateA;
        });

        this.dataList = rawDataList.map((item: any) => ({
          ...item,
          autorizacion_monto: this.formatCurrency(item.autorizacion_monto),
          ejecucion_monto: this.formatCurrency(item.ejecucion_monto)
        }));
        // App zoneless + OnPush: sin markForCheck la vista NO se repinta tras el
        // subscribe y los resultados nunca aparecen aunque lleguen los datos.
        this.cdr.markForCheck();

        Swal.close();
      },
      error: (error: any) => {
        if (token !== this.queryToken) return;
        this.finalizarSinResultados();
        Swal.fire({
          icon: 'error',
          title: 'Error de conexión',
          text: 'Hubo un problema al traer las transacciones. Intente nuevamente.',
        });
      }
    });
  }

  /** Limpia resultados previos y repinta (evita dejar en pantalla el historial
   *  de una búsqueda anterior cuando la nueva falla o no arroja resultados). */
  private finalizarSinResultados(): void {
    this.dataList = [];
    this.cdr.markForCheck();
  }

  formatCurrency(value: any): string {
    if (value === null || value === undefined || value === '') return '';
    return Number(value).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }
}
