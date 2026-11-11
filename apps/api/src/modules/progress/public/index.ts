/**
 * Misurazioni storiche di peso e circonferenze: append-only e positive.
 * Il Patient registra i propri dati, il Nutritionist assegnato li legge anche
 * quando il diario è privato. Deduplicazione per operazione nella stessa transazione.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal, Repository } from '../../../shared/contracts';
import { PatientService } from '../../patient-management/public';
import { observationTime, validOperationId } from '../domain/observations';

export { ProgressPhotoService, photoMetadata } from '../domain/photos';
export type { ProgressPhoto, ProgressPhotoRepository, StoredProgressPhoto } from '../domain/photos';

type MeasurementKind = { type: 'WEIGHT'; unit: 'KG' } | { type: 'ARM_CIRCUMFERENCE' | 'TORSO_CIRCUMFERENCE'; unit: 'CM' };
export type Measurement = MeasurementKind & { id: string; patientId: string; value: number; timestamp: number; createdAt: number; operationId: string };
export interface ProgressState { measurements: Measurement[] }
export const createEmptyProgressState = (): ProgressState => ({ measurements: [] });
export type RecordMeasurement = MeasurementKind & { operationId: string; value: number; timestamp: string };

function validKind(input: RecordMeasurement): boolean {
  return (input.type === 'WEIGHT' && input.unit === 'KG') ||
    ((input.type === 'ARM_CIRCUMFERENCE' || input.type === 'TORSO_CIRCUMFERENCE') && input.unit === 'CM');
}

export class ProgressService {
  constructor(private readonly repo: Repository<ProgressState>, private readonly patients: PatientService, private readonly clock: Clock) {}

  async record(actor: Principal, input: RecordMeasurement): Promise<Measurement> {
    if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Solo il Patient registra misurazioni.');
    if (!input || !validOperationId(input.operationId) || !validKind(input) || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value <= 0) throw new AppError('InvalidMeasurement', 400, 'Inserire un valore positivo in kg per il peso o in cm per le circonferenze.');
    const time = observationTime(input.timestamp, this.clock(), 'InvalidMeasurement');
    const state = await this.repo.get();
    const existing = state.measurements.find(m => m.patientId === actor.id && m.operationId === input.operationId);
    if (existing) {
      if (existing.type !== input.type || existing.value !== input.value || existing.timestamp !== time) throw new AppError('OperationConflict', 409, 'operationId già usato con dati diversi.');
      return structuredClone(existing);
    }
    const measurement: Measurement = { ...input, id: randomUUID(), patientId: actor.id, timestamp: time, createdAt: this.clock() };
    state.measurements.push(measurement);
    await this.repo.save(state);
    return structuredClone(measurement);
  }

  async list(actor: Principal, patientId: string, from?: number, to?: number): Promise<Measurement[]> {
    await this.patients.assertAccess(actor, patientId);
    if ((from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to)) || (from !== undefined && to !== undefined && from > to)) throw new AppError('ValidationError', 400, 'Intervallo non valido.');
    return structuredClone((await this.repo.get()).measurements.filter(m => m.patientId === patientId && (from === undefined || m.timestamp >= from) && (to === undefined || m.timestamp < to)).sort((a, b) => b.timestamp - a.timestamp));
  }
}
