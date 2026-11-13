/**
 * Misurazioni storiche di peso e circonferenze: append-only e positive.
 * Il Patient registra i propri dati, il Nutritionist assegnato li legge anche
 * quando il diario è privato. Deduplicazione per operazione nella stessa transazione.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal } from '../../../shared/contracts';
import { PatientService } from '../../patient-management/public';
import { assertSameRecord, digestRecord, type DeletedRecord } from '../../../shared/record-retry';
import { minimumObservationTime, observationTime, validOperationId } from '../domain/observations';

export { ProgressPhotoService, photoMetadata } from '../domain/photos';
export type { ProgressPhoto, ProgressPhotoRepository, StoredProgressPhoto } from '../domain/photos';

type MeasurementKind = { type: 'WEIGHT'; unit: 'KG' } | { type: 'ARM_CIRCUMFERENCE' | 'TORSO_CIRCUMFERENCE'; unit: 'CM' };
export type Measurement = MeasurementKind & { id: string; patientId: string; value: number; timestamp: number; createdAt: number; operationId: string; updatedAt?: number };
export type StoredMeasurement = Measurement & { originalDigest?: string };
type DeletedMeasurement = DeletedRecord & { digest: string };
export interface ProgressState { measurements: StoredMeasurement[]; deleted: DeletedMeasurement[] }
export const createEmptyProgressState = (): ProgressState => ({ measurements: [], deleted: [] });
export type RecordMeasurement = MeasurementKind & { operationId: string; value: number; timestamp: string };

export interface ProgressRepository {
  findByOperation(patientId: string, operationId: string): Promise<StoredMeasurement | null>;
  findById(patientId: string, id: string): Promise<StoredMeasurement | null>;
  findDeleted(patientId: string, operationId: string): Promise<DeletedMeasurement | null>;
  insert(measurement: Measurement): Promise<void>;
  listByPatient(patientId: string, from?: number, to?: number, createdFrom?: number): Promise<Measurement[]>;
  update(measurement: StoredMeasurement): Promise<void>;
  remove(measurement: DeletedMeasurement): Promise<void>;
  erasePatient(patientId: string): Promise<void>;
}

export function measurementDto({ originalDigest, ...measurement }: StoredMeasurement): Measurement { return measurement; }
const digestMeasurement = (measurement: Pick<Measurement, 'type' | 'timestamp' | 'value'>) =>
  digestRecord([measurement.type, measurement.timestamp, measurement.value]);

const measurementRanges = {
  WEIGHT: { min: 1, max: 500 },
  ARM_CIRCUMFERENCE: { min: 5, max: 100 },
  TORSO_CIRCUMFERENCE: { min: 20, max: 300 },
} as const;
function assertPlausible(type: Measurement['type'], value: unknown): asserts value is number {
  const { min, max } = measurementRanges[type];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AppError('InvalidMeasurement', 400, `Valore fuori dall’intervallo plausibile (${min}–${max} ${type === 'WEIGHT' ? 'kg' : 'cm'}).`);
  }
}
function assertMeasurementDate(time: number) {
  if (time < minimumObservationTime) throw new AppError('InvalidMeasurement', 400, 'La data deve essere dal 2000 in poi.');
}
function validKind(input: RecordMeasurement): boolean {
  return (input.type === 'WEIGHT' && input.unit === 'KG') ||
    ((input.type === 'ARM_CIRCUMFERENCE' || input.type === 'TORSO_CIRCUMFERENCE') && input.unit === 'CM');
}

export class ProgressService {
  constructor(private readonly repo: ProgressRepository, private readonly patients: PatientService, private readonly clock: Clock) {}

  async record(actor: Principal, input: RecordMeasurement): Promise<Measurement | DeletedRecord> {
    this.patientOnly(actor);
    if (!input || !validOperationId(input.operationId) || !validKind(input) || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value <= 0) throw new AppError('InvalidMeasurement', 400, 'Inserire un valore positivo in kg per il peso o in cm per le circonferenze.');
    const time = observationTime(input.timestamp, this.clock(), 'InvalidMeasurement');
    const digest = digestMeasurement({ type: input.type, timestamp: time, value: input.value });
    const existing = await this.repo.findByOperation(actor.id, input.operationId);
    if (existing) {
      assertSameRecord(existing.originalDigest ?? digestMeasurement(existing), digest);
      return measurementDto(existing);
    }
    const deleted = await this.repo.findDeleted(actor.id, input.operationId);
    if (deleted) {
      const { digest: original, ...receipt } = deleted;
      assertSameRecord(original, digest);
      return receipt;
    }
    assertPlausible(input.type, input.value);
    assertMeasurementDate(time);
    const measurement: Measurement = { ...input, id: randomUUID(), patientId: actor.id, timestamp: time, createdAt: this.clock() };
    await this.repo.insert(measurement);
    return measurement;
  }

  async list(actor: Principal, patientId: string, from?: number, to?: number): Promise<Measurement[]> {
    const visibleFrom = await this.patients.visibleFrom(actor, patientId);
    if ((from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to)) || (from !== undefined && to !== undefined && from > to)) throw new AppError('ValidationError', 400, 'Intervallo non valido.');
    return this.repo.listByPatient(patientId, from, to, visibleFrom ?? undefined);
  }

  async correct(actor: Principal, id: string, input: { value?: unknown; timestamp?: unknown }): Promise<Measurement> {
    const measurement = await this.ownMeasurement(actor, id);
    const originalDigest = measurement.originalDigest ?? digestMeasurement(measurement);
    if (input.value !== undefined && input.value !== measurement.value) {
      assertPlausible(measurement.type, input.value);
      measurement.value = input.value;
    }
    if (input.timestamp !== undefined) {
      const time = observationTime(input.timestamp, this.clock(), 'InvalidMeasurement');
      if (time !== measurement.timestamp) assertMeasurementDate(time);
      measurement.timestamp = time;
    }
    const updated = { ...measurement, originalDigest, updatedAt: this.clock() };
    await this.repo.update(updated);
    return measurementDto(updated);
  }

  async remove(actor: Principal, id: string): Promise<{ deleted: true }> {
    const measurement = await this.ownMeasurement(actor, id);
    await this.repo.remove({ id, patientId: actor.id, operationId: measurement.operationId,
      digest: measurement.originalDigest ?? digestMeasurement(measurement), deletedAt: this.clock() });
    return { deleted: true };
  }

  async exportPatient(patientId: string): Promise<Measurement[]> { return this.repo.listByPatient(patientId); }
  async erasePatient(patientId: string): Promise<void> { await this.repo.erasePatient(patientId); }

  private async ownMeasurement(actor: Principal, id: string) {
    this.patientOnly(actor);
    const measurement = await this.repo.findById(actor.id, id);
    if (!measurement) throw new AppError('MeasurementNotFound', 404, 'Misurazione non trovata.');
    return measurement;
  }
  private patientOnly(actor: Principal) {
    if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Operazione riservata al paziente.');
  }
}
