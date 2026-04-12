-- ============================================================
-- Historical league data: 2025 & 2026 seasons
-- Players: Dawg, CFitz, Deebs, WC
--
-- Team scores (relative to par):
--   Players Championship 2026: CFitz -35, Deebs -28, Dawg -27, WC -21
--   US Open 2025:              WC +15, CFitz +24, Dawg +25, Deebs +26
--   PGA Championship 2025:     WC -29, Deebs -10, CFitz -8, Dawg -1
--   Masters 2025:              Deebs -29, WC -23, CFitz -19, Dawg -9
--
-- "Overall winner" (best individual player, wins $50 prize) denoted per tournament.
-- A synthetic champion player is inserted per tournament to drive the winnings calc.
-- ============================================================

DO $$
DECLARE
  -- User IDs
  dawg_id  uuid;
  cfitz_id uuid;
  deebs_id uuid;
  wc_id    uuid;

  -- Series IDs
  series_2025_id uuid;
  series_2026_id uuid;

  -- Tournament IDs
  masters_id  uuid;
  pga_id      uuid;
  usopen_id   uuid;
  players_id  uuid;

  -- League IDs
  masters_league  uuid;
  pga_league      uuid;
  usopen_league   uuid;
  players_league  uuid;

  -- Synthetic champion player IDs (one per tournament)
  masters_champ  uuid;
  pga_champ      uuid;
  usopen_champ   uuid;
  players_champ  uuid;

