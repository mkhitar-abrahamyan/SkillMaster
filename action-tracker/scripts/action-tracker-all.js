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
  const secret = (el) => el && el.tagName === 'INPUT' && /password/i.test(el.type || '');
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
      const mods = ['Control', 'Alt', 'Shift', 'Meta'].filter((m) => e[m.toLowerCase() + 'Key'] && e.key !== m);
      const key = secret(document.activeElement) && e.key.length === 1 ? '\u2022' : e.key;
      add('key', [...mods, key].join('+'));
    },
    input: (e) => {
      const el = e.target;
      const v = secret(el) ? '\u2022'.repeat(String(el.value || '').length) : String(el.value ?? '').slice(0, 40);
      box(el, 'focus', 'input ' + describe(el));
      add('input', `${describe(el)} = "${v}"`);
    },
    change: (e) => add('input', `change ${describe(e.target)}`),
    scroll: () => {},
  };
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
    clear: () => { lines.length = 0; log.innerHTML = ''; },
  };
  on();
  add('nav', 'tracker on: ' + location.pathname);
  return 'action-tracker installed';
}
