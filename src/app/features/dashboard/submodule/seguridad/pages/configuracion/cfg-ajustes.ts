import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { CampoForm, abrirFormulario } from '../../components/dialogos/formulario-dialogo';
import { Ajustes, AjustesEntrada, Canal, NOMBRE_CANAL, ProveedorWhatsapp } from '../../models/seguridad.models';
import { AccionesSeguridad } from '../../services/acciones.service';
import { SeguridadService } from '../../services/seguridad.service';
import { hace } from '../../utils/formato';

type Bloque = 'general' | 'video' | 'telegram' | 'whatsapp' | 'twilio' | 'webhook' | 'email' | 'privacidad';
const PROVEEDORES: { valor: ProveedorWhatsapp; texto: string }[] = [
  { valor: 'NINGUNO', texto: 'Ninguno' }, { valor: 'META_CLOUD', texto: 'WhatsApp Business Cloud (Meta)' }, { valor: 'TWILIO', texto: 'Twilio' },
  { valor: 'GRANJA', texto: 'Granja propia (ms-whatsapp)' }, { valor: 'WEBHOOK', texto: 'Webhook (n8n, Make…)' },
];

/**
 * Ajustes del módulo y credenciales de los canales. Los secretos son de SOLO ESCRITURA: el
 * backend nunca los devuelve (solo dice si están configurados); un campo vacío no los cambia.
 * En modo `privacidad` muestra lo de Ley 1581: biometría, demografía, retención y el aviso.
 */
@Component({
  selector: 'sg-cfg-ajustes',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cfg-ajustes.html',
  styleUrls: ['../../styles/seguridad-comun.css', './configuracion.css'],
})
export class CfgAjustes {
  private readonly api = inject(SeguridadService);
  private readonly acciones = inject(AccionesSeguridad);
  private readonly dialog = inject(MatDialog);

  readonly modo = input<'ajustes' | 'privacidad'>('ajustes');
  readonly ajustes = signal<Ajustes | null>(null);
  readonly error = signal<string | null>(null);
  readonly f = { hace };

  constructor() { this.cargar(); }

  cargar(): void {
    this.api.ajustes().subscribe({
      next: (a) => { this.ajustes.set(a); this.error.set(null); },
      error: (e) => this.error.set(mensajeDeError(e, 'No se pudieron leer los ajustes.')),
    });
  }

