() => {
  // Chrome action tracker (AGENT-ONLY): shows only actions the agent performs; user input is ignored.
  // CDP input events are indistinguishable from user input, so this version attaches NO page listeners.
  // The agent reports each action itself: window.__actionTracker.act('click'|'hover'|'focus'|'input'|'key', selector|text, detail).
  // User actions are therefore never logged.
  // Paste as the `function` of evaluate_script (also usable as navigate_page `initScript`
  // body if wrapped as `(<this function>)()`). Idempotent; remove with window.__actionTracker.off().
  if (window.__actionTracker) {
    window.__actionTracker.on();
    return 'action-tracker already installed';
  }

  const MAX_LOG = 8;
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
  const lines = [];
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
    const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
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

  const add = (kind, text) => {
    lines.push({ kind, text, at: clock() });
    if (lines.length > MAX_LOG) lines.shift();
    log.innerHTML = lines.map((l, i) =>
      `<div class="row ${l.kind}${i < lines.length - 1 ? ' old' : ''}">${l.at} <b>${l.kind.toUpperCase()}</b> ` +
      `${l.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`).join('');
  };

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
      // A printable key the agent types into a masked field is not logged: one mark per key tells its length.
      if (String(sel).length === 1 && secret(document.activeElement)) return 'ok';
      add('key', String(sel));
      return 'ok';
    }
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) { add('nav', 'not found: ' + sel); return 'not found'; }
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    move(x, y);
    if (kind === 'click') { ripple(x, y); box(el, 'click', 'CLICK ' + describe(el)); add('click', `${describe(el)} @ ${Math.round(x)},${Math.round(y)}`); }
    else if (kind === 'hover') { box(el, 'hover', 'hover ' + describe(el)); add('hover', describe(el)); }
    else if (kind === 'focus') { box(el, 'focus', 'focus ' + describe(el)); add('focus', describe(el)); }
    else if (kind === 'input') {
      const v = secret(el) ? MASK : String(detail ?? '').slice(0, 40);
      box(el, 'focus', 'input ' + describe(el)); add('input', `${describe(el)} = "${v}"`);
    }
    return 'ok';
  };
  const on = () => { document.documentElement.appendChild(host); };
  const off = () => { host.remove(); };
  window.__actionTracker = {
    on, off, act,
    note: (text) => add('nav', String(text).slice(0, 120)), // label the step the agent is about to do
    clear: () => { lines.length = 0; log.innerHTML = ''; },
  };
  on();
  add('nav', 'agent tracker on: ' + location.pathname);
  return 'action-tracker installed';
}