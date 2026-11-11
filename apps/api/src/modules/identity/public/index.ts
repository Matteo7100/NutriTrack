/**
 * Facade Identity: account, profilo personale, credenziali e sessioni.
 * Il repository appartiene a Identity. Tutte le mutazioni avvengono nella UnitOfWork.
 */
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError, Clock, Principal, Repository, Role } from '../../../shared/contracts';

export interface PatientProfile extends Principal {
  birthDate: string | null;
  heightCm: number | null;
}
interface PasswordReset { digest: string; issuedAt: number; expiresAt: number }
interface Account extends Principal {
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

function matchesPassword(password: string, account?: Account) {
  // Anche l'account inesistente esegue scrypt.
  const actual = scryptSync(password, account?.salt ?? '00000000000000000000000000000000', 64);
  const expected = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && !!account;
}

function profile(account: Account): PatientProfile {
  return { ...principal(account), birthDate: account.birthDate ?? null, heightCm: account.heightCm ?? null };
}

function patientAccount(state: IdentityState, actor: Principal) {
  if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Il profilo è riservato al paziente.');
  const account = state.accounts.find(a => a.id === actor.id);
  if (!account) throw new AppError('PatientNotFound', 404, 'Profilo non trovato.');
  return account;
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
  constructor(private readonly repo: Repository<IdentityState>, private readonly clock: Clock) {}

  async provision(email: string, password: string, name: string, role: Role): Promise<Principal> {
    if (!validPassword(password) || !['PATIENT', 'NUTRITIONIST'].includes(role)) {
      throw new AppError('ValidationError', 400, 'Account non valido: nome, email, ruolo e password di 10–128 caratteri richiesti.');
    }
    const normalized = normalizedEmail(email);
    const displayName = normalizedName(name);
    const state = await this.repo.get();
    if (state.accounts.some(a => a.email === normalized)) throw new AppError('AccountExists', 409, 'Email già registrata.');
    const account: Account = { id: randomUUID(), email: normalized, name: displayName, role, ...credentials(password) };
    state.accounts.push(account);
    await this.repo.save(state);
    return principal(account);
  }

  async login(email: string, password: string) {
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) {
      throw new AppError('AuthenticationError', 401, 'Credenziali non valide.');
    }
    const state = await this.repo.get();
    const account = state.accounts.find(a => a.email === email.trim().toLowerCase());
    if (!matchesPassword(password, account) || !account) throw new AppError('AuthenticationError', 401, 'Credenziali non valide.');
    const session: Session = { id: randomBytes(32).toString('hex'), userId: account.id,
      csrfToken: randomBytes(32).toString('hex'), expiresAt: this.clock() + 8 * 60 * 60 * 1000 };
    state.sessions = state.sessions.filter(s => s.expiresAt > this.clock());
    state.sessions.push(session);
    await this.repo.save(state);
    return { user: principal(account), session };
  }

  async getProfile(actor: Principal): Promise<PatientProfile> {
    return profile(patientAccount(await this.repo.get(), actor));
  }

  async updateProfile(actor: Principal, update: ProfileUpdate): Promise<PatientProfile> {
    const state = await this.repo.get();
    const account = patientAccount(state, actor);
    const email = update.email === undefined ? account.email : normalizedEmail(update.email);
    const name = update.name === undefined ? account.name : normalizedName(update.name);
    const birthDate = update.birthDate === undefined ? account.birthDate ?? null : validatedBirthDate(update.birthDate, this.clock());
    const heightCm = update.heightCm === undefined ? account.heightCm ?? null : validatedHeight(update.heightCm);
    if (email !== account.email) {
      if (typeof update.currentPassword !== 'string' || update.currentPassword.length > 128 ||
          !matchesPassword(update.currentPassword, account)) {
        throw new AppError('CurrentPasswordRequired', 400, 'Per cambiare email, inserisci la password attuale corretta.');
      }
      if (state.accounts.some(a => a.email === email)) throw new AppError('AccountExists', 409, 'Email già registrata.');
      delete account.passwordReset;
    }
    Object.assign(account, { email, name, birthDate, heightCm });
    await this.repo.save(state);
    return profile(account);
  }

  async issuePasswordReset(email: unknown): Promise<PasswordResetDelivery | null> {
    const normalized = normalizedEmail(email);
    const state = await this.repo.get();
    const account = state.accounts.find(a => a.email === normalized);
    const now = this.clock();
    if (!account || (account.passwordReset && now - account.passwordReset.issuedAt < resetCooldown)) return null;
    const token = randomBytes(32).toString('hex');
    account.passwordReset = { digest: resetDigest(token), issuedAt: now, expiresAt: now + resetLifetime };
    await this.repo.save(state);
    return { email: account.email, token };
  }

  async resetPassword(token: unknown, password: unknown): Promise<void> {
    if (!validPassword(password)) throw new AppError('ValidationError', 400, 'La password deve contenere da 10 a 128 caratteri.');
    const invalidReset = () => new AppError('InvalidResetToken', 400, 'Link di recupero non valido o scaduto. Richiedi un nuovo link.');
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw invalidReset();
    const digest = resetDigest(token);
    const state = await this.repo.get();
    const now = this.clock();
    const account = state.accounts.find(a => a.passwordReset?.digest === digest && a.passwordReset.expiresAt > now);
    if (!account) throw invalidReset();
    Object.assign(account, credentials(password));
    delete account.passwordReset;
    state.sessions = state.sessions.filter(s => s.userId !== account.id);
    await this.repo.save(state);
  }

  async authenticate(sessionId: string) {
    const state = await this.repo.get();
    const session = state.sessions.find(s => s.id === sessionId && s.expiresAt > this.clock());
    const account = session && state.accounts.find(a => a.id === session.userId);
    if (!session || !account) throw new AppError('AuthenticationError', 401, 'Sessione assente o scaduta: accedere di nuovo.');
    return { user: principal(account), session };
  }

  async logout(sessionId: string): Promise<void> {
    const state = await this.repo.get();
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    await this.repo.save(state);
  }

  async findUserByEmail(email: string): Promise<Principal | null> {
    if (typeof email !== 'string') return null;
    const account = (await this.repo.get()).accounts.find(a => a.email === email.trim().toLowerCase());
    return account ? principal(account) : null;
  }

  async getUser(id: string): Promise<Principal> {
    const account = (await this.repo.get()).accounts.find(a => a.id === id);
    if (!account) throw new AppError('PatientNotFound', 404, 'Profilo non trovato.');
    return principal(account);
  }
}
