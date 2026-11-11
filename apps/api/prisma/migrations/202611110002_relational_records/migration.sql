BEGIN;

-- La migrazione conserva gli identificativi usati dagli altri moduli e la coda offline.
SELECT pg_advisory_xact_lock(72564103);
LOCK TABLE "PatientState", "MealPlanningState", "DiaryState", "ProgressState" IN ACCESS EXCLUSIVE MODE;

-- Inviti e associazioni mantengono l'ordine di inserimento del documento precedente.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "PatientState"
        WHERE jsonb_typeof("data"->'invitations') IS DISTINCT FROM 'array'
           OR jsonb_typeof("data"->'assignments') IS DISTINCT FROM 'array'
    ) THEN
        RAISE EXCEPTION 'PatientState non contiene gli elenchi di inviti e associazioni attesi.';
    END IF;
END;
$$;

CREATE TYPE "PatientInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CLOSED');

CREATE TABLE "PatientInvitation" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "nutritionistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "status" "PatientInvitationStatus" NOT NULL,
    "sequence" SERIAL NOT NULL,
    CONSTRAINT "PatientInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientAssignment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "nutritionistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "sequence" SERIAL NOT NULL,
    CONSTRAINT "PatientAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientInvitation_sequence_key" ON "PatientInvitation"("sequence");
CREATE UNIQUE INDEX "PatientInvitation_one_pending_per_pair_key"
    ON "PatientInvitation"("patientId", "nutritionistId") WHERE "status" = 'PENDING';
CREATE INDEX "PatientInvitation_patientId_status_sequence_idx"
    ON "PatientInvitation"("patientId", "status", "sequence");
CREATE INDEX "PatientInvitation_nutritionistId_status_sequence_idx"
    ON "PatientInvitation"("nutritionistId", "status", "sequence");

CREATE UNIQUE INDEX "PatientAssignment_sequence_key" ON "PatientAssignment"("sequence");
CREATE UNIQUE INDEX "PatientAssignment_one_active_per_patient_key"
    ON "PatientAssignment"("patientId") WHERE "endedAt" IS NULL;
CREATE INDEX "PatientAssignment_patientId_endedAt_idx"
    ON "PatientAssignment"("patientId", "endedAt");
CREATE INDEX "PatientAssignment_nutritionistId_endedAt_sequence_idx"
    ON "PatientAssignment"("nutritionistId", "endedAt", "sequence");

INSERT INTO "PatientInvitation" ("id", "patientId", "nutritionistId", "createdAt", "status", "sequence")
SELECT entry->>'id', entry->>'patientId', entry->>'nutritionistId',
       to_timestamp((entry->>'createdAt')::double precision / 1000) AT TIME ZONE 'UTC',
       (entry->>'status')::"PatientInvitationStatus",
       row_number() OVER (ORDER BY state."id", source.ordinality)::integer
FROM "PatientState" AS state
CROSS JOIN LATERAL jsonb_array_elements(state."data"->'invitations') WITH ORDINALITY AS source(entry, ordinality);

INSERT INTO "PatientAssignment" ("id", "patientId", "nutritionistId", "createdAt", "endedAt", "sequence")
SELECT entry->>'id', entry->>'patientId', entry->>'nutritionistId',
       to_timestamp((entry->>'createdAt')::double precision / 1000) AT TIME ZONE 'UTC',
       to_timestamp((entry->>'endedAt')::double precision / 1000) AT TIME ZONE 'UTC',
       row_number() OVER (ORDER BY state."id", source.ordinality)::integer
FROM "PatientState" AS state
CROSS JOIN LATERAL jsonb_array_elements(state."data"->'assignments') WITH ORDINALITY AS source(entry, ordinality);

SELECT setval(pg_get_serial_sequence('"PatientInvitation"', 'sequence'), coalesce(max("sequence"), 1), count(*) > 0)
FROM "PatientInvitation";
SELECT setval(pg_get_serial_sequence('"PatientAssignment"', 'sequence'), coalesce(max("sequence"), 1), count(*) > 0)
FROM "PatientAssignment";

