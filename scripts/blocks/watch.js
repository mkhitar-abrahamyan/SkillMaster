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
