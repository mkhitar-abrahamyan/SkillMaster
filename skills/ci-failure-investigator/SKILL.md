---
name: ci-failure-investigator
description: Use when a CI pipeline, GitHub Actions workflow, or pull-request check is failing, red, flaky, or timing out, or broke without an obvious code change, and the user wants to know why or how to fix it. Accepts a run URL, run ID, PR, branch, or pasted log.
license: MIT
compatibility: Fetching GitHub Actions logs works best with the GitHub CLI (gh) authenticated for the repository; pasted logs also work.
---

# Skill: CI Failure Investigator

The first meaningful failure explains the run; most later failures are fallout from it.

## Boundary and safety

- Investigate without changing anything. Re-running or cancelling runs, editing workflows,
  changing secrets or variables, and pushing each need the user's explicit approval.
- Leave secret values masked. Logs show secrets as `***`; do not attempt to recover them, and do
  not print repository secrets or variables.
- When `gh` is unavailable or unauthenticated, offer to install it (`winget install GitHub.cli`,
  `brew install gh`, or the distribution's package). With the user's explicit go-ahead, the GitHub
  REST API works too, with a token they already have configured, such as git's credential helper
  (`git credential fill` for `github.com`): read it into a variable, never print, echo, log, or write
  it, and use it only to read this repository's runs. Otherwise ask for the run URL or the log text.

## Workflow

1. **Identify the run.** Resolve the workflow, run ID, attempt, commit SHA, branch or PR, and
   trigger event:
   `gh run view <run-id> --json workflowName,attempt,headSha,headBranch,event,conclusion,jobs`.
   For a PR, list its checks with `gh pr checks <pr>`. Without `gh`, the same comes from
   `GET /repos/{owner}/{repo}/actions/runs/{run_id}` and `.../runs/{run_id}/jobs`.
2. **Find the first meaningful failure.** Fetch failed-step logs with
   `gh run view <run-id> --log-failed`, or one job with `gh run view --job <job-id> --log`; without
   `gh`, `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`, which redirects to the log text. Order
   failures by job dependencies and time, and pick the earliest failing step of the earliest
   failing job. In its log, find the first error rather than the last line. Generic exit-code
   lines, post-job cleanup, and jobs skipped or cancelled after an earlier failure are fallout.
   For test steps, take the first failing test and its assertion or stack trace.
3. **Compare with the last green run.** Find it with
   `gh run list --workflow <workflow> --branch <branch> --status success --limit 1 --json databaseId,headSha`.
   Compare the two runs: code (`git diff <green-sha>..<red-sha> --stat`), workflow files,
   lockfiles, action versions, runner image (printed in the "Set up job" step), tool versions from
   setup steps, cache keys, and the permissions and secrets context (fork PRs, token scopes).
4. **Classify** from the evidence:
   - `CODE DEFECT` — the failure follows from changed code and reproduces locally.
   - `TEST DEFECT` — the test, fixture, or snapshot is wrong or brittle while the code is correct.
   - `FLAKY` — the same SHA has both passed and failed, or the failure depends on timing or order;
     name the source of nondeterminism.
   - `ENVIRONMENT` — runner image, tool, or dependency drift; registry or network outage; rate
     limits; disk or memory limits; corrupted cache.
   - `CONFIGURATION` — workflow syntax, permissions, missing secrets or variables, path or trigger
     filters, matrix definitions.
   - `INCONCLUSIVE` — the evidence cannot separate the candidates; name what would.
5. **Reproduce locally** when feasible: the same command, the tool versions from the setup steps,
   and the same environment variables without secrets. Record whether it reproduced.
6. **Propose the minimal correction** at the root cause: the code, the test, a pinned version, or
   the workflow. Retries, longer timeouts, `continue-on-error`, and skipping a test hide the cause;
   offer one only as a labeled temporary mitigation with a named follow-up.

## Output

Start with **CI diagnosis:** and the classification from step 4. Then include:

- **Run:** workflow, run ID and attempt, SHA, trigger, and link.
- **First failure:** job and step, with at most 15 log lines around the first error.
- **Evidence:** why this classification fits — the last-green comparison, the local reproduction
  result, and rerun history.
- **Fix:** the minimal change (file and diff sketch) or the action that needs approval.
- **Verification:** how to confirm the fix, and whether that was done.
- **Fallout:** later failures attributed to the first one, with a one-line reason each.
