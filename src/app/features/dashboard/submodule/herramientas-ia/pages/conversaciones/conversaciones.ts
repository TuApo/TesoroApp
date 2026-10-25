import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, debounceTime, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import {
  ChatIa, ChatIaRobot, ChatIaService, ContextoChatIa, ConversacionChat, FacetasBandeja, RUTA_BANDEJA_IA,
} from '../../../../../../shared/components/chat-ia';

/** Icono por módulo (primer segmento de la clave). */
const ICONOS: Record<string, string> = {
  tienda: 'storefront', 'herramientas-ia': 'smart_toy', nomina: 'payments', general: 'forum', tesoreria: 'account_balance',
  hiring: 'person_search', afiliaciones: 'health_and_safety', tareas: 'task_alt', contratacion: 'person_search', documentos: 'description',
  operador: 'graphic_eq', economiapp: 'shopping_bag',
};

/**
 * Bandeja central del chat de IA: todas las conversaciones de la persona —de cualquier módulo—
 * en un solo lugar, marcadas con el módulo y la tienda en que se trabajó, con búsqueda en el
 * texto de los mensajes y filtros. Incluye las del Asistente IA y la Analítica de nómina
 * anteriores (se leen aquí y se continúan en su pantalla). Administración puede revisar las de
 * todas las personas (solo lectura).
 */
@Component({
  selector: 'app-conversaciones-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSlideToggleModule, MatTooltipModule, ChatIa, ChatIaRobot],
  templateUrl: './conversaciones.html',
  styleUrl: './conversaciones.css',
})
export class ConversacionesIa implements OnInit {
  private api = inject(ChatIaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  /** Lo mismo que decide ms-ai (ROLE_ADMIN del token); el usuario guardado solo como respaldo. */
  readonly esAdmin = esAdminPorToken()
    || (obtenerUsuarioActual().roles ?? []).map(r => r.toUpperCase()).includes('ADMIN')
    || obtenerUsuarioActual().rol?.toUpperCase() === 'ADMIN';

  readonly conversaciones = signal<ConversacionChat[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly paginas = signal(0);
  readonly facetas = signal<FacetasBandeja>({ modulos: [], tiendas: [] });
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly seleccionada = signal<number | null>(null);
  readonly detalle = signal<ConversacionChat | null>(null);
  readonly enMovil = signal(false);
  readonly verDetalleMovil = signal(false);
  readonly editandoTitulo = signal(false);

  // Filtros
  q = '';
  readonly modulo = signal<string | null>(null);
  readonly tienda = signal<string | null>(null);
  readonly archivadas = signal(false);
  readonly todas = signal(false);
  desde = '';
  hasta = '';
  tituloEditado = '';

  readonly contextoGeneral: ContextoChatIa = {
    modulo: 'general', moduloNombre: 'General', ruta: RUTA_BANDEJA_IA,
  };
  readonly hayFiltros = computed(() => !!(this.modulo() || this.tienda() || this.archivadas() || this.todas()));
  private buscar$ = new Subject<void>();

  ngOnInit(): void {
    this.enMovil.set(window.matchMedia('(max-width: 900px)').matches);
    const mq = window.matchMedia('(max-width: 900px)');
    const alCambiar = (e: MediaQueryListEvent) => this.enMovil.set(e.matches);
    mq.addEventListener('change', alCambiar);
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', alCambiar));
    this.buscar$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.cargar());
    const c = Number(this.route.snapshot.queryParamMap.get('c')) || null;
    const m = this.route.snapshot.queryParamMap.get('modulo');
    if (m) this.modulo.set(m);
    this.cargar();
    this.cargarFacetas();
    if (c) this.abrir(c);
  }

  // ── Datos ──

  async cargar(mas = false): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    const pagina = mas ? this.pagina() + 1 : 0;
    try {
      const r = await firstValueFrom(this.api.bandeja({
        todas: this.todas(), modulo: this.modulo(), tienda: this.tienda(), q: this.q.trim() || null,
        archivadas: this.archivadas(), desde: this.desde || null, hasta: this.hasta || null, pagina, tamano: 30,
      }));
      this.conversaciones.set(mas ? [...this.conversaciones(), ...r.conversaciones] : r.conversaciones);
      this.total.set(r.total);
      this.pagina.set(r.pagina);
      this.paginas.set(r.paginas);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar las conversaciones.'));
    } finally {
      this.cargando.set(false);
    }
  }

  cargarFacetas(): void {
    this.api.facetas(this.todas()).subscribe({ next: f => this.facetas.set(f), error: () => undefined });
  }

