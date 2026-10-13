/* Uno Tracker — views, interactions and glue. */
(function () {
  'use strict';

  const L = window.UnoLogic;
  const S = window.UnoStore;
  const FX = window.UnoFX;
  const C = window.UnoCharts;

  const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'teal'];
  const EMOJIS = ['🦊', '🐸', '🐼', '🦄', '🐙', '🐯', '🐵', '🦖', '🐧', '🐝', '🌻', '🍕', '🌮', '👾', '🤖', '🎃', '🐳', '🦉', '🐲', '🦩', '🍄', '⭐', '🔥', '🎸'];
  const GAME_NAMES = [
    'Friday Night Showdown',
    'The Draw Four Dispute',
    'Reverse Psychology',
    'Skip Day',
    'Wild Card Wednesday',
    'Color Wars',
    'The Great Shuffle',
    'Plus Four and Proud',
    'Red Alert',
    'Last Card Standing',
    'The Kitchen Table Open',
    'Blue Monday Mayhem',
    'Sore Loser Invitational',
    'Grudge Match',
    'Revenge of the Reverse',
  ];

  let state = S.load() || window.UnoDemo.build(L);
  let view = 'play';
  let draft = null; // { gameId, editingId, points }
  let setup = null; // { sel: Set, mode, target, name, open }
  let statsGameId = null;
  let justScored = null;
  let dealtFor = null;
  let sample = null;
  let downloads = null;

  /* ------------------------------------------------------------------ helpers */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const byId = () => Object.fromEntries(state.players.map((p) => [p.id, p]));
  const names = () => Object.fromEntries(state.players.map((p) => [p.id, p.name]));
  const findGame = (id) => state.games.find((g) => g.id === id) || null;
  const currentGame = () => findGame(state.activeGameId);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const listJoin = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const ruleText = (g) => `${L.higherWins(g) ? 'Highest' : 'Lowest'} score wins${g.target ? ` · ${L.higherWins(g) ? 'first to' : 'ends at'} ${g.target}` : ''}`;
  const isEditing = (g) => !!(g && draft && draft.gameId === g.id && draft.editingId);

  function ago(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const avatar = (p, cls = '') => `<span class="avatar pc-${esc((p && p.color) || 'ink')} ${cls}">${esc((p && p.emoji) || '❔')}</span>`;

  function commit(mutate, opts = {}) {
    mutate(state);
    if (!S.save(state)) toast('Could not save on this device. Use Back up to keep a copy.');
    if (opts.render !== false) render();
  }

  function newPlayer(name) {
    const used = state.players.map((p) => p.color);
    const color = COLORS.find((c) => !used.includes(c)) || COLORS[state.players.length % COLORS.length];
    const free = EMOJIS.filter((e) => !state.players.some((p) => p.emoji === e));
    return { id: uid(), name: name.slice(0, 24), emoji: pick(free.length ? free : EMOJIS), color, createdAt: Date.now() };
  }

  function freshName() {
    const used = new Set(state.games.map((g) => g.name));
    const fresh = GAME_NAMES.filter((n) => !used.has(n));
    return pick(fresh.length ? fresh : GAME_NAMES);
  }

  /* ------------------------------------------------------------------- toasts */
  function toast(msg, action) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', () => {
        action.run();
        el.remove();
      });
      el.appendChild(b);
    }
    root.appendChild(el);
    while (root.children.length > 2) root.firstElementChild.remove();
    setTimeout(() => el.remove(), action ? 7000 : 3000);
  }

  /* ------------------------------------------------------------------- modals */
  let modalCleanup = null;
  function openModal(html, { onMount, label = 'Dialog' } = {}) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div></div>`;
    const back = $('[data-modal-backdrop]', root);
    back.addEventListener('mousedown', (e) => e.target === back && closeModal());
    const onKey = (e) => e.key === 'Escape' && closeModal();
    document.addEventListener('keydown', onKey);
    modalCleanup = () => document.removeEventListener('keydown', onKey);
    const modal = $('.modal', root);
    if (onMount) onMount(modal);
    const f = $('[autofocus]', modal) || $('input, button:not(.modal-close)', modal);
    f && f.focus();
    return modal;
  }
  function closeModal() {
    $('#modal-root').innerHTML = '';
    modalCleanup && modalCleanup();
    modalCleanup = null;
  }
  const modalHead = (title, sub) =>
    `<div class="modal-head"><div><h2>${title}</h2>${sub ? `<p class="muted" style="margin-top:6px">${sub}</p>` : ''}</div><button type="button" class="modal-close" data-action="close-modal" aria-label="Close">✕</button></div>`;

  function confirmModal({ title, body, ok = 'Confirm', okClass = 'btn-red', onOk }) {
    openModal(
      `${modalHead(esc(title))}<p>${body}</p><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="button" class="btn ${okClass}" id="confirm-ok">${esc(ok)}</button></div>`,
      {
        label: title,
        onMount: (m) =>
          $('#confirm-ok', m).addEventListener('click', () => {
            closeModal();
            onOk();
          }),
      }
    );
  }

  /* =================================================================== render */
  function render() {
    C.destroyAll();
    $$('.tab').forEach((t) => (t.dataset.view === view ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
    $('#demo-banner').hidden = !state.isDemo;
    renderSync();
    const views = { play: renderPlay, stats: renderStats, players: renderPlayers };
    $('#view').innerHTML = (views[view] || renderPlay)();
    const after = { play: afterPlay, stats: afterStats, players: afterPlayers }[view];
    after && after();
    justScored = null;
  }

  function renderSync() {
    const chip = $('#sync-chip');
    chip.classList.toggle('is-cloud', S.mode === 'cloud');
    chip.classList.toggle('is-readonly', S.mode === 'readonly');
    chip.textContent = S.mode === 'cloud' ? '● Live sync on' : S.mode === 'readonly' ? 'View only' : 'Saved on this device';
    $('#mute-btn').textContent = FX.muted ? '🔇' : '🔊';
  }

  /* ---------------------------------------------------------------- GAME TAB */
  function renderPlay() {
    const g = currentGame();
    return g ? renderGame(g) : renderSetup();
  }

  function ensureSetup() {
    if (setup) return setup;
    const last = [...state.games].sort((a, b) => b.createdAt - a.createdAt)[0];
    const P = byId();
    setup = {
      sel: new Set(last ? last.playerIds.filter((id) => P[id]) : []),
      mode: last ? last.mode : 'high',
      target: last ? last.target : 500,
      name: freshName(),
      open: false,
    };
    return setup;
  }

  /* New game: tap who's playing. */
  function renderSetup() {
    const s = ensureSetup();
    const roster = [...state.players].sort((a, b) => a.name.localeCompare(b.name));
    const chips = roster
      .map(
        (p) =>
          `<button type="button" class="pick pc-${esc(p.color)}" data-action="toggle-pick" data-pid="${esc(p.id)}" aria-pressed="${s.sel.has(p.id)}">${avatar(p, 'avatar-lg')}<span class="pick-name">${esc(p.name)}</span><span class="pick-check" aria-hidden="true">✓</span></button>`
      )
      .join('');
    const n = s.sel.size;
    return `
      <section class="game-head"><div class="game-title"><span class="eyebrow">New game</span><h1>Who’s playing?</h1><p class="muted">Tap the players at the table. New players are saved for next time.</p></div></section>
      <section class="panel setup">
        <div class="picks">${chips || '<p class="muted">No players yet. Add the first one below.</p>'}</div>
        <form class="add-inline" id="setup-add">
          <input type="text" id="setup-new" class="text-input" placeholder="Add a new player" maxlength="24" aria-label="New player name" autocomplete="off">
          <button type="submit" class="btn btn-ink">Add</button>
        </form>
        <details class="options" id="setup-options" ${s.open ? 'open' : ''}>
          <summary>Options <span class="muted">· ${esc(ruleText(s))}</span></summary>
          <div class="options-body">
            <label class="field"><span>Game name</span><input type="text" id="setup-name" class="text-input" value="${esc(s.name)}" maxlength="60"></label>
            <div class="field"><span>Who wins?</span><div class="seg" role="group" aria-label="Who wins">
              <button type="button" data-action="set-mode" data-mode="high" aria-pressed="${s.mode === 'high'}">Highest score</button>
              <button type="button" data-action="set-mode" data-mode="low" aria-pressed="${s.mode === 'low'}">Lowest score</button></div></div>
            <div class="field"><span>Game ends at</span><div class="seg" role="group" aria-label="Game ends at">${[100, 250, 500, null]
              .map((t) => `<button type="button" data-action="set-target" data-target="${t || ''}" aria-pressed="${s.target === t}">${t || 'No limit'}</button>`)
              .join('')}</div></div>
          </div>
        </details>
        <div class="setup-go">
          <span class="muted">${n ? `${plural(n, 'player')} selected` : 'Pick at least 2 players'}</span>
          <button type="button" class="btn btn-red btn-big" data-action="start-game" ${n < 2 ? 'disabled' : ''}>Start game</button>
        </div>
      </section>`;
  }

  function startGame(playerIds, opts) {
    const g = {
      id: uid(),
      name: opts.name || freshName(),
      mode: opts.mode || 'high',
      target: opts.target || null,
      playerIds,
      rounds: [],
      status: 'active',
      createdAt: Date.now(),
      winnerId: null,
    };
    setup = null;
    draft = null;
    dealtFor = null;
    view = 'play';
    commit((st) => {
      st.games.push(g);
      st.activeGameId = g.id;
    });
    FX.sound('uno');
    FX.confetti({ count: 80, spread: 0.7 });
    window.scrollTo({ top: 0 });
    const first = $('#entry-panel input[data-pid]');
    first && first.focus({ preventScroll: true });
  }

  function renderGame(g) {
    const st = L.standings(g);
    const P = byId();
    const finished = g.status === 'finished';
    const deal = dealtFor !== g.id;
    dealtFor = g.id;
    const last = g.rounds[g.rounds.length - 1];
    const topTie = st.length > 1 && st[0].total === st[1].total;

    const cards = st
      .map((row, i) => {
        const p = P[row.id];
        const pct = g.target ? Math.max(0, Math.min(100, (row.total / g.target) * 100)) : 0;
        const md = L.mood(g, row.id);
        const delta = last && last.points ? last.points[row.id] : 0;
        const fresh = justScored && justScored[row.id] != null;
        const lead = row.rank === 1 && g.rounds.length && !topTie;
        return `<article class="pcard pc-${esc(p ? p.color : 'ink')} ${lead ? 'is-leader' : ''}" style="--i:${i};${deal ? '' : 'animation:none'}" data-pid="${esc(row.id)}">
          ${lead ? `<span class="pcard-crown" aria-hidden="true">${finished ? '🏆' : '👑'}</span>` : ''}
          <div class="pcard-top"><span class="pcard-name" title="${esc(p && p.name)}">${esc(p ? p.name : '?')}</span><span class="pcard-rank" title="Rank">${row.rank}</span></div>
          <div class="pcard-oval"><div class="pcard-oval-inner"><span class="pcard-emoji">${esc(p ? p.emoji : '❔')}</span><span class="pcard-score ${fresh ? 'bump' : ''}">${row.total}</span></div></div>
          ${g.target ? `<div class="pcard-bar" title="${Math.round(pct)}% of ${g.target}"><i style="width:${pct}%"></i></div>` : ''}
          <span class="pcard-mood">${md.icon} ${esc(md.text)}</span>
          ${delta ? `<span class="pcard-delta ${fresh ? 'flash' : ''}">${delta > 0 ? '+' : ''}${delta}</span>` : ''}
        </article>`;
      })
      .join('');

    return `
      <section class="game-head">
        <div class="game-title">
          <span class="eyebrow">${finished ? 'Final scores' : `Round ${g.rounds.length + 1}`}</span>
          <h1>${esc(g.name)}</h1>
          <div class="game-meta">
            ${finished ? `<span class="pill pill-done">🏆 ${esc(P[g.winnerId] ? P[g.winnerId].name : '')} won</span>` : '<span class="pill pill-live">Live</span>'}
            <span class="pill">${esc(ruleText(g))}</span>
          </div>
        </div>
        <div class="btn-row">
          ${
            finished
              ? `<button type="button" class="btn btn-ghost" data-action="new-game">New game</button>`
              : `<button type="button" class="btn btn-ghost btn-small" data-action="add-to-game">+ Player</button>
                 <button type="button" class="btn btn-ink btn-small" data-action="finish-game" ${g.rounds.length ? '' : 'disabled'}>Finish game</button>`
          }
        </div>
      </section>
      <section class="board" aria-label="Scoreboard">${cards}</section>
      <div class="grid-2">
        <section class="panel" id="entry-panel">${!finished || isEditing(g) ? renderEntry(g) : renderFinishedPanel(g)}</section>
        <section class="panel">${renderFeed(g)}</section>
      </div>
      ${g.rounds.length ? `<section class="panel">${renderScorecard(g)}</section>` : ''}`;
  }

  /* -------------------------------------------------------------- round entry */
  function ensureDraft(g) {
    if (!draft || draft.gameId !== g.id) draft = { gameId: g.id, editingId: null, points: {} };
    return draft;
  }

  function renderEntry(g) {
    const d = ensureDraft(g);
    const P = byId();
    const totals = L.totals(g);
    const editIdx = d.editingId ? g.rounds.findIndex((r) => r.id === d.editingId) : -1;
    const ids = editIdx >= 0 ? g.playerIds.filter((id) => id in (g.rounds[editIdx].points || {})) : g.playerIds;
    const rows = ids
      .map((id) => {
        const p = P[id];
        const v = d.points[id];
        return `<label class="score-row" for="pts-${esc(id)}">
          <span class="who">${avatar(p)}<span class="entry-name"><strong>${esc(p ? p.name : '?')}</strong><small class="num">${totals[id]} total</small></span></span>
          <input type="number" inputmode="numeric" step="1" id="pts-${esc(id)}" data-pid="${esc(id)}" value="${v == null ? '' : esc(v)}" placeholder="0">
        </label>`;
      })
      .join('');
    return `
      <div class="panel-head"><h2><span class="pip pip-red"></span>${editIdx >= 0 ? `Fix round ${editIdx + 1}` : `Round ${g.rounds.length + 1} scores`}</h2></div>
      <div class="score-list">${rows}</div>
      <div class="entry-summary">
        <span class="entry-hint">Blank counts as 0.</span>
        <div class="btn-row">
          ${editIdx >= 0 ? '<button type="button" class="btn btn-ghost" data-action="cancel-edit">Cancel</button>' : ''}
          <button type="button" class="btn btn-red btn-big" data-action="submit-round">${editIdx >= 0 ? 'Save' : 'Add round'}</button>
        </div>
      </div>`;
  }

  function submitRound() {
    const g = currentGame();
    if (!g || (g.status === 'finished' && !isEditing(g))) return;
    const d = ensureDraft(g);
    const editingId = d.editingId;
    const editIdx = editingId ? g.rounds.findIndex((r) => r.id === editingId) : -1;
    const ids = $$('#entry-panel input[data-pid]').map((i) => i.dataset.pid);
    if (!ids.length) return;
    const points = {};
    ids.forEach((id) => (points[id] = Math.round(Number(d.points[id]) || 0)));
    const wasFinished = g.status === 'finished';
    let nowOver = null;
    commit(
      (s) => {
        const game = s.games.find((x) => x.id === g.id);
        const round = { id: editingId || uid(), at: editIdx >= 0 ? game.rounds[editIdx].at : Date.now(), points, winnerId: L.roundWinner(game, points) };
        const idx = editIdx >= 0 ? editIdx : game.rounds.length;
        game.rounds[idx] = round;
        round.comments = L.commentary(game, idx, names());
        if (editIdx >= 0) round.comments.unshift(`Round ${idx + 1} was re-scored. The judges have spoken.`);
        const over = L.checkOver(game);
        if (over.over) {
          const same = wasFinished && game.winnerId === over.winnerId;
          game.status = 'finished';
          game.winnerId = over.winnerId;
          if (!same) {
            game.finishedAt = Date.now();
            game.endLine = L.gameOverLine(game, names());
            nowOver = game;
          }
        } else if (wasFinished && game.target) {
          game.status = 'active';
          game.winnerId = null;
          game.finishedAt = null;
          game.endLine = null;
        }
      },
      { render: false }
    );
    justScored = points;
    draft = null;
    render();
    FX.sound('round');
    const g2 = currentGame();
    const wId = g2.rounds[editIdx >= 0 ? editIdx : g2.rounds.length - 1].winnerId;
    const card = wId && $(`.pcard[data-pid="${wId}"]`);
    if (card) {
      const r = card.getBoundingClientRect();
      FX.confetti({ x: r.left + r.width / 2, y: r.top + r.height / 3, count: 40, spread: 0.6 });
    }
    if (nowOver) setTimeout(() => showGameOver(nowOver), 400);
    else toast(editingId ? 'Round updated.' : `Round ${g2.rounds.length} added.`);
  }

  function afterPlay() {
    const form = $('#setup-add');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('#setup-new');
        const nm = input.value.trim();
        if (!nm) return input.focus();
        const existing = state.players.find((p) => p.name.toLowerCase() === nm.toLowerCase());
        if (existing) {
          setup.sel.add(existing.id);
          render();
          return toast(`${existing.name} is already saved, so they’re selected.`);
        }
        const p = newPlayer(nm);
        setup.sel.add(p.id);
        commit((s) => s.players.push(p));
        FX.sound('click');
        $('#setup-new').focus();
      });
      const nameInput = $('#setup-name');
      nameInput && nameInput.addEventListener('input', () => (setup.name = nameInput.value));
      const det = $('#setup-options');
      det && det.addEventListener('toggle', () => (setup.open = det.open));
    }
    const panel = $('#entry-panel');
    if (!panel) return;
    panel.addEventListener('input', (e) => {
      const t = e.target;
      if (!t.dataset || !t.dataset.pid || !draft) return;
      draft.points[t.dataset.pid] = t.value === '' ? undefined : Number(t.value);
    });
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      const inputs = $$('input[data-pid]', panel);
      const i = inputs.indexOf(e.target);
      if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus();
      else submitRound();
    });
  }

  /* ------------------------------------------------------------------- feed */
  function renderFeed(g) {
    const P = byId();
    const items = [];
    const notesAfter = {};
    (g.aiNotes || []).forEach((n) => (notesAfter[n.after] = notesAfter[n.after] || []).push(n));
    if (g.endLine) items.push(`<div class="feed-item"><span class="feed-badge is-end">🏁</span><div class="feed-body"><p class="feed-line"><strong>${esc(g.endLine)}</strong></p></div></div>`);
    for (let i = g.rounds.length; i >= 0; i--) {
      (notesAfter[i] || [])
        .slice()
        .reverse()
        .forEach((n) =>
          items.push(`<div class="feed-item"><span class="feed-badge" style="background:var(--card-ink)">🎙</span><div class="feed-body"><p class="feed-line is-ai">${esc(n.text)}</p><span class="feed-when">Claude’s hot take</span></div></div>`)
        );
      if (i === 0) break;
      const r = g.rounds[i - 1];
      const lines = (r.comments && r.comments.length ? r.comments : [`Round ${i} is in the books.`]).map((c) => `<p class="feed-line">${esc(c)}</p>`).join('');
      items.push(`<div class="feed-item"><span class="feed-badge" style="background:${C.colorOf(P[r.winnerId])}">R${i}</span><div class="feed-body">${lines}<span class="feed-when">${esc(ago(r.at))}</span></div></div>`);
    }
    items.push(
      `<div class="feed-item"><span class="feed-badge" style="background:var(--green)">🃏</span><div class="feed-body"><p class="feed-line">Cards are dealt! ${esc(listJoin(g.playerIds.map((id) => (P[id] ? P[id].name : '?'))))} take their seats.</p><span class="feed-when">${esc(ago(g.createdAt))}</span></div></div>`
    );
    return `<div class="panel-head"><h2><span class="pip pip-yellow"></span>Play-by-play</h2>
        ${sample && g.rounds.length ? `<button type="button" class="btn btn-ink btn-small" data-action="ai-take" id="ai-btn">🎙 Hot take</button>` : ''}</div>
      <div class="feed">${items.join('')}</div>`;
  }

  async function aiTake() {
    const g = currentGame();
    if (!g || !sample) return;
    const btn = $('#ai-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '🎙 Thinking…';
    }
    const P = byId();
    const nm = (id) => (P[id] ? P[id].name : '?');
    const st = L.standings(g).map((r) => `${r.rank}. ${nm(r.id)}: ${r.total} pts, ${r.roundsWon} rounds won`).join('\n');
    const recent = g.rounds
      .slice(-5)
      .map((r, i, arr) => `Round ${g.rounds.length - arr.length + i + 1}: ${Object.entries(r.points || {}).map(([id, p]) => `${nm(id)} ${p}`).join(', ')}`)
      .join('\n');
    const prompt = `You are a hyped-up, good-natured sports commentator calling a family game of Uno.
