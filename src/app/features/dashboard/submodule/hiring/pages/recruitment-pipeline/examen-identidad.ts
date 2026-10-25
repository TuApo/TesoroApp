import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { environment } from '@/environments/environment';

/**
 * ¿El examen médico es de este trabajador? (ms-documents,
 * `/gestion_documental/identidad-examen`). El backend lee el nombre y la
 * cédula del PDF (texto → OCR → IA) y los coteja con el candidato.
 */
export type ResultadoIdentidad = 'COINCIDE' | 'NO_COINCIDE' | 'NO_VERIFICABLE';

export interface VeredictoIdentidad {
  resultado: ResultadoIdentidad;
  metodo: 'TEXTO' | 'OCR' | 'IA' | 'NINGUNO';
  por_cedula: boolean;
  cedula_leida: string | null;
  nombre_leido: string | null;
  detalle: string | null;
}

export interface ItemBandejaIdentidad {
  document_id: number;
  owner_id: string;
  title: string;
  proceso_id: number | null;
  cargado_at: string;
  resultado: ResultadoIdentidad;
  metodo: string;
  cedula_leida: string | null;
  nombre_leido: string | null;
  detalle: string | null;
  verificado_at: string;
  revision: string | null;
  justificacion: string | null;
  revisado_por: string | null;
  revisado_at: string | null;
  nombre_trabajador: string | null;
}

@Injectable({ providedIn: 'root' })
export class ExamenIdentidadApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_documental/identidad-examen`;

  /** Antes de subir: un PDF original (sin la portada que se le antepone al unir). No guarda nada. */
  verificar(file: File, cedula: string): Observable<VeredictoIdentidad> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('cedula', cedula);
    return this.http.post<VeredictoIdentidad>(`${this.base}/verificar/`, fd);
  }

  /** Después de subir: deja el resultado del documento y, si la hubo, la justificación de quien cargó. */
  registrar(documentId: number, justificacion?: string | null): Observable<VeredictoIdentidad> {
    return this.http.post<VeredictoIdentidad>(`${this.base}/documentos/${documentId}/verificar/`,
      justificacion ? { justificacion } : {});
  }

  bandeja(incluirRevisados = false): Observable<{ items: ItemBandejaIdentidad[]; resumen: any[] }> {
    return this.http.get<{ items: ItemBandejaIdentidad[]; resumen: any[] }>(`${this.base}/bandeja/`, {
      params: new HttpParams().set('incluir_revisados', String(incluirRevisados)),
    });
  }

  revisar(documentId: number, decision: 'ES_DEL_TRABAJADOR' | 'ES_DE_OTRA_PERSONA', justificacion: string) {
    return this.http.post<{ ok: boolean }>(`${this.base}/documentos/${documentId}/revisar/`, { decision, justificacion });
  }
}

export interface ChequeoIdentidad {
  /** false = quien carga eligió cambiar el archivo: no se sube nada. */
  continuar: boolean;
  /** Motivo escrito al cargar pese a la alerta (queda como revisión del documento). */
  justificacion: string | null;
  /** Aviso suave para el diálogo de confirmación (escaneos que no se pudieron leer). */
  avisoHtml: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * Verifica cada PDF antes de unirlos y, si alguno parece de otra persona,
 * pide confirmar con un motivo. Nunca bloquea por un fallo del verificador:
 * si el servicio no responde, se sigue como hoy.
 */
export async function chequearIdentidadExamenes(
  api: ExamenIdentidadApi,
  archivos: { nombre: string; file: File }[],
  cedula: string,
  nombreCandidato: string,
): Promise<ChequeoIdentidad> {
  Swal.fire({
    title: 'Verificando el examen…',
    html: 'Comprobando que el documento sea de este candidato.',
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading(),
  });
  const veredictos = await Promise.all(archivos.map(async (a) => {
    try {
      return { ...a, v: await firstValueFrom(api.verificar(a.file, cedula)) };
    } catch {
      return { ...a, v: null as VeredictoIdentidad | null };
    }
  }));
  Swal.close();

  const otros = veredictos.filter((x) => x.v?.resultado === 'NO_COINCIDE');
  const ilegibles = veredictos.filter((x) => x.v?.resultado === 'NO_VERIFICABLE');
  const avisoHtml = ilegibles.length
    ? `<br><br><span style="color:#8a6d00">ⓘ No se pudo leer el nombre en ${ilegibles.length} archivo(s)`
      + ' (escaneo). Revísalo a ojo antes de cargar.</span>'
    : '';
  if (!otros.length) return { continuar: true, justificacion: null, avisoHtml };

  const lista = otros.map((x) => {
    const leido = x.v?.cedula_leida ? ` · el documento dice <b>CC ${esc(x.v.cedula_leida)}</b>` : '';
    return `<li><b>${esc(x.nombre)}</b> (${esc(x.file.name)})${leido}</li>`;
  }).join('');
  const r = await Swal.fire({
    icon: 'warning',
    title: 'El examen parece de otra persona',
    html: `Ni la cédula <b>${esc(cedula)}</b> ni el nombre <b>${esc(nombreCandidato || '—')}</b>`
      + ` aparecen en:<ul style="text-align:left;margin:.6em 0">${lista}</ul>`
      + 'Revisa que no hayas adjuntado el examen de otro candidato.'
      + '<br><br>Si de todas formas es correcto, escribe por qué (queda registrado):',
    input: 'textarea',
    inputPlaceholder: 'Ej.: la IPS escribió mal el nombre; verifiqué la cédula en el documento.',
    showCancelButton: true,
    confirmButtonText: 'Cargar de todas formas',
    cancelButtonText: 'Cambiar archivo',
    reverseButtons: true,
    inputValidator: (v) => (!v || v.trim().length < 10) ? 'Escribe el motivo (mínimo 10 caracteres).' : undefined,
  });
  if (!r.isConfirmed) return { continuar: false, justificacion: null, avisoHtml };
  return { continuar: true, justificacion: String(r.value).trim(), avisoHtml };
}
