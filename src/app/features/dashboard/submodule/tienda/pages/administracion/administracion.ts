import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import {
  AlcanceUsuario, Negocio, Nivel, NodoArbol, TiendaService,
} from '../../service/tienda.service';

/** Un nodo del árbol aplanado, con su profundidad, para pintarlo sin recursión. */
interface FilaArbol {
  nodo: NodoArbol;
  profundidad: number;
}

/**
 * Administración de la estructura comercial.
 *
 * <p>Es la pantalla que hace útil el modelo dinámico: los escalones de la jerarquía son
 * datos, así que insertar "Distrito" entre Región y Tienda, o mover una región entera de
 * un negocio a otro, se hace desde aquí y no con una migración.
 *
 * <p>El árbol se pinta APLANADO con sangría en vez de con un componente recursivo. Con
 * recursión, cada nivel nuevo que el negocio invente añade una capa de componentes; con la
 * lista plana, la profundidad es solo un número y el modelo puede crecer sin tocar la
 * vista, que es justamente el punto.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-administracion',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './administracion.html',
  styleUrls: ['../../styles/tienda-comun.css', './administracion.css'],
})
export class Administracion implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);

  readonly arbol = signal<NodoArbol[]>([]);
  readonly negocios = signal<Negocio[]>([]);
  readonly niveles = signal<Nivel[]>([]);
  readonly alcances = signal<AlcanceUsuario[]>([]);
  readonly rolesTienda = signal<string[]>([]);

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Nodo seleccionado: sobre él actúan crear-hijo, crear-tienda y mover. */
  readonly seleccionado = signal<NodoArbol | null>(null);
  readonly moviendo = signal<NodoArbol | null>(null);

  readonly formularioAbierto = signal<'' | 'negocio' | 'nivel' | 'nodo' | 'tienda' | 'alcance'>('');

  // Formularios. Objetos planos y no FormGroup: son altas de cuatro campos y un
  // ReactiveForm por cada una añadiría más ceremonia que ayuda.
  nuevoNegocio = { codigo: '', nombre: '', nit: '' };
  nuevoNivel = { codigo: '', nombre: '', profundidad: 2, contiene_tiendas: false };
  nuevoNodo = { nivel_id: '', codigo: '', nombre: '' };
  nuevaTienda = {
    codigo: '', nombre: '', tipo: 'FISICA', municipio: '', direccion: '', telefono: '',
    permite_domicilio: false, permite_recogida: true, publicada_en_virtual: false,
  };
  nuevoAlcance = { usuario_id: '', rol_tienda: 'TENDERO', ve_todo: false, vigente_hasta: '' };

  /** El árbol aplanado en filas con sangría. */
  readonly filas = computed<FilaArbol[]>(() => {
    const salida: FilaArbol[] = [];
    const recorrer = (nodos: NodoArbol[], profundidad: number) => {
      for (const n of nodos) {
        salida.push({ nodo: n, profundidad });
        if (n.hijos?.length) recorrer(n.hijos, profundidad + 1);
      }
    };
    recorrer(this.arbol(), 0);
    return salida;
  });

  /** Niveles que pueden colgar del nodo seleccionado: los de profundidad mayor. */
  readonly nivelesPosibles = computed(() => {
    const sel = this.seleccionado();
    if (!sel) return this.niveles();
    const nivelActual = this.niveles().find(n => n.id === sel.nivel_id);
    if (!nivelActual) return this.niveles();
    return this.niveles().filter(n => n.profundidad > nivelActual.profundidad);
  });

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.arbol().subscribe({
      next: a => {
        this.arbol.set(a);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar el árbol de la organización');
        this.cargando.set(false);
      },
    });
    this.api.negocios().subscribe({ next: n => this.negocios.set(n), error: () => {} });
    this.api.niveles().subscribe({ next: n => this.niveles.set(n), error: () => {} });
    this.api.rolesDeTienda().subscribe({
      next: r => this.rolesTienda.set(r.map(x => String(x['codigo']))),
      error: () => this.rolesTienda.set(
        ['ADMIN_NEGOCIO', 'ADMIN_TIENDA', 'TENDERO', 'BODEGUERO', 'DOMICILIARIO', 'AUDITOR']),
    });
  }

  seleccionar(nodo: NodoArbol): void {
    this.seleccionado.set(nodo);
    this.formularioAbierto.set('');
    this.api.alcances(undefined, nodo.id).subscribe({
      next: a => this.alcances.set(a),
      error: () => this.alcances.set([]),
    });
  }

  abrir(formulario: '' | 'negocio' | 'nivel' | 'nodo' | 'tienda' | 'alcance'): void {
    this.formularioAbierto.set(this.formularioAbierto() === formulario ? '' : formulario);
    this.aviso.set(null);
    this.error.set(null);
  }

  // ── Altas ───────────────────────────────────────────────────────────────

  crearNegocio(): void {
    this.api.crearNegocio(this.nuevoNegocio).subscribe({
      next: () => {
        this.exito(`Negocio "${this.nuevoNegocio.nombre}" creado`);
        this.nuevoNegocio = { codigo: '', nombre: '', nit: '' };
        this.cargar();
      },
      error: e => this.fallo(e),
    });
  }

  crearNivel(): void {
    this.api.crearNivel(this.nuevoNivel).subscribe({
      next: () => {
        this.exito(`Nivel "${this.nuevoNivel.nombre}" creado. Ya puede colgar nodos de él.`);
        this.nuevoNivel = { codigo: '', nombre: '', profundidad: 2, contiene_tiendas: false };
        this.cargar();
      },
      error: e => this.fallo(e),
    });
  }

  crearNodo(): void {
    const padre = this.seleccionado();
    if (!padre) return;
    this.api.crearNodo({
      negocio_id: padre.negocio_id ?? undefined,
      nivel_id: this.nuevoNodo.nivel_id,
      padre_id: padre.id,
      codigo: this.nuevoNodo.codigo,
      nombre: this.nuevoNodo.nombre,
    }).subscribe({
      next: () => {
        this.exito(`"${this.nuevoNodo.nombre}" creado bajo ${padre.nombre}`);
        this.nuevoNodo = { nivel_id: '', codigo: '', nombre: '' };
        this.cargar();
      },
      error: e => this.fallo(e),
    });
  }

  crearTienda(): void {
    const padre = this.seleccionado();
    if (!padre) return;
    const negocioId = padre.negocio_id ?? this.negocios()[0]?.id;
    if (!negocioId) {
      this.error.set('Primero cree un negocio: una tienda tiene que pertenecer a uno');
      return;
    }
    this.api.crearTienda({
      ...this.nuevaTienda,
      negocio_id: negocioId,
      padre_id: padre.id,
    }).subscribe({
      next: () => {
        this.exito(`Tienda "${this.nuevaTienda.nombre}" creada bajo ${padre.nombre}. `
          + 'Quien tenga alcance sobre esa rama ya la ve.');
        this.nuevaTienda = {
          codigo: '', nombre: '', tipo: 'FISICA', municipio: '', direccion: '', telefono: '',
          permite_domicilio: false, permite_recogida: true, publicada_en_virtual: false,
        };
        this.cargar();
        this.ctx.cargar(true);
      },
      error: e => this.fallo(e),
    });
  }

  // ── Reorganización ──────────────────────────────────────────────────────

  empezarAMover(nodo: NodoArbol, evento: Event): void {
    evento.stopPropagation();
    this.moviendo.set(nodo);
    this.aviso.set(`Seleccione el nuevo padre de "${nodo.nombre}"`);
  }

  cancelarMover(): void {
    this.moviendo.set(null);
    this.aviso.set(null);
  }

  soltarEn(destino: NodoArbol): void {
    const nodo = this.moviendo();
    if (!nodo) { this.seleccionar(destino); return; }
    if (nodo.id === destino.id) { this.cancelarMover(); return; }

    this.api.moverNodo(nodo.id, destino.id).subscribe({
      next: () => {
        this.exito(`"${nodo.nombre}" se movió bajo "${destino.nombre}". `
          + 'El alcance de quien administraba esa rama se movió con ella.');
        this.moviendo.set(null);
        this.cargar();
        this.ctx.cargar(true);
      },
      error: e => { this.moviendo.set(null); this.fallo(e); },
    });
  }

  // ── Alcances ────────────────────────────────────────────────────────────

  asignarAlcance(): void {
    const nodo = this.seleccionado();
    if (!nodo && !this.nuevoAlcance.ve_todo) return;
    this.api.asignarAlcance({
      usuario_id: this.nuevoAlcance.usuario_id,
      nodo_id: this.nuevoAlcance.ve_todo ? undefined : nodo!.id,
      rol_tienda: this.nuevoAlcance.rol_tienda,
      ve_todo: this.nuevoAlcance.ve_todo,
      vigente_hasta: this.nuevoAlcance.vigente_hasta || undefined,
    }).subscribe({
      next: () => {
        this.exito(this.nuevoAlcance.ve_todo
          ? 'Alcance total concedido: verá todas las tiendas de todos los negocios.'
          : `Alcance concedido sobre "${nodo!.nombre}" y todo lo que cuelgue de él.`);
        this.nuevoAlcance = { usuario_id: '', rol_tienda: 'TENDERO', ve_todo: false, vigente_hasta: '' };
        if (nodo) this.seleccionar(nodo);
      },
      error: e => this.fallo(e),
    });
  }

  retirarAlcance(a: AlcanceUsuario): void {
    this.api.retirarAlcance(a.id).subscribe({
      next: () => {
        this.exito('Alcance retirado. Surte efecto en la siguiente pantalla que abra esa persona.');
        const nodo = this.seleccionado();
        if (nodo) this.seleccionar(nodo);
      },
      error: e => this.fallo(e),
    });
  }

  private exito(mensaje: string): void {
    this.aviso.set(mensaje);
    this.error.set(null);
  }

  private fallo(e: unknown): void {
    const cuerpo = (e as { error?: { error?: string } })?.error;
    this.error.set(cuerpo?.error ?? 'No se pudo completar la operación');
    this.aviso.set(null);
  }
}
