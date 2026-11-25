import { describe, it, expect, vi } from 'vitest';
import { createVerificationSender } from '../../src/model/verification-mailer';

describe('envío del email de verificación', () => {
  const setup = (send = vi.fn(async () => {})) => {
    const exp = new Date('2026-01-03T00:00:00Z');
    const verification = { issue: vi.fn(async () => ({ token: 'T0K3N_x-y', expiresAt: exp })) };
    const sender = createVerificationSender({ verification, mailer: { send }, baseUrl: 'https://app.example/' });
    return { sender, send, verification, exp };
  };

  it('emite un token y envía al email un enlace con ese token', async () => {
    const { sender, send, verification } = setup();
    await sender.sendTo({ id: 'u1', email: 'a@b.es' });
    expect(verification.issue).toHaveBeenCalledWith('u1');
    expect(send).toHaveBeenCalledTimes(1);
    const msg = (send.mock.calls[0] as unknown as [any])[0];
    expect(msg.to).toBe('a@b.es');
    expect(msg.text).toContain('https://app.example/verificar-email?token=T0K3N_x-y');
  });

  it('si el envío falla, el error se propaga', async () => {
    const { sender } = setup(vi.fn(async () => { throw new Error('smtp'); }));
    await expect(sender.sendTo({ id: 'u1', email: 'a@b.es' })).rejects.toThrow('smtp');
  });
});
