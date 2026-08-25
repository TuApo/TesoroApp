import { Injectable, inject, signal } from '@angular/core';
import { DeviceKeyService, SelloDispositivo, TipoBinding } from './device-key.service';
import { vaultGet, vaultSet, vaultDelete, secureStorageDisponible } from './secure-store';
import { Plataforma, asegurarPersistencia, detectarPlataforma, esAppInstalada } from './plataforma.util';
import {
  SelloCifrado, aesDecrypt, aesEncrypt, b64uDecode, b64uEncode, derivarClaveDePin,
  derivarClaveDeSecreto, fromBytes, importAesKey, randomBytes, toBytes,
  PBKDF2_ITERACIONES,
} from './crypto.util';
import {
  RegistroBiometrico, SoporteBiometrico, detectarBiometria, registrarBiometria, verificarBiometria,
} from './biometria.util';

const K_REGISTRO = 'quickaccess.v1';
const K_RECHAZO = 'quickaccess.rechazo';
/** Si el usuario dice "ahora no", no se le vuelve a preguntar en 30 días. */
const DIAS_SILENCIO_TRAS_RECHAZO = 30;

/** Formas de desbloqueo que puede elegir el usuario. */
export type MetodoAcceso = 'biometria' | 'pin' | 'dispositivo';

export const MAX_INTENTOS = 5;
/** Caducidad por defecto del guardado, en días. */
export const DIAS_VIGENCIA: Record<MetodoAcceso, number> = {
  biometria: 60,
  pin: 60,
  dispositivo: 14, // sin factor humano: ventana más corta a propósito
};

export interface CredencialesGuardadas {
  login: string;
  password: string;
}

/** Lo que la UI necesita saber sin descifrar nada. */
export interface EstadoAccesoRapido {
  activo: boolean;
  metodo: MetodoAcceso | null;
  etiquetaUsuario: string;
  loginEnmascarado: string;
  creadoEn: number;
  expiraEn: number;
  intentosRestantes: number;
  /** Qué ancla el guardado en este equipo: WebCrypto o el sistema operativo. */
  binding: TipoBinding | null;
  /** En navegador: si el almacenamiento sobrevive a una limpieza automática. */
  persistente: boolean;
}

interface RegistroPersistido {
  v: 1;
  metodo: MetodoAcceso;
  deviceId: string;
  huella: string;
  /** Datos visibles sin descifrar: solo para saludar al usuario en el login. */
  etiquetaUsuario: string;
  loginEnmascarado: string;
  creadoEn: number;
  expiraEn: number;
  ultimoUso: number;
  intentos: number;
  /** Navegador: el almacenamiento quedó marcado como persistente. */
  persistente?: boolean;
  /**
   * Clave de datos envuelta. La capa exterior depende del método; la interior
   * siempre es el sello del dispositivo (WebCrypto no extraíble o safeStorage).
   */
  envoltura: SelloCifrado | SelloDispositivo;
  /** Sal PBKDF2 (solo método 'pin'). */
  pinSalt?: string;
  pinIteraciones?: number;
  /** Registro del autenticador (solo método 'biometria'). */
  bio?: RegistroBiometrico;
  /** Credenciales cifradas con la clave de datos. */
  datos: SelloCifrado;
}

export class ErrorAccesoRapido extends Error {
  constructor(
    message: string,
    readonly codigo: 'no-disponible' | 'sin-registro' | 'expirado' | 'factor-invalido'
      | 'bloqueado' | 'dispositivo-cambiado' | 'cancelado',
    readonly intentosRestantes = 0,
  ) {
    super(message);
  }
}

