import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatderDashboardService } from '../../services/dashboard.service';
import { UserGroupResponse } from '../../models/dashboard.models';
import Swal from 'sweetalert2';
import { MatderMobileNavComponent } from '../../components/matder-mobile-nav/matder-mobile-nav.component';

@Component({
  selector: 'app-groups-page',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule,
    MatderMobileNavComponent
  
  
  ],
  templateUrl: './groups-page.component.html',
  styleUrls: ['./groups-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupsPageComponent implements OnInit {
  groups = signal<UserGroupResponse[]>([]);
  loading = signal(true);
  showForm = signal(false);
  fn = '';
  fd = '';
  // Edit
  editingId: number | null = null;
  editName = '';
  editDesc = '';

  constructor(private ds: MatderDashboardService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try { this.groups.set(await this.ds.getGroups()); }
    catch { this.groups.set([]); }
    finally { this.loading.set(false); }
  }

  async create(): Promise<void> {
    if (!this.fn.trim()) return;
    try {
      await this.ds.createGroup({ name: this.fn.trim(), description: this.fd.trim() || undefined });
      this.fn = '';
      this.fd = '';
      this.showForm.set(false);
      await this.load();
      Swal.fire('Creado', 'Grupo creado exitosamente.', 'success');
    } catch {
      Swal.fire('Error', 'No se pudo crear el grupo.', 'error');
    }
  }

  startEdit(g: UserGroupResponse): void {
    this.editingId = g.id;
    this.editName = g.name;
    this.editDesc = g.description ?? '';
  }

  cancelEdit(): void {
    this.editingId = null;
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId || !this.editName.trim()) return;
    try {
      await this.ds.updateGroup(this.editingId, { name: this.editName.trim(), description: this.editDesc.trim() || null } as any);
      this.editingId = null;
      await this.load();
    } catch {
      Swal.fire('Error', 'No se pudo actualizar.', 'error');
    }
  }

  async del(g: UserGroupResponse): Promise<void> {
    const c = await Swal.fire({
      title: `Eliminar "${g.name}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
    });
    if (c.isConfirmed) {
      try { await this.ds.deleteGroup(g.id); await this.load(); }
      catch { Swal.fire('Error', 'No se pudo eliminar.', 'error'); }
    }
  }

  nav(path: string): void {
    this.router.navigate([`/dashboard/matder/${path}`]);
  }
}
