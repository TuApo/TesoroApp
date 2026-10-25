import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { MarkdownMessageComponent } from '../../../features/dashboard/submodule/nomina/pages/analitica-nomina-ia/markdown-message.component';
import { AvatarAgente } from './avatar-agente';
import { AvatarAgenteService } from './avatar-agente.service';
import { Personaje } from './avatar-agente.modelos';
import { partirTramos } from './tramos';

/**
 * Una respuesta de la IA con la cara de quien la da. Si respondieron varias áreas juntas (marcas
 * [[clave]]), cada parte sale con su personaje, su nombre y su color, para que se note que son
 * dos directores complementándose. Lo usan el asistente operador y cualquier chat que no pinte
 * sus propias burbujas.
 */
@Component({
  selector: 'app-respuesta-avatares',
  imports: [MarkdownMessageComponent, AvatarAgente],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (t of tramos(); track $index) {
      <div class="ra-tramo" [class.ra-tramo--varios]="tramos().length > 1" [style.--ra-c]="t.p.colorPrimario">
        @if (conNombre() || tramos().length > 1) {
          <div class="ra-quien">
            <app-avatar-agente [personaje]="t.p" [tam]="22" [animado]="false" [conTitulo]="false" />
            <b>{{ t.p.nombre }}</b><small>{{ t.p.cargo }}</small>
          </div>
        }
        <app-markdown-message [content]="t.texto" [interactivo]="interactivo()" (pregunta)="pregunta.emit($event)" />
      </div>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .ra-tramo { min-width: 0; }
    .ra-tramo--varios { border-left: 3px solid var(--ra-c, var(--border)); padding-left: 10px; }
    .ra-quien { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; min-width: 0; font-size: .78rem; }
    .ra-quien b { color: var(--text); white-space: nowrap; }
    .ra-quien small { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  `],
})
export class RespuestaAvatares {
  private avatares = inject(AvatarAgenteService);

  readonly contenido = input<string>('');
  /** Quien respondió (clave); null = el presidente. */
  readonly principal = input<string | null | undefined>(null);
  /** Mostrar el nombre aunque hable uno solo. */
  readonly conNombre = input(true);
  readonly interactivo = input(false);
  readonly pregunta = output<string>();

  readonly tramos = computed<{ clave: string; texto: string; p: Personaje }[]>(() => {
    const principal = this.principal() || 'presidente';
    const lista = partirTramos(this.contenido() ?? '', principal);
    if (!lista.length) return [{ clave: principal, texto: this.contenido() ?? '', p: this.avatares.personaje(principal) }];
    return lista.map((t) => ({ ...t, p: this.avatares.personaje(t.clave) }));
  });
}
