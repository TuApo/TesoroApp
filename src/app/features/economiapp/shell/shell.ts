import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { EscanerCodigoComponent, ResultadoEscaneo } from '../../../shared/components/escaner-codigo/escaner-codigo.component';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom, map } from 'rxjs';

import { EconomiaStore } from '../economia.store';
import { SonidosService } from '../sonidos.service';
import { EcoImagen } from '../components/eco-imagen';
import { EcoConfeti } from '../components/eco-confeti';
import { EcoRuleta } from '../components/eco-ruleta';
import { SugerenciasBusqueda, TiendaService } from '../../dashboard/submodule/tienda/service/tienda.service';
import { NotificationItem } from '../../../core/services/notification-center.service';
import { pesos, usuarioEnSesion } from '../economia.util';
import { OperadorComponent } from '../../../shared/components/operador/operador';
import { OperadorService } from '../../../core/services/operador/operador.service';

/**
 * El marco de EconomiAPP: barra superior con el regreso a Tu Apo, la tienda en la que compra,
 * el buscador, el cupo y el carrito; barra de pestañas abajo en el celular.
 *
 * <p>El botón de volver va arriba a la izquierda y primero que todo, siempre visible: esta
 * app se abre a pantalla completa, sin el menú de la plataforma, y quien no encuentra por
 * dónde salir cierra la pestaña.
 */
@Component({
  selector: 'eco-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, MatIconModule, RouterOutlet, RouterLink, RouterLinkActive, EcoImagen, EcoConfeti, EcoRuleta, EscanerCodigoComponent, OperadorComponent],
  templateUrl: './shell.html',
  styleUrls: ['../economiapp.css', './shell.css'],
})
export class EconomiaShell implements OnInit, OnDestroy {
  readonly store = inject(EconomiaStore);
  readonly sonidos = inject(SonidosService);
  /** Asistente operador: el botón de la barra abre el mismo panel que el orbe flotante. */
  readonly operador = inject(OperadorService);
  private router = inject(Router);

  readonly usuario = usuarioEnSesion();
  readonly selectorAbierto = signal(false);
  readonly avisosAbiertos = signal(false);
  readonly texto = signal('');
  private api = inject(TiendaService);

  // ── Buscador inteligente ──
  readonly sugerencias = signal<SugerenciasBusqueda | null>(null);
  readonly buscando = signal(false);
  readonly panelBusqueda = signal(false);
  private relojBusqueda: ReturnType<typeof setTimeout> | null = null;
  /**
   * Una pregunta ("¿cuál celular me recomienda?", "cómo va mi pedido") no se busca en el
   * catálogo: se le lleva a MatIA, que sí sabe responderla.
   */
  readonly esPregunta = computed(() => {
    const t = this.texto().trim().toLowerCase();
    if (t.length < 4) return false;
    return /[¿?]/.test(t)
      || /^(qu[eé]|cu[aá]l|cu[aá]les|c[oó]mo|cu[aá]nto|cu[aá]ndo|d[oó]nde|por qu[eé]|necesito|busco|quiero|recomi[eé]nd|ay[uú]d|dame|mu[eé]strame|compar|arm[ae]|mi pedido|mis pedidos|tengo|me sirve|sirve|hay )/.test(t)
      || t.split(/\s+/).length >= 6;
  });

