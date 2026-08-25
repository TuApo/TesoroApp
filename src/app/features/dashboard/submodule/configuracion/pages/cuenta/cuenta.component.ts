import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import Swal from 'sweetalert2';
import { UtilityServiceService } from '../../../../../../shared/services/utilityService/utility-service.service';
import { ProfilePhotoService } from '../../../../../../shared/services/profile-photo/profile-photo.service';
import { setLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import {
  EstadoAccesoRapido, MetodoAcceso, QuickAccessService,
} from '../../../../../../core/security/quick-access.service';
import {
  DatosSetupAcceso, QuickAccessSetupComponent, ResultadoSetupAcceso,
} from '../../../../../../shared/components/quick-access/quick-access-setup.component';
import { LoginService } from '../../../../../auth/service/login.service';

/** Rol del usuario tal como se pinta en la tarjeta de perfil (multi-rol V40). */
interface RolVista {
  nombre: string;
  principal: boolean;
  /** null = sin límite (indefinido). */
  vigenteHasta: Date | null;
  vencido: boolean;
}

interface SedeVista {
  nombre: string;
  principal: boolean;
}

/**
 * Página "Cuenta": datos del usuario logueado + foto de perfil + acceso a
 * cambiar contraseña. La foto se guarda localmente (ver ProfilePhotoService) y
 * se refleja en el menú de perfil del header.
 */
@Component({
  selector: 'app-cuenta-config',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cuenta.component.html',
  styleUrl: './cuenta.component.css',
})
export class CuentaConfigComponent implements OnInit {
  nombre = '';
  documento = '';
  rol = '';
  sede = '';
  correo = '';
  fotoError = '';

  /** Multi-rol / multi-sede (V40): todas las asignaciones, principal primero. */
  rolesVista: RolVista[] = [];
  sedesVista: SedeVista[] = [];

  // ── Acceso rápido en este dispositivo ────────────────────────────────────
  accesoRapido: EstadoAccesoRapido | null = null;
  accesoRapidoPosible = false;
  private metodosAcceso: MetodoAcceso[] = [];
  private etiquetaBiometria = '';

  /** Foto de perfil en vivo (async pipe en la plantilla). */
  readonly foto$: Observable<string | null>;

  /** Límite del lado más largo tras reescalar, en px. */
  private static readonly MAX_SIDE = 256;
  /** Tamaño máximo del archivo original aceptado, en bytes (8 MB). */
  private static readonly MAX_BYTES = 8 * 1024 * 1024;

  constructor(
    private readonly util: UtilityServiceService,
    private readonly router: Router,
    private readonly photos: ProfilePhotoService,
    private readonly cdr: ChangeDetectorRef,
    private readonly qa: QuickAccessService,
    private readonly dialog: MatDialog,
    private readonly loginS: LoginService,
  ) {
    this.foto$ = this.photos.photo$;
  }

  ngOnInit(): void {
    this.photos.reload();
    const user: any = this.util.getUser?.();
    if (!user) return;
    this.nombre = [user?.datos_basicos?.nombres, user?.datos_basicos?.apellidos]
      .filter(Boolean)
      .join(' ');
    this.documento = user?.numero_de_documento ?? '';
    this.rol = user?.rol?.nombre ?? '';
    this.sede = user?.sede?.nombre ?? '';
    this.correo = user?.datos_basicos?.correo ?? user?.correo ?? user?.email ?? '';

    this.rolesVista = this.normalizarRoles(user);
    this.sedesVista = this.normalizarSedes(user);

    void this.cargarAccesoRapido();
  }

  // ── Multi-rol / multi-sede (V40) ─────────────────────────────────────────
  // `localStorage["user"]` puede traer las listas nuevas (`roles`/`sedes`) o
  // solo los singulares (sesiones iniciadas antes del despliegue): se toleran
  // ambos shapes y siempre se pinta algo.

  private normalizarRoles(user: any): RolVista[] {
    const lista: any[] = Array.isArray(user?.roles) ? user.roles : [];
    const vistos = new Set<string>();
    const out: RolVista[] = [];
    for (const r of lista) {
      const nombre = String(r?.nombre ?? '').trim();
      if (!nombre || vistos.has(nombre)) continue;
      vistos.add(nombre);
      const cruda = r?.vigente_hasta ?? null;
      const hasta = cruda ? new Date(cruda) : null;
      const valida = !!hasta && !isNaN(hasta.getTime());
      out.push({
        nombre,
        principal: !!r?.es_principal,
        vigenteHasta: valida ? hasta : null,
        // El detalle manda `vigente` ya evaluado; si no viene, se evalúa aquí.
        vencido: r?.vigente === false || (valida && hasta!.getTime() <= Date.now()),
      });
    }
    if (!out.length && this.rol) {
      out.push({ nombre: this.rol, principal: true, vigenteHasta: null, vencido: false });
    }
    out.sort((a, b) => Number(b.principal) - Number(a.principal) || a.nombre.localeCompare(b.nombre, 'es'));
    return out;
  }

  private normalizarSedes(user: any): SedeVista[] {
    const lista: any[] = Array.isArray(user?.sedes) ? user.sedes : [];
    const vistos = new Set<string>();
    const out: SedeVista[] = [];
    for (const s of lista) {
      const nombre = String(s?.nombre ?? '').trim();
      if (!nombre || vistos.has(nombre)) continue;
      vistos.add(nombre);
      // El login no marca la principal en la lista: se infiere del singular.
      out.push({ nombre, principal: !!s?.es_principal || nombre === this.sede });
    }
    if (!out.length && this.sede) {
      out.push({ nombre: this.sede, principal: true });
    }
    out.sort((a, b) => Number(b.principal) - Number(a.principal) || a.nombre.localeCompare(b.nombre, 'es'));
    return out;
  }

  /** "hasta 15 sep 2026, 10:30" para el chip de un rol temporal. */
  vigenciaDe(r: RolVista): string {
    if (!r.vigenteHasta) return '';
    return r.vigenteHasta.toLocaleDateString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Acceso rápido ────────────────────────────────────────────────────────

  private async cargarAccesoRapido(): Promise<void> {
    try {
      this.accesoRapidoPosible = await this.qa.disponible();
      if (!this.accesoRapidoPosible) return;

      this.accesoRapido = await this.qa.cargarEstado();
      this.metodosAcceso = await this.qa.metodosDisponibles();
      this.etiquetaBiometria = (await this.qa.soporteBiometrico()).etiqueta;
    } catch {
      this.accesoRapidoPosible = false;
    } finally {
      this.cdr.markForCheck();
    }
  }

  /** Texto legible del método guardado, para la fila de seguridad. */
  get descripcionAccesoRapido(): string {
    switch (this.accesoRapido?.metodo) {
      case 'biometria': return 'Activo · se desbloquea con huella o rostro';
      case 'pin': return 'Activo · se desbloquea con tu PIN';
      case 'dispositivo': return 'Activo · entra directo en este dispositivo';
      default:
        return this.accesoRapidoPosible
          ? 'Guarda tu acceso cifrado en este dispositivo para entrar sin escribir la contraseña.'
          : 'Este navegador no permite guardar el acceso de forma segura.';
    }
  }

  /** Qué protege el guardado en este equipo, en lenguaje del usuario. */
  get proteccionAccesoRapido(): string {
    if (!this.accesoRapido) return '';
    const base = this.accesoRapido.binding === 'sistema-operativo'
      ? 'Protegido con el cifrado de tu cuenta de Windows/macOS: solo se abre en este equipo y con tu usuario.'
      : 'Protegido con una llave del navegador que no se puede copiar ni exportar.';
    const persistencia = this.accesoRapido.persistente
      ? ''
      : ' El navegador podría borrarlo si se queda sin espacio.';
    return base + persistencia;
  }

  get vigenciaAccesoRapido(): string {
    if (!this.accesoRapido) return '';
    return new Date(this.accesoRapido.expiraEn).toLocaleDateString('es-CO', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  }

  /**
   * Activa o cambia el método de acceso rápido. Pide la contraseña actual y la
   * valida contra el servidor antes de guardar nada: sin esa comprobación
   * cualquiera con la sesión abierta podría dejarse un acceso permanente.
   */
  async activarAccesoRapido(): Promise<void> {
    if (!this.accesoRapidoPosible || !this.metodosAcceso.length) return;

    const identificador = this.correo || this.documento;
    if (!identificador) {
      await Swal.fire({
        icon: 'error',
        title: 'Falta tu identificador',
        text: 'No se pudo determinar tu correo o documento para verificar la contraseña.',
      });
      return;
    }

    const { value: password, isConfirmed } = await Swal.fire<string>({
      icon: 'question',
      title: 'Confirma tu contraseña',
      text: 'Por seguridad, escribe tu contraseña para activar el acceso rápido.',
      input: 'password',
      inputAttributes: { autocomplete: 'current-password' },
      inputPlaceholder: 'Tu contraseña',
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!isConfirmed || !password) return;

    try {
      const resp = await this.loginS.login(identificador, password);
      if (!resp?.token) throw new Error('Respuesta inválida del servidor');
      // El backend acaba de emitir un token nuevo; si el anterior quedó
      // invalidado por rotación, seguir con el viejo rompería la sesión.
      setLocalStorageItem('token', resp.token);
      if (resp.user) setLocalStorageItem('user', JSON.stringify(resp.user));
    } catch {
      await Swal.fire({
        icon: 'error',
        title: 'Contraseña incorrecta',
        text: 'No se activó el acceso rápido.',
      });
      return;
    }

    const datos: DatosSetupAcceso = {
      metodos: this.metodosAcceso,
      etiquetaBiometria: this.etiquetaBiometria,
      etiquetaUsuario: this.nombre || identificador,
    };

    const eleccion = await new Promise<ResultadoSetupAcceso | null>(resolve => {
      this.dialog.open(QuickAccessSetupComponent, {
        data: datos, width: '540px', maxWidth: '94vw', autoFocus: false,
      }).afterClosed().subscribe(r => resolve((r as ResultadoSetupAcceso) ?? null));
    });
    if (!eleccion) return;

    try {
      await this.qa.guardar(
        eleccion.metodo,
        { login: identificador, password },
        { etiqueta: datos.etiquetaUsuario, id: this.documento || identificador },
        eleccion.pin,
      );
      this.accesoRapido = this.qa.estado();
      this.cdr.markForCheck();
      await Swal.fire({
        icon: 'success',
        title: 'Acceso rápido activado',
        timer: 2200,
        showConfirmButton: false,
      });
    } catch (e) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo activar',
        text: (e as Error)?.message ?? 'Intenta de nuevo.',
      });
    }
  }

  /** Borra el acceso guardado en este dispositivo. */
  async quitarAccesoRapido(): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning',
      title: '¿Desactivar el acceso rápido?',
      text: 'Se borrarán de este dispositivo los datos guardados. '
        + 'Tendrás que escribir tu contraseña la próxima vez.',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!r.isConfirmed) return;

    await this.qa.olvidar();
    this.accesoRapido = null;
    this.cdr.markForCheck();
  }

  get iniciales(): string {
    const parts = this.nombre.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  /** Selección de archivo desde el input oculto. */
  onFotoSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Permite volver a elegir el mismo archivo tras un error.
    input.value = '';
    if (!file) return;

    this.fotoError = '';
    if (!file.type.startsWith('image/')) {
      this.setError('El archivo debe ser una imagen.');
      return;
    }
    if (file.size > CuentaConfigComponent.MAX_BYTES) {
      this.setError('La imagen no debe superar 8 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => this.reescalarYGuardar(String(reader.result));
    reader.onerror = () => this.setError('No se pudo leer el archivo.');
    reader.readAsDataURL(file);
  }

  quitarFoto(): void {
    this.fotoError = '';
    this.photos.clearPhoto();
    this.cdr.markForCheck();
  }

  cambiarContrasena(): void {
    this.router.navigate(['/dashboard/users/change-password']);
  }

  /** Reescala la imagen a un cuadrado máximo y la guarda como JPEG liviano. */
  private reescalarYGuardar(dataUrl: string): void {
    const img = new Image();
    img.onload = () => {
      const max = CuentaConfigComponent.MAX_SIDE;
      let { width, height } = img;
      if (width >= height && width > max) {
        height = Math.round((height * max) / width);
        width = max;
      } else if (height > width && height > max) {
        width = Math.round((width * max) / height);
        height = max;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        this.photos.setPhoto(dataUrl);
        this.cdr.markForCheck();
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const out = canvas.toDataURL('image/jpeg', 0.85);
      this.photos.setPhoto(out);
      this.cdr.markForCheck();
    };
    img.onerror = () => this.setError('La imagen no es válida.');
    img.src = dataUrl;
  }

  private setError(msg: string): void {
    this.fotoError = msg;
    this.cdr.markForCheck();
  }
}
