import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { CampoForm, abrirFormulario, confirmar } from '../../components/dialogos/formulario-dialogo';
import { SgImagen } from '../../components/imagen-segura/imagen-segura';
import { Ajustes, Avistamiento, Camara, NOMBRE_TIPO_PERSONA, Persona, Rostro, TipoPersona } from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { fechaHora, num, soloFecha } from '../../utils/formato';

const TIPOS: TipoPersona[] = ['EMPLEADO', 'VISITANTE', 'VIP', 'ALERTA', 'OTRO'];
const CON_CONSENTIMIENTO: TipoPersona[] = ['EMPLEADO', 'VISITANTE', 'VIP'];
const TONO_TIPO: Record<TipoPersona, 'info' | 'ok' | 'warn' | 'danger' | 'neutro'> = {
  EMPLEADO: 'info', VISITANTE: 'neutro', VIP: 'ok', ALERTA: 'danger', OTRO: 'neutro',
};

/**
 * Rostros: personas enroladas para reconocimiento facial y sus avistamientos.
 *
 * <p>Biometría = dato sensible (Ley 1581 de 2012). Por eso aquí se exige lo mismo que el
 * backend: empleados, visitantes y VIP necesitan la fecha del consentimiento; la lista de
 * ALERTA necesita el soporte legal (denuncia o incidente) y quién lo aprobó. Sin eso no se
 * deja enrolar un rostro. Los rostros de desconocidos nunca se guardan.
 *
 * <p>Enrolar: subir una foto o tomarla con la cámara del equipo. Debe verse UNA cara de
 * frente; el servidor responde 422 si no hay rostro o hay varios.
 */
@Component({
  selector: 'app-seguridad-rostros',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, SgImagen, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rostros.html',
  styleUrls: ['../../styles/seguridad-comun.css', './rostros.css'],
})
export class SeguridadRostros {
  private readonly api = inject(SeguridadService);
  private readonly dialog = inject(MatDialog);
  private readonly acciones = inject(AccionesSeguridad);

