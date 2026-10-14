# Uno Tracker

A simple, colourful score keeper for Uno game nights. Save your players once, tap who's playing, type the scores. The tracker adds them up, crowns the winner and keeps all-time stats.

No build step and no install. Open `index.html` in a browser and play.

## How it works

1. **Players**: save everyone at your Uno table once (Players tab, or right on the new-game screen). Each gets a mascot emoji and a card colour you can change.
2. **New game**: tap who's playing and press **Start game**. Last game's players are already selected. Under **Options** you can rename the game, choose whether the highest or lowest score wins, and set where the game ends (10, 15, 20, 25, 30, any other number, or no limit). Players in a game can change these later with **⚙ Settings**.
3. **Each round**: type each player's points and press **Add round**. Blank counts as 0. Fix or delete any round from the scorecard.
4. **Game over**: when someone reaches the limit (or you press **Finish game**) the winner gets a podium and confetti. If the top scores are level (0–0, 2–2, 3–3...) the game is a **draw**: nobody wins and nobody loses. **Play again** starts a rematch with the same players in one tap.
5. **Quit game**: throws away a game that's still going. None of its rounds count towards wins, points, stats or trophies.

**Several games at once**: the **Games** tab opens on **Tables**, which shows every game in progress (the tab badge counts the live ones). Abi and Grandpa can play at one table while Omega and Derrick play at another, and each table scores its own game. If someone steps out, **⏸ Pause** the game: its scores are kept and it waits under *Paused* until someone at that table presses **▶ Resume**. Starting a game with someone who is still in a live game asks whether to pause that game or keep both going. Paused and live games count towards the points table as they go, and towards wins, draws and losses once they finish. If two tables save at the same moment, the page saves the second table's change again on top of the first, so neither round is lost.

Along the way, the scoreboard shows each player as an Uno card with their rank and a mood ("🔥 Unstoppable ×3", "👑 Top dog", "🎯 Match point"), and a **play-by-play** feed adds up to four lines of commentary after every round: lead changes, ties, streaks and broken streaks, first wins, match point, runaways, dry spells, milestones and the odd random heckle. "Big" and "close" are judged against your table's usual round scores.

**Stats**: a dashboard for any game (leader, biggest round, lead changes, the race, momentum, points per round, who wins rounds, a stat sheet) and all-time numbers (a leaderboard with wins, draws and losses, wins chart, a Player DNA radar to compare up to four players, head-to-head), plus every past game to reopen or delete.

**Points**: everyone ranked by cumulative points across every game, with the gap to the leader, wins, points per game and per round, best game and best round. A chart shows the points piling up game by game, and a doughnut shows each player's share of every point scored.

**Trophies**: a Trophy Room with 48 trophies, from *The Uno-Disputed Champion*, *The Point Bank* and *Serial Winner* to *The Peacekeeper*, *Snooze Button*, *The Bagel* and *Cursed*. Each one moves to whoever earns it after every round, and a trophy shelf shows who's hoarding the hardware. Trophies nobody has earned yet are listed with how to win them.

## Saving and sharing scores

**On the hosted page (claude.ai):** the scores are saved inside the page itself. Whenever someone saves a round, the page publishes a new version and every open copy refreshes by itself, so the whole table follows along live.

- **Signed-in players:** everyone who can save changes (the page owner and anyone invited as an Editor) must pick a username the first time they open the page. The username is their player and is linked to their Claude account, so it follows them across devices. If the host doesn't share an account id, the choice is remembered on that device, and "Already picked one on another device?" lets them reclaim it.
- **Who can change scores:** the players in a game who have a username can add, fix and delete its rounds, add a late player and finish it. Everyone else signed in watches that game. The page owner can change anything, back up or restore, and remove players.
- **Guests:** players without a Claude account can be added as guests. They show up on the scoreboard, but can't change scores themselves.
- **Watching without an account:** anyone who can only view the page (for example through a public link) sees the scoreboard, stats and players with no sign-in. Their header says "👀 Watching live".

**Opened as a file or from any other website:** scores are saved in that browser (`localStorage`). Use **⇅ Back up & restore** to download a backup or move scores to another device.

On first launch the scorekeeper sees a clearly marked demo game night. Use **Clear demo and start fresh** to begin your own. The demo is never shown to people who are only watching.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | All styling, with light and dark themes |
| `js/logic.js` | Totals, standings, stats, trophies and commentary (pure functions, no DOM) |
| `js/storage.js` | Browser storage, and reading scores saved inside the page |
| `js/page.js` | Template for the single-file page that carries its own scores |
| `js/app.js` | Views and interactions |
| `js/charts.js` | Charts: race, momentum, points per round, round-win share, Player DNA, wins, points over time, points share |
| `js/fx.js` | Confetti and sound effects |
| `js/demo.js` | Seeded demo data |
| `scripts/build.js` | Builds the single-file page (`node scripts/build.js out.html --full`) |
| `tests/logic.test.js` | Unit tests for the scoring logic and page template |

Charts use [Chart.js](https://www.chartjs.org/) 4.4.1 from cdnjs and fonts come from Google Fonts. Offline, everything else still works and the chart shows a short note instead.

## Tests

```sh
node --test
```