DO $$
BEGIN
    IF (SELECT count(*) FROM "PatientInvitation") <>
           (SELECT coalesce(sum(jsonb_array_length("data"->'invitations')), 0) FROM "PatientState")
       OR (SELECT count(*) FROM "PatientAssignment") <>
           (SELECT coalesce(sum(jsonb_array_length("data"->'assignments')), 0) FROM "PatientState") THEN
        RAISE EXCEPTION 'Il numero di inviti o associazioni copiati non corrisponde a PatientState.';
    END IF;
END;
$$;

-- Meal Planning: piani, versioni e contenuto ordinato di ogni versione.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "MealPlanningState"
        WHERE jsonb_typeof("data"->'versions') IS DISTINCT FROM 'array'
    ) THEN
        RAISE EXCEPTION 'MealPlanningState non contiene un elenco di versioni valido.';
    END IF;
END;
$$;

CREATE TEMP TABLE legacy_meal_versions ON COMMIT DROP AS
SELECT entry
FROM "MealPlanningState"
CROSS JOIN LATERAL jsonb_array_elements("data"->'versions') AS version(entry);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM legacy_meal_versions
        WHERE jsonb_typeof(entry #> '{content,meals}') IS DISTINCT FROM 'array'
           OR entry #> '{content,meals}' = '[]'::jsonb
           OR jsonb_typeof(entry->'changeSet') IS DISTINCT FROM 'array'
    ) THEN
        RAISE EXCEPTION 'Una versione precedente ha pasti o modifiche in un formato non valido.';
    END IF;
END;
$$;

CREATE TEMP TABLE legacy_meal_meals ON COMMIT DROP AS
SELECT (version.entry->>'id') || ':meal:' || meal.ordinality AS id,
       version.entry->>'id' AS version_id, (meal.ordinality - 1)::integer AS position, meal.entry
FROM legacy_meal_versions AS version
CROSS JOIN LATERAL jsonb_array_elements(version.entry #> '{content,meals}')
    WITH ORDINALITY AS meal(entry, ordinality);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM legacy_meal_meals
        WHERE jsonb_typeof(entry->'options') IS DISTINCT FROM 'array' OR entry->'options' = '[]'::jsonb
    ) THEN
        RAISE EXCEPTION 'Un pasto precedente non contiene alternative valide.';
    END IF;
END;
$$;

CREATE TEMP TABLE legacy_meal_alternatives ON COMMIT DROP AS
SELECT meal.id || ':alternative:' || alternative.ordinality AS id,
       meal.id AS meal_id, (alternative.ordinality - 1)::integer AS position, alternative.entry
FROM legacy_meal_meals AS meal
CROSS JOIN LATERAL jsonb_array_elements(meal.entry->'options')
    WITH ORDINALITY AS alternative(entry, ordinality);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM legacy_meal_alternatives
        WHERE jsonb_typeof(entry->'foods') IS DISTINCT FROM 'array' OR entry->'foods' = '[]'::jsonb
    ) THEN
        RAISE EXCEPTION 'Una alternativa precedente non contiene alimenti validi.';
    END IF;
END;
$$;

CREATE TEMP TABLE legacy_meal_foods ON COMMIT DROP AS
SELECT alternative.id || ':food:' || food.ordinality AS id,
       alternative.id AS alternative_id, (food.ordinality - 1)::integer AS position, food.entry
FROM legacy_meal_alternatives AS alternative
CROSS JOIN LATERAL jsonb_array_elements(alternative.entry->'foods')
    WITH ORDINALITY AS food(entry, ordinality);

CREATE TEMP TABLE legacy_meal_changes ON COMMIT DROP AS
SELECT (version.entry->>'id') || ':change:' || change.ordinality AS id,
       version.entry->>'id' AS version_id, (change.ordinality - 1)::integer AS position, change.entry
FROM legacy_meal_versions AS version
CROSS JOIN LATERAL jsonb_array_elements(version.entry->'changeSet')
    WITH ORDINALITY AS change(entry, ordinality);

