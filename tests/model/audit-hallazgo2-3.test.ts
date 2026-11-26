import { describe, it, expect, vi } from 'vitest';
import { createEmailVerificationModel } from '../../src/model/email-verification';
import { createCompanyModel } from '../../src/model/company';
import { createStudentForgetModel } from '../../src/model/student-forget';
import type { Db } from '../../src/model/db';

const NOW = new Date('2026-01-01T00:00:00Z');
const TOK = 'A'.repeat(43);

function mkDb(handler: (sql: string, p?: unknown[]) => unknown[] = () => []) {
  const query = vi.fn(async (sql: string, p?: unknown[]) => handler(sql, p));
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  return { db, query, tx };
}

describe('Email_verification_token: auditoría (hallazgo 2)', () => {
  it('issue audita el INSERT del token sin token ni hash, en la transacción', async () => {
    const { db, tx } = mkDb();
    const record = vi.fn(async () => {});
    const model = createEmailVerificationModel(db, { now: () => NOW, audit: { record } });
    const { token, expiresAt } = await model.issue('u1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'Email_verification_token',
        operacion: 'INSERT',
        datosNuevos: { user_id: 'u1', expires_at: expiresAt },
      }),
      tx,
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain(token);
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/sha256/i);
  });

  it('verify audita el UPDATE de used_at del token (sin token ni hash)', async () => {
    const { db, tx } = mkDb((sql) => (/update "Email_verification_token"/i.test(sql) ? [{ user_id: 'u1' }] : []));
    const record = vi.fn(async () => {});
    const model = createEmailVerificationModel(db, { now: () => NOW, audit: { record } });
    await model.verify(TOK);
    const call = (record.mock.calls as unknown as [any, unknown][]).find(([e]) => e.tabla === 'Email_verification_token')!;
    expect(call[0]).toMatchObject({ operacion: 'UPDATE', datosNuevos: { user_id: 'u1', used_at: NOW } });
    expect(call[1]).toBe(tx);
    expect(JSON.stringify(record.mock.calls)).not.toContain(TOK);
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/sha256/i);
  });
});

describe('Company_user_rel: auditoría (hallazgo 2)', () => {
  it('create audita el INSERT de la relación empresa-usuario con ids', async () => {
    const { db, tx } = mkDb((sql) => (/insert into "Company" /i.test(sql) ? [{ id: 'c1', nombre: 'Acme' }] : []));
    const record = vi.fn(async () => {});
    const createUser = vi.fn(async () => ({ id: 'u1' }));
    const model = createCompanyModel(db, { record }, { createUser } as never);
    await model.create({ id: 'a1', rol: 'ADMIN' }, { email: 'e@x.es', password: 'una-clave-larga-123', nombre: 'Acme' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'Company_user_rel',
        operacion: 'INSERT',
        datosNuevos: { company_id: 'c1', user_id: 'u1' },
      }),
      tx,
    );
  });
});

describe('Derecho al olvido: purga del Audit_log de datos hijos (hallazgo 3)', () => {
  it('purga entradas de Project y relaciones que referencian al alumno por student_id o por id de proyecto', async () => {
    const { db, query } = mkDb((sql) => (/^\s*select/i.test(sql) ? [{ id: 's1', user_id: 'u1' }] : []));
    const model = createStudentForgetModel(db, { record: vi.fn(async () => {}) });
    await model.forget({ id: 'u1', rol: 'ALUMNO' });
    const call = query.mock.calls.find(
      (c) => /update "Audit_log"/i.test(c[0]) && /Skill_student_rel/.test(c[0]) && /Project/.test(c[0]),
    )!;
    expect(call).toBeTruthy();
    expect(call[0]).toMatch(/datos_anteriores = null/i);
    expect(call[0]).toMatch(/datos_nuevos = null/i);
    expect(call[0]).toMatch(/Language_student_rel/);
    expect(call[0]).toMatch(/Company_student_rel/);
    expect(call[0]).toMatch(/Reminder_state/);
    expect(call[0]).toMatch(/datos_nuevos->>'student_id' = \$1/);
    expect(call[0]).toMatch(/datos_anteriores->>'student_id' = \$1/);
    expect(call[1]).toEqual(['s1']);
  });
});
