import {  Component, OnInit, ViewChild, ElementRef, inject , ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import Swal from 'sweetalert2';

import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { DynamicFormDialogComponent, FieldConfig } from '@/app/shared/components/dynamic-form-dialog/dynamic-form-dialog.component';
import { FarmsService } from '../../services/farms/farms.service';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';

type AnyObj = Record<string, any>;

interface CentroCostoView {
  id: number;
  finca: string;
  ccostos: string;
  subcentro: string;
  categoria: string;
  operacion: string;
  sublabor: string;
  salario: number;
  auxilio: 'SI' | 'NO';
  ruta: 'SI' | 'NO';
  valor_transporte: number;
  empresa: string;
  centro_de_costo: string;
  ciudad: string;
  telefono_gestor: string;
  temporal: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-farms',
  standalone: true,
  imports: [
    MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule, StandardFilterTable, MatMenuModule
  ],
  templateUrl: './farms.component.html',
  styleUrls: ['./farms.component.css']
} )
export class FarmsComponent implements OnInit {
  private svc = inject(FarmsService);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('fileInp', { static: false }) fileInp!: ElementRef<HTMLInputElement>;

  // Data que se muestra en la tabla
  viewData: CentroCostoView[] = [];

  // Definición de columnas (elige las más útiles para la vista)
  columns: ColumnDefinition[] = [
    { name: 'finca', header: 'Finca', type: 'text', stickyStart: true },
    { name: 'ccostos', header: 'Ccostos', type: 'text' },
    { name: 'subcentro', header: 'Subcentro', type: 'text' },
    { name: 'categoria', header: 'Categoría', type: 'text' },
    { name: 'operacion', header: 'Operación', type: 'text' },
    { name: 'sublabor', header: 'Sublabor', type: 'text' },
    // format:'currency' -> antes salía "1300000" crudo; ahora "$1.300.000"
    { name: 'salario', header: 'Salario', type: 'number', format: 'currency', align: 'right', width: '14ch' },
    { name: 'auxilio', header: 'Aux. Transp.', type: 'text' },
    { name: 'ruta', header: 'Ruta', type: 'text' },
    { name: 'valor_transporte', header: 'Val. Transporte', type: 'number', format: 'currency', align: 'right', width: '14ch' },
    { name: 'empresa', header: 'Empresa', type: 'text' },
    { name: 'centro_de_costo', header: 'Centro de costo', type: 'text' },
    { name: 'ciudad', header: 'Ciudad', type: 'text' },
    { name: 'telefono_gestor', header: 'Tel. Gestor', type: 'text' },
    { name: 'temporal', header: 'Temporal', type: 'text' },
    { name: 'actions', header: 'Acciones', type: 'custom', stickyEnd: true }
  ];

  ngOnInit(): void {
    this.cargar();
  }

  // ================== Cargar listado ==================
  cargar(search?: string): void {
    this.svc.list(search).subscribe({
      next: rows => { this.viewData = (rows ?? []).map((it: AnyObj) => this.toView(it)); this.cdr.markForCheck(); },
      error: () => Swal.fire('Error', 'Error cargando centros de costo', 'error')
    });
  }


  // Backend -> ViewModel
  // El API (ms-auth-admin) devuelve camelCase: finca, ccostos, subcentro, categoria,
  // operacion, sublabor, salario, auxilioTransporte (boolean), ruta (boolean),
  // valorTransporte, empresa, centroDeCosto, ciudad, telefonoGestor, temporal.
  // Leemos camelCase primero y caemos al viejo formato "tal cual Excel" como fallback,
  // para tolerar API vieja o nueva.
  private toView(it: AnyObj): CentroCostoView {
    return {
      id: it['id'],
      finca: it['finca'] ?? it['FINCA'] ?? '',
      ccostos: it['ccostos'] ?? it['Ccostos'] ?? '',
      subcentro: it['subcentro'] ?? it['Subcentro'] ?? '',
      categoria: it['categoria'] ?? it['Categoría'] ?? '',
      operacion: it['operacion'] ?? it['Operación'] ?? '',
      sublabor: it['sublabor'] ?? it['Sublabor'] ?? '',
      salario: Number(it['salario'] ?? it['Salario'] ?? 0),
      auxilio: this.siNo(it['auxilioTransporte'] ?? it['AUXILIO DE TRANSPORTE']),
      ruta: this.siNo(it['ruta'] ?? it['RUTA']),
      valor_transporte: Number(it['valorTransporte'] ?? it['Valor Transporte'] ?? 0),
      empresa: it['empresa'] ?? it['Empresa '] ?? '',
      centro_de_costo: it['centroDeCosto'] ?? it['Centro de costo'] ?? '',
      ciudad: it['ciudad'] ?? it['Ciudad'] ?? '',
      telefono_gestor: it['telefonoGestor'] ?? it['Telefono de Contato Gestor'] ?? '',
      temporal: it['temporal'] ?? it['Temporal'] ?? ''
    };
  }

