# I due package.json, spiegati
Questa nota affianca i manifest: package.json richiede JSON senza commenti.
Inserire // o /* ... */ nei manifest li renderebbe non validi.

## package.json nella cartella principale
Questo file descrive il progetto complessivo e offre comandi che inoltrano il lavoro al backend.

| Campo | Spiegazione |
|---|---|
| name: nutritrack | Nome tecnico del progetto. |
| version: 0.0.0 | Versione iniziale; non significa applicazione completata. |
| private: true | Impedisce la pubblicazione accidentale come pacchetto nel registry. |
| packageManager: pnpm@11.19.0 | Dichiara il gestore di pacchetti e la versione scelta. |
| scripts | Oggetto con nomi e comandi eseguibili tramite pnpm. |
| typecheck | pnpm --dir apps/api typecheck esegue lo script omonimo del backend, usando apps/api come directory. |
| test | Inoltra allo script test del backend. |
| check | pnpm typecheck && pnpm test: esegue il secondo comando solo se il primo riesce. |

## apps/api/package.json
Descrive il backend e gli strumenti locali necessari al controllo dei suoi file.

| Campo | Spiegazione |
|---|---|
| name: @nutritrack/api | Nome con scope @nutritrack: raggruppamento nominale del backend, non un account o provider. |
| version e private | Versione iniziale e blocco pubblicazione come nella radice. |
| typecheck: tsc --noEmit | tsc è il compilatore TypeScript; --noEmit controlla i tipi senza creare JavaScript compilato. |
| test: jest --runInBand | Jest esegue i test; --runInBand li esegue in sequenza nello stesso processo, sufficiente per questo piccolo progetto. |
| devDependencies | Pacchetti per sviluppo e verifiche; non codice del dominio NutriTrack. |
| @types/jest | Dichiarazioni che consentono a TypeScript di riconoscere le funzioni globali Jest. |
| jest | Framework che trova, esegue e valuta i test. |
| ts-jest | Trasforma TypeScript per Jest, secondo tsconfig.json. |
| typescript | Fornisce il compilatore tsc e gli strumenti del linguaggio. |

## Sintassi JSON
Le parentesi graffe delimitano oggetti; ogni campo ha una chiave tra virgolette, due punti e un valore. Le virgole separano i campi e non vanno dopo l'ultimo campo. Le stringhe usano virgolette doppie; true è un booleano, non un testo. Gli oggetti possono contenere altri oggetti, come scripts.

Le versioni con ^ ammettono aggiornamenti compatibili secondo le regole di versione del gestore. Il lockfile del backend conserva le versioni esatte risolte. Per riprodurle si usa install --frozen-lockfile. I lockfile e le librerie scaricate non vengono annotati manualmente: sono artefatti generati.

src/.gitkeep è un file vuoto creato da noi: permette a Git di conservare la cartella vuota. Non viene eseguito e .gitkeep è una convenzione, non una funzionalità speciale di Git.

## Perché pnpm-lock.yaml contiene così tanti packages?
Un package è una libreria o uno strumento distribuito come pacchetto, con nome, versione e proprie dipendenze. Nel package.json abbiamo scelto direttamente solo quattro strumenti: typescript, jest, ts-jest e @types/jest. Questi strumenti sono costruiti usando altre librerie, che a loro volta possono dipendere da ulteriori pacchetti. pnpm risolve questa rete e la registra nel lockfile.

- Dipendenza diretta: scelta da noi nel manifest, per esempio jest.
- Dipendenza transitiva: richiesta da una dipendenza, per esempio jest-cli, usata da jest.
- Peer dependency: requisito di compatibilità con un pacchetto usato insieme allo strumento, come TypeScript e Jest per ts-jest. Non è semplicemente una libreria interna; pnpm registra anche il contesto in cui il requisito è stato risolto.
- Dipendenza opzionale: può essere applicabile solo in alcuni ambienti o per funzionalità facoltative. Una voce nel lockfile non implica che il pacchetto venga installato su ogni PC.

