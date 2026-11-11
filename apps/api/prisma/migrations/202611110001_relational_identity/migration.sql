BEGIN;

-- Condivide il lock della UnitOfWork prima di leggere lo stato di Identity.
SELECT pg_advisory_xact_lock(72564103);
LOCK TABLE "IdentityState" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "IdentityState"
        WHERE jsonb_typeof("data"->'accounts') IS DISTINCT FROM 'array'
           OR jsonb_typeof("data"->'sessions') IS DISTINCT FROM 'array'
    ) THEN
        RAISE EXCEPTION 'IdentityState non contiene gli elenchi di account e sessioni attesi.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "IdentityState"
        CROSS JOIN LATERAL jsonb_array_elements("data"->'accounts') AS accounts(entry)
        GROUP BY lower(btrim(entry->>'email'))
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'IdentityState contiene indirizzi email duplicati dopo la normalizzazione.';
    END IF;
END;
$$;

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "birthDate" DATE,
    "heightCm" DOUBLE PRECISION,
    "resetDigest" TEXT,
    "resetIssuedAt" TIMESTAMP(3),
    "resetExpiresAt" TIMESTAMP(3),
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Account_email_normalized" CHECK ("email" <> '' AND "email" = lower(btrim("email"))),
    CONSTRAINT "Account_role_valid" CHECK ("role" IN ('PATIENT', 'NUTRITIONIST')),
    CONSTRAINT "Account_reset_complete" CHECK (num_nonnulls("resetDigest", "resetIssuedAt", "resetExpiresAt") IN (0, 3))
);

CREATE TABLE "AccountSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");
CREATE UNIQUE INDEX "Account_resetDigest_key" ON "Account"("resetDigest");
CREATE INDEX "AccountSession_userId_idx" ON "AccountSession"("userId");
CREATE INDEX "AccountSession_expiresAt_idx" ON "AccountSession"("expiresAt");

INSERT INTO "Account" (
    "id", "email", "name", "role", "salt", "passwordHash", "birthDate", "heightCm",
    "resetDigest", "resetIssuedAt", "resetExpiresAt"
)
SELECT entry->>'id', lower(btrim(entry->>'email')), entry->>'name', entry->>'role',
       entry->>'salt', entry->>'passwordHash', (entry->>'birthDate')::date,
       (entry->>'heightCm')::double precision, entry #>> '{passwordReset,digest}',
       to_timestamp((entry #>> '{passwordReset,issuedAt}')::double precision / 1000) AT TIME ZONE 'UTC',
       to_timestamp((entry #>> '{passwordReset,expiresAt}')::double precision / 1000) AT TIME ZONE 'UTC'
FROM "IdentityState"
CROSS JOIN LATERAL jsonb_array_elements("data"->'accounts') AS accounts(entry);

INSERT INTO "AccountSession" ("id", "userId", "csrfToken", "expiresAt")
SELECT entry->>'id', entry->>'userId', entry->>'csrfToken',
       to_timestamp((entry->>'expiresAt')::double precision / 1000) AT TIME ZONE 'UTC'
FROM "IdentityState"
CROSS JOIN LATERAL jsonb_array_elements("data"->'sessions') AS sessions(entry);

DO $$
BEGIN
    IF (SELECT count(*) FROM "Account") <>
           (SELECT coalesce(sum(jsonb_array_length("data"->'accounts')), 0) FROM "IdentityState")
       OR (SELECT count(*) FROM "AccountSession") <>
           (SELECT coalesce(sum(jsonb_array_length("data"->'sessions')), 0) FROM "IdentityState") THEN
        RAISE EXCEPTION 'Il numero di account o sessioni copiati non corrisponde a IdentityState.';
    END IF;
END;
$$;

DROP TABLE "IdentityState";

COMMIT;