CREATE TABLE "MealPlan" (
    "id" TEXT PRIMARY KEY,
    "patientId" TEXT NOT NULL
);

CREATE TABLE "MealPlanVersion" (
    "id" TEXT PRIMARY KEY,
    "mealPlanId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "parentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    CONSTRAINT "MealPlanVersion_interval" CHECK ("validUntil" IS NULL OR "validFrom" < "validUntil"),
    CONSTRAINT "MealPlanVersion_mealPlanId_fkey" FOREIGN KEY ("mealPlanId")
        REFERENCES "MealPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MealPlanVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId")
        REFERENCES "MealPlanVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MealPlanMeal" (
    "id" TEXT PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL CHECK ("position" >= 0),
    "name" TEXT NOT NULL,
    CONSTRAINT "MealPlanMeal_versionId_fkey" FOREIGN KEY ("versionId")
        REFERENCES "MealPlanVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MealPlanAlternative" (
    "id" TEXT PRIMARY KEY,
    "mealId" TEXT NOT NULL,
    "position" INTEGER NOT NULL CHECK ("position" >= 0),
    CONSTRAINT "MealPlanAlternative_mealId_fkey" FOREIGN KEY ("mealId")
        REFERENCES "MealPlanMeal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MealPlanFood" (
    "id" TEXT PRIMARY KEY,
    "alternativeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL CHECK ("position" >= 0),
    "food" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL CHECK ("quantity" > 0 AND "quantity" < 'Infinity'::double precision),
    "unit" TEXT NOT NULL,
    CONSTRAINT "MealPlanFood_alternativeId_fkey" FOREIGN KEY ("alternativeId")
        REFERENCES "MealPlanAlternative" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MealPlanChange" (
    "id" TEXT PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL CHECK ("position" >= 0),
    "path" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    CONSTRAINT "MealPlanChange_versionId_fkey" FOREIGN KEY ("versionId")
        REFERENCES "MealPlanVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MealPlan_patientId_key" ON "MealPlan"("patientId");
CREATE UNIQUE INDEX "MealPlanVersion_mealPlanId_versionNumber_key" ON "MealPlanVersion"("mealPlanId", "versionNumber");
CREATE UNIQUE INDEX "MealPlanVersion_open_key" ON "MealPlanVersion"("mealPlanId") WHERE "validUntil" IS NULL;
CREATE INDEX "MealPlanVersion_mealPlanId_validFrom_idx" ON "MealPlanVersion"("mealPlanId", "validFrom");
CREATE INDEX "MealPlanVersion_parentVersionId_idx" ON "MealPlanVersion"("parentVersionId");
CREATE UNIQUE INDEX "MealPlanMeal_versionId_position_key" ON "MealPlanMeal"("versionId", "position");
CREATE UNIQUE INDEX "MealPlanAlternative_mealId_position_key" ON "MealPlanAlternative"("mealId", "position");
CREATE UNIQUE INDEX "MealPlanFood_alternativeId_position_key" ON "MealPlanFood"("alternativeId", "position");
CREATE UNIQUE INDEX "MealPlanChange_versionId_position_key" ON "MealPlanChange"("versionId", "position");

INSERT INTO "MealPlan" ("id", "patientId")
SELECT DISTINCT entry->>'mealPlanId', entry->>'patientId'
FROM legacy_meal_versions;

INSERT INTO "MealPlanVersion" ("id", "mealPlanId", "versionNumber", "parentVersionId", "createdAt", "createdBy", "validFrom", "validUntil")
SELECT entry->>'id', entry->>'mealPlanId', (entry->>'versionNumber')::integer, entry->>'parentVersionId',
       to_timestamp((entry->>'createdAt')::double precision / 1000) AT TIME ZONE 'UTC', entry->>'createdBy',
       to_timestamp((entry->>'validFrom')::double precision / 1000) AT TIME ZONE 'UTC',
       to_timestamp((entry->>'validUntil')::double precision / 1000) AT TIME ZONE 'UTC'
FROM legacy_meal_versions;

INSERT INTO "MealPlanMeal" ("id", "versionId", "position", "name")
SELECT id, version_id, position, entry->>'name' FROM legacy_meal_meals;

INSERT INTO "MealPlanAlternative" ("id", "mealId", "position")
SELECT id, meal_id, position FROM legacy_meal_alternatives;

INSERT INTO "MealPlanFood" ("id", "alternativeId", "position", "food", "quantity", "unit")
SELECT id, alternative_id, position, entry->>'food', (entry->>'quantity')::double precision, entry->>'unit'
FROM legacy_meal_foods;

INSERT INTO "MealPlanChange" ("id", "versionId", "position", "path", "before", "after")
SELECT id, version_id, position, entry->>'path', entry->'before', entry->'after' FROM legacy_meal_changes;

DO $$
BEGIN
    IF (SELECT count(*) FROM "MealPlan") <> (SELECT count(DISTINCT entry->>'mealPlanId') FROM legacy_meal_versions)
       OR (SELECT count(*) FROM "MealPlanVersion") <> (SELECT count(*) FROM legacy_meal_versions)
       OR (SELECT count(*) FROM "MealPlanMeal") <> (SELECT count(*) FROM legacy_meal_meals)
       OR (SELECT count(*) FROM "MealPlanAlternative") <> (SELECT count(*) FROM legacy_meal_alternatives)
       OR (SELECT count(*) FROM "MealPlanFood") <> (SELECT count(*) FROM legacy_meal_foods)
       OR (SELECT count(*) FROM "MealPlanChange") <> (SELECT count(*) FROM legacy_meal_changes) THEN
        RAISE EXCEPTION 'Il numero di righe copiate per Meal Planning non corrisponde allo stato precedente.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "MealPlanVersion" AS version
        JOIN "MealPlanVersion" AS parent ON parent.id = version."parentVersionId"
        WHERE parent."mealPlanId" <> version."mealPlanId"
           OR parent."versionNumber" >= version."versionNumber"
    ) THEN
        RAISE EXCEPTION 'Una versione del piano fa riferimento a una versione precedente non valida.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM (
            SELECT "validFrom", row_number() OVER periods AS position, lag("validUntil") OVER periods AS previous_end
            FROM "MealPlanVersion"
            WINDOW periods AS (PARTITION BY "mealPlanId" ORDER BY "validFrom", "versionNumber")
        ) AS ordered_periods
        WHERE position > 1 AND (previous_end IS NULL OR previous_end > "validFrom")
    ) THEN
        RAISE EXCEPTION 'Le versioni di un piano precedente hanno intervalli sovrapposti.';
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "DiaryState"
        WHERE jsonb_typeof("data"->'entries') IS DISTINCT FROM 'array'
           OR jsonb_typeof("data"->'preferences') IS DISTINCT FROM 'object'
    ) THEN
        RAISE EXCEPTION 'DiaryState non contiene le registrazioni e preferenze attese.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "ProgressState"
        WHERE jsonb_typeof("data"->'measurements') IS DISTINCT FROM 'array'
    ) THEN
        RAISE EXCEPTION 'ProgressState non contiene la lista di misurazioni attesa.';
    END IF;
