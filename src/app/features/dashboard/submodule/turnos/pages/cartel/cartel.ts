import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { CroquisSvg, leerPisos } from '../../components/croquis-svg/croquis-svg';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Cartel, CartelImprimible, CartelIn, Croquis, PisoCroquis, PlantillaCartel, TurnosService } from '../../service/turnos.service';

/**
 * El cartel estándar de la oficina: croquis, código, trámites y QR, en una hoja lista para
 * imprimir y pegar. Lo que se ve en la vista previa es lo que sale por la impresora
 * (@media print oculta el resto de la aplicación).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-cartel',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorOficina, CroquisSvg],
  templateUrl: './cartel.html',
  styleUrls: ['../../styles/turnos-comun.css', './cartel.css'],
})
export class CartelImprimiblePage implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  private api = inject(TurnosService);

  readonly carteles = signal<Cartel[]>([]);
  readonly vigente = signal<Cartel | null>(null);
  readonly hoja = signal<CartelImprimible | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  form: CartelIn = this.vacio();
  readonly PLANTILLAS: { v: PlantillaCartel; n: string }[] = [
    { v: 'A4_VERTICAL', n: 'A4 vertical' }, { v: 'A4_HORIZONTAL', n: 'A4 horizontal' },
    { v: 'CARTA_VERTICAL', n: 'Carta vertical' }, { v: 'MEDIA_CARTA', n: 'Media carta' }, { v: 'ADHESIVO_10X15', n: 'Adhesivo 10×15' },
  ];

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.cargar(id));
    });
  }

  ngOnInit(): void { this.ctx.cargar(); }

  guardar(): void {
    const id = this.ctx.oficinaId();
    if (!id) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.api.guardarCartel(id, this.form).subscribe({
      next: c => { this.ocupado.set(false); this.aviso.set(`Cartel guardado (v${c.version})`); this.cargar(id); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  imprimir(): void {
    const c = this.vigente();
    if (!c) return;
    // Marcar como impreso es lo que hace que el siguiente cambio nazca como versión nueva
    // (hay copias circulando con este código).
    this.api.marcarImpreso(c.id).subscribe({ next: () => {}, error: () => {} });
    setTimeout(() => window.print(), 150);
  }

  pisosDe(c: Croquis): PisoCroquis[] { return leerPisos(c); }

  verVersion(c: Cartel): void {
    this.api.cartelImprimible(c.id).subscribe({ next: h => { this.hoja.set(h); this.vigente.set(c); }, error: () => {} });
  }

  private cargar(id: string | null): void {
    if (!id) { this.carteles.set([]); this.vigente.set(null); this.hoja.set(null); return; }
    this.api.carteles(id).subscribe({
      next: lista => {
        this.carteles.set(lista);
        const v = lista.find(c => c.vigente) ?? null;
        this.vigente.set(v);
        if (v) {
          this.form = { titulo: v.titulo, subtitulo: v.subtitulo, plantilla: v.plantilla, mostrar_croquis: v.mostrar_croquis,
            mostrar_qr: v.mostrar_qr, mostrar_servicios: v.mostrar_servicios, instrucciones: v.instrucciones, pie: v.pie, croquis_id: v.croquis_id };
          this.api.cartelImprimible(v.id).subscribe({ next: h => this.hoja.set(h), error: () => this.hoja.set(null) });
        } else {
          this.form = this.vacio();
          this.hoja.set(null);
        }
      },
      error: () => this.carteles.set([]),
    });
  }

  private vacio(): CartelIn {
    return { titulo: 'Tome su turno', subtitulo: 'Escanee el código o pida su turno en recepción', plantilla: 'A4_VERTICAL',
      mostrar_croquis: true, mostrar_qr: true, mostrar_servicios: true,
      instrucciones: '1. Escanee el QR con la cámara de su celular.\n2. Elija el trámite y tome su turno.\n3. Espere a que la pantalla lo llame y diríjase al módulo indicado.',
      pie: 'TuApo · Tu aliado en el trabajo' };
  }
}
