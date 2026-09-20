import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  NgZone,
  OnInit,
  output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ValidatorFn,
  AbstractControl,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { DateAdapter } from '@angular/material/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, firstValueFrom, map, merge, startWith, take, filter, of, catchError, shareReplay } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import Swal from 'sweetalert2';

import colombia from '../../../../../../data/colombia.json';
import { TextFieldModule } from '@angular/cdk/text-field';
import {
  campoMotivoContrario,
  campoMotivoDe,
  ESTADOS_OBSERVACION,
  MAX_MOTIVO,
  observacionCompleta,
} from './observacion-evaluador.rules';
import { isPlatformBrowser } from '@angular/common';
import { SharedModule } from '@/app/shared/shared.module';
import {
  anclaSeccion,
  FichaCamposComponent,
  SECCIONES_FICHA,
  SECCIONES_FICHA_EXTRA,
  SeccionFicha,
} from '../ficha-campos/ficha-campos.component';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { docParaEnviar } from '@/app/shared/utils/tipo-doc.util';
import { RegistroProcesoContratacion } from '../../service/registro-proceso-contratacion/registro-proceso-contratacion';
import { SeleccionEstadoService } from '../../service/seleccion/seleccion-estado.service';
import { AnalisisIaService, AnalisisCandidato, PuntoAnalisis } from '../../service/analisis-ia/analisis-ia.service';
import { Router } from '@angular/router';
import {
  GestionParametrizacionService,
  CatalogValue,
} from '../../../users/services/gestion-parametrizacion/gestion-parametrizacion.service';
import { PipelineNavService } from '../../service/pipeline-nav/pipeline-nav.service';
import { Avance, avanceDeForm } from '../../shared/progreso.util';
import { AutoGuardado, GuardadoIncompleto } from '../../shared/auto-guardado';
import { AutoGuardadoEstadoComponent } from '../auto-guardado-estado/auto-guardado-estado.component';
import { AsistenteIaComponent } from '../../../herramientas-ia/pages/asistente-ia/asistente-ia.component';

