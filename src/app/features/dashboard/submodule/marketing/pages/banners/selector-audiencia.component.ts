import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { AudienceCatalogService, Sujeto } from '../../../dynamic-forms/services/audience-catalog.service';
import { EventoTipo, ReglaAudiencia, TipoAudiencia } from '../../carrusel/carrusel.models';
import { CarruselService } from '../../carrusel/carrusel.service';
import { normalizarTexto } from '@/app/core/services/permissions.service';

interface Opcion { tipo: TipoAudiencia; valor: string; nombre: string; detalle?: string; }

const NOMBRE_TIPO: Record<string, string> = {
  ROL: 'Roles', SEDE: 'Sedes', GRUPO: 'Grupos', USUARIO: 'Personas', DOCUMENTO: 'Personas', EVENTO: 'Eventos de plataforma',
};

/**
 * Quién ve un banner.
 *
 * La regla que se le explica a Marketing en la propia pantalla: dentro de un mismo tipo
 * basta con cumplir uno (rol A o rol B); entre tipos hay que cumplir todos (rol A y sede
 * X); y las exclusiones ganan siempre. Es exactamente lo que evalúa el backend
 * (Segmentacion.java): si la pantalla explicara otra cosa, alguien publicaría un
 * comunicado creyendo que lo ve un grupo y lo vería otro.
 *
 * Los catálogos (roles, sedes, grupos, personas) salen de ms-auth-admin por el mismo
 * servicio que usa la audiencia de los formularios dinámicos.
 */
@Component({
  selector: 'app-selector-audiencia',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './selector-audiencia.component.html',
  styleUrl: './selector-audiencia.component.css',
})
export class SelectorAudienciaComponent implements OnInit {
  private readonly catalogo = inject(AudienceCatalogService);
  private readonly carrusel = inject(CarruselService);

  readonly reglas = model<ReglaAudiencia[]>([]);
  readonly deshabilitado = input(false);

  readonly cargando = signal(true);
  readonly opciones = signal<Record<string, Opcion[]>>({});
  readonly pestana = signal<TipoAudiencia>('ROL');
  readonly busqueda = signal('');
  readonly modoExcluir = signal(false);
  readonly cedulas = signal('');

  readonly tipos: { tipo: TipoAudiencia; nombre: string; icono: string }[] = [
    { tipo: 'ROL', nombre: 'Roles', icono: 'badge' },
    { tipo: 'SEDE', nombre: 'Sedes', icono: 'location_on' },
    { tipo: 'GRUPO', nombre: 'Grupos', icono: 'groups' },
    { tipo: 'USUARIO', nombre: 'Personas', icono: 'person' },
    { tipo: 'EVENTO', nombre: 'Eventos', icono: 'event' },
  ];

  /** Escrito como dato: unas llaves dobles literales en la plantilla serían interpolación. */
  readonly variableNombre = '{{nombre}}';

  readonly paraTodos = computed(() => !this.reglas().some((r) => !r.excluir));

  readonly filtradas = computed(() => {
    const q = normalizarTexto(this.busqueda());
    const lista = this.opciones()[this.pestana()] ?? [];
    const filtrada = q
      ? lista.filter((o) => normalizarTexto(`${o.nombre} ${o.detalle ?? ''}`).includes(q))
      : lista;
    // Personas: el catálogo entero son miles; sin búsqueda se muestran solo las elegidas.
    if (this.pestana() === 'USUARIO' && !q) {
      return filtrada.filter((o) => this.estado(o) !== null);
    }
    return filtrada.slice(0, 200);
  });

