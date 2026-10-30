/** Composition root: unico punto che collega adapter privati e contratti dei moduli. */
import { Persistence } from '../infrastructure/persistence';
import { Clock } from '../shared/contracts';
import { IdentityService, createEmptyIdentityState } from '../modules/identity/public';
import { PatientService, createEmptyPatientState } from '../modules/patient-management/public';
import { MealPlanningService, createEmptyMealPlanningState } from '../modules/meal-planning/public';
import { DiaryService, createEmptyDiaryState } from '../modules/diary/public';
import { ProgressService, createEmptyProgressState } from '../modules/progress/public';

export class Application {
  readonly identity: IdentityService;
  readonly patients: PatientService;
  readonly plans: MealPlanningService;
  readonly diary: DiaryService;
  readonly progress: ProgressService;
  constructor(readonly persistence: Persistence, clock: Clock = Date.now) {
    this.identity = new IdentityService(persistence.repository('identity', createEmptyIdentityState), clock);
    this.patients = new PatientService(persistence.repository('patients', createEmptyPatientState), this.identity, clock);
    this.plans = new MealPlanningService(persistence.repository('plans', createEmptyMealPlanningState), this.patients, clock);
    this.diary = new DiaryService(persistence.repository('diary', createEmptyDiaryState), this.patients, this.plans, clock);
    this.progress = new ProgressService(persistence.repository('progress', createEmptyProgressState), this.patients, clock);
  }
}
