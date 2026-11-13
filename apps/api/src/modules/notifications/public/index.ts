/** Conserva le notifiche fino all'invio o alla scadenza. */
import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../shared/contracts';

export type NotificationKind = 'PASSWORD_RESET' | 'INVITATION';
export type NotificationPayload =
  | { kind: 'PASSWORD_RESET'; recipientId: string; email: string; token: string }
  | { kind: 'INVITATION'; recipientId: string; senderId: string; invitationId: string; email: string; nutritionistName: string; nutritionistEmail: string };

export interface OutboxItem {
  id: string;
  payload: NotificationPayload;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number;
}
export interface ClaimedNotification extends OutboxItem {
  leaseId: string;
  leaseUntil: number;
}

type PendingNotification = { id: string; kind: NotificationKind; attempts: number; nextAttemptAt: number };

export interface NotificationRepository {
  add(item: OutboxItem): Promise<void>;
  claimDue(kinds: NotificationKind[], now: number, leaseId: string, leaseUntil: number): Promise<ClaimedNotification | null>;
  deleteExpired(now: number): Promise<void>;
  deleteForAccount(accountId: string): Promise<void>;
  complete(id: string, leaseId: string): Promise<boolean>;
  reschedule(id: string, leaseId: string, attempts: number, nextAttemptAt: number): Promise<boolean>;
  pending(): Promise<PendingNotification[]>;
}

export const maxAttempts = 8;
const leaseMs = 60_000;
export const retryDelay = (attempt: number) => Math.min(600_000, 5_000 * 2 ** (attempt - 1));

export class NotificationOutbox {
  constructor(private readonly repo: NotificationRepository, private readonly clock: Clock) {}

  async enqueue(payload: NotificationPayload, ttlMs: number): Promise<void> {
    const now = this.clock();
    await this.repo.add({ id: randomUUID(), payload, expiresAt: now + ttlMs, attempts: 0, nextAttemptAt: now });
  }

  deleteExpired(): Promise<void> {
    return this.repo.deleteExpired(this.clock());
  }

  claim(kinds: NotificationKind[]): Promise<ClaimedNotification | null> {
    const now = this.clock();
    return this.repo.claimDue(kinds, now, randomUUID(), now + leaseMs);
  }

  complete({ id, leaseId }: ClaimedNotification): Promise<boolean> {
    return this.repo.complete(id, leaseId);
  }

  async fail(item: ClaimedNotification): Promise<'retry' | 'dropped' | 'stale'> {
    const attempts = item.attempts + 1;
    const next = this.clock() + retryDelay(attempts);
    if (attempts >= maxAttempts || next >= item.expiresAt) {
      return await this.complete(item) ? 'dropped' : 'stale';
    }
    return await this.repo.reschedule(item.id, item.leaseId, attempts, next) ? 'retry' : 'stale';
  }

  deleteForAccount(accountId: string): Promise<void> {
    return this.repo.deleteForAccount(accountId);
  }

  pending(): Promise<PendingNotification[]> {
    return this.repo.pending();
  }
}
