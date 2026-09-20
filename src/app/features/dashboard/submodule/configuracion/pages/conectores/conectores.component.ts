import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  CampoSchema, Conector, ConectoresMcpService, EntradaDirectorio,
  HerramientaMcp, camposDe,
} from '../../service/conectores-mcp.service';

/**
 * Conectores MCP. Solo la ve un administrador (lo impone el shell y, de verdad, el
 * backend: los endpoints de gestion son `hasAuthority('ADMIN')`).
 *
 * <p>Lo que hace distinta a esta pantalla: <b>no tiene ni un parametro cableado</b>. Cada
 * herramienta llega con su JSON Schema y el formulario se dibuja leyendolo. Cuando el
 * proveedor publique una herramienta nueva, aparecera aqui con sus campos sin que nadie
 * despliegue nada.
 */
@Component({
  selector: 'app-conectores',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conectores.component.html',
  styleUrl: './conectores.component.css',
})
export class ConectoresComponent implements OnInit {
  private readonly api = inject(ConectoresMcpService);

  readonly cargando = signal(true);
  readonly conectores = signal<Conector[]>([]);
  readonly directorio = signal<EntradaDirectorio[]>([]);

  /** El conector abierto en el panel de detalle. */
  readonly abierto = signal<Conector | null>(null);
  readonly herramientas = signal<HerramientaMcp[]>([]);
  readonly cargandoHerramientas = signal(false);

  /** La herramienta que se esta probando, y los valores tecleados. */
  readonly probando = signal<HerramientaMcp | null>(null);
  readonly campos = signal<CampoSchema[]>([]);
  valores: Record<string, unknown> = {};
  readonly invocando = signal(false);
  readonly ultimoResultado = signal<string | null>(null);

  // Alta de un conector nuevo.
  readonly mostrandoAlta = signal(false);
  nuevoNombre = '';
  nuevaUrl = '';
  readonly sondeando = signal(false);
  readonly resultadoSondeo = signal<string | null>(null);

  readonly hayConectores = computed(() => this.conectores().length > 0);

  ngOnInit(): void {
    this.recargar();
    this.api.directorio().subscribe({
      next: (d) => this.directorio.set(d),
      // El directorio es una comodidad, no un requisito: si falla, se puede escribir la URL.
      error: () => this.directorio.set([]),
    });
  }

  recargar(): void {
    this.cargando.set(true);
    this.api.listar().subscribe({
      next: (c) => { this.conectores.set(c); this.cargando.set(false); },
      error: (e) => { this.cargando.set(false); this.error('No se pudieron cargar los conectores', e); },
    });
  }

  // ── alta ────────────────────────────────────────────────────────────────

  abrirAlta(desde?: EntradaDirectorio): void {
    this.nuevoNombre = desde?.nombre ?? '';
    this.nuevaUrl = desde?.url ?? '';
    this.resultadoSondeo.set(null);
    this.mostrandoAlta.set(true);
  }

  cerrarAlta(): void { this.mostrandoAlta.set(false); }

  /** Antes de dar de alta, se le pregunta al propio servidor que exige. */
  sondear(): void {
    if (!this.nuevaUrl.trim()) return;
    this.sondeando.set(true);
    this.resultadoSondeo.set(null);
    this.api.sondear(this.nuevaUrl.trim()).subscribe({
      next: (s) => {
        this.sondeando.set(false);
        this.resultadoSondeo.set(
          s.alcanzable
            ? (s.auth_tipo === 'NINGUNA'
                ? 'Responde sin autenticación: se puede usar en cuanto se dé de alta.'
                : 'Exige autorización OAuth. Se pedirá al dar de alta.')
            : `No respondió: ${s.detalle}`);
      },
      error: (e) => {
        this.sondeando.set(false);
        this.resultadoSondeo.set(this.mensaje(e));
      },
    });
  }

  crear(): void {
    const url = this.nuevaUrl.trim();
    if (!url) return;
    this.api.crear(this.nuevoNombre.trim(), url).subscribe({
      next: () => {
        this.mostrandoAlta.set(false);
        this.recargar();
        Swal.fire({ icon: 'success', title: 'Conector agregado',
          text: 'Ahora hay que autorizarlo para poder usar sus herramientas.' });
      },
      error: (e) => this.error('No se pudo agregar', e),
    });
  }

  // ── autorizacion ────────────────────────────────────────────────────────

  /**
   * Abre la pagina del proveedor en otra pestaña. No se puede hacer dentro de un iframe:
   * los servidores de autorizacion lo prohiben a proposito, para que quien autoriza vea
   * la barra de direcciones y sepa a quien le esta dando permiso.
   */
  autorizar(c: Conector): void {
    this.api.autorizar(c.id).subscribe({
      next: (r) => {
        window.open(r.url_autorizacion, '_blank', 'noopener');
        Swal.fire({
          icon: 'info',
          title: 'Autoriza en la otra pestaña',
          text: 'Cuando termines, vuelve aquí y pulsa "Sincronizar" para traer sus herramientas.',
        });
      },
      error: (e) => this.error('No se pudo iniciar la autorización', e),
    });
  }

