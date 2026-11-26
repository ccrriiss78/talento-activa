import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditLike } from './audit';
import { DatosNoValidosError } from './password';
import { FichaNoEncontradaError } from './student-profile';

export class ProyectoNoEncontradoError extends Error {
  constructor() {
    super('Proyecto no encontrado');
    this.name = 'ProyectoNoEncontradoError';
  }
}

export interface Proyecto {
  id: string;
  student_id: string;
  titulo: string;
  descripcion: string | null;
  url: string;
  thumbnail_url: string | null;
  created_at: Date | string;
}

export type DatosProyecto = Partial<Pick<Proyecto, 'titulo' | 'descripcion' | 'url' | 'thumbnail_url'>>;

const COLUMNAS = 'id, student_id, titulo, descripcion, url, thumbnail_url, created_at';
const esTexto = (v: unknown): v is string => typeof v === 'string';
const esHttp = (v: string) => {
  if (!/^https?:\/\/\S+$/i.test(v)) return false;
  try {
    return Boolean(new URL(v).hostname);
  } catch {
    return false;
  }
};

/** Valida y normaliza. `completo` = alta (titulo y url obligatorios). */
function validar(input: unknown, completo: boolean): Record<string, string | null> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DatosNoValidosError();
  const i = input as Record<string, unknown>;
  const out: Record<string, string | null> = {};
  const requerido = (k: 'titulo' | 'url', ok: (s: string) => boolean) => {
    const v = i[k];
    if (v === undefined) return;
    if (!esTexto(v) || !ok(v.trim())) throw new DatosNoValidosError();
    out[k] = v.trim();
  };
  const opcional = (k: 'descripcion' | 'thumbnail_url', ok: (s: string) => boolean) => {
    const v = i[k];
    if (v === undefined) return;
    if (v === null) out[k] = null;
    else if (esTexto(v) && ok(v.trim())) out[k] = v.trim();
    else throw new DatosNoValidosError();
  };
  requerido('titulo', (s) => s !== '');
  requerido('url', esHttp);
  if (i.titulo === null || i.url === null) throw new DatosNoValidosError();
  opcional('descripcion', () => true);
  opcional('thumbnail_url', esHttp);
  if (completo && (out.titulo === undefined || out.url === undefined)) throw new DatosNoValidosError();
  if (Object.keys(out).length === 0) throw new DatosNoValidosError();
  return out;
}

/** Proyectos del alumno autenticado: solo puede ver y tocar los suyos. */
export function createProjectModel(db: Db, audit: AuditLike) {
  const studentId = async (q: Queryable, actor: Actor): Promise<string> => {
    if (actor.rol !== 'ALUMNO') throw new FichaNoEncontradaError();
    const s = (await q.query<{ id: string }>('select id from "Student" where user_id = $1', [actor.id]))[0];
    if (!s) throw new FichaNoEncontradaError();
    return s.id;
  };
  const propio = async (q: Queryable, id: string, sid: string) => {
    const p = (await q.query<Proyecto>(`select ${COLUMNAS} from "Project" where id = $1 and student_id = $2`, [id, sid]))[0];
    if (!p) throw new ProyectoNoEncontradoError();
    return p;
  };

  return {
    async list(actor: Actor): Promise<Proyecto[]> {
      const sid = await studentId(db, actor);
      return db.query<Proyecto>(`select ${COLUMNAS} from "Project" where student_id = $1 order by created_at`, [sid]);
    },

    async create(actor: Actor, input: DatosProyecto): Promise<Proyecto> {
      const v = validar(input, true);
      return db.transaction(async (tx) => {
        const sid = await studentId(tx, actor);
        const p = (
          await tx.query<Proyecto>(
            `insert into "Project" (student_id, titulo, descripcion, url, thumbnail_url)
             values ($1, $2, $3, $4, $5) returning ${COLUMNAS}`,
            [sid, v.titulo, v.descripcion ?? null, v.url, v.thumbnail_url ?? null],
          )
        )[0]!;
        await audit.record({ actor, tabla: 'Project', idRegistro: p.id, operacion: 'INSERT', datosNuevos: p }, tx);
        return p;
      });
    },

    async update(actor: Actor, id: string, input: DatosProyecto): Promise<Proyecto> {
      const v = validar(input, false);
      const campos = Object.keys(v);
      return db.transaction(async (tx) => {
        const sid = await studentId(tx, actor);
        const antes = await propio(tx, id, sid);
        const p = (
          await tx.query<Proyecto>(
            `update "Project" set ${campos.map((c, n) => `${c} = $${n + 3}`).join(', ')}
             where id = $1 and student_id = $2 returning ${COLUMNAS}`,
            [id, sid, ...campos.map((c) => v[c])],
          )
        )[0]!;
        await audit.record(
          { actor, tabla: 'Project', idRegistro: id, operacion: 'UPDATE', datosAnteriores: antes, datosNuevos: p },
          tx,
        );
        return p;
      });
    },

    async remove(actor: Actor, id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const sid = await studentId(tx, actor);
        const antes = await propio(tx, id, sid);
        await tx.query('delete from "Project" where id = $1 and student_id = $2', [id, sid]);
        await audit.record({ actor, tabla: 'Project', idRegistro: id, operacion: 'DELETE', datosAnteriores: antes }, tx);
      });
    },
  };
}