/**
 * Acceso rápido: guarda las credenciales del usuario **cifradas y atadas a
 * este dispositivo**, para que pueda volver a entrar sin escribir la
 * contraseña.
 *
 * ── Cómo se protege ──────────────────────────────────────────────────────
 *
 * Las credenciales nunca se guardan en claro ni en algo reversible como
 * base64. La cadena es:
 *
 *   credenciales ──AES-GCM(claveDatos)──────▶ blob `datos`
 *   claveDatos   ──sello del dispositivo─────▶ capa 1   (siempre)
 *   capa 1       ──AES-GCM(claveFactor)──────▶ capa 2   (PIN o biometría PRF)
 *
 * · El **sello del dispositivo** lo pone `DeviceKeyService` con el mecanismo
 *   más fuerte que ofrezca el entorno: una clave AES no extraíble de WebCrypto
 *   en navegador y APK, o el cifrado del sistema operativo (DPAPI / Keychain /
 *   libsecret) en el escritorio. En los dos casos el secreto no se puede leer
 *   ni copiar a otra máquina → **solo ese dispositivo** abre el blob.
 * · `claveFactor` es lo que aporta la persona: el PIN (vía PBKDF2, 310k
 *   iteraciones) o el secreto PRF de la huella. Sin ella tampoco se abre, así
 *   que ni quien tenga el teléfono desbloqueado en la mano entra solo.
 * · Con método 'dispositivo' se omite la capa 2: entra directo. Es la opción
 *   más rápida y la menos segura, así que solo se ofrece en la app instalada
 *   (APK o escritorio), nunca en el navegador, y además caduca antes.
 *
 * Cada AES-GCM lleva un AAD con `deviceId|metodo|versión`: si alguien mezcla
 * blobs de registros distintos, el descifrado falla en vez de colar datos.
 *
 * Defensas adicionales: caducidad, contador de intentos con autodestrucción a
 * los 5 fallos, invalidación si cambia la huella del entorno, y borrado
 * automático cuando el servidor rechaza las credenciales guardadas.
 */
@Injectable({ providedIn: 'root' })
export class QuickAccessService {
  private readonly device = inject(DeviceKeyService);

  /** Estado reactivo para que login y configuración se refresquen solos. */
  readonly estado = signal<EstadoAccesoRapido | null>(null);

  private soporteCache: SoporteBiometrico | null = null;

  // ─── Disponibilidad ────────────────────────────────────────────────────

  async disponible(): Promise<boolean> {
    return secureStorageDisponible();
  }

  plataforma(): Plataforma {
    return detectarPlataforma();
  }

  async soporteBiometrico(): Promise<SoporteBiometrico> {
    if (this.soporteCache) return this.soporteCache;
    this.soporteCache = (await this.disponible())
      ? await detectarBiometria()
      : { disponible: false, backend: 'ninguno', etiqueta: '' };
    return this.soporteCache;
  }

  /**
   * Métodos que este dispositivo puede ofrecer ahora mismo.
   *
   * En el navegador se omite 'dispositivo' a propósito: un equipo con sesión
   * de navegador suele ser compartido (recepción, sala, PC familiar) y esa
   * opción entra sin pedir nada a nadie. En el APK o en la app de escritorio
   * el dispositivo ya es personal y está tras el bloqueo del sistema, así que
   * ahí sí tiene sentido ofrecerla.
   */
  async metodosDisponibles(): Promise<MetodoAcceso[]> {
    if (!(await this.disponible())) return [];
    const bio = await this.soporteBiometrico();

    const metodos: MetodoAcceso[] = [];
    if (bio.disponible) metodos.push('biometria');
    metodos.push('pin');
    if (esAppInstalada()) metodos.push('dispositivo');
    return metodos;
  }

  // ─── Consulta ──────────────────────────────────────────────────────────

  /** Lee el registro y actualiza `estado`. Invalida lo caducado o trasplantado. */
  async cargarEstado(): Promise<EstadoAccesoRapido | null> {
    const reg = await this.leerRegistroValido();
    const estado: EstadoAccesoRapido | null = reg
      ? {
          activo: true,
          metodo: reg.metodo,
          etiquetaUsuario: reg.etiquetaUsuario,
          loginEnmascarado: reg.loginEnmascarado,
          creadoEn: reg.creadoEn,
          expiraEn: reg.expiraEn,
          intentosRestantes: Math.max(0, MAX_INTENTOS - reg.intentos),
          binding: await this.device.tipoBinding(),
          persistente: reg.persistente ?? false,
        }
      : null;
    this.estado.set(estado);
    return estado;
  }

