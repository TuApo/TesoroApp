# De dónde sale esta oficina

La escena 3D viene de **agents-office** (https://github.com/ajsahni/agents-office),
v3.0.0-beta.4, bajo **PolyForm Noncommercial 1.0.0** — copia íntegra en
`LICENSE-agents-office.txt`.

**Qué permite:** uso personal e interno. **Qué no:** venderlo, revenderlo ni
construir un producto de pago encima. TuApo lo usa como herramienta interna de
administración, que es uso permitido. Si algún día la plataforma se factura a
terceros con esta pantalla dentro, hay que sacarla o renegociar la licencia.

## Qué se portó y qué no

| De agents-office | Aquí |
|---|---|
| `src/builders.js` — geometría procedural | `builders.ts`, port casi literal (TS estricto, menos sombras, menos polígonos) |
| `src/main.js` — cámara isométrica, tween, foco/atenuado, raycast, LOD | `oficina-escena.ts`, reescrito sobre un contenedor en vez de la ventana |
| `makeNeuralBrain()` — nebulosa procedural | `makeCerebro()`, nodos = documentos reales del módulo Conocimiento |
| 6 departamentos y 33 agentes escritos a mano | `oficina-plano.ts`: las 22 categorías y los 81 agentes del catálogo de ruflo |
| Motor de tareas propio (`serve.mjs`, llama a `claude -p`) | **No se portó.** Manda el puente que ya existe (`/ia/agentes/**` → :8099) |
| El "brain" como carpeta de notas Markdown | **No se portó.** El grafo sale de `/ia/conocimiento/documentos` |
| Chat por agente, MCP, reuniones, modo cámara | **No se portó** |

## Por qué no se corrió tal cual

agents-office es un producto autónomo: levanta su propio servidor en :4520 y llama
a Claude con **su** cuenta. Montarlo al lado habría dado dos sistemas de agentes
desconectados — sus 33 agentes de mentira frente a los 81 reales del pool, y una
cuenta fuera del reparto de ranuras. Lo que aporta es la cara; las tripas ya
estaban y son mejores.