END;
$$;

CREATE TABLE "DiaryEntry" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "consumptionTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "actualConsumption" TEXT NOT NULL,
    "mealPlanVersionId" TEXT,
    "sequence" SERIAL NOT NULL,
    CONSTRAINT "DiaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiarySharingPreference" (
    "patientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "assignmentId" TEXT,
    CONSTRAINT "DiarySharingPreference_pkey" PRIMARY KEY ("patientId"),
    CONSTRAINT "DiarySharingPreference_assignment_check" CHECK (NOT "enabled" OR "assignmentId" IS NOT NULL)
);

CREATE TABLE "ProgressMeasurement" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "sequence" SERIAL NOT NULL,
    CONSTRAINT "ProgressMeasurement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProgressMeasurement_kind_check" CHECK (
        ("type" = 'WEIGHT' AND "unit" = 'KG') OR
        ("type" IN ('ARM_CIRCUMFERENCE', 'TORSO_CIRCUMFERENCE') AND "unit" = 'CM')
    ),
    CONSTRAINT "ProgressMeasurement_value_check" CHECK ("value" > 0 AND "value" < 'Infinity'::DOUBLE PRECISION)
);

CREATE UNIQUE INDEX "DiaryEntry_sequence_key" ON "DiaryEntry"("sequence");
CREATE UNIQUE INDEX "DiaryEntry_patientId_operationId_key" ON "DiaryEntry"("patientId", "operationId");
CREATE INDEX "DiaryEntry_patientId_consumptionTime_sequence_idx" ON "DiaryEntry"("patientId", "consumptionTime" DESC, "sequence");
CREATE UNIQUE INDEX "ProgressMeasurement_sequence_key" ON "ProgressMeasurement"("sequence");
CREATE UNIQUE INDEX "ProgressMeasurement_patientId_operationId_key" ON "ProgressMeasurement"("patientId", "operationId");
CREATE INDEX "ProgressMeasurement_patientId_timestamp_sequence_idx" ON "ProgressMeasurement"("patientId", "timestamp" DESC, "sequence");

