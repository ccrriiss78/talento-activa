import { describe, it, expect, vi } from 'vitest';
import { createSessionModel } from '../../src/model/session';
import type { Db } from '../../src/model/db';

const DAY = 86_400_000;
const NOW = new Date('2026-01-01T00:00:00Z');
const USER_ID = '44444444-4444-4444-4444-444444444444';
const SID = 'sid-1';

function setup(opts: { select?: Record<string, unknown>[]; returning?: Record<string, unknown>[] } = {}) {
  const query = vi.fn(async (sql: string, _p: unknown[] = []) => {
    if (/^\s*select/i.test(sql)) return opts.select ?? [];
    if (/returning/i.test(sql)) return opts.returning ?? [];
    return [];
  });
  const record = vi.fn(async () => {});
  const model = createSessionModel({ query } as unknown as Db, { now: () => NOW, audit: { record } });
  return { model, query, record };
}
const fila = (dias: number, rol: string | null = 'ALUMNO') => ({
  id: SID,
  expires_at: new Date(NOW.getTime() + dias * DAY),
  user_id: rol ? USER_ID : null,
  rol,
});

describe('Session: auditoría de mutaciones', () => {
  it('create audita INSERT con el usuario como actor y sin token ni hash', async () => {
    const { model, record } = setup({ returning: [{ id: SID }] });
    const { token, expiresAt } = await model.create(USER_ID);
    expect(record).toHaveBeenCalledTimes(1);
    const e = (record.mock.calls[0] as unknown as [any])[0];
    expect(e).toMatchObject({ tabla: 'Session', idRegistro: SID, operacion: 'INSERT' });
    expect(e.actor).toEqual({ id: USER_ID });
    expect(e.datosNuevos).toEqual({ user_id: USER_ID, expires_at: expiresAt });
    expect(JSON.stringify(e)).not.toContain(token);
  });

  it('resolve que renueva audita UPDATE', async () => {
    const { model, record } = setup({ select: [fila(10)] });
    const r = await model.resolve('abc');
    expect(r?.renewed).toBe(true);
    const e = (record.mock.calls[0] as unknown as [any])[0];
    expect(e).toMatchObject({ tabla: 'Session', idRegistro: SID, operacion: 'UPDATE', actor: { id: USER_ID, rol: 'ALUMNO' } });
    expect(e.datosNuevos).toEqual({ expires_at: r!.expiresAt });
  });

  it('resolve sin renovar no audita', async () => {
    const { model, record } = setup({ select: [fila(30)] });
    await model.resolve('abc');
    expect(record).not.toHaveBeenCalled();
  });

  it('purga por caducidad audita DELETE con actor null (sistema)', async () => {
    const { model, record } = setup({ select: [fila(-1)] });
    expect(await model.resolve('abc')).toBeNull();
    const e = (record.mock.calls[0] as unknown as [any])[0];
    expect(e).toMatchObject({ tabla: 'Session', idRegistro: SID, operacion: 'DELETE', actor: null });
    expect(e.datosAnteriores).toEqual({ user_id: USER_ID, expires_at: expect.any(Date) });
  });

  it('purga por usuario inexistente audita DELETE con actor null', async () => {
    const { model, record } = setup({ select: [fila(30, null)] });
    await model.resolve('abc');
    expect((record.mock.calls[0] as unknown as [any])[0]).toMatchObject({ operacion: 'DELETE', actor: null });
  });

  it('destroy audita DELETE de la sesión borrada; si no existía no audita', async () => {
    const a = setup({ returning: [{ id: SID, user_id: USER_ID, expires_at: NOW }] });
    await a.model.destroy('abc');
    const e = (a.record.mock.calls[0] as unknown as [any])[0];
    expect(e).toMatchObject({ tabla: 'Session', idRegistro: SID, operacion: 'DELETE', actor: { id: USER_ID } });
    expect(e.datosAnteriores).toEqual({ user_id: USER_ID, expires_at: NOW });
    const b = setup({ returning: [] });
    await b.model.destroy('abc');
    expect(b.record).not.toHaveBeenCalled();
  });
});
