import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { BotService } from '../../services/bot.service';
import { BotConfig, Buzon, Plataforma } from '../../models/bot.model';
import { PLATAFORMAS, PLATAFORMAS_CONFIGURABLES, nombreDiceBot } from '../../utils/bot';
import { mensajeError } from '../../../utils/texto';
import { fechaHora } from '../../../utils/tiempo';

/** Campos numéricos con sus topes (los mismos que valida el backend, para avisar antes). */
export const LIMITES: Record<string, { min: number; max: number }> = {
  capturas_cada_seg: { min: 5, max: 600 },
  clip_segundos: { min: 5, max: 180 },
  notas_cada_seg: { min: 20, max: 900 },
  salir_si_solo_min: { min: 1, max: 60 },
  duracion_max_min: { min: 10, max: 480 },
  sala_espera_max_min: { min: 1, max: 60 },
};

type CampoNumero = keyof typeof LIMITES & keyof BotConfig;

/**
 * Configuración del asistente de cada persona: con qué nombre entra, qué buzones del CRM
 * vigila para aceptar invitaciones, qué captura, cada cuánto escribe notas y cuándo sale.
 * Todo es por usuario: lo que se guarda aquí solo afecta a SU bot.
 */
@Component({
  selector: 'app-bot-config',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bot-config.component.html',
  styleUrls: ['../../../estilos/base.css', './bot-config.component.css'],
})
export class BotConfigComponent {
  private readonly api = inject(BotService);

  readonly PLATAFORMAS = PLATAFORMAS;
  readonly CONFIGURABLES = PLATAFORMAS_CONFIGURABLES;
  readonly LIMITES = LIMITES;
  readonly fechaHora = fechaHora;

  readonly cfg = signal<BotConfig | null>(null);
  readonly buzones = signal<Buzon[]>([]);
  readonly errorBuzones = signal('');
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly guardando = signal(false);
  readonly guardado = signal(false);
  readonly errorGuardar = signal('');
  readonly sucio = signal(false);

  readonly nombreOk = computed(() => nombreDiceBot(this.cfg()?.nombre_bot));
  readonly numerosOk = computed(() => {
    const c = this.cfg();
    if (!c) return false;
    return Object.entries(LIMITES).every(([k, l]) => {
      const v = Number((c as unknown as Record<string, unknown>)[k]);
      return Number.isFinite(v) && v >= l.min && v <= l.max;
    });
  });
  readonly buzonesSinConexion = computed(() => {
    const sel = new Set(this.cfg()?.buzones ?? []);
    return this.buzones().filter(b => sel.has(b.id) && b.estado && b.estado !== 'CONECTADO');
  });
  readonly invitacionesSinBuzon = computed(() => !!this.cfg()?.unirse_invitaciones && !(this.cfg()?.buzones?.length));
  readonly valido = computed(() => this.nombreOk() && this.numerosOk() && !this.invitacionesSinBuzon()
    && (this.cfg()?.plataformas?.length ?? 0) > 0);

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      this.cfg.set(await firstValueFrom(this.api.config()));
      this.sucio.set(false);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo cargar la configuración'));
    } finally {
      this.cargando.set(false);
    }
    try {
      this.buzones.set(await firstValueFrom(this.api.buzones()));
      this.errorBuzones.set('');
    } catch (e) {
      this.errorBuzones.set(mensajeError(e, 'No se pudieron leer tus correos del CRM'));
    }
  }

  set<K extends keyof BotConfig>(k: K, v: BotConfig[K]): void {
    this.cfg.update(c => (c ? { ...c, [k]: v } : c));
    this.sucio.set(true);
    this.guardado.set(false);
  }

  numero(k: CampoNumero, valor: string): void {
    const n = Number(valor);
    this.set(k, (Number.isFinite(n) ? Math.round(n) : 0) as never);
  }

  fueraDeRango(k: CampoNumero): boolean {
    const c = this.cfg();
    if (!c) return false;
    const v = Number(c[k]);
    const l = LIMITES[k];
    return !Number.isFinite(v) || v < l.min || v > l.max;
  }

  alternarBuzon(id: string, on: boolean): void {
    const actual = new Set(this.cfg()?.buzones ?? []);
    if (on) actual.add(id); else actual.delete(id);
    this.set('buzones', [...actual]);
  }

  alternarPlataforma(p: Plataforma, on: boolean): void {
    const actual = new Set(this.cfg()?.plataformas ?? []);
    if (on) actual.add(p); else actual.delete(p);
    this.set('plataformas', this.CONFIGURABLES.filter(x => actual.has(x)));
  }

  tieneBuzon(id: string): boolean { return (this.cfg()?.buzones ?? []).includes(id); }
  tienePlataforma(p: Plataforma): boolean { return (this.cfg()?.plataformas ?? []).includes(p); }

  async guardar(): Promise<void> {
    const c = this.cfg();
    if (!c || !this.valido() || this.guardando()) return;
    this.guardando.set(true);
    this.errorGuardar.set('');
    try {
      const nuevo = await firstValueFrom(this.api.guardarConfig({
        ...c,
        nombre_bot: c.nombre_bot.trim(),
        mensaje_presentacion: (c.mensaje_presentacion ?? '').trim(),
        instrucciones_ia: c.instrucciones_ia?.trim() || null,
      }));
      this.cfg.set(nuevo);
      this.sucio.set(false);
      this.guardado.set(true);
    } catch (e) {
      this.errorGuardar.set(mensajeError(e, 'No se pudo guardar la configuración'));
    } finally {
      this.guardando.set(false);
    }
  }
}
