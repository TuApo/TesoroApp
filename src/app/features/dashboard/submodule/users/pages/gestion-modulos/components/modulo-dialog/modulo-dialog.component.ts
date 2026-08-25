import { Component, Inject, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SharedModule } from '@/app/shared/shared.module';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ModulosService } from '../../../../services/modulos/modulos.service';

export interface ModuloDialogData {
  title: string;
  parentName?: string;
  /** Ruta del padre — si existe, "Auto" la usa como prefijo para el slug. */
  parentRuta?: string | null;
  nombre?: string;
  ruta?: string;
  icono?: string;
  orden?: number;
  /** Si es true, oculta el campo "orden" (lo gestiona el padre con next-orden). */
  autoOrden?: boolean;
}

interface IconSuggestion {
  icon: string;
  label: string;
}

interface IconKeywordRule {
  match: string[];
  suggestions: IconSuggestion[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-modulo-dialog',
  imports: [SharedModule, MatDialogModule, ReactiveFormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './modulo-dialog.component.html',
  styleUrl: './modulo-dialog.component.css'
})
export class ModuloDialogComponent {
  form: FormGroup;
  isEdit: boolean;

  /** Nombre actual del módulo (signal reactivo, alimentado por valueChanges). */
  nombreSignal = signal<string>('');

  /** Sugerencias por defecto (cuando no hay match con el nombre tipeado). */
  private fallbackSuggestions: IconSuggestion[] = [
    { icon: 'widgets', label: 'Módulo' },
    { icon: 'dashboard', label: 'Panel' },
    { icon: 'folder', label: 'Carpeta' },
    { icon: 'group', label: 'Grupo' },
    { icon: 'settings', label: 'Configuración' },
    { icon: 'description', label: 'Documento' }
  ];

