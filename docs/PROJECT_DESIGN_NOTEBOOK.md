# Project Design Notebook — NutriTrack
Fase 2 completata il 2026-10-06: publishNewVersion interna a MealPlanning chiude la versione corrente e apre la nuova allo stesso istante, senza modificare gli input; base obsoleta → MealPlanVersionConflict; creazione iniziale con base nulla; attivazione retroattiva respinta. Typecheck OK, 17 test PASS complessivi. [Spiegazione pratica](increments/phase-02.md). Concorrenza reale rinviata alla transazione PostgreSQL (fase 6); nessuna nuova decisione architetturale.
2026-10-06: preparata collaborazione su GitHub, repository Matteo7100/NutriTrack, branch main. Primo snapshot comprende documentazione e fasi 0/1; esclusi sources/, istruzioni locali sincronizzate, dipendenze e cache. [Guida collaborazione](collaboration.md).
Fase 1 completata: proiezione temporale MealPlanVersionPeriod e resolver puro interno a MealPlanning, con intervalli [from,until), assenza piano e rilevamento ambiguità all'istante cercato. Typecheck OK, 9 test PASS complessivi. [Spiegazione pratica](increments/phase-01.md). Nessun database/server; nessuna nuova decisione architetturale.
Preferenza didattica affinata: ogni nuovo file scritto da noi deve iniziare con una descrizione dello scopo e spiegare istruzioni/sintassi quando necessario. Per formati senza commenti usare una guida affiancata; non modificare artefatti generati solo per annotarli. Fase 0 annotata senza cambiamenti funzionali.
Fase 0 completata: typecheck senza errori e 1 test Jest PASS. Configurazione, dipendenze e comandi ripetibili spiegati nella [guida fase 0](increments/phase-00.md). Nessuna regola di dominio implementata; pausa prima della fase 1.
Avviata fase 0 il 2026-10-05: configurazione minima TypeScript/Jest, backend senza framework ancora e test dell'ambiente. Gestore pacchetti pnpm fornito dal runtime locale; nessuna installazione globale. [Registro incrementi](increments/README.md).
Preferenza di sviluppo aggiornata il 2026-10-05: piccoli incrementi didattici, spiegazioni pratiche, commenti in italiano e riferimenti precisi a file/righe. Dopo ciascun incremento fermarsi per lettura e confronto prima di proseguire. Procedura: [sviluppo guidato](development-workflow.md).
Baseline v1 · 2026-10-05 · documentazione persistente

## 1. Provenienza e stato delle decisioni
Fonte: [conversazione recuperata](reference/conversation-recovered.md). Sono disponibili analisi degli scenari critici, domain model, module architecture e module contracts. La prima fase è stata fornita dall'utente in questa sessione: [requirements](requirements.md) conserva FR-01..16, NFR-01..07 e BR-01..11; il catalogo UC e ADR-001 sono stati ripristinati. Le successive ADR raffinano quella originaria. Technology stack e struttura confermati dall'utente il 2026-10-05 (ADR-020).

## 2. Scope
Il nucleo recuperato comprende due ruoli, associazione Patient–Nutritionist, prescrizione versionata, registrazione dei consumi anche offline, privacy del diario e misurazioni storiche. Non sono richiesti microservizi, broker distribuiti né un sistema universale di permessi. Fuori scope: pagamenti, videochiamate, generazione AI piani, riconoscimento cibo da immagini, social, chat, wearable e ordini della spesa. Frigorifero/inventario escluso dal core. Nessun Admin senza requisito concreto.

FR descrive cosa fa il sistema; NFR descrive una qualità da garantire; BR è una regola del dominio. Per esempio: registrare un pasto è un FR, poter testare la logica senza database è una qualità architetturale, associare il pasto alla versione temporalmente corretta è una BR. Catalogo: [requirements](requirements.md).

## 3. Privacy: proprietà e accesso
Il Patient controlla una preferenza globale di condivisione del diario. Il Nutritionist legge il diario solo se è assegnato al Patient e la condivisione è abilitata. Revocare la condivisione impedisce nuove letture senza cancellare le entry. Una preferenza non è un flag per ogni pasto. Default iniziale ora confermato: sharingEnabled=false. Attivarlo rende visibile anche lo storico del diario.
Le measurements restano visibili al Nutritionist assegnato (ADR-019). Nascondere il diario non nasconde misurazioni e piano.

## 4. Prescrizione e consumo reale
MealPlan rappresenta l'identità stabile del piano; MealPlanVersion contiene una prescrizione valida in un intervallo. DiaryEntry rappresenta ciò che è stato mangiato. Separarli evita che una modifica della prescrizione riscriva la storia del Patient.
Una entry può esistere senza piano applicabile: riferimento alla versione nullo (ADR-004).

## 5. Tempo e immutabilità
Una versione attivata conserva immutati i contenuti nutrizionali. Una modifica genera una nuova versione e un ChangeSet, con parentVersionId. Il sistema chiude la validità precedente e apre quella nuova allo stesso istante.
L'immutabilità dei contenuti non impedisce la chiusura controllata di validUntil: il contratto della fonte distingue contenuto storico e metadati temporali.

Invariante recuperata: per ogni Patient e istante t, il numero di versioni valide è al massimo uno.
Affinamento tecnico ADR-021: intervalli [validFrom, validUntil); validUntil nullo indica intervallo aperto. Al confine vale la versione nuova.
Una nuova versione può partire solo dalla versione attiva indicata da baseVersionId. Se un'altra sessione l'ha già sostituita, si produce un conflitto e si richiede il ricaricamento.

