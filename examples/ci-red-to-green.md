# Example: red CI to green

A failing pull-request check diagnosed with `ci-failure-investigator` and fixed with
`bug-reproducer`. Output excerpts are illustrative.

**Prompt**

> PR #77 is red on the "test" job but every test passes on my laptop. What's wrong?

## 1. Diagnose — `ci-failure-investigator`

The skill reads only what it needs, without re-running anything:

```bash
gh pr checks 77
gh run view 9123456789 --log-failed
gh run list --workflow ci.yml --branch main --status success --limit 1 --json databaseId,headSha
```

```markdown
CI diagnosis: TEST DEFECT

First failure: test > Run unit tests
  FAIL src/reports/summary.test.ts > renders the generated-at timestamp
  Expected: "Generated 19 Oct 2026, 13:00"
  Received: "Generated 19 Oct 2026, 09:00"

Evidence: the last green run on main used the same lockfile and runner image. The PR adds this
test, which hard-codes a time rendered in the author's UTC+4 zone; GitHub-hosted runners use UTC.
Running the test locally with TZ=UTC reproduces the failure.

Fix: render the expected value with the same formatter and an explicit timeZone, or set TZ for
the test run in the test configuration.

Fallout: "Upload coverage" failed because no coverage file was produced — a consequence of the
failed test step.
```

The diagnosis also skips the fixes it rejects: adding retries or skipping the test would hide a
real timezone dependence.

## 2. Fix — `bug-reproducer`

Because the classification is `TEST DEFECT`, the workflow hands over to `bug-reproducer`, which
treats the CI failure as its reproduction:

```markdown
Reproduction: TZ=UTC yarn vitest run src/reports/summary.test.ts -> 1 failed (before fix)
Fix: summary.test.ts builds the expected string with timeZone: "UTC" and pins TZ in vitest config.
Verification: TZ=UTC -> passed; TZ=Asia/Yerevan -> passed; yarn vitest run src/reports -> 41 passed.
Bug status: FIXED
```

Testing under two timezones shows the test no longer depends on the machine it runs on. Re-running
the CI job needs the user's approval; the report gives the command instead of running it.
