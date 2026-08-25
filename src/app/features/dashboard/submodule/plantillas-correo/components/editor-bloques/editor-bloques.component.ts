import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Activo, Bloque, DocumentoCorreo, TipoBloque } from '../../models/plantilla-correo.model';

/** Un tipo de bloque en la paleta. */
interface TipoPaleta {
  tipo: TipoBloque;
  etiqueta: string;
  icono: string;
  ayuda: string;
  props: Record<string, any>;
}

/**
 * Lienzo del editor: la lista ordenada de bloques que compone el correo.
 *
 * <h3>Qué hace y qué no</h3>
 * Aquí se ordenan, añaden y borran bloques, y se ve una **aproximación** de cómo
 * quedan. La representación fiel es la vista previa, que pinta el HTML que
 * compila el backend en un iframe aislado. Duplicar aquí la lógica del
 * compilador — tablas anidadas, estilos en línea, media queries — sería tener
 * dos motores de maquetación que se desincronizan; lo que se ve en el lienzo es
 * una guía de estructura, no la maqueta final.
 *
 * <h3>Por qué el borrado pide confirmación y el orden no</h3>
 * Reordenar es reversible arrastrando otra vez; borrar un bloque con dos
 * párrafos escritos, no. La confirmación la pone la página contenedora.
 */
@Component({
  selector: 'app-editor-bloques',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, CdkDropList, CdkDrag,
    MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule,
  ],
  templateUrl: './editor-bloques.component.html',
  styleUrl: './editor-bloques.component.css',
})
export class EditorBloquesComponent {
  readonly documento = input.required<DocumentoCorreo>();
  readonly activos = input<Activo[]>([]);
  readonly seleccionado = input<string | null>(null);

  readonly documentoChange = output<DocumentoCorreo>();
  readonly seleccionar = output<string | null>();
  readonly eliminarBloque = output<Bloque>();

  readonly arrastrando = signal(false);

  /**
   * La paleta. Cada entrada trae sus `props` de partida ya rellenas: un bloque
   * recién soltado tiene que verse, no aparecer vacío y obligar a rellenar
   * cuatro campos antes de que ocurra nada.
   */
  readonly paleta: TipoPaleta[] = [
    { tipo: 'TITULO', etiqueta: 'Título', icono: 'title',
      ayuda: 'Encabezado grande. Se compila como div, no como h1: Outlook añade márgenes propios a los encabezados que no hay forma de anular.',
      props: { texto: 'Nuevo título', nivel: 1, alineacion: 'left', paddingY: 20, paddingX: 24 } },
    { tipo: 'TEXTO', etiqueta: 'Texto', icono: 'notes',
      ayuda: 'Párrafo con negrita, enlaces y listas. Acepta variables entre llaves.',
      props: { html: '<p>Escribe aquí…</p>', alineacion: 'left', paddingY: 8, paddingX: 24 } },
    { tipo: 'IMAGEN', etiqueta: 'Imagen', icono: 'image',
      ayuda: 'Foto de la biblioteca. Se incrusta en el correo, así que se ve aunque el cliente bloquee imágenes remotas.',
      props: { activoId: null, alt: '', anchoPct: 100, alineacion: 'center', enlace: null, paddingY: 12, paddingX: 24 } },
    { tipo: 'VIDEO', etiqueta: 'Vídeo', icono: 'smart_display',
      ayuda: 'Miniatura enlazada al vídeo. Ningún cliente de correo reproduce vídeo incrustado, así que esto es lo que de verdad funciona.',
      props: { url: '', activoId: null, alt: 'Ver vídeo', anchoPct: 100, alineacion: 'center', paddingY: 12, paddingX: 24 } },
    { tipo: 'BOTON', etiqueta: 'Botón', icono: 'smart_button',
      ayuda: 'Llamada a la acción. El destino puede ser una variable, por ejemplo el enlace al contrato de cada persona.',
      props: { texto: 'Ver más', enlace: 'https://', colorFondo: null, colorTexto: '#ffffff', alineacion: 'center', radioPx: 6, paddingY: 16, paddingX: 24 } },
    { tipo: 'LISTA_DATOS', etiqueta: 'Tabla de datos', icono: 'table_rows',
      ayuda: 'Filas etiqueta/valor. Es el bloque natural para volcar los datos del candidato o del contrato.',
      props: { titulo: 'Datos', filas: [{ etiqueta: 'Cargo', valor: '{{proceso.vacante_tipo}}' }], paddingY: 12, paddingX: 24 } },
    { tipo: 'COLUMNAS', etiqueta: 'Columnas', icono: 'view_column',
      ayuda: 'Dos columnas que se apilan solas en el móvil.',
      props: { espacioPx: 16, paddingY: 12, paddingX: 16,
               columnas: [{ ancho: 50, bloques: [] }, { ancho: 50, bloques: [] }] } },
    { tipo: 'SEPARADOR', etiqueta: 'Separador', icono: 'horizontal_rule',
      ayuda: 'Línea divisoria. Se compila como celda con fondo porque hr se pinta distinto en cada cliente.',
      props: { color: '#e5e7eb', grosorPx: 1, paddingY: 16, paddingX: 24 } },
    { tipo: 'ESPACIO', etiqueta: 'Espacio', icono: 'height',
      ayuda: 'Aire vertical.',
      props: { altoPx: 24 } },
    { tipo: 'HTML', etiqueta: 'HTML libre', icono: 'code',
      ayuda: 'Marcado a mano para lo que la paleta no cubra. Se sanea antes de guardar.',
      props: { html: '<p>&nbsp;</p>', paddingY: 8, paddingX: 24 } },
  ];

