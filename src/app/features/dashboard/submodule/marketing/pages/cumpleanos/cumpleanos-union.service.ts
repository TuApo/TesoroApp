import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import {
  ConfigCumpleanos, CumpleanosDelDia, CumpleanosService, DiaCalendario, PersonaCumpleanos,
} from '../../../nomina/service/cumpleanos/cumpleanos.service';

/**
 * Une las dos caras del cumpleaños: la CELEBRACIÓN en la plataforma (ms-marketing, la arma
 * Marketing con foto) y el CORREO de felicitación (ms-payroll, sale del padrón que se sube
 * en Excel). Son dos listas en dos servicios; aquí se cruzan por cédula y por día para que
 * el calendario diga, de cada persona, si también le llega el correo, y de cada día, quién
 * más cumple según el padrón.
 *
 * Nada de esto puede tumbar la pantalla de Marketing: si ms-payroll no responde, cada método
 * devuelve vacío y la celebración se administra igual.
 */
@Injectable({ providedIn: 'root' })
export class CumpleanosUnionService {
  private readonly correos = inject(CumpleanosService);
  private readonly cacheDia = new Map<string, Observable<CumpleanosDelDia | null>>();

  /** Días con gente en el padrón entre dos fechas: una petición por mes (normalmente 2). */
  padronEntre(desde: string, hasta: string): Observable<PadronRango> {
    const meses = mesesEntre(desde, hasta);
    if (!meses.length) return of({ dias: new Map(), disponible: false, totalMeses: 0, desde, hasta });
    return forkJoin(meses.map(([a, m]) => this.correos.calendario(a, m).pipe(catchError(() => of(null))))).pipe(
      map((cals) => {
        const dias = new Map<string, DiaCalendario>();
        let total = 0;
        for (const c of cals) {
          if (!c) continue;
          total += c.total;
          for (const d of c.dias) if (d.fecha >= desde && d.fecha <= hasta && d.total > 0) dias.set(d.fecha, d);
        }
        return { dias, disponible: cals.some((c) => c !== null), totalMeses: total, desde, hasta };
      }),
    );
  }

  /** Quiénes del padrón cumplen ese día y si ya salió el correo (con caché por pantalla). */
  delDia(fecha: string, refrescar = false): Observable<CumpleanosDelDia | null> {
    if (refrescar) this.cacheDia.delete(fecha);
    let o = this.cacheDia.get(fecha);
    if (!o) {
      o = this.correos.delDia(fecha).pipe(catchError(() => of(null)), shareReplay(1));
      this.cacheDia.set(fecha, o);
    }
    return o;
  }

  /** La hora del envío automático y si está prendido. */
  config(): Observable<ConfigCumpleanos | null> {
    return this.correos.configuracion().pipe(map((c) => c.config), catchError(() => of(null)));
  }

  /** Cuántos hay activos en el padrón (0 = nunca se subió el Excel: nadie recibe correo). */
  activosEnPadron(): Observable<number | null> {
    return this.correos.padron({ activo: true, page: 0, size: 1 }).pipe(map((p) => p.total_activos ?? p.total), catchError(() => of(null)));
  }

  olvidar(): void { this.cacheDia.clear(); }
}

export interface PadronRango {
  dias: Map<string, DiaCalendario>;
  /** ms-payroll respondió (si no, la pantalla no dice nada del correo). */
  disponible: boolean;
  totalMeses: number;
  /** Los días consultados: fuera de ellos no se sabe si alguien está en el padrón. */
  desde: string;
  hasta: string;
}

export type ClaseCorreo = 'ok' | 'aviso' | 'neutro' | 'error';
export interface EstadoCorreo {
  clase: ClaseCorreo; icono: string; texto: string; ayuda: string;
  /**
   * Qué puede hacer Marketing desde el chip: «agregar» a quien no está en el padrón, o
   * «corregir» un alta manual suya (las del Excel se corrigen en el Excel).
   */
  accion?: 'agregar' | 'corregir';
  /** La persona del padrón, cuando está. */
  persona?: PersonaCumpleanos;
}

