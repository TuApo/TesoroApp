import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { BuscadorPersona } from '../../components/buscador-persona/buscador-persona';
import { FichaPersona } from '../../components/ficha-persona/ficha-persona';
import { ResultadoBusqueda } from '../../service/tesoreria-api.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';

/**
 * Consulta de persona: el buscador y la ficha completa, en una pantalla.
 *
 * <p>Existe porque la pregunta «¿por qué a esta persona no se le puede autorizar?» no
 * tenía respuesta en la aplicación. El mostrador veía un rechazo sin explicación y
 * terminaba llamando por teléfono a tesorería. Aquí se ve el veredicto de cada condición,
 * el histórico de lo que ha pedido y en qué estado está cada cosa.
 *
 * <p>Es de solo lectura a propósito: autorizar se hace desde su pantalla. Esta sirve para
 * mirar antes de decidir, y para contestar a quien pregunta.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tesoreria-consulta',
  standalone: true,
  imports: [CommonModule, MatIconModule, BuscadorPersona, FichaPersona],
  templateUrl: './consulta.html',
  styleUrls: ['../../styles/tesoreria-comun.css', './consulta.css'],
})
export class ConsultaPersona {

  private utilidades = inject(UtilityServiceService);
  private sedeScope = inject(SedeScopeService);

  readonly documento = signal<string | null>(null);
  readonly sede = signal<string | null>(null);

  constructor() {
    // La sede del autorizador entra en la evaluación: hay ajustes de tope que dependen
    // de ella, y sin mandarla el cupo que se muestra aquí no sería el mismo que al
    // autorizar.
    // Desde una sede transversal (ADMINISTRATIVOS, VIRTUAL) no hay oficina propia que
    // aplicar: la consulta muestra el cupo general y la oficina se elige al autorizar.
    const usuario = this.utilidades.getUser?.() ?? {};
    this.sede.set(this.sedeScope.trabajaDesdeTransversal() ? null : (usuario?.sede?.nombre ?? null));
  }

  alSeleccionar(p: ResultadoBusqueda): void {
    this.documento.set(p.numero_documento);
  }
}
