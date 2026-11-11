CREATE TABLE "ProgressPhoto" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "ProgressPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgressPhoto_patientId_operationId_key" ON "ProgressPhoto"("patientId", "operationId");
CREATE INDEX "ProgressPhoto_patientId_timestamp_idx" ON "ProgressPhoto"("patientId", "timestamp");
