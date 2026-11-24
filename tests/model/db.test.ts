import { describe, it, expect, vi } from 'vitest';
import { createDb, type PoolLike } from '../../src/model/db';

function fakePool(rows: unknown[] = []): PoolLike & { query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })),
    end: vi.fn(async () => undefined),
  } as never;
}

describe('cliente de datos', () => {
  it('falla si no hay DATABASE_URL', () => {
    expect(() => createDb({ env: {} })).toThrow(/DATABASE_URL/);
  });

  it('crea el pool con la DATABASE_URL del entorno', () => {
    const factory = vi.fn(() => fakePool());
    createDb({ env: { DATABASE_URL: 'postgres://x/y' }, poolFactory: factory });
    expect(factory).toHaveBeenCalledWith('postgres://x/y');
  });

  it('query devuelve las filas y pasa los parámetros (consultas parametrizadas)', async () => {
    const pool = fakePool([{ n: 1 }]);
    const db = createDb({ env: { DATABASE_URL: 'u' }, poolFactory: () => pool });
    const rows = await db.query('select $1::int as n', [1]);
    expect(rows).toEqual([{ n: 1 }]);
    expect(pool.query).toHaveBeenCalledWith('select $1::int as n', [1]);
  });

  it('close cierra el pool', async () => {
    const pool = fakePool();
    const db = createDb({ env: { DATABASE_URL: 'u' }, poolFactory: () => pool });
    await db.close();
    expect(pool.end).toHaveBeenCalled();
  });

  it('ping ejecuta una consulta básica', async () => {
    const pool = fakePool([{ ok: 1 }]);
    const db = createDb({ env: { DATABASE_URL: 'u' }, poolFactory: () => pool });
    await expect(db.ping()).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith('select 1 as ok', []);
  });
});