  private def(b: Bloque, a: Ajustes): { titulo: string; icono: string; descripcion?: string; campos: CampoForm[]; valores: Record<string, unknown>; salida: (v: Record<string, any>) => AjustesEntrada } {
    switch (b) {
      case 'general': return {
        titulo: 'Retención y palabras clave', icono: 'tune',
        campos: [
          { clave: 'retencion_capturas_dias', etiqueta: 'Capturas (días)', tipo: 'numero', min: 1, requerido: true },
          { clave: 'retencion_eventos_dias', etiqueta: 'Eventos (días)', tipo: 'numero', min: 1, requerido: true },
          { clave: 'retencion_grabacion_dias', etiqueta: 'Grabación continua (días)', tipo: 'numero', min: 1, requerido: true,
            ayuda: 'Cada cámara puede tener la suya.' },
          { clave: 'palabras_clave', etiqueta: 'Palabras clave del micrófono', tipo: 'chips', placeholder: 'auxilio, ayuda, robo…',
            ayuda: 'Si un micrófono con transcripción las oye, se dispara la regla PALABRA_CLAVE.' },
        ],
        valores: { ...a },
        salida: (v) => ({ retencion_capturas_dias: v['retencion_capturas_dias'], retencion_eventos_dias: v['retencion_eventos_dias'],
          retencion_grabacion_dias: v['retencion_grabacion_dias'], palabras_clave: v['palabras_clave'] ?? [] }),
      };
      case 'video': return {
        titulo: 'Direcciones públicas y video', icono: 'videocam',
        descripcion: 'Se usan para armar los enlaces de los mensajes y las direcciones de video (WHEP/HLS) que recibe el navegador.',
        campos: [
          { clave: 'url_publica', etiqueta: 'URL pública de la app', tipo: 'texto', ancho: true, placeholder: 'https://tesoro.tuapo.co' },
          { clave: 'whep_base', etiqueta: 'Base WHEP (WebRTC)', tipo: 'texto', ancho: true, placeholder: 'https://api.tuapo.co/video' },
          { clave: 'hls_base', etiqueta: 'Base HLS', tipo: 'texto', ancho: true, placeholder: 'https://api.tuapo.co/video-hls' },
        ],
        valores: { ...a },
        salida: (v) => ({ url_publica: v['url_publica'], whep_base: v['whep_base'], hls_base: v['hls_base'] }),
      };
      case 'telegram': return {
        titulo: 'Telegram (canal principal)', icono: 'send',
        descripcion: 'Cree un bot con @BotFather (comando /newbot) y pegue aquí el token. El servidor lo consulta hacia afuera (sin webhook ni puertos).',
        campos: [{ clave: 'telegram_bot_token', etiqueta: 'Token del bot', tipo: 'clave', guardado: a.telegram.configurado, ancho: true, requerido: !a.telegram.configurado }],
        valores: {},
        salida: (v) => ({ telegram_bot_token: v['telegram_bot_token'] }),
      };
      case 'whatsapp': return {
        titulo: 'WhatsApp', icono: 'chat',
        campos: [
          { clave: 'proveedor', etiqueta: 'Proveedor', tipo: 'seleccion', requerido: true, opciones: PROVEEDORES, ancho: true },
          { clave: 'origen', etiqueta: 'Número de origen', tipo: 'texto', visible: (v) => v['proveedor'] !== 'NINGUNO' },
          { clave: 'whatsapp_phone_id', etiqueta: 'Phone number ID (Meta)', tipo: 'clave', visible: (v) => v['proveedor'] === 'META_CLOUD', guardado: a.whatsapp.configurado },
          { clave: 'whatsapp_token', etiqueta: 'Token de acceso (Meta)', tipo: 'clave', visible: (v) => v['proveedor'] === 'META_CLOUD', guardado: a.whatsapp.configurado },
          { clave: 'twilio_whatsapp_from', etiqueta: 'Remitente WhatsApp de Twilio', tipo: 'clave', visible: (v) => v['proveedor'] === 'TWILIO', guardado: a.twilio.configurado,
            ayuda: 'Las credenciales de la cuenta Twilio van en el bloque Twilio.' },
        ],
        valores: { proveedor: a.whatsapp.proveedor, origen: a.whatsapp.origen },
        salida: (v) => ({ whatsapp: { proveedor: v['proveedor'], origen: v['origen'] ?? null }, whatsapp_phone_id: v['whatsapp_phone_id'],
          whatsapp_token: v['whatsapp_token'], twilio_whatsapp_from: v['twilio_whatsapp_from'] }),
      };
      case 'twilio': return {
        titulo: 'Twilio (llamadas de voz)', icono: 'call',
        descripcion: 'Para el canal LLAMADA: el sistema llama y lee la alarma con voz.',
        campos: [
          { clave: 'twilio_sid', etiqueta: 'Account SID', tipo: 'clave', guardado: a.twilio.configurado },
          { clave: 'twilio_token', etiqueta: 'Auth token', tipo: 'clave', guardado: a.twilio.configurado },
          { clave: 'twilio_voz_from', etiqueta: 'Número de origen de las llamadas', tipo: 'clave', guardado: !!a.twilio.origen_voz },
          { clave: 'origen_voz', etiqueta: 'Número visible (referencia)', tipo: 'texto' },
        ],
        valores: { origen_voz: a.twilio.origen_voz },
        salida: (v) => ({ twilio_sid: v['twilio_sid'], twilio_token: v['twilio_token'], twilio_voz_from: v['twilio_voz_from'], twilio: { origen_voz: v['origen_voz'] ?? null } }),
      };
      case 'webhook': return {
        titulo: 'Webhook', icono: 'webhook',
        descripcion: 'Cada aviso del canal WEBHOOK se envía como POST JSON firmado con el secreto (cabecera de firma HMAC).',
        campos: [
          { clave: 'webhook_url', etiqueta: 'URL', tipo: 'texto', ancho: true, placeholder: 'https://…' },
          { clave: 'webhook_secreto', etiqueta: 'Secreto de firma', tipo: 'clave', guardado: !!a.webhook.url, ancho: true },
        ],
        valores: { webhook_url: a.webhook.url },
        salida: (v) => ({ webhook_url: v['webhook_url'] ?? '', webhook_secreto: v['webhook_secreto'] }),
      };
      case 'email': return {
        titulo: 'Correo', icono: 'mail',
        descripcion: 'Sale por el Centro de Notificaciones de la plataforma, con la captura adjunta.',
        campos: [
          { clave: 'habilitado', etiqueta: 'Enviar alarmas por correo', tipo: 'booleano', ancho: true },
          { clave: 'remitente', etiqueta: 'Remitente', tipo: 'texto', ancho: true, placeholder: 'seguridad@tuapo.co' },
        ],
        valores: { habilitado: a.email.habilitado, remitente: a.email.remitente },
        salida: (v) => ({ email: { habilitado: !!v['habilitado'], remitente: v['remitente'] ?? null } }),
      };
      case 'privacidad': return {
        titulo: 'Privacidad y datos sensibles', icono: 'privacy_tip',
        campos: [
          { clave: 'rostros_habilitado', etiqueta: 'Reconocimiento facial', tipo: 'booleano', ancho: true,
            ayuda: 'Solo compara contra personas enroladas con consentimiento o soporte legal. Los rostros desconocidos no se guardan.' },
          { clave: 'umbral_rostro', etiqueta: 'Umbral de similitud', tipo: 'rango', min: 0.2, max: 0.8, paso: 0.01, ancho: true,
            ayuda: 'Más alto = menos falsos positivos pero más rostros sin reconocer. Recomendado 0,36–0,45.' },
          { clave: 'demografia_habilitada', etiqueta: 'Demografía (edad y género estimados, solo agregada)', tipo: 'booleano', ancho: true,
            ayuda: 'Apagada por defecto. Requiere aprobación del área jurídica y un modelo con licencia comercial.' },
          { clave: 'aviso_privacidad', etiqueta: 'Aviso de videovigilancia', tipo: 'area', ancho: true,
            ayuda: 'Texto del aviso que debe estar visible en las sedes (Guía SIC de videovigilancia).' },
          { clave: 'retencion_capturas_dias', etiqueta: 'Retención de capturas (días)', tipo: 'numero', min: 1, seccion: 'Retención' },
          { clave: 'retencion_grabacion_dias', etiqueta: 'Retención de grabación (días)', tipo: 'numero', min: 1 },
        ],
        valores: { ...a },
        salida: (v) => ({ rostros_habilitado: !!v['rostros_habilitado'], umbral_rostro: Number(v['umbral_rostro']), demografia_habilitada: !!v['demografia_habilitada'],
          aviso_privacidad: v['aviso_privacidad'] ?? null, retencion_capturas_dias: v['retencion_capturas_dias'], retencion_grabacion_dias: v['retencion_grabacion_dias'] }),
      };
    }
  }

