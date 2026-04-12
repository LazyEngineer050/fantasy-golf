# ButteryBiscuits — Feature Backlog

## Top 5 recommended next features

### 1. 🏅 Final results & winner announcement
When the tournament ends, lock scores, compute final standings, and show a winner screen with trophy, final leaderboard, and each team's complete scorecard. Mark the league as `completed` and prevent further polling.

### 2. 📱 Push / share notifications
Let users subscribe to score alerts (e.g. "your player just birdied", "you moved into first place"). Could use browser push notifications or a simple shareable results link that updates live — useful for people not actively watching the leaderboard.

### 3. 📊 Player performance history chart
Mini sparkline chart per player showing their score trend across the 4 rounds. Quickly shows who started hot and faded vs. who finished strong. Could be a tooltip or expand on click.

### 4. 🔁 Multi-tournament / season support
Track results across multiple events (e.g. all 4 majors in a year). Accumulate points per league with a season standings table. Requires a `season_standings` table and points rules (1st = 10 pts, 2nd = 7 pts, etc.).

### 5. 🎲 Live draft room
Replace the offline commissioner draft with a real-time snake draft — each manager picks on a timer, picks are broadcast live, and the board updates as players are taken. Draft state infrastructure already exists in `draft_state` table.

---

## Other ideas (unranked)

- **Trash talk / chat**: league chat or per-team comment thread on the leaderboard
- **Pick 'em side game**: before the tournament, everyone predicts the overall winner — show who called it
- **Cut tracker**: highlight which teams lose a player to the cut and how it affects their score
- **Mobile PWA**: add a manifest + service worker so it installs as an app on phones
- **Admin ingest trigger**: button in the admin UI to manually trigger an ESPN ingest without needing curl
- **Score alerts on cut**: notify the commissioner when players miss the cut so they can manage rosters
- **Historical leaderboard replay**: scrub through scores round by round after the tournament ends
- **Tiebreaker rules**: configurable tiebreaker (e.g. best round 4 score) when two teams finish equal
- **Invite links**: shareable URL that lets a new user join a league without needing the commissioner
- **Dark/light mode toggle**: some users prefer light mode
