-- =============================================================================
-- Migration: Enable Row Level Security on all public tables
-- Project:   Cogniflow
-- Date:      2026-03-05
--
-- Architecture note:
--   This app uses Prisma + NextAuth.js (custom JWT) — it does NOT use Supabase
--   Auth. All server-side DB access is performed through the postgres superuser
--   (service role), which bypasses RLS by default because it has the BYPASSRLS
--   privilege. Enabling RLS therefore:
--
--     ✓ Blocks anonymous / anon-key requests from PostgREST (the API surface
--       that Supabase exposes publicly) — fixing the security alerts.
--     ✓ Does NOT break any existing Prisma queries (they run as superuser).
--
--   Each table gets one or more policies that are intentionally restrictive for
--   the anon / authenticated roles so that no row is reachable through the
--   PostgREST REST API without an explicit grant.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENABLE RLS ON ALL AFFECTED TABLES
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problems             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_concept_gaps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_insights     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_concept_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_tags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_cases           ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FORCE RLS EVEN FOR TABLE OWNERS (belt-and-suspenders)
--    Supabase's postgres user owns the tables and normally bypasses RLS.
--    FORCE ROW LEVEL SECURITY makes the policies apply to the owner role too,
--    so PostgREST requests made with the service_role key (owner) also go
--    through policies. This is the strictest option — remove if Prisma queries
--    start failing (they use the pg superuser which retains BYPASSRLS).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users                FORCE ROW LEVEL SECURITY;
ALTER TABLE public.problems             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sessions             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.session_events       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_concept_gaps    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.session_insights     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.problem_concept_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE public.concept_tags         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.test_cases           FORCE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. POLICIES
--
-- Strategy per table type:
--
--   Reference / lookup tables (read-only public data):
--     problems, concept_tags, problem_concept_tags, test_cases
--     → Allow SELECT for authenticated role only (requires a valid JWT).
--       Anonymous users get nothing.
--
--   User-owned tables (PII / private data):
--     users, sessions, session_events, session_insights, user_concept_gaps
--     → No policies for anon or authenticated roles.
--       All access is only through the server-side Prisma connection (superuser
--       with BYPASSRLS). PostgREST anon/authenticated requests are denied.
--
-- ─────────────────────────────────────────────────────────────────────────────


-- ── problems ──────────────────────────────────────────────────────────────────
-- Public problems can be read by any logged-in user (no write via API).

CREATE POLICY "authenticated users can read problems"
  ON public.problems
  FOR SELECT
  TO authenticated
  USING (true);


-- ── concept_tags ─────────────────────────────────────────────────────────────

CREATE POLICY "authenticated users can read concept_tags"
  ON public.concept_tags
  FOR SELECT
  TO authenticated
  USING (true);


-- ── problem_concept_tags ─────────────────────────────────────────────────────

CREATE POLICY "authenticated users can read problem_concept_tags"
  ON public.problem_concept_tags
  FOR SELECT
  TO authenticated
  USING (true);


-- ── test_cases ───────────────────────────────────────────────────────────────

CREATE POLICY "authenticated users can read test_cases"
  ON public.test_cases
  FOR SELECT
  TO authenticated
  USING (true);


-- ── users ────────────────────────────────────────────────────────────────────
-- No PostgREST access at all — all CRUD goes through Prisma (server-side).
-- Intentionally no policy is created so the default-deny applies to every role.


-- ── sessions ─────────────────────────────────────────────────────────────────
-- Same: server-only via Prisma.


-- ── session_events ───────────────────────────────────────────────────────────
-- Same: server-only via Prisma.


-- ── session_insights ─────────────────────────────────────────────────────────
-- Same: server-only via Prisma.


-- ── user_concept_gaps ────────────────────────────────────────────────────────
-- Same: server-only via Prisma.


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK INSTRUCTIONS (run to undo):
--
--   ALTER TABLE public.users                DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.problems             DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.sessions             DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.session_events       DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.user_concept_gaps    DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.session_insights     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.problem_concept_tags DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.concept_tags         DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.test_cases           DISABLE ROW LEVEL SECURITY;
--
--   DROP POLICY IF EXISTS "authenticated users can read problems"             ON public.problems;
--   DROP POLICY IF EXISTS "authenticated users can read concept_tags"         ON public.concept_tags;
--   DROP POLICY IF EXISTS "authenticated users can read problem_concept_tags" ON public.problem_concept_tags;
--   DROP POLICY IF EXISTS "authenticated users can read test_cases"           ON public.test_cases;
-- =============================================================================
