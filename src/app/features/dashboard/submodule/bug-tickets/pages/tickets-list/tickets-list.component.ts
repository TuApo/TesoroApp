import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, ViewChild, AfterViewInit, ElementRef } from '@angular/core';
import { SharedModule } from '../../../../../../shared/shared.module';
import { TicketsService, BugTicket, TicketComentario } from '../../services/tickets.service';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';
import { FormControl } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-tickets-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  templateUrl: './tickets-list.component.html',
  styleUrl: './tickets-list.component.css',
})
export class TicketsListComponent implements OnInit, AfterViewInit {
  displayedColumns = ['titulo', 'prioridad', 'estado', 'usuario', 'fecha_reporte', 'acciones'];
  dataSource = new MatTableDataSource<any>([]);
  loading = true;

  filtroEstado = new FormControl('');
  filtroPrioridad = new FormControl('');
  filtroBusqueda = new FormControl('');

  estados = ['Abierto', 'En Progreso', 'Resuelto', 'Cerrado'];
  prioridades = ['Baja', 'Media', 'Alta', 'Critica'];

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild('chatContainer') chatContainer!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  ticketSeleccionado: BugTicket | null = null;
  mostrarDetalle = false;
  cargandoDetalle = false;

  // Comentarios
  nuevoComentario = '';
  enviandoComentario = false;
  archivoSeleccionado: File | null = null;
  archivoPreview: string | null = null;

  // Chat unificado (comentarios + eventos de historial)
  chatItems: any[] = [];

  promptGenerado = false;
  aiAnalisisExpandido = true;
  aiSugerenciaExpandida = true;

