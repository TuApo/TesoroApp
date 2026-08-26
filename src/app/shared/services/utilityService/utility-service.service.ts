import { EventEmitter, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import { getLocalStorageItem, clearLocalStorage } from '../../../core/utils/safe-storage';
import { AlcanceSedes } from '../../models/sede-alcance.model';

@Injectable({
  providedIn: 'root',
})
export class UtilityServiceService {
  private apiUrl = environment.apiUrl;
  // 🔔 EventEmitter para comunicar entre padre e hijo
  nextStep: EventEmitter<void> = new EventEmitter<void>();

  constructor(private http: HttpClient) { }

  /**
   * Obtiene el usuario almacenado en `localStorage`, verificando si se está ejecutando en el navegador.
   */
  getUser(): any {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const user = getLocalStorageItem('user');
      return user ? JSON.parse(user) : null;
    }
    return null;
  }

  /**
   * Limpia todo el localStorage, verificando si se está ejecutando en el navegador.
   */
  clearLocalStorage(): void {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      clearLocalStorage();
    }
  }

  /**
   * Sedes con caché compartida: al menos siete pantallas (sidebar, reportes,
   * mercancía, vacantes…) piden `/gestion_admin/sedes/` al abrirse, y las
   * sedes solo cambian desde el admin de Django. Se cachea la PETICIÓN con
   * `shareReplay` —quienes lleguen mientras está en vuelo la comparten— y un
   * TTL corto la refresca si la sesión queda abierta mucho tiempo. Un error
   * no se cachea: el próximo interesado reintenta.
   */
  traerSucursales(): Observable<any> {
    const ahora = Date.now();
    if (!this.sedesCache || ahora - this.sedesCacheTs > UtilityServiceService.SEDES_TTL_MS) {
      this.sedesCache = this.http.get(`${this.apiUrl}/gestion_admin/sedes/`).pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.sedesCacheTs = ahora;
      this.sedesCache.subscribe({ error: () => { this.sedesCache = null; } });
    }
    return this.sedesCache;
  }

  traerSucursales2(): Observable<any> {
    return this.traerSucursales();
  }

  private sedesCache: Observable<any> | null = null;
  private sedesCacheTs = 0;
  private static readonly SEDES_TTL_MS = 5 * 60_000;

  // traer empresas
  traerEmpresas(): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_admin/empresas/`);
  }

  // traer roles
  traerRoles(): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_admin/roles/`);
  }

  // traer permisos

  /**
   * Variante directa cuando ya tienes el UUID del usuario.
   */
  cambiarSedePorUsuarioId(
    usuarioId: string,
    sedeId: string | null
  ): Observable<{ ok: boolean; changed: boolean; sede_id: string | null; sede: string | null; }> {
    // La clave va DUPLICADA a propósito: `sede` es la que entiende el backend nuevo y
    // `sede_id`/`sedeId` las que leían las versiones anteriores del controlador. Mandar
    // solo una hacía que la otra punta recibiera null y BORRARA las sedes del usuario.
    const body = sedeId
      ? { sede: sedeId, sede_id: sedeId, sedeId }
      : { sede: null, sede_id: null, sedeId: null };
    return this.http.post<{
      ok: boolean; changed: boolean; sede_id: string | null; sede: string | null;
    }>(`${this.apiUrl}/gestion_admin/usuarios/${usuarioId}/cambiar_sede/`, body);
  }

  /**
   * Alcance de sedes del usuario (V62): sobre cuáles puede operar, cuál tiene activa y
   * cuáles caducan. Para un ADMIN devuelve TODAS las sedes activas con `todas: true`.
   */
  traerAlcanceSedes(usuarioId: string): Observable<AlcanceSedes> {
    return this.http.get<AlcanceSedes>(`${this.apiUrl}/gestion_admin/usuarios/${usuarioId}/sedes/`);
  }

  /**
   * Guarda la selección acumulativa del buscador de sedes. Lo que añade quien NO es
   * administrador caduca a las 24 h; un administrador consolida de forma permanente.
   */
  guardarSedesOperativas(
    usuarioId: string,
    sedes: string[],
    principal: string | null,
    motivo?: string,
  ): Observable<AlcanceSedes> {
    return this.http.post<AlcanceSedes>(
      `${this.apiUrl}/gestion_admin/usuarios/${usuarioId}/sedes/operativas/`,
      { sedes, principal, motivo: motivo ?? null },
    );
  }

  traerUsuarios(): Observable<any> {
    return this.http.get(`${this.apiUrl}/usuarios/usuarios`);
  }

  getAllUsers(): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_admin/usuarios/`);
  }

  // Traer datos de la comercializadora por codigo
  // verificar cedula si pertenece al codigo
  public verificarCedulaCodigo(
    codigo: string,
    cedula: string
  ): Observable<string> {
    return this.http
      .get<{ message: string }>(
        `${this.apiUrl}/Codigo/verificarCedula/${cedula}/${codigo}`
      )
      .pipe(map((response) => response.message));
  }

  // Verificar monto del código
  public verificarMontoCodigo(codigo: any, monto: number, rol?: string): boolean {
    // 🔹 Validar si codigo y codigo.codigo[0] existen
    if (!codigo || !codigo.codigo || !codigo.codigo[0]) {
      return false;
    }

    // 🔹 Convertir a número para asegurar cálculos correctos
    const montoCodigo = parseInt(codigo.codigo[0].monto, 10);
    if (isNaN(montoCodigo)) {
      return false;
    }

    // 🔹 Evaluar según el rol
    if (rol?.toLowerCase() === 'tienda') {
      // Se permite un excedente de 50,000 si el rol es "TIENDA"
      return montoCodigo >= (monto - 50000);
    }

    // Para otros roles, el monto no debe superar el disponible
    return montoCodigo >= monto;
  }

  // Buscar operario por cedula
  async buscarOperarioPorCedula(cedula: string): Promise<any> {
    return this.http.get(`${this.apiUrl}/contratacion/buscarCandidato/${cedula}`);
  }

  public obtenerCodigosContrato(cedula: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/contratacion/contratos/${cedula}/`).pipe(
      map((response: any) => response)
    );
  }


  /** Normaliza para comparar: sin acentos, minúsculas, un solo espacio */
  _normKey(s: string): string {
    return (s ?? '')
      .toString()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** normaliza para comparar: sin acentos, minúsculas */
  normKey(s: string): string {
    return (s ?? '')
      .toString()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** String del backend ("A, B, C") -> array mapeado a tu catálogo */
  parseMultiToCatalog(input: string | string[] | null | undefined, catalog: readonly string[]): string[] {
    const catMap = new Map<string, string>(catalog.map(v => [this.normKey(v), v]));
    const tokens = Array.isArray(input)
      ? input
      : String(input ?? '')
        .split(/[,\uFF0C;|/]+/) // coma, punto y coma, pipes, slash…
        .map(s => s.trim())
        .filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of tokens) {
      const k = this.normKey(raw);
      const canon = catMap.get(k);
      if (!canon) continue;          // ignora lo que no esté en tu catálogo
      const dk = this.normKey(canon);
      if (seen.has(dk)) continue;    // evita duplicados
      seen.add(dk);
      out.push(canon);
    }
    return out;
  }




  /* ──────────  Refactor Utilities (Nuevas)  ────────── */

  /**
   * Normaliza un texto: sin acentos/diacríticos, sin espacios extra y mayúsculas.
   * Útil para comparaciones o claves.
   */
  normalizeText(s: any): string {
    return (s ?? '')
      .toString()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[\u0300-\u036f]/g, '') // redundancia defensiva
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  /**
   * Convierte valores booleanos, numéricos o strings a 'Sí' o 'No'.
   */
  toSiNo(v: any): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'string') {
      const s = this.normalizeText(v);
      return ['SI', 'YES', 'TRUE', '1', 'S', 'X'].includes(s);
    }
    return false;
  }

  /**
   * Formatea un objeto Date a string YYYY-MM-DD para el backend.
   */
  formatDateForBackend(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}
