---
name: session-handoff
description: Use when ending or pausing a work session, switching AI models, tools, or chats, running low on context, or when the user asks for a handoff, status summary, progress notes, or a recap that another person or agent will pick up. Writes the note in the conversation; for records kept in the project's .context/ folder, which the next chat or tool resumes from, use context-keeper.
license: MIT
---

# Skill: Session Handoff

Write the note the next agent needs to continue in one read. Build it from the workspace and this
session's command results, not from memory.

## Workflow

1. **Workspace state.** Run `git status --short`, `git diff --stat`, `git diff --cached --stat`,
   and `git log --oneline -5`, and record the branch and HEAD. Include untracked files that belong
   to the work.
2. **Verification from this session.** For each check, record the exact command and its result,
   and whether it ran after the last edit to the files it covers. A check that ran before a later
   edit is `stale`. List checks that never ran as not run.
3. **In flight.** Work that is still running or waiting when the session ends: background jobs and
   watchers, CI, deploy, or publish runs, registry or review waits, and servers, containers, or
   tunnels started for the task. For each, how to check it and what to do when it finishes; say
   when one must be stopped, and how.
4. **Decisions.** For each meaningful decision: what was chosen, why, and the alternative rejected.
   Include user instructions and preferences that constrain the remaining work.
5. **Dead ends and gotchas.** Approaches ruled out, with the evidence, so they are not repeated;
   environment quirks such as failing commands, required setup, and flaky tests.
6. **Next actions** as an ordered list. The first must be executable without further discovery: an
   exact file, command, or question.
7. **Size and safety.** Aim for 40–80 lines. Reference files and line numbers instead of pasting
   code. Leave out secrets, tokens, and `.env` contents.
8. **Delivery.** Print the handoff in the conversation. Write it to a file only when asked, at the
   path the user names or the project's designated notes location; commit it only when asked.

## Template

```markdown
# Handoff: <task> — <date, time, timezone>

**Goal:** what done looks like, in one or two sentences.
**Status:** in progress | blocked | ready for review | done — one-line reason.
**Branch / HEAD:** `<branch>` @ `<short-sha>`; uncommitted changes: yes | no.

## Done
- Completed work, with `path` references.

## Changed files
- `path` — what changed (from git output)

## Verification
| Check | Command | Result | Fresh |
|-------|---------|--------|-------|
| Unit tests | `...` | 42 passed, 1 failed (`test name`) | yes |
| Lint | `...` | not run — reason | — |

## In flight
- What is running or waiting — how to check it — what to do when it finishes

## Decisions
- Decision — why — rejected alternative

## Dead ends and gotchas
- Tried X — ruled out because Y

## Open questions
- Question — who can answer it

## Next actions
1. Exact first step
2. ...
```

Verification, In flight, Open questions, and Next actions say `None` when empty; omit other empty
sections.
