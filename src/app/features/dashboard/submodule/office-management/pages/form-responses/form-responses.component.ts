import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, inject, signal, viewChild } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent } from '../../../../../../shared/components/tabla-estandar';
import { OfficeFormsService } from '../../services/office-forms.service';
import { ResponseSummary } from '../../models/office-forms.models';

/**
 * Respuestas registradas de un formulario, sobre la tabla estándar en modo servidor: el
 * backend pagina y no busca ni ordena, así que la búsqueda va apagada y ninguna columna ordena.
 */
@Component({
  selector: 'app-form-responses',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, ...TABLA_ESTANDAR],
  template: `
  <div class="fr">
    <header class="fr__head">
      <button mat-icon-button (click)="back()"><mat-icon>arrow_back</mat-icon></button>
      <div>
        <h1>{{ title() || 'Respuestas' }}</h1>
        <p>{{ total() }} respuesta(s) registrada(s).</p>
      </div>
      <button mat-flat-button color="primary" (click)="fill()"><mat-icon>edit_note</mat-icon> Llenar</button>
    </header>

    <!-- «Ver» (o doble clic) abre el detalle de la respuesta. -->
    <app-tabla-estandar
      class="fr__tabla"
      id="gestion-oficina-respuestas"
      [titulo]="title() || 'Respuestas'"
      modulo="Gestión de Oficina"
      [busqueda]="false"
      vacio="Sin respuestas todavía."
      [datos]="rows()"
      [columnas]="columnas"
      [filaId]="idRespuesta"
      [cargando]="loading()"
      [totalServidor]="total()"
      [filasPorPagina]="pageSize"
      (paginaCambio)="cambiarPagina($event)"
      (filaClick)="detail($event)" />
  </div>
  `,
  styles: [`
    .fr { padding: 8px 4px 40px; }
    .fr__head { display: flex; align-items: center; gap: 12px; }
    .fr__head h1 { font-size: 22px; font-weight: 800; margin: 0; color: var(--text); }
    .fr__head p { color: var(--muted); margin: 2px 0 0; }
    .fr__head > button:last-child { margin-left: auto; }
    .fr__tabla { margin-top: 16px; }
  `],
})
export class FormResponsesComponent implements OnInit {
  /** Tope de filas por página del endpoint de respuestas (ms-forms). */
  private static readonly MAX_POR_PAGINA = 200;

  private api = inject(OfficeFormsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private locale = inject(LOCALE_ID);
  private readonly tabla = viewChild(TablaEstandarComponent);

  formId = 0;
  pageSize = 25;
  rows = signal<ResponseSummary[]>([]);
  total = signal(0);
  page = signal(0);
  title = signal('');
  loading = signal(true);

  readonly columnas: ColumnaTabla<ResponseSummary>[] = [
    { id: 'id', header: '#', valor: r => r.id, ordenable: false, tarjeta: 'titulo' },
    { id: 'origen', header: 'Origen', valor: r => (r.source === 'PUBLIC' ? 'Público' : 'Interno'), ordenable: false,
      tarjeta: 'badge',
      badge: r => (r.source === 'PUBLIC' ? { texto: 'Público', tono: 'info' } : { texto: 'Interno', tono: 'neutro' }) },
    { id: 'oficina', header: 'Oficina', valor: r => r.office_id ?? '', formato: r => r.office_id || '—',
      ordenable: false, prioridad: 2, tarjeta: 'meta' },
    { id: 'enviado', header: 'Enviado por', valor: r => r.submitted_by || 'Anónimo', ordenable: false, tarjeta: 'subtitulo' },
    { id: 'fecha', header: 'Fecha', ordenable: false, tarjeta: 'meta',
      valor: r => (r.submitted_at ? new Date(r.submitted_at) : null),
      formato: r => (r.submitted_at ? formatDate(r.submitted_at, 'short', this.locale) : '') },
  ];

  readonly idRespuesta = (r: ResponseSummary) => r.id;

  ngOnInit(): void {
    this.formId = Number(this.route.snapshot.paramMap.get('id'));
    this.api.get(this.formId).subscribe({ next: f => this.title.set(f.title), error: () => {} });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.listResponses(this.formId, { page: this.page(), size: this.pageSize }).subscribe({
      next: (p) => { this.rows.set(p.content); this.total.set(p.total); this.loading.set(false); },
      error: () => { this.rows.set([]); this.loading.set(false); },
    });
  }

  /** La tabla pide otra página (o cambia el tamaño): se consulta al backend. */
  cambiarPagina(e: { pagina: number; porPagina: number }): void {
    // El backend sirve como mucho 200 por página: si se elige más (la tabla ofrece 250),
    // se le pide a la tabla que use 200, que vuelve a emitir con ese tamaño.
    if (e.porPagina > FormResponsesComponent.MAX_POR_PAGINA) {
      this.tabla()?.cambiarPorPagina(FormResponsesComponent.MAX_POR_PAGINA);
      return;
    }
    this.page.set(e.pagina);
    this.pageSize = e.porPagina;
    this.load();
  }

  detail(r: ResponseSummary): void { this.router.navigate(['/dashboard/office-management/responses', r.id]); }
  fill(): void { this.router.navigate(['/dashboard/office-management/forms', this.formId, 'fill']); }
  back(): void { this.router.navigate(['/dashboard/office-management']); }
}
