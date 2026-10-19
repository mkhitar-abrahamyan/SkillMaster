---
name: adversarial-patch-attacker
description: Attempt to break a specified code change with focused reproduction tests or scripts. Use only when the user asks to attack, stress-test, fuzz, or try to break a patch; ordinary code-review requests belong to a review skill.
license: MIT
---

# Skill: Adversarial Patch Attacker

Prefer one verified failure over ten speculative concerns.

## Boundary and safety

This is an opt-in attack workflow, not an ordinary code review. If the user only asks to review a
PR, diff, or patch, use the review skill instead.

- Keep reviewed source, tracked tests, and the user's existing work unchanged. Run checks that
  write caches, build output, or reports in scratch space or an isolated working copy under the
  shared repository guidance. Do not modify commits or branches.
- Put generated tests, fixtures, and reproduction scripts in a temporary/scratch directory. If a
  retained artifact is explicitly useful, use the target project's designated artifact directory
  rather than a source or test directory.
- Do not commit, push, or post review comments.
- Do not run destructive reproductions against shared or production databases, queues, filesystems,
  or third-party services. Force dependency failures with mocks, local doubles, or isolated local
  resources only.
- If an attack would require credentials, external mutation, or unsafe shared infrastructure,
  mark that path blocked and continue independent safe checks. Report the resulting coverage gap.

## Scope and stopping rule

1. Resolve the target and read applicable repository instructions. Follow
   [Repository](references/repository.md) for diff selection, verification writes, and P0–P3 priorities.
   Inspect the complete scoped diff and enough surrounding code to identify the runtime paths
   the change can reach.
2. Identify the stack, then load only relevant shared references:
   - [TypeScript](references/typescript.md) for TypeScript or JavaScript.
   - [React](references/react.md) for React or Next.js.
   - [Backend](references/backend.md) for server, API, database, or queue changes.
3. Use `NO REACHABLE SURFACE` only when inspection establishes that the change has no runtime
   effect, such as documentation prose or comments. Renames, dependency/version changes, and
   configuration can affect imports, packaging, startup, or runtime behavior; inspect those paths.
   If reachability cannot be determined from the available target, use `INCONCLUSIVE`.
4. Attack only paths reachable from the diff. Prefer two or three deep, targeted attempts over
   broad shallow coverage. Stop when each material reachable risk has had a meaningful attack or
   further attempts would only repeat an exhausted scenario. A blocked check is not a successful
   attack. Expand the scope only when an attack reveals a new reachable path.

## Attack procedure

For each selected path:

1. State the invariant or assumption being attacked.
2. Construct the smallest realistic input, request sequence, state transition, or concurrency
   schedule that could violate it.
3. Produce and run a deterministic unit/integration test, reproduction script, or concrete local
   execution whenever possible. If execution is unavailable, distinguish a demonstrated code-path
   result from an untested hypothesis; do not describe a proposed test as having run.
4. Check the result against the expected behavior, including cleanup and state after failure.
5. Continue through the selected paths after finding a failure, but do not broaden into unrelated
   code.

Use these test-shape mappings:

- Retry or duplicate execution -> repeat the operation and assert side-effect/execution count.
- Idempotency -> submit the same operation twice and compare state and response.
- Authorization -> execute as a user who must not have access, including another tenant/resource.
- Concurrency or ordering -> run simultaneous/interleaved operations and assert the invariant.
- Failure or timeout -> force the dependency to fail at each relevant step and assert cleanup,
  error contract, and persisted state.
- State transition -> exercise the transition sequence, not only the final happy-path value.
- Boundary/input -> test empty, null, malformed, duplicate, missing, minimum, maximum, and
  oversized values only where the changed boundary accepts them.

## Evidence and outcomes

Do not create a finding merely because an attack is imaginable.

- A **verified failure** has a failing test, reproduction, runtime result, or directly demonstrated
  code path that proves the expected behavior is broken.
- An **unproven risk** must identify the changed code, a reachable trigger, concrete impact, and
  code or call-path evidence supporting the suspected failure introduced by the change. It must
  also name the exact unresolved assumption, state the evidence that would settle it, and explain
  why that evidence could not be gathered in this environment. Without all of these, omit the
  finding; retain any actual verification blocker in coverage. Missing evidence alone is not a risk.
- `INCONCLUSIVE` means the target or reachability could not be established, or a material check
  within the selected attack scope could not be assessed. Missing dependencies, permissions, or
  a failed test harness do not prove the patch is broken or that it survived.
- `SURVIVED` requires meaningful attacks or demonstrated code-path checks of the selected
  invariants, with no qualifying failure, unproven risk, or material blocked check within that
  scope. Report its scope explicitly; it does not establish that the entire patch is defect-free.

Use the shared P0–P3 priority definitions. Report verified failures and unproven risks only at
P0, P1, or P2; omit P3 concerns from this attack workflow. Unproven risks cannot be P0. Do not
inflate a low-impact hypothesis to produce `SUSPICIOUS`.

## Output

Start with **Attack result:** and choose one result using these rules in order:

- At least one verified failure -> `BROKEN`, even when other checks are blocked.
- Otherwise, at least one qualifying P1/P2 unproven risk -> `SUSPICIOUS`; disclose blocked checks.
- Otherwise, unresolved target/reachability or a material blocked check within the selected
  attack scope -> `INCONCLUSIVE`.
- Otherwise, inspection establishes no runtime effect -> `NO REACHABLE SURFACE`.
- Otherwise, the selected invariants were meaningfully checked without qualifying issues -> `SURVIVED`.

If no meaningful check could be completed, use `INCONCLUSIVE`, except for established changes
with no runtime effect. Deliberately excluded paths outside the selected attack scope remain
disclosed limits rather than claims that those paths survived.

### Attack Coverage

Always state the exact target and selected invariants. For each, give the method and observed
result, distinguishing executed tests, demonstrated code-path checks, and blocked/proposed checks.
List material reachable paths not attacked and why. For `INCONCLUSIVE`, state what evidence or
prerequisite is missing. For `NO REACHABLE SURFACE`, explain the evidence for no runtime effect
and state that no runtime attack was run.

### Verified Failures

For each verified failure:

#### [P1] Short, actionable title

**Location:** relevant file/function/line; keep the cited range within the diff when possible.

Use the appropriate P0/P1/P2 prefix and keep the title under 80 characters. In one concise
paragraph, give the exact triggering input/sequence/schedule, violated invariant, and evidence
from the test, reproduction, runtime result, or demonstrated code path. Add a minimal fix
direction or behavioral regression test only when useful. If there are no verified failures,
write `No verified failures.` This alone does not imply `SURVIVED`.

### Unproven Risks

List only P1/P2 risks meeting the evidence bar above. Use the same compact finding format, mark
each `unproven`, and cite the changed code, reachable trigger, concrete impact, and supporting
evidence. State the exact unresolved assumption, missing validation, and why it was unavailable.
Omit this section when none exist.

### Tests Generated

List generated tests or reproduction scripts, their scratch locations, and which were actually
run. Omit this section when none were generated. Do not repeat the attack result in a second rubric.
