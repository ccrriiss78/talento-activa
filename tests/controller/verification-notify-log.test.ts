import { describe, it, expect, vi, afterEach } from 'vitest';
import { notificarVerificacion } from '../../src/controller/verification-notify';

afterEach(() => vi.restoreAllMocks());

describe('notificarVerificacion: fallo del proveedor (hallazgo 2 revisión 2026-11-26)', () => {
  it('no rompe el alta y registra un log genérico con el id, sin email ni detalles del proveedor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sender = { sendTo: vi.fn(async () => { throw new Error('smtp secreto token=abc a@x.es'); }) };
    await expect(notificarVerificacion({ verificationSender: sender }, { id: 'u1', email: 'a@x.es' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const texto = JSON.stringify(warn.mock.calls);
    expect(texto).toContain('u1');
    expect(texto).not.toContain('a@x.es');
    expect(texto).not.toContain('secreto');
    expect(texto).not.toContain('abc');
  });
});