  async editar(b: Bloque): Promise<void> {
    const a = this.ajustes();
    if (!a) return;
    const d = this.def(b, a);
    const r = await abrirFormulario<Ajustes>(this.dialog, {
      titulo: d.titulo, icono: d.icono, descripcion: d.descripcion, campos: d.campos, valores: d.valores,
      aviso: d.campos.some((c) => c.tipo === 'clave') ? { tono: 'info', texto: 'Los secretos solo se escriben: nunca se vuelven a mostrar. Déjelos vacíos para no cambiarlos.' } : undefined,
      guardar: (v) => {
        const salida = d.salida(v);
        // Secretos vacíos fuera: vacío = no cambia.
        for (const k of Object.keys(salida) as (keyof AjustesEntrada)[]) if (salida[k] === undefined || salida[k] === '') delete salida[k];
        return this.api.guardarAjustes(salida);
      },
    });
    if (!r) return;
    this.acciones.aviso('Ajustes guardados.');
    if ((r as Ajustes).telegram) this.ajustes.set(r as Ajustes); else this.cargar();
  }

  async probar(canal: Canal): Promise<void> {
    const r = await abrirFormulario<Record<string, any>>(this.dialog, {
      titulo: `Probar ${NOMBRE_CANAL[canal]}`, icono: 'science', ancho: '440px', textoGuardar: 'Enviar prueba',
      campos: [{ clave: 'destino', etiqueta: canal === 'TELEGRAM' ? 'chat_id de destino' : canal === 'EMAIL' ? 'Correo' : canal === 'WEBHOOK' ? 'URL (vacía = la configurada)' : 'Número (+57…)',
        tipo: 'texto', requerido: canal !== 'WEBHOOK', ancho: true }],
    });
    if (!r) return;
    try {
      const res = await firstValueFrom(this.api.probarCanal(canal, r['destino'] ?? ''));
      this.acciones.aviso(res.ok ? `Prueba enviada por ${NOMBRE_CANAL[canal]}.` : res.mensaje || 'La prueba falló.', !res.ok);
    } catch (e) { this.acciones.aviso(mensajeDeError(e, 'La prueba falló.'), true); }
  }
}
