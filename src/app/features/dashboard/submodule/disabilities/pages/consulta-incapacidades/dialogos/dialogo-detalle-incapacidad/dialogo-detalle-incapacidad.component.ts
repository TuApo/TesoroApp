import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, Subscription } from 'rxjs';
import { saveAs } from 'file-saver';

import {
  AlertaValidacion,
  ArchivoRadicacion,
  DondeRadicado,
  RadicacionIncapacidad,
  RadicarPeticion,
  SoporteRequerido,
  TipoSoporte,
} from '../../../../models/incapacidad-v2.model';
import { IncapacidadV2Service } from '../../../../services/incapacidad-v2/incapacidad-v2.service';
import { calcularEdad, parsearFechaFlexible } from '../../../../utils/fechas';
import { codigoSinGuion } from '../../../../utils/codigos';
import {
  CATALOGOS_RESPALDO,
  COLOR_ESTADO,
  COLOR_ESTADO_DOCUMENTO,
  COLOR_NIVEL_ALERTA,
  COLOR_RESPONSABLE_PAGO,
  ESTILO_CHIP_NEUTRO,
  EstiloChip,
  EventoHistorial,
  ICONO_NIVEL_ALERTA,
  ICONO_SOPORTE,
  IncapacidadResumenExtendido,
  IncapacidadV2Detalle,
  etiquetaDeCatalogo,
} from '../../consulta-incapacidades.model';
import { fechaHoraLegible, fechaLegible } from '../../exportacion-incapacidades';

/** Lo que recibe el dialogo. */
export interface DatosDialogoDetalle {
  id: number;
  /** Fila del listado: se pinta al instante mientras llega el detalle. */
  resumen?: IncapacidadResumenExtendido;
}

/** Lo que devuelve al cerrarse (la pagina ejecuta la accion). */
export interface ResultadoDialogoDetalle {
  accion: 'editar' | 'eliminar' | 'validar' | 'recargar';
}

/** Un dato de la ficha. */
export interface CampoFicha {
  etiqueta: string;
  valor: string;
  /** Ocupa dos columnas (observaciones, diagnostico largo...). */
  ancho?: boolean;
}

/** Un bloque de la ficha. */
export interface GrupoFicha {
  titulo: string;
  icono: string;
  campos: CampoFicha[];
}

/** Un soporte ya preparado para la lista. */
export interface SoporteVista {
  tipo: string;
  etiqueta: string;
  icono: string;
  cargado: boolean;
  obligatorio: boolean;
  nombreArchivo: string;
  url: string;
  subidoEn: string;
}

/** Documento abierto en el visor embebido del dialogo. */
export interface PreviewDocumento {
  titulo: string;
  esImagen: boolean;
  /** blob: URL cruda — para `<img>` y para revocarla al cerrar. */
  crudo: string;
  /** La misma URL bendecida para el `<iframe>` del PDF. */
  url: SafeResourceUrl;
}

const VACIO = '—';

/** Canales de radicacion si el catalogo del backend aun no los envia. */
const DONDES_RESPALDO: { codigo: DondeRadicado; etiqueta: string }[] = [
  { codigo: 'PAGINA', etiqueta: 'Portal web' },
  { codigo: 'CORREO', etiqueta: 'Correo electronico' },
  { codigo: 'PUNTO_FISICO', etiqueta: 'Punto fisico' },
];

/**
 * Ficha completa de una incapacidad.
 *
 * Muestra los datos, la linea de tiempo del historico de estados, los soportes
 * con su enlace de descarga y las alertas del motor de reglas.
 *
 * Degrada con elegancia: mientras llega `GET /Incapacidades/v2/{id}` se pinta lo
 * que ya traia la fila del listado, y si esa peticion falla se sigue mostrando
 * el resumen con un aviso, en vez de dejar el dialogo en blanco.
 */
