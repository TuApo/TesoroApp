import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import Swal from 'sweetalert2';

import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import {
  Grupo, GrupoClase, GrupoTipo, GruposService, MiembroGrupo, NOMBRE_TIPO_GRUPO,
} from '../../services/grupos/grupos.service';

/** Fila mínima del listado de usuarios que necesita el buscador de miembros. */
interface UsuarioLista {
  id: string;
  nombre: string;
  documento: string;
  correo: string;
}

/**
 * GESTIÓN DE GRUPOS Y ETIQUETAS.
 *
 * Un grupo NO otorga permisos —eso sigue siendo del rol—: es una etiqueta de AUDIENCIA
 * con la que se responde "a quién va dirigido esto". Hoy la consumen los Formularios
 * Dinámicos para acotar quién puede llenar cada formulario.
 *
 * Dos clases, y la diferencia importa al operar:
 *  - FIJO: sale del catálogo de centros de costo (fincas y empresas usuarias). El botón
 *    "Sincronizar catálogo" los siembra; es ADITIVO —crea y reactiva, nunca borra ni
 *    desasigna—, así que una recarga incompleta del Excel no puede vaciar audiencias.
 *  - TAG: etiqueta libre que alguien crea aquí para marcar a varias personas.
 *
 * "Oficina" no aparece como tipo a propósito: en esta plataforma la oficina es la SEDE,
 * que el usuario ya tiene asignada; duplicarla como grupo sería inventar un segundo dato
 * que se desincroniza.
 */
