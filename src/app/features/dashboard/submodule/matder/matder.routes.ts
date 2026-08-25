import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard-page/dashboard-page.component').then(m => m.MatderDashboardPageComponent),
  },
  {
    path: 'workspaces',
    loadComponent: () => import('./pages/workspaces-page/workspaces-page.component').then(m => m.WorkspacesPageComponent),
  },
  {
    path: 'workspaces/:id',
    loadComponent: () => import('./pages/workspaces-page/workspaces-page.component').then(m => m.WorkspacesPageComponent),
  },
  {
    path: 'boards',
    loadComponent: () => import('./pages/boards-page/boards-page.component').then(m => m.BoardsPageComponent),
  },
  {
    path: 'boards/:boardId',
    loadComponent: () => import('./pages/board-preview-page/board-preview-page.component').then(m => m.BoardPreviewPageComponent),
  },
  {
    path: 'calendar',
    loadComponent: () => import('./pages/calendar-page/calendar-page.component').then(m => m.CalendarPageComponent),
  },
  {
    path: 'favorites',
    loadComponent: () => import('./pages/favorites-page/favorites-page.component').then(m => m.FavoritesPageComponent),
  },
  {
    path: 'analytics',
    loadComponent: () => import('./pages/analytics-page/analytics-page.component').then(m => m.AnalyticsPageComponent),
  },
  {
    path: 'groups',
    loadComponent: () => import('./pages/groups-page/groups-page.component').then(m => m.GroupsPageComponent),
  },
  {
    // La bandeja dejó de ser de Matder: ahora es /dashboard/novedades y recibe
    // avisos de cualquier módulo. Se conserva la ruta como redirección porque
    // hay notificaciones ya enviadas y menús que apuntan aquí.
    path: 'notifications',
    redirectTo: '/dashboard/novedades',
    pathMatch: 'full',
  },
  {
    path: 'import',
    loadComponent: () => import('./pages/import-page/import-page.component').then(m => m.ImportPageComponent),
  },
  {
    path: 'audit',
    loadComponent: () => import('./pages/audit-page/audit-page.component').then(m => m.AuditPageComponent),
  },
];
