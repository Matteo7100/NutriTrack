/**
 * Descrive solo l'identità e la validità temporale di una versione del piano.
 * Non è ancora il modello completo: pasti, contenuti e ChangeSet arriveranno dopo.
 * Gli istanti sono numeri: millisecondi dal 1 gennaio 1970 UTC (Unix epoch).
 * Questo evita di conservare oggetti Date modificabili nel modello temporale.
 *
 * COME SCRIVERE DATA E ORA IN TYPESCRIPT
 * Una rappresentazione leggibile è la stringa ISO 8601:
 * '2026-10-05T14:30:00Z'
 * 2026-10-05 = anno-mese-giorno; T separa data e ora;
 * 14:30:00 = ore:minuti:secondi; Z indica UTC, non l'ora locale italiana.
 * Si possono indicare millisecondi: '2026-10-05T14:30:00.123Z'.
 * Oppure un offset esplicito: '2026-10-05T16:30:00+02:00'
 * rappresenta lo stesso istante di '2026-10-05T14:30:00Z'.
 *
 * I campi di questa interface sono number, quindi non ricevono la stringa:
 * const activationTime: number = Date.parse('2026-10-05T14:30:00Z');
 * const period: MealPlanVersionPeriod = {
 *   id: 'v1', patientId: 'P1',
 *   validFrom: activationTime, validUntil: null,
 * };
 * Date.parse converte la stringa in millisecondi dall'epoch UTC.
 * Per renderli leggibili: new Date(activationTime).toISOString().
 * Una stringa non valida può produrre NaN: il resolver respinge numeri non finiti.
 * Al confine API servirà anche validazione del formato con offset esplicito.
 *
 * CREAZIONE E VALIDITÀ SONO CONCETTI DISTINTI
 * createdAt = momento in cui il sistema crea/registra la versione.
 * validFrom = momento da cui la prescrizione è applicabile.
 * Questo modello temporale minimo contiene validFrom, non ancora createdAt.
 * Nella prima versione del progetto l'attivazione è immediata: il backend
 * assegnerà il tempo server, per esempio Date.now(), alla pubblicazione.
 * Date.now() restituisce già un number; non inseriamo questa chiamata nel
 * resolver, perché deve cercare rispetto all'istante ricevuto come parametro.
 */
export interface MealPlanVersionPeriod {
  // export permette di importare il tipo; interface descrive la forma dei dati.
  // readonly impedisce assegnazioni a questi campi nel codice TypeScript;
  // non congela automaticamente l'oggetto a runtime.
  readonly id: string;
  readonly patientId: string;
  readonly validFrom: number;
  // null significa che non è ancora stata fissata una fine della validità.
  // L'unione number | null ammette esplicitamente entrambe le possibilità.
  readonly validUntil: number | null;
}
