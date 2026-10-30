/**
 * Prova IndexedDB con la sua API reale simulata in memoria da fake-indexeddb.
 * Le richieste HTTP sono simulate per verificare retry, identità e risposta persa.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from './api';
import { enqueue, flushQueue, readQueue, readSnapshot, retryAuthentication, saveSnapshot, setSyncAccount } from './offline';
import type { Snapshot } from './types';

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: http.request }));

const snapshot: Snapshot = {
  user: { id: 'P1', name: 'Patient', email: 'p1@example.test', role: 'PATIENT' },
  active: null, history: [], diary: [], measurements: [], sharing: false, cachedAt: 100,
};

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', { onLine: true });
  http.request.mockReset();
  setSyncAccount('P1');
});
afterEach(() => { setSyncAccount(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Persistenza offline e riconciliazione', () => {
  it('separa snapshot e coda per account', async () => {
    await saveSnapshot(snapshot);
    await enqueue('P1', 'diary', { consumptionTime: '2026-10-05T08:00:00Z', actualConsumption: 'Pane' });
    expect((await readSnapshot('P1'))?.user.id).toBe('P1');
    expect(await readSnapshot('P2')).toBeNull();
    expect(await readQueue('P2')).toEqual([]);
    const [pending] = await readQueue('P1');
    expect(pending.payload.operationId).toBe(pending.id);
    expect((await readQueue('P1'))[0].id).toBe(pending.id);
  });

  it('non invia le operazioni se il server riconosce un altro account', async () => {
    await enqueue('P1', 'progress', { value: 75 });
    http.request.mockResolvedValue({ user: { id: 'P2' } });
    expect(await flushQueue('P1')).toBe(false);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(await readQueue('P1')).toHaveLength(1);
  });

  it('conserva lo stesso operationId dopo una risposta persa e rimuove solo dopo conferma', async () => {
    await enqueue('P1', 'diary', { consumptionTime: '2026-10-05T08:00:00Z', actualConsumption: 'Pane' });
    const committed = new Map<string, unknown>();
    const sent: string[] = [];
    let lost = true;
    http.request.mockImplementation(async (path: string, _method?: string, body?: Record<string, unknown>) => {
      if (path === '/auth/me') return { user: { id: 'P1' } };
      const id = String(body!.operationId); sent.push(id); committed.set(id, body);
      if (lost) { lost = false; throw new Error('Risposta persa dopo il commit'); }
      return { id };
    });
    await flushQueue('P1');
    expect(await readQueue('P1')).toHaveLength(1);
    const later = Date.now() + 120_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await flushQueue('P1');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
    expect(committed.size).toBe(1);
    expect(await readQueue('P1')).toHaveLength(0);
  });

  it('trattiene la coda con sessione scaduta e riparte dopo nuovo login', async () => {
    await enqueue('P1', 'progress', { value: 75 });
    http.request.mockRejectedValue(new ApiError('AuthenticationError', 401, 'Sessione scaduta'));
    await flushQueue('P1');
    expect((await readQueue('P1'))[0].status).toBe('AUTH_REQUIRED');
    await retryAuthentication('P1');
    http.request.mockImplementation(async (path: string) => path === '/auth/me' ? { user: { id: 'P1' } } : { id: 'confirmed' });
    await flushQueue('P1');
    expect(await readQueue('P1')).toEqual([]);
  });

  it('rende esplicito un conflitto e non ritenta automaticamente', async () => {
    await enqueue('P1', 'progress', { value: 75 });
    http.request.mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { user: { id: 'P1' } };
      throw new ApiError('OperationConflict', 409, 'Payload diverso');
    });
    await flushQueue('P1');
    expect((await readQueue('P1'))[0].status).toBe('CONFLICT');
    http.request.mockClear();
    await flushQueue('P1');
    expect(http.request).toHaveBeenCalledTimes(1); // Solo verifica sessione, nessuna POST.
  });
});
