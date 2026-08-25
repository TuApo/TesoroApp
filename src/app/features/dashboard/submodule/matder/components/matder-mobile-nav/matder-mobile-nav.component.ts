import { Component, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';

interface NavItem { icon: string; label: string; path: string; }

@Component({
  selector: 'app-matder-mobile-nav',
  standalone: true,
  imports: [RouterModule, MatIconModule, MatRippleModule],
  templateUrl: './matder-mobile-nav.component.html',
  styleUrls: ['./matder-mobile-nav.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatderMobileNavComponent {
  readonly items: NavItem[] = [
    { icon: 'dashboard',          label: 'Inicio',       path: '/dashboard/matder/dashboard' },
    { icon: 'dashboard_customize',label: 'Tableros',     path: '/dashboard/matder/boards' },
    { icon: 'workspaces',         label: 'Workspaces',   path: '/dashboard/matder/workspaces' },
    { icon: 'calendar_month',     label: 'Calendario',   path: '/dashboard/matder/calendar' },
    { icon: 'notifications',      label: 'Novedades',    path: '/dashboard/novedades' },
  ];

  constructor(private router: Router) {}

  isActive(path: string): boolean {
    return this.router.url.startsWith(path);
  }

  go(path: string): void {
    this.router.navigate([path]);
  }
}
