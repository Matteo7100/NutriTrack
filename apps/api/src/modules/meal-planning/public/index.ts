/**
 * Contratto pubblico MealPlanning: autorizza pubblicazione/letture e conserva
 * versioni complete. La ricerca temporale riusa il resolver puro del primo step.
 * Un nuovo contenuto non sovrascrive il precedente: copia, chiusura e append
 * vengono salvati insieme dalla transazione che avvolge il caso d'uso.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal, Repository } from '../../../shared/contracts';
import { PatientService } from '../../patient-management/public';
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
  constructor(private readonly repo: Repository<MealPlanningState>, private readonly patients: PatientService, private readonly clock: Clock) {}

  async publish(actor: Principal, patientId: string, baseVersionId: string | null, input: unknown): Promise<MealPlanVersion> {
    if (actor.role !== 'NUTRITIONIST') throw new AppError('AuthorizationError', 403, 'Solo il Nutritionist può pubblicare piani.');
    await this.patients.assertAccess(actor, patientId);
    const content = validatePlanContent(input);
    if (baseVersionId !== null && typeof baseVersionId !== 'string') throw new AppError('InvalidMealPlan', 400, 'Base della versione non valida.');
    const state = await this.repo.get();
    const previous = state.versions.find(v => v.patientId === patientId && v.validUntil === null);
    if ((previous?.id ?? null) !== baseVersionId) throw new AppError('MealPlanVersionConflict', 409, 'La versione di partenza è superata: ricaricare il piano.');
    const activation = this.clock();
    // Non inventiamo un istante futuro per distinguere due pubblicazioni nello stesso ms.
    // Il retry successivo potrà pubblicare un intervallo di durata strettamente positiva.
    if (previous && activation <= previous.validFrom) throw new AppError('PublicationBusy', 409, 'Attendere un istante e riprovare: attivazione troppo ravvicinata.');
    // Riusa la regola pura studiata nella fase 2, ora dentro la transazione reale.
    const transition = publishNewVersion(state.versions, {
      patientId, baseVersionId, newVersionId: randomUUID(), activationTime: activation,
    });
    const version: MealPlanVersion = {
      ...transition.newVersion, mealPlanId: previous?.mealPlanId ?? randomUUID(),
      versionNumber: (previous?.versionNumber ?? 0) + 1, parentVersionId: previous?.id ?? null,
      createdAt: activation, createdBy: actor.id, validFrom: activation, validUntil: null,
      content, changeSet: changes(previous?.content ?? null, content),
    };
    if (previous) previous.validUntil = transition.closedVersion!.validUntil; // Solo metadato: contenuto invariato.
    state.versions.push(version);
    await this.repo.save(state);
    return structuredClone(version);
  }

  async getVersionAt(patientId: string, time: number): Promise<MealPlanVersion | null> {
    const versions = (await this.repo.get()).versions;
    const period = resolveVersionAt(versions, patientId, time);
    const version = versions.find(v => v.id === period?.id);
    return version ? structuredClone(version) : null;
  }

  async active(actor: Principal, patientId: string): Promise<MealPlanVersion | null> {
    await this.patients.assertAccess(actor, patientId);
    return this.getVersionAt(patientId, this.clock());
  }

  async history(actor: Principal, patientId: string): Promise<MealPlanVersion[]> {
    await this.patients.assertAccess(actor, patientId);
    return structuredClone((await this.repo.get()).versions.filter(v => v.patientId === patientId).sort((a, b) => a.versionNumber - b.versionNumber));
  }
}
