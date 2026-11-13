import { INestApplication } from '@nestjs/common';
import { Application } from '../src/composition/application';
import { createServer } from '../src/composition/bootstrap';
import { createPasswordResetSender } from '../src/infrastructure/password-reset-mail';
import { MemoryPersistence } from '../src/infrastructure/persistence';
import type { PasswordResetDelivery } from '../src/modules/identity/public';

describe('Registrazione, profilo e recupero account via HTTP', () => {
  const originalPassword = 'TestPassword2026!';
  const replacementPassword = 'NuovaPassword2026!';
  const delivered: PasswordResetDelivery[] = [];
  let now = Date.parse('2026-10-30T12:00:00Z');
  let server: INestApplication;
  let url: string;
  type Session = { cookie: string; csrf: string };

  function call(path: string, method = 'GET', body?: unknown, session?: Session) {
    return fetch(`${url}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function register(email: string, role = 'PATIENT') {
    return call('/auth/register', 'POST', { email, role, name: 'Account Test', password: originalPassword });
  }

  async function login(email: string, password = originalPassword): Promise<Session> {
    const response = await call('/auth/login', 'POST', { email, password });
    expect(response.status).toBe(201);
    const data = await response.json() as { csrfToken: string };
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
  }

  let app: Application;
  // Le email escono dall'outbox dopo la risposta: il test attende il ciclo del dispatcher.
  const sent = () => app.dispatcher.dispatch();
  beforeAll(async () => {
    app = new Application(new MemoryPersistence(), () => now, async delivery => {
      delivered.push(delivery);
    });
    server = await createServer(app, true);
    await server.listen(0, '127.0.0.1');
    url = await server.getUrl();
  });
  afterAll(async () => { await server?.close(); });

  it('registra entrambi i ruoli e conserva l’unicità dell’email normalizzata', async () => {
    const created = await register('  Paziente@example.it  ');
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      user: { id: expect.any(String), email: 'paziente@example.it', name: 'Account Test', role: 'PATIENT' },
    });
    expect((await register('PAZIENTE@EXAMPLE.IT')).status).toBe(409);
    expect((await register('admin@example.it', 'ADMIN')).status).toBe(400);
    expect((await register('nutri@example.it', 'NUTRITIONIST')).status).toBe(201);
    const nutritionist = await login('nutri@example.it');
    expect((await call('/profile', 'GET', undefined, nutritionist)).status).toBe(403);
  });

  it('aggiorna solo il profilo personale e invalida il recupero del vecchio indirizzo', async () => {
    const oldEmail = 'profilo@example.it';
    const newEmail = 'profilo.nuovo@example.it';
    expect((await register(oldEmail)).status).toBe(201);
    const session = await login(oldEmail);
    expect((await call('/profile')).status).toBe(401);
    const initial = await call('/profile', 'GET', undefined, session);
    expect(await initial.json()).toMatchObject({ email: oldEmail, birthDate: null, heightCm: null });
    expect((await call('/profile', 'PATCH', { heightCm: 175 }, { ...session, csrf: '' })).status).toBe(403);
    expect((await call('/profile', 'PATCH', { birthDate: '2000-02-30' }, session)).status).toBe(400);
    expect((await call('/profile', 'PATCH', { email: newEmail }, session)).status).toBe(400);
    expect((await call('/auth/forgot-password', 'POST', { email: oldEmail })).status).toBe(202);
    await sent();
    const token = delivered.find(delivery => delivery.email === oldEmail)!.token;

    const updated = await call('/profile', 'PATCH', {
      email: newEmail, name: 'Nuovo Nome', birthDate: '2000-02-29', heightCm: 175.5, currentPassword: originalPassword,
    }, session);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ email: newEmail, name: 'Nuovo Nome', birthDate: '2000-02-29', heightCm: 175.5 });
    expect(await (await call('/auth/me', 'GET', undefined, session)).json()).toMatchObject({ user: { email: newEmail } });
    expect((await call('/auth/login', 'POST', { email: oldEmail, password: originalPassword })).status).toBe(401);
    expect((await call('/auth/reset-password', 'POST', { token, password: replacementPassword })).status).toBe(400);
    const cleared = await call('/profile', 'PATCH', { birthDate: null, heightCm: null }, await login(newEmail));
    expect(await cleared.json()).toMatchObject({ email: newEmail, birthDate: null, heightCm: null });
  });

  it('gestisce scadenza, richieste ravvicinate e consumo atomico del link, revocando le sessioni', async () => {
    const email = 'reset@example.it';
    expect((await register(email)).status).toBe(201);
    const firstSession = await login(email);
    const secondSession = await login(email);
    const requestReset = async (address = email) => { const response = await call('/auth/forgot-password', 'POST', { email: address }); await sent(); return response; };
    const reset = (token: string) => call('/auth/reset-password', 'POST', { token, password: replacementPassword });
    const unknown = await requestReset('unknown@example.it');
    const known = await requestReset();
    expect(known.status).toBe(unknown.status);
    expect(await known.json()).toEqual(await unknown.json());
    await requestReset();
    const deliveries = () => delivered.filter(delivery => delivery.email === email);
    expect(deliveries()).toHaveLength(1);
    now += 30 * 60 * 1000;
    expect((await reset(deliveries()[0].token)).status).toBe(400);
    expect((await requestReset()).status).toBe(202);
    expect(deliveries()).toHaveLength(2);
    const token = deliveries()[1].token;

    const results = await Promise.all([reset(token), reset(token)]);
    expect(results.map(response => response.status).sort()).toEqual([200, 400]);
    expect((await call('/auth/me', 'GET', undefined, firstSession)).status).toBe(401);
    expect((await call('/auth/me', 'GET', undefined, secondSession)).status).toBe(401);
    expect((await call('/auth/login', 'POST', { email, password: originalPassword })).status).toBe(401);
    await login(email, replacementPassword);
  });
});

it('compone il link nel frammento e invia la mail tramite l’adapter Resend', async () => {
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  try {
    const send = createPasswordResetSender({
      NODE_ENV: 'production',
      PUBLIC_APP_URL: 'https://nutrition.example/',
      RESEND_API_KEY: 'test-key',
      PASSWORD_RESET_FROM: 'NutriTrack <account@nutrition.example>',
    });
    await send!({ email: 'person@example.it', token: 'demo-token' });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      from: 'NutriTrack <account@nutrition.example>',
      to: ['person@example.it'],
      text: expect.stringContaining('https://nutrition.example/#resetToken=demo-token'),
    });
  } finally {
    request.mockRestore();
  }
});
