import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NotificacionesConfigService } from '../../services/notificaciones-config.service';
import {
  AUDIENCIA_MODOS,
  AudienciaModo,
  CANALES,
  Canal,
  Condicion,
  DESTINO_TIPOS,
  DestinoTipo,
  modoPideIds,
  NotificationType,
  NotifRegla,
  OPERADORES,
  OpcionAudiencia,
  parseAudiencia,
  parseCondiciones,
  ReglaRequest,
  serializarCondiciones,
  URGENCIAS,
  Urgencia,
} from '../../models/notificacion-config.model';

export interface ReglaFormDialogData {
  /** Ausente = alta. */
  regla?: NotifRegla;
  tipos: NotificationType[];
  eventos: string[];
}

/**
 * Alta/edición de una regla de notificación.
 *
 * La pantalla está organizada como la frase que describe una regla —
 * *cuando pase X, si se cumple Y, avísale a Z por W, diciendo T, y al hacer clic
 * llévalo a D* — y no como el volcado de columnas de `notif_regla`. Quien
 * configura esto piensa en la frase, no en la tabla.
 *
 * DOS DECISIONES QUE NO SON COSMÉTICAS:
 *
 *  1. El estado activo NO se edita aquí. Una regla nace desactivada y solo se
 *     enciende desde el listado, que es donde el toggle avisa del alcance y
 *     empuja a simular primero. Activar es la única acción irreversible de este
 *     módulo: los mensajes ya entregados no se pueden recoger.
 *
 *  2. `condicion_json` y `audiencia_json` se editan con constructores visuales,
 *     no como texto. Un JSON inválido en la condición hace que la regla NO
 *     dispare (`CondicionEvaluador` devuelve false ante un parseo fallido), y ese
 *     fallo es invisible: se ve como "no llegó la notificación", no como error.
 *     Si el JSON guardado no se puede leer se muestra en crudo y de solo lectura
 *     en vez de pisarlo con una lista vacía.
 */
@Component({
  selector: 'app-regla-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatDividerModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './regla-form-dialog.component.html',
  styleUrls: ['./regla-form-dialog.component.css'],
})
export class ReglaFormDialogComponent implements OnInit {
  form!: FormGroup;
  guardando = false;

  readonly esEdicion: boolean;
  readonly tipos: NotificationType[];
  readonly eventosConocidos: string[];

  readonly MODOS = AUDIENCIA_MODOS;
  readonly CANALES = CANALES;
  readonly DESTINOS = DESTINO_TIPOS;
  readonly OPERADORES = OPERADORES;
  readonly URGENCIAS = URGENCIAS;

  /**
   * Ejemplos con llaves dobles. Viven aqui y no en el HTML porque Angular corta
   * la interpolacion en el primer `}}`: un `{{ '{{campo}}' }}` incrustado en el
   * template rompe el parseo con un error de expresion sin terminar.
   */
  readonly EJ_PLACEHOLDER = '{{campo}}';
  readonly EJ_RUTA = '{{card.title}}';
  readonly EJ_TITULO = 'Tarea próxima a vencer: {{card.title}}';
  readonly EJ_MENSAJE = 'Quedan {{horasRestantes}} horas';

  /** Canales marcados. Fuera del FormGroup: es un set, no un control. */
  canalesSel = new Set<Canal>(['IN_APP']);

  /** Ids elegidos en el selector de audiencia (modos que los piden). */
  audienciaSel: string[] = [];
  opciones: OpcionAudiencia[] = [];
  cargandoOpciones = false;
  filtroOpciones = '';

  /**
   * null = el `condicion_json` guardado no se pudo interpretar. En ese caso el
   * constructor visual se bloquea y se muestra el JSON crudo, para no destruir
   * una condición que alguien escribió a mano.
   */
  condiciones: Condicion[] | null = [];
  condicionCruda = '';

  constructor(
    private fb: FormBuilder,
    private api: NotificacionesConfigService,
    private snack: MatSnackBar,
    private ref: MatDialogRef<ReglaFormDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ReglaFormDialogData,
  ) {
    this.esEdicion = !!data.regla;
    // Al crear solo se ofrecen tipos ACTIVOS; al editar se conserva el que ya
    // tuviera aunque esté desactivado, o el select saldría en blanco y guardar
    // le cambiaría el tipo a la regla sin que nadie lo pidiera.
    this.tipos = data.tipos.filter((t) => t.activo || t.id === data.regla?.tipo_id);
    this.eventosConocidos = data.eventos ?? [];
  }

