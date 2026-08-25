/** Semilla que el tab de Informe envía al tab de Chat para iniciar una
 *  conversación nueva con el resumen del informe como contexto. El `nonce`
 *  fuerza que el `effect` del chat reaccione aunque el texto sea idéntico. */
export interface ChatSeed {
  titulo: string;
  contexto: string;
  nonce: number;
}