  /**
   * Mapa heurístico nombre → sugerencias.
   * Cada sugerencia trae label en español (no es el nombre técnico del ícono).
   */
  private iconKeywordRules: IconKeywordRule[] = [
    { match: ['tesorer', 'banc', 'finan'], suggestions: [
      { icon: 'account_balance', label: 'Banco' },
      { icon: 'payments', label: 'Pagos' },
      { icon: 'savings', label: 'Ahorro' },
      { icon: 'receipt_long', label: 'Recibo' },
      { icon: 'account_balance_wallet', label: 'Cartera' }
    ]},
    { match: ['pago', 'cobr', 'transferenc'], suggestions: [
      { icon: 'payments', label: 'Pagos' },
      { icon: 'credit_card', label: 'Tarjeta' },
      { icon: 'attach_money', label: 'Dinero' },
      { icon: 'request_quote', label: 'Factura' }
    ]},
    { match: ['factur'], suggestions: [
      { icon: 'receipt_long', label: 'Recibo' },
      { icon: 'request_quote', label: 'Factura' },
      { icon: 'description', label: 'Documento' }
    ]},
    { match: ['nomin'], suggestions: [
      { icon: 'paid', label: 'Pagado' },
      { icon: 'payments', label: 'Pagos' },
      { icon: 'receipt_long', label: 'Recibo' },
      { icon: 'badge', label: 'Empleado' }
    ]},
    { match: ['contab'], suggestions: [
      { icon: 'account_balance', label: 'Banco' },
      { icon: 'calculate', label: 'Calcular' },
      { icon: 'analytics', label: 'Análisis' }
    ]},
    { match: ['caj'], suggestions: [
      { icon: 'point_of_sale', label: 'Caja' },
      { icon: 'savings', label: 'Ahorro' }
    ]},
    { match: ['user', 'usuari'], suggestions: [
      { icon: 'group', label: 'Grupo' },
      { icon: 'person', label: 'Persona' },
      { icon: 'manage_accounts', label: 'Gestión' },
      { icon: 'badge', label: 'Identificación' }
    ]},
    { match: ['emple', 'colaborad', 'personal'], suggestions: [
      { icon: 'badge', label: 'Empleado' },
      { icon: 'work', label: 'Trabajo' },
      { icon: 'groups', label: 'Equipo' },
      { icon: 'person', label: 'Persona' }
    ]},
    { match: ['client'], suggestions: [
      { icon: 'groups_2', label: 'Clientes' },
      { icon: 'support_agent', label: 'Atención' },
      { icon: 'person', label: 'Persona' }
    ]},
    { match: ['dashboard', 'inicio', 'home', 'panel'], suggestions: [
      { icon: 'dashboard', label: 'Panel' },
      { icon: 'home', label: 'Inicio' },
      { icon: 'analytics', label: 'Análisis' },
      { icon: 'space_dashboard', label: 'Tablero' }
    ]},
    { match: ['config', 'ajust', 'paramet'], suggestions: [
      { icon: 'settings', label: 'Configuración' },
      { icon: 'tune', label: 'Ajustes' },
      { icon: 'build', label: 'Herramientas' }
    ]},
    { match: ['seguri'], suggestions: [
      { icon: 'security', label: 'Seguridad' },
      { icon: 'lock', label: 'Bloqueo' },
      { icon: 'shield', label: 'Escudo' },
      { icon: 'verified_user', label: 'Verificado' }
    ]},
    { match: ['acces', 'permis', 'rol'], suggestions: [
      { icon: 'admin_panel_settings', label: 'Permisos' },
      { icon: 'key', label: 'Llave' },
      { icon: 'lock_open', label: 'Acceso' }
    ]},
    { match: ['inform', 'report', 'estadi', 'analyt'], suggestions: [
      { icon: 'analytics', label: 'Análisis' },
      { icon: 'assessment', label: 'Reporte' },
      { icon: 'bar_chart', label: 'Gráfico' },
      { icon: 'insights', label: 'Insights' }
    ]},
    { match: ['document'], suggestions: [
      { icon: 'description', label: 'Documento' },
      { icon: 'folder', label: 'Carpeta' },
      { icon: 'article', label: 'Artículo' }
    ]},
    { match: ['archi', 'carpet'], suggestions: [
      { icon: 'folder', label: 'Carpeta' },
      { icon: 'inventory_2', label: 'Archivos' },
      { icon: 'folder_special', label: 'Especial' }
    ]},
    { match: ['contrat'], suggestions: [
      { icon: 'handshake', label: 'Acuerdo' },
      { icon: 'description', label: 'Documento' },
      { icon: 'work', label: 'Trabajo' }
    ]},
    { match: ['capacit', 'educa', 'formaci', 'curso'], suggestions: [
      { icon: 'school', label: 'Educación' },
      { icon: 'menu_book', label: 'Manual' },
      { icon: 'cast_for_education', label: 'Curso' }
    ]},
    { match: ['asist', 'soport', 'ayud'], suggestions: [
      { icon: 'support_agent', label: 'Soporte' },
      { icon: 'help', label: 'Ayuda' },
      { icon: 'contact_support', label: 'Contacto' }
    ]},
    { match: ['huell', 'biometr'], suggestions: [
      { icon: 'fingerprint', label: 'Huella' },
      { icon: 'face', label: 'Rostro' }
    ]},
    { match: ['notific', 'alert'], suggestions: [
      { icon: 'notifications', label: 'Avisos' },
      { icon: 'campaign', label: 'Campaña' },
      { icon: 'priority_high', label: 'Alerta' }
    ]},
    { match: ['audit'], suggestions: [
      { icon: 'fact_check', label: 'Auditoría' },
      { icon: 'verified', label: 'Verificado' },
      { icon: 'rule', label: 'Regla' }
    ]},
    { match: ['empres', 'compañ', 'compani'], suggestions: [
      { icon: 'business', label: 'Empresa' },
      { icon: 'apartment', label: 'Edificio' },
      { icon: 'corporate_fare', label: 'Corporativo' }
    ]},
    { match: ['costo', 'ceco', 'centro de cost'], suggestions: [
      { icon: 'account_balance_wallet', label: 'Cartera' },
      { icon: 'account_tree', label: 'Estructura' },
      { icon: 'request_quote', label: 'Factura' }
    ]},
    { match: ['tick'], suggestions: [
      { icon: 'confirmation_number', label: 'Ticket' },
      { icon: 'support_agent', label: 'Soporte' }
    ]},
    { match: ['bug', 'error', 'incid', 'fall'], suggestions: [
      { icon: 'bug_report', label: 'Bug' },
      { icon: 'report', label: 'Reporte' },
      { icon: 'error', label: 'Error' }
    ]},
    { match: ['inventari', 'product'], suggestions: [
      { icon: 'inventory_2', label: 'Inventario' },
      { icon: 'category', label: 'Categoría' },
      { icon: 'shelves', label: 'Estantes' }
    ]},
    { match: ['hir', 'contrata', 'reclut', 'seleccion'], suggestions: [
      { icon: 'handshake', label: 'Acuerdo' },
      { icon: 'person_add', label: 'Sumar' },
      { icon: 'work', label: 'Trabajo' }
    ]},
    { match: ['vacacion', 'permis'], suggestions: [
      { icon: 'beach_access', label: 'Vacaciones' },
      { icon: 'event_available', label: 'Disponible' }
    ]},
    { match: ['salud', 'medic', 'incapacid'], suggestions: [
      { icon: 'medical_services', label: 'Médico' },
      { icon: 'health_and_safety', label: 'Salud' },
      { icon: 'medication', label: 'Medicina' }
    ]},
    { match: ['agend', 'calendar', 'cita'], suggestions: [
      { icon: 'event', label: 'Evento' },
      { icon: 'calendar_month', label: 'Calendario' },
      { icon: 'schedule', label: 'Horario' }
    ]},
    { match: ['comuni', 'mensaj', 'chat'], suggestions: [
      { icon: 'chat', label: 'Chat' },
      { icon: 'forum', label: 'Foro' },
      { icon: 'mail', label: 'Correo' }
    ]},
    { match: ['admin'], suggestions: [
      { icon: 'admin_panel_settings', label: 'Admin' },
      { icon: 'manage_accounts', label: 'Gestión' }
    ]},
    { match: ['cargo', 'puesto'], suggestions: [
      { icon: 'badge', label: 'Cargo' },
      { icon: 'work', label: 'Trabajo' }
    ]},
    { match: ['centro', 'sede', 'oficina'], suggestions: [
      { icon: 'business', label: 'Empresa' },
      { icon: 'location_city', label: 'Ciudad' },
      { icon: 'apartment', label: 'Edificio' }
    ]},
    { match: ['tarea', 'task', 'pendient'], suggestions: [
      { icon: 'task_alt', label: 'Tarea' },
      { icon: 'checklist', label: 'Checklist' },
      { icon: 'fact_check', label: 'Revisar' }
    ]},
    { match: ['proyect'], suggestions: [
      { icon: 'rocket_launch', label: 'Proyecto' },
      { icon: 'lightbulb', label: 'Idea' },
      { icon: 'flag', label: 'Meta' }
    ]},
    { match: ['prove'], suggestions: [
      { icon: 'local_shipping', label: 'Envío' },
      { icon: 'inventory_2', label: 'Inventario' }
    ]},
    { match: ['firm'], suggestions: [
      { icon: 'draw', label: 'Firma' },
      { icon: 'edit_note', label: 'Anotar' }
    ]},
    { match: ['gps', 'ruta', 'mapa', 'ubicaci'], suggestions: [
      { icon: 'map', label: 'Mapa' },
      { icon: 'place', label: 'Ubicación' },
      { icon: 'pin_drop', label: 'Punto' }
    ]},
    { match: ['transport', 'vehicul'], suggestions: [
      { icon: 'directions_car', label: 'Vehículo' },
      { icon: 'local_shipping', label: 'Camión' }
    ]},
    { match: ['tienda', 'comerci', 'venta'], suggestions: [
      { icon: 'storefront', label: 'Tienda' },
      { icon: 'point_of_sale', label: 'Caja' },
      { icon: 'shopping_cart', label: 'Carrito' }
    ]},
    { match: ['gestion', 'manage'], suggestions: [
      { icon: 'manage_accounts', label: 'Gestión' },
      { icon: 'admin_panel_settings', label: 'Admin' },
      { icon: 'tune', label: 'Ajustes' }
    ]}
  ];

