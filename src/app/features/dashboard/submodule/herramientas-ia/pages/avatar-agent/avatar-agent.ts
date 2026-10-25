import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { AvatarAgente } from '../../../../../../shared/components/avatar-agente/avatar-agente';
import { AvatarAgenteService } from '../../../../../../shared/components/avatar-agente/avatar-agente.service';
import {
  AssetAvatar, EstadoAvatar, EstadoAvatarAgent, Personaje, PersonajeAdmin, RangoPersonaje, TipoAsset,
} from '../../../../../../shared/components/avatar-agente/avatar-agente.modelos';
import { MarkdownMessageComponent } from '../../../nomina/pages/analitica-nomina-ia/markdown-message.component';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';

/** ms-ai responde los errores como {mensaje}: ese texto se muestra tal cual. */
function textoError(e: unknown, respaldo: string): string {
  const m = (e as { error?: { mensaje?: unknown } })?.error?.mensaje;
  return typeof m === 'string' && m.trim() ? m : mensajeDeError(e, respaldo);
}

/** Lo que se edita: listas como texto para los campos de una línea por valor. */
interface Borrador {
  nuevo: boolean;
  clave: string;
  nombre: string;
  cargo: string;
  rango: RangoPersonaje;
  padreClave: string | null;
  modulos: string;
  rutas: string;
  colegas: string[];
  descripcion: string;
  personalidad: string;
  tono: string;
  voz: string | null;
  saludo: string;
  instrucciones: string;
  plantillaRespuesta: string;
  colorPrimario: string;
  colorSecundario: string;
  icono: string;
  promptVisual: string;
  orden: number;
  activo: boolean;
}

type Pestana = 'identidad' | 'caracter' | 'avatar' | 'prompt';

const NOMBRE_RANGO: Record<RangoPersonaje, string> = { PRESIDENTE: 'Presidente', DIRECTOR: 'Director(a)', ASESOR: 'Asesor(a)' };
const NOMBRE_TIPO: Record<TipoAsset, string> = { ESTATICO: 'Retrato', IDLE: 'Clip en reposo', HABLANDO: 'Clip hablando' };

/** Una respuesta de muestra para ver la plantilla con la cara del personaje. */
const MUESTRA = `Esta quincena van **128 contratados**, 12 % más que la anterior.

\`\`\`kpis
[{"etiqueta":"Inscritos","valor":"412"},{"etiqueta":"Contratados","valor":"128","detalle":"+12 %"},{"etiqueta":"Conversión","valor":"31 %"}]
\`\`\`

\`\`\`filtros
{"titulo":"Afinar","opciones":[{"campo":"oficina","etiqueta":"Oficina","valores":["SUBA","SOACHA","TOCANCIPA"]}]}
\`\`\``;

/**
 * Herramientas IA › Avatar Agent: el elenco que le da cara y carácter a la IA. Apo es el
 * presidente (la IA general) y cada módulo tiene su director; aquí se registran (nombre, cargo,
 * módulos y pantallas que atiende, carácter, estructura de respuesta, colegas con los que puede
 * resolver en conjunto) y se les da forma: retratos y clips con Higgsfield o subidos a mano.
 * Solo administración (ms-ai lo exige).
 */
@Component({
  selector: 'app-avatar-agent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgTemplateOutlet, MatIconModule, MatTooltipModule, AvatarAgente, MarkdownMessageComponent],
  templateUrl: './avatar-agent.html',
  styleUrls: ['../automatizaciones-ia/automatizaciones-ia.css', './avatar-agent.css'],
})
export class AvatarAgent implements OnInit, OnDestroy {
  private api = inject(AvatarAgenteService);

  readonly personajes = signal<PersonajeAdmin[]>([]);
  readonly estado = signal<EstadoAvatarAgent | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly borrador = signal<Borrador | null>(null);
  readonly pestana = signal<Pestana>('identidad');
  readonly guardando = signal(false);
  readonly assets = signal<AssetAvatar[]>([]);
  readonly prompt = signal<string | null>(null);
  readonly variantes = signal(2);
  readonly generando = signal(false);
  readonly estadoVista = signal<EstadoAvatar>('reposo');

  readonly nombreRango = NOMBRE_RANGO;
  readonly nombreTipo = NOMBRE_TIPO;
  readonly tipos: TipoAsset[] = ['ESTATICO', 'IDLE', 'HABLANDO'];
  readonly muestra = MUESTRA;

  readonly presidente = computed(() => this.personajes().find(p => p.rango === 'PRESIDENTE') ?? null);
  readonly directores = computed(() => this.personajes().filter(p => p.rango === 'DIRECTOR'));
  readonly asesoresDe = (clave: string) => this.personajes().filter(p => p.rango === 'ASESOR' && p.padreClave === clave);
  /** Asesores que no le reportan a un director (van en su propio grupo). */
  readonly huerfanos = computed(() => {
    const directores = new Set(this.directores().map(p => p.clave));
    return this.personajes().filter(p => p.rango === 'ASESOR' && !directores.has(p.padreClave ?? ''));
  });