  private async leerRegistroValido(): Promise<RegistroPersistido | null> {
    if (!(await this.disponible())) return null;
    const reg = await vaultGet<RegistroPersistido>(K_REGISTRO);
    if (!reg || reg.v !== 1) return null;

    if (Date.now() > reg.expiraEn) {
      await this.olvidar();
      return null;
    }
    if (reg.intentos >= MAX_INTENTOS) {
      await this.olvidar();
      return null;
    }
    // El perfil fue copiado a otro navegador/origen: no lo dejamos ni intentar.
    const huellaActual = await this.device.calcularHuella();
    if (reg.huella !== huellaActual) {
      await this.olvidar();
      return null;
    }
    const deviceId = await this.device.obtenerId();
    if (reg.deviceId !== deviceId) {
      await this.olvidar();
      return null;
    }
    return reg;
  }

  /**
   * ¿Conviene ofrecer la activación tras un login correcto? Solo si el
   * dispositivo lo soporta, no hay ya un registro y el usuario no lo rechazó
   * hace poco. Ofrecerlo en cada login sería una molestia, no una función.
   */
  async debeOfrecer(): Promise<boolean> {
    if (!(await this.disponible())) return false;
    if (await this.leerRegistroValido()) return false;
    const rechazo = await vaultGet<number>(K_RECHAZO);
    if (!rechazo) return true;
    return Date.now() - rechazo > DIAS_SILENCIO_TRAS_RECHAZO * 86_400_000;
  }

  /** El usuario respondió "ahora no". */
  async marcarRechazo(): Promise<void> {
    await vaultSet(K_RECHAZO, Date.now());
  }

  // ─── Alta ──────────────────────────────────────────────────────────────

