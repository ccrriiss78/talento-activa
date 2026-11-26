import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditEntry } from './audit';
import { DatosNoValidosError } from './password';
import { CAMPOS_PRIVACIDAD, FichaNoEncontradaError, type Ficha } from './student-profile';

export type EstadoAlumno = 'activo' | 'inactivo';
const ESTADOS: readonly string[] = ['activo', 'inactivo'];

interface AuditLike {
  record(entry: AuditEntry, executor?: Queryable): Promise<void>;
}

const COLUMNAS =
  'id, user_id, edition_id, nombre, foto_url, bio, ubicacion, disponibilidad_traslado, modalidad, estado_laboral, cv_url, linkedin, github, estado, privacy, filled_at';

export function createStudentStatusModel(db: Db, audit: AuditLike) {
  return {
    /**
     * Cambia el estado: el ALUMNO el suyo (ignora `studentId`), el ADMIN el del Student
     * indicado. Cualquier otro caso es "no encontrada". Audita antes/después.
     */
    async setEstado(actor: Actor, estado: EstadoAlumno, studentId?: string): Promise<Ficha> {
      if (actor.rol === 'SOCIO' || (actor.rol === 'ADMIN' && !studentId)) throw new FichaNoEncontradaError();
      if (typeof estado !== 'string' || !ESTADOS.includes(estado)) throw new DatosNoValidosError();
      const propio = actor.rol === 'ALUMNO';
      return db.transaction(async (tx) => {
        const antes = (
          await tx.query<Ficha>(
            `select ${COLUMNAS} from "Student" where ${propio ? 'user_id' : 'id'} = $1`,
            [propio ? actor.id : studentId],
          )
        )[0];
        if (!antes) throw new FichaNoEncontradaError();
        const f = (
          await tx.query<Ficha>(`update "Student" set estado = $2 where id = $1 returning ${COLUMNAS}`, [antes.id, estado])
        )[0]!;
        await audit.record(
          { actor, tabla: 'Student', idRegistro: antes.id, operacion: 'UPDATE', datosAnteriores: antes, datosNuevos: f },
          tx,
        );
        return f;
      });
    },

    /**
     * Vista de un alumno para una empresa (SOCIO): solo activos con consentimiento (`consent_at`) y solo los campos con
     * `privacy[campo] === true` (privado por defecto). Un inactivo es "no encontrado".
     */
    async getForCompany(actor: Actor, studentId: string): Promise<Record<string, unknown>> {
      if (actor.rol !== 'SOCIO') throw new FichaNoEncontradaError();
      const f = (
        await db.query<Ficha>(`select ${COLUMNAS} from "Student" where id = $1 and estado = 'activo' and consent_at is not null`, [studentId])
      )[0];
      if (!f) throw new FichaNoEncontradaError();
      const vista: Record<string, unknown> = { id: f.id, edition_id: f.edition_id, nombre: f.nombre };
      for (const campo of CAMPOS_PRIVACIDAD) if (f.privacy?.[campo] === true) vista[campo] = f[campo];
      return vista;
    },
  };
}
