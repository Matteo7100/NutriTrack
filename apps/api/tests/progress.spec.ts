import { INestApplication } from '@nestjs/common';
import { Application } from '../src/composition/application';
import { createServer } from '../src/composition/bootstrap';
import { MemoryStorageFactory } from '../src/infrastructure/persistence';

const timestamp = '2026-11-04T08:00:00Z';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7GQAAAAASUVORK5CYII=';
const photo = { operationId: 'progress-photo-1', timestamp, dataUrl: `data:image/png;base64,${png}` };
type Session = { cookie: string; csrf: string };

describe('Misurazioni e foto dei progressi via HTTP', () => {
  let server: INestApplication, url: string, patientId: string;
  let patient: Session, other: Session, nutritionist: Session;

  function request(path: string, method = 'GET', session?: Session, body?: string) {
    return fetch(`${url}/api${path}`, { method, body, headers: {
      'Content-Type': 'application/json', ...(session && { cookie: session.cookie, 'X-CSRF-Token': session.csrf }),
    } });
  }
  async function login(email: string): Promise<Session> {
    const response = await request('/auth/login', 'POST', undefined, JSON.stringify({ email, password: 'TestPassword2026!' }));
    const { csrfToken } = await response.json() as { csrfToken: string };
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: csrfToken };
  }

  beforeAll(async () => {
    const app = new Application(new MemoryStorageFactory(), () => Date.parse('2026-11-04T12:00:00Z'));
    await app.persistence.run(async () => {
      const p = await app.identity.provision('patient@test.it', 'TestPassword2026!', 'Patient', 'PATIENT');
      patientId = p.id;
      await app.identity.provision('other@test.it', 'TestPassword2026!', 'Other', 'PATIENT');
      const n = await app.identity.provision('nutri@test.it', 'TestPassword2026!', 'Nutritionist', 'NUTRITIONIST');
      const invitation = await app.patients.invite(n, p.email);
      await app.patients.accept(p, invitation.id);
    });
    server = await createServer(app, true);
    await server.listen(0, '127.0.0.1');
    url = await server.getUrl();
    [patient, other, nutritionist] = await Promise.all([login('patient@test.it'), login('other@test.it'), login('nutri@test.it')]);
  });
  afterAll(async () => { await server?.close(); });

  it('registra peso e circonferenze, valida le unità e deduplica le operazioni', async () => {
    const measurements = [
      { operationId: 'weight-test-1', timestamp, type: 'WEIGHT', unit: 'KG', value: 75.5 },
      { operationId: 'arm-test-1', timestamp, type: 'ARM_CIRCUMFERENCE', unit: 'CM', value: 31.5 },
      { operationId: 'torso-test-1', timestamp, type: 'TORSO_CIRCUMFERENCE', unit: 'CM', value: 90 },
    ];
    const saved = [];
    for (const input of measurements) {
      const response = await request('/progress', 'POST', patient, JSON.stringify(input));
      expect(response.status).toBe(201);
      saved.push(await response.json());
    }
    const retry = await request('/progress', 'POST', patient, JSON.stringify(measurements[1]));
    expect(await retry.json()).toEqual(saved[1]);
    expect((await request('/progress', 'POST', patient, JSON.stringify({ ...measurements[1], type: 'TORSO_CIRCUMFERENCE' }))).status).toBe(409);
    expect((await request('/progress', 'POST', patient, JSON.stringify({ ...measurements[1], unit: 'KG' }))).status).toBe(400);
    expect((await request('/progress', 'POST', nutritionist, JSON.stringify(measurements[1]))).status).toBe(403);
    const history = await request(`/progress/${patientId}`, 'GET', nutritionist);
    expect(await history.json()).toEqual(saved);
  });

  it('mantiene le foto private, valida l’upload e permette al paziente di eliminarle', async () => {
    const upload = (input = photo, session = patient) => request('/progress/photos', 'POST', session, JSON.stringify(input));
    expect((await upload(photo, { ...patient, csrf: '' })).status).toBe(403);
    expect((await upload(photo, nutritionist)).status).toBe(403);
    expect((await upload({ ...photo, dataUrl: `data:image/jpeg;base64,${png}` })).status).toBe(400);
    expect((await upload({ ...photo, dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })).status).toBe(400);
    const largeData = `data:image/png;base64,${'A'.repeat(4 * Math.ceil(2 * 1024 * 1024 / 3) + 4)}`;
    expect((await upload({ ...photo, dataUrl: largeData })).status).toBe(413);
    expect((await upload({ ...photo, dataUrl: 'A'.repeat(3 * 1024 * 1024) })).status).toBe(413);

    // Supera il limite JSON ordinario con whitespace, senza alterare i byte dell'immagine.
    const response = await request('/progress/photos', 'POST', patient, `${' '.repeat(105_000)}${JSON.stringify(photo)}`);
    expect(response.status).toBe(201);
    const saved = await response.json() as { id: string; timestamp: number; createdAt: number; mimeType: string };
    expect(saved).toEqual({ id: expect.any(String), timestamp: Date.parse(timestamp), createdAt: expect.any(Number), mimeType: 'image/png' });
    expect(await (await upload()).json()).toEqual(saved);
    expect((await upload({ ...photo, timestamp: '2026-11-04T07:00:00Z' })).status).toBe(409);
    expect(await (await request('/progress/photos', 'GET', patient)).json()).toEqual([saved]);
    expect(await (await request('/progress/photos', 'GET', other)).json()).toEqual([]);
    expect((await request('/progress/photos', 'GET', nutritionist)).status).toBe(403);
    const url = `/progress/photos/${saved.id}`;
    expect((await request(url)).status).toBe(401);
    expect((await request(url, 'GET', other)).status).toBe(404);
    expect((await request(url, 'DELETE', other)).status).toBe(404);
    const image = await request(url, 'GET', patient);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe(png);
    expect(await (await request(url, 'DELETE', patient)).json()).toEqual({ deleted: true });
    expect((await request(url, 'GET', patient)).status).toBe(404);
  });
});
