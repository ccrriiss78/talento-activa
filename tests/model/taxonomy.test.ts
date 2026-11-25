import { describe, it, expect, vi } from 'vitest';
import { createTaxonomyModel, ElementoNoEncontradoError } from '../../src/model/taxonomy';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ALUMNO = { id: 'u1', rol: 'ALUMNO' as const };
const ADMIN = { id: 'a1', rol: 'ADMIN' as const };
const ITEM = { id: 'k1', nombre: 'TypeScript' };
const REL = { id: 'k1', nombre: 'TypeScript', nivel: 'medio' };

function setup(opts: { student?: unknown[]; item?: unknown[]; rel?: unknown[]; upsert?: unknown[]; insertCatalog?: unknown[] } = {}) {
  const student = opts.student ?? [{ id: 's1' }];
  const item = opts.item ?? [ITEM];
  const rel = opts.rel ?? [];
  const query = vi.fn(async (sql: string, _p?: unknown[]) => {
    if (/from "Student"/i.test(sql)) return student;
    if (/insert into "Skill_student_rel"|insert into "Language_student_rel"/i.test(sql)) return opts.upsert ?? [{ nivel: 'medio' }];
    if (/insert into "Skill"|insert into "Language"/i.test(sql)) return opts.insertCatalog ?? [ITEM];
    if (/_student_rel/i.test(sql) && /^\s*delete/i.test(sql)) return rel;
    if (/_student_rel/i.test(sql)) return rel;
    if (/^\s*select/i.test(sql)) return item;
    return [];
  });
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  return {
    skills: createTaxonomyModel(db, { record }, 'skill'),
    langs: createTaxonomyModel(db, { record }, 'language'),
    query, record, tx,
  };
}

describe('Taxonomy.catalog', () => {
  it('lista el catálogo ordenado por nombre (skills e idiomas en su tabla)', async () => {
    const { skills, langs, query } = setup();
    expect(await skills.catalog()).toEqual([ITEM]);
    expect(await langs.catalog()).toEqual([ITEM]);
    expect(query.mock.calls[0]![0]).toMatch(/from "Skill"/);
    expect(query.mock.calls[1]![0]).toMatch(/from "Language"/);
  });
});

