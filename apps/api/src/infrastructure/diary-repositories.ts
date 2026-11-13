import type { DiaryEntry as DiaryEntryRow, Prisma } from '@prisma/client';
import { diaryEntry } from '../modules/diary/public';
import type { DiaryEntry, DiaryRepository, DiarySharingPreference, DiaryState, StoredDiaryEntry } from '../modules/diary/public';
import type { Repository } from '../shared/contracts';

export class MemoryDiaryRepository implements DiaryRepository {
  constructor(private readonly repository: Repository<DiaryState>) {}

  async getPreference(patientId: string): Promise<DiarySharingPreference | null> {
    const { preferences } = await this.repository.get();
    return preferences[patientId] ?? null;
  }

  async savePreference(patientId: string, preference: DiarySharingPreference): Promise<void> {
    const state = await this.repository.get();
    state.preferences[patientId] = preference;
    await this.repository.save(state);
  }

  async findByOperation(patientId: string, operationId: string) {
    const { entries } = await this.repository.get();
    return entries.find(entry => entry.patientId === patientId && entry.operationId === operationId) ?? null;
  }
  async findById(patientId: string, id: string) {
    return (await this.repository.get()).entries.find(entry => entry.patientId === patientId && entry.id === id) ?? null;
  }
  async findDeleted(patientId: string, operationId: string) {
    return (await this.repository.get()).deleted.find(entry => entry.patientId === patientId && entry.operationId === operationId) ?? null;
  }

  async insert(entry: DiaryEntry): Promise<void> {
    const state = await this.repository.get();
    state.entries.push(entry);
    await this.repository.save(state);
  }

  async listByPatient(patientId: string, from?: number, to?: number): Promise<DiaryEntry[]> {
    const { entries } = await this.repository.get();
    return entries.filter(entry => entry.patientId === patientId &&
      (from === undefined || entry.consumptionTime >= from) && (to === undefined || entry.consumptionTime < to))
      .sort((a, b) => b.consumptionTime - a.consumptionTime).map(diaryEntry);
  }
  async update(entry: StoredDiaryEntry) {
    const state = await this.repository.get();
    state.entries = state.entries.map(current => current.id === entry.id ? entry : current);
    await this.repository.save(state);
  }
  async remove(entry: DiaryState['deleted'][number]) {
    const state = await this.repository.get();
    state.entries = state.entries.filter(current => current.id !== entry.id);
    state.deleted.push(entry);
    await this.repository.save(state);
  }
  async erasePatient(patientId: string) {
    const state = await this.repository.get();
    state.entries = state.entries.filter(entry => entry.patientId !== patientId);
    state.deleted = state.deleted.filter(entry => entry.patientId !== patientId);
    delete state.preferences[patientId];
    await this.repository.save(state);
  }
}

function readEntry({ sequence, consumptionTime, createdAt, updatedAt, originalDigest, ...entry }: DiaryEntryRow): StoredDiaryEntry {
  return { ...entry, consumptionTime: consumptionTime.getTime(), createdAt: createdAt.getTime(),
    ...(updatedAt && { updatedAt: updatedAt.getTime() }), ...(originalDigest && { originalDigest }) };
}

export class PostgresDiaryRepository implements DiaryRepository {
  constructor(private readonly transaction: () => Pick<Prisma.TransactionClient, 'diaryEntry' | 'diarySharingPreference' | 'deletedDiaryEntry'>) {}

  async getPreference(patientId: string): Promise<DiarySharingPreference | null> {
    return this.transaction().diarySharingPreference.findUnique({
      where: { patientId }, select: { enabled: true, assignmentId: true },
    });
  }

  async savePreference(patientId: string, preference: DiarySharingPreference): Promise<void> {
    await this.transaction().diarySharingPreference.upsert({
      where: { patientId }, create: { patientId, ...preference }, update: preference,
    });
  }

  async findByOperation(patientId: string, operationId: string) {
    const row = await this.transaction().diaryEntry.findUnique({ where: { patientId_operationId: { patientId, operationId } } });
    return row ? readEntry(row) : null;
  }
  async findById(patientId: string, id: string) {
    const row = await this.transaction().diaryEntry.findUnique({ where: { patientId, id } });
    return row ? readEntry(row) : null;
  }
  async findDeleted(patientId: string, operationId: string) {
    const row = await this.transaction().deletedDiaryEntry.findUnique({ where: { patientId_operationId: { patientId, operationId } } });
    return row ? { id: row.recordId, patientId, operationId, digest: row.digest, deletedAt: row.deletedAt.getTime() } : null;
  }

  async insert({ consumptionTime, createdAt, updatedAt, ...entry }: DiaryEntry): Promise<void> {
    await this.transaction().diaryEntry.create({ data: { ...entry, consumptionTime: new Date(consumptionTime), createdAt: new Date(createdAt) } });
  }

  async listByPatient(patientId: string, from?: number, to?: number): Promise<DiaryEntry[]> {
    const rows = await this.transaction().diaryEntry.findMany({
      where: { patientId, consumptionTime: {
        gte: from === undefined ? undefined : new Date(Math.ceil(from)),
        lt: to === undefined ? undefined : new Date(Math.ceil(to)),
      } },
      orderBy: [{ consumptionTime: 'desc' }, { sequence: 'asc' }],
    });
    return rows.map(row => diaryEntry(readEntry(row)));
  }
  async update(entry: StoredDiaryEntry) {
    await this.transaction().diaryEntry.update({ where: { id: entry.id, patientId: entry.patientId }, data: {
      actualConsumption: entry.actualConsumption, mealPlanVersionId: entry.mealPlanVersionId,
      consumptionTime: new Date(entry.consumptionTime), originalDigest: entry.originalDigest,
      updatedAt: entry.updatedAt === undefined ? undefined : new Date(entry.updatedAt),
    } });
  }
  async remove({ id, deletedAt, ...entry }: DiaryState['deleted'][number]) {
    const tx = this.transaction();
    await tx.diaryEntry.delete({ where: { id, patientId: entry.patientId } });
    await tx.deletedDiaryEntry.create({ data: { ...entry, recordId: id, deletedAt: new Date(deletedAt) } });
  }
  async erasePatient(patientId: string) {
    const tx = this.transaction();
    await tx.diaryEntry.deleteMany({ where: { patientId } });
    await tx.diarySharingPreference.deleteMany({ where: { patientId } });
    await tx.deletedDiaryEntry.deleteMany({ where: { patientId } });
  }
}
