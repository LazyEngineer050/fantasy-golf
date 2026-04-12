@AGENTS.md

# ButteryBiscuits Fantasy Golf

## App overview
Fantasy golf league app for an offline snake draft. The commissioner assigns players to teams manually. Scores are pulled from ESPN and updated live on the leaderboard.

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
- Current Masters ESPN event ID: `401811941`

## Scoring pipeline
1. `POST /api/refresh` (public) — called by the leaderboard client every 30 seconds
2. `POST /api/ingest` (secret-protected) — same logic, for manual/cron use
3. Both call `lib/ingest.ts → runIngest(tournamentId)`
4. Scores written to `player_scores` (r1–r4 + total + today + thru + position)
5. `lib/scoring.ts → recomputeTeamScores()` updates `team_scores` and ranks

## Database schema highlights
- `picks.round` = draft round (1–4), not golf round
- `player_scores` has `r1_strokes`, `r2_strokes`, `r3_strokes`, `r4_strokes` (added in migration 002)
- `team_scores` has `total_strokes` and `rank` (recomputed after each ingest)
- Migrations live in `supabase/migrations/` — run manually in Supabase SQL editor

## Commissioner flow
- `/commissioner` — build teams offline, assign players from ESPN pool, save draft
- `saveDraft()` creates users, league_members, picks, sets league status to `live`
- Management tab: rename team, delete team, add/remove individual picks

## Leaderboard (`/dashboard/[leagueId]`)
- **Teams view**: ranked team cards with player table. Columns: Player | icons | Total | R{n}…R1
- **Players view**: flat sorted list of all players with Owner column
- 🔥 = team with most-improved score over last 10 polls; 🥶 = most-declined (always one of each)
- ⭐ = overall tournament leader player; 💩 = worst current-round score on a team (if over par)
- Polls `/api/refresh` + `/api/scores` every 30 seconds to update standings and track movement history
- `HISTORY_CAP = 10` snapshots; movement icons always assigned (relative ranking, not threshold)

## Environment variables (Vercel + .env.local)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `INGEST_SECRET` = `biscuits-2026-secret` (on Vercel)
