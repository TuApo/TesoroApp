import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { TurnosService } from '../../service/turnos.service';
import { VistaCasoService } from '../../service/vista-caso.service';
import { leerContexto } from '../../components/panel-atencion/panel-atencion';

/**
 * Entrada de un caso por enlace: /dashboard/turnos/caso/<id>.
 *
 * <p>Es lo que permite abrir un caso en OTRA pestaña del navegador (o en otro equipo con
 * la misma sesión): se activa el caso, se navega a la pantalla donde se iba y se vuelven
 * a poner los datos que se estaban registrando.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-abrir-caso',
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="abrir">
      <mat-icon>{{ error() ? 'error' : 'folder_open' }}</mat-icon>
      <p>{{ error() || 'Abriendo el caso y restaurando la pantalla donde iba…' }}</p>
    </div>
  `,
  styles: [`
    .abrir { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 16px; color: var(--muted); text-align: center; }
    .abrir mat-icon { font-size: 44px; width: 44px; height: 44px; color: var(--brand-blue); }
  `],
})
export class AbrirCaso implements OnInit {
  readonly id = input.required<string>();
  private api = inject(TurnosService);
  private ctx = inject(ContextoTurnosService);
  private vista = inject(VistaCasoService);
  private router = inject(Router);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.ctx.cargar();
    this.api.activarCaso(this.id()).subscribe({
      next: async c => {
        this.ctx.aplicarCaso(c);
        this.ctx.preferencia.update(p => (p ? { ...p, caso_activo_id: c.id } : p));
        this.ctx.recargarPanel();
        const v = leerContexto(c.contexto_json);
        if (v.ruta && v.ruta !== this.router.url) await this.vista.restaurar(v);
        else this.router.navigateByUrl('/dashboard/turnos/atencion');
      },
      error: e => this.error.set(e?.status === 404 ? 'Ese caso no existe o no es suyo.' : (e?.error?.message || 'No se pudo abrir el caso')),
    });
  }
}
