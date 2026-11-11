/**
 * Command GoF: richiesta differita più receiver HTTP. L'invoker usa soltanto execute.
 * Si persistono DTO, non oggetti eseguibili: la ricostruzione conserva operationId.
 * Non c'è undo: il pattern non annulla una registrazione confermata.
 */
import type { ApiClient, Queued } from './types';
export interface SyncCommand { execute(): Promise<unknown> }
export class RecordMealCommand implements SyncCommand {
  private readonly payload: Record<string, unknown>;
  constructor(private readonly receiver: ApiClient, payload: Record<string, unknown>) {
    // Copia profonda: chi prepara la richiesta non può cambiarla dopo la costruzione.
    this.payload = structuredClone(payload);
  }
  execute(): Promise<unknown> { return this.receiver.request('/diary', 'POST', structuredClone(this.payload)); }
}
export class RecordWeightCommand implements SyncCommand {
  private readonly payload: Record<string, unknown>;
  constructor(private readonly receiver: ApiClient, payload: Record<string, unknown>) { this.payload = structuredClone(payload); }
  // Anche il receiver riceve una copia: un suo eventuale effetto non cambia il retry.
  execute(): Promise<unknown> { return this.receiver.request('/progress', 'POST', structuredClone(this.payload)); }
}
// Il discriminante del DTO sceglie la classe. Non si genera un nuovo ID al retry.
export function restoreCommand(record: Pick<Queued, 'kind' | 'payload'>, receiver: ApiClient): SyncCommand {
  switch (record.kind) {
    case 'diary': return new RecordMealCommand(receiver, record.payload);
    case 'progress': return new RecordWeightCommand(receiver, record.payload);
    default: throw new Error('Tipo di operazione locale non supportato.');
  }
}
