/**
 * Radicar por codigo unico (reunion funcional 2026-10-05). Es el corazon de Radicacion y de
 * "Recobro por codigo":
 *
 *  1. Se escribe un codigo (Enter / Agregar) o se pegan varios: la BUSQUEDA COLECTIVA, porque
 *     Famisanar o Salud Total devuelven UN radicado para 10 incapacidades.
 *  2. `POST /radicacion/buscar` dice de cada una si se puede radicar, si ya tenia radicado
 *     (volver a radicar = correccion) o si el codigo base casa con varias (base y base-2).
 *  3. Se marcan las que van, se digita el radicado una sola vez y se guarda en lote.
 *
 * La lista es de TRABAJO: se va armando con varias busquedas y de ella salen las que quedaron
 * guardadas; las que fallaron se quedan con su motivo para corregir y reintentar.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../../../shared/components/tabla-estandar';
import type {
  CodigoEncontrado,
  IncapacidadRef,
  ModoBusquedaRadicacion,
  ResultadoAsignacionRadicado,
  ResultadoBusquedaCodigos,
} from '../../../../models/incapacidad-salud.model';
import { IncapacidadSaludService } from '../../../../services/incapacidad-salud/incapacidad-salud.service';
import { codigoSinGuion } from '../../../../utils/codigos';
import {
  DatosRadicado,
  MAX_CODIGOS_POR_BUSQUEDA,
  aFechaLocal,
  codigoVisible,
  confirmarRadicado,
  entidadDe,
  etiquetaDonde,
  fechaCorta,
  fusionarEncontrados,
  marcadaPorDefecto,
  mensajeError,
  periodo,
  separarCodigos,
  tonoEstado,
} from '../../radicacion.utils';
import { FormularioRadicadoComponent } from '../formulario-radicado/formulario-radicado.component';
import { ResultadoRadicadoComponent } from '../resultado-radicado/resultado-radicado.component';

/** Aviso de una fila de la lista de trabajo. */
export interface AvisoFila {
  tono: 'ok' | 'info' | 'aviso' | 'peligro';
  icono: string;
  texto: string;
}

