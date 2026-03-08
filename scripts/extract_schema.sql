-- ============================================================
-- Member 1 — Schema Extraction SQL
-- Extracts full schema metadata from information_schema
-- ============================================================

-- 1. List all user-defined tables in the public schema
SELECT
    t.table_name,
    t.table_type,
    obj_description(pgc.oid, 'pg_class') AS table_comment
FROM information_schema.tables t
JOIN pg_class pgc ON pgc.relname = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;

-- 2. Detailed column metadata per table
SELECT
    c.table_name,
    c.column_name,
    c.ordinal_position,
    c.column_default,
    c.is_nullable,
    c.data_type,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale,
    c.udt_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;

-- 3. Primary key constraints
SELECT
    kcu.table_name,
    kcu.column_name,
    tco.constraint_name
FROM information_schema.table_constraints tco
JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tco.constraint_name
    AND kcu.constraint_schema = tco.constraint_schema
WHERE tco.constraint_type = 'PRIMARY KEY'
  AND kcu.table_schema = 'public'
ORDER BY kcu.table_name, kcu.ordinal_position;

-- 4. Foreign key constraints (dependency graph)
SELECT
    tc.table_name            AS source_table,
    kcu.column_name          AS source_column,
    ccu.table_name           AS target_table,
    ccu.column_name          AS target_column,
    tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY source_table, source_column;

-- 5. Unique constraints
SELECT
    tc.table_name,
    kcu.column_name,
    tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'UNIQUE'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- 6. Check constraints
SELECT
    tc.table_name,
    tc.constraint_name,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
WHERE tc.constraint_type = 'CHECK'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- 7. Indexes (from pg_indexes — more complete than information_schema)
SELECT
    tablename             AS table_name,
    indexname             AS index_name,
    indexdef              AS index_definition
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ============================================================
-- M5 — Index Effectiveness Queries (run with EXPLAIN ANALYZE)
-- ============================================================

-- Check if commit history query uses the composite index
EXPLAIN ANALYZE
SELECT id, message, author, "createdAt", "prevCommitId", "branchId", "projectId"
FROM "Commit"
WHERE "projectId" = 1 AND "branchId" = 1
ORDER BY "createdAt" DESC
LIMIT 50;

-- Check branch HEAD resolution
EXPLAIN ANALYZE
SELECT id, name, "headCommitId"
FROM "Branch"
WHERE "projectId" = 1 AND name = 'main';

-- Check project lookup
EXPLAIN ANALYZE
SELECT id, name, "targetDbUrl"
FROM "Project"
WHERE name = 'my-app';
