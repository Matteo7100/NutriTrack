/**
 * Diario del Patient: la versione è risolta dal sistema al consumo, non al sync.
 * Condivisione globale inizialmente falsa e legata all'associazione corrente.
 * operationId rende i retry idempotenti: payload diverso sullo stesso ID è conflitto.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal, Repository } from '../../../shared/contracts';
import { PatientService } from '../../patient-management/public';
import { MealPlanningService } from '../../meal-planning/public';

export interface DiaryEntry { id: string; patientId: string; consumptionTime: number; createdAt: number; actualConsumption: string; mealPlanVersionId: string | null; operationId: string }
export interface DiaryState { entries: DiaryEntry[]; preferences: Record<string, { enabled: boolean; assignmentId: string | null }> }
export const createEmptyDiaryState = (): DiaryState => ({ entries: [], preferences: {} });
export interface RecordMeal { operationId: string; consumptionTime: string; actualConsumption: string }

// Offset obbligatorio. La verifica del calendario evita Date.parse che normalizza 30 febbraio.
function instant(input: unknown, now: number): number {
  if (typeof input !== 'string') throw new AppError('InvalidDiaryEntry', 400, 'Data con offset esplicito richiesta.');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!m) throw new AppError('InvalidDiaryEntry', 400, 'Formato ISO 8601 con Z o offset richiesto.');
  const [, y, mo, d, h, mi, s, , zone] = m;
  const day = Number(d), month = Number(mo), year = Number(y);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  const offset = zone === 'Z' ? [0, 0] : zone.slice(1).split(':').map(Number);
  const value = Date.parse(input);
  if (month < 1 || month > 12 || day < 1 || day > days || +h > 23 || +mi > 59 || +s > 59 || offset[0] > 23 || offset[1] > 59 || !Number.isFinite(value) || value > now) {
    throw new AppError('InvalidDiaryEntry', 400, 'Data non valida o futura.');
  }
  return value;
}

export class DiaryService {
  constructor(private readonly repo: Repository<DiaryState>, private readonly patients: PatientService,
    private readonly plans: MealPlanningService, private readonly clock: Clock) {}

  async sharing(actor: Principal): Promise<{ enabled: boolean }> {
    this.patientOnly(actor);
    const preference = (await this.repo.get()).preferences[actor.id];
    return { enabled: !!preference?.enabled && preference.assignmentId === await this.patients.assignmentKey(actor.id) && preference.assignmentId !== null };
  }

  async setSharing(actor: Principal, enabled: boolean) {
    this.patientOnly(actor);
    if (typeof enabled !== 'boolean') throw new AppError('ValidationError', 400, 'enabled deve essere booleano.');
    const assignmentId = await this.patients.assignmentKey(actor.id);
    if (enabled && !assignmentId) throw new AppError('PatientNotAssigned', 409, 'Associare un Nutritionist prima di condividere.');
    const state = await this.repo.get();
    state.preferences[actor.id] = { enabled, assignmentId };
    await this.repo.save(state);
    return { enabled };
  }

  async record(actor: Principal, input: RecordMeal): Promise<DiaryEntry> {
    this.patientOnly(actor);
    if (!input || typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationId) || typeof input.actualConsumption !== 'string' || !input.actualConsumption.trim() || input.actualConsumption.length > 4000) {
      throw new AppError('InvalidDiaryEntry', 400, 'Operazione e consumo non validi.');
    }
    const consumptionTime = instant(input.consumptionTime, this.clock());
    const actualConsumption = input.actualConsumption.trim();
    const state = await this.repo.get();
    const existing = state.entries.find(e => e.patientId === actor.id && e.operationId === input.operationId);
    if (existing) {
      if (existing.consumptionTime !== consumptionTime || existing.actualConsumption !== actualConsumption) throw new AppError('OperationConflict', 409, 'operationId già usato con contenuto diverso.');
      return structuredClone(existing);
    }
    const version = await this.plans.getVersionAt(actor.id, consumptionTime);
    const entry: DiaryEntry = { id: randomUUID(), patientId: actor.id, consumptionTime, createdAt: this.clock(), actualConsumption, mealPlanVersionId: version?.id ?? null, operationId: input.operationId };
    state.entries.push(entry);
    await this.repo.save(state);
    return structuredClone(entry);
  }

  async list(actor: Principal, patientId: string, from?: number, to?: number) {
    await this.patients.assertAccess(actor, patientId);
    const state = await this.repo.get();
    if (actor.role === 'NUTRITIONIST') {
      const pref = state.preferences[patientId];
      if (!pref?.enabled || pref.assignmentId === null || pref.assignmentId !== await this.patients.assignmentKey(patientId)) throw new AppError('DiaryNotShared', 403, 'Il Patient non condivide il diario.');
    }
    if ((from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to)) || (from !== undefined && to !== undefined && from > to)) throw new AppError('ValidationError', 400, 'Intervallo non valido.');
    return structuredClone(state.entries.filter(e => e.patientId === patientId && (from === undefined || e.consumptionTime >= from) && (to === undefined || e.consumptionTime < to)).sort((a, b) => b.consumptionTime - a.consumptionTime));
  }

  private patientOnly(actor: Principal) { if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Operazione riservata al Patient.'); }
}
