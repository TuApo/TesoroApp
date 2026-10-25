import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  ArticuloComprador, BloqueAsesor, ConversacionResumen, ListaDetalle, ListaResumen, MensajeAsesor, TiendaService,
} from '../../../dashboard/submodule/tienda/service/tienda.service';
// Voz y archivos compartidos con el chat de IA de la plataforma (se importan los archivos sueltos,
// no el índice: ese arrastra el chat completo).
import { GrabadoraVoz, ReproductorVoz, textoParaVoz } from '../../../../shared/components/chat-ia/chat-ia-voz';
import { archivosPegados, nombreAlSubir, reducirImagen, traeArchivos } from '../../../../shared/components/chat-ia/chat-ia-archivos';
import { EcoImagen } from '../../components/eco-imagen';
import { AvatarAgente } from '../../../../shared/components/avatar-agente/avatar-agente';
import { AvatarAgenteService } from '../../../../shared/components/avatar-agente/avatar-agente.service';
import { OperadorService } from '../../../../core/services/operador/operador.service';
import { EcoProducto } from '../../components/eco-producto';
import { EconomiaStore } from '../../economia.store';
import { SonidosService } from '../../sonidos.service';
import { ESTADO_PEDIDO, iconoCategoria, llegada, mensajeError, pesos } from '../../economia.util';

/** Lo que se ve mientras MatIA piensa: el mensaje del usuario ya aparece, la respuesta no. */
type Mensaje = MensajeAsesor & { pendiente?: boolean };

/** Archivo adjunto mientras se lee y ya leído (lo que MatIA entendió viaja en el mensaje). */
interface Adjunto { id: string; nombre: string; tipo: string; estado: 'leyendo' | 'listo' | 'error'; texto?: string; error?: string; vista?: string }

const MARCA_VOZ = '[Nota de voz] ';
/** Lo que MatIA sabe leer (MediosAsesor de ms-store): fotos, PDF y texto. */
const LEE = /^(image\/|application\/pdf$|text\/(plain|csv)$)/;
const MARCA_ADJ = /\n*\[Adjunto: ([^\]]+)\]\n/;
const CLAVE_LEER = 'eco.matia.leer';

const SUGERENCIAS = [
  { icono: 'shopping_basket', texto: 'Hazme el mercado de la semana para 4 personas con $250.000' },
  { icono: 'restaurant', texto: 'Dame una receta de ajiaco para 6 y lo que necesito comprar' },
  { icono: 'local_shipping', texto: '¿Cómo va mi pedido?' },
  { icono: 'history', texto: 'Arma lo de siempre pero que me salga más barato' },
  { icono: 'account_balance_wallet', texto: '¿Cuánto bono mercado tengo y qué me alcanza?' },
  { icono: 'compare_arrows', texto: 'Compara dos detergentes y dime cuál rinde más' },
];

/**
 * MatIA (asistente con IA) de EconomiAPP: un chat que recomienda, compara, arma listas, lleva al carrito y
 * dice cómo va un pedido. Las respuestas traen tarjetas reales (con el precio de hoy) y sus
 * botones funcionan igual que en el resto de la tienda.
 *
 * <p>El historial vive en el servidor: la misma conversación se retoma desde otro celular.
 */
