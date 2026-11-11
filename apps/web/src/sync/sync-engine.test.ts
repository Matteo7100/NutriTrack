/**
 * Test di Invoker/Subject con store e receiver sostituibili. Le Promise differite
 * riproducono il cambio account mentre una chiamata asincrona è ancora in corso.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { QueuePanelModel, PatientDataRefresher } from './observers';
import { SyncEngine } from './sync-engine';
import type { ApiClient, Queued, QueueStore, SyncEvent } from './types';

class MemoryStore implements QueueStore {
  readonly data = new Map<string, Queued>();
  async read(account: string) { return [...this.data.values()].filter(item => item.accountId === account).map(item => structuredClone(item)); }
  async save(item: Queued) { this.data.set(item.id, structuredClone(item)); }
  async remove(id: string) { this.data.delete(id); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const store = new MemoryStore();
  const request = vi.fn().mockImplementation(async (path: string) => path === '/auth/me' ? { user: { id: 'P1' } } : { id: 'server' });
  const receiver: ApiClient = { request };
  let id = 0;
  const engine = new SyncEngine(store, receiver, undefined, () => 1000, () => true, () => `op-${++id}`);
  engine.setAccount('P1');
  return { store, request, engine };
}
const event = (type: 'queued' | 'confirmed', accountId = 'P1'): SyncEvent => ({ type, accountId, operationId: 'op-1', at: 1000 });

describe('Observer concreti', () => {
  it('QueuePanelModel filtra l’account e rilegge solo dopo un evento pertinente', async () => {
    const store = new MemoryStore(), render = vi.fn();
    await store.save({ id: 'op-1', accountId: 'P1', kind: 'diary', payload: {}, status: 'PENDING', attempts: 0, nextAttempt: 0 });
    const panel = new QueuePanelModel('P1', store, render);
    await panel.onSyncEvent(event('queued', 'P2'));
    expect(render).not.toHaveBeenCalled();
    await panel.onSyncEvent(event('queued'));
    expect(render).toHaveBeenCalledWith(await store.read('P1'));
    panel.dispose(); await panel.onSyncEvent(event('confirmed'));
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('una lettura pendente non aggiorna il pannello dopo dispose', async () => {
    const gate = deferred<Queued[]>(), render = vi.fn();
    const panel = new QueuePanelModel('P1', { read: () => gate.promise }, render);
    const reading = panel.refresh(); panel.dispose(); gate.resolve([]); await reading;
    expect(render).not.toHaveBeenCalled();
  });
  it('PatientDataRefresher reagisce solo a conferme dell’account attivo', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    let active = true;
    const observer = new PatientDataRefresher('P1', refresh, () => active);
    await observer.onSyncEvent(event('queued'));
    await observer.onSyncEvent(event('confirmed', 'P2'));
    await observer.onSyncEvent(event('confirmed'));
    expect(refresh).toHaveBeenCalledExactlyOnceWith('P1');
    active = false; await observer.onSyncEvent(event('confirmed'));
    active = true; observer.dispose(); await observer.onSyncEvent(event('confirmed'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('Subject e Invoker SyncEngine', () => {
  it('dopo cambio account durante enqueue conserva il DTO ma non notifica la nuova UI', async () => {
    const { engine, store } = fixture();
    const committing = deferred<void>();
    vi.spyOn(store, 'save').mockImplementation(async item => {
      await committing.promise; store.data.set(item.id, structuredClone(item));
    });
    const onSyncEvent = vi.fn(); engine.subscribe({ onSyncEvent });
    const payload = { extra: { value: 75 } };
    const enqueuing = engine.enqueue('P1', 'progress', payload);
    payload.extra.value = 1; engine.setAccount('P2');
    committing.resolve(); await enqueuing;
    expect((await store.read('P1'))[0].payload).toEqual({ operationId: 'op-1', extra: { value: 75 } });
    expect(await store.read('P2')).toEqual([]);
    expect(onSyncEvent).not.toHaveBeenCalled();
  });
  it('notifica queued dopo persistenza e supporta unsubscribe', async () => {
    const { engine, store } = fixture();
    const seen: SyncEvent[] = [];
    const unsubscribe = engine.subscribe({ onSyncEvent: async received => {
      expect(await store.read('P1')).toHaveLength(1); seen.push(received);
    } });
    await engine.enqueue('P1', 'diary', { actualConsumption: 'Pane' });
    unsubscribe(); await engine.enqueue('P1', 'progress', { value: 75 });
    expect(seen.map(item => item.type)).toEqual(['queued']);
  });
  it('isola errori degli observer e non riesegue un Command già confermato', async () => {
    const { engine, store, request } = fixture();
    await engine.enqueue('P1', 'diary', { actualConsumption: 'Pane' });
    const seen: string[] = [];
    engine.subscribe({ onSyncEvent: () => { throw new Error('UI difettosa'); } });
    engine.subscribe({ onSyncEvent: async received => {
      if (received.type === 'confirmed') expect(await store.read('P1')).toEqual([]);
      seen.push(received.type);
    } });
    expect(await engine.flush('P1')).toBe(true);
    await engine.flush('P1');
    expect(request.mock.calls.filter(call => call[0] === '/diary')).toHaveLength(1);
    expect(seen).toEqual(['confirmed']);
    expect(await store.read('P1')).toEqual([]);
  });
  it('arresta il batch se il primo Command riceve 401', async () => {
    const { engine, store, request } = fixture();
    await engine.enqueue('P1', 'diary', {}); await engine.enqueue('P1', 'progress', {});
    request.mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { user: { id: 'P1' } };
      throw new ApiError('AuthenticationError', 401, 'Accedi');
    });
    const seen: SyncEvent[] = [];
    engine.subscribe({ onSyncEvent: received => { seen.push(received); } });
    await engine.flush('P1');
    expect(request.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(1);
    expect((await store.read('P1')).map(item => item.status)).toEqual(['AUTH_REQUIRED', 'PENDING']);
    expect(seen[0]).toMatchObject({ type: 'failed', status: 'AUTH_REQUIRED' });
  });
  it('annulla l’invio se cambia account mentre attende la sessione', async () => {
    const { engine, store, request } = fixture();
    await engine.enqueue('P1', 'diary', {});
    const gate = deferred<unknown>(); request.mockReturnValue(gate.promise);
    const flushing = engine.flush('P1'); engine.setAccount('P2');
    gate.resolve({ user: { id: 'P1' } }); await flushing;
    expect(request).toHaveBeenCalledTimes(1);
    expect(await store.read('P1')).toHaveLength(1);
  });
  it('annulla l’invio se cambia account durante la lettura della coda', async () => {
    const { engine, store, request } = fixture();
    await engine.enqueue('P1', 'diary', {});
    const stored = await store.read('P1');
    const readStarted = deferred<void>(), gate = deferred<Queued[]>();
    vi.spyOn(store, 'read').mockImplementation(() => { readStarted.resolve(); return gate.promise; });
    const flushing = engine.flush('P1'); await readStarted.promise;
    engine.setAccount('P2'); gate.resolve(stored); await flushing;
    expect(request.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(0);
  });
  it('dopo cambio account durante HTTP conserva il DTO e non invia il successivo', async () => {
    const { engine, store, request } = fixture();
    await engine.enqueue('P1', 'diary', {}); await engine.enqueue('P1', 'progress', {});
    const sent = deferred<void>(), gate = deferred<unknown>();
    request.mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { user: { id: 'P1' } };
      sent.resolve(); return gate.promise;
    });
    const seen: SyncEvent[] = []; engine.subscribe({ onSyncEvent: received => { seen.push(received); } });
    const flushing = engine.flush('P1'); await sent.promise;
    engine.setAccount('P2'); gate.resolve({ id: 'committed' }); await flushing;
    expect(request.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(1);
    expect(await store.read('P1')).toHaveLength(2);
    expect(seen).toEqual([]);
  });
});
