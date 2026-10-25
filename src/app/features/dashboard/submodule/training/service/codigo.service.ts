import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Ejercicios de programación calificados por pruebas (learning-ms V19).
 *
 * Ejecutar código no cabe en una petición (el gateway corta a los 30 s): probar, verificar,
 * calcular esperados y sugerir casos devuelven un TRABAJO que se consulta hasta que termina.
 * {@link CodigoService.esperar} hace esa espera.
 */

export type LenguajeEjercicio = 'python' | 'javascript' | 'java' | 'c' | 'cpp' | 'go' | 'csharp';
export type ModoEjercicio = 'SALIDA' | 'FUNCIONES';

export interface CasoPrueba {
  nombre?: string | null;
  /** SALIDA: lo que el programa lee. */
  entrada?: string | null;
  /** SALIDA: lo que tiene que escribir. */
  salida_esperada?: string | null;
  /** FUNCIONES: la expresión que se evalúa, p. ej. suma(2, 3). */
  llamada?: string | null;
  /** FUNCIONES: el valor esperado, también como expresión. */
  esperado?: string | null;
  peso?: number | null;
  oculto?: boolean | null;
}

export interface EjercicioCodigo {
  lenguaje: LenguajeEjercicio | string;
  modo: ModoEjercicio | string;
  plantilla?: string | null;
  /** Solo llega a quien diseña. */
  solucion?: string | null;
  casos: CasoPrueba[];
  ignorar_espacios?: boolean | null;
  ignorar_mayusculas?: boolean | null;
  tolerancia?: number | null;
}

export type EstadoCaso = 'OK' | 'FALLO' | 'ERROR' | 'TIEMPO';

export interface CasoResultado {
  indice: number;
  nombre?: string | null;
  oculto: boolean;
  estado: EstadoCaso;
  peso?: number | null;
  entrada?: string | null;
  esperado?: string | null;
  obtenido?: string | null;
  literal?: string | null;
  mensaje?: string | null;
}

export interface ResultadoCodigo {
  puntaje: number;
  pasadas: number;
  total: number;
  compilo: boolean;
  error_compilacion?: string | null;
  salida?: string | null;
  casos: CasoResultado[];
  resumen: string;
  solo_visibles: boolean;
  calificado_at?: string;
}

export type EstadoTrabajo = 'EN_COLA' | 'PROCESANDO' | 'LISTO' | 'ERROR';

export interface TrabajoCodigo {
  id: string;
  tipo: string;
  estado: EstadoTrabajo;
  resultado?: ResultadoCodigo | null;
  ejercicio?: EjercicioCodigo | null;
  notas?: (string | null)[] | null;
  completos?: boolean | null;
  casos?: CasoPrueba[] | null;
  error?: string | null;
}

export interface EstadoCodigo {
  piston_configurado: boolean;
  lenguajes: string[];
  con_funciones: string[];
}

export type OrigenEjercicio = 'PREGUNTA' | 'ACTIVIDAD' | 'AULA';

export const LENGUAJES_EJERCICIO: { id: LenguajeEjercicio; nombre: string; funciones: boolean }[] = [
  { id: 'python', nombre: 'Python', funciones: true },
  { id: 'javascript', nombre: 'JavaScript', funciones: true },
  { id: 'java', nombre: 'Java', funciones: true },
  { id: 'c', nombre: 'C', funciones: true },
  { id: 'cpp', nombre: 'C++', funciones: true },
  { id: 'go', nombre: 'Go', funciones: false },
  { id: 'csharp', nombre: 'C#', funciones: false },
];

export function nombreLenguaje(l: string | null | undefined): string {
  return LENGUAJES_EJERCICIO.find(x => x.id === l)?.nombre ?? (l ?? '');
}

/** Un ejercicio vacío para empezar, con su plantilla y un caso de ejemplo. */
export function ejercicioNuevo(lenguaje: LenguajeEjercicio = 'python', modo: ModoEjercicio = 'FUNCIONES'): EjercicioCodigo {
  return {
    lenguaje, modo,
    plantilla: plantillaDe(lenguaje, modo),
    solucion: '',
    casos: [modo === 'FUNCIONES'
      ? { nombre: 'Caso básico', llamada: ejemploLlamada(lenguaje), esperado: '', peso: 1 }
      : { nombre: 'Caso básico', entrada: '2 3', salida_esperada: '', peso: 1 }],
    ignorar_espacios: true, ignorar_mayusculas: false,
  };
}

export function ejemploLlamada(l: string): string {
  return l === 'java' ? 'Solucion.suma(2, 3)' : 'suma(2, 3)';
}

