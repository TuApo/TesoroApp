import { Component, Inject, OnInit, ChangeDetectionStrategy, signal, computed } from '@angular/core';

import { FormBuilder, Validators, ReactiveFormsModule, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import {
  AdminService,
  ActualizarUsuarioPayload,
  UsuarioDetail,
  RolAsignado,
  SedeAsignada,
} from '../../services/admin.service';
import { forkJoin, Observable, of, switchMap } from 'rxjs';
import {
  Grupo, GrupoTipo, GruposService, NOMBRE_TIPO_GRUPO,
} from '../../services/grupos/grupos.service';
import { catchError, map } from 'rxjs/operators';
import Swal from 'sweetalert2';

export interface UserUpsertData {
  mode: 'create' | 'edit';
  user?: {
    id: string;
    numero_de_documento: string;
    tipo_documento: string;
    correo_electronico: string;
    estado_solicitudes: boolean;
    empresa?: { id: string; nombre: string } | null;
    sede?: { id: string; nombre: string; activa: boolean } | null;
    rol?: { nombre: string; id?: string } | null;
    roles?: RolAsignado[];
    sedes?: SedeAsignada[];
    datos_basicos?: { nombres: string; apellidos: string; celular?: string | null } | null;
    tiene_foto?: boolean;
  } | null;
}

/** Rol elegido en el diálogo. `vigente_hasta` en ISO-8601; null = indefinido. */
interface RolSeleccionado {
  id: string;
  nombre: string;
  es_principal: boolean;
  vigente_hasta: string | null;
}

interface SedeSeleccionada {
  id: string;
  nombre: string;
  es_principal: boolean;
}



@Component({
  selector: 'app-user-upsert-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatTooltipModule
],
  templateUrl: './user-upsert-dialog.component.html',
  styleUrl: './user-upsert-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserUpsertDialogComponent implements OnInit {
  // Catálogos (signals)
  roles = signal<{ id: string; nombre: string }[]>([]);
  sedes = signal<{ id: string; nombre: string; activa: boolean }[]>([]);
  empresas = signal<{ id: string; nombre: string }[]>([]);

  // ── Asignaciones múltiples (V40) ──────────────────────────────────────
  /** Roles asignados; exactamente uno lleva es_principal=true. */
  rolesAsignados = signal<RolSeleccionado[]>([]);
  sedesAsignadas = signal<SedeSeleccionada[]>([]);
  /** Se intentó guardar sin roles: muestra el error bajo el selector. */
  rolesTocados = signal(false);
  /** Rol cuyo input de fecha/hora personalizada está abierto, o null. */
  vigenciaEnEdicion = signal<string | null>(null);
  /** Rol sobre el que se abrió el menú del temporizador. */
  private menuVigenciaRolId: string | null = null;

  // ── Grupos y etiquetas (V41) ──────────────────────────────────────────
  /**
   * Los grupos NO son permisos: son audiencia ("a quién va dirigido esto"). Se guardan
   * en su propio endpoint (PUT /usuarios/{id}/grupos) y no en el payload del usuario,
   * porque al CREAR todavía no existe el id — por eso en alta se envían después.
   */
  grupos = signal<Grupo[]>([]);
  gruposAsignados = signal<Grupo[]>([]);

  /** Opciones aún no asignadas, para los selectores de "Agregar…". */
  rolesDisponibles = computed(() =>
    this.roles().filter(r => !this.rolesAsignados().some(a => a.id === r.id)));
  sedesDisponibles = computed(() =>
    this.sedes().filter(s => !this.sedesAsignadas().some(a => a.id === s.id)));
  gruposDisponibles = computed(() =>
    this.grupos().filter(g => g.activo && !this.gruposAsignados().some(a => a.id === g.id)));

  loading = signal(false);
  saving = signal(false);
  hidePw = signal(true);
  hidePw2 = signal(true);
  changePw = signal(false); // <- toggle para cambiar contraseña en edición

  // --- FOTO DE PERFIL ---
  /** data-URL de la foto en pantalla, o null si no hay. */
  foto = signal<string | null>(null);
  /** Sólo se manda al backend si el usuario la tocó: evita reescribir la misma imagen. */
  fotoTocada = signal(false);
  fotoCargando = signal(false);

  /** Lado máximo en píxeles. Es un avatar: más resolución sólo engorda la fila en BD. */
  private static readonly FOTO_LADO_MAX = 256;
  /** Tope del archivo ORIGINAL que aceptamos abrir (el reescalado lo deja en ~30 KB). */
  private static readonly FOTO_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024;

  /** Iniciales para el hueco cuando no hay foto. */
  iniciales = computed(() => {
    const n = (this.form?.get('nombres')?.value ?? '').toString().trim();
    const a = (this.form?.get('apellidos')?.value ?? '').toString().trim();
    const ini = `${n.charAt(0)}${a.charAt(0)}`.toUpperCase();
    return ini || '?';
  });

  title = computed(() => (this.data.mode === 'create' ? 'Crear usuario' : 'Editar usuario'));
  isCreate = computed(() => this.data.mode === 'create');

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private adminService: AdminService,
    private utils: UtilityServiceService,
    private gruposSvc: GruposService,
    private dialogRef: MatDialogRef<UserUpsertDialogComponent, any>,
    @Inject(MAT_DIALOG_DATA) public data: UserUpsertData
  ) {}

  ngOnInit(): void {
    // 1) Form base
    this.form = this.fb.group({
      numero_de_documento: ['', [Validators.required, Validators.minLength(4)]],
      tipo_documento: ['CC', Validators.required],
      correo_electronico: ['', [Validators.required, Validators.email]],
      estado_solicitudes: [true],
      empresa_id: [null as string | null],
      // rol/sede ya no son selects únicos: viven en rolesAsignados/sedesAsignadas.
      nombres: ['', [Validators.required, Validators.minLength(2)]],
      apellidos: ['', [Validators.required, Validators.minLength(2)]],
      celular: [null as string | null],

      // Password: obligatorio solo en create. En edición se activa con toggle.
      password: [''],
      password2: [''],
    });

    if (this.isCreate()) {
      this.form.get('password')?.addValidators([Validators.required, Validators.minLength(12)]);
      this.form.get('password2')?.addValidators([Validators.required, Validators.minLength(12)]);
      this.form.get('password')?.updateValueAndValidity();
      this.form.get('password2')?.updateValueAndValidity();
    }

    // 2) Cargar catálogos en paralelo (con fallback por si no existe traerEmpresas en UtilityService)
    this.loading.set(true);

    const roles$ = this.utils.traerRoles() as Observable<any[]>;
    const sedes$ = this.utils.traerSucursales2() as Observable<any[]>;
    const empresas$ = (typeof (this.utils as any).traerEmpresas === 'function'
      ? (this.utils as any).traerEmpresas()
      : of([])) as Observable<any[]>;
    // Los grupos son opcionales: si el servicio aún no está desplegado, el selector se
    // queda vacío y el diálogo sigue funcionando igual que antes.
    const grupos$ = this.gruposSvc.list().pipe(catchError(() => of([] as Grupo[])));

    forkJoin({ roles: roles$, sedes: sedes$, empresas: empresas$, grupos: grupos$ }).subscribe({
      next: ({ roles, sedes, empresas, grupos }) => {
        const norm = (x: any): any[] => (Array.isArray(x) ? x : x?.results ?? x?.data ?? []);
        this.roles.set(norm(roles).map((r: any) => ({ id: r.id, nombre: r.nombre })));
        this.sedes.set(norm(sedes).map((s: any) => ({ id: s.id, nombre: s.nombre, activa: !!s.activa })));
        this.empresas.set(norm(empresas).map((e: any) => ({ id: e.id, nombre: e.nombre })));
        this.grupos.set(grupos ?? []);

        if (this.data.mode === 'edit' && this.data.user) {
          this.patchFormWithUser(this.data.user);
          if (this.data.user.tiene_foto) this.cargarFotoExistente(this.data.user.id);
          this.cargarGruposDelUsuario(this.data.user.id);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private patchFormWithUser(u: NonNullable<UserUpsertData['user']>) {
    this.form.patchValue({
      numero_de_documento: u.numero_de_documento ?? '',
      tipo_documento: u.tipo_documento ?? 'CC',
      correo_electronico: u.correo_electronico ?? '',
      estado_solicitudes: !!u.estado_solicitudes,
      empresa_id: u.empresa?.id ?? null,
      nombres: u.datos_basicos?.nombres ?? '',
      apellidos: u.datos_basicos?.apellidos ?? '',
      celular: u.datos_basicos?.celular ?? null,
    });

    // Asignaciones: la lista nueva si el backend ya la manda; si no, el
    // singular legacy como única asignación principal.
    if (u.roles?.length) {
      this.rolesAsignados.set(u.roles.map(r => ({
        id: r.id, nombre: r.nombre,
        es_principal: !!r.es_principal,
        vigente_hasta: r.vigente_hasta ?? null,
      })));
    } else if ((u.rol as any)?.id) {
      this.rolesAsignados.set([{
        id: (u.rol as any).id, nombre: u.rol!.nombre, es_principal: true, vigente_hasta: null,
      }]);
    }
    this.asegurarUnPrincipalRol();

    if (u.sedes?.length) {
      this.sedesAsignadas.set(u.sedes.map(s => ({
        id: s.id, nombre: s.nombre, es_principal: !!s.es_principal,
      })));
    } else if (u.sede?.id) {
      this.sedesAsignadas.set([{ id: u.sede.id, nombre: u.sede.nombre, es_principal: true }]);
    }
    this.asegurarUnPrincipalSede();

    // En edición: por defecto no cambiar contraseña
    if (!this.isCreate()) {
      this.onToggleChangePw(false);
    }
  }

  // ── Grupos y etiquetas: agregar / quitar ──────────────────────────────

  nombreTipoGrupo(t: GrupoTipo): string { return NOMBRE_TIPO_GRUPO[t]; }

  agregarGrupo(grupoId: string | null): void {
    if (!grupoId) return;
    const g = this.grupos().find(x => x.id === grupoId);
    if (!g || this.gruposAsignados().some(a => a.id === grupoId)) return;
    this.gruposAsignados.update(l => [...l, g]);
  }

  quitarGrupo(grupoId: string): void {
    this.gruposAsignados.update(l => l.filter(g => g.id !== grupoId));
  }

  private cargarGruposDelUsuario(usuarioId: string): void {
    this.gruposSvc.gruposDeUsuario(usuarioId)
      .pipe(catchError(() => of([] as Grupo[])))
      .subscribe(g => this.gruposAsignados.set(g ?? []));
  }

  // ── Roles: agregar / quitar / principal / temporizador ────────────────

  agregarRol(rolId: string | null): void {
    if (!rolId) return;
    const rol = this.roles().find(r => r.id === rolId);
    if (!rol || this.rolesAsignados().some(a => a.id === rolId)) return;
    this.rolesAsignados.update(lista => [...lista, {
      id: rol.id, nombre: rol.nombre,
      es_principal: lista.length === 0,
      vigente_hasta: null,
    }]);
  }

  quitarRol(rolId: string): void {
    this.rolesAsignados.update(lista => {
      const nueva = lista.filter(r => r.id !== rolId);
      if (nueva.length && !nueva.some(r => r.es_principal)) nueva[0] = { ...nueva[0], es_principal: true };
      return nueva;
    });
    if (this.vigenciaEnEdicion() === rolId) this.vigenciaEnEdicion.set(null);
  }

  marcarRolPrincipal(rolId: string): void {
    this.rolesAsignados.update(lista =>
      lista.map(r => ({ ...r, es_principal: r.id === rolId })));
  }

  /** Guarda a qué rol pertenece el menú de temporizador que se abre. */
  abrirMenuVigencia(rolId: string): void {
    this.menuVigenciaRolId = rolId;
  }

  /** Preset del menú: días desde ahora, o null = indefinido. */
  setVigenciaPreset(dias: number | null): void {
    const rolId = this.menuVigenciaRolId;
    if (!rolId) return;
    this.vigenciaEnEdicion.set(null);
    const hasta = dias === null
      ? null
      : new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
    this.rolesAsignados.update(lista =>
      lista.map(r => (r.id === rolId ? { ...r, vigente_hasta: hasta } : r)));
  }

  /** Abre el input de fecha/hora personalizada bajo la fila del rol. */
  abrirVigenciaPersonalizada(): void {
    this.vigenciaEnEdicion.set(this.menuVigenciaRolId);
  }

  setVigenciaFecha(rolId: string, event: Event): void {
    const valor = (event.target as HTMLInputElement).value; // "yyyy-MM-ddTHH:mm" local
    const hasta = valor ? new Date(valor).toISOString() : null;
    this.rolesAsignados.update(lista =>
      lista.map(r => (r.id === rolId ? { ...r, vigente_hasta: hasta } : r)));
  }

  /** Valor local "yyyy-MM-ddTHH:mm" para el input datetime-local. */
  vigenciaLocalDe(r: RolSeleccionado): string {
    if (!r.vigente_hasta) return '';
    const d = new Date(r.vigente_hasta);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  esVencido(r: RolSeleccionado): boolean {
    return !!r.vigente_hasta && new Date(r.vigente_hasta).getTime() <= Date.now();
  }

  vigenciaLabel(r: RolSeleccionado): string {
    if (!r.vigente_hasta) return 'Sin límite';
    const d = new Date(r.vigente_hasta);
    if (isNaN(d.getTime())) return 'Sin límite';
    const fecha = d.toLocaleDateString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    if (this.esVencido(r)) return `Venció el ${fecha}`;
    const dias = Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return `Hasta ${fecha} (${dias} día${dias === 1 ? '' : 's'})`;
  }

  private asegurarUnPrincipalRol(): void {
    this.rolesAsignados.update(lista => {
      if (!lista.length) return lista;
      let visto = false;
      const nueva = lista.map(r => {
        const es = r.es_principal && !visto;
        if (es) visto = true;
        return { ...r, es_principal: es };
      });
      if (!visto) nueva[0] = { ...nueva[0], es_principal: true };
      return nueva;
    });
  }

  // ── Sedes: agregar / quitar / principal ───────────────────────────────

  agregarSede(sedeId: string | null): void {
    if (!sedeId) return;
    const sede = this.sedes().find(s => s.id === sedeId);
    if (!sede || this.sedesAsignadas().some(a => a.id === sedeId)) return;
    this.sedesAsignadas.update(lista => [...lista, {
      id: sede.id, nombre: sede.nombre, es_principal: lista.length === 0,
    }]);
  }

  quitarSede(sedeId: string): void {
    this.sedesAsignadas.update(lista => {
      const nueva = lista.filter(s => s.id !== sedeId);
      if (nueva.length && !nueva.some(s => s.es_principal)) nueva[0] = { ...nueva[0], es_principal: true };
      return nueva;
    });
  }

  marcarSedePrincipal(sedeId: string): void {
    this.sedesAsignadas.update(lista =>
      lista.map(s => ({ ...s, es_principal: s.id === sedeId })));
  }

  private asegurarUnPrincipalSede(): void {
    this.sedesAsignadas.update(lista => {
      if (!lista.length) return lista;
      let visto = false;
      const nueva = lista.map(s => {
        const es = s.es_principal && !visto;
        if (es) visto = true;
        return { ...s, es_principal: es };
      });
      if (!visto) nueva[0] = { ...nueva[0], es_principal: true };
      return nueva;
    });
  }

  /** Trae la foto ya guardada. Si falla se sigue con las iniciales: no bloquea la edición. */
  private cargarFotoExistente(id: string): void {
    this.fotoCargando.set(true);
    this.adminService.obtenerFoto(id).subscribe({
      next: r => { this.foto.set(r?.foto ?? null); this.fotoCargando.set(false); },
      error: () => this.fotoCargando.set(false),
    });
  }

  /**
   * Reescala en el navegador antes de subir. Sin esto una foto de móvil (varios MB) viajaría
   * entera y acabaría en una fila de db_admin; el backend además la rechazaría por tamaño.
   */
  async onArchivoFoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite volver a elegir el MISMO archivo tras quitarlo
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      Swal.fire({ title: 'Archivo no válido', text: 'Seleccione una imagen.', icon: 'warning',
        customClass: { container: 'swal-over-dialog' } });
      return;
    }
    if (file.size > UserUpsertDialogComponent.FOTO_ORIGINAL_MAX_BYTES) {
      Swal.fire({ title: 'Imagen demasiado grande', text: 'El archivo supera los 10 MB.', icon: 'warning',
        customClass: { container: 'swal-over-dialog' } });
      return;
    }

    this.fotoCargando.set(true);
    try {
      this.foto.set(await this.reescalar(file));
      this.fotoTocada.set(true);
    } catch {
      Swal.fire({ title: 'No se pudo leer la imagen', text: 'Pruebe con otro archivo.', icon: 'error',
        customClass: { container: 'swal-over-dialog' } });
    } finally {
      this.fotoCargando.set(false);
    }
  }

  quitarFoto(): void {
    this.foto.set(null);
    this.fotoTocada.set(true);
  }

  /** Recorta al cuadrado centrado y exporta JPEG. */
  private reescalar(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('lectura'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decodificación'));
        img.onload = () => {
          const lado = Math.min(img.width, img.height);
          const destino = Math.min(lado, UserUpsertDialogComponent.FOTO_LADO_MAX);
          const canvas = document.createElement('canvas');
          canvas.width = destino;
          canvas.height = destino;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas')); return; }
          // Fondo blanco: el JPEG no tiene alfa y un PNG transparente saldría negro.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, destino, destino);
          ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, destino, destino);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  // Toggle para activar/desactivar cambio de contraseña en edición
  onToggleChangePw(checked: boolean): void {
    this.changePw.set(checked);
    const pw = this.form.get('password')!;
    const pw2 = this.form.get('password2')!;
    if (checked) {
      pw.setValidators([Validators.required, Validators.minLength(12)]);
      pw2.setValidators([Validators.required, Validators.minLength(12)]);
    } else {
      pw.clearValidators(); pw.reset('');
      pw2.clearValidators(); pw2.reset('');
      // Limpia error de mismatch si quedó colgado
      pw2.setErrors(null);
    }
    pw.updateValueAndValidity();
    pw2.updateValueAndValidity();
  }

  cancelar(): void {
    this.dialogRef.close(null);
  }

  guardar(): void {
    // Validación de match de password en create o si activaste el toggle en edición
    if (this.isCreate() || this.changePw()) {
      const p1 = (this.form.get('password')?.value ?? '').toString();
      const p2 = (this.form.get('password2')?.value ?? '').toString();
      if (p1 !== p2) {
        this.form.get('password2')?.setErrors({ mismatch: true });
      }
    }

    // Al menos un rol (el requerido que antes vivía en el select rol_id).
    if (!this.rolesAsignados().length) {
      this.rolesTocados.set(true);
      this.form.markAllAsTouched();
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);

    // Saneo simple: trim strings
    const raw = this.form.getRawValue();
    const trim = (v: any) => (typeof v === 'string' ? v.trim() : v);

    // Asignaciones múltiples (V40): la lista completa manda; el backend deriva
    // el principal (columna legacy) del es_principal.
    const rolesPayload = this.rolesAsignados().map(r => ({
      rol_id: r.id,
      es_principal: r.es_principal,
      vigente_hasta: r.vigente_hasta,
    }));
    const sedesPayload = this.sedesAsignadas().map(s => ({
      sede_id: s.id,
      es_principal: s.es_principal,
    }));

    const payload: ActualizarUsuarioPayload = {
      numero_de_documento: trim(raw.numero_de_documento) || undefined,
      tipo_documento: trim(raw.tipo_documento) || undefined,
      correo_electronico: trim(raw.correo_electronico) || undefined,
      estado_solicitudes: raw.estado_solicitudes ?? true,
      empresa: raw.empresa_id ?? null,
      roles: rolesPayload,
      sedes: sedesPayload,
      nombres: trim(raw.nombres) ?? '',
      apellidos: trim(raw.apellidos) ?? '',
      celular: trim(raw.celular) ?? null,
      // password sólo si aplica (create o toggle activo en edición)
      ...(this.isCreate() || this.changePw() ? { password: trim(raw.password) } : {}),
    };

    // Unificamos a Observable<UsuarioDetail>.
    // El alta va en UNA sola llamada al endpoint admin: antes creaba contra /auth/register/
    // (que ignora el rol por seguridad) y parcheaba el rol después con cambiarRol, cuyo error
    // se tragaba un catchError — el usuario quedaba creado como SIN-ASIGNAR sin avisar.
    const req$: Observable<UsuarioDetail> =
      this.data.mode === 'create'
        ? this.adminService.crear({
            numero_de_documento: payload.numero_de_documento!,
            tipo_documento: payload.tipo_documento!,
            correo_electronico: payload.correo_electronico!,
            password: (payload as any).password!, // garantizado en create
            estado_solicitudes: payload.estado_solicitudes,
            empresa: payload.empresa ?? null,
            roles: rolesPayload,
            sedes: sedesPayload,
            nombres: payload.nombres,
            apellidos: payload.apellidos,
            celular: payload.celular ?? null,
            // En el alta la foto viaja en el mismo POST: si el usuario no llega a crearse,
            // no queda una foto suelta apuntando a nadie.
            foto: this.foto(),
          })
        : this.adminService.actualizar(this.data.user!.id, payload, true).pipe(
            // En edición la foto es un recurso aparte y sólo se toca si el usuario la cambió.
            switchMap((detail: UsuarioDetail) =>
              this.fotoTocada()
                ? this.adminService.guardarFoto(detail.id, this.foto()).pipe(
                    map(() => detail),
                    // La foto no debe tumbar un guardado que ya se aplicó: se avisa y se sigue.
                    catchError(() => {
                      Swal.fire({
                        title: 'Datos guardados, foto no',
                        text: 'Los cambios del usuario se guardaron, pero la foto no se pudo actualizar.',
                        icon: 'warning',
                        customClass: { container: 'swal-over-dialog' },
                      });
                      return of(detail);
                    })
                  )
                : of(detail)
            )
          );

    // Los grupos van en su PROPIO endpoint y DESPUÉS del alta (al crear todavía no hay
    // id). Como no son permisos, un fallo aquí no invalida el guardado: se avisa y el
    // usuario queda creado/actualizado igual.
    const conGrupos$ = req$.pipe(
      switchMap((detail: UsuarioDetail) =>
        this.gruposSvc.asignarAUsuario(detail.id, this.gruposAsignados().map(g => g.id)).pipe(
          map(() => detail),
          catchError(() => {
            Swal.fire({
              title: 'Datos guardados, grupos no',
              text: 'Los cambios del usuario se guardaron, pero los grupos y etiquetas no se pudieron asignar.',
              icon: 'warning',
              customClass: { container: 'swal-over-dialog' },
            });
            return of(detail);
          })
        )
      )
    );

    conGrupos$.subscribe({
      next: (detail: UsuarioDetail) => {
        this.saving.set(false);
        this.dialogRef.close({ ok: true, data: detail });
      },
      error: (err: any) => {
        const errors = err?.error?.errors;
        const msg = err?.error?.message;
        let detalle = 'No fue posible guardar el usuario.';
        if (errors && typeof errors === 'object') {
          detalle = Object.values(errors).join('\n');
          Object.entries(errors).forEach(([field, errMsg]) => this.marcarError(field, errMsg));
        } else if (msg) {
          detalle = msg;
          // El backend responde en prosa ("Ya existe un usuario con la cédula 123"):
          // resaltamos el campo concreto que menciona en vez de ambos a ciegas.
          const low = msg.toLowerCase();
          if (low.includes('cedula') || low.includes('cédula')) {
            this.marcarError('numero_de_documento', msg);
          }
          if (low.includes('correo')) {
            this.marcarError('correo_electronico', msg);
          }
          if (low.includes('contrase')) {
            this.marcarError('password', msg);
          }
        }
        Swal.fire({ title: 'Error', text: detalle, icon: 'error', customClass: { container: 'swal-over-dialog' } });
        this.saving.set(false);
      },
    });
  }

  /**
   * Pinta el error del servidor sobre el control correspondiente.
   * El validador de Spring devuelve las claves con el nombre Java (camelCase:
   * `numeroDeDocumento`), mientras que los controles del formulario son snake_case,
   * así que se prueban ambas formas antes de descartar el error.
   */
  private marcarError(field: string, mensaje: unknown): void {
    const snake = field.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    const ctrl = this.form.get(field) ?? this.form.get(snake) ?? this.form.get(field === 'rol' ? 'rol_id' : field);
    if (ctrl) {
      ctrl.setErrors({ serverError: mensaje });
      ctrl.markAsTouched();
    }
  }

}
