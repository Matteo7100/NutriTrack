/**
 * Configura Jest: cerca i test del backend e traduce TypeScript con ts-jest.
 * I test vengono eseguiti in Node, senza browser o database.
 * .cjs indica un file JavaScript nel formato CommonJS.
 */
// module.exports rende questo oggetto di configurazione leggibile da Jest.
module.exports = {
  // Sceglie l'ambiente Node, anziché un ambiente che simula un browser.
  testEnvironment: 'node',
  // <rootDir> è la cartella della configurazione: apps/api.
  // Limita la ricerca a test e sorgenti, escludendo la documentazione.
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  // Ogni file che termina in .spec.ts è riconosciuto come un test.
  testMatch: ['**/*.spec.ts'],
  // La chiave è un'espressione regolare: seleziona file .ts e .tsx.
  // \\ nel testo JavaScript rappresenta un singolo backslash nella regex;
  // il punto viene quindi interpretato come un punto letterale.
  // Il valore indica il trasformatore e la configurazione TypeScript da usare.
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};
