import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditLike } from './audit';
import { EdicionNoEncontradaError } from './edition';
import { DatosNoValidosError } from './password';
import type { NuevoUsuario, UserPublic } from './user';

export interface Student {
  id: string;
  user_id: string;
  edition_id: string;
  nombre: string;
  estado: 'activo' | 'inactivo';
}
export interface NuevoAlumno {
  email: string;
  password: string;
  edition_id: string;
  nombre: string;
}

interface UsersLike {
  createUser(actor: Actor, input: NuevoUsuario, executor?: Queryable): Promise<UserPublic>;
}

const COLUMNAS = 'id, user_id, edition_id, nombre, estado';
const texto = (v: unknown) => typeof v === 'string' && v.trim() !== '';

export function createStudentModel(db: Db, audit: AuditLike, users: UsersLike) {
  return {
    /**
     * Alta de alumno finalizado: crea su usuario ALUMNO y su Student en la edición,
     * todo en una transacción. Nace `inactivo` (defecto de BD) hasta que rellene la ficha.
     */
    async create(actor: Actor, input: NuevoAlumno): Promise<Student> {
      if (!texto(input.nombre) || !texto(input.edition_id)) throw new DatosNoValidosError();
      const nombre = input.nombre.trim();
      return db.transaction(async (tx) => {
        const ed = await tx.query(`select id from "Edition" where id = $1`, [input.edition_id]);
        if (ed.length === 0) throw new EdicionNoEncontradaError();
        const user = await users.createUser(
          actor,
          { email: input.email, password: input.password, rol: 'ALUMNO' },
          tx,
        );
        const s = (
          await tx.query<Student>(
            `insert into "Student" (user_id, edition_id, nombre) values ($1, $2, $3) returning ${COLUMNAS}`,
            [user.id, input.edition_id, nombre],
          )
        )[0]!;
        await audit.record({ actor, tabla: 'Student', idRegistro: s.id, operacion: 'INSERT', datosNuevos: s }, tx);
        return s;
      });
    },
  };
}
