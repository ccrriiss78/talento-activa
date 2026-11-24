import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, DatosNoValidosError } from '../../src/model/password';

const ok = 'una-contraseña-segura-123';

describe('password (Argon2id)', () => {
  it('genera un hash Argon2id con m=19456,t=2,p=1', async () => {
    const h = await hashPassword(ok);
    expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const h = await hashPassword(ok);
    expect(await verifyPassword(ok, h)).toBe(true);
    expect(await verifyPassword(ok + 'x', h)).toBe(false);
  });

  it('dos hashes de la misma contraseña difieren (sal aleatoria)', async () => {
    expect(await hashPassword(ok)).not.toBe(await hashPassword(ok));
  });

  it('acepta los límites 12 y 256 caracteres', async () => {
    await expect(hashPassword('a'.repeat(12))).resolves.toBeTypeOf('string');
    await expect(hashPassword('a'.repeat(256))).resolves.toBeTypeOf('string');
  });

  it('rechaza longitud 11 y 257 con DatosNoValidosError', async () => {
    await expect(hashPassword('a'.repeat(11))).rejects.toBeInstanceOf(DatosNoValidosError);
    await expect(hashPassword('a'.repeat(257))).rejects.toBeInstanceOf(DatosNoValidosError);
  });

  it('verify fuera de rango devuelve false sin lanzar', async () => {
    const h = await hashPassword(ok);
    expect(await verifyPassword('corta', h)).toBe(false);
    expect(await verifyPassword('a'.repeat(300), h)).toBe(false);
  });

  it('verify con hash malformado devuelve false', async () => {
    expect(await verifyPassword(ok, 'no-es-un-hash')).toBe(false);
  });
});