  sincronizar(c: Conector): void {
    this.api.sincronizar(c.id).subscribe({
      next: (r) => {
        this.recargar();
        if (this.abierto()?.id === c.id) this.abrir(c);
        Swal.fire({ icon: 'success', title: 'Catálogo actualizado',
          text: `${r.total} herramientas (${r.nuevas} nuevas${r.ausentes ? `, ${r.ausentes} ya no están` : ''}).` });
      },
      error: (e) => this.error('No se pudo sincronizar', e),
    });
  }

  async desactivar(c: Conector): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning', title: `¿Quitar ${c.nombre}?`,
      text: 'Dejará de estar disponible. Las credenciales guardadas se conservan por si se vuelve a activar.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.desactivar(c.id).subscribe({
      next: () => { if (this.abierto()?.id === c.id) this.abierto.set(null); this.recargar(); },
      error: (e) => this.error('No se pudo quitar', e),
    });
  }

  // ── detalle y herramientas ──────────────────────────────────────────────

  abrir(c: Conector): void {
    this.abierto.set(c);
    this.probando.set(null);
    this.ultimoResultado.set(null);
    this.cargandoHerramientas.set(true);
    this.api.herramientas(c.id).subscribe({
      next: (h) => { this.herramientas.set(h); this.cargandoHerramientas.set(false); },
      error: () => { this.herramientas.set([]); this.cargandoHerramientas.set(false); },
    });
  }

  cerrarDetalle(): void { this.abierto.set(null); this.probando.set(null); }

  /** Abre el formulario de una herramienta, dibujado desde su propio esquema. */
  probar(h: HerramientaMcp): void {
    const campos = camposDe(h.input_schema);
    this.campos.set(campos);
    this.valores = {};
    for (const c of campos) {
      if (c.valorPorDefecto !== null && c.valorPorDefecto !== undefined) {
        this.valores[c.clave] = c.valorPorDefecto;
      }
    }
    this.ultimoResultado.set(null);
    this.probando.set(h);
  }

  invocar(): void {
    const conector = this.abierto();
    const herramienta = this.probando();
    if (!conector || !herramienta) return;

    // Los vacios no se mandan: un opcional en blanco no es lo mismo que un opcional
    // puesto a cadena vacia, y algunos servidores rechazan lo segundo.
    const argumentos: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.valores)) {
      if (v === null || v === undefined || v === '') continue;
      argumentos[k] = v;
    }
    this.invocando.set(true);
    this.api.invocar(conector.id, herramienta.nombre, argumentos).subscribe({
      next: (r) => {
        this.invocando.set(false);
        this.ultimoResultado.set(r.resultado ?? r.error_detalle ?? '(sin contenido)');
      },
      error: (e) => { this.invocando.set(false); this.ultimoResultado.set(this.mensaje(e)); },
    });
  }

  // ── presentacion ────────────────────────────────────────────────────────

  etiquetaEstado(e: string): string {
    switch (e) {
      case 'AUTORIZADO': return 'Conectado';
      case 'SIN_AUTORIZAR': return 'Sin autorizar';
      case 'ERROR': return 'Con problemas';
      case 'REVOCADO': return 'Revocado';
      default: return e;
    }
  }

  claseEstado(e: string): string {
    switch (e) {
      case 'AUTORIZADO': return 'ok';
      case 'ERROR': case 'REVOCADO': return 'mal';
      default: return 'pendiente';
    }
  }

  categorias = computed(() => {
    const mapa = new Map<string, EntradaDirectorio[]>();
    for (const d of this.directorio()) {
      if (!mapa.has(d.categoria)) mapa.set(d.categoria, []);
      mapa.get(d.categoria)!.push(d);
    }
    return [...mapa.entries()].map(([categoria, items]) => ({ categoria, items }));
  });

  /** true si esa entrada del directorio ya esta dada de alta. */
  yaConectado(d: EntradaDirectorio): boolean {
    return this.conectores().some((c) => c.url === d.url);
  }

  trackConector = (_: number, c: Conector) => c.id;
  trackHerramienta = (_: number, h: HerramientaMcp) => h.nombre;
  trackCampo = (_: number, c: CampoSchema) => c.clave;
  trackDirectorio = (_: number, d: EntradaDirectorio) => d.clave;

  private mensaje(e: any): string {
    return e?.error?.error ?? e?.error?.message ?? e?.message ?? 'Error inesperado';
  }

  private error(titulo: string, e: any): void {
    Swal.fire({ icon: 'error', title: titulo, text: this.mensaje(e) });
  }
}
