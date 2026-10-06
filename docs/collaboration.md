# Collaborazione su GitHub
Codice, test, lockfile e docs/ sono condivisi nella repository NutriTrack.
node_modules/, cache, file .env e riferimenti sincronizzati sources/ sono esclusi.
La conversazione condivisa è separata: GitHub conserva le nostre note persistenti,
non aggiorna automaticamente un link alla chat.

## Per il secondo collaboratore
Il codice su GitHub è sufficiente come sorgente, ma non comprende gli strumenti
installati sul PC dell'autore. Sul secondo PC servono:
- Accesso alla repository: se privata, accettare l'invito; per inviare modifiche
  autenticarsi con il proprio account autorizzato, anche se la repository è pubblica.
- Git per clonare e sincronizzare; VS Code consigliato per leggere e modificare.
- Node.js 24.x, famiglia usata nella verifica locale (24.19.0).
- pnpm 11.19.0, dichiarato nel manifest. Non installare semplicemente la release
  latest: potrebbe essere una versione principale diversa.
- Connessione alla rete per scaricare inizialmente le dipendenze.

### Preparazione strumenti (esempio Windows)
Installare Git e Node.js dai siti ufficiali, e riaprire VS Code/il terminale per
aggiornare il PATH. L'installazione standard di Node include npm: non serve
installare TypeScript o Jest globalmente.

```powershell
git --version
node --version
npm.cmd --version
npm.cmd install --global pnpm@11.19.0
pnpm.cmd --version
```

L'installazione di pnpm sopra viene effettuata dal collega sul proprio PC;
noi non abbiamo eseguito installazioni globali sul PC dell'autore.
Su macOS/Linux usare npm e pnpm senza il suffisso .cmd.

### Copia del progetto e verifica
Dal terminale in una cartella personale di sviluppo:

```powershell
git clone https://github.com/Matteo7100/NutriTrack.git
cd NutriTrack
pnpm.cmd --dir apps/api install --frozen-lockfile --store-dir .pnpm-store
pnpm.cmd check
```

Il clone crea la cartella NutriTrack: aprirla interamente in VS Code con
File > Open Folder. Se Git chiede accesso, usare l'autenticazione GitHub del
collega tramite il gestore credenziali o GitHub Desktop, non le credenziali
dell'autore. Lo ZIP scaricato permette di leggere/eseguire ma non prepara
lo storico Git: preferire clone per collaborare.

Risultato atteso: typecheck senza errori, due suite e nove test PASS.
Non serve un comando start: in questa fase non c'è ancora un server o una UI.

### Per salvare e condividere le modifiche
Configurare una volta nome e email propri con git config user.name e user.email
nella copia locale (o tramite GitHub Desktop), poi lavorare su un branch e inviare
commit/pull request. Avere un account GitHub da solo non configura automaticamente
Git sul PC. GitHub Desktop è facoltativo per semplificare autenticazione e operazioni.

### Cosa non serve ancora
PostgreSQL, Docker, servizi cloud, file .env, API key e Codex non sono necessari
per eseguire i test attuali. Codex è facoltativo se il collega vuole assistenza AI;
una sua chat dovrà leggere notebook e documentazione, senza presumere il contesto
completo della chat dell'autore. I materiali sources/ non servono per i test;
per studiare le fonti del corso andranno condivisi separatamente se necessario.

### Controllo di riproducibilità
2026-10-06: esportati solo i file del commit iniziale in una nuova cartella senza
node_modules, poi reinstallate le dipendenze dal lockfile usando la cache locale.
Controllo tipi OK; due suite e nove test PASS. Questo verifica l'indipendenza dai file esclusi, non simula autenticazione GitHub
o tutte le piattaforme del collega.

Fonti: [Node.js](https://nodejs.org/en/download), [pnpm installazione e compatibilità](https://pnpm.io/installation), [GitHub clone](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository).

Non copiare i percorsi del runtime Codex di un altro PC: le guide li riportano
solo per il terminale locale dell'autore. Il progetto usa dipendenze locali e lockfile.

## Piccoli incrementi
Prima di lavorare recuperare le modifiche remote; usare un branch per il proprio
incremento. Un commit salva una modifica con messaggio; una pull request permette
all'altro collaboratore di leggerla prima dell'integrazione. Coordinare gli interventi
sugli stessi file e aggiornare sempre notebook e registro incrementi.

## Stato del primo caricamento
Repository: https://github.com/Matteo7100/NutriTrack. Branch iniziale: main.
Primo snapshot: baseline documentale, ADR-001..024, configurazione fase 0 e resolver
temporale fase 1. Il caricamento viene verificato confrontando il commit locale
con il riferimento remoto. Nessuna fase applicativa successiva avviata.
