import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@/environments/environment';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Los 23 datos que alimentan los documentos de afiliación.
 *
 * Va en su propio servicio (y no dentro de AfiliacionesGestionService) porque no comparte nada
 * con el estado de la pantalla: no tiene filtros ni paginación, es leer y guardar una ficha.
 *
 * Las claves son las MISMAS del formato que usa el área (Primer_Apellido, Numero_Movil…), en
 * camelCase, para poder cotejar el formulario contra el Excel campo a campo.
 */

/** Nombre lógico de cada campo — el que ve el operador y el que queda en la auditoría. */
export type CampoAfiliacion =
  | 'Cedula' | 'Tipo_Documento' | 'Primer_Apellido' | 'Segundo_Apellido'
  | 'Primer_Nombre' | 'Segundo_Nombre' | 'Fecha_Nacimiento' | 'Sexo'
  | 'Direccion' | 'Localidad' | 'Municipio_Residencia' | 'Departamento_Residencia'
  | 'Numero_Movil' | 'Correo'
  | 'Municipio_Nacimiento' | 'Departamento_Nacimiento' | 'Nacionalidad' | 'Pais'
  | 'Salario' | 'Fecha_Ingreso' | 'EPS' | 'AFP' | 'Temporal';

/** Los 23 valores editables. Las fechas viajan como 'YYYY-MM-DD'. */
export interface DatosAfiliacion {
  cedula: string;
  tipoDocumento: string;
  primerApellido: string;
  segundoApellido: string;
  primerNombre: string;
  segundoNombre: string;
  fechaNacimiento: string;
  sexo: string;
  direccion: string;
  localidad: string;
  municipioResidencia: string;
  departamentoResidencia: string;
  numeroMovil: string;
  correo: string;
  municipioNacimiento: string;
  departamentoNacimiento: string;
  nacionalidad: string;
  pais: string;
  salario: string;
  fechaIngreso: string;
  eps: string;
  afp: string;
  temporal: string;
}

/** Una edición registrada: qué campo, qué había, qué quedó, quién y cuándo. */
export interface EdicionDato {
  id: number;
  campo: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  usuario: string | null;
  createdAt: string;
}

export interface FichaAfiliacion extends DatosAfiliacion {
  candidatoId: number;
  procesoId: number | null;
  nombreCompleto: string;
  /** Campos sin valor: lo que hay que completar antes de generar los documentos. */
  faltantes: string[];
  historial: EdicionDato[];
}

export interface GuardarResultado {
  cambios: number;
  aplicados: EdicionDato[];
  /** Avisos que no impiden guardar (por ejemplo, haber cambiado la cédula). */
  avisos: string[];
  datos: FichaAfiliacion;
}

@Injectable({ providedIn: 'root' })
export class AfiliacionDatosService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/gestion_afiliaciones`;

  /**
   * Sugerencias para los tres campos que nacieron vacíos en las 76.015 filas. NO se guardan
   * solas: el formulario las precarga y el operador confirma al guardar. Localidad no se
   * sugiere porque no hay forma de deducirla.
   */
  static readonly SUGERENCIAS: Partial<Record<keyof DatosAfiliacion, string>> = {
    nacionalidad: 'COLOMBIANA',
    pais: 'COLOMBIA'
  };

  obtener(candidatoId: number): Observable<FichaAfiliacion> {
    return this.http.get<any>(`${this.apiUrl}/casos/${candidatoId}/datos`).pipe(
      map(r => this.mapFicha(r))
    );
  }

  guardar(candidatoId: number, datos: DatosAfiliacion): Observable<GuardarResultado> {
    return this.http.put<any>(`${this.apiUrl}/casos/${candidatoId}/datos`, this.aPayload(datos)).pipe(
      map(r => ({
        cambios: r?.cambios || 0,
        aplicados: (r?.aplicados || []).map((e: any) => this.mapEdicion(e)),
        avisos: r?.avisos || [],
        datos: this.mapFicha(r?.datos)
      }))
    );
  }

  historial(candidatoId: number): Observable<EdicionDato[]> {
    return this.http.get<any[]>(`${this.apiUrl}/casos/${candidatoId}/datos/historial`).pipe(
      map(rows => (rows || []).map(e => this.mapEdicion(e)))
    );
  }

  /**
   * Un campo vacío significa "no lo toques", NO "bórralo" — el backend lo interpreta igual.
   * Por eso se manda `null` en vez de cadena vacía: si vacío borrara, abrir la ficha y guardar
   * sin escribir nada dejaría a la persona sin la mitad de los datos.
   */
  private aPayload(d: DatosAfiliacion): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    (Object.keys(d) as (keyof DatosAfiliacion)[]).forEach(k => {
      const v = (d[k] || '').trim();
      out[k] = v === '' ? null : v;
    });
    return out;
  }

  private mapFicha(r: any): FichaAfiliacion {
    return {
      candidatoId: r?.candidatoId,
      procesoId: r?.procesoId ?? null,
      nombreCompleto: r?.nombreCompleto || '',
      cedula: r?.cedula || '',
      tipoDocumento: r?.tipoDocumento || '',
      primerApellido: r?.primerApellido || '',
      segundoApellido: r?.segundoApellido || '',
      primerNombre: r?.primerNombre || '',
      segundoNombre: r?.segundoNombre || '',
      fechaNacimiento: this.aFecha(r?.fechaNacimiento),
      sexo: r?.sexo || '',
      direccion: r?.direccion || '',
      localidad: r?.localidad || '',
      municipioResidencia: r?.municipioResidencia || '',
      departamentoResidencia: r?.departamentoResidencia || '',
      numeroMovil: r?.numeroMovil || '',
      correo: r?.correo || '',
      municipioNacimiento: r?.municipioNacimiento || '',
      departamentoNacimiento: r?.departamentoNacimiento || '',
      nacionalidad: r?.nacionalidad || '',
      pais: r?.pais || '',
      salario: r?.salario || '',
      fechaIngreso: this.aFecha(r?.fechaIngreso),
      eps: r?.eps || '',
      afp: r?.afp || '',
      temporal: r?.temporal || '',
      faltantes: r?.faltantes || [],
      historial: (r?.historial || []).map((e: any) => this.mapEdicion(e))
    };
  }

  private mapEdicion(e: any): EdicionDato {
    return {
      id: e?.id,
      campo: e?.campo || '',
      valorAnterior: e?.valorAnterior ?? null,
      valorNuevo: e?.valorNuevo ?? null,
      usuario: e?.usuario ?? null,
      createdAt: this.aInstante(e?.createdAt)
    };
  }

  /**
   * LocalDate → 'YYYY-MM-DD'. En este despliegue el config-server pisa
   * `write-dates-as-timestamps:false`, así que Jackson manda las fechas como array
   * [aaaa,mm,dd]; hay que aceptar las dos formas.
   */
  private aFecha(v: any): string {
    if (v == null || v === '') return '';
    if (Array.isArray(v) && v.length >= 3) {
      const [a, m, d] = v;
      return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return String(v).slice(0, 10);
  }

  /** Instant → ISO. Por el mismo motivo puede llegar como epoch en SEGUNDOS. */
  private aInstante(v: any): string {
    if (v == null || v === '') return '';
    if (typeof v === 'number') {
      const ms = v < 1e12 ? Math.round(v * 1000) : v;
      return new Date(ms).toISOString();
    }
    if (Array.isArray(v)) return this.aFecha(v);
    return String(v);
  }
}
