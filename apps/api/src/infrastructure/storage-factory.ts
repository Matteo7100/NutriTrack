/**
 * Abstract Factory GoF: crea una famiglia coerente di repository dei cinque
 * moduli e della UnitOfWork che delimita le loro transazioni.
 * Il client Application conosce questi prodotti astratti, non Prisma o Map.
 */
import { Repository } from '../shared/contracts';
import { UnitOfWork } from '../shared/unit-of-work';
import { IdentityState } from '../modules/identity/public';
import { PatientState } from '../modules/patient-management/public';
import { MealPlanningState } from '../modules/meal-planning/public';
import { DiaryState } from '../modules/diary/public';
import { ProgressPhotoRepository, ProgressState } from '../modules/progress/public';

// Prodotti diversi per responsabilità e tipo di stato; stessa piccola API get/save.
export type IdentityRepository = Repository<IdentityState>;
export type PatientRepository = Repository<PatientState>;
export type MealPlanRepository = Repository<MealPlanningState>;
export type DiaryRepository = Repository<DiaryState>;
export type ProgressRepository = Repository<ProgressState>;

export interface StorageFactory {
  createIdentityRepository(): IdentityRepository;
  createPatientRepository(): PatientRepository;
  createMealPlanRepository(): MealPlanRepository;
  createDiaryRepository(): DiaryRepository;
  createProgressRepository(): ProgressRepository;
  createProgressPhotoRepository(): ProgressPhotoRepository;
  createUnitOfWork(): UnitOfWork;
  close(): Promise<void>;
}
