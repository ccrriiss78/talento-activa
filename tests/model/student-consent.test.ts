import { describe, it, expect, vi } from 'vitest';
import { createStudentConsentModel } from '../../src/model/student-consent';
import { createStudentStatusModel } from '../../src/model/student-status';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import type { Db } from '../../src/model/db';

const ALUMNO = { id: 'u1', rol: 'ALUMNO' as const };
const ADMIN = { id: 'a1', rol: 'ADMIN' as const };
const SOCIO = { id: 'c1', rol: 'SOCIO' as const };

function setup(select: unknown[] = [{ id: 's1', consent_at: null }], update: unknown[] = [{ id: 's1', consent_at: '2026-11-26T10:00:00Z' }]) {
  const query = vi.fn(async (sql: string, _p?: unknown[]) => (/^\s*select/i.test(sql) ? select : update));
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  return { model: createStudentConsentModel(db, { record }), query, record, tx };
}

describe('StudentConsent.giveOwn', () => {
  it('fija consent_at = now() del alumno (por user_id) y lo audita antes/después', async () => {
    const { model, query, record, tx } = setup();
    const r = await model.giveOwn(ALUMNO);
    expect(r.consent_at).toBe('2026-11-26T10:00:00Z');
    expect(query.mock.calls[0]![1]).toEqual(['u1']);
    expect(query.mock.calls[1]![0]).toMatch(/set consent_at = now\(\)/i);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ALUMNO, tabla: 'Student', idRegistro: 's1', operacion: 'UPDATE',
        datosAnteriores: { id: 's1', consent_at: null }, datosNuevos: { id: 's1', consent_at: '2026-11-26T10:00:00Z' } }),
      tx,
    );
  });

  it('si ya consintió es idempotente: no reescribe ni audita', async () => {
    const { model, query, record } = setup([{ id: 's1', consent_at: '2026-01-01T00:00:00Z' }]);
    const r = await model.giveOwn(ALUMNO);
    expect(r.consent_at).toBe('2026-01-01T00:00:00Z');
    expect(query).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });

  it('ADMIN y SOCIO no pueden consentir por el alumno => no encontrada sin tocar BD', async () => {
    for (const a of [ADMIN, SOCIO]) {
      const { model, query } = setup();
      await expect(model.giveOwn(a)).rejects.toBeInstanceOf(FichaNoEncontradaError);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it('ficha inexistente => FichaNoEncontradaError', async () => {
    const { model, record } = setup([]);
    await expect(model.giveOwn(ALUMNO)).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('StudentStatus.getForCompany exige consentimiento (RGPD)', () => {
  it('la consulta filtra consent_at is not null además de estado activo', async () => {
    const query = vi.fn(async () => [{ id: 's1', edition_id: 'e1', nombre: 'Ana', privacy: {} }]);
    const db = { query } as unknown as Db;
    const model = createStudentStatusModel(db, { record: vi.fn() });
    await model.getForCompany(SOCIO, 's1');
    const sql = (query.mock.calls[0] as unknown as [string])[0];
    expect(sql).toMatch(/estado = 'activo'/i);
    expect(sql).toMatch(/consent_at is not null/i);
  });
});
