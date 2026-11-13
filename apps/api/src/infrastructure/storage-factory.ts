/**
 * Abstract Factory GoF: crea una famiglia coerente di repository dei cinque
 * moduli e della UnitOfWork che delimita le loro transazioni.
 * Il client Application conosce questi prodotti astratti, non Prisma o Map.
 */
import { UnitOfWork } from '../shared/unit-of-work';
import type { IdentityRepository } from '../modules/identity/public';
import type { PatientRepository } from '../modules/patient-management/public';
import type { MealPlanRepository } from '../modules/meal-planning/public';
import type { DiaryRepository } from '../modules/diary/public';
import type { ProgressPhotoRepository, ProgressRepository } from '../modules/progress/public';

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
