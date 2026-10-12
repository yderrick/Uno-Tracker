/* Uno Tracker — Chart.js wrappers that read colors from the page's theme tokens. */
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

  function base() {
    const fg = css('--fg');
    const muted = css('--muted');
    const line = css('--line');
    const font = css('--f-body') || 'system-ui';
    return {
      fg,
      muted,
      line,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.UnoFX && window.UnoFX.reduced() ? false : { duration: 700, easing: 'easeOutBack' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: fg, font: { family: font, weight: '700' }, usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            backgroundColor: '#16121f',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 10,
            cornerRadius: 10,
            titleFont: { family: font, weight: '800' },
            bodyFont: { family: font, weight: '600' },
            usePointStyle: true,
          },
        },
        scales: {
          x: { ticks: { color: muted, font: { family: font, weight: '700' } }, grid: { color: line, drawTicks: false }, border: { color: line } },
          y: { ticks: { color: muted, font: { family: font, weight: '700' } }, grid: { color: line, drawTicks: false }, border: { display: false } },
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

  const L = () => window.UnoLogic;

  /** Cumulative score per player across rounds, with the target as a dashed line. */
  function race(canvas, game, byId) {
    const b = base();
    const labels = ['Start', ...game.rounds.map((_, i) => `R${i + 1}`)];
    const datasets = game.playerIds.map((id) => {
      const p = byId[id];
      const c = colorOf(p);
      const data = labels.map((_, i) => L().totalsAfter(game, i)[id]);
      return {
        label: p ? `${p.emoji} ${p.name}` : '?',
        data,
        borderColor: c,
        backgroundColor: alpha(c, 0.12),
        pointBackgroundColor: c,
        pointRadius: data.map((_, i) => (i === data.length - 1 ? 6 : 2.5)),
        pointHoverRadius: 7,
        borderWidth: 3,
        cubicInterpolationMode: 'monotone',
        fill: false,
      };
    });
    datasets.push({
      label: game.mode === 'lowball' ? 'Limit' : 'Target',
      data: labels.map(() => game.target),
      borderColor: b.muted,
      borderDash: [6, 6],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
    });
    const opt = b.options;
    opt.scales.y.beginAtZero = true;
    opt.scales.y.suggestedMax = game.target;
    return make(canvas, { type: 'line', data: { labels, datasets }, options: opt });
  }

  /** Rank after each round (1 at the top). */
  function bump(canvas, game, byId) {
    const b = base();
    const labels = game.rounds.map((_, i) => `R${i + 1}`);
    const datasets = game.playerIds.map((id) => {
      const p = byId[id];
      const c = colorOf(p);
      return {
        label: p ? `${p.emoji} ${p.name}` : '?',
        data: labels.map((_, i) => L().standingsAfter(game, i + 1).find((s) => s.id === id).rank),
        borderColor: c,
        backgroundColor: c,
        pointRadius: 5,
        pointHoverRadius: 8,
        borderWidth: 4,
        cubicInterpolationMode: 'monotone',
        stepped: false,
      };
    });
    const opt = b.options;
    opt.scales.y.reverse = true;
    opt.scales.y.min = 0.5;
    opt.scales.y.max = game.playerIds.length + 0.5;
    const n = game.playerIds.length;
    opt.scales.y.afterBuildTicks = (axis) => (axis.ticks = Array.from({ length: n }, (_, i) => ({ value: i + 1 })));
    opt.scales.y.ticks.callback = (v) => `#${v}`;
    opt.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: #${ctx.parsed.y}` };
    return make(canvas, { type: 'line', data: { labels, datasets }, options: opt });
  }

  /** Points scored (or taken) in each round, stacked. */
  function perRound(canvas, game, byId) {
    const b = base();
    const labels = game.rounds.map((_, i) => `R${i + 1}`);
    const datasets = game.playerIds.map((id) => {
      const p = byId[id];
      const c = colorOf(p);
      return {
        label: p ? `${p.emoji} ${p.name}` : '?',
        data: game.rounds.map((r) => (r.points && r.points[id]) || 0),
        backgroundColor: c,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 46,
      };
    });
    const opt = b.options;
    opt.scales.x.stacked = true;
    opt.scales.y.stacked = true;
    opt.scales.x.grid.display = false;
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
        labels: ids.map((id) => (byId[id] ? `${byId[id].emoji} ${byId[id].name}` : '?')),
        datasets: [{ data: ids.map((id) => won[id]), backgroundColor: ids.map((id) => colorOf(byId[id])), borderColor: css('--surface'), borderWidth: 4, hoverOffset: 14 }],
      },
      options: opt,
    });
  }

  /** Player DNA radar: each axis normalised 0–100 across the compared players. */
  function radar(canvas, statList, byId) {
    const b = base();
    const axes = [
      ['Win rate', (s) => s.winRate],
      ['Round wins', (s) => s.roundWinRate],
      ['Big hauls', (s) => s.bestHaul],
      ['Clean hands', (s) => (s.handRounds ? -s.avgHand : null)],
      ['Streaks', (s) => s.longestStreak],
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
      const p = byId[s.id];
      const c = colorOf(p);
      return {
        label: p ? `${p.emoji} ${p.name}` : '?',
        data: norm.map((f) => f(s)),
        borderColor: c,
        backgroundColor: alpha(c, 0.18),
        pointBackgroundColor: c,
        borderWidth: 2.5,
      };
    });
    const opt = b.options;
    delete opt.scales;
    opt.interaction = { mode: 'nearest', intersect: false };
    opt.scales = {
      r: {
        min: 0,
        max: 100,
        ticks: { display: false, stepSize: 25 },
        grid: { color: b.line },
        angleLines: { color: b.line },
        pointLabels: { color: b.fg, font: { family: css('--f-body'), weight: '800', size: 12 } },
      },
    };
    opt.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.r}/100` };
    return make(canvas, { type: 'radar', data: { labels: axes.map((a) => a[0]), datasets }, options: opt });
  }

  /** Games won vs played per player, horizontal. */
  function wins(canvas, statList, byId) {
    const b = base();
    const sorted = [...statList].sort((a, z) => z.wins - a.wins || z.finished - a.finished);
    const opt = b.options;
    opt.indexAxis = 'y';
    opt.scales.x.beginAtZero = true;
    opt.scales.x.ticks.stepSize = 1;
    opt.scales.y.grid.display = false;
    opt.scales.y.ticks.color = b.fg;
    return make(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map((s) => (byId[s.id] ? `${byId[s.id].emoji} ${byId[s.id].name}` : '?')),
        datasets: [
          { label: 'Games won', data: sorted.map((s) => s.wins), backgroundColor: sorted.map((s) => colorOf(byId[s.id])), borderRadius: 8, maxBarThickness: 26 },
          { label: 'Games played', data: sorted.map((s) => s.finished), backgroundColor: alpha('#8a83ad', 0.25), borderRadius: 8, maxBarThickness: 26 },
        ],
      },
      options: opt,
    });
  }

  window.UnoCharts = { available: () => !!window.Chart, colorOf, race, bump, perRound, share, radar, wins, destroyAll, PALETTE };
})();
