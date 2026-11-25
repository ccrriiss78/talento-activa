import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createEmailVerificationModel, TokenVerificacionNoValidoError } from '../../src/model/email-verification';
import type { Db, Queryable } from '../../src/model/db';

const NOW = new Date('2026-01-01T00:00:00Z');
const HORA = 3_600_000;
const TOK = 'A'.repeat(43);
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

function setup(opts: { consumed?: Record<string, unknown>[] } = {}) {
  const query = vi.fn(async (sql: string, _p: unknown[] = []) => {
    if (/update "Email_verification_token"/i.test(sql)) return opts.consumed ?? [];
    return [];
  });
  const tx = { query } as unknown as Queryable;
  const db = { query, transaction: async (fn: (t: Queryable) => Promise<unknown>) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  const model = createEmailVerificationModel(db, { now: () => NOW, audit: { record } });
  return { model, query, record };
}

describe('Email_verification_token: emisión', () => {
  it('issue guarda solo el SHA-256 del token, con caducidad limitada, y devuelve el token en claro', async () => {
    const { model, query } = setup();
    const { token, expiresAt } = await model.issue('u1');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 48 * HORA);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/insert into "Email_verification_token"/i);
    expect(params).toEqual(['u1', sha(token), expiresAt]);
    expect(JSON.stringify(params)).not.toContain(token);
  });

  it('issue no audita el token (ni en claro ni su hash)', async () => {
    const { model, record } = setup();
    const { token } = await model.issue('u1');
    expect(JSON.stringify(record.mock.calls)).not.toContain(token);
    expect(JSON.stringify(record.mock.calls)).not.toContain(sha(token));
  });
});

describe('Email_verification_token: verificación (un solo uso)', () => {
  it('consume el token válido, marca email_verified y audita UPDATE sobre User', async () => {
    const { model, query, record } = setup({ consumed: [{ user_id: 'u1' }] });
    const userId = await model.verify(TOK);
    expect(userId).toBe('u1');
    const consume = query.mock.calls.find(([s]) => /update "Email_verification_token"/i.test(s as string))!;
    expect(consume[0]).toMatch(/used_at is null/i);
    expect(consume[0]).toMatch(/expires_at\s*>/i);
    expect(consume[1]).toEqual([sha(TOK), NOW]);
    expect(query.mock.calls.some(([s]) => /update "User"\s+set email_verified\s*=\s*true/i.test(s as string))).toBe(true);
    const e = (record.mock.calls[0] as unknown as [any])[0];
    expect(e).toMatchObject({ tabla: 'User', idRegistro: 'u1', operacion: 'UPDATE', actor: { id: 'u1' } });
    expect(e.datosNuevos).toEqual({ email_verified: true });
  });

  it('token inexistente, usado o caducado => error y no toca User', async () => {
    const { model, query, record } = setup({ consumed: [] });
    await expect(model.verify(TOK)).rejects.toBeInstanceOf(TokenVerificacionNoValidoError);
    expect(query.mock.calls.some(([s]) => /update "User"/i.test(s as string))).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it('token con formato absurdo => error sin consultar la BD', async () => {
    const { model, query } = setup();
    await expect(model.verify('')).rejects.toBeInstanceOf(TokenVerificacionNoValidoError);
    await expect(model.verify('x'.repeat(500))).rejects.toBeInstanceOf(TokenVerificacionNoValidoError);
    expect(query).not.toHaveBeenCalled();
  });
});
