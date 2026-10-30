/**
 * Specifica eseguibile dei casi d'uso con repository fake: nessuna UI o rete.
 * I repository clonano i dati come un adapter persistente, quindi i servizi non
 * possono alterare lo stato già salvato tramite riferimenti JavaScript condivisi.
 * Atomicità tra richieste concorrenti è verificata separatamente contro PostgreSQL.
 */
import { Repository } from '../src/shared/contracts';
import { IdentityService, createEmptyIdentityState } from '../src/modules/identity/public';
import { PatientService, createEmptyPatientState } from '../src/modules/patient-management/public';
import { MealPlanningService, createEmptyMealPlanningState, PlanContent } from '../src/modules/meal-planning/public';
import { DiaryService, createEmptyDiaryState } from '../src/modules/diary/public';
import { ProgressService, createEmptyProgressState } from '../src/modules/progress/public';

function fake<T>(initial: T): Repository<T> {
  let state = structuredClone(initial);
  return { get: async () => structuredClone(state), save: async next => { state = structuredClone(next); } };
}
const content = (quantity = 80): PlanContent => ({ meals: [{ name: 'Colazione', options: [{ foods: [{ food: 'Avena', quantity, unit: 'g' }] }] }] });

async function fixture() {
  let now = Date.parse('2026-10-05T08:00:00Z');
  const clock = () => now;
  const identity = new IdentityService(fake(createEmptyIdentityState()), clock);
  const patients = new PatientService(fake(createEmptyPatientState()), identity, clock);
  const plans = new MealPlanningService(fake(createEmptyMealPlanningState()), patients, clock);
  const diary = new DiaryService(fake(createEmptyDiaryState()), patients, plans, clock);
  const progress = new ProgressService(fake(createEmptyProgressState()), patients, clock);
  const patient = await identity.provision('p@example.test', 'NutriTrack123!', 'Patient', 'PATIENT');
  const nutritionist = await identity.provision('n@example.test', 'NutriTrack123!', 'Nutritionist', 'NUTRITIONIST');
  const other = await identity.provision('other@example.test', 'NutriTrack123!', 'Other', 'NUTRITIONIST');
  const invitation = await patients.invite(nutritionist, patient.email);
  await patients.accept(patient, invitation.id);
  return { identity, patients, plans, diary, progress, patient, nutritionist, other,
    advance: (iso: string) => { now = Date.parse(iso); } };
}

