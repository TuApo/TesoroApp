import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@/environments/environment';
import { Observable, from, of } from 'rxjs';
import { concatMap, map, startWith } from 'rxjs/operators';

/**
 * Servicio del CAMBIO MASIVO DE ESTADO POR PEGADO (Confirmación de ingresos).
 *
 * Va aparte de AfiliacionesGestionService a propósito: aquel maneja el estado de la pantalla
 * (filtros, paginación, refresco) y este es una utilidad sin estado que solo resuelve cédulas
 * y aplica la confirmación. Mantiene sus propios tipos para no acoplarse a los del tablero.
 */

/** Los 4 validadores de la confirmación de ingreso. */
export type ValidadorPegado = 'AFILIACIONES' | 'COORDINADOR' | 'NOMINA' | 'PAGO_SEGURIDAD';

/** Canal por el que se confirmó. */
export type CanalPegado = 'LLAMADA' | 'CORREO' | 'WHATSAPP';

/** Una cédula pegada, ya resuelta contra la base. */
export interface PegadoItem {
  entrada: string;               // tal como se pegó (para poder señalar la fila que falló)
  cedula: string | null;         // la forma con la que quedó en la base
  encontrado: boolean;
  candidatoId: number | null;
  procesoId: number | null;
  nombreCompleto: string | null;
  empresa: string | null;
  oficina: string | null;
  finca: string | null;
  fechaIngreso: string | null;   // ISO yyyy-MM-dd
  activo: boolean | null;
  ingresoConfirmado: boolean;    // Validador 1: afiliaciones
  coordConfirmado: boolean;      // Validador 2: coordinador de finca
  nominaConfirmado: boolean;     // Validador 3: nómina
  pagoConfirmado: boolean;       // Validador 4: pago de seguridad social
  adresEstado: string | null;
  contratos: number;             // >1 = la persona tiene varios contratos; se resolvió el más reciente
}

export interface PegadoLookup {
  solicitadas: number;
  encontradas: number;
  noEncontradas: number;
  items: PegadoItem[];
}

export interface PegadoMasivoResult {
  solicitados: number;
  procesados: number;
  fallidos: number[];
}

/**
 * Avance de una operación que se manda por lotes.
 *
 * El porcentaje es REAL (lotes efectivamente respondidos por el servidor), no una animación:
 * por eso el trabajo se parte en lotes en vez de mandarlo en una sola petición. Con 2.000
 * cédulas en un solo POST la pantalla se queda muda varios segundos y no hay forma de saber
 * si está andando o si se colgó.
 *
 * `resultado` solo viene en la ÚLTIMA emisión, con todo acumulado.
 */
export interface AvanceLote<T> {
  /** Unidades (cédulas o candidatos) ya confirmadas por el servidor. */
  hechas: number;
  total: number;
  /** 0..100, redondeado. */
  porcentaje: number;
  /** Lote en curso y cuántos son en total (para el texto "lote 3 de 14"). */
  lote: number;
  lotes: number;
  terminado: boolean;
  resultado?: T;
}

