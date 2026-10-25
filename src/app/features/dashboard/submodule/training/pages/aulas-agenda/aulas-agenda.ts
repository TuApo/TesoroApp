import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { AulaRequest, AulaResumen, AulasService, CursoLibre, OpcionesAula, TipoAula } from '../../service/aulas.service';
import { mensajeDeError } from '../../service/disenador.service';

/**
 * CAPACITACIONES EN VIVO: la agenda de aulas (lo que está en vivo ahora, lo que viene y lo que
 * acaba de pasar), entrar con el código que alguien compartió, crear o programar un aula, y el
 * catálogo de capacitaciones libres para inscribirse solo.
 */
@Component({
  selector: 'app-aulas-agenda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, DatePipe],
  templateUrl: './aulas-agenda.html',
  styleUrl: './aulas-agenda.css',
})
export class AulasAgenda implements OnInit {
  private api = inject(AulasService);
  private router = inject(Router);

  readonly aulas = signal<AulaResumen[]>([]);
  readonly libres = signal<CursoLibre[]>([]);
  readonly cargando = signal(true);
  readonly puedeCrear = signal(false);
  readonly creando = signal(false);
  readonly formAbierto = signal(false);
  readonly opciones = signal<OpcionesAula | null>(null);
  readonly guardando = signal(false);

  readonly enVivo = computed(() => this.aulas().filter(a => a.estado === 'EN_VIVO'));
  readonly proximas = computed(() => this.aulas().filter(a => a.estado === 'PROGRAMADA'));
  readonly recientes = computed(() => this.aulas().filter(a => a.estado === 'FINALIZADA' || a.estado === 'CANCELADA').slice(0, 8));

  codigo = '';
  f: AulaRequest & { inicio_local: string; invitados_texto: string } = this.formVacio();

  readonly tipos: { valor: TipoAula; nombre: string; ayuda: string; icono: string }[] = [
    { valor: 'CLASE', nombre: 'Clase', ayuda: 'Explicas, preguntan, practican', icono: 'co_present' },
    { valor: 'TALLER', nombre: 'Taller', ayuda: 'Trabajo en equipos, código y entregas', icono: 'construction' },
    { valor: 'WEBINAR', nombre: 'Webinar', ayuda: 'Muchos miran; hablan a quien des la palabra', icono: 'podcasts' },
    { valor: 'TUTORIA', nombre: 'Tutoría', ayuda: 'Grupo pequeño, conversación', icono: 'support_agent' },
    { valor: 'REUNION', nombre: 'Reunión', ayuda: 'Equipo de trabajo', icono: 'groups' },
  ];

  readonly leccionesDelCurso = computed(() => this.opciones()?.cursos.find(c => c.id === this.cursoElegido())?.lecciones ?? []);
  readonly cursoElegido = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.cargar();
    this.api.puedoCrear().then(r => this.puedeCrear.set(r.puede_crear)).catch(() => undefined);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [a, l] = await Promise.all([this.api.agenda(), this.api.catalogoLibre().catch(() => [])]);
      this.aulas.set(a);
      this.libres.set(l);
    } catch (e) {
      Swal.fire({ toast: true, position: 'top-end', timer: 3000, showConfirmButton: false, icon: 'error', title: mensajeDeError(e) });
    } finally {
      this.cargando.set(false);
    }
  }

  async abrirFormulario(): Promise<void> {
    this.formAbierto.set(!this.formAbierto());
    if (this.formAbierto() && !this.opciones()) {
      try { this.opciones.set(await this.api.opciones()); } catch { this.opciones.set({ cursos: [], grupos: [] }); }
    }
  }

  elegirCurso(id: string | null): void {
    this.cursoElegido.set(id || null);
    this.f.course_id = id || null;
    this.f.lesson_id = null;
  }

  async crear(abrirYa: boolean): Promise<void> {
    if (!this.f.titulo.trim()) return;
    this.guardando.set(true);
    try {
      const req: AulaRequest = {
        ...this.f,
        titulo: this.f.titulo.trim(),
        inicio_programado: abrirYa ? new Date().toISOString() : (this.f.inicio_local ? new Date(this.f.inicio_local).toISOString() : null),
        invitados: this.f.acceso === 'INVITADOS' ? this.f.invitados_texto.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean) : [],
        group_id: this.f.acceso === 'GRUPO' ? this.f.group_id : null,
      };
      const a = await this.api.crear(req);
      this.f = this.formVacio();
      this.formAbierto.set(false);
      if (abrirYa) {
        await this.router.navigate(['/dashboard/capacitaciones/aula', a.id]);
      } else {
        await this.cargar();
        Swal.fire({ icon: 'success', title: 'Aula programada', html: `Comparte el código <b>${a.codigo}</b> o el enlace de la agenda.` });
      }
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo crear', text: mensajeDeError(e) });
    } finally {
      this.guardando.set(false);
    }
  }

  async entrarConCodigo(): Promise<void> {
    const c = this.codigo.trim();
    if (!c) return;
    try {
      const r = await this.api.porCodigo(c);
      await this.router.navigate(['/dashboard/capacitaciones/aula', r.id]);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Código no válido', text: mensajeDeError(e, 'No hay ningún aula con ese código') });
    }
  }

  abrir(a: AulaResumen): void {
    this.router.navigate(['/dashboard/capacitaciones/aula', a.id]);
  }

  async inscribirme(c: CursoLibre): Promise<void> {
    if (c.mi_matricula_id) { this.router.navigate(['/dashboard/capacitaciones', c.mi_matricula_id]); return; }
    try {
      const m = await this.api.inscribirme(c.id);
      this.router.navigate(['/dashboard/capacitaciones', m.id]);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo inscribir', text: mensajeDeError(e) });
    }
  }

  tipoNombre(t: string): string { return this.tipos.find(x => x.valor === t)?.nombre ?? t; }

  private formVacio(): AulaRequest & { inicio_local: string; invitados_texto: string } {
    return { titulo: '', descripcion: '', tipo: 'CLASE', contexto: 'CORPORATIVO', acceso: 'LIBRE', course_id: null, group_id: null,
      lesson_id: null, duracion_min: 60, max_participantes: 40, permite_espectadores: true, minutos_asistencia: null,
      inicio_local: '', invitados_texto: '' };
  }
}
