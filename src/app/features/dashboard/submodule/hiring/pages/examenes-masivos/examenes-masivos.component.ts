import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import {
  AccionMasiva,
  BadgeCelda,
  ColumnaTabla,
  TABLA_ESTANDAR,
} from '@/app/shared/components/tabla-estandar';
import {
  CONCEPTOS_EXAMEN,
  ConceptoExamen,
  etiquetaConcepto,
  normalizarConcepto,
} from '../recruitment-pipeline/examen-medico.rules';
import {
  CRUCES_CORREGIBLES,
  CRUCES_SUBIBLES,
  EstadoCruce,
  MAX_ARCHIVOS_LOTE,
  TAM_MAX_ARCHIVO,
  armarTandas,
  contarConceptos,
  entradaZipEsExamen,
  esPdfPorNombre,
  esZipPorNombre,
  hoyLocal,
  motivoNoSubible,
  nombreBase,
  tamanoLegible,
} from './examenes-masivos.util';
import {
  ExamenesMasivosService,
  ItemLote,
  LoteExamenes,
} from './examenes-masivos.service';
import { ExamenIdentidadBandejaComponent } from '../../components/examen-identidad-bandeja/examen-identidad-bandeja.component';

/** Una fila de la revisión: el item del backend + el PDF que está en el navegador. */
export interface FilaExamen extends ItemLote {
  /** El PDF leído en esta pantalla (no viaja al backend hasta subir). */
  archivoLocal: File | null;
  /** Bytes, para armar las tandas. */
  tamano: number;
  /** El operador la sacó del lote. */
  excluida: boolean;
  /** Corrigiendo la cédula (petición en vuelo). */
  corrigiendo: boolean;
}

type Fase = 'inicio' | 'leyendo' | 'revision' | 'subiendo' | 'fin';

const ETIQUETA_CRUCE: Record<EstadoCruce, string> = {
  OK: 'Listo',
  AVISO: 'Revisar',
  SIN_CEDULA: 'Sin cédula',
  SIN_CANDIDATO: 'No registrada',
  VARIAS_CEDULAS: 'Varias cédulas',
  SIN_PROCESO: 'Sin proceso',
  YA_CONTRATADO: 'Ya contratada',
  PROCESO_CERRADO: 'Proceso cerrado',
  FUERA_DE_ALCANCE: 'Otra oficina',
};

/**
 * Carga masiva de exámenes médicos (pedido #11).
 *
 * Las IPS devuelven los exámenes en tanda, un PDF por persona (o un ZIP con
 * todos) con la cédula en el nombre. Flujo:
 *  1. Se arrastran los PDF o el ZIP. El ZIP se abre en el navegador (JSZip) y
 *     solo se toman sus PDF.
 *  2. ms-hr lee la cédula de cada nombre (también las que empiezan por X),
 *     la cruza con la persona y su proceso abierto y devuelve la tabla.
 *  3. Se revisa y corrige: cédula mal leída, concepto (sin valor por defecto),
 *     restricciones y fecha del examen.
 *  4. Se confirma y se sube por tandas: cada PDF va al expediente (tipo 32),
 *     el concepto al proceso (origen MASIVO), se enciende la etapa de
 *     exámenes, NO APTO rechaza y se genera el código de contrato.
 *
 * Partir un PDF consolidado (varias personas en un archivo) queda fuera.
 */
