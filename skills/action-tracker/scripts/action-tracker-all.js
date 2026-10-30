() => {
  // Chrome action tracker (ALL ACTIONS): logs every user AND agent hover, click, focus, key and input.
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
    <div class="panel" id="panel"><h4>All actions</h4><div id="log"></div></div>`;
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

  // shared-block: panel start
  // The log panel. The overlay stays click-through except the panel's grip and buttons, so the page
  // gets every click meant for it. The panel keeps the last HISTORY lines for copying while it shows
  // the last MAX_LOG, can be dragged by its grip and collapsed, and moves out of the way of an element
  // the agent is about to act on.
  const HISTORY = 500;
  const lines = [];
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
  };
  // The whole log as text, values already masked as the panel shows them.
  const exportLog = () => lines.map((l) => `${l.at} ${l.kind.toUpperCase()} ${l.text}`).join('\n');
  const copy = async () => {
    const text = exportLog();
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
    $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy'; }, 1200);
  };

  const place = (x, y) => {
    const r = panel.getBoundingClientRect();
    Object.assign(panel.style, {
      left: Math.max(0, Math.min(innerWidth - r.width, x)) + 'px',
      top: Math.max(0, Math.min(innerHeight - r.height, y)) + 'px',
      right: 'auto',
      bottom: 'auto',
    });
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
  $('fold').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    $('fold').textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });

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
    if (covers(rect)) {
      panel.classList.add('collapsed');
      $('fold').textContent = '+';
    }
    return true;
  };
  const dodgeTarget = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    return el && el.getBoundingClientRect ? dodge(el.getBoundingClientRect()) : false;
  };
  // shared-block: panel end

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

  let lastHover;
  const handlers = {
    mousemove: (e) => {
      move(e.clientX, e.clientY);
      const el = e.target;
      if (el !== lastHover) {
        lastHover = el;
        box(el, 'hover', 'hover ' + describe(el));
        add('hover', describe(el));
      }
    },
    mousedown: (e) => {
      move(e.clientX, e.clientY);
      ripple(e.clientX, e.clientY);
      box(e.target, 'click', 'CLICK ' + describe(e.target));
      add('click', `${describe(e.target)} @ ${Math.round(e.clientX)},${Math.round(e.clientY)}` +
        (e.detail > 1 ? ` x${e.detail}` : ''));
    },
    focusin: (e) => {
      box(e.target, 'focus', 'focus ' + describe(e.target));
      add('focus', describe(e.target));
    },
    keydown: (e) => {
      // A printable key in a masked field is not logged at all: even one mark per key tells its length.
      if (e.key.length === 1 && secret(document.activeElement)) return;
      const mods = ['Control', 'Alt', 'Shift', 'Meta'].filter((m) => e[m.toLowerCase() + 'Key'] && e.key !== m);
      add('key', [...mods, e.key].join('+'));
    },
    input: (e) => {
      const el = e.target;
      const v = secret(el) ? MASK : String(el.value ?? '').slice(0, 40);
      box(el, 'focus', 'input ' + describe(el));
      add('input', `${describe(el)} = "${v}"`);
    },
    change: (e) => add('input', `change ${describe(e.target)}`),
    scroll: () => {},
  };
  // The panel's grip and buttons are not page actions: their events reach the document from the host.
  for (const [kind, handler] of Object.entries(handlers)) handlers[kind] = (e) => { if (e.target !== host) handler(e); };
  const opts = { capture: true, passive: true };
  const on = () => {
    document.documentElement.appendChild(host);
    Object.entries(handlers).forEach(([k, f]) => document.addEventListener(k, f, opts));
  };
  const off = () => {
    Object.entries(handlers).forEach(([k, f]) => document.removeEventListener(k, f, opts));
    host.remove();
  };
  window.__actionTracker = {
    on, off,
    note: (text) => add('nav', String(text).slice(0, 120)), // label the step the agent is about to do
    clear: () => { lines.length = 0; render(); },
    export: exportLog, // the whole log as text, masked as shown
    copy, // to the clipboard, as the panel's Copy button does
    dodge: dodgeTarget, // the panel out of the way of an element, before acting on it
  };
  on();
  add('nav', 'tracker on: ' + location.pathname);
  return 'action-tracker installed';
}
