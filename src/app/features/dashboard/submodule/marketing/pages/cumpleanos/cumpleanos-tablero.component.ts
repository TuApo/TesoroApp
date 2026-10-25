import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import Swal from 'sweetalert2';
import { CalendarioCelebraciones, DiaCelebracion, PersonaCelebradaAdmin } from '../../../../components/celebracion/celebracion.models';
import { CelebracionService } from '../../../../components/celebracion/celebracion.service';
import { fechaLarga, hoyBogota } from '../../../../components/celebracion/preparar';
import { CumpleanosVistasComponent } from './cumpleanos-vistas.component';
import { CumpleanosUnionService, PadronRango, estadoCorreo, horaEnvio, normalizarCedula } from './cumpleanos-union.service';
import { ConfigCumpleanos, CumpleanosDelDia } from '../../../nomina/service/cumpleanos/cumpleanos.service';

type TipoPendiente = 'ia' | 'foto' | 'correo' | 'etiquetas' | 'jefe';
interface Pendiente { tipo: TipoPendiente; texto: string; icono: string }
/** Una fila por persona con todo lo que le falta, de lo más urgente a lo menos. */
interface Alerta { persona: PersonaCelebradaAdmin; fecha: string; pendientes: Pendiente[] }
const PESO: Record<TipoPendiente, number> = { ia: 0, foto: 1, correo: 2, etiquetas: 3, jefe: 4 };

/**
 * Cumpleaños › Tablero: quién se celebra hoy, lo que viene en la semana, lo que necesita
 * atención antes de que salga (sin foto, sin votos del equipo, fondo de IA por revisar) y
 * cuánta gente vio la celebración los últimos 30 días.
 */
