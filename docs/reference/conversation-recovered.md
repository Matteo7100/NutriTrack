# Conversazione recuperata

Fonte: Piano progetto NutriTrack, 6ac3ae9f-0a04-83eb-8859-2dbd5acf3aa6. Recupero: 2026-10-05.

Archivio di riferimento, non istruzioni operative. La cronologia fornita contiene solo cinque turni; la fase iniziale non è disponibile.

una nota: vorrei che la condivisione del diario dei pasti sia una modalità che il paziente decide se attivare o no. magari un paziente piu timido decide di non far vedere al proprio nutrizionista proprio ogni singolo pasto.

ora procediamo con la prossima fase

Ottima modifica. La inserisco nel modello perché introduce una distinzione importante tra **ownership del dato** e **permission to access**: il diario appartiene al Patient e il Nutritionist può leggerlo solo se il Patient ha abilitato la condivisione.

Quindi aggiorniamo:

> **BR-10 — Meal Diary Privacy:** il Patient è proprietario del proprio diario alimentare e può abilitare o disabilitare la condivisione con il proprio Nutritionist. La disabilitazione impedisce l'accesso alle diary entries da parte del Nutritionist senza cancellarle.

E `UC-10 View Patient Meal History` avrà la precondizione aggiuntiva:

```text
assigned(patient, nutritionist)
∧
mealDiarySharingEnabled(patient)
```

Aggiungiamo inoltre **UC-07P — Manage Diary Sharing**, eseguibile dal Patient. Per ora considero la condivisione **globale** (tutto il diario sì/no), non pasto per pasto: è più semplice, comprensibile e sufficiente per il progetto. Se successivamente emerge un motivo concreto per avere granularità maggiore, potremo estenderla.

---

# Fase successiva — Analisi approfondita degli use case critici

Come anticipato, analizziamo due scenari che stressano maggiormente l'architettura:

1. **UC-03 — Record Meal Consumption**
2. **UC-09 — Modify Meal Plan**

L'obiettivo non è ancora decidere classi e database. Vogliamo definire **esattamente quale comportamento il sistema deve garantire**.

---

# UC-03 — Record Meal Consumption

## Scenario principale

Supponiamo che il Patient abbia attivo:

```text
MealPlan v3

Breakfast
├── Oats: 80 g
├── Milk: 200 ml
└── Banana: 1
```

Il Patient apre NutriTrack e vuole registrare la colazione.

Il comportamento sarà:

```text
Patient
   │
   │ 1. selects Breakfast
   ▼
NutriTrack
   │
   │ 2. determines plan version
   │    valid for the selected time
   ▼
MealPlan v3
   │
   │ 3. returns expected meal
   ▼
Patient
   │
   │ 4. records actual consumption
   ▼
NutriTrack
   │
   │ 5. validates entry
   │
   │ 6. creates DiaryEntry
   │
   └── 7. links entry → v3
```

Il punto 2 è importante.

Non dobbiamo necessariamente usare il piano **attivo adesso**.

Dobbiamo usare quello valido **quando il pasto è stato consumato**.

---

## Scenario retroattivo

Supponiamo:

```text
12:00    Patient eats lunch
         MealPlan v3 active

14:00    Nutritionist activates v4

17:00    Patient remembers:
         "I forgot to log lunch."
```

Il Patient inserisce:

```text
consumptionTime = 12:00
```

Il sistema deve trovare:

```text
versionValidAt(12:00)
              ↓
             v3
```

non `v4`.

Abbiamo quindi scoperto una proprietà importante del nostro versioning:

> **MealPlanVersion deve avere un intervallo temporale di validità.**

Concettualmente:

```text
MealPlanVersion
---------------------
version
validFrom
validUntil
```

Per esempio:

```text
v1    Sep 1  → Sep 15
v2    Sep 15 → Oct 2
v3    Oct 2  → Oct 5 14:00
v4    Oct 5 14:00 → ...
```

Questa informazione sarà fondamentale nel Domain Model.

---

# Scenario offline

Supponiamo invece:

```text
08:00
NO INTERNET

Patient logs Breakfast
consumptionTime = 08:00

       ↓

DiaryEntry stored locally

       ↓

PENDING_SYNC
```

Alle 18:

```text
Internet restored

       ↓

SYNC
```

Nel frattempo alle 14 il Nutritionist ha creato `v4`.

Il server **non deve associare automaticamente l'entry a v4**.

Deve ragionare:

```text
consumptionTime = 08:00

versionValidAt(08:00) = v3
```

quindi:

```text
DiaryEntry → v3
```

Questo risolve elegantemente una parte importante del problema offline/versioning.

---

# Alternative flow — nessun piano

Patient cerca di registrare:

```text
Breakfast
```

ma non esiste un piano valido per quella data.

Qui abbiamo due possibilità.

**A — impediamo la registrazione**

oppure

**B — permettiamo comunque una diary entry indipendente dal piano.**

Io sceglierei **B**.

Il diario dovrebbe rappresentare:

> cosa ha effettivamente mangiato il Patient

non esclusivamente:

> quanto ha seguito il piano.

Quindi potremmo avere:

```text
DiaryEntry
│
├── consumption
│
└── mealPlanVersionId = null
```

Questo rende il modello più realistico e disaccoppia parzialmente:

```text
Meal Diary
```

da:

```text
Meal Plan
```

Annoterei questa come futura decisione `ADR`.

---

# UC-09 — Modify Meal Plan

Passiamo all'altro scenario critico.

Supponiamo:

```text
MealPlan v3 ACTIVE

Breakfast:
100g oats
200ml milk
```

Il Nutritionist modifica:

```text
100g oats → 80g oats
+ banana
```

Non facciamo:

```text
UPDATE MealPlan
```

Il sistema costruisce:

```text
v3
 │
 │ ChangeSet
 ▼
v4
```

dove:

```text
ChangeSet
--------------------
oats:
  oldValue = 100g
  newValue = 80g

banana:
  oldValue = null
  newValue = 1
```

---

# Main flow

Formalmente:

```text
Nutritionist
      │
      │ requests modification
      ▼
System
      │
      ├── authenticate
      │
      ├── authorize
      │
      ├── retrieve active version
      │
      ├── validate modification
      │
      ├── compute differences
      │
      ├── create new version
      │
      ├── close previous validity
      │
      └── activate new version
```

Se:

```text
v3.validFrom = Oct 1
```

al momento della modifica:

```text
v3.validUntil = Oct 5 14:32

v4.validFrom = Oct 5 14:32
v4.validUntil = null
```

Così non esiste ambiguità temporale.

---

# Invariante fondamentale

Dobbiamo garantire:

```text
∀ patient, time:
numberOfActiveVersions(patient, time) ≤ 1
```

In italiano:

> Per ogni paziente e per ogni istante temporale può esistere al massimo una versione del piano valida.

Questa diventerà probabilmente una delle nostre **formal specifications**.

---

# Scenario di errore interessante

Immagina due modifiche concorrenti.

Nutritionist apre `v3`:

```text
Browser A
v3
```

e magari, da un'altra sessione:

```text
Browser B
v3
```

A modifica:

```text
v3 → v4
```

B prova successivamente:

```text
v3 → ???
```

