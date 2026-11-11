/**
 * Abstract Factory: verifica comportamenti che richiedono prodotti coerenti,
 * non soltanto i nomi dei metodi create*. Lo stesso caso d'uso attraversa tutti
 * i cinque repository e la UnitOfWork; rollback e isolamento restano invariati.
 */
import { randomUUID } from 'node:crypto';
import { Application } from '../src/composition/application';
import { MemoryStorageFactory, PostgresStorageFactory } from '../src/infrastructure/persistence';
import { StorageFactory } from '../src/infrastructure/storage-factory';

const now = Date.parse('2026-11-04T12:00:00Z');
const plan = { meals: [{ name: 'Pranzo', options: [{ foods: [{ food: 'Pasta', quantity: 80, unit: 'g' }] }] }] };

async function populate(factory: StorageFactory) {
  const app = new Application(factory, () => now);
  const suffix = randomUUID();
  const actors = await app.persistence.run(async () => {
    const patient = await app.identity.provision(`p-${suffix}@test.local`, 'Password123!', 'Patient', 'PATIENT');
    const nutritionist = await app.identity.provision(`n-${suffix}@test.local`, 'Password123!', 'Nutritionist', 'NUTRITIONIST');
    const invitation = await app.patients.invite(nutritionist, patient.email);
    await app.patients.accept(patient, invitation.id);
    const version = await app.plans.publish(nutritionist, patient.id, null, plan);
    await app.diary.setSharing(patient, true);
    await app.diary.record(patient, { operationId: `diary-${suffix}`, consumptionTime: new Date(now).toISOString(), actualConsumption: 'Pasta 80g' });
    await app.progress.record(patient, { operationId: `weight-${suffix}`, timestamp: new Date(now).toISOString(), type: 'WEIGHT', unit: 'KG', value: 78 });
    return { patient, nutritionist, version };
  });
  return { app, ...actors };
}

describe('Abstract Factory: famiglia Memory coerente', () => {
  it('i cinque prodotti collaborano nello stesso caso d’uso e conservano scope distinti', async () => {
    const factory = new MemoryStorageFactory();
    const { patient, nutritionist, version } = await populate(factory);
    // Un secondo client della stessa factory trova dati e transazione condivisi.
    const otherClient = new Application(factory, () => now);
    await factory.createUnitOfWork().run(async () => {
      expect((await otherClient.diary.list(nutritionist, patient.id))[0].mealPlanVersionId).toBe(version.id);
      expect(await otherClient.progress.list(nutritionist, patient.id)).toHaveLength(1);
      const identity = factory.createIdentityRepository();
      expect((await identity.findAccountById(patient.id))?.email).toBe(patient.email);
      expect((await identity.findAccountById(nutritionist.id))?.email).toBe(nutritionist.email);
      expect(await factory.createPatientRepository().activeAssignmentsForNutritionist(nutritionist.id)).toHaveLength(1);
      expect(await factory.createMealPlanRepository().listVersions(patient.id)).toHaveLength(1);
      expect(await factory.createDiaryRepository().listByPatient(patient.id)).toHaveLength(1);
      expect(await factory.createProgressRepository().listByPatient(patient.id)).toHaveLength(1);
    });
  });

  it('rollback annulla scritture su due prodotti della stessa famiglia', async () => {
    const factory = new MemoryStorageFactory();
    const { app, patient } = await populate(factory);
    await expect(app.persistence.run(async () => {
      await app.diary.setSharing(patient, false);
      await app.progress.record(patient, { operationId: 'rollback-weight', timestamp: new Date(now).toISOString(), type: 'WEIGHT', unit: 'KG', value: 77 });
      throw new Error('Errore dopo due prodotti');
    })).rejects.toThrow('Errore dopo due prodotti');
    await factory.createUnitOfWork().run(async () => {
      expect(await app.diary.sharing(patient)).toEqual({ enabled: true });
      expect(await app.progress.list(patient, patient.id)).toHaveLength(1);
    });
  });

  it('due factory Memory hanno archivi e contesti indipendenti: non si mischiano le famiglie', async () => {
    const left = new MemoryStorageFactory(), right = new MemoryStorageFactory();
    const { patient } = await populate(left);
    const rightApp = new Application(right, () => now);
    expect(await right.createUnitOfWork().run(() => rightApp.identity.findUserByEmail(patient.email))).toBeNull();
    // Un repository della famiglia sinistra non funziona nella transazione destra.
    await expect(right.createUnitOfWork().run(() => left.createIdentityRepository().findAccountById(patient.id))).rejects.toThrow('UnitOfWork');
    await expect(left.createDiaryRepository().getPreference(patient.id)).rejects.toThrow('UnitOfWork');
  });

  it('gli adapter preservano copie su lettura e scrittura', async () => {
    const factory = new MemoryStorageFactory();
    const repo = factory.createDiaryRepository();
    await factory.createUnitOfWork().run(async () => {
      const preference = { enabled: true, assignmentId: 'A1' };
      await repo.savePreference('P1', preference);
      preference.enabled = false;
      expect((await repo.getPreference('P1'))?.enabled).toBe(true);
      const read = (await repo.getPreference('P1'))!;
      read.enabled = false;
      expect((await repo.getPreference('P1'))?.enabled).toBe(true);
    });
  });
});

const postgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;
postgres('Abstract Factory: stessa famiglia PostgreSQL reale', () => {
  let factory: PostgresStorageFactory, second: PostgresStorageFactory;
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    factory = new PostgresStorageFactory(); second = new PostgresStorageFactory();
  });
  afterAll(async () => { await factory?.close(); await second?.close(); });
  it('adatta i cinque prodotti, mantiene il rollback e non mescola contesti di connessioni diverse', async () => {
    const { patient, nutritionist, version, app } = await populate(factory);
    const otherApp = new Application(second, () => now);
    await second.createUnitOfWork().run(async () => {
      expect((await otherApp.diary.list(nutritionist, patient.id))[0].mealPlanVersionId).toBe(version.id);
      expect(await otherApp.progress.list(nutritionist, patient.id)).toHaveLength(1);
    });
    await expect(factory.createUnitOfWork().run(async () => {
      await app.diary.setSharing(patient, false);
      await app.progress.record(patient, { operationId: randomUUID(), timestamp: new Date(now).toISOString(), type: 'WEIGHT', unit: 'KG', value: 77 });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    await second.createUnitOfWork().run(async () => {
      expect(await otherApp.diary.sharing(patient)).toEqual({ enabled: true });
      expect(await otherApp.progress.list(patient, patient.id)).toHaveLength(1);
    });
    await expect(second.createUnitOfWork().run(() => factory.createIdentityRepository().findAccountById(patient.id))).rejects.toThrow('UnitOfWork');
  }, 30000);
});