## 6. Associazione storica anche offline
consumptionTime è il momento del consumo; createdAt è il momento della registrazione; synchronizationTime è il momento della trasmissione. Sono concetti distinti.
Esempio: consumo alle 08:00 con v3, attivazione v4 alle 14:00, sync alle 18:00. L'entry deve riferirsi a v3.
Il client invia consumo e contenuto, non sceglie mealPlanVersionId. Diary chiede a MealPlanning.getVersionAt(patientId, consumptionTime) la versione corretta. Offline il riferimento non ancora verificato non va confuso con l'assenza accertata di piano: la distinzione tecnica è da progettare.
La sincronizzazione conserva il timestamp del consumo. ADR-021 definisce UTC, operationId stabile, retry idempotente, verifica server e conflitto esplicito. I dettagli sono nel [registro decisionale](decisions-to-close.md).

## 7. Domain model: concetti da studiare
Entity: oggetto riconosciuto tramite identità, anche se gli attributi cambiano (Patient, MealPlan, DiaryEntry).
Value Object: oggetto riconosciuto dai valori, come Quantity o FoodItem; non necessita di identità autonoma.
Aggregate: confine di consistenza; l'esterno chiede un'operazione controllata che preserva invarianti, senza modificare liberamente Meal e FoodItem.
Domain Service: comportamento che non appartiene naturalmente a una singola entity, come risolvere una versione per un istante.
Il raggruppamento MealPlan/versioni/pasti è un candidato aggregate, non una decisione definitiva sulle dimensioni da caricare o memorizzare. L'ereditarietà concettuale User–Patient–Nutritionist non obbliga a usare inheritance nel codice.

Entità, attributi e cardinalità: [architecture](architecture.md#domain-model).

## 8. Modular monolith e ownership
Un modular monolith ha un solo backend deployabile e cinque moduli con confini espliciti. Offre modularità senza transazioni distribuite e gestione di più servizi.
High cohesion significa responsabilità interne riferite allo stesso problema; low coupling significa dipendenza limitata dai dettagli altrui.
Ogni modulo possiede la propria persistenza. Un database fisico condiviso è compatibile con ownership logica, purché nessun altro modulo ne legga direttamente tabelle o collection.
Un ID esterno è consentito: DiaryEntry può conservare mealPlanVersionId; Diary non può interrogare direttamente la persistenza di MealPlanning.

## 9. Contratti, API ed eventi
Un contratto espone operazioni, input, risultati ed errori, nascondendo repository e tecnologia. Qui API significa interfaccia pubblica di modulo: non implica HTTP tra moduli dello stesso processo.
API sincrona: occorre subito una risposta, come getVersionAt o isAssigned.
Evento: comunica un fatto avvenuto, come MealPlanVersionCreated; il publisher non conosce i consumer.
Gli eventi proposti non impongono un broker né consegna asincrona distribuita. Transazioni, emissione dopo commit e affidabilità saranno definite con lo stack. Le verifiche di autorizzazione non si basano su eventi potenzialmente obsoleti.

## 10. Repository abstraction e dependency inversion
Domain/application dipendono da un'interfaccia repository; l'adapter infrastrutturale implementa quell'interfaccia usando il database scelto. La dipendenza del codice va verso l'astrazione; a runtime la chiamata raggiunge l'adapter.
Un fake repository consente di verificare regole temporali, privacy e conflitti senza rete. I repository restano privati del modulo: non sono il contratto per comunicare con altri moduli.
Firebase è un esempio presente nella conversazione, non una scelta tecnologica congelata.

## 11. ADR e prossimo passo
Il [registro](adr/README.md) conserva ADR-001..019; ADR-001 conserva la decomposizione orientata al dominio originaria. Le duplicazioni ADR-002/007 e ADR-003/016 sono conservate per rispettare la storia: temporalità, timestamp e autorità del sistema sono aspetti collegati.

Dopo verifica della documentazione scegliamo stack e repository structure tramite [guida](technology-and-repository.md). L'implementazione con Codex comincerà soltanto quando quelle decisioni saranno confermate. Questa sessione è già nell'app Codex, ma il lavoro resta nella fase documentale: il passaggio indica l'avvio del codice, non un obbligo di cambiare interfaccia.

## 12. Registro aggiornamenti
- 2026-10-05: materializzati notebook, specifiche, ADR e fonte recuperata; nessun codice applicativo.
- Prima fase integrata dal testo utente; ripristinati identificativi originali e ADR-001.
- Preferenza utente: nessuna esperienza o vincolo tecnologico, tecnologie diffuse e complessità contenuta. Stack proposto, non approvato.

## 13. Affinamenti dopo la baseline
ADR-020: stack/repository confermati. ADR-021: intervalli temporali, transazioni e idempotenza. ADR-022: diario privato inizialmente, sharing globale comprensivo dello storico; Patient con 0..1 Nutritionist attivo e associazione accettata; offline per cache propria e creazione pasti/measurements. Privacy, associazioni e piani si modificano online.
Le regole residue proposte sono nel [registro](decisions-to-close.md). Nessun codice applicativo ancora creato.

## Chiusura decisioni per il primo incremento
ADR-023 confermata: prima measurement WEIGHT in kg; nuovi piani attivati immediatamente al server, senza retrodatazione/programmazione; modifica/cancellazione pasti e measurements rinviata; al cambio Nutritionist sharing disabilitato fino a nuova scelta del Patient.
ADR-024: email/password con sessione server, cookie HttpOnly e store persistente nel modulo Identity; Prisma negli adapter privati; Jest backend e Vitest frontend. Versioni/librerie concrete verificate al bootstrap. Il primo incremento con Codex può iniziare dai contratti, regole e repository fake.
