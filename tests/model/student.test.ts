import { describe, it, expect, vi } from 'vitest';
import { createStudentModel } from '../../src/model/student';
import { EdicionNoEncontradaError } from '../../src/model/edition';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ADMIN = { id: 'a1', rol: 'ADMIN' as const };
const USER = { id: 'u1', email: 'al@x.es', rol: 'ALUMNO', email_verified: false, created_at: new Date() };
const STUDENT = { id: 's1', user_id: 'u1', edition_id: 'e1', nombre: 'Ana Pérez', estado: 'inactivo' };
const INPUT = { email: 'al@x.es', password: 'una-clave-larga-123', edition_id: 'e1', nombre: ' Ana Pérez ' };

function setup(edicion: unknown[] = [{ id: 'e1' }]) {
  const query = vi.fn(async (sql: string) => (/from "Edition"/i.test(sql) ? edicion : [STUDENT]));
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  const createUser = vi.fn(async () => USER as never);
  return { model: createStudentModel(db, { record }, { createUser }), query, record, createUser, tx };
}

describe('modelo Student.create (alta de alumno finalizado)', () => {
  it('crea el usuario ALUMNO y el Student en la misma transacción, inactivo, y audita', async () => {
    const { model, query, record, createUser, tx } = setup();
    const s = await model.create(ADMIN, INPUT);
    expect(createUser).toHaveBeenCalledWith(
      ADMIN,
      { email: 'al@x.es', password: 'una-clave-larga-123', rol: 'ALUMNO' },
      tx,
    );
    const insert = query.mock.calls.find((c) => /insert into "Student"/i.test(c[0] as string))!;
    expect(insert).toBeDefined();
    expect((insert[0] as string).split(/values/i)[0]).not.toMatch(/estado/i); // el defecto de BD es 'inactivo'
    expect(s).toEqual(STUDENT);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ADMIN, tabla: 'Student', idRegistro: 's1', operacion: 'INSERT' }),
      tx,
    );
  });

  it('el alta no audita contraseña ni hash', async () => {
    const { model, record } = setup();
    await model.create(ADMIN, INPUT);
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/una-clave|password/i);
  });

  it('rechaza si la edición no existe, sin crear usuario', async () => {
    const { model, createUser } = setup([]);
    await expect(model.create(ADMIN, INPUT)).rejects.toBeInstanceOf(EdicionNoEncontradaError);
    expect(createUser).not.toHaveBeenCalled();
  });

  it.each([
    { ...INPUT, nombre: '  ' },
    { ...INPUT, nombre: undefined },
    { ...INPUT, edition_id: '' },
    { ...INPUT, edition_id: undefined },
  ])('rechaza datos no válidos %j sin tocar la BD', async (input) => {
    const { model, query, createUser } = setup();
    await expect(model.create(ADMIN, input as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });
});
