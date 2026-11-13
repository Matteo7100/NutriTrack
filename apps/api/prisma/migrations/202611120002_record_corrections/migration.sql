BEGIN;

ALTER TABLE "DiaryEntry" ADD COLUMN "updatedAt" TIMESTAMP(3), ADD COLUMN "originalDigest" TEXT;
ALTER TABLE "ProgressMeasurement" ADD COLUMN "updatedAt" TIMESTAMP(3), ADD COLUMN "originalDigest" TEXT;

CREATE TABLE "DeletedDiaryEntry" (
    "patientId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeletedDiaryEntry_pkey" PRIMARY KEY ("patientId", "operationId")
);

CREATE TABLE "DeletedProgressMeasurement" (
    "patientId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeletedProgressMeasurement_pkey" PRIMARY KEY ("patientId", "operationId")
);

COMMIT;
