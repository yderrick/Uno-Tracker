/* Uno Tracker — persistence.
   Always keeps a copy in this browser (localStorage). When the page runs inside a
   claude.ai Artifact with the `db` capability, it also syncs to a shared store so
   every phone at the table sees the same scoreboard live. */
(function () {
  'use strict';

  const KEY = 'uno-tracker:v1';
  const ROSTER_DOC = 'tracker/roster';
  const GAMES = 'games';

  const listeners = new Set();
  let mode = 'local'; // 'local' | 'cloud' | 'readonly'
  let db = null;
  const written = new Map(); // doc path -> last JSON we wrote or received
  let writeChain = Promise.resolve();
  let pending = null;
  let timer = null;

  const emptyState = () => ({ version: 1, players: [], games: [], activeGameId: null, isDemo: false });

  function normalise(s) {
    const base = emptyState();
    if (!s || typeof s !== 'object') return base;
    return {
      ...base,
      ...s,
      players: Array.isArray(s.players) ? s.players : [],
      games: Array.isArray(s.games) ? s.games.map((g) => window.UnoLogic.normaliseGame(g)) : [],
    };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalise(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  function saveLocal(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  const rosterBody = (s) => ({ players: s.players, activeGameId: s.activeGameId || null, isDemo: !!s.isDemo, version: 1 });

  function queueCloud(state) {
    pending = state;
    clearTimeout(timer);
    timer = setTimeout(flushCloud, 350);
  }

  function flushCloud() {
    if (!db || mode !== 'cloud' || !pending) return;
    const s = pending;
    pending = null;
    const jobs = [];
    const roster = rosterBody(s);
    const rj = JSON.stringify(roster);
    if (written.get(ROSTER_DOC) !== rj) jobs.push([ROSTER_DOC, roster]);
    const live = new Set();
    s.games.forEach((g) => {
      const path = `${GAMES}/${g.id}`;
      live.add(path);
      const gj = JSON.stringify(g);
      if (written.get(path) !== gj) jobs.push([path, g]);
    });
    [...written.keys()].forEach((path) => {
      if (path.startsWith(GAMES + '/') && !live.has(path)) jobs.push([path, null]);
    });
    jobs.forEach(([path, body]) => {
      written.set(path, body ? JSON.stringify(body) : undefined);
      if (!body) written.delete(path);
      writeChain = writeChain
        .then(() => (body ? db.doc(path).set(JSON.parse(JSON.stringify(body))) : db.doc(path).delete()))
        .catch((e) => {
          if (e && (e.code === 'invalid_argument' || e.code === 'not_granted')) {
            mode = 'readonly';
            emit('mode');
          } else if (e && e.code === 'quota_exceeded') {
            emit('error', 'The shared store is full. Delete a few old games from History to free space.');
          } else {
            emit('error', 'Could not sync that change. It is still saved on this device.');
          }
        });
    });
  }

  function emit(type, payload) {
    listeners.forEach((fn) => {
      try {
        fn(type, payload);
      } catch (e) {
        console.error(e);
      }
    });
  }

  /** Subscribe to the shared store. Resolves true if cloud sync is active. */
  async function connectCloud() {
    if (!window.claude || typeof window.claude.use !== 'function') return false;
    try {
      db = await window.claude.use('db');
    } catch (e) {
      db = null;
    }
    if (!db) return false;

    let roster;
    let games;
    let gotRoster = false;
    let gotGames = false;
    const publish = (initial) => {
      if (!gotRoster || !gotGames || pending) return;
      if (!roster && !games.length) {
        if (initial) emit('cloud-empty');
        return;
      }
      const state = normalise({ ...(roster || {}), games: games.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) });
      saveLocal(state);
      emit('remote', state);
    };
    let first = true;
    db.doc(ROSTER_DOC).onSnapshot(
      (snap) => {
        if (snap.metadata && snap.metadata.hasPendingWrites) return;
        roster = snap.exists ? snap.data() : null;
        if (roster) written.set(ROSTER_DOC, JSON.stringify(rosterBody(normalise(roster))));
        gotRoster = true;
        publish(first);
        if (gotGames) first = false;
      },
      () => {}
    );
    db.collection(GAMES).onSnapshot(
      (snap) => {
        if (snap.metadata && snap.metadata.hasPendingWrites) return;
        games = snap.docs.map((d) => d.data());
        [...written.keys()].forEach((k) => k.startsWith(GAMES + '/') && written.delete(k));
        games.forEach((g) => written.set(`${GAMES}/${g.id}`, JSON.stringify(g)));
        gotGames = true;
        publish(first);
        if (gotRoster) first = false;
      },
      () => {}
    );
    mode = 'cloud';
    emit('mode');
    return true;
  }

  window.UnoStore = {
    emptyState,
    normalise,
    load: () => loadLocal(),
    save(state) {
      const ok = saveLocal(state);
      if (mode === 'cloud') queueCloud(state);
      return ok || mode === 'cloud';
    },
    connectCloud,
    get mode() {
      return mode;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
