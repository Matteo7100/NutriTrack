/**
 * Concrete Factory delle famiglie Memory e PostgreSQL. Ogni factory crea i
 * repository dei moduli e una UnitOfWork collegati allo STESSO contesto transazionale.
 * I servizi usano gli stessi contratti in entrambe le famiglie.
 * PostgreSQL conserva lock advisory + ReadCommitted; Memory replica commit/rollback.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient, Prisma } from '@prisma/client';
import { Repository } from '../shared/contracts';
import { UnitOfWork } from '../shared/unit-of-work';
import { createEmptyIdentityState } from '../modules/identity/public';
import { createEmptyPatientState } from '../modules/patient-management/public';
import { createEmptyMealPlanningState } from '../modules/meal-planning/public';
import { createEmptyDiaryState } from '../modules/diary/public';
import { createEmptyProgressState, StoredProgressPhoto } from '../modules/progress/public';
import { StorageFactory } from './storage-factory';
import { MemoryRepository, MemoryKey, MemoryState } from './repository-adapters';
import { MemoryIdentityRepository, PostgresIdentityRepository } from './identity-repositories';
import { MemoryPatientRepository, PostgresPatientRepository } from './patient-repositories';
import { MemoryMealPlanRepository, PostgresMealPlanRepository } from './meal-plan-repositories';
import { MemoryDiaryRepository, PostgresDiaryRepository } from './diary-repositories';
import { MemoryProgressRepository, PostgresProgressRepository } from './progress-repositories';
import { MemoryProgressPhotoRepository, PostgresProgressPhotoRepository } from './progress-photo-repositories';

export type { StorageFactory } from './storage-factory';

/** Prodotto transazionale della famiglia Memory: fake usato esclusivamente nei test. */
export class MemoryUnitOfWork implements UnitOfWork {
  private data: MemoryState = new Map();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly context: AsyncLocalStorage<MemoryState>) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return operation();
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const snapshot = structuredClone(this.data);
      const result = await this.context.run(snapshot, operation);
      this.data = snapshot; // Commit soltanto quando il caso d'uso termina senza errori.
      return result;
    } finally { release(); }
  }
}

export class MemoryStorageFactory implements StorageFactory, UnitOfWork {
  private readonly context = new AsyncLocalStorage<MemoryState>();
  private readonly unitOfWork = new MemoryUnitOfWork(this.context);
  private repository<T>(key: MemoryKey, initial: () => T): Repository<T> {
    return new MemoryRepository(key, initial, () => {
      const state = this.context.getStore();
      if (!state) throw new Error('Repository usato fuori dalla UnitOfWork.');
      return state;
    });
  }
  createIdentityRepository() { return new MemoryIdentityRepository(this.repository('identity', createEmptyIdentityState)); }
  createPatientRepository() { return new MemoryPatientRepository(this.repository('patients', createEmptyPatientState)); }
  createMealPlanRepository() { return new MemoryMealPlanRepository(this.repository('plans', createEmptyMealPlanningState)); }
  createDiaryRepository() { return new MemoryDiaryRepository(this.repository('diary', createEmptyDiaryState)); }
  createProgressRepository() { return new MemoryProgressRepository(this.repository('progress', createEmptyProgressState)); }
  createProgressPhotoRepository() { return new MemoryProgressPhotoRepository(this.repository<StoredProgressPhoto[]>('progressPhotos', () => [])); }
  // Tutti i client della stessa factory condividono questo prodotto e il suo stato.
  createUnitOfWork(): UnitOfWork { return this.unitOfWork; }
  async close() { /* Nessuna connessione nel fake. */ }
  // Compatibilità con gli avvii e test storici che chiamano direttamente factory.run.
  run<T>(operation: () => Promise<T>): Promise<T> { return this.unitOfWork.run(operation); }
}

/** Prodotto transazionale PostgreSQL: nessun cambiamento all'isolamento esistente. */
export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly client: PrismaClient, private readonly context: AsyncLocalStorage<Prisma.TransactionClient>) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return operation();
    return this.client.$transaction(async tx => {
      // Lock prima del primo read: richieste concorrenti vedono l'ultimo commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72564103)`;
      return this.context.run(tx, operation);
    }, { isolationLevel: 'ReadCommitted', maxWait: 30000, timeout: 30000 });
  }
}

export class PostgresStorageFactory implements StorageFactory, UnitOfWork {
  private readonly client = new PrismaClient();
  private readonly context = new AsyncLocalStorage<Prisma.TransactionClient>();
  private readonly unitOfWork = new PostgresUnitOfWork(this.client, this.context);
  private currentTransaction(): Prisma.TransactionClient {
    const tx = this.context.getStore();
    if (!tx) throw new Error('Repository usato fuori dalla UnitOfWork.');
    return tx;
  }
  createIdentityRepository() { return new PostgresIdentityRepository(() => this.currentTransaction()); }
  createPatientRepository() { return new PostgresPatientRepository(() => this.currentTransaction()); }
  createMealPlanRepository() { return new PostgresMealPlanRepository(() => this.currentTransaction()); }
  createDiaryRepository() { return new PostgresDiaryRepository(() => this.currentTransaction()); }
  createProgressRepository() { return new PostgresProgressRepository(() => this.currentTransaction()); }
  createProgressPhotoRepository() { return new PostgresProgressPhotoRepository(() => this.currentTransaction().progressPhoto); }
  createUnitOfWork(): UnitOfWork { return this.unitOfWork; }
  async close() { await this.client.$disconnect(); }
  run<T>(operation: () => Promise<T>): Promise<T> { return this.unitOfWork.run(operation); }
}

/** Nomi storici mantenuti per compatibilità; il client nuovo usa StorageFactory. */
export interface Persistence extends StorageFactory, UnitOfWork {}
/** @deprecated Usare MemoryStorageFactory per rendere esplicita la famiglia. */
export class MemoryPersistence extends MemoryStorageFactory implements Persistence {}
/** @deprecated Usare PostgresStorageFactory per rendere esplicita la famiglia. */
export class PostgresPersistence extends PostgresStorageFactory implements Persistence {}
