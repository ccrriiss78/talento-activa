import { describe, it, expect, vi } from 'vitest';
import { createProjectModel, ProyectoNoEncontradoError } from '../../src/model/project';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ALUMNO = { id: 'u1', rol: 'ALUMNO' as const };
const PROY = {
  id: 'p1', student_id: 's1', titulo: 'App', descripcion: null, url: 'https://github.com/a/b',
  thumbnail_url: null, created_at: '2026-01-01',
};

function setup(opts: { student?: unknown[]; proyecto?: unknown[]; despues?: unknown } = {}) {
  const student = opts.student ?? [{ id: 's1' }];
  const proyecto = opts.proyecto ?? [PROY];
  const query = vi.fn(async (sql: string, _p?: unknown[]) => {
    if (/from "Student"/i.test(sql)) return student;
    if (/^\s*select/i.test(sql)) return proyecto;
    if (/^\s*delete/i.test(sql)) return [];
    return [opts.despues ?? PROY];
  });
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  return { model: createProjectModel(db, { record }), query, record, tx };
}

describe('Project.list', () => {
  it('lista los proyectos del alumno autenticado', async () => {
    const { model, query } = setup();
    expect(await model.list(ALUMNO)).toEqual([PROY]);
    expect(query.mock.calls.some((c) => (c[1] as unknown[])?.includes('s1'))).toBe(true);
  });
  it('ADMIN y SOCIO no tienen proyectos propios', async () => {
    const { model, query } = setup();
    for (const rol of ['ADMIN', 'SOCIO'] as const) {
      await expect(model.list({ id: 'x', rol })).rejects.toBeInstanceOf(FichaNoEncontradaError);
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('sin ficha => FichaNoEncontradaError', async () => {
    await expect(setup({ student: [] }).model.list(ALUMNO)).rejects.toBeInstanceOf(FichaNoEncontradaError);
  });
});

describe('Project.create', () => {
  it('inserta con student_id del actor, recorta y audita INSERT', async () => {
    const { model, query, record, tx } = setup();
    const r = await model.create(ALUMNO, { titulo: ' App ', url: ' https://github.com/a/b ', descripcion: 'd', thumbnail_url: 'https://x.test/t.png', student_id: 'otro' } as never);
    expect(r).toEqual(PROY);
    const ins = query.mock.calls.find((c) => /insert into "Project"/i.test(c[0] as string))!;
    expect(ins[1]).toEqual(['s1', 'App', 'd', 'https://github.com/a/b', 'https://x.test/t.png']);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ALUMNO, tabla: 'Project', idRegistro: 'p1', operacion: 'INSERT', datosNuevos: PROY }),
      tx,
    );
  });
  it.each([
    {},
    { titulo: 'x' },
    { url: 'https://a.b' },
    { titulo: ' ', url: 'https://a.b' },
    { titulo: 'x', url: 'javascript:alert(1)' },
    { titulo: 'x', url: 'ftp://a.b' },
    { titulo: 'x', url: 'no es url' },
    { titulo: 'x', url: 'https://a.b', thumbnail_url: 'javascript:1' },
    { titulo: 5, url: 'https://a.b' },
    { titulo: 'x', url: 'https://a.b', descripcion: 4 },
  ])('datos no válidos %j', async (b) => {
    const { model, query } = setup();
    await expect(model.create(ALUMNO, b as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('Project.update', () => {
  it('actualiza solo campos editables de un proyecto propio y audita antes/después', async () => {
    const despues = { ...PROY, titulo: 'Nuevo' };
    const { model, query, record, tx } = setup({ despues });
    const r = await model.update(ALUMNO, 'p1', { titulo: 'Nuevo', student_id: 'x', id: 'y' } as never);
    expect(r).toEqual(despues);
    const upd = query.mock.calls.find((c) => /update "Project"/i.test(c[0] as string))!;
    expect((upd[0] as string).split(/where/i)[0]).not.toMatch(/student_id|created_at/);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'Project', idRegistro: 'p1', operacion: 'UPDATE', datosAnteriores: PROY, datosNuevos: despues }),
      tx,
    );
  });
  it('la consulta filtra por student_id del alumno (no toca proyectos ajenos)', async () => {
    const { model, query } = setup({ proyecto: [] });
    await expect(model.update(ALUMNO, 'p9', { titulo: 'x' })).rejects.toBeInstanceOf(ProyectoNoEncontradoError);
    const sel = query.mock.calls.find((c) => /from "Project"/i.test(c[0] as string))!;
    expect(sel[1]).toEqual(['p9', 's1']);
  });
  it('permite quitar descripción/miniatura con null y rechaza url inválida o vacío', async () => {
    const { model } = setup();
    await expect(model.update(ALUMNO, 'p1', { descripcion: null, thumbnail_url: null })).resolves.toBeDefined();
    await expect(model.update(ALUMNO, 'p1', { url: 'javascript:1' })).rejects.toBeInstanceOf(DatosNoValidosError);
    await expect(model.update(ALUMNO, 'p1', { url: null } as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    await expect(model.update(ALUMNO, 'p1', {})).rejects.toBeInstanceOf(DatosNoValidosError);
  });
});

describe('Project.remove', () => {
  it('borra un proyecto propio y audita DELETE con datos anteriores', async () => {
    const { model, query, record, tx } = setup();
    await model.remove(ALUMNO, 'p1');
    expect(query.mock.calls.some((c) => /delete from "Project"/i.test(c[0] as string))).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'Project', idRegistro: 'p1', operacion: 'DELETE', datosAnteriores: PROY }),
      tx,
    );
  });
  it('proyecto inexistente o ajeno => ProyectoNoEncontradoError sin borrar', async () => {
    const { model, query, record } = setup({ proyecto: [] });
    await expect(model.remove(ALUMNO, 'p9')).rejects.toBeInstanceOf(ProyectoNoEncontradoError);
    expect(query.mock.calls.some((c) => /delete/i.test(c[0] as string))).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
});
