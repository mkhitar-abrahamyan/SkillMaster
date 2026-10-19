# Backend and API Review Reference

Load this reference for server, API, database, persistence, or queue changes:

- Treat authentication and authorization separately. Check resource ownership, tenant boundaries,
  role checks, and insecure direct object references at every newly reachable operation.
- Check validation at trust boundaries, API contract and status-code consistency, safe error
  responses, sensitive logging, and whether client-controlled values reach queries, commands, file
  paths, redirects, or deserializers.
- Check transaction boundaries, partial writes, uniqueness/race handling, idempotency, retry
  safety, and whether concurrent requests can duplicate or reorder an operation.
- Look for N+1 queries, missing pagination, unbounded result loading, repeated external calls,
  missing timeouts, and cache invalidation errors when the change affects data access.
- Trace DTOs, guards, controllers/resolvers, services, repositories, entities/schema, migrations,
  callers, and regression tests together for contract or persistence changes.

Report a backend or security concern only with a realistic affected path and impact; do not flag a
missing hardening measure that the changed operation cannot reach.
