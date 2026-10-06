/**
 * Pubblica una nuova versione del piano di un Patient a partire dalla versione corrente.
 * Regole applicate: BR-04/05/06/11, UC-09, ADR-021 (intervalli [from,until)) e
 * ADR-023 (attivazione immediata, nessuna retrodatazione).
 *
 * Cosa fa, in breve:
 * - verifica che il chiamante sia partito dalla versione oggi corrente (baseVersionId);
 * - chiude la versione corrente con validUntil = activationTime;
 * - apre la nuova versione con validFrom = activationTime e validUntil = null.
 * Le due operazioni usano lo stesso istante: non restano buchi né sovrapposizioni.
 *
 * È una funzione pura, come resolveVersionAt: non legge database né orologio e
 * non modifica gli oggetti ricevuti. Restituisce nuovi oggetti che il futuro
 * repository dovrà salvare. L'istante di attivazione lo fornirà il server.
 *
 * Limite consapevole: questa funzione rileva una base obsoleta nei dati ricevuti.
 * Due richieste davvero simultanee potrebbero leggere entrambe v3 prima che una
 * delle due salvi: proteggere quel caso spetta alla transazione PostgreSQL (fase 6).
 */
import { MealPlanVersionPeriod } from './meal-plan-version-period';
import { MealPlanTimelineError } from './resolve-version-at';

/**
 * BR-11: la nuova versione deve partire dalla versione attiva.
 * Non è un errore dei dati: un'altra sessione ha già pubblicato. L'interfaccia
 * dovrà chiedere di ricaricare il piano; nessuna fusione automatica (ADR-021).
 */
export class MealPlanVersionConflict extends Error {
  // "readonly" nei parametri del costruttore crea e assegna automaticamente due
  // proprietà dell'oggetto (parameter properties di TypeScript): chi intercetta
  // l'errore può leggere err.baseVersionId e err.currentVersionId.
  constructor(
    readonly baseVersionId: string | null,
    readonly currentVersionId: string | null,
  ) {
    // ?? sostituisce il valore di sinistra solo se è null o undefined.
    super(
      `Base ${baseVersionId ?? 'nessuna'} non più attuale: ` +
        `versione corrente ${currentVersionId ?? 'nessuna'}.`,
    );
    this.name = 'MealPlanVersionConflict';
  }
}

// Dati della richiesta di pubblicazione, raccolti in un unico oggetto.
export interface PublishVersionRequest {
  readonly patientId: string;
  // Versione da cui il Nutritionist è partito. null = "credo che non esista
  // ancora un piano": è il caso della creazione iniziale (UC-08, v1).
  readonly baseVersionId: string | null;
  // In questa fase l'identificativo arriva dall'esterno (nei test lo scegliamo
  // noi); in futuro lo genererà l'application layer.
  readonly newVersionId: string;
  // Istante del server, in millisecondi UTC. Non lo sceglie il client.
  readonly activationTime: number;
}

export interface PublishVersionResult {
  // Copia della versione precedente con la fine fissata; null alla creazione iniziale.
  readonly closedVersion: MealPlanVersionPeriod | null;
  readonly newVersion: MealPlanVersionPeriod;
  // Timeline aggiornata del solo Patient richiesto, comodamente riutilizzabile
  // con resolveVersionAt.
  readonly versions: ReadonlyArray<MealPlanVersionPeriod>;
}

export function publishNewVersion(
  versions: ReadonlyArray<MealPlanVersionPeriod>,
  request: PublishVersionRequest,
): PublishVersionResult {
  // Destrutturazione: crea quattro costanti con i campi omonimi di request.
  const { patientId, baseVersionId, newVersionId, activationTime } = request;

  if (!Number.isFinite(activationTime)) {
    throw new RangeError('activationTime deve essere un istante finito.');
  }

  // some restituisce true se almeno un elemento soddisfa la condizione.
  // Controlliamo tutte le versioni, anche di altri Patient: un id è unico ovunque.
  if (versions.some((version) => version.id === newVersionId)) {
    throw new MealPlanTimelineError(`Identificativo ${newVersionId} già usato.`);
  }

  // filter crea un nuovo array con i soli elementi che soddisfano la condizione.
  const patientVersions = versions.filter((version) => version.patientId === patientId);

  let current: MealPlanVersionPeriod | null = null;

  for (const version of patientVersions) {
    // ADR-023: l'attivazione non può cadere prima o dentro un intervallo già
    // esistente, altrimenti riscriverebbe una storia già usata dal diario.
    // Scriviamo !(a < b) invece di a >= b: con NaN ogni confronto è false,
    // quindi anche un dato salvato non valido viene respinto.
    const activationNotAfterStart = !(version.validFrom < activationTime);
    const activationBeforeEnd = version.validUntil !== null && !(version.validUntil <= activationTime);
    if (activationNotAfterStart || activationBeforeEnd) {
      throw new MealPlanTimelineError(
        `Attivazione non successiva all'intervallo di ${version.id}.`,
      );
    }

    // La versione corrente è quella con fine aperta. Con attivazione immediata
    // e senza programmazione futura, ne può esistere al massimo una (BR-03).
    if (version.validUntil === null) {
      if (current !== null) {
        throw new MealPlanTimelineError('Più versioni aperte per lo stesso Patient.');
      }
      current = version;
    }
  }

  // ?. legge id solo se current non è null; ?? converte undefined in null.
  const currentVersionId = current?.id ?? null;

  // BR-11: confronto tra la base dichiarata e quella effettiva.
  // Vale anche alla creazione: base null con un piano già aperto è un conflitto.
  if (baseVersionId !== currentVersionId) {
    throw new MealPlanVersionConflict(baseVersionId, currentVersionId);
  }

  // Spread {...current}: copia tutti i campi, poi sovrascrive solo validUntil.
  // L'oggetto originale resta intatto (BR-04/06: niente modifica in place).
  const closedVersion: MealPlanVersionPeriod | null =
    current === null ? null : { ...current, validUntil: activationTime };

  const newVersion: MealPlanVersionPeriod = {
    id: newVersionId,
    patientId,
    validFrom: activationTime,
    validUntil: null,
  };

  // Le versioni già chiuse sono riportate così come sono, stessi oggetti.
  const unchanged = patientVersions.filter((version) => version !== current);
  const updated =
    closedVersion === null ? [...unchanged, newVersion] : [...unchanged, closedVersion, newVersion];

  return { closedVersion, newVersion, versions: updated };
}
