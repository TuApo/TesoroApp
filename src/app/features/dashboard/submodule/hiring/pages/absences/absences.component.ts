import { isPlatformBrowser } from '@angular/common';
import {  Component, ElementRef, OnInit, ViewChild, Inject, PLATFORM_ID , ChangeDetectionStrategy, signal } from '@angular/core';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { SharedModule } from '@/app/shared/shared.module';
import { FormsModule } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { HiringService } from '../../service/hiring.service';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-absences',
  standalone: true,
  imports: [
    SharedModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './absences.component.html',
  styleUrl: './absences.component.css'
} )
export class AbsencesComponent implements OnInit {
  /** Ausentismos cargados (señal: la pantalla es OnPush y sin zone.js). */
  filas = signal<any[]>([]);
  /** Casillas de la tabla estándar para las acciones masivas. */
  selection = new SelectionModel<any>(true, []);

  /**
   * Columnas de la tabla estándar (búsqueda, filtros, orden y vista en
   * tarjetas los pone la tabla; la tarjeta propia va en `tablaTarjeta`).
   */
  readonly columnas: ColumnaTabla<any>[] = [
    { id: 'fecha_diligenciamiento', header: 'Fecha', valor: (r) => r.fecha_diligenciamiento, prioridad: 2 },
    { id: 'codigo_empleado', header: 'Código', valor: (r) => r.codigo_empleado, prioridad: 2 },
    { id: 'cedula', header: 'Cédula', valor: (r) => r.cedula },
    { id: 'nombre_completo', header: 'Nombre Completo', valor: (r) => r.nombre_completo, minAncho: '180px' },
    { id: 'numero_contacto', header: 'Celular', valor: (r) => r.numero_contacto, interactiva: true, prioridad: 2 },
    { id: 'correo', header: 'Correo', valor: (r) => r.correo, prioridad: 3 },
    { id: 'fecha_inicio', header: 'Fecha Inicial', valor: (r) => r.fecha_inicio },
    { id: 'total_dias', header: 'Días Ausencia', valor: (r) => this.numeroODato(r.total_dias) },
    { id: 'items', header: 'Motivo', valor: (r) => r.items || 'NO ASIGNADO', prioridad: 2 },
    { id: 'estado_actual', header: 'Estado Actual', valor: (r) => r.estado_actual?.replace('_', ' ') || 'Sin Asignar', prioridad: 2 },
  ];

