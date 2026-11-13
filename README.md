# NutriTrack
Sistema di gestione nutrizionale per il progetto Software Engineering. Pazienti e nutrizionisti accedono a dashboard dedicate con piani versionati, diario con condivisione facoltativa, misurazioni e attività del paziente supportate offline.

## Avvio
Leggere [RUNBOOK](docs/RUNBOOK.md) per strumenti, ambiente PostgreSQL, installazione, migrazioni, seed e demo. Comandi principali dalla radice: `pnpm install:all`, `pnpm check`, `pnpm build`, `pnpm start`.

Per aggiornare un’installazione esistente, eseguire `pnpm db:generate` e `pnpm db:migrate` prima di ricompilare. Per attivare il recupero della password via email, configurare `PUBLIC_APP_URL`, `RESEND_API_KEY` e `PASSWORD_RESET_FROM` come descritto nel [RUNBOOK](docs/RUNBOOK.md#recupero-password-via-email).

## Documentazione per studiare e presentare
1. [Guida al professore](docs/PROFESSOR_GUIDE.md): percorso ragionato, design pattern, invarianti e punti del codice.
2. [Riepilogo decisioni](docs/DECISION_SUMMARY.md): tutte le scelte, con motivazioni e ADR-001..038.
3. [Requirements](docs/requirements.md): FR-01..21, BR-01..11 e NFR-01..10.
4. [Tracciabilità](docs/TRACEABILITY.md): requisito → implementazione → prova.
5. [Use cases](docs/use-cases.md), [architettura](docs/architecture.md) e [notebook](docs/PROJECT_DESIGN_NOTEBOOK.md).
6. [ADR](docs/adr/README.md): storia delle decisioni senza riscritture retroattive.
7. [Collaborazione](docs/collaboration.md): sorgenti e strumenti sui PC dei collaboratori.
8. [Design pattern](docs/DESIGN_PATTERNS.md): sei GoF applicati, confronto del catalogo dei 22, vantaggi della Strategy e diagrammi delle collaborazioni.
9. [Refactoring spiegato](docs/increments/refactor-patterns.md): ordine di lettura dei nuovi file e differenze rispetto alla versione precedente.

## Struttura
- `apps/api`: backend NestJS, cinque moduli, contratti, repository, PostgreSQL/Prisma e test.
- `apps/web`: interfaccia React/Vite/TypeScript, cache e coda offline personale.
- `docs`: decisioni, specifiche, guida d'esame e istruzioni pratiche.
- `compose.yaml`: PostgreSQL della dimostrazione locale.

Il monolite è modulare: nessun modulo accede alla persistenza degli altri. I consumi si associano alla versione valida a consumptionTime, anche se trasmessi dopo una modifica del piano. La condivisione del diario è disabilitata inizialmente; il Patient decide se abilitarla per tutto lo storico.

## Perimetro
Registrazione dal sito come paziente o nutrizionista. Il paziente può modificare il profilo, registrare peso in kg e circonferenze di braccio e busto in cm e gestire la propria galleria fotografica privata. Le misurazioni usano la coda offline. La galleria, le modifiche al profilo e il recupero della password richiedono la connessione. Il paziente può correggere o eliminare pasti e misurazioni confermati. Entrambi i ruoli possono cambiare password, scaricare i propri dati ed eliminare l’account dalla sezione Profilo. I piani si attivano alla pubblicazione e le versioni storiche sono immutabili.

## Stato e verifiche
Il 4 novembre 2026 è stato autorizzato il refactoring Command/Strategy/Observer per l'offline e Abstract Factory per lo storage, senza ampliare i requisiti. La verifica aggiornata è in TRACEABILITY; il conteggio seguente resta evidenza storica del completamento del 30 ottobre.
Verifica locale conclusa: **42 test PASS**, build backend/frontend e smoke browser completo offline con PostgreSQL reale. App disponibile su [localhost:3000](http://127.0.0.1:3000) quando il server è avviato. [Infrastruttura e costi](docs/INFRASTRUCTURE_AND_COSTS.md): nessun servizio cloud a pagamento attivato.
Il completamento del 30 ottobre 2026 attua la baseline concordata e sostituisce la precedente pausa dopo ciascun incremento. Il riepilogo delle verifiche effettivamente eseguite e dei loro limiti è in [TRACEABILITY](docs/TRACEABILITY.md); non confondere presenza dell'implementazione con verifica end-to-end.

## Percorso didattico conservato
Le guide [fase 0](docs/increments/phase-00.md), [fase 1](docs/increments/phase-01.md) e [fase 2](docs/increments/phase-02.md) documentano lo sviluppo iniziale e i commenti riga per riga. Le affermazioni storiche «nessun server» o «nessuna implementazione» in quei resoconti descrivono quelle date, non il progetto attuale.

## Manutenzione
Ogni scelta va registrata nel riepilogo e, se architetturale, in un'ADR. Aggiornare notebook, specifiche e tracciabilità insieme al codice. I materiali sincronizzati sotto sources/ rimangono riferimenti in sola lettura.
