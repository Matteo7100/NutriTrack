import { Prisma } from '@prisma/client';
import type { MealPlanRepository, MealPlanVersion, MealPlanningState } from '../modules/meal-planning/public';
import { AppError, type Repository } from '../shared/contracts';

type Period = Pick<MealPlanVersion, 'id' | 'patientId' | 'validFrom' | 'validUntil'>;

function staleVersion() {
  return new AppError('MealPlanVersionConflict', 409, 'La versione di partenza è superata: ricaricare il piano.');
}

export class MemoryMealPlanRepository implements MealPlanRepository {
  constructor(private readonly repository: Repository<MealPlanningState>) {}

  async listPeriods(patientId: string): Promise<Period[]> {
    const { versions } = await this.repository.get();
    return versions.filter(version => version.patientId === patientId)
      .map(({ id, validFrom, validUntil }) => ({ id, patientId, validFrom, validUntil }));
  }

  async findVersion(id: string) {
    const { versions } = await this.repository.get();
    return versions.find(version => version.id === id) ?? null;
  }

  async listVersions(patientId: string) {
    const { versions } = await this.repository.get();
    return versions.filter(version => version.patientId === patientId).sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async savePublication(closedVersion: Period | null, version: MealPlanVersion) {
    const state = await this.repository.get();
    if (closedVersion) {
      const previous = state.versions.find(candidate => candidate.id === closedVersion.id && candidate.validUntil === null);
      if (!previous) throw staleVersion();
      previous.validUntil = closedVersion.validUntil;
    }
    state.versions.push(version);
    await this.repository.save(state);
  }
}

const versionContent = {
  plan: { select: { patientId: true } },
  meals: {
    orderBy: { position: 'asc' },
    include: {
      alternatives: { orderBy: { position: 'asc' }, include: { foods: { orderBy: { position: 'asc' } } } },
    },
  },
  changes: { orderBy: { position: 'asc' } },
} as const satisfies Prisma.MealPlanVersionInclude;

function readVersion(row: Prisma.MealPlanVersionGetPayload<{ include: typeof versionContent }>): MealPlanVersion {
  return {
    id: row.id, mealPlanId: row.mealPlanId, patientId: row.plan.patientId,
    versionNumber: row.versionNumber, parentVersionId: row.parentVersionId,
    createdAt: row.createdAt.getTime(), createdBy: row.createdBy,
    validFrom: row.validFrom.getTime(), validUntil: row.validUntil?.getTime() ?? null,
    content: {
      meals: row.meals.map(meal => ({
        name: meal.name,
        options: meal.alternatives.map(alternative => ({
          foods: alternative.foods.map(({ food, quantity, unit }) => ({ food, quantity, unit })),
        })),
      })),
    },
    changeSet: row.changes.map(({ path, before, after }) => ({ path, before, after })),
  };
}

function changeValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

export class PostgresMealPlanRepository implements MealPlanRepository {
  constructor(private readonly transaction: () => Pick<Prisma.TransactionClient, 'mealPlanVersion'>) {}

  async listPeriods(patientId: string): Promise<Period[]> {
    const periods = await this.transaction().mealPlanVersion.findMany({
      where: { plan: { patientId } },
      select: { id: true, validFrom: true, validUntil: true },
    });
    return periods.map(({ id, validFrom, validUntil }) => ({
      id, patientId, validFrom: validFrom.getTime(), validUntil: validUntil?.getTime() ?? null,
    }));
  }

  async findVersion(id: string) {
    const row = await this.transaction().mealPlanVersion.findUnique({ where: { id }, include: versionContent });
    return row ? readVersion(row) : null;
  }

  async listVersions(patientId: string) {
    const rows = await this.transaction().mealPlanVersion.findMany({
      where: { plan: { patientId } }, orderBy: { versionNumber: 'asc' }, include: versionContent,
    });
    return rows.map(readVersion);
  }

  async savePublication(closedVersion: Period | null, version: MealPlanVersion) {
    const { mealPlanVersion } = this.transaction();
    if (closedVersion) {
      const { count } = await mealPlanVersion.updateMany({
        where: { id: closedVersion.id, validUntil: null },
        data: { validUntil: new Date(version.validFrom) },
      });
      if (count !== 1) throw staleVersion();
    }
    await mealPlanVersion.create({ data: {
      id: version.id, versionNumber: version.versionNumber, createdBy: version.createdBy,
      createdAt: new Date(version.createdAt), validFrom: new Date(version.validFrom),
      plan: { connectOrCreate: { where: { id: version.mealPlanId }, create: { id: version.mealPlanId, patientId: version.patientId } } },
      parent: version.parentVersionId ? { connect: { id: version.parentVersionId } } : undefined,
      meals: { create: version.content.meals.map((meal, position) => ({
        name: meal.name, position,
        alternatives: { create: meal.options.map((option, optionPosition) => ({
          position: optionPosition,
          foods: { create: option.foods.map((food, foodPosition) => ({ ...food, position: foodPosition })) },
        })) },
      })) },
      changes: { create: version.changeSet.map((change, position) => ({
        position, path: change.path, before: changeValue(change.before), after: changeValue(change.after),
      })) },
    } });
  }
}
