import type { Clock } from '../shared/contracts';
import type { Logger } from '../shared/logger';
import type { UnitOfWork } from '../shared/unit-of-work';
import type { ClaimedNotification, NotificationKind, NotificationOutbox } from '../modules/notifications/public';

export type MailStatus = 'disabled' | 'ok' | 'degraded';
export const breakerThreshold = 3;
export const breakerOpenMs = 60_000;
const sendTimeoutMs = 10_000;
const notificationsPerCycle = 10;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('NotificationSendTimeout')), sendTimeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class NotificationDispatcher {
  private running: Promise<void> | null = null;
  private stopped = false;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly outbox: NotificationOutbox,
    private readonly kinds: NotificationKind[],
    private readonly isCurrent: (item: ClaimedNotification) => Promise<boolean>,
    private readonly send: (item: ClaimedNotification) => Promise<void>,
    private readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  configured(kind: NotificationKind): boolean {
    return this.kinds.includes(kind);
  }

  status(): MailStatus {
    if (this.kinds.length === 0) return 'disabled';
    return this.consecutiveFailures === 0 ? 'ok' : 'degraded';
  }

  kick(): void {
    void this.dispatch().catch(() => this.logger.log('error', 'notification.dispatch_failed'));
  }

  dispatch(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.running) this.running = this.cycle().finally(() => { this.running = null; });
    return this.running;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.running?.catch(() => undefined);
  }

  private async cycle(): Promise<void> {
    // La scadenza viene applicata anche quando il provider è disattivato o il circuito è aperto.
    await this.unitOfWork.run(() => this.outbox.deleteExpired());
    if (this.kinds.length === 0 || this.clock() < this.openUntil) return;

    for (let count = 0; count < notificationsPerCycle && !this.stopped; count++) {
      const item = await this.unitOfWork.run(async () => {
        const claimed = await this.outbox.claim(this.kinds);
        if (!claimed || await this.isCurrent(claimed)) return claimed;
        await this.outbox.complete(claimed);
        return undefined;
      });
      if (item === null) return;
      if (item === undefined) continue;

      if (!await this.deliver(item)) return;
    }
  }

  private async deliver(item: ClaimedNotification): Promise<boolean> {
    const fields = { notificationId: item.id, kind: item.payload.kind, attempts: item.attempts + 1 };
    try {
      await withTimeout(this.send(item));
    } catch {
      this.consecutiveFailures++;
      const outcome = await this.unitOfWork.run(() => this.outbox.fail(item));
      if (outcome !== 'stale') {
        this.logger.log(outcome === 'dropped' ? 'error' : 'warn',
          outcome === 'dropped' ? 'notification.dropped' : 'notification.retry_scheduled', fields);
      }
      if (this.consecutiveFailures < breakerThreshold) return true;

      this.openUntil = this.clock() + breakerOpenMs;
      this.logger.log('error', 'notification.circuit_open', { failures: this.consecutiveFailures, retryInMs: breakerOpenMs });
      return false;
    }

    this.consecutiveFailures = 0;
    this.openUntil = 0;
    // Il provider è già stato contattato. Se il commit fallisce, la presa in carico
    // scadrà e il mittente riuserà la stessa chiave di idempotenza.
    await this.unitOfWork.run(() => this.outbox.complete(item));
    this.logger.log('info', 'notification.sent', fields);
    return true;
  }
}