describe('Taxonomy.addToCatalog', () => {
  it('inserta recortando el nombre y audita INSERT', async () => {
    const { skills, query, record, tx } = setup();
    expect(await skills.addToCatalog(ADMIN, '  Rust ')).toEqual(ITEM);
    const ins = query.mock.calls.find((c) => /insert into "Skill"/i.test(c[0] as string))!;
    expect(ins[1]).toEqual(['Rust']);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ADMIN, tabla: 'Skill', idRegistro: 'k1', operacion: 'INSERT', datosNuevos: ITEM }),
      tx,
    );
  });
  it('si ya existe devuelve el existente sin auditar', async () => {
    const { skills, record } = setup({ insertCatalog: [] });
    expect(await skills.addToCatalog(ADMIN, 'TypeScript')).toEqual(ITEM);
    expect(record).not.toHaveBeenCalled();
  });
  it.each(['', '   ', 5, null, undefined])('nombre no válido %j', async (n) => {
    const { langs, query } = setup();
    await expect(langs.addToCatalog(ADMIN, n as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('Taxonomy.listOwn', () => {
  it('lista los del alumno autenticado con su nivel', async () => {
    const { skills, query } = setup({ rel: [REL] });
    expect(await skills.listOwn(ALUMNO)).toEqual([REL]);
    expect(query.mock.calls.some((c) => (c[1] as unknown[])?.includes('s1'))).toBe(true);
  });
  it('ADMIN/SOCIO o sin ficha => FichaNoEncontradaError', async () => {
    const { skills, query } = setup();
    await expect(skills.listOwn({ id: 'x', rol: 'SOCIO' })).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(query).not.toHaveBeenCalled();
    await expect(setup({ student: [] }).skills.listOwn(ALUMNO)).rejects.toBeInstanceOf(FichaNoEncontradaError);
  });
});

describe('Taxonomy.set', () => {
  it('asocia con upsert, student_id del actor, y audita INSERT cuando es nuevo', async () => {
    const { skills, query, record, tx } = setup();
    const r = await skills.set(ALUMNO, 'k1', 'medio');
    expect(r).toEqual(REL);
    const up = query.mock.calls.find((c) => /insert into "Skill_student_rel"/i.test(c[0] as string))!;
    expect(up[0]).toMatch(/on conflict \(skill_id, student_id\) do update/i);
    expect(up[1]).toEqual(['k1', 's1', 'medio']);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ALUMNO, tabla: 'Skill_student_rel', operacion: 'INSERT', datosNuevos: expect.objectContaining({ nivel: 'medio' }) }),
      tx,
    );
  });
  it('si ya estaba asociada audita UPDATE con el nivel anterior', async () => {
    const { skills, record } = setup({ rel: [{ nivel: 'basico' }] });
    await skills.set(ALUMNO, 'k1', 'medio');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operacion: 'UPDATE',
        datosAnteriores: expect.objectContaining({ nivel: 'basico' }),
        datosNuevos: expect.objectContaining({ nivel: 'medio' }),
      }),
      expect.anything(),
    );
  });
  it('idiomas usan Language_student_rel y niveles CEFR/nativo; nivel opcional (null)', async () => {
    const { langs, query } = setup({ upsert: [{ nivel: 'B2' }] });
    await langs.set(ALUMNO, 'k1', 'B2');
    await langs.set(ALUMNO, 'k1', null);
    const ups = query.mock.calls.filter((c) => /insert into "Language_student_rel"/i.test(c[0] as string));
    expect(ups).toHaveLength(2);
    expect(ups[0]![0]).toMatch(/on conflict \(language_id, student_id\)/i);
    expect(ups[1]![1]).toEqual(['k1', 's1', null]);
  });
  it.each([
    ['skill', 'B2'], ['skill', 'experto'], ['skill', 3],
    ['language', 'medio'], ['language', 'c1'],
  ] as const)('nivel no válido (%s, %j)', async (kind, nivel) => {
    const s = setup();
    const m = kind === 'skill' ? s.skills : s.langs;
    await expect(m.set(ALUMNO, 'k1', nivel as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(s.query).not.toHaveBeenCalled();
  });
  it('elemento de catálogo inexistente => ElementoNoEncontradoError', async () => {
    const { skills, record } = setup({ item: [] });
    await expect(skills.set(ALUMNO, 'zz', 'medio')).rejects.toBeInstanceOf(ElementoNoEncontradoError);
    expect(record).not.toHaveBeenCalled();
  });
  it('solo ALUMNO con ficha', async () => {
    await expect(setup().skills.set(ADMIN, 'k1', 'medio')).rejects.toBeInstanceOf(FichaNoEncontradaError);
    await expect(setup({ student: [] }).skills.set(ALUMNO, 'k1', 'medio')).rejects.toBeInstanceOf(FichaNoEncontradaError);
  });
});

describe('Taxonomy.remove', () => {
  it('borra solo la asociación propia y audita DELETE con el dato anterior', async () => {
    const { skills, query, record, tx } = setup({ rel: [{ nivel: 'medio' }] });
    await skills.remove(ALUMNO, 'k1');
    const del = query.mock.calls.find((c) => /delete from "Skill_student_rel"/i.test(c[0] as string))!;
    expect(del[1]).toEqual(['k1', 's1']);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ALUMNO, tabla: 'Skill_student_rel', operacion: 'DELETE', datosAnteriores: expect.objectContaining({ nivel: 'medio' }) }),
      tx,
    );
  });
  it('no asociada => ElementoNoEncontradoError sin auditar', async () => {
    const { skills, record } = setup({ rel: [] });
    await expect(skills.remove(ALUMNO, 'k1')).rejects.toBeInstanceOf(ElementoNoEncontradoError);
    expect(record).not.toHaveBeenCalled();
  });
});
