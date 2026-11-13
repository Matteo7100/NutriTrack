/**
 * Regressioni dal collaudo dell'11 novembre 2026 sul lato client:
 * token CSRF sostituito, coda bloccata, identità offline al primo uso e logout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from './api';
import { deleteSnapshot, discardItem, enqueueFor, ensureOfflineIdentity, flushQueue, readQueue, readSnapshot, retryItem, saveSnapshot, setSyncAccount } from './offline';
import { RetryContext } from './sync/retry';
import type { Queued } from './sync/types';
import type { Snapshot, User } from './types';

const http = vi.hoisted(() => ({ request: vi.fn(), csrf: vi.fn() }));
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: http.request, setCsrf: http.csrf }));

const patient: User = { id: 'P1', name: 'Paziente', email: 'p1@example.test', role: 'PATIENT' };
const meal = { consumptionTime: '2026-11-12T08:00:00Z', actualConsumption: 'Avena' };

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', { onLine: true });
  http.request.mockReset(); http.csrf.mockReset();
  setSyncAccount('P1');
});
afterEach(() => { setSyncAccount(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Collaudo 11 novembre · client', () => {
  it('NT-02: il primo salvataggio offline crea l’identità per il riavvio, senza sovrascrivere una copia completa', async () => {
    await enqueueFor(patient, 'diary', meal);
    expect(await readSnapshot('P1')).toMatchObject({ user: patient, cachedAt: 0 });
    const full: Snapshot = { user: patient, active: null, history: [], diary: [], measurements: [], sharing: true, cachedAt: 500 };
    await saveSnapshot(full);
    await ensureOfflineIdentity(patient);
    expect(await readSnapshot('P1')).toEqual(full);
    expect(await readQueue('P1')).toHaveLength(1);
  });

  it('logout: la copia dei dati viene cancellata, la coda resta', async () => {
    await enqueueFor(patient, 'diary', meal);
    await deleteSnapshot('P1');
    expect(await readSnapshot('P1')).toBeNull();
    expect(await readQueue('P1')).toHaveLength(1);
  });

  it('B: il flush usa il token CSRF della sessione corrente e tratta CsrfError come transitorio', async () => {
    await enqueueFor(patient, 'diary', meal);
    http.request.mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { user: { id: 'P1' }, csrfToken: 'token-nuovo' };
      throw new ApiError('CsrfError', 403, 'Sessione non valida per questa operazione.');
    });
    await flushQueue('P1');
    expect(http.csrf).toHaveBeenCalledWith('token-nuovo');
    const [item] = await readQueue('P1');
    expect(item.status).toBe('PENDING');
    const other: Queued = { ...item, attempts: 0 };
    expect(new RetryContext().failure(other, new ApiError('InvalidDiaryEntry', 400, 'x'), 0).item.status).toBe('REJECTED');
  });

  it('C: un’operazione respinta si può riprovare con lo stesso ID oppure eliminare', async () => {
    const operationId = await enqueueFor(patient, 'diary', meal);
    http.request.mockImplementation(async (path: string) => {
      if (path === '/auth/me') return { user: { id: 'P1' } };
      throw new ApiError('InvalidDiaryEntry', 400, 'Data non valida o futura.');
    });
    await flushQueue('P1');
    expect((await readQueue('P1'))[0].status).toBe('REJECTED');
    await retryItem('P1', operationId);
    expect((await readQueue('P1'))[0]).toMatchObject({ status: 'PENDING', attempts: 0, id: operationId, payload: { operationId } });
    http.request.mockImplementation(async (path: string, _method?: string, body?: { operationId: string }) =>
      path === '/auth/me' ? { user: { id: 'P1' } } : { id: 'server', operationId: body?.operationId });
    await flushQueue('P1');
    expect(await readQueue('P1')).toEqual([]);
    expect(http.request).toHaveBeenLastCalledWith('/diary', 'POST', expect.objectContaining({ operationId }));

    const second = await enqueueFor(patient, 'diary', { ...meal, actualConsumption: 'Pane' });
    await discardItem('P1', second);
    expect(await readQueue('P1')).toEqual([]);
  });
});