BEGIN

  -- ── Users ───────────────────────────────────────────────────────────────────
  -- Look up each user by display_name; create if not found.

  SELECT id INTO dawg_id  FROM users WHERE display_name = 'Dawg'  LIMIT 1;
  IF dawg_id  IS NULL THEN dawg_id  := gen_random_uuid(); INSERT INTO users (id, display_name) VALUES (dawg_id,  'Dawg');  END IF;

  SELECT id INTO cfitz_id FROM users WHERE display_name = 'CFitz' LIMIT 1;
  IF cfitz_id IS NULL THEN cfitz_id := gen_random_uuid(); INSERT INTO users (id, display_name) VALUES (cfitz_id, 'CFitz'); END IF;

  SELECT id INTO deebs_id FROM users WHERE display_name = 'Deebs' LIMIT 1;
  IF deebs_id IS NULL THEN deebs_id := gen_random_uuid(); INSERT INTO users (id, display_name) VALUES (deebs_id, 'Deebs'); END IF;

  SELECT id INTO wc_id    FROM users WHERE display_name = 'WC'    LIMIT 1;
  IF wc_id    IS NULL THEN wc_id    := gen_random_uuid(); INSERT INTO users (id, display_name) VALUES (wc_id,    'WC');    END IF;

  -- ── Series ──────────────────────────────────────────────────────────────────

  series_2025_id := gen_random_uuid();
  INSERT INTO series (id, name, year) VALUES (series_2025_id, 'ButteryBiscuits', 2025);

  series_2026_id := gen_random_uuid();
  INSERT INTO series (id, name, year) VALUES (series_2026_id, 'ButteryBiscuits', 2026);

  -- ── Tournaments ─────────────────────────────────────────────────────────────

  masters_id := gen_random_uuid();
  INSERT INTO tournaments (id, name, start_date, end_date)
  VALUES (masters_id, 'The Masters', '2025-04-10', '2025-04-13');

  pga_id := gen_random_uuid();
  INSERT INTO tournaments (id, name, start_date, end_date)
  VALUES (pga_id, 'PGA Championship', '2025-05-15', '2025-05-18');

  usopen_id := gen_random_uuid();
  INSERT INTO tournaments (id, name, start_date, end_date)
  VALUES (usopen_id, 'U.S. Open', '2025-06-12', '2025-06-15');

  players_id := gen_random_uuid();
  INSERT INTO tournaments (id, name, start_date, end_date)
  VALUES (players_id, 'The Players Championship', '2026-03-13', '2026-03-16');

  -- ── Leagues ─────────────────────────────────────────────────────────────────

  masters_league := gen_random_uuid();
  INSERT INTO leagues (id, name, tournament_id, status, series_id)
  VALUES (masters_league, 'ButteryBiscuits', masters_id, 'completed', series_2025_id);

  pga_league := gen_random_uuid();
  INSERT INTO leagues (id, name, tournament_id, status, series_id)
  VALUES (pga_league, 'ButteryBiscuits', pga_id, 'completed', series_2025_id);

  usopen_league := gen_random_uuid();
  INSERT INTO leagues (id, name, tournament_id, status, series_id)
  VALUES (usopen_league, 'ButteryBiscuits', usopen_id, 'completed', series_2025_id);

  players_league := gen_random_uuid();
  INSERT INTO leagues (id, name, tournament_id, status, series_id)
  VALUES (players_league, 'ButteryBiscuits', players_id, 'completed', series_2026_id);

  -- ── League Members ──────────────────────────────────────────────────────────
  -- Draft positions are arbitrary for historical data.

  INSERT INTO league_members (league_id, user_id, draft_position) VALUES
    (masters_league,  dawg_id,  1), (masters_league,  cfitz_id, 2),
    (masters_league,  deebs_id, 3), (masters_league,  wc_id,    4),
    (pga_league,      dawg_id,  1), (pga_league,      cfitz_id, 2),
    (pga_league,      deebs_id, 3), (pga_league,      wc_id,    4),
    (usopen_league,   dawg_id,  1), (usopen_league,   cfitz_id, 2),
    (usopen_league,   deebs_id, 3), (usopen_league,   wc_id,    4),
    (players_league,  dawg_id,  1), (players_league,  cfitz_id, 2),
    (players_league,  deebs_id, 3), (players_league,  wc_id,    4);

  -- ── Team Scores ─────────────────────────────────────────────────────────────

  -- Masters 2025: Deebs -29(1), WC -23(2), CFitz -19(3), Dawg -9(4)
  INSERT INTO team_scores (league_id, user_id, total_strokes, rank) VALUES
    (masters_league, deebs_id, -29, 1),
    (masters_league, wc_id,    -23, 2),
    (masters_league, cfitz_id, -19, 3),
    (masters_league, dawg_id,   -9, 4);

  -- PGA Championship 2025: WC -29(1), Deebs -10(2), CFitz -8(3), Dawg -1(4)
  INSERT INTO team_scores (league_id, user_id, total_strokes, rank) VALUES
    (pga_league, wc_id,    -29, 1),
    (pga_league, deebs_id, -10, 2),
    (pga_league, cfitz_id,  -8, 3),
    (pga_league, dawg_id,   -1, 4);

  -- US Open 2025: WC +15(1), CFitz +24(2), Dawg +25(3), Deebs +26(4)
  INSERT INTO team_scores (league_id, user_id, total_strokes, rank) VALUES
    (usopen_league, wc_id,    15, 1),
    (usopen_league, cfitz_id, 24, 2),
    (usopen_league, dawg_id,  25, 3),
    (usopen_league, deebs_id, 26, 4);

  -- Players Championship 2026: CFitz -35(1), Deebs -28(2), Dawg -27(3), WC -21(4)
  INSERT INTO team_scores (league_id, user_id, total_strokes, rank) VALUES
    (players_league, cfitz_id, -35, 1),
    (players_league, deebs_id, -28, 2),
    (players_league, dawg_id,  -27, 3),
    (players_league, wc_id,    -21, 4);

  -- ── Synthetic Champion Players ───────────────────────────────────────────────
  -- One player per tournament representing the overall individual winner.
  -- Score is set 1 stroke better than the best team score to guarantee
  -- it's the lowest individual score, triggering the $50 prize correctly.
  -- The pick is owned by the "overall winner" team for that tournament.

  -- Masters 2025 — overall winner: Deebs (score -30, one better than team -29)
  masters_champ := gen_random_uuid();
  INSERT INTO players (id, name) VALUES (masters_champ, 'Masters Champion');
  INSERT INTO tournament_players (tournament_id, player_id, status) VALUES (masters_id, masters_champ, 'active');
  INSERT INTO player_scores (tournament_id, player_id, total_strokes, thru, position)
  VALUES (masters_id, masters_champ, -30, 'F', '1');
  INSERT INTO picks (id, league_id, pick_number, round, user_id, player_id)
  VALUES (gen_random_uuid(), masters_league, 1, 1, deebs_id, masters_champ);

  -- PGA Championship 2025 — overall winner: WC (score -30, one better than team -29)
  pga_champ := gen_random_uuid();
  INSERT INTO players (id, name) VALUES (pga_champ, 'PGA Champion');
  INSERT INTO tournament_players (tournament_id, player_id, status) VALUES (pga_id, pga_champ, 'active');
  INSERT INTO player_scores (tournament_id, player_id, total_strokes, thru, position)
  VALUES (pga_id, pga_champ, -30, 'F', '1');
  INSERT INTO picks (id, league_id, pick_number, round, user_id, player_id)
  VALUES (gen_random_uuid(), pga_league, 1, 1, wc_id, pga_champ);

  -- US Open 2025 — overall winner: WC (score +14, one better than team +15)
  usopen_champ := gen_random_uuid();
  INSERT INTO players (id, name) VALUES (usopen_champ, 'U.S. Open Champion');
  INSERT INTO tournament_players (tournament_id, player_id, status) VALUES (usopen_id, usopen_champ, 'active');
  INSERT INTO player_scores (tournament_id, player_id, total_strokes, thru, position)
  VALUES (usopen_id, usopen_champ, 14, 'F', '1');
  INSERT INTO picks (id, league_id, pick_number, round, user_id, player_id)
  VALUES (gen_random_uuid(), usopen_league, 1, 1, wc_id, usopen_champ);

  -- Players Championship 2026 — overall winner: WC (CFitz had best team score)
  players_champ := gen_random_uuid();
  INSERT INTO players (id, name) VALUES (players_champ, 'Players Champion');
  INSERT INTO tournament_players (tournament_id, player_id, status) VALUES (players_id, players_champ, 'active');
  INSERT INTO player_scores (tournament_id, player_id, total_strokes, thru, position)
  VALUES (players_id, players_champ, -36, 'F', '1');
  INSERT INTO picks (id, league_id, pick_number, round, user_id, player_id)
  VALUES (gen_random_uuid(), players_league, 1, 1, wc_id, players_champ);

END $$;
