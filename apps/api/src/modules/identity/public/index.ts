/**
 * Facade Identity: account, profilo personale, credenziali e sessioni.
 * Il repository appartiene a Identity. Tutte le mutazioni avvengono nella UnitOfWork.
 */
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError, Clock, Principal, Role } from '../../../shared/contracts';

export interface PatientProfile extends Principal {
  birthDate: string | null;
  heightCm: number | null;
}
interface PasswordReset { digest: string; issuedAt: number; expiresAt: number }
export interface Account extends Principal {
  salt: string;
  passwordHash: string;
  birthDate?: string | null;
  heightCm?: number | null;
  passwordReset?: PasswordReset;
}
interface ProfileUpdate {
  name?: unknown;
  email?: unknown;
  birthDate?: unknown;
  heightCm?: unknown;
  currentPassword?: unknown;
}
export interface PasswordResetDelivery { email: string; token: string }
export interface Session { id: string; userId: string; csrfToken: string; expiresAt: number }
export interface IdentityRepository {
  findAccountByEmail(email: string): Promise<Account | null>;
  findAccountById(id: string): Promise<Account | null>;
  findAccountByResetDigest(digest: string): Promise<Account | null>;
  createAccount(account: Account): Promise<void>;
  updateAccount(account: Account): Promise<void>;
  findSession(id: string): Promise<Session | null>;
  createSession(session: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<void>;
  /** Elimina l'account e le sue sessioni. */
  deleteAccount(id: string): Promise<void>;
}
export interface IdentityState { accounts: Account[]; sessions: Session[] }
export const createEmptyIdentityState = (): IdentityState => ({ accounts: [], sessions: [] });
const principal = ({ id, email, name, role }: Account): Principal => ({ id, email, name, role });
const resetLifetime = 30 * 60 * 1000;
const resetCooldown = 60 * 1000;

function normalizedEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)) {
    throw new AppError('ValidationError', 400, 'Inserisci un indirizzo email valido.');
  }
  return email;
}

function normalizedName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 100) throw new AppError('ValidationError', 400, 'Inserisci un nome di 1–100 caratteri.');
  return name;
}

function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 10 && password.length <= 128;
}

function credentials(password: string) {
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
}

function matchesPassword(password: string, account: Account | null) {
  // Anche l'account inesistente esegue scrypt.
  const actual = scryptSync(password, account?.salt ?? '00000000000000000000000000000000', 64);
  const expected = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && !!account;
}

function profile(account: Account): PatientProfile {
  return { ...principal(account), birthDate: account.birthDate ?? null, heightCm: account.heightCm ?? null };
}

function validatedBirthDate(value: unknown, now: number) {
  if (value === null) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      value >= '1900-01-01' && value <= new Date(now).toISOString().slice(0, 10)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)) return value;
  }
  throw new AppError('ValidationError', 400, 'Inserisci una data di nascita valida.');
}

function validatedHeight(value: unknown) {
  if (value === null) return null;
  if (typeof value === 'number' && value >= 30 && value <= 300) return value;
  throw new AppError('ValidationError', 400, 'Inserisci un’altezza tra 30 e 300 cm.');
}

function resetDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export class IdentityService {
  constructor(private readonly repo: IdentityRepository, private readonly clock: Clock) {}

  private async patientAccount(actor: Principal): Promise<Account> {
    if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Il profilo è riservato al paziente.');
    const account = await this.repo.findAccountById(actor.id);
    if (!account) throw new AppError('PatientNotFound', 404, 'Profilo non trovato.');
    return account;
  }

  async provision(email: string, password: string, name: string, role: Role): Promise<Principal> {
    if (!validPassword(password) || !['PATIENT', 'NUTRITIONIST'].includes(role)) {
      throw new AppError('ValidationError', 400, 'Account non valido: nome, email, ruolo e password di 10–128 caratteri richiesti.');
    }
    const normalized = normalizedEmail(email);
    const displayName = normalizedName(name);
    if (await this.repo.findAccountByEmail(normalized)) throw new AppError('AccountExists', 409, 'Email già registrata.');
    const account: Account = { id: randomUUID(), email: normalized, name: displayName, role, ...credentials(password) };
    await this.repo.createAccount(account);
    return principal(account);
  }

  async login(email: string, password: string) {
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) {
      throw new AppError('AuthenticationError', 401, 'Credenziali non valide.');
    }
    const account = await this.repo.findAccountByEmail(email.trim().toLowerCase());
    if (!matchesPassword(password, account) || !account) throw new AppError('AuthenticationError', 401, 'Credenziali non valide.');
    const now = this.clock();
    const session: Session = { id: randomBytes(32).toString('hex'), userId: account.id,
      csrfToken: randomBytes(32).toString('hex'), expiresAt: now + 8 * 60 * 60 * 1000 };
    await this.repo.deleteExpiredSessions(now);
    await this.repo.createSession(session);
    return { user: principal(account), session };
  }

  async getProfile(actor: Principal): Promise<PatientProfile> {
    return profile(await this.patientAccount(actor));
  }

  async updateProfile(actor: Principal, update: ProfileUpdate): Promise<PatientProfile> {
    const account = await this.patientAccount(actor);
    const email = update.email === undefined ? account.email : normalizedEmail(update.email);
    const name = update.name === undefined ? account.name : normalizedName(update.name);
    const birthDate = update.birthDate === undefined ? account.birthDate ?? null : validatedBirthDate(update.birthDate, this.clock());
    const heightCm = update.heightCm === undefined ? account.heightCm ?? null : validatedHeight(update.heightCm);
    if (email !== account.email) {
      if (typeof update.currentPassword !== 'string' || update.currentPassword.length > 128 ||
          !matchesPassword(update.currentPassword, account)) {
        throw new AppError('CurrentPasswordRequired', 400, 'Per cambiare email, inserisci la password attuale corretta.');
      }
      if (await this.repo.findAccountByEmail(email)) throw new AppError('AccountExists', 409, 'Email già registrata.');
      delete account.passwordReset;
    }
    Object.assign(account, { email, name, birthDate, heightCm });
    await this.repo.updateAccount(account);
    return profile(account);
  }

  async issuePasswordReset(email: unknown): Promise<(PasswordResetDelivery & { accountId: string }) | null> {
    const normalized = normalizedEmail(email);
    const account = await this.repo.findAccountByEmail(normalized);
    const now = this.clock();
    if (!account || (account.passwordReset && now - account.passwordReset.issuedAt < resetCooldown)) return null;
    const token = randomBytes(32).toString('hex');
    account.passwordReset = { digest: resetDigest(token), issuedAt: now, expiresAt: now + resetLifetime };
    await this.repo.updateAccount(account);
    return { accountId: account.id, email: account.email, token };
  }

  /** Il dispatcher verifica che il link corrisponda ancora al profilo attuale. */
  async isPasswordResetCurrent(accountId: string, email: string, token: string): Promise<boolean> {
    const account = await this.repo.findAccountById(accountId);
    return !!account?.passwordReset && account.email === email &&
      account.passwordReset.digest === resetDigest(token) && account.passwordReset.expiresAt > this.clock();
  }

  async resetPassword(token: unknown, password: unknown): Promise<void> {
    if (!validPassword(password)) throw new AppError('ValidationError', 400, 'La password deve contenere da 10 a 128 caratteri.');
    const invalidReset = () => new AppError('InvalidResetToken', 400, 'Link di recupero non valido o scaduto. Richiedi un nuovo link.');
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw invalidReset();
    const account = await this.repo.findAccountByResetDigest(resetDigest(token));
    if (!account?.passwordReset || account.passwordReset.expiresAt <= this.clock()) throw invalidReset();
    Object.assign(account, credentials(password));
    delete account.passwordReset;
    await this.repo.updateAccount(account);
    await this.repo.deleteSessionsForUser(account.id);
  }

  /** Cambio password autenticato: la sessione corrente resta, le altre vengono revocate. */
  async changePassword(actor: Principal, currentSessionId: string, currentPassword: unknown, newPassword: unknown): Promise<{ ok: true }> {
    const account = await this.repo.findAccountById(actor.id);
    if (!account) throw new AppError('AuthenticationError', 401, 'Sessione assente o scaduta: accedere di nuovo.');
    if (typeof currentPassword !== 'string' || currentPassword.length > 128 || !matchesPassword(currentPassword, account)) {
      throw new AppError('CurrentPasswordRequired', 400, 'La password attuale non è corretta.');
    }
    if (!validPassword(newPassword)) throw new AppError('ValidationError', 400, 'La nuova password deve contenere da 10 a 128 caratteri.');
    const current = await this.repo.findSession(currentSessionId);
    Object.assign(account, credentials(newPassword));
    delete account.passwordReset;
    await this.repo.updateAccount(account);
    await this.repo.deleteSessionsForUser(account.id);
    if (current && current.userId === account.id) await this.repo.createSession(current);
    return { ok: true };
  }

  /** Conferma della password prima di operazioni irreversibili (eliminazione dell'account). */
  async verifyPassword(actor: Principal, password: unknown): Promise<void> {
    const account = await this.repo.findAccountById(actor.id);
    if (typeof password !== 'string' || password.length > 128 || !matchesPassword(password, account)) {
      throw new AppError('CurrentPasswordRequired', 400, 'La password non è corretta.');
    }
  }

  async deleteAccount(actor: Principal): Promise<void> {
    await this.repo.deleteSessionsForUser(actor.id);
    await this.repo.deleteAccount(actor.id);
  }

  /** Dati personali dell'account, per l'esportazione (senza credenziali). */
  async exportAccount(actor: Principal) {
    const account = await this.repo.findAccountById(actor.id);
    if (!account) throw new AppError('AuthenticationError', 401, 'Sessione assente o scaduta: accedere di nuovo.');
    return { ...principal(account), birthDate: account.birthDate ?? null, heightCm: account.heightCm ?? null };
  }

  async authenticate(sessionId: string) {
    const session = await this.repo.findSession(sessionId);
    const account = session && session.expiresAt > this.clock() ? await this.repo.findAccountById(session.userId) : null;
    if (!session || !account) throw new AppError('AuthenticationError', 401, 'Sessione assente o scaduta: accedere di nuovo.');
    return { user: principal(account), session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.deleteSession(sessionId);
  }

  async findUserByEmail(email: string): Promise<Principal | null> {
    if (typeof email !== 'string') return null;
    const account = await this.repo.findAccountByEmail(email.trim().toLowerCase());
    return account ? principal(account) : null;
  }

  async getUser(id: string): Promise<Principal> {
    const account = await this.repo.findAccountById(id);
    if (!account) throw new AppError('PatientNotFound', 404, 'Profilo non trovato.');
    return principal(account);
  }
}
