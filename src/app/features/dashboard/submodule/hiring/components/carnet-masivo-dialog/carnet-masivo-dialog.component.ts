/**
 * Generación MASIVA de carnets.
 *
 * Arma el mismo carnet que `generate-contracting-documents` (buildCarnetApoyoPdf)
 * pero para varias personas a la vez, aprovechando que la hoja ya trae una
 * grilla de 9: `buildCarnetApoyoLotePdf` llena las 9 celdas por hoja.
 *
 * Reglas:
 *  - Un candidato solo se genera si tiene TODOS los datos del carnet. Si le
 *    falta algo, la fila queda bloqueada y se dice exactamente qué falta.
 *  - Por defecto se preseleccionan solo los que NO tienen carnet generado: la
 *    idea es completar los que faltan, no re-imprimir lo que ya salió.
 *  - Un carnet ya generado se puede volver a marcar a mano para regenerarlo
 *    (uno o varios); queda advertido en la fila.
 *  - "Previsualizar" arma el PDF del lote sin escribir nada en el servidor.
 *  - "Generar" sube el carnet de cada persona al gestor documental y marca
 *    `carnet_generado`, además de descargar el lote para imprimir.
 */
import { CommonModule } from '@angular/common';
import { centroDeCostosImpreso } from '../../shared/contrato-campos';
import { ChangeDetectionStrategy, Component, Inject, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom, of } from 'rxjs';
import { catchError, take } from 'rxjs/operators';

import {
  CarnetAvisoData,
  CarnetAvisoDialogComponent,
  CarnetProgresoDialogComponent,
} from './carnet-dialogs.component';

import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { VacantesService } from '../../../vacancies/service/vacantes/vacantes.service';
import {
  CARNETS_POR_HOJA,
  DatosCarnet,
  buildCarnetApoyoLotePdf,
  buildCarnetApoyoPdf,
} from '../generate-contracting-documents/carnet-apoyo-fill';
import {
  ARL_ALIANZA,
  CARNETS_POR_HOJA_ALIANZA,
  CarnetMasivoRow,
  TELEFONO_COORDINADOR_ALIANZA,
  buildCarnetsMasivoPdf,
} from '../generate-contracting-documents/carnet-masivo-fill';
import { CarnetImpresionComponent } from '../generate-contracting-documents/carnet-impresion.component';
import {
  ConfigImpresionCarnet,
  FormatoCarnet,
  leerImpresion,
} from '../generate-contracting-documents/carnet-impresion';
import QRCode from 'qrcode';

/** Las dos temporales tienen formato, logo, ARL y coordinador distintos. */
type TemporalCarnet = 'apoyo' | 'alianza';

/** type_id del carnet en el gestor documental. */
const TIPO_DOC_CARNET = 102;

export interface CarnetMasivoDialogData {
  /** Cédulas sugeridas al abrir (p. ej. las de la cola de turnos). */
  cedulas?: string[];
}

interface FilaCarnet {
  cedula: string;
  nombre: string;
  tipoDoc: string | null;
  /** Ya tenía carnet generado antes de esta corrida. */
  yaGenerado: boolean;
  /** Campos obligatorios que faltan; si hay alguno, no se puede generar. */
  faltantes: string[];
  datos: DatosCarnet | null;
  error: string | null;
  /** proceso al que hay que marcarle `carnet_generado`. */
  procesoId: number | null;
  /** Temporal de la vacante: decide formato, logo, ARL y coordinador. */
  temporal: TemporalCarnet;
  /** Apellidos y nombres por separado: el carnet de Alianza los pinta en 2 renglones. */
  apellidos: string;
  nombres: string;
}

@Component({
  selector: 'app-carnet-masivo-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule,
    CarnetImpresionComponent,
  ],
  templateUrl: './carnet-masivo-dialog.component.html',
  styleUrl: './carnet-masivo-dialog.component.css',
})
export class CarnetMasivoDialogComponent {
  private readonly gc = inject(RegistroProcesoContratacion);
  private readonly docsSrv = inject(GestionDocumentalService);
  private readonly vacantesSrv = inject(VacantesService);
  private readonly dialog = inject(MatDialog);

