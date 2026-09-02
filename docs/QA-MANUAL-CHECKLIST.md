# QA manual — checklist post-hardening

Después de mergear `hardening/tesoroapp-modernization` a `main`, ejecutar
**en orden** este checklist en una máquina con Electron real.

> **Por qué manual**: el Karma headless no abre Electron, y los PDFs son
> validados visualmente porque no hay golden tests todavía (Sprint 3 lo
> agregará en el futuro).

---

## 0) Setup

```bash
cd c:/Users/sebst/Documents/GITHUB/codigo/trabajo/apoyo-laboral/TesoroApp
git checkout hardening/tesoroapp-modernization
npm install --legacy-peer-deps   # primera vez después del checkout
npm run start:electron           # abre Electron en dev (puerto 4400)
```

---

## 1) Autenticación

- [ ] **Login con credenciales válidas** → llega al dashboard.
- [ ] **Token persiste**: cerrar y volver a abrir Electron → debería seguir
  logueado (a menos que el token haya expirado).
- [ ] **Login con credenciales inválidas** → muestra mensaje de error.
- [ ] **Logout** → vuelve a la pantalla de login. `localStorage` limpio.
- [ ] **Token expirado** (forzar enviando petición a un endpoint que valida
  token y dejar pasar 24h) → 401 → redirección a login automática.
- [ ] **DevTools (F12) → Application → Local Storage**: las keys son
  `token`, `Authorization`, `user` (sin cambios).

---

## 2) Navegación

- [ ] Sidebar abre/cierra.
- [ ] Cada item del sidebar carga su feature lazy (verificar en DevTools
  → Network → chunk separado por feature).
- [ ] Navbar muestra usuario + rol.
- [ ] Hash routing funciona: la URL siempre tiene `#/...` cuando se
  navega.
- [ ] Refresh (Ctrl+R) preserva la ruta actual.

---

## 3) Documentos PDF (Hiring)

Probar con cédulas reales de **al menos** estas empresas:

| Empresa | Vacante esperada | Docs críticos a generar |
|---|---|---|
| THE ELITE FLOWER | Elite | Inducción, Manejo Imagen, Ficha Técnica, Contrato |
| ELITE BLU | Elite Blu | Inducción, Manejo Imagen, Ficha Técnica, Contrato |
| FLORES IPANEMA | Ipanema | Inducción Ipanema, Inducción Ipanema Foráneos, BONIFICACION IPANEMA |
| FLORES SÁGARO | Sagaro | Inducción Sagaro, Sagaro Lockers/Imagen/Celular |
| FLORES DEL RIO | Flores del Rio | Inducción Agrícola, Entrega Carnets, Inducción Capacitación, Formato Solicitud |
| AGRICOLA CARDENAL | Agricola | Inducción Agrícola |
| ADMINISTRATIVO (finca) | Administrativos | Inducción Administrativos |
| APOYO LABORAL TS | Apoyo default | Inducción genérica |

Para cada combinación:
- [ ] La pestaña Auto-generables muestra los docs esperados (ni más, ni menos).
- [ ] Click "Generar PDF" produce un PDF válido.
- [ ] El PDF abre en el iframe de preview sin errores en consola.
- [ ] Comparar visualmente con un PDF generado **antes del merge** (si
  alguien guardó samples).

---

## 4) Electron — seguridad runtime

- [ ] DevTools → Console: ninguna advertencia de CSP bloqueando recursos
  legítimos.
  - Si aparece "Refused to load X because it violates CSP": agregar X al
    CSP en index.html (puede ser un endpoint nuevo del backend).
- [ ] DevTools → Network: `fonts/Roboto-Regular.ttf` y `Docs/*.pdf` se
  descargan **una sola vez** por sesión (caché del componente PDF).
- [ ] DevTools → Console: el log `[entrevista pick]` aparece al entrar a
  documentos de un candidato.
- [ ] DevTools → Console: el log `[docs filter]` aparece y solo se vuelve a
  imprimir cuando cambia la vacante.
