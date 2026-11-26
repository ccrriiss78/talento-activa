import { describe, it, expect, vi } from 'vitest';
import { createStudentProfileModel } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ALUMNO = { id: 'u1', rol: 'ALUMNO' as const };
const FICHA = { id: 's1', user_id: 'u1', edition_id: 'e1', nombre: 'Ana', estado: 'inactivo', privacy: {}, filled_at: null };

function setup() {
  const query = vi.fn(async (sql: string) => (/^\s*select/i.test(sql) ? [FICHA] : [FICHA]));
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn({ query }) } as unknown as Db;
  return createStudentProfileModel(db, { record: vi.fn(async () => {}) });
}

describe('StudentProfile: foto_url y cv_url deben ser http(s)', () => {
  for (const campo of ['foto_url', 'cv_url']) {
    for (const malo of ['javascript:alert(1)', 'data:text/html,hola', 'texto suelto', 'ftp://x.com/a']) {
      it(`rechaza ${campo}=${malo}`, async () => {
        await expect(setup().updateOwn(ALUMNO, { [campo]: malo } as never)).rejects.toBeInstanceOf(DatosNoValidosError);
      });
    }
    it(`acepta ${campo} https y null`, async () => {
      await expect(setup().updateOwn(ALUMNO, { [campo]: 'https://x.com/a.png' } as never)).resolves.toBeDefined();
      await expect(setup().updateOwn(ALUMNO, { [campo]: null } as never)).resolves.toBeDefined();
    });
  }
});
