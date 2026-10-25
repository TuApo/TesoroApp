import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { OperadorService } from '../../../../../../core/services/operador/operador.service';
import {
  CatalogoPersonalidades, EstiloRespuesta, LongitudRespuesta, NuevaPersonalidad, PersonalidadOperador, TonoRespuesta,
} from '../../../../../../core/services/operador/operador.modelos';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';

/** ms-ai responde los errores como {mensaje}: ese texto se muestra tal cual. */
function textoError(e: unknown, respaldo: string): string {
  const m = (e as { error?: { mensaje?: unknown } })?.error?.mensaje;
  return typeof m === 'string' && m.trim() ? m : mensajeDeError(e, respaldo);
}

/** Lo que se edita en el diálogo (nueva o existente). */
interface Borrador extends NuevaPersonalidad {
  id: number | null;
}

const NOMBRE_ESTILO: Record<EstiloRespuesta, string> = {
  auto: 'Automática', directa: 'Directa', analitica: 'Analítica', ejecutiva: 'Ejecutiva', didactica: 'Didáctica', conversacional: 'Conversacional',
};
const NOMBRE_TONO: Record<TonoRespuesta, string> = { cercano: 'Cercano', formal: 'Formal', neutral: 'Neutral', motivador: 'Motivador' };
const NOMBRE_LONGITUD: Record<LongitudRespuesta, string> = { corta: 'Corta', media: 'Media', detallada: 'Detallada' };

/** Cómo sonaría una respuesta a «¿Cómo van las ventas de la semana?» con cada estilo (vista previa). */
const MUESTRA: Record<EstiloRespuesta, string> = {
  auto: 'Las ventas de la semana van en $ 48,2 M, un 6 % más que la anterior. ¿Te muestro el detalle por tienda?',
  directa: '$ 48,2 M esta semana (+6 %). Cajicá lidera.',
  analitica: 'Ventas: $ 48,2 M (+6 % vs. semana anterior). El alza viene de Cajicá (+14 %) por la promo de granos; Soacha cae 3 % por menos tráfico el martes. Conclusión: replicar la promo en Soacha.',
  ejecutiva: 'Vamos bien: $ 48,2 M (+6 %). Riesgo: Soacha bajando 3 %. Recomendación: extender la promo de granos a Soacha esta semana.',
  didactica: 'Para verlo tú mismo: 1) abre Tienda › Indicadores, 2) elige «Esta semana», 3) compara con la anterior. Hoy da $ 48,2 M, 6 % más. ¿Te llevo?',
  conversacional: '¡Buena semana! Llevamos unos 48 millones, un poquito más que la pasada. Cajicá está volando. ¿Quieres que miremos alguna tienda?',
};

const ICONOS = ['face', 'smart_toy', 'auto_awesome', 'psychology', 'bolt', 'query_stats', 'work', 'school', 'record_voice_over', 'support_agent', 'emoji_objects', 'favorite'];
const COLORES = ['#7C3AED', '#2563EB', '#0D9488', '#1F3A93', '#D97706', '#DB2777', '#16A34A', '#DC2626'];

/**
 * Herramientas IA › Personalidades IA: cómo responde el Asistente IA a cada persona. Hay estilos
 * predefinidos (automática, directa, analítica, ejecutiva, didáctica, conversacional) y cada quien
 * puede crear los suyos con tono, longitud, indicaciones propias y voz. La que queda «por defecto»
 * es la que usa el asistente (y sus automatizaciones); dentro del asistente se puede cambiar por
 * conversación con el selector «Respuesta».
 */
@Component({
  selector: 'app-personalidades-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, MatIconModule, MatTooltipModule],
  templateUrl: './personalidades-ia.html',
  styleUrls: ['../automatizaciones-ia/automatizaciones-ia.css', './personalidades-ia.css'],
})
export class PersonalidadesIa implements OnInit, OnDestroy {
  private op = inject(OperadorService);

  readonly catalogo = signal<CatalogoPersonalidades | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly borrador = signal<Borrador | null>(null);
  readonly guardando = signal(false);

  readonly activa = computed(() => this.catalogo()?.activa ?? 'auto');
  readonly nombreActiva = computed(() => {
    const c = this.catalogo();
    return [...(c?.predefinidas ?? []), ...(c?.propias ?? [])].find(p => p.clave === this.activa())?.nombre ?? 'Automática';
  });
  readonly muestra = computed(() => MUESTRA[this.borrador()?.estilo ?? 'auto']);

  readonly estilos: EstiloRespuesta[] = ['auto', 'directa', 'analitica', 'ejecutiva', 'didactica', 'conversacional'];
  readonly tonos: TonoRespuesta[] = ['cercano', 'formal', 'neutral', 'motivador'];
  readonly longitudes: LongitudRespuesta[] = ['corta', 'media', 'detallada'];
  readonly nombreEstilo = NOMBRE_ESTILO;
  readonly nombreTono = NOMBRE_TONO;
  readonly nombreLongitud = NOMBRE_LONGITUD;
  readonly iconos = ICONOS;
  readonly colores = COLORES;
  readonly ejemplos = [
    'Trátame de usted y cierra siempre con el siguiente paso.',
    'Muéstrame siempre una tabla y una gráfica cuando haya cifras.',
    'Habla como un coordinador de tienda: práctico y sin tecnicismos.',
    'Si te pido un informe, hazlo en PDF con resumen ejecutivo.',
  ];

