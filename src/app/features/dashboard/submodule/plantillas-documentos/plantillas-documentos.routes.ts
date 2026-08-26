import { Routes } from '@angular/router';
import { CatalogoComponent } from './pages/catalogo/catalogo.component';

export const routes: Routes = [
  { path: '', component: CatalogoComponent, data: { title: 'Documentos parametrizables' } },
  {
    path: ':id',
    loadComponent: () => import('./pages/editor/editor.component').then(m => m.EditorComponent),
    data: { title: 'Configurar documento' },
  },
];
