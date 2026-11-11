/** Smoke browser locale: usa gli account demo e un profilo di prova con email univoca. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const evidence = process.env.SMOKE_EVIDENCE_DIR || path.resolve(__dirname, '../../../docs/evidence');
// Ogni esecuzione usa testo univoco: la demo conserva i dati delle prove precedenti.
const mealText = 'Pasto offline smoke ' + Date.now();

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const nutritionist = await browser.newContext({ timezoneId: 'UTC' });
  const patient = await browser.newContext({ timezoneId: 'UTC' });
  const n = await nutritionist.newPage(), p = await patient.newPage();
  const errors = [];
  for (const page of [n, p]) page.on('pageerror', error => errors.push(error.message));
  async function login(page, email, password = 'DemoNutriTrack2026!') {
    await page.goto(base); await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Accedi', exact: true }).click();
    await page.getByRole('button', { name: 'Esci', exact: true }).waitFor();
  }
  async function openSection(page, name) {
    await page.getByRole('link', { name: 'NutriTrack, panoramica' }).click();
    await page.getByRole('link', { name: new RegExp('^' + name) }).click();
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
    const fresh = await browser.newContext({ viewport: { width: 320, height: 844 } });
    try {
      const account = await fresh.newPage();
      account.on('pageerror', error => errors.push(error.message));
      const email = `smoke-${Date.now()}@example.test`, password = 'NuovoAccountSmoke2026!';
      await account.goto(base);
      await account.getByRole('button', { name: 'Password dimenticata?' }).click();
      await account.getByRole('heading', { name: 'Recupera la password' }).waitFor();
      await account.getByRole('button', { name: 'Torna al login' }).click();
      await account.getByRole('button', { name: 'Crea un account' }).click();
      await account.getByLabel('Nome e cognome').fill('Paziente Smoke');
      await account.getByLabel('Email', { exact: true }).fill(email);
      await account.getByLabel('Tipo di account').selectOption('PATIENT');
      await account.getByLabel('Password', { exact: true }).fill(password);
      await account.getByLabel('Conferma password').fill(password);
      await account.getByRole('button', { name: 'Crea account', exact: true }).click();
      await account.getByText('Account creato.', { exact: false }).waitFor();
      await login(account, email, password);
      assert.ok(await account.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'La dashboard mobile deve rientrare nel viewport');
      await account.getByRole('link', { name: 'Profilo', exact: true }).click();
      await account.getByRole('button', { name: 'Modifica profilo' }).click();
      await account.getByLabel('Data di nascita').fill('1995-04-12');
      await account.getByLabel('Altezza (cm)').fill('172.5');
      await account.getByRole('button', { name: 'Salva profilo' }).click();
      await account.getByText('Profilo aggiornato.').waitFor();
      await account.reload();
      await account.getByText('172,5 cm', { exact: true }).waitFor();
      assert.equal((await request(account, '/profile')).birthDate, '1995-04-12');
    } finally { await fresh.close(); }
    console.log('Browser: nuova registrazione, profilo salvato e dashboard mobile verificati');
    await login(n, 'nutri@example.test'); await login(p, 'patient@example.test');
    console.log('Browser: due login completati');
    await openSection(n, 'I tuoi pazienti');
    const who = await request(p, '/auth/me'), patientId = who.user.id;
    let patients = await request(n, '/patients');
    if (!patients.some(user => user.id === patientId)) {
      const pending = await request(p, '/patients/invitations');
      if (!pending.length) {
        await n.getByLabel('Email Patient').fill('patient@example.test');
        await n.getByRole('button', { name: 'Invita Patient', exact: true }).click();
        await n.getByText('Invito inviato. Il Patient deve accettarlo.', { exact: true }).waitFor();
      }
      await openSection(p, 'Condivisione e inviti');
      await p.reload(); await p.getByRole('button', { name: 'Accetta associazione' }).first().click();
      await p.getByText('Associazione accettata.', { exact: true }).waitFor();
      await n.getByRole('button', { name: 'Aggiorna elenco', exact: true }).click();
    }
    if (await n.getByLabel('Paziente associato').inputValue() !== patientId) await n.getByLabel('Paziente associato').selectOption(patientId);
    await openSection(n, 'Piano alimentare');
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
    await openSection(p, 'Piano alimentare');
    await p.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await p.getByText('Avena · 80 g', { exact: true }).first().waitFor();
    await request(p, '/sharing', 'PUT', { enabled: false });
    const privateStatus = await n.evaluate(async id => (await fetch('/api/diary/' + id)).status, patientId);
    assert.equal(privateStatus, 403, 'Il diario privato deve essere negato');
    await openSection(p, 'Condivisione e inviti');
    await p.reload(); p.on('dialog', dialog => dialog.accept());
    await p.getByRole('button', { name: 'Condividi il diario', exact: true }).click();
    await p.getByText('Diario condiviso.', { exact: true }).waitFor();
    assert.deepEqual(await request(n, '/diary/' + patientId), await request(p, '/diary/' + patientId));
    console.log('Browser: privacy negata e successiva condivisione verificate');
    await openSection(p, 'Misurazioni e progressi');
    const png = await p.evaluate(() => document.createElement('canvas').toDataURL('image/png').split(',')[1]);
    const photo = Buffer.from(png, 'base64');
    await p.getByLabel('File della foto').setInputFiles({ name: 'progress.png', mimeType: 'image/png', buffer: photo });
    const uploaded = p.waitForResponse(response => response.url().endsWith('/api/progress/photos') && response.request().method() === 'POST');
    await p.getByRole('button', { name: 'Carica foto', exact: true }).click();
    const uploadResponse = await uploaded;
    assert.equal(uploadResponse.status(), 201);
    const { id: photoId } = await uploadResponse.json();
    const galleryItem = p.locator('li').filter({ has: p.locator(`img[src="/api/progress/photos/${photoId}"]`) });
    const deletePhoto = galleryItem.getByRole('button', { name: /^Elimina foto del/ });
    await deletePhoto.waitFor();
    const photoImage = galleryItem.getByRole('img');
    await photoImage.scrollIntoViewIfNeeded();
    assert.ok(await photoImage.evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }));
    await deletePhoto.click();
    await deletePhoto.waitFor({ state: 'detached' });
    console.log('Browser: foto privata caricata ed eliminata');
    // Aspetta che la shell e lo snapshot Patient siano disponibili prima della perdita rete.
    await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await p.waitForTimeout(1500);
    const now = new Date();
    // Edge normalizza :00 al formato senza secondi, che Playwright tratta come diverso dal valore fornito.
    if (now.getUTCSeconds() === 0) now.setUTCSeconds(-1);
    const consumption = now.toISOString().slice(0, 19);
    await patient.setOffline(true);
    await openSection(p, 'Diario dei pasti');
    await p.getByLabel('Quando hai consumato il pasto?').fill(consumption);
    // datetime-local usa il fuso del browser: il contesto predefinito è UTC su questo test.
    await p.getByLabel('Cosa hai mangiato?').fill(mealText);
    await p.getByRole('button', { name: 'Registra pasto', exact: true }).click();
    await p.getByText('Registrazione salvata sul dispositivo.', { exact: false }).waitFor();
    await openSection(p, 'Misurazioni e progressi');
    await p.getByLabel('Data e ora', { exact: true }).fill(consumption);
    await p.getByLabel('Peso (kg)').fill('74.2');
    await p.getByRole('button', { name: 'Registra peso', exact: true }).click();
    await p.getByLabel('Misurazione', { exact: true }).selectOption('ARM_CIRCUMFERENCE');
    await p.getByLabel('Circonferenza braccio (cm)', { exact: true }).fill('31.4');
    await p.getByRole('button', { name: 'Registra circonferenza braccio', exact: true }).click();
    await openSection(p, 'Sincronizzazione');
    await p.getByText('31.4 cm', { exact: true }).waitFor();
    await p.reload(); await p.getByText(mealText, { exact: true }).waitFor();
    console.log('Browser: reload offline riuscito con coda conservata');
    const changed = structuredClone(firstPlan.content); changed.meals[0].options[0].foods[0].quantity = 90;
    await request(n, '/plans/' + patientId, 'POST', { baseVersionId: firstPlan.id, content: changed });
    await patient.setOffline(false);
    await p.getByText('Tutte le registrazioni sono confermate.', { exact: true }).waitFor({ timeout: 30_000 });
    // Dopo la rimozione dalla coda, il consumo deve apparire nel diario confermato:
    // verifica anche l'aggiornamento reale della vista tramite gli Observer.
    await openSection(p, 'Diario dei pasti');
    await p.getByText(mealText, { exact: true }).waitFor({ timeout: 30_000 });
    await p.locator('li').filter({ hasText: mealText }).getByText(`Versione associata: ${firstPlan.versionNumber}`, { exact: true }).waitFor();
    const entries = await request(p, '/diary/' + patientId);
    const entry = entries.find(value => value.actualConsumption === mealText && value.mealPlanVersionId === firstPlan.id);
    assert.ok(entry, 'Il pasto offline deve restare associato alla versione prima del cambio');
    const progress = await request(n, '/progress/' + patientId);
    assert.ok(progress.some(value => value.type === 'WEIGHT' && value.value === 74.2));
    assert.ok(progress.some(value => value.type === 'ARM_CIRCUMFERENCE' && value.value === 31.4));
    assert.deepEqual(errors, []);
    fs.mkdirSync(evidence, { recursive: true });
    await p.screenshot({ path: path.join(evidence, 'browser-patient.png'), fullPage: true });
    console.log('PASS browser: registrazione, profilo, inviti, piano, diario privato/condiviso, foto, misurazioni offline e sincronizzazione storica.');
  } catch (error) {
    console.error('Browser checkpoint failure:', error.message, 'pageerrors:', errors);
    console.error('PATIENT BODY:', await p.locator('body').innerText().catch(() => 'unavailable'));
    console.error('NUTRITIONIST BODY:', await n.locator('body').innerText().catch(() => 'unavailable'));
    console.error('INVITATIONS:', await request(p, '/patients/invitations').catch(e => e.message));
    fs.mkdirSync(evidence, { recursive: true });
    await p.screenshot({ path: path.join(evidence, 'browser-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
