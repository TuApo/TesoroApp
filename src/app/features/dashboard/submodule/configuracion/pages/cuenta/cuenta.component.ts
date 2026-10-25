import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom, Observable } from 'rxjs';
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
import { AdminService } from '../../../users/services/admin.service';
import { FirmaDialogComponent } from '../../../hiring/components/firma/firma.dialog';

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

  // ── Firma digital (en el servidor, ligada al usuario) ────────────────────
  firma: string | null = null;
  firmaOrigen: 'DIBUJO' | 'IMAGEN' | null = null;
  firmaActualizada: Date | null = null;
  firmaCargando = true;
  firmaGuardando = false;
  firmaError = '';

  /** Ancho máximo de la firma ya recortada, en px. */
  private static readonly FIRMA_MAX_W = 600;
  private static readonly FIRMA_MAX_H = 240;

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
    private readonly admin: AdminService,
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
    void this.cargarFirma();
  }

  // ── Firma digital ────────────────────────────────────────────────────────

  private async cargarFirma(): Promise<void> {
    this.firmaCargando = true;
    try {
      const r = await firstValueFrom(this.admin.obtenerMiFirma());
      this.aplicarFirma(r?.firma ?? null, r?.origen ?? null, r?.actualizado_en ?? null);
    } catch {
      this.firmaError = 'No se pudo cargar tu firma.';
    } finally {
      this.firmaCargando = false;
      this.cdr.markForCheck();
    }
  }

  private aplicarFirma(firma: string | null, origen: 'DIBUJO' | 'IMAGEN' | null, fecha: string | null): void {
    this.firma = firma;
    this.firmaOrigen = firma ? origen : null;
    const f = fecha ? new Date(fecha) : null;
    this.firmaActualizada = f && !isNaN(f.getTime()) ? f : null;
  }

  get firmaFechaTexto(): string {
    return this.firmaActualizada
      ? this.firmaActualizada.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
      : '';
  }

  /** Abre el lienzo; el trazo se limpia (fondo transparente, recorte) antes de guardar. */
  dibujarFirma(): void {
    this.dialog.open(FirmaDialogComponent, {
      width: '620px', maxWidth: '95vw', autoFocus: false,
      data: { titulo: 'Tu firma digital', pista: 'Firma dentro del recuadro con el ratón, el dedo o el lápiz.' },
    }).afterClosed().subscribe((file?: File) => {
      if (file) void this.procesarYGuardarFirma(file, 'DIBUJO');
    });
  }

  onFirmaSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.firmaError = '';
    if (!file.type.startsWith('image/')) {
      this.setFirmaError('El archivo debe ser una imagen (PNG o JPG).');
      return;
    }
    if (file.size > CuentaConfigComponent.MAX_BYTES) {
      this.setFirmaError('La imagen no debe superar 8 MB.');
      return;
    }
    void this.procesarYGuardarFirma(file, 'IMAGEN');
  }

  async quitarFirma(): Promise<void> {
    const r = await Swal.fire({
      icon: 'warning',
      title: '¿Quitar tu firma?',
      text: 'Se eliminará la firma guardada en tu cuenta.',
      showCancelButton: true,
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!r.isConfirmed) return;
    await this.enviarFirma(null, 'DIBUJO');
  }

  private async procesarYGuardarFirma(file: File, origen: 'DIBUJO' | 'IMAGEN'): Promise<void> {
    this.firmaError = '';
    let dataUrl: string;
    try {
      dataUrl = await this.limpiarFirma(file);
    } catch (e) {
      this.setFirmaError((e as Error)?.message || 'No se pudo procesar la imagen.');
      return;
    }
    await this.enviarFirma(dataUrl, origen);
  }

  private async enviarFirma(dataUrl: string | null, origen: 'DIBUJO' | 'IMAGEN'): Promise<void> {
    this.firmaGuardando = true;
    this.cdr.markForCheck();
    try {
      const r = await firstValueFrom(this.admin.guardarMiFirma(dataUrl, origen));
      this.aplicarFirma(r?.tiene_firma ? dataUrl : null, r?.origen ?? null, r?.actualizado_en ?? null);
      await Swal.fire({
        icon: 'success',
        title: dataUrl ? 'Firma guardada' : 'Firma eliminada',
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (e: any) {
      this.setFirmaError(e?.error?.detail || e?.error?.message || 'No se pudo guardar la firma.');
    } finally {
      this.firmaGuardando = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Deja la firma lista para estampar en documentos: el fondo claro pasa a
   * transparente (alfa = oscuridad del trazo, sin halo blanco), se recorta al
   * trazo con un margen y se reescala a un tamaño liviano. Sale en PNG.
   */
  private limpiarFirma(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        // Se trabaja a un tamaño acotado: una foto de 12 MP no hace falta píxel a píxel.
        const escala0 = Math.min(1, 1600 / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala0));
        const h = Math.max(1, Math.round(img.height * escala0));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) { reject(new Error('El navegador no permite procesar la imagen.')); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const datos = ctx.getImageData(0, 0, w, h);
        const px = datos.data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            // Por encima de ~215 es papel/fondo; por debajo, la tinta gana opacidad.
            const a = lum >= 215 ? 0 : Math.min(255, Math.round((215 - lum) * 255 / 120));
            px[i + 3] = a;
            if (a > 24) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) { reject(new Error('No se detectó ningún trazo en la imagen.')); return; }
        ctx.putImageData(datos, 0, 0);

        const pad = 8;
        const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
        const sw = Math.min(w, maxX + pad + 1) - sx, sh = Math.min(h, maxY + pad + 1) - sy;
        const k = Math.min(1, CuentaConfigComponent.FIRMA_MAX_W / sw, CuentaConfigComponent.FIRMA_MAX_H / sh);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(sw * k));
        out.height = Math.max(1, Math.round(sh * k));
        const octx = out.getContext('2d');
        if (!octx) { reject(new Error('El navegador no permite procesar la imagen.')); return; }
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
        resolve(out.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('La imagen no es válida.')); };
      img.src = url;
    });
  }

  private setFirmaError(msg: string): void {
    this.firmaError = msg;
    this.cdr.markForCheck();
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
