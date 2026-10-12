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
  let statsGameId = null;
  let compareIds = null;
  let draft = null;
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
  const mode = (g) => L.MODES[g.mode] || L.MODES.classic;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const isEditing = (g) => !!(g && draft && draft.gameId === g.id && draft.editingId);
  const showEntry = (g) => g.status !== 'finished' || isEditing(g);

  function ago(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const avatar = (p, cls = '') => `<span class="avatar pc-${esc((p && p.color) || 'ink')} ${cls}" style="background:var(--pc)">${esc((p && p.emoji) || '❔')}</span>`;
  const who = (p) => `<span class="who">${avatar(p)}<span>${esc(p ? p.name : 'Unknown')}</span></span>`;

  function commit(mutate, opts = {}) {
    mutate(state);
    if (!S.save(state)) toast('Could not save on this device. Use Back up to keep a copy.');
    if (opts.render !== false) render();
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
    setTimeout(() => el.remove(), action ? 7000 : 3200);
  }

  /* ------------------------------------------------------------------- modals */
  let modalCleanup = null;
  function openModal(html, { wide = false, onMount, label = 'Dialog' } = {}) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div></div>`;
    const back = $('[data-modal-backdrop]', root);
    back.addEventListener('mousedown', (e) => {
      if (e.target === back) closeModal();
    });
    const onKey = (e) => e.key === 'Escape' && closeModal();
    document.addEventListener('keydown', onKey);
    modalCleanup = () => document.removeEventListener('keydown', onKey);
    const modal = $('.modal', root);
    if (onMount) onMount(modal);
    const focusable = $('[autofocus]', modal) || $('input, button:not(.modal-close)', modal);
    focusable && focusable.focus();
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
    const el = $('#view');
    const views = { play: renderPlay, stats: renderStats, fame: renderFame, history: renderHistory, players: renderPlayers };
    el.innerHTML = (views[view] || renderPlay)();
    const after = { play: afterPlay, stats: afterStats, fame: afterFame }[view];
    after && after();
    justScored = null;
  }

  function renderSync() {
    const chip = $('#sync-chip');
    chip.classList.toggle('is-cloud', S.mode === 'cloud');
    chip.classList.toggle('is-readonly', S.mode === 'readonly');
    chip.textContent = S.mode === 'cloud' ? '● Live sync on' : S.mode === 'readonly' ? 'View only' : 'Saved on this device';
    chip.title =
      S.mode === 'cloud'
        ? 'Scores sync to everyone who opens this tracker'
        : S.mode === 'readonly'
          ? 'You can watch the scores but not change them'
          : 'Scores are saved in this browser. Use Back up to move them.';
    $('#mute-btn').textContent = FX.muted ? '🔇' : '🔊';
  }

  /* --------------------------------------------------------------------- PLAY */
  function renderPlay() {
    const g = currentGame();
    if (!g) return renderNoGame();
    const st = L.standings(g);
    const P = byId();
    const m = mode(g);
    const finished = g.status === 'finished';
    const roundNo = g.rounds.length + 1;
    const deal = dealtFor !== g.id;
    dealtFor = g.id;
    const last = g.rounds[g.rounds.length - 1];
    const topTie = st.length > 1 && st[0].total === st[1].total;

    const cards = st
      .map((row, i) => {
        const p = P[row.id];
        const pct = Math.min(100, (row.total / g.target) * 100);
        const md = L.mood(g, row.id);
        const delta = last && last.points ? last.points[row.id] : 0;
        const fresh = justScored && justScored[row.id];
        const lead = row.rank === 1 && g.rounds.length && !topTie;
        return `<article class="pcard pc-${esc(p ? p.color : 'ink')} ${lead ? 'is-leader' : ''}" style="--i:${i};${deal ? '' : 'animation:none'}" data-pid="${esc(row.id)}">
          ${lead ? `<span class="pcard-crown" aria-hidden="true">${finished ? '🏆' : '👑'}</span>` : ''}
          <div class="pcard-top"><span class="pcard-name" title="${esc(p && p.name)}">${esc(p ? p.name : '?')}</span><span class="pcard-rank" title="Rank">${row.rank}</span></div>
          <div class="pcard-oval"><div class="pcard-oval-inner"><span class="pcard-emoji">${esc(p ? p.emoji : '❔')}</span><span class="pcard-score ${fresh ? 'bump' : ''}">${row.total}</span></div></div>
          <div class="pcard-bar" title="${Math.round(pct)}% of ${g.target}"><i style="width:${pct}%"></i></div>
          <div class="pcard-foot"><span class="num">${row.total} / ${g.target}</span><span>${row.roundsWon} 🏆</span></div>
          <span class="pcard-mood">${md.icon} ${esc(md.text)}</span>
          ${delta ? `<span class="pcard-delta ${fresh ? 'flash' : ''}">+${delta}</span>` : ''}
        </article>`;
      })
      .join('');

    return `
      <section class="game-head">
        <div class="game-title">
          <span class="eyebrow">${finished ? 'Final scores' : g.rounds.length ? `Now playing · Round ${roundNo}` : 'Fresh deck · Round 1'}</span>
          <h1>${esc(g.name)}</h1>
          <div class="game-meta">
            ${finished ? `<span class="pill pill-done">🏆 ${esc(P[g.winnerId] ? P[g.winnerId].name : '')} won</span>` : '<span class="pill pill-live">Live</span>'}
            <span class="pill">${esc(m.label)} · ${g.mode === 'lowball' ? 'limit' : 'target'} ${g.target}</span>
            <span class="pill">${plural(g.rounds.length, 'round')}</span>
            <span class="pill">Started ${esc(ago(g.createdAt))}</span>
          </div>
        </div>
        <div class="btn-row">
          <button type="button" class="uno-shout" data-action="uno" aria-label="Shout UNO">UNO!</button>
          <div class="btn-row" style="flex-direction:column;align-items:stretch">
            ${
              finished
                ? `<button type="button" class="btn btn-green" data-action="rematch" data-game="${esc(g.id)}">Rematch</button>
                   <button type="button" class="btn btn-ghost btn-small" data-action="new-game">New game</button>`
                : `<button type="button" class="btn btn-ghost btn-small" data-action="add-to-game">+ Add player</button>
                   <button type="button" class="btn btn-ghost btn-small" data-action="undo-round" ${g.rounds.length ? '' : 'disabled'}>↶ Undo last round</button>
                   <button type="button" class="btn btn-ghost btn-small" data-action="end-game" ${g.rounds.length ? '' : 'disabled'}>End game</button>`
            }
          </div>
        </div>
      </section>
      ${renderTicker(g)}
      <section class="board" aria-label="Scoreboard">${cards}</section>
      <div class="grid-2">
        <section class="panel" id="entry-panel">${showEntry(g) ? renderEntry(g) : renderFinishedPanel(g)}</section>
        <section class="panel">${renderFeed(g)}</section>
      </div>
      <section class="panel">${renderScorecard(g)}</section>`;
  }

  function renderNoGame() {
    const recent = [...state.games].sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt)).slice(0, 3);
    const P = byId();
    const fan = [
      ['var(--red)', 'var(--red-deep)', '-24deg', '7'],
      ['var(--yellow)', 'var(--yellow-deep)', '-8deg', '+2'],
      ['var(--green)', 'var(--green-deep)', '8deg', '⇄'],
      ['var(--blue)', 'var(--blue-deep)', '24deg', '0'],
    ]
      .map(([c, cd, r, t]) => `<div class="fan-card" style="--c:${c};--cd:${cd};--r:${r}"><span>${t}</span></div>`)
      .join('');
    return `
      <section class="hero">
        <div>
          <span class="eyebrow">No game on the table</span>
          <h1 style="margin-top:8px">Shuffle up. Somebody is about to get a Draw Four.</h1>
          <p>Add the players, pick how you score, then enter each round's points. The tracker keeps the totals, crowns the winner and roasts whoever is holding all the cards.</p>
          <div class="btn-row">
            <button type="button" class="btn btn-red btn-big" data-action="new-game">Deal a new game</button>
            <button type="button" class="btn btn-ghost btn-big" data-action="rules">How scoring works</button>
          </div>
        </div>
        <div class="fan" aria-hidden="true">${fan}</div>
      </section>
      ${
        recent.length
          ? `<section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Recent games</h2><button type="button" class="link-btn" data-action="go" data-view="history">See all</button></div>
             <div class="games">${recent.map((g) => gameCard(g, P)).join('')}</div></section>`
          : ''
      }`;
  }

  function renderTicker(g) {
    const P = byId();
    const st = L.standings(g);
    const items = [];
    if (g.endLine) items.push(g.endLine);
    [...g.rounds].reverse().slice(0, 4).forEach((r) => (r.comments || []).forEach((c) => items.push(c)));
    if (st.length && g.rounds.length) {
      const top = P[st[0].id];
      if (g.mode === 'lowball') {
        const danger = [...st].sort((a, b) => b.total - a.total)[0];
        items.push(`${top ? top.name : '?'} is the safest at ${st[0].total}`);
        items.push(`${P[danger.id] ? P[danger.id].name : '?'} is ${Math.max(0, g.target - danger.total)} from the limit`);
      } else {
        items.push(`${top ? top.name : '?'} leads with ${st[0].total}`);
        if (g.status !== 'finished') items.push(`${top ? top.name : '?'} needs ${Math.max(0, g.target - st[0].total)} more to win`);
      }
    }
    if (!items.length) items.push('Cards are dealt. Waiting for the first round…', `${g.playerIds.length} players at the table`, `First to ${g.target}`);
    const dur = Math.max(18, items.join(' ').length / 6);
    return `<div class="ticker" role="marquee" aria-label="Latest commentary"><span class="ticker-label">UNO NEWS</span><div class="ticker-track"><div class="ticker-move" style="--dur:${dur}s">${items.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div></div>`;
  }

  /* -------------------------------------------------------------- round entry */
  function freshDraft(g) {
    const playing = {};
    g.playerIds.forEach((id) => (playing[id] = true));
    return { gameId: g.id, editingId: null, playing, winnerId: null, hands: {}, points: {} };
  }

  function ensureDraft(g) {
    if (!draft || draft.gameId !== g.id) draft = freshDraft(g);
    g.playerIds.forEach((id) => id in draft.playing || (draft.playing[id] = true));
    return draft;
  }

  function draftEntry(g) {
    const d = ensureDraft(g);
    const playerIds = g.playerIds.filter((id) => d.playing[id]);
    return { playerIds, winnerId: d.winnerId && d.playing[d.winnerId] ? d.winnerId : null, hands: d.hands, points: d.points };
  }

  function renderEntry(g) {
    const d = ensureDraft(g);
    const P = byId();
    const m = mode(g);
    const totals = L.totals(g);
    const entry = draftEntry(g);
    const preview = L.roundPoints(g.mode, entry);
    const editingIdx = d.editingId ? g.rounds.findIndex((r) => r.id === d.editingId) : -1;
    const title = editingIdx >= 0 ? `Editing round ${editingIdx + 1}` : `Round ${g.rounds.length + 1}`;
    const hint = m.usesHands ? 'Tap who went out, then enter the points left in everyone else’s hand.' : 'Enter the points each player scored this round.';

    const rows = g.playerIds
      .map((id) => {
        const p = P[id];
        const on = !!d.playing[id];
        const isW = entry.winnerId === id;
        let right;
        if (m.usesHands && isW) {
          right = `<div class="winner-take num" aria-live="polite">${g.mode === 'classic' ? `+${preview[id] || 0}` : '0 ✨'}</div>`;
        } else {
          const val = m.usesHands ? d.hands[id] : d.points[id];
          right = `<div class="entry-points">
            <input type="number" inputmode="numeric" min="${m.usesHands ? 0 : ''}" step="1" id="pts-${esc(id)}" data-pid="${esc(id)}" data-field="${m.usesHands ? 'hands' : 'points'}" value="${val == null ? '' : esc(val)}" placeholder="0" aria-label="${esc(p ? p.name : '')} ${m.usesHands ? 'points in hand' : 'points'}">
            ${m.usesHands ? `<button type="button" class="calc-btn" data-action="calc" data-pid="${esc(id)}" title="Count the cards" aria-label="Count ${esc(p ? p.name : '')}’s cards">🧮</button>` : ''}
          </div>`;
        }
        return `<div class="entry-row ${isW ? 'is-winner' : ''} ${on ? '' : 'is-out'}">
          <button type="button" class="sit-toggle" data-action="toggle-sit" data-pid="${esc(id)}" aria-pressed="${on}" title="${on ? 'Playing this round (tap to sit out)' : 'Sitting out (tap to deal in)'}">${on ? '✓' : ''}</button>
          <span class="who">${avatar(p)}<span class="entry-name"><strong>${esc(p ? p.name : '?')}</strong><small class="num">${totals[id]} pts</small></span></span>
          <button type="button" class="went-out" data-action="set-winner" data-pid="${esc(id)}" aria-pressed="${isW}" ${on ? '' : 'disabled'}>${isW ? '🏆 Went out' : m.usesHands ? 'Went out?' : '⭐ Best?'}</button>
          ${right}
        </div>`;
      })
      .join('');

    return `
      <div class="panel-head"><h2><span class="pip pip-red"></span>${esc(title)}</h2><button type="button" class="link-btn" data-action="rules">Card values</button></div>
      <p class="entry-hint" style="margin-bottom:12px">${esc(hint)}</p>
      <div class="entry-list">${rows}</div>
      <div class="entry-summary">
        <span class="entry-hint" id="entry-preview">${previewText(g)}</span>
        <div class="btn-row">
          ${editingIdx >= 0 ? '<button type="button" class="btn btn-ghost" data-action="cancel-edit">Cancel</button>' : ''}
          <button type="button" class="btn btn-red btn-big" data-action="submit-round">${editingIdx >= 0 ? 'Save round' : 'Lock in round'}</button>
        </div>
      </div>`;
  }

  function previewText(g) {
    const entry = draftEntry(g);
    const P = byId();
    const m = mode(g);
    const pts = L.roundPoints(g.mode, entry);
    if (entry.playerIds.length < 2) return 'At least two players need to be dealt in.';
    if (m.usesHands && !entry.winnerId) return 'Who went out? Tap their “Went out?” button.';
    const nm = (id) => esc(P[id] ? P[id].name : '?');
    if (g.mode === 'classic') return `🏆 <strong>${nm(entry.winnerId)}</strong> collects <strong class="num">${pts[entry.winnerId]}</strong> points`;
    if (g.mode === 'lowball') {
      const hits = entry.playerIds.filter((id) => pts[id] > 0).map((id) => `${nm(id)} +${pts[id]}`);
      return hits.length ? `Damage report: ${hits.join(', ')}` : 'A clean round. Nobody takes points.';
    }
    const sum = entry.playerIds.reduce((s, id) => s + pts[id], 0);
    return `Points this round: <strong class="num">${sum}</strong>`;
  }

  function rerenderEntry() {
    const g = currentGame();
    const panel = $('#entry-panel');
    if (!g || !panel || !showEntry(g)) return;
    const focusedId = document.activeElement && document.activeElement.id;
    panel.innerHTML = renderEntry(g);
    if (focusedId) {
      const f = document.getElementById(focusedId);
      f && f.focus();
    }
  }

  function submitRound() {
    const g = currentGame();
    if (!g || !showEntry(g)) return;
    const wasFinished = g.status === 'finished';
    const m = mode(g);
    const entry = draftEntry(g);
    if (entry.playerIds.length < 2) return toast('Deal in at least two players.');
    if (m.usesHands && !entry.winnerId) {
      $('#entry-panel').classList.add('shake');
      setTimeout(() => $('#entry-panel') && $('#entry-panel').classList.remove('shake'), 500);
      return toast('Tap who went out first.');
    }
    const points = L.roundPoints(g.mode, entry);
    const hands = {};
    if (m.usesHands) entry.playerIds.forEach((id) => id !== entry.winnerId && (hands[id] = Math.max(0, Math.round(Number(entry.hands[id]) || 0))));
    const editingId = draft.editingId;
    let nowOver = null;
    commit(
      (s) => {
        const game = s.games.find((x) => x.id === g.id);
        const round = { id: editingId || uid(), at: Date.now(), playerIds: entry.playerIds, winnerId: entry.winnerId, hands, points };
        let idx;
        if (editingId) {
          idx = game.rounds.findIndex((r) => r.id === editingId);
          round.at = game.rounds[idx].at;
          game.rounds[idx] = round;
        } else {
          game.rounds.push(round);
          idx = game.rounds.length - 1;
        }
        round.comments = L.commentary(game, idx, names());
        if (editingId) round.comments.unshift(`Round ${idx + 1} was re-scored. The judges have spoken.`);
        const over = L.checkOver(game);
        if (over.over) {
          const sameWinner = wasFinished && game.winnerId === over.winnerId;
          game.status = 'finished';
          game.winnerId = over.winnerId;
          game.finishedAt = sameWinner ? game.finishedAt : Date.now();
          if (!sameWinner) {
            game.endLine = L.gameOverLine(game, names());
            nowOver = game;
          }
        } else if (game.status === 'finished') {
          game.status = 'active';
          game.winnerId = null;
          game.finishedAt = null;
          game.endLine = null;
        }
      },
      { render: false }
    );
    justScored = points;
    draft = freshDraft(currentGame());
    render();
    FX.sound('round');
    const winCard = entry.winnerId && $(`.pcard[data-pid="${entry.winnerId}"]`);
    if (winCard) {
      const r = winCard.getBoundingClientRect();
      FX.confetti({ x: r.left + r.width / 2, y: r.top + r.height / 3, count: 50, spread: 0.6 });
    }
    if (!nowOver) toast(editingId ? 'Round updated.' : `Round ${currentGame().rounds.length} locked in.`);
    if (nowOver) setTimeout(() => showGameOver(nowOver), 450);
  }

  /* ------------------------------------------------------------------- feed */
  function renderFeed(g) {
    const P = byId();
    const items = [];
    const notesAfter = {};
    (g.aiNotes || []).forEach((n) => (notesAfter[n.after] = notesAfter[n.after] || []).push(n));
    if (g.endLine) items.push(`<div class="feed-item"><span class="feed-badge is-end">🏁</span><div class="feed-body"><p class="feed-line"><strong>${esc(g.endLine)}</strong></p><span class="feed-when">${esc(ago(g.finishedAt))}</span></div></div>`);
    for (let i = g.rounds.length; i >= 0; i--) {
      (notesAfter[i] || [])
        .slice()
        .reverse()
        .forEach((n) =>
          items.push(`<div class="feed-item"><span class="feed-badge" style="background:var(--card-ink)">🎙</span><div class="feed-body"><p class="feed-line is-ai">${esc(n.text)}</p><span class="feed-when">Claude’s hot take · ${esc(ago(n.at))}</span></div></div>`)
        );
      if (i === 0) break;
      const r = g.rounds[i - 1];
      const lines = (r.comments && r.comments.length ? r.comments : [`Round ${i} is in the books.`]).map((c) => `<p class="feed-line">${esc(c)}</p>`).join('');
      items.push(`<div class="feed-item"><span class="feed-badge" style="background:${C.colorOf(P[r.winnerId])}">R${i}</span><div class="feed-body">${lines}<span class="feed-when">${esc(ago(r.at))}</span></div></div>`);
    }
    const ppl = g.playerIds.map((id) => (P[id] ? P[id].name : '?'));
    items.push(
      `<div class="feed-item"><span class="feed-badge" style="background:var(--green)">🃏</span><div class="feed-body"><p class="feed-line">Cards are dealt! ${esc(listJoin(ppl))} take their seats. ${esc(mode(g).label)} rules, ${g.mode === 'lowball' ? 'limit' : 'first to'} ${g.target}.</p><span class="feed-when">${esc(ago(g.createdAt))}</span></div></div>`
    );
    return `<div class="panel-head"><h2><span class="pip pip-yellow"></span>Play-by-play</h2>
        ${sample && g.rounds.length ? `<button type="button" class="btn btn-ink btn-small" data-action="ai-take" id="ai-btn">🎙 Ask Claude for a hot take</button>` : ''}</div>
      <div class="feed">${items.join('')}</div>`;
  }
  const listJoin = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

  async function aiTake() {
    const g = currentGame();
    if (!g || !sample) return;
    const btn = $('#ai-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '🎙 Warming up the mic…';
    }
    const P = byId();
    const nm = (id) => (P[id] ? P[id].name : '?');
    const st = L.standings(g)
      .map((r) => `${r.rank}. ${nm(r.id)}: ${r.total} pts, ${r.roundsWon} rounds won, current streak ${L.currentStreak(g, r.id)}`)
      .join('\n');
    const recent = g.rounds
      .slice(-5)
      .map((r, i, arr) => {
        const n = g.rounds.length - arr.length + i + 1;
        const hands = Object.entries(r.hands || {}).map(([id, h]) => `${nm(id)} held ${h}`).join(', ');
        return `Round ${n}: ${r.winnerId ? nm(r.winnerId) + ' went out' : 'no winner marked'}; points ${Object.entries(r.points || {}).map(([id, p]) => `${nm(id)} +${p}`).join(', ')}${hands ? '; ' + hands : ''}`;
      })
      .join('\n');
    const prompt = `You are a hyped-up, good-natured sports commentator calling a family game of Uno.
Game: "${g.name}". Mode: ${mode(g).label} (${mode(g).blurb}) Target: ${g.target}. Status: ${g.status}. Rounds played: ${g.rounds.length}.
Standings:
${st}
Recent rounds:
${recent}
Write ONE hot take of at most 2 short sentences (under 45 words). Be playful and specific to these players and numbers, tease gently, no insults about real traits, no hashtags, no emoji at the start. Reply with the commentary text only.`;
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
      if (e && e.code === 'not_granted') {
        sample = null;
        toast('Claude’s commentary is turned off for this page.');
      } else if (e && e.code === 'rate_limited') toast('The commentator needs a breather. Try again in a minute.');
      else toast('No hot take this time. Try again in a moment.');
      render();
    }
  }

  /* -------------------------------------------------------------- scorecard */
  function renderScorecard(g) {
    const P = byId();
    if (!g.rounds.length) {
      return `<div class="panel-head"><h2><span class="pip pip-green"></span>Scorecard</h2></div><div class="empty"><span class="empty-icon">📝</span><p>Rounds you lock in show up here, with a heat map of who scored what.</p></div>`;
    }
    const max = Math.max(1, ...g.rounds.flatMap((r) => Object.values(r.points || {})));
    const totals = L.totals(g);
    const head = g.playerIds.map((id) => `<th scope="col"><span class="who" style="justify-content:flex-end">${avatar(P[id])}<span>${esc(P[id] ? P[id].name : '?')}</span></span></th>`).join('');
    const rows = g.rounds
      .map((r, i) => {
        const cells = g.playerIds
          .map((id) => {
            if (!(r.playerIds || []).includes(id)) return '<td class="muted">—</td>';
            const v = (r.points && r.points[id]) || 0;
            const heat = v ? Math.round(14 + (v / max) * 56) : 0;
            const star = r.winnerId === id ? '<span class="cell-star" title="Went out">★ </span>' : '';
            const hand = r.hands && r.hands[id] != null && g.mode === 'classic' ? `<small class="muted" title="Points left in hand"> (${r.hands[id]})</small>` : '';
            return `<td>${star}<span class="cell-heat pc-${esc(P[id] ? P[id].color : 'ink')}" style="background:color-mix(in srgb, var(--pc) ${heat}%, transparent)">${v}</span>${hand}</td>`;
          })
          .join('');
        return `<tr><th scope="row" style="text-align:left">R${i + 1}</th>${cells}<td><span class="row-actions"><button type="button" data-action="edit-round" data-round="${esc(r.id)}" aria-label="Edit round ${i + 1}" title="Edit">✎</button><button type="button" data-action="delete-round" data-round="${esc(r.id)}" aria-label="Delete round ${i + 1}" title="Delete">✕</button></span></td></tr>`;
      })
      .join('');
    return `<div class="panel-head"><h2><span class="pip pip-green"></span>Scorecard</h2><span class="entry-hint">★ went out${g.mode === 'classic' ? ' · (n) points left in hand' : ''}</span></div>
      <div class="table-wrap"><table><thead><tr><th scope="col">Round</th>${head}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td>Total</td>${g.playerIds.map((id) => `<td>${totals[id]}</td>`).join('')}<td></td></tr></tfoot></table></div>`;
  }

  function renderFinishedPanel(g) {
    const P = byId();
    const w = P[g.winnerId];
    return `<div class="trophy" style="padding:10px 0">
      <span class="trophy-cup">🏆</span>
      <span class="eyebrow">Champion</span>
      <h2>${esc(w ? `${w.emoji} ${w.name}` : 'Someone')}</h2>
      <p class="muted">${esc(g.endLine || '')}</p>
      ${podium(g)}
      <div class="btn-row" style="justify-content:center;margin-top:8px">
        <button type="button" class="btn btn-green" data-action="rematch" data-game="${esc(g.id)}">Rematch, same players</button>
        <button type="button" class="btn btn-ghost" data-action="open-stats" data-game="${esc(g.id)}">See the stats</button>
      </div>
    </div>`;
  }

  function podium(g) {
    const P = byId();
    const st = L.standings(g);
    const order = [st[1], st[0], st[2]];
    return `<div class="podium">${order
      .map((row, i) => {
        if (!row) return '<div></div>';
        const place = [2, 1, 3][i];
        return `<div class="podium-step podium-${place}">${avatar(P[row.id], 'avatar-lg')}<span class="who"><span>${esc(P[row.id] ? P[row.id].name : '?')}</span></span><div class="podium-block num">${row.total}</div></div>`;
      })
      .join('')}</div>`;
  }

  function showGameOver(g) {
    FX.sound('fanfare');
    FX.confetti({ count: 220 });
    setTimeout(() => FX.confetti({ x: innerWidth * 0.2, y: innerHeight * 0.5, count: 90 }), 300);
    setTimeout(() => FX.confetti({ x: innerWidth * 0.8, y: innerHeight * 0.5, count: 90 }), 550);
    const P = byId();
    const w = P[g.winnerId];
    openModal(
      `<div class="trophy">
        <span class="trophy-cup">🏆</span>
        <span class="eyebrow">Game over · ${plural(g.rounds.length, 'round')}</span>
        <h1>${esc(w ? `${w.name} wins!` : 'We have a winner!')}</h1>
        <p class="muted">${esc(g.endLine || '')}</p>
        ${podium(g)}
      </div>
      <div class="btn-row" style="justify-content:center">
        <button type="button" class="btn btn-green" data-action="rematch" data-game="${esc(g.id)}">Rematch</button>
        <button type="button" class="btn btn-blue" data-action="open-stats" data-game="${esc(g.id)}">See the stats</button>
        <button type="button" class="btn btn-ghost" data-action="undo-round">Oops, undo that round</button>
      </div>`,
      { label: 'Game over' }
    );
  }

  function afterPlay() {
    const panel = $('#entry-panel');
    if (!panel) return;
    panel.addEventListener('input', (e) => {
      const t = e.target;
      if (!t.dataset || !t.dataset.pid || !draft) return;
      draft[t.dataset.field][t.dataset.pid] = t.value === '' ? undefined : Number(t.value);
      const g = currentGame();
      const pv = $('#entry-preview');
      if (pv && g) pv.innerHTML = previewText(g);
      if (g && g.mode === 'classic' && draft.winnerId) {
        const wt = $('.entry-row.is-winner .winner-take', panel);
        if (wt) wt.textContent = `+${L.roundPoints(g.mode, draftEntry(g))[draft.winnerId] || 0}`;
      }
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

  /* --------------------------------------------------------- card calculator */
  function openCalc(pid) {
    const g = currentGame();
    const P = byId();
    const p = P[pid];
    const hand = [];
    const cards = L.CARDS.map(
      (c) =>
        `<button type="button" class="calc-card ${c.kind === 'wild' ? 'wild' : ''}" data-card="${c.key}" aria-label="${esc(c.label)}, ${c.value} points"><b>${esc(c.glyph || c.label)}</b><small>${c.value}</small></button>`
    ).join('');
    openModal(
      `${modalHead(`Count ${esc(p ? p.name : '')}’s hand`, 'Tap each card they are still holding.')}
      <div class="calc-cards">${cards}</div>
      <div class="field"><span>In hand</span><div class="calc-hand" id="calc-hand"><span class="muted">No cards yet</span></div></div>
      <div class="btn-row" style="justify-content:space-between">
        <div><span class="eyebrow">Total</span><div class="calc-total" id="calc-total">0</div></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost" id="calc-clear">Clear</button><button type="button" class="btn btn-red" id="calc-apply">Use these points</button></div>
      </div>`,
      {
        label: 'Card counter',
        onMount: (m) => {
          const draw = () => {
            const total = hand.reduce((s, c) => s + c.value, 0);
            $('#calc-total', m).textContent = total;
            $('#calc-hand', m).innerHTML = hand.length
              ? hand.map((c, i) => `<button type="button" data-i="${i}" title="Remove">${esc(c.glyph && c.kind !== 'number' ? `${c.glyph} ${c.label}` : c.label)} · ${c.value}</button>`).join('')
              : '<span class="muted">No cards yet</span>';
          };
          m.addEventListener('click', (e) => {
            const card = e.target.closest('[data-card]');
            if (card) {
              hand.push(L.CARDS.find((c) => c.key === card.dataset.card));
              FX.sound('slap');
              draw();
            }
            const rm = e.target.closest('#calc-hand [data-i]');
            if (rm) {
              hand.splice(Number(rm.dataset.i), 1);
              draw();
            }
          });
          $('#calc-clear', m).addEventListener('click', () => {
            hand.length = 0;
            draw();
          });
          $('#calc-apply', m).addEventListener('click', () => {
            const total = hand.reduce((s, c) => s + c.value, 0);
            ensureDraft(g).hands[pid] = total;
            closeModal();
            rerenderEntry();
            const big = hand.filter((c) => c.value >= 50).length;
            if (big >= 2) toast(`${p ? p.name : 'They'} was sitting on ${big} wilds. Bold strategy.`);
          });
        },
      }
    );
  }

  /* ------------------------------------------------------------- new game */
  function openNewGame(prefill) {
    const last = [...state.games].sort((a, b) => b.createdAt - a.createdAt)[0];
    const sel = new Set(prefill ? prefill.playerIds : last ? last.playerIds.filter((id) => byId()[id]) : []);
    let gameMode = prefill ? prefill.mode : last ? last.mode : 'classic';
    const usedNames = new Set(state.games.map((g) => g.name));
    const fresh = GAME_NAMES.filter((n) => !usedNames.has(n));
    const name = pick(fresh.length ? fresh : GAME_NAMES);
    const quick = { classic: [100, 250, 500], lowball: [100, 200, 300], freestyle: [50, 100, 500] };
    const target = prefill ? prefill.target : gameMode === 'lowball' ? 200 : 500;

    const html = `${modalHead(prefill ? 'Rematch!' : 'Deal a new game')}
      <div class="field"><span>Game name</span><input type="text" id="ng-name" value="${esc(name)}" maxlength="60"></div>
      <div class="field"><span>Who’s playing?</span><div class="chips" id="ng-players"></div>
        <div class="add-inline"><input type="text" id="ng-new" placeholder="Add a new player" maxlength="24" class="select" aria-label="New player name"><button type="button" class="btn btn-ink" id="ng-add">Add</button></div></div>
      <fieldset class="field"><legend>Scoring</legend><div class="modes">${Object.entries(L.MODES)
        .map(
          ([k, m]) =>
            `<div class="mode-opt"><input type="radio" name="ng-mode" id="ng-mode-${k}" value="${k}" ${k === gameMode ? 'checked' : ''}><label for="ng-mode-${k}"><strong>${esc(m.label)}</strong><small>${esc(m.blurb)}</small></label></div>`
        )
        .join('')}</div></fieldset>
      <div class="field"><span id="ng-target-label">Play to</span>
        <div class="btn-row"><input type="number" id="ng-target" min="10" step="10" value="${target}" class="select" style="width:110px" aria-labelledby="ng-target-label"><div class="quick-targets" id="ng-quick"></div></div></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="button" class="btn btn-red btn-big" id="ng-start">Shuffle &amp; deal</button></div>`;

    openModal(html, {
      label: 'New game',
      onMount: (m) => {
        const drawPlayers = () => {
          const P = state.players;
          $('#ng-players', m).innerHTML = P.length
            ? P.map((p) => `<button type="button" class="chip pc-${esc(p.color)}" data-pid="${esc(p.id)}" aria-pressed="${sel.has(p.id)}">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')
            : '<span class="muted">No players yet. Add the first one below.</span>';
          $('#ng-start', m).disabled = sel.size < 2;
          $('#ng-start', m).textContent = sel.size < 2 ? 'Pick at least 2 players' : `Shuffle & deal (${sel.size})`;
        };
        const drawQuick = () => {
          $('#ng-quick', m).innerHTML = quick[gameMode].map((v) => `<button type="button" class="btn btn-ghost btn-small" data-q="${v}">${v}</button>`).join('');
          $('#ng-target-label', m).textContent = gameMode === 'lowball' ? 'Elimination limit' : 'Play to';
        };
        drawPlayers();
        drawQuick();
        $('#ng-players', m).addEventListener('click', (e) => {
          const c = e.target.closest('[data-pid]');
          if (!c) return;
          sel.has(c.dataset.pid) ? sel.delete(c.dataset.pid) : sel.add(c.dataset.pid);
          FX.sound('click');
          drawPlayers();
        });
        const add = () => {
          const input = $('#ng-new', m);
          const nm = input.value.trim();
          if (!nm) return input.focus();
          const p = newPlayer(nm);
          state.players.push(p);
          sel.add(p.id);
          input.value = '';
          drawPlayers();
          input.focus();
        };
        $('#ng-add', m).addEventListener('click', add);
        $('#ng-new', m).addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), add()));
        m.addEventListener('change', (e) => {
          if (e.target.name === 'ng-mode') {
            gameMode = e.target.value;
            $('#ng-target', m).value = gameMode === 'lowball' ? 200 : gameMode === 'freestyle' ? 100 : 500;
            drawQuick();
          }
        });
        $('#ng-quick', m).addEventListener('click', (e) => {
          const q = e.target.closest('[data-q]');
          if (q) $('#ng-target', m).value = q.dataset.q;
        });
        $('#ng-start', m).addEventListener('click', () => {
          const target = Math.max(10, Math.round(Number($('#ng-target', m).value) || 500));
          const g = {
            id: uid(),
            name: $('#ng-name', m).value.trim() || name,
            mode: gameMode,
            target,
            playerIds: state.players.filter((p) => sel.has(p.id)).map((p) => p.id),
            rounds: [],
            status: 'active',
            createdAt: Date.now(),
            winnerId: null,
          };
          closeModal();
          commit((s) => {
            s.games.push(g);
            s.activeGameId = g.id;
          });
          view = 'play';
          draft = null;
          dealtFor = null;
          render();
          FX.sound('uno');
          FX.confetti({ count: 80, spread: 0.7 });
          toast('Cards are dealt. Good luck!');
        });
      },
    });
  }

  function newPlayer(name) {
    const used = state.players.map((p) => p.color);
    const color = COLORS.find((c) => !used.includes(c)) || COLORS[state.players.length % COLORS.length];
    const usedE = state.players.map((p) => p.emoji);
    const emoji = pick(EMOJIS.filter((e) => !usedE.includes(e)).length ? EMOJIS.filter((e) => !usedE.includes(e)) : EMOJIS);
    return { id: uid(), name: name.slice(0, 24), emoji, color, createdAt: Date.now() };
  }

  function openAddToGame() {
    const g = currentGame();
    if (!g) return;
    const avail = state.players.filter((p) => !g.playerIds.includes(p.id));
    openModal(
      `${modalHead('Pull up a chair', 'Late arrivals start at 0 points.')}
      ${avail.length ? `<div class="chips" id="atg-list">${avail.map((p) => `<button type="button" class="chip pc-${esc(p.color)}" data-pid="${esc(p.id)}">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>` : ''}
      <div class="add-inline"><input type="text" id="atg-new" class="select" placeholder="New player name" maxlength="24" aria-label="New player name" autofocus><button type="button" class="btn btn-ink" id="atg-add">Add to game</button></div>`,
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
          list && list.addEventListener('click', (e) => {
            const c = e.target.closest('[data-pid]');
            c && join(c.dataset.pid);
          });
          const add = () => {
            const nm = $('#atg-new', m).value.trim();
            if (!nm) return;
            const p = newPlayer(nm);
            join(p.id, p);
          };
          $('#atg-add', m).addEventListener('click', add);
          $('#atg-new', m).addEventListener('keydown', (e) => e.key === 'Enter' && add());
        },
      }
    );
  }

  /* -------------------------------------------------------------------- STATS */
  function renderStats() {
    const games = [...state.games].filter((g) => g.rounds.length).sort((a, b) => b.createdAt - a.createdAt);
    if (!games.length) return emptyState('📊', 'No rounds yet', 'Play a round and the charts will appear here.', 'new-game', 'Deal a new game');
    if (!statsGameId || !games.find((g) => g.id === statsGameId)) statsGameId = (currentGame() && currentGame().rounds.length ? currentGame() : games[0]).id;
    const g = findGame(statsGameId);
    const P = byId();
    const st = L.standings(g);
    const nm = (id) => (P[id] ? `${P[id].emoji} ${P[id].name}` : '?');

    let big = { v: -1 };
    g.rounds.forEach((r, i) => Object.entries(r.points || {}).forEach(([id, v]) => v > big.v && (big = { v, id, n: i + 1 })));
    const mostWins = [...st].sort((a, b) => b.roundsWon - a.roundsWon)[0];
    const handed = g.rounds.reduce((s, r) => s + Object.values(r.points || {}).reduce((a, b) => a + b, 0), 0);
    const margin = st.length > 1 ? Math.abs(st[0].total - st[1].total) : 0;
    let leadChanges = 0;
    for (let i = 2; i <= g.rounds.length; i++) if (L.standingsAfter(g, i)[0].id !== L.standingsAfter(g, i - 1)[0].id) leadChanges++;

    const tiles = [
      ['var(--red)', g.status === 'finished' ? 'Winner' : 'Leader', nm(st[0].id), `${st[0].total} pts`],
      ['var(--blue)', 'Rounds', g.rounds.length, `${plural(leadChanges, 'lead change')}`],
      ['var(--yellow)', g.mode === 'lowball' ? 'Worst hit' : 'Biggest round', big.v, `${nm(big.id)} in R${big.n}`],
      ['var(--green)', 'Most rounds won', mostWins.roundsWon, nm(mostWins.id)],
      ['var(--red)', 'Avg per round', Math.round(handed / g.rounds.length), `${handed} points total`],
      ['var(--blue)', 'Gap: 1st to 2nd', margin, margin <= g.target * 0.05 ? 'Photo finish' : margin >= g.target * 0.3 ? 'Runaway' : 'Within reach'],
    ];

    const sheet = st
      .map((row) => {
        const s = sheetFor(g, row.id);
        return `<tr><td>${who(P[row.id])}</td><td>${row.rank}</td><td><strong>${row.total}</strong></td><td>${row.roundsWon}</td><td>${s.played ? Math.round((row.roundsWon / s.played) * 100) : 0}%</td><td>${s.avgHand}</td><td>${s.best}</td><td>${L.longestStreak(g, row.id)}</td></tr>`;
      })
      .join('');

    return `
      <section class="game-head">
        <div class="game-title"><span class="eyebrow">Game dashboard</span><h1>${esc(g.name)}</h1>
          <div class="game-meta"><span class="pill ${g.status === 'finished' ? 'pill-done' : 'pill-live'}">${g.status === 'finished' ? 'Finished' : 'Live'}</span><span class="pill">${esc(mode(g).label)} · ${g.target}</span><span class="pill">${esc(ago(g.createdAt))}</span></div></div>
        <label class="field" style="min-width:min(280px,100%)"><span>Show game</span><select class="select" id="stats-game">${games
          .map((x) => `<option value="${esc(x.id)}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)} · ${esc(ago(x.createdAt))}</option>`)
          .join('')}</select></label>
      </section>
      <section class="tiles">${tiles
        .map(([c, l, v, sub]) => `<div class="tile" style="--tc:${c}"><span class="eyebrow">${esc(l)}</span><span class="tile-value ${typeof v === 'string' ? 'is-text' : ''}">${esc(v)}</span><span class="tile-sub">${esc(sub)}</span></div>`)
        .join('')}</section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-red"></span>The race</h2><span class="entry-hint">Running totals after every round. Dashed line is the ${g.mode === 'lowball' ? 'limit' : 'target'}.</span></div>
        <div class="chart-box tall"><canvas id="ch-race" aria-label="Running totals chart" role="img"></canvas></div></section>
      <div class="chart-grid">
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Momentum</h2><span class="entry-hint">Rank after each round</span></div><div class="chart-box"><canvas id="ch-bump" role="img" aria-label="Rank by round chart"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-yellow"></span>Points per round</h2><span class="entry-hint">${g.mode === 'lowball' ? 'Damage taken' : 'Who scored what'}</span></div><div class="chart-box"><canvas id="ch-rounds" role="img" aria-label="Points per round chart"></canvas></div></section>
      </div>
      <div class="chart-grid">
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-green"></span>Who goes out</h2><span class="entry-hint">Share of rounds won</span></div><div class="chart-box short"><canvas id="ch-share" role="img" aria-label="Share of rounds won"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-wild"></span>Stat sheet</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Player</th><th>Rank</th><th>Total</th><th>Rounds won</th><th>Win %</th><th title="Average points left in hand when someone else went out">Avg hand</th><th>Best round</th><th>Streak</th></tr></thead><tbody>${sheet}</tbody></table></div></section>
      </div>`;
  }

  function sheetFor(g, id) {
    let played = 0;
    let hand = 0;
    let handN = 0;
    let best = 0;
    g.rounds.forEach((r) => {
      if (!(r.playerIds || []).includes(id)) return;
      played++;
      best = Math.max(best, (r.points && r.points[id]) || 0);
      if (r.hands && r.hands[id] != null) {
        hand += r.hands[id];
        handN++;
      }
    });
    return { played, avgHand: handN ? (hand / handN).toFixed(1) : '—', best };
  }

  function afterStats() {
    const sel = $('#stats-game');
    sel &&
      sel.addEventListener('change', () => {
        statsGameId = sel.value;
        render();
      });
    const g = findGame(statsGameId);
    if (!g) return;
    if (!C.available()) return chartsMissing();
    const P = byId();
    C.race($('#ch-race'), g, P);
    C.bump($('#ch-bump'), g, P);
    C.perRound($('#ch-rounds'), g, P);
    C.share($('#ch-share'), g, P);
  }

  function chartsMissing() {
    $$('.chart-box').forEach((b) => (b.innerHTML = '<div class="chart-fallback">Charts need an internet connection to load. Scores and tables still work offline.</div>'));
  }

  /* --------------------------------------------------------------------- FAME */
  function renderFame() {
    const played = state.games.filter((g) => g.rounds.length);
    if (!played.length) return emptyState('🏅', 'The Hall of Fame is empty', 'Finish a game to start handing out trophies.', 'new-game', 'Deal a new game');
    const P = byId();
    const stats = L.playerStats(state);
    const list = Object.values(stats).filter((s) => s.rounds > 0);
    const aw = L.awards(state);
    if (!compareIds) compareIds = [...list].sort((a, b) => b.rounds - a.rounds).slice(0, 4).map((s) => s.id);
    const totalRounds = played.reduce((s, g) => s + g.rounds.length, 0);
    const totalPts = played.reduce((s, g) => s + g.rounds.reduce((a, r) => a + Object.values(r.points || {}).reduce((x, y) => x + y, 0), 0), 0);
    const finished = state.games.filter((g) => g.status === 'finished').length;

    const board = [...list]
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.roundsWon - a.roundsWon)
      .map(
        (s, i) =>
          `<tr><td><span class="who"><b class="muted" style="font-family:var(--f-display);font-weight:400;width:22px">${i + 1}</b>${avatar(P[s.id])}<span>${esc(P[s.id] ? P[s.id].name : '?')}</span></span></td><td><strong>${s.wins}</strong> / ${s.finished}</td><td>${Math.round(s.winRate * 100)}%</td><td>${s.roundsWon}</td><td>${Math.round(s.roundWinRate * 100)}%</td><td>${s.handRounds ? s.avgHand.toFixed(1) : '—'}</td><td>${s.bestHaul}</td><td>${s.longestStreak}</td></tr>`
      )
      .join('');

    const h2h = L.headToHead(state);
    const hp = list.map((s) => s.id);
    const h2hTable =
      finished && hp.length > 1
        ? `<div class="table-wrap"><table class="h2h"><thead><tr><th>Row beat column</th>${hp.map((id) => `<th title="${esc(P[id] && P[id].name)}">${esc(P[id] ? P[id].emoji : '')}</th>`).join('')}</tr></thead><tbody>${hp
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
      <section class="game-head"><div class="game-title"><span class="eyebrow">All-time</span><h1>Hall of Fame</h1><p class="muted">Every game, every round, every Draw Four you are still not over.</p></div></section>
      <section class="tiles">
        <div class="tile" style="--tc:var(--red)"><span class="eyebrow">Games</span><span class="tile-value">${state.games.length}</span><span class="tile-sub">${finished} finished</span></div>
        <div class="tile" style="--tc:var(--yellow)"><span class="eyebrow">Rounds dealt</span><span class="tile-value">${totalRounds}</span><span class="tile-sub">≈ ${Math.round((totalRounds * 7 * 4) / 60)} hours of shuffling</span></div>
        <div class="tile" style="--tc:var(--green)"><span class="eyebrow">Points scored</span><span class="tile-value">${totalPts.toLocaleString()}</span><span class="tile-sub">≈ ${Math.round(totalPts / 50)} Wild cards’ worth</span></div>
        <div class="tile" style="--tc:var(--blue)"><span class="eyebrow">Players</span><span class="tile-value">${list.length}</span><span class="tile-sub">${state.players.length - list.length ? `${state.players.length - list.length} yet to play` : 'Everyone has played'}</span></div>
      </section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-yellow"></span>Trophy cabinet</h2></div>
        <div class="awards">${aw
          .map(
            (a, i) =>
              `<div class="award pc-${esc(P[a.winnerId] ? P[a.winnerId].color : 'ink')}" style="--i:${i}"><span class="award-icon">${a.icon}</span><div style="min-width:0"><div class="award-title">${esc(a.title)}</div><div class="award-blurb">${esc(a.blurb)}</div><div class="award-who">${avatar(P[a.winnerId])}<span>${esc(P[a.winnerId] ? P[a.winnerId].name : '?')}</span><span class="award-value">${esc(a.value)}</span></div></div></div>`
          )
          .join('')}</div></section>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-green"></span>Leaderboard</h2><span class="entry-hint">Ranked by games won</span></div>
        <div class="table-wrap"><table><thead><tr><th>Player</th><th>Won / played</th><th>Win %</th><th>Rounds won</th><th>Round win %</th><th title="Average points stuck in hand">Avg hand</th><th>Best round</th><th>Best streak</th></tr></thead><tbody>${board}</tbody></table></div></section>
      <div class="chart-grid">
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-wild"></span>Player DNA</h2><span class="entry-hint">Compare up to 4</span></div>
          <div class="chips" id="dna-chips" style="margin-bottom:12px">${list
            .map((s) => `<button type="button" class="chip pc-${esc(P[s.id] ? P[s.id].color : 'ink')}" data-pid="${esc(s.id)}" aria-pressed="${compareIds.includes(s.id)}">${avatar(P[s.id])}<span>${esc(P[s.id] ? P[s.id].name : '?')}</span></button>`)
            .join('')}</div>
          <div class="chart-box tall"><canvas id="ch-radar" role="img" aria-label="Player comparison radar"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2><span class="pip pip-red"></span>Wins</h2><span class="entry-hint">Finished games only</span></div><div class="chart-box tall"><canvas id="ch-wins" role="img" aria-label="Games won per player"></canvas></div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2><span class="pip pip-blue"></span>Head to head</h2><span class="entry-hint">How often each row player finished above each column player</span></div>${h2hTable}</section>`;
  }

  function afterFame() {
    const chips = $('#dna-chips');
    chips &&
      chips.addEventListener('click', (e) => {
        const c = e.target.closest('[data-pid]');
        if (!c) return;
        const id = c.dataset.pid;
        if (compareIds.includes(id)) {
          if (compareIds.length > 1) compareIds = compareIds.filter((x) => x !== id);
        } else {
          compareIds = [...compareIds, id].slice(-4);
        }
        render();
      });
    if (!C.available()) return chartsMissing();
    const stats = L.playerStats(state);
    const P = byId();
    const list = Object.values(stats).filter((s) => s.rounds > 0);
    if (!$('#ch-radar')) return;
    C.radar($('#ch-radar'), list.filter((s) => compareIds.includes(s.id)), P);
    C.wins($('#ch-wins'), list, P);
  }

  /* ------------------------------------------------------------------ HISTORY */
  function gameCard(g, P) {
    const st = L.standings(g);
    const max = Math.max(g.target, ...st.map((s) => s.total), 1);
    const isCurrent = g.id === state.activeGameId;
    return `<article class="game-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="min-width:0"><h3>${esc(g.name)}</h3><span class="muted" style="font-size:.82rem;font-weight:700">${esc(new Date(g.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${esc(mode(g).label)} ${g.target} · ${plural(g.rounds.length, 'round')}</span></div>
        ${g.status === 'finished' ? '<span class="pill pill-done">Finished</span>' : '<span class="pill pill-live">Live</span>'}
      </div>
      <div class="mini-stand">${st
        .map(
          (row) =>
            `<div class="mini-row"><b>${row.rank}</b><span class="who">${avatar(P[row.id])}<span>${esc(P[row.id] ? P[row.id].name : '?')}${g.winnerId === row.id ? ' 🏆' : ''}</span></span><span class="num">${row.total}</span><div class="mini-bar pc-${esc(P[row.id] ? P[row.id].color : 'ink')}"><i style="width:${(row.total / max) * 100}%"></i></div></div>`
        )
        .join('')}</div>
      <div class="btn-row">
        ${g.status === 'active' ? `<button type="button" class="btn ${isCurrent ? 'btn-red' : 'btn-ink'} btn-small" data-action="resume" data-game="${esc(g.id)}">${isCurrent ? 'Back to the table' : 'Resume'}</button>` : `<button type="button" class="btn btn-green btn-small" data-action="rematch" data-game="${esc(g.id)}">Rematch</button>`}
        ${g.rounds.length ? `<button type="button" class="btn btn-ghost btn-small" data-action="open-stats" data-game="${esc(g.id)}">Stats</button>` : ''}
        <button type="button" class="btn btn-ghost btn-small" data-action="delete-game" data-game="${esc(g.id)}" aria-label="Delete ${esc(g.name)}">Delete</button>
      </div>
    </article>`;
  }

  function renderHistory() {
    const P = byId();
    const games = [...state.games].sort((a, b) => b.createdAt - a.createdAt);
    if (!games.length) return emptyState('🗂️', 'No games yet', 'Every game you play is kept here, finished or not.', 'new-game', 'Deal a new game');
    return `<section class="game-head"><div class="game-title"><span class="eyebrow">${plural(games.length, 'game')}</span><h1>Game history</h1></div><button type="button" class="btn btn-red" data-action="new-game">Deal a new game</button></section>
      <section class="games">${games.map((g) => gameCard(g, P)).join('')}</section>`;
  }

  /* ------------------------------------------------------------------ PLAYERS */
  function renderPlayers() {
    const stats = L.playerStats(state);
    const cards = state.players
      .map((p) => {
        const s = stats[p.id];
        const ranks = state.games
          .filter((g) => g.status === 'finished' && g.playerIds.includes(p.id))
          .sort((a, b) => a.finishedAt - b.finishedAt)
          .map((g) => ({ rank: L.standings(g).find((r) => r.id === p.id).rank, n: g.playerIds.length }));
        return `<article class="roster-card">
          <div class="roster-top">${avatar(p, 'avatar-lg')}<div style="min-width:0;flex:1"><h3>${esc(p.name)}</h3><span class="muted" style="font-size:.8rem;font-weight:700">${s.lastPlayed ? `Last played ${esc(ago(s.lastPlayed))}` : 'Yet to play'}</span></div>
            <button type="button" class="btn btn-ghost btn-small" data-action="edit-player" data-pid="${esc(p.id)}">Edit</button></div>
          <div class="roster-stats"><div><strong>${s.wins}</strong><small>Wins</small></div><div><strong>${s.games}</strong><small>Games</small></div><div><strong>${s.roundsWon}</strong><small>Rounds won</small></div></div>
          ${ranks.length > 1 ? sparkline(ranks, C.colorOf(p)) : ''}
        </article>`;
      })
      .join('');
    return `<section class="game-head"><div class="game-title"><span class="eyebrow">${plural(state.players.length, 'player')}</span><h1>The regulars</h1></div><button type="button" class="btn btn-red" data-action="edit-player">+ New player</button></section>
      ${state.players.length ? `<section class="roster">${cards}</section>` : emptyState('🪑', 'No players yet', 'Add everyone who sits at your Uno table.', 'edit-player', 'Add a player')}`;
  }

  function sparkline(ranks, color) {
    const w = 220;
    const h = 34;
    const pad = 5;
    const maxN = Math.max(...ranks.map((r) => r.n));
    const x = (i) => pad + (i / (ranks.length - 1)) * (w - pad * 2);
    const y = (r) => pad + ((r - 1) / Math.max(1, maxN - 1)) * (h - pad * 2);
    const pts = ranks.map((r, i) => `${x(i).toFixed(1)},${y(r.rank).toFixed(1)}`).join(' ');
    const last = ranks[ranks.length - 1];
    return `<div><span class="eyebrow">Finishing place, game by game</span><svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Finishing places over time">
      <line x1="${pad}" x2="${w - pad}" y1="${pad}" y2="${pad}" stroke="var(--line)" stroke-dasharray="3 3"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(ranks.length - 1)}" cy="${y(last.rank)}" r="4" fill="${color}"/></svg></div>`;
  }

  function openPlayerEditor(pid) {
    const existing = pid ? byId()[pid] : null;
    const p = existing ? { ...existing } : newPlayer('');
    const inGames = existing ? state.games.some((g) => g.playerIds.includes(pid)) : false;
    openModal(
      `${modalHead(existing ? 'Edit player' : 'New player')}
      <div class="field"><span>Name</span><input type="text" id="pe-name" value="${esc(p.name)}" maxlength="24" placeholder="e.g. Aunt Linda" autofocus></div>
      <div class="field"><span>Mascot</span><div class="emojis" id="pe-emoji">${EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-e="${e}" aria-pressed="${e === p.emoji}">${e}</button>`).join('')}</div></div>
      <div class="field"><span>Card color</span><div class="swatches" id="pe-color">${COLORS.map((c) => `<button type="button" class="swatch pc-${c}" data-c="${c}" aria-pressed="${c === p.color}" aria-label="${c}"></button>`).join('')}</div></div>
      <div class="btn-row" style="justify-content:space-between">
        ${existing ? `<button type="button" class="btn btn-ghost" id="pe-delete" ${inGames ? 'disabled title="Players with game history can be renamed but not deleted"' : ''}>Delete</button>` : '<span></span>'}
        <div class="btn-row"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button><button type="button" class="btn btn-red" id="pe-save">${existing ? 'Save' : 'Add player'}</button></div>
      </div>
      ${existing && inGames ? '<p class="entry-hint">Players with game history can be renamed but not deleted, so old scores stay intact.</p>' : ''}`,
      {
        label: 'Player',
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
            if (!nm) {
              $('#pe-name', m).focus();
              return toast('Give them a name first.');
            }
            p.name = nm.slice(0, 24);
            closeModal();
            commit((s) => {
              const i = s.players.findIndex((x) => x.id === p.id);
              if (i >= 0) s.players[i] = p;
              else s.players.push(p);
            });
            toast(existing ? 'Saved.' : `${p.name} joins the regulars.`);
          };
          $('#pe-save', m).addEventListener('click', save);
          $('#pe-name', m).addEventListener('keydown', (e) => e.key === 'Enter' && save());
          const del = $('#pe-delete', m);
          del &&
            del.addEventListener('click', () => {
              closeModal();
              commit((s) => (s.players = s.players.filter((x) => x.id !== pid)));
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

  function openRules() {
    openModal(
      `${modalHead('How scoring works')}
      <div class="modes">${Object.values(L.MODES).map((m) => `<div class="mode-opt"><label style="cursor:default"><strong>${esc(m.label)}</strong><small>${esc(m.blurb)}</small></label></div>`).join('')}</div>
      <div class="field"><span>Card values</span><div class="calc-cards">${L.CARDS.map(
        (c) => `<div class="calc-card ${c.kind === 'wild' ? 'wild' : ''}" title="${esc(c.label)}"><b>${esc(c.glyph || c.label)}</b><small>${c.value}</small></div>`
      ).join('')}</div></div>
      <p class="entry-hint">Use the 🧮 button next to a player to tap in the cards they’re holding and let the tracker add them up.</p>`,
      { wide: true, label: 'Scoring rules' }
    );
  }

  function openBackup() {
    const json = JSON.stringify(state, null, 1);
    const where =
      S.mode === 'cloud'
        ? 'Scores sync live to everyone who opens this tracker, and a copy stays in this browser.'
        : S.mode === 'readonly'
          ? 'You can watch this tracker but not change it.'
          : 'Scores are saved in this browser. Download a backup to move them to another device or keep them safe.';
    openModal(
      `${modalHead('Back up & restore', esc(where))}
      <div class="btn-row"><button type="button" class="btn btn-blue" id="bk-download">Download backup</button><button type="button" class="btn btn-ghost" id="bk-copy">Copy to clipboard</button></div>
      <div class="field"><span>Restore from a backup file</span><input type="file" id="bk-file" accept="application/json,.json"></div>
      <div class="field"><span>…or paste backup text</span><textarea id="bk-text" spellcheck="false" placeholder='{"version":1,"players":[…],"games":[…]}'></textarea></div>
      <div class="btn-row" style="justify-content:space-between"><button type="button" class="btn btn-ghost" id="bk-wipe">Erase everything</button><button type="button" class="btn btn-red" id="bk-restore">Restore</button></div>`,
      {
        wide: true,
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
            const ta = $('#bk-text', m);
            navigator.clipboard
              .writeText(json)
              .then(() => toast('Backup copied. Paste it somewhere safe.'))
              .catch(() => {
                ta.value = json;
                ta.select();
                toast('Select-all is ready. Press copy on your keyboard.');
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
              return toast('That does not look like an Uno Tracker backup. Check the file and try again.');
            }
            confirmModal({
              title: 'Replace all scores?',
              body: `This replaces everything with the backup: ${plural(parsed.players.length, 'player')} and ${plural(parsed.games.length, 'game')}.`,
              ok: 'Restore backup',
              onOk: () => {
                state = S.normalise(parsed);
                draft = null;
                commit(() => {});
                toast('Backup restored.');
              },
            });
          });
          $('#bk-wipe', m).addEventListener('click', () =>
            confirmModal({
              title: 'Erase everything?',
              body: 'All players, games and stats will be deleted. Download a backup first if you might want them back.',
              ok: 'Erase everything',
              onOk: () => {
                state = S.emptyState();
                draft = null;
                view = 'play';
                commit(() => {});
                toast('Clean slate.');
              },
            })
          );
        },
      }
    );
  }

  function deleteRound(roundId) {
    const g = currentGame() && currentGame().rounds.some((r) => r.id === roundId) ? currentGame() : state.games.find((x) => x.rounds.some((r) => r.id === roundId));
    if (!g) return;
    const before = JSON.parse(JSON.stringify(g));
    const idx = g.rounds.findIndex((r) => r.id === roundId);
    commit((s) => {
      const game = s.games.find((x) => x.id === g.id);
      game.rounds.splice(idx, 1);
      if (game.status === 'finished' && !L.checkOver(game).over) {
        game.status = 'active';
        game.winnerId = null;
        game.finishedAt = null;
        game.endLine = null;
        s.activeGameId = game.id;
      }
    });
    if (draft && draft.editingId === roundId) draft = null;
    FX.sound('oops');
    toast(`Round ${idx + 1} removed.`, {
      label: 'Restore',
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
      $('#view').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: FX.reduced() ? 'auto' : 'smooth' });
    },
    'close-modal': closeModal,
    mute: () => {
      FX.toggleMute();
      renderSync();
      FX.sound('click');
    },
    rules: openRules,
    backup: openBackup,
    'clear-demo': () =>
      confirmModal({
        title: 'Clear the demo?',
        body: 'The example players and games will be removed so you can start your own.',
        ok: 'Clear demo',
        okClass: 'btn-red',
        onOk: () => {
          state = S.emptyState();
          draft = null;
          view = 'play';
          commit(() => {});
          openNewGame();
        },
      }),
    'new-game': () => openNewGame(),
    rematch: (el) => {
      const g = findGame(el.dataset.game);
      closeModal();
      openNewGame(g ? { playerIds: g.playerIds, mode: g.mode, target: g.target } : null);
    },
    resume: (el) => {
      commit((s) => (s.activeGameId = el.dataset.game), { render: false });
      view = 'play';
      draft = null;
      render();
    },
    'open-stats': (el) => {
      closeModal();
      statsGameId = el.dataset.game;
      view = 'stats';
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
        onOk: () => {
          commit((s) => {
            s.games = s.games.filter((x) => x.id !== g.id);
            if (s.activeGameId === g.id) s.activeGameId = null;
          });
          toast('Game deleted.');
        },
      });
    },
    uno: (el) => {
      FX.sound('uno');
      el.classList.remove('boom');
      void el.offsetWidth;
      el.classList.add('boom');
      const r = el.getBoundingClientRect();
      FX.confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 60, spread: 0.7 });
      toast(pick(['UNO! Everybody heard that.', 'UNO! Somebody forgot to say it… draw two!', 'One card left. The tension is unbearable.', 'UNO! Hide your Draw Fours.']));
    },
    'toggle-sit': (el) => {
      const g = currentGame();
      const d = ensureDraft(g);
      d.playing[el.dataset.pid] = !d.playing[el.dataset.pid];
      if (!d.playing[el.dataset.pid] && d.winnerId === el.dataset.pid) d.winnerId = null;
      rerenderEntry();
    },
    'set-winner': (el) => {
      const g = currentGame();
      const d = ensureDraft(g);
      d.winnerId = d.winnerId === el.dataset.pid ? null : el.dataset.pid;
      FX.sound('click');
      rerenderEntry();
      const next = $$('#entry-panel input[data-pid]')[0];
      next && d.winnerId && next.focus();
    },
    calc: (el) => openCalc(el.dataset.pid),
    'submit-round': submitRound,
    'cancel-edit': () => {
      draft = null;
      rerenderEntry();
    },
    'edit-round': (el) => {
      const g = currentGame();
      const r = g && g.rounds.find((x) => x.id === el.dataset.round);
      if (!r) return;
      const playing = {};
      g.playerIds.forEach((id) => (playing[id] = (r.playerIds || []).includes(id)));
      draft = { gameId: g.id, editingId: r.id, playing, winnerId: r.winnerId, hands: { ...(r.hands || {}) }, points: { ...(r.points || {}) } };
      render();
      const panel = $('#entry-panel');
      panel && panel.scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'start' });
    },
    'delete-round': (el) =>
      confirmModal({ title: 'Delete this round?', body: 'Its points come off everyone’s totals.', ok: 'Delete round', onOk: () => deleteRound(el.dataset.round) }),
    'undo-round': () => {
      closeModal();
      const g = currentGame();
      const last = g && g.rounds[g.rounds.length - 1];
      last && deleteRound(last.id);
    },
    'end-game': () => {
      const g = currentGame();
      if (!g || !g.rounds.length) return;
      const top = L.standings(g)[0];
      const P = byId();
      confirmModal({
        title: 'Call it here?',
        body: `${esc(P[top.id] ? P[top.id].name : 'The leader')} is ${g.mode === 'lowball' ? 'lowest' : 'ahead'} with ${top.total} points and will be crowned the winner.`,
        ok: 'End game',
        okClass: 'btn-green',
        onOk: () => {
          let done;
          commit((s) => {
            const game = s.games.find((x) => x.id === g.id);
            game.status = 'finished';
            game.winnerId = top.id;
            game.finishedAt = Date.now();
            game.endLine = L.gameOverLine(game, names());
            done = game;
          });
          showGameOver(done);
        },
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
  scheme && scheme.addEventListener && scheme.addEventListener('change', () => (view === 'stats' || view === 'fame') && render());
  new MutationObserver(() => (view === 'stats' || view === 'fame') && render()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  S.on((type, payload) => {
    if (type === 'remote') {
      if (JSON.stringify(payload) === JSON.stringify(state)) return;
      const hadModal = !!$('#modal-root').innerHTML;
      state = payload;
      if (!hadModal) render();
      else renderSync();
    } else if (type === 'cloud-empty') {
      // Nothing shared yet. If this browser already has real scores, share them.
      if (!state.isDemo && (state.players.length || state.games.length)) S.save(state);
    } else if (type === 'mode') {
      renderSync();
      if (S.mode === 'readonly') toast('This tracker is view-only for you. Scores you enter stay on this device.');
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
