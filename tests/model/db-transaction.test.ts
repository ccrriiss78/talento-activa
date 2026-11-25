import { describe, it, expect, vi } from 'vitest';
import { createDb, type PoolLike } from '../../src/model/db';
import { createAudit } from '../../src/model/audit';

function setup() {
  const clientQuery = vi.fn(async (_t: string, _p?: unknown[]) => ({ rows: [{ n: 1 }], rowCount: 1 }));
  const release = vi.fn();
  const pool = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    end: vi.fn(async () => undefined),
    connect: vi.fn(async () => ({ query: clientQuery, release })),
  } as unknown as PoolLike;
  const db = createDb({ env: { DATABASE_URL: 'u' }, poolFactory: () => pool });
  return { db, clientQuery, release, pool };
}

describe('Db.transaction', () => {
  it('hace BEGIN, COMMIT y libera el cliente; las consultas usan el mismo cliente', async () => {
    const { db, clientQuery, release, pool } = setup();
    const r = await db.transaction(async (tx) => tx.query('select 1', []));
    expect(r).toEqual([{ n: 1 }]);
    expect(clientQuery.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'select 1', 'COMMIT']);
    expect(release).toHaveBeenCalledOnce();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('si fn falla hace ROLLBACK, relanza el error y libera el cliente', async () => {
    const { db, clientQuery, release } = setup();
    await expect(db.transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(clientQuery.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('la auditoría puede escribir dentro de la transacción', async () => {
    const { db, clientQuery } = setup();
    const audit = createAudit(db);
    await db.transaction(async (tx) => {
      await audit.record({ actor: null, tabla: 'User', idRegistro: 'x', operacion: 'INSERT' }, tx);
    });
    expect(clientQuery.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0])).toEqual(['BEGIN', 'insert', 'COMMIT']);
  });
});
