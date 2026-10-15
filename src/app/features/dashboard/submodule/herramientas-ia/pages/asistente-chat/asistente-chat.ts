import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { ChatIa, ContextoChatIa } from '../../../../../../shared/components/chat-ia';

/** Ruta de esta pantalla (menú: Herramientas IA › Asistente IA). */
const RUTA = '/dashboard/herramientas-ia/asistente';

/**
 * Herramientas IA › Asistente IA sobre el chat estándar de la plataforma (módulo
 * `herramientas-ia.asistente` de ms-ai): consulta contratación, nómina, tesorería, documentos y
 * afiliaciones con los permisos de la persona, busca en la base de conocimiento interna y entrega
 * PDF, Excel, Word y PowerPoint. Las conversaciones del asistente anterior se siguen aquí mismo.
 *
 * Parámetros de la URL que usan otras pantallas:
 * - `q`: pregunta con la que arrancar una conversación nueva (buscador del menú, Agentes de desarrollo).
 * - `contexto`: lo que la pantalla de origen sabe (p. ej. el proceso jurídico); va como "lo que se ve".
 * - `c`: conversación a abrir (la bandeja la manda al botón «Abrir»).
 *
 * El chat del proceso de contratación (form-entrevista) sigue usando el componente anterior.
 */
@Component({
  selector: 'app-asistente-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatIa],
  template: `<app-chat-ia class="ac-chat" modo="pagina" [contexto]="contexto()" [(conversacionId)]="conversacionId" />`,
  styles: [`
    :host { display: block; }
    .ac-chat { height: calc(100dvh - var(--alto-barra-superior, 120px)); min-height: 520px; border: 1px solid var(--border);
      border-radius: 16px; overflow: hidden; background: var(--surface); }
    @media (max-width: 900px) { .ac-chat { height: calc(100dvh - var(--alto-barra-superior, 140px)); border-radius: 12px; } }
    @media (max-width: 600px) {
      .ac-chat { border: 0; border-radius: 0; height: calc(100dvh - var(--alto-barra-superior, 130px) - var(--mobile-bottombar-h, 0px)); }
    }
  `],
})
export class AsistenteChat {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private readonly chat = viewChild(ChatIa);
  readonly conversacionId = signal<number | null>(null);
  /** Lo que mandó la pantalla de origen en `?contexto=` (se queda mientras dure la conversación). */
  private readonly contextoUrl = signal<string | null>(null);
  /** Pregunta de `?q=` que espera a que la IA esté lista. */
  private readonly pregunta = signal<string | null>(null);

  readonly contexto = computed<ContextoChatIa>(() => {
    const extra = this.contextoUrl();
    return {
      modulo: 'herramientas-ia.asistente',
      moduloNombre: 'Herramientas IA › Asistente IA',
      ruta: RUTA,
      pantalla: extra ? { origen: extra } : null,
    };
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(p => {
      const q = (p.get('q') ?? '').trim();
      const ctx = (p.get('contexto') ?? '').trim();
      const c = Number(p.get('c'));
      if (!q && !ctx && !c) return;
      if (ctx) this.contextoUrl.set(ctx.slice(0, 4000));
      if (c > 0) this.conversacionId.set(c);
      if (q) this.pregunta.set(q.slice(0, 6000));
      // Se limpia la URL para que recargar no vuelva a preguntar.
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    });
    // La pregunta de la URL se manda en una conversación nueva cuando la IA responde que está disponible.
    effect(() => {
      const chat = this.chat();
      const q = this.pregunta();
      if (!chat || !q || !chat.estado()?.disponible) return;
      untracked(() => {
        this.pregunta.set(null);
        chat.nueva();
        chat.texto.set(q);
        void chat.enviar();
      });
    });
  }
}
