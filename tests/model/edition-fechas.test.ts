import { describe, it, expect, vi } from 'vitest';
import { createEditionModel } from '../../src/model/edition';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ADMIN = { id: '22222222-2222-2222-2222-222222222222', rol: 'ADMIN' as const };
const ED = { id: 'e1', nombre: 'x', anio: 2026, fecha_inicio: null, fecha_fin: null, estado: 'abierta' };

function setup() {
  const query = vi.fn(async () => [ED]);
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn({ query }) } as unknown as Db;
  return createEditionModel(db, { record: vi.fn(async () => {}) });
}

describe('Edition: fechas imposibles', () => {
  for (const f of ['2026-02-30', '2026-13-01', '2026-04-31', '2025-02-29']) {
    it(`rechaza ${f} con DatosNoValidosError`, async () => {
      await expect(setup().create(ADMIN, { nombre: 'x', anio: 2026, fecha_inicio: f })).rejects.toBeInstanceOf(DatosNoValidosError);
    });
  }
  it('acepta fechas reales, incluido 29-feb bisiesto', async () => {
    await expect(setup().create(ADMIN, { nombre: 'x', anio: 2024, fecha_inicio: '2024-02-29' })).resolves.toBeDefined();
  });
});
