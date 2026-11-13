import type { Prisma, ProgressMeasurement as MeasurementRow } from '@prisma/client';
import { measurementDto } from '../modules/progress/public';
import type { Measurement, ProgressRepository, ProgressState, StoredMeasurement } from '../modules/progress/public';
import type { Repository } from '../shared/contracts';

export class MemoryProgressRepository implements ProgressRepository {
  constructor(private readonly repository: Repository<ProgressState>) {}

  async findByOperation(patientId: string, operationId: string) {
    const { measurements } = await this.repository.get();
    return measurements.find(item => item.patientId === patientId && item.operationId === operationId) ?? null;
  }
  async findById(patientId: string, id: string) {
    return (await this.repository.get()).measurements.find(item => item.patientId === patientId && item.id === id) ?? null;
  }
  async findDeleted(patientId: string, operationId: string) {
    return (await this.repository.get()).deleted.find(item => item.patientId === patientId && item.operationId === operationId) ?? null;
  }

  async insert(measurement: Measurement): Promise<void> {
    const state = await this.repository.get();
    state.measurements.push(measurement);
    await this.repository.save(state);
  }

  async listByPatient(patientId: string, from?: number, to?: number, createdFrom?: number): Promise<Measurement[]> {
    const { measurements } = await this.repository.get();
    return measurements.filter(item => item.patientId === patientId &&
      (from === undefined || item.timestamp >= from) && (to === undefined || item.timestamp < to) &&
      (createdFrom === undefined || item.createdAt >= createdFrom))
      .sort((a, b) => b.timestamp - a.timestamp).map(measurementDto);
  }
  async update(measurement: StoredMeasurement) {
    const state = await this.repository.get();
    state.measurements = state.measurements.map(item => item.id === measurement.id ? measurement : item);
    await this.repository.save(state);
  }
  async remove(measurement: ProgressState['deleted'][number]) {
    const state = await this.repository.get();
    state.measurements = state.measurements.filter(item => item.id !== measurement.id);
    state.deleted.push(measurement);
    await this.repository.save(state);
  }
  async erasePatient(patientId: string) {
    const state = await this.repository.get();
    state.measurements = state.measurements.filter(item => item.patientId !== patientId);
    state.deleted = state.deleted.filter(item => item.patientId !== patientId);
    await this.repository.save(state);
  }
}

function readMeasurement({ sequence, timestamp, createdAt, updatedAt, originalDigest, ...measurement }: MeasurementRow): StoredMeasurement {
  // PostgreSQL vincola le coppie di tipo e unità alle combinazioni ammesse dal dominio.
  return { ...measurement, timestamp: timestamp.getTime(), createdAt: createdAt.getTime(),
    ...(updatedAt && { updatedAt: updatedAt.getTime() }), ...(originalDigest && { originalDigest }) } as StoredMeasurement;
}

export class PostgresProgressRepository implements ProgressRepository {
  constructor(private readonly transaction: () => Pick<Prisma.TransactionClient, 'progressMeasurement' | 'deletedProgressMeasurement'>) {}

  async findByOperation(patientId: string, operationId: string) {
    const row = await this.transaction().progressMeasurement.findUnique({ where: { patientId_operationId: { patientId, operationId } } });
    return row ? readMeasurement(row) : null;
  }
  async findById(patientId: string, id: string) {
    const row = await this.transaction().progressMeasurement.findUnique({ where: { patientId, id } });
    return row ? readMeasurement(row) : null;
  }
  async findDeleted(patientId: string, operationId: string) {
    const row = await this.transaction().deletedProgressMeasurement.findUnique({ where: { patientId_operationId: { patientId, operationId } } });
    return row ? { id: row.recordId, patientId, operationId, digest: row.digest, deletedAt: row.deletedAt.getTime() } : null;
  }

  async insert({ id, patientId, operationId, type, unit, value, timestamp, createdAt }: Measurement): Promise<void> {
    await this.transaction().progressMeasurement.create({ data: {
      id, patientId, operationId, type, unit, value, timestamp: new Date(timestamp), createdAt: new Date(createdAt),
    } });
  }

  async listByPatient(patientId: string, from?: number, to?: number, createdFrom?: number): Promise<Measurement[]> {
    const rows = await this.transaction().progressMeasurement.findMany({
      where: { patientId, timestamp: {
        gte: from === undefined ? undefined : new Date(Math.ceil(from)),
        lt: to === undefined ? undefined : new Date(Math.ceil(to)),
      }, createdAt: createdFrom === undefined ? undefined : { gte: new Date(createdFrom) } },
      orderBy: [{ timestamp: 'desc' }, { sequence: 'asc' }],
    });
    return rows.map(row => measurementDto(readMeasurement(row)));
  }
  async update(measurement: StoredMeasurement) {
    await this.transaction().progressMeasurement.update({ where: { id: measurement.id, patientId: measurement.patientId }, data: {
      value: measurement.value, timestamp: new Date(measurement.timestamp), originalDigest: measurement.originalDigest,
      updatedAt: measurement.updatedAt === undefined ? undefined : new Date(measurement.updatedAt),
    } });
  }
  async remove({ id, deletedAt, ...measurement }: ProgressState['deleted'][number]) {
    const tx = this.transaction();
    await tx.progressMeasurement.delete({ where: { id, patientId: measurement.patientId } });
    await tx.deletedProgressMeasurement.create({ data: { ...measurement, recordId: id, deletedAt: new Date(deletedAt) } });
  }
  async erasePatient(patientId: string) {
    const tx = this.transaction();
    await tx.progressMeasurement.deleteMany({ where: { patientId } });
    await tx.deletedProgressMeasurement.deleteMany({ where: { patientId } });
  }
}
