# Contratti HTTP — NutriTrack
Il controller è in [app.controller.ts](../apps/api/src/composition/app.controller.ts). Queste API del browser sono distinte dalle chiamate interne tra moduli. Il prefisso è /api. Corpo JSON; timestamp in ingresso ISO 8601 con Z o offset esplicito, in uscita millisecondi UTC.

## Autenticazione e errori
POST /auth/login accetta email/password e restituisce user (id,email,name,role) e csrfToken, oltre a un cookie sessione HttpOnly. GET /auth/me recupera il principal e il token dopo un reload. Nessun ID attore arbitrario in un comando sostituisce il principal server.
Le mutazioni autenticate richiedono `X-CSRF-Token`. Le risposte API usano `Cache-Control: no-store`. Le richieste di recupero valide restituiscono lo stesso risultato anche quando l’indirizzo non è registrato. Il reset usa un token monouso valido 30 minuti e revoca le sessioni dell’account.

Gli errori restituiscono `{code,message}`. I codici comprendono 400 per validazione, 401 per sessione assente, 403 per autorizzazione o CSRF, 404 per risorsa assente, 409 per conflitto, 413 per foto troppo grande, 429 per limite richieste e 503 se il servizio email è privo di configurazione. POST restituisce 201 salvo i codici indicati di seguito. GET, PATCH, PUT e DELETE restituiscono 200 in caso di successo.

## Endpoint
| Metodo e percorso dopo /api | Corpo/parametri | Risultato e autorizzazione |
|---|---|---|
| POST /auth/login | email,password | user,csrfToken e cookie; login online |
| POST /auth/register | `name`, `email`, `password`, `role` | `{user}`. Registrazione pubblica come `PATIENT` o `NUTRITIONIST`. |
| POST /auth/forgot-password | `email` | 202 `{ok:true}`. Invia un link quando l’account esiste e il servizio è configurato. |
| POST /auth/reset-password | `token`, `password` | 200 `{ok:true}`. Aggiorna la password e revoca le sessioni. |
| GET /auth/me | — | user,csrfToken da sessione valida |
| POST /auth/logout | — | ok; token CSRF |
| GET /profile | — | Profilo del paziente autenticato. Ai campi pubblici dell’account aggiunge `birthDate` e `heightCm`, entrambi nullable. |
| PATCH /profile | `name`, `email`, `birthDate` (YYYY-MM-DD), `heightCm`, `currentPassword` | Campi modificabili anche singolarmente. La password attuale è richiesta per cambiare email. Restituisce il profilo aggiornato. |
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
| POST /progress | `operationId`, `timestamp`, `type`, `value`, `unit` | Misurazione del paziente. `WEIGHT` richiede `KG`. `ARM_CIRCUMFERENCE` e `TORSO_CIRCUMFERENCE` richiedono `CM`. |
| GET /progress/photos | — | Elenco dei metadati delle foto del paziente autenticato. |
| POST /progress/photos | `operationId`, `timestamp`, `dataUrl` | Metadati della foto salvata. JPEG, PNG o WebP fino a 2 MiB per foto, con un massimo di 50 foto per paziente. |
| GET /progress/photos/:id | — | Immagine binaria con il `Content-Type` del formato, disponibile solo al proprietario. |
| DELETE /progress/photos/:id | — | `{deleted:true}`. Solo il proprietario può cancellare la foto. |

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
