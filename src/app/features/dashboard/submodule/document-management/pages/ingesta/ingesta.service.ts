import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '@/environments/environment';

import { ContextoPersona, ContratoPersona, DocumentoExistente } from './ingesta.model';

/**
 * Contexto de la persona destinataria, para la mesa de ingesta.
 *
 * Dos llamadas en paralelo porque ningún endpoint trae las dos cosas:
 *
 *  - `expediente-contrato` sabe QUÉ hay cargado (documentos, vigencia, tipos
 *    exigidos y faltantes) pero no el nombre de la persona.
 *  - `documentos-checklist` sabe QUIÉN es (nombre, finca, fecha de ingreso),
 *    porque cruza contra db_hr.
 *
 * Las dos degradan solas: si una falla, la otra sigue sirviendo. Bloquear la
 * carga porque no se pudo pintar un nombre sería peor que cargarla sin él.
 */
@Injectable({ providedIn: 'root' })
export class IngestaService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  contextoDe(cedula: string): Observable<ContextoPersona> {
    const ced = (cedula ?? '').trim();

    const vacio: ContextoPersona = {
      cedula: ced, existe: false, nombre: '', finca: '', fechaIngreso: '',
      contratos: [], documentos: [], faltantes: [], aviso: '', cargando: false,
    };
    if (!ced) return of(vacio);

    const expediente$ = this.http
      .get<any>(`${this.api}/gestion_documental/expediente-contrato`, { params: { cedula: ced } })
      .pipe(catchError(() => of(null)));

    const ficha$ = this.http
      .get<any>(`${this.api}/gestion_documental/documentos-checklist`, { params: { cedulas: ced } })
      .pipe(catchError(() => of(null)));

    return forkJoin({ expediente: expediente$, ficha: ficha$ }).pipe(
      map(({ expediente, ficha }) => this.armar(ced, expediente, ficha))
    );
  }

  private armar(cedula: string, expediente: any, checklist: any): ContextoPersona {
    const fila = (checklist?.items ?? [])[0] ?? null;
    const nombre = (fila?.nombre_completo ?? '').trim();

    const contratos: ContratoPersona[] = (expediente?.contratos ?? []).map((c: any) => ({
      procesoId: c?.proceso_id ?? null,
      codigoContrato: c?.codigo_contrato ?? null,
      fechaIngreso: c?.fecha_ingreso ?? null,
      fechaRetiro: c?.fecha_retiro ?? null,
      activo: c?.contrato_activo ?? null,
      empresaUsuaria: c?.empresa_usuaria ?? null,
      oficina: c?.oficina ?? null,
      contratado: c?.contratado ?? null,
    }));

    const documentos: DocumentoExistente[] = [
      ...(expediente?.documentos_contrato ?? []),
      ...(expediente?.documentos_persona ?? []),
      ...(expediente?.sin_asignar ?? []),
    ].map((d: any) => ({
      documentId: d?.document_id ?? 0,
      typeId: d?.type_id ?? null,
      typeName: d?.type_name ?? '',
      titulo: d?.title ?? '',
      subidoEn: d?.uploaded_at ?? null,
      fileUrl: d?.file_url ?? null,
      vigente: !!d?.vigente,
      contrato: d?.contract_number ?? null,
    }));

    const faltantes: string[] = (expediente?.exigidos ?? [])
      .filter((e: any) => e?.estado === 'FALTA')
      .map((e: any) => e?.type_name)
      .filter(Boolean);

    // "Existe" = contratación lo conoce. El nombre viene de db_hr; los contratos,
    // de la misma base. Con cualquiera de los dos basta: hay personas con proceso
    // abierto y sin contrato todavía, y su expediente es válido igual.
    const existe = !!nombre || contratos.length > 0;

    const avisos: string[] = expediente?.avisos ?? [];

    return {
      cedula,
      existe,
      nombre,
      finca: (fila?.finca ?? '').trim(),
      fechaIngreso: (fila?.fecha_ingreso ?? '').trim(),
      contratos,
      documentos,
      faltantes,
      aviso: existe ? (avisos[0] ?? '') : 'Esta cédula no figura en contratación',
      cargando: false,
    };
  }
}
