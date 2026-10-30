# Riepilogo delle scelte di NutriTrack
pnpm verifyDepsBeforeRun=false nei due progetti: l'installazione è un passo esplicito (`install:all` con lockfile), non un effetto nascosto di test/start. Scelta verificata per evitare reinstallazioni implicite con store diverso nell'ambiente Windows; dipendenze e lockfile restano obbligatori.
Playwright1.62.1 aggiunto come strumento di sviluppo per rendere ripetibile lo smoke browser con Edge, senza dipendenza dai tool interni di Codex. In precedenza la prova è stata eseguita con la medesima versione fornita dal runtime. La prova scrive solo dati dimostrativi locali e non cancella registrazioni. Bug osservato in prova: null del piano serializzato esplicitamente JSON per rispettare il contratto.
## Dettagli implementativi del completamento
Le seguenti scelte tecniche non aggiungono funzionalità di prodotto:
- Account CLI e seed idempotente; nessun invito email reale (l'invito è visibile nell'app), nessun recupero password o registrazione pubblica.
- Sessioni di 8 ore, scrypt con salt casuale, cookie HttpOnly/SameSite Strict, Secure in produzione; token CSRF separato e nessun CORS aperto. Limite locale 30 richieste login/minuto/IP, non protezione distribuita.
- Validazione input con whitelist dei campi HTTP. Piani: 1..14 pasti, 1..10 alternative per pasto, 1..30 alimenti per alternativa; nomi pasto max100 caratteri, alimento200, unità30; quantità positiva finita. Limiti tecnici anti-input eccessivo, non prescrizioni nutrizionali.
- Consumo testuale max4000 caratteri; operationId da8 a100 caratteri alfanumerici, underscore o trattino; peso positivo finito WEIGHT/KG. Timestamp ISO con offset, calendario reale e niente date future per nuove registrazioni.
- Date di validità in millisecondi UTC; finestre di lettura [from,to); stesso millisecondo di pubblicazione -> PublicationBusy, non retrodatazione. Una timeline senza piano non impedisce il diario.
- Nessuna transazione distribuita: UnitOfWork avvolge anche autenticazione e verifiche. Advisory lock comune prima del primo read in ReadCommitted. MemoryPersistence solo test, mai fallback del server.
- Pubblicazione salva snapshot completo e diff strutturale path/before/after; la UI traduce le differenze per la lettura. Nessun event bus senza consumer richiesto; API interne soddisfano NFR-04.
- Browser: nessuna password/sessione salvata in cache; cache Patient per account, solo shell nel service worker, dati Nutritionist non persistiti offline. Pending distinto da assenza piano confermata. Retry con attesa crescente fino a60s; 401 attende nuovo login, conflitti/validazione restano visibili senza sovrascrittura.
- Versioni dipendenze fissate nei lockfile; Prisma client generato; script build autorizzati soltanto per i componenti necessari (Prisma/esbuild), non per tutte le dipendenze.
- Backend ascolta sul loopback3000; PostgreSQL loopback15432; Vite solo per sviluppo. Container e volume locali, nessun deployment remoto.

Provenienza di PostgreSQL, licenze e assenza di servizi a pagamento: [infrastruttura e costi](INFRASTRUCTURE_AND_COSTS.md). Porta PostgreSQL locale definitiva: 15432; 54329 non disponibile su questo PC. Runtime locale pnpm 11.25.0 compatibile con il formato del lockfile; il manifest dichiara la versione originaria 11.19.0.
Documento centrale da aggiornare insieme al codice. Stato aggiornato al 30 ottobre 2026. Le ADR conservano contesto, motivazioni e conseguenze; questo file permette di ritrovare ogni scelta senza rileggere tutta la conversazione.

## Perimetro vincolante
La fonte funzionale è [requirements.md](requirements.md), con FR-01..16, BR-01..11 e NFR-01..07; gli obiettivi degli attori sono in [use-cases.md](use-cases.md). Le decisioni successive precisano quel perimetro, senza aggiungere funzionalità di prodotto.

La versione iniziale comprende Patient e Nutritionist, associazione con accettazione del Patient, piani versionati, diario con privacy opzionale, peso storico, consultazione e inserimenti offline supportati con sincronizzazione. Sono esclusi Admin, pagamenti, videochiamate, AI, riconoscimento immagini, social, chat, wearable, spesa automatica e inventario. Modifica/cancellazione di pasti e misurazioni e programmazione/retrodatazione dei piani restano rinviate come già concordato. Il cambio di professionista richiede un nuovo consenso alla condivisione; non significa introdurre un nuovo sistema universale di permessi.

