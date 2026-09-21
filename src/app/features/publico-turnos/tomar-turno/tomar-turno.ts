import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { CartelImprimible, Servicio, TurnosService } from '../../dashboard/submodule/turnos/service/turnos.service';
import { CroquisSvg } from '../../dashboard/submodule/turnos/components/croquis-svg/croquis-svg';

/**
 * Tomar turno desde el celular, después de escanear el QR del cartel (o escribiendo el
 * código a mano). Sin sesión, pensado para una mano y un pulgar.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tomar-turno',
  imports: [CommonModule, FormsModule, MatIconModule, CroquisSvg],
  templateUrl: './tomar-turno.html',
  styleUrl: './tomar-turno.css',
})
export class TomarTurno implements OnInit {
  readonly codigo = input<string>();

  private api = inject(TurnosService);
  private router = inject(Router);

  readonly cartel = signal<CartelImprimible | null>(null);
  readonly servicios = signal<Servicio[]>([]);
  readonly error = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly paso = signal<'codigo' | 'servicio' | 'datos'>('codigo');
  readonly elegido = signal<Servicio | null>(null);
  readonly enviando = signal(false);
  readonly verMapa = signal(false);

  codigoManual = '';
  form = { documento: '', nombre: '', telefono: '' };

  readonly areaDelElegido = computed(() => this.elegido()?.area_id ?? null);

  ngOnInit(): void {
    const c = this.codigo();
    if (c) this.cargar(c);
  }

  buscar(): void {
    const c = this.codigoManual.trim().toUpperCase();
    if (!c) return;
    this.router.navigate(['/t', c]);
    this.cargar(c);
  }

  private cargar(c: string): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.publicoCartel(c).subscribe({
      next: h => {
        this.cartel.set(h);
        this.api.publicoServicios(c).subscribe({
          next: s => { this.servicios.set(s); this.cargando.set(false); this.paso.set('servicio'); },
          error: () => { this.cargando.set(false); this.error.set('No se pudieron cargar los trámites'); },
        });
      },
      error: e => { this.cargando.set(false); this.error.set(e?.status === 404 ? 'Ese código no corresponde a ninguna oficina. Revise el cartel.' : 'No se pudo conectar. Intente de nuevo.'); },
    });
  }

  elegir(s: Servicio): void { this.elegido.set(s); this.paso.set('datos'); }

  tomar(): void {
    const c = this.codigo() ?? this.codigoManual.trim().toUpperCase();
    const s = this.elegido();
    if (!c || !s) return;
    if (s.requiere_documento && !this.form.documento.trim()) { this.error.set('Este trámite requiere su número de cédula.'); return; }
    this.enviando.set(true);
    this.error.set(null);
    this.api.publicoTomarTurno(c, { servicio_id: s.id, documento: this.form.documento.trim() || null, nombre: this.form.nombre.trim() || null, telefono: this.form.telefono.trim() || null }).subscribe({
      next: t => {
        try { localStorage.setItem('tuapo.turno.ultimo', t.turno.id); } catch { /* sin storage */ }
        this.router.navigate(['/t/seguimiento', t.turno.id]);
      },
      error: e => { this.enviando.set(false); this.error.set(e?.error?.message || 'No se pudo tomar el turno'); },
    });
  }
}