  /** Sugerencias dinámicas según el nombre tipeado. */
  iconosSugeridosPorNombre = computed<IconSuggestion[]>(() => {
    const n = this.normalize(this.nombreSignal());
    if (n.length < 2) return [];
    const out: IconSuggestion[] = [];
    const seen = new Set<string>();
    for (const rule of this.iconKeywordRules) {
      if (rule.match.some(m => n.includes(m))) {
        for (const s of rule.suggestions) {
          if (!seen.has(s.icon)) { seen.add(s.icon); out.push(s); }
        }
      }
    }
    return out.slice(0, 8);
  });

  // ===== IA (DeepSeek) =====
  private modulos = inject(ModulosService);
  aiSuggestions = signal<IconSuggestion[]>([]);
  aiLoading = signal(false);
  aiError = signal<string | null>(null);
  aiUsedCache = signal(false);

  /** Cuál fue el nombre con el que se generó la última respuesta IA (para invalidar). */
  private aiLastFor = signal<string>('');

  /** Sugerencias mostradas: IA si existe y matchea el nombre actual, si no heurísticas, si no fallback. */
  sugerenciasMostradas = computed<IconSuggestion[]>(() => {
    const aiList = this.aiSuggestions();
    const aiFor = this.aiLastFor();
    const nombreActual = this.normalize(this.nombreSignal());
    if (aiList.length > 0 && aiFor && aiFor === nombreActual) {
      return aiList;
    }
    const heur = this.iconosSugeridosPorNombre();
    return heur.length > 0 ? heur : this.fallbackSuggestions;
  });

