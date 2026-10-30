/**
 * Adapter Repository e Unit of Work: un repository per ogni modulo, uno stesso
 * confine transazionale per i flussi applicativi. I servizi non conoscono Prisma.
 * Il lock globale è una scelta conservativa per il volume del progetto d'esame:
 * impedisce race tra versione, privacy e sync; non è una soluzione per alto traffico.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient, Prisma } from '@prisma/client';
import { Repository } from '../shared/contracts';
import { UnitOfWork } from '../shared/unit-of-work';

export type ModuleKey = 'identity' | 'patients' | 'plans' | 'diary' | 'progress';
export interface Persistence extends UnitOfWork {
  repository<T>(key: ModuleKey, initial: () => T): Repository<T>;
  close(): Promise<void>;
}

/** Fake transazionale usato esclusivamente da test: rollback e isolamento seriale. */
export class MemoryPersistence implements Persistence {
  private data = new Map<ModuleKey, unknown>();
  private readonly context = new AsyncLocalStorage<Map<ModuleKey, unknown>>();
  private queue: Promise<void> = Promise.resolve();
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return operation();
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const snapshot = structuredClone(this.data);
      const result = await this.context.run(snapshot, operation);
      this.data = snapshot;
      return result;
    } finally { release(); }
  }
  repository<T>(key: ModuleKey, initial: () => T): Repository<T> {
    const state = () => {
      const context = this.context.getStore();
      if (!context) throw new Error('Repository usato fuori dalla UnitOfWork.');
      return context;
    };
    return {
      get: async () => structuredClone((state().get(key) as T | undefined) ?? initial()),
      save: async value => { state().set(key, structuredClone(value)); },
    };
  }
  async close() { /* Nessuna connessione nel fake. */ }
}

export class PostgresPersistence implements Persistence {
  private readonly client = new PrismaClient();
  private readonly context = new AsyncLocalStorage<Prisma.TransactionClient>();
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return operation();
    return this.client.$transaction(async tx => {
      // Lock transazionale rilasciato anche in rollback. Prima del primo read:
      // al livello ReadCommitted i successivi read vedono l'ultimo commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72564103)`;
      return this.context.run(tx, operation);
    }, { isolationLevel: 'ReadCommitted', maxWait: 30000, timeout: 30000 });
  }
  repository<T>(key: ModuleKey, initial: () => T): Repository<T> {
    const delegate = () => {
      const tx = this.context.getStore();
      if (!tx) throw new Error('Repository usato fuori dalla UnitOfWork.');
      // Selezione chiusa e statica: nessun nome SQL controllato dal client.
      const models = { identity: tx.identityState, patients: tx.patientState,
        plans: tx.mealPlanningState, diary: tx.diaryState, progress: tx.progressState };
      // I cinque model hanno la stessa forma; restringiamo l'API comune per
      // evitare l'unione delle firme generiche generate da Prisma.
      return models[key] as unknown as {
        findUnique(args: { where: { id: string } }): Promise<{ data: Prisma.JsonValue } | null>;
        upsert(args: { where: { id: string }; create: { id: string; data: Prisma.InputJsonValue }; update: { data: Prisma.InputJsonValue } }): Promise<unknown>;
      };
    };
    return {
      get: async () => {
        const row = await delegate().findUnique({ where: { id: 'root' } });
        return row ? structuredClone(row.data) as T : initial();
      },
      save: async value => {
        // Stati dei moduli serializzabili, nessuna funzione o Date persistita.
        const data = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
        await delegate().upsert({ where: { id: 'root' }, create: { id: 'root', data }, update: { data } });
      },
    };
  }
  async close() { await this.client.$disconnect(); }
}
