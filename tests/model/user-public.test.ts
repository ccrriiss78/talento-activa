import { describe, it, expect } from 'vitest';
import { toPublic } from '../../src/model/user';

describe('toPublic', () => {
  it('devuelve solo la proyección pública, sin password_hash', () => {
    const created_at = new Date();
    const conHash = {
      id: 'u1',
      email: 'a@b.es',
      rol: 'ADMIN' as const,
      email_verified: true,
      created_at,
      password_hash: 'secreto',
    };
    const pub = toPublic(conHash);
    expect(pub).toEqual({ id: 'u1', email: 'a@b.es', rol: 'ADMIN', email_verified: true, created_at });
    expect('password_hash' in pub).toBe(false);
  });
});
