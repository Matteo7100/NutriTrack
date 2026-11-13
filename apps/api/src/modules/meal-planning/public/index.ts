/**
 * Contratto pubblico MealPlanning: autorizza pubblicazione/letture e conserva
 * versioni complete. La ricerca temporale riusa il resolver puro del primo step.
 * Un nuovo contenuto non sovrascrive il precedente: copia, chiusura e append
 * vengono salvati insieme dalla transazione che avvolge il caso d'uso.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal } from '../../../shared/contracts';
import { PatientService } from '../../patient-management/public';
import type { MealPlanVersionPeriod } from '../domain/meal-plan-version-period';
import { resolveVersionAt } from '../domain/resolve-version-at';
import { publishNewVersion } from '../domain/publish-new-version';

export interface FoodItem { food: string; quantity: number; unit: string }
export interface PlanContent { meals: { name: string; options: { foods: FoodItem[] }[] }[] }
export interface Change { path: string; before: unknown; after: unknown }
export interface MealPlanVersion {
  id: string; mealPlanId: string; patientId: string; versionNumber: number; parentVersionId: string | null;
  createdAt: number; createdBy: string; validFrom: number; validUntil: number | null;
  content: PlanContent; changeSet: Change[];
}
export interface MealPlanningState { versions: MealPlanVersion[] }
export const createEmptyMealPlanningState = (): MealPlanningState => ({ versions: [] });

export interface StoredPlanPeriod extends MealPlanVersionPeriod {
  readonly mealPlanId: string;
  readonly versionNumber: number;
  readonly createdAt: number;
  readonly createdBy: string;
}

export interface MealPlanRepository {
  listPeriods(patientId: string): Promise<StoredPlanPeriod[]>;
  findVersion(id: string): Promise<MealPlanVersion | null>;
  listVersions(patientId: string, visible?: { from: number; author: string }): Promise<MealPlanVersion[]>;
  listAuthoredVersions(nutritionistId: string): Promise<MealPlanVersion[]>;
  savePublication(closedVersion: MealPlanVersionPeriod | null, version: MealPlanVersion): Promise<void>;
  closeVersion(versionId: string, validUntil: number): Promise<void>;
  erasePatient(patientId: string): Promise<void>;
}

function invalid(): never { throw new AppError('InvalidMealPlan', 400, 'Inserire almeno un pasto, un’opzione e un alimento con quantità positiva e unità.'); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
export function validatePlanContent(input: unknown): PlanContent {
  if (!input || typeof input !== 'object') return invalid();
  const meals = (input as PlanContent).meals;
  if (!Array.isArray(meals) || meals.length < 1 || meals.length > 14) return invalid();
  for (const meal of meals) {
    if (!meal || !text(meal.name, 100) || !Array.isArray(meal.options) || !meal.options.length || meal.options.length > 10) return invalid();
    for (const option of meal.options) {
      if (!option || !Array.isArray(option.foods) || !option.foods.length || option.foods.length > 30) return invalid();
      for (const item of option.foods) if (!item || !text(item.food, 200) || !text(item.unit, 30) || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) return invalid();
    }
  }
  // Ricostruisce solo i campi ammessi: niente contenuti client arbitrari persistiti.
  return { meals: meals.map(m => ({ name: m.name.trim(), options: m.options.map(o => ({ foods: o.foods.map(f => ({ food: f.food.trim(), quantity: f.quantity, unit: f.unit.trim() })) })) })) };
}

// Diff strutturale: il path permette di mostrare al Patient cosa è cambiato.
function changes(before: unknown, after: unknown, path = 'content'): Change[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object') {
    const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    return keys.flatMap(k => changes(left[k] ?? null, right[k] ?? null, `${path}.${k}`));
  }
  return [{ path, before: before ?? null, after: after ?? null }];
}

export class MealPlanningService {
  constructor(private readonly repo: MealPlanRepository, private readonly patients: PatientService, private readonly clock: Clock) {}

  async publish(actor: Principal, patientId: string, baseVersionId: string | null, input: unknown): Promise<MealPlanVersion> {
    if (actor.role !== 'NUTRITIONIST') throw new AppError('AuthorizationError', 403, 'Solo il nutrizionista può pubblicare piani.');
    const windowStart = await this.patients.visibleFrom(actor, patientId);
    const content = validatePlanContent(input);
    if (baseVersionId !== null && typeof baseVersionId !== 'string') throw new AppError('InvalidMealPlan', 400, 'Base della versione non valida.');
    const periods = await this.repo.listPeriods(patientId);
    const open = periods.find(version => version.validUntil === null);
    const current = open && this.visible(open, actor, windowStart) ? open : null;
    if ((current?.id ?? null) !== baseVersionId) throw new AppError('MealPlanVersionConflict', 409, 'La versione di partenza è superata: ricaricare il piano.');
    const activation = this.clock();
    if (periods.some(version => activation <= version.validFrom || (version.validUntil !== null && activation < version.validUntil))) {
      throw new AppError('PublicationBusy', 409, 'Attendere un istante e riprovare: attivazione troppo ravvicinata.');
    }
    const transition = publishNewVersion(periods, {
      patientId, baseVersionId: open?.id ?? null, newVersionId: randomUUID(), activationTime: activation,
    });
    const previous = current ? await this.repo.findVersion(current.id) : null;
    const lastNumber = periods.reduce((latest, version) => Math.max(latest, version.versionNumber), 0);
    const version: MealPlanVersion = {
      ...transition.newVersion, mealPlanId: periods[0]?.mealPlanId ?? randomUUID(),
      versionNumber: lastNumber + 1, parentVersionId: previous?.id ?? null,
      createdAt: activation, createdBy: actor.id, validFrom: activation, validUntil: null,
      content, changeSet: changes(previous?.content ?? null, content),
    };
    await this.repo.savePublication(transition.closedVersion, version);
    return structuredClone(version);
  }

  async getVersionAt(patientId: string, time: number): Promise<MealPlanVersion | null> {
    const period = resolveVersionAt(await this.repo.listPeriods(patientId), patientId, time);
    return period ? this.repo.findVersion(period.id) : null;
  }

  async active(actor: Principal, patientId: string): Promise<MealPlanVersion | null> {
    const windowStart = await this.patients.visibleFrom(actor, patientId);
    const version = await this.getVersionAt(patientId, this.clock());
    return version && version.validUntil === null && this.visible(version, actor, windowStart) ? version : null;
  }

  async history(actor: Principal, patientId: string): Promise<MealPlanVersion[]> {
    const windowStart = await this.patients.visibleFrom(actor, patientId);
    return this.repo.listVersions(patientId, windowStart === null ? undefined : { from: windowStart, author: actor.id });
  }

  async closeOpenPlan(patientId: string): Promise<void> {
    const open = (await this.repo.listPeriods(patientId)).find(version => version.validUntil === null);
    if (open) await this.repo.closeVersion(open.id, Math.max(this.clock(), open.validFrom + 1));
  }

  async exportPatient(patientId: string): Promise<MealPlanVersion[]> {
    return this.repo.listVersions(patientId);
  }

  async exportAuthored(nutritionistId: string): Promise<MealPlanVersion[]> {
    return this.repo.listAuthoredVersions(nutritionistId);
  }

  async erasePatient(patientId: string): Promise<void> {
    await this.repo.erasePatient(patientId);
  }

  private visible(version: Pick<StoredPlanPeriod, 'createdAt' | 'createdBy'>, actor: Principal, windowStart: number | null): boolean {
    return windowStart === null || (version.createdAt >= windowStart && version.createdBy === actor.id);
  }
}
