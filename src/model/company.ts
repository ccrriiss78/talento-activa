import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditLike } from './audit';
import { DatosNoValidosError } from './password';
import type { NuevoUsuario, UserPublic } from './user';

export interface Company {
  id: string;
  nombre: string;
  es_socia: boolean;
  contacto: string | null;
  created_by: string | null;
}
export interface NuevaEmpresa {
  email: string;
  password: string;
  nombre: string;
  es_socia?: boolean;
  contacto?: string;
}

interface UsersLike {
  createUser(actor: Actor, input: NuevoUsuario, executor?: Queryable): Promise<UserPublic>;
}

export class EmpresaNoEncontradaError extends Error {
  constructor() {
    super('Empresa no encontrada');
    this.name = 'EmpresaNoEncontradaError';
  }
}

const COLUMNAS = 'id, nombre, es_socia, contacto, created_by';

export function createCompanyModel(db: Db, audit: AuditLike, users: UsersLike) {
  return {
    /** Alta de empresa por invitación: usuario SOCIO + Company + relación, en una transacción. */
    async create(actor: Actor, input: NuevaEmpresa): Promise<Company> {
      if (typeof input.nombre !== 'string' || input.nombre.trim() === '') throw new DatosNoValidosError();
      if (input.es_socia !== undefined && typeof input.es_socia !== 'boolean') throw new DatosNoValidosError();
      if (input.contacto !== undefined && typeof input.contacto !== 'string') throw new DatosNoValidosError();
      return db.transaction(async (tx) => {
        const user = await users.createUser(
          actor,
          { email: input.email, password: input.password, rol: 'SOCIO' },
          tx,
        );
        const c = (
          await tx.query<Company>(
            `insert into "Company" (nombre, es_socia, contacto, created_by) values ($1, $2, $3, $4) returning ${COLUMNAS}`,
            [input.nombre.trim(), input.es_socia ?? false, input.contacto ?? null, actor.id],
          )
        )[0]!;
        await tx.query(`insert into "Company_user_rel" (company_id, user_id) values ($1, $2)`, [c.id, user.id]);
        await audit.record({ actor, tabla: 'Company', idRegistro: c.id, operacion: 'INSERT', datosNuevos: c }, tx);
        await audit.record(
          {
            actor,
            tabla: 'Company_user_rel',
            idRegistro: null,
            operacion: 'INSERT',
            datosNuevos: { company_id: c.id, user_id: user.id },
          },
          tx,
        );
        return c;
      });
    },

    /** Marca o desmarca una empresa como socia. */
    async setSocia(actor: Actor, id: string, esSocia: boolean): Promise<Company> {
      if (typeof esSocia !== 'boolean') throw new DatosNoValidosError();
      return db.transaction(async (tx) => {
        const antes = (await tx.query<Company>(`select ${COLUMNAS} from "Company" where id = $1 for update`, [id]))[0];
        if (!antes) throw new EmpresaNoEncontradaError();
        const despues = (
          await tx.query<Company>(`update "Company" set es_socia = $2 where id = $1 returning ${COLUMNAS}`, [id, esSocia])
        )[0]!;
        await audit.record(
          { actor, tabla: 'Company', idRegistro: id, operacion: 'UPDATE', datosAnteriores: antes, datosNuevos: despues },
          tx,
        );
        return despues;
      });
    },
  };
}
