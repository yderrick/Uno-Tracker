// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

const game = (mode, target, rounds) => ({
  id: 'g',
  mode,
  target,
  playerIds: ['a', 'b', 'c'],
  rounds: rounds.map((r, i) => ({ id: 'r' + i, playerIds: ['a', 'b', 'c'], ...r, points: L.roundPoints(mode, { playerIds: ['a', 'b', 'c'], ...r }) })),
});

test('classic: the player who goes out collects everyone else’s hand points', () => {
  const pts = L.roundPoints('classic', { playerIds: ['a', 'b', 'c'], winnerId: 'a', hands: { b: 25, c: 50 } });
  assert.deepEqual(pts, { a: 75, b: 0, c: 0 });
});

test('lowball: hand points count against the holder, the winner takes nothing', () => {
  const pts = L.roundPoints('lowball', { playerIds: ['a', 'b', 'c'], winnerId: 'a', hands: { a: 99, b: 12, c: '7' } });
  assert.deepEqual(pts, { a: 0, b: 12, c: 7 });
});

test('freestyle: points are taken as typed, blanks are zero', () => {
  const pts = L.roundPoints('freestyle', { playerIds: ['a', 'b', 'c'], points: { a: 10, b: -5 } });
  assert.deepEqual(pts, { a: 10, b: -5, c: 0 });
});

test('players sitting out a round get nothing', () => {
  const pts = L.roundPoints('classic', { playerIds: ['a', 'b'], winnerId: 'b', hands: { a: 30, c: 80 } });
  assert.deepEqual(pts, { a: 0, b: 30 });
});

test('standings rank high scores first in classic and low scores first in lowball', () => {
  const rounds = [
    { winnerId: 'a', hands: { b: 40, c: 10 } },
    { winnerId: 'b', hands: { a: 5, c: 20 } },
  ];
  assert.deepEqual(L.standings(game('classic', 500, rounds)).map((r) => r.id), ['a', 'b', 'c']);
  // lowball totals: a 5, b 40, c 30
  assert.deepEqual(L.standings(game('lowball', 500, rounds)).map((r) => r.id), ['a', 'c', 'b']);
});

test('ties share a rank', () => {
  const g = game('classic', 500, [{ winnerId: 'a', hands: { b: 10, c: 0 } }, { winnerId: 'b', hands: { a: 0, c: 10 } }]);
  const st = L.standings(g);
  assert.equal(st[0].rank, 1);
  assert.equal(st[1].rank, 1);
  assert.equal(st[2].rank, 3);
});

test('game ends when anyone reaches the target', () => {
  const g = game('classic', 100, [{ winnerId: 'c', hands: { a: 60, b: 50 } }]);
  assert.deepEqual(L.checkOver(g), { over: true, winnerId: 'c' });
  const lb = game('lowball', 100, [{ winnerId: 'c', hands: { a: 120, b: 50 } }]);
  assert.deepEqual(L.checkOver(lb), { over: true, winnerId: 'c' });
  assert.equal(L.checkOver(game('classic', 500, [{ winnerId: 'a', hands: { b: 1 } }])).over, false);
});

test('streaks count consecutive round wins', () => {
  const g = game('classic', 999, [
    { winnerId: 'a', hands: {} },
    { winnerId: 'b', hands: {} },
    { winnerId: 'b', hands: {} },
    { winnerId: 'b', hands: {} },
  ]);
  assert.equal(L.currentStreak(g, 'b'), 3);
  assert.equal(L.longestStreak(g, 'a'), 1);
  assert.equal(L.roundsSinceWin(g, 'a'), 3);
});

test('commentary always returns short strings with player names filled in', () => {
  const g = game('classic', 500, [
    { winnerId: 'a', hands: { b: 120, c: 10 } },
    { winnerId: 'b', hands: { a: 5, c: 90 } },
    { winnerId: 'b', hands: { a: 200, c: 9 } },
  ]);
  for (let i = 0; i < g.rounds.length; i++) {
    const lines = L.commentary(g, i, { a: 'Ann', b: 'Bo', c: 'Cy' }, () => 0.3);
    assert.ok(lines.length >= 1 && lines.length <= 3);
    lines.forEach((l) => assert.doesNotMatch(l, /\{\w+\}/));
  }
});

test('all-time stats and awards', () => {
  const g = game('classic', 100, [{ winnerId: 'a', hands: { b: 70, c: 40 } }]);
  g.status = 'finished';
  g.winnerId = 'a';
  const state = { players: ['a', 'b', 'c'].map((id) => ({ id, name: id })), games: [g] };
  const s = L.playerStats(state);
  assert.equal(s.a.wins, 1);
  assert.equal(s.a.bestHaul, 110);
  assert.equal(s.b.avgHand, 70);
  const h = L.headToHead(state);
  assert.equal(h.a.b, 1);
  assert.equal(h.b.a, 0);
  assert.ok(L.awards(state).find((x) => x.key === 'champ' && x.winnerId === 'a'));
});
