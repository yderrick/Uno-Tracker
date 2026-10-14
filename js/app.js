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

  // Where scores live: 'local' (this browser), or on a hosted page 'editor' (can publish
  // new scores into the page), 'viewer' (watches) and 'checking' (not known yet).
  const SOURCE = S.source();
  const HOSTED = !!(SOURCE && window.claude && typeof window.claude.use === 'function');
  const EMBEDDED = S.embedded();
  let role = HOSTED ? 'checking' : 'local';
  let state = HOSTED ? EMBEDDED || S.emptyState() : S.loadLocal() || EMBEDDED || window.UnoDemo.build(L);
  let artifactApi = null;
  // Who is looking: the Claude account (when the host shares it) and the player it plays as.
  let isOwnerView = false;
  let accountId = null;
  let me = null;
  const CLAIM_KEY = 'uno-tracker:me';
  let publishTimer = null;
  let loadedSeen = null;
  let view = 'play';
  let draft = null; // { gameId, editingId, points }
  let setup = null; // { sel: Set, mode, target, name, open }
  let statsGameId = null;
  let compareIds = null;
  const TARGETS = [10, 15, 20, 25, 30, null];
  let justScored = null;
  let dealtFor = null;

  /* ------------------------------------------------------------------ helpers */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const byId = () => Object.fromEntries(state.players.map((p) => [p.id, p]));
  const names = () => Object.fromEntries(state.players.map((p) => [p.id, p.name]));
  const findGame = (id) => state.games.find((g) => g.id === id) || null;
  // Which table this viewer is looking at: null = the Tables lobby, 'new' = setting up a
  // game, or a game id. Kept per viewer so several games can run at once.
  let focus = null;
  const currentGame = () => (focus && focus !== 'new' ? findGame(focus) : null);
  const liveGames = () => state.games.filter((g) => g.status === 'active' || g.status === 'paused');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const listJoin = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const ruleText = (g) => `${L.higherWins(g) ? 'Highest' : 'Lowest'} score wins${g.target ? ` · ${L.higherWins(g) ? 'first to' : 'ends at'} ${g.target}` : ''}`;
  // canEdit: this view may save at all. The rest is the table's own rules:
  // everyone who can save picks a username first; players in a game can change its
  // scores; the page owner can change anything.
  const canEdit = () => role === 'local' || role === 'editor';
  const ready = () => role === 'local' || (role === 'editor' && !!me);
  const isAdmin = () => role === 'local' || (ready() && isOwnerView);
  const inGame = (g) => !!(me && g && g.playerIds.includes(me));
  const canEditGame = (g) => role === 'local' || (ready() && (isOwnerView || inGame(g)));
  const canManage = ready;
  const fmtAvg = (v) => (Math.round(v * 10) / 10).toString();
  const scoreline = (g) => L.standings(g).map((r) => r.total).join('–');
  /** The game's closing line; games that ended level read as a draw even if saved as a win before draws existed. */
  const endLineOf = (g) => (g.endLine && L.isDraw(g) && !g.draw ? `It’s a draw at ${scoreline(g)}. Nobody wins, nobody loses.` : g.endLine);
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
  const who = (p) => `<span class="who">${avatar(p)}<span>${esc(p ? p.name : 'Unknown')}</span></span>`;

  function commit(mutate, opts = {}) {
    if (!canEdit()) return toast('This scoreboard is view only.');
    mutate(state);
    if (role === 'local') {
      if (!S.saveLocal(state)) toast('Could not save on this device. Use Back up to keep a copy.');
    } else {
      dirty = true;
      schedulePublish();
    }
    if (opts.render !== false) render();
  }

  /* ---------------------------------------------- publishing (hosted page) */
  const seenOf = (st) => {
    const g = st.games.find((x) => x.id === focus);
    return g ? { gameId: g.id, rounds: g.rounds.length, status: g.status } : null;
  };

  /* Simultaneous tables: if another table saved first, re-apply this view's changes
     (whole games and players it changed) on top of theirs after the reload. */
  let baseline = HOSTED ? JSON.parse(JSON.stringify(state)) : null;
  let pendingReplay = null;
  let replayTries = 0;
  let dirty = false; // changes this view made that are not published yet
  function diffFromBaseline() {
    if (!baseline) return null;
    const ser = (x) => JSON.stringify(x);
    const bG = new Map(baseline.games.map((g) => [g.id, ser(g)]));
    const bP = new Map(baseline.players.map((p) => [p.id, ser(p)]));
    const bRounds = new Map(baseline.games.map((g) => [g.id, g.rounds.map((r) => r.id)]));
    return {
      games: state.games.filter((g) => bG.get(g.id) !== ser(g)),
      baseRounds: Object.fromEntries(state.games.filter((g) => bG.get(g.id) !== ser(g)).map((g) => [g.id, bRounds.get(g.id) || []])),
      removed: baseline.games.filter((g) => !state.games.some((x) => x.id === g.id)).map((g) => g.id),
      players: state.players.filter((p) => bP.get(p.id) !== ser(p)),
      removedPlayers: baseline.players.filter((p) => !state.players.some((x) => x.id === p.id)).map((p) => p.id),
    };
  }
  function applyReplay(r) {
    state.games = state.games.filter((g) => !r.removed.includes(g.id));
    r.games.forEach((g) => {
      const i = state.games.findIndex((x) => x.id === g.id);
      if (i < 0) return state.games.push(g);
      // Keep rounds someone else added to the same game in the meantime.
      const mine = new Set(g.rounds.map((x) => x.id));
      const base = new Set((r.baseRounds && r.baseRounds[g.id]) || []);
      const theirs = state.games[i].rounds.filter((x) => !mine.has(x.id) && !base.has(x.id));
      state.games[i] = theirs.length ? { ...g, rounds: [...g.rounds, ...theirs].sort((a, b) => (a.at || 0) - (b.at || 0)) } : g;
    });
    state.players = state.players.filter((p) => !r.removedPlayers.includes(p.id));
    r.players.forEach((p) => {
      const i = state.players.findIndex((x) => x.id === p.id);
      if (i >= 0) state.players[i] = p;
      else state.players.push(p);
    });
  }

  function stash(extra = {}) {
    S.stashUi({
      view,
      focus,
      statsGameId,
      compareIds,
      replay: pendingReplay,
      replayTries,
      setup: setup && { ...setup, sel: [...setup.sel] },
      draft,
      scrollY: window.scrollY,
      seen: loadedSeen,
      ...extra,
    });
  }

  function setSaving(on) {
    const el = $('#saving');
    if (el) el.hidden = !on;
  }

  function schedulePublish() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(publishNow, 900);
    renderSync('Saving…');
  }

  async function publishNow() {
    if (!artifactApi) return;
    stash();
    setSaving(true);
    try {
      await artifactApi.publish(window.UnoPage.documentHtml({ ...SOURCE, data: state, reset: S.hostReset() }));
      dirty = false;
      replayTries = 0;
      // Every open view, this one included, now reloads to the new version.
      setTimeout(() => setSaving(false), 12000);
    } catch (e) {
      setSaving(false);
      const code = e && e.code;
      if (code === 'conflict') {
        const diff = diffFromBaseline();
        if (diff && replayTries < 3) stash({ replay: diff, replayTries: replayTries + 1 });
        else stash({ flash: 'Someone else saved at the same moment. Check the last round and enter it again if it is missing.' });
        return;
      }
      if (['not_writer', 'not_granted', 'not_declared', 'consent_required', 'capability_disabled', 'capability_removed'].includes(code)) {
        role = 'viewer';
        render();
        return toast('You can watch this scoreboard, but only the scorekeeper can change it.');
      }
      if (code === 'too_large') return toast('The scoreboard is full. Delete a few old games in Stats.');
      toast(code === 'rate_limited' ? 'Saving is busy. Trying again in a few seconds…' : 'Could not save. Trying again…');
      publishTimer = setTimeout(publishNow, code === 'rate_limited' ? 6000 : 3000);
    }
  }

  function newPlayer(name) {
    const used = state.players.map((p) => p.color);
    const color = COLORS.find((c) => !used.includes(c)) || COLORS[state.players.length % COLORS.length];
    const free = EMOJIS.filter((e) => !state.players.some((p) => p.emoji === e));
    return { id: uid(), name: name.slice(0, 24), emoji: pick(free.length ? free : EMOJIS), color, createdAt: Date.now(), account: false };
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
  function openModal(html, { onMount, label = 'Dialog', locked = false } = {}) {
    if (!locked && $('#gate-form')) return null; // the username step comes first
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div></div>`;
    const back = $('[data-modal-backdrop]', root);
    back.addEventListener('mousedown', (e) => !locked && e.target === back && closeModal());
    const onKey = (e) => !locked && e.key === 'Escape' && closeModal();
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
    me = resolveMe();
    C.destroyAll();
    $$('.tab').forEach((t) => (t.dataset.view === view ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
    $('#demo-banner').hidden = !(state.isDemo && isAdmin());
    renderSync();
    const views = { play: renderPlay, stats: renderStats, points: renderPoints, trophies: renderTrophies, players: renderPlayers };
    $('#view').innerHTML = (views[view] || renderPlay)();
    const after = { play: afterPlay, stats: afterStats, points: afterPoints, players: afterPlayers }[view];
    const live = state.games.filter((g) => g.status === 'active').length;
    const badge = $('#live-count');
    if (badge) {
      badge.textContent = live;
      badge.hidden = !live;
    }
    after && after();
    justScored = null;
    if (role === 'editor' && !me && !$('#gate-form')) openGate();
  }

  function renderSync(override) {
    const chip = $('#sync-chip');
    const text = {
      local: 'Saved on this device',
      checking: 'Connecting…',
      viewer: '👀 Watching live',
      editor: me && byId()[me] ? `● ${byId()[me].name}` : '● Signed in',
    }[role];
    chip.classList.toggle('is-cloud', role === 'editor');
    chip.textContent = override || text;
    chip.title =
      role === 'viewer'
        ? 'Scores update by themselves when the scorekeeper adds a round'
        : role === 'editor'
          ? 'Signed in. You can change the scores of games you are playing in.'
          : 'Scores are saved in this browser';
    $('#mute-btn').textContent = FX.muted ? '🔇' : '🔊';
    $('#backup-btn').hidden = !isAdmin();
  }

  /* ---------------------------------------------------------------- GAME TAB */
  function renderPlay() {
    if (focus === 'new' && canManage()) return renderSetup();
    const g = currentGame();
    if (g) return renderGame(g);
    return renderLobby();
  }

  /* The Tables lobby: every game in progress, live or paused, side by side. */
  function lastActivity(g) {
    const r = g.rounds[g.rounds.length - 1];
    return Math.max(g.createdAt || 0, (r && r.at) || 0, g.pausedAt || 0, g.resumedAt || 0);
  }

  function tableCard(g, P) {
    const st = L.standings(g);
    const paused = g.status === 'paused';
    const mine = inGame(g);
    return `<article class="table-card ${paused ? 'is-paused' : ''} ${mine ? 'is-mine' : ''}">
      <div class="table-top">
        <div style="min-width:0"><h3>${esc(g.name)}</h3><span class="muted table-sub">${g.rounds.length ? `Round ${g.rounds.length + 1}` : 'Just dealt'} · ${esc(ruleText(g))} · ${esc(ago(lastActivity(g)))}</span></div>
        ${paused ? '<span class="pill pill-paused">⏸ Paused</span>' : '<span class="pill pill-live">Live</span>'}
      </div>
      ${mine ? '<span class="pick-tag table-you">You’re playing</span>' : ''}
      <div class="table-score">${st
        .map(
          (row) =>
            `<span class="table-player pc-${esc(P[row.id] ? P[row.id].color : 'ink')}">${avatar(P[row.id])}<span class="table-name">${esc(P[row.id] ? P[row.id].name : '?')}</span><b>${row.total}</b></span>`
        )
        .join('<span class="table-vs">vs</span>')}</div>
      <div class="btn-row">
        <button type="button" class="btn ${paused ? 'btn-ghost' : 'btn-red'} btn-small" data-action="open-game" data-game="${esc(g.id)}">${canEditGame(g) && !paused ? 'Play' : 'Open'}</button>
        ${canEditGame(g) ? (paused ? `<button type="button" class="btn btn-green btn-small" data-action="resume-game" data-game="${esc(g.id)}">▶ Resume</button>` : `<button type="button" class="btn btn-ghost btn-small" data-action="pause-game" data-game="${esc(g.id)}">⏸ Pause</button>`) : ''}
      </div>
    </article>`;
  }

  function renderLobby() {
    const P = byId();
    const byRecent = (a, b) => (inGame(b) - inGame(a)) || lastActivity(b) - lastActivity(a);
    const live = state.games.filter((g) => g.status === 'active').sort(byRecent);
    const paused = state.games.filter((g) => g.status === 'paused').sort(byRecent);
    const recent = state.games.filter((g) => g.status === 'finished').sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt)).slice(0, 3);
    const watching = !canManage();
    return `
      <section class="game-head"><div class="game-title"><span class="eyebrow">${role === 'checking' ? 'Loading' : live.length ? `${plural(live.length, 'game')} live` : 'Game night'}</span><h1>Tables</h1>
        <p class="muted">${watching ? 'Every game being played right now. Tap one to follow it live.' : 'Run as many games at once as you like. Pause one when someone steps out, and pick it back up later.'}</p></div>
        ${canManage() ? '<button type="button" class="btn btn-red btn-big" data-action="new-game">+ New game</button>' : ''}</section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-red"></span>Live now</h2><span class="entry-hint">${live.length ? 'Scores update by themselves' : ''}</span></div>
        ${live.length ? `<div class="tables">${live.map((g) => tableCard(g, P)).join('')}</div>` : `<div class="empty"><span class="empty-icon">🃏</span><p>No games on right now.</p>${canManage() ? '<button type="button" class="btn btn-red" data-action="new-game">Deal a new game</button>' : ''}</div>`}</section>
      ${paused.length ? `<section class="panel"><div class="panel-head"><h2><span class="pip pip-yellow"></span>Paused</h2><span class="entry-hint">Waiting for everyone to come back</span></div><div class="tables">${paused.map((g) => tableCard(g, P)).join('')}</div></section>` : ''}
      ${recent.length ? `<section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Just finished</h2><button type="button" class="link-btn" data-action="go" data-view="stats">All games</button></div><div class="games">${recent.map((g) => gameCard(g, P)).join('')}</div></section>` : ''}`;
  }

  function ensureSetup() {
    if (setup) return setup;
    const last = [...state.games].sort((a, b) => b.createdAt - a.createdAt)[0];
    const P = byId();
    setup = {
      sel: new Set([...(last ? last.playerIds.filter((id) => P[id]) : []), ...(me ? [me] : [])]),
      mode: last ? last.mode : 'high',
      target: last && last.target && last.target <= 100 ? last.target : 20,
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
          `<button type="button" class="pick pc-${esc(p.color)}" data-action="toggle-pick" data-pid="${esc(p.id)}" aria-pressed="${s.sel.has(p.id)}">${avatar(p, 'avatar-lg')}<span class="pick-name">${esc(p.name)}</span>${playerTag(p)}<span class="pick-check" aria-hidden="true">✓</span></button>`
      )
      .join('');
    const n = s.sel.size;
    return `
      <section class="game-head"><div class="game-title"><span class="eyebrow">New game</span><h1>Who’s playing?</h1><p class="muted">Tap the players at the table. Friends who sign in with their own username show up here, and you can add guests who don’t have a Claude account.</p></div></section>
      <section class="panel setup">
        <div class="picks">${chips || '<p class="muted">No players yet. Add the first one below.</p>'}</div>
        <form class="add-inline" id="setup-add">
          <input type="text" id="setup-new" class="text-input" placeholder="Add a guest (no Claude account)" maxlength="24" aria-label="Guest player name" autocomplete="off">
          <button type="submit" class="btn btn-ink">Add</button>
        </form>
        <details class="options" id="setup-options" ${s.open ? 'open' : ''}>
          <summary>Options <span class="muted">· ${esc(ruleText(s))}</span></summary>
          <div class="options-body">
            <label class="field"><span>Game name</span><input type="text" id="setup-name" class="text-input" value="${esc(s.name)}" maxlength="60"></label>
            <div class="field"><span>Who wins?</span><div class="seg" role="group" aria-label="Who wins">
              <button type="button" data-action="set-mode" data-mode="high" aria-pressed="${s.mode === 'high'}">Highest score</button>
              <button type="button" data-action="set-mode" data-mode="low" aria-pressed="${s.mode === 'low'}">Lowest score</button></div></div>
            <div class="field"><span>Game ends at</span>${targetPicker(s.target, 'setup-target')}</div>
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
    focus = g.id;
    commit((st) => st.games.push(g));
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

    const paused = g.status === 'paused';
    return `
      <button type="button" class="link-btn back-link" data-action="go-hub">← All tables</button>
      <section class="game-head">
        <div class="game-title">
          <span class="eyebrow">${finished ? 'Final scores' : paused ? `Paused before round ${g.rounds.length + 1}` : `Round ${g.rounds.length + 1}`}</span>
          <h1>${esc(g.name)}</h1>
          <div class="game-meta">
            ${finished ? (L.isDraw(g) ? `<span class="pill pill-done">🤝 Draw · ${esc(scoreline(g))}</span>` : `<span class="pill pill-done">🏆 ${esc(P[L.winnerOf(g)] ? P[L.winnerOf(g)].name : '')} won</span>`) : paused ? '<span class="pill pill-paused">⏸ Paused</span>' : '<span class="pill pill-live">Live</span>'}
            <span class="pill">${esc(ruleText(g))}</span>
            ${!canEditGame(g) && !finished && !paused ? `<span class="pill">${ready() ? '👀 You’re not in this game, so you’re watching' : '👀 Updates by itself'}</span>` : ''}
          </div>
        </div>
        <div class="btn-row" ${(finished ? canManage() : canEditGame(g)) ? '' : 'hidden'}>
          ${
            finished
              ? `<button type="button" class="btn btn-ghost" data-action="new-game">New game</button>`
              : paused
                ? `<button type="button" class="btn btn-ghost btn-small" data-action="game-settings">⚙ Settings</button>
                   <button type="button" class="btn btn-ghost btn-small" data-action="quit-game">Quit game</button>
                   <button type="button" class="btn btn-green btn-small" data-action="resume-game" data-game="${esc(g.id)}">▶ Resume</button>`
                : `<button type="button" class="btn btn-ghost btn-small" data-action="game-settings">⚙ Settings</button>
                   <button type="button" class="btn btn-ghost btn-small" data-action="add-to-game">+ Player</button>
                   <button type="button" class="btn btn-ghost btn-small" data-action="pause-game" data-game="${esc(g.id)}">⏸ Pause</button>
                   <button type="button" class="btn btn-ghost btn-small" data-action="quit-game">Quit game</button>
                   <button type="button" class="btn btn-ink btn-small" data-action="finish-game" ${g.rounds.length ? '' : 'disabled'}>Finish game</button>`
          }
        </div>
      </section>
      <section class="board" aria-label="Scoreboard">${cards}</section>
      ${
        canEditGame(g) || finished || paused
          ? `<div class="grid-2">
        <section class="panel" id="entry-panel">${paused && !isEditing(g) ? renderPausedPanel(g) : canEditGame(g) && (!finished || isEditing(g)) ? renderEntry(g) : renderFinishedPanel(g)}</section>
        <section class="panel">${renderFeed(g)}</section>
      </div>`
          : `<section class="panel">${renderFeed(g)}</section>`
      }
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
    if (!g || ((g.status === 'finished' || g.status === 'paused') && !isEditing(g))) return;
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
          const same = wasFinished && game.winnerId === over.winnerId && !!game.draw === over.draw;
          game.status = 'finished';
          game.winnerId = over.winnerId;
          game.draw = over.draw;
          if (!same) {
            game.finishedAt = Date.now();
            game.endLine = L.gameOverLine(game, names());
            nowOver = game;
          }
        } else if (wasFinished && game.target) {
          game.status = 'active';
          game.winnerId = null;
          game.draw = false;
          game.finishedAt = null;
          game.endLine = null;
        }
      },
      { render: false }
    );
    justScored = points;
    draft = null;
    render();
    if (role !== 'local') return; // the hosted page reloads after saving and celebrates then
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
    if (g.endLine) items.push(`<div class="feed-item"><span class="feed-badge is-end">${L.isDraw(g) ? '🤝' : '🏁'}</span><div class="feed-body"><p class="feed-line"><strong>${esc(endLineOf(g))}</strong></p></div></div>`);
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
    return `<div class="panel-head"><h2><span class="pip pip-yellow"></span>Play-by-play</h2></div>
      <div class="feed">${items.join('')}</div>`;
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
        if (!canEditGame(g)) return `<tr><th scope="row" style="text-align:left">R${i + 1}</th>${cells}</tr>`;
        return `<tr><th scope="row" style="text-align:left">R${i + 1}</th>${cells}<td><span class="row-actions"><button type="button" data-action="edit-round" data-round="${esc(r.id)}" aria-label="Edit round ${i + 1}" title="Edit">✎</button><button type="button" data-action="delete-round" data-round="${esc(r.id)}" aria-label="Delete round ${i + 1}" title="Delete">✕</button></span></td></tr>`;
      })
      .join('');
    return `<div class="panel-head"><h2><span class="pip pip-green"></span>Scorecard</h2><span class="entry-hint">★ round winner${canEditGame(g) ? ' · ✎ to fix a round' : ''}</span></div>
      <div class="table-wrap"><table><thead><tr><th scope="col">Round</th>${head}${canEditGame(g) ? '<th scope="col"><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td>Total</td>${g.playerIds.map((id) => `<td>${totals[id]}</td>`).join('')}${canEditGame(g) ? '<td></td>' : ''}</tr></tfoot></table></div>`;
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

  function renderPausedPanel(g) {
    return `<div class="trophy" style="padding:10px 0">
      <span class="trophy-cup">⏸</span>
      <span class="eyebrow">Paused · ${esc(scoreline(g))}</span>
      <h2>Taking a breather</h2>
      <p class="muted">The scores are safe. ${canEditGame(g) ? 'Resume when everyone’s back at the table.' : 'The players will pick it back up later.'}</p>
      ${canEditGame(g) ? `<div class="btn-row" style="justify-content:center;margin-top:8px"><button type="button" class="btn btn-green btn-big" data-action="resume-game" data-game="${esc(g.id)}">▶ Resume game</button></div>` : ''}
    </div>`;
  }

  function renderFinishedPanel(g) {
    const draw = L.isDraw(g);
    const w = byId()[L.winnerOf(g)];
    return `<div class="trophy" style="padding:10px 0">
      <span class="trophy-cup">${draw ? '🤝' : '🏆'}</span>
      <span class="eyebrow">${draw ? `Draw · ${esc(scoreline(g))}` : 'Champion'}</span>
      <h2>${draw ? 'Honours even' : esc(w ? `${w.emoji} ${w.name}` : 'Someone')}</h2>
      ${draw ? '<p class="muted">Nobody wins, nobody loses. It goes down as a draw for everyone.</p>' : ''}
      ${podium(g)}
      <div class="btn-row" style="justify-content:center;margin-top:8px" ${canManage() ? '' : 'hidden'}>
        ${canEditGame(g) ? `<button type="button" class="btn btn-green" data-action="play-again" data-game="${esc(g.id)}">Play again, same players</button>` : ''}
        <button type="button" class="btn btn-ghost" data-action="new-game">New game</button>
      </div>
    </div>`;
  }

  function finishGame(g) {
    let done;
    commit((s) => {
      const game = s.games.find((x) => x.id === g.id);
      const draw = L.tiedAtTop(game);
      game.status = 'finished';
      game.draw = draw;
      game.winnerId = draw ? null : L.standings(game)[0].id;
      game.finishedAt = Date.now();
      game.endLine = L.gameOverLine(game, names());
      done = game;
    });
    if (role === 'local') showGameOver(done); // the hosted page shows it after reloading
  }

  function showGameOver(g) {
    FX.sound('fanfare');
    FX.confetti({ count: 220 });
    setTimeout(() => FX.confetti({ x: innerWidth * 0.2, y: innerHeight * 0.5, count: 90 }), 300);
    setTimeout(() => FX.confetti({ x: innerWidth * 0.8, y: innerHeight * 0.5, count: 90 }), 550);
    const draw = L.isDraw(g);
    const w = byId()[L.winnerOf(g)];
    openModal(
      `<div class="trophy">
        <span class="trophy-cup">${draw ? '🤝' : '🏆'}</span>
        <span class="eyebrow">Game over · ${plural(g.rounds.length, 'round')}</span>
        <h1>${draw ? `It’s a draw! ${esc(scoreline(g))}` : esc(w ? `${w.name} wins!` : 'We have a winner!')}</h1>
        <p class="muted">${esc(endLineOf(g) || '')}</p>
        ${podium(g)}
      </div>
      <div class="btn-row" style="justify-content:center">
        ${canEditGame(g) ? `<button type="button" class="btn btn-green" data-action="play-again" data-game="${esc(g.id)}">Play again</button>` : ''}
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
    if (!withRounds.length) return emptyState('📊', 'No scores yet', 'Play a round and the dashboards and charts show up here.', canManage() ? 'go-play' : null, 'Start a game');
    if (!statsGameId || !withRounds.find((g) => g.id === statsGameId)) statsGameId = (currentGame() && currentGame().rounds.length ? currentGame() : withRounds[0]).id;
    return `
      <section class="game-head"><div class="game-title"><span class="eyebrow">Dashboards</span><h1>Stats</h1><p class="muted">Every round, every game, every grudge.</p></div>
        <button type="button" class="btn btn-yellow" data-action="go" data-view="trophies">🏆 Trophy Room</button></section>
      ${renderGameDashboard(findGame(statsGameId), withRounds)}
      ${renderAllTime()}
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Past games</h2></div>
        <div class="games">${games.map((g) => gameCard(g, byId())).join('')}</div></section>`;
  }

  function renderGameDashboard(g, withRounds) {
    const P = byId();
    const st = L.standings(g);
    const nm = (id) => (P[id] ? `${P[id].emoji} ${P[id].name}` : '?');
    let big = { v: -Infinity };
    g.rounds.forEach((r, i) => Object.entries(r.points || {}).forEach(([id, v]) => v > big.v && (big = { v, id, n: i + 1 })));
    const mostWins = [...st].sort((a, b) => b.roundsWon - a.roundsWon)[0];
    const handed = g.rounds.reduce((sum, r) => sum + Object.values(r.points || {}).reduce((a, b) => a + b, 0), 0);
    const margin = st.length > 1 ? Math.abs(st[0].total - st[1].total) : 0;
    let leadChanges = 0;
    for (let i = 2; i <= g.rounds.length; i++) if (L.standingsAfter(g, i)[0].id !== L.standingsAfter(g, i - 1)[0].id) leadChanges++;
    const tiles = [
      L.isDraw(g) ? ['var(--red)', 'Result', 'Draw', scoreline(g)] : ['var(--red)', g.status === 'finished' ? 'Winner' : 'Leader', nm(L.winnerOf(g) || st[0].id), plural(st[0].total, 'point')],
      ['var(--blue)', 'Rounds', g.rounds.length, plural(leadChanges, 'lead change')],
      ['var(--yellow)', L.higherWins(g) ? 'Biggest round' : 'Worst hit', big.v, `${nm(big.id)} in R${big.n}`],
      ['var(--green)', 'Most rounds won', mostWins.roundsWon, nm(mostWins.id)],
      ['var(--red)', 'Avg per round', Math.round((handed / g.rounds.length) * 10) / 10, `${plural(handed, 'point')} total`],
      ['var(--blue)', 'Gap: 1st to 2nd', margin, margin <= 1 ? 'Photo finish' : margin >= Math.max(3, Math.abs(st[0].total) / 2) ? 'Runaway' : 'Within reach'],
    ];
    const sheet = st
      .map((row) => {
        const played = g.rounds.filter((r) => r.points && row.id in r.points).length;
        const best = Math.max(0, ...g.rounds.map((r) => (r.points && r.points[row.id]) || 0));
        return `<tr><td>${who(P[row.id])}</td><td>${row.rank}</td><td><strong>${row.total}</strong></td><td>${row.roundsWon}</td><td>${played ? Math.round((row.roundsWon / played) * 100) : 0}%</td><td>${best}</td><td>${L.longestStreak(g, row.id)}</td></tr>`;
      })
      .join('');
    return `
      <section class="panel dash-head"><div class="panel-head" style="margin:0"><h2><span class="pip pip-red"></span>Game dashboard</h2>
        <select class="select" id="stats-game" aria-label="Game">${withRounds.map((x) => `<option value="${esc(x.id)}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)} · ${esc(ago(x.createdAt))}${x.status === 'active' ? ' · live' : x.status === 'paused' ? ' · paused' : ''}</option>`).join('')}</select></div></section>
      <section class="tiles">${tiles
        .map(([c, l, v, sub]) => `<div class="tile" style="--tc:${c}"><span class="eyebrow">${esc(l)}</span><span class="tile-value ${typeof v === 'string' ? 'is-text' : ''}">${esc(v)}</span><span class="tile-sub">${esc(sub)}</span></div>`)
        .join('')}</section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-red"></span>The race</h2><span class="entry-hint">Running totals after every round</span></div>
        <div class="chart-box tall"><canvas id="ch-race" role="img" aria-label="Running totals after each round"></canvas></div></section>
      <div class="chart-grid">
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Momentum</h2><span class="entry-hint">Rank after each round</span></div><div class="chart-box"><canvas id="ch-bump" role="img" aria-label="Rank after each round"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-yellow"></span>Points per round</h2><span class="entry-hint">Who scored what</span></div><div class="chart-box"><canvas id="ch-rounds" role="img" aria-label="Points per round"></canvas></div></section>
      </div>
      <div class="chart-grid">
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-green"></span>Who wins rounds</h2><span class="entry-hint">Share of rounds won</span></div><div class="chart-box short"><canvas id="ch-share" role="img" aria-label="Share of rounds won"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-wild"></span>Stat sheet</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Player</th><th>Rank</th><th>Total</th><th>Rounds won</th><th>Win %</th><th>Best round</th><th>Best streak</th></tr></thead><tbody>${sheet}</tbody></table></div></section>
      </div>`;
  }

  function renderAllTime() {
    const P = byId();
    const stats = Object.values(L.playerStats(state)).filter((s) => s.rounds > 0);
    const held = trophyCounts();
    const finished = state.games.filter((g) => g.status === 'finished').length;
    const totalRounds = state.games.reduce((sum, g) => sum + g.rounds.length, 0);
    const totalPts = state.games.reduce((sum, g) => sum + g.rounds.reduce((a, r) => a + Object.values(r.points || {}).reduce((x, y) => x + y, 0), 0), 0);
    if (!compareIds || !compareIds.every((id) => stats.some((s) => s.id === id))) compareIds = [...stats].sort((a, b) => b.rounds - a.rounds).slice(0, 4).map((s) => s.id);
    const nameCell = (s, i) => `<td><span class="who"><b class="rank-num">${i + 1}</b>${avatar(P[s.id])}<span>${esc(P[s.id] ? P[s.id].name : '?')}</span></span></td>`;
    const board = [...stats]
      .sort((a, b) => b.wins - a.wins || b.draws - a.draws || a.losses - b.losses || b.points - a.points)
      .map(
        (s, i) =>
          `<tr>${nameCell(s, i)}<td><strong>${s.wins}</strong></td><td>${s.draws}</td><td>${s.losses}</td><td>${s.finished}</td><td>${Math.round(s.winRate * 100)}%</td><td>${s.roundsWon}</td><td>${s.longestStreak}</td><td>${held[s.id] || 0} 🏆</td></tr>`
      )
      .join('');

    const h2h = L.headToHead(state);
    const hp = stats.map((s) => s.id);
    const h2hTable =
      finished && hp.length > 1
        ? `<div class="table-wrap"><table class="h2h"><thead><tr><th>Row beat column</th>${hp.map((id) => `<th title="${esc(P[id] && P[id].name)}">${esc(P[id] ? P[id].emoji : '')} ${esc(P[id] ? P[id].name : '')}</th>`).join('')}</tr></thead><tbody>${hp
            .map(
              (a) =>
                `<tr><td>${who(P[a])}</td>${hp
                  .map((b) => {
                    if (a === b) return '<td class="self"></td>';
                    const w = h2h[a][b];
                    const l = h2h[b][a];
                    const tone = w > l ? 'var(--good)' : w < l ? 'var(--bad)' : 'var(--muted)';
                    return `<td title="${esc(P[a] && P[a].name)} finished above ${esc(P[b] && P[b].name)} ${w} of ${w + l} times"><strong style="color:${tone}">${w}</strong><span class="muted">–${l}</span></td>`;
                  })
                  .join('')}</tr>`
            )
            .join('')}</tbody></table></div>`
        : '<div class="empty"><p>Finish a game to see who has whose number.</p></div>';
    return `
      <section class="panel dash-head"><div class="panel-head" style="margin:0"><h2><span class="pip pip-green"></span>All-time</h2><span class="entry-hint">Across every game on this page</span></div></section>
      <section class="tiles">
        <div class="tile" style="--tc:var(--red)"><span class="eyebrow">Games</span><span class="tile-value">${state.games.length}</span><span class="tile-sub">${finished} finished</span></div>
        <div class="tile" style="--tc:var(--yellow)"><span class="eyebrow">Rounds dealt</span><span class="tile-value">${totalRounds}</span><span class="tile-sub">and not one of them fair</span></div>
        <div class="tile" style="--tc:var(--green)"><span class="eyebrow">Points scored</span><span class="tile-value">${totalPts.toLocaleString()}</span><span class="tile-sub">across all games</span></div>
        <div class="tile" style="--tc:var(--blue)"><span class="eyebrow">Players</span><span class="tile-value">${stats.length}</span><span class="tile-sub">have played</span></div>
      </section>
      <section class="panel points-teaser"><div class="panel-head" style="margin:0"><h2><span class="pip pip-yellow"></span>Points table</h2><button type="button" class="btn btn-yellow btn-small" data-action="go" data-view="points">See the points table →</button></div></section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-green"></span>Leaderboard</h2><span class="entry-hint">Ranked by wins. Draws count for nobody.</span></div>
        <div class="table-wrap"><table><thead><tr><th>Player</th><th title="Wins">W</th><th title="Draws">D</th><th title="Losses">L</th><th>Finished</th><th>Win %</th><th>Rounds won</th><th>Best streak</th><th>Trophies</th></tr></thead><tbody>${board}</tbody></table></div></section>
      <div class="chart-grid">
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-red"></span>Wins</h2><span class="entry-hint">Finished games</span></div><div class="chart-box tall"><canvas id="ch-wins" role="img" aria-label="Games won per player"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-wild"></span>Player DNA</h2><span class="entry-hint">Compare up to 4</span></div>
          <div class="chips" style="margin-bottom:12px">${stats
            .map((s) => `<button type="button" class="chip pc-${esc(P[s.id] ? P[s.id].color : 'ink')}" data-action="compare-toggle" data-pid="${esc(s.id)}" aria-pressed="${compareIds.includes(s.id)}">${avatar(P[s.id])}<span>${esc(P[s.id] ? P[s.id].name : '?')}</span></button>`)
            .join('')}</div>
          <div class="chart-box"><canvas id="ch-radar" role="img" aria-label="Player comparison"></canvas></div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Head to head</h2><span class="entry-hint">How often each row player finished above each column player</span></div>${h2hTable}</section>`;
  }

  /* ------------------------------------------------------------------- POINTS */
  function renderPoints() {
    const P = byId();
    const stats = Object.values(L.playerStats(state))
      .filter((s) => s.rounds > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins);
    if (!stats.length)
      return `<section class="game-head"><div class="game-title"><span class="eyebrow">Points</span><h1>Points table</h1></div></section>
        <div class="empty"><span class="empty-icon">🔢</span><p>Play a round and the points start piling up here.</p></div>`;
    const totalPts = stats.reduce((a, s) => a + s.points, 0);
    const topPts = Math.max(1, ...stats.map((s) => s.points));
    const leader = stats[0];
    const second = stats[1];
    const bestAvg = [...stats].filter((s) => s.games).sort((a, b) => b.avgPerGame - a.avgPerGame)[0];
    const bestGame = [...stats].sort((a, b) => (b.bestGame || 0) - (a.bestGame || 0))[0];
    const nm = (s) => esc(s && P[s.id] ? `${P[s.id].emoji} ${P[s.id].name}` : '?');
    const rows = stats
      .map((s, i) => {
        const gap = i ? leader.points - s.points : 0;
        return `<tr class="${i < 3 ? `pts-top pts-${i + 1}` : ''}"><td><span class="who"><b class="rank-num">${['🥇', '🥈', '🥉'][i] || i + 1}</b>${avatar(P[s.id])}<span>${esc(P[s.id] ? P[s.id].name : '?')}</span></span></td>
          <td><span class="pts-cell"><span class="pts-bar pc-${esc(P[s.id] ? P[s.id].color : 'ink')}"><i style="width:${Math.round((s.points / topPts) * 100)}%"></i></span><strong>${s.points}</strong></span></td>
          <td class="muted">${i ? `−${gap}` : 'Leader'}</td><td>${s.wins}</td><td>${s.games}</td><td>${fmtAvg(s.avgPerGame)}</td><td>${s.rounds ? fmtAvg(s.points / s.rounds) : '—'}</td><td>${s.bestGame || '—'}</td><td>${s.bestRound || '—'}</td></tr>`;
      })
      .join('');
    return `
      <section class="game-head"><div class="game-title"><span class="eyebrow">${totalPts.toLocaleString()} points scored all-time</span><h1>Points table</h1>
        <p class="muted">Every point from every game, added up and ranked. Live and paused games count as they go.</p></div></section>
      <section class="tiles">
        <div class="tile" style="--tc:var(--yellow)"><span class="eyebrow">Top of the table</span><span class="tile-value">${leader.points}</span><span class="tile-sub">${nm(leader)}${second ? ` · ${leader.points - second.points} ahead` : ''}</span></div>
        <div class="tile" style="--tc:var(--red)"><span class="eyebrow">Best per game</span><span class="tile-value">${bestAvg ? fmtAvg(bestAvg.avgPerGame) : '—'}</span><span class="tile-sub">${nm(bestAvg)}</span></div>
        <div class="tile" style="--tc:var(--green)"><span class="eyebrow">Biggest single game</span><span class="tile-value">${bestGame.bestGame || 0}</span><span class="tile-sub">${nm(bestGame)}</span></div>
        <div class="tile" style="--tc:var(--blue)"><span class="eyebrow">Points scored</span><span class="tile-value">${totalPts.toLocaleString()}</span><span class="tile-sub">by ${plural(stats.length, 'player')}</span></div>
      </section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-yellow"></span>Points table</h2><span class="entry-hint">Ranked by cumulative points</span></div>
        <div class="table-wrap"><table class="pts-table"><thead><tr><th>Player</th><th>Points</th><th>Gap</th><th>Wins</th><th>Games</th><th>Per game</th><th>Per round</th><th>Best game</th><th>Best round</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <div class="chart-grid">
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-red"></span>The long race</h2><span class="entry-hint">Points piling up, game by game</span></div><div class="chart-box tall"><canvas id="ch-pts-time" role="img" aria-label="Cumulative points after each game"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-green"></span>Slice of the pie</h2><span class="entry-hint">Share of every point scored</span></div><div class="chart-box tall"><canvas id="ch-pts-share" role="img" aria-label="Share of all points"></canvas></div></section>
      </div>`;
  }

  function afterPoints() {
    if (!$('#ch-pts-time')) return;
    if (!C.available()) {
      $$('.chart-box').forEach((b) => (b.innerHTML = '<div class="chart-fallback">Charts need an internet connection to load. Everything else works offline.</div>'));
      return;
    }
    const P = byId();
    const stats = Object.values(L.playerStats(state)).filter((s) => s.rounds > 0);
    C.pointsOverTime($('#ch-pts-time'), state.games, stats.map((s) => s.id), P);
    C.pointsShare($('#ch-pts-share'), stats, P);
  }

  /* ----------------------------------------------------------------- TROPHIES */
  function trophyCounts() {
    const held = {};
    L.trophies(state).forEach((t) => t.holders.forEach((id) => (held[id] = (held[id] || 0) + 1)));
    return held;
  }

  function renderTrophies() {
    const P = byId();
    const all = L.trophies(state);
    const earned = all.filter((t) => t.holders.length);
    const locked = all.filter((t) => !t.holders.length);
    const shelf = {};
    earned.forEach((t) => t.holders.forEach((id) => (shelf[id] = shelf[id] || []).push(t)));
    const shelfRows = Object.entries(shelf)
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([id, ts], i) =>
          `<div class="shelf-row"><b class="rank-num">${i + 1}</b>${who(P[id])}<span class="shelf-icons" title="${esc(ts.map((t) => t.title).join(', '))}">${ts.map((t) => `<span>${t.icon}</span>`).join('')}</span><strong class="shelf-count">${ts.length}</strong></div>`
      )
      .join('');
    const names = (ids) => listJoin(ids.map((id) => (P[id] ? P[id].name : 'Someone')));
    const card = (t, i) => {
      const p = P[t.holders[0]];
      const quip = t.holders.length ? t.quip.replace('{name}', names(t.holders)).replace('{value}', t.value) : '';
      return `<article class="trophy-card pc-${esc(p ? p.color : 'ink')} ${t.holders.length ? '' : 'is-locked'}" style="--i:${i}">
        <div class="trophy-medal" aria-hidden="true">${t.holders.length ? t.icon : '🔒'}</div>
        <div class="trophy-body">
          <h3>${esc(t.title)}</h3>
          ${
            t.holders.length
              ? `<div class="trophy-who">${t.holders.map((id) => avatar(P[id])).join('')}<span>${esc(names(t.holders))}</span><span class="trophy-value">${esc(t.value)}</span></div>
                 <p class="trophy-quip">${esc(quip)}</p>`
              : `<div class="trophy-who"><span class="muted">Up for grabs</span></div>`
          }
          <p class="trophy-how">${t.holders.length ? 'How it’s won: ' : 'How to win it: '}${esc(t.how)}</p>
        </div>
      </article>`;
    };
    return `
      <section class="game-head"><div class="game-title"><span class="eyebrow">${earned.length} of ${all.length} trophies handed out</span><h1>Trophy Room</h1>
        <p class="muted">Glory, shame and everything in between. Trophies move to whoever earns them, after every round.</p></div></section>
      ${shelfRows ? `<section class="panel"><div class="panel-head"><h2><span class="pip pip-yellow"></span>Trophy shelf</h2><span class="entry-hint">Who’s hoarding the hardware</span></div><div class="shelf">${shelfRows}</div></section>` : ''}
      <section class="trophies">${earned.map(card).join('')}</section>
      ${locked.length ? `<section class="panel"><div class="panel-head"><h2><span class="pip pip-wild"></span>Still up for grabs</h2><span class="entry-hint">${plural(locked.length, 'trophy').replace('trophys', 'trophies')} nobody has earned yet</span></div><div class="trophies">${locked.map(card).join('')}</div></section>` : ''}`;
  }

  /* ------------------------------------------------------------- GAME SETTINGS */
  function targetPicker(target, inputId) {
    const custom = target && !TARGETS.includes(target);
    return `<div class="seg" role="group" aria-label="Game ends at">${TARGETS.map(
      (t) => `<button type="button" data-action="set-target" data-for="${inputId}" data-target="${t || ''}" aria-pressed="${target === t}">${t || 'No limit'}</button>`
    ).join('')}
      <input type="number" min="1" step="1" inputmode="numeric" class="seg-input ${custom ? 'is-on' : ''}" id="${inputId}" placeholder="Other" value="${custom ? target : ''}" aria-label="Other end score"></div>`;
  }

  function openGameSettings() {
    const g = currentGame();
    if (!g) return;
    const draftS = { mode: g.mode, target: g.target };
    openModal(
      `${modalHead('Game settings', 'Changes apply to everyone at the table.')}
      <label class="field"><span>Game name</span><input type="text" id="gs-name" class="text-input" value="${esc(g.name)}" maxlength="60"></label>
      <div class="field"><span>Who wins?</span><div class="seg" role="group" aria-label="Who wins" id="gs-mode">
        <button type="button" data-mode="high" aria-pressed="${g.mode === 'high'}">Highest score</button>
        <button type="button" data-mode="low" aria-pressed="${g.mode === 'low'}">Lowest score</button></div></div>
      <div class="field"><span>Game ends at</span>${targetPicker(g.target, 'gs-target')}</div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="button" class="btn btn-red" id="gs-save">Save</button></div>`,
      {
        label: 'Game settings',
        onMount: (m) => {
          $('#gs-mode', m).addEventListener('click', (e) => {
            const b = e.target.closest('[data-mode]');
            if (!b) return;
            draftS.mode = b.dataset.mode;
            $$('[data-mode]', m).forEach((x) => x.setAttribute('aria-pressed', x === b));
          });
          m.addEventListener('target-change', (e) => (draftS.target = e.detail));
          $('#gs-save', m).addEventListener('click', () => {
            const name = $('#gs-name', m).value.trim() || g.name;
            closeModal();
            let done = null;
            commit((st) => {
              const game = st.games.find((x) => x.id === g.id);
              const modeChanged = game.mode !== draftS.mode;
              Object.assign(game, { name, mode: draftS.mode, target: draftS.target || null });
              if (modeChanged) game.rounds.forEach((r) => (r.winnerId = L.roundWinner(game, r.points)));
              const over = L.checkOver(game);
              if (over.over) {
                game.status = 'finished';
                game.winnerId = over.winnerId;
                game.draw = over.draw;
                game.finishedAt = Date.now();
                game.endLine = L.gameOverLine(game, names());
                done = game;
              }
            });
            if (done && role === 'local') showGameOver(done);
            toast('Game settings saved.');
          });
        },
      }
    );
  }

  function gameCard(g, P) {
    const st = L.standings(g);
    const max = Math.max(g.target || 0, ...st.map((s) => Math.abs(s.total)), 1);
    return `<article class="game-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="min-width:0"><h3>${esc(g.name)}</h3><span class="muted" style="font-size:.82rem;font-weight:700">${esc(new Date(g.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${plural(g.rounds.length, 'round')}</span></div>
        ${g.status === 'finished' ? (L.isDraw(g) ? '<span class="pill pill-done">🤝 Draw</span>' : '<span class="pill pill-done">Finished</span>') : g.status === 'paused' ? '<span class="pill pill-paused">⏸ Paused</span>' : '<span class="pill pill-live">Live</span>'}
      </div>
      <div class="mini-stand">${st
        .map(
          (row) =>
            `<div class="mini-row"><b>${row.rank}</b><span class="who">${avatar(P[row.id])}<span>${esc(P[row.id] ? P[row.id].name : '?')}${L.winnerOf(g) === row.id ? ' 🏆' : ''}</span></span><span class="num">${row.total}</span><div class="mini-bar pc-${esc(P[row.id] ? P[row.id].color : 'ink')}"><i style="width:${(Math.abs(row.total) / max) * 100}%"></i></div></div>`
        )
        .join('')}</div>
      <div class="btn-row">
        <button type="button" class="btn ${g.status === 'finished' ? 'btn-ink' : 'btn-red'} btn-small" data-action="open-game" data-game="${esc(g.id)}">Open</button>
        ${isAdmin() || inGame(g) ? `<button type="button" class="btn btn-ghost btn-small" data-action="delete-game" data-game="${esc(g.id)}" aria-label="Delete ${esc(g.name)}">Delete</button>` : ''}
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
      $$('.chart-box').forEach((b) => (b.innerHTML = '<div class="chart-fallback">Charts need an internet connection to load. Everything else works offline.</div>'));
      return;
    }
    const P = byId();
    const g = findGame(statsGameId);
    C.race($('#ch-race'), g, P);
    C.bump($('#ch-bump'), g, P);
    C.perRound($('#ch-rounds'), g, P);
    C.share($('#ch-share'), g, P);
    const stats = Object.values(L.playerStats(state)).filter((x) => x.rounds > 0);
    C.wins($('#ch-wins'), stats, P);
    C.radar($('#ch-radar'), stats.filter((x) => (compareIds || []).includes(x.id)), P);
  }

  /* ------------------------------------------------------------------ PLAYERS */
  function renderPlayers() {
    const stats = L.playerStats(state);
    const cards = [...state.players]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        const s = stats[p.id];
        return `<article class="roster-card">
          <div class="roster-top">${avatar(p, 'avatar-lg')}<div style="min-width:0;flex:1"><h3>${esc(p.name)} ${playerTag(p)}</h3><span class="muted" style="font-size:.8rem;font-weight:700">${s.lastPlayed ? `Last played ${esc(ago(s.lastPlayed))}` : 'Yet to play'}</span></div>
            ${canEditPlayer(p) ? `<button type="button" class="btn btn-ghost btn-small" data-action="edit-player" data-pid="${esc(p.id)}">Edit</button>` : ''}</div>
          <div class="roster-stats"><div><strong>${s.points}</strong><small>Points</small></div><div><strong>${s.wins}</strong><small>Wins</small></div><div><strong>${s.draws}</strong><small>Draws</small></div><div><strong>${s.losses}</strong><small>Losses</small></div></div>
        </article>`;
      })
      .join('');
    return `<section class="game-head"><div class="game-title"><span class="eyebrow">${plural(state.players.length, 'player')} saved</span><h1>Players</h1><p class="muted">${canManage() ? 'Friends appear here once they sign in and pick a username. Guests are players without a Claude account.' : 'Everyone who has a seat at this table.'}</p></div></section>
      <section class="panel" ${canManage() ? '' : 'hidden'}><form class="add-inline" id="roster-add"><input type="text" id="roster-new" class="text-input" placeholder="Guest name (no Claude account)" maxlength="24" aria-label="Guest player name" autocomplete="off"><button type="submit" class="btn btn-red">Add guest</button></form></section>
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
            if (p.account) {
              const problem = usernameProblem(nm, p.id);
              if (problem) return toast(problem);
            }
            p.name = nm.slice(0, 24);
            closeModal();
            commit((s) => (s.players = s.players.map((x) => (x.id === p.id ? p : x))));
            toast('Saved.');
          };
          $('#pe-save', m).addEventListener('click', save);
          $('#pe-name', m).addEventListener('keydown', (e) => e.key === 'Enter' && save());
          $('#pe-delete', m).addEventListener('click', () => {
            if (p.account && !isAdmin()) return toast('Players with a username can only be removed by the page owner.');
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
    return `<section class="panel"><div class="empty"><span class="empty-icon">${icon}</span><h2>${esc(title)}</h2><p>${esc(body)}</p>${action ? `<button type="button" class="btn btn-red" data-action="${action}">${esc(label)}</button>` : ''}</div></section>`;
  }

  function openBackup() {
    const json = JSON.stringify(state, null, 1);
    const where = HOSTED ? 'Scores are saved in this page for everyone with the link. Copy a backup to keep a spare.' : 'Scores are saved in this browser. Download a backup to move them to another device.';
    openModal(
      `${modalHead('Back up & restore', esc(where))}
      <div class="btn-row"><button type="button" class="btn btn-blue" id="bk-download" ${HOSTED ? 'hidden' : ''}>Download backup</button><button type="button" class="btn btn-ghost" id="bk-copy">Copy to clipboard</button></div>
      <label class="field"><span>Restore from a backup file</span><input type="file" id="bk-file" accept="application/json,.json"></label>
      <label class="field"><span>…or paste backup text</span><textarea id="bk-text" spellcheck="false"></textarea></label>
      <div class="btn-row" style="justify-content:space-between"><button type="button" class="btn btn-ghost" id="bk-wipe">Erase everything</button><button type="button" class="btn btn-red" id="bk-restore">Restore</button></div>`,
      {
        label: 'Backup',
        onMount: (m) => {
          const filename = `uno-tracker-${new Date().toISOString().slice(0, 10)}.json`;
          $('#bk-download', m).addEventListener('click', () => {
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
        game.draw = false;
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

  /* ---------------------------------------------------------------- identity */
  const playerTag = (p) => (p.id === me ? '<span class="pick-tag">you</span>' : p.account ? '' : '<span class="pick-tag">guest</span>');
  const canEditPlayer = (p) => isAdmin() || (ready() && (p.id === me || !p.account));

  function readClaim() {
    try {
      return localStorage.getItem(CLAIM_KEY);
    } catch (e) {
      return null;
    }
  }
  function writeClaim(pid) {
    try {
      localStorage.setItem(CLAIM_KEY, pid);
    } catch (e) {}
  }

  /** The player this viewer plays as: matched by Claude account, else by this device's earlier choice. */
  function resolveMe() {
    if (role !== 'editor') return null;
    if (accountId) {
      const p = state.players.find((x) => x.account && x.accountId === accountId);
      if (p) return p.id;
    }
    const claimed = readClaim();
    const p = claimed && state.players.find((x) => x.id === claimed && x.account && (!x.accountId || x.accountId === accountId));
    return p ? p.id : null;
  }

  function guardGame() {
    if (canEditGame(currentGame())) return true;
    toast('Only the players in this game can change its scores.');
    return false;
  }

  function usernameProblem(nm, exceptId) {
    if (nm.length < 2 || nm.length > 20) return 'Use 2 to 20 characters.';
    if (!/^[\p{L}\p{N}_. -]+$/u.test(nm)) return 'Use letters, numbers, spaces, dots, dashes or underscores.';
    const clash = state.players.find((p) => p.account && p.id !== exceptId && p.name.toLowerCase() === nm.toLowerCase());
    return clash ? 'That username is taken. Pick another one.' : null;
  }

  /** Required for everyone who can keep score: pick a username (or reclaim yours). */
  function openGate() {
    const claimable = state.players.filter((p) => p.account && !p.accountId);
    openModal(
      `<div class="modal-head"><div><span class="eyebrow">Welcome to the table</span><h2 style="margin-top:6px">Pick your username</h2>
        <p class="muted" style="margin-top:6px">You need one to keep score. It’s how your friends see you on the scoreboard, and it lets you change the scores of games you play in.</p></div></div>
      <form id="gate-form" class="field">
        <span>Username</span>
        <div class="add-inline"><input type="text" id="gate-name" class="text-input" maxlength="20" placeholder="e.g. Derrick" autocomplete="nickname" autofocus><button type="submit" class="btn btn-red">Join</button></div>
        <p class="entry-hint" id="gate-error" role="alert"></p>
      </form>
      ${
        claimable.length
          ? `<div class="field"><span>Already picked one on another device? Tap it.</span><div class="chips">${claimable
              .map((p) => `<button type="button" class="chip pc-${esc(p.color)}" data-action="claim-player" data-pid="${esc(p.id)}">${avatar(p)}<span>${esc(p.name)}</span></button>`)
              .join('')}</div></div>`
          : ''
      }`,
      {
        label: 'Pick your username',
        locked: true,
        onMount: (m) => {
          $('#gate-form', m).addEventListener('submit', (e) => {
            e.preventDefault();
            const nm = $('#gate-name', m).value.trim().replace(/\s+/g, ' ');
            const problem = usernameProblem(nm);
            if (problem) {
              $('#gate-error', m).textContent = problem;
              return $('#gate-name', m).focus();
            }
            if (state.isDemo) state = S.emptyState();
            // A guest with the same name becomes this account, keeping their stats.
            const guest = state.players.find((p) => !p.account && p.name.toLowerCase() === nm.toLowerCase());
            const p = guest ? { ...guest, name: nm } : newPlayer(nm);
            p.account = true;
            p.accountId = accountId;
            writeClaim(p.id);
            closeModal();
            commit((st) => {
              if (guest) st.players = st.players.map((x) => (x.id === p.id ? p : x));
              else st.players.push(p);
            });
            toast(`Welcome, ${nm}!`);
          });
        },
      }
    );
  }

  function claimPlayer(pid) {
    const p = byId()[pid];
    if (!p || !p.account || (p.accountId && p.accountId !== accountId)) return;
    writeClaim(pid);
    closeModal();
    if (accountId && !p.accountId) {
      commit((st) => (st.players = st.players.map((x) => (x.id === pid ? { ...x, accountId } : x))));
    } else {
      render();
    }
    toast(`Welcome back, ${p.name}!`);
  }

  /* -------------------------------------------------------------- page frame */
  function mountShell() {
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<header class="topbar">
  <div class="topbar-inner">
    <button class="brand" type="button" data-action="go" data-view="play" aria-label="Uno Tracker home">
      <span class="logo-oval"><span>UNO</span></span>
      <span class="brand-word">Tracker</span>
    </button>
    <nav class="tabs" aria-label="Sections">
      <button type="button" class="tab c-red" data-action="go" data-view="play"><span class="tab-glyph">▶</span>Games<span class="tab-count" id="live-count" hidden></span></button>
      <button type="button" class="tab c-yellow" data-action="go" data-view="stats"><span class="tab-glyph">★</span>Stats</button>
      <button type="button" class="tab c-wild" data-action="go" data-view="points"><span class="tab-glyph">#</span>Points</button>
      <button type="button" class="tab c-blue" data-action="go" data-view="trophies"><span class="tab-glyph">🏆</span>Trophies</button>
      <button type="button" class="tab c-green" data-action="go" data-view="players"><span class="tab-glyph">☺</span>Players</button>
    </nav>
    <div class="top-actions">
      <span id="sync-chip" class="sync-chip"></span>
      <button type="button" class="icon-btn" id="mute-btn" data-action="mute" aria-label="Toggle sound">🔊</button>
      <button type="button" class="icon-btn" id="backup-btn" data-action="backup" aria-label="Back up or restore data">⇅</button>
    </div>
  </div>
</header>
<div id="demo-banner" class="demo-banner" hidden>
  <span><strong>Demo game night.</strong> These players and scores are examples so you can see how it works.</span>
  <button type="button" class="btn btn-small btn-ink" data-action="clear-demo">Clear demo and start fresh</button>
</div>
<main id="view" class="wrap" tabindex="-1"></main>
<footer class="foot wrap"><span>Card values: numbers = face value · Skip, Reverse, Draw Two = 20 · Wild, Wild Draw Four = 50</span></footer>
<div id="modal-root"></div>
<div id="toast-root" class="toast-root" aria-live="polite"></div>
<div id="saving" class="saving" hidden><span>Saving scores for everyone…</span></div>
<canvas id="fx" aria-hidden="true"></canvas>`
    );
  }

  /* After a reload (a new version of the hosted page), put the viewer back where they were. */
  const bootUi = S.readUi();

  function restoreUi() {
    if (!bootUi) return;
    if (['play', 'stats', 'points', 'trophies', 'players'].includes(bootUi.view)) view = bootUi.view;
    if (bootUi.focus === 'new' || (bootUi.focus && findGame(bootUi.focus))) focus = bootUi.focus;
    if (bootUi.replay) {
      pendingReplay = bootUi.replay;
      replayTries = bootUi.replayTries || 1;
    }
    compareIds = bootUi.compareIds || null;
    statsGameId = bootUi.statsGameId || null;
    if (bootUi.setup) setup = { ...bootUi.setup, sel: new Set(bootUi.setup.sel || []) };
    if (bootUi.draft && state.games.some((g) => g.id === bootUi.draft.gameId)) draft = bootUi.draft;
  }

  /* Celebrate what changed since this tab last saw the page: a new round or a finished game. */
  function afterBoot() {
    if (!bootUi) return;
    if (bootUi.scrollY) requestAnimationFrame(() => window.scrollTo(0, bootUi.scrollY));
    if (bootUi.flash) toast(bootUi.flash);
    const before = bootUi.seen;
    const now = seenOf(state);
    if (!HOSTED || !before || !now) return;
    const g = currentGame();
    if (now.gameId !== before.gameId) {
      if (!now.rounds) toast('A new game just started!');
      return;
    }
    if (now.status === 'finished' && before.status !== 'finished') {
      setTimeout(() => showGameOver(g), 300);
      return;
    }
    if (now.rounds > before.rounds) {
      const r = g.rounds[g.rounds.length - 1];
      justScored = r.points;
      render();
      FX.sound('round');
      const card = r.winnerId && $(`.pcard[data-pid="${r.winnerId}"]`);
      if (card) {
        const box = card.getBoundingClientRect();
        FX.confetti({ x: box.left + box.width / 2, y: box.top + box.height / 3, count: 40, spread: 0.6 });
      }
      const top = L.standings(g)[0];
      const leader = byId()[top.id];
      toast(`Round ${g.rounds.length} is in! ${leader ? leader.name : 'Someone'} leads with ${top.total}.`);
    }
  }

  /* ---------------------------------------------------------------- actions */
  const actions = {
    go: (el) => {
      view = el.dataset.view;
      if (view === 'play') focus = null;
      render();
      window.scrollTo({ top: 0, behavior: FX.reduced() ? 'auto' : 'smooth' });
    },
    'go-play': () => {
      view = 'play';
      focus = canManage() ? 'new' : null;
      render();
    },
    'go-hub': () => {
      view = 'play';
      focus = null;
      draft = null;
      render();
      window.scrollTo({ top: 0 });
    },
    'pause-game': (el) => {
      const g = findGame(el.dataset.game);
      if (!g || g.status !== 'active' || !canEditGame(g)) return;
      draft = null;
      if (focus === g.id) focus = null;
      view = 'play';
      commit((st) => {
        const game = st.games.find((x) => x.id === g.id);
        game.status = 'paused';
        game.pausedAt = Date.now();
      });
      toast(`“${g.name}” is paused. Pick it back up from Tables any time.`);
    },
    'resume-game': (el) => {
      const g = findGame(el.dataset.game);
      if (!g || g.status !== 'paused' || !canEditGame(g)) return;
      focus = g.id;
      view = 'play';
      commit((st) => {
        const game = st.games.find((x) => x.id === g.id);
        game.status = 'active';
        game.resumedAt = Date.now();
      });
      toast('Back in action! Deal ’em.');
    },
    'close-modal': closeModal,
    mute: () => {
      FX.toggleMute();
      renderSync();
      FX.sound('click');
    },
    backup: () => isAdmin() && openBackup(),
    'clear-demo': () =>
      confirmModal({
        title: 'Clear the demo?',
        body: 'The example players and games will be removed so you can start your own.',
        ok: 'Clear demo',
        onOk: () => {
          state = S.emptyState();
          draft = setup = null;
          view = 'play';
          focus = 'new';
          commit(() => {});
          const input = $('#setup-new');
          input && input.focus();
        },
      }),
    'toggle-pick': (el) => {
      const s = ensureSetup();
      if (el.dataset.pid === me && !isAdmin() && s.sel.has(me)) return toast('You’re keeping score, so you’re in this game.');
      s.sel.has(el.dataset.pid) ? s.sel.delete(el.dataset.pid) : s.sel.add(el.dataset.pid);
      FX.sound('click');
      render();
    },
    'set-mode': (el) => {
      ensureSetup().mode = el.dataset.mode;
      render();
    },
    'set-target': (el) => {
      const t = el.dataset.target ? Number(el.dataset.target) : null;
      if (el.dataset.for === 'gs-target') {
        const group = el.closest('.seg');
        $$('[data-target]', group).forEach((b) => b.setAttribute('aria-pressed', b === el));
        const input = $('.seg-input', group);
        input.value = '';
        input.classList.remove('is-on');
        el.dispatchEvent(new CustomEvent('target-change', { bubbles: true, detail: t }));
        return;
      }
      ensureSetup().target = t;
      render();
    },
    'start-game': () => {
      const s = ensureSetup();
      if (me && !isAdmin()) s.sel.add(me);
      const ids = state.players.filter((p) => s.sel.has(p.id)).map((p) => p.id);
      if (ids.length < 2) return toast('Pick at least 2 players.');
      const opts = { name: (s.name || '').trim(), mode: s.mode, target: s.target };
      const busy = state.games.filter((g) => g.status === 'active' && g.playerIds.some((id) => ids.includes(id)));
      if (!busy.length) {
        startGame(ids, opts);
        return toast('Cards are dealt. Good luck!');
      }
      const P = byId();
      const lines = busy
        .map((g) => `<li><strong>${esc(g.name)}</strong>: ${esc(listJoin(g.playerIds.filter((id) => ids.includes(id)).map((id) => (P[id] ? P[id].name : '?'))))} ${g.playerIds.filter((id) => ids.includes(id)).length === 1 ? 'is' : 'are'} still playing</li>`)
        .join('');
      const pausable = busy.filter((g) => canEditGame(g));
      openModal(
        `${modalHead('Some players are mid-game')}
        <ul class="busy-list">${lines}</ul>
        <p class="muted">${pausable.length ? 'Pause that game so you can pick it up later, or keep both going at once.' : 'You can keep both going at once.'}</p>
        <div class="btn-row" style="justify-content:flex-end">
          <button type="button" class="btn btn-ghost" id="busy-both">Keep both going</button>
          ${pausable.length ? `<button type="button" class="btn btn-red" id="busy-pause">Pause ${pausable.length === 1 ? 'it' : 'them'} and start</button>` : ''}
        </div>`,
        {
          label: 'Players mid-game',
          onMount: (m) => {
            $('#busy-both', m).addEventListener('click', () => {
              closeModal();
              startGame(ids, opts);
              toast('Cards are dealt. Two tables on the go!');
            });
            const pb = $('#busy-pause', m);
            pb &&
              pb.addEventListener('click', () => {
                closeModal();
                const ids2 = pausable.map((g) => g.id);
                commit(
                  (st) =>
                    st.games.forEach((g) => {
                      if (ids2.includes(g.id)) {
                        g.status = 'paused';
                        g.pausedAt = Date.now();
                      }
                    }),
                  { render: false }
                );
                startGame(ids, opts);
                toast(`Paused ${listJoin(pausable.map((g) => `“${g.name}”`))}. New game dealt!`);
              });
          },
        }
      );
    },
    'new-game': () => {
      closeModal();
      if (!canManage()) return;
      setup = null;
      draft = null;
      focus = 'new';
      view = 'play';
      render();
      window.scrollTo({ top: 0 });
    },
    'play-again': (el) => {
      const g = findGame(el.dataset.game);
      closeModal();
      if (!g || !canEditGame(g)) return;
      startGame(g.playerIds.filter((id) => byId()[id]), { mode: g.mode, target: g.target });
      toast('Rematch! Same players, fresh deck.');
    },
    'open-game': (el) => {
      if (!findGame(el.dataset.game)) return;
      draft = null;
      focus = el.dataset.game;
      view = 'play';
      render();
      window.scrollTo({ top: 0 });
    },
    'delete-game': (el) => {
      const g = findGame(el.dataset.game);
      if (!g || !(isAdmin() || inGame(g))) return;
      confirmModal({
        title: `Delete “${g.name}”?`,
        body: `This removes ${plural(g.rounds.length, 'round')} and their stats for good.`,
        ok: 'Delete game',
        onOk: () =>
          {
            if (focus === g.id) focus = null;
            commit((s) => (s.games = s.games.filter((x) => x.id !== g.id)));
          },
      });
    },
    'submit-round': () => guardGame() && submitRound(),
    'cancel-edit': () => {
      draft = null;
      render();
    },
    'edit-round': (el) => {
      if (!guardGame()) return;
      const g = currentGame();
      const r = g && g.rounds.find((x) => x.id === el.dataset.round);
      if (!r) return;
      draft = { gameId: g.id, editingId: r.id, points: { ...(r.points || {}) } };
      render();
      const panel = $('#entry-panel');
      panel && panel.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'start' });
    },
    'delete-round': (el) => guardGame() && deleteRound(el.dataset.round),
    'finish-game': () => {
      if (!guardGame()) return;
      const g = currentGame();
      if (!g || !g.rounds.length) return;
      const top = L.standings(g)[0];
      const p = byId()[top.id];
      confirmModal({
        title: 'Finish the game?',
        body: L.tiedAtTop(g)
          ? `It’s level at ${esc(scoreline(g))}, so it goes down as a draw. Nobody wins and nobody loses.`
          : `${esc(p ? p.name : 'The leader')} wins with ${plural(top.total, 'point')}.`,
        ok: 'Finish game',
        okClass: 'btn-green',
        onOk: () => finishGame(g),
      });
    },
    'quit-game': () => {
      if (!guardGame()) return;
      const g = currentGame();
      if (!g || g.status === 'finished') return;
      confirmModal({
        title: 'Quit this game?',
        body: `“${esc(g.name)}” and its ${plural(g.rounds.length, 'round')} will be thrown away. Nothing from it counts towards wins, points, stats or trophies.`,
        ok: 'Quit and discard',
        onOk: () => {
          draft = null;
          setup = null;
          focus = null;
          commit((st) => (st.games = st.games.filter((x) => x.id !== g.id)));
          toast('Game discarded. It never happened.');
        },
      });
    },
    'add-to-game': () => guardGame() && openAddToGame(),
    'game-settings': () => guardGame() && openGameSettings(),
    'compare-toggle': (el) => {
      const id = el.dataset.pid;
      const cur = compareIds || [];
      if (cur.includes(id)) {
        if (cur.length > 1) compareIds = cur.filter((x) => x !== id);
      } else compareIds = [...cur, id].slice(-4);
      render();
    },
    'claim-player': (el) => claimPlayer(el.dataset.pid),
    'edit-player': (el) => canEditPlayer(byId()[el.dataset.pid] || {}) && openPlayerEditor(el.dataset.pid),
  };

  // "Other" end score: typed into the box next to the presets.
  document.addEventListener('input', (e) => {
    const input = e.target.closest && e.target.closest('.seg-input');
    if (!input) return;
    const v = Math.round(Number(input.value));
    const t = v > 0 ? v : null;
    const group = input.closest('.seg');
    $$('[data-target]', group).forEach((b) => b.setAttribute('aria-pressed', String(!t && b.dataset.target === '')));
    input.classList.toggle('is-on', !!t);
    if (input.id === 'setup-target') ensureSetup().target = t;
    else input.dispatchEvent(new CustomEvent('target-change', { bubbles: true, detail: t }));
  });

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

  mountShell();
  restoreUi();
  loadedSeen = seenOf(state);
  render();
  afterBoot();
  // A reload can land before this view's save went out (another table saved first): keep the change.
  addEventListener('pagehide', () => {
    const diff = dirty ? diffFromBaseline() : null;
    stash(diff && replayTries < 3 ? { replay: diff, replayTries: replayTries + 1 } : {});
  });

  if (HOSTED) {
    Promise.all([window.claude.use('user'), window.claude.use('artifact')])
      .then(async ([user, art]) => {
        let editor = false;
        try {
          editor = !!(user && art && (await user.canEdit()));
          isOwnerView = !!(user && (await user.isOwner()));
          accountId = (user && (await user.id())) || null;
        } catch (e) {}
        artifactApi = art;
        role = editor ? 'editor' : 'viewer';
        if (editor && !EMBEDDED) {
          state = window.UnoDemo.build(L); // brand-new page: show the demo until the first change
          baseline = null;
        }
        const replay = editor && EMBEDDED ? pendingReplay : null;
        pendingReplay = null;
        if (replay) {
          // Another table saved at the same moment as this one: put this view's changes back on top.
          const before = JSON.stringify(state);
          applyReplay(replay);
          if (JSON.stringify(state) !== before) {
            dirty = true;
            schedulePublish();
            toast('Another table saved at the same moment. Your change is being saved again.');
          }
        } else {
          replayTries = 0;
        }
        render();
      })
      .catch(() => {
        role = 'viewer';
        render();
      });
  }
})();
