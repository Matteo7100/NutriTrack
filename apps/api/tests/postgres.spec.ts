/**
 * Integrazione opt-in su PostgreSQL reale: usa account unici, senza cancellare dati.
 * TEST_DATABASE_URL deve indicare il DB locale di test. Nessun fallback memory.
 */
import { randomUUID } from 'node:crypto';
import { PostgresPersistence } from '../src/infrastructure/persistence';
import { Application } from '../src/composition/application';
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('PostgreSQL: transazioni reali e persistenza', () => {
  let db: PostgresPersistence;
  let second: PostgresPersistence;
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    db = new PostgresPersistence(); second = new PostgresPersistence();
  });
  afterAll(async () => { await db?.close(); await second?.close(); });
  it('con due connessioni accetta una sola pubblicazione dalla stessa base e deduplica retry', async () => {
    const app = new Application(db), other = new Application(second);
    const suffix = randomUUID();
    const { n, p, version } = await db.run(async () => {
      const n = await app.identity.provision(`n-${suffix}@test.it`, 'TestPassword2026!', 'N Test', 'NUTRITIONIST');
      const p = await app.identity.provision(`p-${suffix}@test.it`, 'TestPassword2026!', 'P Test', 'PATIENT');
      const invite = await app.patients.invite(n, p.email); await app.patients.accept(p, invite.id);
      const version = await app.plans.publish(n, p.id, null, { meals: [{ name: 'Pranzo', options: [{ foods: [{ food: 'Pasta', quantity: 80, unit: 'g' }] }] }] });
      return { n, p, version };
    });
    const results = await Promise.allSettled([
      db.run(() => app.plans.publish(n, p.id, version.id, version.content)),
      second.run(() => other.plans.publish(n, p.id, version.id, version.content)),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
    const payload = { operationId: randomUUID(), consumptionTime: new Date().toISOString(), actualConsumption: 'Pasta' };
    const first = await db.run(() => app.diary.record(p, payload));
    const retry = await second.run(() => other.diary.record(p, payload));
    expect(retry.id).toBe(first.id);
    expect(await second.run(() => other.diary.list(p, p.id))).toHaveLength(1);
    // Rollback di una modifica a un secondo modulo.
    await expect(db.run(async () => { await app.diary.setSharing(p, true); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await second.run(() => other.diary.sharing(p))).toEqual({ enabled: false });
  }, 30000);

  it('conserva foto binarie tra connessioni e rispetta il rollback', async () => {
    const app = new Application(db), other = new Application(second);
    const patient = await db.run(() => app.identity.provision(`p-${randomUUID()}@test.it`, 'TestPassword2026!', 'P Test', 'PATIENT'));
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7GQAAAAASUVORK5CYII=';
    const payload = { operationId: randomUUID(), timestamp: new Date().toISOString(), dataUrl: `data:image/png;base64,${png}` };
    const [first, retry] = await Promise.all([
      db.run(() => app.progressPhotos.add(patient, payload)),
      second.run(() => other.progressPhotos.add(patient, payload)),
    ]);
    expect(retry).toEqual(first);
    expect(await second.run(() => other.progressPhotos.list(patient))).toEqual([first]);
    await expect(db.run(async () => {
      await app.progressPhotos.delete(patient, first.id);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const stored = await second.run(() => other.progressPhotos.get(patient, first.id));
    expect(Buffer.from(stored.bytes).toString('base64')).toBe(png);
    await db.run(() => app.progressPhotos.delete(patient, first.id));
  }, 30000);
});