  /**
   * Aviso/confirmación. Devuelve true si se confirmó.
   *
   * Reemplaza a SweetAlert dentro de este diálogo: un Swal abierto desde un
   * MatDialog quedaba detrás pese a forzarle target, z-index y orden en el DOM.
   * Con MatDialog el CDK apila por orden de apertura y siempre queda al frente.
   */
  private aviso(data: CarnetAvisoData): Promise<boolean> {
    return firstValueFrom(
      this.dialog.open<CarnetAvisoDialogComponent, CarnetAvisoData, boolean>(
        CarnetAvisoDialogComponent, { data, autoFocus: 'dialog', restoreFocus: false },
      ).afterClosed(),
    ).then(r => r === true);
  }

  /** Progreso bloqueante; el texto se actualiza con `ref.componentInstance`. */
  private abrirProgreso(titulo: string, mensaje: string) {
    const ref = this.dialog.open(CarnetProgresoDialogComponent, {
      disableClose: true, autoFocus: false, restoreFocus: false,
    });
    ref.componentInstance.titulo.set(titulo);
    ref.componentInstance.mensaje.set(mensaje);
    return ref;
  }

  /** Cédulas escritas/pegadas: una por línea, o separadas por coma/espacio. */
  cedulasTexto = '';

  cargando = signal(false);
  generando = signal(false);
  progreso = signal('');
  filas = signal<FilaCarnet[]>([]);
  private readonly marcadas = signal<Set<string>>(new Set<string>());

  /** Vacantes ya consultadas (varias personas comparten la misma). */
  private readonly vacantesCache = new Map<number, any>();

  readonly total = computed(() => this.filas().length);
  readonly seleccionadas = computed(() =>
    this.filas().filter(f => this.marcadas().has(f.cedula) && this.puedeGenerar(f)),
  );
  /** Seleccionadas por temporal: cada una arma sus propias hojas. */
  readonly porTemporal = computed(() => {
    const sel = this.seleccionadas();
    return {
      apoyo: sel.filter(f => f.temporal === 'apoyo').length,
      alianza: sel.filter(f => f.temporal === 'alianza').length,
    };
  });
  /**
   * Hojas totales. Se cuentan POR SEPARADO porque los dos formatos no comparten
   * hoja: 5 de Apoyo + 5 de Alianza son 2 hojas, no 1.
   */
  readonly hojas = computed(() => {
    const t = this.porTemporal();
    // Cada formato con SU constante: hoy ambas valen 9, pero si mañana cambia
    // la grilla de una, este contador tiene que seguirla sin tocar nada más.
    return Math.ceil(t.apoyo / CARNETS_POR_HOJA)
      + Math.ceil(t.alianza / CARNETS_POR_HOJA_ALIANZA);
  });
  readonly bloqueadas = computed(() => this.filas().filter(f => !this.puedeGenerar(f)).length);
  /**
   * Qué formato(s) se van a imprimir. Importa para el bloque de volteo: los dos
   * formatos usan hojas de orientación distinta, así que el MISMO volteo se
   * llama "lado corto" en uno y "lado largo" en el otro.
   */
  readonly formatoImpresion = computed<FormatoCarnet | 'ambos'>(() => {
    const t = this.porTemporal();
    if (t.apoyo && t.alianza) return 'ambos';
    return t.alianza ? 'alianza' : 'apoyo';
  });
  readonly regenerando = computed(() =>
    this.seleccionadas().filter(f => f.yaGenerado).length,
  );

  constructor(
    public dialogRef: MatDialogRef<CarnetMasivoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CarnetMasivoDialogData,
  ) {
    const sugeridas = (data?.cedulas ?? []).map(c => String(c).trim()).filter(Boolean);
    if (sugeridas.length) this.cedulasTexto = sugeridas.join('\n');
  }

  /** Una fila es generable solo si no le falta ningún dato del carnet. */
  puedeGenerar(f: FilaCarnet): boolean {
    return !!f.datos && f.faltantes.length === 0 && !f.error;
  }

  estaMarcada(f: FilaCarnet): boolean {
    return this.marcadas().has(f.cedula);
  }

  marcar(f: FilaCarnet, checked: boolean): void {
    const s = new Set(this.marcadas());
    if (checked) s.add(f.cedula); else s.delete(f.cedula);
    this.marcadas.set(s);
  }

