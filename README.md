# Uno Tracker

A colourful score keeper for Uno game nights, with live dashboards, an all-time Hall of Fame and a play-by-play commentator that roasts whoever is holding all the cards.

No build step and no install. Open `index.html` in a browser and play.

## What it does

**Play**
- Add players with a mascot emoji and card colour, then deal a game.
- Three scoring modes:
  - **Classic** (official rules): whoever goes out collects the points left in everyone else's hand. First to the target (default 500) wins.
  - **Lowball**: the points left in your hand count against you. When anyone hits the limit, the lowest total wins.
  - **Freestyle**: type any score for anyone each round.
- Each round, tap who went out and enter the hand points for everyone else. The 🧮 card counter lets you tap the actual cards (0–9, Skip, Reverse, Draw Two, Wild, Wild Draw Four, Shuffle Hands, Customizable) and adds them up for you.
- Players can sit out a round, and late arrivals can join mid-game.
- Edit or delete any round. Undo has a Restore button in case you change your mind.
- The scoreboard is drawn as Uno cards, with ranks, a crown for the leader, progress to the target and a mood for each player ("🔥 On fire ×3", "😬 Danger zone", "🧊 Ice cold").
- An **UNO NEWS** ticker and a **play-by-play** feed comment on every round: lead changes, monster hauls, streaks, comebacks and near-misses.
- Confetti, card-slap sounds, an UNO! shout button and a game-over podium. Sound can be muted, and motion respects `prefers-reduced-motion`.

**Stats** (per game): running-total race chart against the target, momentum (rank after each round), points per round, share of rounds won, and a stat sheet.

**Hall of Fame** (all time): leaderboard, a trophy cabinet (Champion, Speed Demon, Big Haul, Hot Streak, Clean Hands, Card Hoarder, Eternal Bridesmaid, Marathoner), a "Player DNA" radar to compare up to four players, wins chart, and a head-to-head matrix.

**History** and **Players**: every game with its final standings (resume, rematch, view stats, delete), and the roster with each player's finishing places over time.

## Saving your scores

- Everything saves automatically in your browser (`localStorage`), so it is still there next time you open the page on the same device.
- Use **⇅ Back up & restore** to download a JSON backup, copy it to the clipboard, or restore from a file or pasted text. That is also how you move scores to another device.
- When the page runs as a hosted claude.ai Artifact, scores also sync to a shared store, so everyone who opens the tracker sees the same scoreboard update live. The header shows "● Live sync on" when that is active. In that mode a "🎙 Ask Claude for a hot take" button can also generate fresh commentary.

On first launch the tracker shows a clearly marked demo game night so the dashboards have something to show. Use **Clear demo and start fresh** to begin your own.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | All styling, with light and dark themes |
| `js/logic.js` | Scoring, standings, stats, awards and commentary (pure functions, no DOM) |
| `js/storage.js` | Browser storage plus optional live sync |
| `js/app.js` | Views and interactions |
| `js/charts.js` | Chart.js wrappers |
| `js/fx.js` | Confetti and sound effects |
| `js/demo.js` | Seeded demo data |
| `tests/logic.test.js` | Unit tests for the scoring logic |

Charts use [Chart.js](https://www.chartjs.org/) 4.4.1 from cdnjs and fonts come from Google Fonts. Offline, everything else still works and the charts show a short note instead.

## Tests

```sh
node --test
```
