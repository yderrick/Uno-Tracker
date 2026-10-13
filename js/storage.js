/* Uno Tracker — where the scores live.

   Opened as a file or from any web host, scores are kept in this browser (localStorage).
   Hosted as a claude.ai Artifact, the scores are written into the page itself: the
   scorekeeper's changes publish a new version of the page, and everyone with the link,
   signed in or not, sees the new scores. See js/page.js for the page template. */
(function () {
  'use strict';

  const KEY = 'uno-tracker:v1';
  const UI_KEY = 'uno-tracker:ui';

  const emptyState = () => ({ version: 2, players: [], games: [], activeGameId: null, isDemo: false });

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

  /** Scores written into the page (the single-file build). null when there are none. */
  function embedded() {
    const el = document.getElementById('uno-data');
    if (!el) return null;
    try {
      const text = el.textContent.trim();
      return text ? normalise(JSON.parse(text)) : null;
    } catch (e) {
      return null;
    }
  }

  /** The page's own CSS and JS, present only in the single-file build. */
  function source() {
    const css = document.getElementById('uno-css');
    const js = document.getElementById('uno-js');
    return css && js ? { css: css.textContent, js: js.textContent } : null;
  }

  /** The reset stylesheet the Artifact host puts in <head>, so a republish keeps it. */
  function hostReset() {
    const el = document.head && document.head.querySelector('style');
    return el ? el.textContent : null;
  }

  /** Per-tab UI state that survives the reload a publish triggers. */
  function stashUi(ui) {
    try {
      sessionStorage.setItem(UI_KEY, JSON.stringify({ ...ui, at: Date.now() }));
    } catch (e) {}
  }
  function readUi() {
    try {
      const ui = JSON.parse(sessionStorage.getItem(UI_KEY) || 'null');
      return ui && Date.now() - ui.at < 30 * 60000 ? ui : null;
    } catch (e) {
      return null;
    }
  }

  window.UnoStore = { emptyState, normalise, loadLocal, saveLocal, embedded, source, hostReset, stashUi, readUi };
})();
