import { Prisma, type Account as AccountRow, type AccountSession as SessionRow } from '@prisma/client';
import type { Account, IdentityRepository, IdentityState, Session } from '../modules/identity/public';
import { AppError, type Repository } from '../shared/contracts';

export class MemoryIdentityRepository implements IdentityRepository {
  constructor(private readonly repository: Repository<IdentityState>) {}

  private async change(update: (state: IdentityState) => void): Promise<void> {
    const state = await this.repository.get();
    update(state);
    await this.repository.save(state);
  }

  async findAccountByEmail(email: string) {
    return (await this.repository.get()).accounts.find(account => account.email === email) ?? null;
  }

  async findAccountById(id: string) {
    return (await this.repository.get()).accounts.find(account => account.id === id) ?? null;
  }

  async findAccountByResetDigest(digest: string) {
    return (await this.repository.get()).accounts.find(account => account.passwordReset?.digest === digest) ?? null;
  }

  async createAccount(account: Account) {
    await this.change(state => { state.accounts.push(account); });
  }

  async updateAccount(account: Account) {
    await this.change(state => {
      const index = state.accounts.findIndex(current => current.id === account.id);
      if (index < 0) throw new Error('Account mancante durante il salvataggio.');
      state.accounts[index] = account;
    });
  }

  async findSession(id: string) {
    return (await this.repository.get()).sessions.find(session => session.id === id) ?? null;
  }

  async createSession(session: Session) {
    await this.change(state => { state.sessions.push(session); });
  }

  async deleteSession(id: string) {
    await this.change(state => { state.sessions = state.sessions.filter(session => session.id !== id); });
  }

  async deleteSessionsForUser(userId: string) {
    await this.change(state => { state.sessions = state.sessions.filter(session => session.userId !== userId); });
  }

  async deleteExpiredSessions(now: number) {
    await this.change(state => { state.sessions = state.sessions.filter(session => session.expiresAt > now); });
  }
}

function readAccount(row: AccountRow | null): Account | null {
  if (!row) return null;
  const { birthDate, resetDigest, resetIssuedAt, resetExpiresAt, role, ...fields } = row;
  return {
    ...fields,
    role: role as Account['role'],
    birthDate: birthDate?.toISOString().slice(0, 10) ?? null,
    ...(resetDigest !== null && resetIssuedAt !== null && resetExpiresAt !== null && {
      passwordReset: { digest: resetDigest, issuedAt: resetIssuedAt.getTime(), expiresAt: resetExpiresAt.getTime() },
    }),
  };
}

function accountFields({ birthDate, heightCm, passwordReset, email, name, role, salt, passwordHash }: Account) {
  return {
    email, name, role, salt, passwordHash,
    birthDate: birthDate ? new Date(birthDate) : null,
    heightCm: heightCm ?? null,
    resetDigest: passwordReset?.digest ?? null,
    resetIssuedAt: passwordReset ? new Date(passwordReset.issuedAt) : null,
    resetExpiresAt: passwordReset ? new Date(passwordReset.expiresAt) : null,
  };
}

function rethrowAccountWrite(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' &&
    Array.isArray(error.meta?.target) && error.meta.target.includes('email')) {
    throw new AppError('AccountExists', 409, 'Email già registrata.');
  }
  throw error;
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly transaction: () => Pick<Prisma.TransactionClient, 'account' | 'accountSession'>) {}

  async findAccountByEmail(email: string) {
    return readAccount(await this.transaction().account.findUnique({ where: { email } }));
  }

  async findAccountById(id: string) {
    return readAccount(await this.transaction().account.findUnique({ where: { id } }));
  }

  async findAccountByResetDigest(resetDigest: string) {
    return readAccount(await this.transaction().account.findUnique({ where: { resetDigest } }));
  }

  async createAccount(account: Account) {
    await this.transaction().account.create({ data: { id: account.id, ...accountFields(account) } }).catch(rethrowAccountWrite);
  }

  async updateAccount(account: Account) {
    await this.transaction().account.update({ where: { id: account.id }, data: accountFields(account) }).catch(rethrowAccountWrite);
  }

  async findSession(id: string): Promise<Session | null> {
    const row: SessionRow | null = await this.transaction().accountSession.findUnique({ where: { id } });
    return row ? { ...row, expiresAt: row.expiresAt.getTime() } : null;
  }

  async createSession(session: Session) {
    await this.transaction().accountSession.create({ data: { ...session, expiresAt: new Date(session.expiresAt) } });
  }

  async deleteSession(id: string) {
    await this.transaction().accountSession.deleteMany({ where: { id } });
  }

  async deleteSessionsForUser(userId: string) {
    await this.transaction().accountSession.deleteMany({ where: { userId } });
  }

  async deleteExpiredSessions(now: number) {
    await this.transaction().accountSession.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
  }
}
