import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { GestionDocumentalService } from '../../service/gestion-documental/gestion-documental.service';
import type { CarasCedula } from '../../../document-management/components/document-scan-dialog/caras-cedula.util';
import { Cara, CedulaArmada, PasoCedula, TIPO_CARA, interpretarArmado } from './cedula-camara.util';

/** Falla en un paso concreto: el componente arma el mensaje con `mensajeFallo`. */
export class FalloCedulaCamara extends Error {
  constructor(readonly paso: PasoCedula, readonly causa: unknown, mensaje?: string) {
    super(mensaje ?? `Falló el paso ${paso}`);
  }
}

/**
 * Sube las dos caras del documento de identidad y pide la hoja carta al 150 %.
 *
 * Las caras van por `documentosPruebas` con `typeName` (el mismo camino que el
 * formulario de vacantes del portal): ms-documents las reconoce como caras y, al
 * llegar la segunda, arma solo la ampliada en el tipo 29 CEDULA. Después se llama
 * `cedula-ampliada/{owner}` explícitamente: es idempotente, devuelve el id de la
 * hoja (YA_ESTABA) y, si el armado automático falló, la arma ahí (CREADA).
 *
 * `owner_id` es el documento tal cual (con la X de los no-CC incluida), el mismo
 * con el que Contratación lee el tipo 29 y llama `armarCedulaAmpliada`.
 */
@Injectable({ providedIn: 'root' })
export class CedulaCamaraService {
  private readonly http = inject(HttpClient);
  private readonly docSvc = inject(GestionDocumentalService);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Última hoja armada con la cámara, desde CUALQUIER sitio (Contratación, ficha…).
   * La tarjeta "Documento de identidad" la escucha para refrescarse aunque la foto
   * se haya tomado desde otra pestaña.
   */
  readonly ultimaArmada = signal<CedulaArmada | null>(null);

  /** Sube una cara. Ruta con barra final, igual que el portal. */
  subirCara(cedula: string, cara: Cara, archivo: File): Observable<{ ok?: boolean; documentId?: number }> {
    const fd = new FormData();
    fd.append('file', archivo, archivo.name);
    fd.append('owner_id', cedula);
    fd.append('title', cara === 'frente' ? 'Documento de identidad frente' : 'Documento de identidad reverso');
    fd.append('typeName', TIPO_CARA[cara]);
    return this.http.post<{ ok?: boolean; documentId?: number }>(
      `${this.apiUrl}/gestion_documental/documentosPruebas/`, fd);
  }

  /**
   * Frente → reverso → hoja al 150 %, en ese orden (el reverso dispara el armado
   * en el servidor). `alPaso` avisa en qué va para pintar el progreso.
   */
  async subirYArmar(cedula: string, caras: CarasCedula,
                    alPaso: (paso: PasoCedula) => void = () => { }): Promise<CedulaArmada> {
    const owner = String(cedula ?? '').trim();
    if (!owner) throw new FalloCedulaCamara('frente', null, 'Sin documento de la persona');

    alPaso('frente');
    try {
      await firstValueFrom(this.subirCara(owner, 'frente', caras.frente));
    } catch (e) {
      throw new FalloCedulaCamara('frente', e);
    }

    alPaso('reverso');
    try {
      await firstValueFrom(this.subirCara(owner, 'reverso', caras.reverso));
    } catch (e) {
      throw new FalloCedulaCamara('reverso', e);
    }
    // Ya hay documentos nuevos de esta cédula: lo cacheado no sirve.
    this.docSvc.invalidarDocumentos(owner);

    alPaso('armando');
    let respuesta: unknown;
    try {
      respuesta = await firstValueFrom(this.docSvc.armarCedulaAmpliada(owner));
    } catch (e) {
      throw new FalloCedulaCamara('armando', e);
    }
    const r = interpretarArmado(respuesta);
    if (!r.ok || r.id === null) throw new FalloCedulaCamara('armando', null, r.mensaje);

    this.docSvc.invalidarDocumentos(owner);
    const armada: CedulaArmada = { cedula: owner, id: r.id, estado: r.estado };
    this.ultimaArmada.set(armada);
    return armada;
  }
}
