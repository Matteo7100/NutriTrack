/** Account solo dimostrativi; esecuzione esplicita, idempotente e senza cancellare dati. */
import 'dotenv/config';
import { Application } from './application';
import { PostgresPersistence } from '../infrastructure/persistence';

export async function seed(app: Application) {
  await app.persistence.run(async () => {
    const accounts = [
      ['nutri@example.test', 'Dott.ssa Rossi', 'NUTRITIONIST'],
      ['patient@example.test', 'Patient Demo', 'PATIENT'],
      ['unassigned@example.test', 'Patient non associato', 'PATIENT'],
    ] as const;
    for (const [email, name, role] of accounts) {
      if (!(await app.identity.findUserByEmail(email))) await app.identity.provision(email, 'DemoNutriTrack2026!', name, role);
    }
    // La demo inizia senza associazione: invito e accettazione sono visibili.
  });
}
if (require.main === module) {
  const persistence = new PostgresPersistence();
  void seed(new Application(persistence)).then(() => console.log('Account dimostrativi pronti; nessun dato preesistente modificato.'))
    .catch(error => { console.error(error); process.exitCode = 1; }).finally(() => persistence.close());
}
