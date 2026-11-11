import type { DiaryEntry as DiaryEntryRow, Prisma } from '@prisma/client';
import type { DiaryEntry, DiaryRepository, DiarySharingPreference, DiaryState } from '../modules/diary/public';
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

  async findByOperation(patientId: string, operationId: string): Promise<DiaryEntry | null> {
    const { entries } = await this.repository.get();
    return entries.find(entry => entry.patientId === patientId && entry.operationId === operationId) ?? null;
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
      .sort((a, b) => b.consumptionTime - a.consumptionTime);
  }
}

function readEntry({ sequence, consumptionTime, createdAt, ...entry }: DiaryEntryRow): DiaryEntry {
  return { ...entry, consumptionTime: consumptionTime.getTime(), createdAt: createdAt.getTime() };
}

export class PostgresDiaryRepository implements DiaryRepository {
  constructor(private readonly transaction: () => Pick<Prisma.TransactionClient, 'diaryEntry' | 'diarySharingPreference'>) {}

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

  async findByOperation(patientId: string, operationId: string): Promise<DiaryEntry | null> {
    const row = await this.transaction().diaryEntry.findUnique({ where: { patientId_operationId: { patientId, operationId } } });
    return row ? readEntry(row) : null;
  }

  async insert({ consumptionTime, createdAt, ...entry }: DiaryEntry): Promise<void> {
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
    return rows.map(readEntry);
  }
}
