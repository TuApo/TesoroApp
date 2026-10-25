import { InjectionToken } from '@angular/core';

import { ClaveModulo } from '../../service/turnos.service';

/**
 * Catálogo de módulos que se abren en ventana flotante desde la atención remota.
 *
 * <p>Las CLAVES son las mismas que usa ms-turnos al sugerir temas (el backend no conoce
 * rutas). Las RUTAS están verificadas contra los `*.routes.ts` y contra `db_admin.modulo`
 * (el guard de permisos resuelve el nodo más largo que coincide: una ruta que no esté allí
 * dejaría al usuario fuera). Solo el pipeline lee `?cedula=` hoy; los demás abren su página
 * de trabajo y la cédula va a mano (la ventana ofrece copiarla).
 */
export interface ModuloFlotante {
  clave: ClaveModulo;
  etiqueta: string;
  icono: string;
  ruta: string;
  /** La pantalla abre directamente a la persona con `?cedula=`. */
  admiteCedula: boolean;
  ayuda: string;
}

export const CATALOGO_MODULOS: readonly ModuloFlotante[] = [
  { clave: 'pipeline', etiqueta: 'Selección y contratación', icono: 'how_to_reg', ruta: '/dashboard/hiring/recruitment-pipeline', admiteCedula: true, ayuda: 'El pipeline de esta persona: entrevista, ficha, contratación' },
  { clave: 'formulario-vacantes', etiqueta: 'Formulario de vacantes', icono: 'edit_document', ruta: '/dashboard/hiring/query-form', admiteCedula: false, ayuda: 'Las respuestas del formulario de vacantes' },
  { clave: 'documentos', etiqueta: 'Gestión documental', icono: 'folder_copy', ruta: '/dashboard/document-management/search-documents', admiteCedula: false, ayuda: 'Buscar y ver los documentos del expediente' },
  { clave: 'afiliaciones', etiqueta: 'Afiliaciones', icono: 'health_and_safety', ruta: '/dashboard/afiliaciones/confirmacion-ingresos', admiteCedula: false, ayuda: 'EPS, pensión, ARL y caja' },
  { clave: 'incapacidades', etiqueta: 'Incapacidades', icono: 'medical_information', ruta: '/dashboard/disabilities/consulta', admiteCedula: false, ayuda: 'Consulta de incapacidades' },
  { clave: 'nomina-formas-pago', etiqueta: 'Formas de pago', icono: 'account_balance', ruta: '/dashboard/payments/payments-method', admiteCedula: false, ayuda: 'Cuenta y banco donde se le paga' },
  { clave: 'nomina-desprendibles', etiqueta: 'Desprendibles', icono: 'receipt_long', ruta: '/dashboard/payments/pay-slips', admiteCedula: false, ayuda: 'Comprobantes de pago de nómina' },
  { clave: 'tesoreria', etiqueta: 'Tesorería', icono: 'savings', ruta: '/dashboard/treasury/consulta', admiteCedula: false, ayuda: 'Préstamos, créditos y autorizaciones de la persona' },
  { clave: 'carnet', etiqueta: 'Carné', icono: 'badge', ruta: '/dashboard/carnet/identificar', admiteCedula: false, ayuda: 'Identificar y verificar el carné' },
  { clave: 'juridico', etiqueta: 'Jurídico', icono: 'gavel', ruta: '/dashboard/gestion-legal/bandeja', admiteCedula: false, ayuda: 'Procesos legales' },
  { clave: 'soporte', etiqueta: 'Soporte', icono: 'support_agent', ruta: '/dashboard/bug-tickets/tickets', admiteCedula: false, ayuda: 'Abrir o seguir un ticket' },
  { clave: 'reuniones', etiqueta: 'Reuniones', icono: 'groups', ruta: '/dashboard/reuniones', admiteCedula: false, ayuda: 'Reuniones, actas y compromisos' },
];

export function moduloPorClave(clave: string | null | undefined): ModuloFlotante | null {
  return CATALOGO_MODULOS.find(m => m.clave === clave) ?? null;
}

/**
 * Ruta con consulta (sin el `#`) del módulo para una persona, en modo embebido.
 * `embebido=1` marca la URL de la ventana (se ve en el historial y en los registros); quien
 * decide esconder menú, barra y paneles es el shell, y solo si de verdad está en un marco.
 */
export function rutaModulo(m: ModuloFlotante, cedula: string | null, embebido = true): string {
  const q = new URLSearchParams();
  // Sin puntos ni espacios, pero sin tocar la letra: hay cédulas "X" + dígitos (extranjeros).
  if (m.admiteCedula && cedula?.trim()) q.set('cedula', cedula.replace(/[.\s]/g, ''));
  if (embebido) q.set('embebido', '1');
  const s = q.toString();
  return s ? `${m.ruta}?${s}` : m.ruta;
}

/**
 * URL completa (mismo documento, enrutado con hash) para el iframe o una pestaña nueva.
 * `base` es la dirección de la app sin el `#…` (web, Electron con file:// o la APK).
 */
export function urlModulo(m: ModuloFlotante, cedula: string | null, base: string, embebido = true): string {
  return `${base}#${rutaModulo(m, cedula, embebido)}`;
}

/** La dirección de la app en curso sin el fragmento. */
export function baseDeLaApp(): string {
  return typeof location === 'undefined' ? '/' : location.href.split('#')[0];
}

/** Dirección base de la app donde se arman las URLs de las ventanas (se cambia en las pruebas). */
export const ORIGEN_APP = new InjectionToken<string>('ORIGEN_APP', { providedIn: 'root', factory: baseDeLaApp });
