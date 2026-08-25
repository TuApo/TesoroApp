import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

import { InformeTabComponent } from './informe-tab.component';
import { ChatTabComponent } from './chat-tab.component';
import { ChatSeed } from './chat-seed';

/**
 * Submódulo "Analítica Nómina IA": dos pestañas.
 *   • Informe IA → filtros + KPIs + anomalías + gráficas + informe redactado por IA.
 *   • Chat       → asistente conversacional con historial, carpetas y markdown.
 * El botón "Conversar este informe" del tab 1 siembra una conversación en el tab 2.
 */
@Component({
  selector: 'app-analitica-nomina-ia',
  standalone: true,
  imports: [CommonModule, MatTabsModule, MatIconModule, InformeTabComponent, ChatTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analitica-nomina-ia.component.html',
  styleUrls: ['./analitica-nomina-ia.component.css'],
})
export class AnaliticaNominaIaComponent {
  tab = signal<number>(0);
  chatSeed = signal<ChatSeed | null>(null);

  onEnviarAChat(seed: ChatSeed): void {
    this.chatSeed.set(seed);
    this.tab.set(1);
  }
}
