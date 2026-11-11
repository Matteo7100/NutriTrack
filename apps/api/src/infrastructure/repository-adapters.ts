/**
 * Adapter GoF espliciti. I servizi chiedono get/save (Target Repository<T>),
 * mentre gli archivi offrono Map.get/set oppure Prisma.findUnique/upsert.
 * Ogni adapter riceve dalla factory il proprio scope e il contesto transazionale:
 * non apre una transazione separata e non sceglie tabelle in base al client HTTP.
 */
import type { Prisma } from '@prisma/client';
import { Repository } from '../shared/contracts';

export type ModuleKey = 'patients' | 'plans' | 'diary' | 'progress';
export type MemoryKey = ModuleKey | 'identity' | 'progressPhotos';
export type MemoryState = Map<MemoryKey, unknown>;

/** API comune dei modelli Prisma che conservano aggregati in JSONB. */
export interface PrismaStateDelegate {
  findUnique(args: { where: { id: string } }): Promise<{ data: Prisma.JsonValue } | null>;
  upsert(args: { where: { id: string }; create: { id: string; data: Prisma.InputJsonValue }; update: { data: Prisma.InputJsonValue } }): Promise<unknown>;
}

export class MemoryRepository<T> implements Repository<T> {
  constructor(
    private readonly key: MemoryKey,
    private readonly initial: () => T,
    // La callback restituisce soltanto lo snapshot della transazione corrente.
    private readonly currentState: () => MemoryState,
  ) {}
  async get(): Promise<T> {
    return structuredClone((this.currentState().get(this.key) as T | undefined) ?? this.initial());
  }
  async save(value: T): Promise<void> {
    // La copia impedisce che un chiamante alteri lo stato salvato dopo il return.
    this.currentState().set(this.key, structuredClone(value));
  }
}

export class PostgresRepository<T> implements Repository<T> {
  constructor(
    private readonly initial: () => T,
    // L'adaptee è il model del solo modulo, risolto nella UnitOfWork corrente.
    private readonly currentDelegate: () => PrismaStateDelegate,
  ) {}
  async get(): Promise<T> {
    const row = await this.currentDelegate().findUnique({ where: { id: 'root' } });
    return row ? structuredClone(row.data) as T : this.initial();
  }
  async save(value: T): Promise<void> {
    // Traduzione della rappresentazione applicativa in JSON compatibile con Prisma.
    const data = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    await this.currentDelegate().upsert({ where: { id: 'root' }, create: { id: 'root', data }, update: { data } });
  }
}
