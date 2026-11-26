import type { Context } from 'hono';

/**
 * Manejador global de errores (`app.onError`). Un `:id` que no es uuid hace que Postgres
 * lance 22P02 (invalid_text_representation): se responde 404 como "no encontrado". El resto
 * son 500 genéricos que no filtran el mensaje interno.
 */
export function manejarErrores(err: Error, c: Context) {
  if ((err as { code?: string }).code === '22P02') return c.json({ error: 'No encontrado' }, 404);
  console.error(err);
  return c.json({ error: 'Error interno' }, 500);
}
