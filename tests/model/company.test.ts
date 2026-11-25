import { describe, it, expect, vi } from 'vitest';
import { createCompanyModel, EmpresaNoEncontradaError } from '../../src/model/company';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ADMIN = { id: 'a1', rol: 'ADMIN' as const };
const USER = { id: 'u1', email: 'e@x.es', rol: 'SOCIO', email_verified: false, created_at: new Date() };
const COMPANY = { id: 'c1', nombre: 'Acme', es_socia: true, contacto: 'rrhh@acme.es', created_by: 'a1' };
const INPUT = { email: 'e@x.es', password: 'una-clave-larga-123', nombre: ' Acme ', es_socia: true, contacto: 'rrhh@acme.es' };

function setup(rows: unknown[] = [COMPANY]) {
  const query = vi.fn(async (..._a: unknown[]) => rows);
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  const createUser = vi.fn(async () => USER as never);
  return { model: createCompanyModel(db, { record }, { createUser }), query, record, createUser, tx };
}

describe('modelo Company.create (alta de empresa por invitación)', () => {
  it('crea usuario SOCIO, Company y su relación en una transacción, y audita', async () => {
    const { model, query, record, createUser, tx } = setup();
    const c = await model.create(ADMIN, INPUT);
    expect(createUser).toHaveBeenCalledWith(
      ADMIN,
      { email: 'e@x.es', password: 'una-clave-larga-123', rol: 'SOCIO' },
      tx,
    );
    const insert = query.mock.calls.find((c) => /insert into "Company"/i.test(c[0] as string))!;
    expect(insert[1]).toEqual(['Acme', true, 'rrhh@acme.es', 'a1']);
    const rel = query.mock.calls.find((c) => /insert into "Company_user_rel"/i.test(c[0] as string))!;
    expect(rel[1]).toEqual(['c1', 'u1']);
    expect(c).toEqual(COMPANY);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ADMIN, tabla: 'Company', idRegistro: 'c1', operacion: 'INSERT' }),
      tx,
    );
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/una-clave|password/i);
  });

  it('es_socia por defecto false y contacto null', async () => {
    const { model, query } = setup();
    await model.create(ADMIN, { email: 'e@x.es', password: 'una-clave-larga-123', nombre: 'Acme' });
    const insert = query.mock.calls.find((c) => /insert into "Company"/i.test(c[0] as string))!;
    expect(insert[1]).toEqual(['Acme', false, null, 'a1']);
  });

  it.each([
    { ...INPUT, nombre: ' ' },
    { ...INPUT, nombre: undefined },
    { ...INPUT, es_socia: 'si' },
    { ...INPUT, contacto: 5 },
  ])('rechaza datos no válidos %j sin tocar la BD', async (input) => {
    const { model, query, createUser } = setup();
    await expect(model.create(ADMIN, input as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe('modelo Company.setSocia', () => {
  it('actualiza es_socia y audita con datos anteriores y nuevos', async () => {
    const { model, query, record } = setup([{ ...COMPANY, es_socia: false }]);
    query.mockResolvedValueOnce([{ ...COMPANY, es_socia: false }]).mockResolvedValueOnce([COMPANY]);
    const c = await model.setSocia(ADMIN, 'c1', true);
    expect(c.es_socia).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'Company',
        idRegistro: 'c1',
        operacion: 'UPDATE',
        datosAnteriores: expect.objectContaining({ es_socia: false }),
        datosNuevos: expect.objectContaining({ es_socia: true }),
      }),
      expect.anything(),
    );
  });

  it('empresa inexistente => EmpresaNoEncontradaError sin auditar', async () => {
    const { model, record } = setup([]);
    await expect(model.setSocia(ADMIN, 'nope', true)).rejects.toBeInstanceOf(EmpresaNoEncontradaError);
    expect(record).not.toHaveBeenCalled();
  });

  it('es_socia no booleano => datos no válidos', async () => {
    const { model, query } = setup();
    await expect(model.setSocia(ADMIN, 'c1', 'x' as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
  });
});
