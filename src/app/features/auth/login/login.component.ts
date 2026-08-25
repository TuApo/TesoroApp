import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import {
  AbstractControl, FormBuilder, FormGroup,
  ValidationErrors, Validators
} from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { LoginService } from '../service/login.service';
import { SharedModule } from '../../../shared/shared.module';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { setLocalStorageItem } from '../../../core/utils/safe-storage';
import { OfflineSyncService } from '../../../core/services/offline-sync.service';
import { CatalogPreloadService } from '../../../core/services/catalog-preload.service';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import {
  CredencialesGuardadas, ErrorAccesoRapido, EstadoAccesoRapido, MetodoAcceso,
  QuickAccessService,
} from '../../../core/security/quick-access.service';
import {
  DatosSetupAcceso, QuickAccessSetupComponent, ResultadoSetupAcceso,
} from '../../../shared/components/quick-access/quick-access-setup.component';
import {
  DatosUnlockAcceso, QuickAccessUnlockComponent,
} from '../../../shared/components/quick-access/quick-access-unlock.component';

interface AppRelease {
  version: string;
  filename: string;
  url: string;
  releaseDate: string;
  sizeMB: number;
  apkFilename?: string;
  apkUrl?: string;
  apkSizeMB?: number;
}

type Vista = 'login' | 'solicitar-otp' | 'verificar-otp' | 'nueva-contrasena';

function emailOrDocValidator(control: AbstractControl): ValidationErrors | null {
  const v: string = (control.value || '').toString().trim();
  if (!v) return { required: true };
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isDoc = /^\d{4,30}$/.test(v);
  return isEmail || isDoc ? null : { emailOrDoc: true };
}

function passwordStrengthValidator(control: AbstractControl): ValidationErrors | null {
  const v: string = control.value || '';
  if (v.length < 12) return { minLength: true };
  let hasLower = false, hasUpper = false, hasDigit = false, hasSymbol = false;
  for (const c of v) {
    if (c >= 'a' && c <= 'z') hasLower = true;
    else if (c >= 'A' && c <= 'Z') hasUpper = true;
    else if (c >= '0' && c <= '9') hasDigit = true;
    else hasSymbol = true;
  }
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  return classes >= 3 ? null : { passwordStrength: true };
}

/**
 * Nombre para saludar en la pantalla de desbloqueo. El backend devuelve el
 * usuario con formas distintas según el endpoint (`datos_basicos.nombres`,
 * `primer_nombre`…), así que se prueban en orden y se cae al login.
 */
function nombreVisible(user: any, login: string): string {
  const compuesto = [user?.datos_basicos?.nombres, user?.datos_basicos?.apellidos]
    .filter(Boolean).join(' ').trim();
  if (compuesto) return compuesto;

  const legacy = [user?.primer_nombre, user?.primer_apellido]
    .filter(Boolean).join(' ').trim();
  if (legacy) return legacy;

  return (login.includes('@') ? login.split('@')[0] : login) || 'usuario';
}

function passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
  const pass = group.get('password')?.value;
  const confirm = group.get('confirmar')?.value;
  return pass && confirm && pass !== confirm ? { passwordsMismatch: true } : null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-login',
  imports: [SharedModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  private http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly qa = inject(QuickAccessService);

  // ── Acceso rápido ────────────────────────────────────────────────────────
  /** Registro guardado en ESTE dispositivo, si lo hay. */
  readonly accesoRapido = signal<EstadoAccesoRapido | null>(null);
  /** El navegador permite guardado cifrado (hay IndexedDB + WebCrypto). */
  readonly accesoRapidoPosible = signal(false);
  /** Métodos que este dispositivo puede ofrecer al activar. */
  private metodosDisponibles: MetodoAcceso[] = [];
  private etiquetaBiometria = '';
  desbloqueando = signal(false);

  // ── Login ────────────────────────────────────────────────────────────────
  loginForm!: FormGroup;
  hide = true;
  loading = false;
  desktopRelease = signal<AppRelease | null>(null);

  // ── OTP recovery ─────────────────────────────────────────────────────────
  vista = signal<Vista>('login');
  otpLoading = signal(false);

  otpRequestForm!: FormGroup;
  otpVerifyForm!: FormGroup;
  newPasswordForm!: FormGroup;
  hideNewPwd = true;
  hideConfirmPwd = true;

  /** Email enmascarado devuelto por solicitar-otp (ej: j***n@empresa.com) */
  correoEnmascarado = signal('');
  /** Login ingresado en solicitar-otp (se reutiliza en verificar-otp) */
  private loginGuardado = '';
  /** Token de reset devuelto por verificar-otp */
  private resetToken = '';

  constructor(
    private fb: FormBuilder,
    private loginS: LoginService,
    private router: Router,
    private offlineSync: OfflineSyncService,
    private catalogPreload: CatalogPreloadService,
  ) {}

  ngOnInit(): void {
    this.loginForm = this.fb.group({
      login: ['', [Validators.required, emailOrDocValidator]],
      password: ['', [Validators.required]],
      // "Recordarme": no guarda nada por sí solo, solo fuerza la propuesta de
      // acceso rápido tras un login correcto.
      recordar: [false],
    });

    this.otpRequestForm = this.fb.group({
      login: ['', [Validators.required, emailOrDocValidator]],
    });

    this.otpVerifyForm = this.fb.group({
      codigo: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });

    this.newPasswordForm = this.fb.group({
      password: ['', [Validators.required, passwordStrengthValidator]],
      confirmar: ['', [Validators.required]],
    }, { validators: passwordsMatchValidator });

    this.http.get<AppRelease>('/downloads/latest.json').subscribe({
      next: r => this.desktopRelease.set(r),
      error: () => {},
    });

    void this.prepararAccesoRapido();
  }

  /**
   * Consulta si hay un acceso guardado en este dispositivo y qué métodos
   * soporta. Nunca lanza: si algo falla, el login normal sigue intacto.
   */
  private async prepararAccesoRapido(): Promise<void> {
    try {
      const posible = await this.qa.disponible();
      this.accesoRapidoPosible.set(posible);
      if (!posible) return;

      const estado = await this.qa.cargarEstado();
      this.accesoRapido.set(estado);

      this.metodosDisponibles = await this.qa.metodosDisponibles();
      this.etiquetaBiometria = (await this.qa.soporteBiometrico()).etiqueta;
    } catch {
      this.accesoRapidoPosible.set(false);
    }
  }

  descargarEscritorio(): void {
    const r = this.desktopRelease();
    if (!r) return;
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.filename;
    a.click();
  }

  descargarAndroid(): void {
    const r = this.desktopRelease();
    if (!r?.apkUrl) return;
    const a = document.createElement('a');
    a.href = r.apkUrl;
    a.download = r.apkFilename ?? 'GestionTesoreria.apk';
    a.click();
  }

  async onSubmit(): Promise<void> {
    if (this.loginForm.invalid || this.loading) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.loginForm.patchValue({
      login: (this.loginForm.value.login || '').toString().trim(),
      password: (this.loginForm.value.password || '').toString().trim(),
    });

    const { login, password } = this.loginForm.value;

    if (login === 'thisisatestaccount@test.com' && password === 'thisisatestaccount23#') {
      setLocalStorageItem('token', 'testToken');
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
      setLocalStorageItem('user', JSON.stringify(testUser));
      this.offlineSync.syncNow().catch(() => null);
      this.router.navigate(['/dashboard']);
      return;
    }

    await this.autenticar(login, password, 'formulario');
  }

  /**
   * Camino único de autenticación, venga del formulario o del acceso rápido.
   * `origen` solo cambia dos cosas: si se ofrece guardar el acceso al terminar,
   * y qué hacer cuando el servidor rechaza las credenciales.
   */
  private async autenticar(
    login: string,
    password: string,
    origen: 'formulario' | 'acceso-rapido',
  ): Promise<void> {
    this.loading = true;
    try {
      const resp = await this.loginS.login(login, password);
      if (!resp?.token || !resp?.user) {
        throw new Error('Respuesta inválida del servidor');
      }
      setLocalStorageItem('token', resp.token);
      setLocalStorageItem('user', JSON.stringify(resp.user));
      const rolNombre = resp.user?.rol?.nombre ?? '';

      this.offlineSync.syncNow().catch(() => null);
      // La parametrización se baja tras entrar (no al arrancar la app): antes
      // del login no hay token y todos los catálogos responderían 401.
      this.catalogPreload.preload().catch(() => null);

      if (origen === 'formulario') {
        // Se ofrece ANTES de navegar: la contraseña en claro solo existe aquí.
        await this.ofrecerAccesoRapido(login, password, resp.user);
      }

      if (rolNombre === 'SIN-ASIGNAR') {
        this.router.navigate(['']);
        Swal.fire({ icon: 'info', title: 'Sin asignar', text: 'Tu cuenta no tiene un rol asignado.' });
      } else {
        this.router.navigate(['/dashboard']);
      }
    } catch (err) {
      const e = err as HttpErrorResponse;
      const rechazado = e.status === 401 || e.status === 403;

      if (rechazado && origen === 'acceso-rapido') {
        // La contraseña guardada dejó de servir (la cambiaron, o revocaron el
        // usuario). Se borra el registro para no reintentar en bucle.
        await this.qa.olvidar();
        this.accesoRapido.set(null);
        this.loginForm.patchValue({ login, password: '' });
        await Swal.fire({
          icon: 'warning',
          title: 'Tu contraseña cambió',
          text: 'El acceso guardado en este dispositivo ya no es válido. '
            + 'Entra con tu contraseña y vuelve a activarlo.',
        });
      } else if (rechazado) {
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

  // ── Acceso rápido: activar ───────────────────────────────────────────────

  /**
   * Tras un login correcto, propone guardar el acceso en este dispositivo.
   * Se muestra si el usuario marcó "recordarme" o si nunca ha respondido
   * (y no dijo "ahora no" en los últimos 30 días).
   */
  private async ofrecerAccesoRapido(login: string, password: string, user: any): Promise<void> {
    try {
      if (!this.accesoRapidoPosible() || !this.metodosDisponibles.length) return;
      const pidioRecordar = this.loginForm.get('recordar')?.value === true;
      if (!pidioRecordar && !(await this.qa.debeOfrecer())) return;
      if (this.accesoRapido()) return;

      const datos: DatosSetupAcceso = {
        metodos: this.metodosDisponibles,
        etiquetaBiometria: this.etiquetaBiometria,
        etiquetaUsuario: nombreVisible(user, login),
      };

      const eleccion = await firstValueFrom(
        this.dialog.open(QuickAccessSetupComponent, {
          data: datos,
          width: '540px',
          maxWidth: '94vw',
          disableClose: false,
          autoFocus: false,
        }).afterClosed(),
      ) as ResultadoSetupAcceso | null | undefined;

      if (!eleccion) {
        await this.qa.marcarRechazo();
        return;
      }

      await this.qa.guardar(
        eleccion.metodo,
        { login, password },
        { etiqueta: datos.etiquetaUsuario, id: String(user?.numero_de_documento ?? login) },
        eleccion.pin,
      );
      const guardado = this.qa.estado();
      this.accesoRapido.set(guardado);

      // En navegador, si no se concedió almacenamiento persistente, hay que
      // decirlo: el propio navegador puede desalojar los datos sin avisar.
      const aviso = guardado && !guardado.persistente
        ? ' Nota: tu navegador podría borrar estos datos si se queda sin espacio; '
          + 'si pasa, entra con tu contraseña y vuelve a activarlo.'
        : '';

      await Swal.fire({
        icon: 'success',
        title: 'Acceso rápido activado',
        text: this.textoConfirmacion(eleccion.metodo) + aviso,
        timer: aviso ? 6000 : 3200,
        showConfirmButton: false,
      });
    } catch (e) {
      const err = e as ErrorAccesoRapido;
      // Nunca bloquea el login: si no se pudo guardar, se entra igual.
      await Swal.fire({
        icon: 'info',
        title: 'No se pudo activar el acceso rápido',
        text: err?.message || 'Puedes intentarlo luego desde Configuración → Cuenta.',
        timer: 4000,
        showConfirmButton: false,
      });
    }
  }

  private textoConfirmacion(metodo: MetodoAcceso): string {
    switch (metodo) {
      case 'biometria':
        return 'La próxima vez entra con tu huella o rostro desde este dispositivo.';
      case 'pin':
        return 'La próxima vez entra con tu PIN desde este dispositivo.';
      default:
        return 'La próxima vez entra con un solo toque desde este dispositivo.';
    }
  }

  // ── Acceso rápido: usar ──────────────────────────────────────────────────

  /** Desbloquea con el método guardado y entra sin escribir la contraseña. */
  async desbloquearAccesoRapido(): Promise<void> {
    const estado = this.accesoRapido();
    if (!estado || this.desbloqueando() || this.loading) return;

    this.desbloqueando.set(true);
    try {
      let credenciales: CredencialesGuardadas | null = null;

      if (estado.metodo === 'pin') {
        const datos: DatosUnlockAcceso = {
          etiquetaUsuario: estado.etiquetaUsuario,
          loginEnmascarado: estado.loginEnmascarado,
          intentosRestantes: estado.intentosRestantes,
        };
        credenciales = (await firstValueFrom(
          this.dialog.open(QuickAccessUnlockComponent, {
            data: datos,
            width: '380px',
            maxWidth: '94vw',
            autoFocus: false,
          }).afterClosed(),
        )) as CredencialesGuardadas | null;
      } else {
        credenciales = await this.qa.desbloquear();
      }

      // Refrescamos el estado: el diálogo pudo consumir intentos o autodestruirse.
      this.accesoRapido.set(await this.qa.cargarEstado());

      if (!credenciales) return;
      await this.autenticar(credenciales.login, credenciales.password, 'acceso-rapido');
    } catch (e) {
      const err = e as ErrorAccesoRapido;
      this.accesoRapido.set(await this.qa.cargarEstado());
      if (err?.codigo === 'cancelado') return;
      await Swal.fire({
        icon: err?.codigo === 'bloqueado' ? 'error' : 'warning',
        title: err?.codigo === 'bloqueado' ? 'Acceso rápido bloqueado' : 'No se pudo desbloquear',
        text: err?.message || 'Intenta con tu contraseña.',
      });
    } finally {
      this.desbloqueando.set(false);
    }
  }

  /** Icono Material que representa el método guardado. */
  iconoMetodo(metodo: MetodoAcceso | null): string {
    switch (metodo) {
      case 'biometria': return 'fingerprint';
      case 'pin': return 'pin';
      default: return 'bolt';
    }
  }

  /** Texto del botón de desbloqueo, según el método guardado. */
  textoMetodo(metodo: MetodoAcceso | null): string {
    switch (metodo) {
      case 'biometria': return 'Entrar con huella o rostro';
      case 'pin': return 'Entrar con mi PIN';
      default: return 'Entrar ahora';
    }
  }

  /** Iniciales para el avatar de la tarjeta. */
  inicialesAccesoRapido(): string {
    const partes = (this.accesoRapido()?.etiquetaUsuario || '?').trim().split(/\s+/);
    return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  /** Quita el acceso guardado de este dispositivo (previa confirmación). */
  async olvidarDispositivo(): Promise<void> {
    const estado = this.accesoRapido();
    if (!estado) return;

    const r = await Swal.fire({
      icon: 'question',
      title: '¿Quitar el acceso guardado?',
      text: `Se borrarán de este dispositivo los datos de ${estado.etiquetaUsuario}. `
        + 'Podrás volver a activarlo la próxima vez que entres con tu contraseña.',
      showCancelButton: true,
      confirmButtonText: 'Sí, quitarlo',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!r.isConfirmed) return;

    await this.qa.olvidar();
    this.accesoRapido.set(null);
  }

  // ── OTP: Paso 1 ─ Solicitar código ────────────────────────────────────────

  irARecuperarContrasena(): void {
    this.otpRequestForm.reset();
    this.vista.set('solicitar-otp');
  }

  async onSolicitarOtp(): Promise<void> {
    if (this.otpRequestForm.invalid || this.otpLoading()) {
      this.otpRequestForm.markAllAsTouched();
      return;
    }
    this.otpLoading.set(true);
    const login = (this.otpRequestForm.value.login || '').toString().trim();
    try {
      const resp = await this.loginS.solicitarOtp(login);
      this.loginGuardado = login;
      this.correoEnmascarado.set(resp.correo_enmascarado);
      this.otpVerifyForm.reset();
      this.vista.set('verificar-otp');
    } catch (err) {
      const e = err as HttpErrorResponse;
      const msg = e?.error?.message || 'No se pudo enviar el código. Intenta de nuevo.';
      await Swal.fire({ icon: 'error', title: 'Error', text: msg });
    } finally {
      this.otpLoading.set(false);
    }
  }

  // ── OTP: Paso 2 ─ Verificar código ────────────────────────────────────────

  async onVerificarOtp(): Promise<void> {
    if (this.otpVerifyForm.invalid || this.otpLoading()) {
      this.otpVerifyForm.markAllAsTouched();
      return;
    }
    this.otpLoading.set(true);
    const codigo = (this.otpVerifyForm.value.codigo || '').toString().trim();
    try {
      const resp = await this.loginS.verificarOtp(this.loginGuardado, codigo);
      this.resetToken = resp.reset_token;
      this.newPasswordForm.reset();
      this.vista.set('nueva-contrasena');
    } catch (err) {
      const e = err as HttpErrorResponse;
      if (e.status === 401) {
        await Swal.fire({
          icon: 'error',
          title: 'Código incorrecto',
          text: 'El código ingresado no es válido o ya expiró.',
        });
      } else {
        await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo verificar el código.' });
      }
    } finally {
      this.otpLoading.set(false);
    }
  }

  async reenviarOtp(): Promise<void> {
    if (this.otpLoading()) return;
    this.otpLoading.set(true);
    try {
      const resp = await this.loginS.solicitarOtp(this.loginGuardado);
      this.correoEnmascarado.set(resp.correo_enmascarado);
      this.otpVerifyForm.reset();
      await Swal.fire({ icon: 'success', title: 'Código reenviado', text: 'Revisa tu correo.', timer: 2500, showConfirmButton: false });
    } catch {
      await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo reenviar el código.' });
    } finally {
      this.otpLoading.set(false);
    }
  }

  // ── OTP: Paso 3 ─ Nueva contraseña ────────────────────────────────────────

  async onResetContrasena(): Promise<void> {
    if (this.newPasswordForm.invalid || this.otpLoading()) {
      this.newPasswordForm.markAllAsTouched();
      return;
    }
    this.otpLoading.set(true);
    const nuevaContrasena = this.newPasswordForm.value.password;
    try {
      await this.loginS.resetContrasena(this.resetToken, nuevaContrasena);
      await Swal.fire({
        icon: 'success',
        title: '¡Contraseña actualizada!',
        text: 'Ya puedes iniciar sesión con tu nueva contraseña.',
        confirmButtonText: 'Ir al login',
      });
      this.volverAlLogin();
    } catch (err) {
      const e = err as HttpErrorResponse;
      const msg = e?.error?.message || 'No se pudo restablecer la contraseña.';
      await Swal.fire({ icon: 'error', title: 'Error', text: msg });
    } finally {
      this.otpLoading.set(false);
    }
  }

  // ── Navegación ────────────────────────────────────────────────────────────

  volverAlLogin(): void {
    this.loginGuardado = '';
    this.resetToken = '';
    this.vista.set('login');
  }
}
