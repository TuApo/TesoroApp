import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { OrdenesService } from '../../ordenes/ordenes.service';
import {
  FlujoResumen, ICONO_PASO, ModeloIa, NOMBRE_PASO, Proveedores, TIPOS_ENTREGABLE, etiquetaTipo,
} from '../../ordenes/ordenes.models';

/**
 * Flujos de generacion con IA: que proveedores estan listos y como esta armado cada flujo.
 *
 * <p>Los pasos se editan como JSON a proposito: es la forma exacta que guarda el backend, y
 * el validador del servidor dice que paso esta mal ANTES de guardar. Un editor visual llegara
 * cuando se sepa que flujos se usan de verdad; hoy lo importante es poder iterar los prompts
 * sin desplegar.
 */
@Component({
  selector: 'app-mk-flujos',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './flujos.component.html',
  styleUrls: ['../../ordenes/ordenes-comun.css', './flujos.component.css'],
})
export class FlujosComponent implements OnInit {
  private readonly api = inject(OrdenesService);

  readonly tipos = TIPOS_ENTREGABLE;
  readonly iconoPaso = ICONO_PASO;
  readonly nombrePaso = NOMBRE_PASO;
  readonly etiquetaTipo = etiquetaTipo;
  readonly entradas = ['NINGUNA', 'IMAGEN', 'VIDEO', 'AUDIO', 'DOCUMENTO', 'CUALQUIERA'];

  readonly cargando = signal(true);
  readonly flujos = signal<FlujoResumen[]>([]);
  readonly proveedores = signal<Proveedores | null>(null);
  readonly modelos = signal<ModeloIa[]>([]);
  readonly editando = signal<FlujoResumen | null>(null);
  readonly esNuevo = signal(false);
  readonly problemas = signal<string[]>([]);
  readonly guardando = signal(false);
  readonly esAdmin = signal(true);

  // formulario
  codigo = '';
  nombre = '';
  descripcion = '';
  tipoEntregable = 'VIDEO';
  entrada = 'NINGUNA';
  activo = true;
  experimental = false;
  pasosTexto = '';

  ngOnInit(): void {
    this.cargar();
    this.api.proveedores().subscribe({ next: (p) => this.proveedores.set(p), error: () => {} });
    this.api.modelos().subscribe({ next: (m) => this.modelos.set(m), error: () => {} });
  }

  cargar(): void {
    this.api.flujos(true).subscribe({
      next: (f) => { this.flujos.set(f); this.cargando.set(false); },
      error: () => { this.cargando.set(false); Swal.fire({ icon: 'error', title: 'No se pudieron cargar los flujos' }); },
    });
  }

  abrir(f: FlujoResumen): void {
    this.api.flujo(f.id).subscribe({
      next: (d) => {
        this.esNuevo.set(false);
        this.codigo = d.codigo; this.nombre = d.nombre; this.descripcion = d.descripcion ?? '';
        this.tipoEntregable = d.tipo_entregable; this.entrada = d.entrada; this.activo = d.activo;
        this.experimental = d.experimental;
        this.pasosTexto = JSON.stringify(d.pasos ?? [], null, 2);
        this.problemas.set([]);
        this.editando.set(d);
      },
    });
  }

  nuevo(): void {
    this.esNuevo.set(true);
    this.codigo = ''; this.nombre = ''; this.descripcion = ''; this.tipoEntregable = 'PDF'; this.entrada = 'NINGUNA';
    this.activo = true; this.experimental = true;
    this.pasosTexto = JSON.stringify([
      { clave: 'contenido', tipo: 'IA_TEXTO', titulo: 'Redactar', config: {
        formato: 'html', system: 'Eres redactor editorial.', max_tokens: 16000,
        prompt: 'Marca: {{marca.nombre}}. Tono: {{marca.tono}}\nPedido: {{orden.titulo}}\nBrief: {{orden.brief}}\nVersion anterior: {{base.texto}}\nCambios: {{instrucciones}}' } },
      { clave: 'pdf', tipo: 'RENDER_PDF', titulo: 'PDF', resultado: true, config: { html: '{{pasos.contenido.html}}', tamano: 'A4', nombre: 'documento' } },
    ], null, 2);
    this.problemas.set([]);
    this.editando.set({ id: '', codigo: '', nombre: '' } as FlujoResumen);
  }

  private pasos(): unknown | null {
    try {
      return JSON.parse(this.pasosTexto);
    } catch (e) {
      this.problemas.set(['El JSON no es válido: ' + (e as Error).message]);
      return null;
    }
  }

  validar(): void {
    const p = this.pasos();
    if (p === null) return;
    this.api.validarFlujo(p).subscribe({
      next: (r) => {
        this.problemas.set(r.problemas);
        if (r.valido) Swal.fire({ icon: 'success', title: 'El flujo es válido',
          text: r.faltantes.length ? 'Para correr le falta: ' + r.faltantes.join(' ') : '', timer: 2200, showConfirmButton: !!r.faltantes.length });
      },
    });
  }

  guardar(): void {
    const p = this.pasos();
    if (p === null) return;
    const f = this.editando();
    this.guardando.set(true);
    this.api.guardarFlujo(this.esNuevo() ? null : f!.id, {
      codigo: this.codigo, nombre: this.nombre, descripcion: this.descripcion, tipo_entregable: this.tipoEntregable,
      entrada: this.entrada, activo: this.activo, experimental: this.experimental, pasos: p,
    } as Partial<FlujoResumen> & { pasos: unknown }).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.editando.set(null);
        this.cargar();
        Swal.fire({ icon: 'success', title: 'Flujo guardado', text: `Versión ${r.version}`, timer: 1500, showConfirmButton: false });
      },
      error: (e) => {
        this.guardando.set(false);
        if (e?.status === 403) this.esAdmin.set(false);
        const msg: string = e?.error?.error ?? 'No se pudo guardar';
        this.problemas.set(msg.replace(/^El flujo tiene errores: /, '').split(' | '));
      },
    });
  }

  duplicar(f: FlujoResumen): void {
    this.api.duplicarFlujo(f.id).subscribe({
      next: (c) => { this.cargar(); this.abrir(c); },
      error: (e) => Swal.fire({ icon: 'error', title: 'No se pudo duplicar', text: e?.error?.error ?? '' }),
    });
  }

  copiar(texto: string): void {
    navigator.clipboard?.writeText(texto).then(
      () => Swal.fire({ icon: 'success', title: 'Copiado', timer: 900, showConfirmButton: false }),
      () => {});
  }
}
