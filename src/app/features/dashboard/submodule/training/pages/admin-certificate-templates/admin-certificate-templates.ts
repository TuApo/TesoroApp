import { Component, ChangeDetectionStrategy, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import Swal from 'sweetalert2';
import {
  TrainingAdminService, PlantillaCertificado, PlantillaRequest, BasePlantilla
} from '../../service/training-admin.service';

/** Lo que se edita. Es el request más el id cuando ya existe. */
type FormPlantilla = Required<Omit<PlantillaRequest, 'base' | 'orientacion'>> & {
  id?: string; base: BasePlantilla; orientacion: 'HORIZONTAL' | 'VERTICAL';
};

/**
 * Plantillas de certificado: cómo se ve el diploma de cada curso.
 *
 * No se edita HTML: se eligen decisiones —una base de diseño de la empresa, colores, textos,
 * logo y firmas— y el servidor pinta el PDF. Así un certificado de alturas y uno de
 * inducción pueden verse distintos sin que ninguno deje de parecer de la empresa, y nadie
 * puede dejar una etiqueta sin cerrar que se descubra al emitir.
 *
 * La vista previa es un PDF de verdad, generado con datos ficticios: lo que se ve es lo que
 * se imprime.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-certificate-templates',
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './admin-certificate-templates.html',
  styleUrl: './admin-certificate-templates.css'
})
export class AdminCertificateTemplates implements OnInit, OnDestroy {
  private api = inject(TrainingAdminService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  readonly plantillas = signal<PlantillaCertificado[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly subiendo = signal<string | null>(null);

  readonly editando = signal<FormPlantilla | null>(null);
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly previewCargando = signal(false);
  private previewObjectUrl: string | null = null;

  readonly bases: { valor: BasePlantilla; nombre: string; ayuda: string; icono: string }[] = [
    { valor: 'CLASICA', nombre: 'Clásica', icono: 'crop_landscape', ayuda: 'Marco doble, todo centrado, logo arriba. La de siempre.' },
    { valor: 'MODERNA', nombre: 'Moderna', icono: 'view_sidebar', ayuda: 'Banda de color a la izquierda con el logo; texto alineado a la izquierda.' },
    { valor: 'FORMAL',  nombre: 'Formal',  icono: 'history_edu', ayuda: 'Tipografía serif, filete y marco fino: tono de diploma.' },
  ];

  readonly marcadores = [
    ['{{nombre}}', 'nombre completo'], ['{{cedula}}', 'documento'], ['{{curso}}', 'nombre del curso'],
    ['{{fecha}}', 'fecha de emisión'], ['{{nota}}', 'calificación'], ['{{horas}}', 'intensidad en horas'],
    ['{{horas_frase}}', '«, con una intensidad de N horas» (vacío si el curso no tiene horas)'],
    ['{{entidad}}', 'entidad capacitadora'], ['{{codigo}}', 'código del certificado'],
    ['{{vence}}', 'vigencia'], ['{{version}}', 'versión del curso'],
  ];

  readonly predeterminada = computed(() => this.plantillas().find(p => p.predeterminada) ?? null);

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  ngOnDestroy(): void {
    this.soltarPreview();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.plantillas.set(await this.api.listarPlantillas());
    } catch (e: any) {
      this.error.set(e?.status === 403
        ? 'Tu rol no tiene permiso para administrar formación.'
        : 'No pudimos cargar las plantillas. Vuelve a intentar en un momento.');
    } finally {
      this.cargando.set(false);
    }
  }

  volver(): void {
    this.router.navigate(['/dashboard/capacitaciones/tablero']);
  }

  // ── Editor ────────────────────────────────────────────────────────────────

  nuevo(): void {
    this.editando.set({
      nombre: '', descripcion: '', base: 'CLASICA',
      color_primario: '#194262', color_secundario: '#2d6a4f',
      titulo: 'CERTIFICADO DE FORMACIÓN', subtitulo: '',
      texto_principal: 'Se certifica que <strong>{{nombre}}</strong>, identificado(a) con documento '
        + '{{cedula}}, participó y aprobó el curso <strong>{{curso}}</strong>{{horas_frase}}.',
      texto_pie: 'Verifique la autenticidad de este documento escaneando el código QR.',
      logo_document_id: null,
      firma1_nombre: '', firma1_cargo: '', firma1_document_id: null,
      firma2_nombre: '', firma2_cargo: '', firma2_document_id: null,
      mostrar_nota: true, mostrar_qr: true, mostrar_horas: true, mostrar_vigencia: true,
      orientacion: 'HORIZONTAL',
    });
    this.soltarPreview();
  }

  editar(p: PlantillaCertificado): void {
    this.editando.set({
      id: p.id, nombre: p.nombre, descripcion: p.descripcion ?? '', base: p.base,
      color_primario: p.color_primario ?? '#194262', color_secundario: p.color_secundario ?? '#2d6a4f',
      titulo: p.titulo ?? '', subtitulo: p.subtitulo ?? '',
      texto_principal: p.texto_principal ?? '', texto_pie: p.texto_pie ?? '',
      logo_document_id: p.logo_document_id ?? null,
      firma1_nombre: p.firma1_nombre ?? '', firma1_cargo: p.firma1_cargo ?? '', firma1_document_id: p.firma1_document_id ?? null,
      firma2_nombre: p.firma2_nombre ?? '', firma2_cargo: p.firma2_cargo ?? '', firma2_document_id: p.firma2_document_id ?? null,
      mostrar_nota: p.mostrar_nota, mostrar_qr: p.mostrar_qr, mostrar_horas: p.mostrar_horas, mostrar_vigencia: p.mostrar_vigencia,
      orientacion: p.orientacion,
    });
    this.soltarPreview();
    void this.previsualizar();
  }

  cerrar(): void {
    this.editando.set(null);
    this.soltarPreview();
  }

  campo<K extends keyof FormPlantilla>(clave: K, valor: FormPlantilla[K]): void {
    this.editando.update(f => f ? { ...f, [clave]: valor } : f);
  }

  private aRequest(f: FormPlantilla): PlantillaRequest {
    const limpio = (s: string | null | undefined) => (s ?? '').trim() || null;
    return {
      nombre: f.nombre.trim(), descripcion: limpio(f.descripcion), base: f.base,
      color_primario: limpio(f.color_primario), color_secundario: limpio(f.color_secundario),
      titulo: limpio(f.titulo), subtitulo: limpio(f.subtitulo),
      texto_principal: limpio(f.texto_principal), texto_pie: limpio(f.texto_pie),
      logo_document_id: f.logo_document_id || null,
      firma1_nombre: limpio(f.firma1_nombre), firma1_cargo: limpio(f.firma1_cargo), firma1_document_id: f.firma1_document_id || null,
      firma2_nombre: limpio(f.firma2_nombre), firma2_cargo: limpio(f.firma2_cargo), firma2_document_id: f.firma2_document_id || null,
      mostrar_nota: f.mostrar_nota, mostrar_qr: f.mostrar_qr, mostrar_horas: f.mostrar_horas, mostrar_vigencia: f.mostrar_vigencia,
      orientacion: f.orientacion,
    };
  }

  async guardar(): Promise<void> {
    const f = this.editando();
    if (!f || this.guardando()) return;
    if (!f.nombre.trim()) {
      Swal.fire('Falta el nombre', 'Ponle un nombre a la plantilla para reconocerla en el curso.', 'info');
      return;
    }
    this.guardando.set(true);
    try {
      const req = this.aRequest({ ...f, nombre: f.nombre });
      if (f.id) await this.api.actualizarPlantilla(f.id, req);
      else await this.api.crearPlantilla(req);
      this.cerrar();
      await this.cargar();
      Swal.fire('Plantilla guardada', 'Los certificados que la usen se imprimen ya con este diseño.', 'success');
    } catch (e: any) {
      Swal.fire('No se pudo guardar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Un PDF de verdad, con datos ficticios, de lo que hay en el formulario ahora mismo. */
  async previsualizar(): Promise<void> {
    const f = this.editando();
    if (!f || this.previewCargando()) return;
    this.previewCargando.set(true);
    try {
      const blob = await this.api.muestraDePlantilla(this.aRequest({ ...f, nombre: f.nombre || 'Muestra' }));
      this.soltarPreview();
      this.previewObjectUrl = URL.createObjectURL(blob);
      this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl + '#toolbar=0&view=FitH'));
    } catch (e: any) {
      Swal.fire('No se pudo generar la muestra', e?.error?.message ?? 'Revisa los colores y los textos.', 'error');
    } finally {
      this.previewCargando.set(false);
    }
  }

  private soltarPreview(): void {
    if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
    this.previewObjectUrl = null;
    this.previewUrl.set(null);
  }

  async subirImagen(clave: 'logo_document_id' | 'firma1_document_id' | 'firma2_document_id', evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (archivo.size > 3 * 1024 * 1024) {
      Swal.fire('Imagen muy grande', 'Usa una imagen de hasta 3 MB: va incrustada en cada PDF.', 'info');
      return;
    }
    this.subiendo.set(clave);
    try {
      const id = await this.api.subirImagenDePlantilla(archivo);
      this.campo(clave, id);
    } catch (e: any) {
      Swal.fire('No se pudo subir', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    } finally {
      this.subiendo.set(null);
    }
  }

  quitarImagen(clave: 'logo_document_id' | 'firma1_document_id' | 'firma2_document_id'): void {
    this.campo(clave, null);
  }

  // ── Acciones sobre la lista ───────────────────────────────────────────────

  async predeterminar(p: PlantillaCertificado): Promise<void> {
    try {
      await this.api.predeterminarPlantilla(p.id);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo cambiar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    }
  }

  async eliminar(p: PlantillaCertificado): Promise<void> {
    const r = await Swal.fire({
      title: `¿Borrar «${p.nombre}»?`,
      text: p.cursos_que_la_usan > 0
        ? `${p.cursos_que_la_usan} curso(s) la tienen elegida: pasarán a imprimir con la predeterminada.`
        : 'Ningún curso la usa.',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.eliminarPlantilla(p.id);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo borrar', e?.error?.message ?? 'Inténtalo de nuevo.', 'error');
    }
  }

  nombreBase(base: BasePlantilla): string {
    return this.bases.find(b => b.valor === base)?.nombre ?? base;
  }
}
