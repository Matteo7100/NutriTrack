/**
 * Verifica gli stessi servizi dentro il composition root e la UnitOfWork fake.
 * Non sostituisce i test PostgreSQL: rende osservabili atomicità/isolamento attesi
 * senza richiedere il database per ogni esecuzione dei test di dominio.
 */
import { Application } from '../src/composition/application';
import { MemoryPersistence } from '../src/infrastructure/persistence';
import { PlanContent } from '../src/modules/meal-planning/public';

const content: PlanContent = { meals: [{ name: 'Pranzo', options: [{ foods: [{ food: 'Pasta', quantity: 80, unit: 'g' }] }] }] };

async function fixture() {
  let time = Date.parse('2026-10-05T08:00:00Z');
  const persistence = new MemoryPersistence();
  const app = new Application(persistence, () => time);
  const actors = await persistence.run(async () => {
    const patient = await app.identity.provision('patient@test.local', 'Password123!', 'P', 'PATIENT');
    const nutritionist = await app.identity.provision('nutritionist@test.local', 'Password123!', 'N', 'NUTRITIONIST');
    const invitation = await app.patients.invite(nutritionist, patient.email);
    await app.patients.accept(patient, invitation.id);
    return { patient, nutritionist };
  });
  return { persistence, app, ...actors, advance: () => { time += 1000; } };
}

describe('UnitOfWork e composizione', () => {
  it('due richieste dalla stessa base non pubblicano entrambe', async () => {
    const f = await fixture();
    const first = await f.persistence.run(() => f.app.plans.publish(f.nutritionist, f.patient.id, null, content));
    f.advance();
    const results = await Promise.allSettled([
      f.persistence.run(() => f.app.plans.publish(f.nutritionist, f.patient.id, first.id, content)),
      f.persistence.run(() => f.app.plans.publish(f.nutritionist, f.patient.id, first.id, content)),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'MealPlanVersionConflict' });
    const versions = await f.persistence.run(() => f.app.plans.history(f.patient, f.patient.id));
    expect(versions).toHaveLength(2);
    expect(versions.filter(v => v.validUntil === null)).toHaveLength(1);
  });

  it('un errore annulla tutte le scritture del caso d’uso', async () => {
    const f = await fixture();
    await expect(f.persistence.run(async () => {
      await f.app.diary.setSharing(f.patient, true);
      await f.app.progress.record(f.patient, { operationId: 'rolled-back-weight', timestamp: '2026-10-05T07:00:00Z', type: 'WEIGHT', value: 78, unit: 'KG' });
      throw new Error('Simulazione guasto dopo le scritture');
    })).rejects.toThrow('Simulazione guasto');
    expect(await f.persistence.run(() => f.app.diary.sharing(f.patient))).toEqual({ enabled: false });
    expect(await f.persistence.run(() => f.app.progress.list(f.patient, f.patient.id))).toEqual([]);
  });

  it('nessun repository applicativo è utilizzabile fuori dalla transazione', async () => {
    const f = await fixture();
    await expect(f.app.plans.history(f.patient, f.patient.id)).rejects.toThrow('UnitOfWork');
  });
});