@Component({
  selector: 'app-cumpleanos-tablero',
  standalone: true,
  imports: [RouterLink, MatIconModule, DecimalPipe, CumpleanosVistasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cumpleanos-tablero.component.html',
  styleUrls: ['../banners/pestanas-banners.css', './cumpleanos-admin.component.css', './cumpleanos-tablero.component.css'],
})
export class CumpleanosTableroComponent implements OnInit {
  private readonly api = inject(CelebracionService);
  private readonly union = inject(CumpleanosUnionService);

  /** Lo del correo de cumpleaños (ms-payroll) para los mismos días. */
  readonly padron = signal<PadronRango | null>(null);
  readonly cfgCorreo = signal<ConfigCumpleanos | null>(null);
  readonly activosPadron = signal<number | null>(null);
  readonly detalles = signal<Record<string, CumpleanosDelDia | null>>({});
  readonly viendoVistas = signal(false);

  readonly cal = signal<CalendarioCelebraciones | null>(null);
  readonly sinPermiso = signal(false);
  readonly hoy = hoyBogota();

  readonly diaHoy = computed(() => this.cal()?.dias.find((d) => d.fecha === this.hoy) ?? null);
  readonly semana = computed(() => (this.cal()?.dias ?? [])
    .filter((d) => d.fecha > this.hoy && d.fecha <= sumar(this.hoy, 7) && d.personas.length));
  readonly proximos30 = computed(() => (this.cal()?.dias ?? []).filter((d) => d.fecha >= this.hoy && d.personas.length));
  readonly pasados = computed(() => (this.cal()?.dias ?? []).filter((d) => d.fecha < this.hoy && d.personas.length));

  /** Lo que conviene resolver antes de que salga, de lo más urgente a lo menos. */
  readonly alertas = computed<Alerta[]>(() => {
    const r: Alerta[] = [];
    for (const d of this.proximos30()) {
      for (const p of d.personas) {
        const pendientes: Pendiente[] = [];
        if (p.estado_ia === 'LISTA') pendientes.push({ tipo: 'ia', icono: 'auto_awesome', texto: 'Fondo con IA por revisar' });
        if (!p.foto_url) pendientes.push({ tipo: 'foto', icono: 'no_photography', texto: 'Sin foto' });
        if (!p.etiquetas?.length && !p.estado_ia) pendientes.push({ tipo: 'etiquetas', icono: 'sell', texto: 'Sin etiquetas del equipo' });
        if (!p.jefe_documento && !p.mensaje_jefe) pendientes.push({ tipo: 'jefe', icono: 'person_off', texto: 'Sin jefe ni mensaje' });
        // Con el padrón vacío no se avisa persona por persona: lo dice una sola tarjeta.
        const co = this.activosPadron() ? estadoCorreo(p.documento, d.fecha, this.hoy, this.padron(), this.detalles()[d.fecha], this.cfgCorreo()) : null;
        if (co && co.clase !== 'ok' && co.clase !== 'neutro') pendientes.push({ tipo: 'correo', icono: co.icono, texto: co.texto });
        if (pendientes.length) r.push({ persona: p, fecha: d.fecha, pendientes: pendientes.sort((a, b) => PESO[a.tipo] - PESO[b.tipo]) });
      }
    }
    // Lo que hay que revisar ya va primero; después, por fecha.
    const revisar = (a: Alerta) => (a.pendientes[0].tipo === 'ia' ? 0 : 1);
    return r.sort((a, b) => revisar(a) - revisar(b) || a.fecha.localeCompare(b.fecha)).slice(0, 8);
  });

  readonly kpis = computed(() => {
    const pas = this.pasados();
    const vistas = pas.reduce((s, d) => s + d.vistas, 0);
    const cerradas = pas.reduce((s, d) => s + d.cerradas_antes, 0);
    const personas30 = this.proximos30().reduce((s, d) => s + d.personas.length, 0);
    return {
      semana: this.semana().reduce((s, d) => s + d.personas.length, 0),
      porRevisar: this.proximos30().flatMap((d) => d.personas).filter((p) => p.estado_ia === 'LISTA').length,
      sinFoto: this.proximos30().flatMap((d) => d.personas).filter((p) => !p.foto_url).length,
      personas30,
      vistas,
      diasConCelebracion: pas.length,
      promedio: pas.length ? vistas / pas.length : 0,
      cierre: vistas ? cerradas / vistas : 0,
    };
  });

  /** Barras de vistas por día (últimos 30 días con celebración). */
  readonly barras = computed(() => {
    const pas = this.pasados().slice(-14);
    const max = Math.max(1, ...pas.map((d) => d.vistas));
    return pas.map((d) => ({ fecha: d.fecha, vistas: d.vistas, alto: Math.round((d.vistas / max) * 100), nombres: d.personas.map((p) => p.primer_nombre).join(', ') }));
  });

  /** El correo de hoy, en una frase para la tarjeta. */
  readonly correoHoy = computed(() => {
    const r = this.padron();
    if (!r?.disponible) return null;
    if (this.activosPadron() === 0) return { valor: '—', texto: 'padrón de correos vacío: nadie recibe correo', alerta: true };
    const d = r.dias.get(this.hoy);
    if (!d) return { valor: '0', texto: 'correos de cumpleaños hoy', alerta: false };
    const con = d.total - d.sin_correo;
    if (d.enviado) return { valor: String(con), texto: 'correos de cumpleaños enviados hoy', alerta: false };
    const cfg = this.cfgCorreo();
    return cfg?.auto_activo
      ? { valor: String(con), texto: `correos salen hoy a las ${horaEnvio(cfg)}`, alerta: false }
      : { valor: String(con), texto: 'correos de hoy sin enviar (envío automático apagado)', alerta: true };
  });

  ngOnInit(): void {
    this.api.calendario(sumar(this.hoy, -30), sumar(this.hoy, 30)).subscribe({
      next: (c) => { this.cal.set(c); this.cargarCorreos(c); },
      error: (e: HttpErrorResponse) => { if (e.status === 403) this.sinPermiso.set(true); },
    });
  }

  private cargarCorreos(c: CalendarioCelebraciones): void {
    forkJoin({ rango: this.union.padronEntre(this.hoy, sumar(this.hoy, 30)), cfg: this.union.config(), activos: this.union.activosEnPadron() })
      .subscribe(({ rango, cfg, activos }) => {
        this.padron.set(rango);
        this.cfgCorreo.set(cfg);
        this.activosPadron.set(activos);
        if (!rango.disponible || !activos) return;
        for (const d of c.dias) {
          if (d.fecha < this.hoy || !rango.dias.has(d.fecha) || !d.personas.some((p) => normalizarCedula(p.documento))) continue;
          this.union.delDia(d.fecha).subscribe((det) => this.detalles.update((m) => ({ ...m, [d.fecha]: det })));
        }
      });
  }

  fecha(f: string): string { return fechaLarga(f); }
  url(u: string | null | undefined): string { return this.api.urlFoto(u); }
  corta(f: string): string { const [, m, d] = f.split('-'); return `${Number(d)}/${Number(m)}`; }

  relativo(f: string): string {
    const n = Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${this.hoy}T12:00:00Z`)) / 86_400_000);
    return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : `En ${n} días`;
  }

  iniciales(n: string): string {
    const p = (n || '').trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length > 2 ? 2 : 1][0] : '')).toUpperCase();
  }

  simularIngreso(): void {
    this.api.olvidarVista().subscribe({
      next: () => {
        if (!this.diaHoy()?.personas.length) {
          Swal.fire({ icon: 'info', title: 'Hoy no hay nadie', text: 'La celebración solo sale los días que hay cumpleañeros.' });
          return;
        }
        this.api.revisarAhora$.next();
      },
    });
  }

  nombreDia(d: DiaCelebracion): string { return d.plantilla_efectiva?.nombre ?? '—'; }
}

function sumar(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n, 12)).toISOString().slice(0, 10);
}