@Component({
  selector: 'app-panel-codigos-radicado',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
    FormularioRadicadoComponent,
    ResultadoRadicadoComponent,
  ],
  templateUrl: './panel-codigos.component.html',
  styleUrls: [
    '../../../gestion-incapacidades.comun.css',
    '../../radicacion.comun.css',
    './panel-codigos.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelCodigosComponent {
  private readonly srv = inject(IncapacidadSaludService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formulario = viewChild(FormularioRadicadoComponent);

  /** RADICACION = radicado inicial (o su correccion); RECOBRO = un radicado mas tras la negacion. */
  readonly modo = input<ModoBusquedaRadicacion>('RADICACION');
  /** Se emite cuando al menos una quedo guardada: la pantalla recarga sus listados. */
  readonly guardado = output<ResultadoAsignacionRadicado>();

  readonly maxCodigos = MAX_CODIGOS_POR_BUSQUEDA;

  // ── Entrada ───────────────────────────────────────────────────────────
  readonly codigo = signal('');
  readonly pegarAbierto = signal(false);
  readonly textoPegado = signal('');
  readonly codigosPegados = computed(() => separarCodigos(this.textoPegado()));

  // ── Lista de trabajo ──────────────────────────────────────────────────
  readonly encontrados = signal<CodigoEncontrado[]>([]);
  readonly noEncontrados = signal<string[]>([]);
  /** Ids de incapacidad marcados (la casilla de una fila que no se puede radicar va deshabilitada). */
  readonly marcados = signal<ReadonlySet<number>>(new Set());
  /** Motivo del ultimo intento fallido, por incapacidad: se ve en su fila. */
  readonly erroresGuardado = signal<ReadonlyMap<number, string>>(new Map());

  readonly buscando = signal(false);
  readonly guardando = signal(false);
  readonly errorBusqueda = signal('');
  readonly resultado = signal<ResultadoAsignacionRadicado | null>(null);
  readonly numeroGuardado = signal<string | null>(null);

  readonly esRecobro = computed(() => this.modo() === 'RECOBRO');
  readonly filasMarcadas = computed(() => {
    const m = this.marcados();
    return this.encontrados().filter((e) => m.has(e.incapacidad.id));
  });
  readonly cantidadMarcadas = computed(() => this.filasMarcadas().length);
  readonly listas = computed(() => this.encontrados().filter(marcadaPorDefecto).length);
  readonly noSePueden = computed(() => this.encontrados().filter((e) => !e.puedeRadicar).length);
  readonly ambiguas = computed(() => this.encontrados().filter((e) => e.puedeRadicar && e.ambiguo).length);
  /** Solo en Radicacion: marcadas que ya tenian radicado (guardar reemplaza el numero). */
  readonly correcciones = computed(() =>
    this.esRecobro() ? [] : this.filasMarcadas().filter((e) => e.yaRadicada),
  );
  readonly bloqueo = computed(() => {
    const n = this.cantidadMarcadas();
    return n > MAX_CODIGOS_POR_BUSQUEDA
      ? `Máximo ${MAX_CODIGOS_POR_BUSQUEDA} por guardado: desmarque ${n - MAX_CODIGOS_POR_BUSQUEDA}.`
      : null;
  });

  readonly fechaCorta = fechaCorta;
  readonly etiquetaDonde = etiquetaDonde;
  readonly idFila = (e: CodigoEncontrado) => e.incapacidad.id;
  readonly claseFila = (e: CodigoEncontrado): string => {
    if (this.erroresGuardado().has(e.incapacidad.id)) return 'te-fila--peligro';
    if (!e.puedeRadicar) return 'te-fila--atenuada';
    if (e.ambiguo || (!this.esRecobro() && e.yaRadicada)) return 'te-fila--alerta';
    return '';
  };

  readonly columnas = computed<ColumnaTabla<CodigoEncontrado>[]>(() => [
    {
      id: 'marca', header: this.esRecobro() ? 'Recobrar' : 'Radicar', align: 'center', ancho: '84px',
      interactiva: true, copiable: false, filtrable: false, ordenable: false, tarjeta: 'badge',
      valor: (e) => (this.marcados().has(e.incapacidad.id) ? 'Sí' : 'No'),
    },
    { id: 'codigo', header: 'Código', tarjeta: 'subtitulo', minAncho: '150px', valor: (e) => codigoVisible(e.incapacidad) },
    { id: 'cedula', header: 'Cédula', tarjeta: 'meta', valor: (e) => e.incapacidad.cedula },
    { id: 'nombre', header: 'Nombre', tarjeta: 'titulo', minAncho: '190px', valor: (e) => e.incapacidad.nombreCompleto },
    { id: 'entidad', header: 'EPS / entidad', prioridad: 2, tarjeta: 'meta', valor: (e) => entidadDe(e.incapacidad) },
    { id: 'tipo', header: 'Tipo', prioridad: 3, tarjeta: 'meta', valor: (e) => e.incapacidad.tipoIncapacidadEtiqueta ?? '' },
    {
      id: 'periodo', header: 'Inicio – fin', prioridad: 2, tarjeta: 'meta', minAncho: '170px',
      valor: (e) => aFechaLocal(e.incapacidad.fechaInicio), formato: (e) => periodo(e.incapacidad),
    },
    { id: 'dias', header: 'Días', align: 'right', prioridad: 3, tarjeta: 'meta', valor: (e) => e.incapacidad.dias },
    {
      id: 'estado', header: 'Estado', tarjeta: 'badge',
      valor: (e) => e.incapacidad.estadoEtiqueta || e.incapacidad.estado,
      badge: (e) => ({ texto: e.incapacidad.estadoEtiqueta || e.incapacidad.estado, tono: tonoEstado(e.incapacidad.estado) }),
    },
    {
      id: 'radicado', header: this.esRecobro() ? 'Radicado inicial' : 'Radicado actual', prioridad: 2, tarjeta: 'meta',
      valor: (e) => e.incapacidad.numeroRadicado ?? '',
    },
    { id: 'aviso', header: 'Aviso', tarjeta: 'cuerpo', minAncho: '220px', valor: (e) => this.avisoDe(e).texto },
  ]);

  // ── Busqueda ──────────────────────────────────────────────────────────

  /** Enter o "Agregar": el campo admite uno o varios codigos. */
  agregarCodigo(): void {
    const codigos = separarCodigos(this.codigo());
    if (!codigos.length) return;
    this.buscar(codigos, () => this.codigo.set(''));
  }

  /** Si se pega una lista en el campo simple, se pasa al cuadro de "Pegar varios" para revisarla. */
  alPegarEnCampo(evento: ClipboardEvent): void {
    const texto = evento.clipboardData?.getData('text') ?? '';
    if (separarCodigos(texto).length > 1) {
      evento.preventDefault();
      this.textoPegado.set(texto);
      this.pegarAbierto.set(true);
    }
  }

  alternarPegar(): void {
    this.pegarAbierto.update((v) => !v);
  }

  cancelarPegar(): void {
    this.textoPegado.set('');
    this.pegarAbierto.set(false);
  }

  buscarPegados(): void {
    const codigos = this.codigosPegados();
    if (!codigos.length) return;
    this.buscar(codigos, () => this.cancelarPegar());
  }

  /**
   * Trae a la lista incapacidades ya elegidas en otro listado (pendientes por radicar) sin
   * volver a teclear. Se re-consultan por su codigo para tener el estado FRESCO (otra persona
   * pudo radicarla hace un minuto: asi aparece como correccion y no se pisa a ciegas). El codigo
   * general base tambien casa con sus hermanas -2/-3; como aqui el usuario ya eligio la
   * incapacidad exacta, solo entran las elegidas y sin marca de ambiguedad.
   */
  agregarIncapacidades(refs: readonly IncapacidadRef[]): void {
    if (!refs.length) return;
    const ids = new Set(refs.map((r) => r.id));
    this.buscar(
      refs.map((r) => r.codigoUnico),
      undefined,
      (r) => {
        const elegidas = r.encontrados
          .filter((e) => ids.has(e.incapacidad.id))
          .map((e) => ({ ...e, ambiguo: false }));
        const llegaron = new Set(elegidas.map((e) => e.incapacidad.id));
        const faltan = refs.filter((x) => !llegaron.has(x.id)).map((x) => codigoVisible(x));
        return { encontrados: elegidas, noEncontrados: faltan };
      },
    );
  }

  private buscar(
    codigos: string[],
    alTerminar?: () => void,
    ajustar?: (r: ResultadoBusquedaCodigos) => ResultadoBusquedaCodigos,
  ): void {
    if (codigos.length > MAX_CODIGOS_POR_BUSQUEDA) {
      this.errorBusqueda.set(
        `Son ${codigos.length} códigos: busque máximo ${MAX_CODIGOS_POR_BUSQUEDA} a la vez.`,
      );
      return;
    }
    this.errorBusqueda.set('');
    this.buscando.set(true);
    this.srv
      .buscarCodigos(codigos, this.modo())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.buscando.set(false);
          const limpio: ResultadoBusquedaCodigos = { encontrados: r?.encontrados ?? [], noEncontrados: r?.noEncontrados ?? [] };
          this.incorporar(ajustar ? ajustar(limpio) : limpio);
          alTerminar?.();
        },
        error: (e: unknown) => {
          this.buscando.set(false);
          this.errorBusqueda.set(mensajeError(e, 'No se pudieron buscar los códigos. Intente de nuevo.'));
        },
      });
  }

  /**
   * Suma el resultado a la lista. Lo nuevo entra marcado solo si se puede radicar y no es
   * ambiguo; lo que ya estaba conserva la decision del usuario, salvo que ahora ya no se pueda.
   */
  private incorporar(r: ResultadoBusquedaCodigos): void {
    const previos = new Set(this.encontrados().map((e) => e.incapacidad.id));
    const marcados = new Set(this.marcados());
    const errores = new Map(this.erroresGuardado());
    for (const e of r.encontrados) {
      const id = e.incapacidad.id;
      errores.delete(id);
      if (!previos.has(id)) {
        if (marcadaPorDefecto(e)) marcados.add(id);
      } else if (!e.puedeRadicar) {
        marcados.delete(id);
      }
    }
    this.encontrados.set(fusionarEncontrados(this.encontrados(), r.encontrados));
    this.marcados.set(marcados);
    this.erroresGuardado.set(errores);

    // No encontrados: se acumulan sin repetir y sale lo que en esta busqueda si aparecio.
    const hallados = new Set(r.encontrados.map((e) => codigoSinGuion(e.codigo)));
    const lista = [...this.noEncontrados()];
    for (const c of r.noEncontrados) {
      if (!lista.some((x) => codigoSinGuion(x) === codigoSinGuion(c))) lista.push(c);
    }
    this.noEncontrados.set(lista.filter((c) => !hallados.has(codigoSinGuion(c))));
  }

  // ── Seleccion y lista ─────────────────────────────────────────────────

  estaMarcada(e: CodigoEncontrado): boolean {
    return this.marcados().has(e.incapacidad.id);
  }

  alternar(e: CodigoEncontrado, marcar: boolean): void {
    if (!e.puedeRadicar) return;
    const m = new Set(this.marcados());
    if (marcar) m.add(e.incapacidad.id);
    else m.delete(e.incapacidad.id);
    this.marcados.set(m);
  }

  /** Marca las que se pueden radicar sin dudas; las ambiguas se eligen a mano. */
  marcarListas(): void {
    this.marcados.set(new Set(this.encontrados().filter(marcadaPorDefecto).map((e) => e.incapacidad.id)));
  }

  desmarcarTodas(): void {
    this.marcados.set(new Set());
  }

  quitar(e: CodigoEncontrado): void {
    const id = e.incapacidad.id;
    this.encontrados.update((l) => l.filter((x) => x.incapacidad.id !== id));
    this.marcados.update((m) => new Set([...m].filter((x) => x !== id)));
    this.erroresGuardado.update((m) => {
      const copia = new Map(m);
      copia.delete(id);
      return copia;
    });
  }

  /** Con una lista larga se confirma: un clic de mas perderia todo lo que se pego. */
  async vaciarLista(): Promise<void> {
    const n = this.encontrados().length;
    if (n > 3) {
      const r = await Swal.fire({
        icon: 'question',
        title: '¿Vaciar la lista?',
        text: `Se quitan ${n} incapacidades de la lista. No se borra nada en el sistema.`,
        showCancelButton: true,
        confirmButtonText: 'Sí, vaciar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true,
      });
      if (!r.isConfirmed) return;
    }
    this.encontrados.set([]);
    this.marcados.set(new Set());
    this.erroresGuardado.set(new Map());
    this.noEncontrados.set([]);
  }

  quitarNoEncontrado(codigo: string): void {
    this.noEncontrados.update((l) => l.filter((c) => c !== codigo));
  }

  quitarNoEncontrados(): void {
    this.noEncontrados.set([]);
  }

  /** Texto del aviso de la fila: por que no se puede, si es correccion o si es ambigua. */
  avisoDe(e: CodigoEncontrado): AvisoFila {
    const error = this.erroresGuardado().get(e.incapacidad.id);
    if (error) return { tono: 'peligro', icono: 'error', texto: `No se guardó: ${error}` };
    if (!e.puedeRadicar) {
      return {
        tono: 'peligro', icono: 'block',
        texto: e.motivo || (this.esRecobro() ? 'No admite recobro.' : 'No se puede radicar.'),
      };
    }
    if (e.ambiguo) {
      return { tono: 'aviso', icono: 'call_split', texto: 'El código corresponde a varias incapacidades: marque la que corresponde.' };
    }
    if (!this.esRecobro() && e.yaRadicada) {
      const actual = e.incapacidad.numeroRadicado;
      return {
        tono: 'aviso', icono: 'edit_note',
        texto: `${actual ? `Ya tiene el radicado ${actual}` : 'Ya estaba radicada'}: guardar lo reemplaza (corrección).`,
      };
    }
    return this.esRecobro()
      ? { tono: 'ok', icono: 'check_circle', texto: 'Lista para el recobro.' }
      : { tono: 'ok', icono: 'check_circle', texto: 'Lista para radicar.' };
  }

  codigoGeneral(e: CodigoEncontrado): string {
    return codigoSinGuion(e.incapacidad.codigoUnico);
  }

  // ── Guardado ──────────────────────────────────────────────────────────

  /** Confirma (advirtiendo las correcciones) y guarda el mismo radicado en todas las marcadas. */
  async guardar(datos: DatosRadicado): Promise<void> {
    const filas = this.filasMarcadas();
    if (!filas.length || this.guardando() || this.bloqueo()) return;
    const confirmado = await confirmarRadicado({
      modo: this.modo(),
      datos,
      cantidad: filas.length,
      correcciones: this.correcciones().map((e) => codigoVisible(e.incapacidad)),
    });
    if (!confirmado) return;

    this.guardando.set(true);
    const peticion = { incapacidadIds: filas.map((e) => e.incapacidad.id), ...datos };
    const llamada = this.esRecobro() ? this.srv.registrarRecobro(peticion) : this.srv.asignarRadicado(peticion);
    llamada.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.aplicarResultado(r, datos.numeroRadicado);
      },
      error: (e: unknown) => {
        this.guardando.set(false);
        void Swal.fire({
          icon: 'error',
          title: this.esRecobro() ? 'No se pudo registrar el recobro' : 'No se pudo guardar el radicado',
          text: mensajeError(e, 'Intente de nuevo en un momento.'),
        });
      },
    });
  }

  /** Las guardadas salen de la lista; las fallidas se quedan marcadas y con su motivo. */
  private aplicarResultado(r: ResultadoAsignacionRadicado, numero: string): void {
    const resultados = r?.resultados ?? [];
    const okIds = new Set(resultados.filter((x) => x.ok).map((x) => x.incapacidadId));
    const errores = new Map(this.erroresGuardado());
    for (const x of resultados) {
      if (x.ok) errores.delete(x.incapacidadId);
      else errores.set(x.incapacidadId, x.mensaje || 'Error sin detalle');
    }
    this.encontrados.update((l) => l.filter((e) => !okIds.has(e.incapacidad.id)));
    this.marcados.update((m) => new Set([...m].filter((id) => !okIds.has(id))));
    this.erroresGuardado.set(errores);
    this.resultado.set(r);
    this.numeroGuardado.set(numero);
    if (okIds.size > 0) {
      this.formulario()?.reiniciar();
      this.guardado.emit(r);
    }
  }
}
