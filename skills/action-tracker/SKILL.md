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
- Panel titled "All actions" lists the last 8 timestamped lines: HOVER, CLICK (x,y), FOCUS, KEY, INPUT. The panel starts in the bottom-right corner. Drag it by its grip (⠿) anywhere on the page; **Copy** puts the whole log on the clipboard, up to the last 500 lines rather than the 8 shown, masked as shown; **–** folds it to its title bar and **+** opens it again. Using the panel is not logged as a page action.
- Values are masked as `•••`, whatever their length, in sensitive fields: passwords (and a field that was one before a "show password" toggle), hidden inputs, payment fields, one-time codes, API keys and tokens, PINs, bank and government IDs, by `type`, `autocomplete`, or the words of a field's name, id, label, or placeholder. A printable key typed into such a field is not logged at all. Add `data-tracker-mask` to mask any other field. Ordinary text, email, and phone fields are shown.
- Closed shadow root, and click-through: only the panel's grip and two buttons take the pointer, so a click anywhere else, the rest of the panel included, reaches the page. It does not alter page styles.
- Lost on reload or full navigation; reinstall. In-app route changes keep it.
- When debugging is finished (before the final answer), always run `() => { if (window.__actionTracker) { window.__actionTracker.off(); delete window.__actionTracker; } return !document.getElementById('__action-tracker-host'); }` so no overlay stays on the user's page.
- API: `window.__actionTracker.note("text")` adds a NAV line, `.export()` returns the whole log as text, `.copy()` copies it as the button does, `.dodge(selector)` moves the panel off an element, `.clear()` empties the log, `.off()` removes the overlay, `.on()` re-attaches it. To hand the user the log, return `.export()` from `evaluate_script`.
- Limits: `fill` shows as FOCUS and INPUT (no per-keystroke KEY lines); a click can report an inner `svg` instead of the button. Before the agent clicks an element the panel's grip or buttons may cover, call `.dodge(selector)`: the panel moves to a clear corner, or folds when none is. Fold or move it when checking layout under it.

## Safety

The overlay only observes. Its installation does not authorize actions that submit forms or persist application data; keep interactions within the user's requested scope and existing authorization.
