# Contratti HTTP — NutriTrack
Il controller è in [app.controller.ts](../apps/api/src/composition/app.controller.ts). Queste API del browser sono distinte dalle chiamate interne tra moduli. Il prefisso è /api. Corpo JSON; timestamp in ingresso ISO 8601 con Z o offset esplicito, in uscita millisecondi UTC.

## Autenticazione e errori
POST /auth/login accetta email/password e restituisce user (id,email,name,role) e csrfToken, oltre a un cookie sessione HttpOnly. GET /auth/me recupera il principal e il token dopo un reload. Nessun ID attore arbitrario in un comando sostituisce il principal server.
Le mutazioni successive richiedono X-CSRF-Token; cookie inviato same-origin. Le risposte API sono no-store. Logout revoca la sessione. Nessuna API pubblica di provisioning: usare account:create/seed nel runbook.
Errore JSON: {code,message}. HTTP400 = validazione; 401 = login necessario; 403 = diniego/CSRF; 404 = risorsa assente; 409 = conflitto; 429 = limite tentativi. Non confondere un403 con una lista vuota autorizzata. POST riusciti restituiscono201, PUT200, GET200.

## Endpoint
| Metodo e percorso dopo /api | Corpo/parametri | Risultato e autorizzazione |
|---|---|---|
| POST /auth/login | email,password | user,csrfToken e cookie; login online |
| GET /auth/me | — | user,csrfToken da sessione valida |
| POST /auth/logout | — | ok; token CSRF |
| GET /patients | — | Nutritionist: Patient associati; Patient: Nutritionist attivo |
| GET /patients/invitations | — | Inviti pending pertinenti al principal |
| POST /patients/invitations | email Patient | Invito; solo Nutritionist |
| POST /patients/invitations/:id/accept | — | Associazione; solo Patient destinatario, massimo una attiva |
| POST /patients/:patientId/end | — | Chiusura; Patient proprio o Nutritionist assegnato |
| GET /plans/:patientId | — | Versione attiva o null; accesso proprio/assegnato |
| GET /plans/:patientId/history | — | Versioni complete con parent e ChangeSet |
| POST /plans/:patientId | baseVersionId,content | Nuova versione; solo Nutritionist assegnato; base null alla prima creazione |
| GET /diary/:patientId | from/to opzionali | Entry in [from,to); Nutritionist richiede anche sharing |
| POST /diary | operationId,consumptionTime,actualConsumption | Entry del Patient autenticato; versione determinata dal server |
| GET /sharing | — | enabled del proprio diario; solo Patient |
| PUT /sharing | enabled booleano | Preferenza globale corrente; online |
| GET /progress/:patientId | from/to opzionali | Measurements; nessun consenso diary richiesto all'assegnato |
| POST /progress | operationId,timestamp,type,value,unit | Measurement del Patient; type WEIGHT, unit KG |

## Contenuto piano di esempio
```json
{
  "baseVersionId": null,
  "content": {
    "meals": [{
      "name": "Colazione",
      "options": [{ "foods": [{ "food": "Avena", "quantity": 80, "unit": "g" }] }]
    }]
  }
}
```
La successiva modifica invia baseVersionId restituito dalla lettura e un nuovo contenuto completo. Il server calcola il diff; non accetta validFrom/validUntil scelti dal client. Base superata -> MealPlanVersionConflict, ricaricamento richiesto. PublicationBusy è il caso raro di due attivazioni nello stesso millisecondo: attendere e ricaricare.

## Diario e riconciliazione
```json
{
  "operationId": "5c20219d-6ce0-49d3-9098-719d439be55c",
  "consumptionTime": "2026-10-05T12:00:00Z",
  "actualConsumption": "Pasta 80g e verdure"
}
```
Il client genera operationId una volta e lo conserva al retry. Stesso proprietario/ID/payload -> stessa entry; payload diverso -> OperationConflict409. mealPlanVersionId in ingresso è vietato. In uscita null significa assenza di piano confermata; una registrazione locale non inviata è invece irrisolta.

## Perimetro del contratto
Non esistono endpoint di cancellazione/modifica consumi o measurements, analytics, AI, pagamenti o chat. Il trasporto non garantisce un'esecuzione distribuita exactly-once: garantiamo un solo effetto del comando confermato mediante deduplicazione nella transazione del modulo.
