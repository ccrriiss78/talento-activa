/** Envío de la verificación de email tras un alta (dependencia opcional e inyectable). */
export interface VerificationNotifyDeps {
  verificationSender?: { sendTo(user: { id: string; email: string }): Promise<void> };
}

/**
 * Envía el enlace de verificación a una cuenta recién creada. La cuenta ya existe, así que un
 * fallo del proveedor de email no debe convertir el alta en error: se registra un aviso genérico y el alta sigue adelante.
 */
export async function notificarVerificacion(
  deps: VerificationNotifyDeps,
  user: { id: string; email: string } | null,
): Promise<void> {
  if (!deps.verificationSender || !user) return;
  try {
    await deps.verificationSender.sendTo({ id: user.id, email: user.email });
  } catch {
    // Log genérico: solo el id de usuario, sin email, token ni detalles del proveedor.
    console.warn(`No se pudo enviar el email de verificación (user_id=${user.id})`);
  }
}
