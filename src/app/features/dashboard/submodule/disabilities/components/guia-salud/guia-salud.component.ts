import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  OnDestroy,
  PLATFORM_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import { getLocalStorageItem, setLocalStorageItem } from '@/app/core/utils/safe-storage';
import { etiquetaNivel, nivelSalud, usaFormularioSimplificado } from '../../utils/nivel-salud';
import { ClavePantalla, GuiaPantalla, PasoGuia, pantallaDeRuta } from './guia-salud.modelo';
import { GUIAS_SALUD, guiasDelNivel } from './guia-salud.contenido';
import { ModoRecorrido, PasoRecorrido, iniciarRecorrido } from './recorrido-guiado';

/** Marca "ya vio la guia de esta pantalla" (por navegador): el boton deja de latir. */
export const CLAVE_GUIA_VISTA = 'tuapo.salud.guia.vista.';

/** Nombre del CustomEvent con el que la guia le da ordenes a la pantalla (hoy solo al registro). */
export const EVENTO_GUIA = 'tuapo-guia';

/** Pasos que aplican al formulario del usuario (simplificado del nivel 1 o completo). */
export function pasosParaUsuario(guia: GuiaPantalla, simplificado: boolean): PasoGuia[] {
  return guia.pasos.filter((p) => (simplificado ? !p.soloCompleto : !p.soloSimplificado));
}

/** Los pasos con ancla, listos para el recorrido (con sus acciones y condiciones de simulacion). */
export function pasosDelRecorrido(pasos: readonly PasoGuia[]): PasoRecorrido[] {
  return pasos
    .filter((p) => !!p.ancla)
    .map((p) => ({
      ancla: p.ancla as string,
      titulo: p.titulo,
      texto: p.texto,
      acciones: p.acciones,
      listo: p.listo,
      practica: p.practica,
    }));
}

/**
 * "¿Como se hace?" de Salud (reunion funcional 2026-10-20: instructivo dentro del programa para
 * apoyar las capacitaciones; 2026-10-21: "casi como una simulacion que los guie"). Un boton flotante
 * abre los pasos de la pantalla actual segun el nivel del usuario y ofrece dos simulaciones sobre la
 * pantalla real: "Mira como se hace" (la guia escribe, abre las listas y elige) y "Practica paso a
 * paso" (la guia abre solo la parte que toca y espera a que la persona lo haga). Detecta la pantalla
 * por la URL: basta con poner `<app-guia-salud />` en cada pagina.
 */
