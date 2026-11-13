/**
 * Adapter IndexedDB, schema v1 invariato: snapshot e coda separati per account.
 * La Promise termina al commit della transazione, non al solo put riuscito.
 */
import type { Snapshot } from '../types';
import type { Queued, QueueStore } from './types';
const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('nutritrack-patient-v1', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('snapshots', { keyPath: 'id' });
    request.result.createObjectStore('queue', { keyPath: 'id' });
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
export class IndexedDbQueueStore implements QueueStore {
  async read(accountId: string): Promise<Queued[]> {
    const all = await transact<Queued[]>('queue', 'readonly', store => store.getAll());
    return all.filter(item => item.accountId === accountId);
  }
  async save(item: Queued): Promise<void> { await transact('queue', 'readwrite', store => store.put(item)); }
  async remove(id: string): Promise<void> { await transact('queue', 'readwrite', store => store.delete(id)); }
}
export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await transact('snapshots', 'readwrite', store => store.put({ id: snapshot.user.id, snapshot }));
}
/** Crea lo snapshot solo se assente: non sovrascrive mai una copia completa già salvata. */
export async function saveSnapshotIfAbsent(snapshot: Snapshot): Promise<void> {
  // Lettura e scrittura nella stessa transazione readwrite: nessun saveSnapshot
  // concorrente può inserirsi tra il controllo e l'inserimento.
  await transact('snapshots', 'readwrite', store => {
    const existing = store.get(snapshot.user.id);
    existing.onsuccess = () => { if (!existing.result) store.put({ id: snapshot.user.id, snapshot }); };
    return existing;
  });
}
/** Al logout la copia dei dati sanitari non resta sul dispositivo. La coda resta (vedi conferma). */
export async function deleteSnapshot(accountId: string): Promise<void> {
  await transact('snapshots', 'readwrite', store => store.delete(accountId));
}
export async function readSnapshot(accountId: string): Promise<Snapshot | null> {
  const value = await transact<{ snapshot: Snapshot } | undefined>('snapshots', 'readonly', store => store.get(accountId));
  return value?.snapshot ?? null;
}
