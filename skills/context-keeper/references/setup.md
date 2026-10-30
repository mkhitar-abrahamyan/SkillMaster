# Setting up context-keeper

What to do once per machine and once per project so that Claude Code, Codex, and tools on a local
Ollama model continue each other's work. Every command runs from the project's folder.

## 1. Install the skill

Install SkillMaster as the README describes: the Claude Code plugin, `gh skill install` for
Codex and other agents, or a copy of `skills/context-keeper/` into the agent's skills folder.
Tools without skills, such as Aider, need nothing installed: they use the project's copy of the
script from step 2.

## 2. Start in a project

Ask the agent: "Save the context of this task so I can continue it in another tool." It runs the
skill's script, which creates `.context/` the first time:

```text
node <skill folder>/scripts/ctx.mjs start --task "csv export" --agent claude-code
```

From then on the project has its own copy, and every tool uses that one:

```text
node .context/ctx.mjs resume          where things stand, and what changed since the last save
node .context/ctx.mjs start --task "csv export" --agent codex
node .context/ctx.mjs note next "Quote fields that hold commas"
node .context/ctx.mjs check -- npm test
node .context/ctx.mjs save --file <record>
node .context/ctx.mjs list
```

`.context/` has a `.gitignore` of its own, so git ignores it. Delete that file only to share the
records with a team through git.

## 3. Saving and resuming by themselves

### Claude Code

```text
node .context/ctx.mjs wire claude
```

This adds hooks to `.claude/settings.local.json`, which stays on your machine. Start a new
session: it opens with the latest record, every reply saves this conversation's record, and one is
written as soon as the conversation changes files. `/hooks` in Claude Code lists them.

### Codex

```text
node .context/ctx.mjs wire codex
```

This adds hooks to `.codex/hooks.json`, kept out of git through `.git/info/exclude`. Codex runs a
hook only after you trust it: open Codex in the project, which must be trusted too, run `/hooks`,
and approve them. Hooks are on by default; if they were turned off, set `hooks = true` under
`[features]` in `~/.codex/config.toml`.

`wire all` does both. `unwire claude`, `unwire codex`, or `unwire all` removes only these hooks.

## 4. Tools on a local Ollama model

These have no hooks, so they read `.context/BRIEF.md`, the latest record in short, rewritten at
every save.

- **Aider:** `aider --model ollama_chat/<model> --read .context/BRIEF.md`, or once, in
  `.aider.conf.yml`: `read: .context/BRIEF.md`. Save progress with `/run node .context/ctx.mjs
  note done "..."` and the like.
- **opencode:** add `".context/BRIEF.md"` to `instructions` in `opencode.json`.
- **A plain chat**, such as `ollama run` or Open WebUI: `node .context/ctx.mjs resume --copy` puts
  the brief on the clipboard to paste. To keep what the chat decided, ask it for its done items,
  next actions, and decisions, and add them with `note`.

Ollama's default context window is small, and it drops what does not fit without a warning. Start
it with a larger one, as Aider's Ollama guide shows: `OLLAMA_CONTEXT_LENGTH=8192 ollama serve`. The
brief stays within about a page for the same reason.

## 5. Tools that read AGENTS.md

Codex, opencode, Cursor, and GitHub Copilot read `AGENTS.md`. To have any of them resume without
hooks, add this to it; it is committed, so it is a change for the whole team:

```markdown
If `.context/` exists, run `node .context/ctx.mjs resume` before starting, start this
conversation's record with `node .context/ctx.mjs start`, and save it as the work moves.
```

## 6. Check that it works

- `node .context/ctx.mjs list` shows a record per conversation; `.context/index.md` lists them too.
- After a wired session that changed files, its record is in `.context/conversations/`.
- A hook that fails never stops the tool: its error is in `.context/hook-errors.log`.

## 7. Remove it

`node .context/ctx.mjs unwire all`, then delete `.context/`.
