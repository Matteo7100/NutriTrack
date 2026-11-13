/**
 * Resilienza (ADR-037), con fault injection: database irraggiungibile, provider
 * email in errore, circuit breaker, health check e log strutturati senza dati personali.
 */
import { INestApplication } from '@nestjs/common';
import { createServer } from '../src/composition/bootstrap';
import { Application } from '../src/composition/application';
import { breakerOpenMs } from '../src/composition/notification-dispatcher';
import { MemoryStorageFactory } from '../src/infrastructure/persistence';
import { createJsonLogger } from '../src/infrastructure/json-logger';
import type { InvitationDelivery } from '../src/infrastructure/password-reset-mail';
import type { UnitOfWork } from '../src/shared/unit-of-work';

const password = 'TestPassword2026!';
type Session = { cookie: string; csrf: string };

/** Storage in memoria che può simulare un database irraggiungibile. */
class FlakyStorage extends MemoryStorageFactory {
  down = false;
  hang = false;
  private unavailable() { return Object.assign(new Error('Can\'t reach database server'), { name: 'PrismaClientInitializationError' }); }
  override createUnitOfWork(): UnitOfWork {
    const inner = super.createUnitOfWork();
    return { run: operation => this.down ? Promise.reject(this.unavailable()) : inner.run(operation) };
  }
  override async ping() {
    if (this.hang) await new Promise(resolve => setTimeout(resolve, 3000));
    if (this.down) throw this.unavailable();
  }
}

