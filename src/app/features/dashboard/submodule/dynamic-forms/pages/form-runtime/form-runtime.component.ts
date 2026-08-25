import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Input, OnDestroy, OnInit,
  ViewChild, computed, effect, inject, signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, finalize } from 'rxjs';
import Swal from 'sweetalert2';

import { FieldRendererComponent } from '@/app/shared/components/forms/field-renderer/field-renderer.component';
import {
  ApiProblem,
  DocumentRef,
  DynamicField,
  FieldValue,
  FormSection,
  FormStructure,
  SubmissionCreateRequest,
  SubmissionPayload,
  validateFieldValue,
} from '../../models/dynamic-forms.models';
import { modoNavegacion, navegacionEfectiva, temaEfectivo, variablesTema } from '../../models/form-theme';
import { ocupaFilaCompleta } from '../../models/field-layout';
import { recorrido } from '../../models/form-routing';
import { DynamicFormService } from '../../services/dynamic-form.service';
import { FormDesignService } from '../../services/form-design.service';
import { SubmissionService } from '../../services/submission.service';
import { MediaOffloadService } from '../../services/media-offload.service';
import { PlacementService } from '../../services/placement.service';

/** Estado de carga de la estructura del formulario. */
type EstadoCarga = 'cargando' | 'listo' | 'error';

/**
 * RUNTIME DE LLENADO — ruta `llenar/:formId`.
 *
 * Carga la estructura PUBLICADA del formulario y la pinta por secciones en una
 * grilla de 2 columnas (1 en móvil) usando SIEMPRE app-field-renderer en modo
 * 'preview' (los componentes de campo concretos son detalle del motor de render).
 *
 * Los hijos de una SECTION escriben PLANO en la misma sección (vía childChange),
 * exactamente como los espera el payload del backend. La media queda subida a
 * ms-documents ANTES del submit (uploadFn inyectada): el payload solo lleva
 * referencias; si hay subidas en vuelo el envío se bloquea con mensaje claro.
 */
