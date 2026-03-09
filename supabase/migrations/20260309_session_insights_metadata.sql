-- Add metadata column to session_insights.
-- Stores evidence signals computed when the insight fired (evidence object
-- from the rule engine). Nullable so existing rows are unaffected.
ALTER TABLE session_insights
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