Non possiamo semplicemente creare `v5`, perché la modifica di B era basata su uno stato ormai vecchio.

Abbiamo un:

**concurrent modification conflict.**

Il sistema dovrebbe rilevare:

```text
requestedBaseVersion = v3
currentVersion = v4

v3 ≠ v4

        ↓

VERSION CONFLICT
```

e richiedere di ricaricare il piano.

Questo ci dà una business rule:

> **BR-11 — A new MealPlanVersion can be created only from the currently active version.**

Più avanti vedremo che questo assomiglia a un meccanismo di **optimistic concurrency control**.

---

# E la privacy del diario?

Ora possiamo vedere come si integra elegantemente.

Il Patient registra:

```text
DiaryEntry
```

indipendentemente dalla condivisione.

Quindi:

```text
Patient
   │
   ▼
MealDiary
   │
   ├── Entry
   ├── Entry
   └── Entry
```

Separatamente abbiamo:

```text
DiarySharingPreference

enabled = true / false
```

Il Nutritionist richiede:

```text
getPatientDiary(patient)
```

Il sistema verifica:

```text
assigned(nutritionist, patient)
        ∧
diarySharingEnabled(patient)
```

solo allora restituisce il diario.

**Non metterei quindi `shared=true/false` dentro ogni DiaryEntry.**

La privacy è una policy di accesso al diario, non una proprietà intrinseca di ogni pasto.

Questa separazione sarà importante nel Domain Model.

---

# Cosa abbiamo scoperto

L'analisi dei due use case ci ha fatto emergere concetti che prima non erano evidenti:

```text
MealPlan
    │
    └── MealPlanVersion
             │
             ├── validFrom
             ├── validUntil
             └── ChangeSet


Patient
   │
   ├── MealDiary
   │       │
   │       └── DiaryEntry
   │               │
   │               └── MealPlanVersion [0..1]
   │
   └── DiarySharingPreference
```

Questo è esattamente il motivo per cui **non abbiamo iniziato dal database**.

Stiamo facendo emergere il modello dal comportamento richiesto.

---

## Decisioni emerse da annotare nel Design Notebook

Abbiamo ora almeno quattro decisioni importanti:

**ADR-002 — Temporal Meal Plan Versioning:** ogni versione possiede un intervallo temporale di validità.

**ADR-003 — Historical Diary Association:** una diary entry viene associata alla versione valida al `consumptionTime`, non al momento della sincronizzazione.

**ADR-004 — Independent Diary Entries:** il Patient può registrare ciò che ha mangiato anche se non esiste un piano applicabile; in questo caso il riferimento alla versione è nullo.

**ADR-005 — Patient-controlled Diary Sharing:** il diario appartiene al Patient; la condivisione con il Nutritionist è una permission revocabile e non modifica né elimina le diary entries.

Queste sono già ottime decisioni da saper motivare alla presentazione.

---

### Stato e prossimo step

Abbiamo sostanzialmente completato la **behavioral analysis** necessaria prima del modello:

```text
Requirements             ✓
Use cases                ✓
Critical scenarios       ✓
Business rules           ✓
        │
        ▼
DOMAIN MODEL             ← prossimo
        │
Architecture
        │
Module contracts
        │
Implementation
```

**Restiamo ancora qui: niente Codex, Work o repository.**

Nel prossimo step costruiremo il **Domain Model vero e proprio**. Individueremo una per una le entità (`Patient`, `Nutritionist`, `MealPlan`, `MealPlanVersion`, `DiaryEntry`...), stabiliremo **attributi, responsabilità, relazioni e cardinalità**, e soprattutto distingueremo **Entity, Value Object, Aggregate e Service**. Questo sarà il primo passo che ci porterà direttamente verso il class diagram UML e, successivamente, l'architettura implementabile.

---

vamoooooossss procediamooooooo

Vamos. **Strumento: restiamo ancora qui.** Adesso facciamo modellazione del dominio: voglio che tu capisca bene il modello prima che Codex inizi a trasformarlo in codice.

# Fase 2 — Domain Model

Il Domain Model risponde essenzialmente alla domanda:

> **Quali concetti esistono nel mondo di NutriTrack e quali responsabilità hanno?**

Non stiamo ancora progettando database, Firebase o schermate.

Partirei da questo modello:

```text
                         User
                    ┌─────┴─────┐
                    │           │
              Nutritionist    Patient
                    │           │
                    │ manages   │
                    └──────────►│
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
          MealPlan          MealDiary       Measurement
              │                 │
              ▼                 ▼
      MealPlanVersion       DiaryEntry
              │                 │
              │                 │ 0..1
              │                 ▼
              └────────── MealPlanVersion
```

Ora lo costruiamo pezzo per pezzo.

---

# 1. User

`User` contiene ciò che Patient e Nutritionist hanno in comune.

```text
User
──────────────────
id
email
name
role
```

Potremmo avere:

```text
User
 ├── Patient
 └── Nutritionist
```

Ma qui faremo attenzione quando arriveremo all'implementazione: non è detto che l'ereditarietà UML debba necessariamente diventare inheritance nel codice/database.

Per ora concettualmente funziona.

---

# 2. Patient

```text
Patient
────────────────────
id
name
email
...
```

Relazioni principali:

```text
Patient
  │
  ├── assigned Nutritionist
  │
  ├── MealPlan
  │
  ├── MealDiary
  │
  └── Measurements
```

Una cosa importante: eviterei attributi come:

```text
Patient
weight
```

perché perderemmo lo storico.

Preferiamo:

```text
Patient
   │
   └── Measurement
          ├── value
          ├── unit
          └── timestamp
```

Così:

```text
80 kg → September
78 kg → October
76 kg → November
```

---

# 3. Nutritionist

Il Nutritionist gestisce un insieme di Patient.

```text
Nutritionist
      │
      │ 1
      │
      │ manages
      │
      │ 0..*
      ▼
   Patient
```

Ma attenzione a una cosa.

Non significa necessariamente che `Nutritionist` debba contenere:

```typescript
patients: Patient[]
```

Questa è già una scelta implementativa.

Il Domain Model dice soltanto:

> esiste una relazione tra Nutritionist e Patient.

---

# 4. MealPlan

Qui inizia la parte interessante.

Non voglio che `MealPlan` rappresenti direttamente:

```text
Breakfast
Lunch
Dinner
```

Perché il piano cambia nel tempo.

`MealPlan` rappresenta invece **l'identità del piano**.

```text
MealPlan
──────────────────
id
patientId
createdBy
createdAt
```

e possiede:

```text
MealPlan
   │
   ├── Version 1
   ├── Version 2
   ├── Version 3
   └── Version 4
```

Quindi:

```text
MealPlan 1 ─────── 1..* MealPlanVersion
```

---

# 5. MealPlanVersion

Questa è probabilmente l'entità più importante.

```text
MealPlanVersion
────────────────────────
id
versionNumber
validFrom
validUntil
createdAt
createdBy
```

e contiene la struttura alimentare effettiva:

```text
MealPlanVersion
       │
       ├── Breakfast
       ├── Lunch
       ├── Snack
       └── Dinner
```

Una versione vecchia diventa **immutable**.

Quindi non esiste concettualmente:

```text
modify(v3)
```

ma:

```text
v3
 │
 │ modifications
 ▼
v4
```

