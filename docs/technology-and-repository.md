# Scelta technology stack e repository
Stato: stack e struttura confermati dall'utente il 2026-10-05 (ADR-020); nessun pacchetto installato o skeleton creato.

## Criteri
Prima valutare vincoli del corso, competenze, web/mobile, tempo disponibile e deployment. Lo stack deve supportare: contratti modulari, test di dominio senza rete, transizione atomica delle versioni, controlli server di privacy e associazione, coda offline con timestamp preservato.

## Raccomandazione nel contesto dell'utente
Nessuna esperienza precedente o vincolo del professore; preferenza per tecnologie diffuse e complessità contenuta. Scelta confermata: web responsive, TypeScript unico linguaggio applicativo, React + Vite per UI, Node.js + NestJS per backend modulare, PostgreSQL per persistenza e IndexedDB per coda/cache offline. Auth, accesso al database e test runner da completare nella scelta tecnica successiva.
Motivo: un linguaggio comune riduce cambi di contesto; moduli e dependency injection rendono esplicite le interfacce; una persistenza transazionale è adatta alla pubblicazione versioni. Scelta ora approvata dall'utente; le alternative sotto conservano le motivazioni del confronto.

| Opzione | Quando preferirla | Costo progettuale |
|---|---|---|
| TypeScript + React + NestJS | Familiarità JS/TS, prodotto web | Framework backend e offline locale da apprendere/progettare |
| Java + backend modulare + UI web | Java richiesto dal corso o già noto | Due ecosistemi se UI usa TypeScript |
| Firebase Auth / Firestore come adapter | Esperienza Firebase e vantaggio operativo concreto | Non delegare a sync automatico invarianti del dominio |
| Client mobile | Mobile richiesto o competenze già presenti | Lifecycle e storage del dispositivo; stack da rivalutare |

Firebase era un esempio nella fonte. Firestore offre cache e sincronizzazione offline, ma le transazioni client falliscono offline: ciò non risolve automaticamente il versioning storico né la pubblicazione coerente.
Fonti ufficiali consultate il 2026-10-05:
- [React e TypeScript](https://react.dev/learn/typescript)
- [NestJS modules](https://docs.nestjs.com/modules)
- [Firestore offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

## Repository proposta (solo schema documentale)
```text
README.md
docs/
apps/
  web/                     UI, cache e coda locale
  api/
    modules/
      identity/
      patient-management/
      meal-planning/
      diary/
      progress/
    composition/           wiring e bootstrap
packages/
  transport-contracts/     eventuali DTO pubblici, niente repository
```
Dentro ogni modulo backend: public/ (facade e DTO), domain/, application/, infrastructure/. Solo public/ è importabile da altri moduli. Gli adapter di persistenza rimangono nel modulo proprietario.
Un'unica repository facilita documentazione, verifiche e modifica coordinata; non implica microservizi o pubblicazione autonoma di ogni cartella.
Non creare un shared/ generico in cui accumulare entity e repository. Condivisione limitata a primitive tecniche realmente comuni.
Alternativa per un singolo backend: src/modules/ invece di apps/api/. Scelta finale dipende da piattaforma e stack.

## Gate per iniziare il codice con Codex
1. Baseline completa con prima fase fornita dall'utente (concluso).
2. Stack e struttura confermati; completare auth.
3. Privacy, associazione e scope offline confermati (ADR-022); temporalità e sync definiti come affinamenti tecnici (ADR-021).
4. Primo incremento: confini modulari e regole di dominio; avvio codice da dichiarare dopo chiusura delle regole residue.
5. Registrare decisioni nuove (ADR-020 e successive), aggiornare notebook.

Quando questi punti sono concordati, dichiarare esplicitamente: “Ora iniziamo l'implementazione con Codex”. Primo lavoro: skeleton dei confini modulari e verifiche mirate, seguito dai primi use case. Ora restiamo alla documentazione.

## Motivazione e complessità residua
React costruisce la UI; Vite prepara/esegue il frontend durante sviluppo. Node.js esegue il backend; NestJS organizza moduli e dipendenze. Un solo linguaggio riduce il carico iniziale.
NestJS richiede di imparare moduli e injection, ma offre convenzioni utili ai cinque confini già progettati. Un framework minimale richiederebbe più convenzioni da definire manualmente. È una valutazione di adeguatezza, non una classifica di popolarità.
PostgreSQL supporta transazioni: la pubblicazione deve chiudere la vecchia versione e controllare baseVersion in modo atomico. Il database da solo non garantisce BR-03/11: occorrono vincoli e controllo concorrenza progettati.
Offline rimane delicato con ogni stack: partire da pasti e measurements in coda locale; non introdurre editing offline dei piani senza requisito.
Non servono microservizi, Kafka, orchestratori, SSR né un tool monorepo ulteriore.

## Struttura raccomandata
Una repository con docs/, apps/web/ e apps/api/. Omettere inizialmente packages/transport-contracts; introdurla solo per condivisione concreta. In apps/api/src/modules/ tenere cinque moduli con domain/, application/, infrastructure/ e un public entry point. Repository privati. Test per comportamento vicino al modulo. Nessuna cartella di codice creata ora.

## Fonti aggiuntive
- [Vite e template React/TypeScript](https://vite.dev/guide/)
- [PostgreSQL: transazioni](https://www.postgresql.org/docs/18/tutorial-transactions.html)

## Chiusura dello stack
ADR-024: autenticazione email/password con sessione server e store persistente PostgreSQL nel modulo Identity, cookie HttpOnly e protezione CSRF; Prisma per gli adapter database; Jest backend e Vitest frontend. Nessun provider esterno o package monorepo aggiuntivo richiesto.
ADR-023 chiude peso iniziale, attivazione immediata, rinvio correzioni e sharing al cambio Nutritionist. Le decisioni per lo skeleton sono chiuse: il prossimo passo è l'implementazione con Codex. Questa fase ha aggiornato solo documentazione.
