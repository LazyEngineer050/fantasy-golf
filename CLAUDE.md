@AGENTS.md

# ButteryBiscuits Fantasy Golf

## App overview
Fantasy golf league app for an offline snake draft. The commissioner assigns players to teams manually. Scores are pulled from ESPN and updated live on the leaderboard. All leagues belong to the "Pride Points" group. The all-time standings page is the main landing page.

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
- **`linescore.value` = raw strokes** (e.g. 68, 70) — always > 0 when played, exactly 0 for unplayed/placeholder rounds. Never use `value` for relative-to-par math.
- **`linescore.displayValue`** = relative-to-par string ("-3", "E", "+2") — use `parseRelPar()` for math; use `value > 0` for structural "was this round played?" checks.
- ESPN pre-creates a placeholder R4 linescore (value=0) before R4 begins — `currentRound` must scan `[r4, r3, r2, r1]` for first with `value > 0`, not just `r4 ?? r3`.
- Cut line is derived dynamically: worst 2-round relative-to-par total among players who have R3 data (`hasMadeCut`). Falls back to top-70 sorted estimate when no R3 data exists (pre-cut).
- `hasMadeCut(c)`: true if R3 or R4 `value > 0`, OR if R3 has a tee time scheduled.
- Tee time is in `linescores[period=N].statistics.categories[0].stats[-1].displayValue` (format: "Sun Apr 12 14:25:00 PDT 2026" — labeled PDT but is ET)
- `inferThru`: when a round has 18 nested hole linescores, check for an unplayed round (value===0) at a later period before returning 'F' — otherwise past completed rounds wrongly show as finished
- All ESPN parsing functions (`parseRelPar`, `extractTeeTime`, `hasMadeCut`, `determineCutLine`, `inferStatus`, `inferThru`) are exported from `lib/espn.ts` for testability

## Scoring pipeline
1. `POST /api/refresh` (public) — called by leaderboard client every 30 s
2. `POST /api/ingest` (secret-protected) — same logic, for manual/cron use
3. Both call `lib/ingest.ts → runIngest(tournamentId)`
4. Scores written to `player_scores` (r1–r4 + total + today + thru + position + tee_time)
5. `lib/scoring.ts → recomputeTeamScores()` updates `team_scores` and ranks
6. After recompute: if all active players have `thru='F'` **and `r4_strokes IS NOT NULL`**, leagues for that tournament are auto-marked `completed` (the `r4_strokes` guard prevents premature completion after R3)

## Database schema highlights
- `picks.round` = draft round (1–4), not golf round
- `player_scores`: `r1–r4_strokes`, `total_strokes`, `today_strokes`, `thru`, `position`, `tee_time`
- `team_scores`: `total_strokes`, `rank` (recomputed after each ingest)
- `series`: groups leagues into a season (`id`, `name`, `year`)
- `leagues.series_id` → optional FK to `series`
- Migrations live in `supabase/migrations/` — run manually in Supabase SQL editor

## Routes
- `/` — redirects to `/standings`
- `/standings` — **main page**; all-time winnings table (tournaments as rows, players as columns); includes live tournaments highlighted green; links to each leaderboard
- `/dashboard/[leagueId]` — live leaderboard; breadcrumb links back to standings; league switcher in breadcrumb
- `/draft/[leagueId]` — real-time draft room
- `/commissioner` — build teams offline, assign players from ESPN pool, save draft; Management tab: rename/delete team, add/remove picks
- `/admin` — create series, tournaments, leagues; manage league members, status, draft init
- `/series/[seriesId]` — legacy series page (still exists but not linked from main nav)

