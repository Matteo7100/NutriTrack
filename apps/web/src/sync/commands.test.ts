/** I Command usano il receiver iniettato e mantengono il DTO ricostruito, senza nuovi ID. */
import { describe, expect, it, vi } from 'vitest';
import { RecordMealCommand, RecordWeightCommand, restoreCommand } from './commands';
import type { ApiClient } from './types';

describe('Command delle registrazioni', () => {
  it('RecordMealCommand delega endpoint, metodo e payload al receiver', async () => {
    const request = vi.fn().mockResolvedValue({ id: 'entry' });
    const receiver: ApiClient = { request };
    const payload = { operationId: 'stable-meal', consumptionTime: '2026-11-04T12:00:00Z', actualConsumption: 'Pane' };
    expect(await new RecordMealCommand(receiver, payload).execute()).toEqual({ id: 'entry' });
    expect(request).toHaveBeenCalledWith('/diary', 'POST', payload);
  });
  it('ripristina il Command peso dal DTO persistito senza rigenerare operationId', async () => {
    const request = vi.fn().mockResolvedValue({ id: 'weight' });
    const dto = { kind: 'progress' as const, payload: { operationId: 'restored-id', value: 75, unit: 'KG', type: 'WEIGHT' } };
    const command = restoreCommand(structuredClone(dto), { request });
    expect(command).toBeInstanceOf(RecordWeightCommand);
    await command.execute(); await command.execute();
    expect(request).toHaveBeenNthCalledWith(1, '/progress', 'POST', dto.payload);
    expect(request).toHaveBeenNthCalledWith(2, '/progress', 'POST', dto.payload);
  });
  it('incapsula il payload rispetto a mutazioni del chiamante e del receiver', async () => {
    const original = { operationId: 'stable', extra: { value: 75 } };
    const sent: unknown[] = [];
    const receiver: ApiClient = { request: vi.fn(async (_path, _method, body) => {
      sent.push(structuredClone(body));
      (body as typeof original).operationId = 'receiver-mutated';
      return undefined as never;
    }) };
    const command = new RecordWeightCommand(receiver, original);
    original.operationId = 'caller-mutated'; original.extra.value = 1;
    await command.execute(); await command.execute();
    expect(sent).toEqual([
      { operationId: 'stable', extra: { value: 75 } },
      { operationId: 'stable', extra: { value: 75 } },
    ]);
  });
});
