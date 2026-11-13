/**
 * Regressione per le tabelle relazionali dei piani. I dati di test usano
 * identificativi unici. TEST_DATABASE_URL deve puntare a un database migrato.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Application } from '../src/composition/application';
import { PostgresStorageFactory } from '../src/infrastructure/persistence';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('PostgreSQL: ciclo di vita dei piani', () => {
  it('preserva lo storico al cambio del nutrizionista e rimuove tutte le versioni quando il paziente si cancella', async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const factory = new PostgresStorageFactory();
    const client = new PrismaClient();
    let now = Date.now();
    const app = new Application(factory, () => now);
    const password = 'TestPassword2026!';
    const suffix = randomUUID();
    const content = (food: string) => ({
      meals: [{ name: 'Pranzo', options: [{ foods: [{ food, quantity: 80, unit: 'g' }] }] }],
    });

    try {
      const { patient, first, second, v1, v2 } = await factory.run(async () => {
        const patient = await app.identity.provision(`p-${suffix}@test.it`, password, 'Paziente', 'PATIENT');
        const first = await app.identity.provision(`n1-${suffix}@test.it`, password, 'Primo nutrizionista', 'NUTRITIONIST');
        const second = await app.identity.provision(`n2-${suffix}@test.it`, password, 'Secondo nutrizionista', 'NUTRITIONIST');
        const invitation = await app.patients.invite(first, patient.email);
        await app.acceptInvitation(patient, invitation.id);
        now += 1000;
        const v1 = await app.plans.publish(first, patient.id, null, content('Riso'));
        now += 1000;
        const v2 = await app.plans.publish(first, patient.id, v1.id, content('Pasta'));
        return { patient, first, second, v1, v2 };
      });
      expect(v2.parentVersionId).toBe(v1.id);

      const v3 = await factory.run(async () => {
        now += 1000;
        await app.endAssociation(first, patient.id);
        expect(await app.plans.active(patient, patient.id)).toBeNull();
        const invitation = await app.patients.invite(second, patient.email);
        await app.acceptInvitation(patient, invitation.id);
        expect(await app.plans.history(second, patient.id)).toEqual([]);
        now += 1000;
        const v3 = await app.plans.publish(second, patient.id, null, content('Cous cous'));
        expect(await app.plans.history(second, patient.id)).toEqual([v3]);
        expect((await app.plans.history(patient, patient.id)).map(version => version.id)).toEqual([v1.id, v2.id, v3.id]);
        return v3;
      });
      expect(v3).toMatchObject({ mealPlanId: v1.mealPlanId, versionNumber: 3, parentVersionId: null });
      expect(await client.mealPlanVersion.count({ where: { mealPlanId: v1.mealPlanId } })).toBe(3);

      await factory.run(() => app.deleteAccount(patient, password));
      expect(await client.account.findUnique({ where: { id: patient.id } })).toBeNull();
      expect(await client.mealPlan.findUnique({ where: { id: v1.mealPlanId } })).toBeNull();
      expect(await client.mealPlanVersion.count({ where: { mealPlanId: v1.mealPlanId } })).toBe(0);
      expect(await client.mealPlanMeal.count({ where: { versionId: { in: [v1.id, v2.id, v3.id] } } })).toBe(0);
      expect(await client.patientAssignment.count({ where: { patientId: patient.id } })).toBe(0);
      expect(await client.patientInvitation.count({ where: { patientId: patient.id } })).toBe(0);
    } finally {
      await client.$disconnect();
      await factory.close();
    }
  }, 30000);
});
