/**
 * Client dell'Abstract Factory: richiede i repository dei cinque moduli e la
 * UnitOfWork senza conoscere classi concrete, chiavi interne o tecnologia storage.
 * Rimane il composition root che collega servizi attraverso i contratti pubblici.
 */
import { StorageFactory } from '../infrastructure/storage-factory';
import type { InvitationNotifier, PasswordResetSender } from '../infrastructure/password-reset-mail';
import { silentLogger, type Logger } from '../shared/logger';
import { NotificationOutbox, type NotificationKind } from '../modules/notifications/public';
import { NotificationDispatcher, type MailStatus } from './notification-dispatcher';
import { UnitOfWork } from '../shared/unit-of-work';
import { AppError, Clock, Principal } from '../shared/contracts';
import { IdentityService } from '../modules/identity/public';
import { PatientService } from '../modules/patient-management/public';
import { MealPlanningService } from '../modules/meal-planning/public';
import { DiaryService } from '../modules/diary/public';
import { ProgressPhotoService, ProgressService } from '../modules/progress/public';

const invitationNoticeLifetimeMs = 24 * 60 * 60_000;

export class Application {
  readonly identity: IdentityService;
  readonly patients: PatientService;
  readonly plans: MealPlanningService;
  readonly diary: DiaryService;
  readonly progress: ProgressService;
  readonly progressPhotos: ProgressPhotoService;
  readonly persistence: UnitOfWork & { close(): Promise<void> };
  readonly notifications: NotificationOutbox;
  readonly dispatcher: NotificationDispatcher;
  private healthPing?: Promise<void>;
  constructor(private readonly storage: StorageFactory, private readonly clock: Clock = Date.now, readonly sendPasswordReset?: PasswordResetSender,
    readonly notifyInvitation?: InvitationNotifier, readonly logger: Logger = silentLogger) {
    const unitOfWork = storage.createUnitOfWork();
    // Conserva l'API application.persistence.run/close usata dall'adapter HTTP.
    this.persistence = { run: operation => unitOfWork.run(operation), close: () => storage.close() };
    this.identity = new IdentityService(storage.createIdentityRepository(), clock);
    this.patients = new PatientService(storage.createPatientRepository(), this.identity, clock);
    this.plans = new MealPlanningService(storage.createMealPlanRepository(), this.patients, clock);
    this.diary = new DiaryService(storage.createDiaryRepository(), this.patients, this.plans, clock);
    this.progress = new ProgressService(storage.createProgressRepository(), this.patients, clock);
    this.progressPhotos = new ProgressPhotoService(storage.createProgressPhotoRepository(), clock);
    this.notifications = new NotificationOutbox(storage.createNotificationRepository(), clock);
    // Le notifiche sono un componente secondario: escono dall'outbox, mai dentro la richiesta.
    const kinds: NotificationKind[] = [];
    if (sendPasswordReset) kinds.push('PASSWORD_RESET');
    if (notifyInvitation) kinds.push('INVITATION');
    this.dispatcher = new NotificationDispatcher(unitOfWork, this.notifications, kinds, async ({ payload }) => {
      if (payload.kind === 'PASSWORD_RESET') {
        return this.identity.isPasswordResetCurrent(payload.recipientId, payload.email, payload.token);
      }
      if (!await this.patients.isPendingInvitation(payload.invitationId, payload.recipientId, payload.senderId)) return false;
      const recipient = await this.identity.findUserByEmail(payload.email);
      const sender = await this.identity.findUserByEmail(payload.nutritionistEmail);
      return recipient?.id === payload.recipientId && sender?.id === payload.senderId;
    }, async ({ expiresAt, payload }) => {
      if (payload.kind === 'PASSWORD_RESET' && sendPasswordReset) {
        await sendPasswordReset({ email: payload.email, token: payload.token });
      }
      if (payload.kind === 'INVITATION' && notifyInvitation) {
        const queuedHour = new Date(expiresAt - invitationNoticeLifetimeMs).toISOString().slice(0, 13);
        await notifyInvitation({ email: payload.email, nutritionistName: payload.nutritionistName, nutritionistEmail: payload.nutritionistEmail }, queuedHour);
      }
    }, logger, clock);
  }

  /**
   * Recupero password: token e notifica nella stessa transazione. La risposta non
   * dipende dall'esistenza dell'account né dall'esito o dalla latenza dell'invio.
   */
  async requestPasswordReset(email: unknown): Promise<{ ok: true }> {
    const delivery = await this.identity.issuePasswordReset(email);
    if (delivery && this.dispatcher.configured('PASSWORD_RESET')) {
      // Scade insieme al link: un'email arrivata dopo 30 minuti non servirebbe.
      await this.notifications.enqueue({
        kind: 'PASSWORD_RESET', recipientId: delivery.accountId, email: delivery.email, token: delivery.token,
      }, 30 * 60_000);
    }
    return { ok: true };
  }

