import { describe, it, expect, vi } from 'vitest';
import { createAudit } from '../../src/model/audit';
import type { Db } from '../../src/model/db';

function fakeDb() {
  const query = vi.fn(async () => []);
  return { db: { query, ping: vi.fn(), close: vi.fn() } as unknown as Db, query };
}

const ID = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';

function insertedParams(query: ReturnType<typeof vi.fn>) {
  const [sql, params] = query.mock.calls[0] as [string, unknown[]];
  return { sql, params };
}

describe('auditoría', () => {
  it('inserta en "Audit_log" con consulta parametrizada', async () => {
    const { db, query } = fakeDb();
    await createAudit(db).record({
      actor: { id: ACTOR, rol: 'ADMIN' },
      tabla: 'Edition',
      idRegistro: ID,
      operacion: 'UPDATE',
      datosAnteriores: { nombre: 'A' },
      datosNuevos: { nombre: 'B' },
    });
    const { sql, params } = insertedParams(query);
    expect(sql).toMatch(/insert into "Audit_log"/i);
    expect(sql).toMatch(/id_usuario, tabla, id_registro, operacion, datos_anteriores, datos_nuevos/);
    expect(params).toEqual([ACTOR, 'Edition', ID, 'UPDATE', '{"nombre":"A"}', '{"nombre":"B"}']);
  });

  it('acepta acciones del sistema (sin actor) y datos nulos', async () => {
    const { db, query } = fakeDb();
    await createAudit(db).record({ actor: null, tabla: 'Session', idRegistro: null, operacion: 'DELETE' });
    expect(insertedParams(query).params).toEqual([null, 'Session', null, 'DELETE', null, null]);
  });

  it('nunca guarda el hash de la contraseña ni tokens (también anidados)', async () => {
    const { db, query } = fakeDb();
    await createAudit(db).record({
      actor: { id: ACTOR, rol: 'ADMIN' },
      tabla: 'User',
      idRegistro: ID,
      operacion: 'INSERT',
      datosNuevos: {
        email: 'a@b.c',
        password_hash: '$argon2id$x',
        token: 'abc',
        token_sha256: 'deadbeef',
        extra: { password: 'plano', password_hash: 'h', ok: 1 },
        lista: [{ token_sha256: 'z', k: 2 }],
      },
      datosAnteriores: { password_hash: 'viejo', email: 'x@y.z' },
    });
    const { params } = insertedParams(query);
    expect(JSON.parse(params[5] as string)).toEqual({
      email: 'a@b.c',
      extra: { ok: 1 },
      lista: [{ k: 2 }],
    });
    expect(JSON.parse(params[4] as string)).toEqual({ email: 'x@y.z' });
    expect(JSON.stringify(params)).not.toMatch(/argon2|deadbeef|plano|viejo/);
  });

  it('rechaza operaciones no válidas', async () => {
    const { db, query } = fakeDb();
    await expect(
      createAudit(db).record({ actor: null, tabla: 'User', idRegistro: null, operacion: 'SELECT' as never }),
    ).rejects.toThrow(/operaci/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('no muta los objetos recibidos', async () => {
    const { db } = fakeDb();
    const nuevos = { password_hash: 'h', a: 1 };
    await createAudit(db).record({ actor: null, tabla: 'User', idRegistro: ID, operacion: 'INSERT', datosNuevos: nuevos });
    expect(nuevos).toEqual({ password_hash: 'h', a: 1 });
  });
});