Quindi la lunghezza del lockfile non indica quanti componenti di NutriTrack abbiamo scritto. La maggior parte delle voci appartiene all'infrastruttura degli strumenti di sviluppo.

### Esempi presenti nel nostro file
| Pacchetto o famiglia | Funzione generale |
|---|---|
| jest-cli, jest-runner, jest-runtime | Gestione del comando Jest, esecuzione e ambiente dei test. |
| expect, jest-matcher-utils | Confronti e messaggi delle verifiche, come expect(result).toBe(5). |
| jest-diff | Mostra differenze tra risultati attesi e ottenuti. |
| @babel/* e babel-jest | Analisi e trasformazione del codice nell'ecosistema dei test; la loro presenza non significa che abbiamo scelto Babel come compilatore del progetto. |
| @types/* | Definizioni TypeScript per librerie JavaScript. |
| chalk e supports-color | Formattazione e supporto dei colori nel terminale. |
| @parcel/watcher e varianti per piattaforma | Monitoraggio dei file; il lockfile comprende varianti Windows, Linux e macOS. |
| unrs-resolver | Risoluzione di riferimenti ai moduli usati dagli strumenti. |

Questi sono esempi rappresentativi, non librerie che dovremo importare tutte nel nostro codice. Una dipendenza presente può supportare anche funzionalità che non usiamo, come osservazione dei file o snapshot test.

### Come leggere le sezioni del lockfile
Il file usa YAML: l'indentazione rappresenta la struttura. È generato da pnpm e non va modificato a mano per aggiungere spiegazioni.

| Sezione/campo | Significato |
|---|---|
| lockfileVersion: '9.0' | Versione del formato del lockfile, non versione di pnpm o dell'app. |
| settings | Impostazioni che influenzano la risoluzione; autoInstallPeers abilita l'installazione automatica dei peer secondo le regole pnpm. |
| importers | Progetti descritti dal file. Qui . significa il backend apps/api, dove si trova questo lockfile. |
| specifier | Vincolo richiesto dal package.json, per esempio ^5.9.0. |
| version | Versione effettivamente risolta, per esempio 5.9.3. |
| packages | Metadati dei pacchetti risolti: versioni, integrità, requisiti e vincoli di piattaforma. |
| resolution.integrity | Impronta crittografica per verificare la corrispondenza del contenuto scaricato; non certifica che una libreria sia priva di bug. |
| engines | Versioni del runtime richieste o dichiarate dal pacchetto. |
| peerDependencies | Requisiti di compatibilità con pacchetti forniti nel contesto d'uso. |
| snapshots | Collegamenti effettivi tra le dipendenze risolte. Non sono gli snapshot dei risultati dei test Jest. |
| dependencies / optionalDependencies | Pacchetti richiesti da quella specifica istanza e quelli opzionali. |

Per esempio typescript ha specifier ^5.9.0 ma version 5.9.3: il primo esprime cosa accettiamo, il secondo cosa abbiamo installato. Una chiave lunga come jest@30.5.2(@types/node@26.6.4)(supports-color@8.1.1) identifica la versione con il suo contesto di peer risolti: non è il nome di un unico pacchetto pubblicato con tutte quelle parentesi.

Lo stesso pacchetto può comparire in packages e snapshots perché le sezioni hanno ruoli diversi; non significa automaticamente due copie installate. Possono inoltre esistere versioni o contesti diversi dello stesso pacchetto.

### Cosa fare nella pratica
Versioniamo il lockfile insieme al package.json. Per ricreare le dipendenze usiamo il comando install --frozen-lockfile documentato nella fase 0: non deve aggiornare il lockfile e segnala incompatibilità con il manifest. Per aggiornare o rimuovere dipendenze useremo pnpm, verificando le modifiche e rieseguendo i controlli. Non cancelliamo singole voci del lockfile e non modifichiamo librerie in node_modules.

Il lockfile è una mappa delle dipendenze, non contiene il loro codice completo. Il codice scaricato si trova in node_modules e nello store pnpm. Per studiare NutriTrack iniziamo dai nostri sorgenti e test; consultiamo questa mappa quando occorre capire una versione, una compatibilità o da dove proviene una dipendenza.
