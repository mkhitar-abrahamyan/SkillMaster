---
name: feature-planner
description: Use when the user asks to plan, scope, spec, or break down a feature or change before coding, when a request is vague or spans several modules, or when an implementation plan is needed for another engineer or model to execute.
license: MIT
---

# Skill: Feature Planner

Turn a request into a plan that another engineer, or a smaller model, can execute without
rediscovering context. Ground every step in the code; write no production code here.

## Boundary

- Keep project files unchanged. Write the plan to a file only when the user asks, at the location
  they choose or the project's designated docs or plans directory.
- Signatures, interface sketches, and pseudocode belong in the plan; implementations do not.
- When the user also asked for implementation, start it only after the plan is `READY` or the user
  accepts its assumptions.
- Do not open `.env` files, secrets, or credentials.

## Workflow

1. **Restate** the request in one or two sentences: the user-visible outcome, the actor, and the
   trigger.
2. **Ground in the repository.** Read project instructions, or an existing context document from
   `repo-context-builder`. Find the closest existing feature and use it as the template for
   structure, naming, and tests. Trace the entry point through every layer the feature touches.
   Check installed dependencies before planning a new one.
3. **Resolve ambiguity.** List the decisions the request leaves open. Ask the user, in one concise
   batch, only about decisions that change architecture, data model, security posture, public
   contracts, or scope. Record every other open decision as an assumption with the chosen default.
4. **Requirements.** Functional requirements; the non-functional ones that apply (security and
   authorization, performance, accessibility, internationalization, observability, backward
   compatibility); and explicit out-of-scope items.
5. **Acceptance criteria.** Numbered `AC1…ACn`, each an observable `Given / When / Then`. Cover
   failure, validation, and permission cases as well as the happy path.
6. **Impacted modules.** Exact paths, each marked `modify` (verified to exist) or `create`
   (location follows project convention), with the reason. Mark contract, schema or migration,
   authentication, configuration, and dependency changes as high risk.
7. **Steps.** Ordered, each small enough to review alone and leaving the build green. Each step
   names its files, the concrete change or pseudocode, the edge cases it handles, the pattern it
   reuses (`like path/to/example`), and a `verify:` line with a command and its expected outcome.
8. **Risks.** Impact, likelihood, and mitigation for each. Include migration order, feature flags,
   and rollback when data or contracts change.
9. **Test plan.** Map every acceptance criterion to unit, integration, or end-to-end tests with file
   locations and the project's commands. Name existing tests that must keep passing.

The plan is complete when every acceptance criterion maps to at least one step and one test, and
every high-risk change has a mitigation.

## Output

Start with **Plan readiness:** and the first matching result:

- An unanswered decision blocks the design -> `BLOCKED`; list the questions first.
- Assumptions remain that the user has not confirmed -> `READY WITH ASSUMPTIONS`.
- Otherwise -> `READY`.

Then fill in this structure:

```markdown
## Summary
## Assumptions            (each with the default chosen)
## Requirements           (functional / non-functional / out of scope)
## Acceptance criteria    (AC1..ACn, Given / When / Then)
## Impacted modules       (path — modify | create — reason)
## Implementation steps   (1..n: files, change, edge cases, reuse, verify:)
## Risks                  (risk — impact / likelihood — mitigation)
## Test plan              (AC -> test file -> command)
## Open questions
```

Cite evidence for each reuse claim as `path:line`. Assumptions and Open questions say `None` when
empty; omit other empty sections.