  /**
   * Readiness: il database è essenziale (down → 503), le notifiche sono secondarie
   * (giù → «degraded», ma il servizio resta disponibile). Il ping non usa il lock.
   */
  async health(): Promise<{ status: 'ok' | 'degraded' | 'down'; checks: { database: { status: 'ok' | 'down'; latencyMs: number }; mail: { status: MailStatus } } }> {
    const started = Date.now();
    let database: 'ok' | 'down' = 'ok';
    try {
      let timer: NodeJS.Timeout | undefined;
      // Le richieste concorrenti condividono il ping, anche se una risposta è già scaduta.
      this.healthPing ??= this.storage.ping().finally(() => { this.healthPing = undefined; });
      await Promise.race([this.healthPing, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 1000); })])
        .finally(() => clearTimeout(timer));
    } catch { database = 'down'; }
    const mail = this.dispatcher.status();
    const status = database === 'down' ? 'down' : mail === 'degraded' ? 'degraded' : 'ok';
    return { status, checks: { database: { status: database, latencyMs: Date.now() - started }, mail: { status: mail } } };
  }

  /**
   * Casi d'uso che attraversano due moduli: PatientManagement non dipende da
   * MealPlanning, quindi la composizione avviene qui, nella stessa UnitOfWork.
   * Alla fine di una relazione il piano prescritto smette di essere attivo.
   */
  async endAssociation(actor: Principal, patientId: string) {
    const result = await this.patients.end(actor, patientId);
    await this.plans.closeOpenPlan(patientId);
    return result;
  }

  /** Un piano rimasto aperto da una relazione precedente non diventa il piano del nuovo Nutritionist. */
  async acceptInvitation(actor: Principal, invitationId: string) {
    const assignment = await this.patients.accept(actor, invitationId);
    await this.plans.closeOpenPlan(assignment.patientId);
    return assignment;
  }

  /**
   * Risposta identica qualunque sia l'esito: un account Nutritionist non può
   * scoprire quali email appartengono a Patient registrati o già associati.
   */
  async inviteQuietly(actor: Principal, email: unknown): Promise<{ ok: true; message: string }> {
    try {
      const invite = await this.patients.invite(actor, typeof email === 'string' ? email : '');
      if (this.dispatcher.configured('INVITATION')) {
        const patient = await this.identity.getUser(invite.patientId);
        await this.notifications.enqueue({
          kind: 'INVITATION', recipientId: patient.id, senderId: actor.id, invitationId: invite.id,
          email: patient.email, nutritionistName: actor.name, nutritionistEmail: actor.email,
        }, invitationNoticeLifetimeMs);
      }
    } catch (error) {
      if (!(error instanceof AppError) || !['PatientNotFound', 'AssociationConflict'].includes(error.code)) throw error;
    }
    return { ok: true, message: 'Se l’indirizzo appartiene a un paziente disponibile, riceverà l’invito nell’app.' };
  }

  /** Copia leggibile di tutti i dati personali dell'account (diritto di accesso e portabilità). */
  async exportAccount(actor: Principal) {
    const account = await this.identity.exportAccount(actor);
    const relations = await this.patients.exportRelations(actor);
    const exportedAt = new Date(this.clock()).toISOString();
    if (actor.role === 'NUTRITIONIST') {
      return { exportedAt, account, ...relations, authoredPlanVersions: await this.plans.exportAuthored(actor.id) };
    }
    const diary = await this.diary.exportPatient(actor);
    return {
      exportedAt, account, ...relations,
      planVersions: await this.plans.exportPatient(actor.id),
      diarySharing: diary.sharing, diaryEntries: diary.entries,
      measurements: await this.progress.exportPatient(actor.id),
      progressPhotos: await this.progressPhotos.list(actor),
    };
  }

  /**
   * Eliminazione definitiva, confermata dalla password. Patient: piani, diario,
   * misure, foto, inviti e associazioni. Nutritionist: le relazioni si chiudono e i
   * piani attivi dei suoi pazienti smettono di essere attivi; lo storico resta ai Patient.
   */
  async deleteAccount(actor: Principal, password: unknown) {
    await this.identity.verifyPassword(actor, password);
    const ended = await this.patients.eraseAccount(actor);
    if (actor.role === 'PATIENT') {
      await this.plans.erasePatient(actor.id);
      await this.diary.erasePatient(actor.id);
      await this.progress.erasePatient(actor.id);
      await this.progressPhotos.erasePatient(actor.id);
    } else {
      for (const patientId of ended) await this.plans.closeOpenPlan(patientId);
    }
    await this.notifications.deleteForAccount(actor.id);
    await this.identity.deleteAccount(actor);
    return { deleted: true };
  }
}
