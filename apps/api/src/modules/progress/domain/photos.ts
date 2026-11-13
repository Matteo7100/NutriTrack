import { randomUUID } from 'node:crypto';
import { AppError, Clock, Principal } from '../../../shared/contracts';
import { minimumObservationTime, observationTime, validOperationId } from './observations';

const maxPhotoBytes = 2 * 1024 * 1024;
const maxPatientPhotos = 50;
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';
export interface ProgressPhoto {
  id: string;
  timestamp: number;
  createdAt: number;
  mimeType: PhotoMime;
}
export interface StoredProgressPhoto extends ProgressPhoto {
  patientId: string;
  operationId: string;
  bytes: Uint8Array;
}

export interface ProgressPhotoRepository {
  list(patientId: string): Promise<ProgressPhoto[]>;
  find(patientId: string, id: string): Promise<StoredProgressPhoto | null>;
  findByOperation(patientId: string, operationId: string): Promise<StoredProgressPhoto | null>;
  add(photo: StoredProgressPhoto): Promise<void>;
  delete(patientId: string, id: string): Promise<boolean>;
  deleteAll(patientId: string): Promise<void>;
}

export function photoMetadata({ id, timestamp, createdAt, mimeType }: ProgressPhoto): ProgressPhoto {
  return { id, timestamp, createdAt, mimeType };
}

function hasImageSignature(mimeType: PhotoMime, bytes: Buffer): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return bytes.length > 5 && bytes.subarray(0, 3).equals(jpegSignature) && bytes.readUInt16BE(bytes.length - 2) === 0xffd9;
    case 'image/png':
      return bytes.length >= 33 && bytes.subarray(0, 8).equals(pngSignature) && bytes.toString('ascii', 12, 16) === 'IHDR';
    case 'image/webp':
      return bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8;
  }
}

function decodePhoto(dataUrl: unknown): { mimeType: PhotoMime; bytes: Buffer } {
  const header = typeof dataUrl === 'string' && /^data:(image\/(?:jpeg|png|webp));base64,/.exec(dataUrl);
  if (!header || typeof dataUrl !== 'string') throw new AppError('InvalidPhoto', 400, 'Caricare una foto JPEG, PNG o WebP.');
  const encoded = dataUrl.slice(header[0].length);
  if (encoded.length > 4 * Math.ceil(maxPhotoBytes / 3)) throw new AppError('PhotoTooLarge', 413, 'La foto deve pesare al massimo 2 MiB.');
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new AppError('InvalidPhoto', 400, 'Foto non valida.');
  const bytes = Buffer.from(encoded, 'base64');
  const mimeType = header[1] as PhotoMime;
  if (bytes.length > maxPhotoBytes) throw new AppError('PhotoTooLarge', 413, 'La foto deve pesare al massimo 2 MiB.');
  if (!hasImageSignature(mimeType, bytes)) throw new AppError('InvalidPhoto', 400, 'Il contenuto della foto non corrisponde al formato indicato.');
  return { mimeType, bytes };
}

export class ProgressPhotoService {
  constructor(private readonly repo: ProgressPhotoRepository, private readonly clock: Clock) {}

  private patientId(actor: Principal): string {
    if (actor.role !== 'PATIENT') throw new AppError('AuthorizationError', 403, 'Le foto dei progressi sono riservate al paziente.');
    return actor.id;
  }

  list(actor: Principal): Promise<ProgressPhoto[]> {
    return this.repo.list(this.patientId(actor));
  }

  async get(actor: Principal, id: string): Promise<StoredProgressPhoto> {
    const photo = await this.repo.find(this.patientId(actor), id);
    if (!photo) throw new AppError('PhotoNotFound', 404, 'Foto non trovata.');
    return photo;
  }

  async add(actor: Principal, input: { operationId?: unknown; timestamp?: unknown; dataUrl?: unknown }): Promise<ProgressPhoto> {
    const patientId = this.patientId(actor);
    if (!validOperationId(input.operationId)) throw new AppError('InvalidPhoto', 400, 'Identificativo dell’operazione non valido.');
    const createdAt = this.clock();
    const timestamp = observationTime(input.timestamp, createdAt, 'InvalidPhoto');
    const { mimeType, bytes } = decodePhoto(input.dataUrl);
    const existing = await this.repo.findByOperation(patientId, input.operationId);
    if (existing) {
      if (existing.timestamp !== timestamp || existing.mimeType !== mimeType || !bytes.equals(existing.bytes)) throw new AppError('OperationConflict', 409, 'operationId già usato con dati diversi.');
      return photoMetadata(existing);
    }
    if (timestamp < minimumObservationTime) throw new AppError('InvalidPhoto', 400, 'La data deve essere dal 2000 in poi.');
    if ((await this.repo.list(patientId)).length >= maxPatientPhotos) throw new AppError('PhotoLimit', 409, 'Raggiunto il limite di 50 foto. Elimina una foto prima di caricarne un’altra.');
    const photo: StoredProgressPhoto = { id: randomUUID(), patientId, operationId: input.operationId, timestamp, createdAt, mimeType, bytes };
    await this.repo.add(photo);
    return photoMetadata(photo);
  }

  /** Cancellazione definitiva, usata dall'eliminazione dell'account. */
  async erasePatient(patientId: string): Promise<void> { await this.repo.deleteAll(patientId); }

  async delete(actor: Principal, id: string): Promise<{ deleted: true }> {
    if (!await this.repo.delete(this.patientId(actor), id)) throw new AppError('PhotoNotFound', 404, 'Foto non trovata.');
    return { deleted: true };
  }
}
