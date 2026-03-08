-- Create a GIN index on the diff JSONB column to accelerate metadata searches
CREATE INDEX "Commit_diff_gin_idx" ON "Commit" USING GIN ("diff");