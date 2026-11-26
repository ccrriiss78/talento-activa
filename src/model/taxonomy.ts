import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditLike } from './audit';
import { DatosNoValidosError } from './password';
import { studentId } from './student-profile';

export class ElementoNoEncontradoError extends Error {
  constructor() {
    super('Elemento no encontrado');
    this.name = 'ElementoNoEncontradoError';
  }
}

export type TaxonomyKind = 'skill' | 'language';

export interface ElementoCatalogo {
  id: string;
  nombre: string;
}
export interface ElementoAlumno extends ElementoCatalogo {
  nivel: string | null;
}

const KINDS = {
  skill: { tabla: 'Skill', rel: 'Skill_student_rel', col: 'skill_id', niveles: ['basico', 'medio', 'avanzado'] },
  language: { tabla: 'Language', rel: 'Language_student_rel', col: 'language_id', niveles: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'nativo'] },
} as const;

/** Catálogo (Skill / Language) y su asociación N:M con el alumno autenticado. */
export function createTaxonomyModel(db: Db, audit: AuditLike, kind: TaxonomyKind) {
  const { tabla, rel, col, niveles } = KINDS[kind];

  const existente = async (q: Queryable, id: string) => {
    const e = (await q.query<ElementoCatalogo>(`select id, nombre from "${tabla}" where id = $1`, [id]))[0];
    if (!e) throw new ElementoNoEncontradoError();
    return e;
  };
  const asociado = async (q: Queryable, id: string, sid: string) =>
    (await q.query<{ nivel: string | null }>(`select nivel from "${rel}" where ${col} = $1 and student_id = $2`, [id, sid]))[0];

  return {
    catalog(): Promise<ElementoCatalogo[]> {
      return db.query<ElementoCatalogo>(`select id, nombre from "${tabla}" order by nombre`);
    },

    async addToCatalog(actor: Actor, nombre: string): Promise<ElementoCatalogo> {
      if (typeof nombre !== 'string' || nombre.trim() === '') throw new DatosNoValidosError();
      const n = nombre.trim();
      return db.transaction(async (tx) => {
        const nuevo = (
          await tx.query<ElementoCatalogo>(
            `insert into "${tabla}" (nombre) values ($1) on conflict (nombre) do nothing returning id, nombre`,
            [n],
          )
        )[0];
        if (!nuevo) return (await tx.query<ElementoCatalogo>(`select id, nombre from "${tabla}" where nombre = $1`, [n]))[0]!;
        await audit.record({ actor, tabla, idRegistro: nuevo.id, operacion: 'INSERT', datosNuevos: nuevo }, tx);
        return nuevo;
      });
    },

    async listOwn(actor: Actor): Promise<ElementoAlumno[]> {
      const sid = await studentId(db, actor);
      return db.query<ElementoAlumno>(
        `select t.id, t.nombre, r.nivel from "${rel}" r join "${tabla}" t on t.id = r.${col}
         where r.student_id = $1 order by t.nombre`,
        [sid],
      );
    },

    async set(actor: Actor, id: string, nivel: string | null): Promise<ElementoAlumno> {
      if (nivel !== null && !(niveles as readonly unknown[]).includes(nivel)) throw new DatosNoValidosError();
      return db.transaction(async (tx) => {
        const sid = await studentId(tx, actor);
        const item = await existente(tx, id);
        const antes = await asociado(tx, id, sid);
        const despues = (
          await tx.query<{ nivel: string | null }>(
            `insert into "${rel}" (${col}, student_id, nivel) values ($1, $2, $3)
             on conflict (${col}, student_id) do update set nivel = excluded.nivel returning nivel`,
            [id, sid, nivel],
          )
        )[0]!;
        const res = { ...item, nivel: despues.nivel };
        await audit.record(
          {
            actor, tabla: rel, idRegistro: id, operacion: antes ? 'UPDATE' : 'INSERT',
            ...(antes ? { datosAnteriores: { [col]: id, student_id: sid, nivel: antes.nivel } } : {}),
            datosNuevos: { [col]: id, student_id: sid, nivel: despues.nivel },
          },
          tx,
        );
        return res;
      });
    },

    async remove(actor: Actor, id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const sid = await studentId(tx, actor);
        const antes = await asociado(tx, id, sid);
        if (!antes) throw new ElementoNoEncontradoError();
        await tx.query(`delete from "${rel}" where ${col} = $1 and student_id = $2`, [id, sid]);
        await audit.record(
          { actor, tabla: rel, idRegistro: id, operacion: 'DELETE', datosAnteriores: { [col]: id, student_id: sid, nivel: antes.nivel } },
          tx,
        );
      });
    },
  };
}
