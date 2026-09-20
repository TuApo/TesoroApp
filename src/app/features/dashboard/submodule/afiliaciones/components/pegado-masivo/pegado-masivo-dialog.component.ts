import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { BadgeCelda, ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import {
  AfiliacionesPegadoService, PegadoItem, ValidadorPegado, CanalPegado, AvanceLote
} from '../../services/afiliaciones-pegado.service';
import { AfiliacionesGestionService } from '../../services/afiliaciones-gestion.service';
import { AfiliacionPdfService } from '../../services/afiliacion-pdf.service';

/** Una fila del preview: lo que devolvió el lookup + si el operador la dejó incluida. */
interface FilaPreview {
  item: PegadoItem;
  incluida: boolean;
}

type Efecto = 'cambia' | 'sin-cambio' | 'no-encontrada' | 'excluida';

/** Chip de la columna «Resultado» para cada efecto. */
const CHIP_EFECTO: Record<Efecto, BadgeCelda> = {
  'cambia':        { texto: 'Confirmar', tono: 'ok', icono: 'arrow_forward' },
  'sin-cambio':    { texto: 'Ya confirmada', tono: 'neutro' },
  'excluida':      { texto: 'Excluida', tono: 'neutro' },
  'no-encontrada': { texto: 'No encontrada', tono: 'danger' },
};

/** 'aaaa-mm-dd' (o ISO con hora) → Date local, igual que el DatePipe; así ordena como fecha. */
function aFecha(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * CAMBIO MASIVO DE ESTADO POR PEGADO — "Confirmación de ingresos".
 *
 * Flujo en dos pasos, a propósito:
 *   1. PEGAR   — el operador pega un bloque copiado de Excel. Se detecta sola la columna de
 *                cédulas (el resto de columnas se ignoran), se normaliza la basura de Excel y
 *                se deduplica.
 *   2. PREVIEW — cada cédula se resuelve contra la base y se muestra QUIÉN es y CÓMO QUEDARÍA
 *                la validación elegida, separando las que sí cambian, las que ya estaban
 *                confirmadas y las que no existen. Recién ahí se confirma.
 *
 * El preview es estado real traído del servidor, no una suposición: por eso resolver y aplicar
 * son dos llamadas distintas. Cambiar el validador NO vuelve a consultar — las 4 banderas ya
 * vinieron en el lookup y el recálculo es local.
 */
@Component({
  selector: 'app-pegado-masivo-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, MatTooltipModule, MatProgressBarModule,
    MatSlideToggleModule, MatSnackBarModule,
    ...TABLA_ESTANDAR
  ],
  templateUrl: './pegado-masivo-dialog.component.html',
  styleUrl: './pegado-masivo-dialog.component.css'
})
export class PegadoMasivoDialogComponent implements OnDestroy {
  private svc = inject(AfiliacionesPegadoService);
  private gestion = inject(AfiliacionesGestionService);
  private pdf = inject(AfiliacionPdfService);
  /** La app corre zoneless: lo que cambie dentro de una promesa hay que marcarlo a mano. */
  private cdrPdf = inject(ChangeDetectorRef);
  private snack = inject(MatSnackBar);
  private ref = inject(MatDialogRef<PegadoMasivoDialogComponent>);

  /** Una cédula es dígitos, con prefijo 'X' opcional (extranjería). */
  private static readonly RE_CEDULA = /^X?\d{4,15}$/;

  paso: 'pegar' | 'preview' = 'pegar';

  // ── Paso 1: pegar ──────────────────────────────────────────────────
  texto = '';
  cedulas: string[] = [];
  duplicadas = 0;
  descartadas = 0;
  cargando = false;

  // ── Paso 2: preview ────────────────────────────────────────────────
  /**
   * Filas del preview. La tabla estándar recibe el arreglo como señal: todo cambio (incluir,
   * excluir, cambiar la validación) se hace con un arreglo nuevo para que se entere.
   */
  filas: FilaPreview[] = [];
  guardando = false;

  readonly columnas: ColumnaTabla<FilaPreview>[] = [
    { id: 'incluir', header: 'Incluir', valor: (f) => f.incluida, interactiva: true, copiable: false,
      ordenable: false, ancho: '44px', tarjeta: 'meta' },
    { id: 'cedula', header: 'Cédula', valor: (f) => f.item.cedula || f.item.entrada, tarjeta: 'subtitulo' },
    { id: 'nombre', header: 'Nombre', valor: (f) => f.item.nombreCompleto ?? '',
      formato: (f) => f.item.nombreCompleto || '—', tarjeta: 'titulo' },
    { id: 'oficina', header: 'Oficina / Finca', prioridad: 2, tarjeta: 'cuerpo',
      valor: (f) => (f.item.oficina || '') + (f.item.finca ? ' · ' + f.item.finca : '') },
    { id: 'ingreso', header: 'Ingreso', prioridad: 2, tarjeta: 'meta',
      valor: (f) => aFecha(f.item.fechaIngreso),
      formato: (f) => { const d = aFecha(f.item.fechaIngreso); return d ? formatDate(d, 'dd/MM/yyyy', 'en-US') : '—'; } },
    // Las 4 banderas actuales como texto (A C N P = las que ya están confirmadas).
    { id: 'estado', header: 'Estado actual', tarjeta: 'cuerpo', valor: (f) => this.textoBanderas(f.item) },
    { id: 'resultado', header: 'Resultado', tarjeta: 'badge',
      valor: (f) => CHIP_EFECTO[this.efecto(f)].texto, badge: (f) => CHIP_EFECTO[this.efecto(f)] },
  ];

  readonly idFila = (f: FilaPreview) => f.item.entrada;
  readonly claseFila = (f: FilaPreview) =>
    (!f.item.encontrado ? 'te-fila--peligro' : !f.incluida ? 'te-fila--atenuada' : '');

  // ── Avance de la operación en curso ────────────────────────────────
  /**
   * Estado de la barra de progreso. Lo que se muestra es avance REAL: el trabajo va por lotes
   * y cada punto de porcentaje corresponde a un lote que el servidor ya respondió. Antes esto
   * era una barra indeterminada y con miles de cédulas no había forma de distinguir "está
   * trabajando" de "se colgó".
   */
  avance: AvanceLote<unknown> | null = null;
  /** Qué se está haciendo: cambia el texto que acompaña a la barra. */
  avanceQue: 'buscando' | 'confirmando' | null = null;
  /** Segundos transcurridos desde que arrancó la operación (para estimar la espera). */
  segundos = 0;
  private cronometro: ReturnType<typeof setInterval> | null = null;
  private inicio = 0;

  // ── Datos de la confirmación ───────────────────────────────────────
  validador: ValidadorPegado = 'AFILIACIONES';
  canal: CanalPegado = 'LLAMADA';
  nota = '';
  /** Volver a confirmar a quien ya estaba confirmado (pisa quién/cuándo lo confirmó). */
  reconfirmar = false;

  validadores: { v: ValidadorPegado; label: string }[] = [
    { v: 'AFILIACIONES',   label: 'Afiliaciones' },
    { v: 'COORDINADOR',    label: 'Coordinador de finca' },
    { v: 'NOMINA',         label: 'Nómina' },
    { v: 'PAGO_SEGURIDAD', label: 'Pago de seguridad social' }
  ];
  canales: CanalPegado[] = ['LLAMADA', 'CORREO', 'WHATSAPP'];

  get validadorLabel(): string {
    return this.validadores.find(x => x.v === this.validador)?.label || this.validador;
  }

  // ──────────────────────────────────────────────────────────────────
  // Paso 1 — pegar y detectar cédulas
  // ──────────────────────────────────────────────────────────────────

  /** Lee el portapapeles directamente (requiere permiso del navegador; si falla, se pega a mano). */
  async leerPortapapeles(): Promise<void> {
    try {
      const t = await navigator.clipboard.readText();
      if (!t?.trim()) { this.snack.open('El portapapeles está vacío', 'Cerrar', { duration: 3000 }); return; }
      this.texto = t;
      this.detectar();
    } catch {
      this.snack.open('El navegador no permitió leer el portapapeles: pega con Ctrl+V en el cuadro', 'Cerrar', { duration: 5000 });
    }
  }

  /**
   * Extrae las cédulas del bloque pegado.
   *
   * Se elige la COLUMNA con más celdas que parezcan cédula (así el encabezado y las columnas de
   * nombre/finca se ignoran solas). Si ninguna columna califica —pegados desordenados— se barre
   * celda por celda como plan B.
   */
  detectar(): void {
    const lineas = (this.texto || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const matriz = this.separarColumnas(lineas);

    const anchos = matriz.map(f => f.length);
    const cols = anchos.length ? Math.max(...anchos) : 0;

    let mejorCol = -1, mejorConteo = 0;
    for (let c = 0; c < cols; c++) {
      const n = matriz.reduce((acc, f) => acc + (this.esCedula(f[c]) ? 1 : 0), 0);
      if (n > mejorConteo) { mejorConteo = n; mejorCol = c; }
    }

    // Se guarda la celda TAL COMO venía: el backend normaliza igual, y así la lista de
    // "no encontradas" que el operador copia de vuelta coincide con su Excel de origen.
    const crudas: string[] = [];
    let celdasTotales = 0;
    if (mejorCol >= 0) {
      for (const f of matriz) {
        const celda = f[mejorCol];
        if (celda === undefined || celda.trim() === '') continue;
        celdasTotales++;
        if (this.esCedula(celda)) crudas.push(celda.trim());
      }
    } else {
      // Plan B: no hay una columna clara, se rescata cualquier celda con forma de cédula.
      for (const f of matriz) {
        for (const celda of f) {
          if (celda === undefined || celda.trim() === '') continue;
          celdasTotales++;
          if (this.esCedula(celda)) crudas.push(celda.trim());
        }
      }
    }

    // La deduplicación va sobre la forma canónica: '1.234.567' y '1234567' son la misma persona.
    const vistas = new Set<string>();
    const unicas: string[] = [];
    for (const c of crudas) {
      const clave = PegadoMasivoDialogComponent.normalizar(c);
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      unicas.push(c);
    }

    this.duplicadas = crudas.length - unicas.length;
    this.descartadas = Math.max(0, celdasTotales - crudas.length);
    this.cedulas = unicas.slice(0, AfiliacionesPegadoService.MAX_CEDULAS);
    if (unicas.length > AfiliacionesPegadoService.MAX_CEDULAS) {
      this.snack.open(
        `Se detectaron ${unicas.length} cédulas; se toman las primeras ${AfiliacionesPegadoService.MAX_CEDULAS}`,
        'Cerrar', { duration: 6000 });
    }
  }

  limpiar(): void {
    this.texto = '';
    this.cedulas = [];
    this.duplicadas = 0;
    this.descartadas = 0;
  }

  /**
   * Parte cada línea en celdas. Excel copia con TAB; se aceptan también ';' y '|'.
   * La coma NO se usa como separador a propósito: rompería "1,234,567".
   */
  private separarColumnas(lineas: string[]): string[][] {
    const sep = lineas.some(l => l.includes('\t')) ? '\t'
      : lineas.some(l => l.includes(';')) ? ';'
        : lineas.some(l => l.includes('|')) ? '|'
          : null;
    return sep ? lineas.map(l => l.split(sep)) : lineas.map(l => [l]);
  }

  private esCedula(celda: string | undefined): boolean {
    if (celda === undefined) return false;
    return PegadoMasivoDialogComponent.RE_CEDULA.test(PegadoMasivoDialogComponent.normalizar(celda));
  }

  /**
   * Deja la cédula en la forma canónica del sistema (dígitos con 'X' opcional al frente).
   * Espejo de la normalización del backend: puntos de miles, el ".0" de Excel, comillas
   * y espacios duros.
   */
  static normalizar(s: string): string {
    if (s == null) return '';
    let t = String(s).replace(/ /g, ' ').trim().toUpperCase();
    t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!t) return '';
    const x = t.startsWith('X');
    if (x) t = t.slice(1);
    t = t.replace(/[.,]0+$/, '');
    t = t.replace(/[^0-9]/g, '');
    return t ? (x ? 'X' : '') + t : '';
  }

  // ──────────────────────────────────────────────────────────────────
  // Paso 2 — resolver contra la base y previsualizar
  // ──────────────────────────────────────────────────────────────────

  buscar(): void {
    if (!this.cedulas.length || this.cargando) return;
    this.cargando = true;
    this.arrancarAvance('buscando');
    this.svc.lookupConAvance(this.cedulas).subscribe({
      next: a => {
        this.avance = a;
        if (!a.terminado || !a.resultado) return;
        this.cargando = false;
        this.pararAvance();
        this.filas = (a.resultado.items || []).map(item => ({ item, incluida: true }));
        this.paso = 'preview';
      },
      error: () => {
        this.cargando = false;
        this.pararAvance();
        this.snack.open('No se pudieron consultar las cédulas', 'Cerrar', { duration: 5000 });
      }
    });
  }

  volverAPegar(): void { this.paso = 'pegar'; }

  /** Estado ACTUAL de la validación elegida para esa persona. */
  yaConfirmado(item: PegadoItem): boolean {
    switch (this.validador) {
      case 'COORDINADOR':    return item.coordConfirmado;
      case 'NOMINA':         return item.nominaConfirmado;
      case 'PAGO_SEGURIDAD': return item.pagoConfirmado;
      default:               return item.ingresoConfirmado;
    }
  }

  /** Qué le va a pasar a la fila con la configuración actual. */
  efecto(fila: FilaPreview): Efecto {
    if (!fila.item.encontrado) return 'no-encontrada';
    if (!fila.incluida) return 'excluida';
    if (this.yaConfirmado(fila.item)) return this.reconfirmar ? 'cambia' : 'sin-cambio';
    return 'cambia';
  }

  /** Filas que efectivamente se van a enviar. */
  get aplicables(): FilaPreview[] {
    return this.filas.filter(f => this.efecto(f) === 'cambia' && f.item.candidatoId != null);
  }
  get totalCambian(): number   { return this.aplicables.length; }
  get totalSinCambio(): number { return this.filas.filter(f => this.efecto(f) === 'sin-cambio').length; }
  get totalNoHallado(): number { return this.filas.filter(f => !f.item.encontrado).length; }
  get totalExcluidas(): number { return this.filas.filter(f => this.efecto(f) === 'excluida').length; }
  /** Aviso: gente con el contrato inactivo dentro de lo que se va a confirmar. */
  get totalInactivos(): number { return this.aplicables.filter(f => f.item.activo === false).length; }

  incluirTodas(v: boolean): void {
    this.filas = this.filas.map(f => (f.item.encontrado ? { ...f, incluida: v } : f));
  }

  /** Incluye o excluye una fila (con un arreglo nuevo, para que la tabla repinte). */
  alternarFila(fila: FilaPreview, v: boolean): void {
    if (!fila.item.encontrado) return;
    this.filas = this.filas.map(f => (f === fila ? { ...f, incluida: v } : f));
  }

  /** Cambiar la validación o «re-confirmar» cambia el resultado de cada fila: se repinta. */
  refrescarPreview(): void {
    this.filas = [...this.filas];
  }

  /** Las banderas ya confirmadas, como texto para buscar, filtrar y copiar. */
  private textoBanderas(item: PegadoItem): string {
    if (!item.encontrado) return '—';
    const on = [
      item.ingresoConfirmado ? 'A' : '', item.coordConfirmado ? 'C' : '',
      item.nominaConfirmado ? 'N' : '', item.pagoConfirmado ? 'P' : '',
    ].filter(Boolean).join(' ');
    return (on || 'Ninguna') + (item.activo === false ? ' · contrato inactivo' : '');
  }

  /** Pasa las cédulas que no existen al portapapeles, para corregirlas en el Excel de origen. */
  copiarNoHalladas(): void {
    const txt = this.filas.filter(f => !f.item.encontrado).map(f => f.item.entrada).join('\n');
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(
      () => this.snack.open('Cédulas no encontradas copiadas', 'Cerrar', { duration: 3000 }),
      () => this.snack.open('No se pudo copiar', 'Cerrar', { duration: 3000 })
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Aplicar
  // ──────────────────────────────────────────────────────────────────

  confirmar(): void {
    const ids = this.aplicables.map(f => f.item.candidatoId!) as number[];
    if (!ids.length || this.guardando) return;
    this.guardando = true;
    this.arrancarAvance('confirmando');
    this.svc.confirmarMasivoConAvance(ids, this.validador, this.canal, this.nota).subscribe({
      next: a => {
        this.avance = a;
        if (!a.terminado || !a.resultado) return;
        const r = a.resultado;
        this.guardando = false;
        this.pararAvance();
        const msg = `${this.validadorLabel}: ${r.procesados}/${r.solicitados} confirmados`
          + (r.fallidos?.length ? `, ${r.fallidos.length} con error` : '');
        this.snack.open(msg, 'Cerrar', { duration: 6000 });
        this.ref.close({ procesados: r.procesados });
      },
      error: () => {
        this.guardando = false;
        // Al ir por lotes, lo ya enviado QUEDÓ aplicado: se dice explícitamente para que
        // nadie vuelva a lanzar el mismo bloque creyendo que no pasó nada.
        const hechas = this.avance?.hechas ?? 0;
        this.pararAvance();
        this.snack.open(
          hechas > 0
            ? `Error al confirmar. Se alcanzaron a aplicar ${hechas} de ${ids.length}; revisa antes de reintentar.`
            : 'Error al confirmar',
          'Cerrar', { duration: 8000 });
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Formato de afiliación (PDF) del lote pegado
  // ──────────────────────────────────────────────────────────────────

  pdfGenerando = false;

  /**
   * Para el PDF sirven TODAS las personas resueltas e incluidas, estén o no confirmadas: el
   * formato es un documento de la persona, no el resultado del cambio de estado. Por eso no se
   * reusa `aplicables`, que sí filtra por el efecto de la validación elegida.
   */
  get paraPdf(): FilaPreview[] {
    return this.filas.filter(f => f.item.encontrado && f.incluida && f.item.candidatoId != null);
  }
  get totalPdf(): number { return this.paraPdf.length; }

  /**
   * El lookup solo trae lo justo para el preview (nombre, oficina, banderas), así que las filas
   * completas se piden aparte — una consulta por persona, de a 6 en paralelo. Es la parte lenta,
   * y por eso va con su propio indicador.
   */
  generarPdf(): void {
    const filas = this.paraPdf;
    if (!filas.length || this.pdfGenerando) return;

    const tope = AfiliacionesGestionService.MAX_FILAS_PDF;
    const ids = filas.map(f => f.item.candidatoId!).slice(0, tope);
    if (filas.length > tope) {
      this.snack.open(
        `Hay ${filas.length} personas incluidas; el PDF se genera con las primeras ${tope}`,
        'Cerrar', { duration: 6000 });
    }

    this.pdfGenerando = true;
    this.gestion.cargarFilas(ids).subscribe({
      next: rows => {
        if (!rows.length) {
          this.pdfGenerando = false;
          this.cdrPdf.markForCheck();
          this.snack.open('No se pudo cargar el detalle de ninguna persona', 'Cerrar', { duration: 5000 });
          return;
        }
        this.pdf.generarMasivo(rows, { origen: `Pegado de cédulas · ${rows.length} de ${ids.length} solicitadas` })
          .then(() => {
            const faltan = ids.length - rows.length;
            this.snack.open(
              `Formato de afiliación generado (${rows.length} personas)`
              + (faltan > 0 ? ` — ${faltan} sin datos, quedaron fuera` : ''),
              'Cerrar', { duration: faltan > 0 ? 7000 : 4000 });
          })
          .catch(() => this.snack.open('No se pudo generar el PDF', 'Cerrar', { duration: 4000 }))
          .finally(() => { this.pdfGenerando = false; this.cdrPdf.markForCheck(); });
      },
      error: () => {
        this.pdfGenerando = false;
        this.cdrPdf.markForCheck();
        this.snack.open('No se pudieron cargar los datos para el PDF', 'Cerrar', { duration: 5000 });
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Avance
  // ──────────────────────────────────────────────────────────────────

  private arrancarAvance(que: 'buscando' | 'confirmando'): void {
    this.avanceQue = que;
    this.avance = null;
    this.segundos = 0;
    this.inicio = Date.now();
    this.pararCronometro();
    this.cronometro = setInterval(() => {
      this.segundos = Math.floor((Date.now() - this.inicio) / 1000);
    }, 1000);
  }

  private pararAvance(): void {
    this.pararCronometro();
    this.avance = null;
    this.avanceQue = null;
  }

  private pararCronometro(): void {
    if (this.cronometro !== null) { clearInterval(this.cronometro); this.cronometro = null; }
  }

  /** Texto de la barra: qué se está haciendo y cuánto va. */
  get avanceTexto(): string {
    if (!this.avance) return '';
    const a = this.avance;
    const que = this.avanceQue === 'confirmando' ? 'Confirmando' : 'Consultando';
    const unidad = this.avanceQue === 'confirmando' ? 'personas' : 'cédulas';
    if (a.lote === 0) return `${que} ${a.total} ${unidad}…`;
    return `${que} ${a.hechas} de ${a.total} ${unidad} · lote ${a.lote} de ${a.lotes}`;
  }

  /**
   * Estimación de lo que falta, en segundos, extrapolando el ritmo hasta ahora.
   * Se muestra solo cuando ya hay al menos un lote medido; antes no hay con qué estimar.
   */
  get avanceRestante(): string {
    const a = this.avance;
    if (!a || a.hechas <= 0 || this.segundos <= 0 || a.terminado) return '';
    const restantes = Math.max(0, a.total - a.hechas);
    if (restantes === 0) return '';
    const seg = Math.round((this.segundos / a.hechas) * restantes);
    if (seg < 60) return `~${seg} s restantes`;
    return `~${Math.ceil(seg / 60)} min restantes`;
  }

  ngOnDestroy(): void { this.pararCronometro(); }

  cerrar(): void { this.ref.close(); }
}
