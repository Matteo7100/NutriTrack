# Tracciabilità requisiti, implementazione e verifiche
## Persistenza relazionale

La migrazione di inviti, associazioni, piani, diario e misurazioni è stata provata su uno schema PostgreSQL isolato. Le letture dell’app prima e dopo la migrazione hanno restituito gli stessi ID, riferimenti storici, contenuti ordinati, preferenze e misurazioni. I retry hanno restituito le registrazioni già presenti. `pnpm check` ha superato 79 test e `pnpm build` è riuscito. Lo smoke Edge ha verificato la demo sul database migrato, compresa la registrazione offline e la sincronizzazione al ritorno online. [ADR-035](adr/ADR-035.md)

## Profili, account e progressi

| Requisiti | Implementazione | Prove |
|---|---|---|
| FR-17/18/19 | Modulo Identity, `AccountAccess` e `PatientProfile` | `identity-http.spec.ts` per ruoli, modifica del profilo, recupero e nuova sessione. Smoke browser per registrazione e profilo. |
| FR-12/13/14/20 | Modulo Progress, `ProgressPanel` e `ProgressPhotos` | `progress.spec.ts` e smoke browser per misurazioni, foto e riconnessione. `postgres.spec.ts` include la persistenza binaria. |
| FR-21 | Navigazione per ruolo in `Workspace` | Smoke browser per sezioni paziente e nutrizionista e layout mobile. |

Verifica del 10 novembre 2026. `pnpm check` ha superato 41 test API e 34 test web. `pnpm build` è riuscito. Lo smoke Edge è passato con storage in memoria, compreso il ripristino dell’app offline e la sincronizzazione storica. La prova di recupero nel browser ha usato un trasporto email di test. Prisma ha validato lo schema e il diff SQL della migrazione. I tre test con PostgreSQL reale richiedono un database attivo e sono stati saltati in questa esecuzione.

## Refactoring del 4 novembre 2026
Nessuna feature o requisito aggiunto. La struttura è affinata con quattro GoF in più: Command/Strategy/Observer nell'offline e Abstract Factory nello storage; Facade e Adapter restano presenti. [Guida e diagrammi](DESIGN_PATTERNS.md), [spiegazione pratica](increments/refactor-patterns.md), ADR-029..032.

| Requisiti interessati | Nuova evidenza strutturale | Prova pertinente |
|---|---|---|
| FR-13/14, UC-06, NFR-07 | SyncCommand e comandi concreti; SyncEngine invoker | sync/commands.test.ts e sync/sync-engine.test.ts nel frontend |
| FR-15, BR-08/09 | RetryStrategy, RetryContext e tre politiche; ID invariato | sync/retry.test.ts, test motore e deduplicazione server già esistente |
| FR-14, NFR-07, isolamento BR-02 | Observer reali QueuePanelModel e PatientDataRefresher con account scope | sync/sync-engine.test.ts e smoke browser |
| NFR-01/02/03/05 | StorageFactory, prodotti tipizzati, adapter e UnitOfWork coerenti | factory.spec.ts backend e suite PostgreSQL |

Verifica effettiva del 4 novembre 2026: **37 test backend PASS** in 9 suite, compresi HTTP e PostgreSQL reale (TEST_DATABASE_URL impostata); **34 test frontend PASS** in 5 file; controllo tipi e build backend/frontend OK. Totale **71 test**, ossia 29 in più dei 42 precedenti. I nuovi casi verificano la coerenza di 5 repository con la propria UnitOfWork, rollback e isolamento tra factory, ripristino e incapsulamento dei Command, sostituzione delle Strategy, notifiche post-persistenza e unsubscribe degli Observer, errori degli observer e cambio account durante gli await.

Smoke browser Edge/Playwright: **PASS** dopo il refactoring. Verificati inviti/associazione, pubblicazione, privacy/sharing, registrazione offline, reload senza rete, nuova versione e sincronizzazione storica. L'asserzione aggiuntiva verifica che il pasto appaia nel diario confermato con il numero della versione precedente: dimostra il collegamento reale degli Observer in App, non solo l'invio al server. Nessun pageerror. [Screenshot aggiornato](evidence/browser-patient.png).

Nessuna dipendenza o funzione di prodotto aggiunta; nessuna migrazione o modifica al formato della coda. Prove eseguite su questo ambiente Windows/Edge/PostgreSQL 16; non sono benchmark né verifiche di tutti i browser. I conteggi e le prove riportati sotto restano la storia del 30 ottobre, non il totale aggiornato.

## Tracciabilità del completamento originario
Aggiornamento: 30 ottobre 2026. Gli identificatori della baseline non sono rinumerati. Le tabelle indicano dove si trova l'implementazione e come osservarla; l'esito effettivo delle esecuzioni è riportato separatamente in fondo.

