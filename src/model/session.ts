import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import type { Actor, AuditEntry, Rol } from './audit';

export const SESSION_DAYS = 30;
export const RENEW_THRESHOLD_DAYS = 15;
const DAY_MS = 86_400_000;

export interface SessionResolved {
  actor: Actor;
  /** true si se extendió la caducidad: el controlador debe reponer la cookie. */
  renewed: boolean;
  expiresAt: Date;
}

export interface SessionOptions {
  now?: () => Date;
  /** Capa de auditoría: cada mutación de Session se registra (sin token ni hash). */
  audit?: { record(entry: AuditEntry): Promise<void> };
}

const sha256Hex = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSessionModel(db: Db, options: SessionOptions = {}) {
  const now = options.now ?? (() => new Date());
  const audit = options.audit;
  const expiraEn = () => new Date(now().getTime() + SESSION_DAYS * DAY_MS);

  return {
    /** Crea una sesión; devuelve el token en claro (solo para la cookie). En BD solo va el SHA-256. */
    async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = expiraEn();
      const rows = await db.query<{ id: string }>(
        `insert into "Session" (user_id, token_sha256, expires_at) values ($1, $2, $3) returning id`,
        [userId, sha256Hex(token), expiresAt],
      );
      await audit?.record({
        actor: { id: userId },
        tabla: 'Session',
        idRegistro: rows[0]?.id ?? null,
        operacion: 'INSERT',
        datosNuevos: { user_id: userId, expires_at: expiresAt },
      });
      return { token, expiresAt };
    },

    async resolve(token: string): Promise<SessionResolved | null> {
      const rows = await db.query<{ id: string; expires_at: Date; user_id: string | null; rol: Rol | null }>(
        `select s.id, s.expires_at, u.id as user_id, u.rol
           from "Session" s left join "User" u on u.id = s.user_id
          where s.token_sha256 = $1`,
        [sha256Hex(token)],
      );
      const row = rows[0];
      if (!row) return null;
      const ahora = now().getTime();
      if (row.expires_at.getTime() <= ahora || !row.user_id || !row.rol) {
        await db.query(`delete from "Session" where id = $1`, [row.id]);
        await audit?.record({
          actor: null,
          tabla: 'Session',
          idRegistro: row.id,
          operacion: 'DELETE',
          datosAnteriores: { user_id: row.user_id, expires_at: row.expires_at },
        });
        return null;
      }
      const actor: Actor = { id: row.user_id, rol: row.rol };
      if (row.expires_at.getTime() - ahora < RENEW_THRESHOLD_DAYS * DAY_MS) {
        const expiresAt = expiraEn();
        await db.query(`update "Session" set expires_at = $1 where id = $2`, [expiresAt, row.id]);
        await audit?.record({
          actor,
          tabla: 'Session',
          idRegistro: row.id,
          operacion: 'UPDATE',
          datosAnteriores: { expires_at: row.expires_at },
          datosNuevos: { expires_at: expiresAt },
        });
        return { actor, renewed: true, expiresAt };
      }
      return { actor, renewed: false, expiresAt: row.expires_at };
    },

    /** Borra la sesión asociada al token; idempotente. */
    async destroy(token: string): Promise<void> {
      const rows = await db.query<{ id: string; user_id: string | null; expires_at: Date }>(
        `delete from "Session" where token_sha256 = $1 returning id, user_id, expires_at`,
        [sha256Hex(token)],
      );
      for (const r of rows) {
        await audit?.record({
          actor: r.user_id ? { id: r.user_id } : null,
          tabla: 'Session',
          idRegistro: r.id,
          operacion: 'DELETE',
          datosAnteriores: { user_id: r.user_id, expires_at: r.expires_at },
        });
      }
    },
  };
}
