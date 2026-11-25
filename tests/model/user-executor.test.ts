import { describe, it, expect, vi } from 'vitest';
import { createUserModel } from '../../src/model/user';
import type { Db } from '../../src/model/db';

const ADMIN = { id: 'a1', rol: 'ADMIN' as const };
const U = { id: 'u1', email: 'a@b.es', rol: 'ALUMNO', email_verified: false, created_at: new Date() };

describe('createUser con ejecutor externo (transacción del llamador)', () => {
  it('usa el ejecutor dado, no abre transacción propia y audita con ese ejecutor', async () => {
    const dbQuery = vi.fn();
    const transaction = vi.fn();
    const db = { query: dbQuery, transaction } as unknown as Db;
    const txQuery = vi.fn(async () => [U]);
    const tx = { query: txQuery } as never;
    const record = vi.fn(async () => {});
    const model = createUserModel(db, { record });
    const u = await model.createUser(ADMIN, { email: 'a@b.es', password: 'una-clave-larga-123', rol: 'ALUMNO' }, tx);
    expect(u).toEqual(U);
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect(dbQuery).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ tabla: 'User', operacion: 'INSERT' }), tx);
  });
});
