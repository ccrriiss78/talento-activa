import { describe, it, expect, vi } from 'vitest';
import { createStudentProfileModel, FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ALUMNO = { id: 'u1', rol: 'ALUMNO' as const };
const FICHA = {
  id: 's1', user_id: 'u1', edition_id: 'e1', nombre: 'Ana', foto_url: null, bio: null, ubicacion: null,
  disponibilidad_traslado: false, modalidad: null, estado_laboral: null, cv_url: null, linkedin: null,
  github: null, estado: 'inactivo', privacy: {}, filled_at: null,
};

function setup(antes: unknown[] = [FICHA], despues: unknown = { ...FICHA, bio: 'Hola' }) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => (/^\s*select/i.test(sql) ? antes : [despues]));
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  return { model: createStudentProfileModel(db, { record }), query, record, tx };
}

describe('modelo StudentProfile.getOwn', () => {
  it('devuelve la ficha del alumno autenticado (por user_id)', async () => {
    const { model, query } = setup();
    expect(await model.getOwn(ALUMNO)).toEqual(FICHA);
    expect(query.mock.calls[0]![1]).toEqual(['u1']);
  });
  it('lanza FichaNoEncontradaError si no hay ficha', async () => {
    await expect(setup([]).model.getOwn(ALUMNO)).rejects.toBeInstanceOf(FichaNoEncontradaError);
  });
  it('un rol distinto de ALUMNO no tiene ficha propia', async () => {
    const { model, query } = setup();
    await expect(model.getOwn({ id: 'a', rol: 'ADMIN' })).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('modelo StudentProfile.updateOwn', () => {
  it('actualiza solo los campos editables dados, marca filled_at y audita antes/después', async () => {
    const { model, query, record, tx } = setup();
    const r = await model.updateOwn(ALUMNO, { bio: ' Hola ', estado: 'activo', user_id: 'x', edition_id: 'z' } as never);
    expect(r).toEqual({ ...FICHA, bio: 'Hola' });
    const upd = query.mock.calls.find((c) => /update "Student"/i.test(c[0] as string))!;
    const sql = upd[0] as string;
    expect(sql).toMatch(/bio = /);
    expect(sql.split(/returning/i)[0]).not.toMatch(/estado|user_id|edition_id/);
    expect(sql).toMatch(/filled_at = coalesce\(filled_at, now\(\)\)/i);
    expect(upd[1]).toContain('Hola');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ALUMNO, tabla: 'Student', idRegistro: 's1', operacion: 'UPDATE', datosAnteriores: FICHA }),
      tx,
    );
  });

  it('acepta privacy por campo (booleanos sobre campos de la ficha)', async () => {
    const { model, query } = setup();
    await model.updateOwn(ALUMNO, { privacy: { linkedin: false, cv_url: true } });
    const upd = query.mock.calls.find((c) => /update "Student"/i.test(c[0] as string))!;
    expect(upd[1]).toContainEqual(JSON.stringify({ linkedin: false, cv_url: true }));
  });

  it.each([
    {},
    { bio: 5 },
    { nombre: '  ' },
    { modalidad: 'volando' },
    { estado_laboral: 'jubilado' },
    { disponibilidad_traslado: 'si' },
    { linkedin: 'javascript:alert(1)' },
    { github: 'ftp://x' },
    { privacy: [] },
    { privacy: { linkedin: 'no' } },
    { privacy: { campo_inventado: true } },
    { privacy: { nombre: false } },
  ])('rechaza datos no válidos %j sin tocar la BD', async (input) => {
    const { model, query } = setup();
    await expect(model.updateOwn(ALUMNO, input as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
  });

  it('permite vaciar campos opcionales con null', async () => {
    const { model, query } = setup();
    await model.updateOwn(ALUMNO, { bio: null, modalidad: null });
    const upd = query.mock.calls.find((c) => /update "Student"/i.test(c[0] as string))!;
    expect(upd[1]).toEqual(expect.arrayContaining([null]));
  });

  it('lanza FichaNoEncontradaError si no existe y no actualiza', async () => {
    const { model, query } = setup([]);
    await expect(model.updateOwn(ALUMNO, { bio: 'x' })).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(query.mock.calls.some((c) => /update/i.test(c[0] as string))).toBe(false);
  });
});
