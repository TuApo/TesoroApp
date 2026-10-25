import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BandejaApiService } from '../bandeja-api.service';
import { Aviso, Cuenta, Vinculacion } from '../bandeja.models';
import { mensajeError } from '../../utils/tareas-ui';

export interface VincularData { canal: 'CORREO' | 'WHATSAPP'; cuenta?: Cuenta }

interface Proveedor { clave: string; nombre: string; ayuda: string; enlace?: string }

/**
 * Vincular una cuenta. Correo: IMAP con contraseña de aplicación (solo lectura). WhatsApp:
 * código QR o código de 8 letras, como "Dispositivos vinculados" de WhatsApp. En los dos
 * casos la persona acepta el aviso (ADMIN/GERENCIA pueden consultar el contenido).
 */
@Component({
  selector: 'app-vincular-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ data.canal === 'CORREO' ? 'mail' : 'chat' }}</mat-icon>
      {{ data.canal === 'CORREO' ? 'Vincular mi correo' : 'Vincular mi WhatsApp' }}
    </h2>
    <mat-dialog-content class="vd">
      @if (paso() === 'datos') {
        @if (data.canal === 'CORREO') {
          <label>Proveedor
            <select [(ngModel)]="proveedor" name="prov">
              @for (p of proveedores; track p.clave) { <option [value]="p.clave">{{ p.nombre }}</option> }
            </select>
          </label>
          <p class="vd-ayuda"><mat-icon>info</mat-icon><span>{{ ayudaProveedor().ayuda }}
            @if (ayudaProveedor().enlace) { <a [href]="ayudaProveedor().enlace" target="_blank" rel="noopener">Crear la contraseña</a> }</span></p>
          <label>Correo <input type="email" [(ngModel)]="correo" name="correo" autocomplete="email" placeholder="tucorreo@empresa.com" /></label>
          <label>Contraseña de aplicación <input type="password" [(ngModel)]="clave" name="clave" autocomplete="new-password" /></label>
          @if (proveedor === 'IMAP') {
            <div class="vd-fila">
              <label>Servidor IMAP <input [(ngModel)]="imapHost" name="host" placeholder="mail.tuempresa.com" /></label>
              <label class="vd-corto">Puerto <input type="number" [(ngModel)]="imapPuerto" name="puerto" /></label>
              <label class="vd-check"><input type="checkbox" [(ngModel)]="imapSsl" name="ssl" /> SSL</label>
            </div>
            <label>Usuario (si no es el correo) <input [(ngModel)]="usuario" name="usuario" /></label>
          }
        } @else {
          <p>Vas a vincular tu WhatsApp como un <b>dispositivo más</b> (igual que WhatsApp Web). Tu celular sigue funcionando normal y
            sonando con los mensajes. La plataforma <b>solo lee</b>: no envía nada desde tu número.</p>
          <label class="vd-check"><input type="checkbox" [(ngModel)]="incluirGrupos" name="grupos" /> Incluir los chats de grupo</label>
          <label class="vd-check"><input type="checkbox" [(ngModel)]="transcribir" name="transcribir" /> Transcribir las notas de voz</label>
        }
        <label class="vd-corto">Traer los últimos <input type="number" min="1" max="365" [(ngModel)]="dias" name="dias" /> días</label>
        <label class="vd-check"><input type="checkbox" [(ngModel)]="analisis" name="ia" /> Analizar con IA (resumen, pendientes y compromisos)</label>
        <div class="vd-aviso">
          <strong><mat-icon>shield</mat-icon>Aviso</strong>
          <p>{{ aviso()?.texto ?? 'Cargando…' }}</p>
          <label class="vd-check"><input type="checkbox" [(ngModel)]="acepto" name="acepto" /> Leí y acepto el aviso</label>
        </div>
        @if (error()) { <p class="vd-error"><mat-icon>error</mat-icon>{{ error() }}</p> }
      } @else if (paso() === 'qr') {
        @let v = vinc();
        @if (v?.estado === 'CONECTADO') {
          <div class="vd-ok"><mat-icon>check_circle</mat-icon><p>¡Listo! WhatsApp {{ v?.numero }} quedó vinculado. Los chats empiezan a llegar en unos minutos.</p></div>
        } @else if (v?.estado === 'EXPIRADO' || v?.estado === 'ERROR' || v?.estado === 'DESCONECTADO') {
          <p class="vd-error"><mat-icon>error</mat-icon>{{ v?.error || 'La vinculación no se completó.' }}</p>
          <button mat-stroked-button (click)="reintentar()"><mat-icon>refresh</mat-icon>Generar otro código</button>
        } @else if (modoCodigo()) {
          @if (codigo()) {
            <p>En tu celular: WhatsApp › <b>Dispositivos vinculados</b> › <b>Vincular un dispositivo</b> › <b>Vincular con número de teléfono</b>, y escribe:</p>
            <p class="vd-codigo">{{ codigo() }}</p>
          } @else {
            <label>Tu número de WhatsApp con indicativo <input [(ngModel)]="telefono" name="tel" placeholder="573001234567" inputmode="tel" /></label>
            <button mat-flat-button (click)="pedirCodigo()" [disabled]="ocupado()">Pedir código</button>
          }
          <button mat-button (click)="modoCodigo.set(false)">Mejor escanear el QR</button>
        } @else {
          <p>En tu celular: WhatsApp › <b>Dispositivos vinculados</b> › <b>Vincular un dispositivo</b> y escanea:</p>
          <div class="vd-qr">
            @if (v?.qr) { <img [src]="v!.qr" alt="Código QR para vincular WhatsApp" /> } @else { <mat-spinner diameter="40" /> }
          </div>
          <p class="vd-ayuda"><mat-icon>smartphone</mat-icon><span>¿Estás en el celular y no puedes escanear tu propia pantalla?
            <button type="button" class="vd-link" (click)="modoCodigo.set(true)">Vincula con un código</button></span></p>
        }
        @if (error()) { <p class="vd-error"><mat-icon>error</mat-icon>{{ error() }}</p> }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (paso() === 'datos') {
        <button mat-button mat-dialog-close>Cancelar</button>
        <button mat-flat-button (click)="vincular()" [disabled]="ocupado() || !acepto || !valido()">
          @if (ocupado()) { <mat-spinner diameter="18" /> } {{ data.canal === 'CORREO' ? 'Probar y vincular' : 'Continuar' }}
        </button>
      } @else {
        <button mat-flat-button [mat-dialog-close]="true">{{ vinc()?.estado === 'CONECTADO' ? 'Listo' : 'Cerrar' }}</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    h2 { display: flex; align-items: center; gap: 8px; }
    .vd { display: flex; flex-direction: column; gap: 10px; min-width: min(520px, 86vw); }
    .vd > * { flex-shrink: 0; }
    .vd label { display: flex; flex-direction: column; gap: 4px; font: 700 13px var(--font-sans); color: var(--text-2); }
    .vd input:not([type=checkbox]), .vd select { height: 42px; border-radius: 10px; border: 1px solid var(--border-strong); padding: 0 10px;
      background: var(--surface); color: var(--text); font: 600 14px var(--font-sans); min-width: 0; }
    .vd .vd-check { flex-direction: row; align-items: center; gap: 8px; font-weight: 650; color: var(--text); }
    .vd .vd-check input { width: 18px; height: 18px; }
    .vd-corto input { max-width: 120px; }
    .vd-fila { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
    .vd-fila label:first-child { flex: 1 1 200px; }
    .vd-ayuda { display: flex; gap: 6px; margin: 0; font-size: 13px; color: var(--muted); }
    .vd-ayuda mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
    .vd-ayuda a, .vd-link { color: var(--link); font-weight: 700; }
    .vd-link { border: 0; background: none; padding: 0; min-height: 0 !important; cursor: pointer; font: inherit; font-weight: 700; }
    .vd-aviso { padding: 10px 12px; border-radius: 12px; background: var(--warn-bg); border: 1px solid var(--warn-border); color: var(--text); }
    .vd-aviso strong { display: flex; align-items: center; gap: 6px; color: var(--warn-fg); }
    .vd-aviso p { margin: 6px 0; font-size: 13px; line-height: 1.45; }
    .vd-error { display: flex; gap: 6px; align-items: flex-start; margin: 0; color: var(--danger-fg); font-weight: 650; }
    .vd-qr { display: grid; place-items: center; min-height: 300px; }
    .vd-qr img { width: min(300px, 70vw); height: auto; border-radius: 12px; background: #fff; padding: 8px; }
    .vd-codigo { text-align: center; font: 850 32px/1.2 ui-monospace, monospace; letter-spacing: .18em; margin: 8px 0; color: var(--text); }
    .vd-ok { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; color: var(--ok-fg); }
    .vd-ok mat-icon { font-size: 52px; width: 52px; height: 52px; }
  `],
})
export class VincularDialogComponent implements OnInit, OnDestroy {
  readonly data = inject<VincularData>(MAT_DIALOG_DATA);
  private readonly api = inject(BandejaApiService);
  private readonly ref = inject(MatDialogRef<VincularDialogComponent>);

  readonly proveedores: Proveedor[] = [
    { clave: 'GMAIL', nombre: 'Gmail / Google Workspace', ayuda: 'Gmail pide una «contraseña de aplicación» (con la verificación en 2 pasos activa). No uses tu clave normal.',
      enlace: 'https://myaccount.google.com/apppasswords' },
    { clave: 'OUTLOOK', nombre: 'Outlook / Microsoft 365', ayuda: 'Microsoft pide una contraseña de aplicación y que IMAP esté habilitado en tu cuenta. Algunas cuentas de empresa lo tienen bloqueado.',
      enlace: 'https://account.live.com/proofs/AppPassword' },
    { clave: 'YAHOO', nombre: 'Yahoo', ayuda: 'Yahoo pide una contraseña de aplicación.', enlace: 'https://login.yahoo.com/account/security' },
    { clave: 'IMAP', nombre: 'Otro (hosting de la empresa)', ayuda: 'Pídele a sistemas el servidor IMAP, el puerto (casi siempre 993 con SSL) y tu usuario.' },
  ];
  proveedor = 'GMAIL';
  correo = '';
  clave = '';
  usuario = '';
  imapHost = '';
  imapPuerto = 993;
  imapSsl = true;
  dias = 30;
  analisis = true;
  incluirGrupos = false;
  transcribir = true;
  acepto = false;
  telefono = '';

  readonly paso = signal<'datos' | 'qr'>('datos');
  readonly aviso = signal<Aviso | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly vinc = signal<Vinculacion | null>(null);
  readonly modoCodigo = signal(false);
  readonly codigo = signal<string | null>(null);
  private cuentaId: string | null = null;
  private sondeo: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    try { this.aviso.set(await this.api.aviso()); } catch { /* el texto vuelve a pedirse al vincular */ }
    if (this.data.cuenta) {
      // Reanudar una vinculación de WhatsApp a medias.
      this.cuentaId = this.data.cuenta.id;
      this.paso.set('qr');
      await this.reintentar();
    }
  }

  ngOnDestroy(): void {
    if (this.sondeo) clearInterval(this.sondeo);
  }

  ayudaProveedor(): Proveedor {
    return this.proveedores.find(p => p.clave === this.proveedor) ?? this.proveedores[0];
  }

  valido(): boolean {
    if (this.data.canal === 'WHATSAPP') return true;
    return /.+@.+\..+/.test(this.correo) && this.clave.length > 0 && (this.proveedor !== 'IMAP' || !!this.imapHost);
  }

  async vincular(): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    try {
      if (this.data.canal === 'CORREO') {
        const c = await this.api.vincularCorreo({
          proveedor: this.proveedor, correo: this.correo.trim(), clave: this.clave, usuario: this.usuario || null,
          imap_host: this.proveedor === 'IMAP' ? this.imapHost : null, imap_puerto: this.proveedor === 'IMAP' ? this.imapPuerto : null,
          imap_ssl: this.proveedor === 'IMAP' ? this.imapSsl : null, dias: this.dias, analisis_ia: this.analisis, aceptar_aviso: this.acepto,
        });
        this.ref.close(c);
      } else {
        const c = await this.api.vincularWhatsapp({
          incluir_grupos: this.incluirGrupos, dias: this.dias, analisis_ia: this.analisis, transcribir_audios: this.transcribir, aceptar_aviso: this.acepto,
        });
        this.cuentaId = c.id;
        this.vinc.set(c.vinculacion ?? null);
        this.paso.set('qr');
        this.sondear();
      }
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudo vincular la cuenta.'));
    } finally {
      this.ocupado.set(false);
    }
  }

  private sondear(): void {
    if (this.sondeo) clearInterval(this.sondeo);
    this.sondeo = setInterval(async () => {
      if (!this.cuentaId) return;
      try {
        const v = await this.api.vinculacion(this.cuentaId);
        this.vinc.set(v);
        if (v.estado === 'CONECTADO' || v.estado === 'EXPIRADO' || v.estado === 'ERROR') {
          if (this.sondeo) clearInterval(this.sondeo);
        }
      } catch { /* se reintenta en el siguiente ciclo */ }
    }, 2500);
  }

  async reintentar(): Promise<void> {
    if (!this.cuentaId) return;
    this.error.set(null);
    this.codigo.set(null);
    try {
      const c = await this.api.reintentar(this.cuentaId);
      this.vinc.set(c.vinculacion ?? null);
      this.sondear();
    } catch (e) {
      this.error.set(mensajeError(e));
    }
  }

  async pedirCodigo(): Promise<void> {
    if (!this.cuentaId) return;
    this.ocupado.set(true);
    this.error.set(null);
    try {
      const r = await this.api.codigoVinculacion(this.cuentaId, this.telefono);
      this.codigo.set(r.codigo);
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }
}
