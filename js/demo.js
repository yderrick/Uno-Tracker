/* Uno Tracker — a seeded demo game night so the dashboards have something to show
   before the first real game. Clearly flagged as demo data in the UI. */
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build(L) {
    const rng = mulberry32(20261012);
    const day = 86400000;
    const now = Date.now();
    const players = [
      { id: 'demo-mia', name: 'Mia', emoji: '🦊', color: 'red' },
      { id: 'demo-theo', name: 'Theo', emoji: '🐸', color: 'green' },
      { id: 'demo-priya', name: 'Priya', emoji: '🦄', color: 'purple' },
      { id: 'demo-jonah', name: 'Jonah', emoji: '🐙', color: 'blue' },
      { id: 'demo-rose', name: 'Grandma Rose', emoji: '🌻', color: 'yellow' },
    ].map((p, i) => ({ ...p, createdAt: now - 30 * day + i }));
    const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    // Some players are luckier than others.
    const skill = { 'demo-mia': 1.3, 'demo-theo': 1, 'demo-priya': 1.15, 'demo-jonah': 0.8, 'demo-rose': 1.25 };

    const hand = () => {
      const cards = 1 + Math.floor(rng() * 6);
      let pts = 0;
      for (let i = 0; i < cards; i++) {
        const r = rng();
        pts += r < 0.62 ? Math.floor(rng() * 10) : r < 0.88 ? 20 : r < 0.97 ? 50 : 40;
      }
      return pts;
    };

    function playGame({ id, name, mode, target, playerIds, start, finish, maxRounds }) {
      const game = { id, name, mode, target, playerIds, rounds: [], status: 'active', createdAt: start, winnerId: null };
      for (let n = 0; n < maxRounds; n++) {
        const weights = playerIds.map((pid) => skill[pid] * (0.5 + rng()));
        const winnerId = playerIds[weights.indexOf(Math.max(...weights))];
        const hands = {};
        playerIds.forEach((pid) => pid !== winnerId && (hands[pid] = hand()));
        const entry = { playerIds, winnerId, hands };
        const round = { id: `${id}-r${n}`, at: start + n * 9 * 60000, playerIds, winnerId, hands, points: L.roundPoints(mode, entry) };
        game.rounds.push(round);
        round.comments = L.commentary(game, n, names, rng);
        const over = L.checkOver(game);
        if (over.over && finish) {
          game.status = 'finished';
          game.winnerId = over.winnerId;
          game.finishedAt = round.at + 60000;
          game.endLine = L.gameOverLine(game, names, rng);
          break;
        }
        if (over.over) {
          game.rounds.pop();
          break;
        }
      }
      return game;
    }

    const all = players.map((p) => p.id);
    const games = [
      playGame({ id: 'demo-g1', name: 'Thanksgiving Throwdown', mode: 'classic', target: 500, playerIds: all, start: now - 21 * day, finish: true, maxRounds: 40 }),
      playGame({ id: 'demo-g2', name: 'The Draw Four Dispute', mode: 'lowball', target: 200, playerIds: all.slice(0, 4), start: now - 12 * day, finish: true, maxRounds: 40 }),
      playGame({ id: 'demo-g3', name: 'Rematch Sunday', mode: 'classic', target: 300, playerIds: [all[0], all[1], all[3], all[4]], start: now - 5 * day, finish: true, maxRounds: 40 }),
      playGame({ id: 'demo-g4', name: 'Friday Night Showdown', mode: 'classic', target: 500, playerIds: all, start: now - 2 * 3600000, finish: false, maxRounds: 7 }),
    ];
    return { version: 1, isDemo: true, players, games, activeGameId: 'demo-g4' };
  }

  window.UnoDemo = { build };
})();
