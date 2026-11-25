import type { Db, Queryable } from './db';
import type { Actor, Rol } from './actor';
import type { AuditEntry } from './audit';
import { hashPassword, DatosNoValidosError } from './password';

export interface UserPublic {
  id: string;
  email: string;
  rol: Rol;
  email_verified: boolean;
  created_at: Date;
}
export interface UserConHash extends UserPublic {
  password_hash: string;
}
export interface NuevoUsuario {
  email: string;
  password: string;
  rol: Rol;
}
interface AuditLike {
  record(entry: AuditEntry, executor?: Queryable): Promise<void>;
}

/** Proyección pública de un usuario (nunca incluye password_hash). */
export function toPublic(u: UserPublic): UserPublic {
  return { id: u.id, email: u.email, rol: u.rol, email_verified: u.email_verified, created_at: u.created_at };
}

export class EmailYaRegistradoError extends Error {
  constructor() {
    super('No se ha podido completar el registro');
    this.name = 'EmailYaRegistradoError';
  }
}

const ROLES: readonly string[] = ['ADMIN', 'SOCIO', 'ALUMNO'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLUMNAS_PUBLICAS = 'id, email, rol, email_verified, created_at';

export function createUserModel(db: Db, audit: AuditLike) {
  return {
    /** Alta por invitación del admin: nace con email_verified=false. */
    async createUser(actor: Actor, input: NuevoUsuario, executor?: Queryable): Promise<UserPublic> {
      if (!ROLES.includes(input.rol)) throw new DatosNoValidosError();
      if (!EMAIL_RE.test(input.email)) throw new DatosNoValidosError();
      const passwordHash = await hashPassword(input.password);
      const insertar = async (ex: Queryable, auditar: (u: UserPublic) => Promise<void>) => {
        let rows: UserPublic[];
        try {
          rows = await ex.query<UserPublic>(
            `insert into "User" (email, password_hash, rol, email_verified)
             values ($1, $2, $3, false) returning ${COLUMNAS_PUBLICAS}`,
            [input.email, passwordHash, input.rol],
          );
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw new EmailYaRegistradoError();
          throw e;
        }
        const u = rows[0]!;
        await auditar(u);
        return u;
      };
      const entrada = (u: UserPublic): AuditEntry => ({
        actor,
        tabla: 'User',
        idRegistro: u.id,
        operacion: 'INSERT',
        datosNuevos: { email: u.email, rol: u.rol, email_verified: u.email_verified },
      });
      // Con ejecutor externo, la mutación va en la transacción del llamador. Si no, en una propia
      // (atómica con su auditoría) cuando el cliente la soporta.
      if (executor) return insertar(executor, (u) => audit.record(entrada(u), executor));
      const user =
        typeof db.transaction === 'function'
          ? await db.transaction((tx) => insertar(tx, (u) => audit.record(entrada(u), tx)))
          : await insertar(db, (u) => audit.record(entrada(u)));
      return user;
    },

    async findByEmail(email: string): Promise<UserConHash | null> {
      const rows = await db.query<UserConHash>(
        `select ${COLUMNAS_PUBLICAS}, password_hash from "User" where lower(email) = lower($1)`,
        [email],
      );
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<UserPublic | null> {
      const rows = await db.query<UserPublic>(`select ${COLUMNAS_PUBLICAS} from "User" where id = $1`, [id]);
      return rows[0] ?? null;
    },
  };
}
