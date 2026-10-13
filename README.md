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

## Saving your scores

- Everything saves automatically in your browser (`localStorage`), so it is still there next time you open the page on the same device.
- Use **⇅ Back up & restore** to download a JSON backup, copy it to the clipboard, or restore from a file or pasted text. That is also how you move scores to another device.
- When the page runs as a hosted claude.ai Artifact, scores also sync to a shared store, so everyone who opens the tracker sees the same scoreboard update live. The header shows "● Live sync on" when that is active. In that mode a "🎙 Hot take" button can also generate fresh commentary.

On first launch the tracker shows a clearly marked demo game night so the dashboards have something to show. Use **Clear demo and start fresh** to begin your own.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | All styling, with light and dark themes |
| `js/logic.js` | Totals, standings, stats, awards and commentary (pure functions, no DOM) |
| `js/storage.js` | Browser storage plus optional live sync |
| `js/app.js` | Views and interactions |
| `js/charts.js` | Score race chart |
| `js/fx.js` | Confetti and sound effects |
| `js/demo.js` | Seeded demo data |
| `tests/logic.test.js` | Unit tests for the scoring logic |

Charts use [Chart.js](https://www.chartjs.org/) 4.4.1 from cdnjs and fonts come from Google Fonts. Offline, everything else still works and the chart shows a short note instead.

## Tests

```sh
node --test
```
