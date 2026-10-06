# NutriTrack
Fase 1 completata: [risoluzione temporale spiegata](docs/increments/phase-01.md). `pnpm check`: controllo tipi e 9 test complessivi.
Fase 0: [guida pratica e comandi](docs/increments/phase-00.md). Per verificare dalla cartella principale: `pnpm check` con Node e pnpm disponibili nel terminale. Nessun server applicativo ancora presente.
Per seguire la produzione del codice: [procedura di sviluppo guidato](docs/development-workflow.md). Implementazione per piccoli incrementi spiegati e verificati, con pausa tra un incremento e il successivo.
Progetto Software Engineering — Design Baseline v1, materializzata il 5 ottobre 2026.

NutriTrack supporta Patient e Nutritionist nella gestione di piani alimentari, diario dei consumi e misurazioni dei progressi. Questa repository contiene esclusivamente documentazione: stack e struttura applicativa sono ancora da decidere.

## Percorso di lettura
1. [Design Notebook](docs/PROJECT_DESIGN_NOTEBOOK.md): concetti, motivazioni e decisioni.
2. [Requirements](docs/requirements.md): scope, requisiti e regole.
3. [Use cases](docs/use-cases.md): comportamenti e scenari critici.
4. [Architecture](docs/architecture.md): modello, ownership e contratti.
5. [ADR](docs/adr/README.md): registro ADR-001..019.
6. [Scelta dello stack](docs/technology-and-repository.md): proposta da valutare.
7. [Verifica](docs/baseline-verification.md): copertura e lacune.

## Stato
Prima fase integrata dal testo utente: FR-01..16, NFR-01..07, BR-01..11, use case originali e ADR-001..019. Dettagli implementativi aperti esplicitamente tracciati. Nessuna implementazione applicativa avviata.

## Manutenzione
Aggiornare insieme notebook, specifica interessata e ADR quando cambia una decisione. Conservare gli identificativi storici e registrare motivazione e conseguenze. I file sotto sources/ sono riferimenti sincronizzati in sola lettura.

## Stato successivo alla baseline
Stack e struttura confermati; affinamenti ADR-020..022. [Decisioni prima del codice](docs/decisions-to-close.md): scelte confermate e proposte residue. Nessun codice applicativo ancora avviato.

Le regole residue per il primo incremento sono confermate (ADR-023). Auth, adapter e test definiti (ADR-024). Prossimo passo: implementazione dello skeleton con Codex.
