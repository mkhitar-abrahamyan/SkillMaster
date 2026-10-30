---
name: action-tracker
description: Use when the user wants a visible overlay in a Chrome tab that logs every pointer and keyboard action, theirs and the agent's, with a cursor, click ripples, hover and focus boxes, and an action log, to watch or record an interaction. To show only the agent's own actions, use chrome-browser.
license: MIT
compatibility: Requires the Chrome DevTools MCP server (chrome-devtools) connected to a running Chrome with remote debugging enabled.
---

# All-actions tracker

Logs every hover, click, focus, key and input on the page, whether performed by the user or by the agent (CDP-driven events are indistinguishable from user events). For an agent-only view use the tracker section of the `chrome-browser` skill instead.

## Install

1. Read `scripts/action-tracker-all.js` (next to this file) (one arrow function).
2. Call `evaluate_script` with its body unchanged as `function` and `waitForStableDom: false`. It is idempotent and returns `action-tracker installed` or `action-tracker already installed`.
3. Do not run it together with the agent-only tracker from the `chrome-browser` skill on the same page: both use `window.__actionTracker`; call `window.__actionTracker.off()` and reload (or ensure only one is installed) before switching.

## Behavior

- White cursor arrow follows the pointer; red ripple and box on click; dashed blue box on hover; green box on focus/input.
- Bottom-right panel titled "All actions" lists the last 8 timestamped lines: HOVER, CLICK (x,y), FOCUS, KEY, INPUT.
- Values are masked as `•••`, whatever their length, in sensitive fields: passwords (and a field that was one before a "show password" toggle), hidden inputs, payment fields, one-time codes, API keys and tokens, PINs, bank and government IDs, by `type`, `autocomplete`, or the words of a field's name, id, label, or placeholder. A printable key typed into such a field is not logged at all. Add `data-tracker-mask` to mask any other field. Ordinary text, email, and phone fields are shown.
- Closed shadow root, `pointer-events: none`: does not intercept clicks or alter page styles.
- Lost on reload or full navigation; reinstall. In-app route changes keep it.
- When debugging is finished (before the final answer), always run `() => { if (window.__actionTracker) { window.__actionTracker.off(); delete window.__actionTracker; } return !document.getElementById('__action-tracker-host'); }` so no overlay stays on the user's page.
- API: `window.__actionTracker.note("text")` adds a NAV line, `.clear()` empties the log, `.off()` removes the overlay, `.on()` re-attaches it.
- Limits: `fill` shows as FOCUS and INPUT (no per-keystroke KEY lines); a click can report an inner `svg` instead of the button; the panel can cover the bottom-right corner (use `.off()` or element screenshots when checking layout there).

## Safety

The overlay only observes. Its installation does not authorize actions that submit forms or persist application data; keep interactions within the user's requested scope and existing authorization.
