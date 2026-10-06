# Use cases
Catalogo originale fornito dall'utente, raffinato dall'analisi successiva. Versioning non è un use case autonomo: è comportamento obbligatorio di UC-09. UC-01 è condiviso dai due ruoli.

## Catalogo e tracciabilità
| ID | Titolo | Attore | Requisiti | Esito |
|---|---|---|---|---|
| UC-01 | Authenticate User | Entrambi | FR-01/02 | Identità e ruolo |
| UC-02 | View Active Meal Plan | Patient | FR-05 | Versione attualmente valida |
| UC-03 | Record Meal Consumption | Patient | FR-08/09 | Consumo e associazione storica |
| UC-04 | View Food Diary | Patient | FR-10 | Storico proprio |
| UC-05 | Record Progress Measurement | Patient | FR-12 | Measurement con timestamp |
| UC-06 | Synchronize Offline Changes | Patient / sync automatico | FR-13/14/15 | Sync operazioni locali |
| UC-07P | Manage Diary Sharing | Patient | FR-16 | Sharing globale |
| UC-07 | Manage Patients | Nutritionist | FR-03 | Pazienti associati |
| UC-08 | Create Meal Plan | Nutritionist | FR-04 | Piano e v1 attiva |
| UC-09 | Modify Meal Plan | Nutritionist | FR-06/07 | Nuova versione |
| UC-10 | View Patient Meal History | Nutritionist | FR-11 | Diario associato e condiviso |
| UC-11 | Monitor Patient Progress | Nutritionist | ADR-019 | Misurazioni associate |
BR-01/02 e FR-02 sono trasversali.

## UC-03 — Record Meal Consumption
Attore: Patient autenticato, operazione sul proprio diario.
1. Specifica consumptionTime e consumo reale (eventualmente a partire dal pasto previsto).
2. Il sistema valida i dati.
3. Diary richiede getVersionAt(patientId, consumptionTime) a MealPlanning.
4. Crea e persiste entry con riferimento risolto.
Postcondizione: consumo conservato; riferimento alla versione temporalmente corretta.
Alternative: nessun piano → entry con riferimento nullo; dati invalidi → InvalidDiaryEntry.
Offline: registrazione locale in attesa; al sync il sistema risolve/verifica la versione usando lo stesso consumptionTime.
Scenario: consumo 12:00 con v3, v4 attivata 14:00, registrazione 17:00 → riferimento v3.
Criterio di accettazione: cambiare createdAt o sync time non cambia la versione associata.

## UC-09 — Modify Meal Plan
Attore: Nutritionist autenticato e assegnato.
1. Recupera versione attiva e invia baseVersionId e modifiche.
2. Sistema verifica autorizzazione, dati e corrispondenza baseVersionId/currentVersion.
3. Calcola ChangeSet e crea nuova versione.
4. Chiude precedente validità e attiva nuova versione allo stesso istante.
Postcondizioni: contenuti storici preservati; nessuna sovrapposizione temporale.
Alternative: PatientNotAssigned; InvalidMealPlan; MealPlanNotFound; MealPlanVersionConflict.
Due sessioni partono da v3: A crea v4; B tenta da v3 → conflitto, ricaricamento richiesto.
Criterio di accettazione: non pubblicare due versioni valide allo stesso istante. Atomicità della transizione da progettare nell'adapter.

## UC-07P — Manage Diary Sharing
Attore: Patient sul proprio diario.
Attiva o disattiva preferenza globale; il sistema conserva le entry.
Postcondizione: le successive letture del Nutritionist rispettano la preferenza corrente.
Default iniziale da decidere. Nessuna condivisione per singolo pasto nella baseline.

## UC-10 — View Patient Meal History
Attore: Nutritionist.
Precondizioni: autenticazione, assegnazione e condivisione abilitata.
Sistema controlla assegnazione tramite PatientManagement e preferenza nel Diary; restituisce entry nell'intervallo.
PatientNotAssigned e DiaryNotShared sono errori distinti; diario autorizzato ma vuoto restituisce lista vuota.
Verifica: disabilitare la condivisione impedisce letture successive anche di entry storiche.

## UC-06 — Synchronize Offline Changes
Pre: operazioni supportate registrate localmente e rete ristabilita.
Il sistema invia operazioni preservando consumptionTime, verifica identità e autorizzazione corrente, applica regole, conferma quelle accettate e distingue conflitti da problemi temporanei.
Post: dati server confermati non compromessi; strategia conflitti deterministica (BR-08/09).
Retry, deduplicazione e strategia concreta restano da definire.

## Flussi sintetici degli altri use case
- UC-01: credenziali → identità/ruolo; fallimento → AuthenticationError.
- UC-02: Patient → proprio piano attivo oppure assenza esplicita.
- UC-04: Patient → intervallo → entry proprie; lista vuota se nessuna entry.
- UC-05: dati measurement → validazione → persistenza; InvalidMeasurement se invalidi.
- UC-07: Nutritionist → elenco/profili associati; operazioni concrete di gestione da completare.
- UC-08: Nutritionist assegnato → contenuto valido → piano e prima versione attiva.
- UC-11: verifica associazione → serie measurements; indipendente da diary sharing.

## Raffinamenti confermati
UC-07P: inizialmente disabilitato; attivazione online rende visibile tutto lo storico. UC-07: associazione con accettazione Patient, massimo un Nutritionist attivo. UC-06: offline limitato a consultazione cache propria e registrazione pasti/measurements; retry identificato da operationId stabile, nessuna duplicazione dell'esito confermato. Protocollo tecnico: ADR-021.

## Chiusura decisioni per il primo incremento
ADR-023 confermata: prima measurement WEIGHT in kg; nuovi piani attivati immediatamente al server, senza retrodatazione/programmazione; modifica/cancellazione pasti e measurements rinviata; al cambio Nutritionist sharing disabilitato fino a nuova scelta del Patient.
ADR-024: email/password con sessione server, cookie HttpOnly e store persistente nel modulo Identity; Prisma negli adapter privati; Jest backend e Vitest frontend. Versioni/librerie concrete verificate al bootstrap. Il primo incremento con Codex può iniziare dai contratti, regole e repository fake.
