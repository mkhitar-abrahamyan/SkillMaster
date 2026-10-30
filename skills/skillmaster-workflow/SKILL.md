---
name: skillmaster-workflow
description: Use when the user asks SkillMaster to take a feature, bug fix, refactor, or CI failure from request to verified result end to end, such as "use SkillMaster to implement...", or asks to understand, plan, implement, test, and review a change in one run.
license: MIT
---

# Skill: SkillMaster Workflow

Deliver a change through gated stages and finish with a report that separates what was verified
from what was assumed.

## Stages

Run the stages in order. Each stage uses the named skill when it is installed; otherwise follow
the essentials in the table. Meet each gate before moving on.

| # | Stage | Skill | Essentials without the skill | Gate |
|---|-------|-------|------------------------------|------|
| 1 | Understand | `repo-context-builder` | Read project instructions, manifests, and CI; record commands with provenance | Build and test commands known |
| 2 | Plan | `feature-planner` | Acceptance criteria, impacted files, ordered steps with `verify:` lines, risks | `READY`, or the user accepted the assumptions |
| 3 | Implement | — | Follow the plan step by step and run each `verify:` line | Every step's verification passed |
| 4 | Verify | `ai-code-verifier`, `test-gap-finder` | Confirm your own imports, APIs, and dependencies exist in installed versions; add a test per acceptance criterion and prove each can fail | `VERIFIED`, and `GAPS CLOSED` or `ADEQUATE` |
| 5 | Review and attack | `ruthless-code-reviewer`, `adversarial-patch-attacker` | Defect-first review of the full diff; targeted attack tests on auth, data, and concurrency paths | No P0/P1; each P2 fixed or justified |
| 6 | Hand off | `session-handoff`; `context-keeper` when another chat or tool continues the work | The final report below | — |

Stage 2 depends on the task:

- **Feature:** `feature-planner` as above.
- **Bug:** `bug-reproducer`; gate `FIXED` with red-to-green evidence. Stage 3 is part of it.
- **CI failure:** `ci-failure-investigator`, then `bug-reproducer` for `CODE DEFECT` or
  `TEST DEFECT`; other classifications go to the user with the proposed correction.
- **Refactor:** `safe-refactor`; gate `BEHAVIOR PRESERVED`. Stage 5 attack is optional.
- **UI from a Figma design:** `figma-implementer` for the screen or component, through stage 4 for
  it; gate `MATCHES`, or `MATCHES WITH DEVIATIONS` the user accepts. The rest of the change takes
  the stages as usual.
- **Release:** after the change is `VERIFIED`, `release-captain`, which runs `ci-parity-check` before
  the tag; publishing still needs the user's explicit request.

## Rules

- **Ledger.** Keep a running list of every check (exact command and result) and every assumption.
  A check counts as passed only when it ran on the final code; re-run checks made stale by later
  edits, or report them as stale.
- **Fix loop.** Findings from stages 4 and 5 return to stage 3, then re-run the stage that found
  them. After two fix rounds on the same finding, stop looping and report it as unresolved.
- **Questions.** Ask about decisions that change architecture, data model, security posture, or
  public contracts, batched at stage 2. Record other open decisions as assumptions.
- **Scope of review.** Stages 4 and 5 target the complete change from stage 3, including
  uncommitted and untracked files.
- **In the browser.** A change to what a page shows or does is also checked in the running app
  with `chrome-browser`; unit tests alone do not show the page.
- **Where CI runs.** When CI runs on another OS or runtime version than this machine, run
  `ci-parity-check` before reporting `VERIFIED`; a check that passed only here is reported as
  passing here, not in CI.
- **Approval.** Commits, pushes, deployments, migrations against shared databases, and secret
  access each need the user's explicit approval.
- **Scale.** For a small change, stages 1 and 2 can be a few lines each. Stage 4's test evidence
  and the final report are always required.

## Final report

Start with **Delivery result:** and the first matching result:

- Work stopped at an unmet gate -> `BLOCKED`, naming the gate, the reason, and what is needed.
- P1/P2 findings or failing checks remain -> `ISSUES REMAIN`.
- An acceptance criterion or material check is unverified -> `PARTIALLY VERIFIED`.
- Otherwise -> `VERIFIED`.

Then include:

- **Changes:** files with one line each.
- **Acceptance criteria:** criterion -> test -> result.
- **Verified:** checks with commands and results, all run on the final code.
- **Unverified assumptions:** each with the evidence that would settle it.
- **Residual risks:** open findings and untested paths, with priority.
- **Next steps:** ordered, the first one immediately actionable.
