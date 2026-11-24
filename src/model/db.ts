import pg from 'pg';

export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
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
    async ping() {
      const rows = await pool.query('select 1 as ok', []);
      return rows.rows.length === 1;
    },
    close: () => pool.end(),
  };
}
