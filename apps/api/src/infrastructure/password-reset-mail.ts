import { createHash } from 'node:crypto';
import type { PasswordResetDelivery } from '../modules/identity/public';

export type PasswordResetSender = (delivery: PasswordResetDelivery) => Promise<void>;
export interface InvitationDelivery { email: string; nutritionistName: string; nutritionistEmail: string }
export type InvitationNotifier = (delivery: InvitationDelivery, deliveryKey?: string) => Promise<void>;

interface MailSettings { apiKey: string; from: string; publicUrl: URL }
interface Mail { to: string; subject: string; text: string; idempotencyKey: string }

function publicAppUrl(env: NodeJS.ProcessEnv, appUrl: string): URL {
  const publicUrl = new URL(appUrl);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') ||
      publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
    throw new Error('PUBLIC_APP_URL deve essere l’URL pubblico dell’app senza credenziali, query o frammento (HTTPS in produzione).');
  }
  return publicUrl;
}

function settings(env: NodeJS.ProcessEnv): MailSettings | undefined {
  const { RESEND_API_KEY: apiKey, PASSWORD_RESET_FROM: from, PUBLIC_APP_URL: appUrl } = env;
  if (!apiKey || !from || !appUrl) return undefined;
  return { apiKey, from, publicUrl: publicAppUrl(env, appUrl) };
}

/**
 * Modalità solo locale: senza provider configurato, il messaggio viene scritto nel
 * terminale del server. Va attivata esplicitamente e non è mai disponibile in produzione.
 */
function consoleMode(env: NodeJS.ProcessEnv): URL | undefined {
  if (env.NODE_ENV === 'production' || env.MAIL_CONSOLE !== 'true') return undefined;
  return publicAppUrl(env, env.PUBLIC_APP_URL || 'http://localhost:3000/');
}

async function sendWithResend({ apiKey, from }: MailSettings, mail: Mail): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': mail.idempotencyKey },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Invio email rifiutato dal provider (HTTP ${response.status}).`);
}

function mailer(env: NodeJS.ProcessEnv): { publicUrl: URL; send: (mail: Mail) => Promise<void> } | undefined {
  const resend = settings(env);
  if (resend) return { publicUrl: resend.publicUrl, send: mail => sendWithResend(resend, mail) };
  const local = consoleMode(env);
  if (local) return { publicUrl: local, send: async mail => { console.log(`[MAIL_CONSOLE] A: ${mail.to}\nOggetto: ${mail.subject}\n${mail.text}\n`); } };
  return undefined;
}

export function createPasswordResetSender(env: NodeJS.ProcessEnv): PasswordResetSender | undefined {
  const mail = mailer(env);
  if (!mail) return undefined;
  return async ({ email, token }) => {
    const resetUrl = new URL(mail.publicUrl);
    resetUrl.hash = new URLSearchParams({ resetToken: token }).toString();
    await mail.send({
      to: email,
      subject: 'Reimposta la password di NutriTrack',
      text: `Apri questo link per scegliere una nuova password. Il link scade dopo 30 minuti.\n\n${resetUrl.href}\n\nSe non hai richiesto il recupero, puoi ignorare questa email.`,
      idempotencyKey: `password-reset/${createHash('sha256').update(token).digest('hex')}`,
    });
  };
}

/** Avvisa il Patient che un invito lo attende nell'app. Nessun link: si accetta dall'app. */
export function createInvitationNotifier(env: NodeJS.ProcessEnv): InvitationNotifier | undefined {
  const mail = mailer(env);
  if (!mail) return undefined;
  return async ({ email, nutritionistName, nutritionistEmail }, deliveryKey) => {
    await mail.send({
      to: email,
      subject: 'Hai ricevuto un invito su NutriTrack',
      text: `${nutritionistName} (${nutritionistEmail}) ti ha invitato a collegare il tuo account NutriTrack.\n\nAccedi a ${mail.publicUrl.href} e apri «Condivisione e inviti» per accettare o rifiutare. Controlla che l’email del nutrizionista sia quella che conosci.\n\nSe non conosci questa persona, rifiuta l’invito.`,
      idempotencyKey: `invitation/${createHash('sha256').update(`${email}|${nutritionistEmail}|${deliveryKey ?? new Date().toISOString().slice(0, 13)}`).digest('hex')}`,
    });
  };
}