@Component({
  selector: 'eco-asesor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, MatIconModule, RouterLink, EcoProducto, EcoImagen, AvatarAgente],
  templateUrl: './asesor.html',
  styleUrls: ['../../economiapp.css', './asesor.css'],
})
export class EconomiaAsesor implements OnInit {
  readonly store = inject(EconomiaStore);
  private sonidos = inject(SonidosService);
  private api = inject(TiendaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private operador = inject(OperadorService);
  private avatares = inject(AvatarAgenteService);
  /** Avatar Agent: MatIA, y Valentina (Tesorería) para lo que no es del mercado. */
  readonly matia = computed(() => this.avatares.personaje('economiapp'));
  readonly colega = computed(() => this.avatares.personaje('tesoreria'));

  /**
   * Préstamos, nómina y lo que no es del mercado lo atiende el asistente general: en EconomiAPP
   * también responde MatIA, pero con todas las áreas a la mano (invita a Valentina o a Ernesto).
   */
  pasarAlEquipo(): void {
    this.operador.abrir();
  }

  private readonly hilo = viewChild<ElementRef<HTMLElement>>('hilo');

  readonly disponible = signal<boolean | null>(null);
  readonly conversaciones = signal<ConversacionResumen[]>([]);
  readonly listas = signal<ListaResumen[]>([]);
  readonly actual = signal<string | null>(null);
  readonly titulo = signal('Nueva conversación');
  readonly mensajes = signal<Mensaje[]>([]);
  readonly enviando = signal(false);
  readonly cargando = signal(false);
  readonly panel = signal<'conversaciones' | 'listas'>('conversaciones');
  readonly panelAbierto = signal(false);
  readonly listaAbierta = signal<ListaDetalle | null>(null);
  readonly ocupadoLista = signal(false);
  texto = '';

  // ── Voz y archivos ──
  readonly medios = signal(false);
  readonly adjuntos = signal<Adjunto[]>([]);
  readonly arrastrando = signal(false);
  /** Notas de voz de hasta 2 minutos; el reproductor también da el nivel de la voz. */
  readonly grabadora = new GrabadoraVoz(120);
  readonly reproductor = new ReproductorVoz();
  readonly grabando = this.grabadora.grabando;
  readonly segundos = this.grabadora.segundos;
  readonly sonando = this.reproductor.sonando;
  readonly transcribiendo = signal(false);
  readonly cargandoVoz = signal<number | null>(null);
  readonly leerSiempre = signal(this.leerGuardado());
  readonly leyendoAdjuntos = computed(() => this.adjuntos().some(a => a.estado === 'leyendo'));
  readonly puedeEnviar = computed(() => !this.enviando() && !this.leyendoAdjuntos() && this.disponible() !== false);
  private vozCache = new Map<string, string>();

  readonly sugerencias = SUGERENCIAS;
  readonly vacio = computed(() => this.mensajes().length === 0);
  readonly pesos = pesos;
  readonly llegada = llegada;
  readonly ESTADO = ESTADO_PEDIDO;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pararGrabacion(true); this.callar();
      for (const u of this.vozCache.values()) URL.revokeObjectURL(u);
      for (const a of this.adjuntos()) if (a.vista) URL.revokeObjectURL(a.vista);
    });
  }

  async ngOnInit(): Promise<void> {
    this.avatares.cargar();
    await this.store.iniciar();
    this.api.asesorEstado().subscribe({ next: e => { this.disponible.set(e.disponible); this.medios.set(!!e.medios); }, error: () => this.disponible.set(false) });
    this.cargarConversaciones();
    this.cargarListas();
    const c = this.route.snapshot.queryParamMap.get('c');
    const q = this.route.snapshot.queryParamMap.get('q');
    if (c) await this.abrir(c);
    else if (q) { this.texto = q; this.enviar(); }
  }

  cargarConversaciones(): void {
    this.api.asesorConversaciones().subscribe({ next: c => this.conversaciones.set(c ?? []), error: () => {} });
  }
  cargarListas(): void {
    this.api.misListas().subscribe({ next: l => this.listas.set(l ?? []), error: () => {} });
  }

  nueva(): void {
    this.actual.set(null);
    this.titulo.set('Nueva conversación');
    this.mensajes.set([]);
    this.panelAbierto.set(false);
    this.router.navigate([], { relativeTo: this.route, queryParams: { c: null, q: null }, replaceUrl: true });
  }

  async abrir(id: string): Promise<void> {
    const tienda = this.store.tiendaId();
    if (!tienda) return;
    this.cargando.set(true);
    this.panelAbierto.set(false);
    try {
      const c = await firstValueFrom(this.api.asesorConversacion(id, tienda));
      this.actual.set(c.id);
      this.titulo.set(c.titulo);
      this.mensajes.set(c.mensajes ?? []);
      this.router.navigate([], { relativeTo: this.route, queryParams: { c: c.id, q: null }, replaceUrl: true });
      this.bajar();
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo abrir la conversación'), 'error');
    } finally {
      this.cargando.set(false);
    }
  }

  async borrar(c: ConversacionResumen, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!confirm(`¿Borrar la conversación "${c.titulo}"?`)) return;
    await firstValueFrom(this.api.asesorArchivar(c.id)).catch(() => null);
    if (this.actual() === c.id) this.nueva();
    this.cargarConversaciones();
  }

  usar(s: string): void {
    this.texto = s;
    this.enviar();
  }

  enviarFormulario(): void { this.enviar(); }

  teclado(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.enviar(); }
  }

  async enviar(deVoz = false): Promise<void> {
    const listos = this.adjuntos().filter(a => a.estado === 'listo');
    let texto = this.texto.trim();
    const tienda = this.store.tiendaId();
    if ((!texto && !listos.length) || !this.puedeEnviar() || !tienda) return;
    if (!texto) texto = 'Mire lo que le envío y ayúdeme con mi compra.';
    if (deVoz) texto = MARCA_VOZ + texto;
    for (const a of listos) texto += `\n\n[Adjunto: ${a.nombre}]\n${a.texto}`;
    this.texto = '';
    this.limpiarAdjuntos();
    this.enviando.set(true);
    this.callar();
    this.mensajes.update(m => [...m, { rol: 'USUARIO', contenido: texto, bloques: [] }, { rol: 'ASESOR', contenido: '', bloques: [], pendiente: true }]);
    this.sonidos.tocar('enviar');
    this.bajar();
    try {
      const r = await firstValueFrom(this.api.asesorEnviar({ conversacion_id: this.actual(), tienda_id: tienda, texto }));
      const nueva = !this.actual();
      this.actual.set(r.conversacion_id);
      this.titulo.set(r.titulo);
      this.mensajes.update(m => [...m.slice(0, -1), r.mensaje]);
      this.sonidos.tocar('mensaje');
      if (r.carrito_cambio) await this.store.refrescarCarrito();
      if (nueva) this.router.navigate([], { relativeTo: this.route, queryParams: { c: r.conversacion_id, q: null }, replaceUrl: true });
      this.cargarConversaciones();
      if (r.mensaje.bloques.some(b => b.tipo === 'lista')) this.cargarListas();
      // Si habló por voz (o pidió que siempre lea), la respuesta se escucha.
      if ((deVoz || this.leerSiempre()) && r.mensaje.contenido) this.escuchar(this.mensajes().length - 1);
    } catch (e) {
      this.mensajes.update(m => [...m.slice(0, -1), { rol: 'ASESOR', contenido: mensajeError(e, 'No pude responder ahora. Intente de nuevo.'), bloques: [] }]);
    } finally {
      this.enviando.set(false);
      this.bajar();
    }
  }

  // ── Archivos ──

  elegirArchivos(ev: Event): void {
    const inp = ev.target as HTMLInputElement;
    const archivos = Array.from(inp.files ?? []);
    inp.value = '';
    void this.agregarArchivos(archivos);
  }

  /** Pegar una captura o una foto copiada la adjunta. */
  alPegar(e: ClipboardEvent): void {
    if (!this.medios() || !this.puedeEnviar()) return;
    const archivos = archivosPegados(e);
    if (!archivos.length) return;
    e.preventDefault();
    void this.agregarArchivos(archivos);
  }

  alArrastrar(e: DragEvent): void {
    if (!this.medios() || !traeArchivos(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    this.arrastrando.set(true);
  }

  alSalir(e: DragEvent): void {
    const dentro = e.relatedTarget as Node | null;
    if (!dentro || !(e.currentTarget as HTMLElement).contains(dentro)) this.arrastrando.set(false);
  }

  alSoltar(e: DragEvent): void {
    if (!this.medios() || !traeArchivos(e)) return;
    e.preventDefault();
    this.arrastrando.set(false);
    if (this.puedeEnviar()) void this.agregarArchivos(Array.from(e.dataTransfer?.files ?? []));
  }

  private async agregarArchivos(archivos: File[]): Promise<void> {
    for (const f of archivos.slice(0, 4)) {
      if (this.adjuntos().length >= 4) { this.store.avisar('Máximo 4 archivos por mensaje', 'error'); break; }
      if (!LEE.test(f.type)) { this.store.avisar(`${f.name}: MatIA lee fotos, PDF y texto`, 'error'); continue; }
      if (f.size > 15 * 1024 * 1024) { this.store.avisar(`${f.name}: máximo 15 MB`, 'error'); continue; }
      const id = crypto.randomUUID();
      const vista = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      this.adjuntos.update(l => [...l, { id, nombre: f.name || 'archivo', tipo: f.type, estado: 'leyendo', vista }]);
      try {
        const blob = f.type.startsWith('image/') ? await reducirImagen(f) : f;
        const r = await firstValueFrom(this.api.asesorAdjunto(blob, nombreAlSubir(f, blob)));
        this.cambiarAdjunto(id, { estado: 'listo', texto: r.texto, tipo: r.tipo });
      } catch (e) {
        this.cambiarAdjunto(id, { estado: 'error', error: mensajeError(e, 'No se pudo leer') });
      }
    }
  }

  quitarAdjunto(id: string): void {
    const a = this.adjuntos().find(x => x.id === id);
    if (a?.vista) URL.revokeObjectURL(a.vista);
    this.adjuntos.update(l => l.filter(x => x.id !== id));
  }

  private limpiarAdjuntos(): void {
    for (const a of this.adjuntos()) if (a.vista) URL.revokeObjectURL(a.vista);
    this.adjuntos.set([]);
  }

  private cambiarAdjunto(id: string, c: Partial<Adjunto>): void {
    this.adjuntos.update(l => l.map(a => a.id === id ? { ...a, ...c } : a));
  }

  // ── Nota de voz ──

  async alternarGrabacion(): Promise<void> {
    if (this.grabando()) { this.pararGrabacion(false); return; }
    if (!GrabadoraVoz.soportada()) { this.store.avisar('Este navegador no permite grabar audio', 'error'); return; }
    try {
      this.callar();
      const { fin } = await this.grabadora.iniciar();
      void fin.then(audio => { if (audio) void this.transcribir(audio); });
    } catch (e: any) {
      this.store.avisar(e?.name === 'NotAllowedError' ? 'Permita el micrófono para enviar notas de voz' : 'No se pudo usar el micrófono', 'error');
    }
  }

  pararGrabacion(cancelar: boolean): void {
    this.grabadora.detener(cancelar);
  }

  private async transcribir(audio: Blob): Promise<void> {
    if (audio.size < 1500) { this.store.avisar('La nota de voz quedó muy corta', 'error'); return; }
    const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
    this.transcribiendo.set(true);
    try {
      const r = await firstValueFrom(this.api.asesorAdjunto(audio, `nota-de-voz.${ext}`));
      this.texto = [this.texto.trim(), r.texto].filter(Boolean).join(' ');
      await this.enviar(true);
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo entender la nota de voz'), 'error');
    } finally {
      this.transcribiendo.set(false);
    }
  }

  // ── Escuchar respuestas ──

  async escuchar(i: number): Promise<void> {
    if (this.sonando() === i) { this.callar(); return; }
    this.callar();
    const m = this.mensajes()[i];
    if (!m?.contenido) return;
    const clave = m.contenido;
    try {
      let url = this.vozCache.get(clave);
      if (!url) {
        if (!this.medios()) throw new Error('sin medios');
        this.cargandoVoz.set(i);
        const blob = await firstValueFrom(this.api.asesorVoz(m.contenido));
        url = URL.createObjectURL(blob);
        this.vozCache.set(clave, url);
      }
      this.cargandoVoz.set(null);
      await this.reproductor.reproducir(i, url);
    } catch {
      // Sin servidor de voz (o el navegador bloqueó el audio): la voz del propio teléfono.
      this.cargandoVoz.set(null);
      if (!this.reproductor.leerConNavegador(i, textoParaVoz(m.contenido))) this.reproductor.callar();
    }
  }

  callar(): void {
    this.reproductor.callar();
  }

  alternarLeer(): void {
    const v = !this.leerSiempre();
    this.leerSiempre.set(v);
    try { localStorage.setItem(CLAVE_LEER, v ? '1' : '0'); } catch { /* opcional */ }
    if (!v) this.callar();
  }

  private leerGuardado(): boolean {
    try { return localStorage.getItem(CLAVE_LEER) === '1'; } catch { return false; }
  }

  /** El mensaje del usuario: su texto, si fue por voz y los nombres de los adjuntos. */
  partes(contenido: string): { texto: string; voz: boolean; adjuntos: string[] } {
    let t = contenido || '';
    const voz = t.startsWith(MARCA_VOZ);
    if (voz) t = t.slice(MARCA_VOZ.length);
    const adjuntos: string[] = [];
    const i = t.search(MARCA_ADJ);
    if (i >= 0) {
      const resto = t.slice(i);
      t = t.slice(0, i);
      for (const m of resto.matchAll(/\[Adjunto: ([^\]]+)\]/g)) adjuntos.push(m[1]);
    }
    return { texto: t.trim(), voz, adjuntos };
  }

  minutos(s: number): string { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

  private bajar(): void {
    setTimeout(() => {
      const h = this.hilo()?.nativeElement;
      if (h) h.scrollTo({ top: h.scrollHeight, behavior: 'smooth' });
    }, 60);
  }

  // ── Listas ──

  async abrirLista(id: string): Promise<void> {
    const tienda = this.store.tiendaId();
    if (!tienda) return;
    try { this.listaAbierta.set(await firstValueFrom(this.api.lista(id, tienda))); }
    catch (e) { this.store.avisar(mensajeError(e, 'No se pudo abrir la lista'), 'error'); }
  }

  async listaAlCarrito(id: string): Promise<void> {
    const tienda = this.store.tiendaId();
    if (!tienda) return;
    this.ocupadoLista.set(true);
    try {
      const r = await firstValueFrom(this.api.listaAlCarrito(id, tienda));
      await this.store.refrescarCarrito();
      this.store.avisar(r.saltados.length
        ? `${r.agregados} al carrito; ${r.saltados.length} no se pudieron agregar`
        : `${r.agregados} producto${r.agregados === 1 ? '' : 's'} en su carrito`, r.saltados.length ? 'error' : 'ok');
    } catch (e) {
      this.store.avisar(mensajeError(e, 'No se pudo pasar la lista al carrito'), 'error');
    } finally {
      this.ocupadoLista.set(false);
    }
  }

  async cantidadLista(l: ListaDetalle, itemId: string, cantidad: number): Promise<void> {
    await firstValueFrom(this.api.cambiarItemLista(l.id, itemId, cantidad)).catch(() => null);
    await this.abrirLista(l.id);
    this.cargarListas();
  }

  async borrarLista(l: ListaDetalle): Promise<void> {
    if (!confirm(`¿Borrar la lista "${l.nombre}"?`)) return;
    await firstValueFrom(this.api.borrarLista(l.id)).catch(() => null);
    this.listaAbierta.set(null);
    this.cargarListas();
  }

  // ── Bloques ──

  /** Filas de la tabla comparativa: precio, llegada, condición y la unión de características. */
  filasComparacion(b: Extract<BloqueAsesor, { tipo: 'comparacion' }>): Array<{ nombre: string; valores: string[] }> {
    const nombres: string[] = [];
    for (const p of b.productos) for (const c of p.ficha?.caracteristicas ?? []) if (!nombres.includes(c.nombre)) nombres.push(c.nombre);
    const filas = [
      { nombre: 'Condición', valores: b.productos.map(p => p.ficha?.condicion ?? '—') },
      { nombre: 'Llegada', valores: b.productos.map(p => llegada(p)) },
      { nombre: 'Opciones', valores: b.productos.map(p => p.opciones?.length ? p.opciones.map(o => `${o.nombre} · ${pesos(o.precio)}`).join('\n') : '—') },
      { nombre: 'Garantía', valores: b.productos.map(p => p.ficha?.garantia ?? '—') },
    ];
    for (const n of nombres) {
      filas.push({ nombre: n, valores: b.productos.map(p => p.ficha?.caracteristicas?.find(c => c.nombre === n)?.valor ?? '—') });
    }
    return filas;
  }

  /** Vista previa del último mensaje sin la sintaxis de markdown. */
  resumen(t: string | null): string {
    return (t || '').replace(/\*\*|__|[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  }

  agregar(a: ArticuloComprador): void {
    if (a.con_opciones) this.router.navigate(['/economiapp/producto', a.id]);
    else this.store.agregar(a);
  }

  icono(a: ArticuloComprador): string {
    const c = this.store.categorias().find(x => x.id === a.categoria_id);
    return iconoCategoria(c?.nombre, c?.icono);
  }

  /**
   * Markdown mínimo y seguro: se escapa TODO el HTML primero y solo después se convierten
   * negrillas, cursivas, listas y saltos. El texto del modelo nunca llega como HTML crudo.
   */
  html(texto: string): string {
    const esc = (texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const out: string[] = [];
    let lista: 'ul' | 'ol' | null = null;
    const cerrar = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
    for (const l of esc.split('\n')) {
      const titulo = l.match(/^\s*#{1,4}\s+(.*)$/);
      const numerado = l.match(/^\s*\d+[.)]\s+(.*)$/);
      const vineta = l.match(/^\s*[-*•]\s+(.*)$/);
      if (titulo) { cerrar(); out.push(`<h4>${this.enLinea(titulo[1])}</h4>`); continue; }
      if (numerado || vineta) {
        const tipo = numerado ? 'ol' : 'ul';
        if (lista !== tipo) { cerrar(); out.push(`<${tipo}>`); lista = tipo; }
        out.push(`<li>${this.enLinea((numerado ?? vineta)![1])}</li>`);
        continue;
      }
      cerrar();
      if (l.trim()) out.push(`<p>${this.enLinea(l)}</p>`);
    }
    cerrar();
    return out.join('');
  }

  private enLinea(t: string): string {
    return t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>');
  }
}
