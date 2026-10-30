---
name: release-captain
description: Use when the user asks to prepare, cut, tag, or publish a release of a package, library, or app, such as "release 2.4", "get version 3.0 ready", or "publish this to npm", or asks whether a version is ready to release. Separates preparing a release from publishing it, and publishes only on an explicit request.
license: MIT
compatibility: Watching the publish works best with the GitHub CLI (gh) authenticated for the repository; registry checks use the ecosystem's own CLI, such as npm view.
---

# Skill: Release Captain

A registry does not take a version back. Prepare everything, prove it where the publish runs, and
publish only when the user says so.

## Boundary and safety

- **Prepare** ("get 2.4 ready", "prepare the release"): implement and verify, keep the changelog
  entries unreleased, and leave version fields as the project leaves them until release. Commit only
  when asked; never push, tag, or publish.
- **Publish** ("release it", "publish 2.4", "cut the tag"): the full workflow below. When a request
  could be either, prepare and ask. When more than one version could be meant, such as a patch on
  the default branch and a major on another, ask which before any publishing step.
- A pushed tag that started a publish is not moved, deleted, or force-pushed without the user's
  explicit permission. A failed publish is fixed forward: a new commit, and a new or re-run
  pipeline as the user decides.
- Publish through the project's own pipeline, such as a tag-triggered workflow with trusted
  publishing. Run a local publish command only when that is the documented process and the user
  asked for it. Do not read or print registry tokens or secrets.

## Workflow

1. **Learn the process.** Read `RELEASING.md` or its equivalent, `CONTRIBUTING.md`, the release
   workflow (what triggers it, what it runs, what it publishes), the changelog's conventions, and
   the last release commit (`git show --stat <last release>`), which lists every file a release
   touches.
2. **Preflight.** A clean working tree on the branch to release, level with its remote; CI green on
   the exact commit (`gh run list --commit <sha>`); the registry's current version and dist-tags
   (`npm view <package> dist-tags`); the last release actually published; the next version chosen
   under the project's versioning policy, a breaking change making it a major.
3. **Version, everywhere.** Every place the version lives: manifests, lockfiles (each entry that
   names the package), sub-packages and the peer ranges between them, version constants in source,
   and docs that name the current release. Search for the old version string to find stragglers. On
   a major, also every range that names the old major, such as peer dependencies, plugin or adapter
   manifests, test fixtures that verify against the current version, and docs examples: these fail
   only once the version really changes, so re-run their tests after the bump, not before it.
4. **Notes and generated files.** Date the changelog section and add its compare links; update
   upgrade or migration notes, stability notes, roadmap, and the README's latest-release lines.
   Regenerate generated files in the order the project needs, a generator whose output another reads
   running first.
5. **Gate.** Run the full release gate from a clean install, as the pipeline runs it, with the
   services it needs started, such as a container daemon. Then run it where the pipeline runs: the
   same OS and every runtime version it uses, from a clean export of the commit (`ci-parity-check`,
   or its essentials). A failure stops the release; fix it in its own commit and re-run what it
   affects.
6. **Publish** (publish mode only). Commit the release, push the branch, and push the tag exactly
   as the pipeline expects it: its name format, annotated or not, on the commit just gated.
7. **Watch to the end.** Follow every run the push started to completion (`gh run watch <id>`), then
   confirm the registry lists the version under the expected dist-tag, for each package published. A
   registry can take a long time to list a version after a successful publish: keep checking it
   rather than publishing again.
8. **Hand over.** Record what the next release needs to know: follow-ups, a known flake and what to
   do if it hits the pipeline, and anything a later major must change.

## Output

Start with **Release status:** and the first matching result:

- Publish asked for, and the registry lists the version -> `RELEASED`.
- The tag is pushed and the publish run passed, but the registry does not list it yet ->
  `PUBLISHED, AWAITING REGISTRY`, with when to check again.
- Preflight, the gate, or a publish run failed -> `BLOCKED`, naming the failure and the fix.
- Prepare mode, everything verified -> `READY TO TAG`.
- Prepare mode, with gaps -> `NOT READY`, listing them.

Then include:

- **Version:** old -> new, and why that increment.
- **Files:** each file the release changed, one line each.
- **Gate:** each check with its command, platform, runtime version, and result.
- **Publish:** each run with its link and result, and the tag with its commit.
- **Registry:** what it lists, per package and dist-tag.
- **Follow-ups:** ordered; the first is immediately actionable.