Game: "${g.name}". ${ruleText(g)}. Status: ${g.status}. Rounds played: ${g.rounds.length}.
Standings:
${st}
Recent round scores:
${recent}
Write ONE hot take of at most 2 short sentences (under 45 words). Be playful and specific to these players and numbers, tease gently, no hashtags. Reply with the commentary text only.`;
    try {
      const res = await sample(prompt, { modelTier: 'quick', cache: false });
      const text = String((res && res.text) || '').trim().replace(/^["“]|["”]$/g, '');
      if (!text) throw new Error('empty');
      commit((s) => {
        const game = s.games.find((x) => x.id === g.id);
        game.aiNotes = [...(game.aiNotes || []), { after: game.rounds.length, at: Date.now(), text: text.slice(0, 400) }].slice(-40);
      });
      FX.sound('uno');
    } catch (e) {
      if (e && e.code === 'not_granted') sample = null;
      toast(e && e.code === 'rate_limited' ? 'The commentator needs a breather. Try again in a minute.' : 'No hot take this time. Try again in a moment.');
      render();
    }
  }

  /* -------------------------------------------------------------- scorecard */
  function renderScorecard(g) {
    const P = byId();
    const totals = L.totals(g);
    const max = Math.max(1, ...g.rounds.flatMap((r) => Object.values(r.points || {}).map(Math.abs)));
    const head = g.playerIds.map((id) => `<th scope="col"><span class="who" style="justify-content:flex-end">${avatar(P[id])}<span>${esc(P[id] ? P[id].name : '?')}</span></span></th>`).join('');
    const rows = g.rounds
      .map((r, i) => {
        const cells = g.playerIds
          .map((id) => {
            if (!r.points || !(id in r.points)) return '<td class="muted">—</td>';
            const v = r.points[id];
            const heat = v ? Math.round(12 + (Math.abs(v) / max) * 50) : 0;
            const star = r.winnerId === id ? '<span class="cell-star" title="Round winner">★ </span>' : '';
            return `<td>${star}<span class="cell-heat pc-${esc(P[id] ? P[id].color : 'ink')}" style="background:color-mix(in srgb, var(--pc) ${heat}%, transparent)">${v}</span></td>`;
          })
          .join('');
        return `<tr><th scope="row" style="text-align:left">R${i + 1}</th>${cells}<td><span class="row-actions"><button type="button" data-action="edit-round" data-round="${esc(r.id)}" aria-label="Edit round ${i + 1}" title="Edit">✎</button><button type="button" data-action="delete-round" data-round="${esc(r.id)}" aria-label="Delete round ${i + 1}" title="Delete">✕</button></span></td></tr>`;
      })
      .join('');
    return `<div class="panel-head"><h2><span class="pip pip-green"></span>Scorecard</h2><span class="entry-hint">★ round winner · ✎ to fix a round</span></div>
      <div class="table-wrap"><table><thead><tr><th scope="col">Round</th>${head}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td>Total</td>${g.playerIds.map((id) => `<td>${totals[id]}</td>`).join('')}<td></td></tr></tfoot></table></div>`;
  }

  function podium(g) {
    const P = byId();
    const st = L.standings(g);
    return `<div class="podium">${[st[1], st[0], st[2]]
      .map((row, i) => {
        if (!row) return '<div></div>';
        const place = [2, 1, 3][i];
        return `<div class="podium-step podium-${place}">${avatar(P[row.id], 'avatar-lg')}<span class="who"><span>${esc(P[row.id] ? P[row.id].name : '?')}</span></span><div class="podium-block num">${row.total}</div></div>`;
      })
      .join('')}</div>`;
  }

  function renderFinishedPanel(g) {
    const w = byId()[g.winnerId];
    return `<div class="trophy" style="padding:10px 0">
      <span class="trophy-cup">🏆</span>
      <span class="eyebrow">Champion</span>
      <h2>${esc(w ? `${w.emoji} ${w.name}` : 'Someone')}</h2>
      ${podium(g)}
      <div class="btn-row" style="justify-content:center;margin-top:8px">
        <button type="button" class="btn btn-green" data-action="play-again" data-game="${esc(g.id)}">Play again, same players</button>
        <button type="button" class="btn btn-ghost" data-action="new-game">New game</button>
      </div>
    </div>`;
  }

  function finishGame(g, winnerId) {
    let done;
    commit((s) => {
      const game = s.games.find((x) => x.id === g.id);
      game.status = 'finished';
      game.winnerId = winnerId;
      game.finishedAt = Date.now();
      game.endLine = L.gameOverLine(game, names());
      done = game;
    });
    showGameOver(done);
  }

  function showGameOver(g) {
    FX.sound('fanfare');
    FX.confetti({ count: 220 });
    setTimeout(() => FX.confetti({ x: innerWidth * 0.2, y: innerHeight * 0.5, count: 90 }), 300);
    setTimeout(() => FX.confetti({ x: innerWidth * 0.8, y: innerHeight * 0.5, count: 90 }), 550);
    const w = byId()[g.winnerId];
    openModal(
      `<div class="trophy">
        <span class="trophy-cup">🏆</span>
        <span class="eyebrow">Game over · ${plural(g.rounds.length, 'round')}</span>
        <h1>${esc(w ? `${w.name} wins!` : 'We have a winner!')}</h1>
        <p class="muted">${esc(g.endLine || '')}</p>
        ${podium(g)}
      </div>
      <div class="btn-row" style="justify-content:center">
        <button type="button" class="btn btn-green" data-action="play-again" data-game="${esc(g.id)}">Play again</button>
        <button type="button" class="btn btn-ghost" data-action="close-modal">See final scores</button>
      </div>`,
      { label: 'Game over' }
    );
  }

  function openAddToGame() {
    const g = currentGame();
    if (!g) return;
    const avail = state.players.filter((p) => !g.playerIds.includes(p.id));
    openModal(
      `${modalHead('Pull up a chair', 'Late arrivals start at 0.')}
      ${avail.length ? `<div class="chips" id="atg-list">${avail.map((p) => `<button type="button" class="chip pc-${esc(p.color)}" data-pid="${esc(p.id)}">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>` : ''}
      <form class="add-inline" id="atg-form"><input type="text" id="atg-new" class="text-input" placeholder="New player name" maxlength="24" aria-label="New player name" autocomplete="off"><button type="submit" class="btn btn-ink">Add</button></form>`,
      {
        label: 'Add player',
        onMount: (m) => {
          const join = (pid, newP) => {
            closeModal();
            commit((s) => {
              if (newP) s.players.push(newP);
              s.games.find((x) => x.id === g.id).playerIds.push(pid);
            });
            toast(`${byId()[pid].name} joins the table!`);
          };
          const list = $('#atg-list', m);
          list &&
            list.addEventListener('click', (e) => {
              const c = e.target.closest('[data-pid]');
              c && join(c.dataset.pid);
            });
          $('#atg-form', m).addEventListener('submit', (e) => {
            e.preventDefault();
            const nm = $('#atg-new', m).value.trim();
            if (!nm) return;
            const p = newPlayer(nm);
            join(p.id, p);
          });
        },
      }
    );
  }

  /* -------------------------------------------------------------------- STATS */
  function renderStats() {
    const games = [...state.games].sort((a, b) => b.createdAt - a.createdAt);
    const withRounds = games.filter((g) => g.rounds.length);
    if (!withRounds.length) return emptyState('📊', 'No scores yet', 'Play a round and the leaderboard, trophies and charts show up here.', 'go-play', 'Start a game');
    const P = byId();
    const stats = Object.values(L.playerStats(state)).filter((s) => s.rounds > 0);
    const aw = L.awards(state);
    const finished = state.games.filter((g) => g.status === 'finished').length;
    const totalRounds = withRounds.reduce((s, g) => s + g.rounds.length, 0);
    if (!statsGameId || !withRounds.find((g) => g.id === statsGameId)) statsGameId = (currentGame() && currentGame().rounds.length ? currentGame() : withRounds[0]).id;

    const board = [...stats]
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.roundsWon - a.roundsWon)
      .map(
        (s, i) =>
          `<tr><td><span class="who"><b class="rank-num">${i + 1}</b>${avatar(P[s.id])}<span>${esc(P[s.id] ? P[s.id].name : '?')}</span></span></td><td><strong>${s.wins}</strong></td><td>${s.games}</td><td>${Math.round(s.winRate * 100)}%</td><td>${s.roundsWon}</td><td>${s.bestRound || '—'}</td></tr>`
      )
      .join('');

    return `
      <section class="game-head"><div class="game-title"><span class="eyebrow">All-time</span><h1>Stats</h1></div></section>
      <section class="tiles">
        <div class="tile" style="--tc:var(--red)"><span class="eyebrow">Games</span><span class="tile-value">${state.games.length}</span><span class="tile-sub">${finished} finished</span></div>
        <div class="tile" style="--tc:var(--yellow)"><span class="eyebrow">Rounds</span><span class="tile-value">${totalRounds}</span><span class="tile-sub">across all games</span></div>
        <div class="tile" style="--tc:var(--blue)"><span class="eyebrow">Players</span><span class="tile-value">${stats.length}</span><span class="tile-sub">have played</span></div>
      </section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-green"></span>Leaderboard</h2><span class="entry-hint">Ranked by games won</span></div>
        <div class="table-wrap"><table><thead><tr><th>Player</th><th>Wins</th><th>Games</th><th>Win %</th><th>Rounds won</th><th>Best round</th></tr></thead><tbody>${board}</tbody></table></div></section>
      ${
        aw.length
          ? `<section class="panel"><div class="panel-head"><h2><span class="pip pip-yellow"></span>Trophies</h2></div><div class="awards">${aw
              .map(
                (a, i) =>
                  `<div class="award pc-${esc(P[a.winnerId] ? P[a.winnerId].color : 'ink')}" style="--i:${i}"><span class="award-icon">${a.icon}</span><div style="min-width:0"><div class="award-title">${esc(a.title)}</div><div class="award-blurb">${esc(a.blurb)}</div><div class="award-who">${avatar(P[a.winnerId])}<span>${esc(P[a.winnerId] ? P[a.winnerId].name : '?')}</span><span class="award-value">${esc(a.value)}</span></div></div></div>`
              )
              .join('')}</div></section>`
          : ''
      }
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-red"></span>Score race</h2>
          <select class="select" id="stats-game" aria-label="Game">${withRounds.map((x) => `<option value="${esc(x.id)}" ${x.id === statsGameId ? 'selected' : ''}>${esc(x.name)} · ${esc(ago(x.createdAt))}</option>`).join('')}</select></div>
        <div class="chart-box"><canvas id="ch-race" role="img" aria-label="Running totals after each round"></canvas></div></section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Past games</h2></div>
        <div class="games">${games.map((g) => gameCard(g, P)).join('')}</div></section>`;
  }

  function gameCard(g, P) {
    const st = L.standings(g);
    const max = Math.max(g.target || 0, ...st.map((s) => Math.abs(s.total)), 1);
    return `<article class="game-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="min-width:0"><h3>${esc(g.name)}</h3><span class="muted" style="font-size:.82rem;font-weight:700">${esc(new Date(g.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${plural(g.rounds.length, 'round')}</span></div>
        ${g.status === 'finished' ? '<span class="pill pill-done">Finished</span>' : '<span class="pill pill-live">Live</span>'}
      </div>
      <div class="mini-stand">${st
        .map(
          (row) =>
            `<div class="mini-row"><b>${row.rank}</b><span class="who">${avatar(P[row.id])}<span>${esc(P[row.id] ? P[row.id].name : '?')}${g.winnerId === row.id ? ' 🏆' : ''}</span></span><span class="num">${row.total}</span><div class="mini-bar pc-${esc(P[row.id] ? P[row.id].color : 'ink')}"><i style="width:${(Math.abs(row.total) / max) * 100}%"></i></div></div>`
        )
        .join('')}</div>
      <div class="btn-row">
        <button type="button" class="btn ${g.status === 'active' ? 'btn-red' : 'btn-ink'} btn-small" data-action="open-game" data-game="${esc(g.id)}">${g.status === 'active' ? 'Resume' : 'Open'}</button>
        <button type="button" class="btn btn-ghost btn-small" data-action="delete-game" data-game="${esc(g.id)}" aria-label="Delete ${esc(g.name)}">Delete</button>
      </div>
    </article>`;
  }

  function afterStats() {
    const sel = $('#stats-game');
    if (!sel) return;
    sel.addEventListener('change', () => {
      statsGameId = sel.value;
      render();
    });
    if (!C.available()) {
      $$('.chart-box').forEach((b) => (b.innerHTML = '<div class="chart-fallback">The chart needs an internet connection to load. Everything else works offline.</div>'));
      return;
    }
    C.race($('#ch-race'), findGame(statsGameId), byId());
  }

  /* ------------------------------------------------------------------ PLAYERS */
  function renderPlayers() {
    const stats = L.playerStats(state);
    const cards = [...state.players]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        const s = stats[p.id];
        return `<article class="roster-card">
          <div class="roster-top">${avatar(p, 'avatar-lg')}<div style="min-width:0;flex:1"><h3>${esc(p.name)}</h3><span class="muted" style="font-size:.8rem;font-weight:700">${s.lastPlayed ? `Last played ${esc(ago(s.lastPlayed))}` : 'Yet to play'}</span></div>
            <button type="button" class="btn btn-ghost btn-small" data-action="edit-player" data-pid="${esc(p.id)}">Edit</button></div>
          <div class="roster-stats"><div><strong>${s.wins}</strong><small>Wins</small></div><div><strong>${s.games}</strong><small>Games</small></div><div><strong>${s.roundsWon}</strong><small>Rounds won</small></div></div>
        </article>`;
      })
      .join('');
    return `<section class="game-head"><div class="game-title"><span class="eyebrow">${plural(state.players.length, 'player')} saved</span><h1>Players</h1><p class="muted">Everyone saved here can be tapped into a new game.</p></div></section>
      <section class="panel"><form class="add-inline" id="roster-add"><input type="text" id="roster-new" class="text-input" placeholder="New player name" maxlength="24" aria-label="New player name" autocomplete="off"><button type="submit" class="btn btn-red">Add player</button></form></section>
      ${state.players.length ? `<section class="roster">${cards}</section>` : ''}`;
  }

  function afterPlayers() {
    const form = $('#roster-add');
    form &&
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nm = $('#roster-new').value.trim();
        if (!nm) return $('#roster-new').focus();
        if (state.players.some((p) => p.name.toLowerCase() === nm.toLowerCase())) return toast(`${nm} is already saved.`);
        const p = newPlayer(nm);
        commit((s) => s.players.push(p));
        toast(`${p.name} added.`);
        $('#roster-new').focus();
      });
  }

  function openPlayerEditor(pid) {
    const existing = byId()[pid];
    if (!existing) return;
    const p = { ...existing };
    const inGames = state.games.some((g) => g.playerIds.includes(pid));
    openModal(
      `${modalHead('Edit player')}
      <label class="field"><span>Name</span><input type="text" id="pe-name" class="text-input" value="${esc(p.name)}" maxlength="24" autofocus></label>
      <div class="field"><span>Mascot</span><div class="emojis">${EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-e="${e}" aria-pressed="${e === p.emoji}">${e}</button>`).join('')}</div></div>
      <div class="field"><span>Color</span><div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch pc-${c}" data-c="${c}" aria-pressed="${c === p.color}" aria-label="${c}"></button>`).join('')}</div></div>
      <div class="btn-row" style="justify-content:space-between">
        <button type="button" class="btn btn-ghost" id="pe-delete">Delete</button>
        <div class="btn-row"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="button" class="btn btn-red" id="pe-save">Save</button></div>
      </div>`,
      {
        label: 'Edit player',
        onMount: (m) => {
          m.addEventListener('click', (e) => {
            const eb = e.target.closest('[data-e]');
            if (eb) {
              p.emoji = eb.dataset.e;
              $$('[data-e]', m).forEach((b) => b.setAttribute('aria-pressed', b === eb));
            }
            const cb = e.target.closest('[data-c]');
            if (cb) {
              p.color = cb.dataset.c;
              $$('[data-c]', m).forEach((b) => b.setAttribute('aria-pressed', b === cb));
            }
          });
          const save = () => {
            const nm = $('#pe-name', m).value.trim();
            if (!nm) return $('#pe-name', m).focus();
            p.name = nm.slice(0, 24);
            closeModal();
            commit((s) => (s.players = s.players.map((x) => (x.id === p.id ? p : x))));
            toast('Saved.');
          };
          $('#pe-save', m).addEventListener('click', save);
          $('#pe-name', m).addEventListener('keydown', (e) => e.key === 'Enter' && save());
          $('#pe-delete', m).addEventListener('click', () => {
            if (inGames) return toast(`${p.name} has played games, so they stay to keep old scores right. You can rename them.`);
            closeModal();
            commit((s) => (s.players = s.players.filter((x) => x.id !== pid)));
            if (setup) setup.sel.delete(pid);
            toast('Player removed.');
          });
        },
      }
    );
  }

  /* ------------------------------------------------------------------- misc */
  function emptyState(icon, title, body, action, label) {
    return `<section class="panel"><div class="empty"><span class="empty-icon">${icon}</span><h2>${esc(title)}</h2><p>${esc(body)}</p><button type="button" class="btn btn-red" data-action="${action}">${esc(label)}</button></div></section>`;
  }

  function openBackup() {
    const json = JSON.stringify(state, null, 1);
    const where = S.mode === 'cloud' ? 'Scores sync live to everyone who opens this tracker.' : 'Scores are saved in this browser. Download a backup to move them to another device.';
    openModal(
      `${modalHead('Back up & restore', esc(where))}
      <div class="btn-row"><button type="button" class="btn btn-blue" id="bk-download">Download backup</button><button type="button" class="btn btn-ghost" id="bk-copy">Copy to clipboard</button></div>
      <label class="field"><span>Restore from a backup file</span><input type="file" id="bk-file" accept="application/json,.json"></label>
      <label class="field"><span>…or paste backup text</span><textarea id="bk-text" spellcheck="false"></textarea></label>
      <div class="btn-row" style="justify-content:space-between"><button type="button" class="btn btn-ghost" id="bk-wipe">Erase everything</button><button type="button" class="btn btn-red" id="bk-restore">Restore</button></div>`,
      {
        label: 'Backup',
        onMount: (m) => {
          const filename = `uno-tracker-${new Date().toISOString().slice(0, 10)}.json`;
          $('#bk-download', m).addEventListener('click', async () => {
            if (downloads) {
              try {
                await downloads.save({ filename, data: new Blob([json], { type: 'application/json' }) });
                return toast('Backup saved.');
              } catch (e) {
                return toast('The download was cancelled. Copy to clipboard works too.');
              }
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 500);
          });
          $('#bk-copy', m).addEventListener('click', () => {
            navigator.clipboard
              .writeText(json)
              .then(() => toast('Backup copied.'))
              .catch(() => {
                const ta = $('#bk-text', m);
                ta.value = json;
                ta.select();
                toast('Text selected. Press copy on your keyboard.');
              });
          });
          $('#bk-file', m).addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => ($('#bk-text', m).value = String(r.result || ''));
            r.readAsText(f);
          });
          $('#bk-restore', m).addEventListener('click', () => {
            let parsed;
            try {
              parsed = JSON.parse($('#bk-text', m).value);
              if (!parsed || !Array.isArray(parsed.players) || !Array.isArray(parsed.games)) throw new Error('shape');
            } catch (e) {
              return toast('That does not look like an Uno Tracker backup.');
            }
            confirmModal({
              title: 'Replace all scores?',
              body: `This replaces everything with the backup: ${plural(parsed.players.length, 'player')} and ${plural(parsed.games.length, 'game')}.`,
              ok: 'Restore backup',
              onOk: () => {
                state = S.normalise(parsed);
                draft = setup = null;
                commit(() => {});
                toast('Backup restored.');
              },
            });
          });
          $('#bk-wipe', m).addEventListener('click', () =>
            confirmModal({
              title: 'Erase everything?',
              body: 'All players, games and stats will be deleted.',
              ok: 'Erase everything',
              onOk: () => {
                state = S.emptyState();
                draft = setup = null;
                view = 'play';
                commit(() => {});
              },
            })
          );
        },
      }
    );
  }

  function deleteRound(roundId) {
    const g = currentGame();
    if (!g) return;
    const before = JSON.parse(JSON.stringify(g));
    const idx = g.rounds.findIndex((r) => r.id === roundId);
    if (idx < 0) return;
    commit((s) => {
      const game = s.games.find((x) => x.id === g.id);
      game.rounds.splice(idx, 1);
      if (game.status === 'finished' && game.target && !L.checkOver(game).over) {
        game.status = 'active';
        game.winnerId = null;
        game.finishedAt = null;
        game.endLine = null;
      }
    });
    if (draft && draft.editingId === roundId) draft = null;
    FX.sound('oops');
    toast(`Round ${idx + 1} removed.`, {
      label: 'Undo',
      run: () =>
        commit((s) => {
          const i = s.games.findIndex((x) => x.id === before.id);
          if (i >= 0) s.games[i] = before;
        }),
    });
  }

  /* ---------------------------------------------------------------- actions */
  const actions = {
    go: (el) => {
      view = el.dataset.view;
      render();
      window.scrollTo({ top: 0, behavior: FX.reduced() ? 'auto' : 'smooth' });
    },
    'go-play': () => {
      view = 'play';
      render();
    },
    'close-modal': closeModal,
    mute: () => {
      FX.toggleMute();
      renderSync();
      FX.sound('click');
    },
    backup: openBackup,
    'clear-demo': () =>
      confirmModal({
        title: 'Clear the demo?',
        body: 'The example players and games will be removed so you can start your own.',
        ok: 'Clear demo',
        onOk: () => {
          state = S.emptyState();
          draft = setup = null;
          view = 'play';
          commit(() => {});
          const input = $('#setup-new');
          input && input.focus();
        },
      }),
    'toggle-pick': (el) => {
      const s = ensureSetup();
      s.sel.has(el.dataset.pid) ? s.sel.delete(el.dataset.pid) : s.sel.add(el.dataset.pid);
      FX.sound('click');
      render();
    },
    'set-mode': (el) => {
      ensureSetup().mode = el.dataset.mode;
      render();
    },
    'set-target': (el) => {
      ensureSetup().target = el.dataset.target ? Number(el.dataset.target) : null;
      render();
    },
    'start-game': () => {
      const s = ensureSetup();
      const ids = state.players.filter((p) => s.sel.has(p.id)).map((p) => p.id);
      if (ids.length < 2) return toast('Pick at least 2 players.');
      startGame(ids, { name: (s.name || '').trim(), mode: s.mode, target: s.target });
      toast('Cards are dealt. Good luck!');
    },
    'new-game': () => {
      closeModal();
      setup = null;
      commit((s) => (s.activeGameId = null), { render: false });
      view = 'play';
      render();
      window.scrollTo({ top: 0 });
    },
    'play-again': (el) => {
      const g = findGame(el.dataset.game);
      closeModal();
      if (!g) return;
      startGame(g.playerIds.filter((id) => byId()[id]), { mode: g.mode, target: g.target });
      toast('Rematch! Same players, fresh deck.');
    },
    'open-game': (el) => {
      draft = null;
      commit((s) => (s.activeGameId = el.dataset.game), { render: false });
      view = 'play';
      render();
      window.scrollTo({ top: 0 });
    },
    'delete-game': (el) => {
      const g = findGame(el.dataset.game);
      if (!g) return;
      confirmModal({
        title: `Delete “${g.name}”?`,
        body: `This removes ${plural(g.rounds.length, 'round')} and their stats for good.`,
        ok: 'Delete game',
        onOk: () =>
          commit((s) => {
            s.games = s.games.filter((x) => x.id !== g.id);
            if (s.activeGameId === g.id) s.activeGameId = null;
          }),
      });
    },
    'submit-round': submitRound,
    'cancel-edit': () => {
      draft = null;
      render();
    },
    'edit-round': (el) => {
      const g = currentGame();
      const r = g && g.rounds.find((x) => x.id === el.dataset.round);
      if (!r) return;
      draft = { gameId: g.id, editingId: r.id, points: { ...(r.points || {}) } };
      render();
      const panel = $('#entry-panel');
      panel && panel.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'start' });
    },
    'delete-round': (el) => deleteRound(el.dataset.round),
    'finish-game': () => {
      const g = currentGame();
      if (!g || !g.rounds.length) return;
      const top = L.standings(g)[0];
      const p = byId()[top.id];
      confirmModal({
        title: 'Finish the game?',
        body: `${esc(p ? p.name : 'The leader')} wins with ${top.total} points.`,
        ok: 'Finish game',
        okClass: 'btn-green',
        onOk: () => finishGame(g, top.id),
      });
    },
    'add-to-game': openAddToGame,
    'ai-take': aiTake,
    'edit-player': (el) => openPlayerEditor(el.dataset.pid),
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(el, e);
    }
  });

  /* -------------------------------------------------------------------- boot */
  const scheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  scheme && scheme.addEventListener && scheme.addEventListener('change', () => view === 'stats' && render());
  new MutationObserver(() => view === 'stats' && render()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  S.on((type, payload) => {
    if (type === 'remote') {
      if (JSON.stringify(payload) === JSON.stringify(state)) return;
      state = payload;
      const typing = document.activeElement && document.activeElement.matches('input, textarea');
      if (!$('#modal-root').innerHTML && !typing) render();
      else renderSync();
    } else if (type === 'cloud-empty') {
      if (!state.isDemo && (state.players.length || state.games.length)) S.save(state);
    } else if (type === 'mode') {
      renderSync();
      if (S.mode === 'readonly') toast('This tracker is view-only for you.');
    } else if (type === 'error') {
      toast(payload);
    }
  });

  render();

  S.connectCloud().then((ok) => ok && renderSync());
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude
      .use('sample')
      .then((s) => {
        sample = s;
        if (s && view === 'play') render();
      })
      .catch(() => {});
    window.claude
      .use('downloads')
      .then((d) => (downloads = d))
      .catch(() => {});
  }
})();
