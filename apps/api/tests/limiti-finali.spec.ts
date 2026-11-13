/**
 * Limiti chiusi dopo il collaudo: correzione ed eliminazione delle registrazioni,
 * cambio password, esportazione ed eliminazione dell'account, avvisi email in locale.
 */
import { INestApplication } from '@nestjs/common';
import { createServer } from '../src/composition/bootstrap';
import { Application } from '../src/composition/application';
import { MemoryStorageFactory } from '../src/infrastructure/persistence';
import { createInvitationNotifier, createPasswordResetSender, type InvitationDelivery } from '../src/infrastructure/password-reset-mail';

const password = 'TestPassword2026!';
type Session = { cookie: string; csrf: string };

describe('Limiti finali', () => {
  let server: INestApplication;
  let url: string;
  let now = Date.parse('2026-11-12T08:00:00Z');
  const notified: InvitationDelivery[] = [];
  let app: Application;
  const tick = (ms = 60_000) => { now += ms; };
  const iso = () => new Date(now - 1000).toISOString();
  const call = (path: string, method = 'GET', body?: unknown, session?: Session) => fetch(`${url}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(session ? { cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (response: Response) => response.json() as Promise<any>;
  async function login(email: string, secret = password): Promise<Session> {
    const response = await call('/auth/login', 'POST', { email, password: secret });
    expect(response.status).toBe(201);
    const data = await json(response);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
  }
  const register = (email: string, name: string, role: string) => call('/auth/register', 'POST', { email, password, name, role });
  async function associate(nutritionist: Session, patient: Session, email: string) {
    await call('/patients/invitations', 'POST', { email }, nutritionist);
    await app.dispatcher.dispatch();
    const [invite] = await json(await call('/patients/invitations', 'GET', undefined, patient));
    expect((await call(`/patients/invitations/${invite.id}/accept`, 'POST', {}, patient)).status).toBe(201);
    tick();
  }

  beforeAll(async () => {
    app = new Application(new MemoryStorageFactory(), () => now, undefined, async delivery => { notified.push(delivery); });
    server = await createServer(app, true);
    await server.listen(0, '127.0.0.1');
    url = await server.getUrl();
    await register('rossi@test.it', 'Dott.ssa Rossi', 'NUTRITIONIST');
    await register('p1@test.it', 'Paziente Uno', 'PATIENT');
    await register('p2@test.it', 'Paziente Due', 'PATIENT');
  });
  afterAll(async () => { await server?.close(); });

  it('il paziente corregge ed elimina pasti; un retry dell’invio originale non li ripristina', async () => {
    const rossi = await login('rossi@test.it'), p1 = await login('p1@test.it');
    await associate(rossi, p1, 'p1@test.it');
    expect(notified).toEqual([{ email: 'p1@test.it', nutritionistName: 'Dott.ssa Rossi', nutritionistEmail: 'rossi@test.it' }]);
    const { user } = await json(await call('/auth/me', 'GET', undefined, p1));
    await call('/sharing', 'PUT', { enabled: true }, p1);
    const original = { operationId: 'meal-to-correct', consumptionTime: iso(), actualConsumption: 'Pasta 800 g' };
    const entry = await json(await call('/diary', 'POST', original, p1));
    tick();
    const corrected = await json(await call(`/diary/entries/${entry.id}`, 'PATCH', { actualConsumption: 'Pasta 80 g' }, p1));
    expect(corrected).toMatchObject({ actualConsumption: 'Pasta 80 g', updatedAt: now });
    // Il retry dell'invio offline originale non sovrascrive né va in conflitto.
    expect(await json(await call('/diary', 'POST', original, p1))).toMatchObject({ actualConsumption: 'Pasta 80 g' });
    const seen = await json(await call(`/diary/${user.id}`, 'GET', undefined, rossi));
    expect(seen[0]).toMatchObject({ actualConsumption: 'Pasta 80 g', updatedAt: now });
    // Solo il proprietario corregge.
    expect((await call(`/diary/entries/${entry.id}`, 'PATCH', { actualConsumption: 'x' }, rossi)).status).toBe(403);
    expect((await call(`/diary/entries/${entry.id}`, 'PATCH', { consumptionTime: '2099-01-01T00:00:00Z' }, p1)).status).toBe(400);

    expect((await call(`/diary/entries/${entry.id}`, 'DELETE', undefined, p1)).status).toBe(200);
    expect(await json(await call(`/diary/${user.id}`, 'GET', undefined, p1))).toEqual([]);
    const replay = await call('/diary', 'POST', original, p1);
    expect(replay.status).toBe(201);
    expect(await json(await call(`/diary/${user.id}`, 'GET', undefined, p1))).toEqual([]);
    expect((await call(`/diary/entries/${entry.id}`, 'DELETE', undefined, p1)).status).toBe(404);
  });

  it('il paziente corregge ed elimina misurazioni, con i limiti di plausibilità', async () => {
    const p1 = await login('p1@test.it');
    const { user } = await json(await call('/auth/me', 'GET', undefined, p1));
    const original = { operationId: 'weight-to-correct', timestamp: iso(), value: 716, type: 'WEIGHT', unit: 'KG' };
    expect((await call('/progress', 'POST', original, p1)).status).toBe(400);
    const measurement = await json(await call('/progress', 'POST', { ...original, value: 76.1 }, p1));
    expect((await call(`/progress/measurements/${measurement.id}`, 'PATCH', { value: 716 }, p1)).status).toBe(400);
    expect(await json(await call(`/progress/measurements/${measurement.id}`, 'PATCH', { value: 71.6 }, p1))).toMatchObject({ value: 71.6 });
    expect((await call(`/progress/measurements/${measurement.id}`, 'DELETE', undefined, p1)).status).toBe(200);
    expect(await json(await call(`/progress/${user.id}`, 'GET', undefined, p1))).toEqual([]);
    expect((await call('/progress', 'POST', { ...original, value: 76.1 }, p1)).status).toBe(201);
    expect(await json(await call(`/progress/${user.id}`, 'GET', undefined, p1))).toEqual([]);
  });

  it('cambio password: richiede quella attuale, mantiene la sessione corrente e revoca le altre', async () => {
    const tab = await login('p2@test.it'), other = await login('p2@test.it');
    expect((await call('/account/password', 'PATCH', { currentPassword: 'sbagliata-123', newPassword: 'NuovaPassword2026!' }, tab)).status).toBe(400);
    expect((await call('/account/password', 'PATCH', { currentPassword: password, newPassword: 'corta' }, tab)).status).toBe(400);
    expect((await call('/account/password', 'PATCH', { currentPassword: password, newPassword: 'NuovaPassword2026!' }, tab)).status).toBe(200);
    expect((await call('/auth/me', 'GET', undefined, tab)).status).toBe(200);
    expect((await call('/auth/me', 'GET', undefined, other)).status).toBe(401);
    expect((await call('/auth/login', 'POST', { email: 'p2@test.it', password })).status).toBe(401);
    await login('p2@test.it', 'NuovaPassword2026!');
  });

  it('esportazione ed eliminazione dell’account del paziente', async () => {
    const rossi = await login('rossi@test.it');
    const p1 = await login('p1@test.it');
    const { user } = await json(await call('/auth/me', 'GET', undefined, p1));
    await call(`/plans/${user.id}`, 'POST', { baseVersionId: null, content: { meals: [{ name: 'Colazione', options: [{ foods: [{ food: 'Avena', quantity: 45, unit: 'g' }] }] }] } }, rossi);
    tick();
    await call('/diary', 'POST', { operationId: 'meal-kept-for-export', consumptionTime: iso(), actualConsumption: 'Yogurt' }, p1);
    await call('/progress', 'POST', { operationId: 'weight-for-export', timestamp: iso(), value: 70.4, type: 'WEIGHT', unit: 'KG' }, p1);
    const exported = await call('/account/export', 'GET', undefined, p1);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const data = await json(exported);
    expect(data.account).toMatchObject({ email: 'p1@test.it', role: 'PATIENT' });
    expect(data.account.passwordHash).toBeUndefined();
    expect(data.diaryEntries.map((e: any) => e.actualConsumption)).toEqual(['Yogurt']);
    expect(data.planVersions).toHaveLength(1);
    expect(data.measurements.map((m: any) => m.value)).toEqual([70.4]);

    expect((await call('/account/delete', 'POST', { password: 'sbagliata-123' }, p1)).status).toBe(400);
    expect((await call('/account/delete', 'POST', { password }, p1)).status).toBe(200);
    expect((await call('/auth/me', 'GET', undefined, p1)).status).toBe(401);
    expect((await call('/auth/login', 'POST', { email: 'p1@test.it', password })).status).toBe(401);
    expect(await json(await call('/patients', 'GET', undefined, rossi))).toEqual([]);
    expect((await call(`/plans/${user.id}/history`, 'GET', undefined, rossi)).status).toBe(403);
    // La stessa email si può registrare di nuovo come account nuovo, senza dati precedenti.
    expect((await register('p1@test.it', 'Paziente Uno', 'PATIENT')).status).toBe(201);
    const again = await login('p1@test.it');
    const fresh = await json(await call('/account/export', 'GET', undefined, again));
    expect(fresh.diaryEntries).toEqual([]);
  });

  it('eliminazione del nutrizionista: i pazienti conservano lo storico, senza piano attivo né inviti orfani', async () => {
    await register('bianchi@test.it', 'Dott. Bianchi', 'NUTRITIONIST');
    await register('p3@test.it', 'Paziente Tre', 'PATIENT');
    const bianchi = await login('bianchi@test.it'), p3 = await login('p3@test.it');
    await associate(bianchi, p3, 'p3@test.it');
    const { user } = await json(await call('/auth/me', 'GET', undefined, p3));
    await call(`/plans/${user.id}`, 'POST', { baseVersionId: null, content: { meals: [{ name: 'Pranzo', options: [{ foods: [{ food: 'Riso', quantity: 70, unit: 'g' }] }] }] } }, bianchi);
    tick();
    await call('/patients/invitations', 'POST', { email: 'p1@test.it' }, bianchi);
    expect((await call('/account/delete', 'POST', { password }, bianchi)).status).toBe(200);
    expect(await json(await call(`/plans/${user.id}`, 'GET', undefined, p3))).toBeNull();
    expect(await json(await call(`/plans/${user.id}/history`, 'GET', undefined, p3))).toHaveLength(1);
    expect(await json(await call('/patients', 'GET', undefined, p3))).toEqual([]);
    const p1 = await login('p1@test.it');
    expect((await call('/patients/invitations', 'GET', undefined, p1)).status).toBe(200);
    expect(await json(await call('/patients/invitations', 'GET', undefined, p1))).toEqual([]);
  });
});

describe('Avvisi email', () => {
  it('in locale scrive nel terminale solo se MAIL_CONSOLE=true e mai in produzione', async () => {
    expect(createPasswordResetSender({ NODE_ENV: 'development' })).toBeUndefined();
    expect(createPasswordResetSender({ NODE_ENV: 'production', MAIL_CONSOLE: 'true' })).toBeUndefined();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const send = createPasswordResetSender({ NODE_ENV: 'development', MAIL_CONSOLE: 'true', PUBLIC_APP_URL: 'http://localhost:3000/' })!;
    await send({ email: 'p@test.it', token: 'abc' });
    expect(log.mock.calls[0][0]).toContain('http://localhost:3000/#resetToken=abc');
    const notify = createInvitationNotifier({ NODE_ENV: 'development', MAIL_CONSOLE: 'true' })!;
    await notify({ email: 'p@test.it', nutritionistName: 'Dott.ssa Rossi', nutritionistEmail: 'rossi@test.it' });
    expect(log.mock.calls[1][0]).toContain('rossi@test.it');
    log.mockRestore();
  });
});
