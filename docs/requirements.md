# Requirements — Design Baseline v1
Fonte: prima fase fornita dall'utente il 2026-10-05, integrata con decisioni successive. Identificativi originali conservati.

## Project scope
NutriTrack consente ai Nutritionist di creare ed evolvere piani personalizzati e ai Patient di consultarli, registrare consumi reali e sincronizzare attività dopo periodi offline. Preserva consistenza storica con versioning e ownership esplicita.
Patient: piano attivo, diario proprio, consumi, misurazioni, offline supportato e controllo sharing.
Nutritionist: pazienti associati, creazione/modifica versionata piani, monitoraggio progressi, lettura diario solo se condiviso.
Nessun Admin senza nuovo requisito concreto.

Fuori scope iniziale: pagamenti, videochiamate, piani generati da AI, riconoscimento cibo da immagini, social network, chat, wearable, ordini automatici della spesa. Frigorifero/inventario escluso dal core; riesame solo per valore architetturale concreto.

## Functional requirements
| ID | Requisito |
|---|---|
| FR-01 | Autenticare gli utenti. |
| FR-02 | Distinguere Patient/Nutritionist e autorizzare le operazioni secondo ruolo. |
| FR-03 | Nutritionist gestisce pazienti associati. |
| FR-04 | Nutritionist crea piano per Patient associato. |
| FR-05 | Patient consulta piano attivo. |
| FR-06 | Modifica piano attivo genera nuova MealPlanVersion senza sovrascrittura. |
| FR-07 | Conservare storico versioni. |
| FR-08 | Patient registra consumi reali nel diario. |
| FR-09 | Entry associata permanentemente alla versione valida a consumptionTime, indipendentemente dal sync; se nessuna versione è valida riferimento opzionale. |
| FR-10 | Patient consulta storico diario proprio. |
| FR-11 | Nutritionist consulta diario solo di Patient associato con sharing abilitato. |
| FR-12 | Patient registra progress measurements. |
| FR-13 | Patient esegue operazioni offline supportate durante perdita temporanea di rete. |
| FR-14 | Sync modifiche locali al ritorno della rete. |
| FR-15 | Rilevare e gestire conflitti sync. |
| FR-16 | Patient abilita/disabilita sharing diario con Nutritionist assegnato. |

## Business rules
| ID | Regola |
|---|---|
| BR-01 | Nutritionist accede/modifica solo dati dei Patient associati, rispettando privacy di dominio. |
| BR-02 | Patient accede solo ai propri dati privati. |
| BR-03 | Al massimo una versione attiva per Patient e istante. |
| BR-04 | Versione attiva non modificabile in place. |
| BR-05 | Modifica piano attivo genera nuova versione. |
| BR-06 | Versioni precedenti restano disponibili per consistenza storica. |
| BR-07 | Entry usa versione valida a consumptionTime, non a creazione/sync. |
| BR-08 | Sync non compromette dati server già confermati. |
| BR-09 | Conflitti locale/remoto gestiti attraverso strategia deterministica. |
| BR-10 | Patient possiede diario e controlla sharing; revoca impedisce lettura Nutritionist senza modificare/cancellare entry. |
| BR-11 | Nuova versione solo dalla versione attiva; base obsoleta produce conflitto. |
Raffinamenti correnti: entry senza piano (ADR-004); privacy globale, non per entry (ADR-005); measurements visibili al Nutritionist assegnato (ADR-019); contenuti di versioni attivate immutabili (ADR-006); sistema determina associazione storica (ADR-016).

## Non-functional / architectural requirements
| ID | Requisito |
|---|---|
| NFR-01 | Backend diviso in moduli con confini/responsabilità chiari. |
| NFR-02 | Ogni modulo controlla propri dati persistenti. |
| NFR-03 | Nessun accesso diretto a persistenza di altro modulo. |
| NFR-04 | Comunicazione cross-module via API/interfacce o eventi espliciti. |
| NFR-05 | Operazioni critiche testabili indipendentemente dalla UI. |
| NFR-06 | Consistenza tra diario storico e versione valida al consumo. |
| NFR-07 | Operazioni Patient supportate tollerano offline e sincronizzano al ritorno della rete. |
Derivano dal requisito del professore di superare una CRUD tramite modularità, ownership, versioning e sync.
Verifiche previste: controllo dipendenze/import e query; test di regole con fake repository; scenari temporalità, autorizzazione, offline e conflitto. Target numerici performance/disponibilità non definiti.

## Decisioni aperte
Operazioni concrete gestione pazienti (FR-03); default privacy; cardinalità/lifecycle associazioni; elenco operazioni offline; intervalli/timezone; idempotenza/retry e strategia deterministica conflitti (BR-08/09); modifica/cancellazione entry; tipi/unità measurements; emissione eventi e atomicità persistenza.

## Affinamenti confermati il 2026-10-05
ADR-020 conferma stack e repository. ADR-022: sharing inizialmente disabilitato, attivazione globale comprensiva dello storico; un Nutritionist attivo per Patient con accettazione Patient. FR-13/14 supportano lettura cache personale e creazione pasti/measurements offline; privacy, associazioni e piani online. ADR-021 precisa UTC, intervalli temporali e sync idempotente per BR-08/09. Vedere [registro decisioni](decisions-to-close.md) per stato delle questioni residue.

## Chiusura decisioni per il primo incremento
ADR-023 confermata: prima measurement WEIGHT in kg; nuovi piani attivati immediatamente al server, senza retrodatazione/programmazione; modifica/cancellazione pasti e measurements rinviata; al cambio Nutritionist sharing disabilitato fino a nuova scelta del Patient.
ADR-024: email/password con sessione server, cookie HttpOnly e store persistente nel modulo Identity; Prisma negli adapter privati; Jest backend e Vitest frontend. Versioni/librerie concrete verificate al bootstrap. Il primo incremento con Codex può iniziare dai contratti, regole e repository fake.
