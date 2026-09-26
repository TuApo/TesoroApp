import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { AgendaPublica, Cita, Franja, Servicio, TurnosService } from '../../dashboard/submodule/turnos/service/turnos.service';

/**
 * Agendar una cita desde el celular o el computador, sin sesión: aspirantes a un proceso
 * y empleados que vienen a un trámite. Trámite → día → hora → datos → comprobante con el
 * enlace para anunciarse al llegar. Si el trámite es de selección, el comprobante avisa si
 * el formulario de vacantes está sin llenar y da el enlace para completarlo antes.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-agendar-cita',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './agendar.html',
  styleUrls: ['../tomar-turno/tomar-turno.css', './agendar.css'],
})
export class AgendarCita implements OnInit {
  readonly codigo = input<string>();

  private api = inject(TurnosService);
  private router = inject(Router);

  readonly agenda = signal<AgendaPublica | null>(null);
  readonly error = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly paso = signal<'codigo' | 'servicio' | 'fecha' | 'datos' | 'listo'>('codigo');
  readonly elegido = signal<Servicio | null>(null);
  readonly franjas = signal<Franja[]>([]);
  readonly mensajeDia = signal<string | null>(null);
  readonly franja = signal<Franja | null>(null);
  readonly enviando = signal(false);
  readonly cita = signal<Cita | null>(null);

  codigoManual = '';
  fecha = '';
  form = { documento: '', nombre: '', telefono: '', correo: '' };

  readonly franjasLibres = computed(() => this.franjas().filter(f => f.disponible));
  readonly minFecha = computed(() => this.agenda()?.desde ?? new Date().toISOString().slice(0, 10));
  readonly maxFecha = computed(() => this.agenda()?.hasta ?? '');

  ngOnInit(): void {
    const c = this.codigo();
    if (c) this.cargar(c);
  }

  buscar(): void {
    const c = this.codigoManual.trim().toUpperCase();
    if (!c) return;
    this.router.navigate(['/agendar', c]);
    this.cargar(c);
  }

  private cargar(c: string): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.publicoAgenda(c).subscribe({
      next: a => {
        this.agenda.set(a);
        this.cargando.set(false);
        this.paso.set('servicio');
        if (!a.agenda_abierta) this.error.set('Esta oficina todavía no da citas por la web. Puede tomar turno al llegar.');
      },
      error: e => { this.cargando.set(false); this.error.set(e?.status === 404 ? 'Ese código no corresponde a ninguna oficina.' : 'No se pudo conectar. Intente de nuevo.'); },
    });
  }

  elegir(s: Servicio): void {
    this.elegido.set(s);
    this.franja.set(null);
    this.paso.set('fecha');
    if (!this.fecha) this.fecha = this.primerDiaConAgenda();
    this.cargarFranjas();
  }

  /** El primer día (desde hoy) que la agenda atiende, para que el calendario arranque con horas. */
  private primerDiaConAgenda(): string {
    const dias = this.agenda()?.dias || '12345';
    const d = new Date();
    for (let i = 0; i < 14; i++) {
      const iso = ((d.getDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
      if (dias.includes(String(iso))) return d.toISOString().slice(0, 10);
      d.setDate(d.getDate() + 1);
    }
    return new Date().toISOString().slice(0, 10);
  }

  cargarFranjas(): void {
    const c = this.codigo() ?? this.codigoManual.trim().toUpperCase();
    const s = this.elegido();
    if (!c || !s || !this.fecha) { this.franjas.set([]); return; }
    this.cargando.set(true);
    this.franja.set(null);
    this.api.publicoDisponibilidad(c, s.id, this.fecha).subscribe({
      next: d => { this.franjas.set(d.franjas); this.mensajeDia.set(d.mensaje); this.cargando.set(false); },
      error: () => { this.franjas.set([]); this.mensajeDia.set('No se pudo consultar la agenda'); this.cargando.set(false); },
    });
  }

  elegirFranja(f: Franja): void {
    if (!f.disponible) return;
    this.franja.set(f);
    this.paso.set('datos');
  }

  agendar(): void {
    const c = this.codigo() ?? this.codigoManual.trim().toUpperCase();
    const s = this.elegido();
    const f = this.franja();
    if (!c || !s || !f) return;
    if (!this.form.documento.trim()) { this.error.set('Escriba su número de cédula: es como lo reconocemos al llegar.'); return; }
    this.enviando.set(true);
    this.error.set(null);
    this.api.publicoAgendar(c, {
      servicio_id: s.id, fecha_hora: f.inicio,
      documento: this.form.documento.trim(), nombre: this.form.nombre.trim() || null,
      telefono: this.form.telefono.trim() || null, correo: this.form.correo.trim() || null,
    }).subscribe({
      next: cita => {
        this.cita.set(cita);
        this.enviando.set(false);
        this.paso.set('listo');
        try { localStorage.setItem('tuapo.turno.ultimo', cita.turno.id); } catch { /* sin storage */ }
      },
      error: e => { this.enviando.set(false); this.error.set(e?.error?.message || 'No se pudo agendar la cita'); },
    });
  }

  fechaLarga(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  irASeguimiento(): void {
    const c = this.cita();
    if (c) this.router.navigate(['/t/seguimiento', c.turno.id]);
  }
}
