/** Smoke browser locale: modifica solo account demo, non azzera dati del database. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
// Ogni esecuzione usa testo univoco: la demo conserva i dati delle prove precedenti.
const mealText = 'Pasto offline smoke ' + Date.now();

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const nutritionist = await browser.newContext({ timezoneId: 'UTC' });
  const patient = await browser.newContext({ timezoneId: 'UTC' });
  const n = await nutritionist.newPage(), p = await patient.newPage();
  const errors = [];
  for (const page of [n, p]) page.on('pageerror', error => errors.push(error.message));
  async function login(page, email) {
    await page.goto(base); await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('DemoNutriTrack2026!');
    await page.getByRole('button', { name: 'Accedi', exact: true }).click();
    await page.getByRole('button', { name: 'Esci', exact: true }).waitFor();
  }
  async function request(page, route, method = 'GET', body) {
    return page.evaluate(async ({ route, method, body }) => {
      const me = await (await fetch('/api/auth/me')).json();
      const response = await fetch('/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(value));
      return value;
    }, { route, method, body });
  }
  try {
    await login(n, 'nutri@example.test'); await login(p, 'patient@example.test');
    console.log('Browser: due login completati');
    const who = await request(p, '/auth/me'), patientId = who.user.id;
    let patients = await request(n, '/patients');
    if (!patients.some(user => user.id === patientId)) {
      const pending = await request(p, '/patients/invitations');
      if (!pending.length) {
        await n.getByLabel('Email Patient').fill('patient@example.test');
        await n.getByRole('button', { name: 'Invita Patient', exact: true }).click();
        await n.getByText('Invito inviato. Il Patient deve accettarlo.', { exact: true }).waitFor();
      }
      await p.reload(); await p.getByRole('button', { name: 'Accetta associazione' }).first().click();
      await p.getByText('Associazione accettata.', { exact: true }).waitFor();
      await n.getByRole('button', { name: 'Aggiorna elenco', exact: true }).click();
    }
    if (await n.getByLabel('Paziente associato').inputValue() !== patientId) await n.getByLabel('Paziente associato').selectOption(patientId);
    // Il test è ripetibile anche su demo già popolata: attendere il piano corrente
    // prima di toccare l'editor, che cambia chiave quando arriva la versione.
    const currentPlan = await request(n, '/plans/' + patientId);
    if (currentPlan) await n.getByRole('button', { name: 'Pubblica nuova versione', exact: true }).waitFor();
    console.log('Browser: associazione disponibile');
    await n.getByLabel('Nome del pasto').first().fill('Colazione');
    await n.getByLabel('Alimento', { exact: true }).first().fill('Avena');
    await n.getByLabel('Quantità', { exact: true }).first().fill('80');
    const publish = n.getByRole('button', { name: /Crea primo piano|Pubblica nuova versione/ });
    await publish.click(); await n.getByText('Nuova versione pubblicata. Lo storico è preservato.', { exact: true }).waitFor();
    const firstPlan = await request(n, '/plans/' + patientId);
    console.log('Browser: piano pubblicato');
    await p.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await p.getByText('Avena · 80 g', { exact: true }).first().waitFor();
    await request(p, '/sharing', 'PUT', { enabled: false });
    const privateStatus = await n.evaluate(async id => (await fetch('/api/diary/' + id)).status, patientId);
    assert.equal(privateStatus, 403, 'Il diario privato deve essere negato');
    await p.reload(); p.on('dialog', dialog => dialog.accept());
    await p.getByRole('button', { name: 'Condividi il diario', exact: true }).click();
    await p.getByText('Diario condiviso.', { exact: true }).waitFor();
    assert.deepEqual(await request(n, '/diary/' + patientId), await request(p, '/diary/' + patientId));
    console.log('Browser: privacy negata e successiva condivisione verificate');
    // Aspetta che la shell e lo snapshot Patient siano disponibili prima della perdita rete.
    await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await p.waitForTimeout(1500);
    const consumption = new Date().toISOString();
    await patient.setOffline(true);
    await p.getByLabel('Quando hai consumato il pasto?').fill(consumption.slice(0, 19));
    // datetime-local usa il fuso del browser: il contesto predefinito è UTC su questo test.
    await p.getByLabel('Cosa hai mangiato?').fill(mealText);
    await p.getByRole('button', { name: 'Registra pasto', exact: true }).click();
    await p.getByLabel('Data e ora', { exact: true }).fill(consumption.slice(0, 19));
    await p.getByLabel('Peso (kg)').fill('74.2');
    await p.getByRole('button', { name: 'Registra peso', exact: true }).click();
    await p.reload(); await p.getByText(mealText, { exact: true }).waitFor();
    console.log('Browser: reload offline riuscito con coda conservata');
    const changed = structuredClone(firstPlan.content); changed.meals[0].options[0].foods[0].quantity = 90;
    await request(n, '/plans/' + patientId, 'POST', { baseVersionId: firstPlan.id, content: changed });
    await patient.setOffline(false);
    await p.getByText('Tutte le registrazioni sono confermate.', { exact: true }).waitFor({ timeout: 30_000 });
    const entries = await request(p, '/diary/' + patientId);
    const entry = entries.find(value => value.actualConsumption === mealText && value.mealPlanVersionId === firstPlan.id);
    assert.ok(entry, 'Il pasto offline deve restare associato alla versione prima del cambio');
    assert.ok((await request(n, '/progress/' + patientId)).some(value => value.value === 74.2));
    assert.deepEqual(errors, []);
    const evidence = path.resolve(__dirname, '../../../docs/evidence'); fs.mkdirSync(evidence, { recursive: true });
    await p.screenshot({ path: path.join(evidence, 'browser-patient.png'), fullPage: true });
    console.log('PASS browser: invito/accettazione, piano, privacy, sharing, peso, shell offline+reload, sync storico. Nessun pageerror.');
  } catch (error) {
    console.error('Browser checkpoint failure:', error.message, 'pageerrors:', errors);
    console.error('PATIENT BODY:', await p.locator('body').innerText().catch(() => 'unavailable'));
    console.error('NUTRITIONIST BODY:', await n.locator('body').innerText().catch(() => 'unavailable'));
    console.error('INVITATIONS:', await request(p, '/patients/invitations').catch(e => e.message));
    const evidence = path.resolve(__dirname, '../../../docs/evidence'); fs.mkdirSync(evidence, { recursive: true });
    await p.screenshot({ path: path.join(evidence, 'browser-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
