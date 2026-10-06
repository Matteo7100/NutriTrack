/**
 * Trova la versione di un Patient valida all'istante richiesto.
 * Regola: validFrom <= istante < validUntil; fine null = intervallo aperto.
 * È una funzione pura: non legge database, non usa l'ora corrente e non modifica dati.
 * Restituisce null se nessun piano è applicabile. Dati ambigui producono un errore,
 * anziché scegliere arbitrariamente una versione e compromettere lo storico.
 */
import { MealPlanVersionPeriod } from './meal-plan-version-period';

// Errore di consistenza distinto dall'assenza legittima di un piano.
export class MealPlanTimelineError extends Error {
  constructor(message: string) {
    super(message); // Inizializza il messaggio nella classe Error di JavaScript.
    this.name = 'MealPlanTimelineError';
  }
}

export function resolveVersionAt(
  // ReadonlyArray consente lettura/iterazione, ma non push o modifica degli elementi.
  versions: ReadonlyArray<MealPlanVersionPeriod>,
  patientId: string,
  consumptionTime: number,
): MealPlanVersionPeriod | null {
  // NaN e Infinity sono numeri JavaScript, ma non rappresentano istanti utilizzabili.
  if (!Number.isFinite(consumptionTime)) {
    throw new RangeError('consumptionTime deve essere un istante finito.');
  }

  // let serve perché aggiorniamo il candidato trovato durante il ciclo.
  let match: MealPlanVersionPeriod | null = null;

  for (const version of versions) {
    // La ricerca riguarda esclusivamente il Patient richiesto.
    if (version.patientId !== patientId) continue;

    // Controlliamo gli intervalli ricevuti: durata positiva e istanti finiti.
    if (
      !Number.isFinite(version.validFrom) ||
      (version.validUntil !== null &&
        (!Number.isFinite(version.validUntil) || version.validUntil <= version.validFrom))
    ) {
      throw new MealPlanTimelineError(`Intervallo non valido per ${version.id}.`);
    }

    // && richiede entrambe le condizioni; || consente la fine aperta oppure futura.
    const isValid = version.validFrom <= consumptionTime &&
      (version.validUntil === null || consumptionTime < version.validUntil);

    if (!isValid) continue;

    // BR-03: due risultati allo stesso istante sono una violazione, non una scelta.
    if (match !== null) {
      throw new MealPlanTimelineError('Più versioni valide per Patient e istante.');
    }
    match = version;
  }

  return match; // Resta null se nessun intervallo comprende consumptionTime.
}
