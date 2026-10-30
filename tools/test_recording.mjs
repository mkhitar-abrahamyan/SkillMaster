#!/usr/bin/env node
/**
 * The trackers' recording, proven: headless Chrome is driven over the DevTools protocol as an agent
 * drives it, with real clicks and keys on a served page. Requests fail, the page throws, a route
 * changes, a link leads to another page, and the page reloads; the tracker is run again after each
 * load, as the skills say. What it recorded comes back as a Playwright test, checked line by line
 * and by `node --check`, with nothing typed into a masked field in it, in the log, or in the storage
 * that carries both across the reload.
 *
 *   node tools/test_recording.mjs
 *
 * Without Chrome it says so and is skipped, except under CI, where it fails.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const ALL = read('skills/action-tracker/scripts/action-tracker-all.js').trim();
const AGENT = read('skills/chrome-browser/scripts/action-tracker-agent.js').trim();
// Typed into a masked field, or carried in a request, a console error, or a link: never recorded.
const SECRETS = ['hunter2', 's3cret-query', 'oauth-c0de', 's3cret-bearer', 's3ss10n', 'abc123', 'eyJhbGciOi', 'p4ss', 't0k3n'];

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

// ── The app under test ───────────────────────────────────────────────

const form = `<!doctype html><meta charset="utf-8"><title>Form</title>
<style>
  body { font: 14px sans-serif; }
  #tile { width: 80px; height: 30px; background: #ddd; }
  [contenteditable] { min-height: 20px; border: 1px solid #999; }
  .dot { display: inline-block; width: 20px; height: 20px; background: #09f; }
</style>
<button data-testid="save">Save</button>
<label for="email">Email</label> <input id="email" type="email">
<label>Password <input id="pw" type="password"></label>
<select aria-label="Plan"><option value="free">Free</option><option value="pro">Pro</option></select>
<label for="pw-ru">Пароль</label> <input id="pw-ru" name="backup_password" type="password">
<input id="suggest" placeholder="Search docs"> <button id="poll">Poll</button> <button id="creds">Retry</button>
<button id="menu"><span id="inner">Open menu</span></button>
<div id="tile"></div>
<label><input type="checkbox"> Remember me</label>
<div contenteditable aria-label="Bio"></div>
<section><p>Don't show again</p></section>
<div class="corner"><span class="dot" id=":r5:"></span></div>
<ul><li><button data-testid="delete">Delete</button></li><li><button data-testid="delete">Delete</button></li></ul>
<button id="fail">Load</button> <button id="xhr">Old load</button> <button id="cancel">Cancel</button>
<button id="boom">Boom</button> <button hidden>Settings</button> <button id="go">Settings</button>
<a id="next" href="/next?token=abc123&page=2">Next page</a>
<script>
const on = (id, f) => document.getElementById(id).addEventListener('click', f);
on('fail', () => fetch('/api/fail?token=s3cret-query&code=oauth-c0de'));
on('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', '/api/missing'); x.send(); });
on('cancel', () => {
  const controller = new AbortController();
  fetch('/api/aborted', { signal: controller.signal }).catch(() => {});
  controller.abort();
  const x = new XMLHttpRequest();
  x.open('GET', '/api/aborted-xhr');
  x.send();
  x.abort();
});
on('boom', () => {
  console.error('auth failed for Bearer s3cret-bearer', 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl', 'at /login?session=s3ss10n');
  Promise.reject(new Error('boom'));
  setTimeout(() => { throw new Error('thrown later'); }, 50);
});
on('go', () => history.pushState({}, '', '/settings?tab=profile'));
// A search box that asks a broken endpoint on every key, a poll that fails the same way three
// times, and credentials in an address.
document.getElementById('suggest').addEventListener('input', (e) => fetch('/api/suggest?q=' + e.target.value));
on('poll', () => { for (let i = 0; i < 3; i++) console.error('poll failed'); });
on('creds', () => {
  fetch('http://admin:p4ss@localhost:9/x').catch(() => {});
  console.error('retrying https://deploy:t0k3n@ci.example/x');
});
on('next', () => console.error('leaving'));
</script>`;
const next = `<!doctype html><meta charset="utf-8"><title>Next</title><button id="done">Done</button>`;
// A request before the page has a body: only a tracker run ahead of the page's own scripts sees it.
const early = `<!doctype html><meta charset="utf-8"><title>Early</title><script>fetch('/api/early')</script><button>Again</button>`;
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  if (pathname === '/api/fail') response.writeHead(500).end('failed');
  else if (pathname.startsWith('/api/') || pathname === '/favicon.ico') response.writeHead(404).end('missing');
  else response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end({ '/next': next, '/early': early }[pathname] ?? form);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

const browser = chrome();
if (!browser) {
  server.close();
  const message = 'No Chrome-family browser found; set CHROME_BIN to run the recording check.';
  if (process.env.CI) {
    console.error(message);
    process.exit(1);
  }
  console.log(`skip - the recording in a browser (${message})`);
  process.exit(0);
}

// ── Chrome over the DevTools protocol, as the agent's MCP server drives it ────

const profile = mkdtempSync(path.join(tmpdir(), 'skillmaster-recording-'));
// The protocol over a pipe, not a WebSocket: any Node version, no port.
const child = spawn(
  browser,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--window-size=1000,800', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const exited = new Promise((resolve) => child.on('exit', resolve));
let nextId = 0;
const pending = new Map();
const listeners = new Set();
let incoming = '';
child.stdio[4].setEncoding('utf8');
child.stdio[4].on('data', (chunk) => {
  incoming += chunk;
  for (let end = incoming.indexOf('\0'); end !== -1; end = incoming.indexOf('\0')) {
    const message = JSON.parse(incoming.slice(0, end));
    incoming = incoming.slice(end + 1);
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (waiting) {
      if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
      else waiting.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { method, resolve, reject });
    child.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });
const timeout = (what, ms = 15_000) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms).unref());

let sessionId;
const cdp = (method, params) => Promise.race([send(method, params, sessionId), timeout(method)]);
const event = (method) =>
  new Promise((resolve) => {
    const listener = (message) => {
      if (message.method === method && message.sessionId === sessionId) {
        listeners.delete(listener);
        resolve(message.params);
      }
    };
    listeners.add(listener);
  });
const load = async (action) => {
  const loaded = event('Page.loadEventFired');
  await action();
  await Promise.race([loaded, timeout('the page to load')]);
};
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(`in the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  return result.value;
};
const until = async (what, check) => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
// The overlay's shadow root is closed; opened here, for the test only, to read and drag the panel.
const OPEN_SHADOWS = `(() => {
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
})();`;
const install = (tracker) => evaluate(`${OPEN_SHADOWS}(${tracker})()`);
const panel = (id = 'panel') => `document.getElementById('__action-tracker-host').shadowRoot.getElementById('${id}')`;
const centre = (expression) =>
  evaluate(`(() => { const r = (${expression}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = (type, [x, y], extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
const click = async (selector, clickCount = 1) => {
  const at = await centre(`document.querySelector(${JSON.stringify(selector)})`);
  await mouse('mouseMoved', at, { button: 'none' });
  for (let count = 1; count <= clickCount; count++) {
    await mouse('mousePressed', at, { clickCount: count });
    await mouse('mouseReleased', at, { clickCount: count });
  }
};
const type = async (text) => {
  for (const key of text) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }
};
const press = async (key, code, keyCode, modifiers = 0) => {
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
};

const results = {};
try {
  const { targetInfos } = await Promise.race([send('Target.getTargets'), timeout('Chrome to start')]);
  ({ sessionId } = await send('Target.attachToTarget', { targetId: targetInfos.find((t) => t.type === 'page').targetId, flatten: true }));
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  // ── The user's tracker: everything done on the page ──
  await load(() => cdp('Page.navigate', { url: `${base}/` }));
  await install(ALL);
  await click('[data-testid="save"]');
  await click('#email');
  await type('ana@example.com');
  await press('a', 'KeyA', 65, 2); // Control+A
  await click('#pw');
  await type('hunter2');
  await press('Enter', 'Enter', 13);
  await evaluate(`(() => {
    const select = document.querySelector('select');
    select.value = 'pro';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await click('input[type="checkbox"]');
  await click('[contenteditable]');
  await type('hello');
  await click('#tile', 2);
  await click('#inner');
  await click('p');
  await click('.dot');
  await click('li:nth-of-type(2) button');
  // Each failure waited for, so it is recorded after the click that caused it and before the next.
  const logged = (pattern) => until(String(pattern), async () => pattern.test(await evaluate('window.__actionTracker.export()')));
  await click('#suggest');
  for (const typed of ['a', 'ab', 'abc']) {
    await type(typed.at(-1));
    await logged(new RegExp(`q=${typed} → 404`));
  }
  await click('#poll');
  await click('#creds');
  await logged(/localhost:9\/x → network error/);
  await click('#fail');
  await logged(/api\/fail.* → 500/);
  await click('#xhr');
  await logged(/api\/missing → 404/);
  await click('#cancel');
  await click('#boom');
  await logged(/thrown later/);
  await click('#go');
  // The panel dragged and folded, to be found where it was after the next page loads.
  const grip = await centre(panel('grip'));
  await mouse('mouseMoved', grip, { button: 'none' });
  await mouse('mousePressed', grip, { clickCount: 1 });
  await mouse('mouseMoved', [grip[0] - 400, grip[1] - 300]);
  await mouse('mouseReleased', [grip[0] - 400, grip[1] - 300], { clickCount: 1 });
  results.dragged = await evaluate(`(() => { const r = ${panel()}.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()`);
  const fold = await centre(panel('fold'));
  await mouse('mousePressed', fold, { clickCount: 1 });
  await mouse('mouseReleased', fold, { clickCount: 1 });

  // A link to another page: the overlay is gone until the tracker runs again, and then it continues.
  await load(() => click('#next'));
  results.goneAfterNavigation = await evaluate(`!document.getElementById('__action-tracker-host')`);
  await install(ALL);
  results.restoredPanel = await evaluate(
    `(() => { const p = ${panel()}; const r = p.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), p.classList.contains('collapsed')]; })()`,
  );
  // A key typed to the page is a line with no step after it: kept across the reload all the same.
  await type('q');
  await load(() => cdp('Page.reload'));
  await install(ALL);
  await click('#done');
  // The panel's buttons copy the test and the log, as the API returns them.
  await evaluate(`Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.copied = text; } } })`);
  for (const button of ['test', 'copy']) {
    const at = await centre(panel(button));
    await mouse('mousePressed', at, { clickCount: 1 });
    await mouse('mouseReleased', at, { clickCount: 1 });
    results[`copied-${button}`] = await until(`the ${button} button to copy`, () => evaluate('window.copied'));
    await evaluate('delete window.copied');
  }
  results.test = await evaluate('window.__actionTracker.test()');
  results.log = await evaluate('window.__actionTracker.export()');
  results.stored = await evaluate(`sessionStorage.getItem('__actionTracker:all')`);
  await evaluate('window.__actionTracker.off()');
  results.storedAfterOff = await evaluate(`sessionStorage.getItem('__actionTracker:all')`);
  results.fetchRestored = await evaluate(`/native code/.test(String(window.fetch)) && /native code/.test(String(console.error))`);

  // ── The agent's tracker: only what the agent reports ──
  await load(() => cdp('Page.navigate', { url: `${base}/` }));
  await install(AGENT);
  await evaluate(`(() => {
    const { act, note } = window.__actionTracker;
    note('Step: sign in');
    act('input', '#email', 'bo@example.com');
    act('input', '#pw', 'hunter2');
    act('input', '#pw-ru', 'hunter2'); // a label in Cyrillic: the variable is named for the field's name
    act('input', 'select', 'pro');
    act('key', 'Escape'); // to the page itself: nothing has focus
    act('click', '#menu');
    document.getElementById('email').focus();
    act('key', 'a');
    act('key', 'Enter');
    act('hover', document.getElementById('menu')); // an element, as evaluate_script passes one by uid
  })()`);
  await click('#tile'); // the user's own click: not the agent's, so not in its test
  // The agent navigates: a goto, not a URL check, as nothing it did on the page led there.
  await load(() => cdp('Page.navigate', { url: `${base}/next` }));
  await install(AGENT);
  // Run again on a page that has since wrapped fetch: the page's wrapper stays, then and after off().
  await evaluate(`(() => {
    const ours = window.fetch;
    window.pageFetch = function (...args) { return ours.apply(this, args); };
    window.fetch = window.pageFetch;
  })()`);
  await install(AGENT);
  results.pageFetchKeptOnRerun = await evaluate('window.fetch === window.pageFetch');
  results.agentTest = await evaluate('window.__actionTracker.test()');
  results.agentLog = await evaluate('window.__actionTracker.export()');
  await evaluate('window.__actionTracker.off()');
  results.agentStoredAfterOff = await evaluate(`sessionStorage.getItem('__actionTracker:agent')`);
  results.pageFetchKeptOnOff = await evaluate('window.fetch === window.pageFetch');

  // ── Run as a new-document script, as navigate_page's initScript runs it: on before the page is ──
  results.thrown = [];
  listeners.add((message) => {
    if (message.method === 'Runtime.exceptionThrown' && message.sessionId === sessionId) {
      results.thrown.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });
  const { identifier } = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `${OPEN_SHADOWS}(${ALL})()` });
  await load(() => cdp('Page.navigate', { url: `${base}/early` }));
  await logged(/early → 404/);
  results.earlyShown = await evaluate(`!!document.getElementById('__action-tracker-host')`);
  await load(() => cdp('Page.reload'));
  await until('the reloaded page to report its request', async () => (await evaluate('window.__actionTracker.test()')).split('request failed').length === 3);
  results.earlyTest = await evaluate('window.__actionTracker.test()');
  await evaluate('window.__actionTracker.clear()');
  results.cleared = await evaluate('window.__actionTracker.test()');
  // Over the limit of 500 steps, the oldest go, but the test still starts at its address.
  await evaluate(`(() => { for (let i = 0; i < 600; i++) window.__actionTracker.note('n' + i); })()`);
  results.trimmed = await evaluate('window.__actionTracker.test()');
  await evaluate('window.__actionTracker.off()');
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier });
} finally {
  await Promise.race([send('Browser.close'), timeout('Chrome to close', 5_000)]).catch(() => child.kill());
  await Promise.race([exited, timeout('Chrome to exit', 10_000)]).catch(() => child.kill());
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ── What was recorded ────────────────────────────────────────────────

const lines = (text) => text.split('\n').map((line) => line.trim());
const test = lines(results.test);
const expected = [
  `await page.goto('${base}/');`,
  `await page.getByTestId('save').click();`,
  `await page.getByLabel('Email').click();`,
  `await page.getByLabel('Email').fill('ana@example.com');`,
  `await page.getByLabel('Email').press('Control+a');`,
  `await page.getByLabel('Password').click();`,
  `await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? ''); // masked while recording`,
  `await page.getByLabel('Password').press('Enter');`,
  `await page.getByLabel('Plan').selectOption('pro');`,
  // A checkbox is its click, not a fill; an editable region is a field found by its label.
  `await page.getByLabel('Remember me').click();`,
  `await page.getByLabel('Bio').click();`,
  `await page.getByLabel('Bio').fill('hello');`,
  `await page.locator('#tile').dblclick();`,
  `await page.getByRole('button', { name: 'Open menu' }).click();`,
  `await page.getByText('Don\\'t show again').click();`,
  // Its id looks generated, so a path.
  `await page.locator('div:nth-of-type(3) > span').click();`,
  // The same test id, role, and name on every row: only a path finds the second.
  `await page.locator('li:nth-of-type(2) > button').click();`,
  // Typing is one fill, though a failed request came between each key.
  `await page.getByPlaceholder('Search docs').click();`,
  `await page.getByPlaceholder('Search docs').fill('abc');`,
  `// request failed: GET /api/suggest?q=a → 404`,
  `// request failed: GET /api/suggest?q=ab → 404`,
  `// request failed: GET /api/suggest?q=abc → 404`,
  // The same failure three times running is one counted comment.
  `await page.getByRole('button', { name: 'Poll' }).click();`,
  `// page error: poll failed (×3)`,
  // Credentials in an address are masked, in an error's text and in a request's URL.
  `await page.getByRole('button', { name: 'Retry' }).click();`,
  `// page error: retrying https://•••@ci.example/x`,
  `// request failed: GET http://•••@localhost:9/x → network error`,
  `await page.getByRole('button', { name: 'Load', exact: true }).click();`,
  `// request failed: GET /api/fail?token=•••&code=••• → 500`,
  `await page.getByRole('button', { name: 'Old load' }).click();`,
  `// request failed: GET /api/missing → 404`,
  `await page.getByRole('button', { name: 'Cancel' }).click();`,
  `await page.getByRole('button', { name: 'Boom' }).click();`,
  `// page error: auth failed for Bearer ••• ••• at /login?session=•••`,
  `// page error: unhandled rejection: boom`,
  `// page error: Uncaught Error: thrown later`,
  // A hidden button of the same name is not one getByRole finds.
  `await page.getByRole('button', { name: 'Settings' }).click();`,
  `await expect(page).toHaveURL('${base}/settings?tab=profile');`,
  `await page.getByRole('link', { name: 'Next page' }).click();`,
  // A note on the way does not hide that the click led to the next page.
  `// page error: leaving`,
  `await expect(page).toHaveURL(/^http:\\/\\/127\\.0\\.0\\.1:${port}\\/next\\?token=[^&#]*&page=2$/);`,
  `await page.reload();`,
  `await page.getByRole('button', { name: 'Done' }).click();`,
];
const body = test.slice(test.findIndex((line) => line.startsWith('test(')) + 1, test.lastIndexOf('});'));
assert.deepEqual(body, expected, `the user's recording as a test:\n${results.test}`);
assert.equal(test[0], "import { test, expect } from '@playwright/test';", 'a Playwright test');
assert.ok(test.includes('// Masked fields read their values from E2E_PASSWORD.'), `the masked field's variable is named:\n${results.test}`);
assert.match(results.test, new RegExp(`test\\('recorded on 127\\.0\\.0\\.1:\\d+ at \\d{4}-`), 'named for where and when it was recorded');
console.log(`ok - the user's actions as a Playwright test: ${expected.length} steps, locators unique as strict mode needs`);

const work = mkdtempSync(path.join(tmpdir(), 'skillmaster-recorded-'));
const file = path.join(work, 'recorded.spec.mjs');
writeFileSync(file, results.test);
const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
rmSync(work, { recursive: true, force: true });
assert.equal(check.status, 0, `the test is valid JavaScript:\n${check.stderr}\n${results.test}`);
console.log('ok - the exported test parses');

for (const [what, text] of Object.entries({ test: results.test, log: results.log, storage: results.stored, 'agent test': results.agentTest, 'agent log': results.agentLog })) {
  assert.ok(text, `the ${what} was read`);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `the ${what} holds ${secret}:\n${text}`);
}
assert.match(results.log, /NET GET \/api\/fail\?token=•••&code=••• → 500/, 'a failed fetch is in the log, its token and code masked');
assert.match(results.log, /NET GET \/api\/missing → 404/, 'a failed XHR is in the log');
assert.doesNotMatch(results.log, /aborted/, 'a request the page cancelled is not a failure');
assert.match(results.log, /ERROR unhandled rejection: boom/, 'an unhandled rejection is in the log');
assert.ok(results.log.includes('ERROR poll failed (×3)\n'), `a line repeated at once is counted:\n${results.log}`);
assert.ok(results.log.includes('INPUT div "Bio" = "hello"'), `an editable region's text is in its input line:\n${results.log}`);
assert.match(results.log, /NAV \/settings\?tab=profile/, 'an in-app route change is in the log');
assert.match(results.log, /NAV page loaded: \/next\?token=•••&page=2/, 'the next page, its token masked');
console.log('ok - failed requests, console errors, uncaught errors, and route changes are in the timeline, masked');

assert.equal(results.goneAfterNavigation, true, 'a full navigation takes the overlay away');
assert.deepEqual(results.restoredPanel, [...results.dragged, true], 'the panel is back where it was dragged, still folded');
assert.ok(lines(results.log).some((line) => /tracker on: \/$/.test(line)), `the log from before the navigation is kept:\n${results.log}`);
assert.ok(results.log.includes('KEY q\n'), `the last line before the reload is kept:\n${results.log}`);
assert.equal(results.storedAfterOff, null, 'off() drops what the tab kept');
assert.equal(results.fetchRestored, true, "off() puts the page's own fetch and console.error back");
console.log('ok - the recording, its log, and the panel survive a navigation and a reload; off() clears them');
assert.equal(results['copied-test'], results.test, "the panel's Test button copies the test");
assert.equal(results['copied-copy'], results.log, "its Copy button copies the log");
console.log("ok - the panel's Test and Copy buttons copy the test and the log");

const agent = lines(results.agentTest);
const agentBody = agent.slice(agent.findIndex((line) => line.startsWith('test(')) + 1, agent.lastIndexOf('});'));
assert.deepEqual(
  agentBody,
  [
    `await page.goto('${base}/');`,
    '// Step: sign in',
    `await page.getByLabel('Email').fill('bo@example.com');`,
    `await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? ''); // masked while recording`,
    `await page.getByLabel('Пароль').fill(process.env.E2E_BACKUP_PASSWORD ?? ''); // masked while recording`,
    `await page.getByLabel('Plan').selectOption('pro');`,
    `await page.keyboard.press('Escape');`,
    `await page.getByRole('button', { name: 'Open menu' }).click();`,
    `await page.getByLabel('Email').press('Enter');`,
    `await page.getByRole('button', { name: 'Open menu' }).hover();`,
    `await page.goto('${base}/next');`,
  ],
  `the agent's reported actions as a test:\n${results.agentTest}`,
);
assert.equal(results.agentStoredAfterOff, null, "off() drops what the agent's tracker kept");
assert.equal(results.pageFetchKeptOnRerun, true, "run again, the tracker leaves the page's own fetch wrapper in place");
assert.equal(results.pageFetchKeptOnOff, true, "off() puts back only what is still the tracker's");
console.log("ok - the agent's reported actions as a Playwright test, the user's own click left out");

assert.deepEqual(results.thrown, [], 'run before the page is parsed, the tracker throws nothing');
assert.equal(results.earlyShown, true, 'its overlay is on the page once there is one');
const earlyTest = lines(results.earlyTest);
assert.deepEqual(
  earlyTest.slice(earlyTest.findIndex((line) => line.startsWith('test(')) + 1, earlyTest.lastIndexOf('});')),
  [`await page.goto('${base}/early');`, '// request failed: GET /api/early → 404', 'await page.reload();', '// request failed: GET /api/early → 404'],
  `as a new-document script, it sees the page's first request on every load:\n${results.earlyTest}`,
);
const cleared = lines(results.cleared);
assert.deepEqual(
  cleared.slice(cleared.findIndex((line) => line.startsWith('test(')) + 1, cleared.lastIndexOf('});')),
  [`await page.goto('${base}/early');`],
  `clear() starts a fresh test from this page:\n${results.cleared}`,
);
const trimmed = lines(results.trimmed);
const trimmedBody = trimmed.slice(trimmed.findIndex((line) => line.startsWith('test(')) + 1, trimmed.lastIndexOf('});'));
assert.equal(trimmedBody.length, 500, 'at most 500 steps are kept');
assert.equal(trimmedBody[0], `await page.goto('${base}/early');`, `over the limit, the test still starts at its address:\n${trimmedBody.slice(0, 3).join('\n')}`);
assert.deepEqual([trimmedBody[1], trimmedBody.at(-1)], ['// n101', '// n599'], 'the oldest steps went, the newest stayed');
console.log("ok - as a new-document script it is on before the page's own scripts, on every load; clear() starts afresh; a long recording keeps its start");
