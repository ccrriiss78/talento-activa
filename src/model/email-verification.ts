import { createHash, randomBytes } from 'node:crypto';
import type { Db, Queryable } from './db';
import type { AuditEntry } from './audit';

export const VERIFICATION_HOURS = 48;
const HOUR_MS = 3_600_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export class TokenVerificacionNoValidoError extends Error {
  constructor() {
    super('Enlace de verificación no válido o caducado');
    this.name = 'TokenVerificacionNoValidoError';
  }
}

export interface EmailVerificationOptions {
  now?: () => Date;
  audit?: { record(entry: AuditEntry, executor?: Queryable): Promise<void> };
}

const sha256Hex = (token: string) => createHash('sha256').update(token).digest('hex');

export function createEmailVerificationModel(db: Db, options: EmailVerificationOptions = {}) {
  const now = options.now ?? (() => new Date());
  const audit = options.audit;

  return {
    /** Emite un token de un solo uso; devuelve el token en claro (solo para el email). En BD va el SHA-256. */
    async issue(userId: string): Promise<{ token: string; expiresAt: Date }> {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now().getTime() + VERIFICATION_HOURS * HOUR_MS);
      await db.query(
        `insert into "Email_verification_token" (user_id, token_sha256, expires_at) values ($1, $2, $3)`,
        [userId, sha256Hex(token), expiresAt],
      );
      return { token, expiresAt };
    },

    /** Consume el token (un solo uso, con caducidad) y marca el email como verificado. Devuelve el id de usuario. */
    async verify(token: string): Promise<string> {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new TokenVerificacionNoValidoError();
      return db.transaction(async (tx) => {
        const rows = await tx.query<{ user_id: string }>(
          `update "Email_verification_token" set used_at = $2
           where token_sha256 = $1 and used_at is null and expires_at > $2
           returning user_id`,
          [sha256Hex(token), now()],
        );
        const userId = rows[0]?.user_id;
        if (!userId) throw new TokenVerificacionNoValidoError();
        await tx.query(`update "User" set email_verified = true where id = $1`, [userId]);
        await audit?.record(
          {
            actor: { id: userId },
            tabla: 'User',
            idRegistro: userId,
            operacion: 'UPDATE',
            datosAnteriores: { email_verified: false },
            datosNuevos: { email_verified: true },
          },
          tx,
        );
        return userId;
      });
    },
  };
}
