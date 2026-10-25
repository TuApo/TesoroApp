import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import { ExamenIdentidadApi, VeredictoIdentidad } from '../../pages/recruitment-pipeline/examen-identidad';
import { ArlApi, EstadoArlApi } from '../../pages/recruitment-pipeline/arl.api';
import {
  ARL_POR_DEFECTO, ARLS, AfiliacionArl, DatosCertificado, TIPOS_COTIZANTE, TIPO_DOCUMENTO_ARL, TipoCotizante,
  fechaCorta, fechasCoinciden, isoDia, leerCertificadoArl,
} from '../../pages/recruitment-pipeline/arl.rules';

/** Soporte del expediente tal como lo lista gestión documental. */
export interface DocArl {
  id: number;
  title?: string;
  file_url: string;
  uploaded_at?: string;
  created_at?: string;
  contract_number?: string | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * Paso ARL de Selección (después de Exámenes de ingreso).
 *
 * Se carga el certificado de afiliación (PDF tipo 30, entra al expediente como
 * el examen médico) y se reescriben sus datos: ARL (SURA por defecto), fecha de
 * inicio de afiliación y tipo de cotizante. Al cargarlo:
 *  - se coteja que el nombre y la cédula del PDF sean los del trabajador, con
 *    el mismo verificador del examen médico (alerta con justificación);
 *  - se compara la fecha de inicio con la fecha de ingreso del contrato (o la
 *    de la vacante mientras el contrato no la tenga): si no coinciden, alerta.
 *
 * Sin certificado y sus datos la pestaña Contratación queda cerrada, y ms-hr no
 * deja contratar con la fecha distinta (409 ARL_REQUERIDA).
 */
@Component({
  selector: 'app-arl-afiliacion',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatAutocompleteModule, MatButtonModule, MatButtonToggleModule, MatDatepickerModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatTooltipModule,
  ],
  templateUrl: './arl-afiliacion.component.html',
  styleUrl: './arl-afiliacion.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArlAfiliacionComponent {
  private readonly api = inject(ArlApi);
  private readonly docSvc = inject(GestionDocumentalService);
  private readonly identidadApi = inject(ExamenIdentidadApi);

  /** El candidato tal como lo tiene el pipeline (`by-document?full=1`). */
  readonly candidato = input<any | null>(null);
  /** Proceso que se va a contratar. */
  readonly procesoId = input<number | null>(null);
  /** Motivo por el que el paso está cerrado (examen no apto, no aplica…); null = abierto. */
  readonly bloqueo = input<string | null>(null);
  /** Certificados ARL del contrato en curso, del más reciente al más viejo. */
  readonly docs = input<readonly DocArl[]>([]);
  readonly esAdmin = input(false);

  /** Algo cambió en el servidor: el pipeline relee la persona y el expediente. */
  readonly guardado = output<void>();
  readonly verDoc = output<DocArl>();
  readonly descargarDoc = output<DocArl>();

  readonly ARLS = ARLS;
  readonly TIPOS_COTIZANTE = TIPOS_COTIZANTE;
  readonly fechaCorta = fechaCorta;

  readonly estado = signal<EstadoArlApi | null>(null);
  readonly cargandoEstado = signal(false);
  readonly errorEstado = signal<string | null>(null);

  // Formulario (se guarda al cambiar cada campo).
  readonly arlNombre = signal<string>(ARL_POR_DEFECTO);
  readonly fechaInicio = signal<string | null>(null);
  readonly tipoCotizante = signal<TipoCotizante | null>('DEPENDIENTE');
  readonly claseRiesgo = signal<number | null>(null);
  readonly porcentaje = signal<number | null>(null);
  readonly CLASES_RIESGO = [1, 2, 3, 4, 5];

  /** PDF elegido y aún sin cargar. */
  readonly archivo = signal<File | null>(null);
  /** Lo que se leyó del PDF elegido (para el rótulo "leído del certificado"). */
  readonly leido = signal<DatosCertificado | null>(null);
  readonly subiendo = signal(false);
  readonly guardando = signal(false);

  readonly hoyIso = isoDia(new Date());

  readonly arlFiltradas = computed(() => {
    const q = this.arlNombre().trim().toUpperCase();
    return q ? ARLS.filter((a) => a.includes(q)) : ARLS;
  });

  readonly afiliacion = computed<AfiliacionArl | null>(() => this.estado()?.arl ?? null);
  readonly certificadoCargado = computed(() => this.afiliacion()?.documento_id != null);

  /** Fecha de ingreso contra la que se compara y de dónde sale. */
  readonly referencia = computed(() => ({
    fecha: this.estado()?.fecha_ingreso_referencia ?? null,
    origen: this.estado()?.fecha_ingreso_origen ?? null,
  }));

  /** Comparación con lo que hay en pantalla (no espera al guardado). */
  readonly coinciden = computed<boolean | null>(() => fechasCoinciden(this.fechaInicio(), this.referencia().fecha));

  readonly faltantesFormulario = computed<string[]>(() => {
    const f: string[] = [];
    if (!this.arlNombre().trim()) f.push('Nombre de la ARL');
    if (!this.fechaInicio()) f.push('Fecha de inicio de afiliación');
    if (!this.tipoCotizante()) f.push('Tipo de cotizante');
    if (this.claseRiesgo() == null) f.push('Clase de riesgo');
    if (this.porcentaje() == null) f.push('Porcentaje de cotización');
    return f;
  });

  constructor() {
    // Cambio de persona o de proceso: se relee el estado y se descarta lo adjuntado.
    effect(() => {
      const id = this.procesoId();
      untracked(() => {
        this.archivo.set(null);
        this.leido.set(null);
        this.estado.set(null);
        if (id != null) void this.recargar(id);
      });
    });
  }

  async recargar(id = this.procesoId()): Promise<void> {
    if (id == null) return;
    this.cargandoEstado.set(true);
    this.errorEstado.set(null);
    try {
      const e = await firstValueFrom(this.api.estado(id));
      if (id !== this.procesoId()) return;
      this.aplicarEstado(e);
    } catch {
      this.errorEstado.set('No se pudo leer la ARL de este proceso. Intenta de nuevo.');
    } finally {
      this.cargandoEstado.set(false);
    }
  }

  private aplicarEstado(e: EstadoArlApi): void {
    this.estado.set(e);
    const a = e.arl;
    this.arlNombre.set(String(a?.arl_nombre ?? '').trim() || ARL_POR_DEFECTO);
    this.fechaInicio.set(isoDia(a?.fecha_inicio_afiliacion));
    const t = String(a?.tipo_cotizante ?? '').toUpperCase();
    this.tipoCotizante.set(t === 'DEPENDIENTE' || t === 'INDEPENDIENTE' ? t : 'DEPENDIENTE');
    this.claseRiesgo.set(a?.clase_riesgo != null ? Number(a.clase_riesgo) : null);
    const pct = a?.porcentaje_cotizacion != null ? Number(a.porcentaje_cotizacion) : NaN;
    this.porcentaje.set(Number.isFinite(pct) ? pct : null);
  }

  // ───────── Campos (guardado al cambiar) ─────────

  async alCambiarArl(valor: string): Promise<void> {
    const v = String(valor ?? '').trim().toUpperCase();
    this.arlNombre.set(v || ARL_POR_DEFECTO);
    if (this.certificadoCargado()) await this.guardar({ arl_nombre: this.arlNombre() });
  }

  async alCambiarFecha(valor: unknown): Promise<void> {
    const iso = isoDia(valor);
    this.fechaInicio.set(iso);
    if (this.certificadoCargado()) {
      await this.guardar({ fecha_inicio_afiliacion: iso });
      this.avisarSiFechaDistinta();
    }
  }

  async alCambiarTipo(valor: TipoCotizante): Promise<void> {
    this.tipoCotizante.set(valor);
    if (this.certificadoCargado()) await this.guardar({ tipo_cotizante: valor });
  }

  async alCambiarClase(valor: number | null): Promise<void> {
    this.claseRiesgo.set(valor);
    if (this.certificadoCargado()) await this.guardar({ clase_riesgo: valor });
  }

  async alCambiarPorcentaje(valor: unknown): Promise<void> {
    const n = Number(String(valor ?? '').replace('%', '').replace(',', '.').trim());
    const v = String(valor ?? '').trim() && Number.isFinite(n) && n > 0 && n < 100 ? n : null;
    this.porcentaje.set(v);
    if (this.certificadoCargado()) await this.guardar({ porcentaje_cotizacion: v });
  }

  private async guardar(cambios: Partial<AfiliacionArl>): Promise<boolean> {
    const id = this.procesoId();
    if (id == null) return false;
    this.guardando.set(true);
    try {
      const e = await firstValueFrom(this.api.guardar(id, cambios));
      if (id === this.procesoId()) this.estado.set(e);
      this.guardado.emit();
      return true;
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'No se guardó la ARL',
        text: err?.error?.detail || 'Intenta de nuevo.' });
      return false;
    } finally {
      this.guardando.set(false);
    }
  }

  // ───────── Certificado ─────────

  async alElegirArchivo(ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const f = inputEl.files?.[0] ?? null;
    inputEl.value = '';
    if (!f) return;
    const esPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!esPdf) {
      await Swal.fire({ icon: 'info', title: 'Solo PDF', text: 'El certificado de la ARL debe ser un PDF.' });
      return;
    }
    this.archivo.set(f);
    this.leido.set(null);
    // Se proponen los datos del certificado; quien carga los revisa.
    try {
      const texto = await this.textoPdf(f);
      const datos = leerCertificadoArl(texto, this.cedula());
      this.leido.set(datos);
      if (datos.arl) this.arlNombre.set(datos.arl);
      if (datos.fechaInicio) this.fechaInicio.set(datos.fechaInicio);
      if (datos.tipoCotizante) this.tipoCotizante.set(datos.tipoCotizante);
      if (datos.claseRiesgo != null) this.claseRiesgo.set(datos.claseRiesgo);
      if (datos.porcentajeCotizacion != null) this.porcentaje.set(datos.porcentajeCotizacion);
    } catch {
      /* Escaneo o PDF que pdf.js no abre: se llenan los campos a mano. */
    }
  }

  quitarArchivo(): void {
    this.archivo.set(null);
    this.leido.set(null);
  }

  verArchivoLocal(): void {
    const f = this.archivo();
    if (!f) return;
    const url = URL.createObjectURL(f);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async cargarCertificado(): Promise<void> {
    const f = this.archivo();
    const id = this.procesoId();
    const cedula = this.cedula();
    if (!f || id == null || !cedula || this.subiendo()) return;
    if (this.bloqueo()) {
      await Swal.fire({ icon: 'info', title: 'Paso cerrado', text: this.bloqueo() ?? '' });
      return;
    }
    const faltan = this.faltantesFormulario();
    if (faltan.length) {
      await Swal.fire({ icon: 'info', title: 'Faltan campos obligatorios', text: faltan.join(', ') + '.' });
      return;
    }

    // 1) ¿El certificado es de esta persona? (mismo verificador del examen médico)
    Swal.fire({
      title: 'Verificando el certificado…',
      html: 'Comprobando que el documento sea de este candidato.',
      allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading(),
    });
    let veredicto: VeredictoIdentidad | null = null;
    try {
      veredicto = await firstValueFrom(this.identidadApi.verificar(f, cedula));
    } catch {
      veredicto = null; // Si el verificador no responde se sigue: nunca bloquea por su fallo.
    }
    Swal.close();

    let justificacion: string | null = null;
    if (veredicto?.resultado === 'NO_COINCIDE') {
      const leida = veredicto.cedula_leida ? ` El documento dice <b>${esc(veredicto.cedula_leida)}</b>.` : '';
      const r = await Swal.fire({
        icon: 'warning',
        title: 'El certificado parece de otra persona',
        html: `Ni la cédula <b>${esc(cedula)}</b> ni el nombre <b>${esc(this.nombre() || '—')}</b>`
          + ` aparecen en <b>${esc(f.name)}</b>.${leida}`
          + '<br><br>Revisa que no hayas adjuntado el certificado de otro candidato.'
          + '<br><br>Si de todas formas es correcto, escribe por qué (queda registrado):',
        input: 'textarea',
        inputPlaceholder: 'Ej.: la ARL escribió mal el nombre; verifiqué la cédula en el certificado.',
        showCancelButton: true,
        confirmButtonText: 'Cargar de todas formas',
        cancelButtonText: 'Cambiar archivo',
        reverseButtons: true,
        inputValidator: (v) => (!v || v.trim().length < 10) ? 'Escribe el motivo (mínimo 10 caracteres).' : undefined,
      });
      if (!r.isConfirmed) return;
      justificacion = String(r.value).trim();
    }

    // 2) Fecha de inicio vs. fecha de ingreso.
    const ref = this.referencia();
    const coincide = this.coinciden();
    const avisoFecha = coincide === false
      ? `<br><br><span style="color:#b42318"><b>⚠ La fecha de inicio de afiliación (${fechaCorta(this.fechaInicio())})`
        + ` no coincide con la fecha de ingreso ${ref.origen === 'VACANTE' ? 'propuesta por la vacante' : 'del contrato'}`
        + ` (${fechaCorta(ref.fecha)}).</b> No se podrá contratar hasta que coincidan.</span>`
      : '';
    const avisoIlegible = veredicto?.resultado === 'NO_VERIFICABLE'
      ? '<br><br><span style="color:#8a6d00">ⓘ No se pudo leer el nombre en el certificado (escaneo). Revísalo a ojo.</span>'
      : '';
    const conf = await Swal.fire({
      icon: coincide === false ? 'warning' : 'question',
      title: this.certificadoCargado() ? '¿Cargar un certificado nuevo?' : '¿Cargar el certificado de la ARL?',
      html: `ARL <b>${esc(this.arlNombre())}</b> · inicio <b>${fechaCorta(this.fechaInicio())}</b>`
        + ` · ${esc(this.tipoCotizante() === 'INDEPENDIENTE' ? 'Independiente' : 'Dependiente')}`
        + ` · riesgo <b>${this.claseRiesgo() ?? '—'}</b> · cotización <b>${this.porcentaje() ?? '—'} %</b>.`
        + '<br>Se subirá al expediente de este proceso (sección Documentos).'
        + (this.certificadoCargado() ? '<br>Reemplaza al certificado enlazado; el anterior sigue en el expediente.' : '')
        + avisoFecha + avisoIlegible,
      showCancelButton: true,
      confirmButtonText: 'Sí, cargar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!conf.isConfirmed) return;

    // 3) Subida + datos.
    const cand = this.candidato();
    const tipoDoc = (cand?.tipo_doc ?? undefined) as string | undefined;
    const contrato = cand?.codigo_contrato || undefined;
    const titulo = `ARL_${this.arlNombre().replace(/\s+/g, '_')}_${cedula}_${(this.fechaInicio() ?? '').replace(/-/g, '')}.pdf`;
    this.subiendo.set(true);
    Swal.fire({ title: 'Cargando certificado…', allowOutsideClick: false, allowEscapeKey: false,
      didOpen: () => Swal.showLoading() });
    try {
      const subido: any = await firstValueFrom(
        this.docSvc.guardarDocumento(titulo, cedula, TIPO_DOCUMENTO_ARL, f, contrato, tipoDoc, id));
      const documentoId = Number(subido?.id ?? subido?.document?.id);
      if (!(documentoId > 0)) throw new Error('gestión documental no devolvió el id del documento');
      const e = await firstValueFrom(this.api.guardar(id, {
        arl_nombre: this.arlNombre(),
        fecha_inicio_afiliacion: this.fechaInicio(),
        tipo_cotizante: this.tipoCotizante(),
        clase_riesgo: this.claseRiesgo(),
        porcentaje_cotizacion: this.porcentaje(),
        documento_id: documentoId,
        identidad_resultado: veredicto?.resultado ?? null,
        identidad_justificacion: justificacion,
      }));
      if (id === this.procesoId()) this.estado.set(e);
      this.archivo.set(null);
      this.leido.set(null);
      Swal.close();
      this.guardado.emit();
      await Swal.fire({
        icon: coincide === false ? 'warning' : 'success',
        title: coincide === false ? 'Certificado cargado, con alerta' : 'Certificado cargado',
        html: coincide === false
          ? 'Las fechas no coinciden: corrige la fecha de inicio o la fecha de ingreso antes de contratar.'
          : 'La ARL quedó registrada y el certificado está en Documentos.',
        timer: coincide === false ? undefined : 2500,
        showConfirmButton: coincide === false,
      });
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        icon: 'error', title: 'No se cargó el certificado',
        text: err?.error?.detail || err?.error?.error || err?.error?.message || err?.message || 'Intenta de nuevo.',
      });
    } finally {
      this.subiendo.set(false);
    }
  }

  /** Alerta automática al cambiar la fecha si deja de coincidir con la de ingreso. */
  private avisarSiFechaDistinta(): void {
    if (this.coinciden() !== false) return;
    const ref = this.referencia();
    void Swal.fire({
      icon: 'warning', toast: true, position: 'top-end', showConfirmButton: false, timer: 6000,
      title: 'Las fechas no coinciden',
      text: `Inicio ARL ${fechaCorta(this.fechaInicio())} ≠ ingreso ${fechaCorta(ref.fecha)}.`,
    });
  }

  async saltarBloqueo(): Promise<void> {
    const id = this.procesoId();
    if (id == null) return;
    const { value: motivo } = await Swal.fire<string>({
      icon: 'question',
      title: 'Saltar el bloqueo de la ARL',
      html: '<p style="margin:0;font-size:13px">Queda registrado a tu nombre, con la fecha y el motivo.</p>',
      input: 'textarea',
      inputPlaceholder: 'Motivo (obligatorio)',
      showCancelButton: true,
      confirmButtonText: 'Saltar bloqueo',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      inputValidator: (v) => (!v || v.trim().length < 5) ? 'Escribe el motivo (mínimo 5 caracteres).' : undefined,
    });
    if (!motivo) return;
    try {
      await firstValueFrom(this.api.saltarBloqueo(id, motivo.trim()));
      await this.recargar(id);
      this.guardado.emit();
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'No se saltó el bloqueo', text: err?.error?.detail || 'Intenta de nuevo.' });
    }
  }

  nombreDoc(d: DocArl): string {
    return String(d?.title ?? '').trim() || `ARL ${d?.id ?? ''}`;
  }

  etiquetaIdentidad(r: string | null | undefined): string {
    switch (r) {
      case 'COINCIDE': return 'Nombre/cédula del trabajador verificados';
      case 'NO_COINCIDE': return 'No coincide con el trabajador (cargado con justificación)';
      case 'NO_VERIFICABLE': return 'No se pudo leer el nombre: revisar a ojo';
      default: return 'Sin verificar';
    }
  }

  private cedula(): string {
    return String(this.candidato()?.numero_documento ?? '').trim();
  }

  private nombre(): string {
    const c = this.candidato();
    return [c?.primer_nombre, c?.segundo_nombre, c?.primer_apellido, c?.segundo_apellido].filter(Boolean).join(' ');
  }

  /** Texto de todas las páginas del PDF (capa de texto; un escaneo devuelve vacío). */
  private async textoPdf(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        // Ruta relativa: el bundler de workers no resuelve especificadores de paquete.
        new URL('../../../../../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url), { type: 'module' });
    }
    const tarea = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const pdf = await tarea.promise;
      const partes: string[] = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
        const page = await pdf.getPage(i);
        const contenido = await page.getTextContent();
        partes.push(contenido.items.map((it: any) => ('str' in it ? it.str : '')).join(' '));
      }
      return partes.join('\n');
    } finally {
      void tarea.destroy();
    }
  }
}
