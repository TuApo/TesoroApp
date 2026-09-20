import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { Consentimiento, ImagenBanco, MarketingService } from '../../service/marketing.service';

/**
 * El banco de imágenes.
 *
 * <p><b>La pantalla existe para una cosa</b>: que se vea de un vistazo qué fotos se pueden
 * usar y cuáles no. Una foto de una persona trabajando no es un recurso gráfico, es su
 * imagen, y usarla en publicidad exige su autorización firmada. Aquí eso no es una nota al
 * pie: la tarjeta sin permiso sale marcada y dice por qué.
 *
 * <p>Se sube primero y se autoriza después, a propósito: la foto se toma en la finca y el
 * formulario firmado llega días más tarde. Lo que se bloquea es el uso, no la custodia.
 */
@Component({
  selector: 'app-mk-banco',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './banco.component.html',
  styleUrl: './banco.component.css',
})
export class BancoComponent implements OnInit, OnDestroy {
  private readonly api = inject(MarketingService);

  readonly cargando = signal(true);
  readonly imagenes = signal<ImagenBanco[]>([]);
  readonly filtro = signal<string>('');
  readonly previas = signal<Record<string, string>>({});

  /** La imagen abierta en el panel lateral, con sus autorizaciones. */
  readonly abierta = signal<ImagenBanco | null>(null);
  readonly consentimientos = signal<Consentimiento[]>([]);
  readonly subiendo = signal(false);

  readonly tipos = [
    { clave: '', etiqueta: 'Todas' },
    { clave: 'FOTO_PERSONA', etiqueta: 'Personas' },
    { clave: 'FOTO_LUGAR', etiqueta: 'Lugares' },
    { clave: 'FONDO', etiqueta: 'Fondos' },
    { clave: 'RECURSO', etiqueta: 'Recursos' },
  ];

  /** Cuántas fotos de persona están bloqueadas: es el número que hay que resolver. */
  readonly bloqueadas = computed(() => this.imagenes().filter((i) => !i.seleccionable).length);

  ngOnInit(): void { this.cargar(); }

  ngOnDestroy(): void {
    // Cada blob crea una URL que el navegador no libera solo: sin esto, entrar y salir de
    // la pantalla varias veces se va acumulando en memoria.
    for (const url of Object.values(this.previas())) URL.revokeObjectURL(url);
  }

  filtrar(tipo: string): void { this.filtro.set(tipo); this.cargar(); }

  private cargar(): void {
    this.cargando.set(true);
    this.api.banco(this.filtro() || undefined).subscribe({
      next: (l) => {
        this.imagenes.set(l);
        this.cargando.set(false);
        // Se precargan las primeras: en un banco no muy grande se ven todas, y el hover
        // no existe en un móvil.
        for (const i of l.slice(0, 24)) this.previa(i);
      },
      error: () => this.cargando.set(false),
    });
  }

  previa(i: ImagenBanco): void {
    if (this.previas()[i.id]) return;
    this.api.imagenBanco(i.id).subscribe({
      next: (b) => this.previas.set({ ...this.previas(), [i.id]: URL.createObjectURL(b) }),
      error: () => {},
    });
  }

  urlPrevia(i: ImagenBanco): string | null { return this.previas()[i.id] ?? null; }

  // ── panel de una imagen ─────────────────────────────────────────────────

  abrir(i: ImagenBanco): void {
    this.abierta.set(i);
    this.consentimientos.set([]);
    this.api.consentimientosDe(i.id).subscribe({
      next: (c) => this.consentimientos.set(c),
      error: () => this.consentimientos.set([]),
    });
  }

  cerrar(): void { this.abierta.set(null); }

  // ── subir ───────────────────────────────────────────────────────────────

