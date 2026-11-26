import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditEntry } from './audit';
import { FichaNoEncontradaError } from './student-profile';

interface AuditLike {
  record(entry: AuditEntry, executor?: Queryable): Promise<void>;
}

export interface ConsentimientoAlumno {
  id: string;
  consent_at: Date | string | null;
}

export function createStudentConsentModel(db: Db, audit: AuditLike) {
  return {
    /**
     * El ALUMNO da su consentimiento explícito a publicar sus datos: fija `consent_at`.
     * Idempotente (si ya consintió no reescribe ni audita). Solo ALUMNO, solo el suyo.
     */
    async giveOwn(actor: Actor): Promise<ConsentimientoAlumno> {
      if (actor.rol !== 'ALUMNO') throw new FichaNoEncontradaError();
      return db.transaction(async (tx) => {
        const antes = (
          await tx.query<ConsentimientoAlumno>('select id, consent_at from "Student" where user_id = $1', [actor.id])
        )[0];
        if (!antes) throw new FichaNoEncontradaError();
        if (antes.consent_at) return antes;
        const despues = (
          await tx.query<ConsentimientoAlumno>(
            'update "Student" set consent_at = now() where id = $1 returning id, consent_at',
            [antes.id],
          )
        )[0]!;
        await audit.record(
          { actor, tabla: 'Student', idRegistro: antes.id, operacion: 'UPDATE', datosAnteriores: antes, datosNuevos: despues },
          tx,
        );
        return despues;
      });
    },
  };
}
