#!/usr/bin/env node
/* Build the single-file Uno Tracker page (CSS, JS and scores in one HTML file).

   node scripts/build.js out.html                 page body, as published to a claude.ai Artifact
   node scripts/build.js out.html --full          complete HTML document, for any web host
   node scripts/build.js out.html --data s.json   bake in scores (e.g. a backup) */
const fs = require('fs');
const path = require('path');
const Page = require('../js/page.js');

const root = path.join(__dirname, '..');
const JS_ORDER = ['logic', 'storage', 'fx', 'demo', 'charts', 'page', 'app'];

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--data');
if (!out) {
  console.error('Usage: node scripts/build.js <out.html> [--full] [--data scores.json]');
  process.exit(1);
}
const dataPath = args.includes('--data') ? args[args.indexOf('--data') + 1] : null;

const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const js = JS_ORDER.map((n) => fs.readFileSync(path.join(root, 'js', `${n}.js`), 'utf8')).join('\n');
const data = dataPath ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : null;

// Inline <script>/<style> end at the first closing tag, so none may appear inside.
if (/<\/script/i.test(js) || /<!--/.test(js)) throw new Error('JS contains a sequence that would end the inline <script>.');
if (/<\/style/i.test(css)) throw new Error('CSS contains </style>.');

const html = args.includes('--full') ? Page.documentHtml({ css, js, data }) : Page.content({ css, js, data });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
