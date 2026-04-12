-- Series: groups multiple leagues (same teams, different tournaments) into a season
create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year int,
  created_at timestamptz default now()
);

-- Link leagues to a series (optional — standalone leagues have series_id = null)
alter table leagues add column if not exists series_id uuid references series(id);
