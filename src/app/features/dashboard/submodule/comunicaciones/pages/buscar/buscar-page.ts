import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Adjunto, Busqueda } from '../../modelos';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { horaCorta, iconoAdjunto, mmss, tamano } from '../../utiles';
import { abrirActa } from '../../components/acta/acta';
import { VisorAdjunto } from '../../components/visor/visor-adjunto';

/** Buscar en todo lo conversado: mensajes, transcripciones, archivos, compromisos y resúmenes. */
@Component({
  selector: 'app-com-buscar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="pagina">
      <form class="caja" (submit)="$event.preventDefault(); buscar(q.value)">
        <mat-icon>manage_search</mat-icon>
        <input #q type="search" placeholder="¿Qué se habló de…? Ej: contrato Faca, presupuesto, afiliaciones" autofocus />
        <button type="submit">Buscar</button>
      </form>
      @if (cargando()) { <p class="tenue">Buscando…</p> }
      @if (r(); as res) {
        @if (!total()) { <p class="tenue">No se encontró “{{ res.q }}” en tus conversaciones.</p> }
        @if (res.transcripciones.length) {
          <h3><mat-icon>record_voice_over</mat-icon> Dicho en llamadas <small>{{ res.transcripciones.length }}</small></h3>
          @for (s of res.transcripciones; track s.id) {
            <button type="button" class="res" (click)="acta(s.llamada_id)">
              <span class="t">{{ minuto(s.inicio_ms) }}</span>
              <span class="c"><strong>{{ s.nombre }}:</strong> {{ s.texto }}
                <small>{{ s.llamada_titulo || 'Llamada' }} · {{ conv(res, s.conversacion_id) }} · {{ cuando(s.llamada_en) }}</small></span>
            </button>
          }
        }
        @if (res.mensajes.length) {
          <h3><mat-icon>chat</mat-icon> Mensajes <small>{{ res.mensajes.length }}</small></h3>
          @for (m of res.mensajes; track m.id) {
            <button type="button" class="res" (click)="irChat(m.conversacion_id)">
              <span class="c"><strong>{{ m.autor_nombre }}:</strong> {{ m.texto }}
                <small>{{ conv(res, m.conversacion_id) }} · {{ cuando(m.creado_en) }}</small></span>
            </button>
          }
        }
        @if (res.compromisos.length) {
          <h3><mat-icon>task_alt</mat-icon> Compromisos <small>{{ res.compromisos.length }}</small></h3>
          @for (c of res.compromisos; track c.id) {
            <button type="button" class="res" (click)="c.llamada_id ? acta(c.llamada_id) : irChat(c.conversacion_id)">
              <span class="c"><strong>{{ c.descripcion }}</strong>
                <small>{{ c.responsable_nombre ?? 'Sin responsable' }} · {{ c.estado.toLowerCase() }} · {{ c.conversacion_nombre }}</small></span>
            </button>
          }
        }
        @if (res.resumenes.length) {
          <h3><mat-icon>summarize</mat-icon> Resúmenes <small>{{ res.resumenes.length }}</small></h3>
          @for (x of res.resumenes; track x.id) {
            <button type="button" class="res" (click)="x.llamada_id ? acta(x.llamada_id) : irChat(x.conversacion_id)">
              <span class="c"><strong>{{ x.titulo || 'Resumen' }}</strong> {{ x.resumen }}
                <small>{{ conv(res, x.conversacion_id) }} · {{ cuando(x.creado_en) }}</small></span>
            </button>
          }
        }
        @if (res.archivos.length) {
          <h3><mat-icon>folder</mat-icon> Archivos <small>{{ res.archivos.length }}</small></h3>
          @for (a of res.archivos; track a.id; let i = $index) {
            <button type="button" class="res" (click)="abrir(res.archivos, i)">
              <mat-icon class="ic">{{ icono(a) }}</mat-icon>
              <span class="c"><strong>{{ a.nombre }}</strong><small>{{ tam(a.tamano) }} · {{ cuando(a.creado_en) }}</small></span>
            </button>
          }
        }
      }
    </div>`,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }
    .pagina { max-width: 860px; margin: 0 auto; padding: 1rem; }
    .caja { display: flex; align-items: center; gap: .5rem; border: 1px solid var(--border-strong); border-radius: 999px; padding: .35rem .4rem .35rem .9rem;
      background: var(--surface); box-shadow: var(--shadow-sm); }
    .caja input { flex: 1; border: 0; outline: 0; font: inherit; font-size: .95rem; background: transparent; color: var(--text); }
    .caja mat-icon { color: var(--primary); }
    .caja button { border: 0; background: var(--primary); color: #fff; border-radius: 999px; padding: .45rem 1rem; font: inherit; font-weight: 700; cursor: pointer; }
    h3 { display: flex; align-items: center; gap: .35rem; font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-2); margin: 1.2rem 0 .4rem; }
    h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--primary); }
    h3 small { background: var(--surface-3); border-radius: 999px; padding: 0 .45rem; }
    .res { display: flex; gap: .6rem; align-items: flex-start; width: 100%; text-align: left; border: 1px solid var(--border); border-radius: 12px;
      padding: .5rem .65rem; margin-bottom: .35rem; background: var(--surface); cursor: pointer; font: inherit; color: var(--text); }
    .res:hover { border-color: var(--border-strong); background: var(--surface-2); }
    .t { font-variant-numeric: tabular-nums; font-size: .75rem; color: var(--muted); padding-top: .1rem; }
    .c { flex: 1; min-width: 0; font-size: .86rem; line-height: 1.45; }
    .c small { display: block; color: var(--muted); font-size: .72rem; margin-top: .15rem; }
    .ic { color: var(--primary); }
    .tenue { color: var(--muted); text-align: center; margin-top: 1.5rem; }
  `],
})
export class BuscarPage {
  private readonly api = inject(ComunicacionesApiService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  readonly r = signal<Busqueda | null>(null);
  readonly cargando = signal(false);

  total(): number {
    const x = this.r();
    return x ? x.mensajes.length + x.transcripciones.length + x.archivos.length + x.compromisos.length + x.resumenes.length : 0;
  }

  buscar(q: string): void {
    if (q.trim().length < 2) return;
    this.cargando.set(true);
    this.api.buscar(q.trim()).subscribe({
      next: r => { this.r.set(r); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  conv(r: Busqueda, id: string | null): string { return r.conversaciones.find(c => c.id === id)?.nombre ?? ''; }
  cuando(iso: string | null): string { return horaCorta(iso); }
  minuto(ms: number): string { return mmss(ms); }
  tam(b: number): string { return tamano(b); }
  icono(a: Adjunto): string { return iconoAdjunto(a.clase, a.mime); }
  acta(id: string): void { abrirActa(this.dialog, id); }
  irChat(id: string): void { void this.router.navigate(['/dashboard/comunicaciones/chats'], { queryParams: { c: id } }); }
  abrir(adjuntos: Adjunto[], i: number): void {
    this.dialog.open(VisorAdjunto, { data: { adjuntos, indice: i }, panelClass: 'com-visor-panel', maxWidth: '100vw', maxHeight: '100vh', width: '100vw', height: '100vh' });
  }
}
