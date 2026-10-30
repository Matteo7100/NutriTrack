-- Tabelle possedute dai cinque moduli; ID root stabile, documento JSONB transazionale.
CREATE TABLE "IdentityState" ("id" TEXT PRIMARY KEY, "data" JSONB NOT NULL);
CREATE TABLE "PatientState" ("id" TEXT PRIMARY KEY, "data" JSONB NOT NULL);
CREATE TABLE "MealPlanningState" ("id" TEXT PRIMARY KEY, "data" JSONB NOT NULL);
CREATE TABLE "DiaryState" ("id" TEXT PRIMARY KEY, "data" JSONB NOT NULL);
CREATE TABLE "ProgressState" ("id" TEXT PRIMARY KEY, "data" JSONB NOT NULL);
