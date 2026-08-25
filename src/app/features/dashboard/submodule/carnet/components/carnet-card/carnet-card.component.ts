import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Carnet } from '../../models/carnet.model';

/**
 * Las dos caras del carnet digital, con sello de agua vivo por encima.
 *
 * EL SELLO NO ES DECORACIÓN. Un carnet en pantalla se puede fotografiar y reenviar; la marca
 * de agua lleva la fecha y hora AL SEGUNDO y la cédula de quien lo abrió, así que una captura
 * envejece a la vista de cualquiera: si el reloj del sello no coincide con el de ahora, lo que
 * están mostrando es una foto, no la app. Por eso el reloj corre mientras el carnet esté
 * abierto y no se congela en el instante de emisión.
 *
 * COMPOSICIÓN EN WEBVIEW (Android/Capacitor) — el sello va con opacidad plana sobre fondos
 * OPACOS. Nada de `backdrop-filter` ni `mask-image`: en esta app ya causaron texto fantasma y
 * sangrado entre capas dentro del WebView. `isolation: isolate` en cada cara mantiene el
 * apilamiento local y evita que el sello de una cara se vea a través de la otra durante el giro.
 */
@Component({
  selector: 'app-carnet-card',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './carnet-card.component.html',
  styleUrl: './carnet-card.component.css',
})
export class CarnetCardComponent implements OnInit, OnDestroy {
  /** Ficha a pintar. Sin ella el componente muestra el esqueleto de carga. */
  @Input({ required: true }) carnet!: Carnet;

  /** Foto ya resuelta a data-URL por quien monta el carnet (biométrica o la del perfil). */
  @Input() foto: string | null = null;

  /**
   * Nombre y cargo de respaldo para el personal que no tiene ficha en contratación: el backend
   * los devuelve vacíos y quien abre su propio carnet sí los tiene en sesión.
   */
  @Input() nombreFallback = '';
  @Input() cargoFallback = '';

  /** Oculta el pie con la validez; el panel de identificación pinta el suyo. */
  @Input() compacto = false;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  /** Cara visible. Empieza por el frente, que es lo que se enseña en una portería. */
  readonly cara = signal<'frente' | 'reverso'>('frente');

  /** Reloj del sello de agua. */
  readonly ahora = signal<Date>(new Date());

  /** data-URL del QR ya renderizado, o null mientras se genera / si falla. */
  readonly qr = signal<string | null>(null);

  private reloj: ReturnType<typeof setInterval> | null = null;

  readonly nombre = computed(() => this.carnet?.nombreCompleto?.trim() || this.nombreFallback || '—');
  readonly cargo = computed(() => this.carnet?.cargo?.trim() || this.cargoFallback || '—');

  /** Texto que se repite en diagonal por encima de las dos caras. */
  readonly textoSello = computed(() => {
    const f = this.ahora();
    const fecha = f.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = f.toLocaleTimeString('es-CO', { hour12: false });
    return `TU APO · ${this.carnet?.cedula ?? ''} · ${fecha} ${hora}`;
  });

  /** Filas del sello. Nueve alcanzan a cubrir la tarjeta girada sin dejar esquinas vacías. */
  readonly filasSello = Array.from({ length: 9 }, (_, i) => i);

  readonly iniciales = computed(() => {
    const partes = this.nombre().trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '·';
    const primera = partes[0]?.[0] ?? '';
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (primera + ultima).toUpperCase();
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Un tick por segundo: es lo que hace creíble el sello. Con `provideZonelessChangeDetection`
    // no hay zona que dispare el render, por eso el reloj es una señal y no un campo.
    this.reloj = setInterval(() => this.ahora.set(new Date()), 1000);
    this.destroyRef.onDestroy(() => this.pararReloj());

    void this.generarQr();
  }

  ngOnDestroy(): void {
    this.pararReloj();
  }

  girar(): void {
    this.cara.update(c => (c === 'frente' ? 'reverso' : 'frente'));
  }

  /** Etiqueta legible del estado, para el sello de la cara frontal. */
  get etiquetaEstado(): string {
    switch (this.carnet?.estado) {
      case 'ACTIVO': return 'ACTIVO';
      case 'RETIRADO': return 'RETIRADO';
      default: return 'SIN CONTRATO';
    }
  }

  /** Fecha ISO (yyyy-MM-dd) a formato colombiano, sin caer en el corrimiento de zona. */
  fecha(iso: string): string {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    // Se construye en horario LOCAL a propósito: `new Date('2025-01-15')` se interpreta como
    // UTC y en Colombia (UTC-5) pinta el 14.
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Valor o guion largo: en un carnet, un hueco en blanco parece un error de carga. */
  val(v: string | undefined | null): string {
    const s = (v ?? '').trim();
    return s ? s : '—';
  }

  private pararReloj(): void {
    if (this.reloj) {
      clearInterval(this.reloj);
      this.reloj = null;
    }
  }

  /**
   * `qrcode` se carga bajo demanda: sólo entra al bundle de quien abre un carnet, y así no se
   * ejecuta durante el render de servidor (SSR), donde no hay canvas.
   */
  private async generarQr(): Promise<void> {
    const token = this.carnet?.qrToken;
    if (!token) return;
    try {
      // `qrcode` es CommonJS: según cómo lo empaquete el bundler, el módulo llega en `.default`
      // o en la raíz. Aceptar las dos formas evita un QR en blanco que sólo aparecería en la
      // build de producción.
      const mod: any = await import('qrcode');
      const QRCode = mod?.default ?? mod;
      const dataUrl = await QRCode.toDataURL(token, {
        margin: 1,
        width: 360,
        // 'M' recupera ~15% de daño: suficiente para una pantalla con reflejos o un carnet
        // impreso algo sucio, sin engordar la matriz como haría 'H'.
        errorCorrectionLevel: 'M',
        color: { dark: '#0b1220', light: '#ffffff' },
      });
      this.qr.set(dataUrl);
    } catch {
      // Sin QR el carnet sigue sirviendo: el panel de identificación acepta la cédula tecleada.
      this.qr.set(null);
    }
  }
}
