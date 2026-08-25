import { Injectable } from '@angular/core';

export interface MatderHistoryItem {
  type: 'workspace' | 'board';
  id: number;
  name: string;
  subtitle?: string;
  accent?: string;
  visitedAt: string;
}

const KEY = 'matder-history-v1';
const MAX = 8;

@Injectable({ providedIn: 'root' })
export class MatderHistoryService {

  getAll(): MatderHistoryItem[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  push(item: Omit<MatderHistoryItem, 'visitedAt'>): void {
    const all = this.getAll().filter(x => !(x.type === item.type && x.id === item.id));
    const next: MatderHistoryItem = { ...item, visitedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify([next, ...all].slice(0, MAX)));
  }

  getRecent(limit = 6): MatderHistoryItem[] {
    return this.getAll().slice(0, limit);
  }

  timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.floor(h / 24)} d`;
  }
}
