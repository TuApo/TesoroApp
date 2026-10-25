import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { AporteCumpleanos, EtiquetaCelebracion } from './celebracion.models';
import { CelebracionService } from './celebracion.service';
import { fechaLarga } from './preparar';

/**
 * /dashboard/cumpleanos/aporte/:token — lo abre quien recibe el enlace de Marketing.
 *
 * El equipo elige hasta 6 etiquetas que describen a quien cumple (con ellas la IA hace su
 * fondo personal) y su jefe le escribe un mensaje que sale firmado en la celebración. El
 * mensaje es sorpresa: solo lo ve quien lo puede escribir.
 */
@Component({
  selector: 'app-aporte-cumpleanos',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './aporte-cumpleanos.component.html',
  styleUrl: './aporte-cumpleanos.component.css',
})
export class AporteCumpleanosComponent implements OnInit {
  private readonly api = inject(CelebracionService);
  private readonly ruta = inject(ActivatedRoute);

  readonly datos = signal<AporteCumpleanos | null>(null);
  readonly error = signal<string | null>(null);
  readonly elegidas = signal<Set<string>>(new Set());
  readonly guardandoEtiquetas = signal(false);
  readonly guardadoEtiquetas = signal(false);
  readonly mensaje = signal('');
  readonly firma = signal('');
  readonly guardandoMensaje = signal(false);
  readonly guardadoMensaje = signal(false);
  private token = '';

  readonly categorias = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const grupos = new Map<string, EtiquetaCelebracion[]>();
    for (const e of d.etiquetas) {
      const l = grupos.get(e.categoria) ?? [];
      l.push(e);
      grupos.set(e.categoria, l);
    }
    return [...grupos.entries()].map(([nombre, etiquetas]) => ({ nombre, etiquetas }));
  });
  readonly cambiaronEtiquetas = computed(() => {
    const d = this.datos();
    if (!d) return false;
    const a = [...this.elegidas()].sort().join(',');
    return a !== [...d.mis_etiquetas].sort().join(',');
  });
  readonly fecha = computed(() => (this.datos() ? fechaLarga(this.datos()!.persona.fecha) : ''));
  readonly top = computed(() => {
    const d = this.datos();
    if (!d) return [];
    return d.etiquetas.filter((e) => d.conteo[e.id]).sort((a, b) => (d.conteo[b.id] ?? 0) - (d.conteo[a.id] ?? 0)).slice(0, 4);
  });

  ngOnInit(): void {
    this.token = this.ruta.snapshot.paramMap.get('token') ?? '';
    this.api.aporte(this.token).subscribe({
      next: (d) => this.cargar(d),
      error: (e: HttpErrorResponse) => this.error.set(e.error?.error || 'No se pudo abrir el enlace. Revisa que esté completo.'),
    });
  }

  private cargar(d: AporteCumpleanos): void {
    this.datos.set(d);
    this.elegidas.set(new Set(d.mis_etiquetas));
    if (d.es_jefe) {
      this.mensaje.set(d.mensaje_jefe ?? '');
      this.firma.set(d.mensaje_jefe_firma ?? (d.jefe_nombre ? `${d.jefe_nombre.split(' ')[0]}, tu jefe` : 'Tu jefe'));
    }
  }

  url(u: string): string { return this.api.urlFoto(u); }

  alternar(e: EtiquetaCelebracion): void {
    const d = this.datos();
    if (!d?.abierta) return;
    const s = new Set(this.elegidas());
    if (s.has(e.id)) s.delete(e.id);
    else if (s.size < d.max_etiquetas) s.add(e.id);
    this.elegidas.set(s);
    this.guardadoEtiquetas.set(false);
  }

  votos(e: EtiquetaCelebracion): number {
    const d = this.datos();
    if (!d) return 0;
    // Lo que se ve incluye el voto que todavía no se guarda.
    const antes = d.mis_etiquetas.includes(e.id) ? 1 : 0;
    const ahora = this.elegidas().has(e.id) ? 1 : 0;
    return (d.conteo[e.id] ?? 0) - antes + ahora;
  }

  guardarEtiquetas(): void {
    this.guardandoEtiquetas.set(true);
    this.api.votar(this.token, [...this.elegidas()]).subscribe({
      next: (d) => { this.cargar(d); this.guardandoEtiquetas.set(false); this.guardadoEtiquetas.set(true); },
      error: (e: HttpErrorResponse) => { this.guardandoEtiquetas.set(false); this.error.set(e.error?.error || 'No se pudo guardar.'); },
    });
  }

  guardarMensaje(): void {
    this.guardandoMensaje.set(true);
    this.api.mensajeJefe(this.token, this.mensaje().trim(), this.firma().trim()).subscribe({
      next: (d) => { this.cargar(d); this.guardandoMensaje.set(false); this.guardadoMensaje.set(true); },
      error: (e: HttpErrorResponse) => { this.guardandoMensaje.set(false); this.error.set(e.error?.error || 'No se pudo guardar.'); },
    });
  }
}
