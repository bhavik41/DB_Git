-- Member 6: Concurrency Control Tables Migration
-- Run this if you're applying manually instead of using: npx prisma migrate dev --name m6_concurrency

-- Table: CommitInProgress
-- Tracks operations currently in-flight for crash recovery.
-- Written at START of atomic operation, deleted at END.
-- Survivors after server restart = crashed operations.

CREATE TABLE IF NOT EXISTS "CommitInProgress" (
    "id"          TEXT         NOT NULL,
    "projectName" TEXT         NOT NULL,
    "branchName"  TEXT         NOT NULL,
    "author"      TEXT         NOT NULL,
    "pid"         INTEGER      NOT NULL,
    "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitInProgress_pkey" PRIMARY KEY ("id")
);

-- Indexes for fast recovery scans
CREATE INDEX IF NOT EXISTS "CommitInProgress_projectName_branchName_idx"
    ON "CommitInProgress"("projectName", "branchName");

CREATE INDEX IF NOT EXISTS "CommitInProgress_startedAt_idx"
    ON "CommitInProgress"("startedAt");

CREATE INDEX IF NOT EXISTS "CommitInProgress_pid_idx"
    ON "CommitInProgress"("pid");


-- Table: FailureLog
-- Permanent audit trail of failed operations. Never deleted.
-- Written when a commit/rollback crashes or is force-cleaned.

CREATE TABLE IF NOT EXISTS "FailureLog" (
    "id"          TEXT         NOT NULL,
    "operation"   TEXT         NOT NULL,
    "projectName" TEXT         NOT NULL,
    "branchName"  TEXT,
    "author"      TEXT,
    "error"       TEXT         NOT NULL,
    "context"     JSONB,
    "occurredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailureLog_pkey" PRIMARY KEY ("id")
);

-- Indexes for failure log queries
CREATE INDEX IF NOT EXISTS "FailureLog_projectName_idx"
    ON "FailureLog"("projectName");

CREATE INDEX IF NOT EXISTS "FailureLog_occurredAt_idx"
    ON "FailureLog"("occurredAt" DESC);

CREATE INDEX IF NOT EXISTS "FailureLog_operation_idx"
    ON "FailureLog"("operation");
