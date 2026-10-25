import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  Diseno, DisenadorService, EstadoDiseno, disenoOcupado, mensajeDeError,
} from '../../service/disenador.service';
import { PasoMaterial } from '../../components/disenador/paso-material';
import { PasoEntrevista } from '../../components/disenador/paso-entrevista';
import { PasoEstructura } from '../../components/disenador/paso-estructura';
import { PasoClases } from '../../components/disenador/paso-clases';
import { PasoCrear } from '../../components/disenador/paso-crear';
import { PasoMedios } from '../../components/disenador/paso-medios';

export type PasoId = 'material' | 'entrevista' | 'estructura' | 'clases' | 'medios' | 'crear';

interface Paso { id: PasoId; titulo: string; icono: string; }

/**
 * El diseñador de un curso, paso a paso.
 *
 * <p>La pantalla sigue al estado del diseño (abre en el paso donde va) pero deja volver a los
 * anteriores: subir otro archivo en plena entrevista o rehacer la estructura no pierde nada.
 * Mientras el servidor trabaja (leer material, pensar la pregunta, escribir clases) se consulta
 * el diseño cada 2 s y una banda arriba dice qué está haciendo; al terminar se deja de consultar.
 */
@Component({
  selector: 'app-disenador',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, PasoMaterial, PasoEntrevista, PasoEstructura, PasoClases, PasoMedios, PasoCrear],
  templateUrl: './disenador.html',
  styleUrl: './disenador.css',
})
export class Disenador implements OnInit {
  private api = inject(DisenadorService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly diseno = signal<Diseno | null>(null);
  readonly error = signal<string | null>(null);
  readonly paso = signal<PasoId>('material');
  readonly editandoTitulo = signal(false);
  tituloEditado = '';

  readonly pasos: Paso[] = [
    { id: 'material', titulo: 'Material', icono: 'upload_file' },
    { id: 'entrevista', titulo: 'Entrevista', icono: 'forum' },
    { id: 'estructura', titulo: 'Estructura', icono: 'account_tree' },
    { id: 'clases', titulo: 'Clases', icono: 'auto_stories' },
    { id: 'medios', titulo: 'Medios', icono: 'perm_media' },
    { id: 'crear', titulo: 'Crear curso', icono: 'rocket_launch' },
  ];

  /** Hasta qué paso se puede ir: los hechos y el siguiente. */
  readonly alcanzable = computed(() => {
    const d = this.diseno();
    if (!d) return 0;
    const porEstado: Record<EstadoDiseno, number> = { MATERIAL: 0, ENTREVISTA: 1, ESTRUCTURA: 2, CONTENIDO: 3, APLICADO: 5 };
    let n = porEstado[d.estado];
    if (d.propuesta) n = Math.max(n, 3);
    // Con una clase escrita ya se pueden pedir medios y crear el curso (los medios son opcionales).
    if (d.propuesta && d.propuesta.modulos.some(m => m.lecciones.some(l => l.estado_detalle === 'LISTO'))) n = 5;
    return n;
  });

  readonly ocupado = computed(() => disenoOcupado(this.diseno()));
  readonly trabajo = computed(() => this.diseno()?.trabajo ?? null);
  readonly trabajoActivo = computed(() => {
    const t = this.trabajo();
    return !!t && (t.estado === 'EN_COLA' || t.estado === 'PROCESANDO');
  });
  readonly porcentaje = computed(() => {
    const t = this.trabajo();
    if (!t || !t.total) return null;
    return Math.round(((t.progreso ?? 0) / t.total) * 100);
  });

  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private vivo = true;
  private ultimoEstado: EstadoDiseno | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.vivo = false;
      if (this.temporizador) clearTimeout(this.temporizador);
    });
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.router.navigate(['/dashboard/capacitaciones/disenar']); return; }
    try {
      this.aplicar(await this.api.obtener(id), true);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se encontró el diseño'));
    }
  }

  /** Lo que devuelve cualquier llamada del diseño pasa por aquí: actualiza y decide si seguir consultando. */
  aplicar(d: Diseno, primeraVez = false): void {
    const antes = this.ultimoEstado;
    this.diseno.set(d);
    this.ultimoEstado = d.estado;
    if (primeraVez) {
      this.paso.set(this.pasoDelEstado(d));
    } else if (antes && antes !== d.estado) {
      // Si el servidor avanzó de paso (terminó de analizar, armó la estructura), se acompaña.
      this.paso.set(this.pasoDelEstado(d));
    }
    this.programarConsulta();
  }

  private pasoDelEstado(d: Diseno): PasoId {
    switch (d.estado) {
      case 'MATERIAL': return 'material';
      case 'ENTREVISTA': return 'entrevista';
      case 'ESTRUCTURA': return 'estructura';
      case 'CONTENIDO': return 'clases';
      case 'APLICADO': return 'crear';
    }
  }

  private programarConsulta(): void {
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
    if (!this.vivo || !this.ocupado()) return;
    this.temporizador = setTimeout(async () => {
      const d = this.diseno();
      if (!d || !this.vivo) return;
      try {
        this.aplicar(await this.api.obtener(d.id));
      } catch {
        // Un fallo de red en la consulta no rompe nada: se reintenta en el siguiente ciclo.
        this.temporizador = setTimeout(() => this.programarConsulta(), 4000);
      }
    }, 2000);
  }

  ir(p: PasoId): void {
    const i = this.pasos.findIndex(x => x.id === p);
    if (i <= this.alcanzable()) this.paso.set(p);
  }

  indice(p: PasoId): number {
    return this.pasos.findIndex(x => x.id === p);
  }

  empezarEdicionTitulo(): void {
    this.tituloEditado = this.diseno()?.titulo ?? '';
    this.editandoTitulo.set(true);
  }

  async guardarTitulo(): Promise<void> {
    const d = this.diseno();
    this.editandoTitulo.set(false);
    if (!d || !this.tituloEditado.trim() || this.tituloEditado.trim() === d.titulo) return;
    try {
      this.aplicar(await this.api.actualizar(d.id, { titulo: this.tituloEditado.trim(), contexto: d.contexto, idea: d.idea }));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo renombrar', text: mensajeDeError(e) });
    }
  }

  async cambiarContexto(): Promise<void> {
    const d = this.diseno();
    if (!d || d.estado === 'APLICADO') return;
    const nuevo = d.contexto === 'CORPORATIVO' ? 'EDUCATIVO' : 'CORPORATIVO';
    try {
      this.aplicar(await this.api.actualizar(d.id, { titulo: d.titulo, contexto: nuevo, idea: d.idea }));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo cambiar', text: mensajeDeError(e) });
    }
  }

  async cancelarTrabajo(): Promise<void> {
    const d = this.diseno();
    if (!d) return;
    try { this.aplicar(await this.api.cancelar(d.id)); } catch { /* se ve en la próxima consulta */ }
  }

  volver(): void {
    this.router.navigate(['/dashboard/capacitaciones/disenar']);
  }
}
