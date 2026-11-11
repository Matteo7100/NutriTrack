/**
 * Facade compatibile: compone store, receiver e motore dei pattern in sync/.
 * Nessuna credenziale è persistita. api usa la sessione corrente del browser.
 */
import { api } from './api';
import { RetryContext } from './sync/retry';
import { IndexedDbQueueStore } from './sync/storage';
import { SyncEngine } from './sync/sync-engine';
import type { Queued } from './sync/types';

export type { Queued, QueueStatus } from './sync/types';
export { readSnapshot, saveSnapshot } from './sync/storage';
export const queueStore = new IndexedDbQueueStore();
const retryContext = new RetryContext();
export const syncEngine = new SyncEngine(queueStore, { request: api }, retryContext);
export const readQueue = (accountId: string) => queueStore.read(accountId);
export const setSyncAccount = (accountId: string | null) => syncEngine.setAccount(accountId);
export const enqueue = (accountId: string, kind: Queued['kind'], payload: Record<string, unknown>) => syncEngine.enqueue(accountId, kind, payload);
export const retryAuthentication = (accountId: string) => syncEngine.retryAuthentication(accountId);
export const flushQueue = (accountId: string) => syncEngine.flush(accountId);
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
