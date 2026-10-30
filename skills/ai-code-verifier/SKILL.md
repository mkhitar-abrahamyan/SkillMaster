---
name: ai-code-verifier
description: Use when code written or changed by an AI assistant or agent needs checking before it is trusted or merged, when an AI summary claims tests pass or a feature works, or when a change adds dependencies, imports, APIs, flags, or config keys that might not exist. Use for hallucination, slopsquatting, and unsupported-claim checks rather than a general code review.
license: MIT
---

# Skill: AI Code Verifier

Treat every claim in AI-written code and its summary as unverified until it is checked against
installed code, the package registry, or a command you ran.

## Boundary and safety

- Keep the reviewed change unchanged; mutations run only in an isolated copy. Follow
  [Repository](references/repository.md) for target selection, isolated verification writes, and
  P0–P3 priorities.
- Check package existence and identity through registry metadata only. Installing an unknown,
  newly published, or near-miss package to test it is the attack this skill guards against;
  report it as a finding instead.
- Do not commit, push, or post comments. Report findings; the author fixes them.

## Workflow

1. **Collect target and claims.** Resolve the diff or files. Gather the AI's own statements from
   its summary, PR description, commit messages, and comments ("handles X", "tests pass",
   "compatible with Y"). Number them `C1…Cn`.
2. **Dependencies.** For each added or changed dependency, confirm through registry metadata that
   the package exists and is the intended one: exact spelling, publisher and source repository,
   publish age, and release history, since near-miss names are a supply-chain risk. Examples:
   `npm view <pkg> versions repository.url time.created`, `pip index versions <pkg>`,
   `go list -m -versions <module>`. Confirm the pinned version exists and that the manifest and
   lockfile changed consistently. Check everything else the change pulls in by name the same way:
   GitHub Actions in `uses:` (the action and its tag exist; a third-party action is pinned to a
   commit SHA), container images and their tags, and tools or MCP servers run through `npx`, `uvx`,
   or `pipx`. A new package that runs install scripts (`npm view <pkg> scripts`) gets a read of what
   they run.
3. **Imports and symbols.** Every import must resolve to a real module and export (default versus
   named, path, casing). Every called API, option, CLI flag, configuration key, environment
   variable, and URL must exist in the **installed** version, with matching arguments and return
   types. Check type definitions or source in the dependency directory, or official docs for that
   exact version. Flag deprecated or removed APIs.
4. **Static checks.** Run the project's type-check, compile, and lint for the affected scope
   without autofix. Record exact commands and results.
5. **Test claims.** Re-run every test the AI claims passes, on the target revision. Confirm those
   tests exist, are not skipped or focus-filtered, execute the changed code, and assert on
   behavior rather than on constants or on a mock of the unit under test. Check whether existing
   tests or assertions were deleted or weakened in the change. For a claimed test of changed
   behavior, break that behavior in an isolated copy: a test that still passes does not test what
   the claim says, which settles the claim as `contradicted`.
   Run mutations with `scripts/mutate.mjs`, beside this file: list each as `{ "name", "file", "from", "to" }`
   with the test command in a JSON file, then `node scripts/mutate.mjs mutants.json --root <isolated copy>`.
   It requires a green baseline, applies each mutant alone, restores every file, and reports each as
   `killed`, `survived`, `timeout`, or `missing`.
6. **AI-specific defect patterns.** In the changed code, look for leftover placeholders, stubs, or
   TODOs; invented constants presented as real (limits, IDs, endpoints); happy-path-only handling;
   swallowed errors and fallbacks that hide failure; missing `await`; hard-coded credentials or
   sample data; helpers that duplicate an existing utility; and edits outside the stated scope.
7. **Settle each claim** as `verified` (re-ran or traced and observed), `contradicted` (evidence
   shows it is false), or `unverified` (could not be checked; state why).

## Output

Start with **Verification result:** and the first matching result:

- A contradicted claim, a nonexistent package, import, or API, or any P0/P1 finding -> `FAILED`.
- Otherwise any P2/P3 finding -> `ISSUES FOUND`.
- Otherwise a material claim is `unverified` or a material check could not run -> `INCONCLUSIVE`.
- Otherwise -> `VERIFIED`.

### Claims

| ID | Claim | Status | Evidence |
|----|-------|--------|----------|

### Findings

Order from P0 to P3. For each: a heading `[P1] Short actionable title`, then **Location:** file and
smallest line range, **Confidence:** `verified`, `likely`, or `unverified`, and one paragraph
giving the trigger, cause, and concrete impact with the supporting evidence. Write `No findings.`
when there are none.

### Checks run

Exact commands with results, then checks not run and why.
