import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Cola, TurnosService } from '../../service/turnos.service';
import { PermissionsService } from '../../../../../../core/services/permissions.service';

interface Atajo { ruta: string; icono: string; titulo: string; ayuda: string; soloAdmin?: boolean; }

/**
 * Entrada del módulo: cómo va la sala HOY de la oficina elegida y a dónde ir.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-home',
  imports: [CommonModule, MatIconModule, SelectorOficina],
  templateUrl: './home.html',
  styleUrls: ['../../styles/turnos-comun.css', './home.css'],
})
export class TurnosHome implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);
  private router = inject(Router);
  private permisos = inject(PermissionsService);

  readonly cola = signal<Cola | null>(null);
  readonly cargando = signal(false);

  readonly atajos: Atajo[] = [
    { ruta: 'atencion', icono: 'support_agent', titulo: 'Panel de atención', ayuda: 'Abrir puesto, llamar turnos y llevar varios casos a la vez' },
    { ruta: 'cola', icono: 'groups', titulo: 'Cola y recepción', ayuda: 'La sala ahora mismo; emitir turnos a mano' },
    { ruta: 'oficinas', icono: 'map', titulo: 'Oficinas y croquis', ayuda: 'El mapa de cada oficina, sus áreas y puntos', soloAdmin: true },
    { ruta: 'servicios', icono: 'list_alt', titulo: 'Servicios', ayuda: 'Trámites que reparten turnos: prefijo, área, prioridad', soloAdmin: true },
    { ruta: 'cartel', icono: 'print', titulo: 'Cartel imprimible', ayuda: 'La hoja estándar con croquis, código y QR', soloAdmin: true },
    { ruta: 'pantallas', icono: 'tv', titulo: 'Pantallas de sala', ayuda: 'Televisores que cantan el turno y circulan publicidad', soloAdmin: true },
    { ruta: 'publicidad', icono: 'campaign', titulo: 'Publicidad y cursos', ayuda: 'Piezas, vigencia, alcance y listas de reproducción', soloAdmin: true },
    { ruta: 'tablero', icono: 'insights', titulo: 'Tablero', ayuda: 'Esperas, atención por asesor y horas pico' },
    { ruta: 'casos', icono: 'folder_shared', titulo: 'Mis casos', ayuda: 'Historial de lo que he atendido' },
  ];

  readonly atajosVisibles = computed(() => this.atajos.filter(a =>
    (!a.soloAdmin || this.ctx.esAdmin()) && this.permisos.canReadRoute('/dashboard/turnos/' + a.ruta)));

  readonly totalEmitidos = computed(() => (this.cola()?.por_servicio ?? []).reduce((s, r) => s + (r.emitidos ?? 0), 0));
  readonly totalAtendidos = computed(() => (this.cola()?.por_servicio ?? []).reduce((s, r) => s + (r.atendidos ?? 0), 0));
  readonly esperaProm = computed(() => {
    const filas = (this.cola()?.por_servicio ?? []).filter(r => r.espera_prom_seg);
    if (!filas.length) return null;
    return Math.round(filas.reduce((s, r) => s + (r.espera_prom_seg ?? 0), 0) / filas.length / 60);
  });

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.cargarCola(id));
    });
  }

  ngOnInit(): void { this.ctx.cargar(); }

  ir(ruta: string): void { this.router.navigate(['/dashboard/turnos', ruta]); }

  private cargarCola(id: string | null): void {
    if (!id) { this.cola.set(null); return; }
    this.cargando.set(true);
    this.api.cola(id).subscribe({
      next: c => { this.cola.set(c); this.cargando.set(false); },
      error: () => { this.cola.set(null); this.cargando.set(false); },
    });
  }
}
