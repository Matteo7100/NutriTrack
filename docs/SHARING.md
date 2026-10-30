# Condividere NutriTrack con il compagno
Controllo locale del 30 ottobre 2026: repository collegata a https://github.com/Matteo7100/NutriTrack, branch di lavoro fase-2. Il completamento ha ancora modifiche locali da salvare e inviare. Questa guida non esegue commit o push e non prova un aggiornamento remoto.

## 1. Caricare il lavoro attuale
In VS Code aprire la cartella principale NutriTrack, poi Terminal > New Terminal. Prima controllare le modifiche:
```powershell
git status
git diff --stat
```
Per salvare il progetto completo nella branch attuale:
```powershell
git add README.md docs apps compose.yaml package.json pnpm-lock.yaml .gitignore
git commit -m "Complete NutriTrack application and exam documentation"
git push -u origin fase-2
```
add prepara i file; commit crea uno snapshot locale; push lo carica su GitHub. Gli ignore escludono node_modules, store, .env e sources. I lockfile e .env.example vanno condivisi. Se Git richiede l'accesso usare il proprio account tramite il gestore credenziali, non copiare password nel codice. Se il push viene rifiutato perché il remoto è cambiato, non usare force: recuperare e integrare le modifiche con il compagno.

L'equivalente grafico in VS Code è Source Control (Ctrl+Shift+G), revisione file, Stage, messaggio Commit e Push. Il commit da solo non aggiorna GitHub.

## 2. Dare accesso
Aprire la repository su GitHub > Settings > Collaborators > Add people e invitare l'account GitHub del compagno. Deve accettare. Una repository privata richiede accesso anche per clonare; una pubblica si può leggere senza invito, ma per contribuire servono permessi. Non è necessario rendere pubblico il progetto.

## 3. Scegliere la branch condivisa
Via rapida: entrambi lavorate dalla branch fase-2 caricata. Il compagno clona con:
```powershell
git clone --branch fase-2 https://github.com/Matteo7100/NutriTrack.git
cd NutriTrack
```
Se aveva già clonato, prima salva il suo lavoro, poi usa git fetch origin, passa a fase-2 e aggiorna con git pull --ff-only. Se manca la branch locale: git switch --track origin/fase-2.
Per rendere il completamento la versione principale, creare una pull request su GitHub da fase-2 verso main, rivederla e unirla. Non assumere che il push su fase-2 aggiorni anche main. Dopo l'integrazione si può clonare normalmente senza --branch.

## 4. Eseguirlo sul secondo PC
Installare Git, Node24, pnpm11 e Docker Desktop; VS Code consigliato. Il progetto non include gli strumenti installati sul PC dell'autore. Con Docker avviato, dalla cartella clonata:
```powershell
pnpm.cmd install:all
Copy-Item apps/api/.env.example apps/api/.env
docker compose up -d db
pnpm.cmd db:generate
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd check
pnpm.cmd build
pnpm.cmd start
```
Su macOS/Linux omettere .cmd e copiare il file con il comando appropriato. Aprire http://127.0.0.1:3000 sul PC del compagno. Dettagli, account e prova database nel [runbook](RUNBOOK.md). Il test browser automatico usa Edge; non serve per il normale avvio dell'app.

## 5. Cosa viene condiviso e cosa no
Sorgenti, configurazioni riproducibili, test, migrazioni, seed, decisioni e guida d'esame sono nel repository. Dipendenze scaricate e output di build vengono ricreati con i comandi.
Il database e i dati IndexedDB dei browser restano locali. Il seed ricrea gli account dimostrativi, non copia le registrazioni dell'autore. Per trasferire esattamente i dati servirebbe un backup separato, non incluso in questa procedura. localhost indica sempre il PC di chi apre il browser: il link locale dell'autore non è un sito condiviso online.
La chat non viene trasferita da Git; notebook e guide conservano il contesto progettuale. I riferimenti del corso sotto sources sono esclusi e vanno condivisi separatamente se necessari. Il file .env personale non va inviato: il compagno usa il modello .env.example.

Fonti: [invito collaboratori GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository), [Git in VS Code](https://code.visualstudio.com/docs/sourcecontrol/overview).
