import { caduca, leerToken, puedeRenovar } from '../security/renovacion-token';

/**
 * ¿Hay sesión con un token que no ha caducado?
 *
 * Lo consultan las descargas en segundo plano antes de pedir nada: con un token
 * vencido, el primer 401 hace que auth.interceptor borre toda la caché offline y
 * deje al equipo sin datos justo cuando más los necesita.
 *
 * Misma búsqueda del token que getTokenSafe() en auth.interceptor. Si el token no
 * es un JWT o no trae `exp`, se da por vigente y decide el backend.
 *
 * Un access token vencido con un refresh token vigente también cuenta como sesión: el
 * interceptor lo renueva antes de enviar. Sin esto, con el access token de minutos, las
 * descargas en segundo plano se detendrían a los pocos minutos de entrar.
 */
export function tokenVigente(margenSeg = 60): boolean {
  if (typeof localStorage === 'undefined') return false;
  const raw = leerToken();
  if (!raw) return false;
  return !caduca(raw, margenSeg) || puedeRenovar();
}
