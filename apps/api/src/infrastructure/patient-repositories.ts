import type { PatientAssignment, PatientInvitation, Prisma } from '@prisma/client';
import type {
  Assignment, Invitation, PatientRepository, PatientState, PendingInvitationLookup,
} from '../modules/patient-management/public';
import { AppError, type Principal, type Repository } from '../shared/contracts';

function ownerFilter(actor: Principal) {
  return actor.role === 'PATIENT' ? { patientId: actor.id } : { nutritionistId: actor.id };
}

function ownedBy(record: { patientId: string; nutritionistId: string }, actor: Principal): boolean {
  return (actor.role === 'PATIENT' ? record.patientId : record.nutritionistId) === actor.id;
}

export class MemoryPatientRepository implements PatientRepository {
  constructor(private readonly repository: Repository<PatientState>) {}

  async activeAssignment(patientId: string) {
    const state = await this.repository.get();
    return state.assignments.find(assignment => assignment.patientId === patientId && assignment.endedAt === null) ?? null;
  }

  async activeAssignmentsForNutritionist(nutritionistId: string) {
    const state = await this.repository.get();
    return state.assignments.filter(assignment => assignment.nutritionistId === nutritionistId && assignment.endedAt === null);
  }

  async pendingInvitations(actor: Principal) {
    const state = await this.repository.get();
    return state.invitations.filter(invitation => invitation.status === 'PENDING' && ownedBy(invitation, actor));
  }

  async pendingInvitation(lookup: PendingInvitationLookup) {
    const state = await this.repository.get();
    return state.invitations.find(invitation => invitation.status === 'PENDING' && invitation.patientId === lookup.patientId &&
      ('id' in lookup ? invitation.id === lookup.id : invitation.nutritionistId === lookup.nutritionistId)) ?? null;
  }

  async createInvitation(invitation: Invitation) {
    const state = await this.repository.get();
    state.invitations.push(invitation);
    await this.repository.save(state);
  }

  async closeInvitation(actor: Principal, invitationId: string) {
    const state = await this.repository.get();
    const invitation = state.invitations.find(item => item.id === invitationId && item.status === 'PENDING' && ownedBy(item, actor));
    if (!invitation) return false;
    invitation.status = 'CLOSED';
    await this.repository.save(state);
    return true;
  }

  async acceptInvitation(invitationId: string, assignment: Assignment) {
    const state = await this.repository.get();
    state.assignments.push(assignment);
    for (const invitation of state.invitations) {
      if (invitation.patientId === assignment.patientId && invitation.status === 'PENDING') {
        invitation.status = invitation.id === invitationId ? 'ACCEPTED' : 'CLOSED';
      }
    }
    await this.repository.save(state);
  }

  async endAssignment(assignmentId: string, endedAt: number) {
    const state = await this.repository.get();
    const assignment = state.assignments.find(candidate => candidate.id === assignmentId);
    if (!assignment) throw new Error('Associazione mancante durante la chiusura.');
    assignment.endedAt = endedAt;
    await this.repository.save(state);
  }

  async relations(actor: Principal) {
    const { assignments, invitations } = await this.repository.get();
    return {
      assignments: assignments.filter(assignment => ownedBy(assignment, actor)),
      invitations: invitations.filter(invitation => ownedBy(invitation, actor)),
    };
  }

  async erasePatientRelations(patientId: string) {
    const state = await this.repository.get();
    state.assignments = state.assignments.filter(assignment => assignment.patientId !== patientId);
    state.invitations = state.invitations.filter(invitation => invitation.patientId !== patientId);
    await this.repository.save(state);
  }

  async closeNutritionistRelations(nutritionistId: string, endedAt: number) {
    const state = await this.repository.get();
    const active = state.assignments.filter(assignment => assignment.nutritionistId === nutritionistId && assignment.endedAt === null);
    for (const assignment of active) assignment.endedAt = endedAt;
    state.invitations = state.invitations.filter(invitation => invitation.nutritionistId !== nutritionistId || invitation.status !== 'PENDING');
    await this.repository.save(state);
    return active.map(assignment => assignment.patientId);
  }
}

function readAssignment({ id, patientId, nutritionistId, createdAt, endedAt }: PatientAssignment): Assignment {
  return { id, patientId, nutritionistId, createdAt: createdAt.getTime(), endedAt: endedAt?.getTime() ?? null };
}

