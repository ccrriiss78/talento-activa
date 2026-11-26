import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { manejarErrores } from '../../src/controller/errores';

function app(err: unknown) {
  const a = new Hono();
  a.onError(manejarErrores);
  a.get('/x/:id', () => {
    throw err;
  });
  const padre = new Hono();
  padre.onError(manejarErrores);
  padre.route('/api', a);
  return padre;
}

describe('manejarErrores', () => {
  it('uuid mal formado de Postgres (22P02) → 404 sin detalles internos', async () => {
    const r = await app(Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: '22P02' })).request('/api/x/abc');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'No encontrado' });
  });
  it('cualquier otro error → 500 genérico, sin filtrar el mensaje', async () => {
    const r = await app(new Error('secreto interno')).request('/api/x/abc');
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secreto');
  });
});