  /** Normaliza a 'SI'/'NO': acepta boolean (API nuevo) o string 'SI'/'NO' (Excel legacy). */
  private siNo(x: any): 'SI' | 'NO' {
    if (typeof x === 'boolean') return x ? 'SI' : 'NO';
    return String(x ?? '').trim().toUpperCase() === 'SI' ? 'SI' : 'NO';
  }

  // ViewModel -> payload camelCase (lo que bindea la entidad CentroCosto de ms-auth-admin).
  // auxilio/ruta van como BOOLEAN; salario/valorTransporte como number.
  private toPayload(v: Partial<CentroCostoView>): AnyObj {
    return {
      finca: v.finca ?? '',
      ccostos: v.ccostos ?? '',
      subcentro: v.subcentro ?? '',
      grupo: '', // opcional si no lo manejas en UI
      categoria: v.categoria ?? '',
      operacion: v.operacion ?? '',
      sublabor: v.sublabor ?? '',
      salario: this.n(v.salario),
      auxilioTransporte: (v.auxilio ?? 'NO') === 'SI',
      ruta: (v.ruta ?? 'NO') === 'SI',
      valorTransporte: this.n(v.valor_transporte),
      empresa: v.empresa ?? '',
      centroDeCosto: v.centro_de_costo ?? '',
      direccion: '', // opcional
      lineaContrato: '', // opcional
      indicaciones: '', // opcional
      ciudad: v.ciudad ?? '',
      telefonoGestor: v.telefono_gestor ?? '',
      temporal: v.temporal ?? ''
    };
  }

  private n(x: any): number {
    if (x == null) return 0;
    const n = Number(String(x).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  // ================== Nuevo ==================
  nuevo(): void {
    const fields: FieldConfig[] = [
      { name: 'finca', label: 'Finca', type: 'text', required: true, maxLength: 200 },
      { name: 'ccostos', label: 'Ccostos', type: 'text', required: true, maxLength: 50 },
      { name: 'subcentro', label: 'Subcentro', type: 'text', required: true, maxLength: 80 },
      { name: 'categoria', label: 'Categoría', type: 'text', required: true, maxLength: 120 },
      { name: 'operacion', label: 'Operación', type: 'text', required: true, maxLength: 120 },
      { name: 'sublabor', label: 'Sublabor', type: 'textarea', required: true },
      {
        name: 'salario', label: 'Salario', type: 'number', required: true, min: 0,
        parse: (raw: any) => this.n(raw)
      },
      {
        name: 'auxilio', label: 'Auxilio de transporte', type: 'select', required: true,
        options: [{ label: 'SI', value: 'SI' }, { label: 'NO', value: 'NO' }],
      },
      {
        name: 'ruta', label: 'Ruta', type: 'select', required: true,
        options: [{ label: 'SI', value: 'SI' }, { label: 'NO', value: 'NO' }],
      },
      {
        name: 'valor_transporte', label: 'Valor transporte', type: 'number', required: true, min: 0,
        parse: (raw: any) => this.n(raw)
      },
      { name: 'empresa', label: 'Empresa', type: 'text', required: true, maxLength: 200 },
      { name: 'centro_de_costo', label: 'Centro de costo', type: 'text', required: true, maxLength: 200 },
      { name: 'ciudad', label: 'Ciudad', type: 'text', required: true, maxLength: 120 },
      { name: 'telefono_gestor', label: 'Teléfono Gestor', type: 'text', required: true, maxLength: 50 },
      { name: 'temporal', label: 'Temporal', type: 'text', required: true, maxLength: 120 }
    ];

    const ref = this.dialog.open(DynamicFormDialogComponent, {
      width: '720px',
      autoFocus: true,
      data: { title: 'Nuevo centro de costo', fields }
    });

    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const payload = this.toPayload(result as Partial<CentroCostoView>);
      this.svc.create(payload).subscribe({
        next: () => {
          Swal.fire('Creado', 'Registro creado correctamente', 'success');
          this.cargar();
        },
        error: (err) => {
          Swal.fire('Error', err?.error?.detail || 'No se pudo crear', 'error');
        }
      });
    });
  }

