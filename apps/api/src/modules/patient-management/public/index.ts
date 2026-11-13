/**
 * Gestisce inviti e associazioni, non dati nutrizionali. Il Patient accetta
 * l'invito; massimo un Nutritionist attivo. Gli altri moduli usano assertAccess
 * o isAssigned invece di leggere questo repository.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal } from '../../../shared/contracts';
import { IdentityService } from '../../identity/public';

export interface Invitation { id: string; patientId: string; nutritionistId: string; createdAt: number; status: 'PENDING' | 'ACCEPTED' | 'CLOSED' }
export interface Assignment { id: string; patientId: string; nutritionistId: string; createdAt: number; endedAt: number | null }
export interface PatientState { invitations: Invitation[]; assignments: Assignment[] }
export const createEmptyPatientState = (): PatientState => ({ invitations: [], assignments: [] });

export type PendingInvitationLookup = { patientId: string } & ({ id: string } | { nutritionistId: string });

export interface PatientRepository {
  activeAssignment(patientId: string): Promise<Assignment | null>;
  activeAssignmentsForNutritionist(nutritionistId: string): Promise<Assignment[]>;
  pendingInvitations(actor: Principal): Promise<Invitation[]>;
  pendingInvitation(lookup: PendingInvitationLookup): Promise<Invitation | null>;
  createInvitation(invitation: Invitation): Promise<void>;
  acceptInvitation(invitationId: string, assignment: Assignment): Promise<void>;
  endAssignment(assignmentId: string, endedAt: number): Promise<void>;
}

export class PatientService {
  constructor(private readonly repo: PatientRepository, private readonly identity: IdentityService, private readonly clock: Clock) {}

  async list(actor: Principal): Promise<Principal[]> {
    if (actor.role === 'NUTRITIONIST') {
      const assignments = await this.repo.activeAssignmentsForNutritionist(actor.id);
      return Promise.all(assignments.map(assignment => this.identity.getUser(assignment.patientId)));
    }
    const assignment = await this.repo.activeAssignment(actor.id);
    return assignment ? [await this.identity.getUser(assignment.nutritionistId)] : [];
  }

  async invitations(actor: Principal) {
    const items = await this.repo.pendingInvitations(actor);
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
    if (await this.repo.activeAssignment(patient.id)) throw new AppError('AssociationConflict', 409, 'Patient già associato: chiudere prima la relazione corrente.');
    const existing = await this.repo.pendingInvitation({ patientId: patient.id, nutritionistId: actor.id });
    if (existing) return existing;
    const invite: Invitation = { id: randomUUID(), patientId: patient.id, nutritionistId: actor.id, createdAt: this.clock(), status: 'PENDING' };
    await this.repo.createInvitation(invite);
    return invite;
  }

  async accept(actor: Principal, inviteId: string) {
    if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Solo il Patient può accettare.');
    const invite = await this.repo.pendingInvitation({ id: inviteId, patientId: actor.id });
    if (!invite) throw new AppError('InvitationNotFound', 404, 'Invito non trovato.');
    if (await this.repo.activeAssignment(actor.id)) throw new AppError('AssociationConflict', 409, 'Esiste già un Nutritionist attivo.');
    const assignment: Assignment = { id: randomUUID(), patientId: actor.id, nutritionistId: invite.nutritionistId, createdAt: this.clock(), endedAt: null };
    await this.repo.acceptInvitation(inviteId, assignment);
    return assignment;
  }

  async end(actor: Principal, patientId: string) {
    await this.assertAccess(actor, patientId);
    const assignment = await this.repo.activeAssignment(patientId);
    if (!assignment) throw new AppError('AssociationConflict', 409, 'Nessuna associazione attiva.');
    await this.repo.endAssignment(assignment.id, this.clock());
    return { ended: true };
  }

  async isAssigned(nutritionistId: string, patientId: string): Promise<boolean> {
    const assignment = await this.repo.activeAssignment(patientId);
    return assignment?.nutritionistId === nutritionistId;
  }

  async assignmentKey(patientId: string): Promise<string | null> {
    return (await this.repo.activeAssignment(patientId))?.id ?? null;
  }

  async assertAccess(actor: Principal, patientId: string): Promise<void> {
    if (actor.role === 'PATIENT' && actor.id === patientId) return;
    if (actor.role === 'NUTRITIONIST' && await this.isAssigned(actor.id, patientId)) return;
    throw new AppError('PatientNotAssigned', 403, 'Accesso ai dati del Patient non consentito.');
  }
}
