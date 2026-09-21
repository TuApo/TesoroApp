import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, take, timeout } from 'rxjs';
import { NavegacionService } from '../../../../../core/services/navegacion.service';

/**
 * Lo que un caso recuerda de la pantalla donde se estaba trabajando.
 *
 * <p>Un caso es una PESTAÑA: al abrirlo se congela la vista activa (ruta, título y lo que
 * había escrito en los formularios), y al volver a él se restaura tal cual para seguir
 * registrando datos. Es la misma idea que tener varias pestañas del navegador, pero
 * guardada en el servidor: sobrevive a recargar, se puede abrir en otra pestaña o en
 * otro equipo con la misma sesión, y no se pierde si se cierra el navegador.
 */
export interface VistaCaso {
  /** Ruta interna (con parámetros y query) donde se estaba. */
  ruta?: string;
  /** Nombre de la pantalla y del módulo, para mostrarlos en la pestaña. */
  titulo?: string;
  modulo?: string;
  /** Valores de los campos de la pantalla, por clave estable (name/formControlName/id). */
  campos?: Record<string, string | boolean>;
  /** Desplazamiento vertical del contenedor de página. */
  scroll?: number;
  /** Cuándo se tomó la foto. */
  guardado_en?: string;
}

/** Datos clave que se leen solos de la pantalla para nombrar y llenar el caso. */
export interface DatosDeLaVista {
  documento: string | null;
  persona_nombre: string | null;
  telefono: string | null;
  correo: string | null;
  motivo: string | null;
}

const SELECTOR_CAMPOS = 'input:not([type=hidden]):not([type=file]):not([type=password]):not([type=submit]):not([type=button]):not([type=search]), select, textarea';
const SELECTOR_PAGINA = '.dashboard-page-wrapper';

@Injectable({ providedIn: 'root' })
export class VistaCasoService {
  private router = inject(Router);
  private navegacion = inject(NavegacionService);

  private get pagina(): HTMLElement | null {
    return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(SELECTOR_PAGINA);
  }

  /** ¿La ruta actual es una pantalla de trabajo (no el propio módulo de turnos)? */
  esVistaDeTrabajo(url = this.router.url): boolean {
    return url.startsWith('/dashboard') && !url.startsWith('/dashboard/turnos');
  }

