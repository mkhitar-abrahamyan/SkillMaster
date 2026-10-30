() => {
  // Chrome action tracker (AGENT-ONLY): shows only actions the agent performs; user input is ignored.
  // CDP input events are indistinguishable from user input, so this version attaches NO input listeners.
  // The agent reports each action itself: window.__actionTracker.act('click'|'hover'|'focus'|'input'|'key', selector|text, detail).
  // User actions are therefore never logged. What the page does in return is: the requests that
  // failed and the errors it threw. The reported steps make a Playwright test: window.__actionTracker.test().
  // Paste as the `function` of evaluate_script (also usable as navigate_page `initScript`
  // body if wrapped as `(<this function>)()`). Idempotent; remove with window.__actionTracker.off().
  // After a reload or a full navigation in the same tab, run it again: the recording continues.
  if (window.__actionTracker) {
    window.__actionTracker.on();
    return 'action-tracker already installed';
  }

  const MAX_LOG = 8;
  const TRACKER = 'agent';
  const host = document.createElement('div');
  host.id = '__action-tracker-host';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: ui-monospace, Consolas, monospace; }
      .cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -3px 0 0 -3px;
        transition: transform 120ms ease-out; will-change: transform; display: none; }
      .cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
      .target { position: fixed; border: 2px solid #ff3b30; background: rgba(255,59,48,.12);
        border-radius: 3px; display: none; transition: all 120ms ease-out; }
      .target.hover { border-color: #0a84ff; background: rgba(10,132,255,.10); border-style: dashed; }
      .target.focus { border-color: #30d158; background: rgba(48,209,88,.10); }
      .tag { position: absolute; left: -2px; top: -22px; max-width: 360px; padding: 2px 6px;
        font-size: 11px; line-height: 16px; color: #fff; background: #ff3b30; border-radius: 3px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .target.hover .tag { background: #0a84ff; }
      .target.focus .tag { background: #30d158; color: #000; }
      .ripple { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
        border: 3px solid #ff3b30; animation: rip 700ms ease-out forwards; }
      @keyframes rip { to { transform: scale(4); opacity: 0; } }
      .panel { position: fixed; right: 12px; bottom: 12px; width: 380px; max-height: 40vh;
        background: rgba(20,20,24,.88); color: #e8e8ea; border-radius: 8px; padding: 8px 10px;
        font-size: 11px; line-height: 16px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
      .panel h4 { margin: 0 0 4px; font-size: 11px; color: #9aa; font-weight: 600; }
      .row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .row b { color: #ff9f0a; font-weight: 600; }
      .row.click b { color: #ff453a; } .row.key b { color: #bf5af2; }
      .row.input b { color: #30d158; } .row.hover b { color: #64d2ff; }
      .row.nav b { color: #ffd60a; } .row.old { opacity: .55; }
    </style>
    <div class="target" id="target"><div class="tag" id="tag"></div></div>
    <div class="cursor" id="cursor">
      <svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>
    </div>
    <div class="panel" id="panel"><h4>Agent actions</h4><div id="log"></div></div>`;
  const $ = (id) => root.getElementById(id);
  const cursor = $('cursor'), target = $('target'), tag = $('tag'), log = $('log');
  let hideTimer;

  const describe = (el) => {
    if (!el || !el.tagName) return '';
    const t = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const name = el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : '';
    const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${t}${id}${name}${label ? ' "' + label + '"' : ''}`;
  };
  // shared-block: sensitive-field start
  // Whether an element's value must never appear in the overlay, which shows in screenshots. It errs
  // toward masking: credentials, payment fields, one-time codes, bank and government IDs, hidden
  // inputs, and anything marked data-tracker-mask. A field seen once as a password stays masked
  // after a "show password" toggle turns it into text. Ordinary text, email, and phone fields show.
  const SENSITIVE_AUTOCOMPLETE = /(^|\s)(cc-|one-time-code|current-password|new-password)/i;
  // Matched against whole words of a field's name, id, label, and placeholder: "newPassword" and
  // "user_pin" are sensitive, "passenger", "footprint", and "pinned" are not.
  const SENSITIVE_WORDS =
    /\b(pw|pwd|pass|password|passwd|passcode|passphrase|secret|token|otp|pin|ssn|iban|cvv|cvc|api ?key|private ?key|security ?code|card ?(number|num|no)|cc ?(number|num))\b/;
  const words = (text) =>
    text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .toLowerCase();
  const wasPassword = new WeakSet();
  const secret = (el) => {
    if (!el || !el.getAttribute) return false;
    const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
    if (!field) return false;
    if (el.type === 'password') wasPassword.add(el);
    if (wasPassword.has(el) || el.type === 'hidden' || el.hasAttribute('data-tracker-mask')) return true;
    if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '')) return true;
    const names = [el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder')];
    return SENSITIVE_WORDS.test(words(names.filter(Boolean).join(' ')));
  };
  // A masked value: the same mark whatever its length, so the overlay reveals nothing about it.
  const MASK = '•••';
  // shared-block: sensitive-field end
  const clock = () => new Date().toLocaleTimeString('en-GB');

  // shared-block: recording start
  // The recording: what the panel shows (lines) and what a test is made of (steps), kept in the tab's
  // session storage, so a reload or a full navigation within the same origin continues it. Only
  // masked text is ever kept: a sensitive field's value is never recorded, only that it was filled.
  const HISTORY = 500;
  const STORE = `__actionTracker:${TRACKER}`;
  const lines = [];
  const steps = [];
  const state = { started: new Date().toISOString(), panel: undefined, collapsed: false, restored: false };
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (saved) {
      lines.push(...saved.lines);
      steps.push(...saved.steps);
      Object.assign(state, { started: saved.started, panel: saved.panel, collapsed: saved.collapsed, restored: true });
    }
  } catch {
    // No session storage here: the recording lives in this page alone.
  }
  const save = () => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ lines, steps, started: state.started, panel: state.panel, collapsed: state.collapsed }));
    } catch {
      // Storage full or unavailable: the panel still shows the recording.
    }
  };
  const forget = () => {
    try {
      sessionStorage.removeItem(STORE);
    } catch {
      // Nothing was kept.
    }
  };

  // A locator for an element as Playwright recommends: a test id, then its label, placeholder, role and
  // accessible name, or text; an id; and only then a CSS path, which breaks when the page changes.
  // Each is used only when it finds this element alone, as strict mode requires.
  const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const text = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label && textOf(label)) return textOf(label);
    }
    const wrapping = el.closest('label');
    return wrapping ? textOf(wrapping) : '';
  };
  const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider', number: 'spinbutton', search: 'searchbox', email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox' };
  const TAG_ROLES = { BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading' };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : '';
    if (el.tagName === 'INPUT') return INPUT_ROLES[(el.getAttribute('type') || 'text').toLowerCase()] ?? '';
    return TAG_ROLES[el.tagName] ?? '';
  };
  const TARGETS = '[data-testid],[data-test],[data-cy],button,a[href],input,select,textarea,summary,[role],[contenteditable]';
  // A field's text is what was typed into it, not a name to find it by.
  const isField = (el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable;
  const all = (selector) => [...document.querySelectorAll(selector)];
  const nameOf = (el) => (labelOf(el) || (isField(el) ? '' : textOf(el)) || el.getAttribute('title') || el.getAttribute('alt') || '').slice(0, 80);
  // Whether a Playwright text match finds one element among these, as strict mode requires: '' when
  // its default does, a substring in any case; 'exact' when only the whole text does; else undefined.
  const only = (candidates, textFor, text) => {
    const lower = text.toLowerCase();
    if (candidates.filter((e) => textFor(e).toLowerCase().includes(lower)).length === 1) return '';
    if (candidates.filter((e) => textFor(e) === text).length === 1) return 'exact';
    return undefined;
  };
  // getByText finds the innermost elements whose text matches.
  const innermost = (match) =>
    all('body *').filter((e) => !['SCRIPT', 'STYLE'].includes(e.tagName) && match(textOf(e)) && ![...e.children].some((c) => match(textOf(c))));
  const locator = (start) => {
    const el = start && start.closest ? start.closest(TARGETS) ?? start : start;
    if (!el || !el.getAttribute || el === document.body || el === document.documentElement) return undefined;
    for (const attribute of ['data-testid', 'data-test', 'data-cy']) {
      const value = el.getAttribute(attribute);
      if (value && all(`[${attribute}="${CSS.escape(value)}"]`).length === 1) {
        return attribute === 'data-testid' ? `page.getByTestId(${quote(value)})` : `page.locator(${quote(`[${attribute}="${value}"]`)})`;
      }
    }
    const field = isField(el);
    const label = labelOf(el);
    const exact = (how) => (how === 'exact' ? ', { exact: true }' : '');
    if (field && label) {
      const how = only(all('input, select, textarea, [aria-label], [aria-labelledby]'), labelOf, label);
      if (how !== undefined) return `page.getByLabel(${quote(label)}${exact(how)})`;
    }
    const placeholder = el.getAttribute('placeholder');
    if (field && placeholder) {
      const how = only(all('[placeholder]'), (e) => e.getAttribute('placeholder'), placeholder);
      if (how !== undefined) return `page.getByPlaceholder(${quote(placeholder)}${exact(how)})`;
    }
    const role = roleOf(el);
    const name = nameOf(el);
    if (role && name) {
      // getByRole leaves out what is hidden.
      const how = only(all('*').filter((e) => roleOf(e) === role && e.checkVisibility?.() !== false), nameOf, name);
      if (how !== undefined) return `page.getByRole(${quote(role)}, { name: ${quote(name)}${how ? ', exact: true' : ''} })`;
    }
    const own = textOf(el);
    if (!field && own && own.length <= 40) {
      const lower = own.toLowerCase();
      if (innermost((text) => text.toLowerCase().includes(lower)).length === 1) return `page.getByText(${quote(own)})`;
      if (innermost((text) => text === own).length === 1) return `page.getByText(${quote(own)}, { exact: true })`;
    }
    // An id that looks generated, with long digit runs or colons, changes between renders.
    if (el.id && !/\d{3,}|:/.test(el.id) && all(`#${CSS.escape(el.id)}`).length === 1) return `page.locator(${quote(`#${CSS.escape(el.id)}`)})`;
    // Last, a CSS path, as short as it can be while it still finds this element alone.
    const path = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
      const same = [...(node.parentElement?.children ?? [])].filter((sibling) => sibling.tagName === node.tagName);
      path.unshift(node.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''));
      if (all(path.join(' > ')).length === 1) return `page.locator(${quote(path.join(' > '))})`;
    }
    return `page.locator(${quote(`body > ${path.join(' > ')}`)})`;
  };
  // The environment variable a masked field's value comes from in the test, named after its label.
  const envName = (el) =>
    `E2E_${(labelOf(el) || el.getAttribute('name') || el.id || 'secret').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SECRET'}`;

  const record = (action, el, data = {}) => {
    const step = { action, ...data };
    if (el) {
      step.locator = locator(el);
      if (!step.locator) return;
    }
    const last = steps[steps.length - 1];
    const sameTarget = last && last.locator === step.locator;
    // Typing is one fill with the field's final value; a second click of a double click replaces the first.
    if (sameTarget && ((action === 'fill' && last.action === 'fill') || (action === 'click' && data.count > 1 && last.action === 'click'))) {
      steps[steps.length - 1] = step;
    } else steps.push(step);
    if (steps.length > HISTORY) steps.shift();
    save();
  };
  const KEYS = new Set(['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
  // A key worth a step of its own: navigation keys and shortcuts. Typed characters are in the fill.
  const pressable = (key, modifiers) => KEYS.has(key) || (modifiers.some((m) => m !== 'Shift') && key.length === 1);
  // The element a key goes to, or none when it goes to the page itself.
  const focused = () => {
    const el = document.activeElement;
    return el && el !== document.body && el !== document.documentElement && el !== host ? el : null;
  };

  // A recorded URL as the test checks it: exactly, or with any value where one was masked.
  const urlCheck = (url) =>
    url.includes(MASK) ? `/^${url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replaceAll(MASK, '[^&#]*')}$/` : quote(url);
  const value = (step) => (step.masked ? `process.env.${step.env} ?? ''` : quote(step.value));
  // The steps as a Playwright test.
  const toPlaywright = () => {
    const body = [];
    for (const step of steps) {
      const target = `  await ${step.locator}`;
      if (step.action === 'goto') {
        body.push(`  await page.goto(${quote(step.url)});${step.url.includes(MASK) ? ` // put the masked ${MASK} value back` : ''}`);
      } else if (step.action === 'url') body.push(`  await expect(page).toHaveURL(${urlCheck(step.url)});`);
      else if (step.action === 'reload') body.push('  await page.reload();');
      else if (step.action === 'click') {
        body.push(!(step.count > 1) ? `${target}.click();` : step.count === 2 ? `${target}.dblclick();` : `${target}.click({ clickCount: ${step.count} });`);
      } else if (step.action === 'hover') body.push(`${target}.hover();`);
      else if (step.action === 'fill') body.push(`${target}.fill(${value(step)});${step.masked ? ' // masked while recording' : ''}`);
      else if (step.action === 'select') body.push(`${target}.selectOption(${value(step)});${step.masked ? ' // masked while recording' : ''}`);
      else if (step.action === 'press') body.push(step.locator ? `${target}.press(${quote(step.key)});` : `  await page.keyboard.press(${quote(step.key)});`);
      else if (step.action === 'note') body.push(`  // ${step.text.replace(/\s+/g, ' ')}`);
    }
    const secrets = [...new Set(steps.filter((step) => step.masked).map((step) => step.env))];
    return [
      "import { test, expect } from '@playwright/test';",
      '',
      ...(secrets.length ? [`// Masked fields read their values from ${secrets.join(', ')}.`] : []),
      `test(${quote(`recorded on ${location.host || 'a local file'} at ${state.started}`)}, async ({ page }) => {`,
      ...body,
      '});',
      '',
    ].join('\n');
  };
  // shared-block: recording end

  // shared-block: panel start
  // The log panel. The overlay stays click-through except the panel's grip and buttons, so the page
  // gets every click meant for it. It shows the last MAX_LOG lines of the recording, copies all of it
  // or a Playwright test of its steps, can be dragged by its grip and folded, keeps its place across a
  // reload, and moves out of the way of an element the agent is about to act on.
  const panel = $('panel');
  const heading = panel.querySelector('h4');
  const controls = document.createElement('style');
  controls.textContent = `
    .panel h4 { display: flex; align-items: center; gap: 6px; }
    .panel h4 .title { flex: 1; }
    .grip, .button { pointer-events: auto; user-select: none; color: #dfe; background: rgba(255,255,255,.1);
      border: 0; border-radius: 4px; padding: 0 6px; font: inherit; line-height: 16px; cursor: pointer; }
    .grip { cursor: grab; touch-action: none; }
    .grip:active { cursor: grabbing; }
    .grip:hover, .button:hover { background: rgba(255,255,255,.22); }
    .panel.collapsed #log { display: none; }
    .panel.collapsed { width: auto; }`;
  root.appendChild(controls);
  const title = heading.textContent;
  heading.innerHTML =
    '<span class="grip" id="grip" title="Drag to move">⠿</span><span class="title"></span>' +
    '<button class="button" id="test" title="Copy a Playwright test of these steps">Test</button>' +
    '<button class="button" id="copy" title="Copy the whole log">Copy</button>' +
    '<button class="button" id="fold" title="Collapse or expand">–</button>';
  heading.querySelector('.title').textContent = title;

  const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const render = () => {
    const shown = lines.slice(-MAX_LOG);
    log.innerHTML = shown
      .map((l, i) => `<div class="row ${l.kind}${i < shown.length - 1 ? ' old' : ''}">${l.at} <b>${l.kind.toUpperCase()}</b> ${escape(l.text)}</div>`)
      .join('');
  };
  const add = (kind, text) => {
    lines.push({ kind, text, at: clock() });
    if (lines.length > HISTORY) lines.shift();
    render();
    save();
  };
  // The whole log as text, values already masked as the panel shows them.
  const exportLog = () => lines.map((l) => `${l.at} ${l.kind.toUpperCase()} ${l.text}`).join('\n');
  const copyText = async (text, button) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard API here, as on a plain-HTTP address other than localhost: select and copy.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:0;top:0;opacity:0;';
      root.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    const label = $(button).textContent;
    $(button).textContent = 'Copied';
    setTimeout(() => { $(button).textContent = label; }, 1200);
  };
  const copy = () => copyText(exportLog(), 'copy');
  const copyTest = () => copyText(toPlaywright(), 'test');

  const place = (x, y) => {
    const r = panel.getBoundingClientRect();
    const left = Math.max(0, Math.min(innerWidth - r.width, x));
    const top = Math.max(0, Math.min(innerHeight - r.height, y));
    Object.assign(panel.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
    state.panel = { left, top };
    save();
  };
  const fold = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    $('fold').textContent = collapsed ? '+' : '–';
    state.collapsed = collapsed;
    save();
  };
  let drag;
  $('grip').addEventListener('pointerdown', (e) => {
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { $('grip').setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has no capture */ }
  });
  $('grip').addEventListener('pointermove', (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
  $('grip').addEventListener('pointerup', () => { drag = undefined; });
  $('copy').addEventListener('click', copy);
  $('test').addEventListener('click', copyTest);
  $('fold').addEventListener('click', () => fold(!panel.classList.contains('collapsed')));
  // Where the panel was before a reload, and what it showed; again once it is on the page, so the
  // place it is put back is measured and kept inside a window that has since shrunk.
  const restore = () => {
    render();
    if (state.panel) place(state.panel.left, state.panel.top);
    if (state.collapsed) fold(true);
  };
  // The overlay on the page. Run as a new-document script, before the page is parsed, there is no
  // element to hold it yet: it goes on once the page is parsed.
  const show = () => {
    if (document.documentElement) document.documentElement.appendChild(host);
    else document.addEventListener('readystatechange', () => { show(); restore(); }, { once: true });
  };

  // Moves the panel to the corner farthest from a box it covers, so a click there reaches the page;
  // collapses it when no corner is clear. Whether it moved.
  const covers = (rect) => {
    const p = panel.getBoundingClientRect();
    return rect.left < p.right && rect.right > p.left && rect.top < p.bottom && rect.bottom > p.top;
  };
  const dodge = (rect) => {
    if (!rect || !covers(rect)) return false;
    const p = panel.getBoundingClientRect();
    const x = rect.left + rect.width / 2 < innerWidth / 2 ? innerWidth - p.width - 12 : 12;
    const y = rect.top + rect.height / 2 < innerHeight / 2 ? innerHeight - p.height - 12 : 12;
    place(x, y);
    if (covers(rect)) fold(true);
    return true;
  };
  const dodgeTarget = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    return el && el.getBoundingClientRect ? dodge(el.getBoundingClientRect()) : false;
  };
  // shared-block: panel end

  // shared-block: watch start
  // What the page did between the actions: failed requests, console errors, uncaught errors, and
  // in-app navigation, in the timeline and as comments and URL checks in the exported test. A query
  // value with a sensitive name, a bearer token, and a JWT are masked before they are shown or kept.
  // Every patch is undone by unwatch(), leaving the page's own functions as they were.
  const marks = document.createElement('style');
  marks.textContent = '.row.net b, .row.error b { color: #ff6961; } .row.error { color: #ffb4ab; }';
  root.appendChild(marks);
  const SENSITIVE_PARAM = /\b(auth|authorization|code|session|sid|sig|signature|jwt|credentials?)\b/;
  // A URL with its sensitive query values masked: the path alone for this origin, unless absolute.
  const maskUrl = (raw, absolute = false) => {
    try {
      const url = new URL(raw, location.href);
      for (const name of [...url.searchParams.keys()]) {
        if (SENSITIVE_WORDS.test(words(name)) || SENSITIVE_PARAM.test(words(name))) url.searchParams.set(name, MASK);
      }
      const shown = url.origin === location.origin && !absolute ? `${url.pathname}${url.search}` : url.href;
      return shown.replaceAll(encodeURIComponent(MASK), MASK);
    } catch {
      return String(raw).slice(0, 160);
    }
  };
  const maskText = (text) =>
    String(text)
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, MASK)
      .replace(/\b(bearer|basic)\s+[\w.~+/=-]+/gi, `$1 ${MASK}`)
      .replace(/([?&](?:[\w-]*(?:token|key|secret|password|auth|code|session|sig)[\w-]*)=)[^&\s"']+/gi, `$1${MASK}`)
      .slice(0, 200);
  const failed = (method, url, status) => {
    const text = `${method} ${maskUrl(url)} → ${status || 'network error'}`;
    add('net', text);
    record('note', null, { text: `request failed: ${text}` });
  };
  const pageError = (text) => {
    const masked = maskText(text);
    add('error', masked);
    record('note', null, { text: `page error: ${masked}` });
  };
  const describeValue = (value) => {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const original = {
    fetch: window.fetch,
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    error: console.error,
  };
  const watchedFetch = async function (input, init) {
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    try {
      const response = await original.fetch.apply(this, arguments);
      if (response.status >= 400) failed(method, url, response.status);
      return response;
    } catch (error) {
      // An aborted request was cancelled by the page, as a search box does on each key: not a failure.
      if (error?.name !== 'AbortError') failed(method, url, 0);
      throw error;
    }
  };
  const watchedOpen = function (method, url) {
    this.__actionTrackerRequest = { method: String(method).toUpperCase(), url: String(url) };
    return original.open.apply(this, arguments);
  };
  const watchedSend = function () {
    const request = this.__actionTrackerRequest;
    if (request) {
      this.addEventListener('abort', () => { request.aborted = true; }, { once: true });
      this.addEventListener('loadend', () => {
        if (!request.aborted && (this.status === 0 || this.status >= 400)) failed(request.method, request.url, this.status);
      }, { once: true });
    }
    return original.send.apply(this, arguments);
  };
  const watchedError = function (...args) {
    pageError(args.map(describeValue).join(' '));
    return original.error.apply(this, args);
  };
  // In-app navigation, however the router changes the URL: Chrome's Navigation API sees pushState,
  // replaceState, back and forward, and a new hash alike.
  let lastUrl = location.href;
  const navigated = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    add('nav', maskUrl(location.href));
    record('url', null, { url: maskUrl(location.href, true) });
  };
  const onError = (e) => pageError(e.message || describeValue(e.error));
  const onRejection = (e) => pageError(`unhandled rejection: ${describeValue(e.reason)}`);
  let watching = false;
  const watch = () => {
    if (watching) return;
    watching = true;
    window.fetch = watchedFetch;
    XMLHttpRequest.prototype.open = watchedOpen;
    XMLHttpRequest.prototype.send = watchedSend;
    console.error = watchedError;
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.navigation?.addEventListener('currententrychange', navigated);
  };
  const unwatch = () => {
    if (!watching) return;
    watching = false;
    // Only what is still ours goes back: a patch the page made on top of it stays.
    if (window.fetch === watchedFetch) window.fetch = original.fetch;
    if (XMLHttpRequest.prototype.open === watchedOpen) XMLHttpRequest.prototype.open = original.open;
    if (XMLHttpRequest.prototype.send === watchedSend) XMLHttpRequest.prototype.send = original.send;
    if (console.error === watchedError) console.error = original.error;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.navigation?.removeEventListener('currententrychange', navigated);
  };
  // Where the recording starts, or how it got here after a reload or a full navigation: a URL check
  // when a click or a key led here, so a link that goes elsewhere fails the test, and a goto when the
  // address was typed or the agent navigated.
  const arrived = (first) => {
    const here = maskUrl(location.href, true);
    const last = [...steps].reverse().find((step) => step.url !== undefined);
    const how = performance.getEntriesByType('navigation')[0]?.type;
    // The last thing done, past the notes of what failed on the way.
    const done = [...steps].reverse().find((step) => step.action !== 'note');
    if (!last) record('goto', null, { url: here });
    else if (state.restored && how === 'reload') record('reload');
    else if (last.url !== here) record(['click', 'press'].includes(done?.action) ? 'url' : 'goto', null, { url: here });
    add('nav', `${state.restored ? 'page loaded' : first}: ${maskUrl(location.href)}`);
  };
  // A fresh recording from this page.
  const restart = () => {
    lines.length = 0;
    steps.length = 0;
    state.started = new Date().toISOString();
    record('goto', null, { url: maskUrl(location.href, true) });
    render();
  };
  // shared-block: watch end

  const box = (el, mode, label) => {
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    Object.assign(target.style, {
      display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
    });
    target.className = 'target ' + mode;
    tag.textContent = label;
    tag.style.top = r.top < 26 ? 'auto' : '-22px';
    tag.style.bottom = r.top < 26 ? '-22px' : 'auto';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { target.style.display = 'none'; }, 2500);
  };
  const move = (x, y) => {
    cursor.style.display = 'block';
    cursor.style.transform = `translate(${x}px,${y}px)`;
  };
  const ripple = (x, y) => {
    const d = document.createElement('div');
    d.className = 'ripple';
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    root.appendChild(d);
    setTimeout(() => d.remove(), 800);
  };

  const act = (kind, sel, detail) => {
    if (kind === 'key') {
      // A key or a shortcut, such as Enter or Control+A, is a step; a typed character is in the fill.
      if (String(sel).length > 1) record('press', focused(), { key: String(sel) });
      // A printable key the agent types into a masked field is not logged: one mark per key tells its length.
      if (String(sel).length === 1 && secret(document.activeElement)) return 'ok';
      add('key', String(sel));
      return 'ok';
    }
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) { add('nav', 'not found: ' + sel); return 'not found'; }
    const r = el.getBoundingClientRect();
    // Out of the way first, so the action the agent is about to send reaches the page, not the panel.
    dodge(r);
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    move(x, y);
    if (kind === 'click') {
      ripple(x, y); box(el, 'click', 'CLICK ' + describe(el)); add('click', `${describe(el)} @ ${Math.round(x)},${Math.round(y)}`);
      record('click', el);
    }
    else if (kind === 'hover') { box(el, 'hover', 'hover ' + describe(el)); add('hover', describe(el)); record('hover', el); }
    else if (kind === 'focus') { box(el, 'focus', 'focus ' + describe(el)); add('focus', describe(el)); }
    else if (kind === 'input') {
      const masked = secret(el);
      const v = masked ? MASK : String(detail ?? '').slice(0, 40);
      box(el, 'focus', 'input ' + describe(el)); add('input', `${describe(el)} = "${v}"`);
      record(el.tagName === 'SELECT' ? 'select' : 'fill', el, masked ? { masked: true, env: envName(el) } : { value: String(detail ?? '') });
    }
    return 'ok';
  };
  const on = () => { show(); watch(); };
  // Off for good: the page's own functions back, and the recording this tab kept dropped.
  const off = () => { unwatch(); forget(); host.remove(); };
  window.__actionTracker = {
    on, off, act,
    // Label the step the agent is about to do, in the log and as a comment in the test.
    note: (text) => { add('nav', String(text).slice(0, 120)); record('note', null, { text: String(text).slice(0, 120) }); },
    clear: restart, // a fresh log and test, starting from this page
    export: exportLog, // the whole log as text, masked as shown
    test: toPlaywright, // the steps as a Playwright test, masked fields read from environment variables
    copy, // to the clipboard, as the panel's Copy button does
    dodge: dodgeTarget, // the panel out of the way of an element, before acting on it
  };
  on();
  restore();
  arrived('agent tracker on');
  return 'action-tracker installed';
}