Questa immutabilità è ciò che garantisce la consistenza storica.

---

# 6. Meal

Introduciamo:

```text
Meal
────────────────
id
type
time?
```

per esempio:

```text
BREAKFAST
MORNING_SNACK
LUNCH
AFTERNOON_SNACK
DINNER
```

Ogni versione contiene diversi pasti:

```text
MealPlanVersion
       │
       │ 1..*
       ▼
      Meal
```

---

# 7. MealOption

Qui introduciamo qualcosa di utile per un vero piano alimentare.

Per esempio:

```text
BREAKFAST

Option A
├── oats 80g
├── milk 200ml
└── banana

OR

Option B
├── bread 100g
├── eggs 2
└── orange
```

Quindi:

```text
Meal
 │
 │ 1..*
 ▼
MealOption
```

Questo permette al Patient di avere alternative.

---

# 8. FoodItem

Dentro `MealOption` possiamo avere:

```text
FoodItem
────────────────
food
quantity
unit
```

Per esempio:

```text
Oats
80
GRAMS
```

Qui farei già una distinzione interessante.

`FoodItem` probabilmente non ha bisogno di un'identità propria.

Due oggetti:

```text
80g oats
```

sono concettualmente equivalenti.

Potremmo quindi modellarlo come **Value Object**.

---

# Entity vs Value Object

Questa distinzione è importante.

### Entity

Ha una propria identità.

Per esempio:

```text
Patient #9281
```

rimane lo stesso Patient anche se cambia email.

L'identità conta.

### Value Object

Conta invece il valore.

Per esempio:

```text
Quantity
80 grams
```

Due quantità:

```text
80 grams
80 grams
```

sono equivalenti.

Non ci interessa quale delle due sia "l'originale".

Per NutriTrack potremmo quindi avere:

**Entities**

```text
Patient
Nutritionist
MealPlan
MealPlanVersion
DiaryEntry
Measurement
```

e **Value Objects**

```text
Quantity
Food
DateRange
```

Non dobbiamo però applicare DDD in maniera religiosa. Usiamo questi concetti dove semplificano realmente il modello.

---

# 9. MealDiary

Il Patient possiede un diario:

```text
Patient
   │
   │ 1
   ▼
MealDiary
```

che contiene:

```text
MealDiary
   │
   │ 0..*
   ▼
DiaryEntry
```

Il diario è quindi un contenitore logico delle registrazioni.

---

# 10. DiaryEntry

Questa è un'altra entità importante.

```text
DiaryEntry
────────────────────────
id
patientId
consumptionTime
createdAt
syncStatus
mealPlanVersionId [0..1]
```

e contiene:

```text
actualConsumption
```

Notiamo la differenza:

```text
MealPlanVersion
       │
       ▼
what SHOULD be eaten
```

mentre:

```text
DiaryEntry
       │
       ▼
what WAS eaten
```

Questa distinzione deve rimanere molto chiara nel modello.

---

# 11. Relazione fondamentale

Abbiamo:

```text
DiaryEntry
     │
     │ 0..1
     ▼
MealPlanVersion
```

Perché `0..1`?

Perché abbiamo deciso che il Patient può registrare:

> "Ho mangiato una pizza"

anche se non aveva un piano valido.

Quindi:

```text
mealPlanVersion = null
```

è consentito.

---

# 12. DiarySharingPreference

Qui arriva la modifica che hai chiesto.

Potremmo creare:

```text
DiarySharingPreference
────────────────────────
patientId
enabled
updatedAt
```

Relazione:

```text
Patient
   │
   │ 1
   ▼
DiarySharingPreference
```

Però attenzione.

Non sono ancora convinto che debba essere una vera Entity separata.

Potrebbe semplicemente essere:

```text
MealDiary
────────────────
sharingEnabled
```

Per ora nel Domain Model la terrei come **policy/concept separato**, e decideremo nell'architettura dove collocarla.

Questo è un buon esempio di decisione che **non dobbiamo prendere prematuramente**.

---

# 13. Measurement

Abbiamo:

```text
Measurement
──────────────────
id
patientId
type
value
unit
timestamp
```

Per esempio:

```text
type = WEIGHT
value = 78.2
unit = KG
```

Patient:

```text
Patient
   │
   │ 0..*
   ▼
Measurement
```

Così possiamo ricostruire:

```text
kg
82 ┤●
80 ┤  ●
78 ┤      ●
76 ┤          ●
   └────────────── time
```

senza cambiare il modello.

---

# 14. ChangeSet

Ora dobbiamo rappresentare le differenze tra versioni.

Concettualmente:

```text
MealPlanVersion v3
        │
        │
        ▼
     ChangeSet
        │
        ▼
MealPlanVersion v4
```

Per esempio:

```text
ChangeSet

CHANGE_QUANTITY
oats
100g → 80g

ADD_FOOD
banana
null → 1
```

Potremmo quindi avere:

```text
MealPlanVersion
────────────────────
id
versionNumber
parentVersionId
validFrom
validUntil
changeSet
```

`parentVersionId` è particolarmente interessante.

Ci permette di avere:

```text
v1
 │
 ▼
v2
 │
 ▼
v3
 │
 ▼
v4
```

e quindi una vera **version history**.

---

# 15. Aggregate

Ora introduciamo un concetto architetturale molto utile.

Non vogliamo permettere a qualsiasi componente di fare:

```text
modify Meal
modify MealOption
modify FoodItem
```

arbitrariamente.

Vogliamo un punto di ingresso controllato.

Per esempio:

```text
            MealPlan
               │
               ▼
       MealPlanVersion
               │
               ▼
             Meal
               │
               ▼
          MealOption
               │
               ▼
           FoodItem
```

Potremmo considerare questo gruppo come un **Aggregate**.

L'esterno non modifica direttamente:

```text
FoodItem
```

ma richiede qualcosa come:

```text
MealPlanService.createNewVersion(...)
```

che garantisce le invarianti.

Questo impedirà molti stati inconsistenti.

---

# 16. Domain Services

Ci sono comportamenti che non appartengono naturalmente a una singola Entity.

Per esempio:

```text
Which MealPlanVersion was valid
at 12:32 on October 5?
```

Potremmo avere concettualmente:

```text
MealPlanVersionResolver
```

con:

```text
resolveVersionAt(mealPlan, timestamp)
```

Oppure:

```text
MealPlanVersioningService
```

per:

```text
createVersion(
    currentVersion,
    requestedChanges
)
```

Non decidiamo ancora i nomi definitivi.

---

# Il Domain Model risultante

Ora possiamo mettere insieme tutto:

```text
                         User
                    ┌─────┴─────┐
                    │           │
              Nutritionist    Patient
                    │           │
                    │1          │
                    │       0..*│
                    └───────────┤
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
            MealPlan        MealDiary      Measurement
                │               │
             1  │               │ 0..*
                │               ▼
              1..*          DiaryEntry
                ▼               │
        MealPlanVersion ◄────────┘
                │           0..1
                │
              1..*
                ▼
               Meal
                │
              1..*
                ▼
           MealOption
                │
              1..*
                ▼
            FoodItem
```

E parallelamente:

```text
MealPlanVersion
       │
       │ parent
       ▼
MealPlanVersion

       +

ChangeSet
```