## Registro sintetico di tutte le decisioni
| ADR | Scelta | Motivazione pratica |
|---|---|---|
| [001](adr/ADR-001.md) | Decomposizione per responsabilità di business | Non derivare l'architettura da schermate o tabelle CRUD. |
| [002](adr/ADR-002.md) | Versioni con intervalli temporali | Ricostruire la prescrizione storica. |
| [003](adr/ADR-003.md) | Diario associato alla versione al consumo | Creazione e sincronizzazione possono avvenire dopo. |
| [004](adr/ADR-004.md) | Entry ammesse senza piano | Consumo reale indipendente dalla prescrizione. |
| [005](adr/ADR-005.md) | Privacy controllata dal Patient | Condivisione revocabile senza cancellare il diario. |
| [006](adr/ADR-006.md) | Contenuti delle versioni immutabili | Nessuna riscrittura della storia. |
| [007](adr/ADR-007.md) | Risoluzione tramite consumptionTime | Correttezza retroattiva e offline. |
| [008](adr/ADR-008.md) | Prescritto separato da consumato | Il comportamento non modifica il piano. |
| [009](adr/ADR-009.md) | Measurements con timestamp | Non sovrascrivere il peso nel profilo. |
| [010](adr/ADR-010.md) | Modular monolith | Un backend, senza infrastruttura distribuita superflua. |
| [011](adr/ADR-011.md) | Ownership esclusiva dei dati | Solo il proprietario governa la persistenza. |
| [012](adr/ADR-012.md) | Riferimenti cross-module tramite ID | Collegare entità senza condividerne i repository. |
| [013](adr/ADR-013.md) | API per risposta, eventi per fatti | Usare il meccanismo adeguato alla dipendenza reale. |
| [014](adr/ADR-014.md) | Sync come infrastruttura | Non creare un dominio nutrizionale artificiale. |
| [015](adr/ADR-015.md) | Contratti di modulo espliciti | Nascondere implementazioni e storage. |
| [016](adr/ADR-016.md) | Versione dell'entry scelta dal server | Il client non può manipolare l'associazione storica. |
| [017](adr/ADR-017.md) | Errori semanticamente distinti | Distinguere diniego, assenza, validazione e conflitto. |
| [018](adr/ADR-018.md) | Repository abstraction | Logica testabile senza database reale. |
| [019](adr/ADR-019.md) | Misurazioni visibili al professionista assegnato | Il consenso opzionale riguarda specificamente il diario. |
| [020](adr/ADR-020.md) | React/Vite/TypeScript, NestJS, PostgreSQL, IndexedDB | Linguaggio applicativo comune e strumenti coerenti con la modularità. |
| [021](adr/ADR-021.md) | UTC, intervalli semiaperti, transazioni, idempotenza | Confini temporali chiari e retry sicuri. |
| [022](adr/ADR-022.md) | Diario privato di default, 0..1 Nutritionist, offline limitato | Controllo esplicito e scope comprensibile. |
| [023](adr/ADR-023.md) | Peso in kg, attivazione immediata, correzioni rinviate | Contenere scope e preservare storia. |
| [024](adr/ADR-024.md) | Sessioni server, Prisma, Jest/Vitest | Completare lo stack senza provider cloud aggiuntivo. |
| [025](adr/ADR-025.md) | Stato persistente separato per modulo e Unit of Work | Atomicità coordinata e ownership verificabile nel progetto d'esame. |
| [026](adr/ADR-026.md) | Account predisposti da CLI, sessioni 8 ore, CSRF | Autenticazione concreta senza registrazione pubblica non richiesta. |
| [027](adr/ADR-027.md) | Cache personale e coda IndexedDB, shell offline | Garantire offline senza memorizzare dati dei pazienti sul client Nutritionist. |
| [028](adr/ADR-028.md) | Completamento integrato richiesto il 30 ottobre | Superare la precedente pausa tra incrementi mantenendo documentazione studiabile. |

## Decisioni implementative da spiegare all'esame
- I public entry point dei moduli espongono servizi e tipi; non espongono Prisma. Il tipo Repository appartiene al contratto tecnico, l'adapter è infrastrutturale.
- La persistenza utilizza un modello Prisma distinto per modulo, con stato JSON. Non è una singola collection liberamente accessibile a tutti i servizi: ogni repository è assegnato al proprietario nella composition root. Scelta deliberatamente semplice, con costo di caricamento e riscrittura dell'aggregato documentato.
- Una Unit of Work apre la transazione e serializza le operazioni con un advisory lock PostgreSQL. La protezione è ampia: limita throughput ma rende consistenti versione corrente, privacy e deduplicazione. Non presentarla come architettura scalabile per milioni di utenti.
- Il clock è iniettato: i test scelgono l'istante, il server reale usa il proprio orologio. Il client non fornisce l'attivazione del piano.
- Due pubblicazioni nello stesso millisecondo non producono una data artificiale: se l'attivazione non sarebbe successiva all'inizio corrente si segnala PublicationBusy (409), da ritentare dopo che il clock server è avanzato.
- L'identificatore operationId è stabile durante i retry. Stesso ID e payload restituiscono lo stesso esito; payload diverso con stesso ID produce conflitto. Nessun last-write-wins sui dati confermati.
- Un riferimento locale UNRESOLVED non è lo stesso di un'entry confermata con mealPlanVersionId nullo. Solo il server risolve definitivamente la versione storica.
- I controlli autoritativi sono server-side. Il principal ricevuto da sessione determina ruolo e identità; un patientId dal browser non prova autorizzazione.
- Il progetto usa le API sincrone interne previste da ADR-013. La possibilità di eventi rimane un'opzione architetturale; non è necessario inventare consumer, notifiche o broker per dichiararla attuata.
- Per i test si usa una persistenza fake con lo stesso contratto. Il server operativo non ripiega silenziosamente su memoria se PostgreSQL non è disponibile.

## Stato delle verifiche
Le prove e i loro limiti sono registrati in [TRACEABILITY.md](TRACEABILITY.md) e nel [runbook](RUNBOOK.md). Un collegamento tra requisito e codice dimostra tracciabilità; il superamento effettivo di test o prova manuale è un'evidenza separata. Non attribuire automaticamente a tutti i requisiti la verifica end-to-end.
