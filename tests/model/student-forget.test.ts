import { describe, it, expect, vi } from 'vitest';
import { createStudentForgetModel } from '../../src/model/student-forget';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import type { Db } from '../../src/model/db';

const ALUMNO = { id: 'u1', rol: 'ALUMNO' as const };
const ADMIN = { id: 'a1', rol: 'ADMIN' as const };
const SOCIO = { id: 'c1', rol: 'SOCIO' as const };
const ST = { id: 's1', user_id: 'u1' };

function setup(found: unknown[] = [ST]) {
  const query = vi.fn(async (sql: string, _p?: unknown[]) => (/^\s*select/i.test(sql) ? found : []));
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  return { model: createStudentForgetModel(db, { record }), query, record, tx };
}
const sqls = (q: ReturnType<typeof setup>['query']) => q.mock.calls.map((c) => c[0].replace(/\s+/g, ' ').trim());

describe('StudentForget.forget (derecho al olvido)', () => {
  it('el alumno olvida SU cuenta (por user_id), ignorando un studentId ajeno', async () => {
    const { model, query } = setup();
    await model.forget(ALUMNO, 'otro');
    expect(query.mock.calls[0]![0]).toMatch(/where user_id = \$1/i);
    expect(query.mock.calls[0]![1]).toEqual(['u1']);
  });

  it('el admin olvida a cualquier alumno por id de Student', async () => {
    const { model, query } = setup();
    await model.forget(ADMIN, 's1');
    expect(query.mock.calls[0]![0]).toMatch(/where id = \$1/i);
    expect(query.mock.calls[0]![1]).toEqual(['s1']);
  });

  it('borra en cascada hijos, Student y User, en la misma transacción', async () => {
    const { model, query, tx } = setup();
    await model.forget(ALUMNO);
    const s = sqls(query);
    for (const t of ['Project', 'Skill_student_rel', 'Language_student_rel', 'Company_student_rel', 'Reminder_state'])
      expect(s.some((x) => new RegExp(`^delete from "${t}" where student_id = \\$1`, 'i').test(x))).toBe(true);
    const iStudent = s.findIndex((x) => /^delete from "Student" where id = \$1/i.test(x));
    const iUser = s.findIndex((x) => /^delete from "User" where id = \$1/i.test(x));
    const iHijo = s.findIndex((x) => /^delete from "Project"/i.test(x));
    expect(iHijo).toBeGreaterThan(-1);
    expect(iStudent).toBeGreaterThan(iHijo);
    expect(iUser).toBeGreaterThan(iStudent);
    const delUser = query.mock.calls.find((c) => /delete from "User"/i.test(c[0]))!;
    expect(delUser[1]).toEqual(['u1']);
    expect(tx.query).toBe(query);
  });

  it('purga datos personales del Audit_log previo del alumno y su usuario', async () => {
    const { model, query } = setup();
    await model.forget(ALUMNO);
    const call = query.mock.calls.find((c) => /update "Audit_log"/i.test(c[0]))!;
    expect(call[0]).toMatch(/datos_anteriores = null/i);
    expect(call[0]).toMatch(/datos_nuevos = null/i);
    expect(call[1]).toEqual(['s1', 'u1']);
  });

  it('audita un DELETE sin datos personales (solo ids) y antes de borrar el usuario', async () => {
    const { model, record, query } = setup();
    await model.forget(ADMIN, 's1');
    expect(record).toHaveBeenCalledTimes(1);
    const entry = (record.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(entry).toMatchObject({ actor: ADMIN, tabla: 'Student', idRegistro: 's1', operacion: 'DELETE' });
    expect(entry.datosAnteriores).toEqual({ id: 's1', user_id: 'u1' });
    expect(entry.datosNuevos).toBeUndefined();
    // el registro de auditoría se escribe tras la purga y antes de borrar el usuario
    const order = record.mock.invocationCallOrder[0]!;
    const purge = query.mock.invocationCallOrder[query.mock.calls.findIndex((c) => /update "Audit_log"/i.test(c[0]))]!;
    const delUser = query.mock.invocationCallOrder[query.mock.calls.findIndex((c) => /delete from "User"/i.test(c[0]))]!;
    expect(order).toBeGreaterThan(purge);
    expect(order).toBeLessThan(delUser);
  });

  it('el admin sin studentId, o un SOCIO => no encontrada sin tocar BD', async () => {
    const a = setup();
    await expect(a.model.forget(ADMIN)).rejects.toBeInstanceOf(FichaNoEncontradaError);
    const s = setup();
    await expect(s.model.forget(SOCIO, 's1')).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(a.query).not.toHaveBeenCalled();
    expect(s.query).not.toHaveBeenCalled();
  });

  it('alumno inexistente => no encontrada, sin borrar ni auditar', async () => {
    const { model, query, record } = setup([]);
    await expect(model.forget(ADMIN, 'zz')).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(sqls(query).some((x) => /^delete/i.test(x))).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
});