- [ ] Click en algún link externo `https://...` → abre en navegador del SO.
- [ ] Click (si existe alguno) en link `http://...` → **NO abre** (CSP +
  helper bloquea). Console debe decir
  `[security] shell.openExternal blocked non-https URL`.

---

## 5) IPC

- [ ] Subir un archivo offline (modo avión activado) → la cola guarda en
  SQLite. Verificar en DevTools → Application → IndexedDB / IpcCalls.
- [ ] Reconectar red → la cola se reproduce automáticamente.
- [ ] Forzar IPC con sender no autorizado: imposible desde DevTools del
  renderer (file:// es allowed). Para validar el helper, intentar invocar
  desde un iframe externo no debería funcionar.
- [ ] Lector de huella (si está conectado): `fingerprint:get` retorna el
  binario del C# externo sin error.

---

## 6) Performance

- [ ] Tiempo de arranque (Splash → Login): comparar con baseline.
  Esperado: igual o mejor que pre-hardening.
- [ ] Generación de PDF: la **segunda** generación del mismo tipo de doc
  debe ser notablemente más rápida (caché de fuente y plantilla).
- [ ] Click en tabs / hover en menús del componente de documentos: fluido,
  sin lag (memoización del filtro).
- [ ] Navegar entre features lazy: cada una carga su chunk al entrar.

---

## 7) Compilación / dev experience

- [ ] `npx tsc --noEmit -p tsconfig.json` → EXIT=0
- [ ] `npm run build` → EXIT=0, solo warnings preexistentes
- [ ] `npm test` → 51/52 (test fallando es preexistente en
  `BoardPreviewPageComponent`, no tocado en hardening)
- [ ] `npm audit` → 32 vulnerabilidades (vs 55 antes; las restantes son
  de transitivas no-Angular y se documentan aparte)

---

## 8) Casos negativos (no debe romper)

- [ ] Ingresar con un usuario que tenga vacantes NO listadas en
  `PerfilEmpresa[]` (ej: `BMC`, `MONTEVERDE`, `LUISIANA FARMS`):
  debería caer al **Tu Alianza default** y mostrar 18 docs sin Inducción.
- [ ] Ingresar con un usuario sin `temporal` poblado:
  cae al **Mínimo absoluto** (Cédula + Contrato + Hoja de Vida Minerva).
- [ ] Si Electron arranca sin red, debería poder abrir y mostrar la UI
  (offline-first via SQLite cache).

---

## 9) Rollback (si algo falla)

```bash
git checkout main
npm install --legacy-peer-deps
npm run start:electron
```

Esto vuelve al estado pre-hardening. Cada commit del hardening es
revertible individualmente con `git revert <hash>`.

Lista de commits del hardening (en orden):

```
332ca12 chore(checkpoint)               ← en main
98b6f71 chore(gitignore)                ← en main
a0459bb security(electron) CSP
a51f7c8 security(electron) https
79db529 security(ipc) app handlers
e90ef7b refactor(security) extract module
709fada security(ipc) db handlers
1511214 fix(platform) localStorage
f805ffd fix(csp) frame-src backend
5476332 security(angular) upgrade
a70228b refactor(angular) control flow
d77a10d refactor(angular) takeUntilDestroyed
250bb3c refactor(angular) inject
998813f docs(pdf) refactor plan
df27c76 docs(material) M3 plan
7a43a9e docs(deps) PDF audit
0608420 docs(electron) Fuses plan
```

Si el QA detecta una regresión, revertir SOLO el commit problemático
sin afectar el resto.

---

## Reportes esperados

Al completar el QA:

- ✅ Si todos los items pasan → merge a `main` y tag `v8.3.0-hardened`.
- ⚠️ Si algunos items fallan → documentar en issue tracker con commit hash
  sospechoso.
- 🔴 Si flujos críticos fallan (login, generación PDF, IPC) → rollback
  inmediato y notificar al equipo.