@Component({
  selector: 'app-form-runtime',
  standalone: true,
  imports: [FieldRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './form-runtime.component.html',
  styleUrls: ['./form-runtime.component.css'],
})
export class FormRuntimeComponent implements OnInit, OnDestroy {
  /**
   * Id inyectado por el DISPATCHER (form-view-host): cuando llega, el runtime
   * arranca directo con ese id y NO resuelve la ruta ni toca el título (de eso se
   * encarga el host). Sin input, se conserva el camino clásico paramMap/URL.
   */
  @Input() set formIdInput(id: number | undefined) {
    if (id != null && Number.isFinite(id) && id > 0) {
      this.idPorInput = id;
      this.tituloExterno = true;
      this.iniciar(id, null);
    }
  }
  private idPorInput?: number;
  private tituloExterno = false;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private forms = inject(DynamicFormService);
  private submissions = inject(SubmissionService);
  private media = inject(MediaOffloadService);
  private design = inject(FormDesignService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private placement = inject(PlacementService);
  private titleService = inject(Title);
  private snack = inject(MatSnackBar);

  readonly structure = signal<FormStructure | null>(null);
  readonly estado = signal<EstadoCarga>('cargando');
  readonly errorCarga = signal<string>('');

  /** { [codigoSeccion]: { [nombreCampo]: valor } } — plano por sección, inmutable. */
  readonly values = signal<Record<string, Record<string, FieldValue>>>({});
  readonly showErrors = signal(false);

  readonly enviando = signal(false);
  readonly guardandoBorrador = signal(false);
  readonly enviado = signal(false);
  /** Id del borrador ya persistido; los siguientes guardados/envíos lo reutilizan. */
  readonly draftId = signal<number | null>(null);
  /** Subidas de media EN VUELO (bloquean envío y borrador para no perder referencias). */
  readonly subiendo = signal(0);

  // ── Asistente por secciones ─────────────────────────────────────────
  /**
   * Índice REAL (dentro de st.sections) de la sección visible cuando se llena paso a
   * paso. No es la posición en el recorrido: con ramificaciones el paso 2 puede ser la
   * sección 5. La posición dentro del recorrido es `pasoEnRuta()`.
   */
  readonly paso = signal(0);

  /**
   * RECORRIDO real según lo respondido hasta ahora: índices de las secciones que este
   * formulario, con estas respuestas, sí atraviesa. Se recalcula solo (los valores son
   * un signal), así que cambiar la respuesta que ramifica reordena el asistente en vivo.
   * Es el MISMO cálculo que hace el servidor al validar (RoutingPlan).
   */
  readonly recorridoActual = computed<number[]>(() => {
    const st = this.structure();
    return st ? recorrido(st.sections, this.values()) : [];
  });

  /** Posición del paso actual DENTRO del recorrido (0 si se salió de él). */
  readonly pasoEnRuta = computed(() => Math.max(0, this.recorridoActual().indexOf(this.paso())));

  /** Pasos que pinta el indicador de progreso: solo las secciones del recorrido. */
  readonly pasosRuta = computed<Array<{ indice: number; code: string; titulo: string }>>(() => {
    const st = this.structure();
    if (!st) return [];
    return this.recorridoActual().map(i => ({
      indice: i,
      code: this.sectionKey(st.sections[i], i),
      titulo: st.sections[i].title || `Sección ${i + 1}`,
    }));
  });

  /**
   * Paso a paso SÍ o NO. Regla del producto: con 2+ secciones el formulario se llena
   * por pasos, salvo que su tema pida explícitamente `single`. Con una sola sección el
   * asistente no aporta nada.
   */
  readonly esWizard = computed(() => {
    const st = this.structure();
    return !!st && modoNavegacion(st.ui, st.sections.length) === 'wizard';
  });

  readonly mostrarProgreso = computed(() =>
    navegacionEfectiva(this.structure()?.ui?.navigation).progress);

  readonly esUltimoPaso = computed(() => {
    const st = this.structure();
    if (!st || !this.esWizard()) return true;
    const ruta = this.recorridoActual();
    return ruta.length === 0 || this.paso() === ruta[ruta.length - 1];
  });

  /**
   * Lo que se pinta: la sección del paso actual, o TODO EL RECORRIDO si el modo es de
   * corrido. En corrido las secciones que la ruta descarta desaparecen en vivo al
   * cambiar la respuesta que ramifica.
   */
  readonly seccionesVisibles = computed<FormSection[]>(() => {
    const st = this.structure();
    if (!st) return [];
    if (!this.esWizard()) return this.recorridoActual().map(i => st.sections[i]);
    const actual = st.sections[this.paso()];
    return actual ? [actual] : [];
  });

  readonly progresoPct = computed(() => {
    const total = this.recorridoActual().length;
    if (total === 0) return 0;
    return Math.round(((this.pasoEnRuta() + 1) / total) * 100);
  });

  // ── Tema de diseño ──────────────────────────────────────────────────
  readonly iconoHeader = computed(() => temaEfectivo(this.structure()?.ui?.theme).icon ?? 'edit_note');
  readonly portadaUrl = signal<string | null>(null);
  readonly portadaAlt = computed(() => this.structure()?.ui?.theme?.cover_alt ?? '');
  /** objectURL de la portada bajada de ms-documents; hay que revocarlo al destruir. */
  private portadaObjectUrl: string | null = null;

  /** Zona con el ÚNICO scroll de la página (los campos). */
  @ViewChild('zonaScroll') private zonaScroll?: ElementRef<HTMLElement>;

  private formId = 0;

  /** Sube a ms-documents y lleva la cuenta de subidas en vuelo (fail-closed en submit). */
  readonly uploadFn = (file: File): Observable<DocumentRef> => {
    this.subiendo.update(n => n + 1);
    return this.media
      .upload(file, this.formId)
      .pipe(finalize(() => this.subiendo.update(n => Math.max(0, n - 1))));
  };

  readonly downloadUrlFn = (ref: DocumentRef): string => this.media.downloadUrl(ref);

  /** Etiqueta del menú (para el título de página); la trae el placement/resolve. */
  private menuLabel: string | null = null;

  constructor() {
    // El tema se aplica como custom properties en el HOST: así cascadean a los campos
    // (app-field-renderer y sus hijos), no solo a la página. Se hace por API del DOM
    // porque el binding [style] de Angular no fija propiedades personalizadas.
    effect(() => {
      const vars = variablesTema(this.structure()?.ui?.theme);
      const el = this.host.nativeElement;
      for (const [nombre, valor] of Object.entries(vars)) el.style.setProperty(nombre, valor);
    });

    // Portada: URL directa si el tema la trae, o blob autenticado de ms-documents
    // (un <img> no manda el JWT, igual que en el campo FOTO).
    effect(() => {
      const theme = this.structure()?.ui?.theme;
      this.revocarPortada();
      if (theme?.cover_url) {
        this.portadaUrl.set(theme.cover_url);
        return;
      }
      this.portadaUrl.set(null);
      const docId = theme?.cover_document_id;
      if (!docId) return;
      this.design.portadaBlobUrl(docId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: url => { this.portadaObjectUrl = url; this.portadaUrl.set(url); },
          error: () => this.portadaUrl.set(null),
        });
    });
  }

  ngOnDestroy(): void {
    this.revocarPortada();
  }

  private revocarPortada(): void {
    if (this.portadaObjectUrl) {
      URL.revokeObjectURL(this.portadaObjectUrl);
      this.portadaObjectUrl = null;
    }
  }

  ngOnInit(): void {
    // Cuando el DISPATCHER ya inyectó el id, el setter arrancó la carga: no se
    // resuelve la ruta (evita doble resolución).
    if (this.idPorInput != null) return;

    // Dos formas de entrar (uso clásico, sin host):
    //  (a) ruta canónica del módulo anfitrión (…/nomina/novedades/x, SIN :formId): se
    //      resuelve el formId por route_path — así el formulario es una vista del módulo.
    //  (b) ruta vieja `llenar/:formId`: se conserva por compat; si el formulario ya está
    //      LINKED, se redirige a su ruta canónica (replaceUrl).
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(pm => {
      const idParam = Number(pm.get('formId'));
      if (Number.isFinite(idParam) && idParam > 0) {
        this.entrarPorId(idParam);
      } else {
        this.entrarPorRuta();
      }
    });
  }

  private entrarPorId(id: number): void {
    // Redirige la ruta vieja a la canónica cuando el formulario está publicado.
    this.placement.getPlacement(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => {
        if (p.placement_status === 'LINKED' && p.route_path) {
          this.router.navigateByUrl('/dashboard/' + p.route_path, { replaceUrl: true });
        } else {
          this.iniciar(id, p.menu_label ?? null);
        }
      },
      error: () => this.iniciar(id, null),
    });
  }

  private entrarPorRuta(): void {
    const routePath = this.rutaActual();
    this.placement.resolveRoute(routePath).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        if (res && res.form_id) {
          if (res.canonical_route_path && res.canonical_route_path !== routePath) {
            this.router.navigateByUrl('/dashboard/' + res.canonical_route_path, { replaceUrl: true });
            return;
          }
          this.iniciar(res.form_id, res.menu_label ?? null);
        } else {
          this.errorCarga.set('Esta vista no corresponde a ningún formulario disponible.');
          this.estado.set('error');
        }
      },
      error: () => {
        this.errorCarga.set('No se pudo resolver la vista. Intenta de nuevo.');
        this.estado.set('error');
      },
    });
  }

  private iniciar(id: number, menuLabel: string | null): void {
    this.formId = id;
    this.menuLabel = menuLabel;
    // El host (dispatcher) ya fija el título con la etiqueta del menú: no lo pisamos.
    if (menuLabel && !this.tituloExterno) this.titleService.setTitle(menuLabel);
    this.reiniciar();
    this.structure.set(null);
    this.cargar();
  }

  /** URL actual relativa a /dashboard (sin query ni fragment), como espera el backend. */
  private rutaActual(): string {
    let url = this.router.url.split('?')[0].split('#')[0];
    if (url.startsWith('/dashboard/')) url = url.substring('/dashboard/'.length);
    else if (url.startsWith('/')) url = url.substring(1);
    return url.replace(/\/+$/, '');
  }

  // ── Carga de estructura ─────────────────────────────────────────────

  recargar(): void {
    this.cargar();
  }

  private cargar(): void {
    if (!this.formId) {
      this.errorCarga.set('El identificador del formulario no es válido.');
      this.estado.set('error');
      return;
    }
    this.estado.set('cargando');
    this.forms
      .structure(this.formId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: st => {
          this.structure.set(st);
          this.estado.set('listo');
          // Título de página = etiqueta del menú, o el nombre del formulario como respaldo
          // (salvo que el host ya gobierne el título).
          if (!this.menuLabel && !this.tituloExterno && st.form_name) this.titleService.setTitle(st.form_name);
        },
        error: (err: HttpErrorResponse) => {
          const p = this.comoProblema(err);
          this.errorCarga.set(
            p.detail ?? 'No se pudo cargar el formulario. Verifica que esté publicado e intenta de nuevo.',
          );
          this.estado.set('error');
        },
      });
  }

  // ── Claves y helpers de render ──────────────────────────────────────

  /** Clave de la sección en el payload (el backend siempre publica `code`). */
  sectionKey(sec: FormSection, index: number): string {
    return sec.code ?? `seccion_${index + 1}`;
  }

  /**
   * Índice REAL de la sección que se está pintando. En modo asistente el @for solo
   * recorre una sección, así que su $index siempre es 0 pero la clave del payload debe
   * seguir siendo la de su posición verdadera.
   */
  indiceReal(indiceVisible: number): number {
    if (this.esWizard()) return this.paso();
    return this.recorridoActual()[indiceVisible] ?? indiceVisible;
  }

  // ── Navegación del asistente ────────────────────────────────────────

  /**
   * Avanza al siguiente paso, pero NO deja pasar con la sección actual incompleta:
   * es el momento natural de corregir, no al final de un formulario de 40 campos.
   */
  siguiente(): void {
    const st = this.structure();
    if (!st || this.esUltimoPaso()) return;
    const invalidos = this.camposInvalidos(st, this.paso());
    if (invalidos.length > 0) {
      this.showErrors.set(true);
      this.snack.open('Completa los campos marcados para continuar', 'Cerrar', { duration: 4000 });
      this.irAlPrimerInvalido(invalidos);
      return;
    }
    this.showErrors.set(false);
    // El siguiente paso lo dicta el RECORRIDO, no el orden: puede saltarse secciones
    // según lo que se acabe de responder. Se recalcula aquí (ya con la respuesta puesta).
    const ruta = this.recorridoActual();
    const siguiente = ruta[ruta.indexOf(this.paso()) + 1];
    if (siguiente == null) return;
    this.paso.set(siguiente);
    this.scrollArriba();
  }

  anterior(): void {
    const ruta = this.recorridoActual();
    const anterior = ruta[ruta.indexOf(this.paso()) - 1];
    if (anterior == null) return;
    this.showErrors.set(false);
    this.paso.set(anterior);
    this.scrollArriba();
  }

  /** Solo hacia atrás DENTRO del recorrido: adelante se va validando con "Siguiente". */
  irAPaso(indice: number): void {
    const ruta = this.recorridoActual();
    const destino = ruta.indexOf(indice);
    if (destino < 0 || destino >= this.pasoEnRuta()) return;
    this.showErrors.set(false);
    this.paso.set(indice);
    this.scrollArriba();
  }

  /** Clave del campo en el payload — misma regla que el id `df-<name>` de los inputs. */
  fieldKey(f: DynamicField): string {
    return f.name ?? f.label;
  }

  /** Misma regla de ancho completo que aplica el renderer dentro de las SECTION. */
  /** Regla compartida con la vista previa del constructor (models/field-layout). */
  esAnchoCompleto(f: DynamicField): boolean {
    return ocupaFilaCompleta(f);
  }

  valorDe(secKey: string, f: DynamicField): FieldValue {
    const seccion = this.values()[secKey];
    return seccion ? seccion[this.fieldKey(f)] ?? null : null;
  }

  /** Valores planos de la sección (los hijos de SECTION viven ahí mismo). */
  seccionValores(secKey: string): Record<string, FieldValue> | null {
    return this.values()[secKey] ?? null;
  }

  /** Escritura inmutable de un valor (campo directo o hijo de SECTION, da igual). */
  setValue(secKey: string, nombre: string, v: FieldValue): void {
    this.values.update(prev => ({
      ...prev,
      [secKey]: { ...(prev[secKey] ?? {}), [nombre]: v },
    }));
  }

  // ── Guardar borrador ────────────────────────────────────────────────

  guardarBorrador(): void {
    const st = this.structure();
    if (!st || this.enviando() || this.guardandoBorrador()) return;
    if (this.subiendo() > 0) {
      this.snack.open('Hay archivos subiéndose todavía; espera a que terminen para guardar.', 'Cerrar', {
        duration: 4000,
      });
      return;
    }
    const req: SubmissionCreateRequest = { status: 'DRAFT', payload: this.construirPayload(st) };
    this.guardandoBorrador.set(true);
    const id = this.draftId();
    const peticion = id != null
      ? this.submissions.updateDraft(id, req)
      : this.submissions.create(st.version.id, req);
    peticion.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => {
        this.guardandoBorrador.set(false);
        this.draftId.set(s.id);
        this.snack.open('Borrador guardado', 'Cerrar', { duration: 3000 });
      },
      error: (err: HttpErrorResponse) => {
        this.guardandoBorrador.set(false);
        this.mostrarErrorApi('No se pudo guardar el borrador', err, () => this.guardarBorrador());
      },
    });
  }

  // ── Enviar ──────────────────────────────────────────────────────────

  onSubmit(ev: Event): void {
    ev.preventDefault();
    this.enviar();
  }

  enviar(): void {
    const st = this.structure();
    if (!st || this.enviando() || this.guardandoBorrador()) return;
    if (this.subiendo() > 0) {
      this.snack.open('Hay archivos subiéndose todavía; espera a que terminen para enviar.', 'Cerrar', {
        duration: 4000,
      });
      return;
    }

    // Validación cliente de TODOS los campos (hijos de SECTION aplanados incluidos).
    const invalidos = this.camposInvalidos(st);
    if (invalidos.length > 0) {
      this.showErrors.set(true);
      this.snack.open('Revisa los campos marcados', 'Cerrar', { duration: 4000 });
      // En modo asistente el campo malo puede estar en un paso que no está en pantalla:
      // primero se salta a ese paso y solo después se hace scroll hasta él.
      const paso = this.primerPasoInvalido(st);
      if (paso != null && paso !== this.paso()) {
        this.paso.set(paso);
        setTimeout(() => this.irAlPrimerInvalido(invalidos));
      } else {
        this.irAlPrimerInvalido(invalidos);
      }
      return;
    }

    const req: SubmissionCreateRequest = { status: 'SUBMITTED', payload: this.construirPayload(st) };
    this.enviando.set(true);
    const id = this.draftId();
    // Un borrador existente se COMPLETA (updateDraft con SUBMITTED), no se duplica.
    const peticion = id != null
      ? this.submissions.updateDraft(id, req)
      : this.submissions.create(st.version.id, req);
    peticion.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.enviando.set(false);
        this.draftId.set(null);
        this.enviado.set(true);
        this.scrollArriba();
      },
      error: (err: HttpErrorResponse) => {
        this.enviando.set(false);
        this.mostrarErrorApi('No se pudo enviar la respuesta', err, () => this.enviar());
      },
    });
  }

  /** Pantalla de gracias → limpiar todo y permitir otra respuesta del mismo formulario. */
  enviarOtra(): void {
    this.reiniciar();
    this.scrollArriba();
  }

  /**
   * Sube la ZONA DE CAMPOS, que es el único contenedor con scroll de la página.
   * `window.scrollTo` no hacía nada aquí: el documento no se desplaza.
   */
  private scrollArriba(): void {
    this.zonaScroll?.nativeElement.scrollTo({ top: 0, behavior: 'smooth' });
  }

  volver(): void {
    void this.router.navigate(['../..'], { relativeTo: this.route });
  }

  // ── Internos ────────────────────────────────────────────────────────

  private reiniciar(): void {
    this.values.set({});
    this.paso.set(0);
    this.showErrors.set(false);
    this.enviado.set(false);
    this.enviando.set(false);
    this.guardandoBorrador.set(false);
    this.draftId.set(null);
    this.subiendo.set(0);
  }

  /**
   * Nombres (en orden de pantalla) de los campos cuyo valor no pasa
   * validateFieldValue. COMMENT/SECTION no llevan valor y se saltan;
   * los hijos de SECTION se validan aplanados contra la misma sección.
   * Con `soloSeccion` valida un único paso del asistente.
   */
  private camposInvalidos(st: FormStructure, soloSeccion?: number): string[] {
    const nombres: string[] = [];
    // Una sección fuera del recorrido no se le mostró a nadie: exigir sus obligatorios
    // dejaría el formulario imposible de enviar. El servidor aplica la misma regla.
    const ruta = new Set(this.recorridoActual());
    st.sections.forEach((sec, i) => {
      if (soloSeccion != null && i !== soloSeccion) return;
      if (soloSeccion == null && !ruta.has(i)) return;
      const actuales = this.values()[this.sectionKey(sec, i)] ?? {};
      const revisar = (f: DynamicField): void => {
        if (f.type === 'COMMENT' || f.type === 'SECTION') return;
        const nombre = this.fieldKey(f);
        if (validateFieldValue(f, actuales[nombre] ?? null) !== null) nombres.push(nombre);
      };
      for (const f of sec.fields) {
        if (f.type === 'SECTION') (f.children ?? []).forEach(revisar);
        else revisar(f);
      }
    });
    return nombres;
  }

  /**
   * Payload = SOLO valores no-null, agrupados por sección; los hijos de SECTION
   * van PLANOS dentro de su sección y los COMMENT no aparecen jamás.
   */
  /** Índice de la primera sección con algún campo inválido (null si están todas bien). */
  private primerPasoInvalido(st: FormStructure): number | null {
    for (const i of this.recorridoActual()) {
      if (this.camposInvalidos(st, i).length > 0) return i;
    }
    return null;
  }

  /** Salta al paso que contiene la sección señalada por el backend en un error de campo. */
  private irASeccion(st: FormStructure, seccion: string): void {
    if (!this.esWizard()) return;
    const i = st.sections.findIndex((sec, idx) => this.sectionKey(sec, idx) === seccion);
    if (i >= 0 && i !== this.paso() && this.recorridoActual().includes(i)) this.paso.set(i);
  }

  private construirPayload(st: FormStructure): SubmissionPayload {
    const payload: SubmissionPayload = {};
    // Solo viaja lo del RECORRIDO: si alguien contestó una rama y luego cambió la
    // respuesta que ramifica, esos valores ya no forman parte de esta respuesta.
    const ruta = new Set(this.recorridoActual());
    st.sections.forEach((sec, i) => {
      if (!ruta.has(i)) return;
      const secKey = this.sectionKey(sec, i);
      const actuales = this.values()[secKey] ?? {};
      const grupo: Record<string, FieldValue> = {};
      const agregar = (f: DynamicField): void => {
        if (f.type === 'COMMENT' || f.type === 'SECTION') return;
        const nombre = this.fieldKey(f);
        const v = actuales[nombre] ?? null;
        if (v !== null) grupo[nombre] = v;
      };
      for (const f of sec.fields) {
        if (f.type === 'SECTION') (f.children ?? []).forEach(agregar);
        else agregar(f);
      }
      if (Object.keys(grupo).length > 0) payload[secKey] = grupo;
    });
    return payload;
  }

  /**
   * NUNCA bloquear en silencio: scroll suave y foco al primer campo inválido.
   * Se ancla a la CELDA (id df-anchor-<name>, presente para TODOS los tipos) y no al
   * input, porque dropdown/choice/signature no exponen id=df-<name>. Como respaldo,
   * intenta también el input df-<name> para enfocar el control cuando existe.
   */
  private irAlPrimerInvalido(nombres: string[]): void {
    for (const nombre of nombres) {
      const el = document.getElementById(`df-anchor-${nombre}`) ?? document.getElementById(`df-${nombre}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const focusable = document.getElementById(`df-${nombre}`) ?? el;
        try {
          (focusable as HTMLElement).focus({ preventScroll: true });
        } catch {
          /* elemento no enfocable: el scroll ya lo señala */
        }
        return;
      }
    }
  }

  private comoProblema(err: HttpErrorResponse): ApiProblem {
    return err.error && typeof err.error === 'object' ? (err.error as ApiProblem) : {};
  }

  /** Swal con el detail del ProblemDetail + errores por campo (con su etiqueta) y Reintentar. */
  private mostrarErrorApi(titulo: string, err: HttpErrorResponse, reintentar: () => void): void {
    const problema = this.comoProblema(err);
    const detalle = problema.detail ?? 'Ocurrió un error inesperado. Intenta de nuevo.';
    let html = `<p>${this.escapeHtml(detalle)}</p>`;
    const st = this.structure();
    if (problema.errors?.length && st) {
      // El servidor marcó campos: mostramos también los errores en línea.
      this.showErrors.set(true);
      this.irASeccion(st, problema.errors[0].section);
      const items = problema.errors
        .map(
          e =>
            `<li><strong>${this.escapeHtml(this.etiquetaDe(st, e.section, e.field))}</strong>: ` +
            `${this.escapeHtml(e.message)}</li>`,
        )
        .join('');
      html += `<ul style="text-align:left;margin:10px 0 0;padding-left:18px">${items}</ul>`;
    }
    void Swal.fire({
      icon: 'error',
      title: titulo,
      html,
      confirmButtonText: 'Reintentar',
      showCancelButton: true,
      cancelButtonText: 'Cerrar',
    }).then(r => {
      if (r.isConfirmed) reintentar();
    });
  }

  /** Etiqueta visible de un campo a partir de (sección, nombre) del error del API. */
  private etiquetaDe(st: FormStructure, seccion: string, campo: string): string {
    for (let i = 0; i < st.sections.length; i++) {
      const sec = st.sections[i];
      if (this.sectionKey(sec, i) !== seccion) continue;
      for (const f of sec.fields) {
        if (this.fieldKey(f) === campo) return f.label;
        if (f.type === 'SECTION') {
          const hijo = (f.children ?? []).find(c => this.fieldKey(c) === campo);
          if (hijo) return hijo.label;
        }
      }
    }
    return campo;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
