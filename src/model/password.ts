import { hash, verify, Algorithm } from '@node-rs/argon2';

export const LONGITUD_MIN = 12;
export const LONGITUD_MAX = 256;

/** Parámetros Argon2id exigidos por el cliente. */
const OPCIONES = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export class DatosNoValidosError extends Error {
  constructor(message = 'Datos no válidos') {
    super(message);
    this.name = 'DatosNoValidosError';
  }
}

function enRango(password: string): boolean {
  return password.length >= LONGITUD_MIN && password.length <= LONGITUD_MAX;
}

export async function hashPassword(password: string): Promise<string> {
  if (!enRango(password)) throw new DatosNoValidosError();
  return hash(password, OPCIONES);
}

/** Nunca lanza: fuera de rango o hash malformado => false. */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (!enRango(password)) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