  marcarTodas(checked: boolean): void {
    this.marcadas.set(
      checked
        ? new Set(this.filas().filter(f => this.puedeGenerar(f)).map(f => f.cedula))
        : new Set<string>(),
    );
  }

  /** Vuelve a marcar solo los pendientes (el estado por defecto). */
  soloPendientes(): void {
    this.marcadas.set(
      new Set(this.filas().filter(f => this.puedeGenerar(f) && !f.yaGenerado).map(f => f.cedula)),
    );
  }

  // ───────── Carga y validación ─────────
  private parsearCedulas(): string[] {
    // OJO con la 'X': es el prefijo de los documentos que NO son cédula de
    // ciudadanía. Un `replace(/\D/g,'')` la borraba, así que pegar
    // 'X1002498616' terminaba buscando al titular CC con ese mismo número y
    // se generaba el carnet de OTRA persona (foto, EPS y datos incluidos).
    const crudas = String(this.cedulasTexto || '')
      .split(/[\s,;]+/)
      .map(c => c.trim().toUpperCase().replace(/[^0-9X]/g, ''))
      // Solo se acepta la X al inicio; en cualquier otra posición es basura.
      .filter(c => /^X?\d+$/.test(c));
    return [...new Set(crudas)];
  }

  async revisar(): Promise<void> {
    const cedulas = this.parsearCedulas();
    if (!cedulas.length) {
      this.aviso({ icono: 'info', titulo: 'Sin cédulas', html: 'Escribe o pega al menos una cédula.' });
      return;
    }

    this.cargando.set(true);
    this.filas.set([]);
    const acumulado: FilaCarnet[] = [];

    try {
      // Secuencial a propósito: son consultas pesadas (candidato completo +
      // vacante) y el backend no tiene por qué recibir 200 a la vez.
      for (let i = 0; i < cedulas.length; i++) {
        this.progreso.set(`Revisando ${i + 1} de ${cedulas.length}…`);
        acumulado.push(await this.construirFila(cedulas[i]));
        this.filas.set([...acumulado]);
      }
      this.soloPendientes();
    } finally {
      this.cargando.set(false);
      this.progreso.set('');
    }
  }