@Component({
  selector: 'app-dialogo-detalle-incapacidad',
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './dialogo-detalle-incapacidad.component.html',
  styleUrl: './dialogo-detalle-incapacidad.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoDetalleIncapacidadComponent implements OnInit, OnDestroy {
  private readonly srv = inject(IncapacidadV2Service);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizador = inject(DomSanitizer);
  private readonly subs = new Subscription();

  readonly datos = inject<DatosDialogoDetalle>(MAT_DIALOG_DATA);
  readonly ref =
    inject<MatDialogRef<DialogoDetalleIncapacidadComponent, ResultadoDialogoDetalle>>(
      MatDialogRef,
    );

  readonly detalle = signal<IncapacidadV2Detalle | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  private readonly catalogos = computed(
    () => this.srv.catalogosCache() ?? CATALOGOS_RESPALDO,
  );

  // ── Cabecera ──────────────────────────────────────────────────────────

  readonly consecutivo = computed(() => {
    const d = this.detalle();
    // V47: manda el codigo visible de cartera (TASB018); lo demas es respaldo.
    // El codigo tecnico se muestra SIN guion bajo (reunion 2026-08-26).
    return (
      codigoSinGuion(
        d?.codigoConsecutivo ||
          this.datos.resumen?.codigoConsecutivo ||
          d?.codigoUnico ||
          this.datos.resumen?.codigoUnico ||
          this.datos.resumen?.consecutivoSistema ||
          '',
      ) || `#${this.datos.id}`
    );
  });

  readonly nombreTrabajador = computed(() => {
    const d = this.detalle();
    return d?.nombreCompleto || this.datos.resumen?.nombreCompleto || VACIO;
  });

  readonly cedulaTrabajador = computed(() => {
    const d = this.detalle();
    return d?.cedula || this.datos.resumen?.cedula || VACIO;
  });

  readonly chipEstado = computed(() => {
    const codigo = this.detalle()?.estado ?? this.datos.resumen?.estado ?? '';
    return {
      texto: etiquetaDeCatalogo(this.catalogos().estados, codigo) || VACIO,
      estilo: estiloDe(COLOR_ESTADO, codigo),
    };
  });

  readonly chipEstadoDocumento = computed(() => {
    const codigo = this.detalle()?.estadoDocumento ?? this.datos.resumen?.estadoDocumento ?? '';
    return {
      texto: etiquetaDeCatalogo(this.catalogos().estadosDocumento, codigo) || VACIO,
      estilo: estiloDe(COLOR_ESTADO_DOCUMENTO, codigo),
    };
  });

  readonly chipResponsable = computed(() => {
    const codigo = this.detalle()?.responsablePago ?? this.datos.resumen?.responsablePago ?? '';
    return {
      texto: etiquetaDeCatalogo(this.catalogos().responsablesPago, codigo) || VACIO,
      estilo: estiloDe(COLOR_RESPONSABLE_PAGO, codigo),
    };
  });

  /** Solo se puede promover a VALIDADA desde RECIBIDA. */
  readonly puedeValidar = computed(
    () => (this.detalle()?.estado ?? this.datos.resumen?.estado) === 'RECIBIDA',
  );

  // ── Historico importado (V45) ─────────────────────────────────────────

  readonly esHistorico = computed(() => this.detalle()?.origen === 'HISTORICO');

  /** Link de Drive del documento original (los PDF del historico NO se copiaron). */
  readonly docHistorico = computed(() => this.detalle()?.docExternoUrl ?? '');

  // ── Ficha ─────────────────────────────────────────────────────────────

  readonly grupos = computed<GrupoFicha[]>(() => {
    const d = this.detalle();
    const r = this.datos.resumen;
    const cat = this.catalogos();
    if (!d && !r) return [];

    const edad =
      d?.edad ?? calcularEdad(d?.fechaNacimiento ?? null) ?? null;

    const diagnostico = [d?.codigoDiagnostico ?? r?.codigoDiagnostico, d?.descripcionDiagnostico]
      .filter((x) => !!x)
      .join(' · ');

    const ips = [d?.nitIps, d?.ipsNombre].filter((x) => !!x).join(' · ');

    return [
      {
        titulo: 'Trabajador',
        icono: 'badge',
        campos: [
          { etiqueta: 'Cedula', valor: texto(d?.cedula ?? r?.cedula) },
          { etiqueta: 'Tipo de documento', valor: texto(d?.tipoDocumento) },
          { etiqueta: 'Nombre completo', valor: texto(d?.nombreCompleto ?? r?.nombreCompleto), ancho: true },
          { etiqueta: 'Fecha de nacimiento', valor: fechaLegible(d?.fechaNacimiento) || VACIO },
          { etiqueta: 'Edad', valor: edad === null ? VACIO : `${edad} anios` },
          { etiqueta: 'Genero', valor: texto(d?.sexo) },
          { etiqueta: 'Celular', valor: texto(d?.celular) },
          { etiqueta: 'Correo', valor: texto(d?.correo), ancho: true },
        ],
      },
      {
        titulo: 'Vinculacion',
        icono: 'work',
        campos: [
          { etiqueta: 'Empresa', valor: texto(d?.empresa ?? r?.empresa) },
          { etiqueta: 'Centro de costo', valor: texto(d?.centroCosto ?? r?.centroCosto) },
          { etiqueta: 'Temporal', valor: texto(d?.temporal ?? r?.temporal) },
          { etiqueta: 'Numero de contrato', valor: texto(d?.numeroContrato ?? r?.numeroContrato) },
          { etiqueta: 'Fecha de ingreso', valor: fechaLegible(d?.fechaIngreso) || VACIO },
          { etiqueta: 'Oficina', valor: texto(d?.oficina ?? r?.oficina) },
          { etiqueta: 'EPS', valor: texto(d?.eps ?? r?.eps) },
          { etiqueta: 'Fondo de pension (AFP)', valor: texto(d?.afp ?? r?.afp) },
          { etiqueta: 'ARL', valor: texto(d?.arl) },
        ],
      },
      {
        titulo: 'Incapacidad',
        icono: 'medical_information',
        campos: [
          {
            etiqueta: 'Tipo',
            valor:
              etiquetaDeCatalogo(cat.tiposIncapacidad, d?.tipoIncapacidad ?? r?.tipoIncapacidad) ||
              VACIO,
          },
          { etiqueta: 'Numero de incapacidad', valor: texto(d?.numeroIncapacidad) },
          { etiqueta: 'Diagnostico (CIE-10)', valor: diagnostico || VACIO, ancho: true },
          { etiqueta: 'Fecha de inicio', valor: fechaLegible(d?.fechaInicio ?? r?.fechaInicio) || VACIO },
          { etiqueta: 'Fecha de fin', valor: fechaLegible(d?.fechaFin ?? r?.fechaFin) || VACIO },
          { etiqueta: 'Dias', valor: numero(d?.dias ?? r?.dias) },
          {
            etiqueta: 'Prorroga',
            valor:
              (d?.esProrroga ?? r?.esProrroga) === true
                ? d?.prorrogaDeId
                  ? `Si, de la incapacidad #${d.prorrogaDeId}`
                  : 'Si'
                : 'No',
          },
          { etiqueta: 'IPS', valor: ips || VACIO, ancho: true },
        ],
      },
      {
        titulo: 'Liquidacion',
        icono: 'calculate',
        campos: [
          { etiqueta: 'Dias a cargo de la empresa', valor: numero(d?.diasEmpresa ?? r?.diasEmpresa) },
          { etiqueta: 'Dias a cargo de la entidad', valor: numero(d?.diasEntidad ?? r?.diasEntidad) },
          { etiqueta: 'Entidad responsable', valor: texto(d?.entidadResponsable) },
          {
            etiqueta: 'Responsable de pago',
            valor: this.chipResponsable().texto,
          },
        ],
      },
      {
        titulo: 'Gestion y trazabilidad',
        icono: 'history_edu',
        campos: [
          { etiqueta: 'Estado', valor: this.chipEstado().texto },
          { etiqueta: 'Estado del documento', valor: this.chipEstadoDocumento().texto },
          { etiqueta: 'Recibido por', valor: texto(d?.recibidoPor) },
          { etiqueta: 'Registrado por', valor: texto(d?.creadoPor ?? r?.creadoPor) },
          { etiqueta: 'Fecha de registro', valor: fechaHoraLegible(d?.creadoEn ?? r?.creadoEn) || VACIO },
          { etiqueta: 'Ultima modificacion', valor: fechaHoraLegible(d?.actualizadoEn ?? r?.actualizadoEn) || VACIO },
          { etiqueta: 'Modificado por', valor: texto(d?.actualizadoPor ?? r?.actualizadoPor) },
          { etiqueta: 'Observaciones', valor: texto(d?.observaciones), ancho: true },
        ],
      },
    ];
  });

  // ── Linea de tiempo ───────────────────────────────────────────────────

  /**
   * Historico de estados. Si el backend no envia `historial`, se reconstruye la
   * traza minima con la auditoria (creado/actualizado) y se avisa en la UI para
   * no hacer pasar una reconstruccion por un historico real.
   */
  readonly historial = computed<EventoHistorial[]>(() => {
    const d = this.detalle();
    if (d?.historial?.length) {
      return [...d.historial].sort((a, b) => comparaFechas(a.fecha, b.fecha));
    }

    const eventos: EventoHistorial[] = [];
    const creado = d?.creadoEn ?? this.datos.resumen?.creadoEn;
    if (creado) {
      eventos.push({
        estado: 'RECIBIDA',
        etiqueta: 'Incapacidad registrada',
        fecha: creado,
        usuario: d?.creadoPor ?? this.datos.resumen?.creadoPor ?? '',
      });
    }
    const actualizado = d?.actualizadoEn ?? this.datos.resumen?.actualizadoEn;
    if (actualizado && actualizado !== creado) {
      eventos.push({
        etiqueta: 'Ultima modificacion',
        fecha: actualizado,
        usuario: d?.actualizadoPor ?? '',
      });
    }
    const estadoActual = d?.estado ?? this.datos.resumen?.estado;
    if (estadoActual) {
      eventos.push({
        estado: estadoActual,
        etiqueta: `Estado actual: ${etiquetaDeCatalogo(this.catalogos().estados, estadoActual)}`,
        fecha: actualizado ?? creado,
      });
    }
    return eventos;
  });

  /** `true` cuando la linea de tiempo es una reconstruccion, no el historico. */
  readonly historialReconstruido = computed(() => !this.detalle()?.historial?.length);

  historialEtiqueta(evento: EventoHistorial): string {
    if (evento.etiqueta) return evento.etiqueta;
    return etiquetaDeCatalogo(this.catalogos().estados, evento.estado) || VACIO;
  }

  historialFecha(evento: EventoHistorial): string {
    return fechaHoraLegible(evento.fecha) || VACIO;
  }

  historialColor(evento: EventoHistorial): string {
    return estiloDe(COLOR_ESTADO, evento.estado ?? '').color;
  }

  // ── Soportes ──────────────────────────────────────────────────────────

  readonly soportes = computed<SoporteVista[]>(() => {
    const d = this.detalle();
    const cat = this.catalogos();
    const adjuntos = d?.soportes ?? [];
    const exigidos: SoporteRequerido[] = (d?.validacion?.soportes ?? []).filter((s) => s.visible);

    // Union: lo exigido por las reglas + lo que este adjunto aunque ya no aplique.
    const tipos = new Set<string>();
    exigidos.forEach((s) => tipos.add(s.tipo));
    adjuntos.forEach((s) => tipos.add(s.tipo));

    const vista: SoporteVista[] = [];
    for (const tipo of tipos) {
      const requerido = exigidos.find((s) => s.tipo === tipo);
      const adjunto = adjuntos.find((s) => s.tipo === tipo);
      vista.push({
        tipo,
        etiqueta:
          requerido?.etiqueta ||
          etiquetaDeCatalogo(cat.tiposSoporte, tipo) ||
          tipo,
        icono: ICONO_SOPORTE[tipo as TipoSoporte] ?? 'insert_drive_file',
        cargado: !!adjunto?.fileUrl || requerido?.cargado === true,
        obligatorio: requerido?.obligatorio === true,
        nombreArchivo: adjunto?.nombreArchivo ?? '',
        url: this.srv.urlAbsolutaDocumento(adjunto?.fileUrl),
        subidoEn: fechaHoraLegible(adjunto?.subidoEn),
      });
    }

    return vista.sort((a, b) => Number(b.obligatorio) - Number(a.obligatorio));
  });

  readonly faltanSoportes = computed(() =>
    this.soportes().some((s) => s.obligatorio && !s.cargado),
  );

  // ── Descarga y visor de soportes ──────────────────────────────────────
  //
  // Los archivos viven tras el gateway (`/api/v1/documents/**`), que exige JWT:
  // un `<a href>` plano navegaba sin Authorization y terminaba en 401. Por eso
  // aqui TODO se baja por HttpClient (que si lleva el token) y el resultado se
  // entrega como blob: descarga con `saveAs` o vista previa embebida.

  /** Tipo de soporte que se esta descargando (deshabilita sus botones). */
  readonly descargandoSoporteTipo = signal<string | null>(null);
  readonly errorSoporte = signal('');
  /** Documento abierto en el visor embebido (soporte o PDF de radicacion). */
  readonly preview = signal<PreviewDocumento | null>(null);

  verSoporte(soporte: SoporteVista): void {
    this.traerSoporte(soporte, true);
  }

  descargarSoporte(soporte: SoporteVista): void {
    this.traerSoporte(soporte, false);
  }

  private traerSoporte(soporte: SoporteVista, abrir: boolean): void {
    this.descargandoSoporteTipo.set(soporte.tipo);
    this.errorSoporte.set('');
    this.subs.add(
      this.srv.descargarDocumento(soporte.url).subscribe({
        next: (blob) => {
          this.descargandoSoporteTipo.set(null);
          const nombre = soporte.nombreArchivo || `${soporte.etiqueta}.pdf`;
          if (abrir) this.mostrarPreview(blob, nombre);
          else saveAs(blob, nombre);
        },
        error: (err: unknown) => {
          this.descargandoSoporteTipo.set(null);
          this.errorSoporte.set(
            motivoHttp(err) || `No se pudo descargar ${soporte.etiqueta}.`,
          );
        },
      }),
    );
  }

  /** Abre el visor embebido con el blob (iframe para PDF, `<img>` para imagen). */
  private mostrarPreview(blob: Blob, titulo: string): void {
    this.cerrarPreview();
    const esImagen = blob.type.startsWith('image/');
    // El visor del navegador necesita el MIME correcto; si el backend no lo dio, PDF.
    const conTipo = blob.type ? blob : new Blob([blob], { type: 'application/pdf' });
    const crudo = URL.createObjectURL(conTipo);
    this.preview.set({
      titulo,
      esImagen,
      crudo,
      url: this.sanitizador.bypassSecurityTrustResourceUrl(crudo),
    });
    // El visor queda al final del dialogo: llevar la vista hasta el.
    if (typeof document !== 'undefined') {
      setTimeout(() =>
        document
          .getElementById('det-visor-documento')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
      );
    }
  }

  cerrarPreview(): void {
    const abierto = this.preview();
    if (abierto) URL.revokeObjectURL(abierto.crudo);
    this.preview.set(null);
  }

  // ── Alertas ───────────────────────────────────────────────────────────

  readonly alertas = computed<AlertaValidacion[]>(() => this.detalle()?.validacion?.alertas ?? []);

  colorAlerta(alerta: AlertaValidacion): EstiloChip {
    return COLOR_NIVEL_ALERTA[alerta.nivel] ?? ESTILO_CHIP_NEUTRO;
  }

  iconoAlerta(alerta: AlertaValidacion): string {
    return ICONO_NIVEL_ALERTA[alerta.nivel] ?? 'info';
  }

  // ── Radicacion (V44) ──────────────────────────────────────────────────

  readonly radicacion = signal<RadicacionIncapacidad | null>(null);
  readonly cargandoRadicacion = signal(false);
  readonly errorRadicacion = signal('');
  /** `true` mientras corre una transicion (pendiente/radicar/regenerar). */
  readonly accionRadicacion = signal(false);
  readonly radicarAbierto = signal(false);
  readonly radicarNumero = signal('');
  /** yyyy-MM-dd del input nativo type=date. */
  readonly radicarFecha = signal('');
  readonly radicarDonde = signal<DondeRadicado | ''>('');
  readonly descargandoArchivoId = signal<number | null>(null);
  /** Hubo transicion o radicado: al cerrar, la pagina recarga el listado. */
  private huboCambiosRadicacion = false;

  private readonly estadoActual = computed(
    () => this.detalle()?.estado ?? this.datos.resumen?.estado ?? '',
  );

  /** La seccion solo aplica desde VALIDADA en adelante (o si ya hay archivos). */
  readonly muestraRadicacion = computed(() => {
    const e = this.estadoActual();
    return (
      e === 'VALIDADA' ||
      e === 'PENDIENTE_RADICACION' ||
      e === 'RADICADA' ||
      e === 'EN_REVISION_EPS' ||
      (this.radicacion()?.archivos.length ?? 0) > 0
    );
  });

  readonly puedePasarAPendiente = computed(() => this.estadoActual() === 'VALIDADA');

  readonly puedeRadicar = computed(() => {
    const e = this.estadoActual();
    return e === 'VALIDADA' || e === 'PENDIENTE_RADICACION' || e === 'RADICADA';
  });

  readonly yaRadicada = computed(() => !!this.radicacion()?.numeroRadicado);

  readonly dondesRadicado = computed(() => {
    const delCatalogo = this.srv.catalogosCache()?.dondesRadicado;
    return delCatalogo?.length ? delCatalogo : DONDES_RESPALDO;
  });

  /** Carpeta de cartera: "Apoyo · Semana 3" (o vacio si aun no se clasifica). */
  readonly carpetaCartera = computed(() => {
    const r = this.radicacion();
    if (!r?.entidadGrupoEtiqueta && !r?.semanaRadicacion) return '';
    return [r.entidadGrupoEtiqueta, r.semanaRadicacion ? `Semana ${r.semanaRadicacion}` : '']
      .filter(Boolean)
      .join(' · ');
  });

  private cargarRadicacion(): void {
    this.cargandoRadicacion.set(true);
    this.errorRadicacion.set('');
    this.subs.add(
      this.srv.obtenerRadicacion(this.datos.id).subscribe({
        next: (r) => {
          this.radicacion.set(r);
          this.cargandoRadicacion.set(false);
          this.sembrarFormularioRadicar(r);
        },
        error: () => {
          this.cargandoRadicacion.set(false);
          // Sin aviso ruidoso: con un backend anterior simplemente no hay seccion.
        },
      }),
    );
  }

  private sembrarFormularioRadicar(r: RadicacionIncapacidad): void {
    if (r.numeroRadicado && !this.radicarNumero()) this.radicarNumero.set(r.numeroRadicado);
    if (r.fechaRadicado && !this.radicarFecha()) this.radicarFecha.set(r.fechaRadicado);
    if (r.dondeRadicado && !this.radicarDonde()) this.radicarDonde.set(r.dondeRadicado);
  }

  pasarAPendiente(): void {
    this.ejecutarAccionRadicacion(
      this.srv.pasarAPendienteRadicacion(this.datos.id),
      'No se pudo pasar a pendiente de radicacion.',
    );
  }

  regenerarPaquete(): void {
    this.ejecutarAccionRadicacion(
      this.srv.regenerarRadicacion(this.datos.id),
      'No se pudo regenerar el paquete.',
    );
  }

  abrirRadicar(): void {
    this.radicarAbierto.set(true);
  }

  cancelarRadicar(): void {
    this.radicarAbierto.set(false);
  }

  confirmarRadicar(): void {
    const numero = this.radicarNumero().trim();
    if (!numero) {
      this.errorRadicacion.set('Escribe el numero de radicado que entrego la EPS/ARL.');
      return;
    }
    const peticion: RadicarPeticion = {
      numeroRadicado: numero,
      fechaRadicado: this.radicarFecha() || null,
      dondeRadicado: (this.radicarDonde() || null) as DondeRadicado | null,
    };
    this.ejecutarAccionRadicacion(
      this.srv.radicar(this.datos.id, peticion),
      'No se pudo registrar el radicado.',
      () => this.radicarAbierto.set(false),
    );
  }

  /** Descarga (o abre en el visor embebido) un PDF de radicacion con su nombre EXACTO. */
  descargarArchivoRadicacion(archivo: ArchivoRadicacion, abrir = false): void {
    this.descargandoArchivoId.set(archivo.id);
    this.subs.add(
      this.srv.descargarArchivoRadicacion(this.datos.id, archivo.id).subscribe({
        next: (blob) => {
          this.descargandoArchivoId.set(null);
          const pdf = new Blob([blob], { type: 'application/pdf' });
          if (abrir) {
            this.mostrarPreview(pdf, archivo.nombreArchivo);
          } else {
            saveAs(pdf, archivo.nombreArchivo);
          }
        },
        error: (err: unknown) => {
          this.descargandoArchivoId.set(null);
          this.errorRadicacion.set(
            motivoHttp(err) || `No se pudo descargar ${archivo.nombreArchivo}.`,
          );
        },
      }),
    );
  }

  tamanoArchivo(bytes: number | null): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private ejecutarAccionRadicacion(
    peticion: Observable<RadicacionIncapacidad>,
    mensajeError: string,
    alTerminar?: () => void,
  ): void {
    this.accionRadicacion.set(true);
    this.errorRadicacion.set('');
    this.subs.add(
      peticion.subscribe({
        next: (r) => {
          this.radicacion.set(r);
          this.accionRadicacion.set(false);
          this.huboCambiosRadicacion = true;
          alTerminar?.();
          this.refrescarDetalle();
        },
        error: (err: unknown) => {
          this.accionRadicacion.set(false);
          this.errorRadicacion.set(motivoHttp(err) || mensajeError);
        },
      }),
    );
  }

  /** Tras una transicion el estado y el historial cambiaron: se relee el detalle. */
  private refrescarDetalle(): void {
    this.subs.add(
      this.srv.obtener(this.datos.id).subscribe({
        next: (detalle) => this.detalle.set(detalle as IncapacidadV2Detalle),
        error: () => {
          /* el dialogo ya muestra la radicacion actualizada */
        },
      }),
    );
  }

  trackArchivoRadicacion = (_: number, archivo: ArchivoRadicacion) => archivo.id;

  // ── Ciclo de vida ─────────────────────────────────────────────────────

  ngOnInit(): void {
    this.subs.add(
      this.srv
        .obtener(this.datos.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (detalle) => {
            this.detalle.set(detalle as IncapacidadV2Detalle);
            this.cargando.set(false);
          },
          error: () => {
            this.cargando.set(false);
            this.error.set(
              'No se pudo cargar el detalle completo. Se muestra la informacion del listado.',
            );
          },
        }),
    );
    this.cargarRadicacion();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    // Libera la blob: URL del visor si el dialogo se cierra con el abierto.
    this.cerrarPreview();
  }

  // ── Acciones ──────────────────────────────────────────────────────────

  cerrar(): void {
    // Si hubo transiciones de radicacion, la pagina debe refrescar la tabla.
    this.ref.close(this.huboCambiosRadicacion ? { accion: 'recargar' } : undefined);
  }

  editar(): void {
    this.ref.close({ accion: 'editar' });
  }

  eliminar(): void {
    this.ref.close({ accion: 'eliminar' });
  }

  validar(): void {
    this.ref.close({ accion: 'validar' });
  }

  trackGrupo = (_: number, grupo: GrupoFicha) => grupo.titulo;
  trackCampo = (_: number, campo: CampoFicha) => campo.etiqueta;
  trackSoporte = (_: number, soporte: SoporteVista) => soporte.tipo;
}

