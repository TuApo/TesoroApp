import { Routes } from '@angular/router';
import { BugDashboardComponent } from './pages/bug-dashboard/bug-dashboard.component';
import { TicketsListComponent } from './pages/tickets-list/tickets-list.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: BugDashboardComponent },
  { path: 'tickets', component: TicketsListComponent },
  { path: 'bugs', redirectTo: 'tickets', pathMatch: 'full' },
];
