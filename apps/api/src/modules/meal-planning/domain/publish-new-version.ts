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

/**
 * GUIDA ALLA FUNZIONE
 * Esempio: P1 ha v2 chiusa e v3 aperta; la richiesta crea v4 partendo da v3.
 * Risultato: [v2 invariata, copia di v3 chiusa, nuova v4 aperta].
 * Prima controlliamo gli input; solo dopo costruiamo il risultato.
 * throw interrompe l'operazione: se un controllo fallisce non si arriva al return.
 * Nessun oggetto ricevuto viene modificato o salvato in questa funzione.
 */
// export permette di importare la funzione da altri file; function la dichiara.
export function publishNewVersion(
  // Primo parametro: elenco dei periodi temporali forniti dal chiamante.
  // ReadonlyArray<T> ammette elementi di tipo T, ma vieta push/splice sull'array.
  // I campi del nostro tipo sono readonly: protezione TypeScript, non freeze runtime.
  versions: ReadonlyArray<MealPlanVersionPeriod>,
  // Secondo parametro: oggetto contenente Patient, base, nuovo ID e attivazione.
  request: PublishVersionRequest,
  // Dopo i parametri, : PublishVersionResult indica il tipo dell'oggetto restituito.
): PublishVersionResult {
  // 1. ESTRAZIONE DELLA RICHIESTA
  // Destrutturazione: equivale a const patientId = request.patientId, ecc.
  // const impedisce di riassegnare queste variabili; non modifica request.
  const { patientId, baseVersionId, newVersionId, activationTime } = request;

  // 2. VALIDAZIONE DELL'ISTANTE
  // Number.isFinite restituisce false per NaN, Infinity e -Infinity.
  // ! nega il risultato: entriamo nell'if quando il numero non è finito.
  // Non è un confronto con l'ora attuale: il timestamp del server arriva dall'esterno.
  if (!Number.isFinite(activationTime)) {
    // RangeError distingue l'input numerico inutilizzabile dal conflitto di versione.
    throw new RangeError('activationTime deve essere un istante finito.');
  }

  // 3. UNICITÀ DELL'ID NEI DATI RICEVUTI
  // some restituisce true appena un elemento soddisfa la funzione passata.
  // (version) => ... è una funzione freccia: riceve un elemento e valuta il confronto.
  // === confronta senza conversioni implicite, per esempio senza convertire stringhe.
  // Qui controlliamo anche gli altri Patient, ma soltanto nella lista ricevuta:
  // l'unicità nell'intero archivio richiederà un vincolo della persistenza.
  if (versions.some((version) => version.id === newVersionId)) {
    // I backtick creano una stringa con interpolazione: ${...} inserisce il valore.
    throw new MealPlanTimelineError(`Identificativo ${newVersionId} già usato.`);
  }

  // 4. SELEZIONE DELLO STORICO DEL PATIENT
  // filter crea un nuovo array con gli elementi che rendono vera la condizione.
  // versions rimane intatto; gli oggetti selezionati sono gli stessi, non copie.
  // Questo filtro non autorizza il Nutritionist: quel controllo sarà nell'application.
  const patientVersions = versions.filter((version) => version.patientId === patientId);

  // let permette di riassegnare current mentre cerchiamo la versione aperta.
  // T | null significa che la variabile può contenere una versione oppure null.
  // null iniziale: nessuna versione corrente trovata finora.
  let current: MealPlanVersionPeriod | null = null;

  // 5. CONTROLLO DEGLI INTERVALLI E RICERCA DELLA VERSIONE CORRENTE
  // for...of visita gli elementi; version è il riferimento all'elemento del giro.
  for (const version of patientVersions) {
    // La nuova attivazione deve essere strettamente successiva a ogni inizio.
    // !(inizio < attivazione) diventa true se attivazione è prima o uguale all'inizio.
    // Esempio: chiudere v3 esattamente quando inizia creerebbe un intervallo vuoto.
    // Anche un inizio NaN viene respinto: il confronto è false e !false è true.
    // Questo controllo non sostituisce la validazione completa della timeline.
    const activationNotAfterStart = !(version.validFrom < activationTime);

    // Per una versione già chiusa, attivazione deve essere >= alla sua fine.
    // && richiede entrambe le condizioni; se la fine è null non valuta la seconda.
    // Per numeri validi !(fine <= attivazione) significa fine > attivazione.
    // In tal caso la nuova attivazione cadrebbe prima della fine di uno storico chiuso.
    // La versione aperta non ha una fine da controllare: gliela assegneremo più avanti.
    const activationBeforeEnd = version.validUntil !== null && !(version.validUntil <= activationTime);

    // || significa almeno una condizione vera: uno dei due problemi basta a fermarci.
    // ADR-023: non riscrivere intervalli storici tramite un'attivazione retroattiva.
    if (activationNotAfterStart || activationBeforeEnd) {
      throw new MealPlanTimelineError(
        `Attivazione non successiva all'intervallo di ${version.id}.`,
      );
    }

    // Nel modello senza pianificazione futura, fine null identifica la corrente.
    if (version.validUntil === null) {
      // Se current è già valorizzata, questa è una seconda versione aperta: BR-03.
      // È un errore dei dati, non una base obsoleta dichiarata dal chiamante.
      if (current !== null) {
        throw new MealPlanTimelineError('Più versioni aperte per lo stesso Patient.');
      }
      // Conserviamo lo stesso oggetto trovato nel ciclo: nessuna modifica o copia qui.
      current = version;
    }
  }

  // 6. CONTROLLO DELLA BASE (CONCORRENZA OTTIMISTICA)
  // ?. legge id solo se current esiste; se è null produce undefined.
  // ?? usa null quando il risultato a sinistra è null o undefined.
  // Quindi: current=v3 -> 'v3'; current=null -> null.
  const currentVersionId = current?.id ?? null;

  // !== confronta la base caricata dal Nutritionist con la corrente ricevuta.
  // Base v3/corrente v3: procediamo. Base v3/corrente v4: occorre ricaricare (BR-11).
  // Creazione iniziale: base null/corrente null è ammessa;
  // base null/corrente v3 è conflitto, perché un piano esiste già.
  if (baseVersionId !== currentVersionId) {
    // Passiamo entrambi gli ID al costruttore: saranno leggibili nell'errore.
    throw new MealPlanVersionConflict(baseVersionId, currentVersionId);
  }

  // 7. CHIUSURA TRAMITE COPIA
  // Operatore ternario: condizione ? valoreSeVera : valoreSeFalsa.
  // Nessuna corrente -> null; corrente presente -> nuovo oggetto con fine fissata.
  // {...current} copia i campi; validUntil scritto dopo sostituisce quello copiato.
  // È una copia superficiale: qui i campi sono primitivi. Futuri campi annidati
  // richiederanno una progettazione dell'immutabilità dei contenuti.
  // current originale conserva fine null: niente modifica in place (BR-04/06).
  const closedVersion: MealPlanVersionPeriod | null =
    current === null ? null : { ...current, validUntil: activationTime };

  // 8. CREAZIONE DEL NUOVO PERIODO
  // Costruiamo un oggetto conforme all'interface MealPlanVersionPeriod.
  // Non contiene ancora pasti, parentVersionId o ChangeSet: solo identità e validità.
  const newVersion: MealPlanVersionPeriod = {
    id: newVersionId,
    // Abbreviazione: patientId equivale a patientId: patientId.
    patientId,
    // Inizio nuova = fine precedente. L'estremo finale è escluso: nessun overlap.
    validFrom: activationTime,
    // null lascia aperta la validità, fino a una successiva pubblicazione.
    validUntil: null,
  };

  // 9. COMPOSIZIONE DELLA TIMELINE
  // Per gli oggetti !== confronta l'identità, non il contenuto dei campi.
  // current è il riferimento trovato nel ciclo, quindi escludiamo proprio quello.
  // Le altre versioni conservano gli stessi oggetti; filter non li clona.
  const unchanged = patientVersions.filter((version) => version !== current);

  // Spread di array [...unchanged, ...] crea un nuovo array con elementi aggiunti.
  // Prima versione: nessuna chiusura, aggiungiamo solo newVersion.
  // Aggiornamento: aggiungiamo la copia chiusa e poi newVersion.
  // Esempio: [v2, v3] diventa [v2, copia chiusa di v3, nuova v4].
  // L'array non include altri Patient e non è necessariamente ordinato per tempo.
  const updated =
    closedVersion === null ? [...unchanged, newVersion] : [...unchanged, closedVersion, newVersion];

  // 10. RISULTATO AL CHIAMANTE
  // I primi due campi sono abbreviati; versions: updated dà un nome diverso al campo.
  // Equivale a {closedVersion: closedVersion, newVersion: newVersion, versions: updated}.
  // Non elimina né salva dati: il chiamante riceve il risultato da persistere.
  // Richieste simultanee richiederanno comunque transazione/vincoli nel repository.
  return { closedVersion, newVersion, versions: updated };
}
