import { Routes } from '@angular/router';
import { GestionUsuariosComponent } from './pages/gestion-usuarios/gestion-usuarios.component';
import { GestionRolesComponent } from './pages/gestion-roles/gestion-roles.component';
import { GestionGruposComponent } from './pages/gestion-grupos/gestion-grupos.component';
import { GestionModulosComponent } from './pages/gestion-modulos/gestion-modulos.component';
import { GestionParametrizacionComponent } from './pages/gestion-parametrizacion/gestion-parametrizacion.component';
import { CambiarContrasenaComponent } from './pages/cambiar-contrasena/cambiar-contrasena.component';
import { CreacionUsuariosTrasladosComponent } from './pages/creacion-usuarios-traslados/creacion-usuarios-traslados.component';

export const routes: Routes = [
  { path: '', redirectTo: 'manage-users', pathMatch: 'full' },
  { path: 'manage-users', component: GestionUsuariosComponent },
  { path: 'manage-roles', component: GestionRolesComponent },
  { path: 'manage-groups', component: GestionGruposComponent },
  { path: 'manage-modules', component: GestionModulosComponent },
  { path: 'manage-parameterization', component: GestionParametrizacionComponent },
  { path: 'change-password', component: CambiarContrasenaComponent },
  { path: 'create-transfer-user', component: CreacionUsuariosTrasladosComponent },
];
