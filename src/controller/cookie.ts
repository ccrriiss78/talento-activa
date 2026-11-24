export const SESSION_COOKIE_NAME = 'sesion';

export interface CookieOptions {
  /** Si se omite, se deduce de NODE_ENV === 'production'. */
  production?: boolean;
}

const TOKEN_SEGURO = /^[A-Za-z0-9_-]+$/;

function atributos(expires: Date, options: CookieOptions): string {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const partes = [`Expires=${expires.toUTCString()}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (production) partes.push('Secure');
  return partes.join('; ');
}

/** Set-Cookie de la sesión. El token solo viaja aquí (nunca en body ni URL). */
export function buildSessionCookie(token: string, expiresAt: Date, options: CookieOptions = {}): string {
  if (!TOKEN_SEGURO.test(token)) throw new Error('Token de sesión no válido para cookie');
  return `${SESSION_COOKIE_NAME}=${token}; ${atributos(expiresAt, options)}`;
}

/** Set-Cookie que borra la cookie de sesión (Expires en el pasado). */
export function clearSessionCookie(options: CookieOptions = {}): string {
  return `${SESSION_COOKIE_NAME}=; ${atributos(new Date(0), options)}`;
}
