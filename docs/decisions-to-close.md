# Decisioni prima dell'implementazione
Data: 2026-10-05. Stack e repository confermati dall'utente. Privacy, sharing storico, associazione e scope offline confermati dall'utente; peso iniziale, attivazione immediata, rinvio correzioni e nuova scelta sharing al cambio Nutritionist sono stati confermati nella seconda risposta.

## Scelte di prodotto confermate
| Tema | Proposta | Motivazione / conseguenza |
|---|---|---|
| Privacy iniziale | sharingEnabled=false | Il Patient sceglie esplicitamente di condividere il diario. |
| Estensione sharing | Tutto il diario, anche storico | Una sola policy globale; la UI deve spiegare che l'attivazione rende visibili anche i pasti precedenti. |
| Revoca | Blocca letture successive; non cancella entry | Non può ritirare informazioni già viste o esportate. Nessuna cache offline del diario dei pazienti sul client Nutritionist nella prima versione. |
| Associazione | Patient ha 0..1 Nutritionist attivo; Nutritionist ha 0..* Patient | Confine di autorizzazione semplice; invito e accettazione Patient online. |
| Cambio Nutritionist | Chiudere vecchia associazione e azzerare sharing | Non trasferire automaticamente la scelta di condivisione a una persona diversa. Nuovo consenso esplicito. Flusso di trasferimento rinviato, non cancellazione dei dati storici. |
| Offline supportato | Patient consulta cache propria e registra pasti/misurazioni | Creazione/modifica piani, associazioni e privacy online. Primo login richiede rete. Nessuna nuova autorizzazione derivata dalla cache. |
| Correzioni dati | Confermare per ora solo creazione/lettura | Modifica/cancellazione di entry e measurements non sono specificate dalla baseline; proposta di rinviarle, mantenendo un backlog esplicito. |
| Measurements iniziali | Peso in kg | Type/unit estensibili; niente altre metriche finché non servono. Valore positivo, finito; nessuna soglia clinica inventata. |
| Attivazione piani | Immediata sul server | Nessuna attivazione retroattiva o pianificata nella prima versione: non alterare intervalli storici già risolti. |

Confermati: privacy iniziale, sharing globale/storico, associazione accettata con un Nutritionist attivo, scope offline. Confermati anche peso iniziale, attivazione immediata, rinvio correzioni e nuova scelta sharing al cambio Nutritionist (ADR-023). Nessuna risposta implicita al trascorrere del tempo.

## Decisioni tecniche adottate come affinamenti progettuali
- Tempo: istanti UTC, API con offset esplicito; UI converte al fuso locale. Validità [validFrom, validUntil), estremo finale escluso. All'istante del cambio si applica la nuova versione. validUntil=null significa intervallo aperto.
- Il server assegna l'istante di attivazione. consumptionTime resta quello inserito dal Patient; date future sono respinte rispetto al tempo server, senza correggere silenziosamente il dato. Gestione messaggio/clock errato da definire nell'interfaccia.
- MealPlanning pubblica una versione in un'unica transazione: protegge lo stato del Patient, verifica baseVersion, chiude precedente intervallo, salva nuovo contenuto/ChangeSet e aggiorna corrente. Anche creazione iniziale usa lo stesso vincolo per Patient.
- Nuova versione da base obsoleta: conflitto esplicito e ricaricamento; nessuna fusione automatica del piano.
- Il trasporto di ogni operazione locale include operationId stabile. Retry dello stesso ID e stesso payload restituisce l'esito già confermato; stesso ID con payload diverso è conflitto. Registrazione dell'esito e scrittura di dominio devono essere atomiche nel modulo proprietario. Non usare last-write-wins per dati confermati.
- operationId e stato sync sono metadati tecnici, distinti dagli input del contratto di dominio. Il server non accetta mealPlanVersionId dal client.
- Operazione locale può avere associazione UNRESOLVED; solo dopo conferma server diventa RESOLVED(versionId) o RESOLVED_NO_PLAN. Null non significa contemporaneamente 'non verificato' e 'nessun piano'.
- Auth scaduta al sync: coda conservata, nuovo login e poi nuova verifica. Errore transitorio: retry con attesa crescente; validazione/conflitto: intervento esplicito, niente retry infinito.
- Cache e coda separate per account. Al logout non perdere operazioni pending: avviso e scelta esplicita; dati locali non accessibili al prossimo account. Dettaglio protezione storage da verificare nell'implementazione.
- Eventi in process dopo commit per reazioni non critiche. Nessuna promessa di consegna durevole: una reazione che diventa critica richiede una nuova ADR e garanzia appropriata.

## Completamento tecnico adottato (ADR-024)
Autenticazione: email/password con sessione server e cookie HttpOnly; credenziali e sessioni nel modulo Identity. Richiede hashing tramite libreria consolidata, protezione CSRF, revoca e persistenza sessioni. Nessun nuovo servizio cloud necessario per l'esame. Librerie concrete da scegliere e verificare prima dell'implementazione auth.
Accesso database: Prisma come adapter privato ai repository; non esporre tipi generati nei public contracts. Migrazioni SQL possono essere necessarie per vincoli temporali. Versioni e compatibilità da fissare al bootstrap, non sulla base di esempi di versioni diverse.
Test: test di dominio/application con fake; integrazione PostgreSQL per concorrenza e atomicità; test HTTP per autorizzazione; scenario offline per retry e associazione storica. Runner: Jest nel backend, Vitest nel frontend; rispettare le convenzioni dei rispettivi framework, senza tool monorepo aggiuntivo.
Deployment: iniziare in locale con dati dimostrativi; hosting, account esterni e pubblicazione si decidono quando esiste un incremento funzionante.

## Ordine del lavoro
1. Confermare regole di prodotto e aggiornare specifiche/ADR.
2. Chiudere auth e dettagli minimi di gestione pazienti e measurement.
3. Dichiarare esplicitamente l'avvio implementazione con Codex.
4. Skeleton dei cinque moduli, repository fake e regole temporali/privacy.
5. Adapter PostgreSQL e test di pubblicazione concorrente; poi UI e offline.

Nessun codice applicativo creato in questa fase.

## Pronti al primo incremento
Le decisioni necessarie al domain skeleton sono chiuse. Prima di collegare auth reale si definiranno provisioning account, reset password e limiti sessione; per la demo si potranno predisporre account dimostrativi con ruoli assegnati dal sistema. Nessuna registrazione autonoma come Nutritionist senza policy esplicita. Questi dettagli non richiedono nuovi ruoli o provider e non impediscono il primo incremento con repository fake.
Il prossimo passo è l'implementazione con Codex: skeleton modular-monolith, contratti e prime regole verificabili. Il codice non è stato avviato in questo aggiornamento documentale.

Fonti tecniche: [NestJS sessioni](https://docs.nestjs.com/http/session), [PostgreSQL range e vincoli](https://www.postgresql.org/docs/current/rangetypes.html), [Prisma transazioni](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions). Le API concrete dipendono dalla versione che verrà verificata e fissata al bootstrap.
