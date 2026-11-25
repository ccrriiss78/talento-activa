export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export interface VerificationSenderDeps {
  verification: { issue(userId: string): Promise<{ token: string; expiresAt: Date }> };
  mailer: Mailer;
  /** URL pública de la app (de entorno), sin credenciales. */
  baseUrl: string;
}

/** Emite el token de verificación y envía el enlace por email (proveedor inyectable). */
export function createVerificationSender(deps: VerificationSenderDeps) {
  const base = deps.baseUrl.replace(/\/+$/, '');
  return {
    async sendTo(user: { id: string; email: string }): Promise<void> {
      const { token } = await deps.verification.issue(user.id);
      const enlace = `${base}/verificar-email?token=${encodeURIComponent(token)}`;
      await deps.mailer.send({
        to: user.email,
        subject: 'Verifica tu email · Xarxatec Activa',
        text: `Verifica tu cuenta pulsando este enlace (caduca en 48 horas):\n${enlace}`,
      });
    },
  };
}
