import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import {
  Integracion, MediosService, ResumenIntegraciones, VozEleven,
} from '../../../training/service/medios.service';
import { mensajeDeError } from '../../../training/service/disenador.service';

interface Opcion { valor: string; etiqueta: string; }

/**
 * INTEROPERABILIDAD: los servicios externos de los que depende Capacitaciones (y sus aulas en
 * vivo), en un solo lugar: si están conectados, de dónde sale la llave, para qué se usan y si
 * responden.
 *
 * La llave se escribe aquí y no vuelve a mostrarse: se guarda cifrada en el servidor y la
 * pantalla solo ve sus últimos cuatro caracteres. Si la fija el servidor (.env), se muestra
 * como "del servidor" y no se puede pisar desde aquí.
 */
@Component({
  selector: 'app-interoperabilidad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, DatePipe],
  templateUrl: './interoperabilidad.component.html',
  styleUrl: './interoperabilidad.component.css',
})
export class InteroperabilidadComponent implements OnInit {
  private api = inject(MediosService);

  readonly datos = signal<ResumenIntegraciones | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal<string | null>(null);
  readonly voces = signal<VozEleven[]>([]);

  /** Edición por proveedor: llave nueva y ajustes. */
  secretos: Record<string, string> = {};
  ajustes: Record<string, Record<string, string>> = {};

  readonly iconos: Record<string, string> = {
    ELEVENLABS: 'record_voice_over', HIGGSFIELD: 'movie_filter', YOUTUBE: 'smart_display',
    LIVEKIT: 'video_camera_front', PISTON: 'terminal',
  };

  readonly etiquetasAjuste: Record<string, string> = {
    voz_narrador: 'Voz del narrador', voz_segunda: 'Segunda voz (podcast)', modelo_tts: 'Modelo de voz',
    modelo_stt: 'Modelo de transcripción', modelo_video: 'Modelo de video', modelo_imagen: 'Modelo de imagen',
    duracion_seg: 'Duración del clip (s)', formato: 'Formato', region: 'Región', busqueda_segura: 'Búsqueda segura',
    url_publica: 'URL para el navegador (wss://)', url_interna: 'URL interna (API)', api_key: 'API key',
    url: 'URL del servidor', lenguajes: 'Lenguajes',
  };

  readonly opciones: Record<string, Opcion[]> = {
    modelo_tts: [
      { valor: 'eleven_multilingual_v2', etiqueta: 'Multilingual v2 (natural, 10.000 caracteres)' },
      { valor: 'eleven_v3', etiqueta: 'v3 (el más expresivo)' },
      { valor: 'eleven_flash_v2_5', etiqueta: 'Flash v2.5 (rápido y económico)' },
    ],
    modelo_stt: [{ valor: 'scribe_v2', etiqueta: 'Scribe v2' }],
    modelo_video: [
      { valor: 'kling-video/v3.0/std/text-to-video', etiqueta: 'Kling 3.0 estándar (con sonido, 3–15 s)' },
      { valor: 'bytedance/seedance-2.0/text-to-video', etiqueta: 'Seedance 2.0 (720p–4K)' },
    ],
    modelo_imagen: [{ valor: 'higgsfield-ai/soul/v2/standard', etiqueta: 'Soul 2 (imagen)' }],
    formato: [{ valor: '16:9', etiqueta: '16:9 horizontal' }, { valor: '9:16', etiqueta: '9:16 vertical' }, { valor: '1:1', etiqueta: '1:1 cuadrado' }],
    busqueda_segura: [{ valor: 'strict', etiqueta: 'Estricta' }, { valor: 'moderate', etiqueta: 'Moderada' }],
  };

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const d = await this.api.integraciones();
      this.datos.set(d);
      for (const p of d.proveedores) {
        // Cada ajuste arranca en '' (y no undefined) para que el selector muestre "Por defecto".
        this.ajustes[p.proveedor] = Object.fromEntries(p.ajustes_disponibles.map(a => [a, p.ajustes[a] ?? '']));
        this.secretos[p.proveedor] ??= '';
      }
      if (d.proveedores.find(p => p.proveedor === 'ELEVENLABS')?.configurado) {
        this.api.voces().then(v => this.voces.set(v)).catch(() => undefined);
      }
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar la interoperabilidad'));
    } finally {
      this.cargando.set(false);
    }
  }

  estado(p: Integracion): { clase: string; texto: string } {
    if (!p.habilitado) return { clase: 'neutro', texto: 'Apagado' };
    if (!p.configurado) return { clase: 'neutro', texto: 'Sin configurar' };
    if (p.estado_prueba === 'ERROR') return { clase: 'error', texto: 'Con error' };
    if (p.estado_prueba === 'OK') return { clase: 'ok', texto: 'Conectado' };
    return { clase: 'info', texto: 'Configurado' };
  }

  origen(p: Integracion): string {
    return p.origen === 'ENTORNO' ? 'Del servidor (.env)' : p.origen === 'GUARDADA' ? 'Guardada aquí (cifrada)' : 'Sin llave';
  }

  fijado(p: Integracion, clave: string): boolean {
    return p.ajustes_fijados.includes(clave);
  }

  async guardar(p: Integracion, habilitado?: boolean): Promise<void> {
    this.ocupado.set(p.proveedor);
    try {
      const secreto = this.secretos[p.proveedor]?.trim();
      const act = await this.api.guardarIntegracion(p.proveedor, {
        habilitado: habilitado ?? p.habilitado,
        ajustes: this.ajustes[p.proveedor],
        secreto: secreto ? secreto : null,
      });
      this.secretos[p.proveedor] = '';
      this.reemplazar(act);
      if (secreto) await this.probar(act);
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e) });
    } finally {
      this.ocupado.set(null);
    }
  }

  async borrarLlave(p: Integracion): Promise<void> {
    const r = await Swal.fire({ icon: 'warning', title: `¿Quitar la llave de ${p.nombre}?`, text: 'Lo que dependa de ella deja de funcionar.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar' });
    if (!r.isConfirmed) return;
    this.ocupado.set(p.proveedor);
    try {
      this.reemplazar(await this.api.guardarIntegracion(p.proveedor, { secreto: '' }));
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo', text: mensajeDeError(e) });
    } finally {
      this.ocupado.set(null);
    }
  }

  async probar(p: Integracion): Promise<void> {
    this.ocupado.set(p.proveedor);
    try {
      const r = await this.api.probarIntegracion(p.proveedor);
      await this.cargar();
      Swal.fire({ toast: true, position: 'top-end', timer: 3500, showConfirmButton: false,
        icon: r.ok ? 'success' : 'error', title: r.ok ? `${p.nombre}: ${r.mensaje}` : r.mensaje });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo probar', text: mensajeDeError(e) });
    } finally {
      this.ocupado.set(null);
    }
  }

  private reemplazar(p: Integracion): void {
    const d = this.datos();
    if (!d) return;
    this.datos.set({ ...d, proveedores: d.proveedores.map(x => x.proveedor === p.proveedor ? p : x) });
    this.ajustes[p.proveedor] = Object.fromEntries(p.ajustes_disponibles.map(a => [a, p.ajustes[a] ?? '']));
  }
}
