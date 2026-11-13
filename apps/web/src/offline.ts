/**
 * Facade compatibile: compone store, receiver e motore dei pattern in sync/.
 * Nessuna credenziale è persistita. api usa la sessione corrente del browser.
 */
import { api, setCsrf } from './api';
import type { User } from './types';
import { RetryContext } from './sync/retry';
import { IndexedDbQueueStore } from './sync/storage';
import { SyncEngine } from './sync/sync-engine';
import type { Queued } from './sync/types';

export type { Queued, QueueStatus } from './sync/types';
export { readSnapshot, saveSnapshot, deleteSnapshot } from './sync/storage';
import { saveSnapshotIfAbsent } from './sync/storage';
export const queueStore = new IndexedDbQueueStore();
const retryContext = new RetryContext();
export const syncEngine = new SyncEngine(queueStore, {
  request: api,
  session: value => { if (value.csrfToken) setCsrf(value.csrfToken); },
}, retryContext);
export const readQueue = (accountId: string) => queueStore.read(accountId);
export const setSyncAccount = (accountId: string | null) => syncEngine.setAccount(accountId);
export const enqueue = (accountId: string, kind: Queued['kind'], payload: Record<string, unknown>) => syncEngine.enqueue(accountId, kind, payload);
export const retryAuthentication = (accountId: string) => syncEngine.retryAuthentication(accountId);
export const flushQueue = (accountId: string) => syncEngine.flush(accountId);
export const retryItem = (accountId: string, operationId: string) => syncEngine.retryItem(accountId, operationId);
export const discardItem = (accountId: string, operationId: string) => syncEngine.discard(accountId, operationId);

/**
 * Identità minima per il riavvio offline: senza snapshot il bootstrap non può
 * riaprire l'area Patient e la coda resterebbe irraggiungibile. cachedAt 0 indica
 * che piano e storici non sono ancora stati scaricati su questo dispositivo.
 */
export function ensureOfflineIdentity(user: User): Promise<void> {
  if (user.role !== 'PATIENT') return Promise.resolve();
  return saveSnapshotIfAbsent({ user, active: null, history: [], diary: [], measurements: [], sharing: false, cachedAt: 0 });
}

/** Enqueue che garantisce, prima di confermare il salvataggio, il ripristino offline. */
export async function enqueueFor(user: User, kind: Queued['kind'], payload: Record<string, unknown>): Promise<string> {
  await ensureOfflineIdentity(user);
  return syncEngine.enqueue(user.id, kind, payload);
}
export const failureState = (item: Queued, error: unknown, now: number) => retryContext.failure(item, error, now).item;

export function localNow(): string {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

/** Converte il campo datetime-local in un ISO con UTC esplicito. */
export function localToIso(value: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('Data e ora non valide.');
  return date.toISOString();
}