  /**
   * Guarda las credenciales para este dispositivo.
   * @param pin obligatorio si `metodo === 'pin'` (4 a 12 dígitos).
   */
  async guardar(
    metodo: MetodoAcceso,
    credenciales: CredencialesGuardadas,
    usuario: { etiqueta: string; id: string },
    pin?: string,
  ): Promise<void> {
    if (!(await this.disponible())) {
      throw new ErrorAccesoRapido(
        'Este dispositivo no permite guardar el acceso de forma segura.', 'no-disponible',
      );
    }
    if (!(await this.metodosDisponibles()).includes(metodo)) {
      throw new ErrorAccesoRapido(
        'Ese método no está disponible en este dispositivo.', 'no-disponible',
      );
    }

    const deviceId = await this.device.obtenerId();
    const aad = `${deviceId}|${metodo}|1`;

    // 1. Clave de datos aleatoria y cifrado de las credenciales.
    const claveDatosRaw = randomBytes(32);
    const claveDatos = await importAesKey(claveDatosRaw, false);
    const datos = await aesEncrypt(claveDatos, toBytes(JSON.stringify(credenciales)), aad);

    // 2. Capa 1: la clave de datos queda atada a este dispositivo — con la
    // clave no extraíble del navegador o con el cifrado del sistema operativo,
    // según lo que ofrezca el entorno.
    const capa1 = await this.device.envolver(claveDatosRaw, aad);
    claveDatosRaw.fill(0); // no dejamos el material dando vueltas en memoria

    // 3. Capa 2: factor del usuario, según el método elegido.
    let envoltura: SelloCifrado | SelloDispositivo = capa1;
    let pinSalt: string | undefined;
    let bio: RegistroBiometrico | undefined;

    if (metodo === 'pin') {
      const limpio = (pin ?? '').trim();
      if (!/^\d{4,12}$/.test(limpio)) {
        throw new ErrorAccesoRapido('El PIN debe tener entre 4 y 12 dígitos.', 'factor-invalido');
      }
      const salt = randomBytes(16);
      pinSalt = b64uEncode(salt);
      const clavePin = await derivarClaveDePin(limpio, salt);
      envoltura = await aesEncrypt(clavePin, toBytes(JSON.stringify(capa1)), aad);
    } else if (metodo === 'biometria') {
      const { registro, secreto } = await registrarBiometria(
        usuario.id, credenciales.login, usuario.etiqueta,
      );
      bio = registro;
      if (secreto) {
        // El autenticador soporta PRF: la huella aporta clave real.
        const claveBio = await derivarClaveDeSecreto(secreto, `tuapo-quickaccess|${deviceId}`);
        envoltura = await aesEncrypt(claveBio, toBytes(JSON.stringify(capa1)), aad);
        secreto.fill(0);
      }
      // Sin PRF la biometría actúa como portero: se exige la verificación antes
      // de tocar la clave del dispositivo, que sigue siendo la que cifra.
    }

    // En navegador, pedir almacenamiento persistente evita que el acceso
    // guardado desaparezca solo cuando el disco anda justo. En app instalada
    // no aplica: los datos ya viven en el perfil de la app.
    const persistente = esAppInstalada()
      ? true
      : (await asegurarPersistencia()) === 'concedida';

    const ahora = Date.now();
    const registro: RegistroPersistido = {
      v: 1,
      metodo,
      deviceId,
      huella: await this.device.calcularHuella(),
      etiquetaUsuario: usuario.etiqueta,
      loginEnmascarado: enmascararLogin(credenciales.login),
      creadoEn: ahora,
      expiraEn: ahora + DIAS_VIGENCIA[metodo] * 86_400_000,
      ultimoUso: ahora,
      intentos: 0,
      persistente,
      envoltura,
      pinSalt,
      pinIteraciones: metodo === 'pin' ? PBKDF2_ITERACIONES : undefined,
      bio,
      datos,
    };

    await vaultSet(K_REGISTRO, registro);
    await vaultDelete(K_RECHAZO);
    await this.device.fijarHuella();
    await this.cargarEstado();
  }

  // ─── Desbloqueo ────────────────────────────────────────────────────────

  /**
   * Devuelve las credenciales descifradas. `pin` solo se usa con método 'pin'.
   * Un fallo de factor suma un intento; al quinto se destruye el registro.
   */
  async desbloquear(pin?: string): Promise<CredencialesGuardadas> {
    const reg = await this.leerRegistroValido();
    if (!reg) {
      throw new ErrorAccesoRapido('No hay un acceso rápido guardado en este dispositivo.', 'sin-registro');
    }
    const aad = `${reg.deviceId}|${reg.metodo}|1`;

    // Un campo vacío es un descuido, no un intento fallido: se valida fuera del
    // try para que no consuma uno de los cinco intentos.
    if (reg.metodo === 'pin' && !(pin ?? '').trim()) {
      throw new ErrorAccesoRapido('Escribe tu PIN.', 'factor-invalido', MAX_INTENTOS - reg.intentos);
    }

    let capa1: SelloDispositivo;
    try {
      if (reg.metodo === 'pin') {
        const limpio = (pin ?? '').trim();
        const clavePin = await derivarClaveDePin(
          limpio, b64uDecode(reg.pinSalt!), reg.pinIteraciones ?? PBKDF2_ITERACIONES,
        );
        capa1 = JSON.parse(fromBytes(
          await aesDecrypt(clavePin, reg.envoltura as SelloCifrado, aad),
        ));
      } else if (reg.metodo === 'biometria') {
        const secreto = await verificarBiometria(reg.bio!);
        if (secreto) {
          const claveBio = await derivarClaveDeSecreto(secreto, `tuapo-quickaccess|${reg.deviceId}`);
          capa1 = JSON.parse(fromBytes(
            await aesDecrypt(claveBio, reg.envoltura as SelloCifrado, aad),
          ));
          secreto.fill(0);
        } else {
          capa1 = reg.envoltura as SelloDispositivo; // portero superado
        }
      } else {
        capa1 = reg.envoltura as SelloDispositivo;
      }
    } catch (e) {
      // Cancelar la huella no debe gastar intentos; un PIN errado sí.
      const cancelado = reg.metodo === 'biometria' && esCancelacion(e);
      if (cancelado) {
        throw new ErrorAccesoRapido('Verificación cancelada.', 'cancelado', MAX_INTENTOS - reg.intentos);
      }
      return this.registrarFallo(reg);
    }

    try {
      const claveDatosRaw = await this.device.desenvolver(capa1, aad);
      const claveDatos = await importAesKey(claveDatosRaw, false);
      claveDatosRaw.fill(0);
      const plano = fromBytes(await aesDecrypt(claveDatos, reg.datos, aad));
      const credenciales = JSON.parse(plano) as CredencialesGuardadas;

      reg.intentos = 0;
      reg.ultimoUso = Date.now();
      await vaultSet(K_REGISTRO, reg);
      await this.cargarEstado();
      return credenciales;
    } catch {
      return this.registrarFallo(reg);
    }
  }

