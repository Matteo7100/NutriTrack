/** Test della policy client: i conflitti non diventano nuove scritture silenziose. */
import { describe, it, expect } from 'vitest';
import { ApiError } from './api';
import { failureState, localToIso, type Queued } from './offline';
const item: Queued = { id: 'same-id', accountId: 'p1', kind: 'diary', payload: { operationId: 'same-id' }, status: 'PENDING', attempts: 0, nextAttempt: 0 };
describe('Riconciliazione offline', () => {
  it('mantiene ID e payload dopo un errore di rete', () => {
    const result = failureState(item, new Error('rete'), 100);
    expect(result.id).toBe(item.id);
    expect(result.payload).toEqual(item.payload);
    expect(result.nextAttempt).toBeGreaterThan(100);
  });
  it('blocca retry automatico dopo conflitto o validazione', () => {
    expect(failureState(item, new ApiError('OperationConflict', 409, 'conflitto'), 0).status).toBe('CONFLICT');
    expect(failureState(item, new ApiError('InvalidDiaryEntry', 400, 'errore'), 0).status).toBe('REJECTED');
  });
  it('conserva la coda quando la sessione è scaduta', () => {
    expect(failureState(item, new ApiError('AuthenticationError', 401, 'login'), 0).status).toBe('AUTH_REQUIRED');
  });
  it('ritenta dopo un timeout o un limite temporaneo di richieste', () => {
    expect(failureState(item, new ApiError('Timeout', 408, 'attendi'), 0).status).toBe('PENDING');
    expect(failureState(item, new ApiError('RateLimit', 429, 'attendi'), 0).status).toBe('PENDING');
  });
  it('normalizza un istante in UTC e respinge input vuoti', () => {
    expect(localToIso('2026-10-05T14:00:00+02:00')).toBe('2026-10-05T12:00:00.000Z');
    expect(() => localToIso('')).toThrow();
  });
});
