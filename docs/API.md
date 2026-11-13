# Contratti HTTP — NutriTrack
Il controller è in [app.controller.ts](../apps/api/src/composition/app.controller.ts). Queste API del browser sono distinte dalle chiamate interne tra moduli. Il prefisso è /api. Corpo JSON; timestamp in ingresso ISO 8601 con Z o offset esplicito, in uscita millisecondi UTC.

## Autenticazione e errori
POST /auth/login accetta email/password e restituisce user (id,email,name,role) e csrfToken, oltre a un cookie sessione HttpOnly. GET /auth/me recupera il principal e il token dopo un reload. Nessun ID attore arbitrario in un comando sostituisce il principal server.
Le mutazioni autenticate richiedono `X-CSRF-Token`. Le risposte API usano `Cache-Control: no-store`. Le richieste di recupero valide restituiscono lo stesso risultato anche quando l’indirizzo non è registrato. Il reset usa un token monouso valido 30 minuti e revoca le sessioni dell’account.

Gli errori restituiscono `{code,message}`. I codici comprendono 400 per validazione, 401 per sessione assente, 403 per autorizzazione o CSRF, 404 per risorsa assente, 409 per conflitto, 413 per foto troppo grande, 429 per limite richieste e 503 se il servizio email è privo di configurazione oppure se il database non è raggiungibile (`ServiceUnavailable`, con header `Retry-After: 5`). Ogni risposta porta l’header `X-Request-Id`, lo stesso presente nei log del server. POST restituisce 201 salvo i codici indicati di seguito. GET, PATCH, PUT e DELETE restituiscono 200 in caso di successo.

## Endpoint
| Metodo e percorso dopo /api | Corpo/parametri | Risultato e autorizzazione |
|---|---|---|
| POST /auth/login | email,password | user,csrfToken e cookie; login online |
| POST /auth/register | `name`, `email`, `password`, `role` | `{user}`. Registrazione pubblica come `PATIENT` o `NUTRITIONIST`. |
| POST /auth/forgot-password | `email` | 202 `{ok:true}`. Invia un link quando l’account esiste e il servizio è configurato. |
| POST /auth/reset-password | `token`, `password` | 200 `{ok:true}`. Aggiorna la password e revoca le sessioni. |
| GET /health/live | — | 200 `{status:"ok"}`. Il processo risponde; nessun accesso al database. Senza autenticazione |
| GET /health/ready | — | `{status, checks:{database:{status,latencyMs}, mail:{status}}}`. 200 con `ok` o `degraded` (componente secondario giù); 503 con `down` se il database non risponde entro 1 s. Senza autenticazione |
| GET /auth/me | — | user,csrfToken da sessione valida |
| POST /auth/logout | — | ok; token CSRF |
| GET /profile | — | Profilo del paziente autenticato. Ai campi pubblici dell’account aggiunge `birthDate` e `heightCm`, entrambi nullable. |
| PATCH /profile | `name`, `email`, `birthDate` (YYYY-MM-DD), `heightCm`, `currentPassword` | Campi modificabili anche singolarmente. La password attuale è richiesta per cambiare email. Restituisce il profilo aggiornato. |
| GET /patients | — | Nutritionist: Patient associati; Patient: Nutritionist attivo |
| GET /patients/invitations | — | Inviti pending pertinenti al principal, con nome ed email di entrambe le parti (`nutritionistEmail`, `patientEmail`) |
| POST /patients/invitations | email Patient | Invito; solo Nutritionist. Risponde sempre `202 { ok, message }`, anche per email sconosciute o pazienti già associati, per non rivelare quali account esistono. Massimo 20 richieste al minuto per IP |
| POST /patients/invitations/:id/accept | — | Associazione; solo Patient destinatario, massimo una attiva. Chiude un eventuale piano rimasto aperto da una relazione precedente |
| POST /patients/invitations/:id/close | — | Il Patient rifiuta un invito ricevuto, il Nutritionist ritira un invito inviato |
| POST /patients/:patientId/end | — | Il paziente o il nutrizionista associato chiude l’associazione e la versione attiva del piano (ADR-038). |
| GET /plans/:patientId | — | Versione attiva o null; accesso proprio/assegnato |
| GET /plans/:patientId/history | — | Versioni complete con parent e ChangeSet. Il Nutritionist vede solo le versioni create dall’inizio della propria associazione |
| POST /plans/:patientId | baseVersionId,content | Nuova versione; solo Nutritionist assegnato; base null alla prima creazione |
| GET /diary/:patientId | from/to opzionali | Entry in [from,to); Nutritionist richiede anche sharing |
| POST /diary | operationId,consumptionTime,actualConsumption | Entry del Patient autenticato; versione determinata dal server. Il retry di un pasto poi corretto o eliminato restituisce lo stato attuale senza ripristinarlo |
| PATCH /diary/entries/:id | `consumptionTime`, `actualConsumption` (anche singolarmente) | Correzione del proprio pasto; versione del piano ricalcolata; aggiunge `updatedAt` |
| DELETE /diary/entries/:id | — | Eliminazione del proprio pasto: resta un segnaposto senza contenuto, escluso da letture ed esportazioni |
| GET /sharing | — | enabled del proprio diario; solo Patient |
| PUT /sharing | enabled booleano | Preferenza globale corrente; online |
| GET /progress/:patientId | from/to opzionali | Measurements; nessun consenso diary richiesto all'assegnato |
| POST /progress | `operationId`, `timestamp`, `type`, `value`, `unit` | Misurazione del paziente. `WEIGHT` richiede `KG`. `ARM_CIRCUMFERENCE` e `TORSO_CIRCUMFERENCE` richiedono `CM`. |
| GET /progress/photos | — | Elenco dei metadati delle foto del paziente autenticato. |
| POST /progress/photos | `operationId`, `timestamp`, `dataUrl` | Metadati della foto salvata. JPEG, PNG o WebP fino a 2 MiB per foto, con un massimo di 50 foto per paziente. |
| GET /progress/photos/:id | — | Immagine binaria con il `Content-Type` del formato, disponibile solo al proprietario. |
| DELETE /progress/photos/:id | — | `{deleted:true}`. Solo il proprietario può cancellare la foto. |
| PATCH /progress/measurements/:id | `value`, `timestamp` (anche singolarmente) | Correzione della propria misurazione, con gli stessi limiti di plausibilità |
| DELETE /progress/measurements/:id | — | Eliminazione della propria misurazione (segnaposto, come per il diario) |
| PATCH /account/password | `currentPassword`, `newPassword` | Entrambi i ruoli. Mantiene la sessione corrente e revoca le altre. Massimo 10 tentativi al minuto per IP |
| GET /account/export | — | JSON scaricabile con tutti i dati personali dell’account (senza credenziali) |
| POST /account/delete | `password` | Eliminazione definitiva confermata dalla password. Patient: cancella piani, diario, misure, foto, inviti e associazioni. Nutritionist: chiude associazioni e inviti, i pazienti conservano lo storico. Massimo 10 tentativi al minuto per IP |

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
