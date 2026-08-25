import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  CampoPlantilla, EnvioCorreosService, ModoDocumento, PeriodoDisponible,
  Plantilla, PreviewCorreo,
} from '../../service/envio-correos/envio-correos.service';

/** Lo que se está editando. `id` null = plantilla nueva. */
interface Borrador {
  id: number | null;
  nombre: string;
  empresa: string | null;
  tipo: string | null;
  asunto: string;
  cuerpo_html: string;
  modo_documento: ModoDocumento;
  activo: boolean;
  destacada: boolean;
}

/**
 * Nómina → Envío de correos (modelo antiguo) → Plantillas.
 *
 * Gestor de las plantillas del correo: crear, editar, destacar y previsualizar.
 *
 * <h3>Por qué un editor de HTML crudo y no un editor visual</h3>
 * Las plantillas reales vienen de Stripo: 30-40 KB de HTML con CSS embebido,
 * comentarios condicionales de Outlook y tablas anidadas. Cualquier editor
 * visual las reescribe al guardarlas y las rompe. Aquí se pega el HTML tal
 * cual y se comprueba en la vista previa, que es como se trabaja con correo.
 */
@Component({
  selector: 'app-envio-correos-plantillas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule,
    MatExpansionModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressBarModule, MatSelectModule, MatTooltipModule,
  ],
  templateUrl: './envio-correos-plantillas.component.html',
  styleUrl: './envio-correos-plantillas.component.css',
})
export class EnvioCorreosPlantillasComponent implements OnInit {
  private srv = inject(EnvioCorreosService);
  private titulo = inject(Title);
  private sanitizer = inject(DomSanitizer);

  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly plantillas = signal<Plantilla[]>([]);
  readonly campos = signal<CampoPlantilla[]>([]);
  readonly periodos = signal<PeriodoDisponible[]>([]);
  readonly preview = signal<PreviewCorreo | null>(null);

  readonly borrador = signal<Borrador | null>(null);
  /** Quincena con la que se renderiza la vista previa. */
  readonly periodoPreview = signal<string | null>(null);

  readonly destacadas = computed(() => this.plantillas().filter((p) => p.destacada));
  readonly resto = computed(() => this.plantillas().filter((p) => !p.destacada));

