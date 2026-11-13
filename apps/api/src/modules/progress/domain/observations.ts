import { AppError } from '../../../shared/contracts';

export const minimumObservationTime = Date.UTC(2000, 0, 1);

export function validOperationId(input: unknown): input is string {
  return typeof input === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(input);
}

export function observationTime(input: unknown, now: number, errorCode: string): number {
  const m = typeof input === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!m) throw new AppError(errorCode, 400, 'Timestamp ISO con offset richiesto.');
  const [, y, mo, d, h, mi, s, zone] = m;
  const offset = zone === 'Z' ? [0, 0] : zone.slice(1).split(':').map(Number);
  const value = Date.parse(input as string);
  const leap = +y % 4 === 0 && (+y % 100 !== 0 || +y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][+mo - 1] ?? 0;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > days || +h > 23 || +mi > 59 || +s > 59 || offset[0] > 23 || offset[1] > 59 || !Number.isFinite(value) || value > now) throw new AppError(errorCode, 400, 'Data inesistente o futura.');
  return value;
}
