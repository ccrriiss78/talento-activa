import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditEntry } from './audit';
import { DatosNoValidosError } from './password';

export interface Edition {
  id: string;
  nombre: string;
  anio: number;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado: 'abierta' | 'cerrada';
}
export interface NuevaEdicion {
  nombre: string;
  anio: number;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
}
export type CambiosEdicion = Partial<NuevaEdicion>;

interface AuditLike {
  record(entry: AuditEntry, executor?: Queryable): Promise<void>;
}

export class EdicionNoEncontradaError extends Error {
  constructor() {
    super('Edición no encontrada');
    this.name = 'EdicionNoEncontradaError';
  }
}
export class EdicionCerradaError extends Error {
  constructor() {
    super('La edición está cerrada');
    this.name = 'EdicionCerradaError';
  }
}

const COLUMNAS = 'id, nombre, anio, fecha_inicio, fecha_fin, estado';
const CAMPOS = ['nombre', 'anio', 'fecha_inicio', 'fecha_fin'] as const;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const fechaValida = (v: unknown) =>
  v === null || (typeof v === 'string' && FECHA_RE.test(v) && !Number.isNaN(Date.parse(v)));

/** Valida los campos presentes; devuelve el subconjunto limpio. */
function validar(input: CambiosEdicion): CambiosEdicion {
  const out: CambiosEdicion = {};
  if (input.nombre !== undefined) {
    if (typeof input.nombre !== 'string' || input.nombre.trim() === '') throw new DatosNoValidosError();
    out.nombre = input.nombre.trim();
  }
  if (input.anio !== undefined) {
    if (!Number.isInteger(input.anio) || input.anio < 2000 || input.anio > 2200) throw new DatosNoValidosError();
    out.anio = input.anio;
  }
  for (const f of ['fecha_inicio', 'fecha_fin'] as const) {
    if (input[f] !== undefined) {
      if (!fechaValida(input[f])) throw new DatosNoValidosError();
      out[f] = input[f];
    }
  }
  return out;
}

const coherente = (ini?: string | null, fin?: string | null) => !(ini && fin && fin < ini);

export function createEditionModel(db: Db, audit: AuditLike) {
  const leer = async (ex: Queryable, id: string) =>
    (await ex.query<Edition>(`select ${COLUMNAS} from "Edition" where id = $1`, [id]))[0] ?? null;

  return {
    async create(actor: Actor, input: NuevaEdicion): Promise<Edition> {
      if (input.nombre === undefined || input.anio === undefined) throw new DatosNoValidosError();
      const v = validar(input);
      if (!coherente(v.fecha_inicio, v.fecha_fin)) throw new DatosNoValidosError();
      return db.transaction(async (tx) => {
        const e = (
          await tx.query<Edition>(
            `insert into "Edition" (nombre, anio, fecha_inicio, fecha_fin, estado)
             values ($1, $2, $3, $4, 'abierta') returning ${COLUMNAS}`,
            [v.nombre, v.anio, v.fecha_inicio ?? null, v.fecha_fin ?? null],
          )
        )[0]!;
        await audit.record({ actor, tabla: 'Edition', idRegistro: e.id, operacion: 'INSERT', datosNuevos: e }, tx);
        return e;
      });
    },

    list(): Promise<Edition[]> {
      return db.query<Edition>(`select ${COLUMNAS} from "Edition" order by anio desc, nombre`);
    },

    get(id: string): Promise<Edition | null> {
      return leer(db, id);
    },

    async update(actor: Actor, id: string, input: CambiosEdicion): Promise<Edition> {
      const v = validar(input ?? {});
      const campos = CAMPOS.filter((c) => v[c] !== undefined);
      if (campos.length === 0) throw new DatosNoValidosError();
      return db.transaction(async (tx) => {
        const antes = await leer(tx, id);
        if (!antes) throw new EdicionNoEncontradaError();
        if (antes.estado === 'cerrada') throw new EdicionCerradaError();
        if (!coherente(v.fecha_inicio ?? antes.fecha_inicio, v.fecha_fin ?? antes.fecha_fin)) {
          throw new DatosNoValidosError();
        }
        const sets = campos.map((c, i) => `${c} = $${i + 2}`).join(', ');
        const e = (
          await tx.query<Edition>(`update "Edition" set ${sets} where id = $1 returning ${COLUMNAS}`, [
            id,
            ...campos.map((c) => v[c]),
          ])
        )[0]!;
        await audit.record(
          { actor, tabla: 'Edition', idRegistro: id, operacion: 'UPDATE', datosAnteriores: antes, datosNuevos: e },
          tx,
        );
        return e;
      });
    },

    /** Cierra la edición (idempotente: si ya estaba cerrada no muta ni audita). */
    async close(actor: Actor, id: string): Promise<Edition> {
      return db.transaction(async (tx) => {
        const antes = await leer(tx, id);
        if (!antes) throw new EdicionNoEncontradaError();
        if (antes.estado === 'cerrada') return antes;
        const e = (
          await tx.query<Edition>(`update "Edition" set estado = 'cerrada' where id = $1 returning ${COLUMNAS}`, [id])
        )[0]!;
        await audit.record(
          {
            actor,
            tabla: 'Edition',
            idRegistro: id,
            operacion: 'UPDATE',
            datosAnteriores: { estado: 'abierta' },
            datosNuevos: { estado: 'cerrada' },
          },
          tx,
        );
        return e;
      });
    },
  };
}
