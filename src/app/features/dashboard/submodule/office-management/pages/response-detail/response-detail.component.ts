import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { OfficeFormsService } from '../../services/office-forms.service';
import { FormResponse, ResponseValue } from '../../models/office-forms.models';

/** Detalle de una respuesta: valores por campo + adjuntos descargables. */
@Component({
  selector: 'app-response-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
  <div class="rd">
    <header class="rd__head">
      <button mat-icon-button (click)="back()"><mat-icon>arrow_back</mat-icon></button>
      <div>
        <h1>Respuesta #{{ resp()?.id }}</h1>
        <p>{{ resp()?.form_title }} · {{ resp()?.submitted_at | date:'medium' }}</p>
      </div>
    </header>

    @if (loading()) {
      <div class="rd__loading"><mat-spinner diameter="34"></mat-spinner></div>
    } @else if (resp(); as r) {
      <div class="meta">
        <span class="chip" [class.chip--pub]="r.source==='PUBLIC'">{{ r.source==='PUBLIC' ? 'Público' : 'Interno' }}</span>
        <span>Oficina: <b>{{ r.office_id || '—' }}</b></span>
        <span>Por: <b>{{ r.submitted_by || 'Anónimo' }}</b></span>
      </div>

      <div class="values">
        @for (v of r.values; track v.field_id) {
          <div class="val">
            <div class="val__label">{{ v.field_label || ('Campo ' + v.field_id) }}</div>
            @if (v.document_url) {
              <button mat-stroked-button (click)="download(v)"><mat-icon>download</mat-icon> Descargar adjunto</button>
            } @else if (v.value_text) {
              <div class="val__text">{{ v.value_text }}</div>
            } @else {
              <div class="val__empty">—</div>
            }
          </div>
        }
        @if (!r.values.length) { <div class="val__empty">Sin valores.</div> }
      </div>
    } @else {
      <div class="rd__error">No se pudo cargar la respuesta.</div>
    }
  </div>
  `,
  styles: [`
    .rd { padding: 8px 4px 40px; max-width: 760px; }
    .rd__head { display: flex; align-items: center; gap: 12px; }
    .rd__head h1 { font-size: 22px; font-weight: 800; margin: 0; color: var(--text); }
    .rd__head p { color: var(--muted); margin: 2px 0 0; }
    .rd__loading { display: flex; justify-content: center; padding: 50px 0; }
    .meta { display: flex; align-items: center; gap: 16px; margin: 16px 0; color: var(--text-2); font-size: 13px; flex-wrap: wrap; }
    .chip { font-size: 11px; background: var(--surface-3); color: var(--text-2); padding: 3px 8px; border-radius: 6px; font-weight: 600; }
    .chip--pub { background: #e0f2fe; background: light-dark(#e0f2fe, #102e4c); color: #0369a1; color: light-dark(#0369a1, #97d5f7); }
    .values { display: flex; flex-direction: column; gap: 12px; }
    .val { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 14px 16px; }
    .val__label { font-weight: 600; color: var(--text); margin-bottom: 6px; }
    .val__text { color: var(--text-2); white-space: pre-wrap; }
    .val__empty { color: var(--text-faint); }
  `],
})
export class ResponseDetailComponent implements OnInit {
  private api = inject(OfficeFormsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  resp = signal<FormResponse | null>(null);
  loading = signal(true);

  ngOnInit(): void {
    const rid = Number(this.route.snapshot.paramMap.get('rid'));
    this.api.getResponse(rid).subscribe({
      next: (r) => { this.resp.set(r); this.loading.set(false); },
      error: () => { this.resp.set(null); this.loading.set(false); },
    });
  }

  download(v: ResponseValue): void {
    if (!v.document_url) return;
    this.api.downloadDocument(v.document_url).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
    });
  }

  back(): void { this.router.navigate(['/dashboard/office-management']); }
}