@Component({
  selector: 'app-form-entrevista',
  standalone: true,
  imports: [
    MatIconModule, SharedModule, AsistenteIaComponent, FichaCamposComponent, AutoGuardadoEstadoComponent,
    // `cdkTextareaAutosize` de los motivos de NO APLICA / EN ESPERA.
    TextFieldModule,
  ],
  templateUrl: './form-entrevista.component.html',
  styleUrls: ['./form-entrevista.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormEntrevistaComponent implements OnInit {
  /** Último titular (tipo|número) rellenado desde el servidor (effect del constructor). */
  private cedulaRellenada: string | null = null;

  /**
   * Entrevista y datos de la persona sin botón "Enviar": cada respuesta se
   * guarda sola. Mientras falten obligatorios se guarda lo respondido; cuando
   * está completa se marca además la entrevista como realizada.
   */
  readonly autoEntrevista = new AutoGuardado(
    () => this.onSubmit({ silencioso: true }),
    () => {
      const c = this.candidatoSeleccionado();
      return c?.numero_documento ? `${c.tipo_doc || 'CC'}|${c.numero_documento}` : '';
    },
  );

  // ====== Inputs / Outputs / Servicios ======
  candidatoSeleccionado = input<any | null>(null);
  /**
   * Override "Modificar de todas formas". Sin esto, guardar la entrevista de un
   * candidato cuyo proceso ya es terminal (contratado, retirado, rechazado, no
   * pasó la prueba, NO_APLICA/EN_ESPERA) abre una entrevista y un proceso NUEVOS
   * — que es la regla correcta cuando de verdad se re-inicia el proceso, pero no
   * cuando el usuario destrabó los tabs justamente para CORREGIR el actual.
   * Con la bandera en true el backend edita la entrevista existente en sitio.
   */
  modificacionForzada = input<boolean>(false);
  /** Nº de consulta del buscador: re-consultar a la misma persona re-rellena. */
  consultaSeq = input<number>(0);
  modificadoPor = input<string>('');
  /**
   * Documento tal como se tecleó en el buscador.
   *
   * Hay registros a los que `numero_documento` les llega vacío. La ficha se
   * pinta igual, pero la IA se quedaba sin cédula —y sin cédula no hay
   * expediente ni chat que hable de la persona que está en pantalla—. El
   * pipeline sabe con qué documento se buscó y lo baja hasta aquí, igual que
   * ya lo hace con los módulos de Documentos.
   */
  documentoBuscado = input<string | null>(null);
  /** Se emite tras guardar la entrevista con éxito, para que el padre recargue
   *  el candidato (y aparezca el proceso nuevo sin re-buscar). */
  guardado = output<void>();

  /**
   * La entrevista se envió y quedó guardada, con el veredicto que llevara.
   *
   * Va aparte de `guardado` a propósito: ese lo emiten también la remisión y los
   * demás tabs, y colgar de él el salto a Remisión haría saltar la pantalla cada
   * vez que se guarda cualquier otra cosa. Este solo sale de "Enviar" de la
   * entrevista, y el pipeline decide a dónde llevar según el veredicto.
   */
  entrevistaEnviada = output<'APLICA' | 'NO_APLICA' | 'EN_ESPERA' | null>();

  private readonly fb = inject(FormBuilder);
  private readonly dateAdapter = inject<DateAdapter<Date>>(
    DateAdapter as any
  );
  private readonly route = inject(ActivatedRoute);
  private readonly util = inject(UtilityServiceService);
  private readonly candidateService = inject(RegistroProcesoContratacion);
  private readonly catalogos = inject(GestionParametrizacionService);
  /** SSR no tiene DOM: el salto de scroll solo corre en el navegador. */
  private readonly platformId = inject(PLATFORM_ID);
  private readonly seleccionEstado = inject(SeleccionEstadoService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  // ====== Catálogos ======
  /**
   * Catálogo con la respuesta compartida entre TODOS los `| async`.
   *
   * Sin `shareReplay` cada suscripción del template dispara su propia petición,
   * porque un observable de HttpClient es frío. `parentescosOpciones$` se usa
   * en las 4 filas de familiares → salían 4 GET idénticos del mismo catálogo
   * (y 2 de estado civil, 2 de marketing) cada vez que se abría un candidato.
   *
   * `refCount: false` a propósito: el valor queda cacheado aunque se queden en
   * cero suscriptores, así cambiar de pestaña no vuelve a pedir la lista.
   */
  private safeCatalog(code: string, label: string): Observable<CatalogValue[]> {
    return this.catalogos.listDatosByTablaCodigo(code, { activo: true }).pipe(
      catchError((err) => {
        console.error(`[form-entrevista] Error cargando catálogo "${label}":`, err);
        Swal.fire({
          icon: 'warning',
          title: 'Error cargando opciones',
          text: `No se pudo cargar la lista "${label}". Recargue la página o contacte a soporte.`,
          confirmButtonColor: '#3085d6',
        });
        return of([] as CatalogValue[]);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }

  tipoDocOpciones$: Observable<CatalogValue[]> = this.safeCatalog('TIPOS_IDENTIFICACION', 'Tipo de Documento');
  escolaridadOpciones$: Observable<CatalogValue[]> = this.safeCatalog('CATALOGO_NIVELES_ESCOLARIDAD', 'Escolaridad');
  estadoCivilOpciones$: Observable<CatalogValue[]> = this.safeCatalog('ESTADOS_CIVILES', 'Estado Civil');

  conQuienViveOpciones$: Observable<CatalogValue[]> = this.safeCatalog('CATALOGO_CON_QUIEN_VIVE', 'Con quién vive').pipe(
    map((opts) => {
      const seen = new Set<string>();
      return (opts ?? []).filter((o) => {
        const k = String(o['codigo'] ?? '').trim().toUpperCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    })
  );

  dominioCorreoOpciones$: Observable<CatalogValue[]> = this.safeCatalog('DOMINIOS', 'Dominios de Correo');
  comoSeEnteroOpciones$: Observable<CatalogValue[]> = this.safeCatalog('CATALOGO_MARKETING', '¿Cómo se enteró?');
  parentescosOpciones$: Observable<CatalogValue[]> = this.safeCatalog('PARENTESCOS_FAMILIARES', 'Parentescos');
  /**
   * Ocupaciones. Es el mismo catálogo que usa el formulario de la vacante en
   * los pasos de pareja, padres y contacto de emergencia; sin él, el
   * seleccionador tendría que teclear a mano lo que la persona eligió de una
   * lista, y los dos valores no volverían a coincidir.
   */
  ocupacionesOpciones$: Observable<CatalogValue[]> = this.safeCatalog('OCUPACIONES', 'Ocupaciones');
  /**
   * Los tres catálogos del bloque de experiencia laboral de la hoja de
   * entrevista. Son LOS MISMOS que usa el formulario de la vacante: si aquí se
   * teclearan a mano, el valor que eligió la persona y el que registra el
   * evaluador dejarían de coincidir.
   */
  areasExperienciaOpciones$: Observable<CatalogValue[]> = this.safeCatalog('AREAS_EXPERIENCIA', 'Áreas de experiencia');
  tiempoExperienciaOpciones$: Observable<CatalogValue[]> = this.safeCatalog('TIEMPO_EXPERIENCIA', 'Tiempo de experiencia');
  motivosRetiroOpciones$: Observable<CatalogValue[]> = this.safeCatalog('CATALOGO_MOTIVOS_RETIRO', 'Motivos de retiro');

  // ====== Form / estado ======
  formVacante!: FormGroup;
  isSubmitting = false;
  lockedOffice?: string;
  firma = '';

  // Agrupadores lógicos (ex "steps") para validación seccional
  step1Ctrl = new FormGroup({});
  step2Ctrl = new FormGroup({});
  step3Ctrl = new FormGroup({});
  step4Ctrl = new FormGroup({});
  step5Ctrl = new FormGroup({});
  step6Ctrl = new FormGroup({});
  step7Ctrl = new FormGroup({});

  // Auxiliares
  readonly emailUserPattern = '^[^@\\s]+$';
  readonly otroExperienciaControl = new FormControl('', [
    Validators.maxLength(64),
  ]);

  // Autocomplete ciudades
  allCities: string[] = [];
  filteredCities$!: Observable<string[]>;
  filteredCitiesNacimiento$!: Observable<string[]>;

  // Listas fijas
  readonly SEED_EXP_COUNT = 0;

  readonly sexos = ['M', 'F'] as const;
  // Fuente de verdad: gestion_admin.Sede == NUMERO_POR_OFICINA del backend
  // (GET /gestion_contratacion/oficinas/). Toda oficina de esta lista TIENE
  // rango de numeracion de contratos; si se agrega una que no lo tenga, el
  // backend rechaza el guardado con 400.
  readonly oficinas = [
    'ADMINISTRATIVOS',
    'ANDES',
    'BOSA',
    'CARTAGENITA',
    'FACA_PRIMERA',
    'FACA_PRINCIPAL',
    'FONTIBÓN',
    'FORANEOS',
    'FUNZA',
    'MADRID',
    'MONTE_VERDE',
    'ROSAL',
    'SOACHA',
    'SOTAQUIRA',
    'SUBA',
    'TOCANCIPÁ',
    'USME',
    'VIRTUAL',
    'ZIPAQUIRÁ',
  ] as const;

  // ==========================================================================
  // FICHA DEL CANDIDATO — panel lateral vivo + área de trabajo por pestañas
  // ==========================================================================
  /*
   * La vista de Selección dejó de ser un formulario de 900 líneas en scroll
   * único. Ahora son dos piezas:
   *
   *   izquierda  — la FICHA: foto + los datos de la persona, siempre visibles.
   *                Cada dato se edita EN SITIO (click en la fila → el control
   *                real del formulario aparece ahí mismo). No es una copia de
   *                solo lectura: son los mismos `formControlName` de siempre,
   *                así que validadores, catálogos y el guardado no cambian.
   *   derecha    — el ÁREA DE TRABAJO: una barra de 5 pestañas con lo que hay
   *                que hacer con la persona al frente.
   *
   * El objetivo es que quien entrevista tenga a la vista a quién tiene enfrente
   * mientras trabaja, y pueda corregir un dato mal capturado sin perder el
   * sitio donde iba.
   */

  /**
   * Pestaña abierta del área de trabajo. `remision` se proyecta desde el padre.
   *
   * Ya no es estado local: el rail de la izquierda del pipeline es quien pinta
   * estas pestañas, y el rail vive tres componentes más arriba. La señal la
   * guarda `PipelineNavService`, así que rail y panel son el mismo dato en vez
   * de dos copias que había que mantener sincronizadas.
   */
  private readonly nav = inject(PipelineNavService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  readonly panel = this.nav.panelSeleccion;

  /**
   * Fila de la ficha que está en modo edición (`null` = todo en lectura).
   * Una sola a la vez: abrir otra cierra la anterior, que es lo que hace que
   * el panel siga siendo legible mientras se corrige.
   */
  readonly filaEnEdicion = signal<string | null>(null);

  /**
   * Tarjetas accesorias del panel que están plegadas.
   *
   * La entrevista es una hoja larga y lo que se quiere en pantalla son los
   * CAMPOS: la sugerencia de la IA vale cuando se consulta y estorba el resto
   * del tiempo, así que arranca plegada. La elección se recuerda en el
   * navegador (`restaurarPlegados`) para no tener que plegarla en cada
   * candidato.
   */
  private readonly plegados = signal<ReadonlySet<string>>(new Set(['ia']));

  /** Foto del candidato, resuelta por el pipeline (doc subido o biometría). */
  fotoUrl = input<string | null>(null);
  /** Datos de la obra/vacante remitida, ya formateados por el padre. */
  datosObra = input<{ label: string; value: string | null }[]>([]);
  /** Candidato EN ESPERA o NO APLICA: la remisión queda bloqueada. */
  bloqueado = input<boolean>(false);

  /** Click en la foto → el pipeline abre la cámara. */
  fotoSolicitada = output<void>();
  /** Salto a un paso del stepper superior (exámenes / contratación). */
  irAPaso = output<'salud' | 'contratacion'>();

  // ── Catálogos como mapa código → descripción, para pintar la ficha ────────
  // El formulario guarda códigos; la ficha tiene que mostrar el texto. Estos
  // mapas se alimentan de los MISMOS observables cacheados que usan los
  // selects, así que no añaden ni una petición.
  private toMapa = (opts: CatalogValue[] | null): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const o of opts ?? []) {
      const k = String(o?.['codigo'] ?? '').trim();
      if (k) m[k] = String(o?.['descripcion'] ?? k);
    }
    return m;
  };

  private readonly mapaTipoDoc = toSignal(
    this.tipoDocOpciones$.pipe(map(this.toMapa)), { initialValue: {} as Record<string, string> });
  private readonly mapaEstadoCivil = toSignal(
    this.estadoCivilOpciones$.pipe(map(this.toMapa)), { initialValue: {} as Record<string, string> });
  private readonly mapaConQuienVive = toSignal(
    this.conQuienViveOpciones$.pipe(map(this.toMapa)), { initialValue: {} as Record<string, string> });
  private readonly mapaParentescos = toSignal(
    this.parentescosOpciones$.pipe(map(this.toMapa)), { initialValue: {} as Record<string, string> });

  // ── Navegación del área de trabajo ───────────────────────────────────────
  /**
   * `salud` y `contratacion` no viven aquí: son los pasos 4 y 5 del stepper de
   * arriba. La pestaña los ofrece igual y emite hacia el pipeline, para que
   * desde Selección se alcance todo sin volver a buscar el paso a mano.
   */
  abrirPanel(p: 'entrevista' | 'formacion' | 'remision' | 'ia' | 'salud' | 'contratacion'): void {
    if (p === 'salud' || p === 'contratacion') {
      this.irAPaso.emit(p);
      return;
    }
    this.panel.set(p);
    this.filaEnEdicion.set(null);
    // El análisis se pide al entrar, no al cargar el candidato: es una llamada
    // cara y la mayoría de las atenciones no la necesitan.
    if (p === 'ia') this.pedirAnalisis();
  }

  // ==========================================================================
  // PESTAÑA DE INTELIGENCIA ARTIFICIAL
  // ==========================================================================
  /*
   * Resume lo que la plataforma sabe de la persona y lo contrasta con la
   * vacante a la que va: qué juega a favor, qué en contra y qué falta por
   * preguntar. El expediente lo junta ms-ai desde ms-hr, ms-documents y
   * ms-payroll; aquí solo se pide y se pinta.
   */
  private readonly analisisIa = inject(AnalisisIaService);
  private readonly router = inject(Router);

  readonly analisis = signal<AnalisisCandidato | null>(null);
  readonly analizando = signal(false);
  readonly errorAnalisis = signal<string | null>(null);

  /** Cédula ya analizada, para no repetir la llamada al volver a la pestaña. */
  private analisisDe: string | null = null;

  /**
   * Pregunta con la que arranca el chat cuando se entra desde el resumen.
   *
   * Lleva un contador porque el texto puede repetirse: pulsar "Seguir en el
   * chat" dos veces tiene que abrir DOS conversaciones, no reusar la misma.
   */
  readonly preguntaChat = signal<{ texto: string; seq: number } | null>(null);
  private seqChat = 0;

  /**
   * La cédula con la que trabaja la IA de este paso: la del registro y, si
   * llegó vacía, la que se tecleó en el buscador. Misma resolución que
   * `cedulaDocs()` en Contratación.
   */
  get cedulaPersona(): string | null {
    return this.texto('numero_documento') || (this.documentoBuscado() ?? '').trim() || null;
  }

  /** Nombre de la persona, para rotular su carpeta de conversaciones. */
  get nombrePersona(): string | null {
    const p = [this.texto('primer_nombre'), this.texto('primer_apellido')]
      .filter(Boolean).join(' ').trim();
    return p || null;
  }

  /** Se dispara al abrir la pestaña; el usuario puede forzar con "Rehacer". */
  pedirAnalisis(forzar = false): void {
    const cedula = this.cedulaPersona;
    if (!cedula) {
      this.errorAnalisis.set('Busca primero a la persona: sin documento no hay expediente que analizar.');
      return;
    }
    if (!forzar && this.analisisDe === cedula && this.analisis()) return;
    if (this.analizando()) return;

    this.analizando.set(true);
    this.errorAnalisis.set(null);

    // Se manda la obra Y las respuestas de la entrevista. Sin las respuestas el
    // análisis solo veía lo guardado en base, así que la sugerencia ignoraba
    // justo lo que se acababa de preguntar.
    this.analisisIa.analizar(cedula, this.contextoParaIa()).subscribe({
      next: (r) => {
        this.analisis.set(r);
        this.analisisDe = cedula;
        this.analizando.set(false);
        this.cdr.markForCheck();
      },
      error: (e) => {
        console.error('[analisis-ia]', e);
        this.errorAnalisis.set(
          'No se pudo generar el análisis. Puede ser que el proveedor de IA no esté configurado.');
        this.analizando.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Lo que la IA necesita saber ADEMÁS del expediente: a qué obra va y qué
   * acaba de responder. Los campos vacíos no se mandan para no llenar el
   * prompt de nulos, que el modelo termina leyendo como si fueran datos.
   */
  private contextoParaIa(): Record<string, unknown> | null {
    const entrevista: Record<string, unknown> = {};
    for (const c of [
      ...FormEntrevistaComponent.CAMPOS_ENTREVISTA,
      ...FormEntrevistaComponent.CAMPOS_FORMACION,
    ]) {
      const v = this.formVacante?.get(c)?.value;
      if (v !== null && v !== undefined && String(v).trim() !== '') entrevista[c] = v;
    }

    const obra = this.obraConDatos;
    if (!obra.length && !Object.keys(entrevista).length) return null;
    return {
      obra: obra.length ? obra : null,
      entrevista: Object.keys(entrevista).length ? entrevista : null,
    };
  }

  /**
   * Los cinco puntos de más peso por lado.
   *
   * El modelo ya viene instruido para no pasar de cinco, pero el recorte se
   * hace también aquí: si algún día devuelve doce, la tarjeta de la entrevista
   * no se convierte en un muro que nadie lee con la persona esperando.
   */
  get aFavorTop(): PuntoAnalisis[] { return (this.analisis()?.aFavor ?? []).slice(0, 5); }
  get enContraTop(): PuntoAnalisis[] { return (this.analisis()?.enContra ?? []).slice(0, 5); }

  /**
   * Pasa del resumen al chat, llevándose lo que ya se leyó del expediente.
   *
   * Antes esto sacaba de la pantalla: navegaba a Herramientas IA y había que
   * volver al pipeline para seguir con la persona. Ahora el chat es el otro
   * panel de este mismo módulo, así que se cambia de panel y se le siembra el
   * contexto: el resumen, el ajuste a la vacante y el cargo propuesto. Sin eso
   * la conversación arrancaba en blanco y había que pedirle a la IA que
   * volviera a leer lo que acababa de decir.
   */
  continuarEnChat(): void {
    const cedula = this.cedulaPersona;
    if (!cedula) return;

    this.preguntaChat.set({ texto: this.contextoParaChat(cedula), seq: ++this.seqChat });
    this.panel.set('iaChat');
  }

  private contextoParaChat(cedula: string): string {
    const a = this.analisis();
    const quien = this.nombrePersona ? `${this.nombrePersona} (CC ${cedula})` : `la persona con cédula ${cedula}`;

    if (!a) {
      return `Estoy atendiendo a ${quien} en el proceso de contratación. `
           + 'Léete su expediente completo y dime qué debería tener en cuenta.';
    }

    const partes = [`Estoy atendiendo a ${quien} en el proceso de contratación.`];
    if (a.resumen) partes.push(`Esto es lo que ya leíste de su expediente:\n${a.resumen}`);
    if (a.ajusteVacante?.nivel) {
      partes.push(`Ajuste a la vacante: ${a.ajusteVacante.nivel}`
        + (a.ajusteVacante.porque ? ` — ${a.ajusteVacante.porque}` : ''));
    }
    if (a.cargoSugerido?.cargo) {
      partes.push(`Cargo que propusiste: ${a.cargoSugerido.cargo}`
        + (a.cargoSugerido.porque ? ` — ${a.cargoSugerido.porque}` : ''));
    }
    partes.push('Tenlo presente para lo que te pregunte a partir de ahora. '
      + 'Empieza diciéndome en dos líneas qué es lo primero que debería confirmar con ella.');
    return partes.join('\n\n');
  }

  // ── Edición en línea dentro de la ficha ──────────────────────────────────
  /** ¿Esta fila está mostrando su control editable? */
  editando(clave: string): boolean {
    return this.filaEnEdicion() === clave;
  }

  /**
   * Abre la fila para editar y deja el foco dentro. El `setTimeout` espera a
   * que Angular pinte el control: sin eso el `querySelector` corre contra el
   * DOM viejo y el foco se pierde, que es justo lo que obliga a dar dos clicks.
   */
  editarFila(clave: string): void {
    this.filaEnEdicion.set(clave);
    setTimeout(() => {
      const campo = document.querySelector<HTMLElement>(
        `[data-fila="${clave}"] input, [data-fila="${clave}"] .mat-mdc-select`
      );
      campo?.focus();
    });
  }

  /** Cierra la edición. Nada que guardar aquí: el control ya es el del form. */
  cerrarFila(): void {
    this.filaEnEdicion.set(null);
  }

  /** Cierra con Escape sin tocar el valor tecleado. */
  onFilaKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.cerrarFila();
    }
  }

  // ── Hijos: nombre y edad ─────────────────────────────────────────────────
  /**
   * Nombre y edad de cada hijo, para la ficha.
   *
   * Es una SEÑAL y no un getter porque la ficha (`app-ficha-campos`) es OnPush y
   * los datos entran por `patchValue(..., { emitEvent: false })`: sin un binding
   * que cambie, la lista se quedaría pintada con lo del candidato anterior.
   * Publicarla como señal y bajarla por `@Input` marca la ficha para revisión.
   */
  readonly hijosResumen = signal<ReadonlyArray<{ nombre: string; edad: string }>>([]);

  /**
   * La edad tal como se dice en la entrevista.
   *
   * Por debajo del año se cuentan MESES —y se dice "meses"—: con un bebé,
   * "0 años" no es una respuesta, y es justo la edad que decide si la persona
   * necesita quién lo cuide.
   */
  private edadDeHijo(valor: any): string {
    const f = valor instanceof Date ? valor : (valor ? new Date(valor) : null);
    if (!f || isNaN(f.getTime())) return 'sin fecha de nacimiento';

    const hoy = new Date();
    let meses = (hoy.getFullYear() - f.getFullYear()) * 12 + (hoy.getMonth() - f.getMonth());
    if (hoy.getDate() < f.getDate()) meses--;
    if (meses < 0) return 'sin fecha de nacimiento';   // fecha futura: dato malo
    if (meses === 0) return 'menos de un mes';
    if (meses < 12) return meses === 1 ? '1 mes' : `${meses} meses`;

    const anios = Math.floor(meses / 12);
    return anios === 1 ? '1 año' : `${anios} años`;
  }

  /** Relee el FormArray de hijos y publica la lista. */
  private refrescarHijosResumen(): void {
    const fa = this.formVacante?.get('hijos') as FormArray | null;
    const filas = (fa?.controls ?? []).map((c, i) => {
      const h = c.value ?? {};
      const nombre =
        [h.primer_nombre, h.segundo_nombre, h.primer_apellido, h.segundo_apellido]
          .filter(Boolean).join(' ').trim() ||
        (h.numero_de_documento ? `Doc. ${h.numero_de_documento}` : `Hijo ${i + 1}`);
      return { nombre, edad: this.edadDeHijo(h.fecha_nac) };
    });
    this.hijosResumen.set(filas);
  }

  // ── Plegado de las tarjetas accesorias ───────────────────────────────────
  private static readonly LS_PLEGADOS = 'entrevista.plegados';

  /** Se llama desde `ngOnInit`: en SSR no hay `localStorage`. */
  private restaurarPlegados(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const crudo = localStorage.getItem(FormEntrevistaComponent.LS_PLEGADOS);
      if (crudo) this.plegados.set(new Set(JSON.parse(crudo) as string[]));
    } catch {
      // Un valor corrupto no puede impedir abrir la entrevista: se ignora.
    }
  }

  plegado(bloque: string): boolean {
    return this.plegados().has(bloque);
  }

  alternarPliegue(bloque: string): void {
    const s = new Set(this.plegados());
    if (s.has(bloque)) s.delete(bloque); else s.add(bloque);
    this.plegados.set(s);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(FormEntrevistaComponent.LS_PLEGADOS, JSON.stringify([...s]));
    } catch {
      // Modo privado o cuota llena: se pierde la preferencia, no la pantalla.
    }
  }

  // ── Lectura de valores para la ficha ─────────────────────────────────────
  /**
   * Getters, no `computed`: los valores viven en un `FormGroup`, que no es
   * señal. Como getter se reevalúan en cada ciclo de detección del componente
   * — y escribir en un campo del propio template dispara ese ciclo — así que
   * la ficha se actualiza mientras se teclea. Un `computed` en cambio se
   * quedaría congelado en el primer valor.
   */
  private val(nombre: string): any {
    return this.formVacante?.get(nombre)?.value ?? null;
  }

  /** Texto de un control, o `null` si está vacío (la ficha pinta “—”). */
  texto(nombre: string): string | null {
    const v = this.val(nombre);
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  }

  /** Igual que `texto`, pero traduciendo el código por el catálogo. */
  textoCatalogo(nombre: string, catalogo: 'tipoDoc' | 'estadoCivil' | 'parentescos'): string | null {
    const v = this.texto(nombre);
    if (!v) return null;
    const mapa =
      catalogo === 'tipoDoc' ? this.mapaTipoDoc()
      : catalogo === 'estadoCivil' ? this.mapaEstadoCivil()
      : this.mapaParentescos();
    return mapa[v] ?? v;
  }

  /** Fecha del form (Date o string ISO) en dd/MM/yyyy. */
  fecha(nombre: string): string | null {
    const v = this.val(nombre);
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  /** Nombre completo, como lo arma el resto de la plataforma. */
  get nombreFicha(): string | null {
    const partes = ['primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido']
      .map((c) => this.texto(c))
      .filter(Boolean);
    return partes.length ? partes.join(' ') : null;
  }

  /** Iniciales para el avatar cuando todavía no hay foto. */
  get inicialesFicha(): string {
    const n = this.texto('primer_nombre')?.[0] ?? '';
    const a = this.texto('primer_apellido')?.[0] ?? '';
    const i = `${n}${a}`.trim().toUpperCase();
    return i || '—';
  }

  /** "CC 52757899" para la cabecera de la ficha. */
  get documentoFicha(): string | null {
    const num = this.texto('numero_documento');
    if (!num) return null;
    const tipo = this.texto('tipo_doc');
    return tipo ? `${tipo} ${num}` : num;
  }

  /** `personas_con_quien_convive` es multi-select: se pinta como lista. */
  get conQuienVive(): string | null {
    const v = this.val('personas_con_quien_convive');
    const arr: string[] = Array.isArray(v) ? v : v ? [v] : [];
    if (!arr.length) return null;
    const mapa = this.mapaConQuienVive();
    return arr.map((c) => mapa[String(c)] ?? String(c)).join(', ');
  }

  /** `hace_cuanto_vive` guarda un código; la ficha muestra el texto. */
  private static readonly TIEMPO_ZONA: Record<string, string> = {
    MENOS_DE_UN_MES: 'Menos de un mes',
    UN_MES: 'Un mes',
    MAS_DE_2_MESES: 'Más de 2 meses',
    MAS_DE_6_MESES: 'Más de 6 meses',
    LIFETIME: 'Toda la vida',
  };

  get tiempoEnZona(): string | null {
    const v = this.texto('hace_cuanto_vive');
    return v ? (FormEntrevistaComponent.TIEMPO_ZONA[v] ?? v) : null;
  }

  /** "Sí · 2 hijos" / "No". */
  get resumenHijos(): string | null {
    const tiene = this.val('tieneHijos');
    if (tiene !== true && tiene !== false) return null;
    if (tiene !== true) return 'No';
    const n = this.texto('numeroHijos');
    return n ? `Sí · ${n} ${Number(n) === 1 ? 'hijo' : 'hijos'}` : 'Sí';
  }

  /** "YOLANDA CASTRO · Hermana" — nombre y parentesco en una sola fila. */
  referencia(campoNombre: string, campoParentesco: string): string | null {
    const nombre = this.texto(campoNombre);
    if (!nombre) return null;
    const par = this.textoCatalogo(campoParentesco, 'parentescos');
    return par ? `${nombre} · ${par}` : nombre;
  }

  /** Datos de obra que sí traen valor: los vacíos no ocupan sitio en la ficha. */
  get obraConDatos(): { label: string; value: string | null }[] {
    return (this.datosObra() ?? []).filter((d) => !!d?.value);
  }

  /**
   * Nº de campos obligatorios sin llenar en cada bloque. Es el contador rojo
   * de la pestaña/bloque: dice dónde falta algo sin obligar a recorrerlo todo.
   */
  private faltantesDe(campos: readonly string[]): number {
    if (!this.formVacante) return 0;
    return campos.filter((c) => this.formVacante.get(c)?.invalid).length;
  }

  /**
   * Dónde vive cada control en la vista nueva: fila de la ficha o pestaña del
   * área de trabajo.
   *
   * Hace falta porque la vista ya no lo pinta todo a la vez. Antes el
   * formulario era un scroll único y bastaba con `querySelector` del primer
   * `.ng-invalid` para llevar al usuario al error; ahora un obligatorio vacío
   * puede estar en una fila cerrada o en una pestaña que no es la activa, y
   * ahí no hay nodo que buscar. Este mapa permite ABRIR el sitio antes de
   * intentar resaltarlo.
   */
  private static readonly UBICACION: ReadonlyArray<
    readonly [string, 'identificacion' | 'personales' | 'contacto' | 'hijos' | 'referencias', string]
  > = [
    ['tipo_doc', 'identificacion', 'documento'],
    ['numero_documento', 'identificacion', 'documento'],
    ['fecha_expedicion', 'identificacion', 'expedicion'],
    ['mpio_expedicion', 'identificacion', 'expedicion'],
    ['primer_nombre', 'personales', 'nombres'],
    ['segundo_nombre', 'personales', 'nombres'],
    ['primer_apellido', 'personales', 'nombres'],
    ['segundo_apellido', 'personales', 'nombres'],
    ['fecha_nacimiento', 'personales', 'nacimiento'],
    ['mpio_nacimiento', 'personales', 'nacimiento'],
    ['sexo', 'personales', 'sexo'],
    ['estado_civil', 'personales', 'estado_civil'],
    ['correo_electronico', 'contacto', 'correo'],
    ['celular', 'contacto', 'telefonos'],
    ['whatsapp', 'contacto', 'telefonos'],
    ['direccion_de_residencia', 'contacto', 'direccion'],
    ['barrio', 'contacto', 'direccion'],
    ['hace_cuanto_vive', 'contacto', 'direccion'],
    ['personas_con_quien_convive', 'contacto', 'convive'],
    ['relacionFamiliar', 'hijos', 'familia'],
    ['tieneHijos', 'hijos', 'hijos'],
    ['numeroHijos', 'hijos', 'hijos'],
    ['cuidadorHijos', 'hijos', 'hijos'],
    ['nombreReferenciaFamiliar1', 'referencias', 'ref-familiares'],
    ['parentescoReferenciaFamiliar1', 'referencias', 'ref-familiares'],
    ['nombreReferenciaPersonal1', 'referencias', 'ref-personales'],
    ['parentescoReferenciaPersonal1', 'referencias', 'ref-personales'],
  ];

  /** Controles que se editan en el área de trabajo, y en qué pestaña. */
  private static readonly UBICACION_PANEL: ReadonlyArray<readonly [string, 'formacion' | 'entrevista']> = [
    ['proyeccion1Ano', 'formacion'],
    // Escolaridad, experiencia e historial laboral se preguntan en la
    // ENTREVISTA (la hoja los lleva) y se siguen pudiendo editar en Formación.
    // El destino es Entrevista porque es donde se contestan de corrido.
    ['nivel', 'entrevista'],
    ['estudiosExtra', 'entrevista'],
    ['tituloObtenido', 'entrevista'],
    ['institucionEstudio', 'entrevista'],
    ['anioFinalizacion', 'entrevista'],
    ['estudiaActualmente', 'entrevista'],
    ['experienciaLaboral', 'entrevista'],
    ['experienciaFlores', 'entrevista'],
    ['tipoExperienciaFlores', 'entrevista'],
    ['otroExperiencia', 'entrevista'],
    ['experiencias', 'entrevista'],
    ['comoSeEntero', 'entrevista'],
    ['referenciado', 'entrevista'],
    ['nombreReferenciado', 'entrevista'],
    ['aplicaObservacion', 'entrevista'],
    ['motivoEspera', 'entrevista'],
    ['motivoNoAplica', 'entrevista'],
  ];

  /**
   * Deja a la vista el primer campo obligatorio que falta: abre su pestaña o
   * despliega su fila en la ficha. Sin esto, "Revise los campos en rojo" podía
   * señalar un rojo que no estaba en pantalla.
   *
   * @returns true si tuvo que abrir algo (el llamador espera un ciclo de
   *          render antes de buscar el nodo en el DOM).
   */
  private revelarPrimerInvalido(): boolean {
    if (!this.formVacante) return false;

    // La ficha del pipeline es de lectura: los campos se editan aquí, en línea.
    // "Revelar" es desplazarse a la sección donde está el hueco; antes abría un
    // diálogo, y antes de eso desplegaba filas de una ficha que este componente
    // dejó de pintar y el aviso señalaba un rojo invisible.
    for (const [campo, bloque] of FormEntrevistaComponent.UBICACION) {
      if (!this.formVacante.get(campo)?.invalid) continue;
      this.irASeccion(bloque);
      return true;
    }

    for (const [campo, destino] of FormEntrevistaComponent.UBICACION_PANEL) {
      if (!this.formVacante.get(campo)?.invalid) continue;
      const cambiaPanel = this.panel() !== destino;
      if (cambiaPanel) this.panel.set(destino);
      // El panel de Entrevista ahora es largo —nueve secciones de datos antes
      // de las preguntas—, así que estar en la pestaña correcta ya no basta:
      // hay que bajar hasta la sección o el rojo queda fuera de pantalla.
      if (destino === 'entrevista') this.irASeccion('entrevista');
      return cambiaPanel;
    }

    return false;
  }

  get faltanIdentificacion(): number { return this.faltantesDe(this.step1Fields); }
  get faltanPersonales(): number { return this.faltantesDe(this.step2Fields); }
  get faltanContacto(): number { return this.faltantesDe(this.step3Fields); }
  get faltanFamilia(): number {
    return this.faltantesDe(['tieneHijos', 'cuidadorHijos', 'numeroHijos']);
  }
  get faltanFormacion(): number {
    return this.faltantesDe([
      'nivel', 'estudiaActualmente', 'proyeccion1Ano', 'experienciaFlores', 'tipoExperienciaFlores',
    ]);
  }
  get faltanEntrevista(): number {
    return this.faltantesDe([
      'comoSeEntero', 'referenciado', 'nombreReferenciado',
      'aplicaObservacion', 'motivoEspera', 'motivoNoAplica',
    ]);
  }

  // Campos usados para validar cada bloque
  private readonly step1Fields = [
    'oficina',
    'tipo_doc',
    'numero_documento',
    'fecha_expedicion',
    'mpio_expedicion',
  ];
  private readonly step2Fields = [
    'primer_apellido',
    'primer_nombre',
    'fecha_nacimiento',
    'mpio_nacimiento',
    'sexo',
    'estado_civil',
  ];
  private readonly step3Fields = [
    'correo_electronico',
    'password',
    'direccion_de_residencia',
    'barrio',
    'celular',
    'whatsapp',
    'personas_con_quien_convive',
    'hace_cuanto_vive',
  ];

  constructor() {
    this.dateAdapter.setLocale('es-CO');

    // =======================
    // Definición del form
    // =======================
    this.formVacante = this.fb.group({
      // Identificación / documento
      // La oficina la preasigna el flujo (URL/candidato). Ya no se pinta en la
      // entrevista —no es algo que se le pregunte a la persona— y por eso deja
      // de ser obligatoria: un campo requerido que no está en pantalla bloquea
      // el guardado sin enseñar dónde está el hueco. El valor sigue cargándose
      // y guardándose igual.
      oficina: [''],
      tipo_doc: ['', Validators.required],
      numero_documento: [
        '',
        [
          Validators.required,
          Validators.pattern(/^X?\d+$/i),
          Validators.minLength(6),
          Validators.maxLength(15),
        ],
      ],
      fecha_expedicion: ['', Validators.required],
      mpio_expedicion: ['', Validators.required],

      // Datos personales
      primer_apellido: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(30),
        ],
      ],
      segundo_apellido: ['', [Validators.maxLength(30)]],
      primer_nombre: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(30),
        ],
      ],
      segundo_nombre: ['', [Validators.maxLength(30)]],
      fecha_nacimiento: ['', Validators.required],
      edad: [{ value: '', disabled: true }],
      mpio_nacimiento: ['', Validators.required],
      sexo: ['', Validators.required],
      estado_civil: ['', Validators.required],
      // RH: lo pide el formulario de la vacante y lo exigen la afiliación y la
      // ficha de emergencia. No lleva `required` porque la base ya registrada
      // no lo tiene y bloquearía el guardado de toda esa gente.
      rh: [''],

      // Contacto / domicilio
      correo_electronico: [
        '',
        [
          Validators.required,
          Validators.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
        ]
      ],
      password: [''],
      direccion_de_residencia: ['', Validators.required],
      barrio: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.maxLength(40),
        ],
      ],
      celular: ['', [Validators.required, Validators.pattern(/^3\d{9}$/)]],
      whatsapp: [
        '',
        [
          Validators.required,
          Validators.pattern(/^3\d{9}$/),
          Validators.maxLength(10),
        ],
      ],
      // Del paso "Su hogar" del formulario de la vacante: perfil socioeconómico,
      // no dato de contratación. Se conserva el control —lo llena el formulario
      // público y se sigue guardando— pero SIN `required`: salió de la ficha, y
      // exigirlo dejaría la entrevista sin poder guardarse y sin dónde llenarlo.
      personas_con_quien_convive: [[]],
      hace_cuanto_vive: ['', Validators.required],

      // Información familiar
      tieneHijos: [null, Validators.required],
      cuidadorHijos: [''],
      numeroHijos: [0],
      hijos: this.fb.array([]),
      nombreReferenciaFamiliar1: [''],
      parentescoReferenciaFamiliar1: ['', [Validators.maxLength(70)]],
      nombreReferenciaFamiliar2: [''],
      parentescoReferenciaFamiliar2: ['', [Validators.maxLength(70)]],
      nombreReferenciaPersonal1: [''],
      parentescoReferenciaPersonal1: ['', [Validators.maxLength(70)]],
      nombreReferenciaPersonal2: [''],
      parentescoReferenciaPersonal2: ['', [Validators.maxLength(70)]],
      // Con el nombre y el parentesco solos no se puede VERIFICAR una
      // referencia, que es para lo que existe antes de contratar. El teléfono,
      // la ocupación y la dirección ya viajan en el payload y el backend los
      // guarda; lo único que faltaba era dónde escribirlos.
      telefonoReferenciaFamiliar1: [''],
      ocupacionReferenciaFamiliar1: [''],
      direccionReferenciaFamiliar1: [''],
      telefonoReferenciaFamiliar2: [''],
      ocupacionReferenciaFamiliar2: [''],
      direccionReferenciaFamiliar2: [''],
      telefonoReferenciaPersonal1: [''],
      ocupacionReferenciaPersonal1: [''],
      direccionReferenciaPersonal1: [''],
      telefonoReferenciaPersonal2: [''],
      ocupacionReferenciaPersonal2: [''],
      direccionReferenciaPersonal2: [''],

      // Formación / experiencia
      nivel: [null, Validators.required],
      /**
       * El detalle de la escolaridad. Vive en `formaciones[0]` y la entrevista
       * lo leía a medias: solo `nivel`. Como el guardado REEMPLAZA la lista, la
       * institución, el título y el año se borraban en cada entrevista guardada
       * —de ahí que a los candidatos con "OTROS" no les quedara nada del
       * estudio superior que sí habían diligenciado—.
       *
       * Ninguno lleva `required`: los registros ya guardados no los tienen y
       * exigirlos dejaría sin poder guardar justo a quien hay que corregirle.
       */
      estudiosExtra: [''],
      tituloObtenido: ['', [Validators.maxLength(255)]],
      institucionEstudio: ['', [Validators.maxLength(255)]],
      anioFinalizacion: [null],
      estudiaActualmente: [null, Validators.required],
      proyeccion1Ano: ['', Validators.required],
      /**
       * "¿Usted cuenta con experiencia laboral?" — la pregunta GENERAL, la que
       * abre el bloque de historial laboral. Va aparte de la de flores: hasta
       * ahora las dos compartían `experiencia_resumen.tiene_experiencia` y no
       * había forma de decir que alguien tiene experiencia pero no en flores.
       */
      experienciaLaboral: [''],
      experienciaFlores: ['', Validators.required],
      tipoExperienciaFlores: [''],
      otroExperiencia: this.otroExperienciaControl,
      /** Áreas y tiempo total: son del resumen, no de una empresa concreta. */
      areaExperiencia: [[]],
      tiempoExperiencia: [''],

      // Historial laboral
      experiencias: this.fb.array([]),

      // Entrevista
      comoSeEntero: ['', [Validators.maxLength(120), Validators.required]],
      referenciado: [null, Validators.required], // 'SI' | 'NO'
      nombreReferenciado: ['', [Validators.maxLength(120)]],
      aplicaObservacion: ['', Validators.required], // 'APLICA' | 'NO_APLICA' | 'EN_ESPERA'
      motivoEspera: [''],
      motivoNoAplica: [''],

      // ── Pareja · paso "Estado civil" del formulario de la vacante ──────
      // NINGUNO de los campos de abajo lleva `required`: son datos que el
      // formulario público pide condicionados (solo si vive en pareja, solo si
      // conoce al papá…) y el guardado de la entrevista valida el formulario
      // ENTERO. Marcarlos obligatorios dejaría sin poder guardar a toda la base
      // ya registrada, que es justo a quien hay que poder corregirle la ficha.
      viveConyuge: [''],
      nombresConyuge: [''],
      apellidosConyuge: [''],
      documentoConyuge: [''],
      telefonoConyuge: [''],
      ocupacionConyuge: [''],
      municipioConyuge: [''],
      barrioConyuge: [''],
      direccionConyuge: [''],

      // ── Padres · paso "Datos de sus padres" ────────────────────────────
      elPadreVive: [''],
      nombresPadre: [''],
      apellidosPadre: [''],
      telefonoPadre: [''],
      ocupacionPadre: [''],
      municipioPadre: [''],
      barrioPadre: [''],
      direccionPadre: [''],
      madreVive: [''],
      nombresMadre: [''],
      apellidosMadre: [''],
      telefonoMadre: [''],
      ocupacionMadre: [''],
      municipioMadre: [''],
      barrioMadre: [''],
      direccionMadre: [''],

      // ── Emergencia · paso "A quién llamamos en una emergencia" ─────────
      nombresFamiliarEmergencia: [''],
      apellidosFamiliarEmergencia: [''],
      parentescoFamiliarEmergencia: [''],
      telefonoFamiliarEmergencia: [''],
      ocupacionFamiliarEmergencia: [''],
      municipioFamiliarEmergencia: [''],
      barrioFamiliarEmergencia: [''],
      direccionFamiliarEmergencia: [''],

      // ── Dotación · paso "Tallas de dotación" ───────────────────────────
      // La tabla guarda enteros (34, 16, 40…), no tallas en letra: se piden
      // como número para no escribir "M" donde el resto del sistema lee cifras.
      tallaChaqueta: [null],
      tallaPantalon: [null],
      tallaCamisa: [null],
      tallaCalzado: [null],

      // Aux
      brigadaDe: [''],

      // Evaluacion (Opcionales)
      relacionFamiliar: [''],
      desempenoLaboral: [''],
      felicitaciones: [''],
      situacionConflictiva: [''],
      actividadesDiferentes: [''],

      // Firma
      firmaEvaluador: [{ value: '', disabled: true }],
    });

    // Sin botón "Enviar": cada cambio del usuario se guarda solo. Faltaba este
    // enganche y la pestaña no guardaba nada (2026-09-16).
    this.autoEntrevista.vigilar(this.formVacante, this.destroyRef);

    // =======================
    // Reacciones dinámicas
    // =======================

    // Edad calculada
    this.ctrl('fecha_nacimiento')
      .valueChanges.pipe(startWith(this.ctrl('fecha_nacimiento').value))
      .subscribe(() => this.setEdad());

    // Hijos
    this.ctrl('tieneHijos')
      .valueChanges.pipe(startWith(this.ctrl('tieneHijos').value))
      .subscribe((tiene: boolean) => this.setupHijosValidators(!!tiene));

    this.ctrl('numeroHijos')
      .valueChanges.pipe(startWith(this.ctrl('numeroHijos').value))
      .subscribe((n: number) => this.setHijosCount(Number(n) || 0));

    // Experiencia en flores
    this.ctrl('experienciaFlores')
      .valueChanges.pipe(startWith(this.ctrl('experienciaFlores').value))
      .subscribe((val) => {
        this.applyExperienciaFloresRules(val);
        this.refreshSteps();
      });

    // Tipo de experiencia = OTROS -> obliga descripción
    this.ctrl('tipoExperienciaFlores')
      .valueChanges.pipe(startWith(this.ctrl('tipoExperienciaFlores').value))
      .subscribe((value) => {
        this.applyTipoExperienciaFloresRules(value);
        this.refreshSteps();
      });

    // Referenciado -> nombreReferenciado requerido si "SI"
    this.ctrl('referenciado')
      .valueChanges.pipe(startWith(this.ctrl('referenciado').value))
      .subscribe((v) => {
        this.applyReferenciadoRules(v);
        this.refreshSteps();
      });

    // aplicaObservacion -> obliga el motivo según el caso
    this.ctrl('aplicaObservacion')
      .valueChanges.pipe(startWith(this.ctrl('aplicaObservacion').value))
      .subscribe((v) => {
        this.applyAplicaObservacionRules(v);
        this.refreshSteps();
      });

    // Cuando cambie el candidato seleccionado, rellenamos el form
    effect(() => {
      const cand = this.candidatoSeleccionado();
      // Solo se rellena al CAMBIAR de persona. El padre recarga el candidato
      // (referencia nueva, misma cédula) tras guardar cualquier pestaña; re-
      // ejecutar acá pisaba media entrevista escrita sin guardar y recortaba
      // las filas de hijos al conteo del servidor. La llave incluye el tipo:
      // dos titulares distintos pueden compartir número (CC vs C.C/CE).
      const ced = cand?.numero_documento ? String(cand.numero_documento) : null;
      // `consultaSeq` entra en la llave: una consulta NUEVA del buscador (que
      // lo incrementa) re-rellena aunque sea la misma persona; las recargas
      // internas tras guardar (mismo seq) no pisan lo editado.
      const clave = ced
        ? `${String(cand?.tipo_doc || 'CC').trim().toUpperCase()}|${ced}#${this.consultaSeq()}`
        : null;
      if (clave !== null && clave === this.cedulaRellenada) return;
      this.cedulaRellenada = clave;
      // Lo pendiente era de la persona anterior, y lo que se rellene ahora no es
      // algo que alguien editó: no debe dispararse el guardado automático.
      this.autoEntrevista.cancelar();
      this.formVacante.markAsPristine();
      // Persona nueva: las secciones que se abrieron a mano para la anterior
      // no tienen por qué seguir abiertas.
      this.seccionesExtra.set([]);
      this.rellenarForm(cand);
    });

    // Populate signature
    const u: any = this.util.getUser();
    if (u) {
      this.firma = `${u?.datos_basicos?.nombres ?? ''} ${u?.datos_basicos?.apellidos ?? ''} - ${u?.rol?.nombre ?? ''}`.trim();
    }

    // El análisis de IA se pedía desde `abrirPanel`, pero ahora quien abre la
    // pestaña es el rail del pipeline, que escribe la señal directamente. Se
    // reacciona a la señal para que dé igual por dónde se haya entrado.
    effect(() => {
      if (this.panel() === 'ia') this.pedirAnalisis();
    });

    // El lápiz de la ficha pide editar; el formulario con esos campos es este,
    // así que el diálogo se abre desde aquí.
    //
    // Pareja, padres, emergencia y tallas ya no se pintan de entrada —no se
    // preguntan en la entrevista—, pero el lápiz de la ficha sigue siendo la
    // única forma de corregirlos: si piden uno de esos bloques, se añade a lo
    // visible ANTES de bajar hasta él. Si no, el lápiz llevaría a una sección
    // que no está en el DOM y no pasaría nada.
    effect(() => {
      const bloque = this.nav.edicionFicha();
      if (!bloque) return;
      this.nav.edicionFicha.set(null);
      if (SECCIONES_FICHA_EXTRA.includes(bloque as SeccionFicha)) {
        this.seccionesExtra.update((s) => (s.includes(bloque as SeccionFicha) ? s : [...s, bloque as SeccionFicha]));
      }
      // El lápiz se pulsa desde la tarjeta del pipeline, que está a la vista en
      // todos los pasos: si el panel abierto no es el de Entrevista, la sección
      // ni siquiera está en el DOM y el salto no llevaría a ninguna parte.
      if (this.panel() !== 'entrevista') this.panel.set('entrevista');
      this.cdr.markForCheck();
      this.irASeccion(bloque);
    });

    // Avance de Entrevista y Formación para los dos railes. Se escucha también
    // `statusChanges` porque los obligatorios de estos bloques aparecen y
    // desaparecen según las respuestas (referenciado, motivo de espera…), y eso
    // cambia cuántas casillas hay que llenar, no solo cuáles están llenas.
    merge(this.formVacante.valueChanges, this.formVacante.statusChanges)
      .pipe(startWith(null), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.publicarAvances());
    this.publicarAvances();
  }

  /**
   * Abre el diálogo de edición de la ficha.
   *
   * `'todos'` pinta los cuatro bloques —es el lápiz de la cabecera— y
   * cualquier otro valor pinta solo el suyo, que es el lápiz de cada bloque.
   * Trabaja sobre ESTE formulario, así que al aceptar se guarda por el camino
   * de siempre (`onSubmit`) y no hay una segunda ruta de guardado.
   */
  /**
   * Las secciones de datos de la persona, para el acceso directo del panel de
   * Entrevista.
   *
   * El lápiz vive en la ficha de la izquierda, bloque por bloque, y quien está
   * entrevistando mira la columna de la derecha: no encontraba dónde corregir
   * lo que la persona le estaba diciendo. Esta barra abre EL MISMO diálogo, sin
   * una segunda ruta de guardado.
   */
  /**
   * Los accesos directos de la barra.
   *
   * Las nueve primeras son los datos de la persona y las pinta `ficha-campos`;
   * la décima —Entrevista— vive en ESTA plantilla porque sus preguntas tienen
   * reglas propias (el motivo aparece o no según la observación) y son las
   * únicas obligatorias del recorrido. Va la última: se coteja la ficha con el
   * documento y solo entonces se registra la entrevista.
   */
  /** Los tres estados del veredicto. Los define la regla, no la plantilla. */
  readonly ESTADOS_OBSERVACION = ESTADOS_OBSERVACION;

  /**
   * Niveles de educación superior. Lista cerrada, LA MISMA que el formulario de
   * la vacante (`NIVELES_SUPERIORES`): si aquí se tecleara a mano, el valor que
   * eligió la persona y el que registra el evaluador dejarían de coincidir.
   *
   * El valor va SIN TILDES a propósito. El formulario público guarda
   * "TECNÓLOGO" con tilde, pero el guardado de la entrevista pasa el payload
   * entero por mayúsculas-sin-tildes: guardaba "TECNOLOGO" y al releer no
   * casaba con ninguna opción, así que el select salía vacío y el dato se
   * perdía en el guardado siguiente. `nivelSuperiorNormalizado` iguala las dos
   * escrituras al cargar.
   */
  readonly NIVELES_SUPERIORES: ReadonlyArray<{ valor: string; etiqueta: string }> = [
    { valor: 'TECNICO', etiqueta: 'Técnico' },
    { valor: 'TECNOLOGO', etiqueta: 'Tecnólogo' },
    { valor: 'PROFESIONAL', etiqueta: 'Profesional' },
    { valor: 'ESPECIALIZACION', etiqueta: 'Especialización' },
    { valor: 'MAESTRIA', etiqueta: 'Maestría' },
    { valor: 'DOCTORADO', etiqueta: 'Doctorado' },
    { valor: 'CURSO / DIPLOMADO', etiqueta: 'Curso / Diplomado' },
    { valor: 'CERTIFICACION', etiqueta: 'Certificación' },
    { valor: 'OTRO', etiqueta: 'Otro' },
  ];

  /** Lo que venga del servidor, llevado a la opción de la lista que le toca. */
  private nivelSuperiorNormalizado(v: any): string {
    const n = this.normalizeText(v);
    return this.NIVELES_SUPERIORES.find((x) => x.valor === n)?.valor ?? '';
  }


  /**
   * Los accesos rápidos del panel, en el orden en que se baja por la hoja.
   *
   * Las cinco primeras las pinta `app-ficha-campos`; las cuatro últimas viven
   * en esta plantilla. Referencias va después de la experiencia, que es el
   * orden de la hoja de entrevista, así que se recoloca aquí a mano.
   */
  readonly SECCIONES_FICHA: ReadonlyArray<{ id: string; label: string; icon: string }> = [
    ...SECCIONES_FICHA.filter((s) => s.id !== 'referencias'),
    { id: 'formacion', label: 'Formación', icon: 'school' },
    { id: 'experiencia', label: 'Experiencia', icon: 'work_history' },
    { id: 'laboral', label: 'Empresas', icon: 'apartment' },
    ...SECCIONES_FICHA.filter((s) => s.id === 'referencias'),
    { id: 'entrevista', label: 'Entrevista', icon: 'rate_review' },
  ];

  /**
   * Secciones de la ficha que no se pintan de entrada y alguien pidió abrir
   * (el lápiz de la ficha del pipeline). Empiezan vacías en cada persona.
   */
  private readonly seccionesExtra = signal<readonly SeccionFicha[]>([]);

  /** Lo que se le pasa a la ficha en línea: los datos de la hoja + lo pedido. */
  readonly seccionesDatos = computed<readonly SeccionFicha[]>(() => [
    ...SECCIONES_FICHA.map((s) => s.id).filter((id) => id !== 'referencias'),
    ...this.seccionesExtra(),
  ]);

  /**
   * Lleva a una sección de los datos de la persona.
   *
   * Antes esto abría un diálogo. Se quitó porque entrevistar es ir bajando por
   * la ficha con el documento en la mano, y un modal obliga a abrir, corregir y
   * cerrar una sección cada vez. Ahora los campos están en línea y esto solo
   * desplaza hasta ellos; `'todos'` va al principio del bloque.
   *
   * `block: 'start'` con el scroll suave del navegador: la sección queda arriba
   * del área visible, no centrada, que es donde se sigue leyendo hacia abajo.
   */
  irASeccion(seccion: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const id = anclaSeccion(seccion === 'todos' ? 'identificacion' : seccion);
    // Un ciclo de render de margen: la sección puede acabar de aparecer (el
    // panel de Entrevista se monta al entrar) y aún no estar en el DOM.
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** Campos que se miran para el % de cada pestaña del área de trabajo. */
  private static readonly CAMPOS_ENTREVISTA = [
    'comoSeEntero', 'referenciado', 'nombreReferenciado', 'aplicaObservacion',
    'motivoEspera', 'motivoNoAplica', 'relacionFamiliar', 'desempenoLaboral',
    'felicitaciones', 'situacionConflictiva', 'actividadesDiferentes',
    'experienciaLaboral', 'areaExperiencia', 'tiempoExperiencia',
  ] as const;

  private static readonly CAMPOS_FORMACION = [
    'nivel', 'estudiaActualmente', 'proyeccion1Ano', 'experienciaFlores',
    'tipoExperienciaFlores', 'otroExperiencia',
    'estudiosExtra', 'tituloObtenido', 'institucionEstudio', 'anioFinalizacion',
  ] as const;

  private publicarAvances(): void {
    this.nav.publicar(
      'entrevista',
      avanceDeForm(this.formVacante, FormEntrevistaComponent.CAMPOS_ENTREVISTA),
    );
    this.nav.publicar(
      'formacion',
      avanceDeForm(this.formVacante, FormEntrevistaComponent.CAMPOS_FORMACION),
    );
    this.publicarAvanceFicha();
  }

  /**
   * Avance de cada bloque de la ficha.
   *
   * Cuenta TODOS los campos habilitados del bloque, no solo los obligatorios:
   * la ficha enseña cada uno de ellos, así que un bloque en 100 % con un "—"
   * en pantalla —el caso del documento, que no es obligatorio en el
   * formulario— se lee como un contador roto. Aquí el porcentaje responde a
   * "cuánto de lo que se ve está lleno".
   *
   * Ojo: esto NO mueve los railes. El avance de la ficha viaja por
   * `avanceFicha`, que son los datos de la PERSONA; los pasos del proceso
   * siguen midiéndose por obligatorios en `publicarAvances`.
   *
   * Los campos de cada bloque salen de `UBICACION`, que ya dice dónde vive
   * cada control —lo usa el aviso de "revise los campos en rojo"—. Escribir
   * una segunda lista era garantía de que se separaran a la primera que
   * alguien moviera un campo de bloque.
   */
  private publicarAvanceFicha(): void {
    const porBloque: Record<string, Avance> = {};
    const campos: Record<string, string[]> = {};
    for (const [campo, bloque] of FormEntrevistaComponent.UBICACION) {
      (campos[bloque] ??= []).push(campo);
    }
    for (const [bloque, lista] of Object.entries(campos)) {
      porBloque[bloque] = avanceDeForm(this.formVacante, lista, { soloObligatorios: false });
    }
    this.nav.avanceFicha.set(porBloque);
  }

  private normalizeText(v: any): string {
    return String(v ?? '')
      .normalize('NFD')                 // separa tildes (incluye el caso de "MÁS")
      .replace(/[\u0300-\u036f]/g, '')  // quita tildes
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private mapHaceCuantoVive(raw: any): string {
    if (!raw) return '';

    const s = this.normalizeText(raw);

    // Si ya viene en formato del select, respétalo
    // Normalizamos quitando guiones bajos para comparar texto flexible
    const textV = s.replace(/_/g, ' ');

    // 1. Mapeo exacto de valores (o equivalentes con espacios)
    if (s === 'LIFETIME' || textV.includes('VIDA')) return 'LIFETIME';
    if (textV.includes('MAS DE 2 MESES')) return 'MAS_DE_2_MESES';
    if (textV.includes('MAS DE 6 MESES')) return 'MAS_DE_6_MESES';
    if (textV.includes('MENOS DE UN MES')) return 'MENOS_DE_UN_MES';
    // "UN MES" debe chequearse después de "MENOS DE UN MES" para evitar falsos positivos
    if (textV.includes('UN MES')) return 'UN_MES';

    // 2. Mapeos de fallback (por si vienen datos viejos tipo "8 MESES", "1 AÑO")
    // Si contiene "AÑO" o "ANO" -> se asume más de 6 meses
    if (textV.includes('ANO') || textV.includes('AÑO')) return 'MAS_DE_6_MESES';

    // Si detectamos meses numéricos y no cayó en los anteriores
    const m = s.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 6) return 'MAS_DE_6_MESES';
      if (n > 2) return 'MAS_DE_2_MESES';
      if (n === 1) return 'UN_MES';
      // n < 1 no debería pasar si dice "meses", pero por si acaso
      return 'MENOS_DE_UN_MES';
    }

    return '';
  }


  // =======================
  // Navegación interna
  // =======================
  /**
   * Smooth-scroll al ancla `id` (sección) dentro del contenedor scrollable más
   * cercano. Funciona aunque el form esté dentro de un mat-tab que tiene su
   * propio overflow.
   */
  scrollToSection(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // =======================
  // Ciclo de vida
  // =======================
  ngOnInit(): void {
    this.restaurarPlegados();

    // Vinculamos controles de la sección de contacto/domicilio para refrescar validación
    this.linkStepToControls(this.step3Ctrl, this.step3Fields);

    this.hydrateOfficeFromQuery();
    this.loadCities();
    this.setupAutocomplete();
    this.setupAutocompleteNacimiento();
    this.seedExperiencias();

    // Validadores por bloque
    this.step1Ctrl.setValidators(this.makeValidator(this.step1Fields));

    this.step2Ctrl.setValidators(this.makeValidator(this.step2Fields));

    this.step3Ctrl.setValidators(this.makeValidator(this.step3Fields));

    this.step4Ctrl.setValidators(
      this.makeValidator(['tieneHijos'], () => {
        if (this.ctrl('tieneHijos').value !== true) return true;
        return (
          this.areValid(['cuidadorHijos', 'numeroHijos']) && this.hijosFA.valid
        );
      })
    );

    this.step5Ctrl.setValidators(
      this.makeValidator(
        ['nivel', 'estudiaActualmente', 'proyeccion1Ano', 'experienciaFlores'],
        () => {
          const exp = this.ctrl('experienciaFlores').value === 'Sí';
          if (!exp) return true;
          if (!this.areValid(['tipoExperienciaFlores'])) return false;
          return this.ctrl('tipoExperienciaFlores').value === 'OTROS'
            ? this.otroExperienciaControl.valid
            : true;
        }
      )
    );

    this.step6Ctrl.setValidators(() =>
      this.experienciasFA.valid ? null : { stepInvalid: true }
    );

    // Bloque de entrevista
    this.step7Ctrl.setValidators(() => {
      const val = (n: string) => (this.ctrl(n).value ?? '').toString().trim();

      // ¿Cómo se enteró?
      const comoSeEnteroOk = !!val('comoSeEntero');

      // Referenciado
      const referenciado = this.ctrl('referenciado').value;
      const nombreReferenciadoOk =
        referenciado === 'SI' ? !!val('nombreReferenciado') : true;

      // Observación del evaluador: la MISMA regla que pone los validadores.
      const aplicaOk = observacionCompleta(this.ctrl('aplicaObservacion').value, {
        motivoEspera: val('motivoEspera'),
        motivoNoAplica: val('motivoNoAplica'),
      });

      const ok = comoSeEnteroOk && nombreReferenciadoOk && aplicaOk;
      return ok ? null : { stepInvalid: true };
    });

    // Cuando cambie cualquier cosa en el formulario, refrescamos validación de las secciones
    this.formVacante.statusChanges.subscribe(() => this.refreshSteps());
    this.refreshSteps();

  }

  // =======================
  // Autocomplete ciudades
  // =======================
  private loadCities(): void {
    const list = colombia as Array<{
      id: number;
      departamento: string;
      ciudades: string[];
    }>;
    const set = new Set<string>();
    list.forEach((d) => d.ciudades?.forEach((c) => set.add(c)));
    this.allCities = Array.from(set).sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' })
    );
  }

  get municipioCtrl() {
    return this.ctrl('mpio_expedicion');
  }
  get lugarNacimientoCtrl() {
    return this.ctrl('mpio_nacimiento');
  }

  private setupAutocomplete(): void {
    this.filteredCities$ = this.municipioCtrl.valueChanges.pipe(
      startWith(this.municipioCtrl.value || ''),
      map((v) => this.filterCities(String(v ?? '')))
    );
  }

  private setupAutocompleteNacimiento(): void {
    this.filteredCitiesNacimiento$ =
      this.lugarNacimientoCtrl.valueChanges.pipe(
        startWith(this.lugarNacimientoCtrl.value || ''),
        map((v) => this.filterCities(String(v ?? '')))
      );
  }

  private filterCities(value: string): string[] {
    const norm = (s: string) =>
      s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const q = norm(value);
    return q
      ? this.allCities.filter((c) => norm(c).includes(q)).slice(0, 50)
      : this.allCities.slice(0, 50);
  }

  onMunicipioSelected(e: MatAutocompleteSelectedEvent) {
    this.municipioCtrl.setValue(e.option.value);
  }

  onLugarNacimientoSelected(e: MatAutocompleteSelectedEvent) {
    this.lugarNacimientoCtrl.setValue(e.option.value);
  }

  // =======================
  // Hijos
  // =======================
  get hijosFA(): FormArray {
    return this.formVacante.get('hijos') as FormArray;
  }

  private buildHijoGroup(): FormGroup {
    return this.fb.group({
      // SIN `required`: de los hijos, la entrevista solo pregunta cuántos son y
      // quién los cuida, así que el detalle de cada uno ya no se pinta. Un
      // obligatorio que no está en pantalla bloquea el guardado y el aviso
      // "revise los campos en rojo" señala un rojo que nadie puede ver. Las
      // filas incompletas las descarta el servicio antes de enviar, y el
      // backend deja intactos los hijos ya guardados cuando la lista llega
      // vacía: el detalle que traiga el registro no se pierde.
      numero_de_documento: [
        '',
        [
          Validators.pattern(/^\d+$/),
          Validators.minLength(6),
          Validators.maxLength(15),
        ],
      ],
      fecha_nac: [null],
      // Datos del hijo como BENEFICIARIO. Opcionales a propósito: los hijos ya
      // cargados solo tienen documento y fecha, y exigir el resto dejaría sin
      // guardar la entrevista de todos ellos.
      tipo_documento: ['RC'],
      primer_nombre: [''],
      segundo_nombre: [''],
      primer_apellido: [''],
      segundo_apellido: [''],
      sexo: [''],
    });
  }

  /** Tope duro de filas de hijos: por encima de esto es un error de digitación. */
  private static readonly MAX_HIJOS = 15;

  private setHijosCount(n: number): void {
    // Sin el tope, teclear "99999" en el número de hijos creaba 99.999
    // FormGroups síncronos y congelaba la ventana.
    const objetivo = Math.min(Math.max(0, Math.floor(Number(n) || 0)), FormEntrevistaComponent.MAX_HIJOS);
    const fa = this.hijosFA;
    while (fa.length < objetivo) fa.push(this.buildHijoGroup());
    while (fa.length > objetivo) fa.removeAt(fa.length - 1);
    this.refrescarHijosResumen();
    this.refreshSteps();
  }

  private setupHijosValidators(tiene: boolean): void {
    const cuidador = this.ctrl('cuidadorHijos');
    const num = this.ctrl('numeroHijos');

    if (tiene) {
      cuidador.addValidators([Validators.required, Validators.maxLength(120)]);
      num.addValidators([Validators.required, Validators.min(1)]);
    } else {
      cuidador.clearValidators();
      cuidador.setValue('', { emitEvent: false });

      num.clearValidators();
      num.setValue(0, { emitEvent: false });

      this.setHijosCount(0);
    }

    cuidador.updateValueAndValidity({ emitEvent: false });
    num.updateValueAndValidity({ emitEvent: false });
  }

  // =======================
  // Experiencias laborales
  // =======================
  get experienciasFA(): FormArray {
    return this.formVacante.get('experiencias') as FormArray;
  }

  addExperiencia(): void {
    this.experienciasFA.push(this.buildExperienciaGroup(true));
    this.refreshSteps();
  }

  removeExperiencia(i: number): void {
    if (i >= this.SEED_EXP_COUNT) {
      this.experienciasFA.removeAt(i);
      // Quitar una fila es una edición: sin marcarla, el guardado automático no
      // se enteraba y la empresa borrada volvía al recargar.
      this.formVacante.markAsDirty();
      this.autoEntrevista.programar();
    }
    this.refreshSteps();
  }

  /**
   * Una empresa del historial laboral.
   *
   * Los campos de contacto de la empresa (teléfono, dirección, barrio), el jefe
   * inmediato, el cargo, la fecha y el motivo de retiro EXISTEN en la tabla
   * desde siempre —el formulario de la vacante los llena y la ficha técnica los
   * imprime—, pero la entrevista solo manejaba cuatro. Como el guardado
   * REEMPLAZA la lista entera, cada entrevista guardada los estaba borrando.
   * Ahora viajan de ida y de vuelta.
   *
   * `labores_realizadas` y `labores_principales` no se pintan; se conservan en
   * el grupo para que sigan cargándose y guardándose.
   */
  private buildExperienciaGroup(required = true): FormGroup {
    const req = required
      ? [Validators.required, Validators.maxLength(255)]
      : [Validators.maxLength(255)];

    return this.fb.group({
      empresa: ['', req],
      telefonos: ['', [Validators.maxLength(15)]],
      direccion: ['', [Validators.maxLength(255)]],
      barrio: ['', [Validators.maxLength(255)]],
      nombre_jefe: ['', [Validators.maxLength(255)]],
      cargo: ['', [Validators.maxLength(64)]],
      fecha_retiro: [null],
      tiempo_trabajado: ['', [Validators.maxLength(50)]],
      motivo_retiro: ['', [Validators.maxLength(255)]],
      labores_realizadas: ['', [Validators.maxLength(255)]],
      labores_principales: ['', [Validators.maxLength(255)]],
    });
  }

  private seedExperiencias(n = this.SEED_EXP_COUNT): void {
    while (this.experienciasFA.length < n) {
      this.experienciasFA.push(this.buildExperienciaGroup(false));
    }
  }

  // =======================
  // Helpers de validación
  // =======================
  private ctrl(name: string) {
    return this.formVacante.get(name)!;
  }

  private areValid(keys: string[]): boolean {
    return keys.every((k) => {
      const c = this.ctrl(k);
      return !!c && (c.disabled || c.valid);
    });
  }

  private makeValidator(
    keys: string[],
    extra?: () => boolean
  ): ValidatorFn {
    return () =>
      this.areValid(keys) && (extra ? extra() : true)
        ? null
        : { stepInvalid: true };
  }

  private minLengthArray(min: number): ValidatorFn {
    return (ctrl: AbstractControl): ValidationErrors | null => {
      const v = ctrl.value as unknown;
      return Array.isArray(v) && v.length >= min
        ? null
        : { minLengthArray: { required: min } };
    };
  }

  private linkStepToControls(step: FormGroup, keys: string[]) {
    keys.forEach((k) =>
      this.ctrl(k).valueChanges.subscribe(() => {
        step.updateValueAndValidity({ onlySelf: true, emitEvent: false });
      })
    );
  }

  // Forzar validación de una sección tras patchValue
  private forceValidateStep(stepCtrl: FormGroup, keys: string[]) {
    keys.forEach((k) =>
      this.ctrl(k).updateValueAndValidity({ emitEvent: false })
    );
    stepCtrl.updateValueAndValidity({ onlySelf: true, emitEvent: false });
  }

  // Revalida todos los bloques lógicos
  refreshSteps(): void {
    this.step1Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step2Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step3Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step4Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step5Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step6Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
    this.step7Ctrl.updateValueAndValidity({
      onlySelf: true,
      emitEvent: false,
    });
  }

  private setEdad(): void {
    const v = this.ctrl('fecha_nacimiento').value;
    const d = v instanceof Date ? v : v ? new Date(v) : null;
    let edad: number | '' = '';

    if (d && !isNaN(d.getTime())) {
      const t = new Date();
      let a = t.getFullYear() - d.getFullYear();
      const m = t.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
      edad = Math.max(0, a);
    }

    this.ctrl('edad').setValue(edad, { emitEvent: false });
  }

  // =======================
  // Helpers de reglas dinámicas
  // =======================
  private applyExperienciaFloresRules(val: any): void {
    const tipoCtrl = this.ctrl('tipoExperienciaFlores');

    if (val !== 'Sí') {
      tipoCtrl.setValue('', { emitEvent: false });
      tipoCtrl.clearValidators();
      this.otroExperienciaControl.reset('', { emitEvent: false });
      this.otroExperienciaControl.clearValidators();
    } else {
      tipoCtrl.setValidators([Validators.required]);
    }

    tipoCtrl.updateValueAndValidity({ emitEvent: false });
    this.otroExperienciaControl.updateValueAndValidity({ emitEvent: false });
  }

  private applyTipoExperienciaFloresRules(value: any): void {
    if (value === 'OTROS') {
      this.otroExperienciaControl.setValidators([
        Validators.required,
        Validators.maxLength(64),
      ]);
    } else {
      this.otroExperienciaControl.reset('', { emitEvent: false });
      this.otroExperienciaControl.clearValidators();
    }

    this.otroExperienciaControl.updateValueAndValidity({
      emitEvent: false,
    });
  }

  private applyReferenciadoRules(v: any): void {
    const nombreRef = this.ctrl('nombreReferenciado');

    if (v === 'SI') {
      nombreRef.setValidators([
        Validators.required,
        Validators.maxLength(120),
      ]);
    } else {
      nombreRef.clearValidators();
      nombreRef.setValue('', { emitEvent: false });
    }

    nombreRef.updateValueAndValidity({ emitEvent: false });
    this.step7Ctrl.updateValueAndValidity({ emitEvent: false });
  }

  private applyAplicaObservacionRules(v: any): void {
    // Punto único por el que pasan tanto la carga del candidato (rellenarForm)
    // como los cambios en vivo del operador. Publicamos el estado para que los
    // componentes hermanos (remisión, exámenes, contratación) se bloqueen si el
    // candidato queda EN ESPERA de vacante.
    this.seleccionEstado.setAplicaObservacion(v);

    // El reparto estado → motivo lo decide `observacion-evaluador.rules`, que es
    // el mismo que usa el cálculo de avance. Antes estaba escrito aquí y allá.
    const propio = campoMotivoDe(v);
    const contrario = campoMotivoContrario(v);

    for (const nombre of ['motivoEspera', 'motivoNoAplica'] as const) {
      const c = this.ctrl(nombre);
      if (nombre === propio) {
        c.setValidators([Validators.required, Validators.maxLength(MAX_MOTIVO)]);
      } else {
        c.clearValidators();
        // Se limpia el del estado contrario: si no, cambiar de "no aplica" a
        // "en espera" dejaba vivo el motivo del rechazo y la ficha decía las
        // dos cosas a la vez.
        if (nombre === contrario || propio === null) c.setValue('', { emitEvent: false });
      }
      c.updateValueAndValidity({ emitEvent: false });
    }
    this.step7Ctrl.updateValueAndValidity({ emitEvent: false });
  }

  // =======================
  // Hidratar desde la URL (oficina)
  // =======================
  private normalizeOffice(s: string): string {
    return s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
  }

  private hydrateOfficeFromQuery() {
    this.route.queryParamMap.subscribe((params) => {
      const raw = (params.get('oficina') || params.get('o') || '').trim();

      // La oficina siempre queda editable: el query param solo la preasigna.
      // Si no hay query param, simplemente quedamos sin valor preasignado.
      if (!raw) {
        this.lockedOffice = undefined;
        return this.refreshSteps();
      }

      const norm = this.normalizeOffice(raw);
      const mapOficinas = new Map(
        this.oficinas.map((o) => [this.normalizeOffice(o), o])
      );
      const match = mapOficinas.get(norm);

      if (match) {
        this.ctrl('oficina').setValue(match, { emitEvent: false });
        this.lockedOffice = match;
      }

      // 'BRIGADA' salió de la lista: no es una sede, no tiene rango de
      // numeración de contratos y el flujo reescribía la oficina a
      // "BRIGADA DE <texto libre>", que es por donde entraban valores
      // arbitrarios. `brigadaDe` se sigue prellenando desde la URL para no
      // perder el dato si alguien todavía manda el query param.
      const brig = params.get('brigada');
      if (brig) {
        this.ctrl('brigadaDe').setValue(brig, { emitEvent: false });
      }

      this.refreshSteps();
    });
  }

  private normalizeCode(v: any): string {
    return String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  private mapEstadoCivil(raw: any, opts: Array<{ codigo?: string; descripcion?: string }> = []): string {
    const s = this.normalizeText(raw);
    if (!s) return '';

    // Si ya viene un código válido
    const byCode = opts.find(o => this.normalizeText(o?.codigo) === s);
    if (byCode?.codigo) return String(byCode.codigo);

    // Si viene "SO (Soltero)" u "SO - Soltero"
    const codeMatch = s.match(/\b(VI|UL|SO|SE|CA)\b/);
    if (codeMatch) {
      const code = codeMatch[1];
      if (opts.some(o => this.normalizeText(o?.codigo) === code)) return code;
    }

    // Si viene solo la palabra (SOLTERO, CASADO, etc.)
    const dict: Record<string, string> = {
      'SOLTERO': 'SO',
      'SOLTERA': 'SO',
      'CASADO': 'CA',
      'CASADA': 'CA',
      'VIUDO': 'VI',
      'VIUDA': 'VI',
      'SEPARADO': 'SE',
      'SEPARADA': 'SE',
      'UNION LIBRE': 'UL',
      'UNIONLIBRE': 'UL',
      'UL': 'UL',
    };

    const mapped = dict[s];
    if (mapped && opts.some(o => this.normalizeText(o?.codigo) === mapped)) return mapped;

    // Último intento: comparar contra descripción
    const byDesc = opts.find(o => this.normalizeText(o?.descripcion).includes(s));
    if (byDesc?.codigo) return String(byDesc.codigo);

    return '';
  }


  // =======================
  // Rellenar el form desde el candidato seleccionado
  // =======================
  private rellenarForm(cand: any): void {
    if (!cand) return;

    console.log('Rellenando formulario con candidato:', cand);
    const toDate = (v: any): Date | null => {
      if (!v) return null;

      // Si llega como "YYYY-MM-DD" (sin hora), parsea en zona local para que NO reste el día
      if (typeof v === 'string') {
        const s = v.trim();

        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (m) {
          const y = Number(m[1]);
          const mo = Number(m[2]) - 1; // 0-based
          const d = Number(m[3]);

          const local = new Date(y, mo, d); // local midnight
          return isNaN(local.getTime()) ? null : local;
        }

        // Si trae hora/zona (ej. 2026-01-17T05:00:00Z), usa el parse normal
        const parsed = new Date(s);
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      const d = v instanceof Date ? v : new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };


    const onlyDigits = (s: any) =>
      String(s ?? '')
        .replace(/\D+/g, '')
        .trim();

    // Normaliza texto (quita tildes raras, espacios, etc.)
    const normalizeText = (v: any): string =>
      String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

    // Mapea estado civil recibido (SOLTERO / "SO (Soltero)" / "SO") -> código (SO, CA, UL, VI, SE)
    const mapEstadoCivil = (
      raw: any,
      opts: Array<{ codigo?: string; descripcion?: string }> = []
    ): string => {
      const s = normalizeText(raw);
      if (!s) return '';

      // 1) Si ya viene el código exacto
      const byCode = opts.find((o) => normalizeText(o?.codigo) === s);
      if (byCode?.codigo) return String(byCode.codigo);

      // 2) Si viene mezclado tipo "SO (Soltero)" / "SO - Soltero"
      const codeMatch = s.match(/\b(VI|UL|SO|SE|CA)\b/);
      if (codeMatch) {
        const code = codeMatch[1];
        if (opts.some((o) => normalizeText(o?.codigo) === code)) return code;
      }

      // 3) Si viene la palabra
      const dict: Record<string, string> = {
        SOLTERO: 'SO',
        SOLTERA: 'SO',
        CASADO: 'CA',
        CASADA: 'CA',
        VIUDO: 'VI',
        VIUDA: 'VI',
        SEPARADO: 'SE',
        SEPARADA: 'SE',
        'UNION LIBRE': 'UL',
        UNIONLIBRE: 'UL',
      };

      const mapped = dict[s];
      if (mapped && opts.some((o) => normalizeText(o?.codigo) === mapped)) return mapped;

      // 4) Último intento: buscar por descripción
      const byDesc = opts.find((o) => normalizeText(o?.descripcion).includes(s));
      if (byDesc?.codigo) return String(byDesc.codigo);

      return '';
    };

    const info_cc = cand?.info_cc ?? {};
    const residencia = cand?.residencia ?? {};
    const contacto = cand?.contacto ?? {};
    const entrevistas = Array.isArray(cand?.entrevistas) ? cand.entrevistas : [];
    const oficina = entrevistas[0]?.oficina ?? '';
    const evalAux = cand?.evaluacion ?? {};

    const fechaNac = toDate(cand?.fecha_nacimiento);
    const fechaExp = toDate(info_cc?.fecha_expedicion);
    const haceCuantoVive = this.mapHaceCuantoVive(residencia?.hace_cuanto_vive);

    const estadoCivilRaw = cand?.estado_civil;
    const estadoCivilNorm = normalizeText(estadoCivilRaw);

    // Si ya viene código, lo ponemos de una; si viene "SOLTERO", lo dejamos vacío y lo mapeamos con el catálogo
    const estadoCivilQuick =
      ['VI', 'UL', 'SO', 'SE', 'CA'].includes(estadoCivilNorm) ? estadoCivilNorm : '';

    // El select de "tipo de experiencia en flores" solo acepta CULTIVO/POSCOSECHA/AMBAS/OTROS.
    // Su sitio es `entrevistas.tipo_experiencia_flores`, que es donde lo escribe el guardado.
    // Los registros anteriores lo dejaban además dentro de `area_experiencia` —que es la
    // lista de áreas del formulario de la vacante, multi-valor ("A, B")— así que se sigue
    // leyendo de ahí como respaldo; si no matchea una opción válida, se deja '' para que el
    // evaluador lo elija (no metemos basura).
    const VALID_TIPO_FLORES = ['CULTIVO', 'POSCOSECHA', 'AMBAS', 'OTROS'];
    const tipoFloresGuardado = normalizeText(entrevistas?.[0]?.tipo_experiencia_flores);
    const areaExpNorm = normalizeText(cand?.experiencia_resumen?.area_experiencia);
    const tipoExperienciaFloresVal =
      VALID_TIPO_FLORES.find((t) => tipoFloresGuardado.includes(t)) ||
      VALID_TIPO_FLORES.find((t) => areaExpNorm.includes(t)) ||
      '';

    // "¿Ha trabajado en empresas de flores?" vive en `entrevistas`. Antes se leía de
    // `experiencia_resumen.tiene_experiencia`, que es la pregunta GENERAL de experiencia
    // laboral: quien tenía experiencia sin ser en flores salía marcado como florista.
    const floresGuardado = String(entrevistas?.[0]?.cuenta_experiencia_flores ?? '').trim().toUpperCase();
    const experienciaFloresVal =
      floresGuardado === 'SI' || floresGuardado === 'SÍ' ? 'Sí'
      : floresGuardado === 'NO' ? 'No'
      : cand?.experiencia_resumen?.tiene_experiencia ? 'Sí' : 'No';

    // Áreas: multi-selección del catálogo AREAS_EXPERIENCIA, guardada como lista separada
    // por comas. Los códigos de tipo de experiencia en flores que los guardados viejos
    // dejaron ahí no son áreas y se descartan.
    const areasGuardadas = String(cand?.experiencia_resumen?.area_experiencia ?? '')
      .split(',')
      .map((x: string) => x.trim())
      .filter((x: string) => !!x && !VALID_TIPO_FLORES.includes(x.toUpperCase()));

    // 1) patchValue sin emitir eventos
    this.formVacante.patchValue(
      {
        // Si el servidor no trae oficina se CONSERVA la actual: el query param
        // `?oficina=` la preasigna en ngOnInit y este patch (que corre después)
        // la borraba para todos los candidatos nuevos.
        oficina: oficina || this.formVacante.get('oficina')?.value || '',
        tipo_doc: cand?.tipo_doc || '',
        numero_documento: cand?.numero_documento || '',
        fecha_expedicion: fechaExp,
        mpio_expedicion: info_cc?.mpio_expedicion || '',

        primer_apellido: cand?.primer_apellido || '',
        segundo_apellido: cand?.segundo_apellido || '',
        primer_nombre: cand?.primer_nombre || '',
        segundo_nombre: cand?.segundo_nombre || '',
        fecha_nacimiento: fechaNac,
        mpio_nacimiento: info_cc?.mpio_nacimiento || '',
        sexo: cand?.sexo || '',
        rh: cand?.rh || '',
        estado_civil: estadoCivilQuick || '',
        correo_electronico: contacto?.email || contacto?.correo_electronico || '',
        direccion_de_residencia: residencia?.direccion || residencia?.direccion_de_residencia || '',
        barrio: residencia?.barrio || '',
        celular: contacto?.celular || '',
        whatsapp: contacto?.whatsapp || '',
        hace_cuanto_vive: haceCuantoVive || '',

        nivel: cand?.formaciones?.[0]?.nivel || '',
        estudiosExtra: this.nivelSuperiorNormalizado(cand?.formaciones?.[0]?.estudios_extra),
        tituloObtenido: cand?.formaciones?.[0]?.titulo_obtenido || '',
        institucionEstudio: cand?.formaciones?.[0]?.institucion || '',
        anioFinalizacion: cand?.formaciones?.[0]?.anio_finalizacion ?? null,
        proyeccion1Ano: entrevistas?.[0]?.como_se_proyecta || evalAux?.motivacion || '',
        estudiaActualmente: !!cand?.vivienda?.estudia_actualmente,
        experienciaLaboral: cand?.experiencia_resumen?.tiene_experiencia === true ? 'SI'
          : cand?.experiencia_resumen?.tiene_experiencia === false ? 'NO' : '',
        experienciaFlores: experienciaFloresVal,
        tipoExperienciaFlores: tipoExperienciaFloresVal,
        areaExperiencia: areasGuardadas,
        tiempoExperiencia: cand?.experiencia_resumen?.tiempo_experiencia_texto || '',

        comoSeEntero: entrevistas?.[0]?.como_se_entero || '',
        // Backend guarda 'SI' | 'NO' (CharField). El bug previo trataba el valor
        // como booleano, así que cualquier string truthy ('NO' incluido) caía a 'SI'.
        // Normalizamos: 'SI'/'SÍ' -> 'SI', 'NO' -> 'NO', resto -> null (sin selección).
        referenciado: ((): 'SI' | 'NO' | null => {
          const v = String(entrevistas?.[0]?.referenciado ?? '').trim().toUpperCase();
          if (v === 'SI' || v === 'SÍ') return 'SI';
          if (v === 'NO') return 'NO';
          return null;
        })(),
        nombreReferenciado: entrevistas?.[0]?.nombre_referenciado || '',
        aplicaObservacion: entrevistas?.[0]?.proceso?.aplica_o_no_aplica || '',
        motivoEspera: entrevistas?.[0]?.proceso?.motivo_espera || '',
        motivoNoAplica: entrevistas?.[0]?.proceso?.motivo_no_aplica || '',

        // Opcionales evaluacion
        relacionFamiliar: evalAux?.relacion_familiar || '',
        desempenoLaboral: evalAux?.rendimiento_laboral || evalAux?.rendimiento || '',
        felicitaciones: evalAux?.porque_lo_felicitarian || '',
        situacionConflictiva: evalAux?.malentendido || '',
        actividadesDiferentes: evalAux?.actividades_diarias || '',
      },
      { emitEvent: false }
    );

    // 1.1) Asegurar estado civil cuando cargue el catálogo (SOLTERO -> SO, etc.)
    this.estadoCivilOpciones$
      .pipe(
        filter((opts): opts is any[] => Array.isArray(opts) && opts.length > 0),
        take(1)
      )
      .subscribe((opts) => {
        const code = mapEstadoCivil(estadoCivilRaw, opts);
        this.formVacante.get('estado_civil')?.setValue(code || '', { emitEvent: false });

        // Revalida por si tienes validación forzada por steps
        this.formVacante.get('estado_civil')?.updateValueAndValidity({ emitEvent: false });
        this.formVacante.updateValueAndValidity({ emitEvent: false });

        if (typeof this.refreshSteps === 'function') {
          this.refreshSteps();
        }
      });

    // 2) Validar secciones inmediatamente después del patch
    this.forceValidateStep(this.step1Ctrl, this.step1Fields);
    this.forceValidateStep(this.step2Ctrl, this.step2Fields);

    // 3) Campos derivados (recalcula edad)
    this.ctrl('fecha_nacimiento').setValue(fechaNac, { emitEvent: true });

    // 4) “¿Con quién vive?”
    const rawConvive = String(cand?.vivienda?.personas_con_quien_convive ?? '');
    const tokens = rawConvive
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.conQuienViveOpciones$.pipe(take(1)).subscribe((opts) => {
      const up = (x: any) => String(x ?? '').trim().toUpperCase();
      const selectedCodes = tokens
        .map((tok) => {
          const TK = up(tok);
          const found = opts.find((o) => up(o['codigo']) === TK || up(o['descripcion']) === TK);
          return found ? String(found['codigo']) : null;
        })
        .filter((x): x is string => !!x);

      this.ctrl('personas_con_quien_convive').setValue(selectedCodes, { emitEvent: false });
      this.forceValidateStep(this.step3Ctrl, this.step3Fields);
      this.refreshSteps();
    });

    // 5) Información familiar (hijos)
    const hijosArr = Array.isArray(cand?.hijos) ? cand.hijos : [];
    
    // Referencias vienen en formato array por el backend
    const refs = Array.isArray(cand?.referencias) ? cand.referencias : [];
    /**
     * Conviven dos convenciones de `tipo`: los registros migrados del sistema
     * viejo guardan dos filas planas ('PERSONAL', 'FAMILIAR') y los creados por
     * esta app usan slot numerado ('PERSONAL1'/'PERSONAL2'). Buscando solo el
     * slot numerado se perdían los migrados, que son la enorme mayoría, y los
     * campos salían vacíos aunque el candidato sí tuviera referencias.
     * Se ordena por id para que la 1ª y la 2ª sean estables (el orden por
     * defecto del modelo es alfabético por nombre).
     */
    const slotRef = (base: 'PERSONAL' | 'FAMILIAR', n: 1 | 2) => {
      const tipoDe = (r: any) => String(r?.tipo ?? '').trim().toUpperCase();
      const exacto = refs.find((r: any) => tipoDe(r) === `${base}${n}`);
      if (exacto) return exacto;
      const planas = refs
        .filter((r: any) => tipoDe(r) === base)
        .sort((a: any, b: any) => (a?.id ?? 0) - (b?.id ?? 0));
      return planas[n - 1] ?? null;
    };
    const fam1 = slotRef('FAMILIAR', 1);
    const fam2 = slotRef('FAMILIAR', 2);
    const per1 = slotRef('PERSONAL', 1);
    const per2 = slotRef('PERSONAL', 2);

    this.formVacante.patchValue(
      {
        tieneHijos: hijosArr.length > 0,
        cuidadorHijos: cand?.vivienda?.responsable_hijos || '',
        numeroHijos: hijosArr.length,
        nombreReferenciaFamiliar1: fam1?.nombre || '',
        parentescoReferenciaFamiliar1: fam1?.parentesco || '',
        nombreReferenciaFamiliar2: fam2?.nombre || '',
        parentescoReferenciaFamiliar2: fam2?.parentesco || '',
        nombreReferenciaPersonal1: per1?.nombre || '',
        parentescoReferenciaPersonal1: per1?.parentesco || '',
        nombreReferenciaPersonal2: per2?.nombre || '',
        parentescoReferenciaPersonal2: per2?.parentesco || '',
        telefonoReferenciaFamiliar1: fam1?.telefono || '',
        ocupacionReferenciaFamiliar1: fam1?.ocupacion || '',
        direccionReferenciaFamiliar1: fam1?.direccion || '',
        telefonoReferenciaFamiliar2: fam2?.telefono || '',
        ocupacionReferenciaFamiliar2: fam2?.ocupacion || '',
        direccionReferenciaFamiliar2: fam2?.direccion || '',
        telefonoReferenciaPersonal1: per1?.telefono || '',
        ocupacionReferenciaPersonal1: per1?.ocupacion || '',
        direccionReferenciaPersonal1: per1?.direccion || '',
        telefonoReferenciaPersonal2: per2?.telefono || '',
        ocupacionReferenciaPersonal2: per2?.ocupacion || '',
        direccionReferenciaPersonal2: per2?.direccion || '',
      },
      { emitEvent: false }
    );

    // 5.b) Pareja, padres, emergencia y tallas.
    //
    // Los cuatro viven en `familiares`, UNA fila por tipo (así los guarda
    // CandidatoFormUpsertService). Se leen aquí para que el diálogo de la ficha
    // los muestre llenos: sin esto el seleccionador vería en blanco datos que la
    // persona sí diligenció en el formulario de la vacante, y al guardar los
    // borraría.
    const familiares = Array.isArray(cand?.familiares) ? cand.familiares : [];
    const familiarDe = (tipo: string) =>
      familiares.find((x: any) => String(x?.tipo ?? '').trim().toUpperCase() === tipo) ?? null;
    const conyuge = familiarDe('CONYUGUE');
    const padre = familiarDe('PADRE');
    const madre = familiarDe('MADRE');
    const emergencia = familiarDe('EMERGENCIA');
    // El contacto de emergencia tiene nombres estructurados (RF-033) y, en los
    // registros viejos, solo el nombre completo. Se prefiere lo estructurado y
    // se cae a lo legacy.
    const nombreDe = (f: any) =>
      [f?.primer_nombre, f?.segundo_nombre].filter(Boolean).join(' ').trim() || (f?.nombre ?? '');
    const apellidoDe = (f: any) =>
      [f?.primer_apellido, f?.segundo_apellido].filter(Boolean).join(' ').trim() || (f?.apellido ?? '');
    const dot = cand?.dotacion ?? null;

    this.formVacante.patchValue(
      {
        viveConyuge: conyuge?.vive_con || '',
        nombresConyuge: nombreDe(conyuge),
        apellidosConyuge: apellidoDe(conyuge),
        documentoConyuge: conyuge?.numero_de_documento || '',
        telefonoConyuge: conyuge?.telefono || '',
        ocupacionConyuge: conyuge?.ocupacion || '',
        municipioConyuge: conyuge?.municipio || '',
        barrioConyuge: conyuge?.barrio || '',
        direccionConyuge: conyuge?.direccion || '',

        elPadreVive: padre?.vive_con || '',
        nombresPadre: nombreDe(padre),
        apellidosPadre: apellidoDe(padre),
        telefonoPadre: padre?.telefono || '',
        ocupacionPadre: padre?.ocupacion || '',
        municipioPadre: padre?.municipio || '',
        barrioPadre: padre?.barrio || '',
        direccionPadre: padre?.direccion || '',

        madreVive: madre?.vive_con || '',
        nombresMadre: nombreDe(madre),
        apellidosMadre: apellidoDe(madre),
        telefonoMadre: madre?.telefono || '',
        ocupacionMadre: madre?.ocupacion || '',
        municipioMadre: madre?.municipio || '',
        barrioMadre: madre?.barrio || '',
        direccionMadre: madre?.direccion || '',

        nombresFamiliarEmergencia: nombreDe(emergencia),
        apellidosFamiliarEmergencia: apellidoDe(emergencia),
        parentescoFamiliarEmergencia: emergencia?.parentesco || '',
        telefonoFamiliarEmergencia: emergencia?.telefono || '',
        ocupacionFamiliarEmergencia: emergencia?.ocupacion || '',
        municipioFamiliarEmergencia: emergencia?.municipio || '',
        barrioFamiliarEmergencia: emergencia?.barrio || '',
        direccionFamiliarEmergencia: emergencia?.direccion || '',

        // 0 es el valor por defecto de la tabla y significa "sin talla": se
        // pinta vacío para que no parezca una talla real.
        tallaChaqueta: dot?.chaqueta || null,
        tallaPantalon: dot?.pantalon || null,
        tallaCamisa: dot?.camisa || null,
        tallaCalzado: dot?.calzado || null,
      },
      { emitEvent: false },
    );

    this.setHijosCount(hijosArr.length);

    hijosArr.forEach((h: any, i: number) => {
      const fg = this.hijosFA.at(i) as FormGroup;
      fg?.patchValue(
        {
          numero_de_documento: onlyDigits(h?.numero_de_documento),
          fecha_nac: toDate(h?.fecha_nac),
          tipo_documento: h?.tipo_documento || 'RC',
          primer_nombre: h?.primer_nombre || '',
          segundo_nombre: h?.segundo_nombre || '',
          primer_apellido: h?.primer_apellido || '',
          segundo_apellido: h?.segundo_apellido || '',
          sexo: h?.sexo || '',
        },
        { emitEvent: false }
      );
    });

    // 6) Historial laboral
    const exps = Array.isArray(cand?.experiencias) ? cand.experiencias : [];
    const totalCards = Math.max(exps.length, this.SEED_EXP_COUNT);

    while (this.experienciasFA.length < totalCards) {
      this.experienciasFA.push(this.buildExperienciaGroup(false));
    }
    while (this.experienciasFA.length > totalCards) {
      this.experienciasFA.removeAt(this.experienciasFA.length - 1);
    }

    const txt = (v: any) => (v ?? '').toString();
    exps.forEach((e: any, i: number) => {
      (this.experienciasFA.at(i) as FormGroup)?.patchValue(
        {
          empresa: txt(e?.empresa),
          telefonos: txt(e?.telefonos),
          direccion: txt(e?.direccion),
          barrio: txt(e?.barrio),
          // El registro viejo trae el jefe en una sola columna y el nuevo
          // partido en nombre y apellido (RF-043): se prefiere lo que tenga.
          nombre_jefe:
            txt(e?.nombre_jefe) ||
            [e?.jefe_primer_nombre, e?.jefe_primer_apellido].filter(Boolean).join(' '),
          cargo: txt(e?.cargo),
          fecha_retiro: e?.fecha_retiro ? new Date(`${String(e.fecha_retiro).slice(0, 10)}T00:00:00`) : null,
          tiempo_trabajado: txt(e?.tiempo_trabajado),
          motivo_retiro: txt(e?.motivo_retiro),
          labores_realizadas: txt(e?.labores_realizadas),
          labores_principales: txt(e?.labores_principales),
        },
        { emitEvent: false }
      );
    });

    for (let i = exps.length; i < totalCards; i++) {
      (this.experienciasFA.at(i) as FormGroup)?.patchValue(
        {
          empresa: '', telefonos: '', direccion: '', barrio: '', nombre_jefe: '',
          cargo: '', fecha_retiro: null, tiempo_trabajado: '', motivo_retiro: '',
          labores_realizadas: '', labores_principales: '',
        },
        { emitEvent: false }
      );
    }

    // 7) Reaplicar reglas dinámicas para que los validadores condicionales coincidan con los valores cargados
    this.setupHijosValidators(this.ctrl('tieneHijos').value === true);
    this.applyExperienciaFloresRules(this.ctrl('experienciaFlores').value);
    this.applyTipoExperienciaFloresRules(this.ctrl('tipoExperienciaFlores').value);
    this.applyReferenciadoRules(this.ctrl('referenciado').value);
    this.applyAplicaObservacionRules(this.ctrl('aplicaObservacion').value);

    // 8) Forzar validación final de todas las secciones
    this.forceValidateStep(this.step3Ctrl, this.step3Fields);
    this.step4Ctrl.updateValueAndValidity({ emitEvent: false });
    this.step5Ctrl.updateValueAndValidity({ emitEvent: false });
    this.step6Ctrl.updateValueAndValidity({ emitEvent: false });
    this.step7Ctrl.updateValueAndValidity({ emitEvent: false });

    // 9) Recalcular el formulario completo
    this.formVacante.updateValueAndValidity({ emitEvent: false });
    this.refrescarHijosResumen();
    this.refreshSteps();
  }


  // =======================
  // Helpers de formato
  // =======================

  // Siempre devolver fechas como 'YYYY-MM-DD' o null
  private toYMD(value: any): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${y}-${m}-${day}`;
  }

  /**
   * La `X` marca que el documento NO es cédula de ciudadanía.
   *
   * Antes esto comparaba `tipo === 'CC'` contra el valor CRUDO del formulario.
   * Con `'C.C'` —13793 filas en prod— la comparación fallaba, se enviaba
   * `X<cédula>` y el backend creaba un Candidato NUEVO para una persona que ya
   * existía. Era la fábrica activa de duplicados: cada entrevista guardada así
   * sumaba una fila. Se canoniza antes de comparar.
   */
  /** Guardado automático de la entrevista (ver `onSubmit`). */
  private async guardarEntrevistaSola(): Promise<void> {
    const raw = this.formVacante.getRawValue();
    if (!String(raw?.numero_documento ?? '').trim() || !raw?.tipo_doc) return;
    const completa = this.formVacante.valid;

    const payload = {
      ...raw,
      numero_documento: this.normalizeDocForSubmit(raw.tipo_doc, raw.numero_documento),
      fecha_expedicion: this.toYMD(raw.fecha_expedicion),
      fecha_nacimiento: this.toYMD(raw.fecha_nacimiento),
      hijos: Array.isArray(raw.hijos)
        ? raw.hijos.map((h: any) => ({ ...h, fecha_nac: this.toYMD(h?.fecha_nac) }))
        : [],
      experiencias: Array.isArray(raw.experiencias)
        ? raw.experiencias.map((e: any) => ({ ...e, fecha_retiro: this.toYMD(e?.fecha_retiro) }))
        : [],
      brigadaDe: raw.brigadaDe ?? '',
    };

    const resp: any = await firstValueFrom(
      this.candidateService.upsertCandidatoByDocumentoFromForm(
        payload,
        // "Entrevistado" solo con la entrevista completa, igual que el antiguo "Enviar".
        completa ? { entrevistado: true } : undefined,
        this.modificacionForzada()
          ? { modificacion_forzada: true, modificado_por: this.modificadoPor() || null }
          : undefined,
      ),
    );
    if (resp?.offline === true) {
      throw new GuardadoIncompleto('Sin conexión: se enviará al volver la conexión');
    }
    this.formVacante.markAsPristine();
    // El padre recarga: si el proceso anterior era terminal, el backend abrió uno
    // nuevo y las píldoras / Historial tienen que verlo.
    this.guardado.emit();
  }

  private normalizeDocForSubmit(tipo: string, raw: any): string {
    return docParaEnviar(tipo, raw);
  }

  // =======================
  // Submit
  // =======================
  /**
   * Guarda la entrevista. `silencioso` es el guardado automático: sin avisos,
   * lanza si falla, y con obligatorios pendientes guarda lo respondido SIN
   * marcar la entrevista como realizada.
   */
  async onSubmit(opts: { silencioso?: boolean } = {}) {
    if (opts.silencioso) {
      await this.guardarEntrevistaSola();
      return;
    }
    if (this.isSubmitting) return;

    if (this.formVacante.invalid) {
      this.formVacante.markAllAsTouched();
      this.refreshSteps();

      // Determinar qué sección tiene el error
      const sections: { ctrl: FormGroup; name: string }[] = [
        { ctrl: this.step1Ctrl, name: 'Identificación / Documento' },
        { ctrl: this.step2Ctrl, name: 'Datos Personales' },
        { ctrl: this.step3Ctrl, name: 'Contacto y Domicilio' },
        { ctrl: this.step4Ctrl, name: 'Información Familiar (Hijos)' },
        { ctrl: this.step5Ctrl, name: 'Formación / Experiencia en Flores' },
        { ctrl: this.step6Ctrl, name: 'Historial Laboral' },
        { ctrl: this.step7Ctrl, name: 'Datos de Entrevista' },
      ];
      const invalidSections = sections.filter(s => s.ctrl.invalid).map(s => `<li>${s.name}</li>`);
      const sectionList = invalidSections.length
        ? `<p>Revise las siguientes secciones:</p><ul style="text-align:left;font-size:14px;">${invalidSections.join('')}</ul>`
        : '';

      await Swal.fire({
        icon: 'error',
        title: 'Formulario incompleto',
        html: `Hay campos obligatorios sin llenar o con errores.<br><b>Revise los campos marcados en rojo.</b>${sectionList}`,
        confirmButtonColor: '#3085d6',
      });

      // Abre la pestaña / fila donde vive el error ANTES de buscarlo en el DOM:
      // en la vista nueva no todo está pintado a la vez.
      this.revelarPrimerInvalido();
      this.cdr.markForCheck();

      setTimeout(() => {
        const firstInvalidControl = document.querySelector(
          'mat-form-field.mat-form-field-invalid, .ng-invalid[formControlName], .ng-invalid[formGroupName], .ng-invalid[formArrayName]'
        ) as HTMLElement;

        if (firstInvalidControl) {
          // Destaca visualmente el control temporalmente
          firstInvalidControl.classList.add('error-pulse');
          setTimeout(() => firstInvalidControl.classList.remove('error-pulse'), 2000);

          // Hacer focus si es posible (inputs/selects de Angular)
          const focusable = firstInvalidControl.querySelector('input, select, textarea') as HTMLElement;
          if (focusable) focusable.focus();

          // El scroll ya no lo hace la ventana sino el contenedor interno (la
          // ficha o el panel de trabajo), así que se delega en el navegador:
          // `scrollIntoView` sube por el árbol y mueve el que corresponda.
          firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);

      return;
    }

    this.isSubmitting = true;
    try {
      const raw = this.formVacante.getRawValue();

      // Normalizamos payload antes de enviarlo
      const payload = {
        ...raw,

        // Documento con regla X + dígitos si no es CC
        numero_documento: this.normalizeDocForSubmit(
          raw.tipo_doc,
          raw.numero_documento
        ),

        // Fechas principales en YYYY-MM-DD
        fecha_expedicion: this.toYMD(raw.fecha_expedicion),
        fecha_nacimiento: this.toYMD(raw.fecha_nacimiento),

        // Hijos: formatear fecha_nac
        hijos: Array.isArray(raw.hijos)
          ? raw.hijos.map((h: any) => ({
            ...h,
            fecha_nac: this.toYMD(h?.fecha_nac),
          }))
          : [],

        // Historial laboral: la fecha de retiro sale del datepicker como Date.
        experiencias: Array.isArray(raw.experiencias)
          ? raw.experiencias.map((e: any) => ({
            ...e,
            fecha_retiro: this.toYMD(e?.fecha_retiro),
          }))
          : [],

        // Por si el backend espera string plano, no Date
        brigadaDe: raw.brigadaDe ?? '',
      };

      // Guardar candidato / marcar entrevista como realizada
      const resp: any = await firstValueFrom(
        this.candidateService.upsertCandidatoByDocumentoFromForm(payload, {
          entrevistado: true,
        }, this.modificacionForzada()
          ? { modificacion_forzada: true, modificado_por: this.modificadoPor() || null }
          : undefined)
      );

      // Detectar respuesta offline falsa del interceptor
      if (resp?.offline === true) {
        await Swal.fire({
          icon: 'info',
          title: 'Sin conexión',
          html: 'No hay conexión a internet. Los datos se guardaron en su dispositivo y se enviarán automáticamente cuando vuelva la conexión.',
          confirmButtonText: 'Entendido',
          confirmButtonColor: '#3085d6',
        });
        return;
      }

      // Guardado real y confirmado (no offline): avisar al padre para que recargue
      // el candidato. Si el proceso anterior era terminal, ahora hay uno nuevo y
      // debe reflejarse en las píldoras / Historial sin tener que re-buscar.
      this.guardado.emit();

      const veredicto = this.ctrl('aplicaObservacion').value;
      await Swal.fire({
        icon: 'success',
        title: 'Listo',
        text: veredicto === 'APLICA'
          ? 'Entrevista guardada. Continúe con la remisión a una vacante.'
          : 'Datos guardados y entrevista marcada.',
      });

      // Se avisa DESPUÉS del aviso: si se salta antes, el operador ve cambiar la
      // pantalla debajo del modal y no sabe qué pasó.
      this.entrevistaEnviada.emit(veredicto ?? null);
    } catch (e: any) {
      console.error('[form-entrevista] Error al guardar:', e);

      let title = 'Error al guardar';
      let htmlMessage = '';

      // Detectar respuesta offline falsa del interceptor
      if (e?.offline === true || e?.error?.offline === true) {
        await Swal.fire({
          icon: 'info',
          title: 'Sin conexión',
          html: 'No hay conexión a internet. Los datos se guardaron en su dispositivo y se enviarán automáticamente cuando vuelva la conexión.',
          confirmButtonText: 'Entendido',
          confirmButtonColor: '#3085d6',
        });
        return;
      }

      const errBody = e?.error;

      // Diccionario para traducir nombres técnicos de campos Django → español
      const fieldDict: Record<string, string> = {
        'numero_documento': 'Número de documento',
        'tipo_doc': 'Tipo de documento',
        'fecha_expedicion': 'Fecha de expedición',
        'mpio_expedicion': 'Municipio de expedición',
        'primer_apellido': 'Primer apellido',
        'segundo_apellido': 'Segundo apellido',
        'primer_nombre': 'Primer nombre',
        'segundo_nombre': 'Segundo nombre',
        'fecha_nacimiento': 'Fecha de nacimiento',
        'mpio_nacimiento': 'Municipio de nacimiento',
        'sexo': 'Género',
        'estado_civil': 'Estado civil',
        'correo_electronico': 'Correo electrónico',
        'password': 'Contraseña',
        'direccion_de_residencia': 'Dirección de residencia',
        'barrio': 'Barrio',
        'celular': 'Celular',
        'whatsapp': 'WhatsApp',
        'personas_con_quien_convive': 'Con quién vive',
        'hace_cuanto_vive': 'Tiempo en la zona',
        'nivel': 'Nivel de escolaridad',
        'experiencias': 'Experiencia laboral',
        'empresa': 'Empresa',
        'tiempo_trabajado': 'Tiempo trabajado',
        'labores_realizadas': 'Labores realizadas',
        'hijos': 'Hijos',
        'fecha_nac': 'Fecha de nacimiento del hijo',
        'numero_de_documento': 'Documento del hijo',
        'non_field_errors': 'Error general',
        'detail': 'Detalle',
      };
      const msgDict: Record<string, string> = {
        'This field is required.': 'Este campo es obligatorio.',
        'This field may not be blank.': 'Este campo no puede estar vacío.',
        'This field must be unique.': 'Este dato ya está registrado.',
        'Ensure this field has at least 8 characters.': 'Debe tener mínimo 8 caracteres.',
        'Enter a valid email address.': 'Ingrese un correo electrónico válido.',
        'A valid integer is required.': 'Se requiere un número válido.',
        'Date has wrong format.': 'Formato de fecha incorrecto (use AAAA-MM-DD).',
      };

      const translateField = (k: string): string => fieldDict[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const translateMsg = (m: string): string => msgDict[m] || m;

      if (errBody) {
        if (errBody.detail) {
          htmlMessage += `<b>${translateMsg(errBody.detail)}</b><br/>`;
        }

        // Parsear errores de validación de Django (DRF) recursivamente
        if (errBody.errors && typeof errBody.errors === 'object') {
          htmlMessage += `<ul style="text-align: left; font-size: 0.9em; margin-top: 10px; max-height: 200px; overflow-y: auto; padding-right: 10px;">`;

          const parseErrors = (obj: any, parentKey = ''): void => {
            if (Array.isArray(obj)) {
              obj.forEach((item, idx) => {
                if (typeof item === 'object' && item !== null) {
                  parseErrors(item, `${parentKey} (#${idx + 1})`);
                } else if (String(item).trim()) {
                  const translated = translateMsg(String(item));
                  if (parentKey.includes('Error general')) {
                    htmlMessage += `<li>${translated}</li>`;
                  } else {
                    htmlMessage += `<li>${parentKey ? `<b>${parentKey}:</b> ` : ''}${translated}</li>`;
                  }
                }
              });
            } else if (typeof obj === 'object' && obj !== null) {
              for (const [k, v] of Object.entries(obj)) {
                const fieldName = k === 'non_field_errors' ? 'Error general' : translateField(k);
                const prefix = parentKey ? `${parentKey} ➔ ${fieldName}` : fieldName;
                parseErrors(v, prefix);
              }
            } else if (String(obj).trim()) {
              const translated = translateMsg(String(obj));
              htmlMessage += `<li>${parentKey ? `<b>${parentKey}:</b> ` : ''}${translated}</li>`;
            }
          };

          parseErrors(errBody.errors);
          htmlMessage += `</ul>`;
        }

        if (errBody.db_error) {
          htmlMessage += `<div style="font-size: 0.85em; margin-top: 10px; color: #666; text-align: left; max-height: 100px; overflow-y: auto;"><i>Detalle técnico:</i> ${errBody.db_error}</div>`;
        }
        if (errBody.hint) {
          htmlMessage += `<div style="font-size: 0.85em; color: dimgrey; margin-top: 5px; text-align: left;"><b>Sugerencia:</b> ${errBody.hint}</div>`;
        }

        if (errBody.error && !errBody.details && !errBody.errors) {
          htmlMessage += `<div style="font-size: 0.85em; margin-top: 10px; color: #666; text-align: left;"><i>Error de sistema:</i> ${errBody.error}</div>`;
        }
      }

      if (!htmlMessage) {
        const status = e?.status;
        if (status === 0 || status === 504) {
          htmlMessage = 'No se pudo conectar con el servidor. Verifique su conexión a internet e intente de nuevo.';
        } else if (status === 500) {
          htmlMessage = 'Error interno del servidor. Los datos no se guardaron. Por favor intente de nuevo o contacte a soporte.';
        } else {
          htmlMessage = e?.message || 'No se pudo guardar debido a un error de conexión o del servidor.';
        }
      }

      await Swal.fire({
        icon: 'error',
        title: title,
        html: htmlMessage + '<p style="font-size:12px;color:#888;margin-top:10px;">Si el problema persiste, contacte a soporte indicando el número de documento.</p>',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#3085d6',
      });
    } finally {
      // OnPush + Electron: el `await` puede resolver FUERA de la zona de Angular
      // (el interceptor offline resuelve vía IPC de Electron). Sin esto, el botón
      // se queda en "Enviando…" hasta el próximo evento (un click). Forzamos el
      // reset y el re-render dentro de la zona.
      this.ngZone.run(() => {
        this.isSubmitting = false;
        this.cdr.markForCheck();
      });
    }
  }
}
