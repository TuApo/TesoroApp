import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SharedModule } from '@/app/shared/shared.module';
import { MatIconModule } from '@angular/material/icon';
import { VacanteAsignadaResumen } from '../../service/pipeline-nav/pipeline-nav.service';
import { Avance, pctDe, sumarAvances } from '../../shared/progreso.util';

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
  /**
   * Cuánto lleva llenado cada bloque, medido con las MISMAS reglas del
   * formulario de la vacante. Lo calcula `form-entrevista` y llega por el
   * pipeline; aquí solo se pinta.
   */
  avances = input<Readonly<Record<string, Avance>>>({});
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
  /** Comprobar que el correo / el WhatsApp existen. */
  comprobarCorreo = output<void>();
  comprobarWhatsapp = output<void>();
  /**
   * Reenviar al candidato el código con el que entra a revisar y actualizar sus datos.
   * El candidato no tiene contraseña: el acceso es un código de un solo uso al correo.
   */
  reenviarAcceso = output<void>();

  private readonly plegados = signal<ReadonlySet<string>>(new Set<string>());

  /** % de un bloque; `null` cuando ese bloque no tiene nada que medir. */
  pct(bloque: string): number | null {
    const a = this.avances()[bloque];
    return a && a.total > 0 ? pctDe(a) : null;
  }

  /** El total de la ficha: la suma de todos sus bloques. */
  readonly avanceTotal = computed<Avance>(() =>
    sumarAvances(Object.values(this.avances())));

  readonly pctTotal = computed<number | null>(() => {
    const a = this.avanceTotal();
    return a.total > 0 ? pctDe(a) : null;
  });

  readonly fichaCompleta = computed<boolean>(() => {
    const a = this.avanceTotal();
    return a.total > 0 && a.hechos >= a.total;
  });

  /** Qué falta, en palabras. Es lo que se lee antes de mandar a contratar. */
  detalle(bloque: string, titulo: string): string {
    const a = this.avances()[bloque];
    if (!a || a.total <= 0) return titulo;
    const faltan = Math.max(0, a.total - a.hechos);
    return faltan === 0
      ? `${titulo} · completo`
      : `${titulo} · ${a.hechos} de ${a.total} · faltan ${faltan}`;
  }

  /** El arco del anillo. Se arma aquí para no depender del binding a CSS vars. */
  fondoAnillo(pct: number | null): string {
    if (pct === null) return 'rgba(255, 255, 255, .16)';
    return `conic-gradient(var(--lime, #8CD50A) ${pct}%, rgba(255, 255, 255, .2) 0)`;
  }

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

  /**
   * Los años que tiene, calculados si el registro no los trae.
   *
   * `edad` es una columna que casi siempre llega en null —nadie la escribe— y
   * la fecha de nacimiento sí está: dejar el dato en blanco teniendo con qué
   * calcularlo es esconder información que ya está en la ficha.
   */
  private edadDe(c: any): number | null {
    const guardada = Number(c?.edad);
    if (Number.isFinite(guardada) && guardada > 0) return guardada;
    const n = c?.fecha_nacimiento ? new Date(c.fecha_nacimiento) : null;
    if (!n || isNaN(n.getTime())) return null;
    const hoy = new Date();
    let años = hoy.getUTCFullYear() - n.getUTCFullYear();
    const mes = hoy.getUTCMonth() - n.getUTCMonth();
    if (mes < 0 || (mes === 0 && hoy.getUTCDate() < n.getUTCDate())) años--;
    return años > 0 && años < 120 ? años : null;
  }

  /**
   * El estado civil, con nombre.
   *
   * En base se guarda el código con el que lo manda el formulario (SO, CA, UL,
   * SE, VI) y la ficha lo estaba pintando crudo: "SO" no es un dato legible
   * para quien está atendiendo a la persona. Los registros viejos traen la
   * palabra completa y esos se muestran tal cual.
   */
  private readonly ESTADO_CIVIL: Readonly<Record<string, string>> = {
    SO: 'Soltero(a)',
    CA: 'Casado(a)',
    UL: 'Unión libre',
    SE: 'Separado(a)',
    VI: 'Viudo(a)',
  };

  private estadoCivilDe(v: unknown): string | null {
    const s = this.txt(v);
    if (!s) return null;
    return this.ESTADO_CIVIL[s.toUpperCase()] ?? s;
  }

  readonly personales = computed<Fila[]>(() => {
    const c = this.candidato();
    const cc = c?.info_cc ?? {};
    const edad = this.edadDe(c);
    return [
      { label: 'Nombre completo', value: this.nombre(), break: true },
      { label: 'Nacimiento', value: this.unir(this.fecha(c?.fecha_nacimiento), edad ? `${edad} años` : null) },
      { label: 'Lugar de nacimiento', value: this.txt(cc.mpio_nacimiento) },
      { label: 'Sexo', value: c?.sexo === 'F' ? 'Femenino' : c?.sexo === 'M' ? 'Masculino' : null },
      { label: 'Estado civil', value: this.estadoCivilDe(c?.estado_civil) },
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

  /** Hay correo al que mandar el código. Sin esto el botón de acceso no tiene destino. */
  readonly tieneCorreo = computed<boolean>(() => {
    const ct = this.candidato()?.contacto ?? {};
    return !!(ct.email ?? ct.correo_electronico ?? '').toString().trim();
  });

  /** ¿El correo/WhatsApp ya se comprobaron? Lo marca el backend. */
  readonly correoConfirmado = computed<boolean>(() => !!this.candidato()?.contacto?.correo_confirmado);
  readonly whatsappConfirmado = computed<boolean>(() => !!this.candidato()?.contacto?.whatsapp_confirmado);

  private unir(a: string | null, b: string | null): string | null {
    if (a && b) return `${a} · ${b}`;
    return a ?? b ?? null;
  }
}
