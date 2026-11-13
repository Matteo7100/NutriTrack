/** Contratti client: il record persistito è un DTO senza credenziali. Il server autorizza ogni richiesta. */
export type QueueStatus = 'PENDING' | 'AUTH_REQUIRED' | 'CONFLICT' | 'REJECTED';
export interface Queued {
  id: string; accountId: string; kind: 'diary' | 'progress'; payload: Record<string, unknown>;
  status: QueueStatus; attempts: number; nextAttempt: number; error?: string;
}
// Receiver dei Command: implementazione HTTP e fake espongono la stessa operazione.
export interface ApiClient {
  request<T>(path: string, method?: string, body?: unknown): Promise<T>;
  /** Riceve la sessione letta da /auth/me prima dell'invio, per aggiornare il token CSRF. */
  session?(value: { csrfToken?: string }): void;
}
export interface QueueStore {
  read(accountId: string): Promise<Queued[]>;
  save(item: Queued): Promise<void>;
  remove(id: string): Promise<void>;
}
// type discrimina i fatti notificati; gli eventi non sono richieste al dominio.
export type SyncEvent =
  | { type: 'queued' | 'confirmed' | 'retry-ready' | 'discarded'; accountId: string; operationId: string; at: number }
  | { type: 'failed'; accountId: string; operationId: string; at: number; status: QueueStatus; error: string };
export interface SyncObserver { onSyncEvent(event: SyncEvent): void | Promise<void> }
