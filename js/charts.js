/* Uno Tracker — the score race chart (Chart.js), colored from the page's theme tokens. */
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

  function destroyAll() {
    while (live.length) live.pop().destroy();
  }

  /** Running total per player after every round, with the target as a dashed line. */
  function race(canvas, game, byId) {
    if (!window.Chart || !canvas) return null;
    const L = window.UnoLogic;
    const fg = css('--fg');
    const muted = css('--muted');
    const line = css('--line');
    const font = css('--f-body') || 'system-ui';
    const labels = ['Start', ...game.rounds.map((_, i) => `R${i + 1}`)];
    const datasets = game.playerIds.map((id) => {
      const p = byId[id];
      const c = colorOf(p);
      const data = labels.map((_, i) => L.totalsAfter(game, i)[id]);
      return {
        label: p ? `${p.emoji} ${p.name}` : '?',
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
        label: L.higherWins(game) ? 'Target' : 'Limit',
        data: labels.map(() => game.target),
        borderColor: muted,
        backgroundColor: muted,
        borderDash: [6, 6],
        borderWidth: 1.5,
        pointRadius: 0,
      });
    }
    const ticks = { color: muted, font: { family: font, weight: '700' } };
    const chart = new window.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
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
          x: { ticks, grid: { color: line }, border: { color: line } },
          y: { ticks, grid: { color: line }, border: { display: false }, beginAtZero: true, suggestedMax: game.target || undefined },
        },
      },
    });
    live.push(chart);
    return chart;
  }

  window.UnoCharts = { available: () => !!window.Chart, colorOf, race, destroyAll };
})();
