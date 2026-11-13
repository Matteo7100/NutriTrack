/**
 * Strategy GoF: il contesto sceglie la policy e le delega l'algoritmo di retry.
 * Le implementazioni sono sostituibili: nessuna modifica al motore è necessaria.
 * Queste policy non risolvono conflitti di dominio né allentano le regole server.
 */
import { ApiError } from '../api';
import type { Queued, QueueStatus } from './types';
export interface RetryDecision { status: QueueStatus; nextAttempt: number; stopBatch: boolean }
export interface RetryStrategy { decide(error: unknown, attempts: number, now: number): RetryDecision }
export class BackoffRetryStrategy implements RetryStrategy {
  decide(_error: unknown, attempts: number, now: number): RetryDecision {
    // attempts è già incrementato; il ritardo esponenziale si ferma a 60 secondi.
    return { status: 'PENDING', nextAttempt: now + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)), stopBatch: false };
  }
}
export class WaitForLoginStrategy implements RetryStrategy {
  decide(_error: unknown, _attempts: number, now: number): RetryDecision {
    return { status: 'AUTH_REQUIRED', nextAttempt: now, stopBatch: true };
  }
}
export class StopRetryStrategy implements RetryStrategy {
  decide(error: unknown, _attempts: number, now: number): RetryDecision {
    return { status: error instanceof ApiError && error.status === 409 ? 'CONFLICT' : 'REJECTED', nextAttempt: now, stopBatch: false };
  }
}
export interface RetryPolicies { backoff: RetryStrategy; waitForLogin: RetryStrategy; stop: RetryStrategy }
export class RetryContext {
  private readonly policies: RetryPolicies;
  constructor(policies: Partial<RetryPolicies> = {}) {
    this.policies = { backoff: new BackoffRetryStrategy(), waitForLogin: new WaitForLoginStrategy(), stop: new StopRetryStrategy(), ...policies };
  }
  select(error: unknown): RetryStrategy {
    if (error instanceof ApiError) {
      if (error.status === 401) return this.policies.waitForLogin;
      // Token CSRF di una sessione sostituita (login in un'altra scheda): il flush
      // successivo rilegge il token da /auth/me, quindi è un errore transitorio.
      if (error.status === 403 && error.code === 'CsrfError') return this.policies.backoff;
      if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) return this.policies.stop;
    }
    return this.policies.backoff;
  }
  failure(item: Queued, error: unknown, now: number): { item: Queued; stopBatch: boolean } {
    const attempts = item.attempts + 1;
    const decision = this.select(error).decide(error, attempts, now);
    return {
      item: { ...item, status: decision.status, attempts, nextAttempt: decision.nextAttempt, error: error instanceof Error ? error.message : 'Connessione non disponibile.' },
      stopBatch: decision.stopBatch,
    };
  }
}
