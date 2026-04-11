-- ============================================================
-- Fantasy Golf – Initial Schema
-- Run this in the Supabase SQL editor (or via supabase db push)
-- ============================================================

-- Users
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null
);

-- Tournaments
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  espn_event_id text unique,          -- ESPN internal event ID for ingestion
  start_date date not null,
  end_date date not null
);

-- Leagues
do $$ begin
  create type league_status as enum ('drafting', 'live', 'completed');
exception when duplicate_object then null;
end $$;

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tournament_id uuid not null references tournaments(id),
  status league_status not null default 'drafting'
);

-- League Members (draft_position 1-based)
create table if not exists league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id),
  draft_position int not null,
  primary key (league_id, user_id),
  unique (league_id, draft_position)
);

-- Players (global roster)
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  espn_player_id text unique          -- ESPN internal player ID
);

-- Tournament Players (cut / active / wd status)
do $$ begin
  create type player_status as enum ('active', 'cut', 'wd');
exception when duplicate_object then null;
end $$;

create table if not exists tournament_players (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  status player_status not null default 'active',
  primary key (tournament_id, player_id)
);

-- Draft State (one row per league)
create table if not exists draft_state (
  league_id uuid primary key references leagues(id) on delete cascade,
  round int not null default 1,        -- 1–4
  pick_number int not null default 1,  -- global pick counter (1-based)
  on_clock_user_id uuid references users(id),
  direction int not null default 1,    -- 1 = forward, -1 = backward
  started_at timestamptz default now()
);

-- Picks
create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  pick_number int not null,
  round int not null,
  user_id uuid not null references users(id),
  player_id uuid not null references players(id),
  timestamp timestamptz not null default now(),
  -- Each player can only be drafted once per league
  unique (league_id, player_id),
  -- Each pick slot is unique per league
  unique (league_id, pick_number)
);

-- Player Scores (updated by ESPN ingestion)
create table if not exists player_scores (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  total_strokes int,
  today_strokes int,
  thru text,                          -- e.g. "F", "9", "-"
  position text,                      -- e.g. "T3", "1", "CUT"
  updated_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

-- Team Scores (recomputed after each ESPN update)
create table if not exists team_scores (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id),
  total_strokes int,
  rank int,
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- ============================================================
-- Max-4-picks-per-user constraint (enforced via trigger)
-- ============================================================
create or replace function check_max_picks()
returns trigger language plpgsql as $$
declare
  existing_count int;
begin
  select count(*) into existing_count
  from picks
  where league_id = NEW.league_id and user_id = NEW.user_id;

  if existing_count >= 4 then
    raise exception 'User already has 4 picks in this league';
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_max_picks on picks;
create trigger enforce_max_picks
  before insert on picks
  for each row execute function check_max_picks();

-- ============================================================
-- Enable Realtime on required tables
-- Run in Supabase dashboard → Database → Replication, or:
-- ============================================================
-- alter publication supabase_realtime add table picks;
-- alter publication supabase_realtime add table draft_state;
-- alter publication supabase_realtime add table player_scores;
-- alter publication supabase_realtime add table team_scores;

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_picks_league on picks(league_id);
create index if not exists idx_picks_user on picks(league_id, user_id);
create index if not exists idx_player_scores_tournament on player_scores(tournament_id);
create index if not exists idx_team_scores_league on team_scores(league_id, rank);
create index if not exists idx_tournament_players_tournament on tournament_players(tournament_id, status);