  private readonly url = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url)),
    { initialValue: this.router.url },
  );
  /** En el carrito la barra inferior se cambia por el botón de pagar: no se tapan. */
  readonly enCarrito = computed(() => this.url().startsWith('/economiapp/carrito'));

  readonly pesos = pesos;
  readonly miles = (n: number) => new Intl.NumberFormat('es-CO').format(n || 0);

  constructor() {
    // Hojas que suben (tienda, avisos): «fiu» al abrir y al cerrar.
    let hoja = false;
    effect(() => {
      const abierta = this.selectorAbierto() || this.avisosAbiertos();
      untracked(() => { if (abierta !== hoja) { hoja = abierta; this.sonidos.tocar(abierta ? 'abrir' : 'cerrar'); } });
    });
    // Festejo (puntos del día, racha): fanfarria y, cuando el contador sube, monedas.
    effect(() => {
      if (!this.store.festejo()) return;
      untracked(() => { this.sonidos.tocar('festejo'); setTimeout(() => this.sonidos.tocar('monedas'), 700); });
    });
    // Cambio de pantalla (no de filtros): un barrido suave en vez del clic.
    let ruta = this.router.url.split('?')[0];
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(inject(DestroyRef))).subscribe(e => {
      const nueva = (e as NavigationEnd).urlAfterRedirects.split('?')[0];
      if (nueva !== ruta) { ruta = nueva; this.sonidos.tocar('navegar'); }
    });
  }

  /**
   * Clic suave en todo lo que se toca (botones, pestañas, filtros). Los enlaces suenan al
   * cambiar de pantalla; lo que tiene sonido propio (agregar, canjear) suena encima.
   */
  alToque(ev: PointerEvent): void {
    if (ev.button > 0) return;
    const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
      'button, [role="button"], [role="tab"], [role="option"], [role="switch"], summary, label, select, input[type="checkbox"], input[type="radio"]');
    if (!el || (el as HTMLButtonElement).disabled || el.closest('[data-sin-sonido]')) return;
    this.sonidos.tocar('tap');
  }

  ngOnInit(): void {
    // Los adornos de temporada se acomodan distinto dentro de EconomiAPP (ver adornos-temporada).
    document.documentElement.setAttribute('data-app', 'economiapp');
    this.store.iniciar();
    this.store.vigilarAvisos();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-app');
    this.store.dejarDeVigilar();
  }

  /** La araña de los banderines de Halloween: al tocarla, «¡bu!» y se deja caer. */
  readonly sustoArana = signal(false);
  boo(): void {
    this.sonidos.tocar('boo');
    this.sustoArana.set(true);
    setTimeout(() => this.sustoArana.set(false), 1300);
  }

  abrirAvisos(): void {
    this.avisosAbiertos.set(true);
    this.store.cargarAvisos();
  }

  /** Un aviso de pedido lleva a sus pedidos; uno con ruta propia, a esa ruta. */
  irAviso(a: NotificationItem): void {
    this.store.marcarLeido(a);
    this.avisosAbiertos.set(false);
    const destino = a.destino_valor || '';
    if (a.destino_tipo === 'URL' && /^https:\/\//.test(destino)) { window.open(destino, '_blank', 'noopener'); return; }
    if (destino.startsWith('/economiapp')) { this.router.navigateByUrl(destino); return; }
    this.router.navigate(['/economiapp/pedidos']);
  }

  irPromocion(id: string): void {
    this.avisosAbiertos.set(false);
    this.router.navigate(['/economiapp/promocion', id]);
  }

  /** Enter: una pregunta va a MatIA; lo demás, a los resultados del catálogo. */
  buscar(): void {
    const q = this.texto().trim();
    this.cerrarBusqueda();
    if (q && this.esPregunta()) { this.preguntarAlTendero(); return; }
    this.router.navigate(['/economiapp/explorar'], { queryParams: q ? { q } : {} });
  }

  escribir(v: string): void {
    this.texto.set(v);
    this.panelBusqueda.set(true);
    if (this.relojBusqueda) clearTimeout(this.relojBusqueda);
    const q = v.trim();
    const tienda = this.store.tiendaId();
    if (q.length < 2 || !tienda) { this.sugerencias.set(null); return; }
    this.relojBusqueda = setTimeout(() => {
      this.buscando.set(true);
      this.api.sugerencias(tienda, q).subscribe({
        next: s => { if (this.texto().trim() === q) this.sugerencias.set(s); this.buscando.set(false); },
        error: () => this.buscando.set(false),
      });
    }, 220);
  }

  preguntarAlTendero(): void {
    const q = this.texto().trim();
    this.cerrarBusqueda();
    this.texto.set('');
    this.router.navigate(['/economiapp/asesor'], { queryParams: q ? { q, c: null } : {} });
  }

  irSugerencia(destino: unknown[], params: Record<string, string> = {}): void {
    this.cerrarBusqueda();
    this.texto.set('');
    this.router.navigate(destino, { queryParams: params });
  }

  cerrarBusqueda(): void {
    this.panelBusqueda.set(false);
    if (this.relojBusqueda) clearTimeout(this.relojBusqueda);
  }

  /** Al perder el foco se espera un instante: si no, el clic en una sugerencia no alcanza a llegar. */
  salirBusqueda(): void {
    setTimeout(() => this.panelBusqueda.set(false), 180);
  }

  async elegirOficina(): Promise<void> {
    this.selectorAbierto.set(false);
    await this.store.verAmbito(null);
    this.store.avisar('Comprando en toda su oficina');
  }

  async elegir(id: string): Promise<void> {
    this.selectorAbierto.set(false);
    if (this.store.modoOficina()) {
      await this.store.verAmbito(id);
      this.store.avisar(`Ahora compra solo en ${this.store.etiquetaAmbito()}`);
      return;
    }
    if (id === this.store.tiendaId()) return;
    await this.store.elegirTienda(id);
    this.store.avisar(`Ahora compra en ${this.store.tienda()?.nombre ?? 'otra tienda'}`);
    this.router.navigate(['/economiapp']);
  }

  // ── Escanear y comprar ──
  /** Lo que queda por mostrar al cerrar el lector: un producto con opciones o varios con el mismo código. */
  private pendienteEscaneo: { tipo: 'producto'; id: string; tienda?: string } | { tipo: 'buscar'; q: string } | null = null;

  /**
   * Cada código leído se busca en el catálogo de su tienda (barras, código interno o del
   * sistema anterior) y, si es uno solo y sin opciones, se agrega de una al carrito: así se
   * arma el mercado escaneando, sin salir de la cámara.
   */
  readonly procesarCodigo = async (codigo: string): Promise<ResultadoEscaneo> => {
    const ambito = this.store.ambito();
    if (!ambito.length) return { ok: false, texto: 'Elija primero una tienda' };
    try {
      const r = await firstValueFrom(this.api.catalogoMulti(ambito, { texto: codigo, tamano: 6 }));
      const lista = r.articulos ?? [];
      if (!lista.length) return { ok: false, texto: 'No está en el catálogo de su tienda', detalle: codigo };
      if (lista.length > 1) {
        this.pendienteEscaneo = { tipo: 'buscar', q: codigo };
        return { ok: true, texto: `${lista.length} productos con ese código`, detalle: 'Al cerrar le mostramos cuál elegir' };
      }
      const a = lista[0];
      if (a.con_opciones || a.precio == null) {
        this.pendienteEscaneo = { tipo: 'producto', id: a.id, tienda: a.tienda_id ?? undefined };
        return { ok: true, texto: a.nombre, detalle: 'Tiene opciones: al cerrar elige talla, color o capacidad' };
      }
      const ok = await this.store.agregar(a);
      return ok
        ? { ok: true, texto: `Agregado: ${a.nombre}`, detalle: `${pesos(a.precio_promo ?? a.precio)} · ${this.store.cantidadDe(a.id)} en el carrito` }
        : { ok: false, texto: `No se pudo agregar ${a.nombre}` };
    } catch {
      return { ok: false, texto: 'No pudimos buscar ese código', detalle: 'Revise la conexión e intente de nuevo' };
    }
  };

  alCerrarEscaner(): void {
    const p = this.pendienteEscaneo;
    this.pendienteEscaneo = null;
    if (!p) return;
    if (p.tipo === 'producto') this.router.navigate(['/economiapp/producto', p.id], { queryParams: p.tienda ? { tienda: p.tienda } : {} });
    else this.router.navigate(['/economiapp/explorar'], { queryParams: { q: p.q } });
  }

  /** De vuelta a la app de la temporal. Se va al tablero, no "atrás": atrás podría ser otra pantalla de la tienda. */
  volverATuApo(): void {
    this.router.navigateByUrl('/dashboard');
  }
}
