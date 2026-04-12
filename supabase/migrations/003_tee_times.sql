-- Add tee_time column to player_scores for players who haven't started the current round
alter table player_scores add column if not exists tee_time text;