  ngOnInit(): void {
    const r = this.data.regla;

    this.form = this.fb.group({
      evento_clave: [r?.evento_clave ?? '', [Validators.required, Validators.maxLength(120)]],
      tipo_id: [r?.tipo_id ?? '', Validators.required],
      nombre: [r?.nombre ?? '', [Validators.required, Validators.maxLength(150)]],
      descripcion: [r?.descripcion ?? '', Validators.maxLength(255)],
      audiencia_modo: [(r?.audiencia_modo ?? 'PAYLOAD') as AudienciaModo, Validators.required],
      excluir_actor: [r ? r.excluir_actor : true],
      plantilla_titulo: [r?.plantilla_titulo ?? '', [Validators.required, Validators.maxLength(500)]],
      plantilla_mensaje: [r?.plantilla_mensaje ?? ''],
      urgencia: [(r?.urgencia ?? null) as Urgencia | null],
      dedup_ventana_min: [r?.dedup_ventana_min ?? null, [Validators.min(1), Validators.max(20160)]],
      destino_tipo: [(r?.destino_tipo ?? 'NINGUNO') as DestinoTipo, Validators.required],
      destino_valor: [r?.destino_valor ?? ''],
    });

    if (r) {
      this.canalesSel = new Set(r.canales.length ? r.canales : (['IN_APP'] as Canal[]));
      this.audienciaSel = parseAudiencia(r.audiencia_json);
      this.condiciones = parseCondiciones(r.condicion_json);
      this.condicionCruda = r.condicion_json ?? '';
    }

    this.sincronizarValidacionDestino();
    this.form.get('destino_tipo')!.valueChanges.subscribe(() => this.sincronizarValidacionDestino());
    this.form.get('audiencia_modo')!.valueChanges.subscribe((modo) => this.onModoChange(modo as AudienciaModo));

    if (modoPideIds(this.form.value.audiencia_modo as AudienciaModo)) this.cargarOpciones();
  }

  // ── Destino ──────────────────────────────────────────────────────────────

  get destinoTipo(): DestinoTipo { return this.form.value.destino_tipo as DestinoTipo; }

  get destinoPideValor(): boolean {
    return this.DESTINOS.find((d) => d.value === this.destinoTipo)?.pideValor ?? false;
  }

  get destinoAyuda(): string {
    return this.DESTINOS.find((d) => d.value === this.destinoTipo)?.ayuda ?? '';
  }

  get destinoEjemplo(): string {
    return this.DESTINOS.find((d) => d.value === this.destinoTipo)?.ejemplo ?? '';
  }