  private async construirFila(cedula: string): Promise<FilaCarnet> {
    const base: FilaCarnet = {
      cedula, nombre: '', tipoDoc: null, yaGenerado: false,
      faltantes: [], datos: null, error: null, procesoId: null,
      temporal: 'apoyo', apellidos: '', nombres: '',
    };

    let cand: any;
    try {
      cand = await firstValueFrom(this.gc.getCandidatoPorDocumento(cedula, true));
    } catch {
      return { ...base, error: 'No se encontró el candidato.' };
    }
    if (!cand?.numero_documento) return { ...base, error: 'No se encontró el candidato.' };

    // Misma elección de entrevista que generate-contracting-documents: la que
    // tiene publicación, si no la que tiene contrato, si no la más reciente.
    const entrevistas: any[] = Array.isArray(cand?.entrevistas) ? [...cand.entrevistas] : [];
    entrevistas.sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0));
    const ent = entrevistas.find(e => e?.proceso?.publicacion)
      || entrevistas.find(e => e?.proceso?.contrato_codigo || e?.proceso?.contrato?.codigo_contrato)
      || entrevistas[0];
    const proc = ent?.proceso ?? null;
    const contrato = proc?.contrato ?? null;

    const nombre = [cand.primer_nombre, cand.segundo_nombre, cand.primer_apellido, cand.segundo_apellido]
      .map((v: any) => String(v ?? '').trim()).filter(Boolean).join(' ');

    if (!contrato) {
      return { ...base, nombre, tipoDoc: cand.tipo_doc ?? null, error: 'No tiene contrato: primero Pago y Transporte.' };
    }

    const vacante = await this.vacante(proc?.publicacion ?? null);
    const antecedentes: any[] = Array.isArray(proc?.antecedentes) ? proc.antecedentes : [];
    const porNombre = (n: string) =>
      String(antecedentes.find(a => String(a?.nombre ?? '').toUpperCase() === n)?.observacion ?? '').trim();

    const familiares: any[] = Array.isArray(cand?.familiares) ? cand.familiares : [];
    const emerg = familiares.find(f => String(f?.tipo ?? '').toUpperCase().includes('EMERGENCIA')) ?? {};

    // El consecutivo del carnet ES el código de contrato (lo asigna el backend
    // por rango de oficina); carnet_codigo queda de respaldo para los viejos.
    const consecutivo = String(
      contrato.codigo_contrato || proc?.contrato_codigo || contrato.carnet_codigo || '',
    ).trim();

    const centroCostos = centroDeCostosImpreso(contrato);
    // Solo `fecha_ingreso` (el DateField real). `carnet_fecha_ingreso` es texto
    // libre y hacía que el carnet saliera con distinta fecha según desde dónde
    // se generara; ver la misma decisión en generate-contracting-documents.
    const fIng = String(contrato.fecha_ingreso || '').trim();
    const fechaIngreso = /^\d{4}-\d{2}-\d{2}/.test(fIng)
      ? `${fIng.slice(8, 10)}/${fIng.slice(5, 7)}/${fIng.slice(0, 4)}`
      : fIng;

    const datos: DatosCarnet = {
      nombreCompleto: nombre,
      cedula: String(cand.numero_documento),
      centroCostos,
      cargo: String(vacante?.cargo ?? proc?.vacante_tipo ?? '').trim(),
      consecutivo,
      fechaIngreso,
      eps: porNombre('EPS'),
      afp: porNombre('AFP'),
      emergenciaNombre: String(emerg?.nombre ?? '').trim(),
      emergenciaTelefono: String(emerg?.telefono ?? '').trim(),
      logoDataUrl: null,   // se resuelve una sola vez al generar
      fotoDataUrl: String(cand?.biometria?.foto?.file_url ?? '') || null,
    };

    // La temporal decide FORMATO, logo, ARL y teléfono del coordinador. Si la
    // vacante no la trae, no hay forma de saber si el carnet es de Apoyo o de
    // Tu Alianza: antes se asumía Apoyo en silencio y podía salir el carnet
    // equivocado. Ahora la fila se bloquea y se dice por qué.
    const temporalVacante = String(vacante?.temporal ?? '').toUpperCase();
    const esAlianza = temporalVacante.includes('ALIANZA');
    const esApoyo = temporalVacante.includes('APOYO');

    // Todo tiene que estar lleno: si falta algo, esta persona no se genera.
    const faltantes: string[] = [];
    if (!esAlianza && !esApoyo) faltantes.push('temporal de la vacante (Apoyo / Tu Alianza)');
    if (!datos.nombreCompleto) faltantes.push('nombre');
    if (!datos.consecutivo) faltantes.push('código de contrato');
    if (!datos.centroCostos) faltantes.push('centro de costo');
    if (!datos.cargo) faltantes.push('cargo');
    if (!datos.fechaIngreso) faltantes.push('fecha de ingreso');
    if (!datos.eps) faltantes.push('EPS');
    if (!datos.afp) faltantes.push('AFP');
    if (!datos.emergenciaNombre) faltantes.push('contacto de emergencia');
    if (!datos.emergenciaTelefono) faltantes.push('teléfono de emergencia');
    if (!datos.fotoDataUrl) faltantes.push('foto');

    return {
      cedula: String(cand.numero_documento),
      nombre,
      tipoDoc: cand.tipo_doc ?? null,
      yaGenerado: contrato.carnet_generado === true,
      faltantes,
      datos,
      error: null,
      procesoId: proc?.id ?? null,
      // Si no se pudo determinar, la fila ya quedó bloqueada por `faltantes`;
      // el valor sirve solo para pintar el chip de la tabla.
      temporal: esAlianza ? 'alianza' : 'apoyo',
      apellidos: [cand.primer_apellido, cand.segundo_apellido]
        .map((v: any) => String(v ?? '').trim()).filter(Boolean).join(' '),
      nombres: [cand.primer_nombre, cand.segundo_nombre]
        .map((v: any) => String(v ?? '').trim()).filter(Boolean).join(' '),
    };
  }

  private async vacante(id: number | null): Promise<any> {
    if (!id) return null;
    if (this.vacantesCache.has(id)) return this.vacantesCache.get(id);
    const vac = await firstValueFrom(
      this.vacantesSrv.obtenerVacante(id).pipe(take(1), catchError(() => of(null))),
    );
    this.vacantesCache.set(id, vac);
    return vac;
  }

  // ───────── Imágenes ─────────
  private async aDataUrl(url?: string | null): Promise<string | null> {
    if (!url) return null;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      let bin = '';
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return `data:image/png;base64,${btoa(bin)}`;
    } catch {
      return null;
    }
  }

  /**
   * Descarga los logos y las fotos una sola vez y devuelve los datos listos.
   *
   * El logo depende de la temporal de CADA fila: antes se usaba `Logo_AL.png`
   * para todo el mundo y a la gente de Tu Alianza le salía el carnet con el
   * logo de Apoyo.
   */
  private async datosConImagenes(filas: FilaCarnet[]): Promise<DatosCarnet[]> {
    const logos: Record<TemporalCarnet, string | null> = {
      apoyo: await this.aDataUrl('logos/Logo_AL.png'),
      alianza: await this.aDataUrl('logos/Logo_TA.png'),
    };
    const out: DatosCarnet[] = [];
    for (const f of filas) {
      const d = f.datos!;
      out.push({
        ...d,
        logoDataUrl: logos[f.temporal],
        fotoDataUrl: await this.aDataUrl(d.fotoDataUrl),
      });
    }
    return out;
  }

  /** Traduce una fila de Apoyo al shape que pinta el carnet de Tu Alianza. */
  private async filaAlianza(fila: FilaCarnet, datos: DatosCarnet): Promise<CarnetMasivoRow> {
    return {
      CEDULA: datos.cedula,
      CODIGO: datos.consecutivo,
      APELLIDOS: fila.apellidos,
      NOMBRES: fila.nombres,
      FECHA_INGRESO: datos.fechaIngreso,
      CENTRO_COSTO: datos.centroCostos,
      FAMILIAR_EMERGENCIA_NOMBRE: datos.emergenciaNombre,
      FAMILIAR_EMERGENCIA_TELEFONO: datos.emergenciaTelefono,
      fotoDataUrl: datos.fotoDataUrl ?? null,
      // Mismo payload que el QR de la masiva de Home, para que sirva el mismo lector.
      qrDataUrl: await QRCode.toDataURL(`${datos.cedula}|${datos.consecutivo}`, {
        errorCorrectionLevel: 'M', margin: 1, width: 300,
      }).catch(() => null),
    };
  }

  /** Opciones fijas del carnet de Tu Alianza (ARL y coordinador propios). */
  private opcionesAlianza(logoDataUrl: string | null, impresion: ConfigImpresionCarnet) {
    return {
      logoDataUrl,
      telefonoCoordinador: TELEFONO_COORDINADOR_ALIANZA,
      arl: ARL_ALIANZA,
      impresion,
    };
  }

  /**
   * Arma un PDF por temporal. NUNCA se mezclan en la misma hoja: los datos
   * fijos (logo, ARL, teléfono del coordinador) y hasta el formato de la
   * tarjeta son distintos, así que una hoja compartida saldría mal para una de
   * las dos.
   */
  private async lotesPorTemporal(
    filas: FilaCarnet[], datos: DatosCarnet[],
  ): Promise<Array<{ temporal: TemporalCarnet; blob: Blob; cantidad: number }>> {
    const out: Array<{ temporal: TemporalCarnet; blob: Blob; cantidad: number }> = [];
    // Cómo voltea la hoja ESTE puesto: lo eligió el operador en el bloque de
    // impresión y define cómo se dibuja la cara de reversos.
    const impresion = leerImpresion();

    const idxApoyo = filas.map((f, i) => ({ f, i })).filter(x => x.f.temporal === 'apoyo');
    if (idxApoyo.length) {
      out.push({
        temporal: 'apoyo',
        blob: buildCarnetApoyoLotePdf(idxApoyo.map(x => datos[x.i]), impresion),
        cantidad: idxApoyo.length,
      });
    }

    const idxAlianza = filas.map((f, i) => ({ f, i })).filter(x => x.f.temporal === 'alianza');
    if (idxAlianza.length) {
      const rows: CarnetMasivoRow[] = [];
      for (const x of idxAlianza) rows.push(await this.filaAlianza(x.f, datos[x.i]));
      out.push({
        temporal: 'alianza',
        blob: buildCarnetsMasivoPdf(
          rows, this.opcionesAlianza(datos[idxAlianza[0].i].logoDataUrl ?? null, impresion)),
        cantidad: idxAlianza.length,
      });
    }

    return out;
  }

  // ───────── Previsualizar / generar ─────────
  /**
   * Abre el PDF en una pestaña nueva de forma confiable.
   *
   * `window.open()` DESPUÉS de un `await` lo bloquea el navegador en silencio:
   * el gesto del usuario ya caducó y lo trata como popup. Por eso la pestaña
   * se abre ANTES de armar el PDF (con la pestaña en blanco) y solo se le
   * cambia la URL cuando el blob está listo.
   *
   * Si aun así viene bloqueada (extensión, política del navegador), se cae a
   * una descarga normal, que nunca se bloquea. Peor es no entregar nada.
   */
  private abrirPdf(ventana: Window | null, blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob);
    if (ventana && !ventana.closed) {
      ventana.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async previsualizar(): Promise<void> {
    const sel = this.seleccionadas();
    if (!sel.length) {
      this.aviso({ icono: 'info', titulo: 'Nada seleccionado', html: 'Marca al menos una persona con todos los datos completos.' });
      return;
    }
    // Antes de cualquier await: si no, el navegador bloquea el popup.
    const ventana = window.open('', '_blank');
    this.generando.set(true);
    this.progreso.set('Armando previsualización…');
    const progreso = this.abrirProgreso(
      'Armando previsualización…', `Procesando ${sel.length} carnet(s)…`);
    try {
      const datos = await this.datosConImagenes(sel);
      const lotes = await this.lotesPorTemporal(sel, datos);
      progreso.close();
      // La ventana ya abierta se usa para el primero; el resto va a descarga.
      lotes.forEach((l, i) => this.abrirPdf(
        i === 0 ? ventana : null, l.blob,
        `carnets_previsualizacion_${l.temporal}.pdf`,
      ));
    } catch (e) {
      console.error('[carnet masivo] previsualizar', e);
      ventana?.close();
      progreso.close();
      this.aviso({ icono: 'error', titulo: 'Error', html: 'No se pudo armar la previsualización.' });
    } finally {
      this.generando.set(false);
      this.progreso.set('');
    }
  }

  async generar(): Promise<void> {
    const sel = this.seleccionadas();
    if (!sel.length) {
      this.aviso({ icono: 'info', titulo: 'Nada seleccionado', html: 'Marca al menos una persona con todos los datos completos.' });
      return;
    }

    const regen = sel.filter(f => f.yaGenerado).length;
    const confirmado = await this.aviso({
      icono: 'question',
      titulo: `Generar ${sel.length} carnet(s)`,
      html: `Se imprimirán en <b>${this.hojas()}</b> hoja(s) de 9.`
        + `<br><small>Apoyo: <b>${this.porTemporal().apoyo}</b> · `
        + `Tu Alianza: <b>${this.porTemporal().alianza}</b> — salen en PDF aparte, `
        + `no se mezclan en la misma hoja.</small>`
        + (regen ? `<br><br><b>${regen}</b> ya tenían carnet y se van a REGENERAR.` : ''),
      textoConfirmar: 'Generar',
      textoCancelar: 'Cancelar',
    });
    if (!confirmado) return;

    // Se abre YA, antes de armar nada: pasado el await el navegador bloquea el
    // popup. `abrirPdf` cae a descarga si aun asi viene bloqueada.
    const ventana = window.open('', '_blank');

    this.generando.set(true);
    const fallidas: string[] = [];
    let progreso: ReturnType<typeof this.abrirProgreso> | null = null;
    try {
      this.progreso.set('Armando los carnets…');
      progreso = this.abrirProgreso('Generando carnets…', 'Armando los PDF…');
      const datos = await this.datosConImagenes(sel);

      // 1) Un lote por temporal: hojas de Apoyo aparte de las de Tu Alianza.
      const lotes = await this.lotesPorTemporal(sel, datos);
      lotes.forEach((l, i) => this.abrirPdf(
        i === 0 ? ventana : null, l.blob,
        `carnets_lote_${l.temporal}_${l.cantidad}.pdf`,
      ));

      // 2) El carnet individual de cada quien al gestor documental + la marca.
      for (let i = 0; i < sel.length; i++) {
        const fila = sel[i];
        this.progreso.set(`Guardando ${i + 1} de ${sel.length} (${fila.cedula})…`);
        progreso?.componentInstance.mensaje.set(
          `Guardando <b>${i + 1}</b> de <b>${sel.length}</b><br>${fila.cedula}`);
        try {
          // Cada quien se guarda con el formato de SU temporal. Esta copia va al
          // gestor documental (siempre en la primera celda) con el mismo volteo
          // del lote, para que reimprimirla desde ahí salga igual de pareja.
          const individual = fila.temporal === 'alianza'
            ? buildCarnetsMasivoPdf(
              [await this.filaAlianza(fila, datos[i])],
              { ...this.opcionesAlianza(datos[i].logoDataUrl ?? null, leerImpresion()), posicion: 1 },
            )
            : buildCarnetApoyoPdf(datos[i], 0, leerImpresion());
          const archivo = new File([individual], `carnet_${fila.cedula}.pdf`, { type: 'application/pdf' });
          await firstValueFrom(this.docsSrv.guardarDocumento(
            `carnet_${fila.cedula}.pdf`, fila.cedula, TIPO_DOC_CARNET, archivo,
            datos[i].consecutivo || undefined, fila.tipoDoc ?? undefined,
          ));
          await firstValueFrom(this.gc.updateProcesoByDocumento({
            numero_documento: fila.cedula,
            // La fila ya resolvió SU proceso: sin esto el backend toma "la
            // última entrevista" y con cédula duplicada (CC vs C.C) o un turno
            // nuevo la marca podía sellarse en el proceso equivocado.
            proceso_id: fila.procesoId ?? undefined,
            contrato: {
              carnet_generado: true,
              carnet_codigo: datos[i].consecutivo,
              carnet_centro_costo: datos[i].centroCostos,
            },
          } as any, 'PATCH'));
        } catch (e) {
          console.error('[carnet masivo] falló', fila.cedula, e);
          fallidas.push(fila.cedula);
        }
      }

      // Refleja el nuevo estado sin volver a consultar todo.
      const okSet = new Set(sel.map(f => f.cedula).filter(c => !fallidas.includes(c)));
      this.filas.set(this.filas().map(f => (okSet.has(f.cedula) ? { ...f, yaGenerado: true } : f)));
      this.soloPendientes();
      this.cambios = true;

      progreso?.close();
      progreso = null;
      await this.aviso({
        icono: fallidas.length ? 'warning' : 'success',
        titulo: fallidas.length ? 'Generado con errores' : 'Carnets generados',
        html: `Se generaron <b>${sel.length - fallidas.length}</b> de ${sel.length}.`
          + (fallidas.length ? `<br><br>No se pudieron guardar: ${fallidas.join(', ')}` : ''),
      });
    } catch (e: any) {
      // Sin este catch, un fallo armando los lotes quedaba como unhandled
      // rejection: la pestaña en blanco pre-abierta se quedaba huérfana y el
      // usuario no veía ningún aviso (previsualizar() sí lo tenía).
      try { ventana?.close(); } catch { /* ya cerrada */ }
      console.error('[carnet masivo] generar() falló:', e);
      await this.aviso({
        icono: 'error',
        titulo: 'No se pudieron generar los carnets',
        html: 'Ocurrió un error armando los PDF. Intenta de nuevo; si sigue igual, avisa a sistemas.',
      });
    } finally {
      // Si algo revienta a mitad, el loader no puede quedarse abierto para
      // siempre bloqueando el diálogo.
      progreso?.close();
      this.generando.set(false);
      this.progreso.set('');
    }
  }

  /** Para que el pipeline sepa si debe refrescar al cerrar. */
  cambios = false;

  cerrar(): void {
    this.dialogRef.close(this.cambios);
  }
}
