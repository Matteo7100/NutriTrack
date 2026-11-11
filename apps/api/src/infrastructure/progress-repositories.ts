import type { Prisma, ProgressMeasurement as MeasurementRow } from '@prisma/client';
import type { Measurement, ProgressRepository, ProgressState } from '../modules/progress/public';
import type { Repository } from '../shared/contracts';

export class MemoryProgressRepository implements ProgressRepository {
  constructor(private readonly repository: Repository<ProgressState>) {}

  async findByOperation(patientId: string, operationId: string): Promise<Measurement | null> {
    const { measurements } = await this.repository.get();
    return measurements.find(item => item.patientId === patientId && item.operationId === operationId) ?? null;
  }

  async insert(measurement: Measurement): Promise<void> {
    const state = await this.repository.get();
    state.measurements.push(measurement);
    await this.repository.save(state);
  }

  async listByPatient(patientId: string, from?: number, to?: number): Promise<Measurement[]> {
    const { measurements } = await this.repository.get();
    return measurements.filter(item => item.patientId === patientId &&
      (from === undefined || item.timestamp >= from) && (to === undefined || item.timestamp < to))
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

function readMeasurement({ sequence, timestamp, createdAt, ...measurement }: MeasurementRow): Measurement {
  // PostgreSQL vincola le coppie di tipo e unità alle combinazioni ammesse dal dominio.
  return { ...measurement, timestamp: timestamp.getTime(), createdAt: createdAt.getTime() } as Measurement;
}

export class PostgresProgressRepository implements ProgressRepository {
  constructor(private readonly transaction: () => Pick<Prisma.TransactionClient, 'progressMeasurement'>) {}

  async findByOperation(patientId: string, operationId: string): Promise<Measurement | null> {
    const row = await this.transaction().progressMeasurement.findUnique({ where: { patientId_operationId: { patientId, operationId } } });
    return row ? readMeasurement(row) : null;
  }

  async insert({ id, patientId, operationId, type, unit, value, timestamp, createdAt }: Measurement): Promise<void> {
    await this.transaction().progressMeasurement.create({ data: {
      id, patientId, operationId, type, unit, value, timestamp: new Date(timestamp), createdAt: new Date(createdAt),
    } });
  }

  async listByPatient(patientId: string, from?: number, to?: number): Promise<Measurement[]> {
    const rows = await this.transaction().progressMeasurement.findMany({
      where: { patientId, timestamp: {
        gte: from === undefined ? undefined : new Date(Math.ceil(from)),
        lt: to === undefined ? undefined : new Date(Math.ceil(to)),
      } },
      orderBy: [{ timestamp: 'desc' }, { sequence: 'asc' }],
    });
    return rows.map(readMeasurement);
  }
}
