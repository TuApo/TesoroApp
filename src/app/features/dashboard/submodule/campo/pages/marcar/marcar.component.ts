import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { CoordinadoresFormulariosService } from '../../../coordinadores/services/coordinadores-formularios.service';
import { ETIQUETA_ROSTRO, Finca, FuenteUbicacion, Marcacion, TipoMarcacion } from '../../campo.models';
import { AvisoUbicacionComponent } from '../../components/aviso-ubicacion/aviso-ubicacion.component';
import { CamaraCampoComponent } from '../../components/camara-campo/camara-campo.component';
import { CirculoMapa, MapaCampoComponent, MarcadorMapa } from '../../components/mapa-campo/mapa-campo.component';
import { CampoService, horaCorta } from '../../services/campo.service';
import { posicionActual, vibrar } from '../../services/dispositivo';

type Paso = 'qr' | 'finca' | 'ubicacion' | 'selfie' | 'confirmar' | 'listo';

/**
 * Marcar llegada o salida en una finca: QR → ubicación → selfie → confirmar.
 *
 * Todo funciona sin señal: el QR se valida contra la huella guardada en el paquete, el GPS
 * no necesita internet, el mapa usa los mosaicos descargados y la marcación entra a la cola
 * del teléfono con su hora real. Al volver la señal se envía sola y la IA compara la selfie
 * con la foto de referencia.
 *
 * Se llega aquí desde el inicio, desde la agenda (`?finca=<id>`) o leyendo el QR con la
 * cámara del sistema (`/campo/qr?f=&t=` → `?f=&t=`).
 */
