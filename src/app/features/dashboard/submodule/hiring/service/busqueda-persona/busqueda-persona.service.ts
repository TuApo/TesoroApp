import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/** Una coincidencia, con lo que la persona tiene registrado. */
export interface PersonaEncontrada {
  id: number;
  tipo_doc: string | null;
  numero_documento: string;
  nombre: string | null;
  primer_nombre: string | null;
  segundo_nombre: string | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  fecha_nacimiento: string | null;
  edad: number | null;
  sexo: string | null;
  estado_civil: string | null;
  departamento: string | null;
  municipio: string | null;
  mpio_nacimiento: string | null;
  mpio_expedicion: string | null;
  fecha_expedicion: string | null;
  residencia_direccion: string | null;
  residencia_barrio: string | null;
  email: string | null;
  celular: string | null;
  whatsapp: string | null;
  oficina: string | null;
  proceso_id: number | null;
  contratado: number | null;
  vacante_cargo: string | null;
  vacante_empresa: string | null;
  vacante_finca: string | null;
  codigo_contrato: string | null;
  contrato_activo: number | null;
  documentos: number;
}

/** Impacto del cambio de documento, por tabla. */
export interface SimulacionCambio {
  anterior: string;
  nuevo: string;
  filasTotales: number;
  porTabla: Record<string, number>;
  avisos: string[];
}

/**
 * Búsqueda amplia y corrección del documento.
 *
 * La búsqueda por documento exacto no sirve cuando la cédula quedó mal
 * digitada al registrar: la persona no aparece ni por su documento real ni
 * por el equivocado si no se conoce. Esta busca también por nombre, correo y
 * teléfono.
 */
@Injectable({ providedIn: 'root' })
export class BusquedaPersonaService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_contratacion/documento`;

  /** @param q documento, nombre, correo o teléfono. Mínimo 3 caracteres. */
  buscar(q: string): Observable<PersonaEncontrada[]> {
    return this.http.get<PersonaEncontrada[]>(`${this.base}/buscar`, { params: { q } });
  }

  /** Cuenta el impacto SIN cambiar nada. */
  simular(actual: string, nueva: string): Observable<SimulacionCambio> {
    return this.http.post<SimulacionCambio>(`${this.base}/simular-cambio`, { actual, nueva });
  }

  /** Aplica el cambio y lo deja asentado en auditoría. */
  cambiar(actual: string, nueva: string, motivo: string): Observable<SimulacionCambio> {
    return this.http.post<SimulacionCambio>(`${this.base}/cambiar`, { actual, nueva, motivo });
  }
}
