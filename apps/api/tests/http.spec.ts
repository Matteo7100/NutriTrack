/** Pipeline HTTP reale Nest con repository fake: sessioni, CSRF e flusso dei due ruoli. */
import { INestApplication } from '@nestjs/common';
import { createServer } from '../src/composition/bootstrap';
import { Application } from '../src/composition/application';
import { MemoryPersistence } from '../src/infrastructure/persistence';

describe('API HTTP', () => {
  let server: INestApplication;
  let url: string;
  let patientId: string;
  type Session = { cookie: string; csrf: string };
  async function call(path: string, method = 'GET', body?: unknown, session?: Session) {
    return fetch(`${url}/api${path}`, { method, headers: {
      'Content-Type': 'application/json', ...(session ? { cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function login(email: string): Promise<Session> {
    const response = await call('/auth/login', 'POST', { email, password: 'TestPassword2026!' });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const data = await response.json() as any;
    expect(data.user.passwordHash).toBeUndefined();
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
  }
  beforeAll(async () => {
    const app = new Application(new MemoryPersistence());
    await app.persistence.run(async () => {
      await app.identity.provision('nutri@test.it', 'TestPassword2026!', 'Nutritionist', 'NUTRITIONIST');
      patientId = (await app.identity.provision('patient@test.it', 'TestPassword2026!', 'Patient', 'PATIENT')).id;
    });
    server = await createServer(app, true);
    await server.listen(0, '127.0.0.1');
    url = await server.getUrl();
  });
  afterAll(async () => { await server?.close(); });

  it('richiede sessione e token CSRF e rifiuta origine esterna', async () => {
    expect((await call('/patients')).status).toBe(401);
    const session = await login('patient@test.it');
    const emptyPlan = await call(`/plans/${patientId}`, 'GET', undefined, session);
    expect(emptyPlan.status).toBe(200);
    expect(await emptyPlan.json()).toBeNull();
    expect((await call('/sharing', 'PUT', { enabled: true }, { ...session, csrf: '' })).status).toBe(403);
    expect((await call(`/diary/${patientId}?from=2026-02-30T00:00:00Z`, 'GET', undefined, session)).status).toBe(400);
    const external = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://external.invalid' }, body: '{}' });
    expect(external.status).toBe(403);
  });

  it('invito, accettazione, piano, diario privato/condiviso e logout', async () => {
    const n = await login('nutri@test.it'), p = await login('patient@test.it');
    const invite = await (await call('/patients/invitations', 'POST', { email: 'patient@test.it' }, n)).json() as any;
    expect((await call(`/patients/invitations/${invite.id}/accept`, 'POST', {}, p)).status).toBe(201);
    const content = { meals: [{ name: 'Colazione', options: [{ foods: [{ food: 'Avena', quantity: 80, unit: 'g' }] }] }] };
    const version = await (await call(`/plans/${patientId}`, 'POST', { baseVersionId: null, content }, n)).json() as any;
    expect(version.versionNumber).toBe(1);
    const payload = { operationId: 'http-meal-1', consumptionTime: new Date().toISOString(), actualConsumption: 'Avena 80g' };
    const entry = await (await call('/diary', 'POST', payload, p)).json() as any;
    expect(entry.mealPlanVersionId).toBe(version.id);
    expect((await call(`/diary/${patientId}`, 'GET', undefined, n)).status).toBe(403);
    expect((await call('/sharing', 'PUT', { enabled: true }, p)).status).toBe(200);
    const list = await (await call(`/diary/${patientId}`, 'GET', undefined, n)).json() as any[];
    expect(list).toHaveLength(1);
    expect((await call('/diary', 'POST', { ...payload, mealPlanVersionId: version.id }, p)).status).toBe(400);
    expect((await call('/diary', 'POST', payload, p)).status).toBe(201);
    expect((await (await call(`/diary/${patientId}`, 'GET', undefined, p)).json() as any[])).toHaveLength(1);
    expect((await call('/auth/logout', 'POST', {}, p)).status).toBe(201);
    expect((await call('/auth/me', 'GET', undefined, p)).status).toBe(401);
  });
});