// ── Utilidades ──────────────────────────────────────────────────────────

function texto(valor: unknown): string {
  const limpio = valor === null || valor === undefined ? '' : String(valor).trim();
  return limpio || VACIO;
}

function numero(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return VACIO;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return isNaN(n) ? VACIO : String(n);
}

function estiloDe<C extends string>(
  mapa: Readonly<Record<C, EstiloChip>>,
  codigo: string,
): EstiloChip {
  const encontrado = (mapa as Record<string, EstiloChip>)[codigo];
  return encontrado ?? ESTILO_CHIP_NEUTRO;
}

/** Motivo legible de un error HTTP del backend ({"error": "..."}). */
function motivoHttp(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const cuerpo: unknown = err.error;
    if (cuerpo && typeof cuerpo === 'object') {
      const mensaje = (cuerpo as { error?: unknown }).error;
      if (typeof mensaje === 'string' && mensaje.trim()) return mensaje.trim();
    }
    if (typeof cuerpo === 'string' && cuerpo.trim()) {
      try {
        const parseado = JSON.parse(cuerpo) as { error?: unknown };
        if (typeof parseado.error === 'string') return parseado.error;
      } catch {
        /* texto plano */
      }
    }
  }
  return '';
}

function comparaFechas(a?: string, b?: string): number {
  const fa = parsearFechaFlexible(a)?.getTime() ?? new Date(a ?? '').getTime();
  const fb = parsearFechaFlexible(b)?.getTime() ?? new Date(b ?? '').getTime();
  const va = isNaN(fa) ? 0 : fa;
  const vb = isNaN(fb) ? 0 : fb;
  return va - vb;
}