/** «1.023.456-789 » → «1023456789». El padrón y la celebración no escriben igual la cédula. */
export function normalizarCedula(v: string | null | undefined): string | null {
  const t = (v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return t || null;
}

/**
 * El correo de una persona celebrada ese día, dicho en una palabra para el chip.
 * `detalle` es lo que dijo ms-payroll de ese día (null si no se pidió: entonces solo se sabe
 * lo que cuenta el calendario del mes).
 */
export function estadoCorreo(documento: string | null | undefined, fecha: string, hoy: string, rango: PadronRango | null,
                             detalle: CumpleanosDelDia | null | undefined, cfg: ConfigCumpleanos | null): EstadoCorreo | null {
  if (!rango?.disponible) return null;
  // Fuera de los días consultados no se sabe: mejor no decir nada que decir «no está».
  if (fecha < rango.desde || fecha > rango.hasta) return null;
  const doc = normalizarCedula(documento);
  if (!doc) return { clase: 'neutro', icono: 'contact_mail', texto: 'Sin cédula para el correo',
    ayuda: 'Ponle la cédula (Editar) para saber si le llega el correo de cumpleaños del padrón.' };
  const dia = rango.dias.get(fecha);
  const fuera: EstadoCorreo = { clase: 'aviso', icono: 'unsubscribe', texto: 'No está en el padrón', accion: 'agregar',
    ayuda: 'No le llega el correo de cumpleaños. «Agregar al padrón» la suma con su correo, y el Excel de RRHH no la saca.' };
  if (!dia) return fuera;
  if (!detalle) return { clase: 'neutro', icono: 'mail', texto: 'Correo…', ayuda: 'Consultando el padrón.' };
  const p = detalle.personas.find((x) => normalizarCedula(x.cedula) === doc);
  if (!p) return fuera;
  const e = estadoEnPadron(p, fecha, hoy, dia, detalle, cfg);
  // Un alta manual es de Marketing: se puede corregir desde aquí.
  return p.origen === 'MANUAL'
    ? { ...e, accion: 'corregir', persona: p, ayuda: `${e.ayuda} Alta manual de Marketing (el Excel no la toca).` }
    : { ...e, persona: p };
}

function estadoEnPadron(p: PersonaCumpleanos, fecha: string, hoy: string, dia: DiaCalendario,
                        detalle: CumpleanosDelDia, cfg: ConfigCumpleanos | null): EstadoCorreo {
  if (!p.correo) return { clase: 'aviso', icono: 'unsubscribe', texto: 'Sin correo en el padrón', ayuda: 'Está en el padrón pero sin correo: no le llega.' };
  if (detalle.ya_enviado || dia.enviado) {
    // Agregada a mano DESPUÉS de que saliera el lote de ese día: ese envío no la incluyó.
    const lote = detalle.envio?.creado_en ? Date.parse(detalle.envio.creado_en) : NaN;
    const alta = p.alta_manual_en ? Date.parse(p.alta_manual_en) : NaN;
    if (p.origen === 'MANUAL' && alta > lote) {
      return { clase: 'aviso', icono: 'mark_email_unread', texto: 'Agregada después del envío',
        ayuda: 'El correo de ese día ya había salido cuando se agregó al padrón: a ella no le llegó. Se lo puedes mandar desde Correos › Probar.' };
    }
    const fallos = detalle.envio?.total_fallidos ?? 0;
    return fallos
      ? { clase: 'aviso', icono: 'mark_email_unread', texto: 'Correo con fallos', ayuda: `El envío de ese día tuvo ${fallos} fallido(s): revísalo en Correos.` }
      : { clase: 'ok', icono: 'mark_email_read', texto: 'Correo enviado', ayuda: `Le llegó a ${p.correo}.` };
  }
  if (fecha < hoy) return { clase: 'error', icono: 'mail_lock', texto: 'El correo no salió', ayuda: 'Ese día no se mandó el saludo.' };
  if (cfg?.auto_activo) {
    return { clase: 'ok', icono: 'schedule_send', texto: `Correo a las ${horaEnvio(cfg)}`, ayuda: `Sale solo a ${p.correo}.` };
  }
  return { clase: 'aviso', icono: 'mail', texto: 'Correo apagado', ayuda: 'El envío automático está apagado: solo sale si alguien lo manda a mano.' };
}

/**
 * El próximo día en que le sale el correo a quien nació en `nacimiento` (AAAA-MM-DD), contando
 * desde `hoy`: este año si todavía no pasó, si no el siguiente. El 29 de febrero sale el 28 en
 * los años no bisiestos, igual que hace ms-payroll.
 */
export function proximoCumple(nacimiento: string, hoy: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nacimiento ?? '');
  if (!m) return null;
  const mes = Number(m[2]), dia = Number(m[3]);
  const en = (a: number) => {
    const bisiesto = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
    const d = mes === 2 && dia === 29 && !bisiesto ? 28 : dia;
    return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const anio = Number(hoy.slice(0, 4));
  const este = en(anio);
  return este >= hoy ? este : en(anio + 1);
}

/** Una línea para el día entero según el padrón (sin pedir el detalle). */
export function resumenCorreoDia(dia: DiaCalendario, fecha: string, hoy: string, cfg: ConfigCumpleanos | null): string {
  const con = dia.total - dia.sin_correo;
  const base = dia.sin_correo ? `${con} con correo, ${dia.sin_correo} sin correo` : `${con} con correo`;
  if (dia.enviado) return `${base} · correo enviado`;
  if (fecha < hoy) return `${base} · el correo no salió`;
  return cfg?.auto_activo ? `${base} · sale a las ${horaEnvio(cfg)}` : `${base} · envío automático apagado`;
}

export function horaEnvio(cfg: ConfigCumpleanos): string {
  const h = cfg.hora_envio, m = String(cfg.minuto_envio).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** «MARÍA DEL PILAR GÓMEZ» → «María del Pilar Gómez»: el padrón suele venir en mayúsculas. */
export function nombrePropio(n: string): string {
  const menores = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return n.trim().toLowerCase().split(/\s+/)
    .map((w, i) => (i > 0 && menores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

/** El cargo que se le pone a alguien del padrón al celebrarlo: su finca y su temporal. */
export function cargoDesdePadron(p: PersonaCumpleanos): string | null {
  const partes = [p.finca ? nombrePropio(p.finca) : null, p.empresa_nombre].filter(Boolean);
  return partes.length ? partes.join(' · ').slice(0, 120) : null;
}

function mesesEntre(desde: string, hasta: string): [number, number][] {
  const r: [number, number][] = [];
  let [a, m] = desde.split('-').map(Number);
  const [ah, mh] = hasta.split('-').map(Number);
  while ((a < ah || (a === ah && m <= mh)) && r.length < 14) {
    r.push([a, m]);
    m++; if (m > 12) { m = 1; a++; }
  }
  return r;
}
