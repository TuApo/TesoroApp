import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ChatStoreService } from './chat-store.service';

export interface VentanaDock {
  conversacionId: string;
  minimizada: boolean;
  /** Llegó algo y la persona todavía no lo miró: la pestaña parpadea. */
  resaltada: boolean;
}

/**
 * El dock de chats: una columna de pestañas delgadas pegadas al borde derecho (la de
 * la lista de chats y una por cada conversación abierta, como la pestaña del menú en
 * el borde izquierdo). Al desplegar una, su ventana aparece abajo a la derecha; al
 * minimizarla queda solo la pestaña, que se resalta cuando llega un mensaje.
 *
 * Las ventanas abiertas se recuerdan por usuario (clave tuapo.ui.*, que
 * sobrevive al cierre de sesión igual que las demás preferencias de la UI).
 */
@Injectable({ providedIn: 'root' })
export class DockService {
  private readonly store = inject(ChatStoreService);
  private readonly router = inject(Router);

  readonly ventanas = signal<VentanaDock[]>([]);
  readonly listaAbierta = signal(false);
  readonly enfocada = signal<string | null>(null);
  readonly anchoPantalla = signal(typeof window === 'undefined' ? 1440 : window.innerWidth);
  readonly altoPantalla = signal(typeof window === 'undefined' ? 900 : window.innerHeight);

  /** Móvil / tableta estrecha: no hay dock, el chat abre a pantalla completa. */
  readonly compacto = computed(() => this.anchoPantalla() <= 900);

  /** Cuántas ventanas caben desplegadas lado a lado (descontando la lista si está abierta). */
  readonly capacidad = computed(() => {
    const libre = this.anchoPantalla() - 120 - (this.listaAbierta() ? 392 : 0);
    return Math.max(1, Math.min(3, Math.floor(libre / 382)));
  });

  /** Ventanas desplegadas (las minimizadas son solo su pestaña). */
  readonly expandidas = computed(() => this.ventanas().filter(v => !v.minimizada));

  /** Pestañas laterales que caben a lo alto; la más reciente arriba, junto a la de Chat. */
  private readonly maxPestanas = computed(() => Math.max(2, Math.floor((this.altoPantalla() - 240) / 104)));
  readonly pestanas = computed(() => [...this.ventanas()].reverse().slice(0, this.maxPestanas()));
  readonly pestanasOcultas = computed(() => [...this.ventanas()].reverse().slice(this.maxPestanas()));

  /** Para qué usuario se leyeron las ventanas guardadas. */
  private restauradoPara: string | null = null;

  constructor() {
    // Al arrancar, el id puede no estar todavía (el usuario guardado aún no se lee o lo
    // reescribe el refresco del menú): se restaura en cuanto se sabe quién es.
    effect(() => {
      const id = this.store.yo()?.id;
      if (id) untracked(() => { if (this.clave() !== this.restauradoPara) this.restaurar(); });
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.anchoPantalla.set(window.innerWidth);
        this.altoPantalla.set(window.innerHeight);
      }, { passive: true });
    }
  }

  private clave(): string { return `tuapo.ui.chatdock.${this.store.miId() || 'anonimo'}`; }

  restaurar(): void {
    this.restauradoPara = this.clave();
    try {
      const crudo = localStorage.getItem(this.clave());
      const lista = crudo ? JSON.parse(crudo) as VentanaDock[] : [];
      this.ventanas.set(Array.isArray(lista) ? lista.filter(v => v?.conversacionId).map(v => ({ ...v, resaltada: false })) : []);
    } catch { this.ventanas.set([]); }
  }

  private guardar(): void {
    try { localStorage.setItem(this.clave(), JSON.stringify(this.ventanas().map(v => ({ ...v, resaltada: false })))); }
    catch { /* almacenamiento bloqueado: se pierde solo el recuerdo */ }
  }

  abierta(id: string): VentanaDock | undefined {
    return this.ventanas().find(v => v.conversacionId === id);
  }

  /** Abre (o trae al frente y despliega) una conversación. En pantallas pequeñas navega. */
  abrir(id: string, opciones: { minimizada?: boolean; enfocar?: boolean } = {}): void {
    if (this.compacto()) {
      void this.router.navigate(['/dashboard/comunicaciones/chats'], { queryParams: { c: id } });
      this.listaAbierta.set(false);
      return;
    }
    const minimizada = opciones.minimizada ?? false;
    this.ventanas.update(l => {
      const actual = l.find(v => v.conversacionId === id);
      const resto = l.filter(v => v.conversacionId !== id);
      const v: VentanaDock = { conversacionId: id, minimizada: actual && opciones.minimizada == null ? false : minimizada,
        resaltada: actual?.resaltada ?? false };
      if (!minimizada) v.resaltada = false;
      // La más reciente queda a la derecha (junto al lanzador), como en Google Chat.
      return [...resto, v].slice(-8);
    });
    if (opciones.enfocar !== false && !minimizada) this.enfocada.set(id);
    if (!minimizada) this.hacerEspacio(id);
    this.guardar();
  }

  /** Si no caben todas las ventanas desplegadas, las más viejas vuelven a ser solo pestaña. */
  hacerEspacio(conservar?: string): void {
    const exceso = this.expandidas().length - this.capacidad();
    if (exceso <= 0) return;
    const aMinimizar = this.expandidas().filter(v => v.conversacionId !== conservar).slice(0, exceso).map(v => v.conversacionId);
    this.ventanas.update(l => l.map(x => aMinimizar.includes(x.conversacionId) ? { ...x, minimizada: true } : x));
  }

  alternar(id: string): void {
    const v = this.abierta(id);
    if (!v) return this.abrir(id);
    this.ventanas.update(l => l.map(x => x.conversacionId === id ? { ...x, minimizada: !x.minimizada, resaltada: false } : x));
    if (v.minimizada) { this.enfocada.set(id); this.hacerEspacio(id); }
    this.guardar();
  }

  minimizar(id: string): void {
    this.ventanas.update(l => l.map(x => x.conversacionId === id ? { ...x, minimizada: true } : x));
    if (this.enfocada() === id) this.enfocada.set(null);
    this.guardar();
  }

  cerrar(id: string): void {
    this.ventanas.update(l => l.filter(x => x.conversacionId !== id));
    if (this.enfocada() === id) this.enfocada.set(null);
    this.guardar();
  }

  cerrarTodas(): void {
    this.ventanas.set([]);
    this.enfocada.set(null);
    this.guardar();
  }

  resaltar(id: string): void {
    this.ventanas.update(l => l.map(x => x.conversacionId === id ? { ...x, resaltada: true } : x));
  }

  enfocar(id: string): void {
    this.enfocada.set(id);
    this.ventanas.update(l => l.map(x => x.conversacionId === id ? { ...x, resaltada: false } : x));
  }
}
