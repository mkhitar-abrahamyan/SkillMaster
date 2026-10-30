---
name: repo-context-builder
description: Use when starting work in an unfamiliar or undocumented repository, when an agent keeps asking how to build, test, or run a project, or when the user asks to explain a codebase's architecture or to draft or refresh AGENTS.md, CLAUDE.md, or similar agent instructions.
license: MIT
---

# Skill: Repository Context Builder

Produce the smallest accurate briefing that lets a newcomer, human or agent, work safely in a
repository without asking again. Every command and convention in it states where it came from.

## Boundary and safety

- Keep project files unchanged. Write a context document or draft `AGENTS.md` only when the user
  asks for a file. When agent instructions already exist, propose additions as a diff for the user
  to apply instead of replacing them.
- Do not open `.env` files, secrets, credentials, private keys, dumps, or production data. Use
  `.env.example` or equivalent files for configuration shape only.
- Run only commands that leave state unchanged: listings, `--version`, `--help`, `git log`, and
  test discovery or dry runs. Installing dependencies, building, migrating, or starting services
  needs the user's go-ahead; otherwise report the command as not run.
- Sample representative files rather than reading the whole repository. Stop when every output
  section is answered or its gap is listed under Open questions.

## Workflow

1. **Existing guidance first.** Read agent and contributor instructions: `AGENTS.md`, `CLAUDE.md`,
   `.github/copilot-instructions.md`, `.cursor/rules/`, `CONTRIBUTING.md`, `README.md`, and docs
   indexes. Treat them as claims to confirm and note where they disagree with the code.
2. **Shape and stack.** List the top two directory levels, excluding dependency, build, and cache
   directories. Read manifests and lockfiles to name languages, frameworks, package manager, and
   versions (`package.json` plus lockfile type, `pyproject.toml`, `go.mod`, `Cargo.toml`,
   `pom.xml` or `build.gradle`, `*.csproj`, `Gemfile`, `composer.json`). Detect workspace or
   monorepo tooling and map packages with their internal dependencies.
3. **Commands.** Prefer CI definitions (`.github/workflows/`, `.gitlab-ci.yml`,
   `azure-pipelines.yml`, `Jenkinsfile`) over READMEs, because CI shows what actually runs.
   Collect install, build, full test, single test, lint, type-check, format, and dev-server
   commands, plus required runtime versions and services such as databases, queues, or Compose.
   Record commands whose order matters, such as a generator that must run before a check that reads
   its output, in the order CI runs them, and platform differences such as line endings or a shell
   that behaves differently on Windows.
4. **Architecture.** Identify entry points (bootstrap, server, CLI, routes, handlers), layers, and
   module boundaries. Trace one representative request or data flow end to end through real files.
   For monorepos, describe each package in one line.
5. **Conventions.** Derive them from configuration (linters, formatter, compiler strictness,
   `.editorconfig`) and from two or three representative files per layer: naming, file placement,
   state and data-access patterns, error handling, test location and naming, fixtures and
   factories. Read `git log --oneline -20` for commit-message style.
6. **Danger zones.** Generated and vendored code, migrations, lockfiles, public API or contract
   files, secret locations, files that require code generation after edits, and operations that
   need approval such as deploys, migrations, and data scripts.
7. **Verify.** Give each command one provenance label: `verified` (ran here, exit code observed),
   `documented` (from CI, README, or manifest, not run), or `inferred` (from conventions; say
   why). Confirm every cited path exists.

## Output

Use this shape and keep it under about 150 lines. Link to files instead of pasting their contents.
For a draft `AGENTS.md`, keep the same sections but phrase each line as an instruction ("Run X",
"Put Y in Z").

```markdown
# <Project> context

**Purpose:** one or two sentences.
**Stack:** languages, frameworks, package manager, runtime versions.

## Layout
- `path/` — responsibility (one line each; one line per package in monorepos)

## Commands
| Task | Command | Provenance |
|------|---------|------------|
| Install | ... | documented (CI: .github/workflows/ci.yml) |
| Test one file | ... | verified |

Order: `generate` before `check` — why, and what fails otherwise.

## Architecture
Entry points, layers, and one traced flow: `a.ts` -> `b.ts` -> `c.ts`.

## Conventions
- Observed rule — evidence file

## Danger zones
- Path or operation — why, and what approval it needs

## Open questions
- What could not be determined, and what would settle it
```

After the document, list the files sampled and any commands not run. Omit empty sections except
Open questions, which says `None` when empty.