@Component({
  selector: 'app-guia-salud',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (guia(); as g) {
      <button
        type="button"
        class="gs-fab"
        [class.gs-fab--nuevo]="primeraVez()"
        (click)="alternar()"
        [attr.aria-expanded]="abierto()"
        aria-controls="gs-panel"
        [matTooltip]="primeraVez() ? '¿Primera vez aquí? Mira cómo se hace' : 'Guía rápida de esta pantalla'"
        matTooltipPosition="left"
      >
        <mat-icon aria-hidden="true">{{ abierto() ? 'close' : 'help' }}</mat-icon>
        <span class="gs-fab-texto">¿Cómo se hace?</span>
      </button>

      @if (abierto()) {
        <section id="gs-panel" class="gs-panel" role="dialog" aria-label="Guía rápida" (keydown.escape)="cerrar()">
          <header class="gs-cabecera">
            <mat-icon class="gs-cabecera-icono" aria-hidden="true">{{ g.icono }}</mat-icon>
            <div class="gs-cabecera-textos">
              <span class="gs-eyebrow">Guía rápida{{ etiquetaNivel ? ' · ' + etiquetaNivel : '' }}</span>
              <h2 class="gs-titulo">{{ g.titulo }}</h2>
            </div>
            <button mat-icon-button type="button" (click)="cerrar()" aria-label="Cerrar la guía">
              <mat-icon>close</mat-icon>
            </button>
          </header>

          <div class="gs-cuerpo">
            <p class="gs-resumen">{{ g.resumen }}</p>

            @if (esLaPantallaActual() && haySimulacion()) {
              <div class="gs-modos">
                <button mat-flat-button type="button" class="gs-recorrido" (click)="recorrer('demo')">
                  <mat-icon>play_circle</mat-icon>
                  Mira cómo se hace
                </button>
                <button mat-stroked-button type="button" class="gs-recorrido" (click)="recorrer('practica')">
                  <mat-icon>touch_app</mat-icon>
                  Practica paso a paso
                </button>
              </div>
              <p class="gs-nota">La simulación se hace sobre esta misma pantalla y no guarda nada.</p>
            } @else if (esLaPantallaActual() && hayRecorrido()) {
              <button mat-flat-button type="button" class="gs-recorrido" (click)="recorrer('ver')">
                <mat-icon>play_circle</mat-icon>
                Recorrido guiado por la pantalla
              </button>
            } @else if (!esLaPantallaActual()) {
              <a mat-stroked-button class="gs-recorrido" [routerLink]="g.ruta" (click)="cerrar()">
                <mat-icon>open_in_new</mat-icon>
                Ir a esta pantalla
              </a>
            }

            <ol class="gs-pasos">
              @for (paso of pasos(); track $index) {
                <li class="gs-paso">
                  <span class="gs-paso-numero">{{ $index + 1 }}</span>
                  <div class="gs-paso-textos">
                    <strong class="gs-paso-titulo">
                      <mat-icon aria-hidden="true">{{ paso.icono }}</mat-icon>
                      {{ paso.titulo }}
                    </strong>
                    <p class="gs-paso-texto">{{ paso.texto }}</p>
                  </div>
                </li>
              }
            </ol>

            @if (g.consejos.length) {
              <div class="gs-consejos">
                <strong><mat-icon aria-hidden="true">tips_and_updates</mat-icon> Consejos</strong>
                <ul>
                  @for (c of g.consejos; track $index) {
                    <li>{{ c }}</li>
                  }
                </ul>
              </div>
            }

            @if (otras().length) {
              <div class="gs-otras">
                <strong>Otras guías de tu perfil</strong>
                <div class="gs-otras-lista">
                  @for (o of otras(); track o.clave) {
                    <button type="button" class="gs-otra" (click)="seleccion.set(o.clave)">
                      <mat-icon aria-hidden="true">{{ o.icono }}</mat-icon>
                      {{ o.titulo }}
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }
    }
  `,
  styles: `
    :host { position: relative; z-index: 900; }
    .gs-fab {
      position: fixed; right: 18px; bottom: 96px; z-index: 900; display: inline-flex; align-items: center;
      gap: 8px; border: 0; border-radius: 28px; padding: 12px 18px 12px 14px; cursor: pointer;
      background: #1565c0; color: #fff; font: inherit; font-weight: 700; font-size: 15px;
      box-shadow: 0 8px 22px rgba(13, 71, 161, 0.35);
    }
    .gs-fab:hover { background: #0d47a1; }
    .gs-fab:focus-visible { outline: 3px solid #90caf9; outline-offset: 2px; }
    .gs-fab--nuevo { animation: gs-latido 1.6s ease-in-out infinite; }
    @keyframes gs-latido {
      0%, 100% { box-shadow: 0 8px 22px rgba(13, 71, 161, 0.35), 0 0 0 0 rgba(66, 165, 245, 0.55); }
      50% { box-shadow: 0 8px 22px rgba(13, 71, 161, 0.35), 0 0 0 12px rgba(66, 165, 245, 0); }
    }
    .gs-panel {
      position: fixed; right: 18px; bottom: 156px; z-index: 901; width: min(420px, calc(100vw - 24px));
      max-height: calc(100vh - 190px); display: flex; flex-direction: column; overflow: hidden;
      background: var(--mat-sys-surface-container-lowest, #fff); color: var(--mat-sys-on-surface, #1f2937);
      border-radius: 18px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
      border: 1px solid var(--mat-sys-outline-variant, #e0e0e0);
    }
    .gs-cabecera {
      display: flex; align-items: center; gap: 12px; padding: 14px 10px 12px 16px;
      background: linear-gradient(135deg, #1565c0, #1e88e5); color: #fff;
    }
    .gs-cabecera button { color: #fff; }
    .gs-cabecera-icono { font-size: 30px; width: 30px; height: 30px; }
    .gs-cabecera-textos { flex: 1; min-width: 0; }
    .gs-eyebrow { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; opacity: .9; }
    .gs-titulo { margin: 2px 0 0; font-size: 18px; font-weight: 800; }
    .gs-cuerpo { overflow: auto; padding: 14px 16px 18px; }
    .gs-resumen { margin: 0 0 12px; color: var(--mat-sys-on-surface-variant, #455a64); }
    .gs-modos { display: grid; gap: 8px; }
    .gs-recorrido { width: 100%; margin-bottom: 14px; }
    .gs-modos .gs-recorrido { margin-bottom: 0; }
    .gs-nota { margin: 8px 0 14px; font-size: 13px; color: var(--mat-sys-on-surface-variant, #607d8b); }
    .gs-pasos { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .gs-paso {
      display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 12px;
      background: var(--mat-sys-surface-container, #f5f7fb);
    }
    .gs-paso-numero {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
      background: #1976d2; color: #fff; font-weight: 800; font-size: 14px;
    }
    .gs-paso-titulo { display: flex; align-items: center; gap: 6px; font-size: 15px; }
    .gs-paso-titulo mat-icon { font-size: 18px; width: 18px; height: 18px; color: #1976d2; }
    .gs-paso-texto { margin: 4px 0 0; font-size: 14px; white-space: pre-line; color: var(--mat-sys-on-surface-variant, #455a64); }
    .gs-consejos {
      margin-top: 14px; padding: 10px 12px; border-radius: 12px; border-left: 4px solid #f9a825;
      background: color-mix(in srgb, #fff59d 35%, transparent); font-size: 14px;
    }
    .gs-consejos strong { display: flex; align-items: center; gap: 6px; }
    .gs-consejos ul { margin: 6px 0 0; padding-left: 18px; }
    .gs-otras { margin-top: 16px; font-size: 14px; }
    .gs-otras-lista { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .gs-otra {
      display: inline-flex; align-items: center; gap: 6px; border: 1px solid #90caf9; border-radius: 18px;
      background: transparent; color: inherit; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 13px;
    }
    .gs-otra mat-icon { font-size: 16px; width: 16px; height: 16px; color: #1976d2; }
    @media (max-width: 600px) {
      .gs-fab { right: 12px; bottom: 88px; padding: 12px; }
      .gs-fab-texto { display: none; }
      .gs-panel { right: 12px; left: 12px; width: auto; bottom: 146px; }
    }
    @media (prefers-reduced-motion: reduce) { .gs-fab--nuevo { animation: none; } }
  `,
})
export class GuiaSaludComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly navegador = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly roles = obtenerUsuarioActual().roles;
  private detenerRecorrido: (() => void) | null = null;

  /** Para forzar una pantalla (si no, se toma de la URL). */
  readonly pantalla = input<ClavePantalla | null>(null);

  readonly nivel = nivelSalud(this.roles);
  readonly etiquetaNivel = etiquetaNivel(this.nivel);
  readonly simplificado = usaFormularioSimplificado(this.roles);

  readonly pantallaActual = computed<ClavePantalla | null>(
    () => this.pantalla() ?? pantallaDeRuta(this.router.url),
  );
  readonly seleccion = signal<ClavePantalla | null>(null);
  readonly abierto = signal(false);

  readonly guia = computed<GuiaPantalla | null>(() => {
    const clave = this.seleccion() ?? this.pantallaActual();
    return clave ? GUIAS_SALUD[clave] : null;
  });
  readonly esLaPantallaActual = computed(() => (this.guia()?.clave ?? null) === this.pantallaActual());
  readonly pasos = computed(() => {
    const g = this.guia();
    return g ? pasosParaUsuario(g, this.simplificado && g.clave === 'registro') : [];
  });
  readonly hayRecorrido = computed(() => this.pasos().some((p) => !!p.ancla));
  /** Algun paso se puede simular (acciones) o practicar (condicion). */
  readonly haySimulacion = computed(() => this.pasos().some((p) => !!p.ancla && (!!p.acciones?.length || !!p.listo)));
  readonly otras = computed(() =>
    guiasDelNivel(this.nivel).filter((g) => g.clave !== this.guia()?.clave),
  );
  readonly primeraVez = signal(this.esPrimeraVez());

  alternar(): void {
    if (this.abierto()) {
      this.cerrar();
    } else {
      this.seleccion.set(null);
      this.abierto.set(true);
      this.marcarVista();
    }
  }

  cerrar(): void {
    this.abierto.set(false);
    this.seleccion.set(null);
  }

  /**
   * Cierra el panel y recorre la pantalla. En `demo` la guia ejecuta cada paso sobre el formulario
   * real; en `practica` lo hace la persona. El registro se avisa (evento `tuapo-guia`) para que se
   * limpie, bloquee el guardado y al final muestre el radicado de ejemplo.
   */
  async recorrer(modo: ModoRecorrido): Promise<void> {
    if (!this.navegador) return;
    const g = this.guia();
    if (!g) return;
    const pasos = pasosDelRecorrido(this.pasos());
    const avisaAlRegistro = modo !== 'ver' && g.clave === 'registro';
    if (avisaAlRegistro && this.doc.querySelector('[data-guia-con-datos]')) {
      const respuesta = await Swal.fire({
        icon: 'question',
        title: '¿Empezamos la simulación?',
        text: 'El formulario tiene datos y la simulación lo deja en blanco. Si estabas registrando una incapacidad real, guárdala primero.',
        showCancelButton: true,
        confirmButtonText: 'Sí, empezar',
        cancelButtonText: 'No, volver',
        confirmButtonColor: '#1976d2',
      });
      if (!respuesta.isConfirmed) return;
    }
    this.cerrar();
    this.detenerRecorrido?.();
    if (avisaAlRegistro) this.avisar('inicio-simulacion', g.clave);
    this.detenerRecorrido = iniciarRecorrido(this.doc, pasos, {
      modo,
      alTerminar: (completado) => {
        this.detenerRecorrido = null;
        if (avisaAlRegistro) this.avisar('fin-simulacion', g.clave, completado);
      },
    });
  }

  ngOnDestroy(): void {
    this.detenerRecorrido?.();
  }

  private avisar(accion: string, pantalla: ClavePantalla, completado?: boolean): void {
    this.doc.dispatchEvent(new CustomEvent(EVENTO_GUIA, { detail: { accion, pantalla, completado } }));
  }

  private esPrimeraVez(): boolean {
    const clave = this.pantallaActual();
    if (!this.navegador || !clave) return false;
    return getLocalStorageItem(CLAVE_GUIA_VISTA + clave) === null;
  }

  private marcarVista(): void {
    const clave = this.pantallaActual();
    if (!this.navegador || !clave) return;
    try {
      setLocalStorageItem(CLAVE_GUIA_VISTA + clave, '1');
    } catch {
      /* sin almacenamiento: el boton seguira latiendo, nada mas */
    }
    this.primeraVez.set(false);
  }
}
