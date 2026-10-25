import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { MetricasContratacionService } from '../../services/metricas-contratacion.service';
import {
  ESTADOS_EVALUACION, ETAPA_TEXTO, FichaPersona, ProcesoFicha, RESULTADOS, TEMPORAL_TEXTO,
} from '../../models/metricas-contratacion.models';
import {
  ExpedienteContratoDialogComponent, ExpedienteContratoDialogData,
} from '@/app/features/dashboard/submodule/hiring/components/expediente-contrato/expediente-contrato-dialog.component';

export interface FichaPersonaData { cedula: string; nombre?: string | null; proceso_id?: number | null; }

/** Un paso de la línea de tiempo de un proceso. */
interface Paso { titulo: string; fecha: string | null; estado: 'ok' | 'mal' | 'pend' | 'gris'; detalle?: string | null; }

/**
 * Ficha de una persona desde Métricas de Contratación: sus datos, contacto y residencia, y cada
 * proceso como línea de tiempo (presentación → evaluación → remisión → prueba → exámenes →
 * contrato). «Ver documentos» abre el expediente estándar del contrato.
 */
@Component({
  selector: 'app-ficha-persona-contratacion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressBarModule],
  templateUrl: './ficha-persona-contratacion.component.html',
  styleUrl: './ficha-persona-contratacion.component.css',
})
export class FichaPersonaContratacionComponent {
  private readonly api = inject(MetricasContratacionService);
  private readonly dialog = inject(MatDialog);
  readonly ref = inject(MatDialogRef<FichaPersonaContratacionComponent>);
  readonly data = inject<FichaPersonaData>(MAT_DIALOG_DATA);

  readonly ficha = signal<FichaPersona | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly abierto = signal<number | null>(null);

  readonly RESULTADOS = RESULTADOS;
  readonly TEMPORAL_TEXTO = TEMPORAL_TEXTO;

  constructor() {
    this.api.persona(this.data.cedula).subscribe({
      next: (f) => {
        this.ficha.set(f);
        this.cargando.set(false);
        const elegido = f.procesos.find((p) => p.proceso_id === this.data.proceso_id) ?? f.procesos[0];
        this.abierto.set(elegido?.proceso_id ?? null);
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(e?.status === 404 ? 'Esta persona no está en las oficinas de su alcance.' : 'No se pudo cargar la ficha.');
      },
    });
  }

  pasos(p: ProcesoFicha): Paso[] {
    const ev = p.evaluacion;
    const pasos: Paso[] = [{ titulo: 'Se presentó', fecha: p.fecha, estado: 'ok', detalle: `${p.oficina} · ${p.entrevista.medio}` }];
    pasos.push({
      titulo: 'Evaluación', fecha: null,
      estado: !ev.estado ? 'pend' : ev.estado === 'APLICA' ? 'ok' : ev.estado === 'NO_APLICA' ? 'mal' : 'gris',
      detalle: ev.estado ? `${ESTADOS_EVALUACION[ev.estado] ?? ev.estado}${ev.motivo ? ' — ' + ev.motivo : ''}` : 'Sin evaluar',
    });
    const remitido = p.vacante.cargo || p.vacante.tipo || p.remision.prueba_at || p.remision.autorizado_at;
    if (remitido) {
      pasos.push({ titulo: 'Remitido a vacante', fecha: p.remision.prueba_at ?? p.remision.autorizado_at, estado: 'ok',
        detalle: [p.vacante.tipo, p.vacante.cargo, p.vacante.finca].filter(Boolean).join(' · ') || null });
    }
    if (p.prueba.resultado) {
      pasos.push({ titulo: 'Prueba técnica', fecha: p.prueba.fecha, estado: p.prueba.resultado === 'PASO' ? 'ok' : 'mal',
        detalle: `${ETAPA_TEXTO[p.prueba.resultado]}${p.prueba.motivo ? ' — ' + p.prueba.motivo : ''}` });
    }
    if (p.examen.enviado_at || p.examen.resultado || p.examen.concepto) {
      pasos.push({ titulo: 'Exámenes médicos', fecha: p.examen.fecha ?? p.examen.enviado_at,
        estado: p.examen.resultado === 'NO_PASO' || p.examen.resultado === 'NO_SE_PRESENTO' ? 'mal' : p.examen.resultado || p.examen.concepto ? 'ok' : 'pend',
        detalle: [p.examen.resultado ? ETAPA_TEXTO[p.examen.resultado] : null, p.examen.concepto, p.examen.ips, p.examen.motivo].filter(Boolean).join(' · ') || null });
    }
    if (p.contrato) {
      const c = p.contrato;
      pasos.push({ titulo: c.real ? 'Contratado' : 'Contrato sin confirmar', fecha: c.fecha_ingreso, estado: c.real ? 'ok' : 'pend',
        detalle: [c.codigo ? 'Código ' + c.codigo : null, c.temporal ? TEMPORAL_TEXTO[c.temporal] : null, c.finca].filter(Boolean).join(' · ') || null });
      if (c.fecha_retiro) pasos.push({ titulo: 'Retiro', fecha: c.fecha_retiro, estado: 'mal', detalle: c.motivo_retiro });
    }
    return pasos;
  }

  residencia(f: FichaPersona): string {
    return [f.direccion, f.barrio, f.localidad, f.municipio, f.departamento].filter(Boolean).join(', ') || '—';
  }

  verDocumentos(p?: ProcesoFicha | null): void {
    const f = this.ficha();
    this.dialog.open<ExpedienteContratoDialogComponent, ExpedienteContratoDialogData>(ExpedienteContratoDialogComponent, {
      data: { cedula: f?.cedula ?? this.data.cedula, proceso_id: p?.contrato ? p.proceso_id : (this.data.proceso_id ?? null), nombre: f?.nombre ?? this.data.nombre },
      width: '1100px', maxWidth: '96vw',
    });
  }

  copiar(texto: string | null): void {
    if (texto) navigator.clipboard?.writeText(texto).catch(() => undefined);
  }

  iniciales(n: string | null | undefined): string {
    return (n ?? '').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  }

  fecha(iso: string | null | undefined): string {
    if (!iso) return '';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    const hora = iso.length > 11 ? ' ' + iso.slice(11, 16) : '';
    return `${d} ${meses[m - 1]} ${y}${hora}`;
  }
}
