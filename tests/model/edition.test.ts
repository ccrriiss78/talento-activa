import { describe, it, expect, vi } from 'vitest';
import { createEditionModel, EdicionNoEncontradaError, EdicionCerradaError } from '../../src/model/edition';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ADMIN = { id: '22222222-2222-2222-2222-222222222222', rol: 'ADMIN' as const };
const ED = { id: 'e1', nombre: 'Edición 1', anio: 2026, fecha_inicio: null, fecha_fin: null, estado: 'abierta' };

function setup(impl?: (sql: string, params: unknown[]) => unknown[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => (impl ? impl(sql, params) : [ED]));
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  return { model: createEditionModel(db, { record }), query, record, tx };
}

describe('modelo Edition', () => {
  it('create inserta con estado abierta, audita INSERT en la misma transacción', async () => {
    const { model, query, record, tx } = setup();
    const e = await model.create(ADMIN, { nombre: ' Edición 1 ', anio: 2026 });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/insert into "Edition"/i);
    expect(params[0]).toBe('Edición 1');
    expect(params[1]).toBe(2026);
    expect(e).toEqual(ED);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ADMIN, tabla: 'Edition', idRegistro: 'e1', operacion: 'INSERT' }),
      tx,
    );
  });

  it.each([
    { nombre: '', anio: 2026 },
    { nombre: 'x', anio: 1999.5 },
    { nombre: 'x', anio: 1800 },
    { nombre: 'x', anio: 2026, fecha_inicio: 'no', },
    { nombre: 'x', anio: 2026, fecha_inicio: '2026-05-01', fecha_fin: '2026-01-01' },
  ])('create rechaza datos no válidos %j sin tocar la BD', async (input) => {
    const { model, query } = setup();
    await expect(model.create(ADMIN, input as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
  });

  it('list y get leen sin auditar', async () => {
    const { model, record } = setup();
    expect(await model.list()).toEqual([ED]);
    expect(await model.get('e1')).toEqual(ED);
    expect(record).not.toHaveBeenCalled();
  });

  it('get devuelve null si no existe', async () => {
    const { model } = setup(() => []);
    expect(await model.get('nope')).toBeNull();
  });

  it('update modifica solo campos permitidos y audita anterior/nuevo', async () => {
    const nuevo = { ...ED, nombre: 'Nueva' };
    const { model, query, record } = setup((sql) => (/^\s*select/i.test(sql) ? [ED] : [nuevo]));
    const e = await model.update(ADMIN, 'e1', { nombre: 'Nueva' });
    expect(e.nombre).toBe('Nueva');
    expect(query.mock.calls.some(([s]) => /update "Edition"/i.test(s as string))).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ operacion: 'UPDATE', tabla: 'Edition', idRegistro: 'e1', datosAnteriores: ED, datosNuevos: nuevo }),
      expect.anything(),
    );
  });

  it('update sin campos válidos => DatosNoValidosError', async () => {
    const { model } = setup();
    await expect(model.update(ADMIN, 'e1', {} as never)).rejects.toBeInstanceOf(DatosNoValidosError);
  });

  it('update de edición inexistente => EdicionNoEncontradaError', async () => {
    const { model } = setup(() => []);
    await expect(model.update(ADMIN, 'x', { nombre: 'a' })).rejects.toBeInstanceOf(EdicionNoEncontradaError);
  });

  it('update de edición cerrada => EdicionCerradaError', async () => {
    const { model } = setup(() => [{ ...ED, estado: 'cerrada' }]);
    await expect(model.update(ADMIN, 'e1', { nombre: 'a' })).rejects.toBeInstanceOf(EdicionCerradaError);
  });

  it('close pasa a cerrada y audita UPDATE', async () => {
    const cerrada = { ...ED, estado: 'cerrada' };
    const { model, record } = setup((sql) => (/^\s*select/i.test(sql) ? [ED] : [cerrada]));
    const e = await model.close(ADMIN, 'e1');
    expect(e.estado).toBe('cerrada');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ operacion: 'UPDATE', datosAnteriores: { estado: 'abierta' }, datosNuevos: { estado: 'cerrada' } }),
      expect.anything(),
    );
  });

  it('close es idempotente: si ya está cerrada no muta ni audita', async () => {
    const { model, record, query } = setup(() => [{ ...ED, estado: 'cerrada' }]);
    const e = await model.close(ADMIN, 'e1');
    expect(e.estado).toBe('cerrada');
    expect(record).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([s]) => /update/i.test(s as string))).toBe(false);
  });

  it('close de inexistente => EdicionNoEncontradaError', async () => {
    const { model } = setup(() => []);
    await expect(model.close(ADMIN, 'x')).rejects.toBeInstanceOf(EdicionNoEncontradaError);
  });
});
