import { describe, it, expect, vi } from 'vitest';
import { createUserModel } from '../../src/model/user';
import type { Db } from '../../src/model/db';

const ADMIN = { id: '22222222-2222-2222-2222-222222222222', rol: 'ADMIN' as const };

describe('alta de usuario: mutación y auditoría atómicas', () => {
  it('inserta y audita con el mismo ejecutor transaccional', async () => {
    const txQuery = vi.fn(async () => [{ id: 'u1', email: 'a@b.co', rol: 'ALUMNO', email_verified: false, created_at: new Date(0) }]);
    const tx = { query: txQuery };
    const poolQuery = vi.fn();
    const db = { query: poolQuery, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
    const record = vi.fn(async () => {});
    await createUserModel(db, { record }).createUser(ADMIN, { email: 'a@b.co', password: 'una-contraseña-segura-123', rol: 'ALUMNO' });
    expect(txQuery).toHaveBeenCalledOnce();
    expect(poolQuery).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ tabla: 'User' }), tx);
  });

  it('si la auditoría falla, el error se propaga (la transacción hace rollback)', async () => {
    const tx = { query: vi.fn(async () => [{ id: 'u1', email: 'a@b.co', rol: 'ALUMNO', email_verified: false, created_at: new Date(0) }]) };
    const db = { query: vi.fn(), transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
    const record = vi.fn(async () => { throw new Error('audit down'); });
    await expect(
      createUserModel(db, { record }).createUser(ADMIN, { email: 'a@b.co', password: 'una-contraseña-segura-123', rol: 'ALUMNO' }),
    ).rejects.toThrow('audit down');
  });
});
