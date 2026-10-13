/* Uno Tracker — pure game logic: totals, standings, stats, trophies and commentary.
   No DOM access here, so it can be unit-tested with Node (see tests/logic.test.js).

   A game is { id, name, mode: 'high' | 'low', target: number | null, playerIds, rounds, status, winnerId }.
   A round is { id, at, points: { playerId: number }, winnerId }. Players missing from
   `points` sat that round out. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnoLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  const plural = (n, w) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`;

  /** Older saves used classic / lowball / freestyle. */
  const higherWins = (game) => !(game.mode === 'low' || game.mode === 'lowball');

  function normaliseGame(g) {
    return {
      rounds: [],
      playerIds: [],
      status: 'active',
      ...g,
      mode: higherWins(g) ? 'high' : 'low',
      target: g.target ? num(g.target) : null,
    };
  }

  /** The round's best score, or null when nobody stands out (a tie for best, or all zero when high wins). */
  function roundWinner(game, points) {
    const entries = Object.entries(points || {}).map(([id, p]) => [id, num(p)]);
    if (entries.length < 2) return null;
    const high = higherWins(game);
    entries.sort((a, b) => (high ? b[1] - a[1] : a[1] - b[1]));
    if (entries[0][1] === entries[1][1]) return null;
    if (high && entries[0][1] <= 0) return null;
    return entries[0][0];
  }

  function totalsAfter(game, roundCount) {
    const t = {};
    game.playerIds.forEach((id) => (t[id] = 0));
    game.rounds.slice(0, roundCount).forEach((r) => {
      Object.entries(r.points || {}).forEach(([id, p]) => {
        if (id in t) t[id] += num(p);
      });
    });
    return t;
  }
  const totals = (game) => totalsAfter(game, game.rounds.length);

  function roundsWonAfter(game, roundCount) {
    const w = {};
    game.playerIds.forEach((id) => (w[id] = 0));
    game.rounds.slice(0, roundCount).forEach((r) => {
      if (r.winnerId && r.winnerId in w) w[r.winnerId]++;
    });
    return w;
  }

  /** Sorted standings with competition ranking (1, 2, 2, 4). */
  function standingsAfter(game, roundCount) {
    const t = totalsAfter(game, roundCount);
    const w = roundsWonAfter(game, roundCount);
    const dir = higherWins(game) ? -1 : 1;
    const rows = game.playerIds.map((id) => ({ id, total: t[id], roundsWon: w[id] }));
    rows.sort((a, b) => (a.total - b.total) * dir || b.roundsWon - a.roundsWon);
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      row.rank = prev && prev.total === row.total ? prev.rank : i + 1;
    });
    return rows;
  }
  const standings = (game) => standingsAfter(game, game.rounds.length);

  /** Has anyone reached the target? Games without a target only end when finished by hand. */
  function checkOver(game) {
    if (!game.target || !game.rounds.length) return { over: false, winnerId: null };
    const reached = Object.values(totals(game)).some((v) => v >= game.target);
    return reached ? { over: true, winnerId: standings(game)[0].id } : { over: false, winnerId: null };
  }

  const played = (r, id) => r.points && id in r.points;

  function currentStreak(game, id, roundCount = game.rounds.length) {
    let s = 0;
    for (let i = roundCount - 1; i >= 0; i--) {
      const r = game.rounds[i];
      if (!played(r, id)) continue;
      if (r.winnerId === id) s++;
      else break;
    }
    return s;
  }

  function longestStreak(game, id) {
    let best = 0;
    let run = 0;
    game.rounds.forEach((r) => {
      if (!played(r, id)) return;
      if (r.winnerId === id) best = Math.max(best, ++run);
      else run = 0;
    });
    return best;
  }

  /** Longest run of rounds played without winning one. */
  function longestDrought(game, id) {
    let best = 0;
    let run = 0;
    game.rounds.forEach((r) => {
      if (!played(r, id)) return;
      if (r.winnerId === id) run = 0;
      else best = Math.max(best, ++run);
    });
    return best;
  }

  function roundsSinceWin(game, id, roundCount = game.rounds.length) {
    let n = 0;
    for (let i = roundCount - 1; i >= 0; i--) {
      const r = game.rounds[i];
      if (!played(r, id)) continue;
      if (r.winnerId === id) return n;
      n++;
    }
    return n;
  }

  /* ---------------------------------------------------------------- commentary */

  const pickFrom = (rng) => (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ''));

  const LINES = {
    opener: [
      'And we are OFF! {w} opens with {ptsW}.',
      'Round one goes to {w}. The table has been warned.',
      '{w} draws first blood. Everyone else, shuffle your feelings.',
      '{w} strikes first. Somebody write this down for the history books.',
      'First round, first casualty. {w} walks away smiling.',
      '{w} comes out swinging. Round one is theirs.',
    ],
    win: [
      '{w} takes round {n} with {ptsW}.',
      'Round {n} belongs to {w}. Thank you, next.',
      '{w} wins round {n}. The rest of the table counts their sins.',
      'A tidy {ptsW} for {w} in round {n}. No notes.',
      '{w} empties the hand like it was nothing.',
      'UNO! And just like that, round {n} goes to {w}.',
      '{w} slaps down the last card with unnecessary force. Round {n}.',
      '{w} wins round {n} and refuses to make eye contact. Classic.',
      'Round {n}: {w}. Cool. Calm. Slightly smug.',
      '{w} takes it. Somewhere, a Draw Four weeps.',
      'Ladies and gentlemen, {w}! Round {n} is in the bag.',
      '{w} wins round {n}. Was it skill? Was it luck? {w} says skill.',
      '{w} grabs round {n} like the last slice of pizza.',
      'Round {n} to {w}. The rest of you can file a complaint.',
    ],
    winLow: [
      '{w} gets off lightest in round {n}, just {ptsW}.',
      'Round {n}: {w} escapes with only {ptsW}.',
      '{w} dodges the damage in round {n}. Slippery!',
      '{w} tiptoes through round {n} with barely a scratch.',
      'Round {n}: {w} keeps their hands clean. Suspiciously clean.',
    ],
    tieBest: [
      'Round {n} is a dead heat at the top. Nobody blinks.',
      'A tie for best in round {n}. Rock, paper, scissors for it?',
      'Round {n}: two players, one glory. The judges call it a draw.',
    ],
    allZero: [
      'Round {n}: nobody scored. Did anyone actually play?',
      'Zeros across the board in round {n}. Peak suspense, zero results.',
    ],
    big: [
      'A {ptsW} round for {w}! That is grand larceny.',
      '{w} rakes in {ptsW}. Somebody check their sleeves.',
      'BOOM. {ptsW} straight into {w}’s pocket.',
      '{ptsW} in one round?! {w} has been training for this.',
      '{w} just cashed a {ptsW} cheque. Taxes are due.',
    ],
    ouch: [
      '{p} takes a {ptsW} hit. Ouch.',
      'Somebody hug {p}. That was {ptsW} of pain.',
      '{p} was building a card collection. {ptsW} of it.',
      '{p} catches {ptsW} right in the feelings.',
    ],
    zero: [
      '{p} scores a big fat zero this round.',
      'Nothing for {p} this time. Not even a crumb.',
      '{p} goes home empty-handed this round. Character building.',
      'Zero for {p}. Bold strategy. Let’s see if it pays off.',
    ],
    firstWin: [
      'FINALLY! {p} gets on the board. The crowd goes mild.',
      '{p} wins a round! We were starting to file a missing persons report.',
      'Look who woke up: {p} takes their first round of the game.',
    ],
    leadChange: [
      'NEW LEADER! {p} snatches the top spot from {q}.',
      'Changing of the guard: {p} overtakes {q}.',
      '{q} has been dethroned. {p} wears the crown now.',
      'Plot twist! {p} storms past {q} into first.',
      '{p} slides into first place. {q}, check your mirrors.',
    ],
    comeback: [
      'From the basement to the penthouse: {p} climbs from last to first!',
      'What a comeback! {p} was dead last and now leads the pack.',
      'Never count out {p}. Last to first. Unbelievable scenes.',
    ],
    tieTop: [
      'It’s all square at the top: {p} and {q} are level on {t}.',
      'Dead heat! {p} and {q} share the lead on {t}.',
      '{p} and {q} are tied on {t}. Nobody breathe.',
    ],
    streak2: [
      'Back-to-back for {p}! Two in a row.',
      '{p} doubles up. Is this a pattern?',
      'Two straight for {p}. The table is getting nervous.',
    ],
    streak3: [
      '{p} is ON FIRE. That is {s} rounds in a row.',
      'Can anyone stop {p}? {s} straight round wins.',
      '{s} in a row for {p}. This is no longer a game, it is a lecture.',
      '{p} has won {s} straight. Someone check the deck for marked cards.',
    ],
    streak5: [
      '{s} IN A ROW?! {p} has left the building and taken the trophy with them.',
      '{p} wins {s} straight. At this point it’s a hostage situation.',
    ],
    streakBroken: [
      '{w} snaps {p}’s {s}-round streak.',
      'The streak is over! {w} ends {p}’s run at {s}.',
      '{w} said “not today” and ended {p}’s {s}-round run.',
    ],
    matchPoint: [
      'MATCH POINT! {p} needs just {gapW}.',
      '{p} can smell victory. Just {gapW} to go.',
      'Danger! {p} is {gapW} from the finish line.',
      '{p} is one good round from glory ({gapW} left).',
    ],
    nearLimit: [
      '{p} is {gapW} from the limit. Sweaty palms.',
      'Careful, {p}. Only {gapW} of breathing room left.',
      '{p} is dangling over the edge: {gapW} from the limit.',
    ],
    blowout: [
      '{p} leads by {gapW}. Is this still a contest?',
      '{p} is running away with it, {gapW} clear. Send help.',
      'At {gapW} ahead, {p} could take a nap and still be winning.',
    ],
    tight: [
      'Only {gapW} between first and second. Tense!',
      'Neck and neck: the top two are {gapW} apart.',
      'It’s a knife fight up top. {gapW} in it.',
    ],
    drought: [
      '{p} hasn’t won a round in {d}. Thoughts and prayers.',
      '{p} is on a {d}-round dry spell. The desert is lonely.',
      'Still waiting on {p}. {d} rounds and counting.',
    ],
    dominance: [
      '{p} has won {pct}% of the rounds so far. Absolute tyranny.',
      '{p} owns {pct}% of the rounds. Everyone else is just visiting.',
    ],
    lastPlace: [
      'Meanwhile, {p} is “building character” in last place.',
      '{p} holds down last place. Someone has to.',
      '{p} remains in last, playing the long game. Very long.',
      '{p} is in last place but first in our hearts.',
      '{p} sits at the bottom, plotting revenge.',
    ],
    milestone: [
      'Round {n} in the books. Snacks are now mandatory.',
      '{n} rounds deep. Nobody is going to bed.',
      'Round {n}! At this point the cards know your names.',
    ],
    flavor: [
      'Somewhere, a Draw Four is being saved for the worst possible moment.',
      'Reminder: forgetting to say UNO is a crime in most households.',
      'The cards are shuffled. So are the friendships.',
      'Rumour has it someone is hoarding Wilds.',
      'Everyone is smiling. Nobody is trusting anyone.',
      'The Reverse card has entered the chat.',
      'This table runs on snacks and spite.',
      'A moment of silence for everyone who just drew four.',
    ],
    gameOver: [
      'GAME OVER! {w} is your champion with {pts}.',
      'That’s the game! Bow down to {w}.',
      '{w} takes it all. Somebody get them a trophy.',
      'The crown goes to {w}. Long may they reign (until the rematch).',
      '{w} wins! The rest of you have been demoted to snack duty.',
    ],
    gameOverClose: [
      '{w} wins it by {marginW}! Photo finish. Lawyers have been called.',
      'By a whisker! {w} edges it by {marginW}.',
    ],
    gameOverBlowout: [
      '{w} wins by {marginW}. That wasn’t a game, it was a lesson.',
      'A {marginW} victory for {w}. Mercy rules were discussed.',
    ],
  };

  /** Commentary for the round at index `idx` (already in game.rounds). names: {id: name}. */
  function commentary(game, idx, names, rng = Math.random) {
    const pick = pickFrom(rng);
    const nm = (id) => names[id] || 'Someone';
    const r = game.rounds[idx];
    const pts = r.points || {};
    const high = higherWins(game);
    const n = idx + 1;
    const before = standingsAfter(game, idx);
    const after = standingsAfter(game, idx + 1);
    const w = r.winnerId;
    const scores = Object.entries(pts).map(([id, v]) => [id, num(v)]);
    const sorted = [...scores].sort((a, b) => b[1] - a[1]);
    const tops = game.rounds.slice(0, idx + 1).map((x) => Math.max(0, ...Object.values(x.points || {}).map(num)));
    const avgTop = tops.reduce((a, b) => a + b, 0) / Math.max(1, tops.length);
    // Judge "big", "close" and "runaway" against this table's usual round scores, not the end score.
    const bigAt = Math.max(3, Math.ceil(avgTop * 2.5));
    const tightAt = Math.max(1, Math.round(avgTop));

    const head = [];
    const hot = [];
    const extra = [];

    // Who won the round
    if (scores.length && scores.every(([, v]) => v === 0)) head.push(fill(pick(LINES.allZero), { n }));
    else if (w) {
      if (idx === 0 && high) head.push(fill(pick(LINES.opener), { w: nm(w), ptsW: plural(pts[w], 'point') }));
      else head.push(fill(pick(high ? LINES.win : LINES.winLow), { w: nm(w), n, ptsW: plural(pts[w], 'point') }));
    } else head.push(fill(pick(LINES.tieBest), { n }));

    // Big rounds and big hits
    if (sorted.length && sorted[0][1] >= bigAt) {
      if (high && idx > 0) hot.push(fill(pick(LINES.big), { w: nm(sorted[0][0]), ptsW: plural(sorted[0][1], 'point') }));
      if (!high) hot.push(fill(pick(LINES.ouch), { p: nm(sorted[0][0]), ptsW: plural(sorted[0][1], 'point') }));
    }

    // Streaks
    if (w) {
      const s = currentStreak(game, w, idx + 1);
      if (s >= 5 && s % 2 === 1) hot.push(fill(pick(LINES.streak5), { p: nm(w), s }));
      else if (s >= 3) hot.push(fill(pick(LINES.streak3), { p: nm(w), s }));
      else if (s === 2) extra.push(fill(pick(LINES.streak2), { p: nm(w) }));
      const prev = idx > 0 ? game.rounds[idx - 1].winnerId : null;
      if (prev && prev !== w) {
        const ps = currentStreak(game, prev, idx);
        if (ps >= 3) hot.push(fill(pick(LINES.streakBroken), { w: nm(w), p: nm(prev), s: ps }));
      }
      const wonBefore = game.rounds.slice(0, idx).some((x) => x.winnerId === w);
      if (!wonBefore && idx >= 3) hot.push(fill(pick(LINES.firstWin), { p: nm(w) }));
    }

    // Changes at the top
    if (idx > 0 && after.length > 1) {
      const newTop = after[0];
      const tiedTop = after[1].total === newTop.total;
      if (tiedTop && !(before[1] && before[0].total === before[1].total)) {
        hot.push(fill(pick(LINES.tieTop), { p: nm(after[0].id), q: nm(after[1].id), t: after[0].total }));
      } else if (!tiedTop && newTop.id !== before[0].id) {
        if (before[before.length - 1].id === newTop.id && before.length > 2) hot.push(fill(pick(LINES.comeback), { p: nm(newTop.id) }));
        else hot.push(fill(pick(LINES.leadChange), { p: nm(newTop.id), q: nm(before[0].id) }));
      }
    }

    // The race
    const over = game.target && after.some((row) => row.total >= game.target);
    if (!over && after.length > 1) {
      if (game.target) {
        const danger = high ? after[0] : [...after].sort((a, b) => b.total - a.total)[0];
        const gap = game.target - danger.total;
        const near = Math.max(1, Math.ceil(game.target * 0.2), Math.ceil(avgTop));
        if (gap > 0 && gap <= near) hot.push(fill(pick(high ? LINES.matchPoint : LINES.nearLimit), { p: nm(danger.id), gapW: plural(gap, 'point') }));
      }
      const gap12 = Math.abs(after[0].total - after[1].total);
      const blowAt = Math.max(3, Math.round(avgTop * 4));
      if (idx >= 3 && gap12 >= blowAt) extra.push(fill(pick(LINES.blowout), { p: nm(after[0].id), gapW: plural(gap12, 'point') }));
      else if (idx >= 2 && gap12 > 0 && gap12 <= tightAt) extra.push(fill(pick(LINES.tight), { gapW: plural(gap12, 'point') }));
      if (idx >= 4) {
        const wins = {};
        game.rounds.slice(0, idx + 1).forEach((x) => x.winnerId && (wins[x.winnerId] = (wins[x.winnerId] || 0) + 1));
        const [topId, topWins] = Object.entries(wins).sort((a, b) => b[1] - a[1])[0] || [];
        const pct = topId ? Math.round((topWins / (idx + 1)) * 100) : 0;
        if (pct >= 70 && rng() < 0.35) extra.push(fill(pick(LINES.dominance), { p: nm(topId), pct }));
      }
    }

    // Little roasts
    if (high && sorted.length > 2 && sorted[sorted.length - 1][1] === 0 && sorted[0][1] > 0 && rng() < 0.4)
      extra.push(fill(pick(LINES.zero), { p: nm(sorted[sorted.length - 1][0]) }));
    const dry = game.playerIds
      .filter((id) => played(r, id) && id !== w)
      .map((id) => [id, roundsSinceWin(game, id, idx + 1)])
      .sort((a, b) => b[1] - a[1])[0];
    if (dry && dry[1] >= 5 && dry[1] % 2 === 1) extra.push(fill(pick(LINES.drought), { p: nm(dry[0]), d: dry[1] }));
    if (idx >= 2 && after.length > 2 && rng() < 0.4) extra.push(fill(pick(LINES.lastPlace), { p: nm(after[after.length - 1].id) }));
    if (n % 5 === 0) extra.push(fill(pick(LINES.milestone), { n }));
    if (rng() < 0.25) extra.push(pick(LINES.flavor));

    // Keep it snappy: the headline, the biggest news, then some colour.
    const shuffled = extra.map((l) => [rng(), l]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    return [...head, ...hot, ...shuffled].slice(0, 4);
  }

  function gameOverLine(game, names, rng = Math.random) {
    const st = standings(game);
    const top = st[0];
    const margin = st[1] ? Math.abs(top.total - st[1].total) : 0;
    const tops = game.rounds.map((x) => Math.max(0, ...Object.values(x.points || {}).map(num)));
    const avgTop = tops.reduce((a, b) => a + b, 0) / Math.max(1, tops.length);
    const pool =
      margin > 0 && margin <= Math.max(1, Math.round(avgTop))
        ? LINES.gameOverClose
        : st[1] && margin >= Math.max(3, Math.abs(top.total) * 0.5)
          ? LINES.gameOverBlowout
          : LINES.gameOver;
    return fill(pickFrom(rng)(pool), { w: names[top.id] || 'Someone', pts: plural(top.total, 'point'), marginW: plural(margin, 'point') });
  }

  /** A mood label for a player's scoreboard card. */
  function mood(game, id) {
    if (!game.rounds.length) return { icon: '🃏', text: 'Shuffling up' };
    const st = standings(game);
    const row = st.find((s) => s.id === id);
    const last = game.rounds[game.rounds.length - 1];
    const streak = currentStreak(game, id);
    const frac = game.target ? row.total / game.target : 0;
    if (streak >= 3) return { icon: '🔥', text: `Unstoppable ×${streak}` };
    if (streak === 2) return { icon: '🔥', text: 'On fire ×2' };
    if (!higherWins(game) && frac >= 0.8) return { icon: '😬', text: 'Danger zone' };
    if (higherWins(game) && frac >= 0.8 && row.rank === 1) return { icon: '🎯', text: 'Match point' };
    if (row.rank === 1 && st.length > 1 && st[1].total !== row.total) return { icon: '👑', text: 'Top dog' };
    if (row.rank === 1) return { icon: '🤝', text: 'Sharing the crown' };
    if (last.winnerId === id) return { icon: '⚡', text: 'Fresh off a win' };
    const dry = roundsSinceWin(game, id);
    if (dry >= 5) return { icon: '🧊', text: 'Ice cold' };
    if (row.rank === st.length && st.length > 2) return { icon: '🐢', text: 'Building character' };
    if (row.rank === st.length) return { icon: '😤', text: 'Plotting revenge' };
    return { icon: '🃏', text: 'In the hunt' };
  }

  /* -------------------------------------------------------------- all-time stats */

  function playerStats(state) {
    const stats = {};
    state.players.forEach((p) => {
      stats[p.id] = {
        id: p.id,
        games: 0,
        finished: 0,
        wins: 0,
        seconds: 0,
        lastPlaces: 0,
        rounds: 0,
        roundsWon: 0,
        bestRound: 0,
        biggestHit: 0,
        totalPoints: 0,
        zeroRounds: 0,
        earlyWins: 0,
        nightRounds: 0,
        roundsLed: 0,
        comebackWins: 0,
        ledButLost: 0,
        longestStreak: 0,
        longestDrought: 0,
        fastestWin: null,
        longestWin: null,
        closestWin: null,
        biggestWin: null,
        highScores: [],
        lowScores: [],
        lastPlayed: 0,
      };
    });
    state.games.forEach((g) => {
      const st = standings(g);
      const high = higherWins(g);
      const finished = g.status === 'finished';
      const led = new Set();
      const wasLast = new Set();
      for (let i = 1; i <= g.rounds.length; i++) {
        const s = standingsAfter(g, i);
        if (s.length > 1 && s[0].total !== s[1].total) {
          led.add(s[0].id);
          if (stats[s[0].id]) stats[s[0].id].roundsLed++;
        }
        const last = s[s.length - 1];
        if (s.length > 1 && i >= 2 && s[s.length - 2].total !== last.total) wasLast.add(last.id);
      }
      g.playerIds.forEach((id) => {
        const s = stats[id];
        if (!s) return;
        s.games++;
        s.lastPlayed = Math.max(s.lastPlayed, g.finishedAt || g.createdAt || 0);
        s.longestStreak = Math.max(s.longestStreak, longestStreak(g, id));
        s.longestDrought = Math.max(s.longestDrought, longestDrought(g, id));
        if (!finished) return;
        s.finished++;
        const row = st.find((x) => x.id === id);
        if (g.winnerId === id) {
          s.wins++;
          const n = g.rounds.length;
          const margin = st[1] ? Math.abs(st[0].total - st[1].total) : 0;
          s.fastestWin = s.fastestWin == null ? n : Math.min(s.fastestWin, n);
          s.longestWin = s.longestWin == null ? n : Math.max(s.longestWin, n);
          if (st.length > 1) {
            s.closestWin = s.closestWin == null ? margin : Math.min(s.closestWin, margin);
            s.biggestWin = s.biggestWin == null ? margin : Math.max(s.biggestWin, margin);
          }
          if (wasLast.has(id)) s.comebackWins++;
        } else {
          if (st.length > 1 && st[1].id === id) s.seconds++;
          if (led.has(id)) s.ledButLost++;
        }
        if (st.length > 2 && row && row === st[st.length - 1] && g.winnerId !== id) s.lastPlaces++;
      });
      g.rounds.forEach((r, ri) => {
        const hour = r.at ? new Date(r.at).getHours() : 12;
        const anyScored = Object.values(r.points || {}).some((v) => num(v) > 0);
        Object.entries(r.points || {}).forEach(([id, p]) => {
          const s = stats[id];
          if (!s) return;
          const v = num(p);
          s.rounds++;
          if (r.winnerId === id) {
            s.roundsWon++;
            if (ri === 0) s.earlyWins++;
          }
          if (hour >= 22 || hour < 4) s.nightRounds++;
          if (high) {
            s.bestRound = Math.max(s.bestRound, v);
            s.totalPoints += v;
            s.highScores.push(v);
            if (v === 0 && anyScored) s.zeroRounds++;
          } else {
            s.biggestHit = Math.max(s.biggestHit, v);
            s.lowScores.push(v);
          }
        });
      });
    });
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const sd = (a) => {
      if (a.length < 2) return 0;
      const m = mean(a);
      return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
    };
    Object.values(stats).forEach((s) => {
      s.winRate = s.finished ? s.wins / s.finished : 0;
      s.roundWinRate = s.rounds ? s.roundsWon / s.rounds : 0;
      s.avgHigh = mean(s.highScores);
      s.avgLow = mean(s.lowScores);
      s.spread = sd(s.highScores);
    });
    return stats;
  }

  /* -------------------------------------------------------------------- trophies */

  const fmt1 = (v) => (Math.round(v * 10) / 10).toString();

  /**
   * Every trophy, earned or up for grabs:
   * {key, icon, title, quip (with {name}/{value}), how, holders: [ids], value (text) | null}.
   * best: higher value wins unless `lowest`; `min` is the smallest value that earns it.
   */
  const TROPHIES = [
    { key: 'champ', icon: '👑', title: 'The Uno-Disputed Champion', how: 'Win the most games.', quip: '{name} has won {value}. The rest of you are just here for the snacks.', fn: (s) => s.wins, fmt: (v) => plural(v, 'game') },
    { key: 'roundhog', icon: '🐗', title: 'Round Hog', how: 'Win the most rounds.', quip: '{name} has hogged {value}. Sharing is caring, apparently not.', fn: (s) => s.roundsWon, fmt: (v) => plural(v, 'round') },
    { key: 'heist', icon: '💰', title: 'Daylight Robbery', how: 'Score the most points in a single round.', quip: '{name} pocketed {value} in one round. Check their sleeves.', fn: (s) => s.bestRound, fmt: (v) => plural(v, 'point') },
    { key: 'streak', icon: '🔥', title: 'Hotter Than a Draw Four', how: 'Win 2+ rounds in a row. Longest streak takes it.', quip: '{name} won {value} in a row. Somebody unplug them.', fn: (s) => s.longestStreak, fmt: (v) => plural(v, 'round'), min: 2 },
    { key: 'leadmagnet', icon: '🧲', title: 'Lead Magnet', how: 'Sit alone in first place after the most rounds.', quip: '{name} has been top of the table for {value}. Comfy up there?', fn: (s) => s.roundsLed, fmt: (v) => plural(v, 'round') },
    { key: 'comeback', icon: '🚀', title: 'The Comeback Kid', how: 'Win a game after being in last place.', quip: '{name} was dead last and still won {value}. Never count them out.', fn: (s) => s.comebackWins, fmt: (v) => plural(v, 'game') },
    { key: 'steamroller', icon: '🚜', title: 'The Steamroller', how: 'Win a game by the biggest margin.', quip: '{name} won by {value}. That wasn’t a game, it was a lesson.', fn: (s) => s.biggestWin, fmt: (v) => plural(v, 'point') },
    { key: 'photo', icon: '📸', title: 'Photo Finish', how: 'Win a game by the smallest margin.', quip: '{name} won by {value}. Lawyers were consulted.', fn: (s) => s.closestWin, fmt: (v) => plural(v, 'point'), lowest: true },
    { key: 'speedrun', icon: '🏎️', title: 'Speed Run', how: 'Win a game in the fewest rounds.', quip: '{name} won a whole game in {value}. Blink and you missed it.', fn: (s) => s.fastestWin, fmt: (v) => plural(v, 'round'), lowest: true },
    { key: 'marathon', icon: '🐌', title: 'Marathon Survivor', how: 'Win the longest game.', quip: '{name} outlasted everyone in a game that went {value}. Legs are gone.', fn: (s) => s.longestWin, fmt: (v) => plural(v, 'round') },
    { key: 'average', icon: '📈', title: 'Mean Machine', how: 'Best average score per round (5+ rounds, highest-wins games).', quip: '{name} averages {value} a round. Mean as in average. And as in mean.', fn: (s) => (s.highScores.length >= 5 ? s.avgHigh : null), fmt: (v) => fmt1(v) },
    { key: 'accountant', icon: '🧮', title: 'The Accountant', how: 'Score the most points all-time.', quip: '{name} has racked up {value}. Numbers don’t lie, but they do brag.', fn: (s) => s.totalPoints, fmt: (v) => plural(v, 'point') },
    { key: 'metronome', icon: '🎯', title: 'The Metronome', how: 'Most consistent scores, round after round (5+ rounds).', quip: '{name} barely changes. Boring? Maybe. Terrifying? Definitely.', fn: (s) => (s.highScores.length >= 5 ? s.spread : null), fmt: (v) => `±${fmt1(v)}`, lowest: true },
    { key: 'rollercoaster', icon: '🎢', title: 'Rollercoaster Rider', how: 'Wildest swings between rounds (5+ rounds).', quip: '{name} is either feast or famine. Mostly drama.', fn: (s) => (s.highScores.length >= 5 ? s.spread : null), fmt: (v) => `±${fmt1(v)}` },
    { key: 'earlybird', icon: '🐣', title: 'Early Bird', how: 'Win the first round of the most games.', quip: '{name} won round one {value}. Strong starts, questionable finishes?', fn: (s) => s.earlyWins, fmt: (v) => plural(v, 'time') },
    { key: 'bridesmaid', icon: '🥈', title: 'Always the Bridesmaid', how: 'Finish second the most.', quip: '{name} finished second {value}. So close you can taste it.', fn: (s) => s.seconds, fmt: (v) => plural(v, 'time') },
    { key: 'choker', icon: '🫠', title: 'So Close, Yet So Uno', how: 'Lead a game at some point, then lose it.', quip: '{name} led {value} and didn’t win. It’s fine. Everything’s fine.', fn: (s) => s.ledButLost, fmt: (v) => plural(v, 'game') },
    { key: 'goose', icon: '🥚', title: 'Goose Egg Collector', how: 'Score zero while someone else scores.', quip: '{name} has scored zero {value}. Eggs-traordinary.', fn: (s) => s.zeroRounds, fmt: (v) => plural(v, 'time') },
    { key: 'iceage', icon: '🧊', title: 'Ice Age', how: 'Go the longest without winning a round (3+).', quip: '{name} once went {value} without a win. We never stopped believing.', fn: (s) => s.longestDrought, fmt: (v) => plural(v, 'round'), min: 3 },
    { key: 'participation', icon: '🐢', title: 'Participation Trophy', how: 'Finish last the most (games with 3+ players).', quip: '{name} came last {value}. Showing up is half the battle.', fn: (s) => s.lastPlaces, fmt: (v) => plural(v, 'time') },
    { key: 'ouch', icon: '🩹', title: 'Ouch, My Hand', how: 'Take the biggest hit in a lowest-wins game.', quip: '{name} ate {value} in one round. Thoughts and prayers.', fn: (s) => s.biggestHit, fmt: (v) => plural(v, 'point') },
    { key: 'teflon', icon: '😇', title: 'Teflon', how: 'Lowest average per round in lowest-wins games (4+ rounds).', quip: 'Nothing sticks to {name}: just {value} a round.', fn: (s) => (s.lowScores.length >= 4 ? s.avgLow : null), fmt: (v) => fmt1(v), lowest: true },
    { key: 'nightowl', icon: '🦉', title: 'Night Owl', how: 'Play the most rounds after 10pm.', quip: '{name} has played {value} after 10pm. Go to bed.', fn: (s) => s.nightRounds, fmt: (v) => plural(v, 'round') },
    { key: 'shuffler', icon: '🃏', title: 'Professional Shuffler', how: 'Play the most rounds.', quip: '{value} and counting. {name} basically lives here now.', fn: (s) => s.rounds, fmt: (v) => plural(v, 'round') },
    { key: 'regular', icon: '🎟️', title: 'Season Ticket Holder', how: 'Play the most games.', quip: '{name} has shown up for {value}. That’s loyalty.', fn: (s) => s.games, fmt: (v) => plural(v, 'game') },
  ];

  function trophies(state) {
    const all = Object.values(playerStats(state)).filter((s) => s.rounds > 0);
    const order = Object.fromEntries(state.players.map((p, i) => [p.id, i]));
    return TROPHIES.map((t) => {
      const scored = all.map((s) => [s.id, t.fn(s)]).filter(([, v]) => v != null && (t.lowest ? true : v >= (t.min || 1)));
      if (!scored.length) return { ...t, holders: [], value: null };
      const best = t.lowest ? Math.min(...scored.map((x) => x[1])) : Math.max(...scored.map((x) => x[1]));
      const holders = scored
        .filter(([, v]) => v === best)
        .map(([id]) => id)
        .sort((a, b) => order[a] - order[b]);
      // A 'lowest' trophy shared by everyone says nothing; leave it up for grabs.
      if (t.lowest && holders.length === all.length && all.length > 1) return { ...t, holders: [], value: null };
      return { ...t, holders, value: t.fmt(best) };
    }).map(({ fn, fmt, ...rest }) => rest);
  }

  /** Earned trophies only (kept for older callers). */
  const awards = (state) => trophies(state).filter((t) => t.holders.length).map((t) => ({ ...t, winnerId: t.holders[0] }));

  /** wins[a][b] = finished games where a placed above b (both played). */
  function headToHead(state) {
    const m = {};
    state.players.forEach((a) => {
      m[a.id] = {};
      state.players.forEach((b) => (m[a.id][b.id] = 0));
    });
    state.games
      .filter((g) => g.status === 'finished')
      .forEach((g) => {
        const st = standings(g);
        const pos = {};
        st.forEach((row, i) => (pos[row.id] = row.id === g.winnerId ? -1 : row.rank + i / 1000));
        g.playerIds.forEach((a) =>
          g.playerIds.forEach((b) => {
            if (a !== b && m[a] && m[a][b] !== undefined && pos[a] < pos[b]) m[a][b]++;
          })
        );
      });
    return m;
  }

  return {
    higherWins,
    normaliseGame,
    roundWinner,
    totals,
    totalsAfter,
    standings,
    standingsAfter,
    checkOver,
    currentStreak,
    longestStreak,
    longestDrought,
    roundsSinceWin,
    commentary,
    gameOverLine,
    mood,
    playerStats,
    trophies,
    awards,
    headToHead,
    TROPHY_COUNT: TROPHIES.length,
  };
});