  /** Días como número (ordena bien); si no es numérico se deja el dato tal cual. */
  private numeroODato(v: any): number | string | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? String(v) : n;
  }

  correo: string | null = null;
  nombreUsuario: string = '';

  // KPIs
  totalAusentismos = 0;
  gestionados = 0;
  sinAsignar = 0;

  @ViewChild('fileInput', { static: false }) private fileInputRef!: ElementRef<HTMLInputElement>;

  constructor(
    private hiringService: HiringService,
    private utilityService: UtilityServiceService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  async ngOnInit(): Promise<void> {
    const user = await this.utilityService.getUser();
    if (user) {
      this.correo = user.correo_electronico;
      this.nombreUsuario = user.nombre_completo || (user.nombres ? user.nombres + ' ' + (user.apellidos || '') : '') || this.correo || 'Gestor';
    }
    if (isPlatformBrowser(this.platformId)) {
      this.cargarDatos();
    }
  }

  calcularKPIs(data: any[]): void {
    this.totalAusentismos = data.length;
    this.gestionados = data.filter(d => d.items && d.items !== 'NO ASIGNADO').length;
    this.sinAsignar = data.filter(d => !d.items || d.items === 'NO ASIGNADO').length;
  }

  cargarDatos(): void {
    if (isPlatformBrowser(this.platformId)) {
      Swal.fire({
        title: 'Cargando datos...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
    }

    this.hiringService.obtenerAusentismos().subscribe({
      next: (data) => {
        // Arreglo nuevo a la tabla estándar (búsqueda y filtros van en la tabla).
        this.filas.set(data ?? []);
        this.selection.clear();
        this.calcularKPIs(data);
        if (isPlatformBrowser(this.platformId)) Swal.close();
      },
      error: (err) => {
        console.error(err);
        if (isPlatformBrowser(this.platformId)) Swal.fire('Error', 'No se pudieron cargar los ausentismos.', 'error');
      }
    });
  }

  exportarExcel(): void {
    if (this.filas().length === 0) {
      Swal.fire('Atención', 'No hay datos para exportar.', 'warning');
      return;
    }

    // Sheet 1: Current Statuses
    const dataActual = this.filas().map((item: any) => ({
      'Fecha': item.fecha_diligenciamiento || '',
      'Código Empleado': item.codigo_empleado || '',
      'Cédula': item.cedula || '',
      'Nombre Completo': item.nombre_completo || '',
      'Teléfono': item.numero_contacto || '',
      'Correo': item.correo || '',
      'Finca': item.finca || '',
      'Fecha Inicio': item.fecha_inicio || '',
      'Fecha Fin': item.fecha_fin || '',
      'Días': item.total_dias || 0,
      'Clasificación / Motivo': item.items || 'NO ASIGNADO',
      'Estado Actual': item.estado_actual?.replace(/_/g, ' ') || 'Sin Asignar',
      'Observación': item.observacion || '',
      'Gestor Asignado': item.gestor || ''
    }));

    // Sheet 2: Full History
    const dataHistorial: any[] = [];
    this.filas().forEach((item: any) => {
      if (item.comentarios && item.comentarios.length > 0) {
        item.comentarios.forEach((c: any) => {
          dataHistorial.push({
            'Cédula': item.cedula || '',
            'Nombre Completo': item.nombre_completo || '',
            'Finca': item.finca || '',
            'Clasificación / Motivo': item.items || 'NO ASIGNADO',
            'Fecha Registro Actividad': new Date(c.fecha_registro).toLocaleString(),
            'Comentario Historial': c.comentario || '',
            'Gestor': item.gestor || ''
          });
        });
      } else {
        // If no comments, register the initial entry to the history sheet
        dataHistorial.push({
          'Cédula': item.cedula || '',
          'Nombre Completo': item.nombre_completo || '',
          'Finca': item.finca || '',
          'Clasificación / Motivo': item.items || 'NO ASIGNADO',
          'Fecha Registro Actividad': item.fecha_diligenciamiento || '',
          'Comentario Historial': 'Sin comentarios registrados históricamente. Observación inicial: ' + (item.observacion || ''),
          'Gestor': item.gestor || ''
        });
      }
    });

    const wb = XLSX.utils.book_new();
    const wsActual = XLSX.utils.json_to_sheet(dataActual);
    const wsHistorial = XLSX.utils.json_to_sheet(dataHistorial);

    // Aesthetics / Width Formatting
    wsActual['!cols'] = [ {wch:12}, {wch:10}, {wch:15}, {wch:35}, {wch:15}, {wch:30}, {wch:15}, {wch:12}, {wch:12}, {wch:6}, {wch:25}, {wch:25}, {wch:40}, {wch:25} ];
    wsHistorial['!cols'] = [ {wch:15}, {wch:35}, {wch:15}, {wch:25}, {wch:25}, {wch:60}, {wch:25} ];

    XLSX.utils.book_append_sheet(wb, wsActual, 'Ausentismos Actuales');
    XLSX.utils.book_append_sheet(wb, wsHistorial, 'Historial de Casos');

    const fileName = `Reporte_Ausentismos_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  // Notificación Masiva
  async enviarNotificacionSeleccionados() {
    const selected = this.selection.selected;
    if (selected.length === 0) return;

    Swal.fire({ title: 'Cargando plantillas de correo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    let plantillasCorreo: any[] = [];
    try {
      plantillasCorreo = await firstValueFrom(this.hiringService.obtenerMensajes('CORREO'));
      Swal.close();
    } catch {
      Swal.fire('Error', 'No se pudieron cargar las plantillas de correo', 'error');
      return;
    }

    let inputOptions: any = {};
    inputOptions[''] = 'Mensaje por Defecto';
    plantillasCorreo.forEach(p => {
      inputOptions[p.id] = p.titulo;
    });

    const { value: selectedTemplateId, isConfirmed } = await Swal.fire({
      title: 'Enviar Notificaciones',
      text: `Se enviarán correos a ${selected.length} colaboradores. Selecciona la plantilla a usar:`,
      icon: 'question',
      input: 'select',
      inputOptions: inputOptions,
      inputPlaceholder: 'Selecciona una plantilla',
      showCancelButton: true,
      confirmButtonText: 'Sí, enviar',
      cancelButtonText: 'Cancelar'
    });

    if (isConfirmed) {
      // Nueva Lógica: Vista Previa
      const plantillaSeleccionada = plantillasCorreo.find(p => String(p.id) === String(selectedTemplateId));
      let previewHTML = '';
      
      if (plantillaSeleccionada) {
         let tempHTML = plantillaSeleccionada.mensaje;
         // Toma el primer empleado como ejemplo para la vista previa
         const testEmp = selected[0];
         tempHTML = tempHTML.replace(/\[NOMBRE\]/g, testEmp.nombre_completo);
         tempHTML = tempHTML.replace(/\[DIAS\]/g, String(testEmp.total_dias || 0));
         tempHTML = tempHTML.replace(/\[CEDULA\]/g, testEmp.cedula);
         tempHTML = tempHTML.replace(/\[FINCA\]/g, testEmp.finca || '');
         tempHTML = tempHTML.replace(/\[ITEMS\]/g, testEmp.items || '');
         tempHTML = tempHTML.replace(/\[INICIO\]/g, String(testEmp.fecha_inicio || ''));
         tempHTML = tempHTML.replace(/\[FIN\]/g, String(testEmp.fecha_fin || ''));
         
         previewHTML = `
          <div style="background:#f1f5f9; padding: 10px; border-radius: 6px; text-align: left; font-size: 13px; max-height: 200px; overflow-y: auto;">
             <p style="margin:0 0 5px 0; color:#475569;"><b>Asunto:</b> ${plantillaSeleccionada.asunto.replace(/\[NOMBRE\]/g, testEmp.nombre_completo)}</p>
             <hr style="margin: 5px 0;">
             ${tempHTML}
          </div>
         `;
      } else {
         const testEmp = selected[0];
         previewHTML = `
          <div style="background:#f1f5f9; padding: 10px; border-radius: 6px; text-align: left; font-size: 13px; max-height: 200px; overflow-y: auto;">
             <p style="margin:0 0 5px 0; color:#475569;"><b>Asunto:</b> Notificación de Ausentismo: ${testEmp.items || 'Registro'}</p>
             <hr style="margin: 5px 0;">
             Hola ${testEmp.nombre_completo},<br><br>
             Se ha registrado una novedad de ausentismo bajo el concepto de '<b>${testEmp.items || 'NO ASIGNADO'}</b>'.<br>
             Fechas: ${testEmp.fecha_inicio} al ${testEmp.fecha_fin}.<br>
             Días de ausencia: ${testEmp.total_dias}<br><br>
             Por favor, revisa esta novedad y comunícate con tu gestor o la oficina correspondiente.
          </div>
         `;
      }

      const confirmPreview = await Swal.fire({
         title: 'Vista Previa del Correo',
         text: `Así se verá el correo (ejemplo usando a ${selected[0].nombre_completo}). ¿Deseas enviarlo a los ${selected.length} colaboradores?`,
         html: previewHTML,
         icon: 'info',
         showCancelButton: true,
         confirmButtonText: 'Sí, Enviar a Todos',
         cancelButtonText: 'Cancelar',
         width: '600px'
      });

      if (confirmPreview.isConfirmed) {
        Swal.fire({
          title: 'Enviando...',
          text: 'Por favor espera mientras se procesan los envíos por Gmail API',
          allowOutsideClick: false,
          didOpen: () => Swal.showLoading()
        });

        const ids = selected.map(s => s.id);
        
        try {
          const plantilla_id = selectedTemplateId ? Number(selectedTemplateId) : null;
          const res = await this.hiringService.enviarNotificacionMasivaAusentismos(ids, plantilla_id);
          Swal.fire({
            icon: 'success',
            title: 'Envíos Completados',
            html: `
              <strong>Exitosos:</strong> ${res.notificados}<br>
              <strong>Fallidos:</strong> ${res.fallidos}
              ${res.errores?.length ? `<br><small style="color:red; max-height:100px; overflow:auto; display:block;">${res.errores.join('<br>')}</small>` : ''}
            `
          });
          this.selection.clear();
        } catch (error) {
          Swal.fire('Error', 'Hubo un problema enviando las notificaciones.', 'error');
        }
      }
    }
  }

  abrirModalGestion(element: any): void {
    Swal.fire({
      title: `Gestionar Ausentismo`,
      html: `
        <div style="text-align: left;">
          <p><strong>Colaborador:</strong> ${element.nombre_completo}</p>
          <p><strong>Cédula:</strong> ${element.cedula}</p>
          <hr>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <label for="swal-gestor">Gestor:</label>
            <input id="swal-gestor" class="swal2-input" value="${element.gestor || this.nombreUsuario}" readonly style="margin: 0; width: 100%; background: #e2e8f0; cursor: not-allowed; color: #475569;">
            
            <label for="swal-items">Clasificación:</label>
            <select id="swal-items" class="swal2-select" style="margin: 0; width: 100%; display: flex;">
              <option value="NO ASIGNADO" ${!element.items || element.items === 'NO ASIGNADO' ? 'selected' : ''}>NO ASIGNADO</option>
              <option value="INCAPACIDAD" ${element.items === 'INCAPACIDAD' ? 'selected' : ''}>INCAPACIDAD</option>
              <option value="SIN COMUNICACIÓN" ${element.items === 'SIN COMUNICACIÓN' ? 'selected' : ''}>SIN COMUNICACIÓN</option>
              <option value="DEJO LA RUTA" ${element.items === 'DEJO LA RUTA' ? 'selected' : ''}>DEJO LA RUTA</option>
              <option value="ENFERMO" ${element.items === 'ENFERMO' ? 'selected' : ''}>ENFERMO</option>
              <option value="NOVEDAD PERSONAL" ${element.items === 'NOVEDAD PERSONAL' ? 'selected' : ''}>NOVEDAD PERSONAL</option>
              <option value="SE RETIRA" ${element.items === 'SE RETIRA' ? 'selected' : ''}>SE RETIRA</option>
              <option value="SE ENCUENTRA TRABAJANDO EN LA FINCA" ${element.items === 'SE ENCUENTRA TRABAJANDO EN LA FINCA' ? 'selected' : ''}>SE ENCUENTRA TRABAJANDO EN LA FINCA</option>
            </select>
            
            <label for="swal-estado_actual">Estado Actual:</label>
            <select id="swal-estado_actual" class="swal2-select" style="margin: 0; width: 100%; display: flex;">
              <option value="" ${!element.estado_actual ? 'selected' : ''}>-- No especificado --</option>
              <option value="NO_CONTESTA_1" ${element.estado_actual === 'NO_CONTESTA_1' ? 'selected' : ''}>No contesta primera</option>
              <option value="NO_CONTESTA_2" ${element.estado_actual === 'NO_CONTESTA_2' ? 'selected' : ''}>No contesta segunda</option>
              <option value="NO_CONTESTA_3" ${element.estado_actual === 'NO_CONTESTA_3' ? 'selected' : ''}>No contesta tercera</option>
              <option value="NOTIFICACION_1" ${element.estado_actual === 'NOTIFICACION_1' ? 'selected' : ''}>Notificación primera</option>
              <option value="NOTIFICACION_2" ${element.estado_actual === 'NOTIFICACION_2' ? 'selected' : ''}>Notificación segunda</option>
              <option value="NOTIFICACION_3" ${element.estado_actual === 'NOTIFICACION_3' ? 'selected' : ''}>Notificación tercera</option>
              <option value="NOTIFICACION_RETIRO" ${element.estado_actual === 'NOTIFICACION_RETIRO' ? 'selected' : ''}>Notificación de retiro enviada</option>
            </select>

            <label for="swal-observacion">Observación actual:</label>
            <textarea id="swal-observacion" class="swal2-textarea" style="margin: 0; width: 100%; height: 60px;">${element.observacion || ''}</textarea>
            
            <label for="swal-comentario"><strong>Nuevo comentario (Historial):</strong></label>
            <textarea id="swal-comentario" class="swal2-textarea" placeholder="Agrega un nuevo hito o comentario para el historial..." style="margin: 0; width: 100%; height: 80px;"></textarea>
          </div>
          
          <div style="margin-top: 20px; max-height: 150px; overflow-y: auto; background: #f9f9f9; padding: 10px; border-radius: 8px;">
            <b>Historial de Comentarios:</b>
            <ul style="padding-left: 20px; font-size: 0.9em; margin-bottom: 0;">
              ${element.comentarios?.length ? element.comentarios.map((c: any) => `<li>[${new Date(c.fecha_registro).toLocaleString()}] ${c.comentario}</li>`).join('') : '<li>Sin comentarios históricos.</li>'}
            </ul>
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      width: '600px',
      preConfirm: () => {
        return {
          gestor: (document.getElementById('swal-gestor') as HTMLInputElement).value,
          items: (document.getElementById('swal-items') as HTMLSelectElement).value,
          estado_actual: (document.getElementById('swal-estado_actual') as HTMLSelectElement).value,
          observacion: (document.getElementById('swal-observacion') as HTMLTextAreaElement).value,
          comentario_nuevo: (document.getElementById('swal-comentario') as HTMLTextAreaElement).value
        }
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
          await this.hiringService.gestionarAusentismo(element.id, result.value);
          Swal.fire('Guardado', 'La gestión se ha actualizado correctamente.', 'success');
          this.cargarDatos(); // Recargar para ver historial
        } catch (error) {
          Swal.fire('Error', 'No se pudo guardar la gestión.', 'error');
        }
      }
    });
  }

  triggerFileInput(): void {
    this.fileInputRef?.nativeElement?.click();
  }

  cargarExcelAusentismos(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;

    Swal.fire({
      title: 'Procesando...',
      text: 'Por favor espera mientras se sube el archivo de ausentismos.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.hiringService.subirAusentismosExcel(file)
      .then((response: any) => {
        Swal.fire({
          icon: 'success',
          title: 'Carga Completa',
          html: `
            <strong>Nuevos registros:</strong> ${response.created}<br>
            <strong>Actualizados:</strong> ${response.updated}<br>
            ${response.errors?.length ? `<strong>Errores:</strong> ${response.errors.length} filas fallaron.` : ''}
          `
        });
        this.cargarDatos(); // Refresh table
      })
      .catch((error: any) => {
        Swal.fire({
          icon: 'error',
          title: 'Error de carga',
          text: error?.error?.detail || 'Ocurrió un error procesando el Excel.'
        });
      })
      .finally(() => {
        if (this.fileInputRef?.nativeElement) {
          this.fileInputRef.nativeElement.value = '';
        }
      });
  }

  // Menú de WhatsApp
  async abrirMenuWhatsapp(element: any, event: Event): Promise<void> {
    event.stopPropagation();
    if (!element.numero_contacto) return;

    Swal.fire({ title: 'Cargando plantillas de WhatsApp...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    let plantillasWA: any[] = [];
    try {
      plantillasWA = await firstValueFrom(this.hiringService.obtenerMensajes('WHATSAPP'));
      Swal.close();
    } catch {
      Swal.fire('Error', 'No se pudieron cargar las plantillas', 'error');
      return;
    }

    if (plantillasWA.length === 0) {
      window.open(`https://wa.me/57${element.numero_contacto}`, '_blank');
      return;
    }

    let inputOptions: any = {};
    plantillasWA.forEach(p => {
      inputOptions[p.id] = p.titulo;
    });

    const { value: selectedTemplateId, isConfirmed } = await Swal.fire({
      title: 'Enviar Mensaje',
      text: 'Selecciona una plantilla para contactar al colaborador:',
      input: 'radio',
      inputOptions: inputOptions,
      showCancelButton: true,
      confirmButtonText: 'Ir a WhatsApp',
      cancelButtonText: 'Cancelar'
    });

    if (isConfirmed && selectedTemplateId) {
      const plantilla = plantillasWA.find(p => String(p.id) === String(selectedTemplateId));
      if (plantilla) {
        let textoFinal = plantilla.mensaje.replace(/\[NOMBRE\]/g, element.nombre_completo);
        textoFinal = textoFinal.replace(/\[DIAS\]/g, String(element.total_dias || 0));
        // Codificamos texto para la url de Whatsapp
        const mensajeCodificado = encodeURIComponent(textoFinal);
        window.open(`https://wa.me/57${element.numero_contacto}?text=${mensajeCodificado}`, '_blank');
      }
    }
  }

  // Pantalla de Configuración de Mensajes
  async configurarMensajes(): Promise<void> {
    Swal.fire({ title: 'Cargando mensajes...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    let mensajes: any[] = [];
    try {
      mensajes = await firstValueFrom(this.hiringService.obtenerMensajes());
      Swal.close();
    } catch {
      Swal.fire('Error', 'No se pudieron cargar los mensajes', 'error');
      return;
    }

    const renderMensaje = (m: any) => `
      <div style="border:1px solid #e2e8f0; padding:10px; margin-bottom:8px; border-radius:6px; background:#fff; position:relative; text-align: left;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:5px;">
          <strong style="font-size:13px; color:#1e293b; padding-right: 25px;">${m.titulo}</strong>
          <button id="del-msg-${m.id}" data-id="${m.id}" class="borrar-mensaje-btn" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:0; position:absolute; right:10px; top:10px;">
            <svg style="width:16px; height:16px; pointer-events:none;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
        ${m.asunto ? `<p style="margin:0 0 4px 0; font-size:12px; color:#10b981;"><b>Asunto:</b> ${m.asunto}</p>` : ''}
        <p style="margin:0; font-size:12px; color:#64748b; white-space: pre-wrap;">${m.mensaje}</p>
      </div>
    `;

    const msgsWA = mensajes.filter(m => m.tipo === 'WHATSAPP');
    const msgsCorreo = mensajes.filter(m => m.tipo === 'CORREO');

    const htmlWA = msgsWA.length ? msgsWA.map(m => renderMensaje(m)).join('') : '<p style="font-size:12px; color:#94a3b8; text-align:center; padding: 10px 0;">Sin plantillas guardadas</p>';
    const htmlCorreo = msgsCorreo.length ? msgsCorreo.map(m => renderMensaje(m)).join('') : '<p style="font-size:12px; color:#94a3b8; text-align:center; padding: 10px 0;">Sin plantillas guardadas</p>';

    Swal.fire({
      title: 'Configuración de Mensajes',
      html: `
        <div class="swal-messages-container" style="display: flex; flex-direction: column; gap: 20px; text-align: left;">
          
          <!-- Lista de Mensajes (Responsive) -->
          <div style="display: flex; flex-wrap: wrap; gap: 15px;">
            <!-- Column WA -->
            <div style="flex: 1; min-width: 250px; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; max-height: 250px; overflow-y: auto;">
              <h4 style="margin: 0 0 15px 0; font-size: 15px; display: flex; align-items: center; gap: 6px; color: #16a34a;">
                <svg style="width:20px;height:20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.573-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86s.274.072.376-.043c.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z"/></svg> 
                Plantillas WhatsApp
              </h4>
              ${htmlWA}
            </div>
            
            <!-- Column Correo -->
            <div style="flex: 1; min-width: 250px; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; max-height: 250px; overflow-y: auto;">
              <h4 style="margin: 0 0 15px 0; font-size: 15px; display: flex; align-items: center; gap: 6px; color: #ea580c;">
                <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                Plantillas Correo
              </h4>
              ${htmlCorreo}
            </div>
          </div>

          <!-- Modulo Variables -->
          <div style="background: #e0f2fe; padding: 15px; border-radius: 8px; border: 1px solid #bae6fd;">
            <h4 style="margin: 0 0 8px 0; color: #0369a1; font-size: 14px;"><strong>&lt;/&gt;</strong> Variables Disponibles</h4>
            <p style="font-size: 12px; margin-bottom: 8px; color: #0284c7;">Escribe estas etiquetas en tu nuevo mensaje para que sean reemplazadas dinámicamente al enviar:</p>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              <span style="background: #fff; border: 1px dashed #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #0369a1; cursor: default;">[NOMBRE]</span>
              <span style="background: #fff; border: 1px dashed #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #0369a1; cursor: default;">[DIAS]</span>
              <span style="background: #fff; border: 1px dashed #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #0369a1; cursor: default;">[CEDULA]</span>
              <span style="background: #fff; border: 1px dashed #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #0369a1; cursor: default;">[FINCA]</span>
              <span style="background: #fff; border: 1px dashed #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #0369a1; cursor: default;">[ITEMS]</span>
              <span style="background: #fff; border: 1px dashed #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #0369a1; cursor: default;">[INICIO]</span>
              <span style="background: #fff; border: 1px dashed #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #0369a1; cursor: default;">[FIN]</span>
            </div>
            <p style="font-size: 11px; margin-top: 8px; margin-bottom: 0; color: #0284c7;"><strong>Nota para Correo:</strong> Puedes usar etiquetas HTML para el diseño, por ejemplo: <code>&lt;b&gt;negrita&lt;/b&gt;</code>, <code>&lt;br&gt;</code> para cambio de línea, <code>&lt;a href="..."&gt;</code> para un link.</p>
          </div>

          <hr style="margin: 0; border: 0; border-top: 1px solid #e2e8f0;">

          <!-- Form Crear -->
          <div>
            <h4 style="margin: 0 0 10px 0; font-size: 15px; color: #334155;">Crear Nueva Plantilla</h4>
            <div style="display:flex; flex-direction:column; gap:10px;">
              <select id="n-tipo" class="swal2-select" style="margin:0; width:100%; font-size:14px; padding: 8px;" onchange="
                if(this.value === 'WHATSAPP') {
                  document.getElementById('n-asunto').style.display = 'none';
                } else {
                  document.getElementById('n-asunto').style.display = 'block';
                }
              ">
                <option value="WHATSAPP">Formato: WhatsApp</option>
                <option value="CORREO">Formato: Correo Electrónico (Admite HTML)</option>
              </select>
              <input id="n-titulo" class="swal2-input" placeholder="Nombre de la Plantilla (Ej. Incapacidad vencida)" style="margin:0; width:100%; font-size:14px; box-sizing: border-box;">
              <input id="n-asunto" class="swal2-input" placeholder="Asunto del Correo (Obligatorio para correo)" style="margin:0; width:100%; font-size:14px; display:none; box-sizing: border-box;">
              <textarea id="n-mensaje" class="swal2-textarea" placeholder="Escribe tu mensaje aquí integrando las variables necesarias..." style="margin:0; width:100%; min-height:100px; font-size:14px; box-sizing: border-box;"></textarea>
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear Mensaje',
      cancelButtonText: 'Cerrar Menu',
      width: '850px',
      customClass: {
        popup: 'modal-responsive-plantillas',
      },
      preConfirm: () => {
        const tipo = (document.getElementById('n-tipo') as HTMLSelectElement).value;
        const titulo = (document.getElementById('n-titulo') as HTMLInputElement).value;
        const asunto = (document.getElementById('n-asunto') as HTMLInputElement).value;
        const mensaje = (document.getElementById('n-mensaje') as HTMLTextAreaElement).value;

        if (!titulo || !mensaje) {
          Swal.showValidationMessage('El Nombre de la Plantilla y el Cuerpo del mensaje son requeridos.');
          return false;
        }

        if (tipo === 'CORREO' && !asunto) {
           Swal.showValidationMessage('Para los correos electrónicos debes especificar un asunto.');
           return false;
        }

        return { tipo, titulo, asunto: tipo === 'CORREO' ? asunto : '', mensaje };
      },
      didRender: () => {
        const btns = document.querySelectorAll('.borrar-mensaje-btn');
        btns.forEach(btn => {
          btn.addEventListener('click', async (e: any) => {
            let target = e.target;
            while(target && target.tagName !== 'BUTTON') {
              target = target.parentElement;
            }
            if(!target) return;
            const id = target.getAttribute('data-id');
            const confirmar = await Swal.fire({ title: '¿Eliminar mensaje?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, Eliminar' });
            if (confirmar.isConfirmed) {
              Swal.fire({ title: 'Eliminando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
              try {
                await this.hiringService.eliminarMensaje(id);
                this.configurarMensajes(); // reabrir para refrescar
              } catch {
                Swal.fire('Error', 'No se pudo eliminar el mensaje.', 'error');
              }
            }
          });
        });
      }
    }).then(async (result) => {
      if (result.isConfirmed && result.value) {
        Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
          await this.hiringService.crearMensaje(result.value);
          Swal.fire('Éxito', 'Mensaje creado correctamente', 'success').then(() => {
            this.configurarMensajes(); // Volver a abrir para ver el cambio
          });
        } catch (error) {
          Swal.fire('Error', 'No se pudo guardar el mensaje', 'error');
        }
      }
    });
  }
}