  ngOnInit(): void { void this.cargar(); }

  ngOnDestroy(): void {
    try { window.speechSynthesis?.cancel(); } catch { /* sin voz */ }
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const c = await firstValueFrom(this.op.catalogoPersonalidades());
      this.catalogo.set(c);
      this.op.personalidades.set(c);
    } catch (e) {
      this.error.set(textoError(e, 'No se pudieron cargar las personalidades.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async usarPorDefecto(p: PersonalidadOperador): Promise<void> {
    try {
      const r = await firstValueFrom(this.op.activarPersonalidad(p.clave));
      this.catalogo.update(c => c ? { ...c, activa: r.activa } : c);
      this.op.personalidades.set(this.catalogo());
      const perfil = this.op.perfil();
      if (perfil) this.op.perfil.set({ ...perfil, personalidad: r.activa });
      this.aviso.set(`«${p.nombre}» quedó como la personalidad por defecto del asistente.`);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo activar.'));
    }
  }

  nueva(base?: PersonalidadOperador): void {
    this.aviso.set(null);
    this.borrador.set({
      id: null,
      nombre: base ? `${base.nombre} (mía)` : '',
      descripcion: base?.descripcion ?? '',
      estilo: base?.estilo ?? 'auto',
      tono: base?.tono ?? 'cercano',
      longitud: base?.longitud ?? 'media',
      instrucciones: '',
      voz: null,
      icono: base?.icono ?? 'face',
      color: base?.color ?? '#7C3AED',
    });
  }

  editar(p: PersonalidadOperador): void {
    this.aviso.set(null);
    this.borrador.set({
      id: p.id, nombre: p.nombre, descripcion: p.descripcion ?? '', estilo: p.estilo, tono: p.tono, longitud: p.longitud,
      instrucciones: p.instrucciones ?? '', voz: p.voz, icono: p.icono ?? 'face', color: p.color ?? '#7C3AED',
    });
  }

  cambiar<K extends keyof Borrador>(campo: K, valor: Borrador[K]): void {
    this.borrador.update(b => b ? { ...b, [campo]: valor } : b);
  }

  agregarEjemplo(t: string): void {
    const b = this.borrador();
    if (!b) return;
    const actual = (b.instrucciones ?? '').trim();
    this.cambiar('instrucciones', actual ? `${actual}\n${t}` : t);
  }

  async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    if (!b.nombre.trim()) { this.aviso.set('Ponle un nombre a la personalidad.'); return; }
    this.guardando.set(true);
    const cuerpo: NuevaPersonalidad = {
      nombre: b.nombre.trim(), descripcion: b.descripcion?.trim() || null, estilo: b.estilo, tono: b.tono, longitud: b.longitud,
      instrucciones: b.instrucciones?.trim() || null, voz: b.voz || null, icono: b.icono || null, color: b.color || null,
    };
    try {
      if (b.id) await firstValueFrom(this.op.cambiarPersonalidad(b.id, cuerpo));
      else await firstValueFrom(this.op.crearPersonalidad(cuerpo));
      this.borrador.set(null);
      this.aviso.set(b.id ? 'Cambios guardados.' : `Personalidad «${cuerpo.nombre}» creada. Elígela en el asistente o déjala por defecto.`);
      await this.cargar();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo guardar.'));
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminar(p: PersonalidadOperador): Promise<void> {
    if (!p.id || !confirm(`¿Eliminar la personalidad «${p.nombre}»?`)) return;
    try {
      await firstValueFrom(this.op.borrarPersonalidad(p.id));
      this.aviso.set(`Se eliminó «${p.nombre}».`);
      await this.cargar();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo eliminar.'));
    }
  }

  /**
   * Vista previa APROXIMADA con la voz del navegador: la voz real del asistente la genera el
   * servidor (OpenAI) con el nombre elegido y suena distinta.
   */
  probarVoz(): void {
    const b = this.borrador();
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.aviso.set('Este navegador no puede reproducir la vista previa de voz.');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(MUESTRA[b?.estilo ?? 'auto']);
      u.lang = 'es-CO';
      u.rate = b?.tono === 'formal' ? 0.95 : 1.05;
      window.speechSynthesis.speak(u);
    } catch { /* sin voz */ }
  }

  resumen(p: PersonalidadOperador): string {
    return `${NOMBRE_ESTILO[p.estilo] ?? p.estilo} · tono ${(NOMBRE_TONO[p.tono] ?? p.tono).toLowerCase()} · ${(NOMBRE_LONGITUD[p.longitud] ?? p.longitud).toLowerCase()}`;
  }
}