  /** Cuál es la fuente actual de las sugerencias mostradas. */
  fuenteSugerencias = computed<'ai' | 'smart' | 'fallback'>(() => {
    const aiList = this.aiSuggestions();
    const nombreActual = this.normalize(this.nombreSignal());
    if (aiList.length > 0 && this.aiLastFor() === nombreActual) return 'ai';
    return this.iconosSugeridosPorNombre().length > 0 ? 'smart' : 'fallback';
  });

  constructor(
    public dialogRef: MatDialogRef<ModuloDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ModuloDialogData,
    private fb: FormBuilder
  ) {
    this.isEdit = !!data.nombre;

    this.form = this.fb.group({
      nombre: [data.nombre || '', [Validators.required, Validators.maxLength(50)]],
      ruta: [data.ruta || '', [Validators.maxLength(255)]],
      icono: [data.icono || 'widgets', [Validators.maxLength(50)]],
      orden: [data.orden ?? 0]
    });

    this.nombreSignal.set(data.nombre || '');

    // Si ya hay ruta al abrir (modo edición o pre-fill), respetamos la edición previa.
    this.rutaManual = !!(data.ruta && data.ruta.trim());

    this.form.get('nombre')!.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(v => {
        const nuevo = (v ?? '').toString();
        this.nombreSignal.set(nuevo);
        if (!this.rutaManual) this.refreshRutaAuto();

        // Si el nombre cambia, invalidamos las sugerencias IA viejas
        if (this.normalize(nuevo) !== this.aiLastFor()) {
          this.aiError.set(null);
        }
      });
  }

