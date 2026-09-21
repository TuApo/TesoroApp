import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, take, timeout } from 'rxjs';
import { NavegacionService } from '../../../../../core/services/navegacion.service';
import { AdaptadorVistaCaso, PersonaEnVista, RegistroVistaCaso } from '../../../../../core/services/vista-caso.registro';

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
  /** Controles de Material que no son campos nativos: mat-select y grupos de botones, por clave → texto elegido. */
  material?: Record<string, string>;
  /** Desplazamiento vertical del contenedor de página. */
  scroll?: number;
  /**
   * Estado propio de la pantalla, cuando ella lo describe (ver `AdaptadorVistaCaso`): la
   * persona buscada y el paso abierto, por ejemplo. Al volver, la pantalla lo repone por
   * sus propios caminos en vez de rellenarse a mano.
   */
  estado?: unknown;
  /** La persona y el motivo que la pantalla dice tener al frente. */
  persona?: PersonaEnVista;
  /** Resumen corto del estado ("Selección · Entrevista"). */
  resumen?: string;
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
  private registro = inject(RegistroVistaCaso);

  /** Avance de la restauración en curso (0–100) o null si no hay ninguna. Lo pinta el panel. */
  readonly progreso = signal<number | null>(null);

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
    // Una pantalla con adaptador guarda SU estado (persona, paso) y decide si sus campos
    // se fotografían: los que se cargan del servidor no.
    const a = this.registro.adaptador();
    if (a) {
      try {
        v.ruta = a.ruta?.() ?? v.ruta;
        const estado = a.capturar();
        if (estado !== null && estado !== undefined) v.estado = estado;
        const persona = a.persona?.();
        if (persona) v.persona = persona;
        const resumen = a.resumen?.();
        if (resumen) v.resumen = resumen;
      } catch { /* la pantalla no pudo describirse: se guarda como cualquier otra */ }
      if (a.camposDom === false) {
        const pagina = this.pagina;
        if (pagina?.scrollTop) v.scroll = pagina.scrollTop;
        return v;
      }
    }
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
    const material = this.materialDe(pagina);
    if (Object.keys(material).length) v.material = material;
    if (pagina.scrollTop) v.scroll = pagina.scrollTop;
    return v;
  }

  /**
   * Un nombre que resuma lo que hay en la pantalla: el título y lo más distintivo de lo
   * que se estaba viendo (la persona si la hay; si no, lo buscado, el rango de fechas y
   * los filtros elegidos). Es el nombre de la pestaña del caso; se puede cambiar a mano.
   */
  resumenDeLaVista(): string {
    const titulo = this.navegacion.titulo() || 'Pantalla';
    const partes: string[] = [];
    const datos = this.datosDeLaVista();
    if (datos.documento || datos.persona_nombre) {
      partes.push([datos.persona_nombre, datos.documento].filter(Boolean).join(' '));
    }
    // La pantalla que sabe describirse lo hace mejor que cualquier lectura de campos.
    const a = this.registro.adaptador();
    if (a) {
      const r = a.resumen?.();
      if (r) partes.push(r);
      return recortar([titulo, ...partes].join(' · '));
    }
    const pagina = this.pagina;
    if (pagina && partes.length < 2) {
      const textos: string[] = [];
      const fechas: string[] = [];
      for (const { clave, el } of this.camposDe(pagina)) {
        const v = (el.value ?? '').toString().trim();
        if (!v || el instanceof HTMLSelectElement) continue;
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden')) continue;
        const k = normalizar(clave + ' ' + (el.getAttribute('placeholder') ?? ''));
        if (el instanceof HTMLInputElement && (el.type === 'date' || /fecha|date|desde|hasta|inicio|fin/.test(k))) { fechas.push(v); continue; }
        if (v.length >= 3 && !/^\d{1,3}$/.test(v)) textos.push(v);
      }
      if (textos.length) partes.push(textos.slice(0, 2).join(', '));
      if (fechas.length) partes.push(fechas.length >= 2 ? `${fechas[0]} – ${fechas[1]}` : fechas[0]);
      const material = this.materialDe(pagina);
      const filtros = Object.values(material).filter(t => t && !/^(todas|todos|ninguno|ninguna|—|-)$/i.test(t)).slice(0, 2);
      if (filtros.length && partes.length < 3) partes.push(filtros.join(', '));
    }
    return recortar([titulo, ...partes].join(' · '));
  }

  /** mat-select y grupos de botones de Material: clave → texto que se ve elegido. */
  private materialDe(pagina: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    const vistos = new Map<string, number>();
    const clave = (el: Element, base: string, i: number) => {
      let k = el.getAttribute('formcontrolname') || el.getAttribute('name') || el.getAttribute('aria-label') || el.id || `${base}#${i}`;
      if (/^mat-/.test(k) && el.getAttribute('aria-labelledby')) {
        const lbl = pagina.querySelector('#' + el.getAttribute('aria-labelledby')!.split(' ')[0]);
        if (lbl?.textContent?.trim()) k = base + ':' + lbl.textContent.trim();
      }
      const n = vistos.get(k) ?? 0; vistos.set(k, n + 1);
      return n ? `${k}@${n}` : k;
    };
    pagina.querySelectorAll<HTMLElement>('mat-select').forEach((el, i) => {
      if (el.closest('app-panel-atencion')) return;
      const texto = el.querySelector('.mat-mdc-select-value-text, .mat-select-value-text')?.textContent?.trim() ?? '';
      if (texto) out['sel:' + clave(el, 'select', i)] = texto;
    });
    pagina.querySelectorAll<HTMLElement>('mat-button-toggle-group').forEach((el, i) => {
      if (el.closest('app-panel-atencion')) return;
      const on = el.querySelector('mat-button-toggle.mat-button-toggle-checked, [aria-pressed="true"], [aria-checked="true"]');
      const texto = on?.textContent?.trim() ?? '';
      if (texto) out['tog:' + clave(el, 'toggle', i)] = texto;
    });
    return out;
  }

  /**
   * Vuelve a la vista de un caso: navega a su ruta y, cuando la pantalla existe, vuelve a
   * poner cada valor donde estaba, disparando los eventos que Angular escucha para que
   * los formularios se enteren (input/change). Lo que la pantalla ya no tenga (un campo
   * que cambió de nombre) simplemente se omite.
   */
  async restaurar(v: VistaCaso | null | undefined): Promise<boolean> {
    if (!v?.ruta) return false;
    this.progreso.set(5);
    try {
      if (this.router.url !== v.ruta) {
        this.progreso.set(15);
        const navegado = this.router.navigateByUrl(v.ruta);
        try {
          await firstValueFrom(this.router.events.pipe(
            filter(e => e instanceof NavigationEnd), take(1), timeout(8000)));
        } catch { /* la navegación no terminó a tiempo; se intenta igual */ }
        await navegado.catch(() => false);
      }
      this.avanzar(40);
      // Pantalla que sabe reponerse (la persona, el paso): lo hace ella. Puede tardar en
      // existir (es un trozo que se carga aparte), así que con estado guardado se la espera.
      const conEstado = v.estado !== undefined && v.estado !== null;
      const a = conEstado ? await this.esperarAdaptador(v.ruta, 10_000) : this.adaptadorDe(v.ruta);
      if (a && conEstado) {
        try {
          await a.restaurar(v.estado, p => this.avanzar(40 + Math.round(Math.max(0, Math.min(1, p)) * 50)));
        } catch { /* la pantalla no pudo: se sigue con lo demás */ }
        this.avanzar(90);
      }
      // Una pantalla que carga sus campos del servidor no acepta que se le escriban encima
      // (ni los de una foto vieja, tomada antes de que supiera describirse).
      const sinCampos = a?.camposDom === false;
      const hayCampos = !sinCampos && !!v.campos && Object.keys(v.campos).length > 0;
      const hayMaterial = !sinCampos && !!v.material && Object.keys(v.material).length > 0;
      if (!hayCampos && !hayMaterial) {
        if (v.scroll) this.esperarYDesplazar(v.scroll);
        this.avanzar(100);
        return true;
      }
      // La pantalla puede tardar en pintar sus campos (datos que llegan por HTTP): se
      // reintenta durante unos segundos hasta que aparezca alguno de los guardados.
      const claves = new Set(Object.keys(v.campos ?? {}));
      const clavesMat = new Set(Object.keys(v.material ?? {}));
      for (let intento = 0; intento < 24; intento++) {
        this.avanzar(Math.min(85, 40 + intento * 2));
        const pagina = this.pagina;
        const presentes = pagina ? this.camposDe(pagina).filter(c => claves.has(c.clave)) : [];
        const presentesMat = pagina ? Object.keys(this.materialDe(pagina)).filter(k => clavesMat.has(k)) : [];
        if (presentes.length || presentesMat.length) {
          await new Promise(r => setTimeout(r, 150));
          this.avanzar(88);
          if (hayMaterial) await this.aplicarMaterial(v.material!);
          this.avanzar(95);
          if (hayCampos) this.aplicar(v.campos!, this.camposDe(this.pagina!));
          if (v.scroll) this.esperarYDesplazar(v.scroll);
          this.avanzar(100);
          return true;
        }
        await new Promise(r => setTimeout(r, 250));
      }
      this.avanzar(100);
      return true;
    } finally {
      // Se deja ver el 100 % un instante y se apaga.
      setTimeout(() => this.progreso.set(null), 700);
    }
  }

  /** La barra solo avanza: los tramos de la pantalla y los de los campos no se pisan. */
  private avanzar(hasta: number): void {
    this.progreso.update(p => Math.max(p ?? 0, hasta));
  }

  /** El adaptador registrado, si es el de la pantalla de esa ruta. */
  private adaptadorDe(ruta: string): AdaptadorVistaCaso | null {
    const a = this.registro.adaptador();
    return a && mismaPantalla(a.ruta?.() ?? this.router.url, ruta) ? a : null;
  }

  /** Espera al adaptador de la pantalla de la ruta pedida (la pantalla puede estar cargándose). */
  private async esperarAdaptador(ruta: string, ms: number): Promise<AdaptadorVistaCaso | null> {
    const inicio = Date.now();
    for (;;) {
      const a = this.adaptadorDe(ruta);
      if (a) return a;
      if (Date.now() - inicio > ms) return null;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /**
   * Repone mat-select y grupos de botones: se abre el selector y se pulsa la opción cuyo
   * texto coincide con el guardado. Es lo que Material entiende; escribirle el valor por
   * dentro no dispararía sus eventos.
   */
  private async aplicarMaterial(material: Record<string, string>): Promise<void> {
    const pagina = this.pagina;
    if (!pagina || typeof document === 'undefined') return;
    const actual = this.materialDe(pagina);
    // Se empareja por orden de aparición: es el mismo recorrido de la captura.
    const selects = Array.from(pagina.querySelectorAll<HTMLElement>('mat-select')).filter(el => !el.closest('app-panel-atencion'));
    const clavesSel = Object.keys(actual).filter(k => k.startsWith('sel:'));
    for (let n = 0; n < selects.length && n < clavesSel.length; n++) {
      const k = clavesSel[n];
      const deseado = material[k];
      if (!deseado || actual[k] === deseado) continue;
      const el = selects[n];
      try {
        el.click();
        await new Promise(r => setTimeout(r, 220));
        const opciones = Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'));
        const opcion = opciones.find(o => o.textContent?.trim() === deseado);
        if (opcion) opcion.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
      } catch { /* selector desmontado */ }
    }
    const grupos = Array.from(pagina.querySelectorAll<HTMLElement>('mat-button-toggle-group')).filter(el => !el.closest('app-panel-atencion'));
    const clavesTog = Object.keys(actual).filter(k => k.startsWith('tog:'));
    for (let n = 0; n < grupos.length && n < clavesTog.length; n++) {
      const deseado = material[clavesTog[n]];
      if (!deseado || actual[clavesTog[n]] === deseado) continue;
      const boton = Array.from(grupos[n].querySelectorAll<HTMLElement>('mat-button-toggle button, mat-button-toggle')).find(b => b.textContent?.trim() === deseado);
      try { boton?.click(); } catch { /* nada */ }
    }
  }

  /**
   * Lee de la pantalla los datos de la persona que se está atendiendo: campos cuyo
   * nombre habla de cédula, nombre, teléfono o correo, y lo que venga en la URL. Es lo
   * que hace que el caso se nombre solo ("1.099.999.001 · CAMILO H. · Contratación").
   */
  datosDeLaVista(): DatosDeLaVista {
    const out: DatosDeLaVista = { documento: null, persona_nombre: null, telefono: null, correo: null, motivo: null };
    // La pantalla que sabe quién tiene al frente lo dice ella; no se adivina en los campos.
    const persona = this.registro.adaptador()?.persona?.();
    if (persona) {
      out.documento = persona.documento ?? null;
      out.persona_nombre = persona.persona_nombre ?? null;
      out.telefono = persona.telefono ?? null;
      out.correo = persona.correo ?? null;
      out.motivo = persona.motivo ?? this.motivoDeLaRuta();
      return out;
    }
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
    out.motivo = this.motivoDeLaRuta();
    return out;
  }

  /** "Módulo · Pantalla" como motivo por defecto de un caso. */
  private motivoDeLaRuta(): string | null {
    const titulo = this.navegacion.titulo();
    const modulo = this.navegacion.modulo();
    return titulo ? (modulo && modulo !== titulo ? `${modulo} · ${titulo}` : titulo) : null;
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

/** ¿Dos URL son la misma pantalla? Se compara la ruta sin query ni fragmento. */
export function mismaPantalla(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ruta = (u: string) => u.split(/[?#]/)[0].replace(/\/+$/, '');
  return ruta(a) === ruta(b);
}

function recortar(nombre: string): string {
  return nombre.length > 90 ? nombre.slice(0, 89) + '…' : nombre;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
