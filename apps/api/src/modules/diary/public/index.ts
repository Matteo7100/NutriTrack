/**
 * Diario del Patient: la versione è risolta dal sistema al consumo, non al sync.
 * Condivisione globale inizialmente falsa e legata all'associazione corrente.
 * operationId rende i retry idempotenti: payload diverso sullo stesso ID è conflitto.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal } from '../../../shared/contracts';
import { assertSameRecord, digestRecord, type DeletedRecord } from '../../../shared/record-retry';
import { PatientService } from '../../patient-management/public';
import { MealPlanningService } from '../../meal-planning/public';

export interface DiaryEntry { id: string; patientId: string; consumptionTime: number; createdAt: number; actualConsumption: string; mealPlanVersionId: string | null; operationId: string; updatedAt?: number }
export type StoredDiaryEntry = DiaryEntry & { originalDigest?: string };
type DeletedDiary = DeletedRecord & { digest: string };
export interface DiarySharingPreference { enabled: boolean; assignmentId: string | null }
export interface DiaryState { entries: StoredDiaryEntry[]; preferences: Record<string, DiarySharingPreference>; deleted: DeletedDiary[] }
export const createEmptyDiaryState = (): DiaryState => ({ entries: [], preferences: {}, deleted: [] });
export interface RecordMeal { operationId: string; consumptionTime: string; actualConsumption: string }

export interface DiaryRepository {
  getPreference(patientId: string): Promise<DiarySharingPreference | null>;
  savePreference(patientId: string, preference: DiarySharingPreference): Promise<void>;
  findByOperation(patientId: string, operationId: string): Promise<StoredDiaryEntry | null>;
  findById(patientId: string, id: string): Promise<StoredDiaryEntry | null>;
  findDeleted(patientId: string, operationId: string): Promise<DeletedDiary | null>;
  insert(entry: DiaryEntry): Promise<void>;
  listByPatient(patientId: string, from?: number, to?: number): Promise<DiaryEntry[]>;
  update(entry: StoredDiaryEntry): Promise<void>;
  remove(entry: DeletedDiary): Promise<void>;
  erasePatient(patientId: string): Promise<void>;
}

export function diaryEntry({ originalDigest, ...entry }: StoredDiaryEntry): DiaryEntry { return entry; }
const digestMeal = (entry: Pick<DiaryEntry, 'consumptionTime' | 'actualConsumption'>) =>
  digestRecord([entry.consumptionTime, entry.actualConsumption]);
const minimumTime = Date.UTC(2000, 0, 1);
function assertMealDate(time: number) {
  if (time < minimumTime) throw new AppError('InvalidDiaryEntry', 400, 'La data deve essere dal 2000 in poi.');
}

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
  constructor(private readonly repo: DiaryRepository, private readonly patients: PatientService,
    private readonly plans: MealPlanningService, private readonly clock: Clock) {}

  async sharing(actor: Principal): Promise<{ enabled: boolean }> {
    this.patientOnly(actor);
    const preference = await this.repo.getPreference(actor.id);
    return { enabled: !!preference?.enabled && preference.assignmentId === await this.patients.assignmentKey(actor.id) && preference.assignmentId !== null };
  }

  async setSharing(actor: Principal, enabled: boolean) {
    this.patientOnly(actor);
    if (typeof enabled !== 'boolean') throw new AppError('ValidationError', 400, 'enabled deve essere booleano.');
    const assignmentId = await this.patients.assignmentKey(actor.id);
    if (enabled && !assignmentId) throw new AppError('PatientNotAssigned', 409, 'Associa un nutrizionista prima di condividere.');
    await this.repo.savePreference(actor.id, { enabled, assignmentId });
    return { enabled };
  }

  async record(actor: Principal, input: RecordMeal): Promise<DiaryEntry | DeletedRecord> {
    this.patientOnly(actor);
    if (!input || typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationId) || typeof input.actualConsumption !== 'string' || !input.actualConsumption.trim() || input.actualConsumption.length > 4000) {
      throw new AppError('InvalidDiaryEntry', 400, 'Operazione e consumo non validi.');
    }
    const consumptionTime = instant(input.consumptionTime, this.clock());
    const actualConsumption = input.actualConsumption.trim();
    const digest = digestMeal({ consumptionTime, actualConsumption });
    const existing = await this.repo.findByOperation(actor.id, input.operationId);
    if (existing) {
      assertSameRecord(existing.originalDigest ?? digestMeal(existing), digest);
      return diaryEntry(existing);
    }
    const deleted = await this.repo.findDeleted(actor.id, input.operationId);
    if (deleted) {
      const { digest: original, ...receipt } = deleted;
      assertSameRecord(original, digest);
      return receipt;
    }
    assertMealDate(consumptionTime);
    const version = await this.plans.getVersionAt(actor.id, consumptionTime);
    const entry: DiaryEntry = { id: randomUUID(), patientId: actor.id, consumptionTime, createdAt: this.clock(), actualConsumption, mealPlanVersionId: version?.id ?? null, operationId: input.operationId };
    await this.repo.insert(entry);
    return entry;
  }

  async list(actor: Principal, patientId: string, from?: number, to?: number) {
    await this.patients.assertAccess(actor, patientId);
    if (actor.role === 'NUTRITIONIST') {
      const pref = await this.repo.getPreference(patientId);
      if (!pref?.enabled || pref.assignmentId === null || pref.assignmentId !== await this.patients.assignmentKey(patientId)) throw new AppError('DiaryNotShared', 403, 'Il paziente non condivide il diario.');
    }
    if ((from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to)) || (from !== undefined && to !== undefined && from > to)) throw new AppError('ValidationError', 400, 'Intervallo non valido.');
    return this.repo.listByPatient(patientId, from, to);
  }

  private async ownEntry(actor: Principal, id: string) {
    this.patientOnly(actor);
    const entry = await this.repo.findById(actor.id, id);
    if (!entry) throw new AppError('DiaryEntryNotFound', 404, 'Pasto non trovato.');
    return entry;
  }

  async correct(actor: Principal, id: string, input: { consumptionTime?: unknown; actualConsumption?: unknown }): Promise<DiaryEntry> {
    const entry = await this.ownEntry(actor, id);
    const originalDigest = entry.originalDigest ?? digestMeal(entry);
    if (input.actualConsumption !== undefined) {
      if (typeof input.actualConsumption !== 'string' || !input.actualConsumption.trim() || input.actualConsumption.length > 4000) {
        throw new AppError('InvalidDiaryEntry', 400, 'Descrivi ciò che hai mangiato (massimo 4000 caratteri).');
      }
      entry.actualConsumption = input.actualConsumption.trim();
    }
    if (input.consumptionTime !== undefined) {
      const time = instant(input.consumptionTime, this.clock());
      if (time !== entry.consumptionTime) assertMealDate(time);
      entry.consumptionTime = time;
      entry.mealPlanVersionId = (await this.plans.getVersionAt(actor.id, time))?.id ?? null;
    }
    const updated = { ...entry, originalDigest, updatedAt: this.clock() };
    await this.repo.update(updated);
    return diaryEntry(updated);
  }

  async remove(actor: Principal, id: string): Promise<{ deleted: true }> {
    const entry = await this.ownEntry(actor, id);
    await this.repo.remove({ id, patientId: actor.id, operationId: entry.operationId,
      digest: entry.originalDigest ?? digestMeal(entry), deletedAt: this.clock() });
    return { deleted: true };
  }

  async exportPatient(actor: Principal) {
    return { sharing: (await this.sharing(actor)).enabled, entries: await this.repo.listByPatient(actor.id) };
  }

  async erasePatient(patientId: string): Promise<void> { await this.repo.erasePatient(patientId); }

  private patientOnly(actor: Principal) { if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Operazione riservata al paziente.'); }
}