function readInvitation({ id, patientId, nutritionistId, createdAt, status }: PatientInvitation): Invitation {
  return { id, patientId, nutritionistId, createdAt: createdAt.getTime(), status };
}

export class PostgresPatientRepository implements PatientRepository {
  constructor(private readonly transaction: () => Pick<Prisma.TransactionClient, 'patientAssignment' | 'patientInvitation'>) {}

  async activeAssignment(patientId: string) {
    const row = await this.transaction().patientAssignment.findFirst({ where: { patientId, endedAt: null } });
    return row ? readAssignment(row) : null;
  }

  async activeAssignmentsForNutritionist(nutritionistId: string) {
    const rows = await this.transaction().patientAssignment.findMany({
      where: { nutritionistId, endedAt: null },
      orderBy: { sequence: 'asc' },
    });
    return rows.map(readAssignment);
  }

  async pendingInvitations(actor: Principal) {
    const rows = await this.transaction().patientInvitation.findMany({
      where: { ...ownerFilter(actor), status: 'PENDING' },
      orderBy: { sequence: 'asc' },
    });
    return rows.map(readInvitation);
  }

  async pendingInvitation(lookup: PendingInvitationLookup) {
    const row = await this.transaction().patientInvitation.findFirst({ where: { ...lookup, status: 'PENDING' } });
    return row ? readInvitation(row) : null;
  }

  async createInvitation(invitation: Invitation) {
    await this.transaction().patientInvitation.create({
      data: { ...invitation, createdAt: new Date(invitation.createdAt) },
    });
  }

  async closeInvitation(actor: Principal, invitationId: string) {
    const { count } = await this.transaction().patientInvitation.updateMany({
      where: { ...ownerFilter(actor), id: invitationId, status: 'PENDING' },
      data: { status: 'CLOSED' },
    });
    return count > 0;
  }

  async acceptInvitation(invitationId: string, assignment: Assignment) {
    const transaction = this.transaction();
    const accepted = await transaction.patientInvitation.updateMany({
      where: { id: invitationId, patientId: assignment.patientId, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    if (!accepted.count) throw new AppError('InvitationNotFound', 404, 'Invito non trovato.');
    const { createdAt, endedAt, ...fields } = assignment;
    await transaction.patientAssignment.create({
      data: { ...fields, createdAt: new Date(createdAt), endedAt: endedAt === null ? null : new Date(endedAt) },
    });
    await transaction.patientInvitation.updateMany({
      where: { patientId: assignment.patientId, status: 'PENDING' },
      data: { status: 'CLOSED' },
    });
  }

  async endAssignment(assignmentId: string, endedAt: number) {
    const ended = await this.transaction().patientAssignment.updateMany({
      where: { id: assignmentId, endedAt: null },
      data: { endedAt: new Date(endedAt) },
    });
    if (!ended.count) throw new AppError('AssociationConflict', 409, 'Nessuna associazione attiva.');
  }

  async relations(actor: Principal) {
    const { patientAssignment, patientInvitation } = this.transaction();
    const where = ownerFilter(actor);
    const [assignments, invitations] = await Promise.all([
      patientAssignment.findMany({ where, orderBy: { sequence: 'asc' } }),
      patientInvitation.findMany({ where, orderBy: { sequence: 'asc' } }),
    ]);
    return { assignments: assignments.map(readAssignment), invitations: invitations.map(readInvitation) };
  }

  async erasePatientRelations(patientId: string) {
    const { patientAssignment, patientInvitation } = this.transaction();
    await patientAssignment.deleteMany({ where: { patientId } });
    await patientInvitation.deleteMany({ where: { patientId } });
  }

  async closeNutritionistRelations(nutritionistId: string, endedAt: number) {
    const { patientAssignment, patientInvitation } = this.transaction();
    const ended = await patientAssignment.updateManyAndReturn({
      where: { nutritionistId, endedAt: null },
      data: { endedAt: new Date(endedAt) },
      select: { patientId: true },
    });
    await patientInvitation.deleteMany({ where: { nutritionistId, status: 'PENDING' } });
    return ended.map(assignment => assignment.patientId);
  }
}
