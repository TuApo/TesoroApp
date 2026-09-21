import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Pantalla, PantallaIn, Playlist, Servicio, TurnosService } from '../../service/turnos.service';

/** Los televisores de la sala: cómo se ven, qué cantan y qué publicidad circulan. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-pantallas',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, SelectorOficina],
  templateUrl: './pantallas.html',
  styleUrls: ['../../styles/turnos-comun.css', './pantallas.css'],
})
export class Pantallas implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);

  readonly pantallas = signal<Pantalla[]>([]);
  readonly playlists = signal<Playlist[]>([]);
  readonly servicios = signal<Servicio[]>([]);
  readonly formAbierto = signal(false);
  readonly editando = signal<string | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly qrGrande = signal<Pantalla | null>(null);

  form: PantallaIn & { servicios: string[]; playlists: string[] } = this.vacio();

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.cargar(id));
    });
  }

  ngOnInit(): void { this.ctx.cargar(); }

  nueva(): void { this.form = this.vacio(); this.editando.set(null); this.formAbierto.set(true); }

  editar(p: Pantalla): void {
    this.form = { nombre: p.nombre, layout: p.layout, orientacion: p.orientacion, turnos_visibles: p.turnos_visibles,
      mostrar_reloj: p.mostrar_reloj, mostrar_croquis: p.mostrar_croquis, sonido: p.sonido, voz: p.voz, voz_plantilla: p.voz_plantilla,
      tema: p.tema, activa: p.activa, servicios: [...p.servicios], playlists: [...p.playlists] };
    this.editando.set(p.id);
    this.formAbierto.set(true);
  }

  alternar(lista: 'servicios' | 'playlists', id: string): void {
    const l = this.form[lista];
    this.form[lista] = l.includes(id) ? l.filter(x => x !== id) : [...l, id];
  }

  guardar(): void {
    const of = this.ctx.oficinaId();
    if (!of) return;
    const id = this.editando();
    this.ocupado.set(true);
    this.error.set(null);
    (id ? this.api.actualizarPantalla(id, this.form) : this.api.crearPantalla(of, this.form)).subscribe({
      next: () => { this.ocupado.set(false); this.formAbierto.set(false); this.aviso.set(id ? 'Pantalla actualizada' : 'Pantalla creada'); this.cargar(of); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  rotar(p: Pantalla): void {
    if (!confirm(`Rotar el código de "${p.nombre}" invalida el enlace actual: habrá que abrir el televisor con el nuevo. ¿Continuar?`)) return;
    this.api.rotarCodigoPantalla(p.id).subscribe({ next: () => this.cargar(this.ctx.oficinaId()), error: () => {} });
  }

  desactivar(p: Pantalla): void {
    if (!confirm(`¿Desactivar la pantalla "${p.nombre}"? El televisor dejará de responder.`)) return;
    this.api.desactivarPantalla(p.id).subscribe({ next: () => this.cargar(this.ctx.oficinaId()), error: () => {} });
  }

  abrir(p: Pantalla): void { window.open(p.url, '_blank', 'noopener'); }

  copiar(p: Pantalla): void {
    navigator.clipboard?.writeText(p.url).then(() => { this.aviso.set('Enlace copiado'); setTimeout(() => this.aviso.set(null), 2000); });
  }

  nombrePlaylist(id: string): string { return this.playlists().find(p => p.id === id)?.nombre ?? id; }

  /** De dónde sale el diseño que reproduce la pantalla (ver Diseño de pantallas). */
  origenDiseno(o: string | null | undefined): string {
    return o === 'PANTALLA' ? 'asignado a esta pantalla' : o === 'OFICINA' ? 'guion de la oficina' : o === 'GLOBAL' ? 'guion global' : '';
  }

  private cargar(id: string | null): void {
    if (!id) { this.pantallas.set([]); return; }
    this.api.pantallas(id).subscribe({ next: p => this.pantallas.set(p), error: () => this.pantallas.set([]) });
    this.api.playlists(id).subscribe({ next: p => this.playlists.set(p), error: () => this.playlists.set([]) });
    this.api.servicios(id).subscribe({ next: s => this.servicios.set(s.filter(x => x.activo)), error: () => this.servicios.set([]) });
  }

  private vacio(): PantallaIn & { servicios: string[]; playlists: string[] } {
    return { nombre: '', layout: 'TURNOS_MEDIA', orientacion: 'HORIZONTAL', turnos_visibles: 5, mostrar_reloj: true, mostrar_croquis: false,
      sonido: true, voz: true, voz_plantilla: 'Turno {codigo}, diríjase a {punto}', tema: 'OSCURO', activa: true, servicios: [], playlists: [] };
  }
}
