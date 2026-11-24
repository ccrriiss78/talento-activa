import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createSessionModel } from '../../src/model/session';
import type { Db } from '../../src/model/db';

describe('modelo Session: destroy', () => {
  it('borra la fila por SHA-256 del token (idempotente)', async () => {
    const query = vi.fn(async () => []);
    const model = createSessionModel({ query } as unknown as Db);
    await model.destroy('abc');
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/delete from "Session"/i);
    expect(params).toEqual([createHash('sha256').update('abc').digest('hex')]);
  });
});
