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

  /** Level at the top (2-2, 0-0...)? A drawn game has no winner and no loser. */
  function tiedAtTop(game) {
    const st = standings(game);
    return st.length > 1 && st[0].total === st[1].total;
  }

  /** Has anyone reached the target? Games without a target only end when finished by hand. */
  function checkOver(game) {
    if (!game.target || !game.rounds.length) return { over: false, winnerId: null, draw: false };
    const reached = Object.values(totals(game)).some((v) => v >= game.target);
    if (!reached) return { over: false, winnerId: null, draw: false };
    const draw = tiedAtTop(game);
    return { over: true, winnerId: draw ? null : standings(game)[0].id, draw };
  }

  /** A finished game that ended level counts as a draw for everyone, whatever was saved before. */
  const isDraw = (game) => game.status === 'finished' && (!!game.draw || tiedAtTop(game));

  /** The winner of a finished game, or null for draws and games still going. */
  const winnerOf = (game) => (game.status !== 'finished' || isDraw(game) ? null : game.winnerId || standings(game)[0].id);

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
    gameOverDraw: [
      'It’s a DRAW! {p} can’t be separated at {t}. Nobody wins, nobody loses, everybody sulks.',
      'Honours even at {t}! {p} shake hands (reluctantly).',
      'A draw at {t}. The cards have spoken, and they said “meh”.',
      'Stalemate! {p} finish level on {t}. Rematch, obviously.',
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
    if (st.length > 1 && st[1].total === top.total) {
      const level = st.filter((r) => r.total === top.total).map((r) => names[r.id] || 'Someone');
      const p = level.length <= 1 ? level.join('') : `${level.slice(0, -1).join(', ')} and ${level[level.length - 1]}`;
      return fill(pickFrom(rng)(LINES.gameOverDraw), { p, t: `${top.total}–${top.total}` });
    }
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
        createdAt: p.createdAt || 0,
        games: 0,
        finished: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        seconds: 0,
        lastPlaces: 0,
        rounds: 0,
        roundsWon: 0,
        bestRound: 0,
        bestGame: 0,
        biggestHit: 0,
        totalPoints: 0,
        zeroRounds: 0,
        zeroRun: 0,
        earlyWins: 0,
        nightRounds: 0,
        morningRounds: 0,
        weekendRounds: 0,
        roundsLed: 0,
        leadsTaken: 0,
        comebackWins: 0,
        slowBurnWins: 0,
        wireToWire: 0,
        cleanSheets: 0,
        closeWins: 0,
        bagels: 0,
        ledButLost: 0,
        longestStreak: 0,
        longestDrought: 0,
        gameStreak: 0,
        lossStreak: 0,
        unbeaten: 0,
        fastestWin: null,
        longestWin: null,
        closestWin: null,
        biggestWin: null,
        highScores: [],
        lowScores: [],
        results: [],
        lastPlayed: 0,
      };
    });
    const ordered = [...state.games].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    ordered.forEach((g) => {
      const st = standings(g);
      const tot = totals(g);
      const high = higherWins(g);
      const finished = g.status === 'finished';
      const draw = isDraw(g);
      const winner = winnerOf(g);
      const led = new Set();
      const wasLast = new Set();
      const ledEvery = {};
      let prevLeader = null;
      for (let i = 1; i <= g.rounds.length; i++) {
        const sAfter = standingsAfter(g, i);
        const unique = sAfter.length > 1 && sAfter[0].total !== sAfter[1].total;
        const leader = unique ? sAfter[0].id : null;
        g.playerIds.forEach((id) => (ledEvery[id] = (ledEvery[id] === undefined ? true : ledEvery[id]) && leader === id));
        if (leader) {
          led.add(leader);
          if (stats[leader]) stats[leader].roundsLed++;
          if (prevLeader !== leader && i > 1 && stats[leader]) stats[leader].leadsTaken++;
        }
        prevLeader = leader || prevLeader;
        const last = sAfter[sAfter.length - 1];
        if (sAfter.length > 1 && i >= 2 && sAfter[sAfter.length - 2].total !== last.total) wasLast.add(last.id);
      }
      const half = Math.floor(g.rounds.length / 2);
      const halfLeader = (() => {
        if (half < 2) return undefined;
        const sh = standingsAfter(g, half);
        return sh.length > 1 && sh[0].total !== sh[1].total ? sh[0].id : null;
      })();
      g.playerIds.forEach((id) => {
        const s = stats[id];
        if (!s) return;
        s.games++;
        s.points += tot[id] || 0;
        if (high) s.bestGame = Math.max(s.bestGame, tot[id] || 0);
        s.lastPlayed = Math.max(s.lastPlayed, g.finishedAt || g.createdAt || 0);
        s.longestStreak = Math.max(s.longestStreak, longestStreak(g, id));
        s.longestDrought = Math.max(s.longestDrought, longestDrought(g, id));
        if (!finished) return;
        s.finished++;
        if (draw) {
          s.draws++;
          s.results.push('D');
          return;
        }
        const row = st.find((x) => x.id === id);
        if (winner === id) {
          s.wins++;
          s.results.push('W');
          const n = g.rounds.length;
          const margin = st[1] ? Math.abs(st[0].total - st[1].total) : 0;
          s.fastestWin = s.fastestWin == null ? n : Math.min(s.fastestWin, n);
          s.longestWin = s.longestWin == null ? n : Math.max(s.longestWin, n);
          if (st.length > 1) {
            s.closestWin = s.closestWin == null ? margin : Math.min(s.closestWin, margin);
            s.biggestWin = s.biggestWin == null ? margin : Math.max(s.biggestWin, margin);
            if (margin <= 1) s.closeWins++;
          }
          if (wasLast.has(id)) s.comebackWins++;
          if (halfLeader !== undefined && halfLeader !== id) s.slowBurnWins++;
          if (g.rounds.length >= 3 && ledEvery[id]) s.wireToWire++;
          if (high && g.playerIds.every((o) => o === id || (tot[o] || 0) === 0)) s.cleanSheets++;
        } else {
          s.losses++;
          s.results.push('L');
          if (st.length > 1 && st[1].id === id) s.seconds++;
          if (led.has(id)) s.ledButLost++;
          if (high && (tot[id] || 0) === 0) s.bagels++;
        }
        if (st.length > 2 && row && row === st[st.length - 1] && winner !== id) s.lastPlaces++;
      });
      const zeroRuns = {};
      g.rounds.forEach((r, ri) => {
        const when = r.at ? new Date(r.at) : null;
        const hour = when ? when.getHours() : 12;
        const day = when ? when.getDay() : 3;
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
          if (hour >= 4 && hour < 10) s.morningRounds++;
          if (day === 0 || day === 6) s.weekendRounds++;
          if (high) {
            s.bestRound = Math.max(s.bestRound, v);
            s.totalPoints += v;
            s.highScores.push(v);
            if (v === 0 && anyScored) {
              s.zeroRounds++;
              zeroRuns[id] = (zeroRuns[id] || 0) + 1;
              s.zeroRun = Math.max(s.zeroRun, zeroRuns[id]);
            } else zeroRuns[id] = 0;
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
    const longestRun = (arr, ok) => {
      let best = 0;
      let run = 0;
      arr.forEach((x) => (ok(x) ? (best = Math.max(best, ++run)) : (run = 0)));
      return best;
    };
    Object.values(stats).forEach((s) => {
      s.decided = s.wins + s.losses;
      s.winRate = s.finished ? s.wins / s.finished : 0;
      s.roundWinRate = s.rounds ? s.roundsWon / s.rounds : 0;
      s.avgPerGame = s.games ? s.points / s.games : 0;
      s.avgHigh = mean(s.highScores);
      s.avgLow = mean(s.lowScores);
      s.spread = sd(s.highScores);
      s.gameStreak = longestRun(s.results, (r) => r === 'W');
      s.lossStreak = longestRun(s.results, (r) => r === 'L');
      s.unbeaten = longestRun(s.results, (r) => r !== 'L');
    });
    return stats;
  }

  /* -------------------------------------------------------------------- trophies */

  const fmt1 = (v) => (Math.round(v * 10) / 10).toString();
  const pct = (v) => `${Math.round(v * 100)}%`;
  const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  /**
   * Every trophy, earned or up for grabs:
   * {key, icon, title, quip (with {name}/{value}), how, holders: [ids], value (text) | null}.
   * fn(stats) gives each player a number: highest wins unless `lowest`; `min` is the
   * smallest value that earns it. `custom(state, stats)` picks holders itself.
   */
  const TROPHIES = [
    { key: 'champ', icon: '👑', title: 'The Uno-Disputed Champion', how: 'Win the most games.', quip: '{name} has won {value}. The rest of you are just here for the snacks.', fn: (s) => s.wins, fmt: (v) => plural(v, 'game') },
    { key: 'pointmachine', icon: '🏦', title: 'The Point Bank', how: 'Score the most points across every game.', quip: '{name} has banked {value} all-time. Interest rates are rising.', fn: (s) => s.points, fmt: (v) => plural(v, 'point') },
    { key: 'roundhog', icon: '🐗', title: 'Round Hog', how: 'Win the most rounds.', quip: '{name} has hogged {value}. Sharing is caring, apparently not.', fn: (s) => s.roundsWon, fmt: (v) => plural(v, 'round') },
    { key: 'serial', icon: '🏅', title: 'Serial Winner', how: 'Win 2+ games in a row. Longest run takes it.', quip: '{name} won {value} back to back. Someone call the authorities.', fn: (s) => s.gameStreak, fmt: (v) => plural(v, 'game'), min: 2 },
    { key: 'unbeaten', icon: '🛡️', title: 'The Unbreakable', how: 'Go the most games in a row without a loss.', quip: '{name} went {value} without losing. Wins and draws only, thank you.', fn: (s) => s.unbeaten, fmt: (v) => plural(v, 'game'), min: 2 },
    { key: 'lucky', icon: '🍀', title: 'Lucky Charm', how: 'Best game win rate (3+ finished games).', quip: '{name} wins {value} of their games. Rub them for luck.', fn: (s) => (s.finished >= 3 ? s.winRate : null), fmt: pct },
    { key: 'sniper', icon: '🎯', title: 'The Sniper', how: 'Best round win rate (10+ rounds).', quip: '{name} wins {value} of rounds. Never misses.', fn: (s) => (s.rounds >= 10 ? s.roundWinRate : null), fmt: pct },
    { key: 'heist', icon: '💰', title: 'Daylight Robbery', how: 'Score the most points in a single round.', quip: '{name} pocketed {value} in one round. Check their sleeves.', fn: (s) => s.bestRound, fmt: (v) => plural(v, 'point') },
    { key: 'bigbang', icon: '💥', title: 'Big Bang', how: 'Score the most points in a single game.', quip: '{name} put up {value} in one game. The table is still smoking.', fn: (s) => s.bestGame, fmt: (v) => plural(v, 'point') },
    { key: 'streak', icon: '🔥', title: 'Hotter Than a Draw Four', how: 'Win 2+ rounds in a row. Longest streak takes it.', quip: '{name} won {value} in a row. Somebody unplug them.', fn: (s) => s.longestStreak, fmt: (v) => plural(v, 'round'), min: 2 },
    { key: 'leadmagnet', icon: '🧲', title: 'Lead Magnet', how: 'Sit alone in first place after the most rounds.', quip: '{name} has been top of the table for {value}. Comfy up there?', fn: (s) => s.roundsLed, fmt: (v) => plural(v, 'round') },
    { key: 'thief', icon: '🦹', title: 'Lead Thief', how: 'Snatch the lead from someone else the most times.', quip: '{name} has stolen the lead {value}. Lock up your points.', fn: (s) => s.leadsTaken, fmt: (v) => plural(v, 'time') },
    { key: 'wire', icon: '🏁', title: 'Wire to Wire', how: 'Lead after every single round of a game (3+ rounds) and win it.', quip: '{name} led from start to finish {value}. Never even looked back.', fn: (s) => s.wireToWire, fmt: (v) => plural(v, 'time') },
    { key: 'comeback', icon: '🚀', title: 'The Comeback Kid', how: 'Win a game after being in last place.', quip: '{name} was dead last and still won {value}. Never count them out.', fn: (s) => s.comebackWins, fmt: (v) => plural(v, 'game') },
    { key: 'slowburn', icon: '🕯️', title: 'Slow Burner', how: 'Win a game you weren’t leading at halfway.', quip: '{name} saved the best for last {value}. Pacing is an art.', fn: (s) => s.slowBurnWins, fmt: (v) => plural(v, 'time') },
    { key: 'cleansheet', icon: '🧹', title: 'Clean Sheet', how: 'Win a game where nobody else scored a single point.', quip: '{name} won {value} without conceding a point. Ruthless.', fn: (s) => s.cleanSheets, fmt: (v) => plural(v, 'game') },
    { key: 'steamroller', icon: '🚜', title: 'The Steamroller', how: 'Win a game by the biggest margin.', quip: '{name} won by {value}. That wasn’t a game, it was a lesson.', fn: (s) => s.biggestWin, fmt: (v) => plural(v, 'point') },
    { key: 'photo', icon: '📸', title: 'Photo Finish', how: 'Win a game by the smallest margin.', quip: '{name} won by {value}. Lawyers were consulted.', fn: (s) => s.closestWin, fmt: (v) => plural(v, 'point'), lowest: true },
    { key: 'ice', icon: '🧊', title: 'Ice in the Veins', how: 'Win the most games by a single point (or less).', quip: '{name} has won {value} by a whisker. Pulse never went above 60.', fn: (s) => s.closeWins, fmt: (v) => plural(v, 'nail-biter') },
    { key: 'speedrun', icon: '🏎️', title: 'Speed Run', how: 'Win a game in the fewest rounds.', quip: '{name} won a whole game in {value}. Blink and you missed it.', fn: (s) => s.fastestWin, fmt: (v) => plural(v, 'round'), lowest: true },
    { key: 'marathon', icon: '🐌', title: 'Marathon Survivor', how: 'Win the longest game.', quip: '{name} outlasted everyone in a game that went {value}. Legs are gone.', fn: (s) => s.longestWin, fmt: (v) => plural(v, 'round') },
    { key: 'average', icon: '📈', title: 'Mean Machine', how: 'Best average score per round (5+ rounds, highest-wins games).', quip: '{name} averages {value} a round. Mean as in average. And as in mean.', fn: (s) => (s.highScores.length >= 5 ? s.avgHigh : null), fmt: (v) => fmt1(v) },
    { key: 'accountant', icon: '🧮', title: 'The Accountant', how: 'Best average points per game (3+ games).', quip: '{name} brings {value} a game. Numbers don’t lie, but they do brag.', fn: (s) => (s.games >= 3 ? s.avgPerGame : null), fmt: (v) => fmt1(v) },
    { key: 'metronome', icon: '⏱️', title: 'The Metronome', how: 'Most consistent scores, round after round (5+ rounds).', quip: '{name} barely changes. Boring? Maybe. Terrifying? Definitely.', fn: (s) => (s.highScores.length >= 5 ? s.spread : null), fmt: (v) => `±${fmt1(v)}`, lowest: true },
    { key: 'rollercoaster', icon: '🎢', title: 'Rollercoaster Rider', how: 'Wildest swings between rounds (5+ rounds).', quip: '{name} is either feast or famine. Mostly drama.', fn: (s) => (s.highScores.length >= 5 ? s.spread : null), fmt: (v) => `±${fmt1(v)}` },
    { key: 'earlybird', icon: '🐣', title: 'Early Bird', how: 'Win the first round of the most games.', quip: '{name} won round one {value}. Strong starts, questionable finishes?', fn: (s) => s.earlyWins, fmt: (v) => plural(v, 'time') },
    { key: 'peace', icon: '🕊️', title: 'The Peacekeeper', how: 'Finish the most games in a draw.', quip: '{name} has drawn {value}. Can’t lose if you don’t win, right?', fn: (s) => s.draws, fmt: (v) => plural(v, 'game') },
    { key: 'bridesmaid', icon: '🥈', title: 'Always the Bridesmaid', how: 'Finish second the most.', quip: '{name} finished second {value}. So close you can taste it.', fn: (s) => s.seconds, fmt: (v) => plural(v, 'time') },
    { key: 'choker', icon: '🫠', title: 'So Close, Yet So Uno', how: 'Lead a game at some point, then lose it.', quip: '{name} led {value} and didn’t win. It’s fine. Everything’s fine.', fn: (s) => s.ledButLost, fmt: (v) => plural(v, 'game') },
    { key: 'cursed', icon: '🐈‍⬛', title: 'Cursed', how: 'Lose 2+ games in a row. Longest run takes it.', quip: '{name} lost {value} in a row. Has anyone checked for a black cat?', fn: (s) => s.lossStreak, fmt: (v) => plural(v, 'game'), min: 2 },
    { key: 'waiting', icon: '⏳', title: 'Still Waiting', how: 'Play the most finished games without winning one.', quip: '{name} has played {value} and is still waiting for that first win. It’s coming. Probably.', fn: (s) => (s.wins === 0 ? s.finished : null), fmt: (v) => plural(v, 'game') },
    { key: 'sloth', icon: '🦥', title: 'The Sloth', how: 'Lowest round win rate (10+ rounds).', quip: '{name} wins {value} of rounds. Conserving energy for something.', fn: (s) => (s.rounds >= 10 ? s.roundWinRate : null), fmt: pct, lowest: true },
    { key: 'goose', icon: '🥚', title: 'Goose Egg Collector', how: 'Score zero while someone else scores.', quip: '{name} has scored zero {value}. Eggs-traordinary.', fn: (s) => s.zeroRounds, fmt: (v) => plural(v, 'time') },
    { key: 'snooze', icon: '😴', title: 'Snooze Button', how: 'Score zero in the most rounds in a row (3+).', quip: '{name} scored zero {value} straight. Wake up!', fn: (s) => s.zeroRun, fmt: (v) => plural(v, 'round'), min: 3 },
    { key: 'bagel', icon: '🥯', title: 'The Bagel', how: 'Finish a game with zero points.', quip: '{name} finished {value} with a big round zero. Toasted.', fn: (s) => s.bagels, fmt: (v) => plural(v, 'game') },
    { key: 'iceage', icon: '🦣', title: 'Ice Age', how: 'Go the longest without winning a round (3+).', quip: '{name} once went {value} without a win. We never stopped believing.', fn: (s) => s.longestDrought, fmt: (v) => plural(v, 'round'), min: 3 },
    { key: 'participation', icon: '🐢', title: 'Participation Trophy', how: 'Finish last the most (games with 3+ players).', quip: '{name} came last {value}. Showing up is half the battle.', fn: (s) => s.lastPlaces, fmt: (v) => plural(v, 'time') },
    { key: 'ouch', icon: '🩹', title: 'Ouch, My Hand', how: 'Take the biggest hit in a lowest-wins game.', quip: '{name} ate {value} in one round. Thoughts and prayers.', fn: (s) => s.biggestHit, fmt: (v) => plural(v, 'point') },
    { key: 'teflon', icon: '😇', title: 'Teflon', how: 'Lowest average per round in lowest-wins games (4+ rounds).', quip: 'Nothing sticks to {name}: just {value} a round.', fn: (s) => (s.lowScores.length >= 4 ? s.avgLow : null), fmt: (v) => fmt1(v), lowest: true },
    { key: 'nightowl', icon: '🦉', title: 'Night Owl', how: 'Play the most rounds after 10pm.', quip: '{name} has played {value} after 10pm. Go to bed.', fn: (s) => s.nightRounds, fmt: (v) => plural(v, 'round') },
    { key: 'earlyriser', icon: '🌅', title: 'Breakfast of Champions', how: 'Play the most rounds before 10am.', quip: '{name} has played {value} before 10am. Cereal and Draw Fours.', fn: (s) => s.morningRounds, fmt: (v) => plural(v, 'round') },
    { key: 'weekend', icon: '🛋️', title: 'Weekend Warrior', how: 'Play the most rounds on Saturdays and Sundays.', quip: '{name} has spent {value} of their weekends here. No regrets.', fn: (s) => s.weekendRounds, fmt: (v) => plural(v, 'round') },
    { key: 'shuffler', icon: '🃏', title: 'Professional Shuffler', how: 'Play the most rounds.', quip: '{value} and counting. {name} basically lives here now.', fn: (s) => s.rounds, fmt: (v) => plural(v, 'round') },
    { key: 'regular', icon: '🎟️', title: 'Season Ticket Holder', how: 'Play the most games.', quip: '{name} has shown up for {value}. That’s loyalty.', fn: (s) => s.games, fmt: (v) => plural(v, 'game') },
    {
      key: 'reigning', icon: '🎖️', title: 'Reigning Champ', how: 'Win the most recent finished game.',
      quip: '{name} won the last game ({value}). Enjoy it while it lasts.',
      custom: (state) => {
        const g = [...state.games].filter((x) => winnerOf(x)).sort((a, b) => (b.finishedAt || b.createdAt || 0) - (a.finishedAt || a.createdAt || 0))[0];
        return g ? { holders: [winnerOf(g)], value: g.name } : null;
      },
    },
    {
      key: 'founder', icon: '🏛️', title: 'The Founding Father', how: 'Win the very first game ever recorded.',
      quip: '{name} won the first ever game ({value}). History remembers.',
      custom: (state) => {
        const g = [...state.games].filter((x) => winnerOf(x)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
        return g ? { holders: [winnerOf(g)], value: g.name } : null;
      },
    },
    {
      key: 'og', icon: '🦕', title: 'The OG', how: 'Be the first player to join the table.',
      quip: '{name} has been here since {value}. Respect your elders.',
      custom: (state, all) => {
        if (all.length < 2) return null;
        const s = [...all].sort((a, b) => a.createdAt - b.createdAt)[0];
        return s.createdAt ? { holders: [s.id], value: shortDate(s.createdAt) } : null;
      },
    },
    {
      key: 'fresh', icon: '🍼', title: 'Fresh Meat', how: 'Be the newest player to sit down.',
      quip: '{name} joined on {value}. Be gentle. Or don’t.',
      custom: (state, all) => {
        if (all.length < 2) return null;
        const s = [...all].sort((a, b) => b.createdAt - a.createdAt)[0];
        return s.createdAt ? { holders: [s.id], value: shortDate(s.createdAt) } : null;
      },
    },
  ];

  function trophies(state) {
    const all = Object.values(playerStats(state)).filter((s) => s.rounds > 0);
    const order = Object.fromEntries(state.players.map((p, i) => [p.id, i]));
    return TROPHIES.map((t) => {
      if (t.custom) {
        const r = all.length ? t.custom(state, all) : null;
        return r && r.holders.every((id) => id in order) ? { ...t, ...r } : { ...t, holders: [], value: null };
      }
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
    }).map(({ fn, fmt, custom, ...rest }) => rest);
  }

  /** Earned trophies only (kept for older callers). */
  const awards = (state) => trophies(state).filter((t) => t.holders.length).map((t) => ({ ...t, winnerId: t.holders[0] }));

  /** wins[a][b] = finished, decided games where a placed above b (both played). Draws don't count. */
  function headToHead(state) {
    const m = {};
    state.players.forEach((a) => {
      m[a.id] = {};
      state.players.forEach((b) => (m[a.id][b.id] = 0));
    });
    state.games
      .filter((g) => winnerOf(g))
      .forEach((g) => {
        const st = standings(g);
        const pos = {};
        const w = winnerOf(g);
        st.forEach((row, i) => (pos[row.id] = row.id === w ? -1 : row.rank + i / 1000));
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
    tiedAtTop,
    isDraw,
    winnerOf,
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
