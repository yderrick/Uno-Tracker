# Uno Tracker

A simple, colourful score keeper for Uno game nights. Save your players once, tap who's playing, type the scores. The tracker adds them up, crowns the winner and keeps all-time stats.

No build step and no install. Open `index.html` in a browser and play.

## How it works

1. **Players**: save everyone at your Uno table once (Players tab, or right on the new-game screen). Each gets a mascot emoji and a card colour you can change.
2. **New game**: tap who's playing and press **Start game**. Last game's players are already selected. Under **Options** you can rename the game, choose whether the highest or lowest score wins, and set where the game ends (100, 250, 500 or no limit).
3. **Each round**: type each player's points and press **Add round**. Blank counts as 0. Fix or delete any round from the scorecard.
4. **Game over**: when someone reaches the limit (or you press **Finish game**) the winner gets a podium and confetti. **Play again** starts a rematch with the same players in one tap.

Along the way, the scoreboard shows each player as an Uno card with their rank and a mood ("🔥 On fire ×3", "👑 Top dog"), and a **play-by-play** feed comments on every round: lead changes, big rounds, streaks and comebacks.

**Stats**: all-time leaderboard, trophies (Champion, Round Machine, Big Round, Hot Streak and more), a score race chart for any game, and every past game to reopen or delete.

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
| `js/logic.js` | Totals, standings, stats, awards and commentary (pure functions, no DOM) |
| `js/storage.js` | Browser storage, and reading scores saved inside the page |
| `js/page.js` | Template for the single-file page that carries its own scores |
| `js/app.js` | Views and interactions |
| `js/charts.js` | Score race chart |
| `js/fx.js` | Confetti and sound effects |
| `js/demo.js` | Seeded demo data |
| `scripts/build.js` | Builds the single-file page (`node scripts/build.js out.html --full`) |
| `tests/logic.test.js` | Unit tests for the scoring logic and page template |

Charts use [Chart.js](https://www.chartjs.org/) 4.4.1 from cdnjs and fonts come from Google Fonts. Offline, everything else still works and the chart shows a short note instead.

## Tests

```sh
node --test
```
