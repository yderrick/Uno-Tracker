/* Uno Tracker — Chart.js wrappers, colored from the page's theme tokens. */
(function () {
  'use strict';

  const PALETTE = {
    red: '#e8212e',
    yellow: '#f2b400',
    green: '#19a54a',
    blue: '#0a6fd8',
    orange: '#f2711c',
    purple: '#7b3fd0',
    pink: '#e8418f',
    teal: '#0f9e95',
    ink: '#6d6590',
  };
  const live = [];

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colorOf = (p) => PALETTE[(p && p.color) || 'ink'] || PALETTE.ink;
  const alpha = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const label = (p) => (p ? `${p.emoji} ${p.name}` : '?');
  const L = () => window.UnoLogic;

  function base() {
    const fg = css('--fg');
    const muted = css('--muted');
    const line = css('--line');
    const font = css('--f-body') || 'system-ui';
    const ticks = { color: muted, font: { family: font, weight: '700' } };
    return {
      fg,
      muted,
      line,
      font,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.UnoFX && window.UnoFX.reduced() ? false : { duration: 600 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: fg, font: { family: font, weight: '700' }, usePointStyle: true, boxWidth: 8 } },
          tooltip: { backgroundColor: '#16121f', padding: 10, cornerRadius: 10, usePointStyle: true, titleFont: { family: font }, bodyFont: { family: font } },
        },
        scales: {
          x: { ticks: { ...ticks }, grid: { color: line }, border: { color: line } },
          y: { ticks: { ...ticks }, grid: { color: line }, border: { display: false } },
        },
      },
    };
  }

  function make(canvas, config) {
    if (!window.Chart || !canvas) return null;
    const c = new window.Chart(canvas.getContext('2d'), config);
    live.push(c);
    return c;
  }

  function destroyAll() {
    while (live.length) live.pop().destroy();
  }

  /** Running total per player after every round, with the target as a dashed line. */
  function race(canvas, game, byId) {
    const b = base();
    const labels = ['Start', ...game.rounds.map((_, i) => `R${i + 1}`)];
    const datasets = game.playerIds.map((id) => {
      const c = colorOf(byId[id]);
      const data = labels.map((_, i) => L().totalsAfter(game, i)[id]);
      return {
        label: label(byId[id]),
        data,
        borderColor: c,
        backgroundColor: c,
        pointRadius: data.map((_, i) => (i === data.length - 1 ? 6 : 2.5)),
        pointHoverRadius: 7,
        borderWidth: 3,
        cubicInterpolationMode: 'monotone',
      };
    });
    if (game.target) {
      datasets.push({
        label: L().higherWins(game) ? 'Target' : 'Limit',
        data: labels.map(() => game.target),
        borderColor: b.muted,
        backgroundColor: b.muted,
        borderDash: [6, 6],
        borderWidth: 1.5,
        pointRadius: 0,
      });
    }
    const opt = b.options;
    opt.scales.y.beginAtZero = true;
    opt.scales.y.ticks.precision = 0;
    // Only stretch the axis to the target when the race gets anywhere near it.
    const top = Math.max(0, ...game.playerIds.map((id) => L().totals(game)[id]));
    if (game.target && top >= game.target * 0.4) opt.scales.y.suggestedMax = game.target;
    else if (game.target) datasets.pop();
    return make(canvas, { type: 'line', data: { labels, datasets }, options: opt });
  }

  /** Rank after each round (1 at the top). */
  function bump(canvas, game, byId) {
    const b = base();
    const labels = game.rounds.map((_, i) => `R${i + 1}`);
    const n = game.playerIds.length;
    const datasets = game.playerIds.map((id) => {
      const c = colorOf(byId[id]);
      return {
        label: label(byId[id]),
        data: labels.map((_, i) => L().standingsAfter(game, i + 1).find((s) => s.id === id).rank),
        borderColor: c,
        backgroundColor: c,
        pointRadius: 5,
        pointHoverRadius: 8,
        borderWidth: 4,
        cubicInterpolationMode: 'monotone',
      };
    });
    const opt = b.options;
    opt.scales.y.reverse = true;
    opt.scales.y.min = 0.5;
    opt.scales.y.max = n + 0.5;
    opt.scales.y.afterBuildTicks = (axis) => (axis.ticks = Array.from({ length: n }, (_, i) => ({ value: i + 1 })));
    opt.scales.y.ticks.callback = (v) => `#${v}`;
    opt.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: #${ctx.parsed.y}` };
    return make(canvas, { type: 'line', data: { labels, datasets }, options: opt });
  }

  /** Points scored in each round, stacked. */
  function perRound(canvas, game, byId) {
    const b = base();
    const labels = game.rounds.map((_, i) => `R${i + 1}`);
    const datasets = game.playerIds.map((id) => ({
      label: label(byId[id]),
      data: game.rounds.map((r) => (r.points && r.points[id]) || 0),
      backgroundColor: colorOf(byId[id]),
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 46,
    }));
    const opt = b.options;
    opt.scales.x.stacked = true;
    opt.scales.y.stacked = true;
    opt.scales.x.grid.display = false;
    opt.scales.y.ticks.precision = 0;
    return make(canvas, { type: 'bar', data: { labels, datasets }, options: opt });
  }

  /** Share of rounds won. */
  function share(canvas, game, byId) {
    const b = base();
    const won = {};
    game.rounds.forEach((r) => r.winnerId && (won[r.winnerId] = (won[r.winnerId] || 0) + 1));
    const ids = game.playerIds.filter((id) => won[id]);
    const opt = b.options;
    delete opt.scales;
    opt.cutout = '58%';
    opt.plugins.legend.position = 'right';
    opt.interaction = { mode: 'nearest', intersect: true };
    return make(canvas, {
      type: 'doughnut',
      data: {
        labels: ids.map((id) => label(byId[id])),
        datasets: [{ data: ids.map((id) => won[id]), backgroundColor: ids.map((id) => colorOf(byId[id])), borderColor: css('--surface'), borderWidth: 4, hoverOffset: 14 }],
      },
      options: opt,
    });
  }

  /** Player DNA radar: each axis scaled 0–100 across the players being compared. */
  function radar(canvas, statList, byId) {
    const b = base();
    const axes = [
      ['Win rate', (s) => s.winRate],
      ['Round wins', (s) => s.roundWinRate],
      ['Big rounds', (s) => s.bestRound],
      ['Streaks', (s) => s.longestStreak],
      ['Consistency', (s) => (s.highScores.length >= 2 ? -s.spread : null)],
      ['Experience', (s) => s.rounds],
    ];
    const norm = axes.map(([, fn]) => {
      const vals = statList.map(fn).filter((v) => v !== null);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      return (s) => {
        const v = fn(s);
        if (v === null || !vals.length) return 0;
        return hi === lo ? 70 : Math.round(15 + ((v - lo) / (hi - lo)) * 85);
      };
    });
    const datasets = statList.map((s) => {
      const c = colorOf(byId[s.id]);
      return { label: label(byId[s.id]), data: norm.map((f) => f(s)), borderColor: c, backgroundColor: alpha(c, 0.18), pointBackgroundColor: c, borderWidth: 2.5 };
    });
    const opt = b.options;
    opt.interaction = { mode: 'nearest', intersect: false };
    opt.scales = {
      r: {
        min: 0,
        max: 100,
        ticks: { display: false, stepSize: 25 },
        grid: { color: b.line },
        angleLines: { color: b.line },
        pointLabels: { color: b.fg, font: { family: b.font, weight: '800', size: 12 } },
      },
    };
    opt.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.r}/100` };
    return make(canvas, { type: 'radar', data: { labels: axes.map((a) => a[0]), datasets }, options: opt });
  }

  /** Games won vs played per player. */
  function wins(canvas, statList, byId) {
    const b = base();
    const sorted = [...statList].sort((a, z) => z.wins - a.wins || z.finished - a.finished);
    const opt = b.options;
    opt.indexAxis = 'y';
    opt.scales.x.beginAtZero = true;
    opt.scales.x.ticks.precision = 0;
    opt.scales.y.grid.display = false;
    opt.scales.y.ticks.color = b.fg;
    return make(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map((s) => label(byId[s.id])),
        datasets: [
          { label: 'Games won', data: sorted.map((s) => s.wins), backgroundColor: sorted.map((s) => colorOf(byId[s.id])), borderRadius: 8, maxBarThickness: 26 },
          { label: 'Games finished', data: sorted.map((s) => s.finished), backgroundColor: alpha('#8a83ad', 0.3), borderRadius: 8, maxBarThickness: 26 },
        ],
      },
      options: opt,
    });
  }

  window.UnoCharts = { available: () => !!window.Chart, colorOf, race, bump, perRound, share, radar, wins, destroyAll };
})();