## Leaderboard (`/dashboard/[leagueId]`)
- **Teams view**: ranked team cards with player table. Columns: Player | icons | Total | R{n}…R1
- **Players view**: flat sorted list of all players with Owner column
- Header: tournament name + LIVE/FINAL badge inline; Teams/Players toggle on right; league switcher in breadcrumb
- 🔥 = most-improved team, 🥶 = most-declined — always one of each; persisted to `localStorage` keyed by leagueId so fire/ice survive page refreshes. Falls back to current standings rank on first load.
- ⭐ = overall tournament leader player (all tied leaders); 💩 = turd (see below)
- Yellow highlight + ⭐ on tied leaders in both Teams and Players views
- Tee time shown for players who haven't started today's round (format: "2:25 PM ET")
- Today's score suppressed (shows —) for players not yet on the course
- 🏆 winner banner when league `status = 'completed'`; polling stops automatically
- Projected winnings shown on each team card (right of total score)
- Polls `/api/refresh` + `/api/scores` every 30 s; `/api/scores` returns full player data (thru, tee_time, r1–r4)

### Turd 💩 logic
- A player is a turd if: `today_strokes >= fieldAvgToday + 3` OR (`today_strokes > 0` AND `fieldAvgToday < 0`)
- `fieldAvgToday` = average `today_strokes` across all **started** drafted players (`thru !== null`)
- Between rounds (no player has `thru !== null` yet): use all players with `today_strokes` — this preserves previous round's turds until play begins
- Once any player starts a new round (`thru !== null`): switch to started-players-only mode, clearing old turds
- Turd size scales dynamically: worst turd = 2rem, best turd = 0.8rem, linear between
- Pure functions: `isTurd(todayStrokes, fieldAvgToday)` and `turdSize(todayStrokes, minTurd, maxTurd)` live in `lib/winnings.ts`

## Prize structure (hardcoded)
- $20 buy-in per team
- $50 → team that owns the best individual player
- $30 → team with the lowest combined score
- $5 side-bet → worst combined team pays best combined team
- Ties split prizes evenly
- `computeWinnings(standings)` lives in `lib/winnings.ts` — shared by Leaderboard.tsx and `app/standings/page.tsx`

## All-time standings (`/standings`)
- Rows = tournaments (newest at top, oldest at bottom); columns = players sorted by lifetime winnings
- Each row shows: Tournament name | Date | per-player winnings | Leaderboard → button
- Live tournaments highlighted green with ● LIVE badge; figures marked with *
- Player column headers show lifetime total winnings
- Prize structure key at bottom

## Commissioner flow
- `/commissioner` — build teams offline, assign players from ESPN pool, save draft
- `saveDraft()` creates users, league_members, picks, sets league status to `live`
- `initializeDraft()` guards against overwriting a live/completed tournament — returns an error if the league_tournament is already live or completed
- "🔴 Live Draft" button starts a real-time draft session; shows a shareable `/draft/[leagueId]` link after starting
- Management tab: rename team, delete team, add/remove individual picks
- "End Tournament" button (when live) calls `completeLeague()` → sets status to `completed`

## Live draft (`/draft/[leagueId]`)
- Cookie-based identity: `/api/identify` sets a `user_id` cookie (no passwords)
- Snake draft algorithm synced via Supabase Realtime on `draft_state` and `picks` tables
- Supabase Realtime must be enabled: Dashboard → Realtime → Publications → `supabase_realtime` → enable for `draft_state` and `picks`
- `draft_state` table tracks current pick index, round, and whose turn it is

## Testing
- vitest with `@` path alias (mapped to repo root in `vitest.config.ts`)
- Run: `npm test` (single pass) or `npm run test:watch`
- `__tests__/espn.test.ts` — 45 tests: `parseRelPar`, `extractTeeTime`, `hasMadeCut`, `determineCutLine`, `inferStatus`, `inferThru`, currentRound selection, auto-complete guard
- `__tests__/winnings.test.ts` — 22 tests: `computeWinnings` prize splits/ties, `isTurd` conditions, `turdSize` scaling

## Historical data
- 4 tournaments seeded via `supabase/migrations/005_historical_data.sql`
- Teams: Dawg, CFitz, Deebs, WC
- Synthetic champion player inserted per tournament to drive $50 best-player prize for historical leagues
- If duplicate users are created by the migration, use the merge SQL pattern in `005_historical_data.sql` comments

## Environment variables (Vercel + .env.local)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `INGEST_SECRET` = `biscuits-2026-secret` (on Vercel)
