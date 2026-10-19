---
name: bug-reproducer
description: Use when the user reports a bug, regression, crash, wrong output, or "this used to work" behavior and wants it reproduced, diagnosed, or fixed, including issue tickets, error messages, and stack traces. Not for trying to break a new patch, which belongs to adversarial-patch-attacker.
license: MIT
---

# Skill: Bug Reproducer

A fix that was never seen failing is a guess. Reproduce first, then find the cause, then fix and
show the reproduction turn from red to green.

## Boundary and safety

- Apply a fix only when the user asked for one. For "investigate", "reproduce", or "why does…"
  requests, stop after diagnosis and describe the proposed fix.
- Reproduce against local or isolated resources. Use mocks, local doubles, or seeded local data
  instead of production or shared databases, queues, and third-party services.
- Do not open `.env` files, secrets, or credentials. Do not commit, push, or rewrite history.
- Retained regression tests go in the project's test location and follow its conventions;
  throwaway scripts go in scratch space.

## Workflow

1. **Capture the report.** Expected versus actual behavior, exact error and stack trace, steps,
   inputs, environment (versions, OS, browser, configuration, data), and first bad version if
   known. Ask only when the bug cannot be approached without a missing fact.
2. **Reproduce before fixing.** Run the reported steps, then shrink them to the smallest
   deterministic reproduction at the lowest layer that still shows the symptom, preferably an
   automated test in the project's framework. Assert on the reported symptom, not on an incidental
   error. Run it and keep the failing output.
3. **When it does not reproduce,** vary one factor at a time toward the reporter's environment:
   versions, configuration, data shape and size, locale and timezone, concurrency and timing,
   cache state, permissions. Use `git bisect` when a known-good revision exists. After a bounded
   set of attempts, stop and report what was tried instead of shipping an unconfirmed fix.
4. **Find the root cause.** Trace backward from the failing assertion through data and control
   flow to where the wrong value or state originates. Test one hypothesis at a time with an
   observation that distinguishes it (log, debugger, assertion). Separate the root cause from the
   symptom and from contributing factors. Search for the same faulty pattern elsewhere.
5. **Fix minimally** at the root cause, with no unrelated refactoring or cleanup. When the right fix
   is large or changes a contract, stop and present options.
6. **Verify red to green.** Show the reproduction failing before the fix and passing after it.
   Run the affected module's tests, then the broader suite the project uses for that area. When a
   related test fails, run it on the unfixed revision to tell a new regression from a pre-existing
   failure.
7. **Keep the guard.** Turn the reproduction into a regression test named for the behavior.

## Output

Start with **Bug status:** and the first matching result:

- Fix applied, reproduction failed before and passes after, related tests run -> `FIXED`.
- Reproduced and root cause identified, fix not applied -> `REPRODUCED`.
- Bounded attempts did not reproduce the bug -> `NOT REPRODUCED`.
- The target, environment, or evidence needed to judge is missing -> `INCONCLUSIVE`.

Then include the sections that apply:

- **Reproduction:** command or test path, and the failing output (at most 15 lines).
- **Root cause:** `file:line`, the mechanism in one paragraph, and confidence `verified` or
  `likely` with its evidence.
- **Fix:** files changed and why the change addresses the root cause.
- **Verification:** before and after results of the reproduction; regression commands with pass
  and fail counts.
- **Attempts:** for `NOT REPRODUCED` or `INCONCLUSIVE`, each variation tried with its result, and
  the evidence that would help next.
- **Related risks:** other occurrences of the faulty pattern and untested paths.