@Injectable({ providedIn: 'root' })
export class AfiliacionesPegadoService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/gestion_afiliaciones`;

  /** Máximo de cédulas por pegado (mismo tope que el backend). */
  static readonly MAX_CEDULAS = 2000;

  /**
   * Tamaño de lote para poder mostrar avance real.
   *
   * Se eligieron chicos a propósito: con 2.000 cédulas dan ~14 pasos de lectura y ~13 de
   * escritura, suficientes para que la barra se mueva de forma visible sin multiplicar el
   * costo por petición. Los lotes van EN SERIE — así el avance es monótono y la carga sobre
   * la base es la misma que tenía la petición única.
   */
  private static readonly LOTE_LOOKUP = 150;
  private static readonly LOTE_CONFIRMAR = 150;

  /**
   * Resuelve un lote de cédulas: quién es cada una y cómo están hoy sus 4 banderas.
   * No muta nada — es el insumo del preview.
   */
  lookup(cedulas: string[]): Observable<PegadoLookup> {
    return this.http.post<any>(`${this.apiUrl}/casos/lookup-cedulas`, { cedulas }).pipe(
      map(r => ({
        solicitadas: r?.solicitadas || 0,
        encontradas: r?.encontradas || 0,
        noEncontradas: r?.noEncontradas || 0,
        items: (r?.items || []) as PegadoItem[]
      }))
    );
  }

  /**
   * Aplica la confirmación del validador sobre los candidatos resueltos.
   * Reusa el endpoint masivo que ya existe; el pegado solo cambia CÓMO se eligió la lista.
   */
  confirmarMasivo(candidatoIds: number[], validador: ValidadorPegado,
                  canal: CanalPegado, nota?: string): Observable<PegadoMasivoResult> {
    return this.http.post<any>(`${this.apiUrl}/casos/confirmar-masivo`,
      { candidatoIds, validador, canal, nota: nota || null }).pipe(
      map(r => ({
        solicitados: r?.solicitados || 0,
        procesados: r?.procesados || 0,
        fallidos: r?.fallidos || []
      }))
    );
  }

  // ── Variantes por lotes, con avance real ─────────────────────────────

  /** Resuelve las cédulas por lotes, informando el avance. Acumula los items en orden. */
  lookupConAvance(cedulas: string[]): Observable<AvanceLote<PegadoLookup>> {
    return this.porLotes(
      cedulas,
      AfiliacionesPegadoService.LOTE_LOOKUP,
      lote => this.lookup(lote),
      (acc, r) => acc == null ? r : {
        solicitadas: acc.solicitadas + r.solicitadas,
        encontradas: acc.encontradas + r.encontradas,
        noEncontradas: acc.noEncontradas + r.noEncontradas,
        items: acc.items.concat(r.items)
      },
      { solicitadas: 0, encontradas: 0, noEncontradas: 0, items: [] }
    );
  }

  /**
   * Aplica la confirmación por lotes, informando el avance.
   *
   * Ojo: al ir por lotes, si algo revienta a mitad quedan lotes YA aplicados. Es el mismo
   * comportamiento que tenía la petición única (el backend procesa candidato por candidato y
   * reporta los fallidos), solo que ahora el corte es visible en el avance.
   */
  confirmarMasivoConAvance(candidatoIds: number[], validador: ValidadorPegado,
                           canal: CanalPegado, nota?: string): Observable<AvanceLote<PegadoMasivoResult>> {
    return this.porLotes(
      candidatoIds,
      AfiliacionesPegadoService.LOTE_CONFIRMAR,
      lote => this.confirmarMasivo(lote, validador, canal, nota),
      (acc, r) => acc == null ? r : {
        solicitados: acc.solicitados + r.solicitados,
        procesados: acc.procesados + r.procesados,
        fallidos: acc.fallidos.concat(r.fallidos)
      },
      { solicitados: 0, procesados: 0, fallidos: [] }
    );
  }

  /**
   * Corre `fn` sobre los lotes EN SERIE y emite el avance tras cada respuesta.
   *
   * La primera emisión sale antes de la primera petición (0 %) para que la barra aparezca
   * apenas se pulsa el botón; la última trae el resultado acumulado.
   */
  private porLotes<T, R>(
    items: T[],
    tam: number,
    fn: (lote: T[]) => Observable<R>,
    acumular: (acc: R | null, r: R) => R,
    vacio: R
  ): Observable<AvanceLote<R>> {
    const total = items.length;
    const lotes = AfiliacionesPegadoService.trozos(items, tam);

    if (!total) {
      return of({ hechas: 0, total: 0, porcentaje: 100, lote: 0, lotes: 0, terminado: true, resultado: vacio });
    }

    let acc: R | null = null;
    let hechas = 0;

    return from(lotes).pipe(
      concatMap((lote, i) => fn(lote).pipe(map(r => {
        acc = acumular(acc, r);
        hechas += lote.length;
        const terminado = i === lotes.length - 1;
        return {
          hechas,
          total,
          porcentaje: Math.round((hechas / total) * 100),
          lote: i + 1,
          lotes: lotes.length,
          terminado,
          resultado: terminado ? (acc as R) : undefined
        } as AvanceLote<R>;
      }))),
      startWith({ hechas: 0, total, porcentaje: 0, lote: 0, lotes: lotes.length, terminado: false } as AvanceLote<R>)
    );
  }

  private static trozos<T>(items: T[], tam: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += tam) out.push(items.slice(i, i + tam));
    return out;
  }
}
