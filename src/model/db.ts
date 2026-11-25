import pg from 'pg';

export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
  connect?(): Promise<ClientLike>;
}

export interface ClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(): void;
}

/** Ejecutor de consultas: el pool (Db) o una transacción. */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** BEGIN/COMMIT/ROLLBACK sobre un mismo cliente del pool. */
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  env?: Record<string, string | undefined>;
  poolFactory?: (connectionString: string) => PoolLike;
}

const defaultPoolFactory = (connectionString: string): PoolLike =>
  new pg.Pool({ connectionString }) as unknown as PoolLike;

/** Cliente de datos: conexión directa a Postgres (omite RLS). La URL viene del entorno. */
export function createDb(options: CreateDbOptions = {}): Db {
  const env = options.env ?? process.env;
  const url = env.DATABASE_URL;
  if (!url) throw new Error('Falta la variable de entorno DATABASE_URL');
  const pool = (options.poolFactory ?? defaultPoolFactory)(url);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[];
    },
    async transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R> {
      if (!pool.connect) throw new Error('El pool no admite transacciones');
      const client = await pool.connect();
      const tx: Queryable = {
        async query<T>(text: string, params: unknown[] = []) {
          return (await client.query(text, params)).rows as T[];
        },
      };
      try {
        await client.query('BEGIN', []);
        const result = await fn(tx);
        await client.query('COMMIT', []);
        return result;
      } catch (e) {
        await client.query('ROLLBACK', []).catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async ping() {
      const rows = await pool.query('select 1 as ok', []);
      return rows.rows.length === 1;
    },
    close: () => pool.end(),
  };
}
