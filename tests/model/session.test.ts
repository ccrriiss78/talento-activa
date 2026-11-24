import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createSessionModel, SESSION_DAYS, RENEW_THRESHOLD_DAYS } from '../../src/model/session';
import type { Db } from '../../src/model/db';

const DAY = 86_400_000;
const NOW = new Date('2026-01-01T00:00:00Z');
const USER_ID = '44444444-4444-4444-4444-444444444444';

type Row = Record<string, unknown>;
function setup(selectRows: Row[] = []) {
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => (/^\s*select/i.test(sql) ? selectRows : []));
  const db = { query, ping: vi.fn(), close: vi.fn() } as unknown as Db;
  const model = createSessionModel(db, { now: () => NOW });
  return { model, query };
}
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('modelo Session: creación', () => {
  it('genera token opaco de 32 bytes base64url y guarda solo su SHA-256', async () => {
    const { model, query } = setup();
    const { token, expiresAt } = await model.create(USER_ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/insert into "Session"/i);
    expect(params).toContain(sha(token));
    expect(params).not.toContain(token);
    expect(params).toContain(USER_ID);
    expect(expiresAt).toEqual(new Date(NOW.getTime() + SESSION_DAYS * DAY));
    expect(params).toContainEqual(expiresAt);
  });

  it('dos sesiones tienen tokens distintos', async () => {
    const { model } = setup();
    expect((await model.create(USER_ID)).token).not.toBe((await model.create(USER_ID)).token);
  });
});

describe('modelo Session: resolver', () => {
  const token = 'abc';
  const fila = (diasRestantes: number, rol: string | null = 'ALUMNO') => ({
    id: 's1',
    expires_at: new Date(NOW.getTime() + diasRestantes * DAY),
    user_id: rol ? USER_ID : null,
    rol,
  });

  it('busca por SHA-256 del token, nunca por el token en claro', async () => {
    const { model, query } = setup([fila(30)]);
    await model.resolve(token);
    expect((query.mock.calls[0] as [string, unknown[]])[1]).toEqual([sha(token)]);
  });

  it('token inexistente => null', async () => {
    const { model } = setup([]);
    expect(await model.resolve(token)).toBeNull();
  });

  it('sesión válida => Actor {id, rol} sin renovar', async () => {
    const { model, query } = setup([fila(20)]);
    const r = await model.resolve(token);
    expect(r).toEqual({ actor: { id: USER_ID, rol: 'ALUMNO' }, renewed: false, expiresAt: new Date(NOW.getTime() + 20 * DAY) });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('caducada => null y borra la fila', async () => {
    const { model, query } = setup([fila(-1)]);
    expect(await model.resolve(token)).toBeNull();
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/delete from "Session"/i);
    expect(params).toEqual(['s1']);
  });

  it('usuario inexistente => null y borra la fila', async () => {
    const { model, query } = setup([fila(30, null)]);
    expect(await model.resolve(token)).toBeNull();
    expect((query.mock.calls[1] as [string])[0]).toMatch(/delete from "Session"/i);
  });

  it('quedan <15 días => extiende a 30 y marca renewed', async () => {
    const { model, query } = setup([fila(RENEW_THRESHOLD_DAYS - 1, 'ADMIN')]);
    const r = await model.resolve(token);
    const nuevo = new Date(NOW.getTime() + SESSION_DAYS * DAY);
    expect(r).toEqual({ actor: { id: USER_ID, rol: 'ADMIN' }, renewed: true, expiresAt: nuevo });
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/update "Session" set expires_at/i);
    expect(params).toEqual([nuevo, 's1']);
  });

  it('quedan exactamente 15 días => no renueva', async () => {
    const { model } = setup([fila(15)]);
    expect((await model.resolve(token))?.renewed).toBe(false);
  });
});
