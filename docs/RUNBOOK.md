# Avvio, verifica e dimostrazione
Guida pratica per eseguire NutriTrack e ripetere i controlli. Comandi dalla cartella principale della repository, salvo indicazione diversa. Non occorre un account cloud, una API key o un provider di autenticazione esterno.

## 1. Strumenti
Servono Node.js 24.x, pnpm 11.19.0 e PostgreSQL 16. Docker Desktop è il modo proposto per il database locale; un PostgreSQL esistente è utilizzabile cambiando DATABASE_URL. Git serve per collaborare, VS Code per leggere/modificare il codice.

```powershell
node --version
pnpm.cmd --version
docker --version
```

Su macOS/Linux usare pnpm senza .cmd. L'installazione dei pacchetti Node del progetto è locale, non globale. I percorsi del runtime Codex presenti nelle prime guide sono specifici del PC dell'autore: non copiarli su un altro PC.

Se sul PC dell'autore Node/pnpm non vengono trovati dal terminale VS Code, la guida fase 0 mostra come aggiungere temporaneamente al PATH i runtime già forniti da Codex. Su un nuovo PC usare invece un'installazione standard di Node e pnpm della versione indicata.

## 2. Dipendenze e ambiente
```powershell
pnpm.cmd install:all
Copy-Item apps/api/.env.example apps/api/.env
```

Copiare .env.example solo al primo avvio: non sovrascrivere un .env già personalizzato. Il modello contiene la connessione locale:

```text
DATABASE_URL=postgresql://nutritrack:nutritrack_local@localhost:15432/nutritrack?schema=public
PORT=3000
NODE_ENV=development
```

Le credenziali sono esclusivamente dimostrative e corrispondono a compose.yaml. Il file .env non va versionato. Il backend legge l'ambiente dalla propria cartella; gli script principali inoltrano i comandi ad apps/api.

## 3. Database
Avviare Docker Desktop, quindi:

```powershell
docker compose up -d db
docker compose ps
pnpm.cmd db:generate
pnpm.cmd db:migrate
pnpm.cmd db:seed
```

Il database pubblica la porta 15432 solo sul loopback. db:generate genera il client Prisma, db:migrate applica migrazioni versionate, db:seed predispone gli account della demo. Il volume Docker conserva dati quando si arresta il container. Non cancellare volumi per risolvere un normale errore di avvio.

## 4. Compilazione e app completa
`pnpm check` esegue normalmente i test che non richiedono PostgreSQL e la pipeline HTTP locale; il test di integrazione PostgreSQL viene saltato se TEST_DATABASE_URL non è impostata. Per includerlo dopo la migrazione, in PowerShell impostare `$env:TEST_DATABASE_URL = 'postgresql://nutritrack:nutritrack_local@localhost:15432/nutritrack?schema=public'`, quindi eseguire `pnpm.cmd check`. Quel test aggiunge solo account con email uniche al database demo e non cancella dati.
```powershell
pnpm.cmd check
pnpm.cmd build
pnpm.cmd start
```

