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
  // The environment variable a masked field's value comes from in the test, named after its label,
  // or its name or id when the label has no Latin letters or digits to make a name of, as "Пароль".
  const envName = (el) => {
    const word = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `E2E_${[labelOf(el), el.getAttribute('name'), el.id].map(word).find(Boolean) ?? 'SECRET'}`;
  };

  const record = (action, el, data = {}) => {
    const step = { action, ...data };
    if (el) {
      step.locator = locator(el);
      if (!step.locator) return;
    }
    const latest = steps[steps.length - 1];
    // The last thing done, past the notes of what failed on the way, such as the request a search
    // box sends for each key typed.
    let at = steps.length - 1;
    while (at >= 0 && steps[at].action === 'note') at--;
    const last = steps[at];
    const sameTarget = last && last.locator === step.locator;
    if (action === 'note' && latest?.action === 'note' && latest.text === step.text) {
      // The same failure again, as from a page polling a broken endpoint: counted, not listed again.
      latest.count = (latest.count ?? 1) + 1;
    } else if (sameTarget && ((action === 'fill' && last.action === 'fill') || (action === 'click' && data.count > 1 && last.action === 'click'))) {
      // Typing is one fill with the field's final value; a second click of a double click replaces the first.
      steps[at] = step;
    } else steps.push(step);
    // Over the limit the oldest steps go, but the test still starts at the address they had reached.
    while (steps.length > HISTORY) {
      const [dropped] = steps.splice(1, 1);
      if (dropped.url !== undefined) steps[0] = { action: 'goto', url: dropped.url };
    }
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
      else if (step.action === 'note') body.push(`  // ${step.text.replace(/\s+/g, ' ')}${step.count > 1 ? ` (×${step.count})` : ''}`);
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
