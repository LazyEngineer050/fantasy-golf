@AGENTS.md

# ButteryBiscuits Fantasy Golf

## App overview
Fantasy golf league app for an offline snake draft. The commissioner assigns players to teams manually. Scores are pulled from ESPN and updated live on the leaderboard. Supports multiple leagues grouped into a season series.

Live at: **https://fantasy-golf-sooty.vercel.app**

## Stack
- Next.js App Router (server components + server actions + API routes)
- Supabase (Postgres + Realtime) — project: `azcvtsosvpdavejayhiu.supabase.co`
- Tailwind CSS v4, dark theme (bg-gray-950)
- Deployed on Vercel (auto-deploys on push to `main`)

## Key conventions
- Server components fetch data; client components handle interactivity
- Never use PostgREST join syntax (e.g. `players(name)`) on `picks` — it silently fails. Always do two separate queries
- Supabase service client for writes/ingestion, anon client for reads in server components
- All scores are **relative to par** (e.g. -12, +4, E), not raw strokes
- `today_strokes` = current round score from ESPN; `total_strokes` = full tournament total

## ESPN data
- Scoreboard endpoint (works publicly): `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard`
- Leaderboard endpoint (`site.web.api.espn.com`) returns 404 publicly — do not use
- Cut line is inferred: top 50 + ties on 2-round stroke totals
- Tee time is in `linescores[period=N].statistics.categories[0].stats[-1].displayValue` (format: "Sun Apr 12 14:25:00 PDT 2026" — labeled PDT but is ET)
- `inferThru`: when a round has 18 nested hole linescores, check for an unplayed round (value===0) at a later period before returning 'F' — otherwise past completed rounds wrongly show as finished

## Scoring pipeline
1. `POST /api/refresh` (public) — called by leaderboard client every 30 s
2. `POST /api/ingest` (secret-protected) — same logic, for manual/cron use
3. Both call `lib/ingest.ts → runIngest(tournamentId)`
4. Scores written to `player_scores` (r1–r4 + total + today + thru + position + tee_time)
5. `lib/scoring.ts → recomputeTeamScores()` updates `team_scores` and ranks
6. After recompute: if all active players have `thru='F'`, leagues for that tournament are auto-marked `completed`

## Database schema highlights
- `picks.round` = draft round (1–4), not golf round
- `player_scores`: `r1–r4_strokes`, `total_strokes`, `today_strokes`, `thru`, `position`, `tee_time`
- `team_scores`: `total_strokes`, `rank` (recomputed after each ingest)
- `series`: groups leagues into a season (`id`, `name`, `year`)
- `leagues.series_id` → optional FK to `series`
- Migrations live in `supabase/migrations/` — run manually in Supabase SQL editor

## Routes
- `/` — home; leagues grouped by series with "Season Standings →" links; standalone leagues below
- `/series/[seriesId]` — season standings table (points per tournament), live/upcoming league links
- `/dashboard/[leagueId]` — live leaderboard; ⛳ home link in header; league switcher if >1 league
- `/draft/[leagueId]` — real-time draft room
- `/commissioner` — build teams offline, assign players from ESPN pool, save draft; Management tab: rename/delete team, add/remove picks
- `/admin` — create series, tournaments, leagues; manage league members, status, draft init

## Leaderboard (`/dashboard/[leagueId]`)
- **Teams view**: ranked team cards with player table. Columns: Player | icons | Total | R{n}…R1
- **Players view**: flat sorted list of all players with Owner column
- 🔥 = most-improved team over last 10 polls; 🥶 = most-declined (always one each)
- ⭐ = overall tournament leader player (all tied leaders get it); 💩 = worst today score on a team (if over par)
- Yellow highlight + ⭐ on tied leaders in both Teams and Players views
- Tee time shown for players who haven't started today's round (format: "2:25 PM ET")
- Today's score suppressed (shows —) for players not yet on the course
- 🏆 winner banner when league `status = 'completed'`; polling stops automatically
- Polls `/api/refresh` + `/api/scores` every 30 s; `/api/scores` returns full player data (thru, tee_time, r1–r4) so all columns stay live

## Series / multi-tournament
- Admin creates a Series, then creates leagues and assigns them to it
- `/series/[seriesId]` shows a points table across all completed leagues in the series
- Points: 1st=10, 2nd=7, 3rd=5, 4th=4, 5th=3, 6th=2, 7th+=1; ties split points (averaged)
- Home page groups leagues by series; standalone leagues shown separately

## Commissioner flow
- `/commissioner` — build teams offline, assign players from ESPN pool, save draft
- `saveDraft()` creates users, league_members, picks, sets league status to `live`
- Management tab: rename team, delete team, add/remove individual picks
- "End Tournament" button (when live) calls `completeLeague()` → sets status to `completed`

## Environment variables (Vercel + .env.local)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `INGEST_SECRET` = `biscuits-2026-secret` (on Vercel)
