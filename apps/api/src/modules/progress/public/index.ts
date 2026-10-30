/**
 * Misurazioni storiche di peso: append-only, positive, WEIGHT/KG.
 * Il Patient registra i propri dati, il Nutritionist assegnato li legge anche
 * quando il diario è privato. Deduplicazione per operazione nella stessa transazione.
 */
import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal, Repository } from '../../../shared/contracts';
import { PatientService } from '../../patient-management/public';

export interface Measurement { id: string; patientId: string; type: 'WEIGHT'; value: number; unit: 'KG'; timestamp: number; createdAt: number; operationId: string }
export interface ProgressState { measurements: Measurement[] }
export const createEmptyProgressState = (): ProgressState => ({ measurements: [] });
export interface RecordMeasurement { operationId: string; type: 'WEIGHT'; value: number; unit: 'KG'; timestamp: string }

function timestamp(input: unknown, now: number): number {
  const m = typeof input === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!m) throw new AppError('InvalidMeasurement', 400, 'Timestamp ISO con offset richiesto.');
  const [, y, mo, d, h, mi, s, zone] = m;
  const offset = zone === 'Z' ? [0, 0] : zone.slice(1).split(':').map(Number);
  const value = Date.parse(input as string);
  const leap = +y % 4 === 0 && (+y % 100 !== 0 || +y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][+mo - 1] ?? 0;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > days || +h > 23 || +mi > 59 || +s > 59 || offset[0] > 23 || offset[1] > 59 || !Number.isFinite(value) || value > now) throw new AppError('InvalidMeasurement', 400, 'Data inesistente o futura.');
  return value;
}

export class ProgressService {
  constructor(private readonly repo: Repository<ProgressState>, private readonly patients: PatientService, private readonly clock: Clock) {}

  async record(actor: Principal, input: RecordMeasurement): Promise<Measurement> {
    if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Solo il Patient registra misurazioni.');
    if (!input || typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationId) || input.type !== 'WEIGHT' || input.unit !== 'KG' || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value <= 0) throw new AppError('InvalidMeasurement', 400, 'Peso positivo e finito in kg richiesto.');
    const time = timestamp(input.timestamp, this.clock());
    const state = await this.repo.get();
    const existing = state.measurements.find(m => m.patientId === actor.id && m.operationId === input.operationId);
    if (existing) {
      if (existing.value !== input.value || existing.timestamp !== time) throw new AppError('OperationConflict', 409, 'operationId già usato con dati diversi.');
      return structuredClone(existing);
    }
    const measurement: Measurement = { id: randomUUID(), patientId: actor.id, type: 'WEIGHT', value: input.value, unit: 'KG', timestamp: time, createdAt: this.clock(), operationId: input.operationId };
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
