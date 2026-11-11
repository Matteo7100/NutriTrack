# Refactoring dei pattern — guida pratica di lettura
Data: 4 novembre 2026. Questa fase riorganizza sincronizzazione e creazione dello storage senza aggiungere funzionalità. Per teoria, classificazione dei 22 e diagrammi vedere [DESIGN_PATTERNS](../DESIGN_PATTERNS.md).

## 1. Perché leggere prima il problema
Nella versione precedente, offline.ts conteneva IndexedDB, selezione dell'endpoint, classificazione errori, batch e un booleano changed. Il codice funzionava, ma per spiegare o cambiare una responsabilità bisognava attraversare tutte le altre. Nel backend repository(key, initial) era un punto di creazione generico: il legame tra cinque repository e una UnitOfWork era implicito.

Il refactoring rende quelle responsabilità nomi e contratti distinti. Le righe in più sono un costo di chiarezza e verifica, non nuove feature. Non cambia il significato di una registrazione, il consenso o la validità delle versioni.

## 2. Primo percorso: seguire un pasto dalla coda al server
1. [sync/types.ts](../../apps/web/src/sync/types.ts): leggere Queued. È il DTO, cioè dati trasferibili e serializzabili. kind distingue diary/progress; operationId nel payload resta stabile. QueueStore e ApiClient descrivono collaboratori, non implementazioni.
2. [sync/storage.ts](../../apps/web/src/sync/storage.ts): IndexedDbQueueStore realizza lettura/scrittura coda e snapshot. Il nome dello storage e il formato persistito non cambiano. L'account limita quali elementi sono esposti al chiamante.
3. [sync/commands.ts](../../apps/web/src/sync/commands.ts): leggere l'interfaccia SyncCommand, poi execute di RecordMealCommand. Il metodo sa inviare il pasto; RecordWeightCommand invia il peso. restoreCommand legge kind e costruisce la classe adatta. Non serializza funzioni e non genera un nuovo operationId.
4. [sync/sync-engine.ts](../../apps/web/src/sync/sync-engine.ts): seguire l'invoker. Verifica sessione/account, seleziona pending pronti, ripristina il comando, esegue, aggiorna store e notifica. Se il batch appartiene a un account superato deve smettere di produrre aggiornamenti per l'account nuovo.
5. [offline.ts](../../apps/web/src/offline.ts): facciata di compatibilità. Le funzioni già usate dalla UI delegano alla nuova composizione; le vecchie API non sono una seconda implementazione parallela.

Domanda di studio: «Dove si decide la versione del piano?» Non nei comandi: execute invia consumptionTime. DiaryService sul server chiede a MealPlanning la versione valida in quell'istante.

## 3. Secondo percorso: seguire un errore e la nuova Strategy
Aprire [sync/retry.ts](../../apps/web/src/sync/retry.ts). Leggere RetryDecision e RetryStrategy prima delle classi concrete, poi RetryContext. Quest'ultima è la classe che seleziona la strategia e ricostruisce l'elemento fallito; decide riceve errore, tentativi e now, e restituisce stato, prossimo tentativo e stopBatch. Un contratto permette di trattare le politiche allo stesso modo; ogni implementazione esprime la propria regola.

Esempi deterministici:
- Errore di rete con now noto: BackoffRetryStrategy mantiene PENDING e calcola nextAttempt. Il test non aspetta davvero: confronta numeri.
- 401: WaitForLoginStrategy mantiene l'operazione ma richiede nuovo login. Il motore non insiste con una sessione scaduta.
- 409: StopRetryStrategy conserva CONFLICT. Non cambia il payload per tentare di far passare l'operazione.
- Validazione 4xx non transitoria: REJECTED, da spiegare alla persona; 408/429 restano transitori.

Vantaggio rispetto alla funzione precedente: il motore può usare una diversa politica di attesa fornita dall'esterno senza cambiare comandi o store; il test può isolare la politica. L'estrazione non rende leciti dati invalidi né sostituisce le business rule. Una Strategy è un algoritmo delegato, non uno status del record: per questo non dichiariamo anche State.

## 4. Terzo percorso: chi aggiorna la schermata?
Aprire [sync/observers.ts](../../apps/web/src/sync/observers.ts), poi cercare QueuePanelModel e PatientDataRefresher in [App.tsx](../../apps/web/src/App.tsx).
- Il motore è subject e pubblica eventi con account.
- QueuePanelModel segue la vista della coda.
- PatientDataRefresher rilegge dati confermati quando il tipo di evento lo richiede.
- App registra e rimuove le sottoscrizioni nel proprio ciclo di vita, senza raccogliere un booleano changed per decidere tutte le azioni.

Questo è il punto che prova l'uso reale di Observer: soggetto, più subscriber e collegamenti eseguiti dall'app. Una classe chiamata Observer senza consumer non basterebbe. Cleanup e account scope sono parte della correttezza, non decorazioni del diagramma.

## 5. Quarto percorso: dal server alla famiglia di storage
1. [storage-factory.ts](../../apps/api/src/infrastructure/storage-factory.ts): leggere i sei metodi. I cinque prodotti repository corrispondono ai proprietari dei dati; la UnitOfWork è il prodotto che definisce il confine atomico.
2. [persistence.ts](../../apps/api/src/infrastructure/persistence.ts): confrontare MemoryStorageFactory e PostgresStorageFactory. I prodotti di ciascuna condividono il proprio contesto, non una transazione casualmente passata da un altro adapter.
3. [repository-adapters.ts](../../apps/api/src/infrastructure/repository-adapters.ts): leggere MemoryRepository.get/save e PostgresRepository.get/save. Qui troviamo Adapter: interfaccia uguale, tecnologia diversa.
4. [Application](../../apps/api/src/composition/application.ts): leggere il costruttore. Riceve StorageFactory e chiede i prodotti per inizializzare i cinque servizi. Non sceglie tabelle o chiavi e non importa un repository altrui nel dominio.
5. [factory.spec.ts](../../apps/api/tests/factory.spec.ts): seguire composizione, isolamento e rollback della famiglia fake. Per PostgreSQL resta necessaria la suite d'integrazione con database reale.

Abstract Factory crea; Adapter traduce; UnitOfWork governa l'atomicità. Sono tre motivazioni diverse che cooperano, non tre nomi per la stessa riga.

## 6. Controlli da ripetere
Esito verificato il 4 novembre: 37 test backend (incluso PostgreSQL reale) e 34 frontend PASS; typecheck/build OK; smoke Edge offline PASS con asserzioni sul diario aggiornato dagli observer. I comandi e i limiti sono registrati nella tracciabilità. Nessuna attesa reale nei test del backoff: il clock è iniettato.
Usare `pnpm check` e `pnpm build` dal runbook. Le nuove suite verificano comandi/strategie/observer/factory e i test precedenti devono restare validi. Il totale storico del 30 ottobre era 42 test; il totale aggiornato si riporta solo dopo esecuzione effettiva in [TRACEABILITY](../TRACEABILITY.md).

Per la demo browser ripetere lo smoke offline: la coda già salvata deve essere leggibile senza migrazione o perdita di operationId; ricaricare offline e tornare online deve conservare gli esiti. La prova browser non è sostituita dai test delle classi.

## 7. Cosa dovete saper spiegare
Per ciascun pattern: problema concreto, ruoli, file, beneficio e costo. In particolare, mostrare che cambiare la Strategy modifica la politica di retry **senza** modificare il motore, ma non modifica privacy o versioning. Le decisioni sono tracciate in ADR-029..032 e nel [riepilogo](../DECISION_SUMMARY.md).
