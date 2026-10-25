import { SharedModule } from '@/app/shared/shared.module';
import { isPlatformBrowser } from '@angular/common';
import {  Component, Inject, PLATFORM_ID , ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { FormGroup, FormBuilder, Validators } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import Swal from 'sweetalert2';
import { AdminService } from '../../../users/services/admin.service';
import { VetadosService } from '../../service/vetados/vetados.service';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { SedeScopeService } from '../../../../../../shared/services/sede-scope/sede-scope.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-banned-report',
  imports: [
    SharedModule
  ],
  templateUrl: './banned-report.component.html',
  styleUrl: './banned-report.component.css'
} )
export class BannedReportComponent {
  reporteForm!: FormGroup;
  sedes: any[] = [];
  /** OnPush: las sedes llegan por HTTP y hay que avisar para que el selector se pinte. */
  private readonly cdr = inject(ChangeDetectorRef);
  username: string = '';  // Usuario actual (reportado por)
  sede: any;  // Sede del usuario
  categorias: number[] = [];  // Array de categorías del 1 al 13

  constructor(
    private fb: FormBuilder,
    private adminService: AdminService,
    private vetadosService: VetadosService,
    private UtilityServiceService: UtilityServiceService,
    private sedeScope: SedeScopeService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {

  }

  isSidebarHidden = false;

  toggleSidebar() {
    this.isSidebarHidden = !this.isSidebarHidden;
  }

  async ngOnInit(): Promise<void> {

    // Inicializar el formulario reactivo
    this.reporteForm = this.fb.group({
      cedula: ['', Validators.required],
      nombre: [{ value: '', disabled: true }],  // Campo de nombre solo lectura
      sede: ['', Validators.required],
      observacion: ['', Validators.required],
      reportadoPor: [{ value: '', disabled: true }],
      centro_costo_carnet: ['', Validators.required],
      fecha_contratacion: [{ value: '', disabled: true }],
    });

    // Escuchar cambios en el campo de cédula con debounceTime
    this.reporteForm.get('cedula')?.valueChanges
      .pipe(
        debounceTime(3000),  // Espera 3 segundos después de que el usuario deje de escribir
        distinctUntilChanged()  // Solo dispara la petición si el valor cambió
      )
      .subscribe(cedula => {
        if (cedula) {
          this.buscarNombre(cedula);
        }
      });

    // Obtener lista de sedes
    (await this.adminService.traerSucursales()).subscribe({
      next: (data: any) => {
        // `/gestion_admin/sedes/` devuelve un ARREGLO plano de sedes; `data.sucursal` era la
        // forma de Django y dejaba el selector siempre vacío. Se aceptan las dos.
        const lista = Array.isArray(data) ? data : (Array.isArray(data?.sucursal) ? data.sucursal : []);
        const sucursales = lista.filter((s: any) => s?.activa !== false && String(s?.nombre ?? '').trim());
        sucursales.sort((a: any, b: any) => String(a?.nombre ?? '').localeCompare(String(b?.nombre ?? '')));  // Ordenar sedes
        this.sedes = sucursales;
        this.cdr.markForCheck();
      },
      error: () => { this.sedes = []; this.cdr.markForCheck(); }
    });

    // Obtener usuario actual y sede
    const user = await this.UtilityServiceService.getUser();
    if (user) {
      this.username = `${user.datos_basicos.nombres} ${user.datos_basicos.apellidos} - ${user.rol.nombre}`;
      this.sede = user.sede.nombre;

      // Asignar el valor del campo 'reportadoPor' en el formulario
      this.reporteForm.patchValue({
        reportadoPor: this.username
      });
      // La sede del reporte se propone con la activa, salvo que sea transversal
      // (ADMINISTRATIVOS, VIRTUAL): entonces hay que elegir la oficina en el formulario.
      if (!this.sedeScope.trabajaDesdeTransversal()) {
        this.reporteForm.patchValue({ sede: this.sede });
      }
    }
  }

  buscarNombre(cedula: string): void {

    this.vetadosService.traerNombreCompletoCandidato(cedula).subscribe(
      (response: any) => {
        const nombreCompleto = response?.nombre_completo || '';

        // Si encuentra el nombre, actualiza el campo de nombre y elimina los errores
        this.reporteForm.patchValue({ nombre: nombreCompleto });
        // colocar el centro de costo carnet en el formulario
        this.reporteForm.patchValue({ centro_costo_carnet: response?.centro_costo_carnet });
        // colopcar fecha_contratacion
        this.reporteForm.patchValue({ fecha_contratacion: response?.fechaContratacion });
        this.reporteForm.get('nombre')?.setErrors(null);  // Elimina el error si existe
        this.reporteForm.get('cedula')?.setErrors(null);  // Elimina cualquier error asociado a la cédula
        this.reporteForm.updateValueAndValidity();  // Actualiza el estado del formulario
      },
      (error: any) => {
        if (error.error.message === "No se encontró el candidato con la cédula proporcionada") {
          // Establece el error en el campo de nombre para invalidar el formulario
          this.reporteForm.get('nombre')?.setErrors({ notFound: true });
          this.reporteForm.get('cedula')?.setErrors({ notFound: true });  // Marca también la cédula como error
          this.reporteForm.updateValueAndValidity();  // Actualiza el estado del formulario

          // Muestra el mensaje de error con SweetAlert
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se encontró el candidato con la cédula proporcionada, habla con contratación para más información, o verifica que la cédula sea correcta',
            confirmButtonText: 'Cerrar'
          });
        }
      }
    );
  }




  async enviarReporte() {
    if (this.reporteForm.valid) {
      const reporte = this.reporteForm.getRawValue();  // Obtener valores del formulario
      // Manda la sede ELEGIDA en el formulario: antes se pisaba con la del usuario y el
      // selector no servía de nada.
      this.vetadosService.enviarReporte(reporte, reporte.sede || this.sede).subscribe(
        response => {
          Swal.fire({
            title: 'Éxito',
            text: 'Reporte enviado exitosamente.',
            icon: 'success', // Ícono de éxito
            confirmButtonText: 'Aceptar'
          });
        },
        error => {
          Swal.fire({
            title: 'Error',
            text: 'Hubo un problema al enviar el reporte.',
            icon: 'error', // Ícono de error
            confirmButtonText: 'Aceptar'
          });
        }
      );
    } else {
      Swal.fire({
        title: 'Formulario Inválido',
        text: 'Por favor, completa todos los campos requeridos.',
        icon: 'warning', // Ícono de advertencia
        confirmButtonText: 'Aceptar'
      });
    }
  }

}
