# Backend and API Review Reference

Load this reference for server, API, database, persistence, or queue changes:

- Treat authentication and authorization separately. Check resource ownership, tenant boundaries,
  role checks, and insecure direct object references at every newly reachable operation.
- Check validation at trust boundaries, API contract and status-code consistency, safe error
  responses, sensitive logging, and whether client-controlled values reach queries, commands, file
  paths, redirects, deserializers, outbound URLs (server-side request forgery), or model fields the
  client must not set (mass assignment).
- For webhooks and signed requests, check that the signature is verified over the raw body with a
  constant-time comparison, that a replay outside its time window is refused, and that redelivery
  is idempotent.
- Check transaction boundaries, partial writes, uniqueness/race handling, idempotency, retry
  safety, and whether concurrent requests can duplicate or reorder an operation.
- Look for N+1 queries, missing pagination, unbounded result loading, repeated external calls,
  missing timeouts, and cache invalidation errors when the change affects data access.
- Trace DTOs, guards, controllers/resolvers, services, repositories, entities/schema, migrations,
  callers, and regression tests together for contract or persistence changes.
- A migration runs against live data while the previous release still serves. Check that a new
  required column has a default or is backfilled first, that a column the previous release reads
  is not renamed or dropped in the same release, that an index on a large table is built without
  blocking writes (such as `CONCURRENTLY`), that a backfill runs in batches, and that the down
  migration does not drop data without saying so.

Report a backend or security concern only with a realistic affected path and impact; do not flag a
missing hardening measure that the changed operation cannot reach.
