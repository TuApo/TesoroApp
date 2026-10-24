import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CampoService } from '../../services/campo.service';

/**
 * Aviso destacado de ubicación, ANTES de que la app pida el permiso del sistema o mande
 * una sola posición (política de datos de usuario de Google Play): qué se recoge, cuándo,
 * quién lo ve y que no es en segundo plano. La respuesta queda en el teléfono.
 */
@Component({
  selector: 'app-aviso-ubicacion',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="aviso" role="region" aria-labelledby="aviso-ubicacion-titulo">
      <div class="icono"><mat-icon>location_on</mat-icon></div>
      <div class="texto">
        <h2 id="aviso-ubicacion-titulo">Esta app usa tu ubicación</h2>
        <p>Para el trabajo de campo, Gestión Tesorería toma tu <strong>ubicación precisa (GPS)</strong>:</p>
        <ul>
          <li>al marcar tu llegada o salida en una finca, para comprobar que estás en el sitio;</li>
          <li>cada pocos minutos <strong>solo mientras la app está abierta</strong>, para que tu supervisor vea dónde está el equipo y si tienes señal.</li>
        </ul>
        <p>No se toma con la app cerrada ni en segundo plano. La ven tu cadena de supervisión y la administración.
          Puedes cambiar esta decisión cuando quieras. <a href="/privacidad.html" target="_blank" rel="noopener">Política de privacidad</a></p>
        <div class="botones">
          <button type="button" class="si" (click)="responder(true)">Aceptar y continuar</button>
          <button type="button" class="no" (click)="responder(false)">No ahora</button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .aviso { display: flex; gap: 14px; padding: 18px; border-radius: 16px; background: var(--surface); border: 2px solid var(--brand-blue);
             box-shadow: var(--shadow-sm); color: var(--text); }
    .icono { flex: none; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; background: var(--info-bg); color: var(--brand-blue); }
    h2 { margin: 0 0 6px; font: 800 18px/1.25 var(--font-sans); }
    p, li { font-size: 14px; line-height: 1.5; margin: 0 0 6px; }
    ul { margin: 0 0 8px; padding-left: 18px; }
    a { color: var(--brand-blue); }
    .botones { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .botones button { min-height: 46px; padding: 0 18px; border-radius: 12px; font: 700 15px var(--font-sans); cursor: pointer; }
    .si { background: var(--navy); color: #fff; border: 1px solid var(--navy); }
    .no { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
    @media (max-width: 520px) { .aviso { flex-direction: column; } .botones button { flex: 1; } }
  `],
})
export class AvisoUbicacionComponent {
  private readonly campo = inject(CampoService);
  readonly respondido = output<boolean>();

  responder(acepta: boolean): void {
    this.campo.responderUbicacion(acepta);
    this.respondido.emit(acepta);
  }
}
