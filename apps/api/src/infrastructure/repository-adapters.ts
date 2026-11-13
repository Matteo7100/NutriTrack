/** Archivio di supporto per i repository in memoria della stessa Unit of Work. */
import { Repository } from '../shared/contracts';

export type MemoryKey = 'identity' | 'patients' | 'plans' | 'diary' | 'progress' | 'progressPhotos' | 'notifications';
export type MemoryState = Map<MemoryKey, unknown>;

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