  /** Foto de la vista activa: ruta + campos con valor + scroll. */
  capturar(): VistaCaso {
    const v: VistaCaso = {
      ruta: this.router.url,
      titulo: this.navegacion.titulo() || undefined,
      modulo: this.navegacion.modulo() || undefined,
      guardado_en: new Date().toISOString(),
    };
    const pagina = this.pagina;
    if (!pagina) return v;
    const campos: Record<string, string | boolean> = {};
    this.camposDe(pagina).forEach(({ clave, el }) => {
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        if (el.checked) campos[clave] = true;
      } else if (el.value !== '' && el.value != null) {
        campos[clave] = el.value;
      }
    });
    if (Object.keys(campos).length) v.campos = campos;
    if (pagina.scrollTop) v.scroll = pagina.scrollTop;
    return v;
  }

  /**
   * Vuelve a la vista de un caso: navega a su ruta y, cuando la pantalla existe, vuelve a
   * poner cada valor donde estaba, disparando los eventos que Angular escucha para que
   * los formularios se enteren (input/change). Lo que la pantalla ya no tenga (un campo
   * que cambió de nombre) simplemente se omite.
   */
  async restaurar(v: VistaCaso | null | undefined): Promise<boolean> {
    if (!v?.ruta) return false;
    if (this.router.url !== v.ruta) {
      const navegado = this.router.navigateByUrl(v.ruta);
      try {
        await firstValueFrom(this.router.events.pipe(
          filter(e => e instanceof NavigationEnd), take(1), timeout(8000)));
      } catch { /* la navegación no terminó a tiempo; se intenta igual */ }
      await navegado.catch(() => false);
    }
    if (!v.campos || !Object.keys(v.campos).length) {
      if (v.scroll) this.esperarYDesplazar(v.scroll);
      return true;
    }
    // La pantalla puede tardar en pintar sus campos (datos que llegan por HTTP): se
    // reintenta durante unos segundos hasta que aparezca alguno de los guardados.
    const claves = new Set(Object.keys(v.campos));
    for (let intento = 0; intento < 20; intento++) {
      const pagina = this.pagina;
      const presentes = pagina ? this.camposDe(pagina).filter(c => claves.has(c.clave)) : [];
      if (presentes.length) {
        await new Promise(r => setTimeout(r, 150));
        this.aplicar(v.campos, this.camposDe(this.pagina!));
        if (v.scroll) this.esperarYDesplazar(v.scroll);
        return true;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return true;
  }

  /**
   * Lee de la pantalla los datos de la persona que se está atendiendo: campos cuyo
   * nombre habla de cédula, nombre, teléfono o correo, y lo que venga en la URL. Es lo
   * que hace que el caso se nombre solo ("1.099.999.001 · CAMILO H. · Contratación").
   */
  datosDeLaVista(): DatosDeLaVista {
    const out: DatosDeLaVista = { documento: null, persona_nombre: null, telefono: null, correo: null, motivo: null };
    const pagina = this.pagina;
    const valor = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => (el.value ?? '').toString().trim();
    if (pagina) {
      for (const { clave, el } of this.camposDe(pagina)) {
        const k = normalizar(clave + ' ' + (el.getAttribute('placeholder') ?? '') + ' ' + (el.getAttribute('aria-label') ?? ''));
        const v = valor(el);
        if (!v) continue;
        if (!out.documento && /(cedula|documento|identificacion|numero_doc|num_doc|nit)\b/.test(k) && !/fecha|expedicion|tipo/.test(k) && /^[\dxX][\d.]{4,}$/.test(v)) out.documento = v.replace(/\./g, '');
        else if (!out.persona_nombre && /(nombre|nombres|candidato|trabajador|persona)/.test(k) && !/empresa|usuaria|usuario|archivo|finca|cargo|vacante|oficina|sede|ciudad|banco/.test(k) && /[a-zA-ZáéíóúñÁÉÍÓÚÑ]{2,}/.test(v)) out.persona_nombre = v;
        else if (!out.telefono && /(telefono|celular|movil|whatsapp)/.test(k) && /\d{7,}/.test(v)) out.telefono = v;
        else if (!out.correo && /(correo|email|mail)/.test(k) && v.includes('@')) out.correo = v;
      }
      // Muchas fichas muestran la cédula como texto ("CC 1.099.999.001") y no en un campo.
      if (!out.documento) {
        const texto = pagina.innerText?.slice(0, 20000) ?? '';
        const m = /(?:c[eé]dula|documento|c\.?c\.?|identificaci[oó]n)[^\d]{0,12}(\d{1,3}(?:\.\d{3}){2,3}|\d{6,12})/i.exec(texto);
        if (m) out.documento = m[1].replace(/\./g, '');
      }
    }
    // La URL: /candidato/1099999001, ?cedula=… o ?documento=…
    try {
      const url = new URL(this.router.url, 'http://x');
      for (const q of ['cedula', 'documento', 'doc', 'numero_documento']) {
        const v = url.searchParams.get(q);
        if (v && !out.documento && /^[\dxX]\d{4,}$/.test(v)) out.documento = v;
      }
      if (!out.documento) {
        const seg = url.pathname.split('/').find(p => /^[xX]?\d{6,12}$/.test(p));
        if (seg) out.documento = seg;
      }
    } catch { /* sin URL válida */ }
    const titulo = this.navegacion.titulo();
    const modulo = this.navegacion.modulo();
    out.motivo = titulo ? (modulo && modulo !== titulo ? `${modulo} · ${titulo}` : titulo) : null;
    return out;
  }

  /** El enlace para abrir el caso en otra pestaña del navegador (misma sesión). */
  enlaceDeCaso(casoId: string): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}#/dashboard/turnos/caso/${casoId}`;
  }

  // ── Auxiliares ─────────────────────────────────────────────────────────

  private camposDe(pagina: HTMLElement): { clave: string; el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement }[] {
    const lista: { clave: string; el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement }[] = [];
    const vistos = new Map<string, number>();
    pagina.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(SELECTOR_CAMPOS).forEach((el, i) => {
      if (el.closest('app-panel-atencion')) return;
      let base = el.getAttribute('name') || el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name') || el.id || '';
      if (!base) base = `#${el.tagName.toLowerCase()}${i}`;
      if (el instanceof HTMLInputElement && el.type === 'radio' && el.value) base += '=' + el.value;
      const n = vistos.get(base) ?? 0;
      vistos.set(base, n + 1);
      lista.push({ clave: n ? `${base}@${n}` : base, el });
    });
    return lista;
  }

  private aplicar(campos: Record<string, string | boolean>, presentes: { clave: string; el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement }[]): void {
    for (const { clave, el } of presentes) {
      if (!(clave in campos)) continue;
      const v = campos[clave];
      try {
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
          if (el.checked !== (v === true)) { el.click(); }
          continue;
        }
        if (String(el.value) === String(v)) continue;
        el.focus();
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      } catch { /* campo de solo lectura o desmontado */ }
    }
  }

  private esperarYDesplazar(scroll: number): void {
    setTimeout(() => { const p = this.pagina; if (p) p.scrollTop = scroll; }, 200);
  }
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
