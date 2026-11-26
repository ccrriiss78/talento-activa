import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditLike } from './audit';
import { FichaNoEncontradaError } from './student-profile';

/** Tablas hijas del alumno que se borran explícitamente (además del ON DELETE CASCADE). */
const HIJAS = ['Project', 'Skill_student_rel', 'Language_student_rel', 'Company_student_rel', 'Reminder_state'];

export function createStudentForgetModel(db: Db, audit: AuditLike) {
  return {
    /**
     * Derecho al olvido: borra al alumno (ALUMNO el suyo, ADMIN el indicado) y su usuario.
     * Es un borrado, no un estado. Se purgan los datos personales del Audit_log previo y se
     * audita el DELETE solo con ids (sin PII). Todo en una transacción.
     */
    async forget(actor: Actor, studentId?: string): Promise<void> {
      if (actor.rol === 'SOCIO' || (actor.rol === 'ADMIN' && !studentId)) throw new FichaNoEncontradaError();
      const propio = actor.rol === 'ALUMNO';
      await db.transaction(async (tx) => {
        const s = (
          await tx.query<{ id: string; user_id: string }>(
            `select id, user_id from "Student" where ${propio ? 'user_id' : 'id'} = $1`,
            [propio ? actor.id : studentId],
          )
        )[0];
        if (!s) throw new FichaNoEncontradaError();
        for (const t of HIJAS) await tx.query(`delete from "${t}" where student_id = $1`, [s.id]);
        await tx.query(
          `update "Audit_log" set datos_anteriores = null, datos_nuevos = null
           where (tabla = 'Student' and id_registro = $1) or (tabla = 'User' and id_registro = $2)`,
          [s.id, s.user_id],
        );
        // Datos hijos (título, URLs, niveles...) auditados antes: referencian al alumno en datos_* (student_id).
        await tx.query(
          `update "Audit_log" set datos_anteriores = null, datos_nuevos = null
           where tabla in ('Project', 'Skill_student_rel', 'Language_student_rel', 'Company_student_rel', 'Reminder_state')
           and (datos_nuevos->>'student_id' = $1 or datos_anteriores->>'student_id' = $1)`,
          [s.id],
        );
        await audit.record(
          { actor, tabla: 'Student', idRegistro: s.id, operacion: 'DELETE', datosAnteriores: { id: s.id, user_id: s.user_id } },
          tx,
        );
        await tx.query(`delete from "Student" where id = $1`, [s.id]);
        await tx.query(`delete from "User" where id = $1`, [s.user_id]);
      });
    },
  };
}