@Component({
  selector: 'app-campo-marcar',
  standalone: true,
  imports: [MatIconModule, RouterLink, CamaraCampoComponent, MapaCampoComponent, AvisoUbicacionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './marcar.component.html',
  styleUrls: ['../../campo-ui.css', './marcar.component.css'],
})
export class MarcarComponent {
  readonly campo = inject(CampoService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formularios = inject(CoordinadoresFormulariosService);
  private readonly destroy = inject(DestroyRef);

  readonly paso = signal<Paso>('qr');
  readonly tipo = signal<TipoMarcacion>('ENTRADA');
  readonly camara = signal<'qr' | 'selfie' | null>(null);

  readonly qrTexto = signal<string | null>(null);
  readonly qrOk = signal<boolean | null>(null);
  readonly qrMotivo = signal<string | null>(null);
  readonly finca = signal<Finca | null>(null);
  readonly buscar = signal('');

  readonly lat = signal<number | null>(null);
  readonly lon = signal<number | null>(null);
  readonly precision = signal<number | null>(null);
  readonly fuente = signal<FuenteUbicacion>('GPS');
  readonly capturadoMs = signal<number | null>(null);
  readonly buscandoGps = signal(false);
  readonly errorGps = signal<string | null>(null);
  readonly eligiendoEnMapa = signal(false);

  readonly selfie = signal<Blob | null>(null);
  readonly selfieUrl = signal<string | null>(null);
  readonly sinSelfie = signal(false);
  readonly nota = signal('');

  readonly enviando = signal(false);
  readonly resultado = signal<{ enviada: Marcacion | null; enCola: boolean } | null>(null);
  readonly errorEnvio = signal<string | null>(null);
  readonly planillaRuta = signal<string | null>(null);

  readonly etiquetaRostro = ETIQUETA_ROSTRO;
  readonly horaCorta = horaCorta;

  readonly evaluacion = computed(() => this.campo.evaluar(this.finca(), this.lat(), this.lon(), this.precision()));

  readonly fincasFiltradas = computed(() => {
    const q = this.buscar().trim().toLowerCase();
    const todas = this.campo.fincas();
    const l = q ? todas.filter(f => f.nombre.toLowerCase().includes(q) || (f.zona_nombre ?? '').toLowerCase().includes(q)) : todas;
    // Primero las mías, después por cercanía si ya tengo posición.
    const p = this.campo.ultimaPosicion();
    return [...l].sort((a, b) => Number(b.mia) - Number(a.mia) || (p ? dist(p, a) - dist(p, b) : a.nombre.localeCompare(b.nombre)))
      .slice(0, 60);
  });

  readonly tareasDeLaFinca = computed(() => {
    const f = this.finca();
    return f ? this.campo.tareasPendientes().filter(t => t.finca_id === f.id) : [];
  });

  readonly marcadores = computed<MarcadorMapa[]>(() => {
    const out: MarcadorMapa[] = [];
    const f = this.finca();
    if (f?.lat != null && f.lon != null) out.push({ id: 'finca', lat: f.lat, lon: f.lon, tipo: 'finca', color: f.zona_color || '#16A34A', etiqueta: f.nombre });
    if (this.lat() != null && this.lon() != null) out.push({ id: 'yo', lat: this.lat()!, lon: this.lon()!, tipo: 'yo', etiqueta: 'Tú' });
    return out;
  });

  readonly circulos = computed<CirculoMapa[]>(() => {
    const f = this.finca();
    const out: CirculoMapa[] = [];
    if (f?.lat != null && f.lon != null) out.push({ lat: f.lat, lon: f.lon, radioM: f.radio_m, color: this.evaluacion().dentro === false ? '#DC2626' : '#16A34A' });
    if (this.lat() != null && this.precision()) out.push({ lat: this.lat()!, lon: this.lon()!, radioM: this.precision()!, color: '#2563EB', punteado: true });
    return out;
  });

  readonly encuadre = computed<[number, number][] | null>(() => {
    const pts: [number, number][] = [];
    const f = this.finca();
    if (f?.lat != null && f.lon != null) pts.push([f.lat, f.lon]);
    if (this.lat() != null && this.lon() != null) pts.push([this.lat()!, this.lon()!]);
    return pts.length ? pts : null;
  });

  constructor() {
    this.campo.iniciar();
    const q = this.ruta.snapshot.queryParamMap;
    if (q.get('tipo') === 'SALIDA' || q.get('tipo') === 'ENTRADA') this.tipo.set(q.get('tipo') as TipoMarcacion);
    const f = q.get('f'), t = q.get('t');
    if (!f) this.camara.set('qr');
    // El paquete guardado en el teléfono puede tardar un instante en cargar: sin él no se valida el QR.
    void this.campo.esperar().then(() => {
      // ¿Hay una entrada abierta? Entonces lo natural es marcar la salida de esa finca.
      if (!q.get('tipo') && this.campo.marcacionAbierta()) {
        this.tipo.set('SALIDA');
        const abierta = this.campo.marcacionAbierta();
        const fa = this.campo.fincas().find(x => x.id === abierta?.finca_id);
        if (fa && !this.finca()) this.finca.set(fa);
      }
      if (f && t) {
        void this.alLeerQr(`${location.origin}/campo/qr?f=${encodeURIComponent(f)}&t=${encodeURIComponent(t)}`);
      } else if (q.get('finca')) {
        const fi = this.campo.fincas().find(x => x.id === Number(q.get('finca')));
        if (fi) this.finca.set(fi);
      }
    });
    // Ubicación en paralelo desde ya: cuando llegue al paso, ya la tiene.
    if (this.campo.consentimientoUbicacion() === true) void this.tomarUbicacion(true);
    this.formularios.formulariosDelMenu().formularios
      .filter(x => x.grupo === 'visitas' && /finca|visita/i.test(x.nombre))
      .slice(0, 1).forEach(x => this.planillaRuta.set(x.ruta));
    this.destroy.onDestroy(() => { const u = this.selfieUrl(); if (u) URL.revokeObjectURL(u); });
  }

  // ─── QR ─────────────────────────────────────────────────────────────────

  async alLeerQr(texto: string): Promise<void> {
    this.camara.set(null);
    this.qrTexto.set(texto);
    const r = await this.campo.validarQr(texto);
    this.qrOk.set(r.valido);
    this.qrMotivo.set(r.motivo);
    if (r.finca) this.finca.set(r.finca);
    vibrar(r.valido ? 40 : [80, 60, 80]);
    if (!r.finca && !r.valido && r.motivo?.startsWith('Ese código')) { this.paso.set('qr'); return; }
    this.paso.set('ubicacion');
  }

  sinQr(): void {
    this.camara.set(null);
    this.qrTexto.set(null);
    this.qrOk.set(null);
    this.qrMotivo.set(null);
    this.paso.set(this.finca() ? 'ubicacion' : 'finca');
  }

  escanear(): void {
    this.qrMotivo.set(null);
    this.camara.set('qr');
  }

  elegirFinca(f: Finca): void {
    this.finca.set(f);
    this.paso.set('ubicacion');
  }

  // ─── Ubicación ──────────────────────────────────────────────────────────

  async tomarUbicacion(silencioso = false): Promise<void> {
    if (this.campo.consentimientoUbicacion() !== true) return;
    this.buscandoGps.set(true);
    if (!silencioso) this.errorGps.set(null);
    try {
      const p = await posicionActual(25_000);
      this.lat.set(p.lat);
      this.lon.set(p.lon);
      this.precision.set(p.precision_m);
      this.fuente.set(p.fuente);
      this.capturadoMs.set(p.capturado_ms);
      this.errorGps.set(null);
      this.eligiendoEnMapa.set(false);
    } catch (e: any) {
      this.errorGps.set(e?.message || 'No se pudo tomar la ubicación');
    } finally {
      this.buscandoGps.set(false);
    }
  }

  alResponderUbicacion(acepta: boolean): void {
    if (acepta) void this.tomarUbicacion();
  }

  compartirUbicacion(): void {
    this.campo.responderUbicacion(true);
    void this.tomarUbicacion();
  }

  elegirEnMapa(): void {
    this.eligiendoEnMapa.set(true);
  }

  alTocarMapa(p: { lat: number; lon: number }): void {
    if (!this.eligiendoEnMapa()) return;
    this.lat.set(p.lat);
    this.lon.set(p.lon);
    this.precision.set(null);
    this.fuente.set('MAPA');
    this.capturadoMs.set(Date.now());
    vibrar(20);
  }

  continuarASelfie(): void {
    this.paso.set('selfie');
    if (!this.selfie() && !this.sinSelfie()) this.camara.set('selfie');
  }

  // ─── Selfie ─────────────────────────────────────────────────────────────

  alFoto(b: Blob): void {
    const u = this.selfieUrl();
    if (u) URL.revokeObjectURL(u);
    this.selfie.set(b);
    this.selfieUrl.set(URL.createObjectURL(b));
    this.camara.set(null);
    this.paso.set('confirmar');
  }

  repetirSelfie(): void { this.camara.set('selfie'); }

  seguirSinSelfie(): void {
    this.sinSelfie.set(true);
    this.camara.set(null);
    this.paso.set('confirmar');
  }

  // ─── Confirmar ──────────────────────────────────────────────────────────

  async registrar(): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.errorEnvio.set(null);
    try {
      const r = await this.campo.marcar({
        tipo: this.tipo(), finca: this.finca(), qr: this.qrTexto(), qrOk: this.qrOk(),
        lat: this.lat(), lon: this.lon(), precision: this.precision(), fuente: this.fuente(),
        selfie: this.selfie(), nota: this.nota().trim() || null, capturadoMs: Date.now(),
      });
      this.resultado.set(r);
      vibrar([40, 50, 120]);
      this.paso.set('listo');
    } catch (e: any) {
      this.errorEnvio.set(e?.message || 'No se pudo guardar la marcación en el teléfono');
    } finally {
      this.enviando.set(false);
    }
  }

  volver(): void {
    const orden: Paso[] = ['qr', 'finca', 'ubicacion', 'selfie', 'confirmar'];
    const i = orden.indexOf(this.paso());
    if (i <= 0) { void this.router.navigateByUrl('/dashboard/coordinadores'); return; }
    let anterior = orden[i - 1];
    if (anterior === 'finca' && this.qrTexto()) anterior = 'qr';
    this.paso.set(anterior);
  }

  otraVez(): void {
    this.resultado.set(null);
    this.qrTexto.set(null);
    this.qrOk.set(null);
    this.selfie.set(null);
    this.sinSelfie.set(false);
    this.nota.set('');
    this.tipo.set(this.tipo() === 'ENTRADA' ? 'SALIDA' : 'ENTRADA');
    this.paso.set('qr');
    this.camara.set('qr');
  }

  cambiarTipo(t: TipoMarcacion): void { this.tipo.set(t); }

  textoPrecision(): string {
    const p = this.precision();
    if (this.fuente() === 'MAPA') return 'Punto elegido en el mapa';
    if (p == null) return 'Precisión desconocida';
    return `Precisión ±${p} m${p > 100 ? ' (baja: sal a cielo abierto)' : ''}`;
  }
}

function dist(p: { lat: number; lon: number }, f: Finca): number {
  if (f.lat == null || f.lon == null) return Number.MAX_SAFE_INTEGER;
  return (p.lat - f.lat) ** 2 + (p.lon - f.lon) ** 2;
}