describe('Contratti applicativi NutriTrack', () => {
  it('autentica, rifiuta password errata e revoca sessioni al logout', async () => {
    const f = await fixture();
    await expect(f.identity.login(f.patient.email, 'errata')).rejects.toMatchObject({ code: 'AuthenticationError' });
    const login = await f.identity.login(f.patient.email, 'NutriTrack123!');
    expect((await f.identity.authenticate(login.session.id)).user.id).toBe(f.patient.id);
    expect(login.user).not.toHaveProperty('passwordHash');
    await f.identity.logout(login.session.id);
    await expect(f.identity.authenticate(login.session.id)).rejects.toMatchObject({ code: 'AuthenticationError' });
    const renewed = await f.identity.login(f.patient.email, 'NutriTrack123!');
    f.advance('2026-10-06T08:00:00Z');
    await expect(f.identity.authenticate(renewed.session.id)).rejects.toMatchObject({ code: 'AuthenticationError' });
  });

  it('richiede accettazione e impedisce accesso ad altri professionisti', async () => {
    const f = await fixture();
    expect(await f.patients.isAssigned(f.nutritionist.id, f.patient.id)).toBe(true);
    await expect(f.patients.invite(f.other, f.patient.email)).rejects.toMatchObject({ code: 'AssociationConflict' });
    await expect(f.plans.history(f.other, f.patient.id)).rejects.toMatchObject({ code: 'PatientNotAssigned' });
    const unrelatedPatient = await f.identity.provision('other-patient@example.test', 'NutriTrack123!', 'Other Patient', 'PATIENT');
    await expect(f.plans.history(unrelatedPatient, f.patient.id)).rejects.toMatchObject({ code: 'PatientNotAssigned' });
    await expect(f.plans.publish(f.patient, f.patient.id, null, content())).rejects.toMatchObject({ code: 'AuthorizationError' });
  });

  it('associa pasto offline alla versione storica, senza modificare i contenuti precedenti', async () => {
    const f = await fixture();
    const first = await f.plans.publish(f.nutritionist, f.patient.id, null, content(80));
    f.advance('2026-10-05T14:00:00Z');
    const second = await f.plans.publish(f.nutritionist, f.patient.id, first.id, content(60));
    f.advance('2026-10-05T18:00:00Z');
    const entry = await f.diary.record(f.patient, { operationId: 'offline-op-1', consumptionTime: '2026-10-05T12:00:00Z', actualConsumption: 'Avena 80 g' });
    expect(entry.mealPlanVersionId).toBe(first.id);
    expect((await f.plans.getVersionAt(f.patient.id, second.validFrom))?.id).toBe(second.id);
    const history = await f.plans.history(f.patient, f.patient.id);
    expect(history[0].content).toEqual(content(80));
    expect(history[0].validUntil).toBe(second.validFrom);
    expect(second.changeSet).toContainEqual({ path: 'content.meals.0.options.0.foods.0.quantity', before: 80, after: 60 });
    await expect(f.plans.publish(f.nutritionist, f.patient.id, first.id, content())).rejects.toMatchObject({ code: 'MealPlanVersionConflict' });
  });

  it('ammette diario senza piano, deduplica retry e rifiuta payload diverso', async () => {
    const f = await fixture();
    const input = { operationId: 'retry-entry-1', consumptionTime: '2026-10-05T07:00:00Z', actualConsumption: 'Pizza' };
    const entry = await f.diary.record(f.patient, input);
    expect(entry.mealPlanVersionId).toBeNull();
    expect(await f.diary.record(f.patient, input)).toEqual(entry);
    expect(await f.diary.list(f.patient, f.patient.id)).toHaveLength(1);
    await expect(f.diary.record(f.patient, { ...input, actualConsumption: 'Altro' })).rejects.toMatchObject({ code: 'OperationConflict' });
  });

  it('diario inizialmente privato, condivisione storico e revoca senza cancellazione', async () => {
    const f = await fixture();
    await f.diary.record(f.patient, { operationId: 'private-entry', consumptionTime: '2026-10-05T07:00:00Z', actualConsumption: 'Pane' });
    expect(await f.diary.sharing(f.patient)).toEqual({ enabled: false });
    await expect(f.diary.list(f.nutritionist, f.patient.id)).rejects.toMatchObject({ code: 'DiaryNotShared' });
    await f.diary.setSharing(f.patient, true);
    expect(await f.diary.list(f.nutritionist, f.patient.id)).toHaveLength(1);
    await f.diary.setSharing(f.patient, false);
    await expect(f.diary.list(f.nutritionist, f.patient.id)).rejects.toMatchObject({ code: 'DiaryNotShared' });
    expect(await f.diary.list(f.patient, f.patient.id)).toHaveLength(1);
  });

  it('il consenso non passa a una nuova associazione', async () => {
    const f = await fixture();
    await f.diary.setSharing(f.patient, true);
    await f.patients.end(f.patient, f.patient.id);
    const invitation = await f.patients.invite(f.other, f.patient.email);
    await f.patients.accept(f.patient, invitation.id);
    expect(await f.diary.sharing(f.patient)).toEqual({ enabled: false });
    await expect(f.diary.list(f.other, f.patient.id)).rejects.toMatchObject({ code: 'DiaryNotShared' });
    await expect(f.diary.list(f.nutritionist, f.patient.id)).rejects.toMatchObject({ code: 'PatientNotAssigned' });
  });

  it('condivide misurazioni con il professionista assegnato indipendentemente dal diario', async () => {
    const f = await fixture();
    const input = { operationId: 'weight-op-1', timestamp: '2026-10-05T07:00:00Z', type: 'WEIGHT' as const, unit: 'KG' as const, value: 78.2 };
    const measurement = await f.progress.record(f.patient, input);
    expect(await f.progress.record(f.patient, input)).toEqual(measurement);
    expect(await f.progress.list(f.nutritionist, f.patient.id)).toHaveLength(1);
    await expect(f.progress.list(f.other, f.patient.id)).rejects.toMatchObject({ code: 'PatientNotAssigned' });
    await expect(f.progress.record(f.patient, { ...input, value: 79 })).rejects.toMatchObject({ code: 'OperationConflict' });
  });

  it('rifiuta date senza offset, date impossibili, futuro e quantità invalide', async () => {
    const f = await fixture();
    for (const consumptionTime of ['2026-10-05T07:00:00', '2026-02-30T07:00:00Z', '2027-01-01T00:00:00Z']) {
      await expect(f.diary.record(f.patient, { operationId: 'invalid-entry', consumptionTime, actualConsumption: 'Pane' })).rejects.toMatchObject({ code: 'InvalidDiaryEntry' });
    }
    await expect(f.plans.publish(f.nutritionist, f.patient.id, null, content(0))).rejects.toMatchObject({ code: 'InvalidMealPlan' });
    await expect(f.progress.record(f.patient, { operationId: 'negative-weight', timestamp: '2026-10-05T07:00:00Z', type: 'WEIGHT', unit: 'KG', value: -1 })).rejects.toMatchObject({ code: 'InvalidMeasurement' });
  });
});