## Punti di ingresso del codice
- **I**: [Identity](../apps/api/src/modules/identity/public/index.ts).
- **P**: [Patient Management](../apps/api/src/modules/patient-management/public/index.ts).
- **M**: [Meal Planning](../apps/api/src/modules/meal-planning/public/index.ts), [resolver](../apps/api/src/modules/meal-planning/domain/resolve-version-at.ts), [pubblicazione](../apps/api/src/modules/meal-planning/domain/publish-new-version.ts).
- **D**: [Diary](../apps/api/src/modules/diary/public/index.ts).
- **G**: [Progress](../apps/api/src/modules/progress/public/index.ts).
- **HTTP**: [controller](../apps/api/src/composition/app.controller.ts), [composition](../apps/api/src/composition/application.ts).
- **DB**: [persistence](../apps/api/src/infrastructure/persistence.ts), [schema](../apps/api/prisma/schema.prisma).
- **UI**: [frontend](../apps/web/src), coda/cache e service worker nel progetto web.
- **S**: [test servizi](../apps/api/tests/services.spec.ts); **T**: [resolver](../apps/api/tests/resolve-version-at.spec.ts) e [pubblicazione](../apps/api/tests/publish-new-version.spec.ts).

## Functional requirements
| ID | Implementazione | Verifica significativa |
|---|---|---|
| FR-01 | I.login/authenticate/logout, cookie HTTP, form UI | Credenziali valide/errate, scadenza sessione, logout |
| FR-02 | Principal da sessione, guardie di ruolo nei servizi | Patient non pubblica piani; Nutritionist non registra consumi altrui |
| FR-03 | P.list/invite/invitations/accept | Solo pazienti associati; invito accettato dal Patient; massimo un attivo |
| FR-04 | M.publish con baseVersionId=null | Prima versione, autorizzazione assegnazione, struttura valida |
| FR-05 | M.active e visualizzazione piano UI | Patient vede proprio piano o assenza esplicita |
| FR-06 | M.publish e funzione pura di pubblicazione | Nuovo ID/versione, chiusura controllata, contenuti precedenti invariati |
| FR-07 | M.history, parentVersionId e changeSet | Storico ordinabile e differenze tra contenuti |
| FR-08 | D.record, form consumo UI | Validazione e persistenza consumo reale |
| FR-09 | D.record → M.getVersionAt | Consumo precedente a nuova versione; nessun piano → null; client non sceglie ID |
| FR-10 | D.list(principal, proprio patientId), cache personale UI | Lettura del proprietario, intervallo e diario vuoto |
| FR-11 | D.list con P.isAssigned e preferenza corrente | Diniego non assegnato; DiaryNotShared; consenso attivo; revoca |
| FR-12 | G.record, form peso UI | Solo WEIGHT/KG, valore positivo e finito, data non futura |
| FR-13 | UI con shell/cache e queue IndexedDB | Primo caricamento online, disconnessione, lettura cache e inserimento locale |
| FR-14 | Riconciliazione UI → D/G.record, operationId stabile | Ritorno rete, server conferma e coda aggiornata |
| FR-15 | D/G deduplicazione e stati coda UI | Stesso ID/payload senza duplicati; ID riusato con altro payload → conflitto |
| FR-16 | D.sharing/setSharing e toggle UI online | Default false; condivisione tutto storico; revoca non cancella entry |

## Business rules
| ID | Dove è applicata | Caso di prova |
|---|---|---|
| BR-01 | P.assertAccess/isAssigned; chiamanti M/D/G | Nutritionist non assegnato riceve diniego |
| BR-02 | Controllo principal.id e ruolo in D/G/M | Patient non legge né registra dati privati altrui |
| BR-03 | M.publish + Unit of Work/lock; resolver rileva ambiguità | Due pubblicazioni dalla stessa base non producono due correnti |
| BR-04 | Copie delle versioni e nuovo contenuto | Input precedente e prescrizione storica non modificati |
| BR-05 | M.publish e nuovo ID/numero | UC-09 restituisce nuova versione |
| BR-06 | M.history e stato persistente | V1 disponibile anche dopo v2 |
| BR-07 | D.record chiama M.getVersionAt(consumptionTime) | Sync tardivo preserva versione storica |
| BR-08 | Unit of Work atomica e ricevute di idempotenza | Retry non altera entry già confermata |
| BR-09 | Dedup stesso payload, conflitto diverso payload; queue UI esplicita | Esito ripetibile, niente last-write-wins |
| BR-10 | D.setSharing/list, preferenza legata all'associazione | Disabilitare preserva diario ma blocca professionista |
| BR-11 | Confronto baseVersionId/current ID dentro transazione | Seconda sessione con base vecchia → MealPlanVersionConflict |

