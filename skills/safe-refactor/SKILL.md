---
name: safe-refactor
description: Use when the user asks to refactor, restructure, clean up, rename, extract, move, split, or modernize existing code without changing what it does, especially legacy, untested, or widely used code.
license: MIT
---

# Skill: Safe Refactor

Behavior is the contract; structure is negotiable. Pin the behavior first, change structure in
small reversible steps, and compare the result with the baseline.

## Boundary

- Keep behavior identical: no features, bug fixes, or contract changes inside the refactor. Record
  any bug found and preserve it; fixing it is a separate, explicit change.
- Limit edits to the refactor's scope, with no formatting churn or unrelated cleanup.
- Do not commit or push unless asked; suggest commit boundaries per step instead.
- Do not open `.env` files or secrets, and do not run migrations or deployments.

## Workflow

1. **Define the contract.** State the goal and the surface to preserve: public functions, classes,
   signatures, and types; return values; errors and messages that callers rely on; side effects
   (writes, events, log and metric names); ordering; serialized names (JSON fields, database
   columns, event names, routes, CLI flags); and the performance envelope.
2. **Find every caller.** Search static references and dynamic ones: string-based lookups,
   reflection and dependency-injection tokens, templates, configuration, serialization, package
   exports used by other packages, and tests. Treat a surface with unknown external consumers as
   frozen.
3. **Baseline.** Run the relevant tests, type-check, and build on the untouched code and record
   the results, including pre-existing failures, which must stay exactly as they are. When no
   baseline can run, stop and ask before refactoring.
4. **Characterize gaps.** Where the code to change has weak coverage, first add characterization
   tests that capture current outputs for representative and edge inputs, surprising behavior
   included. They must pass on the untouched code, and fail when the behavior they capture breaks.
   Run mutations with `scripts/mutate.mjs`, beside this file: list each as `{ "name", "file", "from", "to" }`
   with the test command in a JSON file, then `node scripts/mutate.mjs mutants.json --root <isolated copy>`.
   It requires a green baseline, applies each mutant alone, restores every file, and reports each as
   `killed`, `survived`, `timeout`, or `missing`. A characterization test that survives does not pin
   the behavior: strengthen it before refactoring.
5. **Refactor in steps.** Make one mechanical kind of change per step: rename, extract, inline,
   move, split, or change a signature behind an adapter. After each step, run the type-check or
   build and the baseline tests. When a step breaks something, revert that step and take a smaller
   one.
6. **Compare.** Final test results match the baseline: same passes, same pre-existing failures.
   Characterization tests pass unchanged. The public API surface and serialized names are
   unchanged (compare exports and types). Compare performance-sensitive paths where measurable.

## Output

Start with **Refactor result:** and the first matching result:

- Behavior could not be preserved and the changes were reverted -> `ABORTED`, with the reason.
- Preserved, but part of the surface could not be verified (untestable code, dynamic callers,
  external consumers) -> `PRESERVED WITH GAPS`.
- Otherwise -> `BEHAVIOR PRESERVED`.

Then include:

- **Contract:** the preserved surface.
- **Baseline vs after:** a table of each check with its before and after result.
- **Steps:** each step's change and its check result.
- **Characterization tests added:** paths.
- **Bugs found and preserved:** location and behavior, for a separate fix.
- **Residual risks:** unverified callers or surfaces.
