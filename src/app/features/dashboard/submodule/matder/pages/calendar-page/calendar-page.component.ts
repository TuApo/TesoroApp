import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { BoardService } from '../../services/board.service';
import { CardSummary } from '../../models/board.models';
import { CardDetailDialogComponent } from '../../components/card-detail-dialog/card-detail-dialog.component';
import { MatderMobileNavComponent } from '../../components/matder-mobile-nav/matder-mobile-nav.component';

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatProgressSpinnerModule, MatTooltipModule, MatDialogModule,
    MatderMobileNavComponent
  
  
  ],
  templateUrl: './calendar-page.component.html',
  styleUrls: ['./calendar-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPageComponent implements OnInit {
  cards = signal<CardSummary[]>([]);
  loading = signal(true);
  search = '';
  priorityFilter = '';
  currentMonth = new Date();
  selectedDate: string | null = null;

  constructor(
    private boardService: BoardService,
    private router: Router,
    private dialog: MatDialog,
  ) {}

  /**
   * Abre el modal de detalle de una tarea. Al cerrar, recarga las cards
   * del calendario si hubo cambios (título, fecha, etc.) para que la
   * vista quede sincronizada.
   */
  openCardDetail(card: CardSummary): void {
    const ref = this.dialog.open(CardDetailDialogComponent, {
      width: '1040px', maxWidth: '96vw', maxHeight: '92vh',
      panelClass: 'matder-card-detail-panel',
      data: { cardId: card.id },
    });
    ref.afterClosed().subscribe(async (changed) => {
      if (changed) {
        try {
          this.cards.set(await this.boardService.getCalendarCards());
        } catch { /* ignore */ }
      }
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      this.cards.set(await this.boardService.getCalendarCards());
    } catch { /* empty */ }
    finally { this.loading.set(false); }
  }

  get filteredCards(): CardSummary[] {
    let result = this.cards();
    if (this.search) {
      const q = this.search.toLowerCase();
      result = result.filter(c => c.title.toLowerCase().includes(q));
    }
    if (this.priorityFilter) {
      result = result.filter(c => c.priority === this.priorityFilter);
    }
    return result;
  }

  get calendarDays(): { date: Date; day: number; isCurrentMonth: boolean; cards: CardSummary[] }[] {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const days: { date: Date; day: number; isCurrentMonth: boolean; cards: CardSummary[] }[] = [];

    // Previous month padding
    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, day: d.getDate(), isCurrentMonth: false, cards: [] });
    }

    // Current month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const dateStr = this.toDateStr(date);
      const dayCards = this.filteredCards.filter(c => c.due_at && c.due_at.substring(0, 10) === dateStr);
      days.push({ date, day: d, isCurrentMonth: true, cards: dayCards });
    }

    // Next month padding
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const date = new Date(year, month + 1, d);
        days.push({ date, day: d, isCurrentMonth: false, cards: [] });
      }
    }
    return days;
  }

  get agendaCards(): CardSummary[] {
    if (!this.selectedDate) return this.filteredCards;
    return this.filteredCards.filter(c => c.due_at && c.due_at.substring(0, 10) === this.selectedDate);
  }

  prevMonth(): void {
    const m = this.currentMonth;
    this.currentMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1);
  }

  nextMonth(): void {
    const m = this.currentMonth;
    this.currentMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  }

  selectDate(dateStr: string): void {
    this.selectedDate = this.selectedDate === dateStr ? null : dateStr;
  }

  toDateStr(d: Date): string {
    return d.toISOString().substring(0, 10);
  }

  isToday(d: Date): boolean {
    const today = new Date();
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  }

  prioColor(p: string): string {
    return ({ LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444', URGENT: '#7c3aed' } as Record<string, string>)[p] ?? '#9e9e9e';
  }

  statusLabel(s: string): string {
    return ({ TODO: 'Por hacer', IN_PROGRESS: 'En progreso', BLOCKED: 'Bloqueado', DONE: 'Hecho' } as Record<string, string>)[s] ?? s;
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }
}