## Non-functional / architectural requirements
| ID | Evidenza strutturale | Controllo |
|---|---|---|
| NFR-01 | Cinque directory modulo e contratti pubblici | Revisione dipendenze e composition |
| NFR-02 | Stato/repository distinto per proprietario | Schema Prisma e wiring |
| NFR-03 | Moduli non importano Prisma o storage di altri | Ricerca import e test architetturali quando presenti |
| NFR-04 | Dipendenze tramite public/index.ts | Nessuna query cross-module o broker implicito |
| NFR-05 | Repository/clock iniettati; funzioni pure | S/T eseguibili senza UI e database |
| NFR-06 | Versioni storiche e consumo originale | T + scenario diary storico in S |
| NFR-07 | Cache/coda UI e riconciliazione server | Test helper queue e scenario browser offline |

Non sono definiti target quantitativi di carico, disponibilità o tempi di risposta. Il lock globale è un compromesso di semplicità, non un'evidenza di scalabilità.

## Use cases
| UC | Codice / percorso demo | Condizione essenziale |
|---|---|---|
| UC-01 Authenticate User | Login/logout UI → HTTP → I | Identità e ruolo da server |
| UC-02 View Active Meal Plan | Pannello piano → M.active | Solo propri dati o assegnati |
| UC-03 Record Meal Consumption | Form diario → D.record → M.getVersionAt | consumptionTime determina versione |
| UC-04 View Food Diary | Diario proprio → D.list | Proprietario non dipende da sharing |
| UC-05 Record Progress Measurement | Form peso → G.record | Timestamp e unità validi |
| UC-06 Synchronize Offline Changes | IndexedDB → retry → D/G.record | Idempotenza e conflitti espliciti |
| UC-07P Manage Diary Sharing | Preferenza → D.setSharing | Solo Patient proprietario, online |
| UC-07 Manage Patients | Invito/accettazione → P | Nessuna assegnazione unilaterale del Nutritionist |
| UC-08 Create Meal Plan | Editor → M.publish(base=null) | Nutritionist assegnato |
| UC-09 Modify Meal Plan | Editor versione → M.publish(base=current) | Copia storica e controllo concorrenza |
| UC-10 View Patient Meal History | Nutritionist seleziona paziente → D.list | Associazione e consenso attuale |
| UC-11 Monitor Patient Progress | Nutritionist → G.list | Assegnazione, indipendente da diary sharing |

## Esiti e limiti di verifica
Il 30 ottobre 2026 sono stati eseguiti realmente: `pnpm check` con TEST_DATABASE_URL del database locale e `pnpm build`. Esito: controllo tipi backend/frontend OK; 8 suite backend, 32 test PASS (inclusi HTTP e PostgreSQL reale); 2 suite frontend, 10 test PASS; build Nest/TypeScript e Vite/React OK. Migrazione iniziale applicata e seed demo eseguito. La prova PostgreSQL usa due connessioni, verifica una sola pubblicazione da base comune, deduplicazione e rollback.

Prova browser reale con Microsoft Edge headless e Playwright: PASS. Flusso verificato: due login, invito/accettazione, pubblicazione piano via form, diniego diario privato, attivazione sharing, registrazione pasti/peso offline, ricaricamento pagina senza rete con coda conservata, nuova versione pubblicata dal Nutritionist, ritorno online e conferma senza duplicati. Il pasto conserva il riferimento alla versione precedente e il Nutritionist vede il peso. Nessun errore JavaScript di pagina. [Screenshot finale](evidence/browser-patient.png). Script ripetibile in apps/web/tests/browser-smoke.cjs.

Durante la prova è stato trovato e corretto un bug del trasporto: Nest restituiva corpo vuoto per il piano assente; il controller ora emette JSON null esplicito. Test HTTP di regressione aggiunto. Altri controlli finali: calendario reale nei filtri, retry429/408, risposte asincrone obsolete dopo cambio account e import architetturali vietati.

Limiti: testato questo ambiente Windows/Edge e PostgreSQL16 locale, non tutti i browser/device né deployment pubblico o carico elevato. La persistenza JSON e il lock globale sono compromessi dichiarati. UI ispezionata visivamente sullo screenshot; nessuna certificazione di sicurezza o conformità normativa rivendicata.
Il comando browser definitivo è stato ripetuto con la dipendenza Playwright del progetto (senza PLAYWRIGHT_MODULE del runtime): PASS anche su demo già popolata, usando contenuto di prova univoco. Il test non cancella i dati precedenti. Dopo la correzione della selezione ripetuta del Patient, build frontend e 10 test Vitest sono nuovamente passati. Ultimo totale: 42 test automatici più smoke browser.

Nel [RUNBOOK.md](RUNBOOK.md) sono elencati comandi ripetibili e scenari browser. Un test unitario con fake dimostra la regola, non la corretta configurazione PostgreSQL; una build UI non dimostra il comportamento offline del browser. Le eventuali verifiche non eseguite nell'ambiente sono da dichiarare espressamente, senza marcare il requisito come assente dal codice o come verificato end-to-end.