  readonly bloques = computed(() => this.documento().bloques ?? []);

  /** Índice id → activo, para pintar la miniatura sin buscar en cada render. */
  readonly porId = computed(() => {
    const m = new Map<string, Activo>();
    for (const a of this.activos()) m.set(a.id, a);
    return m;
  });

  agregar(t: TipoPaleta): void {
    const bloque: Bloque = {
      id: this.nuevoId(),
      tipo: t.tipo,
      // Copia profunda: sin ella, dos bloques del mismo tipo compartirían el
      // objeto `props` de la paleta y editar uno cambiaría el otro.
      props: JSON.parse(JSON.stringify(t.props)),
    };
    this.documentoChange.emit({ ...this.documento(), bloques: [...this.bloques(), bloque] });
    this.seleccionar.emit(bloque.id);
  }

  duplicar(b: Bloque, ev: Event): void {
    ev.stopPropagation();
    const copia: Bloque = { id: this.nuevoId(), tipo: b.tipo, props: JSON.parse(JSON.stringify(b.props)) };
    const lista = [...this.bloques()];
    lista.splice(lista.indexOf(b) + 1, 0, copia);
    this.documentoChange.emit({ ...this.documento(), bloques: lista });
    this.seleccionar.emit(copia.id);
  }

  soltar(ev: CdkDragDrop<Bloque[]>): void {
    this.arrastrando.set(false);
    if (ev.previousIndex === ev.currentIndex) return;
    const lista = [...this.bloques()];
    moveItemInArray(lista, ev.previousIndex, ev.currentIndex);
    this.documentoChange.emit({ ...this.documento(), bloques: lista });
  }

  mover(b: Bloque, delta: number, ev: Event): void {
    ev.stopPropagation();
    const lista = [...this.bloques()];
    const i = lista.indexOf(b);
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    moveItemInArray(lista, i, j);
    this.documentoChange.emit({ ...this.documento(), bloques: lista });
  }

  // ── Ayudas de pintado ──────────────────────────────────────────────────────

  iconoDe(tipo: TipoBloque): string {
    return this.paleta.find((p) => p.tipo === tipo)?.icono ?? 'widgets';
  }

  etiquetaDe(tipo: TipoBloque): string {
    return this.paleta.find((p) => p.tipo === tipo)?.etiqueta ?? tipo;
  }

  /** Resumen de una línea del contenido del bloque, para la fila colapsada. */
  resumen(b: Bloque): string {
    switch (b.tipo) {
      case 'TITULO': return b.props['texto'] || '(sin texto)';
      case 'TEXTO':
      case 'HTML': return this.aTextoPlano(b.props['html']) || '(vacío)';
      case 'BOTON': return `${b.props['texto'] || '(sin texto)'} → ${b.props['enlace'] || '(sin destino)'}`;
      case 'IMAGEN': return this.porId().get(b.props['activoId'])?.nombre ?? '(sin imagen elegida)';
      case 'VIDEO': return b.props['url'] || '(sin enlace)';
      case 'LISTA_DATOS': return `${(b.props['filas'] ?? []).length} fila(s)`;
      case 'COLUMNAS': return `${(b.props['columnas'] ?? []).length} columnas`;
      case 'SEPARADOR': return `Línea de ${b.props['grosorPx'] ?? 1} px`;
      case 'ESPACIO': return `${b.props['altoPx'] ?? 24} px de aire`;
      default: return '';
    }
  }

  urlMiniatura(b: Bloque): string | null {
    const a = this.porId().get(b.props['activoId']);
    return a ? a.url : null;
  }

  /** Marca las variables que cita el bloque, para verlas de un vistazo. */
  variablesDe(b: Bloque): string[] {
    const texto = JSON.stringify(b.props);
    return [...new Set([...texto.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g)].map((m) => m[1]))];
  }

  /** Ver PanelVariablesComponent.marcador: las llaves no pueden ir en el HTML. */
  marcador(clave: string): string {
    return `{{${clave}}}`;
  }

  private aTextoPlano(html: string | undefined): string {
    if (!html) return '';
    const t = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  }

  /** `crypto.randomUUID` no existe en contextos no seguros (el APK abre file://). */
  private nuevoId(): string {
    return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }
}