  /**
   * El backend rechaza `destino_valor` vacío para cualquier tipo distinto de
   * NINGUNO, así que el required se activa y desactiva con el selector en vez de
   * dejar que el guardado falle con un 400.
   */
  private sincronizarValidacionDestino(): void {
    const ctrl = this.form.get('destino_valor')!;
    if (this.destinoPideValor) ctrl.addValidators(Validators.required);
    else { ctrl.removeValidators(Validators.required); ctrl.setValue(''); }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  // ── Audiencia ────────────────────────────────────────────────────────────

  get modo(): AudienciaModo { return this.form.value.audiencia_modo as AudienciaModo; }

  get modoPideIds(): boolean { return modoPideIds(this.modo); }

  get modoAyuda(): string {
    return this.MODOS.find((m) => m.value === this.modo)?.ayuda ?? '';
  }

  get modoEsTodos(): boolean { return this.modo === 'TODOS'; }

  private onModoChange(modo: AudienciaModo): void {
    // Los ids de un modo no valen para otro (un id de rol no es un id de sede),
    // así que cambiar de modo limpia la selección en vez de arrastrar basura.
    this.audienciaSel = [];
    this.filtroOpciones = '';
    this.opciones = [];
    if (modoPideIds(modo)) this.cargarOpciones();
  }

  private cargarOpciones(): void {
    this.cargandoOpciones = true;
    this.api.opcionesDe(this.modo).subscribe((ops) => {
      this.opciones = ops;
      this.cargandoOpciones = false;
    });
  }

  get opcionesFiltradas(): OpcionAudiencia[] {
    const q = this.filtroOpciones.trim().toLowerCase();
    if (!q) return this.opciones;
    return this.opciones.filter((o) =>
      `${o.nombre} ${o.detalle ?? ''}`.toLowerCase().includes(q));
  }

  /** Ids seleccionados que ya no están en el catálogo (rol borrado, por ejemplo). */
  get seleccionHuerfana(): string[] {
    const conocidos = new Set(this.opciones.map((o) => o.id));
    return this.audienciaSel.filter((id) => !conocidos.has(id));
  }

  // ── Condiciones ──────────────────────────────────────────────────────────

  get condicionIlegible(): boolean { return this.condiciones === null; }

  agregarCondicion(): void {
    if (this.condiciones === null) return;
    this.condiciones = [...this.condiciones, { campo: '', op: 'EQ', valor: '' }];
  }

  quitarCondicion(i: number): void {
    if (this.condiciones === null) return;
    this.condiciones = this.condiciones.filter((_, idx) => idx !== i);
  }

  opPideValor(op: string): boolean {
    return this.OPERADORES.find((o) => o.value === op)?.pideValor ?? true;
  }

  opEsLista(op: string): boolean {
    return this.OPERADORES.find((o) => o.value === op)?.lista ?? false;
  }

  /** El valor de un IN/NOT_IN se escribe separado por comas y viaja como lista. */
  valorTexto(c: Condicion): string {
    if (Array.isArray(c.valor)) return c.valor.join(', ');
    return c.valor === undefined || c.valor === null ? '' : String(c.valor);
  }

  setValor(c: Condicion, texto: string): void {
    c.valor = this.opEsLista(c.op)
      ? texto.split(',').map((s) => s.trim()).filter(Boolean)
      : texto;
  }

  /** Cambiar de operador reinterpreta el valor: lista ↔ escalar. */
  onOperadorChange(c: Condicion): void {
    this.setValor(c, this.valorTexto(c));
  }

  /** Descarta la condición ilegible y habilita el constructor visual. */
  reiniciarCondicion(): void {
    this.condiciones = [];
    this.condicionCruda = '';
  }

  // ── Plantillas ───────────────────────────────────────────────────────────

  /**
   * Placeholders que ya usa la plantilla. Se muestran como recordatorio de qué
   * campos tendrá que traer el payload del evento; la comprobación real es la
   * simulación, que renderiza contra un payload concreto.
   */
  get placeholdersEnUso(): string[] {
    const texto = `${this.form.value.plantilla_titulo ?? ''} ${this.form.value.plantilla_mensaje ?? ''} ${this.form.value.destino_valor ?? ''}`;
    return [...new Set([...texto.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
  }

  // ── Canales ──────────────────────────────────────────────────────────────

  canalMarcado(c: Canal): boolean { return this.canalesSel.has(c); }

  alternarCanal(c: Canal, marcado: boolean): void {
    if (marcado) this.canalesSel.add(c);
    else this.canalesSel.delete(c);
  }

  // ── Guardado ─────────────────────────────────────────────────────────────

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.snack.open('Revisa los campos marcados', 'Cerrar', { duration: 4000 });
      return;
    }
    if (!this.canalesSel.size) {
      this.snack.open('Elige al menos un canal de entrega', 'Cerrar', { duration: 4000 });
      return;
    }
    if (this.modoPideIds && !this.audienciaSel.length) {
      this.snack.open('Elige al menos un destinatario para este tipo de audiencia', 'Cerrar', { duration: 5000 });
      return;
    }

    const v = this.form.value;
    const payload: ReglaRequest = {
      evento_clave: (v.evento_clave as string).trim(),
      tipo_id: v.tipo_id as string,
      nombre: (v.nombre as string).trim(),
      descripcion: (v.descripcion as string)?.trim() || null,
      audiencia_modo: v.audiencia_modo as AudienciaModo,
      // Los modos que no piden ids mandan null: dejar la lista anterior colgando
      // haría que volver a PAYLOAD conservase una audiencia fantasma en la tabla.
      audiencia_json: this.modoPideIds ? JSON.stringify(this.audienciaSel) : null,
      excluir_actor: !!v.excluir_actor,
      canales: [...this.canalesSel],
      plantilla_titulo: (v.plantilla_titulo as string).trim(),
      plantilla_mensaje: (v.plantilla_mensaje as string)?.trim() || null,
      destino_tipo: v.destino_tipo as DestinoTipo,
      destino_valor: this.destinoPideValor ? (v.destino_valor as string).trim() : '',
      dedup_ventana_min: (v.dedup_ventana_min as number | null) ?? null,
      urgencia: (v.urgencia as Urgencia | null) ?? null,
      condicion_json: this.condiciones === null
        ? this.condicionCruda || null
        : serializarCondiciones(this.condiciones),
    };

    // Solo en alta: nace desactivada a propósito (ver cabecera de la clase).
    // En edición se OMITE para que el PATCH no pise el estado que tenga la regla.
    if (!this.esEdicion) payload.activo = false;

    this.guardando = true;
    const peticion = this.esEdicion
      ? this.api.actualizarRegla(this.data.regla!.id, payload)
      : this.api.crearRegla(payload);

    peticion.subscribe({
      next: (guardada) => { this.guardando = false; this.ref.close(guardada); },
      error: (e) => {
        this.guardando = false;
        const err = e as { error?: { error?: string } | string };
        const msg = typeof err?.error === 'string'
          ? err.error
          : err?.error?.error ?? 'No se pudo guardar la regla';
        this.snack.open(msg, 'Cerrar', { duration: 7000 });
      },
    });
  }

  cancelar(): void { this.ref.close(); }
}
