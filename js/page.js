/* Uno Tracker — the single-file page template.

   Used two ways with the same function, so the two always agree:
   - scripts/build.js writes the page from the repo's styles.css and js/ files;
   - the hosted page rebuilds itself from its own #uno-css / #uno-js text plus the
     current scores, and publishes that as the next version. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnoPage = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Split tags so this file can sit inside an inline <script> without closing it.
  const S_OPEN = '<scr' + 'ipt';
  const S_CLOSE = '</scr' + 'ipt>';

  const HEAD_LINKS = [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Figtree:wght@400;500;600;700;800&display=swap">',
  ].join('\n');
  const CHART_JS = `${S_OPEN} src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js">${S_CLOSE}`;

  // The Artifact host's own skeleton (charset, viewport, small reset). The live page
  // passes the reset it was served with; this copy is the fallback.
  const RESET =
    ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';

  /** JSON that is safe inside a <script> element. */
  const safeJson = (data) =>
    JSON.stringify(data)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

  /** The page body: what gets published, with the scores baked in. */
  function content({ css, js, data }) {
    return [
      '<title>Uno Tracker</title>',
      HEAD_LINKS,
      `<style id="uno-css">${css}</style>`,
      `${S_OPEN} type="application/json" id="uno-data">${data ? safeJson(data) : ''}${S_CLOSE}`,
      CHART_JS,
      `${S_OPEN} id="uno-js">${js}${S_CLOSE}`,
      '',
    ].join('\n');
  }

  /** A complete document in the shape the Artifact host serves. */
  function documentHtml({ css, js, data, reset }) {
    return (
      '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
      `<style>${reset || RESET}</style></head><body>\n${content({ css, js, data })}\n</body></html>`
    );
  }

  return { content, documentHtml, safeJson };
});
