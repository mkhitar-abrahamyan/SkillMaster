# React and Next.js Review Reference

Load this reference for React or Next.js changes. Focus on behavior that can break under renders,
navigation, or request timing:

- Check hook dependency arrays and closures for stale props/state, especially callbacks used by
  effects, subscriptions, timers, and async requests.
- Question every new `useEffect`: distinguish synchronization with an external system from
  derived values or event-driven logic that should not be an effect.
- Look for duplicated derived state, state synchronization loops, unstable references, and
  memoization that hides rather than fixes repeated work.
- Check request cancellation, unmount cleanup, stale responses overwriting newer state, duplicate
  requests, loading/error/empty states, and query-cache invalidation.
- For Next.js, verify client/server boundaries, serialization, hydration, and assumptions about
  browser-only APIs. Everything a server component passes to a client component is sent to the
  browser: no secret, token, or whole database record may cross.
- Server Actions and route handlers are public HTTP endpoints, callable without the page that uses
  them: each checks authentication, authorization, and its input itself. Middleware alone is not an
  authorization boundary.
- For cached data and pages (`'use cache'`, cached `fetch`, `revalidate`, static rendering), check
  that one user's data cannot be served to another, and that each write revalidates what it changes.

Report a rendering or hook concern only when the changed behavior has a concrete failure scenario
or meaningful performance/regression impact.