  /** La audiencia en una frase, con la MISMA lógica que el backend. */
  readonly frase = computed(() => {
    const incl = this.reglas().filter((r) => !r.excluir);
    const excl = this.reglas().filter((r) => r.excluir);
    const grupos = new Map<string, string[]>();
    for (const r of incl) {
      const k = NOMBRE_TIPO[r.tipo] ?? r.tipo;
      grupos.set(k, [...(grupos.get(k) ?? []), r.etiqueta || r.valor]);
    }
    const partes = [...grupos.entries()].map(([k, v]) => `${k}: ${v.join(' o ')}`);
    let s = partes.length ? partes.join('  y  ') : 'Todas las personas con sesión';
    if (excl.length) s += `  ·  excepto ${excl.map((r) => r.etiqueta || r.valor).join(', ')}`;
    return s;
  });

  ngOnInit(): void {
    forkJoin({
      roles: this.catalogo.roles(),
      sedes: this.catalogo.sedes(),
      grupos: this.catalogo.grupos(),
      personas: this.catalogo.personas(),
      eventos: this.carrusel.eventos(),
    }).subscribe({
      next: (r) => {
        const map = (xs: Sujeto[], tipo: TipoAudiencia): Opcion[] =>
          xs.map((x) => ({ tipo, valor: x.id, nombre: x.nombre, detalle: x.detalle }));
        this.opciones.set({
          ROL: map(r.roles, 'ROL'),
          SEDE: map(r.sedes, 'SEDE'),
          GRUPO: map(r.grupos, 'GRUPO'),
          USUARIO: map(r.personas, 'USUARIO'),
          EVENTO: (r.eventos as EventoTipo[]).filter((e) => e.activo).map((e) => ({
            tipo: 'EVENTO' as const, valor: e.codigo, nombre: e.nombre,
            detalle: e.vigentes ? `Lo tienen ahora: ${e.vigentes}` : 'Nadie lo tiene ahora',
          })),
        });
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  /** 'in' | 'out' | null según esté incluida, excluida o no esté. */
  estado(o: Opcion): 'in' | 'out' | null {
    const r = this.reglas().find((x) => x.tipo === o.tipo && x.valor === o.valor);
    return r ? (r.excluir ? 'out' : 'in') : null;
  }

  alternar(o: Opcion): void {
    if (this.deshabilitado()) return;
    const excluir = this.modoExcluir();
    const actual = this.reglas();
    const i = actual.findIndex((x) => x.tipo === o.tipo && x.valor === o.valor);
    if (i >= 0 && !!actual[i].excluir === excluir) {
      this.reglas.set(actual.filter((_, j) => j !== i));
    } else if (i >= 0) {
      this.reglas.set(actual.map((x, j) => (j === i ? { ...x, excluir } : x)));
    } else {
      this.reglas.set([...actual, { tipo: o.tipo, valor: o.valor, etiqueta: o.nombre, excluir }]);
    }
  }

  quitar(r: ReglaAudiencia): void {
    if (this.deshabilitado()) return;
    this.reglas.set(this.reglas().filter((x) => !(x.tipo === r.tipo && x.valor === r.valor && x.excluir === r.excluir)));
  }

  paraTodosClick(): void {
    if (this.deshabilitado()) return;
    this.reglas.set(this.reglas().filter((r) => r.excluir));
  }

  /** Pegar cédulas (una por línea o separadas por comas) como personas de la audiencia. */
  agregarCedulas(): void {
    const excluir = this.modoExcluir();
    const nuevas = this.cedulas()
      .split(/[\s,;]+/)
      .map((c) => c.replace(/[^0-9A-Za-z]/g, ''))
      .filter((c) => c.length >= 4);
    if (!nuevas.length) return;
    const actual = this.reglas();
    const ya = new Set(actual.filter((r) => r.tipo === 'DOCUMENTO').map((r) => r.valor));
    const agregar = [...new Set(nuevas)].filter((c) => !ya.has(c))
      .map((c) => ({ tipo: 'DOCUMENTO' as const, valor: c, etiqueta: `CC ${c}`, excluir }));
    this.reglas.set([...actual, ...agregar]);
    this.cedulas.set('');
  }

  nombreTipo(t: string): string { return NOMBRE_TIPO[t] ?? t; }
}
