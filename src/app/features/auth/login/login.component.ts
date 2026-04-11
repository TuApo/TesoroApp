import {  Component, OnInit , ChangeDetectionStrategy } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { LoginService } from '../service/login.service';
import { SharedModule } from '../../../shared/shared.module';
import { HttpErrorResponse } from '@angular/common/http';

function emailOrDocValidator(control: AbstractControl): ValidationErrors | null {
  const v: string = (control.value || '').toString().trim();
  if (!v) return { required: true };
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isDoc = /^\d{4,30}$/.test(v); // ajusta rango si lo necesitas
  return isEmail || isDoc ? null : { emailOrDoc: true };
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-login',
  imports: [SharedModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
} )
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  hide = true;
  loading = false;

  constructor(
    private fb: FormBuilder,
    private loginS: LoginService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loginForm = this.fb.group({
      login: ['', [Validators.required, emailOrDocValidator]],
      password: ['', [Validators.required]],
    });
  }

  async onSubmit(): Promise<void> {
    if (this.loginForm.invalid || this.loading) {
      this.loginForm.markAllAsTouched();
      return;
    }
    // quitar espacios
    this.loginForm.patchValue({
      login: (this.loginForm.value.login || '').toString().trim(),
      password: (this.loginForm.value.password || '').toString().trim(),
    });

    const { login, password } = this.loginForm.value;

    // Cuenta de prueba (si la usas)
    if (login === 'thisisatestaccount@test.com' && password === 'thisisatestaccount23#') {
      localStorage.setItem('token', 'testToken');
      const testUser = {
        numero_de_documento: '1005851505',
        primer_nombre: 'PRUEBA',
        primer_apellido: 'GOOGLE',
        segundo_nombre: '5',
        segundo_apellido: 'Campos',
        correo_electronico: login,
        rol: { nombre: 'ADMIN' },
        sede: { nombre: 'SOACHA' },
        estado_solicitudes: true,
      };
      localStorage.setItem('user', JSON.stringify(testUser));
      this.router.navigate(['/dashboard']);
      return;
    }

    this.loading = true;
    try {
      const resp = await this.loginS.login(login, password); // { token, user }
      if (!resp?.token || !resp?.user) {
        throw new Error('Respuesta inválida del servidor');
      }      // Guarda credenciales
      localStorage.setItem('token', resp.token);
      localStorage.setItem('user', JSON.stringify(resp.user));
      // Redirección según rol (el backend retorna rol como objeto {id, nombre})
      const rolNombre = resp.user?.rol?.nombre ?? '';

      if (rolNombre === 'SIN-ASIGNAR') {
        this.router.navigate(['']);
        Swal.fire({
          icon: 'info',
          title: 'Sin asignar',
          text: 'Tu cuenta no tiene un rol asignado.',
        });
      } else {
        this.router.navigate(['/dashboard']);
      }
    } catch (err) {
      const e = err as HttpErrorResponse;
      if (e.status === 401 || e.status === 403) {
        await Swal.fire({
          icon: 'error',
          title: 'Credenciales inválidas',
          text: 'Correo/documento o contraseña incorrectos.',
        });
      } else {
        await Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'No se pudo iniciar sesión. Verifique su conexión o intente más tarde.',
        });
      }
    } finally {
      this.loading = false;
    }
  }
}
