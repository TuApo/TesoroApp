import { Routes } from '@angular/router';
import { AbsencesComponent } from './pages/absences/absences.component';
import { BannedManagementComponent } from './pages/banned-management/banned-management.component';
import { BannedReportComponent } from './pages/banned-report/banned-report.component';
import { HiringReportComponent } from './pages/hiring-report/hiring-report.component';
import { QueryFormComponent } from './pages/query-form/query-form.component';
import { RecruitmentPipelineComponent } from './pages/recruitment-pipeline/recruitment-pipeline.component';
import { ViewReportsComponent } from './pages/view-reports/view-reports.component';
import { GenerateContractingDocumentsComponent } from './components/generate-contracting-documents/generate-contracting-documents.component';
import { ViewReceptionInterviewsComponent } from './pages/view-reception-interviews/view-reception-interviews.component';
import { ErrorListingComponent } from './pages/error-listing/error-listing.component';
import { ConsultContractingDocumentationComponent } from './pages/consult-contracting-documentation/consult-contracting-documentation.component';
import { TarjetasComponent } from './pages/tarjetas/tarjetas.component';
import { AbsencesNew } from './pages/absences-new/absences-new';
import { ManageContractsComponent } from './pages/manage-contracts/manage-contracts.component';

export const routes: Routes = [
  { path: '', redirectTo: 'absences', pathMatch: 'full' },
  { path: 'absences', component: AbsencesComponent },
  // Pedido #8: reporte de presentados (aplica / no aplica / en espera). Carga diferida.
  { path: 'reporte-presentados', loadComponent: () => import('./pages/reporte-presentados/reporte-presentados.component').then((m) => m.ReportePresentadosComponent) },
  // Estado de candidatos (16-oct-2026): en espera, rechazados y contratados con su estadística.
  { path: 'estado-candidatos', loadComponent: () => import('./pages/estado-candidatos/estado-candidatos.component').then((m) => m.EstadoCandidatosComponent) },
  { path: 'hiring-report', component: HiringReportComponent },
  { path: 'recruitment-pipeline', component: RecruitmentPipelineComponent },
  // Pedido #11: carga masiva de exámenes médicos (PDF por persona o ZIP). Carga diferida.
  { path: 'consulta-antecedentes', loadComponent: () => import('./pages/consulta-antecedentes/consulta-antecedentes.component').then((m) => m.ConsultaAntecedentesComponent) },
  { path: 'examenes-masivos', loadComponent: () => import('./pages/examenes-masivos/examenes-masivos.component').then((m) => m.ExamenesMasivosComponent) },
  { path: 'generate-contracting-documents/:numeroDocumento', component: GenerateContractingDocumentsComponent },
  { path: 'query-form', component: QueryFormComponent },
  { path: 'banned-report', component: BannedReportComponent },
  { path: 'banned-management', component: BannedManagementComponent },
  { path: 'view-reports', component: ViewReportsComponent },
  { path: 'view-reception-interviews', component: ViewReceptionInterviewsComponent },
  { path: 'error-listing', component: ErrorListingComponent },
  { path: 'consult-contracting-documentation', component: ConsultContractingDocumentationComponent },
  { path: 'tarjetas', component: TarjetasComponent },
  { path: 'absences-new', component: AbsencesNew },
  { path: 'manage-contracts', component: ManageContractsComponent }
];
