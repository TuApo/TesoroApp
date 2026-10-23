import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { Camara, RegistroAuditoria } from '../../models/seguridad.models';
import { SeguridadService } from '../../services/seguridad.service';
import { fechaHora } from '../../utils/formato';

const ACCIONES = [
  { v: 'VER_VIVO', t: 'Vio en vivo' }, { v: 'VER_GRABACION', t: 'Vio grabación' }, { v: 'EXPORTAR', t: 'Exportó video' },
  { v: 'PTZ', t: 'Movió la cámara' }, { v: 'PTT', t: 'Habló por parlante' },
];
const NOMBRE_ACCION_AUD: Record<string, string> = Object.fromEntries(ACCIONES.map((a) => [a.v, a.t]));

/** Auditoría de video: quién vio qué cámara, cuándo, desde qué IP; quién exportó o movió una cámara. */
@Component({
  selector: 'sg-cfg-auditoria',
  standalone: true,
  imports: [FormsModule, MatIconModule, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="filtros-cfg">
      <label class="sg-campo-nativo">Usuario <input type="text" [ngModel]="usuario()" (ngModelChange)="usuario.set($event)" (keydown.enter)="filtrar()" placeholder="Nombre o documento" /></label>
      <label class="sg-campo-nativo">Cámara
        <select [ngModel]="camaraId()" (ngModelChange)="camaraId.set($event); filtrar()">
          <option [ngValue]="null">Todas</option>
          @for (c of camaras(); track c.id) { <option [ngValue]="c.id">{{ c.sede_nombre }} · {{ c.nombre }}</option> }
        </select>
      </label>
      <label class="sg-campo-nativo">Acción
        <select [ngModel]="accion()" (ngModelChange)="accion.set($event); filtrar()">
          <option [ngValue]="null">Todas</option>
          @for (a of acciones; track a.v) { <option [ngValue]="a.v">{{ a.t }}</option> }
        </select>
      </label>
      <label class="sg-campo-nativo">Desde <input type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event); filtrar()" /></label>
      <label class="sg-campo-nativo">Hasta <input type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event); filtrar()" /></label>
      <button type="button" class="sg-boton" (click)="filtrar()"><mat-icon aria-hidden="true">search</mat-icon>Buscar</button>
    </div>
    @if (error(); as e) { <div class="sg-aviso danger"><mat-icon aria-hidden="true">error</mat-icon><span>{{ e }}</span></div> }
    <app-tabla-estandar id="seguridad-auditoria" titulo="Auditoría de video" modulo="Seguridad" [datos]="filas()" [columnas]="columnas"
                        [filaId]="porId" [cargando]="cargando()" [seleccionable]="false" [pegable]="false"
                        [totalServidor]="total()" [paginaServidor]="pagina()" (paginaCambio)="paginar($event)" vacio="Sin registros con esos filtros." />
  `,
  styleUrls: ['../../styles/seguridad-comun.css', './configuracion.css'],
})
export class CfgAuditoria {
  private readonly api = inject(SeguridadService);

  readonly camaras = signal<Camara[]>([]);
  readonly usuario = signal('');
  readonly camaraId = signal<string | null>(null);
  readonly accion = signal<string | null>(null);
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly filas = signal<RegistroAuditoria[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly porPagina = signal(50);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly acciones = ACCIONES;

  readonly columnas: ColumnaTabla<RegistroAuditoria>[] = [
    { id: 'cuando', header: 'Cuándo', valor: (r) => r.creado_en, formato: (r) => fechaHora(r.creado_en), tarjeta: 'meta' },
    { id: 'usuario', header: 'Usuario', valor: (r) => r.usuario_nombre ?? '', tarjeta: 'titulo' },
    { id: 'accion', header: 'Acción', valor: (r) => NOMBRE_ACCION_AUD[r.accion] ?? r.accion, tarjeta: 'badge',
      badge: (r) => ({ texto: NOMBRE_ACCION_AUD[r.accion] ?? r.accion, tono: r.accion === 'EXPORTAR' ? 'warn' : r.accion === 'PTT' ? 'violet' : 'info' }) },
    { id: 'camara', header: 'Cámara', valor: (r) => r.camara_nombre ?? '', tarjeta: 'subtitulo' },
    { id: 'detalle', header: 'Detalle', prioridad: 2, valor: (r) => r.detalle ?? '', tarjeta: 'cuerpo' },
    { id: 'ip', header: 'IP', prioridad: 3, valor: (r) => r.ip ?? '' },
  ];
  readonly porId = (r: RegistroAuditoria) => r.id;

  constructor() {
    this.api.camaras().subscribe({ next: (c) => this.camaras.set(c), error: () => {} });
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.auditoria({
      usuario: this.usuario().trim() || null, camara_id: this.camaraId(), accion: this.accion(),
      desde: this.desde() ? `${this.desde()}T00:00:00` : null, hasta: this.hasta() ? `${this.hasta()}T23:59:59` : null,
      limit: this.porPagina(), offset: this.pagina() * this.porPagina(),
    }).subscribe({
      next: (p) => { this.filas.set(p.results ?? []); this.total.set(p.count ?? 0); this.cargando.set(false); this.error.set(null); },
      error: (e) => { this.cargando.set(false); this.error.set(mensajeDeError(e, 'No se pudo leer la auditoría.')); },
    });
  }
  filtrar(): void { this.pagina.set(0); this.cargar(); }
  paginar(e: { pagina: number; porPagina: number }): void { this.pagina.set(e.pagina); this.porPagina.set(e.porPagina); this.cargar(); }
}
