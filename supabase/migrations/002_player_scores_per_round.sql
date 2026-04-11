-- Add per-round stroke columns to player_scores
alter table player_scores add column if not exists r1_strokes int;
alter table player_scores add column if not exists r2_strokes int;
alter table player_scores add column if not exists r3_strokes int;
alter table player_scores add column if not exists r4_strokes int;
