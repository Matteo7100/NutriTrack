import { createHash } from 'node:crypto';
import type { PasswordResetDelivery } from '../modules/identity/public';

export type PasswordResetSender = (delivery: PasswordResetDelivery) => Promise<void>;

export function createPasswordResetSender(env: NodeJS.ProcessEnv): PasswordResetSender | undefined {
  const { RESEND_API_KEY: apiKey, PASSWORD_RESET_FROM: from, PUBLIC_APP_URL: appUrl } = env;
  if (!apiKey || !from || !appUrl) return undefined;
  const publicUrl = new URL(appUrl);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') ||
      publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
    throw new Error('PUBLIC_APP_URL deve essere l’URL pubblico dell’app senza credenziali, query o frammento (HTTPS in produzione).');
  }
  return async ({ email, token }) => {
    const resetUrl = new URL(publicUrl);
    resetUrl.hash = new URLSearchParams({ resetToken: token }).toString();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `password-reset/${createHash('sha256').update(token).digest('hex')}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Reimposta la password di NutriTrack',
        text: `Apri questo link per scegliere una nuova password. Il link scade dopo 30 minuti.\n\n${resetUrl.href}\n\nSe non hai richiesto il recupero, puoi ignorare questa email.`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Invio email rifiutato dal provider (HTTP ${response.status}).`);
  };
}