describe('Resilienza', () => {
  let server: INestApplication;
  let url: string;
  let app: Application;
  let now = Date.parse('2026-11-12T08:00:00Z');
  const storage = new FlakyStorage();
  const lines: string[] = [];
  const delivered: InvitationDelivery[] = [];
  let providerDown = false;
  let providerCalls = 0;
  const call = (path: string, method = 'GET', body?: unknown, session?: Session) => fetch(`${url}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(session ? { cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (response: Response) => response.json() as Promise<any>;
  async function login(email: string): Promise<Session> {
    const response = await call('/auth/login', 'POST', { email, password });
    const data = await json(response);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: data.csrfToken };
  }
  const events = () => lines.map(line => JSON.parse(line) as Record<string, unknown>);

  beforeAll(async () => {
    const logger = createJsonLogger({ minLevel: 'debug', write: line => { lines.push(line); } });
    app = new Application(storage, () => now, undefined, async delivery => {
      providerCalls++;
      if (providerDown) throw new Error('Invio email rifiutato dal provider (HTTP 503).');
      delivered.push(delivery);
    }, logger);
    server = await createServer(app, true);
    await server.listen(0, '127.0.0.1');
    url = await server.getUrl();
    for (const [email, role] of [['rossi@test.it', 'NUTRITIONIST'], ['p1@test.it', 'PATIENT'], ['p2@test.it', 'PATIENT'], ['p3@test.it', 'PATIENT'], ['p4@test.it', 'PATIENT'], ['p5@test.it', 'PATIENT']]) {
      await call('/auth/register', 'POST', { email, password, name: 'Account', role });
    }
  });
  afterAll(async () => { await server?.close(); });

  it('health check: live senza database, ready 200 se il database risponde', async () => {
    expect(await json(await call('/health/live'))).toEqual({ status: 'ok' });
    const ready = await call('/health/ready');
    expect(ready.status).toBe(200);
    expect(await json(ready)).toMatchObject({ status: 'ok', checks: { database: { status: 'ok' }, mail: { status: 'ok' } } });
  });

  it('database irraggiungibile: 503 con Retry-After, ready a 503, log con lo stesso requestId', async () => {
    storage.down = true;
    const response = await call('/auth/login', 'POST', { email: 'p1@test.it', password });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(await json(response)).toMatchObject({ code: 'ServiceUnavailable' });
    const requestId = response.headers.get('x-request-id');
    expect(events()).toContainEqual(expect.objectContaining({ event: 'storage.unavailable', requestId }));
    expect(events()).toContainEqual(expect.objectContaining({ event: 'http.request', requestId, status: 503, code: 'ServiceUnavailable' }));
    expect((await call('/health/live')).status).toBe(200);
    const ready = await call('/health/ready');
    expect(ready.status).toBe(503);
    expect(await json(ready)).toMatchObject({ status: 'down', checks: { database: { status: 'down' } } });
    storage.down = false;
    expect((await call('/auth/login', 'POST', { email: 'p1@test.it', password })).status).toBe(201);
  });

  it('un database che non risponde fa scadere il ready entro 1 s invece di bloccarlo', async () => {
    storage.hang = true;
    const started = Date.now();
    const ready = await call('/health/ready');
    expect(ready.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(2000);
    storage.hang = false;
  });

  it('provider email giù: l’invito riesce, la notifica resta in outbox e parte quando il provider torna', async () => {
    const rossi = await login('rossi@test.it');
    providerDown = true;
    expect((await call('/patients/invitations', 'POST', { email: 'p1@test.it' }, rossi)).status).toBe(202);
    await app.dispatcher.dispatch();
    expect(delivered).toEqual([]);
    const pending = await app.persistence.run(() => app.notifications.pending());
    expect(pending).toEqual([expect.objectContaining({ kind: 'INVITATION', attempts: 1 })]);
    // Componente secondario degradato: il servizio resta disponibile.
    const ready = await call('/health/ready');
    expect(ready.status).toBe(200);
    expect(await json(ready)).toMatchObject({ status: 'degraded', checks: { mail: { status: 'degraded' } } });
    // L'operazione principale è avvenuta: il paziente vede l'invito.
    const p1 = await login('p1@test.it');
    expect(await json(await call('/patients/invitations', 'GET', undefined, p1))).toHaveLength(1);

    providerDown = false;
    await app.dispatcher.dispatch();
    expect(delivered).toEqual([]); // backoff: non ancora il momento del nuovo tentativo
    now += 5_000;
    await app.dispatcher.dispatch();
    expect(delivered).toEqual([{ email: 'p1@test.it', nutritionistName: 'Account', nutritionistEmail: 'rossi@test.it' }]);
    expect(await app.persistence.run(() => app.notifications.pending())).toEqual([]);
    expect(await json(await call('/health/ready'))).toMatchObject({ status: 'ok' });
  });

  it('circuit breaker: dopo 3 errori consecutivi il provider non viene chiamato per 60 s', async () => {
    const rossi = await login('rossi@test.it');
    providerDown = true;
    for (const email of ['p2@test.it', 'p3@test.it', 'p4@test.it', 'p5@test.it']) await call('/patients/invitations', 'POST', { email }, rossi);
    await app.dispatcher.dispatch();
    providerCalls = 0;
    now += 60_000; // oltre il backoff, ma il circuito è ancora aperto per qualche istante
    now -= 1_000;
    await app.dispatcher.dispatch();
    expect(providerCalls).toBe(0);
    expect(events()).toContainEqual(expect.objectContaining({ event: 'notification.circuit_open' }));
    providerDown = false;
    now += breakerOpenMs;
    await app.dispatcher.dispatch();
    expect(providerCalls).toBeGreaterThan(0);
    for (let retry = 0; retry < 4 && (await app.persistence.run(() => app.notifications.pending())).length; retry++) {
      now += 120_000;
      await app.dispatcher.dispatch();
    }
    expect(delivered.map(d => d.email).sort()).toEqual(['p1@test.it', 'p2@test.it', 'p3@test.it', 'p4@test.it', 'p5@test.it']);
  });

  it('log strutturati: una riga JSON per richiesta, requestId coerente, nessun dato personale', async () => {
    const p1 = await login('p1@test.it');
    const meal = 'Pasta al pesto molto riconoscibile';
    const response = await call('/diary', 'POST', { operationId: 'resilience-meal-1', consumptionTime: new Date(now - 1000).toISOString(), actualConsumption: meal }, p1);
    expect(response.status).toBe(201);
    const requestId = response.headers.get('x-request-id');
    const line = events().find(event => event.requestId === requestId && event.event === 'http.request');
    expect(line).toMatchObject({ level: 'info', service: 'nutritrack-api', method: 'POST', route: '/api/diary', status: 201 });
    expect(typeof line!.durationMs).toBe('number');
    const all = lines.join('\n');
    for (const secret of [password, meal, 'p1@test.it', 'rossi@test.it', p1.csrf]) expect(all).not.toContain(secret);
    // Gli identificativi nei percorsi diventano :id.
    const { user } = await json(await call('/auth/me', 'GET', undefined, p1));
    await call(`/plans/${user.id}`, 'GET', undefined, p1);
    await call('/not-a-route/private@example.test', 'GET', undefined, p1);
    await call('/plans/private@example.test', 'GET', undefined, p1);
    expect(all + lines.join('\n')).not.toContain(user.id);
    expect(lines.join('\n')).not.toContain('private@example.test');
    expect(events()).toContainEqual(expect.objectContaining({ route: '/api/plans/:id' }));
  });

  it('scarta un avviso se l’invito non è più pendente', async () => {
    const sender = await app.persistence.run(() => app.identity.findUserByEmail('rossi@test.it'));
    const recipient = await app.persistence.run(() => app.identity.findUserByEmail('p1@test.it'));
    if (!sender || !recipient) throw new Error('Fixture mancante.');
    await app.persistence.run(() => app.notifications.enqueue({
      kind: 'INVITATION', recipientId: recipient.id, senderId: sender.id, invitationId: 'non-pendente',
      email: recipient.email, nutritionistEmail: sender.email, nutritionistName: sender.name,
    }, 60_000));
    const before = delivered.length;
    await app.dispatcher.dispatch();
    expect(delivered).toHaveLength(before);
    expect(await app.persistence.run(() => app.notifications.pending())).toEqual([]);
  });

  it('il logger oscura i campi sensibili anche se passati per errore', () => {
    const written: string[] = [];
    createJsonLogger({ write: line => { written.push(line); } }).log('info', 'test', { email: 'a@b.it', token: 'abc', attempts: 2 });
    expect(JSON.parse(written[0])).toMatchObject({ email: '[redacted]', token: '[redacted]', attempts: 2 });
  });
});
