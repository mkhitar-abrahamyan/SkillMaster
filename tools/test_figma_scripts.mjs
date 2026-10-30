#!/usr/bin/env node
/**
 * The figma-implementer's scripts, proven: measure-design.js reads a page whose styles are known, in
 * headless Chrome; visual-diff.mjs compares real Chrome screenshots, identical, shifted, and at twice
 * the scale, decodes a palette PNG it did not write, and its command exits as documented.
 *
 *   node tools/test_figma_scripts.mjs
 *
 * Without Chrome the browser checks say so and are skipped, except under CI, where they fail.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scripts = path.join(root, 'skills', 'figma-implementer', 'scripts');
const { compare, decodePng, encodePng } = await import(pathToFileURL(path.join(scripts, 'visual-diff.mjs')).href);
const work = mkdtempSync(path.join(tmpdir(), 'skillmaster-figma-'));

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

/** Runs headless Chrome on a page and returns its stdout, after it exits. */
async function headless(browser, page, extra) {
  const profile = mkdtempSync(path.join(tmpdir(), 'skillmaster-chrome-'));
  let stdout = '';
  try {
    const child = spawn(
      browser,
      ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${profile}`, ...extra, `data:text/html;base64,${Buffer.from(page).toString('base64')}`],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    const timer = setTimeout(() => child.kill(), 60_000);
    await new Promise((resolve) => child.on('close', resolve));
    clearTimeout(timer);
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return stdout;
}

try {
  // ── PNG, without a browser ───────────────────────────────────────────
  const image = { width: 3, height: 2, rgba: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128, 9, 9, 9, 255, 250, 250, 250, 0, 1, 2, 3, 255]) };
  assert.deepEqual(decodePng(encodePng(image)), image, 'a PNG it writes reads back the same');
  // A palette PNG with transparency, as an exporter writes one, built by hand.
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    let c = 0xffffffff;
    for (const byte of out.subarray(4, 8 + body.length)) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 3, 0, 0, 0], 8);
  const palettePng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('PLTE', Buffer.from([10, 20, 30, 200, 100, 50])),
    chunk('tRNS', Buffer.from([255, 0])),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 1]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.deepEqual([...decodePng(palettePng).rgba], [10, 20, 30, 255, 200, 100, 50, 0], 'a palette with transparency');
  assert.throws(() => decodePng(Buffer.from('not an image')), /not a PNG/);
  console.log('ok - PNG: written and read back, a palette with transparency, and a non-PNG refused');

  const browser = chrome();
  if (!browser) {
    const message = 'No Chrome-family browser found; set CHROME_BIN to run the browser checks.';
    if (process.env.CI) throw new Error(message);
    console.log(`skip - the browser checks (${message})`);
  } else {
    // ── measure-design.js on a page whose styles are known ──────────────
    const measure = readFileSync(path.join(scripts, 'measure-design.js'), 'utf8').replace(
      /const TARGETS = \[[\s\S]*?\];/,
      `const TARGETS = [
        { name: 'card', selector: '#card', children: true },
        { name: 'title', selector: '#title' },
        { name: 'price', selector: '#price' },
        { name: 'cta', selector: '#cta' },
        { name: 'missing', selector: '#nowhere' },
      ];`,
    );
    const measured = await headless(
      browser,
      `<!doctype html><meta charset="utf-8"><body style="margin:0">
<div id="card" style="display:flex;flex-direction:column;gap:12px;padding:24px 16px;background:#1a2b3c;border-radius:8px;border:1px solid rgba(255,0,0,0.5);box-shadow:0 2px 4px rgba(0,0,0,0.25);width:300px;font-family:Arial">
  <h2 id="title" style="margin:0;font-size:20px;font-weight:700;line-height:28px;letter-spacing:0.5px;color:#ffffff;text-transform:uppercase">Pro plan</h2>
  <p id="price" style="margin:0;font-size:32px;line-height:40px;color:rgb(0, 200, 100)">$29</p>
  <button id="cta" style="height:40px;opacity:0.5">Buy</button>
</div>
<pre id="out"></pre>
<script>document.getElementById('out').textContent = 'RESULT ' + (${measure.trim()})();</script>`,
      ['--window-size=800,600', '--virtual-time-budget=3000', '--dump-dom'],
    );
    const reported = /<pre id="out">RESULT ([\s\S]*?)<\/pre>/.exec(measured)?.[1];
    assert.ok(reported, `measure-design.js reported:\n${measured.slice(0, 1_000)}`);
    const { viewport, results } = JSON.parse(reported.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    const byName = Object.fromEntries(results.map((entry) => [entry.name, entry]));
    assert.ok(viewport.width > 700 && viewport.dpr === 1, `the viewport is reported: ${JSON.stringify(viewport)}`);
    const card = byName.card;
    assert.deepEqual(card.box, { x: 0, y: 0, width: 334, height: card.box.height }, 'width 300 + padding 32 + border 2');
    assert.deepEqual(
      [card.display, card.direction, card.gap, card.padding, card.background, card.radius, card.border],
      ['flex', 'column', 12, [24, 16, 24, 16], '#1a2b3c', 8, '1 solid #ff000080'],
    );
    assert.match(card.shadow, /#00000040/, 'a shadow color in hex');
    assert.deepEqual([card.children, card.gaps], [3, [12, 12]], 'the gaps between its children');
    assert.deepEqual(
      [byName.title.text, byName.title.font, byName.title.fontSize, byName.title.fontWeight, byName.title.lineHeight, byName.title.letterSpacing, byName.title.color, byName.title.textTransform],
      ['Pro plan', 'Arial', 20, 700, 28, 0.5, '#ffffff', 'uppercase'],
    );
    assert.equal(byName.price.color, '#00c864');
    assert.equal(byName.cta.opacity, 0.5);
    assert.equal(byName.cta.box.height, 40);
    assert.deepEqual(byName.missing, { name: 'missing', selector: '#nowhere', found: 0 });
    console.log('ok - measure-design.js: box, layout, gaps, typography, colors, border, shadow, opacity, and a missing target');

    // ── visual-diff.mjs on real screenshots ─────────────────────────────
    const shot = async (name, left, extra = []) => {
      const file = path.join(work, `${name}.png`);
      await headless(
        browser,
        `<!doctype html><body style="margin:0;background:#fff;overflow:hidden"><div style="position:absolute;left:${left}px;top:20px;width:60px;height:40px;background:#2255dd;border-radius:6px"></div><p style="position:absolute;left:20px;top:70px;margin:0;font:16px Arial">Pro plan</p>`,
        // Headless Chrome's viewport is much shorter than a small window, so the window is generous.
        ['--window-size=400,300', `--screenshot=${file}`, ...extra],
      );
      return file;
    };
    const design = await shot('design', 20);
    const same = await shot('same', 20);
    const shifted = await shot('shifted', 100);
    const double = await shot('double', 20, ['--force-device-scale-factor=2']);
    const nudged = await shot('nudged', 21);
    const read = (file) => decodePng(readFileSync(file));
    assert.equal(read(design).width, 400, 'a real Chrome screenshot decodes');

    const identical = compare(read(design), read(same));
    assert.deepEqual([identical.differingShare, identical.regions.length], [0, 0], 'the same render matches');
    // A one-pixel offset, as two renderers place an edge differently, is within tolerance.
    assert.equal(compare(read(design), read(nudged)).differingPixels, 0, 'a one-pixel offset is forgiven');
    const moved = compare(read(design), read(shifted));
    assert.ok(moved.differingShare > 3, `a moved box differs: ${moved.differingShare}%`);
    const covered = (x) => moved.regions.some((region) => region.x <= x && x < region.x + region.width && region.y <= 40 && 40 < region.y + region.height);
    assert.ok(covered(50) && covered(130), `regions where the box was and where it went: ${JSON.stringify(moved.regions)}`);
    assert.ok(!covered(300), 'and none where nothing changed');
    const scaled = compare(read(design), read(double));
    assert.deepEqual(scaled.scaledFrom, { width: 800, height: 600 }, 'a 2x capture is scaled to the design');
    assert.ok(scaled.differingShare < 2, `and still matches: ${scaled.differingShare}%`);

    // The command: exit codes and the diff picture.
    const cli = (...args) => spawnSync(process.execPath, [path.join(scripts, 'visual-diff.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(cli(design, same).status, 0, 'matching renders pass');
    const out = path.join(work, 'diff.png');
    const failing = cli(design, shifted, '--out', out, '--max', '1');
    assert.equal(failing.status, 1, 'over --max fails');
    assert.match(failing.stdout, /% of pixels differ/);
    const picture = read(out);
    assert.ok([...picture.rgba].some((value, i) => i % 4 === 0 && value === 230), 'the diff marks differing pixels in red');
    const garbage = path.join(work, 'garbage.png');
    writeFileSync(garbage, 'not a png');
    assert.equal(cli(design, garbage).status, 2, 'an unreadable image is refused');
    console.log('ok - visual-diff.mjs: real screenshots, identical, moved, at 2x, its exit codes, and its diff picture');
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
