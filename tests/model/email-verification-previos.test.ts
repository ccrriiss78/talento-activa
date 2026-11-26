import { describe, it, expect, vi } from 'vitest';
import { createEmailVerificationModel } from '../../src/model/email-verification';
import type { Db, Queryable } from '../../src/model/db';

const NOW = new Date('2026-01-01T00:00:00Z');

function setup() {
  const query = vi.fn(async (sql: string, _p: unknown[] = []) => {
    if (/^\s*insert into "Email_verification_token"/i.test(sql)) return [{ id: 'nuevo' }];
    if (/^\s*update "Email_verification_token"/i.test(sql)) return [{ id: 'viejo-1' }, { id: 'viejo-2' }];
    return [];
  });
  const tx = { query } as unknown as Queryable;
  const db = { query, transaction: async (fn: (t: Queryable) => Promise<unknown>) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  const model = createEmailVerificationModel(db, { now: () => NOW, audit: { record } });
  return { model, query, record };
}

describe('Email_verification_token: emitir invalida los tokens previos sin usar', () => {
  it('marca como usados los tokens anteriores del usuario sin usar, excepto el nuevo', async () => {
    const { model, query } = setup();
    await model.issue('u1');
    const upd = query.mock.calls.find(([s]) => /^\s*update "Email_verification_token"/i.test(s as string))!;
    expect(upd[0]).toMatch(/used_at is null/i);
    expect(upd[0]).toMatch(/user_id = \$1/i);
    expect(upd[0]).toMatch(/id <> \$3/i);
    expect(upd[1]).toEqual(['u1', NOW, 'nuevo']);
  });

  it('audita un UPDATE por cada token invalidado, sin token ni hash', async () => {
    const { model, record } = setup();
    const { token } = await model.issue('u1');
    const updates = (record.mock.calls as unknown as [any][]).map(([e]) => e).filter((e) => e.operacion === 'UPDATE');
    expect(updates.map((e) => e.idRegistro)).toEqual(['viejo-1', 'viejo-2']);
    expect(updates[0]).toMatchObject({ tabla: 'Email_verification_token', datosAnteriores: { user_id: 'u1', used_at: null } });
    expect(JSON.stringify(record.mock.calls)).not.toContain(token);
    expect(JSON.stringify(record.mock.calls)).not.toContain('token_sha256');
  });
});
