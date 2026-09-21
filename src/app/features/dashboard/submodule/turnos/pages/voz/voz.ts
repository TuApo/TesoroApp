import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { SelectorOficina } from '../../components/selector-oficina/selector-oficina';
import { ContextoTurnosService } from '../../service/contexto-turnos.service';
import { Media, TurnosService, VozAjustes, VozAjustesIn, VozAudio, VozDisponible, VozEstado, VozModelo } from '../../service/turnos.service';

/**
 * Voz y locución: la voz de marca con la que los televisores cantan los turnos
 * y se locutan avisos y jingles. Se elige entre las voces de la cuenta de
 * ElevenLabs, se afina (estabilidad, similitud, estilo, velocidad), se
 * prueban las frases de llamado y se administra la biblioteca de audios
 * generados (cada frase se sintetiza una sola vez y se reutiliza).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-turnos-voz',
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, SelectorOficina],
  templateUrl: './voz.html',
  styleUrls: ['../../styles/turnos-comun.css', './voz.css'],
})
export class VozLocucion implements OnInit {
  readonly ctx = inject(ContextoTurnosService);
  readonly api = inject(TurnosService);
  private destroyRef = inject(DestroyRef);

  readonly estado = signal<VozEstado | null>(null);
  readonly voces = signal<VozDisponible[]>([]);
  readonly modelos = signal<VozModelo[]>([]);
  readonly ajustes = signal<VozAjustes | null>(null);
  readonly biblioteca = signal<VozAudio[]>([]);
  readonly totalBiblioteca = signal(0);
  readonly camas = signal<Media[]>([]);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly reproduciendo = signal<string | null>(null);
  readonly ultimoAudio = signal<VozAudio | null>(null);
  readonly soloEspanol = signal(true);
  readonly filtroVoz = signal('');
  readonly filtroUso = signal('');
  readonly cargandoVoces = signal(false);

  readonly VARIABLES = ['{codigo}', '{punto}', '{area}', '{servicio}', '{nombre}'];

  /** Formulario de la voz de marca (copia editable de los ajustes resueltos). */
  form: VozAjustesIn & { voz_id: string | null; voz_nombre: string | null } = this.formVacio();
  prueba = { texto: 'Bienvenidos. Por favor tome su turno en recepción y espere a ser llamado.', voz_id: '', modelo: '' };
  llamadoPrueba = { codigo: 'A-014', punto: 'Módulo 2', area: 'Contratación', nombre: 'CAMILO H.', tipo_punto: 'FIJO' as 'FIJO' | 'MOVIL' };
  clon = { nombre: '', descripcion: '', archivos: [] as File[] };
  musica = { prompt: 'Cama musical corporativa suave y positiva, sin voces, instrumental, para avisos en una sala de espera', segundos: 30, titulo: '' };

  private audio = new Audio();

  readonly vocesFiltradas = computed(() => {
    const q = this.filtroVoz().trim().toLowerCase();
    return this.voces().filter(v => (!this.soloEspanol() || (v.idioma ?? '').startsWith('es') || /colomb|medell|bogot|latino/i.test(v.nombre + ' ' + (v.acento ?? '')))
      && (!q || v.nombre.toLowerCase().includes(q) || (v.descripcion ?? '').toLowerCase().includes(q)));
  });
  readonly vozElegida = computed(() => this.voces().find(v => v.voz_id === this.form.voz_id) ?? null);
  readonly cuota = computed(() => {
    const s = this.estado()?.suscripcion;
    if (!s || !s.caracteres_limite) return null;
    return { usado: s.caracteres_usados, limite: s.caracteres_limite, pct: Math.min(100, Math.round((s.caracteres_usados / s.caracteres_limite) * 100)),
      reinicio: s.proximo_reinicio_unix ? new Date(s.proximo_reinicio_unix * 1000) : null };
  });

  constructor() {
    effect(() => {
      const id = this.ctx.oficinaId();
      untracked(() => this.cargarAjustes(id));
    });
    this.audio.onended = () => this.reproduciendo.set(null);
    this.audio.onerror = () => { this.reproduciendo.set(null); this.error.set('No se pudo reproducir el audio'); };
    this.destroyRef.onDestroy(() => { this.audio.pause(); this.audio.src = ''; });
  }

  ngOnInit(): void {
    this.ctx.cargar();
    this.cargarEstado();
    this.cargarVoces(false);
    this.api.vozModelos().subscribe({ next: m => this.modelos.set(m), error: () => {} });
    this.cargarBiblioteca();
    this.cargarCamas();
  }

  // ── Carga ──────────────────────────────────────────────────────────────

  cargarEstado(): void { this.api.vozEstado().subscribe({ next: e => this.estado.set(e), error: () => this.estado.set(null) }); }

  cargarVoces(refrescar: boolean): void {
    this.cargandoVoces.set(true);
    this.api.vozVoces(refrescar).subscribe({ next: v => { this.voces.set(v); this.cargandoVoces.set(false); }, error: e => { this.cargandoVoces.set(false); this.error.set(e?.error?.message || 'No se pudieron traer las voces'); } });
  }

  private cargarAjustes(oficinaId: string | null): void {
    this.api.vozAjustes(oficinaId).subscribe({
      next: a => { this.ajustes.set(a); this.form = { ...this.formVacio(), ...a, oficina_id: oficinaId }; },
      error: () => {},
    });
  }

  cargarBiblioteca(): void {
    this.api.vozBiblioteca(this.filtroUso() || null, null, 0, 60).subscribe({ next: p => { this.biblioteca.set(p.content); this.totalBiblioteca.set(p.total_elements); }, error: () => {} });
  }

  cargarCamas(): void {
    this.api.buscarMedia(undefined, 'AUDIO', true, 0, 100).subscribe({ next: p => this.camas.set(p.content.filter(m => m.es_cama)), error: () => {} });
  }

  private avisar(t: string): void { this.aviso.set(t); setTimeout(() => this.aviso.set(null), 3000); }

  // ── Reproducción ───────────────────────────────────────────────────────

  escuchar(url: string | null, clave: string): void {
    if (!url) return;
    if (this.reproduciendo() === clave) { this.detener(); return; }
    this.audio.pause();
    this.audio.src = url;
    this.reproduciendo.set(clave);
    this.audio.play().catch(() => { this.reproduciendo.set(null); this.error.set('El navegador bloqueó el audio; haga clic de nuevo.'); });
  }

  detener(): void { this.audio.pause(); this.reproduciendo.set(null); }

  // ── Voz de marca ───────────────────────────────────────────────────────

  elegirVoz(v: VozDisponible): void { this.form = { ...this.form, voz_id: v.voz_id, voz_nombre: v.nombre }; }

  insertar(campo: 'plantilla_llamado' | 'plantilla_llamado_movil', variable: string): void {
    this.form = { ...this.form, [campo]: `${(this.form[campo] ?? '').replace(/\s+$/, '')} ${variable}`.trim() };
  }

  guardar(alcance: 'GLOBAL' | 'OFICINA'): void {
    const of = this.ctx.oficinaId();
    if (alcance === 'OFICINA' && !of) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.api.guardarVozAjustes({ ...this.form, oficina_id: alcance === 'OFICINA' ? of : null }).subscribe({
      next: a => { this.ocupado.set(false); this.ajustes.set(a); this.form = { ...this.formVacio(), ...a, oficina_id: of }; this.avisar(alcance === 'OFICINA' ? 'Voz guardada para esta oficina' : 'Voz de marca guardada para todas las oficinas'); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  volverAGlobal(): void {
    const of = this.ctx.oficinaId();
    if (!of || !confirm('¿Quitar la voz propia de esta oficina y usar la voz de marca global?')) return;
    this.api.quitarVozAjustes(of).subscribe({ next: () => { this.cargarAjustes(of); this.avisar('La oficina vuelve a la voz global'); }, error: e => this.error.set(e?.error?.message || 'No se pudo quitar') });
  }

  probarLlamado(): void {
    this.ocupado.set(true);
    this.error.set(null);
    // Se prueba con lo que hay guardado; si cambió algo en el formulario, primero hay que guardar.
    this.api.vozProbarLlamado({ oficina_id: this.ctx.oficinaId(), ...this.llamadoPrueba }).subscribe({
      next: a => { this.ocupado.set(false); this.ultimoAudio.set(a); this.escuchar(this.api.urlAudio(a.url), 'ultimo'); this.cargarBiblioteca(); this.cargarEstado(); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo generar la frase'); },
    });
  }

  probarTexto(): void {
    if (!this.prueba.texto.trim()) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.api.vozProbar(this.prueba.texto, this.prueba.voz_id || this.form.voz_id, this.prueba.modelo || null, this.ctx.oficinaId()).subscribe({
      next: a => { this.ocupado.set(false); this.ultimoAudio.set(a); this.escuchar(this.api.urlAudio(a.url), 'ultimo'); this.cargarBiblioteca(); this.cargarEstado(); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo sintetizar'); },
    });
  }

  // ── Biblioteca ─────────────────────────────────────────────────────────

  borrarAudio(a: VozAudio): void {
    if (!confirm('¿Borrar este audio de la caché? Si vuelve a hacer falta se genera de nuevo (y se vuelve a cobrar).')) return;
    this.api.vozBorrarAudio(a.id).subscribe({ next: () => this.cargarBiblioteca(), error: e => this.error.set(e?.error?.message || 'No se pudo borrar') });
  }

  // ── Clonar y música ────────────────────────────────────────────────────

  muestrasElegidas(e: Event): void { this.clon.archivos = Array.from((e.target as HTMLInputElement).files ?? []).slice(0, 5); }

  clonar(): void {
    if (!this.clon.nombre.trim() || !this.clon.archivos.length) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.api.vozClonar(this.clon.nombre.trim(), this.clon.descripcion || null, this.clon.archivos).subscribe({
      next: r => { this.ocupado.set(false); this.avisar(`Voz "${r.nombre}" creada`); this.clon = { nombre: '', descripcion: '', archivos: [] }; this.cargarVoces(true); this.form = { ...this.form, voz_id: r.voz_id, voz_nombre: r.nombre }; },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo clonar la voz'); },
    });
  }

  generarMusica(): void {
    if (!this.musica.prompt.trim()) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.api.vozMusica(this.musica.prompt, this.musica.segundos, this.musica.titulo || null).subscribe({
      next: m => { this.ocupado.set(false); this.avisar(`Cama "${m.titulo}" creada; ya se puede usar en avisos hablados`); this.cargarCamas(); this.escuchar(this.api.urlMedia(m), 'cama-' + m.id); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo generar la música'); },
    });
  }

  // ── Utilidades ─────────────────────────────────────────────────────────

  etiquetaVoz(v: VozDisponible): string {
    return [v.genero === 'female' ? 'Mujer' : v.genero === 'male' ? 'Hombre' : null, v.edad?.replace('_', ' ') ?? null, v.acento ?? null,
      v.categoria === 'cloned' ? 'clonada' : v.categoria === 'professional' ? 'profesional' : v.categoria === 'generated' ? 'diseñada' : null]
      .filter(Boolean).join(' · ');
  }
  duracion(ms: number | null): string { return ms ? `${(ms / 1000).toFixed(1)} s` : '—'; }
  kb(b: number): string { return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`; }
  origenNombre(o: string | undefined): string { return o === 'PROPIO' ? 'Voz propia de esta oficina' : o === 'GLOBAL' ? 'Voz de marca (todas las oficinas)' : 'Sin configurar: usa la voz inicial'; }

  private formVacio(): VozAjustesIn & { voz_id: string | null; voz_nombre: string | null } {
    return { oficina_id: null, voz_id: null, voz_nombre: null, modelo_llamado: 'eleven_flash_v2_5', modelo_locucion: 'eleven_multilingual_v2',
      estabilidad: 0.5, similitud: 0.8, estilo: 0, velocidad: 1, plantilla_llamado: 'Turno {codigo}. Diríjase a {punto}.',
      plantilla_llamado_movil: 'Turno {codigo}. Un asesor lo atenderá en {area}.', cantar_con_voz: true };
  }
}
