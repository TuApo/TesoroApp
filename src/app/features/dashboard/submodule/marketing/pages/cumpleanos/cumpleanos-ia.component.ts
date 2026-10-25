import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import {
  CalendarioCelebraciones, CelebracionDelDia, DiaCelebracion, PersonaCelebradaAdmin, PlantillaCelebracionAdmin,
} from '../../../../components/celebracion/celebracion.models';
import { CelebracionService } from '../../../../components/celebracion/celebracion.service';
import { CelebracionProbadorComponent } from '../../../../components/celebracion/celebracion-probador.component';
import { CumpleanosPersonalizacionComponent } from './cumpleanos-personalizacion.component';
import { fechaLarga, hoyBogota } from '../../../../components/celebracion/preparar';
import { armarLocal } from '../../../../components/celebracion/demo';

type Columna = 'revisar' | 'curso' | 'pedir' | 'aprobada';

interface Tarjeta { persona: PersonaCelebradaAdmin; dia: DiaCelebracion }

/**
 * Cumpleaños › Personalización con IA: el flujo de cada cumpleañero de un vistazo, como
 * tablero. El equipo elige etiquetas y el jefe escribe su mensaje (por el enlace de aportes);
 * con eso Higgsfield hace su fondo propio en horizontal y vertical, y Marketing lo aprueba
 * antes de que salga. Cada tarjeta abre el mismo panel que en el calendario.
 */
@Component({
  selector: 'app-cumpleanos-ia',
  standalone: true,
  imports: [RouterLink, MatIconModule, CumpleanosPersonalizacionComponent, CelebracionProbadorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cumpleanos-ia.component.html',
  styleUrls: ['../banners/pestanas-banners.css', './cumpleanos-ia.component.css'],
})
export class CumpleanosIaComponent implements OnInit {
  private readonly api = inject(CelebracionService);

  readonly cal = signal<CalendarioCelebraciones | null>(null);
  readonly plantillas = signal<PlantillaCelebracionAdmin[]>([]);
  readonly sinPermiso = signal(false);
  readonly personalizando = signal<PersonaCelebradaAdmin | null>(null);
  readonly probando = signal<{ base: CelebracionDelDia; textos: { titulo: string | null; mensaje: string | null } } | null>(null);
  readonly hoy = hoyBogota();

  readonly columnas: { id: Columna; nombre: string; ayuda: string; icono: string }[] = [
    { id: 'revisar', nombre: 'Por revisar', ayuda: 'Higgsfield ya entregó: apruébalo o descártalo', icono: 'rate_review' },
    { id: 'curso', nombre: 'Generándose', ayuda: 'En cola o en proceso', icono: 'hourglass_top' },
    { id: 'pedir', nombre: 'Sin pedir', ayuda: 'Aún sale con el fondo de su plantilla', icono: 'auto_awesome' },
    { id: 'aprobada', nombre: 'Aprobadas', ayuda: 'Su fondo propio sale en la celebración', icono: 'verified' },
  ];

  /** Del día de hoy en adelante: lo pasado ya no se personaliza. */
  readonly tarjetas = computed<Record<Columna, Tarjeta[]>>(() => {
    const r: Record<Columna, Tarjeta[]> = { revisar: [], curso: [], pedir: [], aprobada: [] };
    for (const dia of this.cal()?.dias ?? []) {
      if (dia.fecha < this.hoy) continue;
      for (const persona of dia.personas) r[columnaDe(persona)].push({ persona, dia });
    }
    return r;
  });

  readonly total = computed(() => Object.values(this.tarjetas()).reduce((s, l) => s + l.length, 0));

  ngOnInit(): void {
    this.cargar();
    this.api.plantillas().subscribe({ next: (l) => this.plantillas.set(l) });
  }

  cargar(): void {
    this.api.calendario(this.hoy, sumar(this.hoy, 45)).subscribe({
      next: (c) => {
        this.cal.set(c);
        // El panel abierto se queda con la persona fresca (votos, mensaje y estado nuevos).
        const abierta = this.personalizando();
        if (abierta) {
          const fresca = c.dias.flatMap((d) => d.personas).find((p) => p.id === abierta.id);
          if (fresca) this.personalizando.set(fresca);
        }
      },
      error: (e: HttpErrorResponse) => { if (e.status === 403) this.sinPermiso.set(true); },
    });
  }

  fecha(f: string): string { return fechaLarga(f); }
  url(u: string | null | undefined): string { return this.api.urlFoto(u); }

  relativo(f: string): string {
    const n = Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${this.hoy}T12:00:00Z`)) / 86_400_000);
    return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : `En ${n} días`;
  }

  iniciales(n: string): string {
    const p = (n || '').trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length > 2 ? 2 : 1][0] : '')).toUpperCase();
  }

  /** «Ver cómo queda»: el probador con el día de esa persona y la plantilla que le toca. */
  probarPersona(p: PersonaCelebradaAdmin): void {
    const dia = this.cal()?.dias.find((d) => d.fecha === p.fecha);
    const plantilla = this.plantillas().find((x) => x.id === dia?.plantilla_efectiva?.id)
      ?? this.plantillas().find((x) => x.activo) ?? this.plantillas()[0];
    if (!dia || !plantilla) return;
    this.personalizando.set(null);
    const textos = { titulo: dia.titulo, mensaje: dia.mensaje };
    this.probando.set({ base: armarLocal({ fecha: dia.fecha, plantilla, personas: dia.personas, ...textos }), textos });
  }
}

function columnaDe(p: PersonaCelebradaAdmin): Columna {
  switch (p.estado_ia) {
    case 'LISTA': return 'revisar';
    case 'SOLICITADA': case 'GENERANDO': return 'curso';
    case 'APROBADA': return 'aprobada';
    default: return 'pedir';
  }
}

function sumar(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n, 12)).toISOString().slice(0, 10);
}
