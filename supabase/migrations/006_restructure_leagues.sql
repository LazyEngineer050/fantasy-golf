-- ============================================================
-- 006: Restructure leagues → seasons → league_seasons → league_tournaments
--
-- Before: leagues (tied to one tournament), league_members (per league)
-- After:
--   leagues          = persistent group (e.g. "ButteryBiscuits")
--   seasons          = calendar year (2025, 2026…)
--   league_seasons   = a league's participation in a season (members defined here)
--   league_tournaments = a league's draft + scores for one tournament
--
-- Existing data is migrated automatically.
-- Run in Supabase SQL editor.
-- ============================================================

BEGIN;

-- ── Step 1: Rename leagues → league_tournaments (IDs are preserved) ────────────

ALTER TABLE leagues RENAME TO league_tournaments;

-- ── Step 2: Create seasons ────────────────────────────────────────────────────

CREATE TABLE seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ── Step 3: Create new leagues table (persistent group) ───────────────────────

CREATE TABLE leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ── Step 4: Create league_seasons ─────────────────────────────────────────────

CREATE TABLE league_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(league_id, season_id)
);

-- ── Step 5: Create league_season_members (replaces league_members) ─────────────

CREATE TABLE league_season_members (
  league_season_id uuid NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_position int NOT NULL,
  PRIMARY KEY (league_season_id, user_id)
);

-- ── Step 6: Add league_season_id to league_tournaments (nullable for migration) ─

ALTER TABLE league_tournaments
  ADD COLUMN league_season_id uuid REFERENCES league_seasons(id) ON DELETE CASCADE;

-- ── Step 7: Migrate existing data ─────────────────────────────────────────────

DO $$
DECLARE
  bp_league_id    uuid;
  season_2025_id  uuid;
  season_2026_id  uuid;
  ls_2025_id      uuid;
  ls_2026_id      uuid;
  r               RECORD;
BEGIN
  -- Create seasons
  INSERT INTO seasons (year) VALUES (2025) RETURNING id INTO season_2025_id;
  INSERT INTO seasons (year) VALUES (2026) RETURNING id INTO season_2026_id;

  -- Create the single "Pride Points" league from historical data
  -- (all old league rows share the same name — one persistent league)
  INSERT INTO leagues (name) VALUES ('Pride Points') RETURNING id INTO bp_league_id;

  -- Create league_seasons for both years
  INSERT INTO league_seasons (league_id, season_id)
    VALUES (bp_league_id, season_2025_id) RETURNING id INTO ls_2025_id;
  INSERT INTO league_seasons (league_id, season_id)
    VALUES (bp_league_id, season_2026_id) RETURNING id INTO ls_2026_id;

  -- Assign league_season_id to each league_tournament based on tournament year
  FOR r IN
    SELECT lt.id, EXTRACT(YEAR FROM t.start_date::date)::int AS yr
    FROM league_tournaments lt
    JOIN tournaments t ON t.id = lt.tournament_id
  LOOP
    IF r.yr <= 2025 THEN
      UPDATE league_tournaments SET league_season_id = ls_2025_id WHERE id = r.id;
    ELSE
      UPDATE league_tournaments SET league_season_id = ls_2026_id WHERE id = r.id;
    END IF;
  END LOOP;

  -- Migrate league_members → league_season_members (deduplicated per league_season)
  INSERT INTO league_season_members (league_season_id, user_id, draft_position)
  SELECT DISTINCT ON (lt.league_season_id, lm.user_id)
    lt.league_season_id,
    lm.user_id,
    lm.draft_position
  FROM league_members lm
  JOIN league_tournaments lt ON lt.id = lm.league_id
  WHERE lt.league_season_id IS NOT NULL
  ORDER BY lt.league_season_id, lm.user_id, lm.draft_position;
END $$;

-- ── Step 8: Lock down league_season_id ────────────────────────────────────────

ALTER TABLE league_tournaments
  ALTER COLUMN league_season_id SET NOT NULL;

-- ── Step 9: Drop name from league_tournaments (name lives on leagues now) ──────

ALTER TABLE league_tournaments DROP COLUMN name;

-- ── Step 10: Drop old league_members ──────────────────────────────────────────

DROP TABLE league_members;

-- ── Step 11: Rename league_id → league_tournament_id in picks/team_scores/draft_state ──

-- Must drop and recreate the trigger — PL/pgSQL source references column by name
DROP TRIGGER IF EXISTS enforce_max_picks ON picks;
DROP FUNCTION IF EXISTS check_max_picks();

ALTER TABLE picks       RENAME COLUMN league_id TO league_tournament_id;
ALTER TABLE team_scores RENAME COLUMN league_id TO league_tournament_id;
ALTER TABLE draft_state RENAME COLUMN league_id TO league_tournament_id;

-- ── Step 12: Recreate max-picks trigger with new column name ──────────────────

CREATE OR REPLACE FUNCTION check_max_picks()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  existing_count int;
BEGIN
  SELECT count(*) INTO existing_count
  FROM picks
  WHERE league_tournament_id = NEW.league_tournament_id
    AND user_id = NEW.user_id;
  IF existing_count >= 4 THEN
    RAISE EXCEPTION 'User already has 4 picks in this league tournament';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_max_picks
  BEFORE INSERT ON picks
  FOR EACH ROW EXECUTE FUNCTION check_max_picks();

-- ── Step 13: Update indexes ───────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_picks_league;
DROP INDEX IF EXISTS idx_picks_user;
DROP INDEX IF EXISTS idx_team_scores_league;

CREATE INDEX idx_picks_lt       ON picks(league_tournament_id);
CREATE INDEX idx_picks_user_lt  ON picks(league_tournament_id, user_id);
CREATE INDEX idx_team_scores_lt ON team_scores(league_tournament_id, rank);
CREATE INDEX idx_lt_season      ON league_tournaments(league_season_id);

-- ── Step 14: Add season_id to tournaments (for grouping by season) ─────────────

ALTER TABLE tournaments ADD COLUMN season_id uuid REFERENCES seasons(id);

UPDATE tournaments t
SET season_id = s.id
FROM seasons s
WHERE EXTRACT(YEAR FROM t.start_date::date)::int = s.year;

COMMIT;
