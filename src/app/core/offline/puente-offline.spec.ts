import { puenteOffline } from './puente-offline';

/**
 * La cola offline en navegador. Se prueba contra la IndexedDB REAL del
 * navegador de pruebas: es donde vivirían los envíos de la gente, y un mock
 * no diría nada útil sobre transacciones, índices ni cuotas.
 */
describe('puenteOffline (IndexedDB)', () => {
  const puente = puenteOffline();

  beforeEach(async () => {
    await puente.db.clearQueue();
    await puente.db.clearCache();
  });

  afterAll(async () => {
    await puente.db.clearQueue();
    await puente.db.clearCache();
  });

  it('no devuelve el puente nativo cuando no hay Electron', () => {
    expect(puente).withContext('debe haber puente en navegador').toBeTruthy();
    expect((window as any).electron).toBeUndefined();
  });

  it('encola una mutación y la devuelve como pendiente', async () => {
    const res = await puente.db.saveRequestQueue({
      method: 'POST',
      url: 'https://api.tuapo.co/hr/candidatos',
      body: JSON.stringify({ nombre: 'Prueba' }),
      headers: null,
      idempotencyKey: 'clave-1',
      userId: 'u1',
    });
    expect(res.success).toBeTrue();
    expect(res.id).toBeGreaterThan(0);

    const pendientes = await puente.db.getPendingRequests({ userId: 'u1' });
    expect(pendientes.length).toBe(1);
    expect(pendientes[0].method).toBe('POST');
    expect(pendientes[0].status).toBe('pending');
    expect(pendientes[0].body_type).toBe('json');
    expect(pendientes[0].idempotency_key).toBe('clave-1');
    expect(pendientes[0].attempt_count).toBe(0);
  });

  it('no le enseña a un usuario la cola de otro', async () => {
    await puente.db.saveRequestQueue({ method: 'POST', url: '/a', userId: 'u1' });
    await puente.db.saveRequestQueue({ method: 'POST', url: '/b', userId: 'u2' });
    // Sin user_id la fila es de todos (compatibilidad con filas antiguas).
    await puente.db.saveRequestQueue({ method: 'POST', url: '/c', userId: null });

    const deU1 = await puente.db.getPendingRequests({ userId: 'u1' });
    expect(deU1.map((f: any) => f.url).sort()).toEqual(['/a', '/c']);
  });

  it('devuelve los pendientes del más viejo al más nuevo', async () => {
    await puente.db.saveRequestQueue({ method: 'POST', url: '/1', userId: 'u1' });
    await new Promise(r => setTimeout(r, 5));
    await puente.db.saveRequestQueue({ method: 'POST', url: '/2', userId: 'u1' });

    const filas = await puente.db.getPendingRequests({ userId: 'u1' });
    expect(filas.map((f: any) => f.url)).toEqual(['/1', '/2']);
  });

  it('marca el fallo con su motivo y cuenta el intento, sin perder la fila', async () => {
    const { id } = await puente.db.saveRequestQueue({ method: 'PUT', url: '/x', userId: 'u1' });

    await puente.db.markRequestStatus({ id, status: 'failed', error: 'timeout' });

    const fallidos = await puente.db.getFailedRequests({ userId: 'u1' });
    expect(fallidos.length).toBe(1);
    expect(fallidos[0].last_error).toBe('timeout');
    expect(fallidos[0].attempt_count).toBe(1);
    expect(await puente.db.getPendingRequests({ userId: 'u1' })).toEqual([]);
  });

  it('rechaza un estado que el proceso principal no aceptaría', async () => {
    const { id } = await puente.db.saveRequestQueue({ method: 'PUT', url: '/x' });
    await expectAsync(puente.db.markRequestStatus({ id, status: 'inventado' })).toBeRejected();
  });

  it('reintenta un fallido: vuelve a pendiente y limpia el error', async () => {
    const { id } = await puente.db.saveRequestQueue({ method: 'PUT', url: '/x', userId: 'u1' });
    await puente.db.markRequestStatus({ id, status: 'failed', error: 'sin red' });

    await puente.db.retryRequest(id);

    const pendientes = await puente.db.getPendingRequests({ userId: 'u1' });
    expect(pendientes.length).toBe(1);
    expect(pendientes[0].last_error).toBeNull();
  });

  it('guarda un archivo y lo devuelve intacto', async () => {
    const base64 = btoa('contenido binario de prueba');
    const guardado = await puente.offline.saveUpload({
      base64, fileName: 'cedula.pdf', mimeType: 'application/pdf',
    });
    expect(guardado.success).toBeTrue();
    expect(guardado.storedPath).toContain('idb://uploads/');

    const leido = await puente.offline.readUpload(guardado.storedPath);
    expect(leido.success).toBeTrue();
    expect(leido.base64).toBe(base64);
  });

  it('encola un multipart con sus archivos y los borra al completarse', async () => {
    const subida = await puente.offline.saveUpload({
      base64: btoa('pdf'), fileName: 'hoja.pdf', mimeType: 'application/pdf',
    });
    const { id } = await puente.db.saveMultipartRequest({
      method: 'POST',
      url: '/documentos',
      headers: null,
      formFields: [{ name: 'tipo', value: 'HV' }],
      files: [{
        fieldName: 'archivo', fileName: 'hoja.pdf',
        mimeType: 'application/pdf', storedPath: subida.storedPath,
      }],
      userId: 'u1',
    });

    const archivos = await puente.db.getRequestFiles(id);
    expect(archivos.length).toBe(1);
    expect(archivos[0].field_name).toBe('archivo');
    expect(archivos[0].stored_path).toBe(subida.storedPath);

    const pendientes = await puente.db.getPendingRequests({ userId: 'u1' });
    expect(pendientes[0].body_type).toBe('multipart');

    // Replay correcto → se borra la fila Y el binario, o el almacén crecería
    // para siempre con archivos que ya se subieron.
    await puente.db.deleteRequest(id);
    expect(await puente.db.getRequestFiles(id)).toEqual([]);
    expect((await puente.offline.readUpload(subida.storedPath)).success).toBeFalse();
  });

  it('guarda y devuelve respuestas cacheadas, e invalida por prefijo', async () => {
    await puente.db.cacheSave({ url: '/api/hr/candidatos', data: JSON.stringify([{ id: 1 }]) });
    await puente.db.cacheSave({ url: '/api/hr/oficinas', data: JSON.stringify([{ id: 9 }]) });
    await puente.db.cacheSave({ url: '/api/nomina/periodos', data: JSON.stringify([]) });

    expect(await puente.db.cacheGet('/api/hr/candidatos')).toEqual([{ id: 1 }]);
    expect((await puente.db.cacheGetAllUrls()).length).toBe(3);

    await puente.db.cacheInvalidatePrefix('/api/hr');
    expect(await puente.db.cacheGet('/api/hr/candidatos')).toBeNull();
    expect(await puente.db.cacheGet('/api/nomina/periodos')).toEqual([]);
  });

  it('trata una fila de caché corrupta como si no existiera', async () => {
    await puente.db.cacheSave({ url: '/roto', data: '{no es json' });
    expect(await puente.db.cacheGet('/roto')).toBeNull();
  });

  it('el logout borra la caché pero NO la cola de envíos', async () => {
    await puente.db.saveRequestQueue({ method: 'POST', url: '/importante', userId: 'u1' });
    await puente.db.cacheSave({ url: '/algo', data: '[]' });

    await puente.db.clearCache();

    expect(await puente.db.cacheGetAllUrls()).toEqual([]);
    expect((await puente.db.getPendingRequests({ userId: 'u1' })).length)
      .withContext('la cola sobrevive al logout normal').toBe(1);
  });
});
