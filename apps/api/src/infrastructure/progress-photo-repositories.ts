import type { Prisma } from '@prisma/client';
import { photoMetadata } from '../modules/progress/public';
import type { ProgressPhoto, ProgressPhotoRepository, StoredProgressPhoto } from '../modules/progress/public';
import type { Repository } from '../shared/contracts';

export class MemoryProgressPhotoRepository implements ProgressPhotoRepository {
  constructor(private readonly photos: Repository<StoredProgressPhoto[]>) {}

  async list(patientId: string) {
    return (await this.photos.get()).filter(photo => photo.patientId === patientId)
      .sort((a, b) => b.timestamp - a.timestamp || b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .map(photoMetadata);
  }
  async find(patientId: string, id: string) {
    return (await this.photos.get()).find(photo => photo.patientId === patientId && photo.id === id) ?? null;
  }
  async findByOperation(patientId: string, operationId: string) {
    return (await this.photos.get()).find(photo => photo.patientId === patientId && photo.operationId === operationId) ?? null;
  }
  async add(photo: StoredProgressPhoto) {
    const photos = await this.photos.get();
    photos.push(photo);
    await this.photos.save(photos);
  }
  async delete(patientId: string, id: string) {
    const photos = await this.photos.get();
    const remaining = photos.filter(photo => photo.patientId !== patientId || photo.id !== id);
    if (remaining.length === photos.length) return false;
    await this.photos.save(remaining);
    return true;
  }
  async deleteAll(patientId: string) {
    await this.photos.save((await this.photos.get()).filter(photo => photo.patientId !== patientId));
  }
}

const metadataColumns = { id: true, timestamp: true, createdAt: true, mimeType: true } as const;
type MetadataRow = Prisma.ProgressPhotoGetPayload<{ select: typeof metadataColumns }>;
function metadata({ id, timestamp, createdAt, mimeType }: MetadataRow): ProgressPhoto {
  return { id, timestamp: timestamp.getTime(), createdAt: createdAt.getTime(), mimeType: mimeType as ProgressPhoto['mimeType'] };
}
function stored(row: Prisma.ProgressPhotoGetPayload<{}>): StoredProgressPhoto {
  return { ...metadata(row), patientId: row.patientId, operationId: row.operationId, bytes: row.bytes };
}

export class PostgresProgressPhotoRepository implements ProgressPhotoRepository {
  constructor(private readonly currentDelegate: () => Prisma.TransactionClient['progressPhoto']) {}

  async list(patientId: string) {
    const rows = await this.currentDelegate().findMany({ where: { patientId }, select: metadataColumns,
      orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(metadata);
  }
  async find(patientId: string, id: string) {
    const row = await this.currentDelegate().findUnique({ where: { id, patientId } });
    return row ? stored(row) : null;
  }
  async findByOperation(patientId: string, operationId: string) {
    const row = await this.currentDelegate().findUnique({ where: { patientId_operationId: { patientId, operationId } } });
    return row ? stored(row) : null;
  }
  async add({ timestamp, createdAt, bytes, ...metadata }: StoredProgressPhoto) {
    await this.currentDelegate().create({ data: { ...metadata, timestamp: new Date(timestamp), createdAt: new Date(createdAt), bytes: new Uint8Array(bytes) } });
  }
  async delete(patientId: string, id: string) {
    const { count } = await this.currentDelegate().deleteMany({ where: { patientId, id } });
    return count > 0;
  }
  async deleteAll(patientId: string) {
    await this.currentDelegate().deleteMany({ where: { patientId } });
  }
}