  readonly ajustes = signal<Ajustes | null>(null);
  readonly personas = signal<Persona[]>([]);
  readonly camaras = signal<Camara[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly elegidaId = signal<string | null>(null);
  readonly elegida = computed(() => this.personas().find((p) => p.id === this.elegidaId()) ?? null);
  readonly rostros = signal<Rostro[]>([]);
  readonly cargandoRostros = signal(false);
  readonly enrolando = signal(false);
  readonly errorEnrolar = signal<string | null>(null);

  // Cámara del equipo para tomar la foto
  readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  readonly camaraAbierta = signal(false);
  private flujo: MediaStream | null = null;

  // Avistamientos (paginado en el servidor)
  readonly avistamientos = signal<Avistamiento[]>([]);
  readonly totalAvist = signal(0);
  readonly paginaAvist = signal(0);
  readonly porPaginaAvist = signal(50);
  readonly cargandoAvist = signal(false);
  readonly filtroPersona = signal<string | null>(null);
  readonly filtroCamara = signal<string | null>(null);
  readonly filtroDesde = signal('');
  readonly filtroHasta = signal('');

  readonly nombreTipo = NOMBRE_TIPO_PERSONA;
  readonly f = { fechaHora, soloFecha, num };

  readonly faltaLegal = computed(() => {
    const p = this.elegida();
    return p ? this.motivoBloqueo(p) : null;
  });

  readonly columnas: ColumnaTabla<Persona>[] = [
    { id: 'foto', header: '', valor: () => '', ordenable: false, filtrable: false, copiable: false, ancho: '64px', tarjeta: 'oculto' },
    { id: 'nombre', header: 'Nombre', valor: (p) => p.nombre, tarjeta: 'titulo' },
    { id: 'documento', header: 'Documento', valor: (p) => p.documento ?? '', tarjeta: 'subtitulo' },
    { id: 'tipo', header: 'Tipo', valor: (p) => NOMBRE_TIPO_PERSONA[p.tipo], tarjeta: 'badge',
      badge: (p) => ({ texto: NOMBRE_TIPO_PERSONA[p.tipo], tono: TONO_TIPO[p.tipo] }) },
    { id: 'rostros', header: 'Rostros', align: 'right', valor: (p) => p.rostros ?? 0 },
    { id: 'legal', header: 'Base legal', prioridad: 2, valor: (p) => this.textoLegal(p), tarjeta: 'cuerpo' },
    { id: 'ultimo', header: 'Último avistamiento', prioridad: 2, valor: (p) => p.ultimo_avistamiento ?? '', formato: (p) => fechaHora(p.ultimo_avistamiento), tarjeta: 'meta' },
    { id: 'activo', header: 'Activo', prioridad: 3, valor: (p) => p.activo },
  ];
  readonly columnasAvist: ColumnaTabla<Avistamiento>[] = [
    { id: 'captura', header: '', valor: () => '', ordenable: false, filtrable: false, copiable: false, ancho: '96px', tarjeta: 'oculto' },
    { id: 'persona', header: 'Persona', valor: (a) => a.persona_nombre ?? 'Desconocido', tarjeta: 'titulo' },
    { id: 'tipo', header: 'Tipo', valor: (a) => (a.persona_tipo ? NOMBRE_TIPO_PERSONA[a.persona_tipo] : ''), tarjeta: 'badge' },
    { id: 'camara', header: 'Cámara', valor: (a) => a.camara_nombre, tarjeta: 'subtitulo' },
    { id: 'sede', header: 'Sede', prioridad: 2, valor: (a) => a.sede_nombre },
    { id: 'similitud', header: 'Similitud', align: 'right', prioridad: 2, valor: (a) => a.similitud ?? '',
      formato: (a) => (a.similitud == null ? '—' : `${num(a.similitud * (a.similitud <= 1 ? 100 : 1), 0)} %`) },
    { id: 'cuando', header: 'Cuándo', valor: (a) => a.ocurrido_en, formato: (a) => fechaHora(a.ocurrido_en), tarjeta: 'meta' },
  ];
  readonly idPersona = (p: Persona) => p.id;
  readonly idAvist = (a: Avistamiento) => a.id;

  constructor() {
    this.api.ajustes().subscribe({ next: (a) => this.ajustes.set(a), error: () => {} });
    this.api.camaras().subscribe({ next: (c) => this.camaras.set(c), error: () => {} });
    this.cargar();
    this.cargarAvistamientos();
    inject(DestroyRef).onDestroy(() => this.cerrarCamara());
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.personas().subscribe({
      next: (p) => { this.personas.set([...p].sort((a, b) => a.nombre.localeCompare(b.nombre))); this.cargando.set(false); this.error.set(null); },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudieron leer las personas.')); },
    });
  }

  textoLegal(p: Persona): string {
    if (p.tipo === 'ALERTA') return p.soporte_legal ? `Soporte: ${p.soporte_legal}${p.aprobado_por ? ` · aprobó ${p.aprobado_por}` : ''}` : 'Falta soporte legal';
    if (CON_CONSENTIMIENTO.includes(p.tipo)) return p.consentimiento_en ? `Consentimiento ${soloFecha(p.consentimiento_en)}${p.consentimiento_ref ? ` (${p.consentimiento_ref})` : ''}` : 'Falta consentimiento';
    return p.consentimiento_en ? `Consentimiento ${soloFecha(p.consentimiento_en)}` : '—';
  }

  /** Lo que impide enrolar rostros de esta persona (o null si se puede). */
  motivoBloqueo(p: Persona): string | null {
    if (p.tipo === 'ALERTA' && !p.soporte_legal) return 'Para la lista de ALERTA hace falta el soporte legal (denuncia o incidente) y quién lo aprobó.';
    if (p.tipo === 'ALERTA' && !p.aprobado_por) return 'Falta registrar quién aprobó incluir a esta persona en la lista de ALERTA.';
    if (CON_CONSENTIMIENTO.includes(p.tipo) && !p.consentimiento_en) return 'Falta registrar la fecha del consentimiento informado de la persona.';
    if (!p.activo) return 'La persona está inactiva.';
    return null;
  }

  // ── Personas ─────────────────────────────────────────────────────────────
  private campos(): CampoForm[] {
    return [
      { clave: 'nombre', etiqueta: 'Nombre completo', tipo: 'texto', requerido: true, ancho: true },
      { clave: 'documento', etiqueta: 'Documento', tipo: 'texto' },
      { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', requerido: true, opciones: TIPOS.map((t) => ({ valor: t, texto: NOMBRE_TIPO_PERSONA[t] })) },
      { clave: 'consentimiento_en', etiqueta: 'Fecha del consentimiento', tipo: 'fecha', seccion: 'Base legal',
        requeridoSi: (v) => CON_CONSENTIMIENTO.includes(v['tipo']),
        ayuda: 'Obligatoria para empleados, visitantes y VIP (autorización de tratamiento de datos biométricos).' },
      { clave: 'consentimiento_ref', etiqueta: 'Referencia del consentimiento', tipo: 'texto', ayuda: 'N.º de formato, documento firmado, etc.' },
      { clave: 'soporte_legal', etiqueta: 'Soporte legal', tipo: 'area', ancho: true, visible: (v) => v['tipo'] === 'ALERTA',
        requeridoSi: (v) => v['tipo'] === 'ALERTA', placeholder: 'N.º de denuncia, incidente, orden…',
        ayuda: 'La lista de ALERTA exige un soporte (denuncia o incidente) aprobado por el área jurídica.' },
      { clave: 'aprobado_por', etiqueta: 'Aprobado por', tipo: 'texto', visible: (v) => v['tipo'] === 'ALERTA', requeridoSi: (v) => v['tipo'] === 'ALERTA' },
      { clave: 'notas', etiqueta: 'Notas', tipo: 'area', ancho: true },
      { clave: 'activo', etiqueta: 'Activa (se reconoce en las cámaras)', tipo: 'booleano', ancho: true },
    ];
  }

  async editar(p: Persona | null): Promise<void> {
    const r = await abrirFormulario<Persona>(this.dialog, {
      titulo: p ? `Editar ${p.nombre}` : 'Nueva persona', icono: 'face',
      aviso: { tono: 'warn', texto: 'Los datos biométricos son sensibles (Ley 1581 de 2012). Registre solo personas con consentimiento o, en la lista de alerta, con soporte legal aprobado.' },
      campos: this.campos(),
      valores: p ? { ...p, consentimiento_en: p.consentimiento_en?.slice(0, 10) ?? null } : { tipo: 'EMPLEADO', activo: true },
      guardar: (v) => this.api.guardarPersona(p?.id ?? null, {
        ...v, consentimiento_en: v['consentimiento_en'] ? `${String(v['consentimiento_en']).slice(0, 10)}T00:00:00` : null,
        soporte_legal: v['tipo'] === 'ALERTA' ? v['soporte_legal'] : null, aprobado_por: v['tipo'] === 'ALERTA' ? v['aprobado_por'] : null,
      } as Partial<Persona>),
    });
    if (!r) return;
    this.acciones.aviso('Persona guardada.');
    this.cargar();
    if ((r as Persona).id) this.elegir((r as Persona).id);
  }

  async borrar(p: Persona): Promise<void> {
    const ok = await confirmar(this.dialog, {
      titulo: `Borrar a ${p.nombre}`, peligro: true, boton: 'Borrar',
      texto: 'Se borran la persona y todos sus rostros (las plantillas biométricas). Los avistamientos pasados quedan sin nombre.',
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.borrarPersona(p.id));
      if (this.elegidaId() === p.id) this.elegir(null);
      this.acciones.aviso('Persona borrada.');
      this.cargar();
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar.'), true); }
  }

  elegir(id: string | null): void {
    this.cerrarCamara();
    this.errorEnrolar.set(null);
    this.elegidaId.set(id);
    this.rostros.set([]);
    if (!id) return;
    this.cargandoRostros.set(true);
    this.api.rostros(id).subscribe({
      next: (r) => { this.rostros.set(r); this.cargandoRostros.set(false); },
      error: (e) => { this.cargandoRostros.set(false); this.errorEnrolar.set(mensajeDeError(e, 'No se pudieron leer los rostros.')); },
    });
  }

  // ── Enrolar ──────────────────────────────────────────────────────────────
  async subirArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) { this.errorEnrolar.set('El archivo debe ser una imagen (JPG o PNG).'); return; }
    await this.enrolar(archivo, archivo.name);
  }

  private async enrolar(imagen: Blob, nombre: string): Promise<void> {
    const p = this.elegida();
    if (!p) return;
    const bloqueo = this.motivoBloqueo(p);
    if (bloqueo) { this.errorEnrolar.set(bloqueo); return; }
    this.enrolando.set(true);
    this.errorEnrolar.set(null);
    try {
      const r = await firstValueFrom(this.api.enrolarRostro(p.id, imagen, nombre));
      this.rostros.update((l) => [...l, r]);
      this.personas.update((l) => l.map((x) => (x.id === p.id ? { ...x, rostros: (x.rostros ?? 0) + 1 } : x)));
      this.acciones.aviso('Rostro enrolado.');
    } catch (e) {
      const st = (e as { status?: number })?.status;
      this.errorEnrolar.set(st === 422
        ? mensajeDeError(e, 'No se encontró una sola cara en la foto. Use una foto de frente, con buena luz y de una sola persona.')
        : mensajeDeError(e, 'No se pudo enrolar el rostro.'));
    } finally { this.enrolando.set(false); }
  }

  async abrirCamara(): Promise<void> {
    this.errorEnrolar.set(null);
    if (!navigator.mediaDevices?.getUserMedia) { this.errorEnrolar.set('Este navegador no deja usar la cámara (hace falta HTTPS).'); return; }
    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      this.camaraAbierta.set(true);
      // El <video> aparece en el siguiente pintado.
      setTimeout(() => {
        const v = this.video()?.nativeElement;
        if (v && this.flujo) { v.srcObject = this.flujo; v.play().catch(() => {}); }
      });
    } catch (e) {
      const n = (e as { name?: string })?.name;
      this.errorEnrolar.set(n === 'NotAllowedError' ? 'El navegador no dio permiso para la cámara. Actívelo en el candado de la barra de direcciones.'
        : n === 'NotFoundError' ? 'No se encontró una cámara en este equipo.' : 'No se pudo abrir la cámara.');
    }
  }

