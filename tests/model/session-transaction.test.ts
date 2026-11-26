import { describe, it, expect, vi } from 'vitest';
import { createSessionModel } from '../../src/model/session';
import type { Db, Queryable } from '../../src/model/db';

const DAY = 86_400_000;
const NOW = new Date('2026-01-01T00:00:00Z');
const USER_ID = '44444444-4444-4444-4444-444444444444';
const SID = '55555555-5555-5555-5555-555555555555';

function setup(select: Record<string, unknown>[] = []) {
  const tx: Queryable = {
    query: vi.fn(async (sql: string) => {
      if (/returning/i.test(sql)) return [{ id: SID, user_id: USER_ID, expires_at: NOW }];
      return [];
    }) as unknown as Queryable['query'],
  };
  const directo = vi.fn(async (sql: string) => (/^\s*select/i.test(sql) ? select : []));
  let abierta = 0;
  const transaction = vi.fn(async (fn: (t: Queryable) => Promise<unknown>) => {
    abierta++;
    try {
      return await fn(tx);
    } finally {
      abierta--;
    }
  });
  const db = { query: directo, transaction } as unknown as Db;
  const record = vi.fn(async (_e: unknown, _x?: Queryable) => {});
  const model = createSessionModel(db, { now: () => NOW, audit: { record } });
  return { model, tx, directo, transaction, record };
}

describe('Session: mutación y auditoría en la misma transacción', () => {
  it('create inserta y audita con el ejecutor de la transacción', async () => {
    const { model, tx, directo, transaction, record } = setup();
    await model.create(USER_ID);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(directo).not.toHaveBeenCalled();
    expect(record.mock.calls[0]![1]).toBe(tx);
  });

  it('resolve que renueva actualiza y audita en la transacción', async () => {
    const fila = { id: SID, expires_at: new Date(NOW.getTime() + 10 * DAY), user_id: USER_ID, rol: 'ALUMNO' };
    const { model, tx, transaction, record } = setup([fila]);
    await model.resolve('tok');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![1]).toBe(tx);
  });

  it('resolve que purga una sesión caducada borra y audita en la transacción', async () => {
    const fila = { id: SID, expires_at: new Date(NOW.getTime() - DAY), user_id: USER_ID, rol: 'ALUMNO' };
    const { model, tx, transaction, record } = setup([fila]);
    expect(await model.resolve('tok')).toBeNull();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![1]).toBe(tx);
  });

  it('destroy borra y audita en la transacción', async () => {
    const { model, tx, transaction, record } = setup();
    await model.destroy('tok');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![1]).toBe(tx);
  });

  it('si la auditoría falla, la transacción falla (se revierte la mutación)', async () => {
    const { model, record } = setup();
    record.mockRejectedValueOnce(new Error('audit down'));
    await expect(model.create(USER_ID)).rejects.toThrow('audit down');
  });
});