---

# Una cosa che NON voglio ancora fare

Non trasformiamo immediatamente questo in:

```text
users collection
mealPlans collection
diaryEntries collection
...
```

Sarebbe prematuro.

Prima voglio stabilire:

> **chi è responsabile di cosa?**

perché questa domanda determinerà i nostri moduli.

---

# Le responsabilità iniziano già ad emergere

Dal Domain Model possiamo vedere almeno quattro bounded areas:

```text
IDENTITY
────────────
User
Patient
Nutritionist


MEAL PLANNING
────────────
MealPlan
MealPlanVersion
Meal
MealOption
FoodItem
ChangeSet


DIARY
────────────
MealDiary
DiaryEntry
SharingPolicy


PROGRESS
────────────
Measurement
```

Questi sono candidati naturali per i nostri **moduli applicativi**.

Ed è qui che iniziamo finalmente a rispondere al requisito del professore:

> ogni modulo deve controllare i propri dati.

---

# Una domanda architetturale importante

Supponiamo che `DiaryModule` debba sapere:

```text
which MealPlanVersion
was valid at 12:30?
```

La soluzione sbagliata sarebbe:

```text
DiaryModule
      │
      ▼
MealPlan database
```

perché violerebbe il data ownership.

Vogliamo:

```text
DiaryModule
      │
      │ API
      ▼
MealPlanModule
      │
      ▼
MealPlan data
```

cioè:

```text
DiaryModule

"give me the version valid at timestamp T"

            │
            ▼

MealPlanModule
```

**Questa sarà una delle interazioni cross-module più importanti dell'intero progetto.**

---

# Nuove ADR

Aggiungerei al nostro Design Notebook:

**ADR-006 — Immutable MealPlanVersions**

> Once a MealPlanVersion becomes valid, its nutritional contents cannot be modified. Changes generate a new version.

**Motivo:** historical consistency.

---

**ADR-007 — Temporal version resolution**

> Meal plan versions are resolved using the consumption timestamp rather than diary creation or synchronization time.

**Motivo:** supportare correttamente registrazioni retroattive e offline.

---

**ADR-008 — Separate planned and actual consumption**

> MealPlan describes prescribed consumption; MealDiary describes actual consumption.

**Motivo:** evitare coupling tra prescrizione e comportamento reale.

---

**ADR-009 — Historical measurements**

> Progress values are modeled as timestamped Measurement entities instead of mutable Patient attributes.

**Motivo:** preservare lo storico.

---

# Stato del progetto

Siamo arrivati qui:

```text
Requirements              ✓
Business Rules            ✓
Use Cases                 ✓
Critical Scenarios        ✓
Domain Model              ✓
        │
        ▼
MODULE ARCHITECTURE       ← NEXT
        │
Module Contracts
        │
UML Class Diagram
        │
Repository structure
        │
Implementation
```

E il prossimo passaggio è probabilmente **il più importante rispetto al feedback del professore**.

Costruiremo la **Module Architecture**: decideremo quali moduli esistono, **quali dati possiede ciascun modulo**, quali operazioni espone e soprattutto come `Diary`, `MealPlan`, `Identity` e `Progress` possono comunicare **senza accedere direttamente ai dati degli altri**.

**Strumento: ancora ChatGPT normale.** Dopo Module Architecture + Module Contracts avremo finalmente abbastanza informazioni per congelare il design iniziale. **A quel punto ti fermerò io e passeremo a Work per creare fisicamente `PROJECT_DESIGN_NOTEBOOK.md`, documentazione e struttura del repository. Subito dopo entrerà Codex per il primo codice.**

---

perfetto procediamo con la module archietecture. mi raccomando voglio che continui a tenere aggiornato il file con le note. sii chiaro, sintetico quanto serve ma sempre esplicativo riguardo ad ogni concetto introdotto

Procediamo. Una precisazione sul file: **finché restiamo in questa modalità non sto materialmente modificando un file persistente**; sto mantenendo il contenuto del Design Notebook nella conversazione. Al passaggio a Work lo creeremo come `PROJECT_DESIGN_NOTEBOOK.md` e vi trasferiremo queste decisioni. Non voglio darti l'impressione che esista già un file aggiornato sul disco.

**Strumento attuale: ChatGPT normale.** La Module Architecture è ancora una decisione progettuale, quindi niente Codex.

# Fase 3 — Module Architecture

Il requisito fondamentale del professore è:

> Ogni modulo deve avere **responsabilità e dati propri**. Gli altri moduli non possono accedere direttamente alla sua persistenza; devono utilizzare API/interfacce o eventi.

Questo significa che non vogliamo:

```text
MealPlanService ─┐
DiaryService    ─┼──► DATABASE ◄── tutti leggono tutto
ProgressService ─┘
```

Vogliamo:

```text
┌──────────────┐
│ MealPlanning │
└──────┬───────┘
       │ API / Events
       ▼
┌──────────────┐
│    Diary     │
└──────┬───────┘
       │ API / Events
       ▼
┌──────────────┐
│   Progress   │
└──────────────┘
```

Ogni modulo è quindi una sorta di **black box**: conosciamo ciò che espone, ma gli altri moduli non manipolano il suo stato interno.

---

# 1. I cinque moduli

Dopo il Domain Model, modificherei leggermente la suddivisione iniziale. La struttura definitiva che propongo è:

```text
                    NUTRITRACK
                        │
        ┌───────────────┼────────────────┐
        │               │                │
        ▼               ▼                ▼
    Identity       MealPlanning        Diary
        │               │                │
        │               │                │
        └───────┐       │       ┌────────┘
                ▼       ▼       ▼
                 PatientManagement
                        │
                        ▼
                     Progress
```

Più precisamente:

```text
Identity & Access
Patient Management
Meal Planning
Meal Diary
Progress Monitoring
```

Offline synchronization sarà invece una **infrastructure capability trasversale**, non un modulo di business autonomo.

Vediamo perché.

---

# 2. Identity & Access Module

### Responsabilità

Risponde alla domanda:

> **Chi è l'utente e cosa può fare?**

Gestisce:

```text
authentication
identity
role
session
```

Concetti posseduti:

```text
User
Role
Credentials / authentication identity
```

Espone concettualmente operazioni come:

```text
authenticate()
getCurrentUser()
getRole()
```

Non deve sapere nulla di:

```text
MealPlan
DiaryEntry
Measurement
```

---

## Authentication ≠ Authorization

Distinzione importante.

**Authentication**

> Chi sei?

```text
email + password
      ↓
Matteo
```

**Authorization**

> Hai il diritto di eseguire questa operazione?

```text
Matteo
   │
   ├── Patient → view own diary ✓
   └── modify another patient's plan ✗
```

Identity fornisce l'identità e il ruolo, ma alcune autorizzazioni dipendono dal dominio.

Per esempio:

> "Questo Nutritionist può vedere questo Patient?"

dipende dall'associazione Nutritionist–Patient, quindi non è una semplice informazione di login.

---

# 3. Patient Management Module

Questo modulo gestisce la relazione:

```text
Nutritionist
      │
      │ manages
      ▼
Patient
```

### Possiede

```text
PatientProfile
NutritionistProfile
PatientNutritionistAssociation
```

Per esempio:

```text
PatientNutritionistAssociation
──────────────────────────────
patientId
nutritionistId
createdAt
status
```

### Espone

Concettualmente:

```text
getPatient()
getNutritionistPatients()
isPatientAssignedToNutritionist()
```

Quest'ultima operazione sarà molto importante:

```text
isAssigned(nutritionistId, patientId)
```

perché altri moduli potranno chiederlo senza leggere direttamente i dati del Patient Management.

---

# 4. Meal Planning Module

È uno dei moduli centrali.

### Responsabilità

> Gestire ciò che il Patient **dovrebbe mangiare**.

### Possiede

```text
MealPlan
MealPlanVersion
Meal
MealOption
FoodItem
ChangeSet
```

Nessun altro modulo può modificare direttamente questi dati.

Espone operazioni concettuali come:

```text
createMealPlan()
createNewVersion()

getActiveVersion()
getVersionAt(timestamp)

getVersionHistory()
```

La più interessante è:

```text
getVersionAt(patientId, timestamp)
```

Per esempio:

```text
getVersionAt(Matteo, 2026-10-05 12:30)

              ↓

MealPlanVersion v3
```

Questa API sarà utilizzata dal Diary Module.

---

# 5. Meal Diary Module

Responsabilità:

> Gestire ciò che il Patient **ha effettivamente mangiato**.

Possiede:

```text
MealDiary
DiaryEntry
DiarySharingPreference
```

Espone:

```text
recordMeal()
getDiary()
enableSharing()
disableSharing()
```

Questo modulo **non possiede MealPlanVersion**.

Una `DiaryEntry` può però contenere:

```text
mealPlanVersionId
```

come riferimento esterno.

Questa distinzione è fondamentale:

```text
Diary owns DiaryEntry.

MealPlanning owns MealPlanVersion.
```

---

# 6. Come Diary e MealPlanning comunicano

Consideriamo:

```text
recordMeal(
    patientId,
    consumptionTime,
    food
)
```

Il Diary Module deve sapere quale versione era valida.

Non può fare:

```text
Diary
  │
  └────► mealPlanVersionTable
```

Deve fare:

```text
Diary Module

      │
      │ getVersionAt(patientId, time)
      ▼

Meal Planning Module

      │
      ▼

returns versionId
```

Poi:

```text
DiaryEntry
────────────────
patientId
consumptionTime
mealPlanVersionId = v3
```

Questo è **data ownership** applicato concretamente.

---

# 7. Progress Module

Responsabilità:

> Gestire l'evoluzione delle misurazioni del Patient.

Possiede:

```text
Measurement
MeasurementType
```

Espone:

```text
recordMeasurement()
getMeasurementHistory()
```

Per esempio:

```text
recordMeasurement(
    patientId,
    WEIGHT,
    78.2,
    KG
)
```

---

# 8. Ma come fa il Nutritionist a vedere i progressi?

Supponiamo:

```text
Nutritionist → getPatientProgress(patient)
```

Prima dobbiamo verificare:

```text
Nutritionist manages Patient?
```

Questa informazione appartiene a:

```text
PatientManagement
```

quindi:

```text
Progress
   │
   │ isAssigned(nutritionist, patient)?
   ▼
PatientManagement
   │
   │ YES
   ▼
Progress
   │
   └── returns measurements
```

Non:

```text
Progress → patient_association database table
```

---

# 9. Privacy del diario

Stesso principio.

Nutritionist chiede:

```text
getPatientDiary(patient)
```

Diary Module deve verificare due condizioni:

```text
isAssigned(nutritionist, patient)
             ∧
isDiarySharingEnabled(patient)
```

La seconda informazione appartiene al Diary Module stesso.

La prima appartiene a Patient Management.

Quindi:

```text
Nutritionist
     │
     ▼
Diary Module
     │
     ├── check sharing preference
     │
     │
     └──► PatientManagement
               │
               │ isAssigned()?
               ▼
              YES
```

Solo allora:

```text
DiaryEntries
```

vengono restituite.

---

# 10. Una regola architetturale fondamentale

Possiamo formalizzarla così:

> **A module may reference the identifier of an entity owned by another module, but it may not directly manipulate the entity's persistent representation.**

Esempio corretto:

```text
DiaryEntry
mealPlanVersionId = "V3"
```

Esempio scorretto:

```text
DiaryModule

SELECT *
FROM meal_plan_versions
WHERE ...
```

Il secondo viola l'ownership.

---

# 11. API vs Events

Il professore ha parlato di:

> API **o eventi** espliciti.

Sono due modalità diverse.

### API — comunicazione sincrona

Un modulo fa una domanda e vuole subito una risposta:

```text
Diary
 │
 │ getVersionAt(timestamp)
 ▼
MealPlanning
 │
 │ version v3
 ▼
Diary
```

Questo è ideale per operazioni come:

```text
getVersionAt()
isAssigned()
```

---

### Event — comunicazione asincrona

Un modulo comunica:

> È successo qualcosa.

Per esempio:

```text
MealPlanning
     │
     │ MealPlanVersionCreated
     ▼
 Event
```

Altri moduli interessati possono reagire.

MealPlanning **non deve sapere chi riceverà l'evento**.

Questo riduce il coupling.

---

# 12. Un evento utile nel nostro sistema

Quando viene creata una nuova versione:

```text
MealPlanVersionCreated
────────────────────────
patientId
mealPlanId
newVersionId
validFrom
```

MealPlanning pubblica:

```text
MealPlanning

      │
      │ publish
      ▼

MealPlanVersionCreated
```

Eventuali componenti interessati possono reagire.

Non voglio però costruire Kafka o una complessa event-driven architecture.

Per il nostro progetto sarebbe probabilmente **overengineering**.

Possiamo implementare eventi applicativi molto più semplici.

---

# 13. API o Event?

La regola pratica che adotterei è:

### API

quando qualcuno chiede:

> Dimmi qualcosa adesso.

```text
getVersionAt()
isAssigned()
getPatient()
```

### Event

quando qualcuno comunica:

> È successo qualcosa.

```text
MealPlanVersionCreated
DiarySharingChanged
MeasurementRecorded
```

Questa distinzione è molto utile anche da spiegare all'esame.

---

# 14. Offline & Synchronization

Qui farei una scelta architetturale importante.

**Non creerei:**

```text
SynchronizationModule
```

come dominio autonomo.

Offline synchronization non rappresenta un concetto nutrizionale.

È una **infrastructure concern**.

Avremo quindi:

```text
                 Application
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
 MealPlanning      Diary        Progress

────────────────────────────────────────
            Infrastructure
────────────────────────────────────────

          Local Persistence
                 +
           Sync Engine
                 +
         Remote Persistence
```

---

# 15. Sync Engine

Il Sync Engine si occuperà di:

```text
Local operations
       │
       ▼
Pending queue
       │
       ▼
Network available?
       │
      YES
       │
       ▼
Server synchronization
       │
       ├── success → SYNCED
       │
       └── conflict → CONFLICT
```

Per esempio:

```text
DiaryEntry
syncStatus = PENDING
```

quando siamo offline.

Successivamente:

```text
PENDING
   ↓
SYNCING
   ↓
SYNCED
```

Questa parte sarà progettata in dettaglio più avanti.