  async tomarFoto(): Promise<void> {
    const v = this.video()?.nativeElement;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) { this.errorEnrolar.set('No se pudo tomar la foto.'); return; }
    this.cerrarCamara();
    await this.enrolar(blob, 'camara.jpg');
  }

  cerrarCamara(): void {
    this.flujo?.getTracks().forEach((t) => t.stop());
    this.flujo = null;
    this.camaraAbierta.set(false);
  }

  async borrarRostro(r: Rostro): Promise<void> {
    const ok = await confirmar(this.dialog, { titulo: 'Borrar rostro', peligro: true, boton: 'Borrar', texto: 'Se borra esta plantilla biométrica. La persona se reconocerá con los demás rostros que tenga.' });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.borrarRostro(r.id));
      this.rostros.update((l) => l.filter((x) => x.id !== r.id));
      this.personas.update((l) => l.map((x) => (x.id === r.persona_id ? { ...x, rostros: Math.max(0, (x.rostros ?? 1) - 1) } : x)));
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'No se pudo borrar el rostro.'), true); }
  }

  // ── Avistamientos ────────────────────────────────────────────────────────
  cargarAvistamientos(): void {
    this.cargandoAvist.set(true);
    this.api.avistamientos({
      persona_id: this.filtroPersona(), camara_id: this.filtroCamara(),
      desde: this.filtroDesde() ? `${this.filtroDesde()}T00:00:00` : null, hasta: this.filtroHasta() ? `${this.filtroHasta()}T23:59:59` : null,
      limit: this.porPaginaAvist(), offset: this.paginaAvist() * this.porPaginaAvist(),
    }).subscribe({
      next: (p) => { this.avistamientos.set(p.results ?? []); this.totalAvist.set(p.count ?? 0); this.cargandoAvist.set(false); },
      error: (e) => { this.cargandoAvist.set(false); this.acciones.aviso(mensajeDeError(e, 'No se pudieron leer los avistamientos.'), true); },
    });
  }

  filtrarAvistamientos(): void { this.paginaAvist.set(0); this.cargarAvistamientos(); }
  paginar(e: { pagina: number; porPagina: number }): void { this.paginaAvist.set(e.pagina); this.porPaginaAvist.set(e.porPagina); this.cargarAvistamientos(); }
  verAvistamientosDe(p: Persona): void { this.filtroPersona.set(p.id); this.filtrarAvistamientos(); }
}
