/**
 * Adapter del contratto Logger: una riga JSON per evento su stdout (stderr per gli
 * errori), leggibile da strumenti di raccolta log. Rete di sicurezza per la privacy:
 * i campi con nomi sensibili vengono oscurati anche se un chiamante li passa per errore.
 */
import type { LogFields, Logger, LogLevel } from '../shared/logger';

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitive = /password|token|secret|cookie|csrf|email|consumption|content|payload|dataurl|value/i;

export function createJsonLogger(options: { minLevel?: LogLevel; write?: (line: string, level: LogLevel) => void } = {}): Logger {
  const minLevel = options.minLevel ?? 'info';
  const write = options.write ?? ((line, level) => (level === 'error' ? process.stderr : process.stdout).write(line + '\n'));
  return {
    log(level: LogLevel, event: string, fields: LogFields = {}) {
      if (order[level] < order[minLevel]) return;
      const safe: LogFields = {};
      for (const [key, value] of Object.entries(fields)) safe[key] = sensitive.test(key) ? '[redacted]' : value;
      write(JSON.stringify({ ts: new Date().toISOString(), level, service: 'nutritrack-api', event, ...safe }), level);
    },
  };
}
