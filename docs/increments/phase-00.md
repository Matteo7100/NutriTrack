# Fase 0 — Ambiente TypeScript e test
I file di codice/configurazione ora contengono spiegazioni iniziali e annotazioni sulle istruzioni. I due manifest JSON sono spiegati nel documento affiancato [package.json spiegati](package-files-explained.md), perché non ammettono commenti.
Data: 2026-10-05. Obiettivo: eseguire un test TypeScript prima di introdurre regole di dominio.

## File da leggere in ordine
1. apps/api/tests/toolchain.spec.ts: test di prova con commenti. describe raggruppa test, it descrive un caso, expect verifica il risultato.
2. apps/api/package.json: manifest del backend. scripts sono comandi con un nome; devDependencies sono strumenti di sviluppo, non funzionalità dell'app.
3. apps/api/tsconfig.json: regole del compilatore TypeScript. strict abilita controlli rigorosi; noEmit nel comando controlla i tipi senza generare file JavaScript.
4. apps/api/jest.config.cjs: configurazione di Jest. ts-jest traduce i file .ts per eseguirli.
5. package.json alla radice: scorciatoie per lavorare dalla cartella principale.
6. .gitignore: evita di versionare dipendenze, output e credenziali locali.

Il lockfile generato fissa le versioni effettivamente risolte. node_modules contiene librerie scaricate: non è codice da studiare o modificare.

## Ripetere in VS Code su questo PC
Aprire Terminal > New Terminal nella cartella principale del progetto. Il runtime dell'agente non è necessariamente presente nel PATH del terminale VS Code. Per questa sessione PowerShell:

```powershell
$env:Path = 'C:\Users\matte\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\matte\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;' + $env:Path
node --version
pnpm.cmd --version
pnpm.cmd check
```

La modifica PATH vale solo per quel terminale: permette di trovare gli eseguibili già forniti da Codex. Non modifica la configurazione globale di Windows. Questi percorsi dipendono dal runtime installato su questo PC; per condividere il progetto basteranno Node e pnpm compatibili, senza quei percorsi personali.

check prima esegue typecheck e poi test. Risultato atteso: controllo tipi senza errori e una test suite con un test PASS. Un comando termina con codice 0 quando riesce.

## Piccolo esercizio facoltativo
Nel test cambia toBe(5) in toBe(6), salva e ripeti pnpm.cmd test: il test deve fallire mostrando atteso 6 e ottenuto 5. Ripristina toBe(5) e riesegui. Non occorre svolgere l'esercizio per procedere; serve a distinguere un test che passa da uno che rileva un errore.

## Limiti di questo incremento
Il test dimostra solo che configurazione e strumenti funzionano. Non verifica ancora privacy, versioning o offline. src/ è vuota: nessun server, UI o database avviato. La fase 1 introdurrà la prima regola temporale.

## Verifica
Verifica eseguita: Node 24.19.0, pnpm 11.19.0, TypeScript 5.9.3, Jest 30.5.2, ts-jest 29.4.14. pnpm check termina con codice 0: controllo tipi OK, 1 suite e 1 test PASS.
Il download iniziale ha richiesto accesso rete autorizzato. pnpm ha richiesto una scelta sugli script di build di due dipendenze transitive: sono stati disabilitati in apps/api/pnpm-workspace.yaml perché non necessari per questa configurazione, come verificato dal test. Quel file riguarda pnpm, non i moduli di business.
Per ricreare le dipendenze dal lockfile: dalla radice eseguire `pnpm.cmd --dir apps/api install --frozen-lockfile --store-dir .pnpm-store`, poi `pnpm.cmd check`. Sul PC corrente le dipendenze sono già presenti. Reinstallazione offline con lo stesso store verificata con codice 0.
La radice e il backend hanno manifest separati: il lockfile principale al momento non contiene dipendenze; quello del backend contiene gli strumenti di test.
