import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';

import { ActivoOficina, DireccionGuardada, MovimientoHistorial, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EconomiaStore } from '../../economia.store';
import { SonidosService } from '../../sonidos.service';
import { TemporadaService } from '../../../../core/services/temporada.service';
import { ESTADO_CUPO, pesos, usuarioEnSesion } from '../../economia.util';

/**
 * Su cuenta en la tienda: quién es para la tienda (oficina y temporal), cuánto cupo tiene
 * y por qué, y todo lo que ha comprado por los dos canales con lo que ya se le descontó.
 */
@Component({
  selector: 'eco-cuenta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterLink, DatePipe],
  templateUrl: './cuenta.html',
  styleUrls: ['../../economiapp.css', './cuenta.css'],
})
export class EconomiaCuenta {
  readonly store = inject(EconomiaStore);
  readonly sonidos = inject(SonidosService);
  private api = inject(TiendaService);
  private router = inject(Router);
  readonly temporada = inject(TemporadaService);

  readonly usuario = usuarioEnSesion();
  readonly historial = signal<MovimientoHistorial[]>([]);
  readonly cargandoHistorial = signal(true);

  readonly pesos = pesos;
  readonly CUPO = ESTADO_CUPO;

  /** Direcciones guardadas para domicilio (se agregan al pedir). */
  readonly direcciones = signal<DireccionGuardada[]>([]);
  /** Equipos de la empresa que la persona tiene a su cargo. */
  readonly activos = signal<ActivoOficina[]>([]);
  borrarDireccion(d: DireccionGuardada): void {
    if (!confirm(`¿Borrar la dirección "${d.nombre}"?`)) return;
    this.api.borrarDireccion(d.id).subscribe({ next: () => this.direcciones.update(x => x.filter(y => y.id !== d.id)), error: () => this.store.avisar('No se pudo borrar', 'error') });
  }
  principal(d: DireccionGuardada): void {
    this.api.guardarDireccion({ ...d, principal: true }).subscribe({ next: () => this.api.misDirecciones().subscribe(ds => this.direcciones.set(ds)), error: () => null });
  }

  constructor() {
    this.api.misDirecciones().subscribe({ next: d => this.direcciones.set(d), error: () => null });
    this.api.misActivos().subscribe({ next: a => this.activos.set(a), error: () => null });
    this.store.refrescarCupo();
    this.api.miHistorial().subscribe({
      next: h => { this.historial.set(h ?? []); this.cargandoHistorial.set(false); },
      error: () => { this.historial.set([]); this.cargandoHistorial.set(false); },
    });
  }

  abrir(m: MovimientoHistorial): void {
    if (m.origen === 'PEDIDO') this.router.navigate(['/economiapp/pedidos', m.id]);
  }

  volver(): void { this.router.navigateByUrl('/dashboard'); }
}
