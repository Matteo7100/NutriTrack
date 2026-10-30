/**
 * Gestisce inviti e associazioni, non dati nutrizionali. Il Patient accetta
 * l'invito; massimo un Nutritionist attivo. Gli altri moduli usano assertAccess
 * o isAssigned invece di leggere questo repository.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal, Repository } from '../../../shared/contracts';
import { IdentityService } from '../../identity/public';

export interface Invitation { id: string; patientId: string; nutritionistId: string; createdAt: number; status: 'PENDING' | 'ACCEPTED' | 'CLOSED' }
export interface Assignment { id: string; patientId: string; nutritionistId: string; createdAt: number; endedAt: number | null }
export interface PatientState { invitations: Invitation[]; assignments: Assignment[] }
export const createEmptyPatientState = (): PatientState => ({ invitations: [], assignments: [] });

export class PatientService {
  constructor(private readonly repo: Repository<PatientState>, private readonly identity: IdentityService, private readonly clock: Clock) {}

  async list(actor: Principal): Promise<Principal[]> {
    const active = (await this.repo.get()).assignments.filter(a => a.endedAt === null);
    const ids = actor.role === 'NUTRITIONIST'
      ? active.filter(a => a.nutritionistId === actor.id).map(a => a.patientId)
      : active.filter(a => a.patientId === actor.id).map(a => a.nutritionistId);
    return Promise.all(ids.map(id => this.identity.getUser(id)));
  }

  async invitations(actor: Principal) {
    const items = (await this.repo.get()).invitations.filter(i => i.status === 'PENDING' &&
      (actor.role === 'PATIENT' ? i.patientId === actor.id : i.nutritionistId === actor.id));
    return Promise.all(items.map(async i => {
      const nutritionist = await this.identity.getUser(i.nutritionistId);
      const patient = await this.identity.getUser(i.patientId);
      return { ...i, patient, nutritionist, patientName: patient.name, nutritionistName: nutritionist.name };
    }));
  }

  async invite(actor: Principal, email: string) {
    if (actor.role !== 'NUTRITIONIST') throw new AppError('AuthorizationError', 403, 'Solo il Nutritionist può invitare.');
    const patient = await this.identity.findUserByEmail(email);
    if (!patient || patient.role !== 'PATIENT') throw new AppError('PatientNotFound', 404, 'Patient non trovato.');
    const state = await this.repo.get();
    if (state.assignments.some(a => a.patientId === patient.id && a.endedAt === null)) throw new AppError('AssociationConflict', 409, 'Patient già associato: chiudere prima la relazione corrente.');
    const existing = state.invitations.find(i => i.patientId === patient.id && i.nutritionistId === actor.id && i.status === 'PENDING');
    if (existing) return existing;
    const invite: Invitation = { id: randomUUID(), patientId: patient.id, nutritionistId: actor.id, createdAt: this.clock(), status: 'PENDING' };
    state.invitations.push(invite);
    await this.repo.save(state);
    return invite;
  }

  async accept(actor: Principal, inviteId: string) {
    if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Solo il Patient può accettare.');
    const state = await this.repo.get();
    const invite = state.invitations.find(i => i.id === inviteId && i.patientId === actor.id && i.status === 'PENDING');
    if (!invite) throw new AppError('InvitationNotFound', 404, 'Invito non trovato.');
    if (state.assignments.some(a => a.patientId === actor.id && a.endedAt === null)) throw new AppError('AssociationConflict', 409, 'Esiste già un Nutritionist attivo.');
    const assignment: Assignment = { id: randomUUID(), patientId: actor.id, nutritionistId: invite.nutritionistId, createdAt: this.clock(), endedAt: null };
    state.assignments.push(assignment);
    state.invitations.forEach(i => { if (i.patientId === actor.id && i.status === 'PENDING') i.status = i.id === inviteId ? 'ACCEPTED' : 'CLOSED'; });
    await this.repo.save(state);
    return assignment;
  }

  async end(actor: Principal, patientId: string) {
    await this.assertAccess(actor, patientId);
    const state = await this.repo.get();
    const assignment = state.assignments.find(a => a.patientId === patientId && a.endedAt === null);
    if (!assignment) throw new AppError('AssociationConflict', 409, 'Nessuna associazione attiva.');
    assignment.endedAt = this.clock();
    await this.repo.save(state);
    return { ended: true };
  }

  async isAssigned(nutritionistId: string, patientId: string): Promise<boolean> {
    return (await this.repo.get()).assignments.some(a => a.patientId === patientId && a.nutritionistId === nutritionistId && a.endedAt === null);
  }

  async assignmentKey(patientId: string): Promise<string | null> {
    return (await this.repo.get()).assignments.find(a => a.patientId === patientId && a.endedAt === null)?.id ?? null;
  }

  async assertAccess(actor: Principal, patientId: string): Promise<void> {
    if (actor.role === 'PATIENT' && actor.id === patientId) return;
    if (actor.role === 'NUTRITIONIST' && await this.isAssigned(actor.id, patientId)) return;
    throw new AppError('PatientNotAssigned', 403, 'Accesso ai dati del Patient non consentito.');
  }
}
