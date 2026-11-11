/** Ogni policy è verificata come algoritmo; il contesto delega anche a strategie alternative. */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { BackoffRetryStrategy, RetryContext, StopRetryStrategy, WaitForLoginStrategy, type RetryStrategy } from './retry';
import type { Queued } from './types';
const item: Queued = { id: 'id1', accountId: 'P1', kind: 'diary', payload: { operationId: 'id1' }, status: 'PENDING', attempts: 2, nextAttempt: 0 };

describe('Strategy di retry', () => {
  it('BackoffRetryStrategy cresce con i tentativi e applica il limite', () => {
    const policy = new BackoffRetryStrategy();
    expect(policy.decide(new Error('rete'), 1, 100).nextAttempt).toBe(2100);
    expect(policy.decide(new Error('rete'), 100, 100).nextAttempt).toBe(60100);
  });
  it('WaitForLoginStrategy ferma il batch; StopRetryStrategy distingue conflitto e rifiuto', () => {
    expect(new WaitForLoginStrategy().decide(null, 1, 100)).toEqual({ status: 'AUTH_REQUIRED', nextAttempt: 100, stopBatch: true });
    expect(new StopRetryStrategy().decide(new ApiError('Conflict', 409, 'x'), 1, 100).status).toBe('CONFLICT');
    expect(new StopRetryStrategy().decide(new ApiError('Invalid', 400, 'x'), 1, 100).status).toBe('REJECTED');
  });
  it.each([
    [401, 'AUTH_REQUIRED'], [409, 'CONFLICT'], [400, 'REJECTED'], [403, 'REJECTED'],
    [408, 'PENDING'], [429, 'PENDING'], [500, 'PENDING'], [503, 'PENDING'],
  ])('il contesto seleziona la policy per HTTP %s', (status, expected) => {
    const result = new RetryContext().failure(item, new ApiError('Http', status as number, 'errore'), 100);
    expect(result.item.status).toBe(expected);
    expect(result.item.payload).toEqual(item.payload);
    expect(result.item.attempts).toBe(3);
  });
  it('delega a una strategia iniettata, anziché incorporare il suo algoritmo', () => {
    const decide = vi.fn<RetryStrategy['decide']>().mockReturnValue({ status: 'PENDING', nextAttempt: 117, stopBatch: false });
    const context = new RetryContext({ backoff: { decide } });
    const error = new Error('rete');
    const result = context.failure(item, error, 100);
    expect(decide).toHaveBeenCalledWith(error, 3, 100);
    expect(result.item.nextAttempt).toBe(117); // diverso dal backoff esponenziale standard
    expect(context.select(error)).toEqual({ decide });
  });
});
