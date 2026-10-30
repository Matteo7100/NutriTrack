/** Provisioning locale: nessun ruolo Admin o registrazione pubblica inventati. */
import 'dotenv/config';
import { Application } from './application';
import { PostgresPersistence } from '../infrastructure/persistence';
import { Role } from '../shared/contracts';
async function main() {
  const [email, name, role] = process.argv.slice(2);
  const password = process.env.ACCOUNT_PASSWORD;
  if (!email || !name || !['PATIENT', 'NUTRITIONIST'].includes(role) || !password) {
    throw new Error('Uso: ACCOUNT_PASSWORD da ambiente, account:create email nome PATIENT|NUTRITIONIST.');
  }
  const persistence = new PostgresPersistence();
  try { await persistence.run(() => new Application(persistence).identity.provision(email, password, name, role as Role)); }
  finally { await persistence.close(); }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
