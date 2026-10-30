/**
 * Facade Identity: crea account dimostrativi, verifica credenziali e sessioni.
 * Password derivate con scrypt e salt; il contratto restituisce solo il principal.
 * Il repository appartiene a Identity. Tutte le mutazioni avvengono nella UnitOfWork.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError, Clock, Principal, Repository, Role } from '../../../shared/contracts';

interface Account extends Principal { salt: string; passwordHash: string }
export interface Session { id: string; userId: string; csrfToken: string; expiresAt: number }
export interface IdentityState { accounts: Account[]; sessions: Session[] }
export const createEmptyIdentityState = (): IdentityState => ({ accounts: [], sessions: [] });
const principal = ({ id, email, name, role }: Account): Principal => ({ id, email, name, role });

export class IdentityService {
  constructor(private readonly repo: Repository<IdentityState>, private readonly clock: Clock) {}

  async provision(email: string, password: string, name: string, role: Role): Promise<Principal> {
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      typeof password !== 'string' || password.length < 10 || password.length > 128 ||
      typeof name !== 'string' || !name.trim() || name.length > 100 || !['PATIENT', 'NUTRITIONIST'].includes(role)) {
      throw new AppError('ValidationError', 400, 'Account non valido: nome, email, ruolo e password di 10–128 caratteri richiesti.');
    }
    const state = await this.repo.get();
    const normalized = email.trim().toLowerCase();
    if (state.accounts.some(a => a.email === normalized)) throw new AppError('AccountExists', 409, 'Email già registrata.');
    const salt = randomBytes(16).toString('hex');
    const account: Account = { id: randomUUID(), email: normalized, name: name.trim(), role, salt,
      passwordHash: scryptSync(password, salt, 64).toString('hex') };
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
    // Anche l'account inesistente esegue scrypt: non riveliamo la presenza dell'email.
    const actual = scryptSync(password, account?.salt ?? '00000000000000000000000000000000', 64);
    const expected = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(actual, expected) || !account) throw new AppError('AuthenticationError', 401, 'Credenziali non valide.');
    const session: Session = { id: randomBytes(32).toString('hex'), userId: account.id,
      csrfToken: randomBytes(32).toString('hex'), expiresAt: this.clock() + 8 * 60 * 60 * 1000 };
    state.sessions = state.sessions.filter(s => s.expiresAt > this.clock());
    state.sessions.push(session);
    await this.repo.save(state);
    return { user: principal(account), session };
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