  private async registrarFallo(reg: RegistroPersistido): Promise<never> {
    reg.intentos += 1;
    const restantes = MAX_INTENTOS - reg.intentos;

    if (restantes <= 0) {
      await this.olvidar();
      throw new ErrorAccesoRapido(
        'Demasiados intentos fallidos. Se borró el acceso rápido de este dispositivo; '
        + 'entra con tu contraseña para volver a activarlo.',
        'bloqueado', 0,
      );
    }

    await vaultSet(K_REGISTRO, reg);
    await this.cargarEstado();
    throw new ErrorAccesoRapido(
      `Verificación incorrecta. Te ${restantes === 1 ? 'queda' : 'quedan'} ${restantes} `
      + `${restantes === 1 ? 'intento' : 'intentos'} antes de que se borre el acceso guardado.`,
      'factor-invalido', restantes,
    );
  }

  // ─── Baja ──────────────────────────────────────────────────────────────

  /** Borra el acceso guardado. La identidad del dispositivo se conserva. */
  async olvidar(): Promise<void> {
    await vaultDelete(K_REGISTRO);
    this.estado.set(null);
  }

  /** Borra el acceso y además destruye la llave del dispositivo. */
  async olvidarTodo(): Promise<void> {
    await this.olvidar();
    await this.device.destruir();
  }
}

/** juan.perez@empresa.com → j••••••z@empresa.com · 1005851505 → 100•••1505 */
export function enmascararLogin(login: string): string {
  const v = (login ?? '').trim();
  if (!v) return '';
  const at = v.indexOf('@');
  if (at > 0) {
    const usuario = v.slice(0, at);
    const dominio = v.slice(at);
    if (usuario.length <= 2) return `${usuario[0]}•${dominio}`;
    return `${usuario[0]}${'•'.repeat(Math.min(6, usuario.length - 2))}${usuario.at(-1)}${dominio}`;
  }
  if (v.length <= 4) return '•'.repeat(v.length);
  // Documento: se dejan visibles algunos dígitos, pero nunca menos de dos
  // ocultos — con 5 dígitos el enmascarado anterior mostraba el número entero.
  if (v.length <= 6) return `${v[0]}${'•'.repeat(v.length - 2)}${v.at(-1)}`;
  return `${v.slice(0, 3)}${'•'.repeat(v.length - 5)}${v.slice(-2)}`;
}

function esCancelacion(e: unknown): boolean {
  const nombre = (e as any)?.name ?? '';
  const msg = String((e as any)?.message ?? '');
  return nombre === 'NotAllowedError' || nombre === 'AbortError'
    || /cancel|denied|user_?cancel/i.test(msg);
}
