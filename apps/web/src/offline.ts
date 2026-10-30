/**
 * IndexedDB conserva snapshot e operazioni Patient separati per account.
 * operationId è creato una sola volta: una risposta persa non genera un nuovo ID.
 * Nessuna password, cookie o token CSRF viene scritto nella cache.
 */
import { ApiError, api } from './api';
import type { Snapshot } from './types';

export type QueueStatus = 'PENDING' | 'AUTH_REQUIRED' | 'CONFLICT' | 'REJECTED';
export interface Queued {
  id: string; accountId: string; kind: 'diary' | 'progress'; payload: Record<string, unknown>;
  status: QueueStatus; attempts: number; nextAttempt: number; error?: string;
}
const DATABASE = 'nutritrack-patient-v1';
const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('snapshots', { keyPath: 'id' });
    db.createObjectStore('queue', { keyPath: 'id' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transact<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = action(tx.objectStore(storeName));
    tx.oncomplete = () => { db.close(); resolve(req.result as T); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
export const saveSnapshot = (snapshot: Snapshot) => transact('snapshots', 'readwrite', s => s.put({ id: snapshot.user.id, snapshot }));
export async function readSnapshot(accountId: string): Promise<Snapshot | null> {
  const value = await transact<{ snapshot: Snapshot } | undefined>('snapshots', 'readonly', s => s.get(accountId));
  return value?.snapshot ?? null;
}
export async function readQueue(accountId: string): Promise<Queued[]> {
  const all = await transact<Queued[]>('queue', 'readonly', s => s.getAll());
  return all.filter(item => item.accountId === accountId);
}
const writeQueue = (item: Queued) => transact('queue', 'readwrite', s => s.put(item));
export async function enqueue(accountId: string, kind: Queued['kind'], payload: Record<string, unknown>) {
  const id = crypto.randomUUID();
  await writeQueue({ id, accountId, kind, payload: { ...payload, operationId: id }, status: 'PENDING', attempts: 0, nextAttempt: 0 });
}

// 401 attende un nuovo login; un conflitto/errore di validazione non è ritentato in ciclo.
export function failureState(item: Queued, error: unknown, now: number): Queued {
  const attempts = item.attempts + 1;
  const status: QueueStatus = error instanceof ApiError
    ? error.status === 401 ? 'AUTH_REQUIRED' : error.status === 409 ? 'CONFLICT'
      : error.status === 408 || error.status === 429 ? 'PENDING'
      : error.status >= 400 && error.status < 500 ? 'REJECTED' : 'PENDING'
    : 'PENDING';
  return { ...item, status, attempts, nextAttempt: now + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)), error: error instanceof Error ? error.message : 'Connessione non disponibile.' };
}
export async function retryAuthentication(accountId: string) {
  for (const item of await readQueue(accountId)) {
    if (item.status === 'AUTH_REQUIRED') await writeQueue({ ...item, status: 'PENDING', nextAttempt: 0 });
  }
}
let syncing = false;
let syncAccount: string | null = null;
let generation = 0;
// Un cambio account interrompe le successive richieste del vecchio batch.
export function setSyncAccount(accountId: string | null) {
  if (syncAccount !== accountId) { syncAccount = accountId; generation++; }
}
export async function flushQueue(accountId: string): Promise<boolean> {
  if (syncing || !navigator.onLine || syncAccount !== accountId) return false;
  syncing = true;
  const batch = generation;
  let changed = false;
  try {
    // Non basta selezionare uno snapshot: il server deve riconoscere lo stesso account.
    let session: { user: { id: string } };
    try { session = await api('/auth/me'); }
    catch (error) {
      if (generation === batch) for (const item of await readQueue(accountId)) {
        if (item.status === 'PENDING') await writeQueue(failureState(item, error, Date.now()));
      }
      return false;
    }
    if (session.user.id !== accountId || generation !== batch) return false;
    for (const item of await readQueue(accountId)) {
      if (generation !== batch || syncAccount !== accountId) break;
      if (item.status !== 'PENDING' || item.nextAttempt > Date.now()) continue;
      try {
        await api(`/${item.kind}`, 'POST', item.payload);
        // Cancellare solo dopo risposta positiva. In caso di crash, il server deduplica.
        await transact('queue', 'readwrite', s => s.delete(item.id));
        changed = true;
      } catch (error) { await writeQueue(failureState(item, error, Date.now())); }
    }
  } finally { syncing = false; }
  return changed;
}

/** Converte il campo datetime-local in un ISO con UTC esplicito. */
export function localToIso(value: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('Data e ora non valide.');
  return date.toISOString();
}
