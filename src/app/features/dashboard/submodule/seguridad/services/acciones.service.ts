import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../../../../shared/utils/mensaje-error';
import { abrirFormulario, confirmar } from '../components/dialogos/formulario-dialogo';
import {
  AccionDispositivo, Camara, Dispositivo, Incidente, NOMBRE_ACCION, NOMBRE_SEVERIDAD, Protocolo, SEVERIDADES, Sede,
} from '../models/seguridad.models';
import { SeguridadService } from './seguridad.service';
import { SeguridadVivoService } from './seguridad-vivo.service';

/**
 * Acciones con confirmación que se repiten en varias pantallas (centro de monitoreo, detalle
 * de incidente, domótica): reconocer/comentar/escalar/cerrar una alarma, accionar un
 * dispositivo y el botón de pánico. Cada una devuelve lo que respondió el servidor o null
 * si se canceló/falló (el error ya se mostró).
 */
@Injectable({ providedIn: 'root' })
export class AccionesSeguridad {
  private readonly api = inject(SeguridadService);
  private readonly vivo = inject(SeguridadVivoService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  aviso(texto: string, error = false): void {
    this.snack.open(texto, 'OK', { duration: error ? 6000 : 3000, panelClass: error ? ['sg-snack-error'] : undefined });
  }

  async reconocer(i: Incidente, conNota = false): Promise<Incidente | null> {
    let nota: string | null = null;
    if (conNota) {
      const r = await confirmar(this.dialog, {
        titulo: 'Reconocer la alarma', icono: 'task_alt', boton: 'Reconocer',
        texto: `Al reconocerla se detiene el escalamiento de "${i.titulo}" y queda a su nombre en la bitácora.`,
        motivo: 'Nota (opcional): qué va a hacer',
      });
      if (!r) return null;
      nota = r.motivo || null;
    }
    try {
      const res = await firstValueFrom(this.api.reconocer(i.id, nota));
      this.vivo.ponerIncidente(res);
      this.aviso('Alarma reconocida: se detuvo el escalamiento.');
      return res;
    } catch (e) { this.aviso(mensajeDeError(e, 'No se pudo reconocer la alarma.'), true); return null; }
  }

  async comentar(i: Incidente): Promise<boolean> {
    const r = await abrirFormulario(this.dialog, {
      titulo: 'Agregar a la bitácora', icono: 'edit_note', textoGuardar: 'Agregar', ancho: '520px',
      campos: [{ clave: 'texto', etiqueta: 'Qué pasó / qué se hizo', tipo: 'area', requerido: true, ancho: true }],
      guardar: (v) => this.api.comentar(i.id, v['texto']),
    });
    if (r) this.aviso('Comentario agregado.');
    return !!r;
  }

  async escalar(i: Incidente): Promise<Incidente | null> {
    const ok = await confirmar(this.dialog, {
      titulo: 'Escalar ahora', icono: 'trending_up', boton: 'Escalar', peligro: true,
      texto: `Se ejecuta ya el siguiente paso del protocolo${i.protocolo_nombre ? ` "${i.protocolo_nombre}"` : ''} (más contactos, sirena, parlante o policía) sin esperar el tiempo.`,
    });
    if (!ok) return null;
    try {
      const res = await firstValueFrom(this.api.escalar(i.id));
      if (res?.id) this.vivo.ponerIncidente(res);
      this.aviso('Se escaló la alarma.');
      return res;
    } catch (e) { this.aviso(mensajeDeError(e, 'No se pudo escalar.'), true); return null; }
  }

  async cerrar(i: Incidente): Promise<Incidente | null> {
    const r = await abrirFormulario<Incidente>(this.dialog, {
      titulo: 'Cerrar la alarma', icono: 'check_circle', textoGuardar: 'Cerrar alarma', ancho: '520px',
      descripcion: 'Explique cómo terminó: la nota queda en la bitácora y sirve para revisar después.',
      campos: [
        { clave: 'resultado', etiqueta: 'Resultado', tipo: 'seleccion', requerido: true, ancho: true, opciones: [
          { valor: 'CERRADO', texto: 'Atendida y resuelta' },
          { valor: 'FALSA_ALARMA', texto: 'Falsa alarma' },
        ] },
        { clave: 'nota', etiqueta: 'Nota de cierre', tipo: 'area', requerido: true, ancho: true },
      ],
      valores: { resultado: 'CERRADO' },
      guardar: (v) => this.api.cerrarIncidente(i.id, v['resultado'], v['nota']),
    });
    if (!r) return null;
    if ((r as Incidente).id) this.vivo.ponerIncidente(r as Incidente);
    else this.vivo.cargarIncidentes();
    this.aviso('Alarma cerrada.');
    return r as Incidente;
  }

  /** Acción sobre un dispositivo: con motivo obligatorio si `requiere_confirmacion`. */
  async accionar(d: Dispositivo, accion: AccionDispositivo): Promise<boolean> {
    let motivo: string | null = null;
    if (d.requiere_confirmacion) {
      const r = await confirmar(this.dialog, {
        titulo: `${NOMBRE_ACCION[accion]}: ${d.nombre}`, icono: 'gpp_maybe', boton: NOMBRE_ACCION[accion], peligro: true,
        texto: `${d.sede_nombre}. Esta acción queda auditada con su nombre y el motivo.`,
        motivo: 'Motivo', motivoObligatorio: true,
      });
      if (!r) return false;
      motivo = r.motivo;
    }
    try {
      const res = await firstValueFrom(this.api.accionDispositivo(d.id, accion, motivo));
      this.aviso(res.ok ? (res.mensaje || `${NOMBRE_ACCION[accion]}: hecho.`) : (res.mensaje || 'El dispositivo no respondió.'), !res.ok);
      return res.ok;
    } catch (e) { this.aviso(mensajeDeError(e, 'No se pudo accionar el dispositivo.'), true); return false; }
  }

  /** Botón de pánico manual desde el centro: abre un incidente y arranca su protocolo. */
  async panico(sede: Sede, camaras: Camara[], protocolos: Protocolo[]): Promise<Incidente | null> {
    const r = await abrirFormulario<Incidente>(this.dialog, {
      titulo: `Pánico manual · ${sede.nombre}`, icono: 'e911_emergency', tono: 'peligro', textoGuardar: 'Disparar alarma',
      aviso: { tono: 'danger', texto: 'Se abre una alarma real: suena en el centro y avisa según el protocolo hasta que alguien la reconozca.' },
      campos: [
        { clave: 'titulo', etiqueta: 'Qué pasa', tipo: 'texto', requerido: true, ancho: true },
        { clave: 'severidad', etiqueta: 'Severidad', tipo: 'seleccion', requerido: true,
          opciones: SEVERIDADES.map((s) => ({ valor: s, texto: NOMBRE_SEVERIDAD[s] })) },
        { clave: 'protocolo_id', etiqueta: 'Protocolo', tipo: 'seleccion', ayuda: 'Vacío = el protocolo por defecto de la sede.',
          opciones: protocolos.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre })) },
        { clave: 'camara_id', etiqueta: 'Cámara relacionada', tipo: 'seleccion', ancho: true,
          opciones: camaras.filter((c) => c.sede_id === sede.id).map((c) => ({ valor: c.id, texto: c.nombre })) },
        { clave: 'descripcion', etiqueta: 'Detalle', tipo: 'area', ancho: true },
      ],
      valores: { titulo: 'Pánico manual desde el centro de monitoreo', severidad: 'CRITICA' },
      guardar: (v) => this.api.crearIncidente({
        sede_id: sede.id, titulo: v['titulo'], severidad: v['severidad'], descripcion: v['descripcion'] ?? '',
        camara_id: v['camara_id'] ?? null, protocolo_id: v['protocolo_id'] ?? null,
      }),
    });
    if (r && (r as Incidente).id) { this.vivo.ponerIncidente(r as Incidente); this.aviso('Alarma abierta.'); }
    return (r as Incidente) ?? null;
  }
}
