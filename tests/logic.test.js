// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

/** Build a game from plain score rows, e.g. [{a: 10, b: 0, c: 5}, ...]. */
function game(mode, target, rows, playerIds = ['a', 'b', 'c']) {
  const g = { id: 'g', mode, target, playerIds, rounds: [] };
  rows.forEach((points, i) => g.rounds.push({ id: 'r' + i, points, winnerId: L.roundWinner(g, points) }));
  return g;
}

test('totals add up the typed scores, blanks and sit-outs count as nothing', () => {
  const g = game('high', 500, [{ a: 10, b: 0, c: 5 }, { a: 7, b: 30 }]);
  assert.deepEqual(L.totals(g), { a: 17, b: 30, c: 5 });
});

test('round winner is the unique best score for the game’s rule', () => {
  const hi = { mode: 'high' };
  const lo = { mode: 'low' };
  assert.equal(L.roundWinner(hi, { a: 10, b: 40, c: 5 }), 'b');
  assert.equal(L.roundWinner(lo, { a: 10, b: 40, c: 5 }), 'c');
  assert.equal(L.roundWinner(hi, { a: 40, b: 40, c: 5 }), null, 'tie for best');
  assert.equal(L.roundWinner(hi, { a: 0, b: 0, c: 0 }), null, 'nobody scored');
  assert.equal(L.roundWinner(lo, { a: 0, b: 12, c: 9 }), 'a');
});

test('standings rank high scores first, or low scores first when lowest wins', () => {
  const rows = [{ a: 30, b: 10, c: 20 }];
  assert.deepEqual(L.standings(game('high', null, rows)).map((r) => r.id), ['a', 'c', 'b']);
  assert.deepEqual(L.standings(game('low', null, rows)).map((r) => r.id), ['b', 'c', 'a']);
});

test('ties share a rank', () => {
  const st = L.standings(game('high', null, [{ a: 10, b: 10, c: 0 }]));
  assert.deepEqual(st.map((r) => r.rank), [1, 1, 3]);
});

test('a game ends when anyone reaches the target, never when there is no target', () => {
  assert.deepEqual(L.checkOver(game('high', 100, [{ a: 60, b: 101, c: 0 }])), { over: true, winnerId: 'b' });
  assert.deepEqual(L.checkOver(game('low', 100, [{ a: 120, b: 50, c: 30 }])), { over: true, winnerId: 'c' });
  assert.equal(L.checkOver(game('high', null, [{ a: 9999, b: 0 }])).over, false);
  assert.equal(L.checkOver(game('high', 500, [{ a: 10, b: 0 }])).over, false);
});

test('older saves map onto the simple model', () => {
  assert.equal(L.normaliseGame({ mode: 'classic', target: 500 }).mode, 'high');
  assert.equal(L.normaliseGame({ mode: 'freestyle' }).mode, 'high');
  assert.equal(L.normaliseGame({ mode: 'lowball', target: '200' }).mode, 'low');
  assert.equal(L.normaliseGame({ mode: 'high', target: 0 }).target, null);
});

test('streaks count consecutive round wins', () => {
  const g = game('high', null, [{ a: 9, b: 1 }, { a: 1, b: 9 }, { a: 1, b: 9 }, { a: 1, b: 9 }], ['a', 'b']);
  assert.equal(L.currentStreak(g, 'b'), 3);
  assert.equal(L.longestStreak(g, 'a'), 1);
  assert.equal(L.roundsSinceWin(g, 'a'), 3);
});

test('commentary returns 1–3 lines with names filled in', () => {
  const g = game('high', 300, [{ a: 120, b: 0, c: 10 }, { a: 5, b: 90, c: 0 }, { a: 0, b: 200, c: 9 }]);
  for (let i = 0; i < g.rounds.length; i++) {
    const lines = L.commentary(g, i, { a: 'Ann', b: 'Bo', c: 'Cy' }, () => 0.3);
    assert.ok(lines.length >= 1 && lines.length <= 3);
    lines.forEach((l) => assert.doesNotMatch(l, /\{\w+\}|undefined/));
  }
});

test('all-time stats and awards', () => {
  const g = game('high', 100, [{ a: 110, b: 20, c: 40 }]);
  g.status = 'finished';
  g.winnerId = 'a';
  const state = { players: ['a', 'b', 'c'].map((id) => ({ id, name: id })), games: [g] };
  const s = L.playerStats(state);
  assert.equal(s.a.wins, 1);
  assert.equal(s.a.bestRound, 110);
  assert.equal(s.c.seconds, 1);
  assert.ok(L.awards(state).find((x) => x.key === 'champ' && x.winnerId === 'a'));
});

test('the single-file page keeps scores inside a script tag safely', () => {
  const Page = require('../js/page.js');
  const data = { players: [{ id: 'p', name: '</script><img src=x onerror=alert(1)>' }], games: [] };
  const html = Page.documentHtml({ css: 'body{}', js: 'void 0', data });
  assert.ok(html.startsWith('<!doctype html><html><head><meta charset=utf8>'));
  const json = html.match(/id="uno-data">([^]*?)<\/script>/)[1];
  assert.doesNotMatch(json, /</);
  assert.deepEqual(JSON.parse(json), data);
});
