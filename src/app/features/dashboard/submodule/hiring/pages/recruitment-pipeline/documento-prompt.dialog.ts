import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import Swal from 'sweetalert2';

import {
  BusquedaPersonaService, PersonaEncontrada, SimulacionCambio,
} from '../../service/busqueda-persona/busqueda-persona.service';

export interface DocumentoPrompt {
  tipoDoc: string;
  numero: string;
}

/**
 * Encuentra a la persona que se tiene al frente, aunque su cédula esté mal.
 *
 * Antes esto solo aceptaba un documento exacto. Si alguien lo digitó mal al
 * registrar, la persona quedaba inencontrable: no aparecía por su cédula real
 * —porque en base está la equivocada— ni había forma de llegar a ella. Ahora
 * se busca también por nombre, correo y teléfono, cada coincidencia muestra lo
 * que tiene registrado (oficina, vacante, contrato, documentos) para
 * distinguir homónimos, y desde ahí se puede corregir el documento.
 */
@Component({
  selector: 'app-documento-prompt-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./documento-prompt.dialog.css'],
  templateUrl: './documento-prompt.dialog.html',
})
export class DocumentoPromptDialogComponent {
  private readonly srv = inject(BusquedaPersonaService);

  tipoDoc = 'CC';
  numero = '';

  readonly resultados = signal<PersonaEncontrada[]>([]);
  readonly buscando = signal(false);
  readonly buscado = signal(false);

  /** Persona sobre la que se está corrigiendo el documento. */
  readonly corrigiendo = signal<PersonaEncontrada | null>(null);
  readonly nuevoDoc = signal('');
  readonly motivo = signal('');
  readonly simulacion = signal<SimulacionCambio | null>(null);
  readonly aplicando = signal(false);

  private readonly teclas$ = new Subject<string>();

  readonly tiposDocumento: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'CC', label: 'C.C - Cédula de ciudadanía' },
    { value: 'CE', label: 'C.E - Cédula de extranjería' },
    { value: 'TI', label: 'T.I - Tarjeta de identidad' },
    { value: 'PEP', label: 'PEP - Permiso especial de permanencia' },
    { value: 'PPT', label: 'PPT - Permiso por protección temporal' },
    { value: 'PT', label: 'PT - Permiso temporal' },
    { value: 'PA', label: 'PA - Pasaporte' },
  ];

  constructor(readonly ref: MatDialogRef<DocumentoPromptDialogComponent, DocumentoPrompt>) {
    // Se busca mientras se escribe, pero con freno: sin debounce cada tecla
    // dispara una consulta que cruza seis tablas.
    this.teclas$
      .pipe(
        debounceTime(320),
        distinctUntilChanged(),
        switchMap((q) => {
          this.buscando.set(true);
          return this.srv.buscar(q);
        }),
      )
      .subscribe({
        next: (r) => { this.resultados.set(r ?? []); this.buscando.set(false); this.buscado.set(true); },
        error: () => { this.resultados.set([]); this.buscando.set(false); this.buscado.set(true); },
      });
  }

  onEscribe(v: string): void {
    const t = (v ?? '').trim();
    this.resultados.set([]);
    this.buscado.set(false);
    if (t.length >= 3) this.teclas$.next(t);
  }

  /** Se elige una coincidencia: se devuelve su documento REAL, no el tecleado. */
  elegir(p: PersonaEncontrada): void {
    this.ref.close({ tipoDoc: p.tipo_doc || this.tipoDoc, numero: p.numero_documento });
  }

  /** Buscar tal cual se escribió, sin elegir de la lista. */
  buscarTalCual(): void {
    const n = this.numero.trim();
    if (!n) return;
    this.ref.close({ tipoDoc: this.tipoDoc, numero: n });
  }

  // ── Corrección del documento ────────────────────────────────────────────
  abrirCorreccion(p: PersonaEncontrada): void {
    this.corrigiendo.set(p);
    this.nuevoDoc.set('');
    this.motivo.set('');
    this.simulacion.set(null);
  }

  cancelarCorreccion(): void {
    this.corrigiendo.set(null);
    this.simulacion.set(null);
  }

  /** Primero se mira el impacto; recién después se puede aplicar. */
  simular(): void {
    const p = this.corrigiendo();
    const nueva = this.nuevoDoc().trim();
    if (!p || !nueva) return;

    this.srv.simular(p.numero_documento, nueva).subscribe({
      next: (s) => this.simulacion.set(s),
      error: (e) => {
        this.simulacion.set(null);
        Swal.fire('No se puede', e?.error?.error ?? 'No se pudo calcular el impacto.', 'warning');
      },
    });
  }

  async aplicar(): Promise<void> {
    const p = this.corrigiendo();
    const s = this.simulacion();
    const nueva = this.nuevoDoc().trim();
    if (!p || !s || !nueva) return;

    // Cambiar una cédula toca la llave con la que se cruza media plataforma.
    // Se pide confirmación escrita, no un simple "aceptar".
    const c = await Swal.fire({
      icon: 'warning',
      title: 'Vas a cambiar una cédula',
      html:
        `<p style="text-align:left">Se reemplazará <b>${p.numero_documento}</b> por <b>${nueva}</b> ` +
        `en <b>${s.filasTotales}</b> registro(s) de toda la plataforma: contratación, documentos, ` +
        `nómina y acceso.</p>` +
        `<p style="text-align:left">Queda asentado en <b>Logs y Auditoría</b> a tu nombre.</p>` +
        `<p style="text-align:left"><b>Esto no se deshace solo.</b> Escribe la cédula nueva para confirmar:</p>`,
      input: 'text',
      inputPlaceholder: nueva,
      showCancelButton: true,
      confirmButtonText: 'Cambiar la cédula',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b42318',
      inputValidator: (v) => (v?.trim() === nueva ? null : 'No coincide con la cédula nueva.'),
    });
    if (!c.isConfirmed) return;

    this.aplicando.set(true);
    this.srv.cambiar(p.numero_documento, nueva, this.motivo().trim()).subscribe({
      next: (r) => {
        this.aplicando.set(false);
        Swal.fire('Cédula corregida', `Se actualizaron ${r.filasTotales} registro(s).`, 'success');
        this.ref.close({ tipoDoc: p.tipo_doc || this.tipoDoc, numero: nueva });
      },
      error: (e) => {
        this.aplicando.set(false);
        Swal.fire('No se pudo cambiar', e?.error?.error ?? 'Error al aplicar el cambio.', 'error');
      },
    });
  }

  /** Para pintar el impacto por tabla. */
  tablas(s: SimulacionCambio): { tabla: string; filas: number }[] {
    return Object.entries(s.porTabla ?? {}).map(([tabla, filas]) => ({ tabla, filas }));
  }
}
