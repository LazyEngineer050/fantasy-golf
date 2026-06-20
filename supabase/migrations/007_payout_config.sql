-- Per-tournament configurable payout structure.
-- Defaults match the existing hardcoded values so all historical data is unaffected.
ALTER TABLE league_tournaments
  ADD COLUMN IF NOT EXISTS buy_in integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS best_player_prize integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS best_team_prize integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS side_bet integer NOT NULL DEFAULT 5;
