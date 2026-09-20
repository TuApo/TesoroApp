import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';

import { ColumnaTabla, TABLA_ESTANDAR, ValorCelda } from '../../../../../../shared/components/tabla-estandar';
import {
  ContabilidadService,
  HojaContabilidad,
  RegistroPage,
} from '../../service/contabilidad.service';

interface HojaTab {
  hoja: HojaContabilidad;
  loaded: boolean;
  loading: boolean;
  rows: any[];
  columns: string[];
  /** Columnas de la tabla estandar (se arman al cargar la hoja). */
  tabla: ColumnaTabla<any>[];
  total: number;
  page: number;
  pageSize: number;
  buscar: string;
}

const HOJA_ICONS: Record<string, string> = {
  'NM GRUPO ELITE': 'payments', 'NM': 'receipt_long', 'MOV': 'swap_horiz',
  'LQ': 'assignment_return', 'BON': 'card_giftcard', 'SS': 'security',
  'FECHAS': 'calendar_month', 'Analisis': 'analytics',
  'ALIMENTACION': 'restaurant', 'TRANSPORTES': 'directions_bus',
  'FUNERARIO RP': 'church', 'DEVOLUCIONES': 'undo',
  'RODAMIENTO': 'directions_car', 'EXTRAS FUERA DE NOMINA': 'more_time',
  'VACACIONES': 'beach_access', 'FACT MATERNIDAD': 'pregnant_woman',
  'Incapacidades PG 2025': 'local_hospital',
};

