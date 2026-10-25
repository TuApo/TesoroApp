import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { BandejaApiService } from '../bandeja-api.service';
import { BandejaEstadoService } from '../bandeja-estado.service';
import { AccesoSupervision, Cuenta } from '../bandeja.models';
import { cuando, escapar, fechaHora } from '../bandeja-ui';
import { mensajeError } from '../../utils/tareas-ui';
import { VincularDialogComponent, VincularData } from './vincular-dialog.component';
import { AvisoDialogComponent } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';

/** Cuentas vinculadas (correo y WhatsApp), sus ajustes y quién ha abierto mi bandeja. */
@Component({
  selector: 'app-bandeja-cuentas',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!estado.supervisando()) {
      <section class="cu-nuevo">
        <button type="button" class="tarjeta cu-opcion" (click)="vincular('CORREO')">
          <mat-icon data-canal="CORREO">mail</mat-icon>
          <span><strong>Vincular mi correo</strong><small>Gmail, Outlook o el correo de la empresa. Solo lectura, con contraseña de aplicación.</small></span>
        </button>
        <button type="button" class="tarjeta cu-opcion" (click)="vincular('WHATSAPP')">
          <mat-icon data-canal="WHATSAPP">qr_code_2</mat-icon>
          <span><strong>Vincular mi WhatsApp</strong><small>Con código QR, como WhatsApp Web. Tu celular sigue igual; la plataforma no envía nada.</small></span>
        </button>
      </section>
    }

    @if (error()) { <div class="error"><mat-icon>error</mat-icon>{{ error() }}</div> }
    @if (cargando()) { <div class="centro"><mat-spinner diameter="34" /></div> }
    <div class="cu-lista">
      @for (c of cuentas(); track c.id) {
        <article class="tarjeta cu">
          <header class="cu-cab">
            <mat-icon [attr.data-canal]="c.canal">{{ c.canal === 'CORREO' ? 'mail' : 'chat' }}</mat-icon>
            <div class="cu-tit">
              <strong class="ellipsis">{{ c.etiqueta || c.direccion || (c.canal === 'WHATSAPP' ? 'WhatsApp (sin vincular)' : 'Correo') }}</strong>
              <span class="muted ellipsis">{{ c.direccion }} @if (c.servidores) { · {{ c.servidores.imap }} }</span>
            </div>
            <span class="chip" [attr.data-tono]="tono(c.estado)">{{ textoEstado(c.estado) }}</span>
          </header>
          @if (c.ultimo_error) { <p class="cu-err"><mat-icon>warning</mat-icon>{{ c.ultimo_error }}</p> }
          <dl class="cu-datos">
            <div><dt>Última sincronización</dt><dd>{{ c.ultimo_ok_en ? cuando(c.ultimo_ok_en) : '—' }}</dd></div>
            <div><dt>Mensajes importados</dt><dd>{{ c.mensajes_importados }}</dd></div>
            <div><dt>Desde</dt><dd>{{ c.sincronizar_desde || '—' }}</dd></div>
            <div><dt>Aviso aceptado</dt><dd>{{ fechaHora(c.aviso_aceptado_en) }}</dd></div>
          </dl>
          @if (!estado.supervisando()) {
            <div class="cu-ajustes">
              <label><input type="checkbox" [checked]="c.analisis_ia" (change)="ajustar(c, { analisis_ia: $any($event.target).checked })" /> Analizar con IA</label>
              @if (c.canal === 'WHATSAPP') {
                <label><input type="checkbox" [checked]="c.incluir_grupos" (change)="ajustar(c, { incluir_grupos: $any($event.target).checked })" /> Incluir grupos</label>
                <label><input type="checkbox" [checked]="c.transcribir_audios" (change)="ajustar(c, { transcribir_audios: $any($event.target).checked })" /> Transcribir notas de voz</label>
              }
            </div>
            <div class="acciones">
              @if (c.canal === 'WHATSAPP' && c.estado !== 'CONECTADO') {
                <button mat-flat-button class="btn-chico" (click)="revincular(c)"><mat-icon>qr_code_2</mat-icon>Vincular de nuevo</button>
              } @else {
                <button mat-stroked-button class="btn-chico" (click)="sincronizar(c)" [disabled]="ocupado() === c.id">
                  <mat-icon>sync</mat-icon>{{ c.canal === 'CORREO' ? 'Revisar ahora' : 'Reconectar' }}</button>
              }
              @if (c.canal === 'CORREO') {
                <button mat-stroked-button class="btn-chico" (click)="cambiarClave(c)"><mat-icon>key</mat-icon>Cambiar contraseña</button>
              }
              <button mat-button class="btn-chico cu-quitar" (click)="desvincular(c)"><mat-icon>link_off</mat-icon>Desvincular</button>
            </div>
          }
        </article>
      } @empty {
        @if (!cargando()) {
          <div class="vacio"><mat-icon>link</mat-icon><p>{{ estado.supervisando() ? 'Esta persona no tiene cuentas vinculadas.' : 'Todavía no vinculas ninguna cuenta.' }}</p></div>
        }
      }
    </div>

    <section class="tarjeta">
      <h3><mat-icon>policy</mat-icon>{{ estado.supervisando() ? 'Accesos de supervisión a esta bandeja' : 'Accesos a mi bandeja' }}</h3>
      <p class="muted cu-nota">ADMIN y GERENCIA pueden consultar tu bandeja; cada consulta queda aquí.</p>
      <ul class="cu-accesos">
        @for (a of accesos(); track $index) {
          <li><time>{{ fechaHora(a.creado_en) }}</time><b>{{ a.supervisor_nombre }}</b><span class="muted">({{ a.supervisor_rol }})</span>
            abrió {{ recurso(a.recurso) }}@if (a.detalle) { «{{ a.detalle }}» }</li>
        } @empty { <li class="muted">Nadie ha abierto tu bandeja.</li> }
      </ul>
    </section>
  `,
  styleUrls: ['../bandeja-comun.css'],
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .cu-nuevo { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 10px; }
    .cu-opcion { display: flex; gap: 12px; align-items: center; text-align: left; cursor: pointer; font-family: var(--font-sans); color: var(--text); }
    .cu-opcion:hover { border-color: var(--primary); box-shadow: var(--ring); }
    .cu-opcion mat-icon, .cu-cab mat-icon { flex: none; width: 44px; height: 44px; font-size: 26px; display: grid; place-items: center; border-radius: 14px;
      background: var(--info-bg); color: var(--info-fg); }
    mat-icon[data-canal="WHATSAPP"] { background: var(--ok-bg) !important; color: var(--ok-fg) !important; }
    .cu-opcion span { display: flex; flex-direction: column; gap: 3px; }
    .cu-opcion small { color: var(--muted); font-size: 12.5px; line-height: 1.35; }
    .cu-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap: 10px; }
    .cu { display: flex; flex-direction: column; gap: 10px; }
    .cu-cab { display: flex; align-items: center; gap: 10px; }
    .cu-tit { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cu-err { display: flex; gap: 6px; margin: 0; padding: 8px 10px; border-radius: 10px; background: var(--danger-bg); color: var(--danger-fg); font-size: 13px; }
    .cu-err mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
    .cu-datos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; margin: 0; }
    .cu-datos dt { font-size: 11.5px; font-weight: 750; color: var(--muted); }
    .cu-datos dd { margin: 0; font-size: 13.5px; font-weight: 650; color: var(--text); }
    .cu-ajustes { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13.5px; font-weight: 650; color: var(--text); }
    .cu-ajustes label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .cu-ajustes input { width: 17px; height: 17px; }
    .cu-quitar { color: var(--danger-fg) !important; }
    .cu-nota { margin: -4px 0 8px; font-size: 13px; }
    .cu-accesos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; max-height: 320px; overflow-y: auto; }
    .cu-accesos li { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
    .cu-accesos time { font-size: 12px; color: var(--muted); font-weight: 700; min-width: 120px; }
  `],
})
export class CuentasComponent implements OnInit {
  private readonly api = inject(BandejaApiService);
  readonly estado = inject(BandejaEstadoService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  readonly cuentas = signal<Cuenta[]>([]);
  readonly accesos = signal<AccesoSupervision[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal<string | null>(null);
  readonly cuando = cuando;
  readonly fechaHora = fechaHora;

  ngOnInit(): void { void this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    const usuario = this.estado.supervisando() ? this.estado.usuario() : null;
    try {
      const [c, a] = await Promise.all([this.api.cuentas(usuario), this.api.accesos(usuario)]);
      this.cuentas.set(c);
      this.accesos.set(a);
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar las cuentas.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async vincular(canal: 'CORREO' | 'WHATSAPP', cuenta?: Cuenta): Promise<void> {
    const ref = this.dialog.open<VincularDialogComponent, VincularData>(VincularDialogComponent, {
      data: { canal, cuenta }, width: 'min(620px, 96vw)', autoFocus: false, disableClose: canal === 'WHATSAPP',
    });
    const r = await firstValueFrom(ref.afterClosed());
    if (r) this.snack.open(canal === 'CORREO' ? 'Correo vinculado: los mensajes empiezan a llegar en un momento' : 'WhatsApp en proceso de vinculación', undefined, { duration: 3500 });
    await this.cargar();
    void this.estado.refrescar();
  }

  revincular(c: Cuenta): void { void this.vincular('WHATSAPP', c); }

  async ajustar(c: Cuenta, b: Record<string, unknown>): Promise<void> {
    try {
      const nueva = await this.api.ajustarCuenta(c.id, b);
      this.cuentas.update(l => l.map(x => x.id === c.id ? nueva : x));
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  async sincronizar(c: Cuenta): Promise<void> {
    this.ocupado.set(c.id);
    try {
      const r = await this.api.reintentar(c.id);
      this.snack.open(r.nuevos != null ? `${r.nuevos} mensaje(s) nuevo(s)` : 'Reconectando…', undefined, { duration: 2500 });
      await this.cargar();
      void this.estado.refrescar();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    } finally {
      this.ocupado.set(null);
    }
  }

  async cambiarClave(c: Cuenta): Promise<void> {
    const clave = window.prompt(`Nueva contraseña de aplicación para ${c.direccion}:`);
    if (!clave) return;
    await this.ajustar(c, { clave });
    this.snack.open('Contraseña actualizada', undefined, { duration: 2500 });
  }

  async desvincular(c: Cuenta): Promise<void> {
    const ref = this.dialog.open(AvisoDialogComponent, {
      data: {
        icono: 'warning', titulo: 'Desvincular cuenta',
        html: `Se deja de sincronizar <b>${escapar(c.direccion || c.etiqueta || c.canal)}</b>. Las conversaciones, compromisos y tareas que ya están en
               la bandeja <b>se conservan</b> (para borrarlas también, desvincula y luego pide a un administrador que las elimine).`,
        textoConfirmar: 'Desvincular', textoCancelar: 'Cancelar',
      },
      autoFocus: false,
    });
    if (!(await firstValueFrom(ref.afterClosed()))) return;
    try {
      await this.api.desvincular(c.id, false);
      this.snack.open('Cuenta desvinculada', undefined, { duration: 2500 });
      await this.cargar();
      void this.estado.refrescar();
    } catch (e) {
      this.snack.open(mensajeError(e), 'Cerrar', { duration: 4500 });
    }
  }

  tono(e: string): string {
    return e === 'CONECTADO' ? 'ok' : e === 'ESPERANDO_QR' || e === 'CONECTANDO' || e === 'PENDIENTE' ? 'aviso' : 'peligro';
  }

  textoEstado(e: string): string {
    return ({ CONECTADO: 'Conectada', ESPERANDO_QR: 'Esperando el QR', CONECTANDO: 'Conectando', PENDIENTE: 'Pendiente',
      ERROR: 'Con error', DESCONECTADO: 'Desconectada', EXPIRADO: 'QR vencido' } as Record<string, string>)[e] ?? e;
  }

  recurso(r: string): string {
    return ({ HILO: 'la conversación', LISTA: 'la lista de conversaciones', RESUMEN: 'el resumen', CUENTAS: 'las cuentas',
      COMPROMISOS: 'los compromisos', CONTACTOS: 'los contactos', CONTACTO: 'el contacto', ADJUNTO: 'el adjunto',
      MENSAJE: 'el correo original', ACCESOS: 'los accesos', COMPROMISO: 'el compromiso' } as Record<string, string>)[r] ?? r.toLowerCase();
  }
}