  constructor(
    private ticketsService: TicketsService,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      if (params['estado']) this.filtroEstado.setValue(params['estado']);
      if (params['prioridad']) this.filtroPrioridad.setValue(params['prioridad']);
      this.cargarTickets();
    });

    this.filtroBusqueda.valueChanges.subscribe((val) => {
      this.dataSource.filter = (val || '').trim().toLowerCase();
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  cargarTickets(): void {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.filtroEstado.value) params['estado'] = this.filtroEstado.value;
    if (this.filtroPrioridad.value) params['prioridad'] = this.filtroPrioridad.value;

    this.ticketsService.listarTickets(params).subscribe({
      next: (data: any) => {
        const lista = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        this.dataSource.data = lista;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.dataSource.data = [];
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  filtrar(): void {
    this.cargarTickets();
  }

  limpiarFiltros(): void {
    this.filtroEstado.reset();
    this.filtroPrioridad.reset();
    this.filtroBusqueda.reset();
    this.cargarTickets();
  }

  verDetalle(ticket: any): void {
    this.mostrarDetalle = true;
    this.cargandoDetalle = true;
    this.ticketSeleccionado = null;
    this.nuevoComentario = '';
    this.aiAnalisisExpandido = true;
    this.aiSugerenciaExpandida = true;
    this.limpiarArchivo();
    this.cdr.markForCheck();

    this.ticketsService.obtenerTicket(ticket.id).subscribe({
      next: (data: BugTicket) => {
        this.ticketSeleccionado = data;
        this.construirChatUnificado();
        this.cargandoDetalle = false;
        this.cdr.markForCheck();
        this.scrollChatAlFinal();
      },
      error: () => {
        this.ticketSeleccionado = ticket;
        this.cargandoDetalle = false;
        this.cdr.markForCheck();
      },
    });
  }

  cerrarDetalle(): void {
    this.mostrarDetalle = false;
    this.ticketSeleccionado = null;
    this.limpiarArchivo();
    this.cdr.markForCheck();
  }

  async cambiarEstado(ticket: any, nuevoEstado: string): Promise<void> {
    const { value: comentario } = await Swal.fire({
      title: `Cambiar a "${nuevoEstado}"`,
      input: 'textarea',
      inputLabel: 'Comentario (opcional)',
      inputPlaceholder: 'Agrega un comentario sobre el cambio...',
      showCancelButton: true,
      confirmButtonText: 'Cambiar Estado',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3b82f6',
    });

    if (comentario === undefined) return;

    this.ticketsService.actualizarEstado(ticket.id, nuevoEstado, comentario || '').subscribe({
      next: () => {
        Swal.fire({ title: 'Actualizado', text: `El ticket ahora esta "${nuevoEstado}".`, icon: 'success', timer: 2000, showConfirmButton: false });
        this.cargarTickets();
        if (this.mostrarDetalle && this.ticketSeleccionado?.id === ticket.id) {
          this.verDetalle(ticket);
        }
      },
      error: () => {
        Swal.fire('Error', 'No se pudo actualizar el estado.', 'error');
      },
    });
  }

  async asignarTicket(ticket: any): Promise<void> {
    const { value: asignadoA } = await Swal.fire({
      title: 'Asignar Ticket',
      input: 'text',
      inputLabel: 'A quien se asigna este ticket?',
      inputPlaceholder: 'Nombre del responsable...',
      inputValue: ticket.asignado_a || '',
      showCancelButton: true,
      confirmButtonText: 'Asignar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3b82f6',
    });

    if (!asignadoA) return;

    this.ticketsService.asignarTicket(ticket.id, asignadoA).subscribe({
      next: () => {
        Swal.fire({ title: 'Asignado', text: `Ticket asignado a "${asignadoA}".`, icon: 'success', timer: 2000, showConfirmButton: false });
        this.cargarTickets();
        if (this.mostrarDetalle && this.ticketSeleccionado?.id === ticket.id) {
          this.verDetalle(ticket);
        }
      },
      error: () => {
        Swal.fire('Error', 'No se pudo asignar el ticket.', 'error');
      },
    });
  }

  // ===== Archivos =====
  abrirSelectorArchivo(): void {
    this.fileInput?.nativeElement?.click();
  }

  onArchivoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    // Validar tamano (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      Swal.fire('Archivo muy grande', 'El archivo no puede superar los 10 MB.', 'warning');
      return;
    }

    this.archivoSeleccionado = file;

    // Preview para imagenes
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        this.archivoPreview = reader.result as string;
        this.cdr.markForCheck();
      };
      reader.readAsDataURL(file);
    } else {
      this.archivoPreview = null;
    }
    this.cdr.markForCheck();
  }

  limpiarArchivo(): void {
    this.archivoSeleccionado = null;
    this.archivoPreview = null;
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  getArchivoIcono(tipo: string): string {
    if (!tipo) return 'insert_drive_file';
    if (tipo.startsWith('image/')) return 'image';
    if (tipo.includes('pdf')) return 'picture_as_pdf';
    if (tipo.includes('word') || tipo.includes('document')) return 'description';
    if (tipo.includes('sheet') || tipo.includes('excel')) return 'grid_on';
    return 'insert_drive_file';
  }

  esImagen(tipo: string): boolean {
    return tipo?.startsWith('image/') || false;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ===== Enviar comentario =====
  enviarComentario(): void {
    if (!this.ticketSeleccionado) return;
    if (!this.nuevoComentario.trim() && !this.archivoSeleccionado) return;

    this.enviandoComentario = true;
    this.cdr.markForCheck();

    this.ticketsService.agregarComentario(
      this.ticketSeleccionado.id,
      this.nuevoComentario.trim(),
      this.archivoSeleccionado || undefined
    ).subscribe({
      next: () => {
        this.nuevoComentario = '';
        this.limpiarArchivo();
        this.enviandoComentario = false;
        this.verDetalle(this.ticketSeleccionado!);
      },
      error: () => {
        this.enviandoComentario = false;
        this.cdr.markForCheck();
        Swal.fire('Error', 'No se pudo enviar el comentario.', 'error');
      },
    });
  }

  construirChatUnificado(): void {
    if (!this.ticketSeleccionado) return;

    const items: any[] = [];

    // Agregar comentarios
    for (const c of (this.ticketSeleccionado.comentarios || [])) {
      items.push({
        tipo: 'comentario',
        id: c.id,
        autor: c.autor,
        mensaje: c.mensaje,
        archivo_url: c.archivo_url,
        archivo_nombre: c.archivo_nombre,
        archivo_tipo: c.archivo_tipo,
        fecha: c.fecha,
      });
    }

    // Agregar eventos de historial (estado, asignacion, creado, prioridad)
    for (const h of (this.ticketSeleccionado.historial || [])) {
      // No duplicar comentarios/archivos que ya estan como comentario
      if (h.tipo === 'comentario' || h.tipo === 'archivo') continue;

      items.push({
        tipo: 'evento',
        id: h.id,
        eventoTipo: h.tipo,
        descripcion: h.descripcion,
        valor_anterior: h.valor_anterior,
        valor_nuevo: h.valor_nuevo,
        autor: h.usuario,
        fecha: h.fecha,
      });
    }

    // Ordenar por fecha
    items.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
    this.chatItems = items;
  }

  scrollChatAlFinal(): void {
    setTimeout(() => {
      if (this.chatContainer?.nativeElement) {
        this.chatContainer.nativeElement.scrollTop = this.chatContainer.nativeElement.scrollHeight;
      }
    }, 100);
  }

  // ===== Helpers =====
  getPrioridadClass(prioridad: string): string {
    return 'prioridad-' + (prioridad || 'media').toLowerCase();
  }

  getEstadoClass(estado: string): string {
    return 'estado-' + (estado || 'abierto').toLowerCase().replace(/\s+/g, '-');
  }

  getEstadoIcon(estado: string): string {
    const map: Record<string, string> = {
      'Abierto': 'report_problem',
      'En Progreso': 'autorenew',
      'Resuelto': 'check_circle',
      'Cerrado': 'archive',
    };
    return map[estado] || 'help';
  }

  getTiempoRelativo(fecha: string): string {
    if (!fecha) return '';
    const diff = Date.now() - new Date(fecha).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Justo ahora';
    if (mins < 60) return `Hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Hace ${hrs}h`;
    const dias = Math.floor(hrs / 24);
    if (dias < 30) return `Hace ${dias}d`;
    return `Hace ${Math.floor(dias / 30)} meses`;
  }

  getTimelineIcon(tipo: string): string {
    const map: Record<string, string> = {
      'creado': 'add_circle',
      'estado': 'swap_horiz',
      'asignacion': 'person_add',
      'prioridad': 'priority_high',
      'comentario': 'chat',
      'archivo': 'attach_file',
    };
    return map[tipo] || 'circle';
  }

  getConteoEstado(estado: string): number {
    return this.dataSource.data.filter((t: any) => t.estado === estado).length;
  }

  toggleAiAnalisis(): void {
    this.aiAnalisisExpandido = !this.aiAnalisisExpandido;
    this.cdr.markForCheck();
  }

  toggleAiSugerencia(): void {
    this.aiSugerenciaExpandida = !this.aiSugerenciaExpandida;
    this.cdr.markForCheck();
  }

  generarPrompt(): void {
    if (!this.ticketSeleccionado) return;
    const t = this.ticketSeleccionado;

    const fechaFmt = t.fecha_reporte
      ? new Date(t.fecha_reporte).toLocaleString('es-CO')
      : '--';

    const prompt = `# REPORTE DE BUG - TesoroApp

## Informacion del Ticket
- ID: ${t.id}
- Titulo: ${t.titulo}
- Categoria: ${t.categoria || 'Sin categoria'}
- Prioridad: ${t.prioridad}
- Estado: ${t.estado}
- Fecha de reporte: ${fechaFmt}
- Asignado a: ${t.asignado_a || 'Sin asignar'}

## Descripcion del Error
${t.descripcion}

## Contexto del Usuario
- Reportado por: ${t.usuario || '--'}
- Documento: ${t.documento || '--'}
- Rol: ${t.rol || '--'}
- Sede: ${t.sede || '--'}

## Contexto Tecnico
- URL donde ocurrio el error: ${t.url_actual || '--'}
- Navegador: ${t.navegador || '--'}
- Resolucion de pantalla: ${t.resolucion || '--'}
- Version de la aplicacion: ${t.version_app || '--'}

## Logs de Consola
\`\`\`
${t.console_logs || 'No hay logs disponibles'}
\`\`\`

## Captura de Pantalla
${t.screenshot_base64 ? '[Captura de pantalla disponible - ver ticket en el sistema para la imagen]' : 'No hay captura de pantalla disponible'}

## Analisis previo de IA
${t.ai_analisis || 'No disponible - el analisis automatico aun no se ha procesado o fallo'}

## Sugerencia previa de IA
${t.ai_sugerencia || 'No disponible'}

---

Por favor analiza este bug en detalle y proporciona:
1. Explicacion de que pudo haber causado el error (componente, microservicio, flujo de datos)
2. Descripcion del flujo de ejecucion que llevo al bug
3. Pasos detallados para reproducir el error
4. Solucion recomendada con cambios de codigo especificos si es posible
5. Indicacion de si es un error de frontend (Angular) o backend (microservicio Spring Boot) y cual modulo
6. Nivel de severidad y urgencia para resolverlo`;

    const copiar = (text: string) => {
      if (navigator.clipboard) {
        return navigator.clipboard.writeText(text);
      }
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return Promise.resolve();
    };

    copiar(prompt).then(() => {
      this.promptGenerado = true;
      this.cdr.markForCheck();
      setTimeout(() => {
        this.promptGenerado = false;
        this.cdr.markForCheck();
      }, 3000);
    }).catch(() => {
      this.promptGenerado = true;
      this.cdr.markForCheck();
      setTimeout(() => {
        this.promptGenerado = false;
        this.cdr.markForCheck();
      }, 3000);
    });
  }
}
