import { createHash } from 'node:crypto';
import { AppError } from './contracts';

export interface DeletedRecord {
  id: string;
  patientId: string;
  operationId: string;
  deletedAt: number;
}

export const digestRecord = (values: readonly (string | number)[]): string =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

export function assertSameRecord(expected: string, supplied: string): void {
  if (expected !== supplied) throw new AppError('OperationConflict', 409, 'operationId già usato con dati diversi.');
}
