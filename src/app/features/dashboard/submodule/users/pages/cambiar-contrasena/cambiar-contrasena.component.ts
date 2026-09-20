import {  Component, OnInit , ChangeDetectionStrategy } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors
} from '@angular/forms';

import { ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { finalize } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';
import { Router } from '@angular/router';
import { CLAVE_CAMBIO_PENDIENTE } from '../../../../../../core/guards/cambio-password.guard';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cambiar-contrasena',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule
],
  templateUrl: './cambiar-contrasena.component.html',
  styleUrls: ['./cambiar-contrasena.component.css']
} )
export class CambiarContrasenaComponent implements OnInit {
  myForm!: FormGroup;
  hideOldPassword = true;
  hideNewPassword = true;
  hideConfirmPassword = true;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private adminService: AdminService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.myForm = this.fb.group(
      {
        oldPassword: ['', Validators.required],
        newPassword: ['', [Validators.required, Validators.minLength(6)]],
        confirmNewPassword: ['', Validators.required]
      },
      { validators: this.passwordsMatchValidator }
    );
  }

  // Enviar formulario
  onSubmit(): void {
    if (this.myForm.invalid) {
      this.myForm.markAllAsTouched();
      return;
    }

    this.trimFormFields();

    const { oldPassword, newPassword } = this.myForm.value;
    this.isSubmitting = true;

    // Llama al endpoint "me" (token en Authorization)
    this.adminService
      .cambiarContrasenaMe(oldPassword, newPassword)
      .pipe(finalize(() => (this.isSubmitting = false)))
      .subscribe({
        next: (res) => {
          // V86: ya puso una clave suya, así que se levanta la retención del guard. El
          // backend también apaga su marca; esto es para no obligar a volver a entrar.
          let retenido = false;
          try {
            retenido = localStorage.getItem(CLAVE_CAMBIO_PENDIENTE) === '1';
            localStorage.removeItem(CLAVE_CAMBIO_PENDIENTE);
          } catch { /* sin storage: nada que levantar */ }

          Swal.fire({
            icon: 'success',
            title: 'Contraseña cambiada',
            text: retenido
              ? 'Listo, ya es su contraseña. Use esta de ahora en adelante para entrar.'
              : (res?.message ||
                 'Tu contraseña ha sido cambiada correctamente. La próxima vez que inicies sesión, utiliza tu nueva contraseña.'),
          }).then(() => { if (retenido) this.router.navigate(['/dashboard']); });
          this.myForm.reset();
        },
        error: (err) => {
          const msg =
            err?.error?.detail ||
            err?.error?.message ||
            err?.message ||
            'Error al cambiar la contraseña. Inténtalo de nuevo.';
          Swal.fire({
            icon: 'error',
            title: 'Error al cambiar la contraseña',
            text: msg
          });
        }
      });
  }

  private trimFormFields(): void {
    Object.keys(this.myForm.controls).forEach((field) => {
      const control = this.myForm.get(field);
      if (control && typeof control.value === 'string') {
        control.setValue(control.value.trim());
      }
    });
  }

  toggleOldPasswordVisibility(): void {
    this.hideOldPassword = !this.hideOldPassword;
  }

  toggleNewPasswordVisibility(): void {
    this.hideNewPassword = !this.hideNewPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.hideConfirmPassword = !this.hideConfirmPassword;
  }

  private passwordsMatchValidator = (group: AbstractControl): ValidationErrors | null => {
    const p1 = group.get('newPassword')?.value;
    const p2 = group.get('confirmNewPassword')?.value;
    if (!p1 || !p2) return null;
    return p1 === p2 ? null : { mismatch: true };
  };

  // (Opcional) Mostrar/ocultar sidebar si lo usas en el layout
  isSidebarHidden = false;
  toggleSidebar(): void {
    this.isSidebarHidden = !this.isSidebarHidden;
  }
}
