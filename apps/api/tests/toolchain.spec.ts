/**
 * Prova minima dell'ambiente TypeScript/Jest.
 * Calcola 2 + 3 e verifica che il risultato sia 5.
 * Non testa ancora regole di NutriTrack: conferma che possiamo eseguire test.
 */
// describe crea un gruppo di test; il testo diventa il nome del gruppo.
// () => { ... } è una funzione senza parametri, chiamata da Jest.
describe('Ambiente TypeScript e Jest', () => {
  // it definisce un singolo caso; la funzione contiene le istruzioni del test.
  it('esegue un test scritto in TypeScript', () => {
    // const dichiara una variabile che non può essere riassegnata.
    // : number dichiara il tipo; = assegna il risultato dell'espressione 2 + 3.
    // Qui il tipo potrebbe essere inferito: lo esplicitiamo per studiarlo.
    const result: number = 2 + 3;

    // expect riceve il valore ottenuto. toBe verifica l'uguaglianza con 5.
    // Se il confronto fallisce, Jest segnala questo caso come fallito.
    expect(result).toBe(5);
    // Chiude la funzione del caso e la chiamata a it.
  });
  // Chiude la funzione del gruppo e la chiamata a describe.
});
