#!/usr/bin/env node
/**
 * The trackers' masking, proven: the shared sensitive-field policy against representative fields,
 * then both overlays in headless Chrome, where a password, a card number, a one-time code, and an API
 * key are typed, a "show password" toggle included, and what each overlay displays is read back.
 *
 *   node tools/test_trackers.mjs
 *
 * Without Chrome the browser half says so and is skipped, except under CI, where it fails.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

// ── The policy itself ────────────────────────────────────────────────

const { secret, MASK } = new Function(`${read('scripts/blocks/sensitive-field.js')}\nreturn { secret, MASK };`)();
const field = (attributes = {}, tagName = 'INPUT') => ({
  tagName,
  type: attributes.type ?? 'text',
  id: attributes.id ?? '',
  isContentEditable: false,
  getAttribute: (name) => attributes[name] ?? null,
  hasAttribute: (name) => name in attributes,
});
const cases = [
  [{ type: 'password' }, true, 'a password'],
  [{ type: 'hidden' }, true, 'a hidden input'],
  [{ autocomplete: 'cc-number' }, true, 'a card number by autocomplete'],
  [{ autocomplete: 'one-time-code' }, true, 'a one-time code'],
  [{ autocomplete: 'section-a new-password' }, true, 'a new password among other tokens'],
  [{ name: 'newPassword' }, true, 'a camelCase password name'],
  [{ name: 'user_pin' }, true, 'a PIN'],
  [{ id: 'api-key' }, true, 'an API key'],
  [{ placeholder: 'Card number' }, true, 'a card number by placeholder'],
  [{ name: 'iban' }, true, 'an IBAN'],
  [{ 'data-tracker-mask': '' }, true, 'a field marked to mask'],
  [{ name: 'email', type: 'email' }, false, 'an email'],
  [{ name: 'passenger' }, false, 'a passenger name'],
  [{ name: 'footprint' }, false, 'a word that contains otp'],
  [{ name: 'pinned' }, false, 'a word that starts with pin'],
  [{ name: 'className' }, false, 'a word that contains ssn'],
  [{ name: 'search' }, false, 'a search box'],
];
for (const [attributes, expected, what] of cases) {
  assert.equal(secret(field(attributes)), expected, `${what}: ${JSON.stringify(attributes)}`);
}
assert.equal(secret(field({ name: 'notes' }, 'TEXTAREA')), false, 'a plain textarea');
assert.equal(secret(field({ name: 'privateKey' }, 'TEXTAREA')), true, 'a private key in a textarea');
assert.equal(secret({ tagName: 'BUTTON', getAttribute: () => 'password' }), false, 'not a field');
// Seen once as a password, a field stays masked after a "show password" toggle.
const toggled = field({ type: 'password' });
assert.equal(secret(toggled), true);
toggled.type = 'text';
assert.equal(secret(toggled), true, 'still masked after the toggle');
assert.equal(MASK.length, 3);
console.log(`ok - the sensitive-field policy: ${cases.length + 5} cases`);

// ── Both overlays, in a browser ──────────────────────────────────────

function chrome() {
  return [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
    .filter(Boolean)
    .find((candidate) => existsSync(candidate));
}

const SECRETS = ['hunter2', '4242424242424242', '918273', 'sk-live-abc123'];
const page = `<!doctype html><meta charset="utf-8">
<input id="pw" type="password"><input id="card" autocomplete="cc-number"><input id="otp" autocomplete="one-time-code">
<input id="key" name="apiKey"><input id="who" name="displayName">
<pre id="out"></pre>
<script>
// Read what the overlay displays: its shadow root is closed, so open it for the test only.
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
const shown = () => document.getElementById('__action-tracker-host')?.shadowRoot?.textContent ?? '';
const type = (id, text) => {
  const el = document.getElementById(id);
  el.focus();
  for (const key of text) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    el.value += key;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
};
const results = {};
(${read('skills/action-tracker/scripts/action-tracker-all.js').trim()})();
type('pw', 'hunter');
document.getElementById('pw').type = 'text'; // "show password"
type('pw', '2');
type('card', '4242424242424242');
type('otp', '918273');
type('key', 'sk-live-abc123');
type('who', 'Ana');
results.all = shown();
// Not one key line for a masked field: even a mark per key would tell its length.
window.__actionTracker.clear();
type('card', '42');
results.allMaskedKeys = shown();
window.__actionTracker.off();
delete window.__actionTracker;
// A fresh page's password field, for the agent's tracker.
document.getElementById('pw').type = 'password';
document.getElementById('pw').value = '';

(${read('skills/chrome-browser/scripts/action-tracker-agent.js').trim()})();
const act = window.__actionTracker.act;
document.getElementById('pw').focus();
for (const key of 'hunter2') act('key', key);
// Read before more actions push the key lines out of the overlay's last eight.
results.agentMaskedKeys = shown();
act('input', '#pw', 'hunter2');
act('input', '#card', '4242424242424242');
act('input', '#otp', '918273');
act('input', '#key', 'sk-live-abc123');
act('input', '#who', 'Ana');
act('key', 'Enter');
results.agent = shown();
window.__actionTracker.off();
document.getElementById('out').textContent = 'RESULT ' + JSON.stringify(results);
</script>`;

const browser = chrome();
if (!browser) {
  const message = 'No Chrome-family browser found; set CHROME_BIN to run the overlay check.';
  if (process.env.CI) {
    console.error(message);
    process.exit(1);
  }
  console.log(`skip - both overlays in a browser (${message})`);
  process.exit(0);
}
const profile = mkdtempSync(path.join(tmpdir(), 'skillmaster-trackers-'));
let dom = '';
try {
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=5000',
      '--dump-dom',
      `data:text/html;base64,${Buffer.from(page).toString('base64')}`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  child.stdout.on('data', (chunk) => {
    dom += chunk;
  });
  const timer = setTimeout(() => child.kill(), 60_000);
  await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(timer);
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
const reported = /<pre id="out">RESULT ([\s\S]*?)<\/pre>/.exec(dom)?.[1];
assert.ok(reported, `the page reported what the overlays showed:\n${dom.slice(0, 1_500)}`);
const results = JSON.parse(reported.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
const { allMaskedKeys, agentMaskedKeys, ...overlays } = results;
for (const [overlay, text] of Object.entries(overlays)) {
  assert.ok(text.length > 0, `the ${overlay} overlay shows its log`);
  for (const value of SECRETS) assert.ok(!text.includes(value), `the ${overlay} overlay shows ${value}:\n${text}`);
  assert.ok(text.includes(MASK), `the ${overlay} overlay marks what it masked`);
  assert.ok(text.includes('Ana'), `the ${overlay} overlay still shows an ordinary field:\n${text}`);
}
assert.ok(!/KEY/.test(allMaskedKeys), `no key line for a masked field:\n${allMaskedKeys}`);
assert.ok(/INPUT[^"]*= "•••"/.test(allMaskedKeys), `only its masked value:\n${allMaskedKeys}`);
assert.ok(!/KEY/.test(agentMaskedKeys), `no key the agent typed into the password:\n${agentMaskedKeys}`);
console.log('ok - both overlays in a browser: nothing typed into a masked field is shown, and an ordinary field still is');