-- L'ordine originale conserva la precedenza delle registrazioni con lo stesso istante.
INSERT INTO "DiaryEntry" ("id", "patientId", "operationId", "consumptionTime", "createdAt", "actualConsumption", "mealPlanVersionId")
SELECT entry->>'id', entry->>'patientId', entry->>'operationId',
       to_timestamp((entry->>'consumptionTime')::double precision / 1000) AT TIME ZONE 'UTC',
       to_timestamp((entry->>'createdAt')::double precision / 1000) AT TIME ZONE 'UTC',
       entry->>'actualConsumption', entry->>'mealPlanVersionId'
FROM "DiaryState" AS state
CROSS JOIN LATERAL jsonb_array_elements(state."data"->'entries') WITH ORDINALITY AS entries(entry, position)
ORDER BY state."id", entries.position;

INSERT INTO "DiarySharingPreference" ("patientId", "enabled", "assignmentId")
SELECT patient_id, (preference->>'enabled')::boolean, preference->>'assignmentId'
FROM "DiaryState" AS state
CROSS JOIN LATERAL jsonb_each(state."data"->'preferences') AS preferences(patient_id, preference);

INSERT INTO "ProgressMeasurement" ("id", "patientId", "operationId", "timestamp", "createdAt", "type", "unit", "value")
SELECT measurement->>'id', measurement->>'patientId', measurement->>'operationId',
       to_timestamp((measurement->>'timestamp')::double precision / 1000) AT TIME ZONE 'UTC',
       to_timestamp((measurement->>'createdAt')::double precision / 1000) AT TIME ZONE 'UTC',
       measurement->>'type', measurement->>'unit', (measurement->>'value')::double precision
FROM "ProgressState" AS state
CROSS JOIN LATERAL jsonb_array_elements(state."data"->'measurements') WITH ORDINALITY AS measurements(measurement, position)
ORDER BY state."id", measurements.position;

DO $$
BEGIN
    IF (SELECT count(*) FROM "DiaryEntry") <>
           (SELECT coalesce(sum(jsonb_array_length("data"->'entries')), 0) FROM "DiaryState")
       OR (SELECT count(*) FROM "DiarySharingPreference") <>
           (SELECT count(*) FROM "DiaryState" CROSS JOIN LATERAL jsonb_object_keys("data"->'preferences'))
       OR (SELECT count(*) FROM "ProgressMeasurement") <>
           (SELECT coalesce(sum(jsonb_array_length("data"->'measurements')), 0) FROM "ProgressState") THEN
        RAISE EXCEPTION 'Il numero di registrazioni, preferenze o misurazioni copiate non corrisponde ai dati esistenti.';
    END IF;
END;
$$;

-- Elimina i documenti aggregati solo dopo la verifica di tutte le copie.
DROP TABLE "PatientState", "MealPlanningState", "DiaryState", "ProgressState";

COMMIT;
