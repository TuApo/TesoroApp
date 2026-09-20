import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-empty-state',
    standalone: true,
    imports: [MatIconModule],
    template: `
    <div class="empty-state">
      <mat-icon class="icon">{{ icon }}</mat-icon>
      <h4 class="title">{{ title }}</h4>
      @if (description) {
        <p class="description">{{ description }}</p>
      }
      <ng-content></ng-content>
    </div>
    `,
    styles: [`
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1.5rem;
      text-align: center;
      height: 100%;
      box-sizing: border-box;
    }
    .icon {
      font-size: 3rem;
      width: 3rem;
      height: 3rem;
      color: #cbd5e1;
      margin-bottom: 1rem;
    }
    .title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-2);
      margin: 0 0 0.5rem 0;
    }
    .description {
      font-size: 0.875rem;
      color: var(--text-faint);
      max-width: 300px;
      margin: 0;
    }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmptyStateComponent {
    @Input() icon: string = 'inbox';
    @Input({ required: true }) title!: string;
    @Input() description?: string;
}
