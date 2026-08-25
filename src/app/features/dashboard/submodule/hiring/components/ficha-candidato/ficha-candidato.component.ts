import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SharedModule } from '@/app/shared/shared.module';
import { MatIconModule } from '@angular/material/icon';
import { VacanteAsignadaResumen } from '../../service/pipeline-nav/pipeline-nav.service';

/** Una fila de la ficha: etiqueta, valor y a qué bloque pertenece para editar. */
interface Fila {
  label: string;
  value: string | null;
  break?: boolean;
}

/**
 * Los datos de la persona, SIEMPRE a la vista.
 *
 * Antes esto vivía dentro del paso Selección, así que al pasar a Antecedentes o
 * Contratación la persona desaparecía de pantalla justo cuando se estaba
 * escribiendo sobre ella. Ahora es un componente propio, montado al nivel del
 * pipeline: se queda quieto y lo que cambia es el panel de la derecha.
 *
 * Lee del candidato, no de un formulario: así no depende de que el paso de
 * Selección esté montado. Editar abre un diálogo (evento `editar`).
 */
@Component({
  selector: 'app-ficha-candidato',
  standalone: true,
  imports: [SharedModule, MatIconModule],
  templateUrl: './ficha-candidato.component.html',
  styleUrls: ['./ficha-candidato.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FichaCandidatoComponent {
  candidato = input<any | null>(null);
  fotoUrl = input<string | null>(null);
  /** Vacante a la que se remite. `null` = todavía sin asignar. */
  vacante = input<VacanteAsignadaResumen | null>(null);
  /** Documento tal como se tecleó en el diálogo de búsqueda. */
  documentoBuscado = input<string | null>(null);

  fotoSolicitada = output<void>();
  /**
   * La foto no cargó. El pipeline descarta esa URL para caer en las iniciales;
   * si no, se queda la imagen rota, que es peor que no tener foto.
   */
  fotoFallida = output<Event>();
  /** Pide abrir el diálogo de edición en un bloque concreto. */
  editar = output<string>();
  /** El usuario quiere corregir el documento (búsqueda inteligente). */
  corregirDocumento = output<void>();
  /** Pide elegir (o cambiar) la vacante a la que se remite. */
  asignarVacante = output<void>();

  private readonly plegados = signal<ReadonlySet<string>>(new Set<string>());

  plegado(b: string): boolean { return this.plegados().has(b); }

  alternar(b: string): void {
    const s = new Set(this.plegados());
    s.has(b) ? s.delete(b) : s.add(b);
    this.plegados.set(s);
  }

  // ── Lectura ───────────────────────────────────────────────────────────────
  private txt(v: unknown): string | null {
    const s = (v ?? '').toString().trim();
    return s.length ? s : null;
  }

  private fecha(v: unknown): string | null {
    if (!v) return null;
    const d = new Date(v as string);
    if (isNaN(d.getTime())) return this.txt(v);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }

  readonly nombre = computed<string | null>(() => {
    const c = this.candidato();
    if (!c) return null;
    const p = [c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido]
      .map((x: unknown) => this.txt(x)).filter(Boolean);
    return p.length ? p.join(' ') : null;
  });

  readonly iniciales = computed<string>(() => {
    const c = this.candidato();
    const i = `${c?.primer_nombre?.[0] ?? ''}${c?.primer_apellido?.[0] ?? ''}`.trim().toUpperCase();
    return i || '—';
  });

  /** El documento que hay en base. Puede diferir del que se buscó. */
  readonly documento = computed<string | null>(() => this.txt(this.candidato()?.numero_documento));

  readonly tipoDoc = computed<string>(() => this.txt(this.candidato()?.tipo_doc) ?? 'CC');

  /**
   * Se buscó un documento y la persona que salió tiene otro.
   * Es la pista de que alguien tecleó mal la cédula al registrarla.
   */
  readonly documentoDifiere = computed<boolean>(() => {
    const buscado = this.txt(this.documentoBuscado());
    const real = this.documento();
    return !!buscado && !!real && buscado.toUpperCase() !== real.toUpperCase();
  });

  readonly identificacion = computed<Fila[]>(() => {
    const c = this.candidato();
    const cc = c?.info_cc ?? {};
    return [
      { label: 'Oficina', value: this.txt(c?.entrevistas?.[0]?.oficina) },
      { label: 'Documento', value: c ? `${this.tipoDoc()} · ${this.documento() ?? '—'}` : null },
      { label: 'Expedición', value: this.unir(this.fecha(cc.fecha_expedicion), this.txt(cc.mpio_expedicion)) },
    ];
  });

  readonly personales = computed<Fila[]>(() => {
    const c = this.candidato();
    const cc = c?.info_cc ?? {};
    return [
      { label: 'Nombre completo', value: this.nombre(), break: true },
      { label: 'Nacimiento', value: this.unir(this.fecha(c?.fecha_nacimiento), c?.edad ? `${c.edad} años` : null) },
      { label: 'Lugar de nacimiento', value: this.txt(cc.mpio_nacimiento) },
      { label: 'Sexo', value: c?.sexo === 'F' ? 'Femenino' : c?.sexo === 'M' ? 'Masculino' : null },
      { label: 'Estado civil', value: this.txt(c?.estado_civil) },
    ];
  });

  readonly contacto = computed<Fila[]>(() => {
    const c = this.candidato();
    const ct = c?.contacto ?? {};
    const r = c?.residencia ?? {};
    return [
      { label: 'Correo', value: this.txt(ct.email ?? ct.correo_electronico), break: true },
      { label: 'Celular · WhatsApp', value: this.unir(this.txt(ct.celular), this.txt(ct.whatsapp)) },
      { label: 'Dirección', value: this.unir(this.txt(r.direccion), this.txt(r.barrio) ? `Barrio ${r.barrio}` : null), break: true },
      { label: 'Vive con', value: this.txt(c?.vivienda?.personas_con_quien_convive) },
    ];
  });

  readonly familia = computed<Fila[]>(() => {
    const c = this.candidato();
    const hijos = Array.isArray(c?.hijos) ? c.hijos : [];
    const refs = Array.isArray(c?.referencias) ? c.referencias : [];
    const fam = refs.filter((r: any) => String(r?.tipo ?? '').toUpperCase().startsWith('FAM'));
    return [
      { label: 'Hijos', value: hijos.length ? `${hijos.length}` : 'No registra' },
      { label: 'Quién los cuida', value: this.txt(c?.vivienda?.responsable_hijos) },
      { label: 'Referencias familiares',
        value: fam.length ? fam.map((r: any) => this.txt(r.nombre)).filter(Boolean).join(' · ') : null,
        break: true },
    ];
  });

  /** ¿El correo/WhatsApp ya se comprobaron? Lo marca el backend. */
  readonly correoConfirmado = computed<boolean>(() => !!this.candidato()?.contacto?.correo_confirmado);
  readonly whatsappConfirmado = computed<boolean>(() => !!this.candidato()?.contacto?.whatsapp_confirmado);

  private unir(a: string | null, b: string | null): string | null {
    if (a && b) return `${a} · ${b}`;
    return a ?? b ?? null;
  }
}