  readonly previewHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.preview()?.cuerpo_html ?? ''));

  /** true si el cuerpo trae placeholders que el motor no conoce. */
  readonly placeholdersDesconocidos = computed<string[]>(() => {
    const b = this.borrador();
    if (!b) return [];
    const conocidos = new Set(this.campos().map((c) => c.campo.replace(/[{}]/g, '')));
    const usados = new Set<string>();
    for (const m of `${b.asunto} ${b.cuerpo_html}`.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
      if (!conocidos.has(m[1])) usados.add(m[1]);
    }
    return [...usados];
  });

  async ngOnInit(): Promise<void> {
    this.titulo.setTitle('Plantillas de correo | Envío de correos (modelo antiguo)');
    await this.recargar();
  }

  private async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [plantillas, campos, periodos] = await Promise.all([
        firstValueFrom(this.srv.plantillas()),
        firstValueFrom(this.srv.camposPlantilla()),
        firstValueFrom(this.srv.periodos()),
      ]);
      this.plantillas.set(plantillas.content);
      this.campos.set(campos.content);
      this.periodos.set(periodos.content);
      if (!this.periodoPreview() && periodos.content.length) {
        this.periodoPreview.set(periodos.content[0].clave);
      }
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudieron cargar las plantillas.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Edición ───────────────────────────────────────────────────────────────

  nueva(): void {
    this.borrador.set({
      id: null, nombre: '', empresa: null, tipo: null,
      asunto: '{{nombre}}, te enviamos tu desprendible de {{quincena}}',
      cuerpo_html: '<p>Hola <b>{{nombre}}</b>, adjuntamos tu documento de {{quincena}}.</p>',
      modo_documento: 'ADJUNTO', activo: true, destacada: false,
    });
    this.preview.set(null);
  }

  editar(p: Plantilla): void {
    this.borrador.set({
      id: p.id, nombre: p.nombre, empresa: p.empresa, tipo: p.tipo,
      asunto: p.asunto, cuerpo_html: p.cuerpo_html,
      modo_documento: p.modo_documento, activo: p.activo, destacada: p.destacada,
    });
    this.preview.set(null);
    this.previsualizar();
  }

  /** Copia una plantilla existente: la forma habitual de crear una variante. */
  duplicar(p: Plantilla): void {
    this.borrador.set({
      id: null, nombre: `${p.nombre} (copia)`, empresa: p.empresa, tipo: p.tipo,
      asunto: p.asunto, cuerpo_html: p.cuerpo_html,
      modo_documento: p.modo_documento, activo: true, destacada: false,
    });
    this.preview.set(null);
  }

  cerrarEditor(): void {
    this.borrador.set(null);
    this.preview.set(null);
  }

  actualizar<K extends keyof Borrador>(campo: K, valor: Borrador[K]): void {
    this.borrador.update((b) => (b ? { ...b, [campo]: valor } : b));
  }

  async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    if (!b.nombre.trim()) { this.error('Ponle un nombre a la plantilla.'); return; }

    if (this.placeholdersDesconocidos().length) {
      const c = await Swal.fire({
        icon: 'warning',
        title: 'Hay campos que el sistema no conoce',
        html: `<code>${this.placeholdersDesconocidos().map((x) => '{{' + x + '}}').join('</code> <code>')}</code>
               <br><br>Se enviarán <b>tal cual</b> en el correo, sin sustituir.
               Revisa que no sean erratas.`,
        showCancelButton: true,
        confirmButtonText: 'Guardar igual',
        cancelButtonText: 'Volver a revisar',
      });
      if (!c.isConfirmed) return;
    }

    this.guardando.set(true);
    try {
      await firstValueFrom(this.srv.guardarPlantilla(b.id, {
        nombre: b.nombre.trim(),
        empresa: b.empresa,
        tipo: b.tipo,
        asunto: b.asunto,
        cuerpo_html: b.cuerpo_html,
        modo_documento: b.modo_documento,
        activo: b.activo,
        destacada: b.destacada,
      }));
      await this.recargar();
      this.cerrarEditor();
      Swal.fire({ icon: 'success', title: 'Plantilla guardada', timer: 1600, showConfirmButton: false });
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo guardar la plantilla.');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Destacar / activar ────────────────────────────────────────────────────

  async alternarDestacada(p: Plantilla): Promise<void> {
    try {
      await firstValueFrom(this.srv.destacarPlantilla(p.id, !p.destacada));
      await this.recargar();
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo cambiar la plantilla.');
    }
  }

  async alternarActiva(p: Plantilla): Promise<void> {
    try {
      await firstValueFrom(this.srv.activarPlantilla(p.id, !p.activo));
      await this.recargar();
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo cambiar la plantilla.');
    }
  }

  // ── Vista previa ──────────────────────────────────────────────────────────

  /**
   * Renderiza el borrador SIN guardarlo, con una persona real de la quincena.
   * Es lo que permite pegar 40 KB de Stripo y ver si sobrevivió antes de que
   * lo reciba nadie.
   */
  async previsualizar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    try {
      this.preview.set(await firstValueFrom(this.srv.previewPlantilla({
        asunto: b.asunto,
        cuerpo_html: b.cuerpo_html,
        modo_documento: b.modo_documento,
        periodo_clave: this.periodoPreview(),
        empresa: b.empresa,
        tipo: b.tipo,
      })));
    } catch (e: any) {
      this.error(e?.error?.error ?? 'No se pudo generar la vista previa.');
    }
  }

  /** Inserta un placeholder al final del cuerpo, para no teclearlo a mano. */
  insertarCampo(campo: string): void {
    this.borrador.update((b) => (b ? { ...b, cuerpo_html: b.cuerpo_html + ' ' + campo } : b));
  }

  nombreEmpresa(v: string | null): string {
    if (v === 'APOYO_LABORAL') return 'Apoyo Laboral';
    if (v === 'ALIANZA') return 'Tu Alianza';
    return 'Todas';
  }

  nombreTipo(v: string | null): string {
    if (v === 'NOMINA') return 'Nómina';
    if (v === 'LIQUIDACION') return 'Liquidación';
    return 'Todos';
  }

  private error(mensaje: string): void {
    Swal.fire({ icon: 'error', title: 'Error', text: mensaje });
  }
}
