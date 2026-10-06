# Fase 1 — Versione valida al momento del consumo
Completata il 2026-10-05. Una regola di dominio, senza database o server.

## Obiettivo e risultato
Risolvere la versione di un Patient a consumptionTime, applicando ADR-002/007/021 e BR-03/07. V3 valida dall'1 ottobre alle 00:00 UTC fino al 5 ottobre alle 14:00 UTC; v4 valida dalle 14:00 in avanti. Alle 12:00 si ottiene v3, alle 14:00 v4. createdAt e sync time non entrano nella ricerca.

## Ordine di lettura
1. apps/api/src/modules/meal-planning/domain/meal-plan-version-period.ts: forma minima dei dati. interface non crea oggetti né tabelle; definisce i campi ammessi da TypeScript. readonly limita le assegnazioni nel codice, non congela oggetti a runtime. Usiamo numeri primitivi per gli istanti, evitando Date mutabili.
2. apps/api/src/modules/meal-planning/domain/resolve-version-at.ts: import del tipo, classe errore e funzione. export rende utilizzabile la dichiarazione da altri file; non significa ancora contratto pubblico cross-module. Il futuro application layer di MealPlanning userà questa funzione interna.
3. apps/api/tests/resolve-version-at.spec.ts: esempi verificabili. I commenti spiegano Date.parse, optional chaining, copia array e toThrow.

## Algoritmo passo per passo
- Riceve lista versioni, Patient e istante del consumo, senza leggere l'orologio.
- Respinge istante non finito (NaN/Infinity) con RangeError: controllo dell'input tecnico.
- Inizializza il candidato a null, che significa nessun risultato.
- Scorre la lista e ignora versioni di altri Patient. Questo filtro non è un controllo di autorizzazione: quello appartiene al futuro application layer.
- Verifica che gli intervalli del Patient abbiano inizio finito e fine nulla oppure finita e successiva all'inizio.
- Un intervallo comprende l'istante quando from <= time e (until è null oppure time < until).
- Se trova un candidato lo conserva; se ne trova un secondo solleva MealPlanTimelineError.
- Restituisce il candidato o null. Non modifica gli input e non dipende dal loro ordine.

## Simboli incontrati
number | null è un'unione di tipi; !== confronta valori diversi senza conversione implicita; && significa entrambe le condizioni, || almeno una. continue passa all'elemento successivo; throw interrompe la normale esecuzione con un errore. La stringa con backtick e ${...} inserisce un valore nel messaggio.

## Eseguire e studiare
Dalla cartella principale, con il PATH predisposto nella fase 0: `pnpm.cmd check`. Risultato verificato: typecheck OK, 2 suite e 9 test PASS (8 nuovi casi e la prova ambiente della fase 0).
Solo questa suite: `pnpm.cmd --dir apps/api test -- resolve-version-at`.
Esercizio facoltativo: cambiare nel resolver consumptionTime < version.validUntil in <=. Il test al confine deve fallire perché risultano valide entrambe le versioni. Ripristinare < dopo la prova.

## Confini del lavoro
MealPlanVersionPeriod è una proiezione temporale, non il MealPlanVersion completo: non include ancora cibo, parent o ChangeSet. La funzione riceve una lista e non verifica che sia lo storico completo. Segnala sovrapposizioni all'istante cercato, non certifica l'intera timeline. Creazione atomica e vincoli database garantiranno l'invariante globale nei passi successivi.
La funzione non vieta istanti futuri: risolve matematicamente la timeline ricevuta. La validazione delle registrazioni rispetto al tempo server appartiene al caso recordMeal. I timestamp HTTP con offset saranno convertiti al confine dell'applicazione; qui arrivano già come numeri.
MealPlanTimelineError rappresenta dati temporali incoerenti, non il conflitto baseVersion previsto per la modifica del piano. Mapping al contratto/HTTP rinviato.

## Prossimo incremento
Creare una nuova versione dalla base corrente, mantenendo il contenuto storico e rilevando una base obsoleta. Non iniziato in questa fase.
