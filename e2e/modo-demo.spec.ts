/**
 * Modo demostración (revisión de Google Play), de punta a punta sobre el build.
 *
 * Por qué existe
 * ==============
 * Los revisores de Google entran desde fuera de Colombia, donde el API no responde, con la
 * cuenta de revisión de `core/demo/modo-demo.ts`. Con ella la app NO puede tocar la red: el
 * sandbox contesta con datos ficticios. Y al revés, un login real no puede caer en el sandbox
 * aunque haya quedado la marca de una demostración anterior en el mismo teléfono.
 *
 * Regla que vigila: 0 peticiones a *.tuapo.co mientras la marca está puesta, y un login real
 * sin la cuenta de revisión vuelve a salir por la red.
 *
 * Cómo correrlo
 * =============
 *     npx ng build --configuration production          # deja dist/tesoreria/browser
 *     DEMO_WEB=dist/tesoreria/browser DEMO_PASS='<clave de revisión>' \
 *       npx playwright test e2e/modo-demo.spec.ts --workers=1
 *
 * En un host sin las librerías de Chromium, dentro de mcr.microsoft.com/playwright:v1.63.0-noble.
 *
 * Sin DEMO_WEB o sin DEMO_PASS se salta (no hay build que servir, o no hay clave que teclear:
 * la clave no se escribe aquí).
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

const WEB = process.env['DEMO_WEB'] ? path.resolve(process.env['DEMO_WEB']) : '';
const CLAVE = process.env['DEMO_PASS'] ?? '';
// Puerto libre que da el sistema: un puerto fijo choca con lo que ya corra en la máquina.
let RAIZ = '';
const CUENTA = 'thisisatestaccount@test.com';

test.skip(!WEB || !CLAVE || !fs.existsSync(WEB), 'Falta DEMO_WEB (build) o DEMO_PASS');
test.describe.configure({ mode: 'serial' });

const TIPOS: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

let servidor: http.Server;

test.beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let f = path.join(WEB, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    // Build SSR: igual que el workflow de Android, index.csr.html hace de index.html.
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      f = path.join(WEB, fs.existsSync(path.join(WEB, 'index.csr.html')) ? 'index.csr.html' : 'index.html');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  RAIZ = `http://127.0.0.1:${(servidor.address() as import('net').AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
});

/** Contexto que corta y anota toda petición a *.tuapo.co (aquí no hay API de verdad). */
async function contexto(browser: import('@playwright/test').Browser) {
  const fugas: string[] = [];
  const ctx = await browser.newContext({
    serviceWorkers: 'block', viewport: { width: 412, height: 860 }, locale: 'es-CO', timezoneId: 'America/Bogota',
  });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.endsWith('tuapo.co')) {
      fugas.push(`${route.request().method()} ${u.href}`);
      return route.abort();
    }
    return route.continue();
  });
  return { ctx, fugas };
}

async function entrar(page: Page, login: string, clave: string) {
  await page.goto(`${RAIZ}/`);
  await page.waitForSelector('#login', { timeout: 30_000 });
  await page.fill('#login', login);
  await page.fill('#password', clave);
  await page.locator('#password').press('Enter');
}

const texto = async (page: Page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const ir = async (page: Page, ruta: string, espera = 2500) => {
  await page.goto(`${RAIZ}/#${ruta}`);
  await page.waitForTimeout(espera);
};

test.describe('modo demostración', () => {
  let ctx: BrowserContext;
  let fugas: string[];
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    ({ ctx, fugas } = await contexto(browser));
    page = await ctx.newPage();
  });
  test.afterAll(async () => ctx?.close());

  test('la cuenta de revisión entra con datos ficticios', async () => {
    // Fuera de Colombia el heartbeat deja la app «sin red» antes del login. Un corte y vuelta del
    // sistema reproduce ese estado al instante: la demo tiene que entrar igual.
    await page.goto(`${RAIZ}/`);
    await page.waitForSelector('#login', { timeout: 30_000 });
    await ctx.setOffline(true);
    await page.waitForTimeout(300);
    await ctx.setOffline(false);
    // Lo de antes del login (el heartbeat que dispara el «online») sale a la red a propósito:
    // aún no hay marca. Se deja terminar y se empieza a contar desde aquí.
    await page.waitForTimeout(1500);
    fugas.length = 0;
    await entrar(page, CUENTA, CLAVE);
    await page.waitForURL(/#\/dashboard/, { timeout: 30_000 });
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => localStorage.getItem('tuapo_modo_demo'))).toBe('1');
    await expect(page.locator('#aviso-modo-demo')).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}').nombre)).toBe('Laura Demo Restrepo');
  });

  test('consulta de persona y ficha 360', async () => {
    await ir(page, '/dashboard/treasury/consulta');
    const buscador = page.locator('app-buscador-persona input').first();
    await expect(buscador).toHaveCount(1);
    await buscador.fill('prieto');
    await page.waitForTimeout(2500);
    const resultado = page.getByText('JULIÁN ANDRÉS PRIETO EJEMPLO').first();
    await expect(resultado).toHaveCount(1);
    await resultado.click();
    await page.waitForTimeout(3000);
    expect(await texto(page)).toContain('9000000012');
  });

  test('informe de tesorería, autorizaciones y carné', async () => {
    await ir(page, '/dashboard/treasury/informe', 4000);
    expect(await texto(page)).toMatch(/1\.248|1248/);
    await ir(page, '/dashboard/authorizations/market-bonus');
    await ir(page, '/dashboard/authorizations/money-loan', 4000);
    expect(await texto(page)).toContain('Buscar al trabajador');
    await ir(page, '/dashboard/carnet/mi-carnet', 4000);
    expect(await texto(page)).toContain('LAURA DEMO RESTREPO');
  });

  test('al reabrir la app sigue en demostración', async () => {
    await page.reload();
    await page.waitForTimeout(4000);
    await expect(page.locator('#aviso-modo-demo')).toHaveCount(1);
  });

  test('XHR al API no sale a la red y termina en error', async () => {
    const antes = fugas.length;
    const resultado = await page.evaluate(() => new Promise<string>((ok) => {
      const x = new XMLHttpRequest();
      x.open('GET', 'https://api.tuapo.co/health/');
      x.onerror = () => ok(`error:${x.readyState}`);
      x.onload = () => ok('load');
      x.send();
    }));
    expect(resultado).toBe('error:4');
    expect(fugas.length).toBe(antes);
  });

  test('ninguna petición salió a *.tuapo.co durante la demostración', () => {
    expect(fugas).toEqual([]);
  });
});

test('un login real con una marca vieja vuelve a pasar por la red', async ({ browser }) => {
  const { ctx, fugas } = await contexto(browser);
  const page = await ctx.newPage();
  // Demostración que quedó abierta en el teléfono (la app se cerró sin logout).
  await page.goto(`${RAIZ}/`);
  await page.evaluate(() => localStorage.setItem('tuapo_modo_demo', '1'));
  await entrar(page, 'persona.real@example.com', 'otra-clave');
  await expect.poll(() => fugas.some((f) => f.startsWith('POST ')), { timeout: 15_000 }).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('tuapo_modo_demo'))).toBeNull();
  await ctx.close();
});