  async subir(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    input.value = '';   // permite volver a elegir el mismo archivo

    const r = await Swal.fire({
      title: 'Subir al banco',
      html: `<input id="t" class="swal2-input" placeholder="Título" maxlength="160">
             <select id="k" class="swal2-select">
               <option value="RECURSO">Recurso</option>
               <option value="FOTO_LUGAR">Foto de un lugar</option>
               <option value="FOTO_PERSONA">Foto de personas</option>
               <option value="FONDO">Fondo</option>
             </select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Subir',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const t = (document.getElementById('t') as HTMLInputElement).value.trim();
        if (!t) { Swal.showValidationMessage('Ponle un título'); return false; }
        return { titulo: t, tipo: (document.getElementById('k') as HTMLSelectElement).value };
      },
    });
    if (!r.isConfirmed || !r.value) return;

    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('titulo', r.value.titulo);
    fd.append('tipo', r.value.tipo);

    this.subiendo.set(true);
    this.api.subirAlBanco(fd).subscribe({
      next: (i) => {
        this.subiendo.set(false);
        this.cargar();
        if (i.exige_consentimiento) {
          Swal.fire({
            icon: 'info',
            title: 'Subida, pero todavía no se puede usar',
            text: 'Es una foto de personas: hace falta la autorización de uso de imagen '
                + 'firmada antes de poder ponerla en una pieza.',
          });
        } else {
          Swal.fire({ icon: 'success', title: 'Subida', timer: 1300, showConfirmButton: false });
        }
      },
      error: (e) => {
        this.subiendo.set(false);
        Swal.fire({ icon: 'error', title: 'Un momento', text: e?.error?.error ?? 'No se pudo subir' });
      },
    });
  }

  // ── autorización ────────────────────────────────────────────────────────

  async registrar(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const pdf = input.files?.[0];
    const img = this.abierta();
    if (!pdf || !img) return;
    input.value = '';

    const hoy = new Date().toISOString().slice(0, 10);
    const r = await Swal.fire({
      title: 'Autorización de uso de imagen',
      html: `<input id="c" class="swal2-input" placeholder="Cédula de la persona">
             <input id="n" class="swal2-input" placeholder="Nombre (opcional)">
             <label style="display:block;text-align:left;font-size:.85rem;margin:.6rem 0 0">Vigente desde</label>
             <input id="d" type="date" class="swal2-input" value="${hoy}">
             <label style="display:block;text-align:left;font-size:.85rem;margin:.6rem 0 0">Hasta (vacío = sin caducidad)</label>
             <input id="h" type="date" class="swal2-input">`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Registrar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const c = (document.getElementById('c') as HTMLInputElement).value.trim();
        if (!c) { Swal.showValidationMessage('Falta la cédula de la persona'); return false; }
        return {
          cedula: c,
          nombre: (document.getElementById('n') as HTMLInputElement).value.trim(),
          desde: (document.getElementById('d') as HTMLInputElement).value,
          hasta: (document.getElementById('h') as HTMLInputElement).value,
        };
      },
    });
    if (!r.isConfirmed || !r.value) return;

    const fd = new FormData();
    fd.append('autorizacion', pdf);
    fd.append('cedula', r.value.cedula);
    if (r.value.nombre) fd.append('nombre', r.value.nombre);
    if (r.value.desde) fd.append('vigenteDesde', r.value.desde);
    if (r.value.hasta) fd.append('vigenteHasta', r.value.hasta);

    this.api.registrarConsentimiento(img.id, fd).subscribe({
      next: () => { this.abrir(img); this.cargar();
                    Swal.fire({ icon: 'success', title: 'Registrada', timer: 1300, showConfirmButton: false }); },
      error: (e) => Swal.fire({ icon: 'error', title: 'Un momento',
                                text: e?.error?.error ?? 'No se pudo registrar' }),
    });
  }

  async revocar(c: Consentimiento): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning',
      title: '¿Retirar esta autorización?',
      input: 'text',
      inputPlaceholder: 'Motivo (queda registrado)',
      text: 'La imagen deja de poder usarse. El registro no se borra.',
      showCancelButton: true, confirmButtonText: 'Retirar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.api.revocarConsentimiento(c.id, r.value || 'Sin motivo indicado').subscribe({
      next: () => { const i = this.abierta(); if (i) this.abrir(i); this.cargar(); },
      error: () => Swal.fire({ icon: 'error', title: 'No se pudo retirar' }),
    });
  }

  etiquetaTipo(t: string): string {
    return this.tipos.find((x) => x.clave === t)?.etiqueta ?? t;
  }
}