  // ================== Editar (parcial) ==================
  editar(row: CentroCostoView): void {
    const fields: FieldConfig[] = [
      { name: 'finca', label: 'Finca', type: 'text', disabled: true },
      { name: 'ccostos', label: 'Ccostos', type: 'text', disabled: true },
      { name: 'subcentro', label: 'Subcentro', type: 'text', disabled: true },
      {
        name: 'salario', label: 'Salario', type: 'number', required: true, min: 0,
        parse: (raw: any) => this.n(raw)
      },
      {
        name: 'valor_transporte', label: 'Valor transporte', type: 'number', required: true, min: 0,
        parse: (raw: any) => this.n(raw)
      },
      {
        name: 'auxilio', label: 'Auxilio de transporte', type: 'select', required: true,
        options: [{ label: 'SI', value: 'SI' }, { label: 'NO', value: 'NO' }]
      },
      {
        name: 'ruta', label: 'Ruta', type: 'select', required: true,
        options: [{ label: 'SI', value: 'SI' }, { label: 'NO', value: 'NO' }]
      }
    ];

    const ref = this.dialog.open(DynamicFormDialogComponent, {
      width: '560px',
      autoFocus: false,
      data: { title: `Editar: ${row.finca} - ${row.ccostos}`, fields, value: row }
    });

    ref.afterClosed().subscribe(result => {
      if (!result) return;

      // Solo mandamos los campos editados en camelCase (PATCH parcial en el back).
      // auxilio/ruta como boolean.
      const patch: AnyObj = {
        salario: this.n(result.salario),
        valorTransporte: this.n(result.valor_transporte),
        auxilioTransporte: result.auxilio === 'SI',
        ruta: result.ruta === 'SI'
      };

      this.svc.updatePartial(row.id, patch).subscribe({
        next: () => {
          Swal.fire('Actualizado', 'Registro actualizado', 'success');
          this.cargar();
        },
        error: () => {
          Swal.fire('Error', 'No se pudo actualizar', 'error');
        }
      });
    });
  }

  // ================== Eliminar ==================
  eliminar(row: CentroCostoView): void {
    Swal.fire({
      title: '¿Eliminar?',
      text: `Se eliminará el registro de "${row.finca}" (${row.ccostos}).`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then(res => {
      if (!res.isConfirmed) return;
      this.svc.remove(row.id).subscribe({
        next: () => {
          Swal.fire('Eliminado', 'Registro eliminado', 'success');
          this.cargar();
        },
        error: (e) => {
          Swal.fire('Error', e?.error?.detail || 'No se pudo eliminar', 'error');
        }
      });
    });
  }

  // ================== Importar / Exportar ==================
  triggerImport(): void {
    this.fileInp?.nativeElement?.click();
  }

  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.svc.uploadExcel(file).subscribe({
      next: (r) => {
        Swal.fire('Importado', `Carga masiva realizada (${r.insertados} insertados)`, 'success');
        this.cargar();
        input.value = '';
      },
      error: (err) => {
        Swal.fire('Error', err?.error?.error || 'Error de importación', 'error');
        input.value = '';
      }
    });
  }

  exportar(): void {
    this.svc.downloadExcelAndSave('centros_costos.xlsx').subscribe({
      next: () => Swal.fire('Descargado', 'Archivo generado', 'success'),
      error: () => Swal.fire('Error', 'No se pudo descargar el Excel', 'error')
    });
  }
}
