/* Uno Tracker — pure game logic: scoring, standings, stats, awards and commentary.
   No DOM access here, so it can be unit-tested with Node (see tests/logic.test.js). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnoLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Official card values. Number cards score their face value.
  const CARDS = [
    ...Array.from({ length: 10 }, (_, i) => ({ key: String(i), label: String(i), value: i, kind: 'number' })),
    { key: 'skip', label: 'Skip', glyph: '⊘', value: 20, kind: 'action' },
    { key: 'reverse', label: 'Reverse', glyph: '⇄', value: 20, kind: 'action' },
    { key: 'draw2', label: 'Draw Two', glyph: '+2', value: 20, kind: 'action' },
    { key: 'wild', label: 'Wild', glyph: 'W', value: 50, kind: 'wild' },
    { key: 'wild4', label: 'Wild Draw Four', glyph: '+4', value: 50, kind: 'wild' },
    { key: 'shuffle', label: 'Shuffle Hands', glyph: '⟲', value: 40, kind: 'wild' },
    { key: 'custom', label: 'Customizable', glyph: '✎', value: 40, kind: 'wild' },
  ];

  const MODES = {
    classic: {
      label: 'Classic',
      short: 'First to the target wins',
      blurb: "Official rules. Whoever goes out collects the points left in everyone else's hand. First to reach the target wins.",
      higherWins: true,
      usesHands: true,
    },
    lowball: {
      label: 'Lowball',
      short: 'Lowest score survives',
      blurb: 'The points left in your hand count against you. When anyone hits the limit, the lowest total wins.',
      higherWins: false,
      usesHands: true,
    },
    freestyle: {
      label: 'Freestyle',
      short: 'Type any score',
      blurb: 'House rules. Type whatever points each player earned this round. Highest total at the target wins.',
      higherWins: true,
      usesHands: false,
    },
  };

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };

  /** Score deltas for one round. entry = {playerIds, winnerId, hands, points}. */
  function roundPoints(mode, entry) {
    const out = {};
    const ids = entry.playerIds || [];
    if (mode === 'freestyle') {
      ids.forEach((id) => (out[id] = num(entry.points && entry.points[id])));
      return out;
    }
    const hands = entry.hands || {};
    const others = ids.filter((id) => id !== entry.winnerId);
    if (mode === 'lowball') {
      ids.forEach((id) => (out[id] = id === entry.winnerId ? 0 : Math.max(0, num(hands[id]))));
      return out;
    }
    // classic
    const haul = others.reduce((s, id) => s + Math.max(0, num(hands[id])), 0);
    ids.forEach((id) => (out[id] = id === entry.winnerId ? haul : 0));
    return out;
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
    const dir = MODES[game.mode] && MODES[game.mode].higherWins === false ? 1 : -1;
    const rows = game.playerIds.map((id) => ({ id, total: t[id], roundsWon: w[id] }));
    rows.sort((a, b) => (a.total - b.total) * dir || b.roundsWon - a.roundsWon);
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      row.rank = prev && prev.total === row.total ? prev.rank : i + 1;
    });
    return rows;
  }
  const standings = (game) => standingsAfter(game, game.rounds.length);

  /** Has anyone reached the target? Returns {over, winnerId}. */
  function checkOver(game) {
    if (!game.rounds.length) return { over: false, winnerId: null };
    const t = totals(game);
    const reached = Object.values(t).some((v) => v >= game.target);
    if (!reached) return { over: false, winnerId: null };
    return { over: true, winnerId: standings(game)[0].id };
  }

  /** Current run of consecutive round wins, counting back from the latest round. */
  function currentStreak(game, id, roundCount = game.rounds.length) {
    let s = 0;
    for (let i = roundCount - 1; i >= 0; i--) {
      const r = game.rounds[i];
      if (!(r.playerIds || []).includes(id)) continue;
      if (r.winnerId === id) s++;
      else break;
    }
    return s;
  }

  function longestStreak(game, id) {
    let best = 0;
    let run = 0;
    game.rounds.forEach((r) => {
      if (!(r.playerIds || []).includes(id)) return;
      if (r.winnerId === id) best = Math.max(best, ++run);
      else run = 0;
    });
    return best;
  }

  function roundsSinceWin(game, id) {
    let n = 0;
    for (let i = game.rounds.length - 1; i >= 0; i--) {
      const r = game.rounds[i];
      if (!(r.playerIds || []).includes(id)) continue;
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
      'And we are OFF! {w} draws first blood with {pts}.',
      'Round one goes to {w}. The table has been warned.',
      '{w} opens the account. Everyone else, shuffle your feelings.',
      'First round, first casualty. {w} walks away clean.',
    ],
    win: [
      '{w} slaps down the last card. Round {n} is theirs.',
      '{w} goes out! The rest of the table counts their sins.',
      'UNO! And just like that, {w} is empty-handed and smug.',
      'Clean hands for {w}. Round {n} in the books.',
      '{w} empties the hand like it was nothing.',
      'A tidy finish from {w}. No notes.',
    ],
    haul: [
      'A {pts}-point haul for {w}! That is grand larceny.',
      '{w} rakes in {pts}. Somebody check their sleeves.',
      'BOOM. {pts} points straight into {w}’s pocket.',
    ],
    tinyHaul: [
      'Only {pts} for {w}. A win is a win, technically.',
      '{w} wins the round and collects a modest {pts}. Humble.',
    ],
    stuck: [
      '{p} got caught holding {pts}. Ouch.',
      '{p} is left with a {pts}-point souvenir.',
      'Somebody hug {p}. That was a {pts}-point hand.',
      '{p} was building a card collection. {pts} points of it.',
    ],
    leadChange: [
      'NEW LEADER! {p} snatches the top spot from {q}.',
      'Changing of the guard: {p} overtakes {q}.',
      '{q} has been dethroned. {p} wears the crown now.',
    ],
    streak3: [
      '{p} is ON FIRE. That is {s} rounds in a row.',
      'Can anyone stop {p}? {s} straight wins.',
      '{s} in a row for {p}. This is no longer a game, it is a lecture.',
    ],
    streakBroken: [
      '{w} snaps {p}’s {s}-round streak.',
      'The streak is over! {w} ends {p}’s run at {s}.',
    ],
    nearTarget: [
      '{p} can smell victory. Just {gap} to go.',
      'Danger! {p} is {gap} points from the finish line.',
      '{p} is one good round from glory ({gap} left).',
    ],
    nearLimit: [
      '{p} is {gap} points from elimination. Sweaty palms.',
      'Careful, {p}. Only {gap} points of breathing room left.',
    ],
    lowballClean: [
      '{w} dodges the damage this round. Zero points taken.',
      '{w} escapes unharmed while everyone else bleeds points.',
    ],
    comeback: [
      'From the basement to the penthouse: {p} climbs from last to first!',
      'What a comeback! {p} was dead last and now leads the pack.',
    ],
    lastPlace: [
      'Meanwhile, {p} is “building character” in last place.',
      '{p} holds down last place. Someone has to.',
      '{p} remains in last, playing the long game. Very long.',
    ],
    tight: [
      'Only {gap} points separate first and second. Tense!',
      'Neck and neck: the top two are {gap} apart.',
    ],
    freestyleTop: [
      '{p} posts the round’s best score with {pts}.',
      '{p} leads round {n} with {pts}.',
    ],
    gameOver: [
      'GAME OVER! {w} is your champion with {pts}.',
      'That’s the game! Bow down to {w}.',
      '{w} takes it all. Somebody get them a trophy.',
    ],
  };

  /**
   * Commentary for the round at index `idx` (already appended to game.rounds).
   * names: {id: displayName}. Returns an array of short strings.
   */
  function commentary(game, idx, names, rng = Math.random) {
    const pick = pickFrom(rng);
    const nm = (id) => names[id] || 'Someone';
    const r = game.rounds[idx];
    const mode = game.mode;
    const lines = [];
    const before = standingsAfter(game, idx);
    const after = standingsAfter(game, idx + 1);
    const pts = r.points || {};
    const w = r.winnerId;
    const n = idx + 1;

    if (mode === 'freestyle') {
      const best = Object.entries(pts).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) lines.push(fill(pick(LINES.freestyleTop), { p: nm(best[0]), pts: best[1], n }));
    } else if (w) {
      if (idx === 0 && mode === 'classic') lines.push(fill(pick(LINES.opener), { w: nm(w), pts: pts[w] }));
      else if (mode === 'lowball') lines.push(fill(pick(rng() < 0.5 ? LINES.lowballClean : LINES.win), { w: nm(w), n }));
      else lines.push(fill(pick(LINES.win), { w: nm(w), n }));

      if (mode === 'classic' && idx > 0) {
        if (pts[w] >= 100) lines.push(fill(pick(LINES.haul), { w: nm(w), pts: pts[w] }));
        else if (pts[w] > 0 && pts[w] <= 10) lines.push(fill(pick(LINES.tinyHaul), { w: nm(w), pts: pts[w] }));
      }
      const hands = r.hands || {};
      const worst = Object.entries(hands)
        .filter(([id]) => id !== w)
        .sort((a, b) => num(b[1]) - num(a[1]))[0];
      if (worst && num(worst[1]) >= 60) lines.push(fill(pick(LINES.stuck), { p: nm(worst[0]), pts: num(worst[1]) }));

      // streaks
      const s = currentStreak(game, w, idx + 1);
      if (s >= 3) lines.push(fill(pick(LINES.streak3), { p: nm(w), s }));
      const prevWinner = idx > 0 ? game.rounds[idx - 1].winnerId : null;
      if (prevWinner && prevWinner !== w) {
        const ps = currentStreak(game, prevWinner, idx);
        if (ps >= 3) lines.push(fill(pick(LINES.streakBroken), { w: nm(w), p: nm(prevWinner), s: ps }));
      }
    }

    if (idx > 0 && before.length > 1) {
      const oldTop = before[0];
      const newTop = after[0];
      const lastBefore = before[before.length - 1];
      if (newTop.id !== oldTop.id && after[1] && newTop.total !== after[1].total) {
        if (lastBefore.id === newTop.id && before.length > 2) lines.push(fill(pick(LINES.comeback), { p: nm(newTop.id) }));
        else lines.push(fill(pick(LINES.leadChange), { p: nm(newTop.id), q: nm(oldTop.id) }));
      }
    }

    const over = after.some((row) => row.total >= game.target);
    if (!over && after.length > 1) {
      if (mode === 'lowball') {
        const danger = [...after].sort((a, b) => b.total - a.total)[0];
        const gap = game.target - danger.total;
        if (gap > 0 && gap <= game.target * 0.2) lines.push(fill(pick(LINES.nearLimit), { p: nm(danger.id), gap }));
      } else {
        const gap = game.target - after[0].total;
        if (gap > 0 && gap <= game.target * 0.2) lines.push(fill(pick(LINES.nearTarget), { p: nm(after[0].id), gap }));
      }
      const gap12 = Math.abs(after[0].total - after[1].total);
      if (lines.length < 3 && idx >= 2 && gap12 > 0 && gap12 <= Math.max(10, game.target * 0.03))
        lines.push(fill(pick(LINES.tight), { gap: gap12 }));
      if (lines.length < 2 && idx >= 2 && after.length > 2 && rng() < 0.45)
        lines.push(fill(pick(LINES.lastPlace), { p: nm(after[after.length - 1].id) }));
    }
    return lines.slice(0, 3);
  }

  function gameOverLine(game, names, rng = Math.random) {
    const top = standings(game)[0];
    return fill(pickFrom(rng)(LINES.gameOver), { w: names[top.id] || 'Someone', pts: top.total });
  }

  /** A stable mood label for a player's scoreboard card. */
  function mood(game, id) {
    if (!game.rounds.length) return { icon: '🃏', text: 'Shuffling up' };
    const st = standings(game);
    const row = st.find((s) => s.id === id);
    if (!row) return { icon: '🪑', text: 'Sitting out' };
    const last = game.rounds[game.rounds.length - 1];
    const streak = currentStreak(game, id);
    const dry = roundsSinceWin(game, id);
    const frac = row.total / game.target;
    if (streak >= 2) return { icon: '🔥', text: `On fire ×${streak}` };
    if (game.mode === 'lowball' && frac >= 0.8) return { icon: '😬', text: 'Danger zone' };
    if (game.mode !== 'lowball' && frac >= 0.8 && row.rank === 1) return { icon: '🎯', text: 'Smells victory' };
    if (row.rank === 1 && st.length > 1 && st[1].total !== row.total) return { icon: '👑', text: 'Top dog' };
    if (last.winnerId === id) return { icon: '⚡', text: 'Fresh off a win' };
    if (row.rank === st.length && st.length > 2) return { icon: '🐢', text: 'Building character' };
    if (dry >= 4) return { icon: '🧊', text: `Ice cold · ${dry} rounds` };
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
        rounds: 0,
        roundsWon: 0,
        handTotal: 0,
        handRounds: 0,
        worstHand: 0,
        bestHaul: 0,
        banked: 0,
        longestStreak: 0,
        lastPlayed: 0,
      };
    });
    state.games.forEach((g) => {
      const st = standings(g);
      const finished = g.status === 'finished';
      g.playerIds.forEach((id) => {
        const s = stats[id];
        if (!s) return;
        s.games++;
        s.lastPlayed = Math.max(s.lastPlayed, g.finishedAt || g.createdAt || 0);
        s.longestStreak = Math.max(s.longestStreak, longestStreak(g, id));
        if (finished) {
          s.finished++;
          if (g.winnerId === id) s.wins++;
          const row = st.find((x) => x.id === id);
          if (row && st.length > 1 && g.winnerId !== id && row === st[1]) s.seconds++;
        }
      });
      g.rounds.forEach((r) => {
        (r.playerIds || []).forEach((id) => {
          const s = stats[id];
          if (!s) return;
          s.rounds++;
          if (r.winnerId === id) s.roundsWon++;
          const pts = num(r.points && r.points[id]);
          if (g.mode !== 'lowball') {
            s.banked += Math.max(0, pts);
            s.bestHaul = Math.max(s.bestHaul, pts);
          }
          if (MODES[g.mode] && MODES[g.mode].usesHands && r.winnerId && r.winnerId !== id) {
            const h = num(r.hands && r.hands[id]);
            s.handTotal += h;
            s.handRounds++;
            s.worstHand = Math.max(s.worstHand, h);
          }
        });
      });
    });
    Object.values(stats).forEach((s) => {
      s.winRate = s.finished ? s.wins / s.finished : 0;
      s.roundWinRate = s.rounds ? s.roundsWon / s.rounds : 0;
      s.avgHand = s.handRounds ? s.handTotal / s.handRounds : 0;
    });
    return stats;
  }

  /** Superlatives. Each award: {key, icon, title, blurb, winnerId, value}. */
  function awards(state) {
    const stats = Object.values(playerStats(state)).filter((s) => s.rounds > 0);
    const out = [];
    const best = (title, icon, blurb, key, valueFn, { min = 1, lowest = false, filter = () => true, fmt = (v) => v } = {}) => {
      const pool = stats.filter(filter);
      if (!pool.length) return;
      const sorted = [...pool].sort((a, b) => (lowest ? valueFn(a) - valueFn(b) : valueFn(b) - valueFn(a)));
      const top = sorted[0];
      const v = valueFn(top);
      if (!lowest && v < min) return;
      out.push({ key, icon, title, blurb, winnerId: top.id, value: fmt(v) });
    };
    best('Champion', '👑', 'Most games won', 'champ', (s) => s.wins, { fmt: (v) => `${v} win${v === 1 ? '' : 's'}` });
    best('Speed Demon', '⚡', 'Most rounds won', 'speed', (s) => s.roundsWon, { fmt: (v) => `${v} rounds` });
    best('Big Haul', '💰', 'Biggest single round', 'haul', (s) => s.bestHaul, { fmt: (v) => `${v} pts` });
    best('Hot Streak', '🔥', 'Longest run of round wins', 'streak', (s) => s.longestStreak, { min: 2, fmt: (v) => `${v} in a row` });
    best('Clean Hands', '🧼', 'Fewest points stuck in hand', 'clean', (s) => s.avgHand, {
      lowest: true,
      filter: (s) => s.handRounds >= 3,
      fmt: (v) => `${v.toFixed(1)} avg`,
    });
    best('Card Hoarder', '🧲', 'Most points stuck in hand', 'hoard', (s) => s.avgHand, {
      filter: (s) => s.handRounds >= 3,
      fmt: (v) => `${v.toFixed(1)} avg`,
    });
    best('Eternal Bridesmaid', '🥈', 'Most second-place finishes', 'second', (s) => s.seconds, { fmt: (v) => `${v}× runner-up` });
    best('Marathoner', '🏃', 'Most rounds played', 'marathon', (s) => s.rounds, { fmt: (v) => `${v} rounds` });
    return out;
  }

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
    CARDS,
    MODES,
    roundPoints,
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
    headToHead,
  };
});