  /** El personaje tal como lo pintaría el chat con lo que se está editando (vista previa en vivo). */
  readonly vistaPrevia = computed<Personaje | null>(() => {
    const b = this.borrador();
    if (!b) return null;
    const guardado = this.personajes().find(p => p.clave === b.clave);
    return {
      clave: b.clave || 'nuevo', nombre: b.nombre || 'Sin nombre', nombreCorto: (b.nombre || 'Sin nombre').split(' ')[0],
      cargo: b.cargo || 'Cargo', rango: b.rango, colorPrimario: b.colorPrimario, colorSecundario: b.colorSecundario,
      icono: b.icono || null, saludo: b.saludo, assets: guardado?.assets,
    };
  });

  private sondeo: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    void this.cargar();
  }

  ngOnDestroy(): void {
    this.pararSondeo();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [lista, estado] = await Promise.all([firstValueFrom(this.api.todos()), firstValueFrom(this.api.estado())]);
      this.personajes.set(lista);
      this.estado.set(estado);
    } catch (e) {
      this.error.set(textoError(e, 'No se pudo cargar el elenco.'));
    } finally {
      this.cargando.set(false);
    }
  }

  etiquetaEstado(p: PersonajeAdmin): string {
    return p.activo ? NOMBRE_RANGO[p.rango] ?? p.rango : 'Inactivo';
  }

  modulosDe(p: PersonajeAdmin): string {
    return p.modulos.length ? p.modulos.join(' · ') : 'Sin módulo';
  }

  // ── Edición ──

  nuevo(): void {
    this.abrir({
      nuevo: true, clave: '', nombre: '', cargo: '', rango: 'DIRECTOR', padreClave: this.presidente()?.clave ?? null,
      modulos: '', rutas: '', colegas: [], descripcion: '', personalidad: '', tono: 'cercano', voz: null, saludo: '',
      instrucciones: '', plantillaRespuesta: 'Resumen en una línea → ```kpis → tabla → ```echarts → ```filtros → siguientes pasos.',
      colorPrimario: '#4F46E5', colorSecundario: '#C7D2FE', icono: 'support_agent', promptVisual: '', orden: 100, activo: true,
    });
  }

  editar(p: PersonajeAdmin, pestana: Pestana = 'identidad'): void {
    this.abrir({
      nuevo: false, clave: p.clave, nombre: p.nombre, cargo: p.cargo, rango: p.rango, padreClave: p.padreClave ?? null,
      modulos: p.modulos.join(', '), rutas: p.rutas.join('\n'), colegas: [...p.colegas], descripcion: p.descripcion ?? '',
      personalidad: p.personalidad ?? '', tono: p.tono, voz: p.voz ?? null, saludo: p.saludo ?? '', instrucciones: p.instrucciones ?? '',
      plantillaRespuesta: p.plantillaRespuesta ?? '', colorPrimario: p.colorPrimario ?? '#4F46E5', colorSecundario: p.colorSecundario ?? '#C7D2FE',
      icono: p.icono ?? '', promptVisual: p.promptVisual ?? '', orden: p.orden, activo: p.activo,
    }, pestana);
  }

  private abrir(b: Borrador, pestana: Pestana = 'identidad'): void {
    this.aviso.set(null);
    this.prompt.set(null);
    this.assets.set([]);
    this.borrador.set(b);
    this.irA(b.nuevo ? 'identidad' : pestana);
  }

  cerrar(): void {
    this.borrador.set(null);
    this.pararSondeo();
  }

  cambiar<K extends keyof Borrador>(campo: K, valor: Borrador[K]): void {
    this.borrador.update(b => (b ? { ...b, [campo]: valor } : b));
  }

  alternarColega(clave: string): void {
    this.borrador.update(b => {
      if (!b) return b;
      const colegas = b.colegas.includes(clave) ? b.colegas.filter(c => c !== clave) : [...b.colegas, clave];
      return { ...b, colegas };
    });
  }

  irA(p: Pestana): void {
    this.pestana.set(p);
    const b = this.borrador();
    if (!b || b.nuevo) return;
    if (p === 'avatar') void this.cargarAssets();
    if (p === 'prompt') {
      this.prompt.set(null);
      this.api.prompt(b.clave).subscribe({
        next: r => this.prompt.set(r.prompt),
        error: e => this.prompt.set(textoError(e, 'No se pudo armar el prompt.')),
      });
    }
  }

  async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    this.guardando.set(true);
    this.aviso.set(null);
    const cuerpo: Partial<PersonajeAdmin> = {
      nombre: b.nombre, cargo: b.cargo, rango: b.rango, padreClave: b.padreClave || null,
      modulos: separar(b.modulos, /[,\n]/), rutas: separar(b.rutas, /\n/), colegas: b.colegas,
      descripcion: b.descripcion, personalidad: b.personalidad, tono: b.tono, voz: b.voz || null, saludo: b.saludo,
      instrucciones: b.instrucciones, plantillaRespuesta: b.plantillaRespuesta, colorPrimario: b.colorPrimario,
      colorSecundario: b.colorSecundario, icono: b.icono || null, promptVisual: b.promptVisual, orden: b.orden, activo: b.activo,
    };
    try {
      const r = b.nuevo
        ? await firstValueFrom(this.api.crear({ ...cuerpo, clave: b.clave.trim() }))
        : await firstValueFrom(this.api.actualizar(b.clave, cuerpo));
      this.personajes.update(l => (b.nuevo ? [...l, r] : l.map(p => (p.clave === r.clave ? r : p))).sort((x, y) => x.orden - y.orden));
      this.api.cargar(true);
      if (b.nuevo) {
        this.editar(r, 'avatar');
        this.aviso.set('Personaje creado. Ahora dele forma: genere su retrato o súbalo.');
      } else {
        this.aviso.set('Cambios guardados. El chat los usa desde el próximo mensaje.');
      }
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo guardar.'));
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Avatar ──

  async cargarAssets(): Promise<void> {
    const b = this.borrador();
    if (!b || b.nuevo) return;
    try {
      const lista = await firstValueFrom(this.api.assets(b.clave));
      this.assets.set(lista);
      if (lista.some(a => a.estado === 'ENVIADO')) this.iniciarSondeo();
      else this.pararSondeo();
      this.refrescarSeleccion(lista);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudieron cargar los archivos.'));
    }
  }

  assetsDe(tipo: TipoAsset): AssetAvatar[] {
    return this.assets().filter(a => a.tipo === tipo);
  }

  url(a: AssetAvatar) {
    return this.api.urlAsset(a.id);
  }

  async generar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    this.generando.set(true);
    this.aviso.set(null);
    try {
      this.assets.set(await firstValueFrom(this.api.generarRetratos(b.clave, this.variantes(), b.promptVisual)));
      this.aviso.set('Retratos enviados a Higgsfield. Tardan uno o dos minutos; esta pantalla se actualiza sola.');
      this.iniciarSondeo();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudieron generar los retratos.'));
    } finally {
      this.generando.set(false);
    }
  }

  async animar(a: AssetAvatar, tipo: 'IDLE' | 'HABLANDO'): Promise<void> {
    this.aviso.set(null);
    try {
      const nuevo = await firstValueFrom(this.api.animar(a.id, tipo));
      this.assets.update(l => [nuevo, ...l]);
      this.aviso.set(`Clip «${NOMBRE_TIPO[tipo].toLowerCase()}» enviado a Higgsfield. Tarda unos minutos.`);
      this.iniciarSondeo();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo animar el retrato.'));
    }
  }

  async seleccionar(a: AssetAvatar): Promise<void> {
    try {
      await firstValueFrom(this.api.seleccionar(a.id));
      await this.cargarAssets();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo seleccionar.'));
    }
  }

  async eliminar(a: AssetAvatar): Promise<void> {
    if (!confirm(`¿Eliminar este ${NOMBRE_TIPO[a.tipo].toLowerCase()}?`)) return;
    try {
      await firstValueFrom(this.api.eliminar(a.id));
      await this.cargarAssets();
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo eliminar.'));
    }
  }

  async subir(tipo: TipoAsset, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    const b = this.borrador();
    if (!f || !b) return;
    this.aviso.set(null);
    try {
      await firstValueFrom(this.api.subir(b.clave, tipo, f));
      await this.cargarAssets();
      this.aviso.set(`${NOMBRE_TIPO[tipo]} subido y seleccionado.`);
    } catch (e) {
      this.aviso.set(textoError(e, 'No se pudo subir el archivo.'));
    }
  }

  /** Lo seleccionado pasa al elenco de la tabla y al del chat (la vista previa lo usa). */
  private refrescarSeleccion(lista: AssetAvatar[]): void {
    const b = this.borrador();
    if (!b) return;
    const sel: Partial<Record<TipoAsset, number>> = {};
    for (const a of lista) if (a.seleccionado && a.estado === 'LISTO') sel[a.tipo] = a.id;
    this.personajes.update(l => l.map(p => (p.clave === b.clave ? { ...p, assets: sel } : p)));
    this.api.cargar(true);
  }

  private iniciarSondeo(): void {
    if (this.sondeo) return;
    this.sondeo = setInterval(() => void this.cargarAssets(), 10_000);
  }

  private pararSondeo(): void {
    if (this.sondeo) clearInterval(this.sondeo);
    this.sondeo = null;
  }
}

function separar(texto: string, sep: RegExp): string[] {
  return (texto ?? '').split(sep).map(s => s.trim()).filter(Boolean);
}