  /** Pide sugerencias a la IA para el nombre actual. */
  pedirSugerenciasIA(): void {
    const nombre = (this.nombreSignal() || '').trim();
    if (nombre.length < 2 || this.aiLoading()) return;

    this.aiLoading.set(true);
    this.aiError.set(null);

    this.modulos.sugerirIconosIA(nombre).subscribe({
      next: (resp) => {
        const list = (resp?.suggestions || []).map(s => ({
          icon: (s.icon || '').toString(),
          label: (s.label || '').toString()
        })).filter(s => s.icon && s.label);

        if (list.length === 0) {
          this.aiError.set('La IA no devolvió sugerencias válidas.');
        } else {
          this.aiSuggestions.set(list);
          this.aiLastFor.set(this.normalize(nombre));
          this.aiUsedCache.set(!!resp?.cached);
        }
        this.aiLoading.set(false);
      },
      error: (err) => {
        const msg = err?.error?.error || 'No se pudo conectar con la IA';
        this.aiError.set(msg);
        this.aiLoading.set(false);
      }
    });
  }

  /** Vuelve a las sugerencias automáticas (heurística), descartando las de IA. */
  resetIA(): void {
    this.aiSuggestions.set([]);
    this.aiLastFor.set('');
    this.aiError.set(null);
    this.aiUsedCache.set(false);
  }

  /** Marca si el usuario tocó manualmente la ruta (para no pisarla con el auto-fill). */
  private rutaManual = false;

  seleccionarIcono(icono: string): void {
    this.form.get('icono')?.setValue(icono);
  }

  get iconoActual(): string {
    return this.form.get('icono')?.value || 'widgets';
  }

  get mostrarOrden(): boolean {
    return !this.data.autoOrden;
  }

  /** Acortar para mostrar en label. */
  nombreCorto(): string {
    const n = this.nombreSignal();
    return n.length > 24 ? n.slice(0, 24) + '…' : n;
  }

  // ===== RUTA helpers =====

  /** Lo que se muestra al usuario (sin la barra inicial). */
  get rutaSlug(): string {
    const v = (this.form.get('ruta')?.value || '').toString();
    return v.startsWith('/') ? v.slice(1) : v;
  }

  /** El usuario edita el slug manualmente: marcamos manual y guardamos /<slug>. */
  onRutaSlugInput(value: string): void {
    this.rutaManual = true;
    const cleaned = (value || '').replace(/^\/+/, '');
    this.form.get('ruta')?.setValue(cleaned ? '/' + cleaned : '');
  }

  /** Recalcula la ruta automática según el nombre actual + prefijo del padre. */
  private refreshRutaAuto(): void {
    const slug = this.slugify(this.nombreSignal());
    const ctrl = this.form.get('ruta');
    if (!ctrl) return;
    if (!slug) {
      ctrl.setValue('', { emitEvent: false });
      return;
    }
    const padre = (this.data.parentRuta || '').trim().replace(/\/+$/, '');
    const ruta = padre ? `${padre}/${slug}` : `/${slug}`;
    ctrl.setValue(ruta.startsWith('/') ? ruta : '/' + ruta, { emitEvent: false });
  }

  /** Placeholder dinámico del input según haya o no ruta de padre. */
  get rutaPlaceholder(): string {
    const padre = (this.data.parentRuta || '').trim().replace(/^\/+|\/+$/g, '');
    return padre ? `${padre}/tu-nombre` : 'tu-nombre  o  carpeta/tu-nombre';
  }

  /** Limpia la ruta y conserva el control manual (no autocompleta de nuevo). */
  limpiarRuta(): void {
    this.rutaManual = true;
    this.form.get('ruta')?.setValue('');
  }

  /** Slug compatible con URL: minúsculas, sin acentos, separado por "-". */
  private slugify(s: string): string {
    return this.normalize(s)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** Normaliza el texto: minúsculas, sin acentos, sin espacios extremos. */
  private normalize(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }

  save(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.value);
    } else {
      this.form.markAllAsTouched();
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
