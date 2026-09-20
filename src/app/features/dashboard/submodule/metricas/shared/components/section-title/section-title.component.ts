import { Component, Input, ChangeDetectionStrategy } from '@angular/core';


@Component({
    selector: 'app-section-title',
    standalone: true,
    imports: [],
    template: `
    <div class="section-title-container">
      <div class="title-row">
        <h3 class="title">{{ title }}</h3>
        <ng-content select="[actions]"></ng-content>
      </div>
      @if (subtitle) {
        <p class="subtitle">{{ subtitle }}</p>
      }
    </div>
    `,
    styles: [`
    :host {
      display: block;
      margin-bottom: 1.5rem;
    }
    .section-title-container {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--text);
      margin: 0;
    }
    .subtitle {
      font-size: 0.875rem;
      color: var(--muted);
      margin: 0;
    }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SectionTitleComponent {
    @Input({ required: true }) title!: string;
    @Input() subtitle?: string;
}