@Component({
  selector: 'app-analisis-nomina',
  standalone: true,
  imports: [
    CommonModule, MatCardModule, MatIconModule, MatButtonModule,
    MatProgressSpinnerModule, MatToolbarModule, MatTabsModule,
    MatTooltipModule,
    MatSelectModule, MatChipsModule, ...TABLA_ESTANDAR,
  ],
  templateUrl: './analisis-nomina.component.html',
  styleUrls: ['./analisis-nomina.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalisisNominaComponent implements OnInit {
  private readonly service = inject(ContabilidadService);
  private readonly cdr = inject(ChangeDetectorRef);

  loadingHojas = signal(true);
  tabs = signal<HojaTab[]>([]);
  activeTabIndex = signal(0);

  hasData = computed(() => this.tabs().length > 0);

  ngOnInit(): void {
    this.cargarHojas();
  }

  async cargarHojas(): Promise<void> {
    this.loadingHojas.set(true);
    this.cdr.detectChanges();

    try {
      const hojas = await this.service.listarHojas();
      const sorted = hojas.sort((a, b) => a.orden - b.orden);
      this.tabs.set(sorted.map(h => ({
        hoja: h,
        loaded: false,
        loading: false,
        rows: [],
        columns: [],
        tabla: [],
        total: h.total_filas,
        page: 1,
        pageSize: 50,
        buscar: '',
      })));

      // Cargar la primera hoja automáticamente
      if (sorted.length > 0) {
        this.cargarDatosHoja(0);
      }
    } catch (err) {
      console.error('Error cargando hojas:', err);
    } finally {
      this.loadingHojas.set(false);
      this.cdr.detectChanges();
    }
  }

  async cargarDatosHoja(tabIndex: number): Promise<void> {
    const tabsCopy = [...this.tabs()];
    const tab = { ...tabsCopy[tabIndex] };
    tab.loading = true;
    tabsCopy[tabIndex] = tab;
    this.tabs.set(tabsCopy);
    this.cdr.detectChanges();

    try {
      const res: RegistroPage = await this.service.obtenerRegistrosHoja(
        tab.hoja.id, tab.page, tab.pageSize, tab.buscar
      );

      tab.rows = res.results;
      tab.total = res.total;
      tab.loaded = true;

      // Construir columnas de la primera fila
      if (res.results.length > 0) {
        const allKeys = new Set<string>();
        // Priorizar columnas del header original de la hoja
        const hojaColumnas = (res as any).columnas || tab.hoja.columnas || [];
        for (const col of hojaColumnas) {
          if (col && col.trim()) allKeys.add(col.trim());
        }
        // Agregar campos comunes que tengan datos
        const commonFields = ['cedula', 'nombre_empleado', 'cargo', 'centro_costo', 'empresa',
          'salario', 'total_devengado', 'total_deducciones', 'neto_pagar'];
        for (const f of commonFields) {
          if (res.results.some(r => r[f] !== null && r[f] !== undefined && r[f] !== '')) {
            allKeys.add(f);
          }
        }
        // Agregar keys de datos_extra
        for (const row of res.results.slice(0, 5)) {
          for (const k of Object.keys(row)) {
            if (k !== '_fila' && k.trim()) allKeys.add(k);
          }
        }
        tab.columns = Array.from(allKeys);
        tab.tabla = this.columnasTabla(tab);
      }
    } catch (err) {
      console.error('Error cargando registros:', err);
    } finally {
      tab.loading = false;
      const tabsCopy2 = [...this.tabs()];
      tabsCopy2[tabIndex] = tab;
      this.tabs.set(tabsCopy2);
      this.cdr.detectChanges();
    }
  }

  onTabChange(index: number): void {
    this.activeTabIndex.set(index);
    const tab = this.tabs()[index];
    if (!tab.loaded && !tab.loading) {
      this.cargarDatosHoja(index);
    }
  }

  /** Paginacion de la tabla estandar (modo servidor): la pagina se pide al backend. */
  onPageChange(event: { pagina: number; porPagina: number }, tabIndex: number): void {
    const tabsCopy = [...this.tabs()];
    const tab = { ...tabsCopy[tabIndex] };
    tab.page = event.pagina + 1;
    tab.pageSize = event.porPagina;
    tabsCopy[tabIndex] = tab;
    this.tabs.set(tabsCopy);
    this.cargarDatosHoja(tabIndex);
  }

  /** Busqueda de la tabla estandar: ya llega con debounce y va al backend desde la pagina 1. */
  onBuscar(value: string, tabIndex: number): void {
    const tabsCopy = [...this.tabs()];
    const tab = { ...tabsCopy[tabIndex] };
    tab.buscar = value;
    tab.page = 1;
    tabsCopy[tabIndex] = tab;
    this.tabs.set(tabsCopy);
    this.cargarDatosHoja(tabIndex);
  }

  getIcon(nombre: string): string {
    for (const [key, icon] of Object.entries(HOJA_ICONS)) {
      if (nombre.includes(key)) return icon;
    }
    return 'table_chart';
  }

  formatCell(value: any): string {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') {
      if (Math.abs(value) >= 1000) return value.toLocaleString('es-CO', { maximumFractionDigits: 2 });
      return String(value);
    }
    return String(value);
  }

  /** Columnas visibles limitadas para rendimiento */
  visibleColumns(tab: HojaTab): string[] {
    // Mostrar max 30 columnas para rendimiento del DOM
    return tab.columns.slice(0, 30);
  }

  /**
   * Columnas de la tabla estandar para una hoja (dinamicas: salen del header
   * de la hoja y de los datos). La pagina y la busqueda van al backend (modo
   * servidor) y el endpoint no ordena: por eso ninguna es ordenable. En
   * tarjetas (movil) se muestran las primeras; el resto en la vista tabla.
   */
  private columnasTabla(tab: HojaTab): ColumnaTabla<any>[] {
    const fila: ColumnaTabla<any> = {
      id: '_fila', header: 'Fila', valor: (row) => row['_fila'], align: 'right',
      ordenable: false, tarjeta: 'meta', ancho: '56px',
    };
    const datos = this.visibleColumns(tab).map((col, i): ColumnaTabla<any> => ({
      id: col,
      header: col,
      ordenable: false,
      prioridad: i < 6 ? 1 : i < 12 ? 2 : 3,
      tarjeta: i === 0 ? 'titulo' : i === 1 ? 'subtitulo' : i < 8 ? 'meta' : 'oculto',
      valor: (row) => valorPlano(row[col]),
      formato: (row) => this.formatCell(row[col]),
    }));
    return [fila, ...datos];
  }

  readonly idFila = (row: any, i: number) => row?.['_fila'] ?? i;
}

/** Dato plano para la tabla estandar: numeros como numeros, el resto como texto. */
function valorPlano(value: any): ValorCelda {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}