---

# 16. Architettura complessiva

Ora possiamo rappresentare NutriTrack così:

```text
                    ┌─────────────────┐
                    │ Presentation/UI │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Application     │
                    │ Use Cases       │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼

 ┌───────────────┐    ┌──────────────┐     ┌────────────┐
 │ Patient       │◄──►│ MealPlanning │◄───►│   Diary    │
 │ Management    │    │              │     │            │
 └───────▲───────┘    └──────────────┘     └────────────┘
         │
         │
 ┌───────▼───────┐                          ┌────────────┐
 │ Identity &    │                          │ Progress   │
 │ Access        │                          │            │
 └───────────────┘                          └────────────┘

──────────────────────────────────────────────────────────
                    INFRASTRUCTURE
──────────────────────────────────────────────────────────

       Local Storage     Sync Engine     Remote Storage
```

Le frecce qui indicano **dipendenze/interazioni consentite**, non accesso diretto ai database.

---

# 17. Ownership table

Questa tabella sarà importantissima nella documentazione:

| Module | Owns |
|---|---|
| **Identity & Access** | User identity, role, authentication information |
| **Patient Management** | Patient profile, Nutritionist profile, patient–nutritionist association |
| **Meal Planning** | MealPlan, MealPlanVersion, Meal, MealOption, ChangeSet |
| **Meal Diary** | MealDiary, DiaryEntry, SharingPreference |
| **Progress** | Measurement |

La domanda:

> "Chi può modificare `MealPlanVersion`?"

ha quindi una risposta immediata:

**solo Meal Planning.**

---

# 18. Dipendenze consentite

Definirei anche esplicitamente:

```text
Diary
   ├──► MealPlanning
   └──► PatientManagement

MealPlanning
   └──► PatientManagement

Progress
   └──► PatientManagement

PatientManagement
   └──► Identity

Identity
   └──► nobody
```

Questo ci dà una dependency direction abbastanza pulita:

```text
Diary ───────────────┐
                     │
MealPlanning ────────┼──► PatientManagement ──► Identity
                     │
Progress ────────────┘
```

Diary ha inoltre:

```text
Diary ──► MealPlanning
```

per la risoluzione delle versioni.

---

# 19. Perché questa architettura è migliore della CRUD iniziale?

CRUD avrebbe prodotto qualcosa del genere:

```text
UI
 │
 ▼
Services
 │
 ▼
Shared Database
```

con:

```text
MealService → every table
DiaryService → every table
PatientService → every table
```

Il risultato sarebbe **high coupling**.

La nostra soluzione:

```text
Module
 │
 ├── owns its data
 │
 ├── exposes contracts
 │
 └── hides persistence
```

produce invece:

**high cohesion + lower coupling + explicit dependencies.**

Questi due termini sono importanti.

**Cohesion** = quanto le responsabilità interne di un modulo appartengono allo stesso problema.

**Coupling** = quanto un modulo dipende dai dettagli interni degli altri.

Vogliamo:

> **High cohesion, low coupling.**

---

# 20. Un'importante scelta: Modular Monolith

Non costruirei microservices.

Il nostro backend sarà concettualmente un:

> **Modular Monolith**

cioè una singola applicazione deployabile, ma internamente divisa in moduli con confini forti.

```text
              NutriTrack Backend

┌─────────────────────────────────────┐
│                                     │
│ Identity │ Patient │ MealPlan       │
│                                     │
│ Diary    │ Progress                 │
│                                     │
└─────────────────────────────────────┘
```

non:

```text
5 servers
5 deployments
5 databases
Kafka
Docker swarm
...
```

I microservices aggiungerebbero distributed transactions, deployment, networking e observability senza risolvere un problema necessario al nostro progetto.

Il **Modular Monolith** ci permette invece di dimostrare la modularità richiesta dal professore senza introdurre complessità operativa inutile.

---

# Aggiornamento Design Notebook

Le nuove decisioni da conservare sono:

**ADR-010 — Modular Monolith**

> NutriTrack adopts a modular-monolith architecture rather than microservices.

**Reason:** strong logical module boundaries are required, while distributed deployment complexity provides no benefit for the project scope.

---

**ADR-011 — Explicit Data Ownership**

> Each domain module exclusively owns its persistent data. Other modules interact with it through explicit contracts.

---

**ADR-012 — Cross-module identifiers**

> Modules may store identifiers referring to entities owned by another module, but cannot directly manipulate their persistence.

Esempio:

```text
DiaryEntry.mealPlanVersionId
```

è consentito.

---

**ADR-013 — API vs Domain Events**

> Synchronous APIs are used when a module requires an immediate answer; events represent facts that have occurred and do not require the publisher to know the consumers.

---

**ADR-014 — Synchronization as Infrastructure**

> Offline synchronization is a cross-cutting infrastructure capability rather than an independent business-domain module.

---

# Dove siamo

Abbiamo ora:

```text
Requirements                 ✓
Use Cases                    ✓
Domain Model                 ✓
Module Architecture          ✓

              ↓

MODULE CONTRACTS             ← prossimo

              ↓

Detailed UML
              ↓
Technology decisions
              ↓
Repository structure
              ↓
Implementation
```

## Il prossimo step cambia leggermente approccio

Adesso sappiamo **quali moduli esistono**. Ma una scatola chiamata `MealPlanning` non basta.

Dobbiamo definire il suo **contratto pubblico**:

```text
MealPlanning
──────────────────────────

PUBLIC:
 createMealPlan(...)
 createNewVersion(...)
 getVersionAt(...)
 getActiveVersion(...)

PRIVATE:
 repositories
 persistence
 reconstruction algorithm
 change-set implementation
```

Faremo questo per tutti e cinque i moduli e stabiliremo anche **input, output, errori e dipendenze** delle operazioni principali.

Questo sarà il ponte tra **software design e codice**.

**Restiamo ancora qui per i Module Contracts.** Se li chiudiamo bene, quello sarà il punto in cui ti proporrò di passare a **Work**, creare realmente il Design Notebook e impostare i primi file del progetto. Solo dopo passeremo a **Codex** per implementare lo skeleton seguendo questi contratti.

---

perfetto molto bene. procediamo

Perfetto. **Strumento: ancora questa chat.** Questo è l'ultimo grande step puramente progettuale prima di iniziare a creare i file del progetto.

# Fase 4 — Module Contracts

Un **module contract** definisce ciò che un modulo promette agli altri moduli senza esporre **come** lo realizza.

Pensalo come un confine:

```text
                PUBLIC CONTRACT
                       │
                       ▼
              ┌─────────────────┐
other module →│  MealPlanning   │
              │                 │
              │ implementation  │ ← nascosto
              │ database        │ ← nascosto
              │ algorithms      │ ← nascosto
              └─────────────────┘
```

Questa distinzione è fondamentale per ottenere **information hiding**.

---

# 1. Identity & Access

### Responsabilità

Stabilire **chi è l'utente** e quale ruolo possiede.

### API pubblica

Concettualmente:

```text
authenticate(credentials)
    → AuthenticatedUser

getCurrentUser()
    → AuthenticatedUser

logout()
```

dove:

```text
AuthenticatedUser
────────────────────
userId
role
```

e:

```text
Role = PATIENT | NUTRITIONIST
```

