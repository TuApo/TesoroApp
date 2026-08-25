import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DynamicField, FieldMode, FieldValue, LocationValue, validateFieldValue,
} from '../field.model';

/**
 * Campo LOCATION — captura de coordenadas GPS del dispositivo.
 * 'preview': botón que invoca navigator.geolocation.getCurrentPosition
 * (enableHighAccuracy, timeout 10 s); el valor es { lat, lng, timestamp }
 * con 6 decimales. La precisión (accuracy) se muestra pero NO viaja en el valor.
 *
 * 'readonly': coordenadas + enlace externo "Abrir en Google Maps".
 * DECISIÓN: la plataforma no tiene librería de mapas embebidos, así que el
 * detalle enlaza al mapa externo (target _blank, rel noopener) en vez de
 * incrustar un mapa.
 */
@Component({
  selector: 'app-location-field',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df-field" [class.df-field--error]="showErrors && !!error">
      <label class="df-field__label" [attr.for]="inputId">
        {{ field.label }}
        @if (field.required) { <span class="df-field__req" aria-hidden="true">*</span> }
      </label>
      @if (field.schema.description) {
        <p class="df-field__desc">{{ field.schema.description }}</p>
      }

      @switch (mode) {
        @case ('readonly') {
          @if (loc; as l) {
            <div class="loc-ro">
              <p class="df-field__value loc-coords">
                <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
                <span>Lat: {{ coord(l.lat) }} · Lng: {{ coord(l.lng) }}</span>
                @if (capturedAt; as ts) {
                  <span class="loc-meta">Capturada el {{ ts }}</span>
                }
              </p>
              <a class="df-field__btn loc-link" [href]="mapsUrl" target="_blank" rel="noopener">
                <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                Abrir en Google Maps
              </a>
            </div>
          } @else {
            <p class="df-field__value">—</p>
          }
        }
        @case ('config') {
          <button type="button" class="df-field__btn" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">my_location</span>
            Capturar ubicación
          </button>
        }
        @default {
          <div class="loc-capture">
            <button type="button" class="df-field__btn"
                    [id]="inputId"
                    (click)="capture()"
                    [disabled]="capturing() || !geoSupported"
                    [attr.aria-required]="field.required"
                    [attr.aria-invalid]="showErrors && !!error">
              @if (capturing()) {
                <span class="material-symbols-outlined df-spin" aria-hidden="true">progress_activity</span>
                Obteniendo ubicación…
              } @else {
                <span class="material-symbols-outlined" aria-hidden="true">my_location</span>
                {{ loc ? 'Actualizar ubicación' : 'Capturar ubicación' }}
              }
            </button>
            @if (!geoSupported) {
              <p class="df-field__desc">Este dispositivo o navegador no soporta geolocalización.</p>
            }
            @if (loc; as l) {
              <p class="df-field__value loc-coords">
                <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
                <span>Lat: {{ coord(l.lat) }} · Lng: {{ coord(l.lng) }}</span>
                @if (accuracy(); as acc) {
                  <span class="loc-meta">precisión ±{{ acc }} m</span>
                }
              </p>
            }
            @if (geoError(); as msg) {
              <p class="df-field__error" role="alert">{{ msg }}</p>
            }
          </div>
        }
      }

      @if (showErrors && error && mode === 'preview') {
        <p class="df-field__error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styleUrls: ['../field-shared.css'],
  styles: [`
    .loc-capture { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
    .loc-ro { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
    .loc-coords {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .loc-coords .material-symbols-outlined {
      font-size: 18px;
      color: var(--navy, #21263c);
    }
    .loc-meta {
      color: var(--slate-500, #64748b);
      font-size: 0.85rem;
    }
    .loc-link { text-decoration: none; }
    .loc-link:focus-visible {
      outline: 2px solid var(--lime, #8cd50a);
      outline-offset: 1px;
    }
    .df-spin { animation: df-spin 1s linear infinite; }
    @keyframes df-spin { to { transform: rotate(360deg); } }
  `],
})
export class LocationFieldComponent {
  @Input({ required: true }) field!: DynamicField;
  @Input() mode: FieldMode = 'preview';
  @Input() value: FieldValue = null;
  @Input() showErrors = false;
  @Output() valueChange = new EventEmitter<FieldValue>();

  readonly capturing = signal(false);
  readonly geoError = signal<string | null>(null);
  /** Precisión (m) de la última captura de ESTA sesión; informativa, no viaja en el valor. */
  readonly accuracy = signal<number | null>(null);

  readonly geoSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  get inputId(): string {
    return `df-${this.field.name ?? this.field.label}`;
  }

  get error(): string | null {
    return validateFieldValue(this.field, this.value);
  }

  /** Valor tipado solo si tiene la forma LocationValue real. */
  get loc(): LocationValue | null {
    const v = this.value;
    if (v && typeof v === 'object' && !Array.isArray(v)
        && typeof (v as LocationValue).lat === 'number'
        && typeof (v as LocationValue).lng === 'number') {
      return v as LocationValue;
    }
    return null;
  }

  get mapsUrl(): string {
    const l = this.loc;
    return l ? `https://maps.google.com/?q=${l.lat},${l.lng}` : '';
  }

  /** Fecha de captura en formato es-CO (solo si el valor trae timestamp válido). */
  get capturedAt(): string | null {
    const ts = this.loc?.timestamp;
    if (!ts) return null;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  }

  coord(n: number): string {
    return n.toFixed(6);
  }

  capture(): void {
    if (!this.geoSupported) {
      this.geoError.set('Este dispositivo o navegador no soporta geolocalización.');
      return;
    }
    this.capturing.set(true);
    this.geoError.set(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        // 6 decimales ≈ 0,1 m: suficiente y estable para el payload
        const val: LocationValue = {
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
          timestamp: new Date().toISOString(),
        };
        this.accuracy.set(pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null);
        this.capturing.set(false);
        this.value = val;
        this.valueChange.emit(val);
      },
      err => {
        this.capturing.set(false);
        this.geoError.set(this.messageFor(err));
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  private messageFor(err: GeolocationPositionError): string {
    switch (err.code) {
      case err.PERMISSION_DENIED:
        return 'Permiso de ubicación denegado. Actívalo en el navegador e intenta de nuevo.';
      case err.POSITION_UNAVAILABLE:
        return 'La ubicación no está disponible en este momento.';
      case err.TIMEOUT:
        return 'Se agotó el tiempo de espera (10 s) al obtener la ubicación. Intenta de nuevo.';
      default:
        return 'No se pudo obtener la ubicación.';
    }
  }
}
