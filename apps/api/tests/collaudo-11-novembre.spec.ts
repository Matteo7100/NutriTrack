/**
 * Regressioni dal collaudo dell'11 novembre 2026: inviti senza enumerazione,
 * cambio di Nutritionist, limiti di plausibilità e gestione degli inviti.
 * Pipeline HTTP reale con storage in memoria, come http.spec.ts.
 */
import { INestApplication } from '@nestjs/common';
import { createServer } from '../src/composition/bootstrap';
import { Application } from '../src/composition/application';
import { MemoryStorageFactory } from '../src/infrastructure/persistence';

const password = 'TestPassword2026!';
type Session = { cookie: string; csrf: string };

describe('Collaudo 11 novembre', () => {
  let server: INestApplication;
  let url: string;
  let now = Date.parse('2026-11-12T08:00:00Z');
  const tick = (ms = 60_000) => { now += ms; };
  const call = (path: string, method = 'GET', body?: unknown, session?: Session) => fetch(`${url}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(session ? { cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (response: Response) => response.json() as Promise<any>;
  const register = (email: string, name: string, role: string) => call('/auth/register', 'POST', { email, password, name, role });
  async function login(email: string): Promise<Session> {
    const response = await call('/auth/login', 'POST', { email, password });
    const data = await json(response);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
  }
  async function associate(nutritionist: Session, patient: Session, email: string) {
    expect((await call('/patients/invitations', 'POST', { email }, nutritionist)).status).toBe(202);
    const invitations = await json(await call('/patients/invitations', 'GET', undefined, patient));
    const invite = invitations[invitations.length - 1];
    expect((await call(`/patients/invitations/${invite.id}/accept`, 'POST', {}, patient)).status).toBe(201);
    tick();
  }
  const plan = (food: string) => ({ meals: [{ name: 'Colazione', options: [{ foods: [{ food, quantity: 45, unit: 'g' }] }] }] });
  const iso = () => new Date(now - 1000).toISOString();

  beforeAll(async () => {
    server = await createServer(new Application(new MemoryStorageFactory(), () => now), true);
    await server.listen(0, '127.0.0.1');
    url = await server.getUrl();
    await register('rossi@test.it', 'Dott.ssa Rossi', 'NUTRITIONIST');
    await register('bianchi@test.it', 'Dott. Bianchi', 'NUTRITIONIST');
    await register('omonimo@test.it', 'Dott.ssa Rossi', 'NUTRITIONIST');
    await register('p1@test.it', 'Paziente Uno', 'PATIENT');
    await register('p2@test.it', 'Paziente Due', 'PATIENT');
  });
  afterAll(async () => { await server?.close(); });

  it('l’invito risponde allo stesso modo per email sconosciute, pazienti associati e liberi', async () => {
    const rossi = await login('rossi@test.it'), omonimo = await login('omonimo@test.it');
    const p1 = await login('p1@test.it');
    await associate(rossi, p1, 'p1@test.it');
    const answers = await Promise.all(['nessuno@test.it', 'p1@test.it', 'p2@test.it', 'rossi@test.it'].map(async email => {
      const response = await call('/patients/invitations', 'POST', { email }, omonimo);
      return [response.status, await json(response)];
    }));
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    // Il paziente distingue i due nutrizionisti omonimi dall'email.
    const p2 = await login('p2@test.it');
    const [invite] = await json(await call('/patients/invitations', 'GET', undefined, p2));
    expect(invite).toMatchObject({ nutritionistName: 'Dott.ssa Rossi', nutritionistEmail: 'omonimo@test.it' });
  });

  it('il paziente rifiuta e il nutrizionista ritira un invito', async () => {
    const omonimo = await login('omonimo@test.it'), p2 = await login('p2@test.it');
    const [received] = await json(await call('/patients/invitations', 'GET', undefined, p2));
    expect((await call(`/patients/invitations/${received.id}/close`, 'POST', {}, p2)).status).toBe(201);
    expect(await json(await call('/patients/invitations', 'GET', undefined, p2))).toEqual([]);
    await call('/patients/invitations', 'POST', { email: 'p2@test.it' }, omonimo);
    const [sent] = await json(await call('/patients/invitations', 'GET', undefined, omonimo));
    expect(sent.patientEmail).toBe('p2@test.it');
    // Un estraneo non può chiudere l'invito di altri.
    const bianchi = await login('bianchi@test.it');
    expect((await call(`/patients/invitations/${sent.id}/close`, 'POST', {}, bianchi)).status).toBe(404);
    expect((await call(`/patients/invitations/${sent.id}/close`, 'POST', {}, omonimo)).status).toBe(201);
    expect(await json(await call('/patients/invitations', 'GET', undefined, p2))).toEqual([]);
  });

  it('alla fine dell’associazione il piano si chiude e il nuovo nutrizionista vede solo i dati nuovi', async () => {
    const rossi = await login('rossi@test.it'), bianchi = await login('bianchi@test.it'), p1 = await login('p1@test.it');
    const { user } = await json(await call('/auth/me', 'GET', undefined, p1));
    expect((await call(`/plans/${user.id}`, 'POST', { baseVersionId: null, content: plan('Avena') }, rossi)).status).toBe(201);
    tick();
    await call('/progress', 'POST', { operationId: 'weight-before-end', timestamp: iso(), value: 71.6, type: 'WEIGHT', unit: 'KG' }, p1);
    tick();
    expect((await call(`/patients/${user.id}/end`, 'POST', {}, p1)).status).toBe(201);
    tick();
    // Revoca: nessuna lettura per il vecchio nutrizionista e nessun piano attivo per il paziente.
    expect((await call(`/plans/${user.id}`, 'GET', undefined, rossi)).status).toBe(403);
    expect((await call(`/progress/${user.id}`, 'GET', undefined, rossi)).status).toBe(403);
    expect(await json(await call(`/plans/${user.id}`, 'GET', undefined, p1))).toBeNull();
    const meal = await json(await call('/diary', 'POST', { operationId: 'meal-without-plan', consumptionTime: iso(), actualConsumption: 'Pasto libero' }, p1));
    expect(meal.mealPlanVersionId).toBeNull();

    await associate(bianchi, p1, 'p1@test.it');
    await call('/progress', 'POST', { operationId: 'weight-after-start', timestamp: iso(), value: 70.9, type: 'WEIGHT', unit: 'KG' }, p1);
    expect(await json(await call(`/plans/${user.id}`, 'GET', undefined, bianchi))).toBeNull();
    expect(await json(await call(`/plans/${user.id}/history`, 'GET', undefined, bianchi))).toEqual([]);
    expect((await json(await call(`/progress/${user.id}`, 'GET', undefined, bianchi))).map((m: any) => m.value)).toEqual([70.9]);
    tick();
    const first = await json(await call(`/plans/${user.id}`, 'POST', { baseVersionId: null, content: plan('Yogurt') }, bianchi));
    expect(first).toMatchObject({ versionNumber: 2, parentVersionId: null });
    // Il paziente conserva tutto il proprio storico, numerato senza duplicati.
    expect((await json(await call(`/plans/${user.id}/history`, 'GET', undefined, p1))).map((v: any) => v.versionNumber)).toEqual([1, 2]);
    expect(await json(await call(`/progress/${user.id}`, 'GET', undefined, p1))).toHaveLength(2);
  });

  it('respinge misurazioni e date implausibili', async () => {
    const p2 = await login('p2@test.it');
    const weight = (value: number, operationId: string) => call('/progress', 'POST', { operationId, timestamp: iso(), value, type: 'WEIGHT', unit: 'KG' }, p2);
    expect((await weight(5000, 'weight-too-high')).status).toBe(400);
    expect((await weight(0.0001, 'weight-too-low')).status).toBe(400);
    expect((await weight(72.4, 'weight-plausible')).status).toBe(201);
    expect((await call('/progress', 'POST', { operationId: 'arm-too-high', timestamp: iso(), value: 180, type: 'ARM_CIRCUMFERENCE', unit: 'CM' }, p2)).status).toBe(400);
    expect((await call('/diary', 'POST', { operationId: 'meal-in-1900', consumptionTime: '1900-01-01T08:00:00Z', actualConsumption: 'Pane' }, p2)).status).toBe(400);
  });
});
