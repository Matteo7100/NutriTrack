import type { NotificationOutboxEntry, Prisma } from '@prisma/client';
import type { ClaimedNotification, NotificationKind, NotificationRepository, OutboxItem } from '../modules/notifications/public';
import type { Repository } from '../shared/contracts';

type MemoryNotification = OutboxItem & { leaseId?: string; leaseUntil?: number };

export class MemoryNotificationRepository implements NotificationRepository {
  constructor(private readonly storage: Repository<MemoryNotification[]>) {}

  async add(item: OutboxItem) {
    const rows = await this.storage.get();
    await this.storage.save([...rows, item]);
  }

  async claimDue(kinds: NotificationKind[], now: number, leaseId: string, leaseUntil: number) {
    const rows = await this.storage.get();
    const row = rows.filter(item => kinds.includes(item.payload.kind) && item.expiresAt > now && item.nextAttemptAt <= now && (item.leaseUntil ?? 0) <= now)
      .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.id.localeCompare(right.id))[0];
    if (!row) return null;
    const claimed = { ...row, leaseId, leaseUntil };
    await this.storage.save(rows.map(item => item.id === row.id ? claimed : item));
    return claimed;
  }

  async deleteExpired(now: number) {
    const rows = await this.storage.get();
    const remaining = rows.filter(item => item.expiresAt > now || (item.leaseUntil ?? 0) > now);
    if (rows.length !== remaining.length) await this.storage.save(remaining);
  }

  async deleteForAccount(accountId: string) {
    const rows = await this.storage.get();
    const remaining = rows.filter(({ payload }) => payload.recipientId !== accountId &&
      (payload.kind !== 'INVITATION' || payload.senderId !== accountId));
    if (rows.length !== remaining.length) await this.storage.save(remaining);
  }

  async complete(id: string, leaseId: string) {
    const rows = await this.storage.get();
    const remaining = rows.filter(item => item.id !== id || item.leaseId !== leaseId);
    if (rows.length === remaining.length) return false;
    await this.storage.save(remaining);
    return true;
  }

  async reschedule(id: string, leaseId: string, attempts: number, nextAttemptAt: number) {
    const rows = await this.storage.get();
    const row = rows.find(item => item.id === id && item.leaseId === leaseId);
    if (!row) return false;
    row.attempts = attempts;
    row.nextAttemptAt = nextAttemptAt;
    delete row.leaseId;
    delete row.leaseUntil;
    await this.storage.save(rows);
    return true;
  }

  async pending() {
    return (await this.storage.get()).map(({ id, payload, attempts, nextAttemptAt }) => ({
      id, kind: payload.kind, attempts, nextAttemptAt,
    }));
  }
}

function fromRow(row: NotificationOutboxEntry, leaseId: string, leaseUntil: number): ClaimedNotification {
  const { kind, recipientId, email, token, senderId, invitationId, nutritionistName, nutritionistEmail } = row;
  const payload = kind === 'PASSWORD_RESET'
    ? { kind, recipientId, email, token: token! }
    : { kind, recipientId, senderId: senderId!, invitationId: invitationId!, email, nutritionistName: nutritionistName!, nutritionistEmail: nutritionistEmail! };
  return { id: row.id, payload, expiresAt: row.expiresAt.getTime(), attempts: row.attempts, nextAttemptAt: row.nextAttemptAt.getTime(), leaseId, leaseUntil };
}

export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly db: () => Prisma.TransactionClient['notificationOutboxEntry']) {}

  async add({ id, payload, expiresAt, attempts, nextAttemptAt }: OutboxItem) {
    await this.db().create({ data: { id, ...payload, expiresAt: new Date(expiresAt), attempts, nextAttemptAt: new Date(nextAttemptAt) } });
  }

  async claimDue(kinds: NotificationKind[], now: number, leaseId: string, leaseUntil: number) {
    const time = new Date(now);
    const db = this.db();
    const row = await db.findFirst({
      where: { kind: { in: kinds }, expiresAt: { gt: time }, nextAttemptAt: { lte: time }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: time } }] },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    });
    if (!row) return null;
    // La Unit of Work serializza la selezione e l'aggiornamento della presa in carico.
    await db.update({ where: { id: row.id }, data: { leaseId, leaseUntil: new Date(leaseUntil) } });
    return fromRow(row, leaseId, leaseUntil);
  }

  async deleteExpired(now: number) {
    const time = new Date(now);
    await this.db().deleteMany({ where: { expiresAt: { lte: time }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: time } }] } });
  }

  async deleteForAccount(accountId: string) {
    await this.db().deleteMany({ where: { OR: [{ recipientId: accountId }, { senderId: accountId }] } });
  }

  async complete(id: string, leaseId: string) {
    return (await this.db().deleteMany({ where: { id, leaseId } })).count === 1;
  }

  async reschedule(id: string, leaseId: string, attempts: number, nextAttemptAt: number) {
    return (await this.db().updateMany({
      where: { id, leaseId },
      data: { leaseId: null, leaseUntil: null, attempts, nextAttemptAt: new Date(nextAttemptAt) },
    })).count === 1;
  }

  async pending() {
    const rows = await this.db().findMany({ select: { id: true, kind: true, attempts: true, nextAttemptAt: true } });
    return rows.map(({ nextAttemptAt, ...item }) => ({ ...item, nextAttemptAt: nextAttemptAt.getTime() }));
  }
}
