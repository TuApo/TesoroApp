import { Routes } from '@angular/router';
import { CompanyDocsAccessComponent } from './pages/company-docs-access/company-docs-access.component';
import { CreateDocStructureComponent } from './pages/create-doc-structure/create-doc-structure.component';
import { SearchDocumentsComponent } from './pages/search-documents/search-documents.component';
import { UploadDocumentsComponent } from './pages/upload-documents/upload-documents.component';
import { RetencionComponent } from './pages/retencion/retencion.component';

export const routes: Routes = [
  { path: '', redirectTo: 'company-docs-access', pathMatch: 'full' },
  { path: 'company-docs-access', component: CompanyDocsAccessComponent },
  { path: 'create-doc-structure', component: CreateDocStructureComponent },
  { path: 'search-documents', component: SearchDocumentsComponent },
  // La ruta del menú no cambia: lo que cambia es la pantalla que sirve. La mesa
  // carga en diferido porque arrastra el visor de PDF (pdf.js), que pesa más que
  // todo el resto del submódulo junto y no hace falta hasta que alguien entra.
  {
    path: 'upload-documents',
    loadComponent: () => import('./pages/ingesta/ingesta.component').then(m => m.IngestaComponent),
  },
  // La pantalla anterior sigue accesible mientras la mesa se asienta en campo:
  // si algo no cuadra, el personal tiene a dónde volver sin esperar un despliegue.
  { path: 'upload-documents-clasico', component: UploadDocumentsComponent },
  { path: 'withholding-table', component: RetencionComponent }
];
