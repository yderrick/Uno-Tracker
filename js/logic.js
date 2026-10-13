/* Uno Tracker — pure game logic: totals, standings, stats, awards and commentary.
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

  function roundsSinceWin(game, id) {
    let n = 0;
    for (let i = game.rounds.length - 1; i >= 0; i--) {
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
      'And we are OFF! {w} opens with {pts}.',
      'Round one goes to {w}. The table has been warned.',
      '{w} draws first blood. Everyone else, shuffle your feelings.',
    ],
    win: [
      '{w} takes round {n} with {pts}.',
      'Round {n} belongs to {w}. {pts} points, thank you very much.',
      '{w} wins round {n}. The rest of the table counts their sins.',
      'A tidy {pts} for {w} in round {n}. No notes.',
    ],
    winLow: [
      '{w} gets off lightest in round {n}, just {pts}.',
      'Round {n}: {w} escapes with only {pts}.',
      '{w} dodges the damage in round {n}.',
    ],
    big: [
      'A {pts}-point round for {w}! That is grand larceny.',
      '{w} rakes in {pts}. Somebody check their sleeves.',
      'BOOM. {pts} points straight into {w}’s pocket.',
    ],
    ouch: [
      '{p} takes a {pts}-point hit. Ouch.',
      'Somebody hug {p}. That was {pts} points of pain.',
      '{p} was building a card collection. {pts} points of it.',
    ],
    zero: [
      '{p} scores a big fat zero this round.',
      'Nothing for {p} this time. Not even a crumb.',
    ],
    leadChange: [
      'NEW LEADER! {p} snatches the top spot from {q}.',
      'Changing of the guard: {p} overtakes {q}.',
      '{q} has been dethroned. {p} wears the crown now.',
    ],
    comeback: [
      'From the basement to the penthouse: {p} climbs from last to first!',
      'What a comeback! {p} was dead last and now leads the pack.',
    ],
    streak3: [
      '{p} is ON FIRE. That is {s} rounds in a row.',
      'Can anyone stop {p}? {s} straight round wins.',
    ],
    streakBroken: ['{w} snaps {p}’s {s}-round streak.', 'The streak is over! {w} ends {p}’s run at {s}.'],
    nearTarget: ['{p} can smell victory. Just {gap} to go.', 'Danger! {p} is {gap} points from the finish line.'],
    nearLimit: ['{p} is {gap} points from the limit. Sweaty palms.', 'Careful, {p}. Only {gap} points of breathing room left.'],
    tight: ['Only {gap} points separate first and second. Tense!', 'Neck and neck: the top two are {gap} apart.'],
    lastPlace: ['Meanwhile, {p} is “building character” in last place.', '{p} holds down last place. Someone has to.'],
    gameOver: ['GAME OVER! {w} is your champion with {pts}.', 'That’s the game! Bow down to {w}.', '{w} takes it all. Somebody get them a trophy.'],
  };

  /** Commentary for the round at index `idx` (already in game.rounds). names: {id: name}. */
  function commentary(game, idx, names, rng = Math.random) {
    const pick = pickFrom(rng);
    const nm = (id) => names[id] || 'Someone';
    const r = game.rounds[idx];
    const pts = r.points || {};
    const high = higherWins(game);
    const n = idx + 1;
    const lines = [];
    const before = standingsAfter(game, idx);
    const after = standingsAfter(game, idx + 1);
    const bigAt = game.target ? Math.max(20, Math.round(game.target * 0.25)) : 100;
    const w = r.winnerId;

    if (w) {
      if (idx === 0 && high) lines.push(fill(pick(LINES.opener), { w: nm(w), pts: pts[w] }));
      else lines.push(fill(pick(high ? LINES.win : LINES.winLow), { w: nm(w), n, pts: pts[w] }));
      const s = currentStreak(game, w, idx + 1);
      if (s >= 3) lines.push(fill(pick(LINES.streak3), { p: nm(w), s }));
      const prev = idx > 0 ? game.rounds[idx - 1].winnerId : null;
      if (prev && prev !== w) {
        const ps = currentStreak(game, prev, idx);
        if (ps >= 3) lines.push(fill(pick(LINES.streakBroken), { w: nm(w), p: nm(prev), s: ps }));
      }
    } else {
      lines.push(`Round ${n} is in the books. Nobody runs away with it.`);
    }

    const sorted = Object.entries(pts).sort((a, b) => num(b[1]) - num(a[1]));
    if (sorted.length && num(sorted[0][1]) >= bigAt) {
      if (high && idx > 0) lines.push(fill(pick(LINES.big), { w: nm(sorted[0][0]), pts: num(sorted[0][1]) }));
      if (!high) lines.push(fill(pick(LINES.ouch), { p: nm(sorted[0][0]), pts: num(sorted[0][1]) }));
    }
    if (high && sorted.length > 2 && num(sorted[sorted.length - 1][1]) === 0 && num(sorted[0][1]) > 0 && rng() < 0.4)
      lines.push(fill(pick(LINES.zero), { p: nm(sorted[sorted.length - 1][0]) }));

    if (idx > 0 && before.length > 1) {
      const newTop = after[0];
      if (newTop.id !== before[0].id && after[1] && newTop.total !== after[1].total) {
        if (before[before.length - 1].id === newTop.id && before.length > 2) lines.push(fill(pick(LINES.comeback), { p: nm(newTop.id) }));
        else lines.push(fill(pick(LINES.leadChange), { p: nm(newTop.id), q: nm(before[0].id) }));
      }
    }

    const over = game.target && after.some((row) => row.total >= game.target);
    if (!over && after.length > 1) {
      if (game.target) {
        const danger = high ? after[0] : [...after].sort((a, b) => b.total - a.total)[0];
        const gap = game.target - danger.total;
        if (gap > 0 && gap <= game.target * 0.2) lines.push(fill(pick(high ? LINES.nearTarget : LINES.nearLimit), { p: nm(danger.id), gap }));
      }
      const gap12 = Math.abs(after[0].total - after[1].total);
      if (lines.length < 3 && idx >= 2 && gap12 > 0 && gap12 <= 10) lines.push(fill(pick(LINES.tight), { gap: gap12 }));
      if (lines.length < 2 && idx >= 2 && after.length > 2 && rng() < 0.45) lines.push(fill(pick(LINES.lastPlace), { p: nm(after[after.length - 1].id) }));
    }
    return lines.slice(0, 3);
  }

  function gameOverLine(game, names, rng = Math.random) {
    const top = standings(game)[0];
    return fill(pickFrom(rng)(LINES.gameOver), { w: names[top.id] || 'Someone', pts: top.total });
  }

  /** A mood label for a player's scoreboard card. */
  function mood(game, id) {
    if (!game.rounds.length) return { icon: '🃏', text: 'Shuffling up' };
    const st = standings(game);
    const row = st.find((s) => s.id === id);
    const last = game.rounds[game.rounds.length - 1];
    const streak = currentStreak(game, id);
    const frac = game.target ? row.total / game.target : 0;
    if (streak >= 2) return { icon: '🔥', text: `On fire ×${streak}` };
    if (!higherWins(game) && frac >= 0.8) return { icon: '😬', text: 'Danger zone' };
    if (higherWins(game) && frac >= 0.8 && row.rank === 1) return { icon: '🎯', text: 'Smells victory' };
    if (row.rank === 1 && st.length > 1 && st[1].total !== row.total) return { icon: '👑', text: 'Top dog' };
    if (last.winnerId === id) return { icon: '⚡', text: 'Fresh off a win' };
    if (row.rank === st.length && st.length > 2) return { icon: '🐢', text: 'Building character' };
    const dry = roundsSinceWin(game, id);
    if (dry >= 4) return { icon: '🧊', text: 'Ice cold' };
    return { icon: '🃏', text: 'In the hunt' };
  }

  /* -------------------------------------------------------------- all-time stats */

  function playerStats(state) {
    const stats = {};
    state.players.forEach((p) => {
      stats[p.id] = { id: p.id, games: 0, finished: 0, wins: 0, seconds: 0, rounds: 0, roundsWon: 0, bestRound: 0, biggestHit: 0, longestStreak: 0, lastPlayed: 0 };
    });
    state.games.forEach((g) => {
      const st = standings(g);
      const high = higherWins(g);
      g.playerIds.forEach((id) => {
        const s = stats[id];
        if (!s) return;
        s.games++;
        s.lastPlayed = Math.max(s.lastPlayed, g.finishedAt || g.createdAt || 0);
        s.longestStreak = Math.max(s.longestStreak, longestStreak(g, id));
        if (g.status === 'finished') {
          s.finished++;
          if (g.winnerId === id) s.wins++;
          else if (st.length > 1 && st[1].id === id) s.seconds++;
        }
      });
      g.rounds.forEach((r) => {
        Object.entries(r.points || {}).forEach(([id, p]) => {
          const s = stats[id];
          if (!s) return;
          s.rounds++;
          if (r.winnerId === id) s.roundsWon++;
          if (high) s.bestRound = Math.max(s.bestRound, num(p));
          else s.biggestHit = Math.max(s.biggestHit, num(p));
        });
      });
    });
    Object.values(stats).forEach((s) => {
      s.winRate = s.finished ? s.wins / s.finished : 0;
    });
    return stats;
  }

  /** Superlatives: {key, icon, title, blurb, winnerId, value}. */
  function awards(state) {
    const stats = Object.values(playerStats(state)).filter((s) => s.rounds > 0);
    const out = [];
    const best = (key, icon, title, blurb, fn, fmt, min = 1) => {
      if (!stats.length) return;
      const top = [...stats].sort((a, b) => fn(b) - fn(a))[0];
      if (fn(top) >= min) out.push({ key, icon, title, blurb, winnerId: top.id, value: fmt(fn(top)) });
    };
    best('champ', '👑', 'Champion', 'Most games won', (s) => s.wins, (v) => `${v} win${v === 1 ? '' : 's'}`);
    best('rounds', '⚡', 'Round Machine', 'Most rounds won', (s) => s.roundsWon, (v) => `${v} rounds`);
    best('big', '💰', 'Big Round', 'Best single round', (s) => s.bestRound, (v) => `${v} pts`);
    best('streak', '🔥', 'Hot Streak', 'Most round wins in a row', (s) => s.longestStreak, (v) => `${v} in a row`, 2);
    best('second', '🥈', 'Eternal Bridesmaid', 'Most second places', (s) => s.seconds, (v) => `${v}× runner-up`);
    best('ouch', '🩹', 'Ouch!', 'Biggest hit in a lowest-wins game', (s) => s.biggestHit, (v) => `${v} pts`);
    best('marathon', '🏃', 'Marathoner', 'Most rounds played', (s) => s.rounds, (v) => `${v} rounds`);
    return out;
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
    roundsSinceWin,
    commentary,
    gameOverLine,
    mood,
    playerStats,
    awards,
  };
});