### Non espone

Gli altri moduli non devono conoscere:

```text
password
Firebase token implementation
authentication database
Firebase Authentication
```

In particolare, `Firebase` non deve comparire nel contratto.

Perché?

Se un giorno cambiassimo authentication provider:

```text
Firebase → Auth0
```

il resto del dominio idealmente non dovrebbe cambiare.

---

# 2. Patient Management

Questo modulo gestisce profili e associazioni Patient–Nutritionist.

### API pubblica

```text
getPatient(patientId)
    → PatientProfile

getNutritionist(nutritionistId)
    → NutritionistProfile

getPatientsForNutritionist(nutritionistId)
    → PatientProfile[]

isAssigned(nutritionistId, patientId)
    → boolean
```

Quest'ultima funzione sarà usata molto.

Per esempio:

```text
Diary
  │
  │ isAssigned(N42, P12)?
  ▼
PatientManagement
  │
  └── true
```

---

# 3. Meal Planning

Questo è il contratto più ricco.

### Creazione

```text
createMealPlan(
    nutritionistId,
    patientId,
    planContent
)
→ MealPlanId
```

Precondizione:

```text
isAssigned(nutritionistId, patientId)
```

Postcondizione:

```text
exists(MealPlan)
∧
exists(MealPlanVersion v1)
∧
v1 is active
```

---

### Modifica

Non voglio:

```text
updateMealPlan(...)
```

perché semanticamente suggerisce una modifica in-place.

Preferisco:

```text
createNewVersion(
    nutritionistId,
    mealPlanId,
    baseVersionId,
    modifications
)
→ MealPlanVersion
```

Questo nome comunica direttamente il comportamento corretto.

Precondizione:

```text
baseVersion = currentVersion
```

altrimenti:

```text
VersionConflict
```

---

### Recupero piano attivo

```text
getActiveVersion(patientId)
    → MealPlanVersion?
```

Il `?` significa:

> potrebbe non esistere.

---

### Recupero storico

```text
getVersionAt(
    patientId,
    timestamp
)
→ MealPlanVersion?
```

Questa è l'operazione fondamentale utilizzata dal Diary Module.

---

### Storico versioni

```text
getVersionHistory(mealPlanId)
    → MealPlanVersionSummary[]
```

---

# 4. Meal Diary

### Registrazione

```text
recordMeal(
    patientId,
    consumptionTime,
    actualConsumption
)
→ DiaryEntry
```

Internamente accade:

```text
recordMeal()
      │
      ├── validate input
      │
      ├── MealPlanning.getVersionAt()
      │
      ├── create DiaryEntry
      │
      └── persist
```

L'utente non deve passare:

```text
mealPlanVersionId
```

Questa è una scelta importante.

Sarebbe pericoloso permettere:

```text
recordMeal(..., versionId)
```

perché il client potrebbe fornire la versione sbagliata.

Deve essere il **sistema** a determinarla.

---

# 5. Consultazione del proprio diario

```text
getOwnDiary(
    patientId,
    timeRange
)
→ DiaryEntry[]
```

Naturalmente dovremo assicurarci che:

```text
currentUser.id = patientId
```

Questa verifica verrà gestita nell'application layer.

---

# 6. Consultazione da parte del Nutritionist

Qui invece:

```text
getPatientDiary(
    nutritionistId,
    patientId,
    timeRange
)
→ DiaryEntry[]
```

Il comportamento è:

```text
getPatientDiary()
        │
        ├── PatientManagement.isAssigned()
        │
        ├── check sharing preference
        │
        └── return diary
```

Possibili errori:

```text
PatientNotAssigned
DiaryNotShared
```

Questa distinzione è importante.

Non vogliamo semplicemente:

```text
return []
```

perché:

> nessuna entry

e

> non sei autorizzato a vedere le entry

sono semanticamente situazioni completamente diverse.

---

# 7. Privacy API

Il Patient controlla la condivisione:

```text
enableDiarySharing(patientId)

disableDiarySharing(patientId)

isDiarySharingEnabled(patientId)
    → boolean
```

In futuro potremmo trasformarlo in:

```text
setDiarySharing(patientId, enabled)
```

ma il concetto rimane lo stesso.

---

# 8. Progress

API semplice:

```text
recordMeasurement(
    patientId,
    type,
    value,
    unit,
    timestamp
)
→ Measurement
```

e:

```text
getOwnMeasurements(
    patientId,
    timeRange
)
→ Measurement[]
```

Per il Nutritionist:

```text
getPatientMeasurements(
    nutritionistId,
    patientId,
    timeRange
)
→ Measurement[]
```

che internamente verifica:

```text
PatientManagement.isAssigned()
```

---

# 9. Una decisione sulla privacy

Qui emerge una domanda interessante.

Il Patient può nascondere:

```text
Diary
```

al Nutritionist.

E le measurements?

Per mantenere lo scope controllato, propongo:

```text
Meal Diary      → optional sharing
Measurements    → shared with assigned nutritionist
Meal Plan       → obviously shared
```

Perché il Nutritionist deve poter valutare i progressi per svolgere il proprio ruolo.

Non aggiungerei un sistema di permissions granulare universale.

Sarebbe possibile, ma per ora sarebbe **overengineering**.

---

# 10. Contratti cross-module

Ora possiamo finalmente definire le interazioni.

### Diary → MealPlanning

```text
getVersionAt(patientId, timestamp)
```

Motivo:

> associare DiaryEntry alla versione storicamente corretta.

---

### Diary → PatientManagement

```text
isAssigned(nutritionistId, patientId)
```

Motivo:

> autorizzare il Nutritionist alla consultazione.

---

### MealPlanning → PatientManagement

```text
isAssigned(nutritionistId, patientId)
```

Motivo:

> impedire che un Nutritionist modifichi piani di pazienti altrui.

---

### Progress → PatientManagement

```text
isAssigned(nutritionistId, patientId)
```

Motivo:

> autorizzazione.

---

# 11. Dependency Graph

Otteniamo:

```text
                    Identity
                       ▲
                       │
              PatientManagement
                 ▲     ▲     ▲
                 │     │     │
        ┌────────┘     │     └─────────┐
        │              │               │
 MealPlanning ◄────── Diary         Progress
```

Diary dipende anche da:

```text
Diary ─────► MealPlanning
```

Quindi complessivamente:

```text
Diary ───────────────► MealPlanning
 │                         │
 │                         │
 └────► PatientMgmt ◄──────┘
             ▲
             │
          Progress
             │
             ▼
          Identity
```

Non abbiamo dipendenze circolari.

Questo è positivo.

---

# 12. Perché evitare circular dependencies?

Supponiamo:

```text
Diary → MealPlanning
```

e contemporaneamente:

```text
MealPlanning → Diary
```

avremmo:

```text
┌──────────────┐
│              ▼
Diary ───► MealPlanning
▲              │
└──────────────┘
```

Questo rende i moduli fortemente accoppiati.

Se MealPlanning deve reagire a qualcosa accaduto nel Diary, preferiremmo eventualmente:

```text
Diary
 │
 │ publish
 ▼
MealRecordedEvent
```

invece di introdurre una dipendenza inversa diretta.

Questo è uno dei principali utilizzi degli eventi nella nostra architettura.