Aprire [http://127.0.0.1:3000](http://127.0.0.1:3000). Il backend serve anche il frontend compilato. Questa modalità è la più semplice per la dimostrazione offline: shell e service worker lavorano sullo stesso origin dell'API.

Per arrestare il server usare Ctrl+C nel suo terminale. Per fermare il database conservando il volume: `docker compose stop db`.

## 5. Sviluppo con ricaricamento
Per ripetere lo smoke automatico completo con app già avviata: `pnpm.cmd --dir apps/web test:browser`. Richiede Microsoft Edge installato, usa i soli account demo e lascia i dati creati visibili; non ripristina lo stato iniziale. Lo script ha passato il ciclo offline e salva uno screenshot in docs/evidence/browser-patient.png. Playwright è una dipendenza di sviluppo gratuita; non è un servizio cloud. Nessuna chiave API necessaria.
In due terminali distinti:

```powershell
pnpm.cmd dev:api
```

```powershell
pnpm.cmd dev:web
```

Vite comunica l'indirizzo del frontend e inoltra /api al backend su porta 3000. Il browser deve aprire l'indirizzo Vite per questa modalità. Per provare il service worker usare invece la build servita dal backend, evitando di confondere asset di sviluppo e shell compilata.

## 6. Account della demo
Password comune dei soli account dimostrativi: `DemoNutriTrack2026!`.

| Email | Ruolo | Uso |
|---|---|---|
| nutri@example.test | Nutritionist | Invita, gestisce piani e consulta dati consentiti |
| patient@example.test | Patient | Accetta invito, diario e peso |
| unassigned@example.test | Patient | Dimostra assenza di assegnazione e limiti di accesso |

Gli account sono inizialmente non associati: il Nutritionist invita patient@example.test; il Patient accede e accetta l'invito. La preferenza diario resta disabilitata. Non viene creato un Admin né permessa una registrazione pubblica autonoma come Nutritionist.
Nell'ambiente dell'autore lo smoke ha già associato i due utenti demo, pubblicato versioni, attivato sharing e registrato pasti/peso. Sono dati di prova, non il default dei nuovi utenti. Il seed non azzera dati; per mostrare la scelta iniziale usare un nuovo Patient predisposto via CLI oppure disabilitare sharing dal Patient demo. Non cancellare il volume per preparare l'esposizione.

Per predisporre un altro account locale tramite CLI, impostare la password nella variabile d'ambiente e fornire email, nome e ruolo:

```powershell
$env:ACCOUNT_PASSWORD = 'UnaPasswordLocaleDaScegliere'
pnpm.cmd --dir apps/api account:create collega@example.test 'Nome Cognome' PATIENT
Remove-Item Env:ACCOUNT_PASSWORD
```

Questo è provisioning della demo, non un'interfaccia di amministrazione aggiunta al prodotto. Non inserire password reali in repository o documentazione.

## 7. Checklist della dimostrazione
1. Nutritionist: invita il Patient; Patient: accetta. Dimostrare che un invito non attribuisce ancora accesso.
2. Nutritionist: seleziona il paziente associato e crea v1 con pasti/opzioni/alimenti, quantità e unità.
3. Patient: consulta il piano e registra consumo reale con data/ora; mostra propria entry e versione risolta dal server.
4. Nutritionist: tenta di consultare diario senza consenso. Deve apparire un diniego distinto da un diario vuoto.
5. Patient: abilita condivisione del diario intero, incluso storico. Nutritionist: ricarica e può consultarlo.
6. Patient: registra peso in kg; Nutritionist: lo consulta anche se il diario viene nuovamente reso privato.
7. Nutritionist: modifica il piano creando v2. Mostra storico, parent e differenze senza riscrivere v1.
8. Due finestre Nutritionist con la stessa base: pubblicare dalla prima, poi tentare dalla seconda. La seconda riceve conflitto e deve ricaricare.
9. Terminare l'associazione tramite il comando previsto, verificare blocco degli accessi e conservazione dei dati. Una nuova associazione non eredita consenso diario precedente.

## 8. Prova offline ripetibile
1. Avviare la build completa e caricare l'app online. Accedere come Patient e caricare dati personali.
2. Aprire DevTools del browser, sezione Application/Service Workers e verificare che la shell sia pronta; ricaricare online una volta se necessario per il controllo del service worker.
3. Selezionare offline nella scheda Network. Registrare un pasto e un peso: devono risultare locali/pending, senza fingere conferma del server.
4. Il riferimento al piano del pasto pending è UNRESOLVED, non null confermato. Privacy, inviti e pubblicazione piani richiedono rete.
5. Ripristinare online. La coda invia le operazioni con gli stessi operationId e timestamp; il server risolve la versione al consumo, conferma e aggiorna lo stato.
6. Interrompere la risposta o ripetere un invio: stessa operazione non crea duplicati. Un ID riusato con payload diverso è conflitto, non aggiornamento.
7. Se la sessione è scaduta, la coda resta e si richiede nuovo login. Non eliminare storage per risolvere il problema: si perderebbero operazioni non inviate.

## 9. Comandi di verifica e significato
| Comando | Evidenza |
|---|---|
| pnpm check | Controllo tipi e test backend/frontend |
| pnpm build | Compilazione backend e asset frontend |
| pnpm --dir apps/api test | Regole di dominio/application e suite HTTP previste |
| pnpm --dir apps/web test | Funzioni e stati di riconciliazione del frontend |

Il fake in memoria verifica regole senza rete; non dimostra il comportamento di PostgreSQL. La suite infrastrutturale che usa il database richiede il database effettivamente disponibile. L'esito finale e gli eventuali limiti sono nel riepilogo verifiche e in [TRACEABILITY.md](TRACEABILITY.md).

## 10. Problemi comuni
| Sintomo | Controllo |
|---|---|
| Connessione al database fallisce | Docker avviato, container healthy, porta 15432, .env del backend corretto |
| Client Prisma non generato | Eseguire db:generate dopo installazione e cambi schema |
| Migrazione mancante | Eseguire db:migrate prima del seed e del server |
| Credenziali demo non valide | Verificare seed sul database indicato dall'ambiente; non confondere due database |
| Richiesta respinta per sessione/CSRF | Rientrare tramite login; non copiare cookie o token tra origin diversi |
| Offline non ricarica app | Prima visita online necessaria; usare build servita dal backend e service worker attivo |
| Diario negato | Distinguere paziente non assegnato da condivisione disabilitata |
| Conflitto piano | Ricaricare versione corrente e ricostruire modifica sulla nuova base |

I controlli locali non costituiscono una certificazione di sicurezza o conformità per dati sanitari reali. Il progetto d'esame usa dati dimostrativi e dichiara i compromessi di persistenza/concorrenza in ADR-025.
