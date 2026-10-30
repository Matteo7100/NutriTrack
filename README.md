# NutriTrack
Sistema di gestione nutrizionale per il progetto Software Engineering. Patient e Nutritionist condividono un percorso con piani versionati, diario dei consumi con privacy opzionale, peso storico e attività Patient supportate offline.

## Avvio
Leggere [RUNBOOK](docs/RUNBOOK.md) per strumenti, ambiente PostgreSQL, installazione, migrazioni, seed e demo. Comandi principali dalla radice: `pnpm install:all`, `pnpm check`, `pnpm build`, `pnpm start`.

## Documentazione per studiare e presentare
1. [Guida al professore](docs/PROFESSOR_GUIDE.md): percorso ragionato, design pattern, invarianti e punti del codice.
2. [Riepilogo decisioni](docs/DECISION_SUMMARY.md): tutte le scelte, con motivazioni e ADR-001..028.
3. [Requirements](docs/requirements.md): FR-01..16, BR-01..11 e NFR-01..07.
4. [Tracciabilità](docs/TRACEABILITY.md): requisito → implementazione → prova.
5. [Use cases](docs/use-cases.md), [architettura](docs/architecture.md) e [notebook](docs/PROJECT_DESIGN_NOTEBOOK.md).
6. [ADR](docs/adr/README.md): storia delle decisioni senza riscritture retroattive.
7. [Collaborazione](docs/collaboration.md): sorgenti e strumenti sui PC dei collaboratori.

## Struttura
- `apps/api`: backend NestJS, cinque moduli, contratti, repository, PostgreSQL/Prisma e test.
- `apps/web`: interfaccia React/Vite/TypeScript, cache e coda offline personale.
- `docs`: decisioni, specifiche, guida d'esame e istruzioni pratiche.
- `compose.yaml`: PostgreSQL della dimostrazione locale.

Il monolite è modulare: nessun modulo accede alla persistenza degli altri. I consumi si associano alla versione valida a consumptionTime, anche se trasmessi dopo una modifica del piano. La condivisione del diario è disabilitata inizialmente; il Patient decide se abilitarla per tutto lo storico.

## Perimetro
Due ruoli, nessun Admin. Prima misurazione: peso in kg. Piani attivati immediatamente e contenuti storici immutabili. Correzioni/cancellazioni di entry e measurements, programmazione piani e le feature escluse in requirements non sono introdotte.

## Stato e verifiche
Verifica locale conclusa: **42 test PASS**, build backend/frontend e smoke browser completo offline con PostgreSQL reale. App disponibile su [localhost:3000](http://127.0.0.1:3000) quando il server è avviato. [Infrastruttura e costi](docs/INFRASTRUCTURE_AND_COSTS.md): nessun servizio cloud a pagamento attivato.
Il completamento del 30 ottobre 2026 attua la baseline concordata e sostituisce la precedente pausa dopo ciascun incremento. Il riepilogo delle verifiche effettivamente eseguite e dei loro limiti è in [TRACEABILITY](docs/TRACEABILITY.md); non confondere presenza dell'implementazione con verifica end-to-end.

## Percorso didattico conservato
Le guide [fase 0](docs/increments/phase-00.md), [fase 1](docs/increments/phase-01.md) e [fase 2](docs/increments/phase-02.md) documentano lo sviluppo iniziale e i commenti riga per riga. Le affermazioni storiche «nessun server» o «nessuna implementazione» in quei resoconti descrivono quelle date, non il progetto attuale.

## Manutenzione
Ogni scelta va registrata nel riepilogo e, se architetturale, in un'ADR. Aggiornare notebook, specifiche e tracciabilità insieme al codice. I materiali sincronizzati sotto sources/ rimangono riferimenti in sola lettura.
