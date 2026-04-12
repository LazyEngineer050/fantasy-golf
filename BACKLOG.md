# ButteryBiscuits — Feature Backlog

## Shipped
- ✅ Live leaderboard with 30 s polling (teams + players views)
- ✅ Fire 🔥 / ice 🥶 — always one each; persisted to localStorage across refreshes
- ✅ Overall leader ⭐ (ties supported); 💩 = 3+ strokes worse than drafted field average today
- ✅ Yellow leader highlight in both Teams and Players views
- ✅ Tee times for players not yet on the course
- ✅ Final results & 🏆 winner banner; auto-complete detection; polling stops
- ✅ Projected winnings on each team card ($20 buy-in, $50 best player, $30 best team, $5 side-bet)
- ✅ All-time standings as main page — tournaments as rows, players as columns, lifetime winnings totals
- ✅ Live tournament highlighted in standings with projected figures
- ✅ Historical data: Masters/PGA/US Open 2025, The Players 2026
- ✅ League switcher in breadcrumb; status badge in header title; clean nav throughout
- ✅ Commissioner management tab (rename/delete team, add/remove picks)

---

## Top priorities

### 1. 🔐 Logins / user accounts
Real authentication so each manager has their own account. Currently identity is cookie-based (user_id set at join). Options: Supabase Auth (magic link or OAuth), or simple invite-link flow. Needed before multi-league is meaningful.

### 2. 🏌️ Multi-league support
Let a user belong to multiple leagues simultaneously. Currently the app assumes one active league per user.

### 3. 🎲 Live draft room
Replace the offline commissioner draft with a real-time snake draft — each manager picks on a timer, picks broadcast live via Supabase Realtime. `draft_state` table already exists.

### 4. 📊 Player performance history chart
Mini sparkline per player showing score trend across 4 rounds. Tooltip or expand-on-click.

### 5. 📱 Push / share notifications
Browser push or shareable results link. Alert when you move into first, etc.

---

## Other ideas (unranked)

- **Configurable contest money structure**: admin UI to set buy-in and prize rules per league (currently hardcoded)
- **Admin ingest trigger**: button in admin UI to manually trigger an ESPN ingest without curl
- **Cut tracker**: highlight which teams lose a player to the cut; show score impact
- **Pick 'em side game**: predict the overall winner before the tournament
- **Trash talk / chat**: league chat or per-team comment thread
- **Historical leaderboard replay**: scrub through scores round by round after the tournament
- **Tiebreaker rules**: configurable tiebreaker (e.g. best R4 score) for equal teams
- **Invite links**: shareable URL to join a league without commissioner involvement
- **Mobile PWA**: manifest + service worker so it installs as an app
- **Score alerts on cut**: notify commissioner when players miss the cut
