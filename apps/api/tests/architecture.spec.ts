/**
 * Fitness function architetturale: impedisce dipendenze vietate tra moduli.
 * I servizi possono importare solo la public facade del modulo destinatario.
 * L'uso di Prisma resta infrastrutturale, non entra nei cinque domini.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const base = resolve(__dirname, '../src/modules');
const allowed: Record<string, string[]> = {
  identity: [], 'patient-management': ['identity'], 'meal-planning': ['patient-management'],
  diary: ['patient-management', 'meal-planning'], progress: ['patient-management'],
};
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
}

it('rispetta ownership, public contracts e direzione delle dipendenze', () => {
  for (const file of files(base)) {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/from\s+['"]@prisma/);
    const owner = relative(base, file).split(sep)[0];
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const destination = resolve(file, '..', match[1]);
      const modulePath = relative(base, destination).split(sep);
      if (modulePath[0] === '..') {
        // Un import relativo fuori dai moduli può raggiungere solo i contratti
        // tecnici condivisi, mai composition root o persistenza concreta.
        const shared = resolve(base, '../shared');
        expect(destination.startsWith(shared + sep)).toBe(true);
        continue;
      }
      if (modulePath[0] === owner) continue;
      expect(allowed[owner]).toContain(modulePath[0]);
      expect(modulePath[1]).toBe('public');
    }
  }
});
