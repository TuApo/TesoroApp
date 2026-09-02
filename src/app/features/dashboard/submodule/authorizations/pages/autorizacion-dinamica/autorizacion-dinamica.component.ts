import { ChangeDetectorRef, Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { AutorizacionesService } from '../../services/autorizaciones/autorizaciones.service';
import Swal from 'sweetalert2';
import { ActivatedRoute, Router } from '@angular/router';
import { SharedModule } from '../../../../../../shared/shared.module';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { MatDialog } from '@angular/material/dialog';
import { HistorialDialogComponent } from './historial-dialog/historial-dialog.component';

import { BuscadorPersona } from '../../../treasury/components/buscador-persona/buscador-persona';
import { FichaPersona } from '../../../treasury/components/ficha-persona/ficha-persona';
import {
  ConceptoRegla, Evaluacion, ResultadoBusqueda, TesoreriaApiService,
} from '../../../treasury/service/tesoreria-api.service';

/**
 * Autorización de mercado y de préstamo.
 *
 * <h3>Qué cambió</h3>
 * Esta pantalla decidía sola. Los topes por antigüedad, las ventanas de espera, los meses
 * sin préstamo y el cupo salían de `verificarCondiciones` en el navegador, y el servidor
 * aceptaba cualquier monto: quien tuviera sesión podía autorizar un millón con un POST, y
 * GERENCIA/ADMIN se saltaban hasta la validación local.
 *
 * <p>Ahora el veredicto lo da el servidor y esta pantalla lo <b>muestra</b>. Es el mismo
 * cálculo que respalda la autorización, así que lo que se ve en pantalla es exactamente lo
 * que va a pasar al enviar — antes eran dos lógicas distintas y por eso alguien podía ver
 * «cupo 350.000» y recibir un rechazo.
 *
 * <p>La ficha completa va debajo del formulario: quién es, qué debe, qué ha pedido y en
 * qué estado está cada condición. Antes, un rechazo era un «no se puede» sin explicación y
 * el mostrador acababa llamando por teléfono a tesorería.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-autorizacion-dinamica',
  imports: [SharedModule, BuscadorPersona, FichaPersona],
  templateUrl: './autorizacion-dinamica.component.html',
  styleUrls: ['./autorizacion-dinamica.component.css', '../../../treasury/styles/tesoreria-comun.css'],
})
export class AutorizacionDinamicaComponent implements OnInit {

  myForm!: FormGroup;
  datosOperario: any;
  nombreOperario = '';
  sumaPrestamos = 0;
  showValor = false;
  showCuotas = false;
  celularLabel = 'Número';
  user: any;
  rolUsuario = '';
  correoUsuario = '';
  sede: string | null = null;

  tipoAutorizacion: 'prestamo' | 'mercado' = 'prestamo';

  /** El veredicto del servidor. Es lo que decide si el botón de aprobar está habilitado. */
  evaluacion: Evaluacion | null = null;
  evaluando = false;
  limiteDisponible = 0;

  constructor(
    private fb: FormBuilder,
    private autorizacionesService: AutorizacionesService,
    private tesoreria: TesoreriaApiService,
    private utilityService: UtilityServiceService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.user = this.utilityService.getUser();
    if (this.user) {
      this.rolUsuario = this.user.rol?.nombre ?? '';
      this.correoUsuario = this.user.correo_electronico ?? '';
      this.sede = this.user?.sede?.nombre ?? null;
    }

    this.tipoAutorizacion = this.route.snapshot.data['tipoAutorizacion'] || 'prestamo';

    this.myForm = this.fb.group({
      numero_documento: ['', [Validators.required, Validators.pattern(/^[A-Za-z]?\d+$/)]],
      tipo: [this.tipoAutorizacion === 'mercado' ? 'Mercado' : '', Validators.required],
      valor: ['', [Validators.required, this.currencyValidator.bind(this)]],
      cuotas: ['', [Validators.min(1), Validators.max(this.tipoAutorizacion === 'mercado' ? 2 : 4)]],
      formaPago: [''],
      celular: [''],
    });

    if (this.tipoAutorizacion === 'prestamo') {
      this.myForm.get('formaPago')?.setValidators([Validators.required]);
      this.myForm.get('formaPago')?.valueChanges.subscribe(value => {
        const celularControl = this.myForm.get('celular');
        if (value === 'Daviplata' || value === 'Master') {
          celularControl?.setValidators([Validators.required, Validators.pattern(/^\d{10}$/)]);
        } else {
          celularControl?.clearValidators();
        }
        celularControl?.updateValueAndValidity();
      });
    }

    if (this.tipoAutorizacion === 'mercado') {
      this.showValor = true;
      this.showCuotas = true;
    }

    // Reevaluar al cambiar el monto o las cuotas. El servidor devuelve el veredicto
    // completo, así que el mostrador ve el rechazo mientras teclea y no al enviar.
    this.myForm.get('valor')?.valueChanges.subscribe(() => this.reevaluarConRetraso());
    this.myForm.get('cuotas')?.valueChanges.subscribe(() => this.reevaluarConRetraso());
  }

  get concepto(): ConceptoRegla {
    return this.tipoAutorizacion === 'mercado' ? 'MERCADO' : 'PRESTAMO';
  }

  // ── Búsqueda ──────────────────────────────────────────────────────────────

  /** Llega del buscador inteligente: cédula, nombre o código de contrato. */
  alSeleccionarPersona(p: ResultadoBusqueda): void {
    this.myForm.patchValue({ numero_documento: p.numero_documento });
    this.cargarPersona(p.numero_documento);
  }

  /** Búsqueda directa por documento, para quien pega la cédula y pulsa Enter. */
  async buscarOperario(): Promise<void> {
    this.trimField('numero_documento');
    const doc = this.myForm.value.numero_documento;
    if (!doc) {
      Swal.fire('Falta el documento', 'Escribe o busca la cédula del trabajador.', 'warning');
      this.myForm.markAllAsTouched();
      return;
    }
    this.cargarPersona(doc);
  }

  private cargarPersona(doc: string): void {
    this.evaluando = true;
    this.cdr.markForCheck();

    this.tesoreria.ficha(doc, this.concepto, null, null, this.sede).subscribe({
      next: f => {
        this.evaluando = false;

        if (!f.existe) {
          this.datosOperario = null;
          Swal.fire({ icon: 'error', title: 'No está en tesorería', text: f.mensaje });
          this.cdr.markForCheck();
          return;
        }

        this.datosOperario = { ...f.persona, numero_documento: f.numero_documento };
        this.nombreOperario = f.persona?.nombre ?? '';
        this.sumaPrestamos = f.deuda?.total ?? 0;
        this.evaluacion = f.evaluacion ?? null;
        this.limiteDisponible = this.evaluacion?.cupo_disponible ?? 0;

        this.myForm.get('valor')?.updateValueAndValidity({ emitEvent: false });
        this.cdr.markForCheck();
      },
      error: () => {
        this.evaluando = false;
        this.datosOperario = null;
        Swal.fire('Error de conexión', 'No se pudo consultar al trabajador.', 'error');
        this.cdr.markForCheck();
      },
    });
  }

  // ── Evaluación en vivo ────────────────────────────────────────────────────

  private temporizador: any = null;

  /**
   * Reevalúa tras una pausa al teclear. Sin el retraso, escribir «250000» dispararía seis
   * evaluaciones, cada una con su consulta a ms-hr por las incapacidades.
   */
  private reevaluarConRetraso(): void {
    if (!this.datosOperario) return;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.reevaluar(), 400);
  }

  private reevaluar(): void {
    const doc = this.datosOperario?.numero_documento;
    if (!doc) return;

    const monto = this.montoNumerico();
    const cuotas = Number(this.myForm.value.cuotas) || null;

    this.tesoreria.evaluar(doc, this.concepto, monto || null, cuotas, this.sede).subscribe({
      next: ev => {
        this.evaluacion = ev;
        this.limiteDisponible = ev.cupo_disponible ?? 0;
        this.myForm.get('valor')?.updateValueAndValidity({ emitEvent: false });
        this.cdr.markForCheck();
      },
      error: () => { /* el veredicto firme lo da el envío; un fallo aquí no debe bloquear */ },
    });
  }

  private montoNumerico(): number {
    const crudo = String(this.myForm.value.valor ?? '').replace(/\D/g, '');
    return crudo ? parseInt(crudo, 10) : 0;
  }

  /** True cuando el servidor ya dijo que no. Deshabilita el botón de aprobar. */
  get bloqueadoPorReglas(): boolean {
    return !!this.evaluacion && !this.evaluacion.aprobado;
  }

  get motivoDelBloqueo(): string | null {
    return this.evaluacion?.motivo ?? null;
  }

  get reglasIncumplidas() {
    return (this.evaluacion?.reglas ?? []).filter(r => r.bloquea);
  }

  get advertencias(): string[] {
    return this.evaluacion?.advertencias ?? [];
  }

  // ── Formulario ────────────────────────────────────────────────────────────

  formatCurrencyPipe(value: number): string {
    return Number(value ?? 0).toLocaleString('es-CO');
  }

  formatCurrency(event: any): void {
    const input = event.target;
    let value = input.value.replace(/\D/g, '');
    value = Number(value).toLocaleString('es-CO');
    input.value = value;
    this.myForm.get('valor')?.updateValueAndValidity();
  }

  /**
   * Aviso temprano contra el cupo que devolvió el servidor. No es la validación real —esa
   * la hace el backend al enviar— pero evita que alguien teclee una cifra y descubra que
   * no cabe solo al pulsar el botón.
   */
  currencyValidator(control: AbstractControl) {
    if (!control.value) return { required: true };
    const value = parseInt(String(control.value).replace(/\D/g, ''), 10);
    if (isNaN(value)) return { required: true };
    if (this.limiteDisponible > 0 && value > this.limiteDisponible) return { maxLimite: true };
    return null;
  }

  private trimField(fieldName: string): void {
    const control = this.myForm.get(fieldName);
    if (control && control.value && typeof control.value === 'string') {
      control.setValue(control.value.trim().toUpperCase());
    }
  }

  onTipoChange(event: any): void {
    const tipo = event.value;
    if (tipo === 'Otro' || tipo === 'Dinero' || tipo === 'Mercado' || tipo === 'Anchetas') {
      this.showValor = true;
      this.showCuotas = true;
    } else if (tipo === 'Seguro Funerario') {
      this.showValor = true;
      this.showCuotas = false;
      this.myForm.patchValue({ cuotas: 1 });
    } else {
      this.showValor = false;
      this.showCuotas = false;
    }
  }

  onFormaPagoChange(event: any): void {
    const formaPago = event.value;
    if (formaPago === 'Daviplata') this.celularLabel = 'Número de Daviplata';
    else if (formaPago === 'Master') this.celularLabel = 'Número de tarjeta Master';
    else if (formaPago === 'Efectivo') this.celularLabel = 'Número';
    else this.celularLabel = 'Número de cuenta';
  }

  abrirHistorial(): void {
    if (!this.datosOperario) return;
    const doc = this.datosOperario.numero_documento || this.myForm.value.numero_documento;
    this.dialog.open(HistorialDialogComponent, {
      width: 'min(1100px, 96vw)',
      maxWidth: '96vw',
      height: 'min(720px, 88vh)',
      panelClass: 'historial-dialog-panel',
      data: { numeroDocumento: doc },
    });
  }

  // ── Envío ─────────────────────────────────────────────────────────────────

  async onSubmit(): Promise<void> {
    if (this.myForm.invalid) {
      this.myForm.markAllAsTouched();
      return;
    }

    const formValues = { ...this.myForm.value, valor: this.montoNumerico() };
    const valNumerico = formValues.valor;
    const cuotasAux = Number(this.myForm.value.cuotas) || 1;
    const nombreAutorizador =
      `${this.user?.datos_basicos?.nombres ?? ''} ${this.user?.datos_basicos?.apellidos ?? ''}`.trim()
      || this.correoUsuario;

    // Confirmación cuando el servidor va a dejar pasar por excepción de rol. Antes esto
    // ocurría en silencio: ni se avisaba ni quedaba registrado en ninguna parte.
    if (this.evaluacion?.con_excepcion_de_rol) {
      const { isConfirmed } = await Swal.fire({
        icon: 'warning',
        title: 'Se autorizará por excepción',
        html: `<p style="text-align:left;font-size:13.5px;color:#5c6660">
                 Tu rol <b>${this.evaluacion.rol_excepcion}</b> permite pasar por encima del
                 tope. La operación quedará marcada como excepción y con tu nombre.
               </p>`,
        showCancelButton: true,
        confirmButtonText: 'Autorizar igualmente',
        cancelButtonText: 'Volver',
        confirmButtonColor: '#8a6420',
      });
      if (!isConfirmed) return;
    }

    Swal.fire({
      title: 'Procesando…',
      icon: 'info',
      text: 'Generando la autorización…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => { Swal.showLoading(); },
    });

    try {
      // El servidor evalúa otra vez antes de crear la transacción: es el único punto donde
      // el veredicto es firme.
      const response: any = await this.autorizacionesService.autorizarTransaccion(
        formValues.numero_documento,
        valNumerico,
        cuotasAux,
        formValues.tipo,
        nombreAutorizador,
        this.sede ?? '',
        // Cómo se va a pagar. Se pedía desde siempre en el formulario, se imprimía en el
        // PDF y se descartaba: 0 de las 4.077 filas creadas desde marzo lo tienen.
        formValues.formaPago || null,
        formValues.celular || null,
      );

      const codigoOH = response.codigo_autorizacion || 'GENERIC-' + Math.floor(Math.random() * 1000000);

      await this.autorizacionesService.generatePdf(
        this.datosOperario,
        valNumerico,
        this.formatCurrencyPipe(valNumerico),
        formValues.formaPago || 'N/A',
        formValues.celular || 'N/A',
        codigoOH,
        String(cuotasAux),
        this.tipoAutorizacion === 'prestamo' ? 'Prestamo' : 'Mercado',
        nombreAutorizador,
      );

      Swal.close();

      const vence = response.vence_en
        ? `<p style="font-size:13px;color:#5c6660;margin-top:8px">
             Vence el ${new Date(response.vence_en).toLocaleDateString('es-CO')}
             si no se recoge.</p>`
        : '';

      Swal.fire({
        icon: 'success',
        title: '¡Listo!',
        html: `Autorización aprobada.<br><b>${codigoOH}</b>${vence}`,
        confirmButtonText: 'Aceptar',
      }).then(() => {
        const currentUrl = this.router.url;
        this.router.navigateByUrl('/dashboard', { skipLocationChange: true })
          .then(() => this.router.navigate([currentUrl]));
      });

    } catch (error: any) {
      Swal.close();
      this.mostrarRechazo(error);
    }
  }

  /**
   * Explica el rechazo del servidor. El backend devuelve qué reglas fallaron y con qué
   * cifras; mostrar solo «no se pudo» desperdiciaría esa información y devolvería al
   * mostrador a llamar por teléfono.
   */
  private mostrarRechazo(error: any): void {
    const cuerpo = error?.error ?? {};
    const reglas: any[] = cuerpo.reglas_incumplidas ?? [];

    if (reglas.length) {
      const lista = reglas
        .map(r => `<li style="margin-bottom:6px"><b>${r.nombre}</b><br>
                     <span style="color:#5c6660">${r.mensaje}</span></li>`)
        .join('');
      const cupo = cuerpo.cupo_disponible != null
        ? `<p style="font-size:13px;color:#5c6660;margin-top:10px">
             Cupo disponible: <b>$${this.formatCurrencyPipe(cuerpo.cupo_disponible)}</b>
             · Tope $${this.formatCurrencyPipe(cuerpo.tope_aplicado)}
             · Ya debe $${this.formatCurrencyPipe(cuerpo.saldo_pendiente)}</p>`
        : '';
      Swal.fire({
        icon: 'error',
        title: 'No se puede autorizar',
        html: `<ul style="text-align:left;padding-left:18px;margin:0">${lista}</ul>${cupo}`,
        confirmButtonText: 'Entendido',
      });
      // El veredicto que trae el rechazo es más fresco que el que había en pantalla.
      this.reevaluar();
      return;
    }

    Swal.fire({
      icon: 'error',
      title: 'No se pudo autorizar',
      text: cuerpo.error ?? cuerpo.detail ?? 'Ocurrió un problema. Intenta de nuevo.',
      confirmButtonText: 'Aceptar',
    });
  }

  /**
   * Vuelve al paso de búsqueda. No basta con `myForm.reset()`: en mercado el concepto se
   * preselecciona en ngOnInit y un reset lo dejaría vacío y en estado inválido, con el
   * select mostrando la única opción posible sin elegir.
   */
  cancelar(): void {
    this.datosOperario = null;
    this.evaluacion = null;
    this.myForm.reset({
      numero_documento: '',
      tipo: this.tipoAutorizacion === 'mercado' ? 'Mercado' : '',
      valor: '',
      cuotas: '',
      formaPago: '',
      celular: '',
    });
    this.nombreOperario = '';
    this.sumaPrestamos = 0;
    this.limiteDisponible = 0;
    this.showValor = this.tipoAutorizacion === 'mercado';
    this.showCuotas = this.tipoAutorizacion === 'mercado';
    this.cdr.markForCheck();
  }
}
