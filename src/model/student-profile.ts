import type { Db, Queryable } from './db';
import type { Actor } from './actor';
import type { AuditEntry } from './audit';
import { DatosNoValidosError } from './password';

export class FichaNoEncontradaError extends Error {
  constructor() {
    super('Ficha no encontrada');
    this.name = 'FichaNoEncontradaError';
  }
}

export interface Ficha {
  id: string;
  user_id: string;
  edition_id: string;
  nombre: string;
  foto_url: string | null;
  bio: string | null;
  ubicacion: string | null;
  disponibilidad_traslado: boolean;
  modalidad: 'remoto' | 'presencial' | 'hibrido' | null;
  estado_laboral: 'buscando' | 'trabajando' | null;
  cv_url: string | null;
  linkedin: string | null;
  github: string | null;
  estado: 'activo' | 'inactivo';
  privacy: Record<string, boolean>;
  filled_at: Date | string | null;
}

export type CambiosFicha = Partial<
  Pick<
    Ficha,
    | 'nombre' | 'foto_url' | 'bio' | 'ubicacion' | 'disponibilidad_traslado'
    | 'modalidad' | 'estado_laboral' | 'cv_url' | 'linkedin' | 'github' | 'privacy'
  >
>;

interface AuditLike {
  record(entry: AuditEntry, executor?: Queryable): Promise<void>;
}

const COLUMNAS =
  'id, user_id, edition_id, nombre, foto_url, bio, ubicacion, disponibilidad_traslado, modalidad, estado_laboral, cv_url, linkedin, github, estado, privacy, filled_at';

/** Campos de la ficha cuya visibilidad controla `privacy` (el nombre siempre es visible). */
export const CAMPOS_PRIVACIDAD = [
  'foto_url', 'bio', 'ubicacion', 'disponibilidad_traslado', 'modalidad',
  'estado_laboral', 'cv_url', 'linkedin', 'github',
] as const;

const TEXTO_LIBRE = ['bio', 'ubicacion'] as const;
const ENLACES = ['foto_url', 'cv_url', 'linkedin', 'github'] as const;
const MODALIDADES = ['remoto', 'presencial', 'hibrido'];
const ESTADOS_LABORALES = ['buscando', 'trabajando'];

const esTexto = (v: unknown): v is string => typeof v === 'string';
const esHttp = (v: string) => /^https?:\/\/\S+$/i.test(v);

function validar(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nulable = (k: string, v: unknown, ok: (s: string) => boolean) => {
    if (v === null) out[k] = null;
    else if (esTexto(v) && ok(v.trim())) out[k] = v.trim();
    else throw new DatosNoValidosError();
  };
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === 'nombre') {
      if (!esTexto(v) || v.trim() === '') throw new DatosNoValidosError();
      out[k] = v.trim();
    } else if ((TEXTO_LIBRE as readonly string[]).includes(k)) nulable(k, v, () => true);
    else if ((ENLACES as readonly string[]).includes(k)) nulable(k, v, esHttp);
    else if (k === 'modalidad') nulable(k, v, (s) => MODALIDADES.includes(s));
    else if (k === 'estado_laboral') nulable(k, v, (s) => ESTADOS_LABORALES.includes(s));
    else if (k === 'disponibilidad_traslado') {
      if (typeof v !== 'boolean') throw new DatosNoValidosError();
      out[k] = v;
    } else if (k === 'privacy') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DatosNoValidosError();
      for (const [campo, visible] of Object.entries(v)) {
        if (!(CAMPOS_PRIVACIDAD as readonly string[]).includes(campo) || typeof visible !== 'boolean') {
          throw new DatosNoValidosError();
        }
      }
      out[k] = JSON.stringify(v);
    }
    // cualquier otra clave (estado, user_id, edition_id…) se ignora: no es editable por el alumno
  }
  if (Object.keys(out).length === 0) throw new DatosNoValidosError();
  return out;
}

export function createStudentProfileModel(db: Db, audit: AuditLike) {
  const leer = async (q: Queryable, userId: string) =>
    (await q.query<Ficha>(`select ${COLUMNAS} from "Student" where user_id = $1`, [userId]))[0];

  return {
    /** Ficha del propio alumno autenticado. */
    async getOwn(actor: Actor): Promise<Ficha> {
      if (actor.rol !== 'ALUMNO') throw new FichaNoEncontradaError();
      const f = await leer(db, actor.id);
      if (!f) throw new FichaNoEncontradaError();
      return f;
    },

    /** Edita la ficha propia (solo campos editables), marca `filled_at` y audita. */
    async updateOwn(actor: Actor, input: CambiosFicha): Promise<Ficha> {
      if (actor.rol !== 'ALUMNO') throw new FichaNoEncontradaError();
      const v = validar((input ?? {}) as Record<string, unknown>);
      const campos = Object.keys(v);
      return db.transaction(async (tx) => {
        const antes = await leer(tx, actor.id);
        if (!antes) throw new FichaNoEncontradaError();
        const sets = campos.map((c, i) => `${c} = $${i + 2}${c === 'privacy' ? '::jsonb' : ''}`);
        sets.push('filled_at = coalesce(filled_at, now())');
        const f = (
          await tx.query<Ficha>(
            `update "Student" set ${sets.join(', ')} where id = $1 returning ${COLUMNAS}`,
            [antes.id, ...campos.map((c) => v[c])],
          )
        )[0]!;
        await audit.record(
          { actor, tabla: 'Student', idRegistro: antes.id, operacion: 'UPDATE', datosAnteriores: antes, datosNuevos: f },
          tx,
        );
        return f;
      });
    },
  };
}
