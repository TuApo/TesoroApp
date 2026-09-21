import { Injectable, signal } from '@angular/core';

/** La persona que una pantalla tiene al frente: nombra y llena el caso. */
export interface PersonaEnVista {
  documento?: string | null;
  persona_nombre?: string | null;
  telefono?: string | null;
  correo?: string | null;
  /** Qué se estaba haciendo ("Pipeline · Entrevista"); entra en el nombre automático del caso. */
  motivo?: string | null;
}

/**
 * Lo que una pantalla ofrece para que un caso la guarde y la reponga CON SU PROPIA LÓGICA.
 *
 * <p>Sin adaptador, un caso fotografía los campos del DOM y al volver los vuelve a escribir.
 * Eso sirve para filtros y formularios sueltos, pero rompe las pantallas que cargan sus
 * datos del servidor a partir de algo (la persona buscada, el paso abierto): escribir los
 * campos "a mano" deja la pantalla incoherente —los valores están, pero la persona no se
 * cargó y nada de lo que se haga después se guarda donde toca—.
 *
 * <p>Una pantalla con adaptador dice ELLA qué estado guardar (serializable) y cómo volver a
 * él por sus caminos normales (buscar a la persona, abrir el paso). El caso solo lo lleva.
 */
export interface AdaptadorVistaCaso<E = unknown> {
  /** Estado propio de la pantalla. `null` cuando aún no hay nada que guardar. */
  capturar(): E | null;
  /**
   * Repone ese estado; `avance` recibe 0–1 para la barra de progreso. Resuelve cuando la
   * pantalla está lista (o cuando desistió: la pantalla misma avisa de lo que no encontró).
   */
  restaurar(estado: E, avance: (p: number) => void): Promise<void>;
  /** Ruta que representa el estado (p. ej. con la persona en la URL): así una pestaña nueva del navegador llega igual. */
  ruta?(): string;
  /** La persona en pantalla. Manda sobre lo que se pueda leer de los campos. */
  persona?(): PersonaEnVista;
  /** Resumen corto del estado para la pestaña ("Selección · Entrevista"). */
  resumen?(): string | null;
  /** `false` = no fotografiar ni reponer los campos del DOM: la pantalla los carga del servidor. */
  camposDom?: boolean;
}

/**
 * Punto de encuentro entre las pantallas y el módulo de casos: la pantalla activa registra
 * su adaptador al nacer y lo retira al morir; quien guarda o restaura casos pregunta aquí.
 *
 * <p>Vive en core para que ninguna pantalla dependa del módulo de turnos: solo de esta
 * interfaz.
 */
@Injectable({ providedIn: 'root' })
export class RegistroVistaCaso {
  /** El adaptador de la pantalla que está en pantalla, o null. */
  readonly adaptador = signal<AdaptadorVistaCaso | null>(null);

  /** Sube cada vez que la pantalla registrada cambia de estado (paso, persona…): dispara el autoguardado del caso. */
  readonly cambios = signal(0);

  /** Registra el adaptador de la pantalla activa. Devuelve la función que lo retira (para `DestroyRef.onDestroy`). */
  registrar(adaptador: AdaptadorVistaCaso): () => void {
    this.adaptador.set(adaptador);
    return () => {
      if (this.adaptador() === adaptador) this.adaptador.set(null);
    };
  }

  /** La pantalla avisa de que su estado cambió. Sin adaptador registrado no hace nada. */
  notificarCambio(): void {
    if (this.adaptador()) this.cambios.update(n => n + 1);
  }
}
