/**
 * Client dell'Abstract Factory: richiede i repository dei cinque moduli e la
 * UnitOfWork senza conoscere classi concrete, chiavi interne o tecnologia storage.
 * Rimane il composition root che collega servizi attraverso i contratti pubblici.
 */
import { StorageFactory } from '../infrastructure/storage-factory';
import type { PasswordResetSender } from '../infrastructure/password-reset-mail';
import { UnitOfWork } from '../shared/unit-of-work';
import { Clock } from '../shared/contracts';
import { IdentityService } from '../modules/identity/public';
import { PatientService } from '../modules/patient-management/public';
import { MealPlanningService } from '../modules/meal-planning/public';
import { DiaryService } from '../modules/diary/public';
import { ProgressPhotoService, ProgressService } from '../modules/progress/public';

export class Application {
  readonly identity: IdentityService;
  readonly patients: PatientService;
  readonly plans: MealPlanningService;
  readonly diary: DiaryService;
  readonly progress: ProgressService;
  readonly progressPhotos: ProgressPhotoService;
  readonly persistence: UnitOfWork & { close(): Promise<void> };
  constructor(storage: StorageFactory, clock: Clock = Date.now, readonly sendPasswordReset?: PasswordResetSender) {
    const unitOfWork = storage.createUnitOfWork();
    // Conserva l'API application.persistence.run/close usata dall'adapter HTTP.
    this.persistence = { run: operation => unitOfWork.run(operation), close: () => storage.close() };
    this.identity = new IdentityService(storage.createIdentityRepository(), clock);
    this.patients = new PatientService(storage.createPatientRepository(), this.identity, clock);
    this.plans = new MealPlanningService(storage.createMealPlanRepository(), this.patients, clock);
    this.diary = new DiaryService(storage.createDiaryRepository(), this.patients, this.plans, clock);
    this.progress = new ProgressService(storage.createProgressRepository(), this.patients, clock);
    this.progressPhotos = new ProgressPhotoService(storage.createProgressPhotoRepository(), clock);
  }
}
