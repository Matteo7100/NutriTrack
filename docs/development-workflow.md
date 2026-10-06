# Sviluppo guidato a piccoli incrementi
Preferenza esplicita dell'utente, 2026-10-05. Non generare l'intera applicazione in una volta.

## Strumenti
La chat corrente nell'app Codex coordina il lavoro e modifica i file della cartella locale. VS Code serve a leggere, modificare e navigare gli stessi file; il terminale esegue comandi; il browser mostra la UI quando esisterà un frontend eseguibile.
Tenere questa chat come riferimento iniziale: non è necessario aprire una nuova chat nell'estensione VS Code. L'estensione Codex è un'alternativa opzionale e una nuova conversazione non va considerata automaticamente dotata di tutto il contesto precedente.

## Aprire il progetto
In VS Code: File > Open Folder (Apri cartella), quindi selezionare:
`C:\Users\matte\.codex\.chatgpt-projects\g-p-6a7c7580866c8191b8e495c44594b182`
Aprire la cartella intera, non soltanto README.md. Explorer mostra l'albero; Ctrl+P cerca un file; Ctrl+G raggiunge una riga; Ctrl+Shift+V mostra l'anteprima Markdown. Terminal > New Terminal apre il terminale nella cartella di lavoro: controllare il percorso prima di eseguire comandi.
Le cartelle sources/ e i file sincronizzati restano riferimenti non modificabili.

## Regola di ciascun incremento
1. Spiegare un obiettivo osservabile e i concetti nuovi prima delle modifiche.
2. Realizzare una sola porzione comprensibile: normalmente pochi file; configurazioni del framework possono richiedere più file, tutti spiegati.
3. Commenti in italiano sulle regole, le responsabilità e le scelte non evidenti. Identificatori tecnici coerenti in inglese. Evitare commenti che ripetono ogni istruzione.
4. Eseguire le verifiche necessarie; fornire il comando ripetibile, cartella da cui eseguirlo e risultato atteso.
5. Mostrare file e righe reali cliccabili, ordine di lettura e un esempio concreto di input/risultato. Definire ciascun termine introdotto.
6. Aggiornare notebook e un registro degli incrementi con obiettivo, file, verifica e stato. ADR solo quando cambia una decisione, non per ogni file.
7. Fermarsi al termine dell'incremento per spiegazioni/domande. Non proseguire automaticamente con il successivo: è il ritmo didattico richiesto dall'utente.

## Sequenza iniziale
| Incremento | Obiettivo pratico | Cosa osservare |
|---|---|---|
| 0 | Verificare strumenti e predisporre progetto/test minimi | Differenza tra file sorgente, configurazione, dipendenza e test |
| 1 | Risoluzione versione a un istante | Esempio v3/v4 e test al confine temporale |
| 2 | Creazione nuova versione da base corrente | Contenuto storico immutato e conflitto da base obsoleta |
| 3 | Diary con repository fake e contratto MealPlanning | Entry riferita alla versione al consumptionTime, anche senza piano |
| 4 | Policy sharing e associazione | Patient legge; Nutritionist legge solo se assegnato e sharing attivo |
| 5 | Collegare i moduli al backend NestJS | Una richiesta attraversa controller, application e domain |
| 6 | PostgreSQL e adapter | Stesse regole, dati persistenti e test di concorrenza |
| 7 | Prima schermata React | Azione UI e chiamata al backend |
| 8 | Coda offline e retry | Operazione pending, riconciliazione e nessun duplicato |

Ogni riga può essere divisa ulteriormente. Auth e associazioni reali saranno introdotte prima di esporre dati reali; all'inizio si usano principal e dati dimostrativi. Lo skeleton non deve produrre tutti i moduli completi prima che il Patient possa studiare il primo comportamento.

## Stato
Procedura registrata. Nessun codice applicativo prodotto in questo aggiornamento. Node e Git individuati nel terminale dell'agente; npm non individuato nel PATH in quel controllo. Questo non prova che manchi sul PC: verificare il terminale VS Code prima di installare strumenti. VS Code risulta disponibile.

Fonti: [Codex IDE extension](https://learn.chatgpt.com/docs/codex/ide), [app desktop](https://learn.chatgpt.com/docs/app).
