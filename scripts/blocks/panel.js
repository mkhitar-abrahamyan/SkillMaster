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
