/**
 * Invoker dei Command e Subject degli Observer. Gli eventi seguono i commit locali.
 * Ogni await può consentire un cambio account: la generazione viene ricontrollata
 * prima delle azioni successive. La coda conserva l'ID per retry idempotenti.
 */
import { restoreCommand } from './commands';
import { RetryContext } from './retry';
import type { ApiClient, Queued, QueueStore, SyncEvent, SyncObserver } from './types';
export class SyncEngine {
  private readonly observers = new Set<SyncObserver>();
  private accountId: string | null = null;
  private generation = 0;
  private syncing = false;
  constructor(
    private readonly store: QueueStore,
    private readonly receiver: ApiClient,
    private readonly retries = new RetryContext(),
    private readonly clock: () => number = () => Date.now(),
    private readonly isOnline: () => boolean = () => navigator.onLine,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}
  setAccount(accountId: string | null): void {
    if (this.accountId !== accountId) { this.accountId = accountId; this.generation++; }
  }
  subscribe(observer: SyncObserver): () => void {
    this.observers.add(observer);
    return () => this.unsubscribe(observer);
  }
  unsubscribe(observer: SyncObserver): void { this.observers.delete(observer); }
  private active(accountId: string, generation: number): boolean { return this.accountId === accountId && this.generation === generation; }
  private async notify(event: SyncEvent): Promise<void> {
    // Gli errori degli Observer non entrano nel catch del Command già confermato.
    await Promise.allSettled([...this.observers].map(observer => Promise.resolve().then(() => {
      if (this.observers.has(observer)) return observer.onSyncEvent(event);
    })));
  }
  async enqueue(accountId: string, kind: Queued['kind'], payload: Record<string, unknown>): Promise<string> {
    const batch = this.generation;
    if (!this.active(accountId, batch)) throw new Error('Account locale non più attivo.');
    const id = this.newId();
    await this.store.save({ id, accountId, kind, payload: { ...structuredClone(payload), operationId: id }, status: 'PENDING', attempts: 0, nextAttempt: 0 });
    if (this.active(accountId, batch)) await this.notify({ type: 'queued', accountId, operationId: id, at: this.clock() });
    return id;
  }
  /** Rimette in coda un'operazione respinta (es. orologio del dispositivo avanti), con lo stesso ID. */
  async retryItem(accountId: string, operationId: string): Promise<void> {
    const item = (await this.store.read(accountId)).find(candidate => candidate.id === operationId);
    if (!item || item.status === 'PENDING') return;
    await this.store.save({ ...item, status: 'PENDING', attempts: 0, nextAttempt: 0, error: undefined });
    await this.notify({ type: 'retry-ready', accountId, operationId, at: this.clock() });
  }
  /** Elimina dal dispositivo un'operazione mai confermata, su scelta esplicita del Patient. */
  async discard(accountId: string, operationId: string): Promise<void> {
    const item = (await this.store.read(accountId)).find(candidate => candidate.id === operationId);
    if (!item) return;
    await this.store.remove(operationId);
    await this.notify({ type: 'discarded', accountId, operationId, at: this.clock() });
  }
  async retryAuthentication(accountId: string): Promise<void> {
    const batch = this.generation;
    if (!this.active(accountId, batch)) return;
    const items = await this.store.read(accountId);
    if (!this.active(accountId, batch)) return;
    for (const item of items) {
      if (item.status !== 'AUTH_REQUIRED') continue;
      await this.store.save({ ...item, status: 'PENDING', nextAttempt: 0 });
      if (!this.active(accountId, batch)) return;
      await this.notify({ type: 'retry-ready', accountId, operationId: item.id, at: this.clock() });
      if (!this.active(accountId, batch)) return;
    }
  }
  private async persistFailure(item: Queued, error: unknown, batch: number): Promise<boolean> {
    if (!this.active(item.accountId, batch)) return true;
    const outcome = this.retries.failure(item, error, this.clock());
    await this.store.save(outcome.item);
    if (!this.active(item.accountId, batch)) return true;
    await this.notify({ type: 'failed', accountId: item.accountId, operationId: item.id, at: this.clock(), status: outcome.item.status, error: outcome.item.error! });
    return outcome.stopBatch || !this.active(item.accountId, batch);
  }
  async flush(accountId: string): Promise<boolean> {
    if (this.syncing || !this.isOnline() || this.accountId !== accountId) return false;
    this.syncing = true;
    const batch = this.generation;
    let changed = false;
    try {
      let session: { user: { id: string }; csrfToken?: string };
      try { session = await this.receiver.request('/auth/me'); }
      catch (error) {
        if (!this.active(accountId, batch)) return false;
        const items = await this.store.read(accountId);
        if (!this.active(accountId, batch)) return false;
        // Su 401 iniziale si marchiano le pending senza inviare alcun Command.
        for (const item of items) {
          if (!this.active(accountId, batch)) break;
          if (item.status === 'PENDING') await this.persistFailure(item, error, batch);
        }
        return false;
      }
      if (!this.active(accountId, batch) || session.user.id !== accountId) return false;
      // Un login in un'altra scheda sostituisce la sessione: si usa il token corrente.
      this.receiver.session?.(session);
      const items = await this.store.read(accountId);
      if (!this.active(accountId, batch)) return false;
      for (const item of items) {
        if (!this.active(accountId, batch)) break;
        if (item.status !== 'PENDING' || item.nextAttempt > this.clock()) continue;
        try {
          const command = restoreCommand(item, this.receiver);
          await command.execute();
          // Se cambia account durante HTTP, conserviamo il DTO: il server deduplica.
          if (!this.active(accountId, batch)) break;
          await this.store.remove(item.id);
          if (!this.active(accountId, batch)) break;
          changed = true;
          await this.notify({ type: 'confirmed', accountId, operationId: item.id, at: this.clock() });
          if (!this.active(accountId, batch)) break;
        } catch (error) {
          if (!this.active(accountId, batch) || await this.persistFailure(item, error, batch)) break;
        }
      }
    } finally { this.syncing = false; }
    return changed; // Compatibilità: App reagisce agli eventi, non a questo risultato.
  }
}
