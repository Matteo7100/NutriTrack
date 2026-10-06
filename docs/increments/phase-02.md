# Fase 2 — Nuova versione dalla base corrente
Completata il 2026-10-06. Una regola di dominio, senza database o server.

## Obiettivo e risultato
Pubblicare una nuova versione del piano partendo dalla versione attiva, applicando BR-04/05/06/11, UC-08/09, ADR-021 e ADR-023. Esempio: v3 aperta dal 1 ottobre; alle 14:00 UTC del 5 ottobre il Nutritionist pubblica v4 partendo da v3. Risultato: v3 termina alle 14:00, v4 inizia alle 14:00 con fine aperta, v2 resta identica. Se un'altra sessione aveva già pubblicato v4 e B prova a partire ancora da v3, si ottiene MealPlanVersionConflict con base v3 e versione corrente v4.

## Concetti nuovi
- Base version: la versione da cui il Nutritionist è partito quando ha caricato il piano. Il server la confronta con quella attuale (controllo di concorrenza ottimistico: si lascia lavorare e si verifica al momento della pubblicazione).
- Conflitto e errore dei dati sono distinti: MealPlanVersionConflict significa "qualcuno ha pubblicato prima di te, ricarica"; MealPlanTimelineError significa "la timeline ricevuta è incoerente".
- Creazione iniziale: è la stessa operazione con baseVersionId null ("non esiste ancora un piano"). Così ADR-021 vale anche per v1: due creazioni contemporanee non producono due piani aperti.

## Ordine di lettura
1. apps/api/src/modules/meal-planning/domain/publish-new-version.ts: righe 28-43 l'errore di conflitto; 46-64 la forma di richiesta e risultato; 67 la funzione.
2. Dentro la funzione: riga 80 id già usato; righe 89-110 controllo della timeline e ricerca della versione aperta; riga 117 confronto base/corrente; riga 123 chiusura tramite copia; riga 134 composizione della timeline aggiornata.
3. apps/api/tests/publish-new-version.spec.ts: otto casi, a partire da riga 40. Il caso delle due sessioni è a riga 62.

## Algoritmo passo per passo
- Respinge activationTime non finito (RangeError) e un newVersionId già esistente.
- Considera solo le versioni del Patient richiesto.
- Per ogni versione verifica che l'attivazione sia successiva al suo inizio e non anteriore alla sua fine: niente retrodatazione (ADR-023), quindi lo storico già usato dal diario non cambia.
- Cerca la versione con validUntil null: è quella corrente. Due versioni aperte sono dati incoerenti.
- Se baseVersionId è diverso dall'id corrente (null compreso) solleva MealPlanVersionConflict.
- Crea una copia della corrente con validUntil = activationTime e la nuova versione con validFrom = activationTime.
- Restituisce versione chiusa, nuova versione e timeline aggiornata del Patient. Gli input non vengono modificati.

## Simboli incontrati
- Destrutturazione `const { a, b } = request`: crea costanti con i campi omonimi.
- Spread di oggetto `{ ...current, validUntil: t }`: copia i campi e sovrascrive solo quello indicato. Spread di array `[...a, x]`: nuovo array con gli elementi di a più x.
- `some` / `filter` / `find`: metodi degli array; ricevono una funzione freccia che dice quale elemento cercare.
- `??`: usa il valore di destra solo se quello di sinistra è null o undefined.
- `readonly` nei parametri del costruttore: dichiara e assegna in un colpo una proprietà dell'oggetto.
- `!(a < b)` invece di `a >= b`: con NaN ogni confronto è false, quindi la forma negata respinge anche dati numerici non validi.
- Nei test: `toEqual` confronta contenuti, `toBe` l'identità dello stesso oggetto, `toMatchObject` solo i campi indicati; `unknown` è il tipo di un valore da verificare prima dell'uso. `60_000` è 60000: il trattino basso serve solo alla leggibilità.

## Eseguire e studiare
Dalla cartella principale: `pnpm check` (su Windows `pnpm.cmd check`). Risultato verificato: typecheck OK, 3 suite e 17 test PASS (8 nuovi casi).
Solo questa suite: `pnpm --dir apps/api test -- publish-new-version`.
Esercizi facoltativi, da ripristinare dopo la prova:
- A riga 117 sostituire la condizione con `false`: falliscono i due test di conflitto (verificato).
- A riga 94 cambiare `<` in `<=`: fallisce il test sulle attivazioni retroattive, perché v3 resterebbe con intervallo vuoto (verificato).

## Confini del lavoro
MealPlanVersionPeriod contiene ancora solo id e intervallo: pasti, parentVersionId e ChangeSet non sono modellati. L'immutabilità verificata qui è quella degli oggetti ricevuti e delle versioni chiuse; quella dei contenuti nutrizionali arriverà con il modello completo.
La funzione rileva la base obsoleta nei dati che riceve. Due richieste davvero simultanee potrebbero leggere entrambe v3: il caso va protetto da transazione e vincoli PostgreSQL nella fase 6, come previsto da ADR-021.
Nessun controllo di autorizzazione (Nutritionist assegnato): appartiene all'application layer. Nessun mapping HTTP dell'errore.
Nessuna nuova decisione architetturale: non servono ADR.

## Prossimo incremento
Fase 2b facoltativa: parentVersionId e ChangeSet tra contenuti. Altrimenti fase 3: Diary con repository fake e contratto MealPlanning. Non iniziato in questa fase.