  buscar(): void {
    this.buscar$.next();
  }

  filtrarModulo(clave: string | null): void {
    this.modulo.set(this.modulo() === clave ? null : clave);
    this.cargar();
  }

  filtrarTienda(id: string): void {
    this.tienda.set(id || null);
    this.cargar();
  }

  alternarArchivadas(): void {
    this.archivadas.set(!this.archivadas());
    this.cargar();
  }

  alternarTodas(): void {
    this.todas.set(!this.todas());
    this.cargar();
    this.cargarFacetas();
  }

  limpiarFiltros(): void {
    this.q = '';
    this.modulo.set(null);
    this.tienda.set(null);
    this.archivadas.set(false);
    this.todas.set(false);
    this.desde = '';
    this.hasta = '';
    this.cargar();
    this.cargarFacetas();
  }

  // ── Selección ──

  abrir(id: number): void {
    this.seleccionada.set(id);
    this.verDetalleMovil.set(true);
    this.editandoTitulo.set(false);
    const enLista = this.conversaciones().find(c => c.id === id);
    if (enLista) this.detalle.set(enLista);
    this.api.conversacion(id).subscribe({ next: r => this.detalle.set(r.conversacion), error: () => undefined });
    this.router.navigate([], { relativeTo: this.route, queryParams: { c: id }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  nueva(): void {
    this.seleccionada.set(null);
    this.detalle.set(null);
    this.verDetalleMovil.set(true);
    this.router.navigate([], { relativeTo: this.route, queryParams: { c: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  volverALista(): void {
    this.verDetalleMovil.set(false);
  }

  /** El chat avisa que la conversación cambió (nueva, título, último mensaje): se refleja en la lista. */
  alCambiar(c: ConversacionChat): void {
    this.detalle.set(c);
    if (this.seleccionada() !== c.id) {
      this.seleccionada.set(c.id);
      this.router.navigate([], { relativeTo: this.route, queryParams: { c: c.id }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    const l = this.conversaciones();
    if (l.some(x => x.id === c.id)) this.conversaciones.set([c, ...l.filter(x => x.id !== c.id)]);
    else { this.conversaciones.set([c, ...l]); this.total.update(t => t + 1); this.cargarFacetas(); }
  }

  irAlModulo(c: ConversacionChat): void {
    if (c.ruta) this.router.navigateByUrl(c.ruta);
  }

  async fijar(c: ConversacionChat): Promise<void> {
    await this.actualizar(c, { fijada: !c.fijada });
  }

  async archivar(c: ConversacionChat): Promise<void> {
    await this.actualizar(c, { archivada: !c.archivada });
    this.conversaciones.update(l => l.filter(x => x.id !== c.id));
    this.total.update(t => Math.max(0, t - 1));
    if (this.seleccionada() === c.id) this.nueva();
    this.cargarFacetas();
  }

  empezarRenombrar(c: ConversacionChat): void {
    this.tituloEditado = c.titulo;
    this.editandoTitulo.set(true);
  }

  async renombrar(c: ConversacionChat): Promise<void> {
    const t = this.tituloEditado.trim();
    this.editandoTitulo.set(false);
    if (t && t !== c.titulo) await this.actualizar(c, { titulo: t });
  }

  private async actualizar(c: ConversacionChat, cambios: Partial<Pick<ConversacionChat, 'titulo' | 'archivada' | 'fijada'>>): Promise<void> {
    try {
      const n = await firstValueFrom(this.api.actualizar(c.id, cambios));
      this.conversaciones.update(l => l.map(x => x.id === n.id ? n : x));
      if (this.detalle()?.id === n.id) this.detalle.set(n);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo guardar el cambio.'));
    }
  }

  icono(clave: string | null): string {
    const raiz = (clave ?? 'general').split('.')[0];
    return ICONOS[clave ?? ''] ?? ICONOS[raiz] ?? 'chat';
  }
}

/** Lee rol/roles del JWT de la sesión (sin validarlo: solo decide si se ofrece el filtro; ms-ai lo exige de verdad). */
function esAdminPorToken(): boolean {
  try {
    const t = localStorage.getItem('token') || JSON.parse(localStorage.getItem('user') || '{}')?.token || '';
    const carga = JSON.parse(atob(t.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const roles: string[] = [carga.rol, ...(Array.isArray(carga.roles) ? carga.roles : [])].filter(Boolean).map((r: string) => String(r).toUpperCase());
    return roles.includes('ADMIN');
  } catch {
    return false;
  }
}
