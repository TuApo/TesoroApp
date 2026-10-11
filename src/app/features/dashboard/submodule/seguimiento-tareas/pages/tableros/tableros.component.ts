import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TareasApiService } from '../../services/tareas-api.service';
import { RecientesService, Reciente } from '../../services/recientes.service';
import { sinTildes } from '../../services/directorio.service';
import { Espacio, IndicadorTablero, Tablero } from '../../models/tareas.models';
import { COLORES_TABLERO, hace, mensajeError } from '../../utils/tareas-ui';

/**
 * Todos los tableros, agrupados por espacio, con su avance y lo vencido a la vista.
 * Favoritos y "abiertos hace poco" para llegar rápido; alta de tablero sin salir de aquí.
 */
@Component({
  selector: 'app-tableros',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTooltipModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  templateUrl: './tableros.component.html',
  styleUrls: ['./tableros.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TablerosComponent implements OnInit {
  private readonly api = inject(TareasApiService);
  private readonly recientesSvc = inject(RecientesService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly tableros = signal<Tablero[]>([]);
  readonly espacios = signal<Espacio[]>([]);
  readonly indicadores = signal<Map<number, IndicadorTablero>>(new Map());
  readonly recientes = signal<Reciente[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly busqueda = signal('');
  readonly soloFavoritos = signal(false);

  // Alta
  readonly creando = signal(false);
  readonly guardando = signal(false);
  nuevoEspacio: number | null = null;
  nuevoNombre = '';
  nuevaDesc = '';
  nuevoColor = COLORES_TABLERO[0];
  readonly colores = COLORES_TABLERO;

  readonly espaciosEditables = computed(() => this.espacios().filter(e => e.can_create_boards));

  readonly grupos = computed(() => {
    const q = sinTildes(this.busqueda().trim());
    const fav = this.soloFavoritos();
    const lista = this.tableros().filter(t =>
      (!q || sinTildes(`${t.name} ${t.workspace_name} ${t.description ?? ''}`).includes(q)) && (!fav || t.is_favorite));
    const m = new Map<number, { id: number; nombre: string; tableros: Tablero[] }>();
    for (const t of lista) {
      const g = m.get(t.workspace) ?? { id: t.workspace, nombre: t.workspace_name, tableros: [] };
      g.tableros.push(t);
      m.set(t.workspace, g);
    }
    return [...m.values()]
      .map(g => ({ ...g, tableros: g.tableros.sort((a, b) => Number(!!b.is_favorite) - Number(!!a.is_favorite) || a.name.localeCompare(b.name, 'es')) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });

  async ngOnInit(): Promise<void> {
    this.recientes.set(this.recientesSvc.todos().filter(r => r.tipo === 'tablero'));
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [tableros, espacios, resumen] = await Promise.all([
        this.api.tableros(), this.api.espacios(), this.api.resumen().catch(() => null),
      ]);
      this.tableros.set(tableros);
      this.espacios.set(espacios);
      this.indicadores.set(new Map((resumen?.board_indicators ?? []).map(b => [b.id, b])));
      // Los recientes que ya no existen se olvidan.
      const ids = new Set(tableros.map(t => t.id));
      for (const r of this.recientes()) if (!ids.has(r.id)) this.recientesSvc.quitar('tablero', r.id);
      this.recientes.set(this.recientesSvc.todos().filter(r => r.tipo === 'tablero'));
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los tableros.'));
    } finally {
      this.cargando.set(false);
    }
  }

  ind(id: number): IndicadorTablero | undefined { return this.indicadores().get(id); }

  abiertas(id: number): number {
    const i = this.ind(id);
    return i ? i.task_count - i.completed_task_count : 0;
  }

  async favorito(t: Tablero, ev: Event): Promise<void> {
    ev.stopPropagation();
    ev.preventDefault();
    const antes = !!t.is_favorite;
    this.tableros.update(l => l.map(x => x.id === t.id ? { ...x, is_favorite: !antes } : x));
    try {
      const r = await this.api.favorito('BOARD', t.id);
      this.tableros.update(l => l.map(x => x.id === t.id ? { ...x, is_favorite: r.is_favorite } : x));
    } catch (e) {
      this.tableros.update(l => l.map(x => x.id === t.id ? { ...x, is_favorite: antes } : x));
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4000 });
    }
  }

  abrirAlta(espacioId?: number): void {
    this.nuevoEspacio = espacioId ?? this.espaciosEditables()[0]?.id ?? null;
    this.nuevoNombre = '';
    this.nuevaDesc = '';
    this.creando.set(true);
  }

  async crear(): Promise<void> {
    if (!this.nuevoEspacio || !this.nuevoNombre.trim() || this.guardando()) return;
    this.guardando.set(true);
    try {
      const t = await this.api.crearTablero({
        workspace: this.nuevoEspacio, name: this.nuevoNombre.trim(),
        description: this.nuevaDesc.trim() || null, accent: this.nuevoColor,
      });
      this.creando.set(false);
      this.snack.open('Tablero creado con sus columnas por defecto', undefined, { duration: 2500 });
      this.router.navigate(['/dashboard/tareas/tableros', t.id]);
    } catch (e) {
      this.snack.open(mensajeError(e, 'No se pudo crear el tablero.'), 'Cerrar', { duration: 4500 });
    } finally {
      this.guardando.set(false);
    }
  }

  hace = hace;
}
