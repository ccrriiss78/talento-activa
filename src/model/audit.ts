import type { Db, Queryable } from './db';

import type { Rol } from './actor';

export type Operacion = 'INSERT' | 'UPDATE' | 'DELETE';
const OPERACIONES: readonly string[] = ['INSERT', 'UPDATE', 'DELETE'];

/** Claves que jamás deben llegar a Audit_log (hash de contraseña, tokens). */
const CLAVES_PROHIBIDAS = new Set(['password', 'password_hash', 'token', 'token_sha256']);

export interface AuditEntry {
  actor: { id: string; rol?: Rol } | null; // null => lo genera el sistema
  tabla: string;
  idRegistro: string | null;
  operacion: Operacion;
  datosAnteriores?: unknown;
  datosNuevos?: unknown;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !CLAVES_PROHIBIDAS.has(k))
        .map(([k, v]) => [k, sanitize(v)]),
    );
  }
  return value;
}

const toJson = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(sanitize(value));

export function createAudit(db: Db) {
  return {
    async record(entry: AuditEntry, executor: Queryable = db): Promise<void> {
      if (!OPERACIONES.includes(entry.operacion)) {
        throw new Error(`Operación de auditoría no válida: ${String(entry.operacion)}`);
      }
      await executor.query(
        `insert into "Audit_log" (id_usuario, tabla, id_registro, operacion, datos_anteriores, datos_nuevos)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          entry.actor?.id ?? null,
          entry.tabla,
          entry.idRegistro,
          entry.operacion,
          toJson(entry.datosAnteriores),
          toJson(entry.datosNuevos),
        ],
      );
    },
  };
}
