/**
 * Contratto di logging strutturato condiviso: i moduli e la composizione emettono
 * eventi con nome stabile e campi semplici, senza dipendere dalla libreria di output.
 * Regola di privacy: mai password, token, email, contenuto dei pasti o misure nei campi.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
}

/** Logger muto: default per test e composizioni che non vogliono output. */
export const silentLogger: Logger = { log() { /* nessun output */ } };