@Component({
  selector: 'app-gestion-grupos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="gg-page">

    <header class="card-header-premium" role="banner">
      <div class="header-content">
        <div class="header-icon-container">
          <span class="material-symbols-outlined header-icon" aria-hidden="true">sell</span>
        </div>
        <div class="header-text">
          <h1 class="titulo">Grupos y etiquetas</h1>
          <p class="subtitulo">
            Marca a las personas por finca, empresa usuaria o con una etiqueta propia ·
            {{ grupos().length }} en total
          </p>
        </div>
        <span class="grow"></span>
        <div class="header-actions">
          <button type="button" class="gg-btn gg-btn--ghost"
                  (click)="sincronizar()" [disabled]="sincronizando()"
                  title="Crea los grupos de finca y empresa usuaria que falten, a partir del catálogo de centros de costo">
            <span class="material-symbols-outlined" aria-hidden="true">sync</span>
            {{ sincronizando() ? 'Sincronizando…' : 'Sincronizar catálogo' }}
          </button>
          <button type="button" class="gg-btn gg-btn--primary" (click)="abrirNuevo()">
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
            Nueva etiqueta
          </button>
        </div>
      </div>
    </header>

    <!-- Filtros -->
    <section class="gg-filtros">
      <div class="gg-buscar">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input type="search" placeholder="Buscar por nombre…"
               [ngModel]="busqueda()" (ngModelChange)="busqueda.set($event)"
               aria-label="Buscar grupo por nombre" />
      </div>
      <div class="gg-chips" role="group" aria-label="Filtrar por tipo">
        @for (t of filtrosTipo; track t.valor) {
          <button type="button" class="gg-chip"
                  [class.gg-chip--activo]="tipoFiltro() === t.valor"
                  (click)="tipoFiltro.set(t.valor)">{{ t.nombre }}</button>
        }
      </div>
      <label class="gg-check">
        <input type="checkbox" [ngModel]="verInactivos()" (ngModelChange)="verInactivos.set($event)" />
        <span>Ver desactivados</span>
      </label>
    </section>

    @if (cargando()) {
      <p class="gg-estado" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span>
        Cargando grupos…
      </p>
    } @else if (visibles().length === 0) {
      <p class="gg-estado">
        <span class="material-symbols-outlined" aria-hidden="true">inbox</span>
        @if (grupos().length === 0) {
          Todavía no hay grupos. Crea una etiqueta o sincroniza el catálogo para traer las fincas y empresas usuarias.
        } @else {
          Ningún grupo coincide con el filtro.
        }
      </p>
    } @else {
      <div class="gg-grid">
        @for (g of visibles(); track g.id) {
          <article class="gg-card" [class.gg-card--off]="!g.activo">
            <div class="gg-card__head">
              <span class="gg-punto" [style.background]="g.color || colorPorTipo(g.tipo)" aria-hidden="true"></span>
              <h2 class="gg-card__nombre" [title]="g.nombre">{{ g.nombre }}</h2>
              <span class="gg-tipo">{{ nombreTipo(g.tipo) }}</span>
            </div>
            @if (g.descripcion) { <p class="gg-card__desc">{{ g.descripcion }}</p> }
            <div class="gg-card__meta">
              <span class="gg-meta">
                <span class="material-symbols-outlined" aria-hidden="true">group</span>
                {{ g.usuarios }} {{ g.usuarios === 1 ? 'persona' : 'personas' }}
              </span>
              <span class="gg-meta gg-meta--clase" [title]="g.clase === 'FIJO'
                    ? 'Viene del catálogo de centros de costo y se re-sincroniza'
                    : 'Etiqueta creada a mano'">
                {{ g.clase === 'FIJO' ? 'Del catálogo' : 'Etiqueta libre' }}
              </span>
              @if (!g.activo) { <span class="gg-meta gg-meta--off">Desactivado</span> }
            </div>
            <div class="gg-card__acciones">
              <button type="button" class="gg-btn gg-btn--claro" (click)="abrirMiembros(g)">
                <span class="material-symbols-outlined" aria-hidden="true">manage_accounts</span>
                Personas
              </button>
              <button type="button" class="gg-btn gg-btn--claro" (click)="abrirEditar(g)">
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                Editar
              </button>
              @if (g.activo) {
                <button type="button" class="gg-btn gg-btn--peligro" (click)="desactivar(g)">
                  <span class="material-symbols-outlined" aria-hidden="true">block</span>
                  Desactivar
                </button>
              } @else {
                <button type="button" class="gg-btn gg-btn--claro" (click)="reactivar(g)">
                  <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
                  Reactivar
                </button>
              }
            </div>
          </article>
        }
      </div>
    }

    <!-- Alta / edición -->
    @if (editando(); as g) {
      <div class="gg-fondo" (click)="cerrarEdicion()">
        <div class="gg-modal" role="dialog" aria-modal="true" aria-labelledby="gg-modal-titulo"
             (click)="$event.stopPropagation()">
          <h2 class="gg-modal__titulo" id="gg-modal-titulo">
            {{ g.id ? 'Editar grupo' : 'Nueva etiqueta' }}
          </h2>

          <label class="gg-campo">
            <span>Nombre <b aria-hidden="true">*</b></span>
            <input type="text" maxlength="120" [ngModel]="formNombre()" (ngModelChange)="formNombre.set($event)"
                   placeholder="Ej. Turno noche, La Esperanza…" />
          </label>

          <label class="gg-campo">
            <span>Descripción</span>
            <textarea rows="2" maxlength="500" [ngModel]="formDescripcion()"
                      (ngModelChange)="formDescripcion.set($event)"
                      placeholder="Para qué sirve esta etiqueta"></textarea>
          </label>

          @if (!g.id) {
            <label class="gg-campo">
              <span>Tipo</span>
              <select [ngModel]="formTipo()" (ngModelChange)="formTipo.set($event)">
                <option value="LIBRE">Etiqueta libre</option>
                <option value="FINCA">Finca</option>
                <option value="EMPRESA_USUARIA">Empresa usuaria</option>
              </select>
              <small>
                Las fincas y empresas usuarias normalmente se traen con «Sincronizar catálogo»;
                crea una a mano solo si no está ahí.
              </small>
            </label>
          }

          <label class="gg-campo gg-campo--color">
            <span>Color del chip</span>
            <input type="color" [ngModel]="formColor()" (ngModelChange)="formColor.set($event)" />
          </label>

          @if (errorForm(); as e) { <p class="gg-error" role="alert">{{ e }}</p> }

          <div class="gg-modal__acciones">
            <button type="button" class="gg-btn gg-btn--claro" (click)="cerrarEdicion()">Cancelar</button>
            <button type="button" class="gg-btn gg-btn--primary" (click)="guardar()" [disabled]="guardando()">
              {{ guardando() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Miembros -->
    @if (miembrosDe(); as g) {
      <div class="gg-fondo" (click)="cerrarMiembros()">
        <div class="gg-modal gg-modal--ancho" role="dialog" aria-modal="true"
             aria-labelledby="gg-miembros-titulo" (click)="$event.stopPropagation()">
          <h2 class="gg-modal__titulo" id="gg-miembros-titulo">Personas en «{{ g.nombre }}»</h2>
          <p class="gg-modal__sub">
            {{ miembros().length }} {{ miembros().length === 1 ? 'persona' : 'personas' }} ·
            los cambios se guardan al instante.
          </p>

          <div class="gg-buscar gg-buscar--modal">
            <span class="material-symbols-outlined" aria-hidden="true">person_search</span>
            <input type="search" placeholder="Buscar persona por nombre, documento o correo…"
                   [ngModel]="buscaPersona()" (ngModelChange)="buscaPersona.set($event)"
                   aria-label="Buscar persona para agregar al grupo" />
          </div>

          @if (candidatos().length > 0) {
            <ul class="gg-lista gg-lista--sugerencias">
              @for (u of candidatos(); track u.id) {
                <li>
                  <div class="gg-persona">
                    <span class="gg-persona__nombre">{{ u.nombre }}</span>
                    <span class="gg-persona__meta">{{ u.documento }} · {{ u.correo }}</span>
                  </div>
                  <button type="button" class="gg-btn gg-btn--claro" (click)="agregar(u)"
                          [disabled]="moviendo()">
                    <span class="material-symbols-outlined" aria-hidden="true">add</span>
                    Agregar
                  </button>
                </li>
              }
            </ul>
          } @else if (buscaPersona().trim().length >= 2) {
            <p class="gg-estado gg-estado--chico">Nadie más coincide con esa búsqueda.</p>
          }

          <h3 class="gg-sub">En el grupo</h3>
          @if (miembros().length === 0) {
            <p class="gg-estado gg-estado--chico">Todavía no hay nadie. Búscalos arriba y agrégalos.</p>
          } @else {
            <ul class="gg-lista">
              @for (m of miembros(); track m.id) {
                <li>
                  <div class="gg-persona">
                    <span class="gg-persona__nombre">{{ m.nombre_completo }}</span>
                    <span class="gg-persona__meta">{{ m.numero_de_documento }} · {{ m.correo_electronico }}</span>
                  </div>
                  <button type="button" class="gg-btn gg-btn--peligro" (click)="quitar(m)"
                          [disabled]="moviendo()">
                    <span class="material-symbols-outlined" aria-hidden="true">close</span>
                    Quitar
                  </button>
                </li>
              }
            </ul>
          }

          <div class="gg-modal__acciones">
            <button type="button" class="gg-btn gg-btn--primary" (click)="cerrarMiembros()">Listo</button>
          </div>
        </div>
      </div>
    }
  </div>
  `,
  styleUrl: './gestion-grupos.component.css',
})
export class GestionGruposComponent implements OnInit {
  private gruposSvc = inject(GruposService);
  private utils = inject(UtilityServiceService);

  readonly filtrosTipo: Array<{ valor: GrupoTipo | ''; nombre: string }> = [
    { valor: '', nombre: 'Todos' },
    { valor: 'FINCA', nombre: 'Fincas' },
    { valor: 'EMPRESA_USUARIA', nombre: 'Empresas usuarias' },
    { valor: 'LIBRE', nombre: 'Etiquetas' },
  ];

  readonly grupos = signal<Grupo[]>([]);
  readonly cargando = signal(true);
  readonly sincronizando = signal(false);

  readonly busqueda = signal('');
  readonly tipoFiltro = signal<GrupoTipo | ''>('');
  readonly verInactivos = signal(false);

  readonly visibles = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const tipo = this.tipoFiltro();
    return this.grupos()
      .filter(g => this.verInactivos() || g.activo)
      .filter(g => !tipo || g.tipo === tipo)
      .filter(g => !texto || g.nombre.toLowerCase().includes(texto));
  });

  // ── Alta / edición ──────────────────────────────────────────────────
  readonly editando = signal<Grupo | { id: null } | null>(null);
  readonly formNombre = signal('');
  readonly formDescripcion = signal('');
  readonly formTipo = signal<GrupoTipo>('LIBRE');
  readonly formColor = signal('#21263c');
  readonly guardando = signal(false);
  readonly errorForm = signal<string | null>(null);

  // ── Miembros ────────────────────────────────────────────────────────
  readonly miembrosDe = signal<Grupo | null>(null);
  readonly miembros = signal<MiembroGrupo[]>([]);
  readonly moviendo = signal(false);
  readonly buscaPersona = signal('');
  private readonly usuarios = signal<UsuarioLista[]>([]);

  /** Candidatos: coinciden con la búsqueda y NO están ya dentro (tope de 8 para no tapar la lista). */
  readonly candidatos = computed<UsuarioLista[]>(() => {
    const texto = this.buscaPersona().trim().toLowerCase();
    if (texto.length < 2) return [];
    const dentro = new Set(this.miembros().map(m => m.id));
    return this.usuarios()
      .filter(u => !dentro.has(u.id))
      .filter(u => u.nombre.toLowerCase().includes(texto)
        || u.documento.toLowerCase().includes(texto)
        || u.correo.toLowerCase().includes(texto))
      .slice(0, 8);
  });

  ngOnInit(): void {
    this.recargar();
    this.cargarUsuarios();
  }

  nombreTipo(t: GrupoTipo): string { return NOMBRE_TIPO_GRUPO[t]; }

  colorPorTipo(t: GrupoTipo): string {
    return t === 'FINCA' ? '#8cd50a' : t === 'EMPRESA_USUARIA' ? '#0ea5e9' : '#21263c';
  }

  recargar(): void {
    this.cargando.set(true);
    this.gruposSvc.list()
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: g => this.grupos.set(g ?? []),
        error: () => void Swal.fire('No se pudo cargar', 'Intenta de nuevo en un momento.', 'error'),
      });
  }

  private cargarUsuarios(): void {
    this.utils.getAllUsers().subscribe({
      next: (data: unknown) => {
        const filas = Array.isArray(data) ? data : ((data as { results?: unknown[] })?.results ?? []);
        this.usuarios.set((filas as Array<Record<string, any>>).map(u => ({
          id: String(u['id']),
          nombre: [u['datos_basicos']?.['nombres'], u['datos_basicos']?.['apellidos']]
            .filter(Boolean).join(' ').trim() || String(u['correo_electronico'] ?? ''),
          documento: String(u['numero_de_documento'] ?? ''),
          correo: String(u['correo_electronico'] ?? ''),
        })));
      },
      // Sin listado de usuarios el buscador queda vacío, pero la pantalla sigue sirviendo
      // para crear, editar y quitar gente: no vale la pena un modal de error aquí.
      error: () => this.usuarios.set([]),
    });
  }

  sincronizar(): void {
    this.sincronizando.set(true);
    this.gruposSvc.sincronizarCatalogo()
      .pipe(finalize(() => this.sincronizando.set(false)))
      .subscribe({
        next: r => {
          this.recargar();
          void Swal.fire({
            icon: 'success',
            title: 'Catálogo sincronizado',
            html: `${r.creados} creados · ${r.reactivados} reactivados · ${r.ya_existian} ya existían.`
              + `<br><small>La sincronización solo agrega: nunca borra grupos ni quita personas.</small>`,
          });
        },
        error: () => void Swal.fire('No se pudo sincronizar', 'Revisa el catálogo de centros de costo.', 'error'),
      });
  }

  // ── Alta / edición ──────────────────────────────────────────────────

  abrirNuevo(): void {
    this.errorForm.set(null);
    this.formNombre.set('');
    this.formDescripcion.set('');
    this.formTipo.set('LIBRE');
    this.formColor.set('#21263c');
    this.editando.set({ id: null });
  }

  abrirEditar(g: Grupo): void {
    this.errorForm.set(null);
    this.formNombre.set(g.nombre);
    this.formDescripcion.set(g.descripcion ?? '');
    this.formTipo.set(g.tipo);
    this.formColor.set(g.color || this.colorPorTipo(g.tipo));
    this.editando.set(g);
  }

  cerrarEdicion(): void { this.editando.set(null); }

  guardar(): void {
    const actual = this.editando();
    if (!actual) return;
    const nombre = this.formNombre().trim();
    if (!nombre) {
      this.errorForm.set('El grupo necesita un nombre.');
      return;
    }
    this.errorForm.set(null);
    this.guardando.set(true);

    const cuerpo = {
      nombre,
      descripcion: this.formDescripcion().trim() || null,
      color: this.formColor(),
    };
    const peticion = actual.id
      ? this.gruposSvc.update(actual.id, cuerpo)
      : this.gruposSvc.create({ ...cuerpo, tipo: this.formTipo(), clase: 'TAG' as GrupoClase });

    peticion.pipe(finalize(() => this.guardando.set(false))).subscribe({
      next: () => {
        this.cerrarEdicion();
        this.recargar();
      },
      error: (e: { error?: { message?: string; detail?: string } }) =>
        this.errorForm.set(e?.error?.message || e?.error?.detail
          || 'No se pudo guardar. Puede que ya exista un grupo con ese nombre.'),
    });
  }

  desactivar(g: Grupo): void {
    void Swal.fire({
      icon: 'question',
      title: `¿Desactivar «${g.nombre}»?`,
      html: g.usuarios > 0
        ? `Lo tienen ${g.usuarios} persona(s). Deja de ofrecerse para nuevas audiencias, `
          + `pero <b>no</b> se borra ni se le quita a nadie.`
        : 'Deja de ofrecerse para nuevas audiencias. Puedes reactivarlo cuando quieras.',
      showCancelButton: true,
      confirmButtonText: 'Desactivar',
      cancelButtonText: 'Cancelar',
    }).then(r => {
      if (!r.isConfirmed) return;
      this.gruposSvc.remove(g.id).subscribe({
        next: () => this.recargar(),
        error: () => void Swal.fire('No se pudo desactivar', 'Intenta de nuevo.', 'error'),
      });
    });
  }

  reactivar(g: Grupo): void {
    this.gruposSvc.update(g.id, { activo: true }).subscribe({
      next: () => this.recargar(),
      error: () => void Swal.fire('No se pudo reactivar', 'Intenta de nuevo.', 'error'),
    });
  }

  // ── Miembros ────────────────────────────────────────────────────────

  abrirMiembros(g: Grupo): void {
    this.buscaPersona.set('');
    this.miembros.set([]);
    this.miembrosDe.set(g);
    this.gruposSvc.detail(g.id).subscribe({
      next: d => this.miembros.set(d.miembros ?? []),
      error: () => void Swal.fire('No se pudo cargar', 'Intenta abrir el grupo de nuevo.', 'error'),
    });
  }

  cerrarMiembros(): void {
    this.miembrosDe.set(null);
    // El contador de la tarjeta cambió con las altas/bajas.
    this.recargar();
  }

  agregar(u: UsuarioLista): void {
    const g = this.miembrosDe();
    if (!g || this.moviendo()) return;
    this.moviendo.set(true);
    this.gruposSvc.cambiarMiembros(g.id, { agregar: [u.id] })
      .pipe(finalize(() => this.moviendo.set(false)))
      .subscribe({
        next: d => {
          this.miembros.set(d.miembros ?? []);
          this.buscaPersona.set('');
        },
        error: () => void Swal.fire('No se pudo agregar', 'Intenta de nuevo.', 'error'),
      });
  }

  quitar(m: MiembroGrupo): void {
    const g = this.miembrosDe();
    if (!g || this.moviendo()) return;
    this.moviendo.set(true);
    this.gruposSvc.cambiarMiembros(g.id, { quitar: [m.id] })
      .pipe(finalize(() => this.moviendo.set(false)))
      .subscribe({
        next: d => this.miembros.set(d.miembros ?? []),
        error: () => void Swal.fire('No se pudo quitar', 'Intenta de nuevo.', 'error'),
      });
  }
}
