BEGIN;

CREATE TYPE "NotificationKind" AS ENUM ('PASSWORD_RESET', 'INVITATION');

CREATE TABLE "NotificationOutboxEntry" (
    "id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "senderId" TEXT,
    "invitationId" TEXT,
    "email" TEXT NOT NULL,
    "token" TEXT,
    "nutritionistName" TEXT,
    "nutritionistEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "leaseId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    CONSTRAINT "NotificationOutboxEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationOutboxEntry_lease_check" CHECK (("leaseId" IS NULL) = ("leaseUntil" IS NULL)),
    CONSTRAINT "NotificationOutboxEntry_payload_check" CHECK (
      ("kind" = 'PASSWORD_RESET' AND "token" IS NOT NULL
         AND num_nonnulls("senderId", "invitationId", "nutritionistName", "nutritionistEmail") = 0)
      OR ("kind" = 'INVITATION' AND "token" IS NULL
         AND num_nonnulls("senderId", "invitationId", "nutritionistName", "nutritionistEmail") = 4)
    )
);

CREATE INDEX "NotificationOutboxEntry_nextAttemptAt_id_idx" ON "NotificationOutboxEntry"("nextAttemptAt", "id");
CREATE INDEX "NotificationOutboxEntry_expiresAt_idx" ON "NotificationOutboxEntry"("expiresAt");
CREATE INDEX "NotificationOutboxEntry_recipientId_idx" ON "NotificationOutboxEntry"("recipientId");
CREATE INDEX "NotificationOutboxEntry_senderId_idx" ON "NotificationOutboxEntry"("senderId");

COMMIT;
