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
  const lineText = (l) => `${l.text}${l.count > 1 ? ` (×${l.count})` : ''}`;
  const render = () => {
    const shown = lines.slice(-MAX_LOG);
    log.innerHTML = shown
      .map((l, i) => `<div class="row ${l.kind}${i < shown.length - 1 ? ' old' : ''}">${l.at} <b>${l.kind.toUpperCase()}</b> ${escape(lineText(l))}</div>`)
      .join('');
  };
  // A line repeated at once, as from a page polling a broken endpoint, is counted. A masked field's
  // line is not (quiet): how many there were would tell the length of what was typed.
  const add = (kind, text, quiet = false) => {
    const last = lines[lines.length - 1];
    if (last && last.kind === kind && last.text === text) {
      if (!quiet) last.count = (last.count ?? 1) + 1;
      last.at = clock();
    } else {
      lines.push({ kind, text, at: clock() });
      if (lines.length > HISTORY) lines.shift();
    }
    render();
    save();
  };
  // The whole log as text, values already masked as the panel shows them.
  const exportLog = () => lines.map((l) => `${l.at} ${l.kind.toUpperCase()} ${lineText(l)}`).join('\n');
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