@Component({
  selector: 'app-examenes-masivos',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
    ExamenIdentidadBandejaComponent,
  ],
  templateUrl: './examenes-masivos.component.html',
  styleUrl: './examenes-masivos.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExamenesMasivosComponent implements OnInit {
  private readonly api = inject(ExamenesMasivosService);

  readonly CONCEPTOS = CONCEPTOS_EXAMEN;
  readonly etiquetaConcepto = etiquetaConcepto;
  readonly tamanoLegible = tamanoLegible;
  readonly hoy = hoyLocal();
  readonly TAM_MAX_TEXTO = tamanoLegible(TAM_MAX_ARCHIVO);

  /** Las mismas IPS del pipeline (Exámenes de ingreso). Solo informativa en el lote. */
  readonly IPS_OPCIONES: readonly string[] = [
    'JAVAP', 'ESTRATEGO', 'HELSEN', 'ASISTIR', 'SIGMEDICAL', 'PORSALUD',
    'ASTON MEDICAL', 'ACR VITAL', 'SANILAB', 'KAREN SOTELO',
    'JOHON VLADIMIR CRISTANCHO',
  ];

  // ── Estado ────────────────────────────────────────────────────────────

  readonly fase = signal<Fase>('inicio');
  readonly arrastrando = signal(false);
  readonly error = signal('');
  /** Archivos que no entraron al lote y por qué. */
  readonly avisosLectura = signal<string[]>([]);
  readonly lote = signal<LoteExamenes | null>(null);
  readonly filas = signal<FilaExamen[]>([]);
  readonly ips = signal('');
  readonly conceptoParaTodas = signal<ConceptoExamen | null>(null);
  readonly fechaParaTodas = signal('');
  readonly progreso = signal({ hechos: 0, total: 0 });
  readonly deteniendo = signal(false);
  readonly recientes = signal<LoteExamenes[]>([]);
  private detener = false;

  // ── Derivados ─────────────────────────────────────────────────────────

  /** Filas que van a subirse: se cruzaron, no se quitaron y no están subidas. */
  readonly porSubir = computed(() =>
    this.filas().filter((f) => !f.excluida && f.estado_carga !== 'SUBIDO'
      && CRUCES_SUBIBLES.includes(f.estado_cruce)));

  /** De esas, las que aún no están listas (sin concepto, sin restricciones…). */
  readonly incompletas = computed(() => this.porSubir().filter((f) => !!motivoNoSubible(f, this.hoy)));

  readonly sinCruce = computed(() =>
    this.filas().filter((f) => !f.excluida && !CRUCES_SUBIBLES.includes(f.estado_cruce)).length);

  readonly subidas = computed(() => this.filas().filter((f) => f.estado_carga === 'SUBIDO').length);
  readonly fallidas = computed(() => this.filas().filter((f) => f.estado_carga === 'ERROR').length);

  readonly pct = computed(() => {
    const p = this.progreso();
    return p.total ? Math.round((p.hechos / p.total) * 100) : 0;
  });

  readonly bloqueada = computed(() => this.fase() === 'subiendo' || this.fase() === 'leyendo');

  // ── Tabla ─────────────────────────────────────────────────────────────

  readonly idFila = (f: FilaExamen) => f.id;

  readonly claseFila = (f: FilaExamen): string => {
    if (f.excluida) return 'te-fila--atenuada';
    if (f.estado_carga === 'SUBIDO') return 'te-fila--ok';
    if (f.estado_carga === 'ERROR') return 'te-fila--peligro';
    if (!CRUCES_SUBIBLES.includes(f.estado_cruce)) return 'te-fila--alerta';
    return '';
  };

  readonly columnas: ColumnaTabla<FilaExamen>[] = [
    { id: 'persona', header: 'Persona', valor: (f) => f.nombre, tarjeta: 'titulo', minAncho: '170px',
      formato: (f) => f.nombre || '—' },
    { id: 'cedula', header: 'Cédula', valor: (f) => f.cedula, tarjeta: 'subtitulo', interactiva: true, minAncho: '130px' },
    { id: 'archivo', header: 'Archivo', valor: (f) => f.archivo, minAncho: '180px', tarjeta: 'meta', prioridad: 2 },
    { id: 'cruce', header: 'Cruce', valor: (f) => ETIQUETA_CRUCE[f.estado_cruce] ?? f.estado_cruce,
      badge: (f) => this.badgeCruce(f), align: 'center', tarjeta: 'badge' },
    // El error de la subida manda sobre el detalle del cruce: es lo que hay que arreglar.
    { id: 'detalle', header: 'Detalle', minAncho: '200px', prioridad: 2, tarjeta: 'cuerpo',
      valor: (f) => (f.error ? `Error al subir: ${f.error}` : f.mensaje) },
    { id: 'concepto', header: 'Concepto', valor: (f) => (f.concepto ? etiquetaConcepto(f.concepto) : ''),
      interactiva: true, minAncho: '170px' },
    { id: 'restricciones', header: 'Restricciones', valor: (f) => f.restricciones, interactiva: true,
      minAncho: '180px', prioridad: 2 },
    { id: 'fecha', header: 'Fecha realización del examen', valor: (f) => f.fecha_examen, interactiva: true, minAncho: '140px', prioridad: 2 },
    { id: 'carga', header: 'Carga', valor: (f) => this.textoCarga(f), badge: (f) => this.badgeCarga(f),
      align: 'center', minAncho: '120px' },
    { id: 'proceso', header: 'Proceso', valor: (f) => f.proceso_id, align: 'right', prioridad: 3 },
    { id: 'codigo', header: 'Código contrato', valor: (f) => f.codigo_contrato, prioridad: 3 },
  ];

  readonly acciones: AccionMasiva<FilaExamen>[] = [
    {
      id: 'concepto', etiqueta: 'Poner concepto', icono: 'medical_information', tono: 'primario',
      aplicaA: (f) => !f.excluida && f.estado_carga !== 'SUBIDO' && CRUCES_SUBIBLES.includes(f.estado_cruce),
      confirmar: {
        titulo: (fs) => `Concepto para ${fs.length} examen(es)`,
        texto: 'Se pone en pantalla; no se sube nada hasta confirmar la carga.',
        icono: 'question',
        opciones: {
          etiqueta: 'Concepto',
          valores: () => CONCEPTOS_EXAMEN.map((o) => ({ valor: o.valor, texto: o.etiqueta })),
        },
        boton: 'Aplicar',
      },
      ejecutar: async (f, ctx) => { this.cambiarConcepto(f, ctx.opcion); },
      etiquetaFila: (f) => `${f.nombre || f.archivo} (${f.cedula || 's/c'})`,
      verbo: 'actualizada(s)',
    },
    {
      id: 'quitar', etiqueta: 'Quitar del lote', icono: 'remove_circle_outline', tono: 'aviso',
      aplicaA: (f) => !f.excluida && f.estado_carga !== 'SUBIDO',
      confirmar: {
        texto: 'No se suben. Se pueden volver a incluir desde la fila.',
        icono: 'warning',
      },
      ejecutar: async (f) => { this.actualizar(f.id, { excluida: true }); },
      etiquetaFila: (f) => f.archivo,
      verbo: 'quitada(s)',
    },
  ];

  ngOnInit(): void {
    this.api.recientes().subscribe({ next: (ls) => this.recientes.set(ls ?? []), error: () => { } });
  }

  // ── Lectura de archivos ───────────────────────────────────────────────

  alSeleccionar(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const lista = input.files ? Array.from(input.files) : [];
    // Se limpia para que volver a elegir los MISMOS archivos dispare `change`.
    input.value = '';
    void this.tomarArchivos(lista);
  }

  alArrastrarEncima(evento: DragEvent): void {
    evento.preventDefault();
    if (!this.bloqueada()) this.arrastrando.set(true);
  }

  alSalirArrastre(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
  }

  alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
    if (this.bloqueada()) return;
    void this.tomarArchivos(evento.dataTransfer?.files ? Array.from(evento.dataTransfer.files) : []);
  }

  /** PDF sueltos y/o ZIP → vista previa en ms-hr → filas nuevas de la revisión. */
  async tomarArchivos(archivos: File[]): Promise<void> {
    if (!archivos.length || this.bloqueada()) return;
    this.error.set('');
    const faseAntes = this.filas().length ? 'revision' : 'inicio';
    this.fase.set('leyendo');

    const avisos: string[] = [];
    const pdfs: { nombre: string; file: File }[] = [];
    for (const a of archivos) {
      if (esZipPorNombre(a.name)) {
        try {
          const extraidos = await this.leerZip(a);
          if (!extraidos.length) avisos.push(`${a.name}: el ZIP no trae ningún PDF.`);
          pdfs.push(...extraidos);
        } catch {
          avisos.push(`${a.name}: no se pudo abrir el ZIP.`);
        }
      } else if (esPdfPorNombre(a.name)) {
        pdfs.push({ nombre: a.name, file: a });
      } else {
        avisos.push(`${a.name}: no es PDF ni ZIP; se omitió.`);
      }
    }

    const validos = pdfs.filter((p) => {
      if (p.file.size === 0) { avisos.push(`${p.nombre}: está vacío; se omitió.`); return false; }
      if (p.file.size > TAM_MAX_ARCHIVO) {
        avisos.push(`${p.nombre}: pesa ${tamanoLegible(p.file.size)} (máximo ${this.TAM_MAX_TEXTO}); se omitió.`);
        return false;
      }
      return true;
    });
    const cupo = MAX_ARCHIVOS_LOTE - this.filas().length;
    if (validos.length > cupo) {
      avisos.push(`Máximo ${MAX_ARCHIVOS_LOTE} archivos por lote: quedaron fuera ${validos.length - Math.max(0, cupo)}.`);
      validos.splice(Math.max(0, cupo));
    }
    this.avisosLectura.update((a) => [...a, ...avisos]);
    if (!validos.length) {
      this.fase.set(faseAntes);
      return;
    }

    try {
      const resp = await firstValueFrom(this.api.preview(
        validos.map((v) => ({ nombre: v.nombre, tamano: v.file.size })),
        this.ips(), this.lote()?.id ?? null));
      this.lote.set(resp.lote);
      // Cada fila se queda con SU PDF: por posición si el nombre coincide (ms-hr guarda los
      // primeros 255 caracteres) y, si no (el backend omitió alguno), buscándolo por nombre.
      // Sin PDF la fila no se sube ("Faltan archivos"): nunca el examen de otra persona.
      const clave = (n: string) => String(n ?? '').slice(0, 255);
      const usados = new Set<number>();
      const nuevas = (resp.items ?? []).map((it, i) => {
        let j = i < validos.length && !usados.has(i) && clave(validos[i].nombre) === it.archivo ? i : -1;
        if (j < 0) j = validos.findIndex((v, k) => !usados.has(k) && clave(v.nombre) === it.archivo);
        if (j >= 0) usados.add(j);
        return this.aFila(it, j >= 0 ? validos[j].file : null);
      });
      this.filas.update((fs) => [...fs, ...nuevas]);
      this.fase.set('revision');
    } catch (err) {
      this.error.set(this.mensajeDeError(err, 'No se pudieron leer los archivos.'));
      this.fase.set(faseAntes);
    }
  }

  /** Abre el ZIP en el navegador y devuelve sus PDF (con la ruta interna como nombre). */
  private async leerZip(zip: File): Promise<{ nombre: string; file: File }[]> {
    const mod: any = await import('jszip');
    const JSZip = mod.default ?? mod;
    const z = await JSZip.loadAsync(zip);
    const out: { nombre: string; file: File }[] = [];
    for (const e of Object.values<any>(z.files)) {
      if (!entradaZipEsExamen(e.name, e.dir)) continue;
      const blob: Blob = await e.async('blob');
      out.push({ nombre: e.name, file: new File([blob], nombreBase(e.name), { type: 'application/pdf' }) });
    }
    return out;
  }

  private aFila(it: ItemLote, file: File | null): FilaExamen {
    return {
      ...it,
      concepto: normalizarConcepto(it.concepto),
      // La fecha sí puede venir de "para todas"; el concepto NUNCA viene por defecto.
      fecha_examen: it.fecha_examen || this.fechaParaTodas() || null,
      archivoLocal: file,
      tamano: file?.size ?? it.tamano_bytes ?? 0,
      excluida: false,
      corrigiendo: false,
    };
  }

  // ── Edición de la revisión ────────────────────────────────────────────

  private actualizar(id: number | null | undefined, cambios: Partial<FilaExamen>): void {
    if (id == null) return;
    this.filas.update((fs) => fs.map((f): FilaExamen => (f.id === id ? { ...f, ...cambios } : f)));
  }

  editable(f: FilaExamen): boolean {
    return !this.bloqueada() && !f.excluida && f.estado_carga !== 'SUBIDO'
      && CRUCES_SUBIBLES.includes(f.estado_cruce);
  }

  corregible(f: FilaExamen): boolean {
    return !this.bloqueada() && f.estado_carga !== 'SUBIDO' && CRUCES_CORREGIBLES.includes(f.estado_cruce);
  }

  cambiarConcepto(f: FilaExamen, valor: unknown): void {
    const concepto = normalizarConcepto(valor);
    this.actualizar(f.id, {
      concepto,
      // Las restricciones solo acompañan a APTO CON RESTRICCIONES.
      restricciones: concepto === 'APTO_CON_RESTRICCIONES' ? f.restricciones : null,
    });
  }

  cambiarRestricciones(f: FilaExamen, valor: string): void {
    this.actualizar(f.id, { restricciones: String(valor ?? '').trim() || null });
  }

  cambiarFecha(f: FilaExamen, valor: string): void {
    this.actualizar(f.id, { fecha_examen: valor || null });
  }

  incluir(f: FilaExamen): void {
    this.actualizar(f.id, { excluida: false });
  }

  excluir(f: FilaExamen): void {
    this.actualizar(f.id, { excluida: true });
  }

  /** La cédula leída del nombre estaba mal o no había: se escribe y se vuelve a cruzar. */
  async corregirCedula(f: FilaExamen, valor: string): Promise<void> {
    const cedula = String(valor ?? '').trim();
    if (!cedula || cedula === f.cedula) return;
    this.actualizar(f.id, { corrigiendo: true });
    try {
      const it = await firstValueFrom(this.api.corregirCedula(f.id, cedula));
      this.actualizar(f.id, { ...it, concepto: normalizarConcepto(f.concepto), corrigiendo: false });
    } catch (err) {
      this.actualizar(f.id, { corrigiendo: false });
      await Swal.fire({ icon: 'error', title: 'No se pudo cruzar', text: this.mensajeDeError(err, 'Intenta de nuevo.') });
    }
  }

  verPdf(f: FilaExamen): void {
    if (!f.archivoLocal) return;
    const url = URL.createObjectURL(f.archivoLocal);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Concepto y fecha "para todas": solo donde aún no hay (no pisa lo ya decidido). */
  aplicarATodas(): void {
    const concepto = this.conceptoParaTodas();
    const fecha = this.fechaParaTodas();
    if (!concepto && !fecha) return;
    this.filas.update((fs) => fs.map((f): FilaExamen => {
      if (f.excluida || f.estado_carga === 'SUBIDO' || !CRUCES_SUBIBLES.includes(f.estado_cruce)) return f;
      const cambios: Partial<FilaExamen> = {};
      if (concepto && !f.concepto) cambios.concepto = concepto;
      if (fecha && !f.fecha_examen) cambios.fecha_examen = fecha;
      return { ...f, ...cambios };
    }));
  }

  // ── Subida ────────────────────────────────────────────────────────────

  async subir(): Promise<void> {
    const lote = this.lote();
    if (!lote || this.bloqueada()) return;
    const listas = this.porSubir();
    if (!listas.length) {
      await Swal.fire({ icon: 'info', title: 'Nada por subir', text: 'No hay filas cruzadas pendientes de subir.' });
      return;
    }
    const incompletas = this.incompletas();
    if (incompletas.length) {
      const muestra = incompletas.slice(0, 8)
        .map((f) => `<li>${this.escapar(f.nombre || f.archivo)}: ${motivoNoSubible(f, this.hoy)}</li>`).join('');
      await Swal.fire({
        icon: 'warning',
        title: `${incompletas.length} fila(s) sin terminar`,
        html: `<p style="margin:0 0 6px">Complétalas o quítalas del lote antes de subir:</p>
               <ul style="text-align:left;margin:0;padding-left:18px">${muestra}</ul>
               ${incompletas.length > 8 ? `<p style="margin:6px 0 0">…y ${incompletas.length - 8} más.</p>` : ''}`,
      });
      return;
    }
    const sinArchivo = listas.filter((f) => !f.archivoLocal);
    if (sinArchivo.length) {
      await Swal.fire({ icon: 'warning', title: 'Faltan archivos',
        text: `${sinArchivo.length} fila(s) no tienen el PDF en esta pantalla. Vuelve a arrastrar esos archivos.` });
      return;
    }

    const c = contarConceptos(listas);
    const r = await Swal.fire({
      icon: 'question',
      title: `Subir ${listas.length} examen(es)`,
      html: `<ul style="text-align:left;margin:0;padding-left:18px">
               <li>Apto: <b>${c.APTO}</b></li>
               <li>Apto con restricciones: <b>${c.APTO_CON_RESTRICCIONES}</b></li>
               <li>Aplazado (quedan en espera): <b>${c.APLAZADO}</b></li>
               <li>No apto: <b>${c.NO_APTO}</b>${c.NO_APTO ? ' — <b>esos procesos quedan rechazados</b>' : ''}</li>
             </ul>
             <p style="margin:10px 0 0;font-size:13px">Cada PDF va al expediente de la persona y el concepto a su proceso.</p>`,
      showCancelButton: true,
      confirmButtonText: 'Subir',
      cancelButtonText: 'Revisar otra vez',
      confirmButtonColor: '#21263C',
    });
    if (!r.isConfirmed) return;

    this.fase.set('subiendo');
    this.detener = false;
    this.deteniendo.set(false);
    this.progreso.set({ hechos: 0, total: listas.length });
    for (const tanda of armarTandas(listas)) {
      if (this.detener) break;
      try {
        const resp = await firstValueFrom(this.api.subir(lote.id, tanda.map((f) => ({
          archivo: f.archivoLocal!,
          item: {
            item_id: f.id,
            concepto: f.concepto!,
            restricciones: f.concepto === 'APTO_CON_RESTRICCIONES' ? f.restricciones : null,
            fecha_examen: f.fecha_examen || null,
          },
        }))));
        if (resp?.lote) this.lote.set(resp.lote);
        for (const it of resp?.items ?? []) {
          this.actualizar(it.id, {
            estado_carga: it.estado_carga, error: it.error,
            documento_id: it.documento_id, codigo_contrato: it.codigo_contrato,
          });
        }
      } catch (err) {
        const msg = this.mensajeDeError(err, 'No se pudo subir esta tanda.');
        for (const f of tanda) this.actualizar(f.id, { estado_carga: 'ERROR', error: msg });
      }
      this.progreso.update((p) => ({ ...p, hechos: p.hechos + tanda.length }));
    }
    this.fase.set('fin');
  }

  detenerSubida(): void {
    this.detener = true;
    this.deteniendo.set(true);
  }

  /** Vuelve a subir solo lo que falló (el backend no duplica lo ya subido). */
  async reintentarFallidas(): Promise<void> {
    this.filas.update((fs) => fs.map((f): FilaExamen => (f.estado_carga === 'ERROR' ? { ...f, estado_carga: 'PENDIENTE', error: null } : f)));
    this.fase.set('revision');
    await this.subir();
  }

  nuevoLote(): void {
    this.filas.set([]);
    this.lote.set(null);
    this.avisosLectura.set([]);
    this.error.set('');
    this.progreso.set({ hechos: 0, total: 0 });
    this.conceptoParaTodas.set(null);
    this.fase.set('inicio');
    this.ngOnInit();
  }

  limpiarAvisos(): void {
    this.avisosLectura.set([]);
  }

  // ── Presentación ──────────────────────────────────────────────────────

  private badgeCruce(f: FilaExamen): BadgeCelda {
    const texto = ETIQUETA_CRUCE[f.estado_cruce] ?? f.estado_cruce;
    switch (f.estado_cruce) {
      case 'OK': return { texto, tono: 'ok', icono: 'check_circle' };
      case 'AVISO': return { texto, tono: 'warn', icono: 'info' };
      case 'FUERA_DE_ALCANCE': return { texto, tono: 'neutro', icono: 'lock' };
      default: return { texto, tono: 'danger', icono: 'error' };
    }
  }

  textoCarga(f: FilaExamen): string {
    if (f.excluida) return 'Quitada';
    switch (f.estado_carga) {
      case 'SUBIDO': return 'Subido';
      case 'ERROR': return 'Error';
      default: return CRUCES_SUBIBLES.includes(f.estado_cruce) ? (motivoNoSubible(f, this.hoy) ? 'Incompleta' : 'Lista') : '—';
    }
  }

  private badgeCarga(f: FilaExamen): BadgeCelda | null {
    const texto = this.textoCarga(f);
    switch (texto) {
      case 'Subido': return { texto, tono: 'ok', icono: 'cloud_done' };
      case 'Error': return { texto, tono: 'danger', icono: 'cloud_off' };
      case 'Lista': return { texto, tono: 'info', icono: 'task_alt' };
      case 'Incompleta': return { texto, tono: 'warn', icono: 'edit_note' };
      case 'Quitada': return { texto, tono: 'neutro', icono: 'remove_circle_outline' };
      default: return null;
    }
  }

  private static readonly ENTIDADES: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };

  /** El nombre del archivo va dentro del HTML del aviso: se escapa. */
  private escapar(s: string): string {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ExamenesMasivosComponent.ENTIDADES[c] ?? c);
  }

  private mensajeDeError(err: unknown, respaldo: string): string {
    const e = err as HttpErrorResponse;
    if (e?.status === 0) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
    if (e?.status === 413) return 'El servidor rechazó la tanda por tamaño.';
    const detalle = e?.error?.detail || e?.error?.error || e?.error?.message;
    return typeof detalle === 'string' && detalle.trim() ? detalle.trim() : respaldo;
  }
}
