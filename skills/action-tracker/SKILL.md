---
name: action-tracker
description: Use when the user wants a visible overlay in a Chrome tab that logs every pointer and keyboard action, theirs and the agent's, with the requests that failed and the errors the page threw, to watch or record an interaction, or to turn what they click through in the tab into a Playwright test. To show only the agent's own actions, use chrome-browser.
license: MIT
compatibility: Requires the Chrome DevTools MCP server (chrome-devtools) connected to a running Chrome with remote debugging enabled.
---

# All-actions tracker

Logs every hover, click, focus, key and input on the page, whether performed by the user or by the agent (CDP-driven events are indistinguishable from user events), with what the page did in return, and records the steps as a Playwright test. For an agent-only view use the tracker section of the `chrome-browser` skill instead.

## Install

1. Read `scripts/action-tracker-all.js` (next to this file) (one arrow function).
2. Call `evaluate_script` with its body unchanged as `function` (or the file as `sourcePath`, where the server takes one) and `waitForStableDom: false`. It is idempotent and returns `action-tracker installed` or `action-tracker already installed`.
3. A reload or a full navigation in the tab takes the overlay away. Run the script again the same way and the recording continues: the log, the steps, and the panel's place and fold come back from the tab's session storage. What happened on a page before it ran again is not recorded, so run it again as soon as a page loads. When the agent navigates the tab itself, pass the same text, wrapped as `(<function>)()`, as `navigate_page`'s `initScript`: the tracker is then on before the page's own scripts and sees their first requests. A page on another origin starts a fresh recording.
4. Do not run it together with the agent-only tracker from the `chrome-browser` skill on the same page: both use `window.__actionTracker`; call `window.__actionTracker.off()` and reload (or ensure only one is installed) before switching.

## Behavior

- White cursor arrow follows the pointer; red ripple and box on click; dashed blue box on hover; green box on focus/input.
- Panel titled "All actions" lists the last 8 timestamped lines: HOVER, CLICK (x,y), FOCUS, KEY, INPUT. The panel starts in the bottom-right corner. Drag it by its grip (⠿) anywhere on the page; **Test** puts the recording on the clipboard as a Playwright test; **Copy** puts the whole log there, up to the last 500 lines rather than the 8 shown, masked as shown; **–** folds it to its title bar and **+** opens it again. Using the panel is not logged as a page action.
- Between the actions: NET lines for the requests that failed, by `fetch` or XHR, with a status of 400 or more or no response at all (a request the page cancelled is not a failure); ERROR lines for `console.error`, uncaught errors, and unhandled rejections; NAV lines for in-app route changes. A query value with a sensitive name (a token, key, code, session, or signature), credentials in an address, a bearer token, and a JWT show as `•••`. A line repeated at once, as from a page polling a broken endpoint, is counted, such as `(×3)`.
- Values are masked as `•••`, whatever their length, in sensitive fields: passwords (and a field that was one before a "show password" toggle), hidden inputs, payment fields, one-time codes, API keys and tokens, PINs, bank and government IDs, by `type`, `autocomplete`, or the words of a field's name, id, label, or placeholder. A printable key typed into such a field is not logged at all, its typing is one uncounted line, and the line names the field without its text. Add `data-tracker-mask` to mask any other field, an editable region included. Ordinary text, email, and phone fields are shown.
- Closed shadow root, and click-through: only the panel's grip and three buttons take the pointer, so a click anywhere else, the rest of the panel included, reaches the page. It does not alter page styles. It wraps `fetch`, XHR, and `console.error` to see failures, and `.off()` puts them back.
- When debugging is finished (before the final answer), first hand over what the user needs, by returning `.test()` or `.export()`, because `.off()` drops the recording; then always run `() => { if (window.__actionTracker) { window.__actionTracker.off(); delete window.__actionTracker; } return !document.getElementById('__action-tracker-host'); }` so no overlay stays on the user's page.
- API: `window.__actionTracker.note("text")` adds a NAV line and a comment in the test, `.export()` returns the whole log as text, `.test()` returns the Playwright test, `.copy()` copies the log as the button does, `.dodge(selector)` moves the panel off an element (for a snapshot `uid`, pass the element instead: `(el) => window.__actionTracker.dodge(el)` with the `uid` in `args`), `.clear()` starts a fresh log and test from the current page, `.off()` removes the overlay, puts the page's functions back, and drops the recording the tab kept, `.on()` re-attaches it. To hand the user the log or the test, return `.export()` or `.test()` from `evaluate_script`.
- Limits: `fill` shows as FOCUS and INPUT (no per-keystroke KEY lines); a click can report an inner `svg` instead of the button. Before the agent clicks an element the panel's grip or buttons may cover, call `.dodge(selector)`: the panel moves to a clear corner, or folds when none is. Fold or move it when checking layout under it.

## Export a Playwright test

`.test()`, or the panel's **Test** button, turns the recording into a Playwright test:

- `page.goto` where the recording starts; clicks, double clicks, fills, selected options, and keys: Enter, Tab, Escape, arrows, and shortcuts such as `Control+a` (typed characters are in the fill). A checkbox or radio is its click; hovers and file inputs are left out.
- `expect(page).toHaveURL` where a click or key led to a new URL, in the app or to another page; `page.goto` where the address changed by other means; `page.reload()` for a reload. Failed requests, page errors, and notes are comments where they happened, the same one repeated at once counted; typing stays one fill when a failed request comes between the keys.
- Locators in Playwright's order: test id, label, placeholder, role and accessible name, text, an id that does not look generated, and a CSS path last. Each is used only when it finds the element alone, as strict mode requires, with `exact: true` where a substring would find more.
- A masked field is filled from an environment variable named for its label, or for its `name` or `id` when the label has no Latin letters, such as `E2E_PASSWORD`, listed at the top. Its value is never recorded.
- Past 500 steps the oldest go, and the test starts at the address they had reached.

A recording shows what happened, not what should: before it goes into a suite, add the assertions that state the expected result, and run it. Hand it to the user, or write it into the project's test directory when they asked for a test file.

## Safety

The overlay only observes. Its installation does not authorize actions that submit forms or persist application data; keep interactions within the user's requested scope and existing authorization. The recording lives in the tab's session storage, masked as the panel shows it, until `.off()` or the tab closes.
