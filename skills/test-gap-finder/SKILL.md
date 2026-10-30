---
name: test-gap-finder
description: Use when the user asks whether a change is adequately tested, which tests are missing, or to add tests for changed code, or before merging a change whose branches, error paths, or edge cases may be untested. Also use when coverage numbers look fine but confidence in the tests is low.
license: MIT
---

# Skill: Test Gap Finder

A line that runs is not a behavior that is tested. Map behaviors to assertions, then prove that
each new test can fail.

## Boundary and safety

- Follow [Repository](references/repository.md) for target selection, isolated verification
  writes, and P0–P3 priorities.
- Add tests to the project's test tree only when the user asked for tests to be added; otherwise
  write candidates in scratch space and report them.
- Keep source code unchanged. Run mutation checks in an isolated copy: a `git worktree` for
  committed targets, or a scratch copy of the working tree for local changes.
- Make tests deterministic: control network, clock, randomness, and ordering. A test of random or
  timed behavior asserts exactly, or with a margin no normal run crosses, such as five standard
  deviations: a bound that a correct run can miss becomes a flake in CI.

## Workflow

1. **Inventory behaviors.** For each changed function, endpoint, or component, list behaviors as
   `B1…Bn`: each branch outcome, error path, boundary (empty, null, minimum, maximum, duplicate),
   state transition, side effect (writes, events, outbound calls), and contract output (status
   codes, shapes, messages). Skip trivial accessors and pure wiring. Load the stack references that
   apply: [TypeScript](references/typescript.md), [React](references/react.md), and
   [Backend](references/backend.md) list what breaks there, and so the behaviors most often left
   untested, such as another tenant refused, a retried request applied once, or a stale response
   not overwriting a newer one.
2. **Map behaviors to tests.** Find tests that reach each behavior by searching the test tree for
   callers, and run coverage scoped to the changed files when the project has a coverage tool.
   Give each behavior one status:
   - `asserted` — a test reaches it and would fail if the behavior changed;
   - `executed only` — reached, but nothing meaningful is asserted (coverage without assertions,
     snapshots of mocks, assertions on a mock's own return value);
   - `untested`.
3. **Prioritize gaps** P1 to P3 by the impact of the behavior breaking: security, data, and
   contract paths first, then error handling, then edge cases.
4. **Write candidate tests** for the highest-priority gaps. Mirror a nearby existing test for
   framework, file location, naming, fixtures, factories, and mocking style. Cover one behavior per
   test and name the test for that behavior.
5. **Prove each test.** Run it on the target revision; it must pass. A test that fails there may
   have found a real defect: report it as a finding and leave the test asserting the correct
   behavior. Then, in the isolated copy, apply the smallest mutation that breaks that specific
   behavior (invert a condition, drop the error branch, shift the boundary) and confirm the test
   fails. A test that survives its mutation does not test the behavior; rewrite or discard it.
   Run mutations with `scripts/mutate.mjs`, beside this file: list each as `{ "name", "file", "from", "to" }`
   with the test command in a JSON file, then `node scripts/mutate.mjs mutants.json --root <isolated copy>`.
   It requires a green baseline, applies each mutant alone, restores every file, and reports each as
   `killed`, `survived`, `timeout`, or `missing`.
6. **Run the affected suite** to confirm the new tests pass alongside existing ones and in any order.

## Output

Start with **Coverage result:** and the first matching result:

- A new test fails on the target revision because of a real defect -> `DEFECT FOUND`.
- A P1 or P2 behavior is still `untested` or `executed only` -> `GAPS FOUND`.
- Gaps existed and mutation-proven tests now cover them -> `GAPS CLOSED`.
- The target or test tooling was unavailable for a material part -> `INCONCLUSIVE`.
- Otherwise -> `ADEQUATE`.

### Behavior map

| ID | Behavior | Location | Test | Status | Priority |
|----|----------|----------|------|--------|----------|

### Generated tests

For each test: path (scratch or project), behaviors covered, result on the target revision, and the
mutation applied with its outcome (`killed` or `survived`).

### Checks run

Exact commands with results, then what could not run and why.
