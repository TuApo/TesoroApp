import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MarkdownMessageComponent } from '@/app/features/dashboard/submodule/nomina/pages/analitica-nomina-ia/markdown-message.component';
import { ActividadApiService } from '../../actividad-api.service';
import { Alcance, Informe, InformeResumen, PersonaFila } from '../../actividad.models';
import { fechaHora, hace, rangoDe } from '../../actividad-ui';

type Tipo = 'PERSONA' | 'EQUIPO' | 'PLATAFORMA';

/**
 * Informes de IA sobre la actividad: se le pregunta algo (o se pide el informe general) de
 * una persona, un equipo o toda la plataforma; queda guardado con los datos con que se
 * escribió, se puede "Actualizar" hasta hoy y hacerle preguntas de seguimiento.
 */
@Component({
  selector: 'app-actividad-informes',
  standalone: true,
  imports: [RouterLink, FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule, MarkdownMessageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './informes.component.html',
  styleUrls: ['../../actividad-comun.css', './informes.component.css'],
})
export class InformesComponent implements OnInit, OnDestroy {
  private readonly api = inject(ActividadApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  readonly alcance = signal<Alcance | null>(null);
  readonly historial = signal<InformeResumen[]>([]);
  readonly totalHistorial = signal(0);
  readonly mios = signal(false);
  readonly filtroTipo = signal('');
  readonly actual = signal<Informe | null>(null);
  readonly cargandoActual = signal(false);
  readonly creando = signal(false);
  readonly preguntando = signal(false);
  readonly formAbierto = signal(true);

  // Formulario
  tipo: Tipo = 'PERSONA';
  sujeto: PersonaFila | null = null;
  buscarPersona = '';
  readonly candidatos = signal<PersonaFila[]>([]);
  rol = '';
  sede = '';
  periodo = '30';
  desde = rangoDe('30').desde;
  hasta = rangoDe('30').hasta;
  enfoque = '';
  pregunta = '';
  readonly roles = signal<string[]>([]);
  readonly sedes = signal<string[]>([]);

  readonly sugerencias = [
    '¿Qué hizo en este periodo y en qué módulos se le fue el tiempo?',
    '¿Respondió a tiempo a sus clientes y cumplió sus compromisos?',
    '¿Hay algo inusual: borrados, errores, accesos fuera de horario o ingresos fallidos?',
    '¿Quién tiene más carga y quién casi no usa la plataforma?',
  ];
  readonly fechaHora = fechaHora;
  readonly hace = hace;
  private sondeo: ReturnType<typeof setInterval> | null = null;
  private tBuscar: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    try { this.alcance.set(await this.api.alcance()); } catch { /* la API decide */ }
    const q = this.route.snapshot.queryParamMap;
    const nuevo = q.get('nuevo') as Tipo | null;
    if (nuevo) {
      this.tipo = nuevo;
      if (q.get('sujeto')) this.sujeto = { usuario_id: q.get('sujeto')!, nombre: q.get('nombre') ?? 'Persona' } as PersonaFila;
      this.rol = q.get('rol') ?? '';
      this.sede = q.get('sede') ?? '';
      if (q.get('desde') && q.get('hasta')) { this.desde = q.get('desde')!; this.hasta = q.get('hasta')!; this.periodo = 'rango'; }
    }
    if (!this.alcance()?.supervisa && this.tipo === 'PERSONA' && !this.sujeto && this.alcance()) {
      this.sujeto = { usuario_id: this.alcance()!.yo, nombre: 'Mi actividad' } as PersonaFila;
    }
    try {
      const p = await this.api.personas({ soloConActividad: false, tamano: 1, desde: this.desde, hasta: this.hasta });
      this.roles.set(p.roles);
      this.sedes.set(p.sedes);
    } catch { /* sin listas: se escribe a mano */ }
    await this.cargarHistorial();
    const id = q.get('informe');
    if (id) { this.formAbierto.set(false); await this.abrir(id); }
  }

  ngOnDestroy(): void {
    if (this.sondeo) clearInterval(this.sondeo);
  }

  async cargarHistorial(): Promise<void> {
    try {
      const r = await this.api.informes({ mios: this.mios(), tipo: this.filtroTipo() || null, tamano: 60 });
      this.historial.set(r.items);
      this.totalHistorial.set(r.total);
    } catch { /* lista vacía */ }
  }

  buscar(v: string): void {
    this.buscarPersona = v;
    if (this.tBuscar) clearTimeout(this.tBuscar);
    if (v.trim().length < 2) { this.candidatos.set([]); return; }
    this.tBuscar = setTimeout(async () => {
      try {
        const r = await this.api.personas({ q: v, soloConActividad: false, tamano: 8, desde: this.desde, hasta: this.hasta });
        this.candidatos.set(r.items);
      } catch { this.candidatos.set([]); }
    }, 300);
  }

  elegirPersona(p: PersonaFila): void {
    this.sujeto = p;
    this.buscarPersona = '';
    this.candidatos.set([]);
  }

  elegirPeriodo(p: string): void {
    this.periodo = p;
    if (p !== 'rango') { const r = rangoDe(p); this.desde = r.desde; this.hasta = r.hasta; }
  }

  usarSugerencia(s: string): void { this.enfoque = s; }

  puedeCrear(): boolean {
    if (this.tipo === 'PERSONA') return !!this.sujeto;
    return true;
  }

  async crear(): Promise<void> {
    this.creando.set(true);
    try {
      const inf = await this.api.crearInforme({
        tipo: this.tipo, sujeto_id: this.tipo === 'PERSONA' ? this.sujeto?.usuario_id : null,
        rol: this.tipo === 'EQUIPO' ? this.rol || null : null, sede: this.tipo === 'EQUIPO' ? this.sede || null : null,
        desde: this.desde, hasta: this.hasta, enfoque: this.enfoque.trim() || null,
      });
      this.formAbierto.set(false);
      this.mostrar(inf);
      await this.cargarHistorial();
    } catch (e: any) {
      this.snack.open(e?.error?.message ?? e?.error?.error ?? 'No se pudo pedir el informe', 'Cerrar', { duration: 5000 });
    } finally {
      this.creando.set(false);
    }
  }

  async abrir(id: string): Promise<void> {
    this.cargandoActual.set(true);
    try {
      this.mostrar(await this.api.informe(id));
      void this.router.navigate([], { relativeTo: this.route, queryParams: { informe: id }, replaceUrl: true });
    } catch {
      this.snack.open('No se pudo abrir el informe', 'Cerrar', { duration: 3500 });
    } finally {
      this.cargandoActual.set(false);
    }
  }

  /** Muestra el informe y, mientras la IA escribe (o responde), lo vuelve a pedir cada 3 s. */
  private mostrar(inf: Informe): void {
    this.actual.set(inf);
    if (this.sondeo) clearInterval(this.sondeo);
    const pendiente = (i: Informe) => i.estado === 'PENDIENTE' || i.estado === 'EN_CURSO' || i.mensajes.some(m => m.estado === 'PENDIENTE');
    if (!pendiente(inf)) return;
    this.sondeo = setInterval(async () => {
      try {
        const nuevo = await this.api.informe(inf.id);
        this.actual.set(nuevo);
        if (!pendiente(nuevo)) {
          if (this.sondeo) clearInterval(this.sondeo);
          void this.cargarHistorial();
        }
      } catch { /* siguiente vuelta */ }
    }, 3000);
  }

  async actualizar(): Promise<void> {
    const a = this.actual();
    if (!a) return;
    this.creando.set(true);
    try {
      const nuevo = await this.api.actualizarInforme(a.id);
      this.mostrar(nuevo);
      await this.cargarHistorial();
      this.snack.open('Generando la versión actualizada hasta hoy', undefined, { duration: 2500 });
    } catch (e: any) {
      this.snack.open(e?.error?.message ?? 'No se pudo actualizar', 'Cerrar', { duration: 4500 });
    } finally {
      this.creando.set(false);
    }
  }

  async preguntar(): Promise<void> {
    const a = this.actual();
    const p = this.pregunta.trim();
    if (!a || !p) return;
    this.preguntando.set(true);
    try {
      this.mostrar(await this.api.preguntar(a.id, p));
      this.pregunta = '';
    } catch (e: any) {
      this.snack.open(e?.error?.message ?? 'No se pudo enviar la pregunta', 'Cerrar', { duration: 4500 });
    } finally {
      this.preguntando.set(false);
    }
  }

  async eliminar(): Promise<void> {
    const a = this.actual();
    if (!a || !window.confirm('¿Borrar este informe y sus preguntas?')) return;
    try {
      await this.api.eliminarInforme(a.id);
      this.actual.set(null);
      this.formAbierto.set(true);
      await this.cargarHistorial();
    } catch (e: any) {
      this.snack.open(e?.error?.message ?? 'No se pudo borrar', 'Cerrar', { duration: 4500 });
    }
  }

  async copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.actual()?.contenido?.replace(/```echarts[\s\S]*?```/g, '').trim() ?? '');
      this.snack.open('Informe copiado', undefined, { duration: 2000 });
    } catch { /* sin portapapeles */ }
  }

  nuevo(): void {
    this.formAbierto.set(true);
    this.actual.set(null);
    if (this.sondeo) clearInterval(this.sondeo);
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  etiquetaTipo(t: string): string {
    return t === 'EQUIPO' ? 'Equipo' : t === 'PLATAFORMA' ? 'Plataforma' : 'Persona';
  }
}
