/**
 * Observer concreti senza dipendenza React: pannello coda e refresh dati Patient.
 * dispose/isCurrent impediscono aggiornamenti dopo smontaggio o cambio account.
 */
import type { Queued, QueueStore, SyncEvent, SyncObserver } from './types';
export class QueuePanelModel implements SyncObserver {
  private disposed = false;
  private request = 0;
  constructor(
    private readonly accountId: string,
    private readonly store: Pick<QueueStore, 'read'>,
    private readonly render: (items: Queued[]) => void,
    private readonly isCurrent: () => boolean = () => true,
  ) {}
  async refresh(): Promise<void> {
    if (this.disposed || !this.isCurrent()) return;
    const request = ++this.request;
    const items = await this.store.read(this.accountId);
    // Una lettura vecchia non può sovrascrivere una più recente.
    if (!this.disposed && this.isCurrent() && request === this.request) this.render(items);
  }
  async onSyncEvent(event: SyncEvent): Promise<void> { if (event.accountId === this.accountId) await this.refresh(); }
  dispose(): void { this.disposed = true; this.request++; }
}
export class PatientDataRefresher implements SyncObserver {
  private disposed = false;
  constructor(
    private readonly accountId: string,
    private readonly refreshData: (accountId: string) => Promise<void>,
    private readonly isCurrent: () => boolean = () => true,
  ) {}
  async onSyncEvent(event: SyncEvent): Promise<void> {
    if (event.type !== 'confirmed' || event.accountId !== this.accountId || this.disposed || !this.isCurrent()) return;
    await this.refreshData(this.accountId);
  }
  dispose(): void { this.disposed = true; }
}
