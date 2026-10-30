---
name: ci-parity-check
description: Use before pushing or tagging when checks pass locally but CI runs on another OS, runtime version, or clean environment, or when the user asks whether a change will pass CI, wants the CI matrix reproduced locally, or suspects a test is flaky or platform-dependent. Not for diagnosing a run that already failed, which belongs to ci-failure-investigator.
license: MIT
compatibility: Stands in for CI with what the machine has, such as WSL or a Linux VM, Docker or Podman, and side-by-side runtime versions or a version manager.
---

# Skill: CI Parity Check

Green on your machine is one data point. Run what CI runs, where it runs it, from what it checks
out, before a push finds out the hard way.

## Boundary and safety

- Leave the user's working tree as it is: run in a clean export or a worktree.
- Use local resources only. Do not push to trigger CI, re-run remote runs, or use secrets; a step
  that needs one is a cell without a stand-in.
- Installing runtimes, container images, or system packages needs the user's go-ahead.

## Workflow

1. **Read the matrix.** From the CI configuration: OS images, runtime versions, services and their
   images, environment variables by name, and the exact commands in their order, including flags
   that make a skippable check mandatory there, such as one that requires a container daemon.
2. **Export what CI checks out.** Make a clean copy of the commit, not the working tree:
   `git -c core.autocrlf=false archive HEAD | tar -x -C <scratch>`, or a fresh worktree. Untracked
   files stay out, and line endings match the repository rather than a Windows checkout; confirm on
   one file (`od -c file | head -1` shows `\n`, not `\r\n`).
3. **Map each cell to a stand-in.** Linux through WSL, a VM, or a container of the CI's base image;
   each runtime version through side-by-side installs or a version manager; services through
   containers. Name every cell without a stand-in.
4. **Run CI's commands** in each cell: CI's install from the lockfile, then its steps in its order,
   with its environment flags. Keep each cell's output.
5. **Shake out flakes** in what the change touched: run its new and changed tests repeatedly in each
   cell, for example 5 to 20 times, and once under load, such as alongside the full suite. A
   timing-sensitive test should wait on the clock the code reads rather than a fixed sleep; on
   WSL, timers and the wall clock can drift apart.
6. **Compare** each cell with the local result. For a divergence, find the first difference:
   line endings, path separators and case, shell, locale and timezone, runtime version, file
   permissions, a missing tool such as a browser or a stopped container daemon, or resource limits.

## Output

Start with **CI parity:** and the first matching result:

- A check fails reproducibly in a cell where it passes locally -> `DIVERGES`.
- A check fails only sometimes in a cell -> `FLAKY`, with its failure rate there.
- A material cell had no stand-in or could not run -> `PARTIAL`.
- Otherwise -> `PARITY`.

Then include:

- **Matrix:** each CI cell, its local stand-in, and its result.
- **Export:** how the copy was made, and the line-ending check.
- **Divergences:** each with its first difference, the evidence, and the fix.
- **Flakes:** each test with its failure rate per cell and the suspected source of nondeterminism.
- **Not covered:** cells without a stand-in, and what would cover them.