---

# 13. Error contract

Anche gli errori fanno parte del contratto.

Definirei almeno queste categorie:

```text
AuthenticationError

AuthorizationError
├── PatientNotAssigned
└── DiaryNotShared

ValidationError
├── InvalidMealPlan
├── InvalidMeasurement
└── InvalidDiaryEntry

NotFoundError
├── PatientNotFound
└── MealPlanNotFound

ConflictError
└── MealPlanVersionConflict
```

Questo sarà molto meglio rispetto a:

```text
throw new Error("something went wrong")
```

perché l'application layer potrà reagire diversamente a ogni caso.

---

# 14. Esempio completo

Prendiamo uno scenario reale.

Nutritionist vuole vedere il diario di Matteo:

```text
UI
 │
 │ request patient diary
 ▼
Application Layer
 │
 ▼
DiaryModule
 │
 │
 ├────► PatientManagement
 │       isAssigned(N1, P7)?
 │
 │             ↓
 │            true
 │
 ├────► SharingPreference
 │       enabled?
 │
 │             ↓
 │            true
 │
 ▼
DiaryRepository
 │
 ▼
DiaryEntries
 │
 ▼
UI
```

Se invece:

```text
sharingEnabled = false
```

otteniamo:

```text
DiaryNotShared
```

e la UI potrebbe mostrare:

> The patient has chosen not to share their meal diary.

Questo è un esempio completo di:

**UI → Application → Module Contract → Domain Rule → Repository**

---

# 15. Repository interfaces

Ora introduciamo un concetto che useremo moltissimo nel codice.

Il dominio non dovrebbe fare:

```typescript
firebase
  .collection("diary")
  .get()
```

Vogliamo invece:

```text
DiaryService
     │
     ▼
DiaryRepository
```

dove il contratto potrebbe essere:

```text
DiaryRepository
──────────────────────
save(entry)
findByPatient(...)
findById(...)
```

Poi:

```text
                DiaryRepository
                      ▲
                      │ implements
                      │
          FirestoreDiaryRepository
```

Quindi:

```text
Domain/Application
       │
       ▼
Repository interface
       │
       ▼
Infrastructure implementation
       │
       ▼
Firebase
```

Questo applica il **Dependency Inversion Principle**.

---

# 16. Perché ci servirà nei test?

Perché invece di:

```text
DiaryService
     ↓
Firebase
```

nei test possiamo fare:

```text
DiaryService
     ↓
FakeDiaryRepository
```

Per esempio:

```text
FakeDiaryRepository
─────────────────────
entries = []
```

e testare:

```text
recordMeal()
```

senza Internet, Firebase o database.

Questa sarà una delle ragioni principali per cui la nostra architettura sarà facilmente testabile.

---

# 17. Contratto complessivo

Riassumendo:

| Module | API principali | Dipendenze |
|---|---|---|
| Identity | authenticate, getCurrentUser | — |
| PatientManagement | getPatient, getPatients, isAssigned | Identity |
| MealPlanning | createPlan, createNewVersion, getVersionAt | PatientManagement |
| Diary | recordMeal, getDiary, sharing settings | MealPlanning, PatientManagement |
| Progress | recordMeasurement, getMeasurements | PatientManagement |

Questo è il **public surface** iniziale dell'applicazione.

---

# 18. Cosa abbiamo ottenuto

Ora possiamo guardare NutriTrack a tre livelli.

### Domain

```text
Patient
MealPlan
MealPlanVersion
DiaryEntry
Measurement
```

### Modules

```text
PatientManagement
MealPlanning
Diary
Progress
Identity
```

### Contracts

```text
getVersionAt()
isAssigned()
recordMeal()
createNewVersion()
...
```

Quindi abbiamo trasformato:

> "Facciamo un'app per nutrizionisti"

in una specifica software molto più concreta.

---

# Design Notebook — nuove decisioni

Aggiungerei:

### ADR-015 — Explicit Module Contracts

> Cross-module communication must occur through explicitly defined public operations. Internal repositories and persistence models are private to their owning module.

**Motivo:** information hiding e riduzione del coupling.

---

### ADR-016 — System-controlled historical association

> Clients cannot select the MealPlanVersion associated with a DiaryEntry. Diary obtains the historically correct version from MealPlanning using the consumption timestamp.

**Motivo:** impedire associazioni inconsistenti o manipolate dal client.

---

### ADR-017 — Domain-specific errors

> Module contracts expose semantically meaningful errors rather than generic failures.

**Motivo:** permettere a application layer e UI di distinguere validation, authorization, conflicts e missing resources.

---

### ADR-018 — Repository abstraction

> Domain/application logic depends on repository interfaces rather than concrete persistence technology.

**Motivo:** dependency inversion, testabilità e indipendenza da Firebase.

---

### ADR-019 — Measurement visibility

> Progress measurements are visible to the assigned Nutritionist; optional sharing applies specifically to the Meal Diary.

**Motivo:** mantenere un modello di privacy comprensibile senza introdurre un sistema generalizzato di permission management.

---

# Il primo blocco progettuale è concluso

Siamo arrivati a un milestone importante:

```text
REQUIREMENTS
     ✓
     │
USE CASES
     ✓
     │
DOMAIN MODEL
     ✓
     │
MODULE ARCHITECTURE
     ✓
     │
MODULE CONTRACTS
     ✓
     │
     ▼
══════════════════════
 DESIGN BASELINE v1
══════════════════════
```

Questo significa che **adesso abbiamo abbastanza informazioni per iniziare a materializzare il progetto**.

Non significa che il design non cambierà. Durante l'implementazione sicuramente scopriremo qualcosa e aggiorneremo le ADR. È normale: vogliamo evitare sia *no design* sia *big design up front*.

## Adesso cambia lo strumento

**Qui mi fermerei prima di scrivere codice. Il prossimo step dovrebbe essere in Work.**

Il compito iniziale sarà creare la prima struttura documentale:

```text
NutriTrack/
│
├── README.md
│
├── docs/
│   ├── PROJECT_DESIGN_NOTEBOOK.md
│   ├── requirements.md
│   ├── use-cases.md
│   ├── architecture.md
│   └── adr/
│
└── src/
```

In `PROJECT_DESIGN_NOTEBOOK.md` trasferiremo in forma studiabile **le motivazioni e i concetti che abbiamo discusso**, mentre gli altri file conterranno le specifiche più formali. Le ADR potranno poi diventare file separati se ne vale la pena.

**Non passerei ancora a Codex.** Prima userei Work per creare questa baseline documentale e decidere insieme **technology stack + repository structure**. Una volta congelati quelli, ti dirò esplicitamente quando entrare in Codex per generare lo skeleton del codice.

---

ok passiamo a work

Perfetto. Ho creato la nuova sessione in **Work** con tutto il contesto della Design Baseline v1 e le istruzioni per:

- materializzare `PROJECT_DESIGN_NOTEBOOK.md` e la documentazione;
- mantenere traccia delle ADR e delle scelte progettuali;
- definire technology stack e struttura del repository;
- **non iniziare ancora a scrivere codice**;
- indicarti esplicitamente quando sarà il momento di passare a Codex.

Continua quindi nella nuova sessione Work: da lì iniziamo a costruire fisicamente NutriTrack.