export function plantillaDe(l: string, modo: string): string {
  const f = modo === 'FUNCIONES';
  switch (l) {
    case 'python': return f ? 'def suma(a, b):\n    # Escribe tu solución aquí\n    pass\n'
      : 'a, b = map(int, input().split())\n# Escribe tu solución aquí\nprint(a + b)\n';
    case 'javascript': return f ? 'function suma(a, b) {\n  // Escribe tu solución aquí\n}\n'
      : "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\n// Escribe tu solución aquí\nconsole.log(a + b);\n";
    case 'java': return f ? 'public class Solucion {\n    public static int suma(int a, int b) {\n        // Escribe tu solución aquí\n        return 0;\n    }\n}\n'
      : 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int a = sc.nextInt(), b = sc.nextInt();\n        System.out.println(a + b);\n    }\n}\n';
    case 'c': return f ? 'int suma(int a, int b) {\n    /* Escribe tu solución aquí */\n    return 0;\n}\n'
      : '#include <stdio.h>\n\nint main(void) {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}\n';
    case 'cpp': return f ? '#include <bits/stdc++.h>\nusing namespace std;\n\nint suma(int a, int b) {\n    // Escribe tu solución aquí\n    return 0;\n}\n'
      : '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << a + b << endl;\n}\n';
    case 'go': return 'package main\n\nimport "fmt"\n\nfunc main() {\n    var a, b int\n    fmt.Scan(&a, &b)\n    fmt.Println(a + b)\n}\n';
    case 'csharp': return 'using System;\n\nclass Program {\n    static void Main() {\n        var p = Console.ReadLine().Split(\' \');\n        Console.WriteLine(int.Parse(p[0]) + int.Parse(p[1]));\n    }\n}\n';
    default: return '';
  }
}

/** Cómo se escriben la llamada y el esperado en cada lenguaje (ayuda de la pantalla). */
export function ayudaFunciones(l: string): string {
  switch (l) {
    case 'python': return 'Llamada: suma(2, 3) · Esperado: 5, "hola", [1, 2], {"a": 1}, True, None';
    case 'javascript': return 'Llamada: suma(2, 3) · Esperado: 5, "hola", [1, 2], ({a: 1}), true, null';
    case 'java': return 'Llamada: Solucion.suma(2, 3) · Esperado: 5, "hola", \'c\', 2.5, true, new int[]{1, 2}, List.of(1, 2)';
    case 'c': return 'Llamada: suma(2, 3) · Esperado: 5, 2.5, \'c\', "hola" (los textos se comparan con strcmp)';
    case 'cpp': return 'Llamada: suma(2, 3) · Esperado: 5, 2.5, "hola", vector<int>{1, 2}';
    default: return '';
  }
}

@Injectable({ providedIn: 'root' })
export class CodigoService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/learning/codigo`;

  private estadoCache: Promise<EstadoCodigo> | null = null;

  /** Si hay compilador (Piston). Se pregunta una vez por sesión de la pantalla. */
  estado(): Promise<EstadoCodigo> {
    if (!this.estadoCache) {
      this.estadoCache = firstValueFrom(this.http.get<EstadoCodigo>(`${this.base}/estado`)).catch(e => {
        this.estadoCache = null;
        throw e;
      });
    }
    return this.estadoCache;
  }

  probar(origen: OrigenEjercicio, origenId: string, codigo: string): Promise<TrabajoCodigo> {
    return firstValueFrom(this.http.post<TrabajoCodigo>(`${this.base}/probar`, { origen, origen_id: origenId, codigo }));
  }

  verificar(ejercicio: EjercicioCodigo, codigo?: string | null): Promise<TrabajoCodigo> {
    return firstValueFrom(this.http.post<TrabajoCodigo>(`${this.base}/verificar`, { ejercicio, codigo: codigo ?? null }));
  }

  esperados(ejercicio: EjercicioCodigo): Promise<TrabajoCodigo> {
    return firstValueFrom(this.http.post<TrabajoCodigo>(`${this.base}/esperados`, { ejercicio }));
  }

  sugerir(enunciado: string, ejercicio: EjercicioCodigo, cantidad = 5): Promise<TrabajoCodigo> {
    return firstValueFrom(this.http.post<TrabajoCodigo>(`${this.base}/sugerir`, { enunciado, ejercicio, cantidad }));
  }

  trabajo(id: string): Promise<TrabajoCodigo> {
    return firstValueFrom(this.http.get<TrabajoCodigo>(`${this.base}/trabajos/${id}`));
  }

  /**
   * Espera a que un trabajo termine (LISTO o ERROR), consultando cada segundo y medio.
   * @param alAvanzar se llama con cada estado intermedio (para mostrar "en cola" / "ejecutando")
   */
  async esperar(t: TrabajoCodigo, alAvanzar?: (t: TrabajoCodigo) => void, maxSeg = 240): Promise<TrabajoCodigo> {
    let actual = t;
    const limite = Date.now() + maxSeg * 1000;
    while (actual.estado !== 'LISTO' && actual.estado !== 'ERROR') {
      if (Date.now() > limite) throw new Error('Se demoró demasiado: intenta otra vez en un momento');
      await new Promise(r => setTimeout(r, 1500));
      actual = await this.trabajo(actual.id);
      alAvanzar?.(actual);
    }
    return actual;
  }
}
