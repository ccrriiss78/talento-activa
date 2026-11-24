import { describe, it, expect } from 'vitest';
import { buildSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from '../../src/controller/cookie';

const EXPIRES = new Date('2026-02-01T12:30:00Z');

describe('cookie de sesión', () => {
  it('se llama "sesion"', () => {
    expect(SESSION_COOKIE_NAME).toBe('sesion');
  });

  it('lleva el token, HttpOnly, SameSite=Lax y Path=/', () => {
    const c = buildSessionCookie('tok_abc-123', EXPIRES, { production: false });
    expect(c.startsWith('sesion=tok_abc-123;')).toBe(true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
  });

  it('usa Expires absoluto (HTTP-date) y nunca Max-Age', () => {
    const c = buildSessionCookie('t', EXPIRES, { production: false });
    expect(c).toContain('Expires=Sun, 01 Feb 2026 12:30:00 GMT');
    expect(c).not.toMatch(/max-age/i);
  });

  it('Secure solo en producción', () => {
    expect(buildSessionCookie('t', EXPIRES, { production: true })).toContain('Secure');
    expect(buildSessionCookie('t', EXPIRES, { production: false })).not.toContain('Secure');
  });

  it('por defecto deduce producción de NODE_ENV', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(buildSessionCookie('t', EXPIRES)).toContain('Secure');
      process.env.NODE_ENV = 'test';
      expect(buildSessionCookie('t', EXPIRES)).not.toContain('Secure');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('limpiar la cookie: valor vacío, Expires en el pasado, mismos flags', () => {
    const c = clearSessionCookie({ production: true });
    expect(c.startsWith('sesion=;')).toBe(true);
    expect(c).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Secure');
    expect(c).not.toMatch(/max-age/i);
  });

  it('rechaza tokens con caracteres no seguros para una cookie', () => {
    expect(() => buildSessionCookie('a;b', EXPIRES, { production: false })).toThrow();
    expect(() => buildSessionCookie('a b', EXPIRES, { production: false })).toThrow();
    expect(() => buildSessionCookie('', EXPIRES, { production: false })).toThrow();
  });
});
