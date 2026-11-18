# Setting up context-keeper

What to do once per machine and once per project so that Claude Code, Codex, and tools on a local
Ollama model continue each other's work. Every command runs from the project's folder.

For a workspace with several projects, prefer one context root outside all source projects. For
example, use the absolute path `<workspace>/.ai/.context`, which creates separate project folders
such as `.ai/.context/project-a/` and `.ai/.context/project-b/`. Pass the same `--context-dir` value to every
command; `wire` embeds it in generated hooks. Existing per-project `.context/` storage remains the
default when no central root is configured.

## 1. Install the skill

Install SkillMaster as the README describes: the Claude Code plugin, `gh skill install` for
Codex and other agents, or a copy of `skills/context-keeper/` into the agent's skills folder.
Tools without skills, such as Aider, need nothing installed: they use the project's copy of the
script from step 2.

## 2. Start in a project

Ask the agent: "Save the context of this task so I can continue it in another tool." With central
storage, it runs the skill's script from the project root, which creates the project-specific folder
under the selected context root the first time:

```text
node <skill folder>/scripts/ctx.mjs start --task "csv export" --agent claude-code
```

For the example central layout, use:

```text
node <skill folder>/scripts/ctx.mjs start --task "csv export" --agent claude-code --context-dir "<workspace>/.ai/.context"
```

Without an agent, run the same from a clone of SkillMaster:
`node SkillMaster/skills/context-keeper/scripts/ctx.mjs start ...`.

From then on the project-specific context folder has its own script copy, and every tool uses that
one. Without a central root, commands use the default local folder:

```text
node .context/ctx.mjs resume          where things stand, and what changed since the last save
node .context/ctx.mjs start --task "csv export" --agent codex
node .context/ctx.mjs note next "Quote fields that hold commas" --file <record>
node .context/ctx.mjs check --file <record> -- npm test
node .context/ctx.mjs save --file <record>
node .context/ctx.mjs list
node .context/ctx.mjs doctor          what could keep it from working, and the fix for each
```

For example, when centrally stored:

```text
node "<workspace>/.ai/.context/project-a/ctx.mjs" resume --context-dir "<workspace>/.ai/.context"
node "<workspace>/.ai/.context/project-a/ctx.mjs" save --file "<workspace>/.ai/.context/project-a/conversations/<record>.md" --context-dir "<workspace>/.ai/.context"
```

Keep the record path printed by `start`. Use it for this conversation's later messages and after
compaction: `resume --file <record>` continues it without creating another. A known `--session <id>`
can replace `--file`; ambiguous updates are refused. Resumed hook sessions select their own record.

Each project's context folder has a `.gitignore` of its own, so git ignores records even if the
central context root is inside the workspace but outside source projects. Delete that file only to
share the records with a team through git.

## 3. Saving and resuming by themselves

### Claude Code

```text
node "<workspace>/.ai/.context/project-a/ctx.mjs" wire claude --context-dir "<workspace>/.ai/.context"
```

This adds hooks to `.claude/settings.local.json`, which stays on your machine. Start a new
session: it opens with the latest record, every reply saves this conversation's record, and one is
written as soon as the conversation changes files. `/hooks` in Claude Code lists them.

### Codex

```text
node "<workspace>/.ai/.context/project-a/ctx.mjs" wire codex --context-dir "<workspace>/.ai/.context"
```

This adds hooks to `.codex/hooks.json`, kept out of git through `.git/info/exclude`. Codex runs a
hook only after you trust it: open Codex in the project, which must be trusted too, run `/hooks`,
and approve them. Hooks are on by default; if they were turned off, set `hooks = true` under
`[features]` in `~/.codex/config.toml`.

`wire all` does both. `unwire claude`, `unwire codex`, or `unwire all` removes only these hooks.

## 4. Tools on a local Ollama model

These have no hooks, so they read the project's `BRIEF.md` (for example,
`<workspace>/.ai/.context/project-a/BRIEF.md`), the latest record in short, rewritten at every save.

- **Aider:** `aider --model ollama_chat/<model> --read "<workspace>/.ai/.context/project-a/BRIEF.md"`, or once, in
  `.aider.conf.yml`: `read: <workspace>/.ai/.context/project-a/BRIEF.md`. Save progress with `/run node
  "<workspace>/.ai/.context/project-a/ctx.mjs" note done "..." --file <record> --context-dir "<workspace>/.ai/.context"` and the like.
- **opencode:** add `"<workspace>/.ai/.context/project-a/BRIEF.md"` to `instructions` in `opencode.json`.
- **A plain chat**, such as `ollama run` or Open WebUI: `node "<workspace>/.ai/.context/project-a/ctx.mjs" resume --copy --context-dir "<workspace>/.ai/.context"` puts
  the brief on the clipboard to paste. To keep what the chat decided, ask it for its done items,
  next actions, and decisions, and add them with `note`.

Ollama's default context window is small, and it drops what does not fit without a warning. Start
it with a larger one, as Aider's Ollama guide shows: `OLLAMA_CONTEXT_LENGTH=8192 ollama serve`. The
brief stays within about a page for the same reason.

## 5. Tools that read AGENTS.md

Codex, opencode, Cursor, and GitHub Copilot read `AGENTS.md`. To have any of them resume without
hooks, add this to it; it is committed, so it is a change for the whole team:

```markdown
Refresh the context-keeper script with `node <installed skill>/scripts/ctx.mjs init --context-dir <central context root>`.
In a new conversation, run `node <project context>/ctx.mjs resume --context-dir <central context root>`, then start one record with
`node <project context>/ctx.mjs start --task <task> --agent <tool> --context-dir <central context root>` and retain its path. In the same
conversation, including after compaction, reuse that path with `resume --file <record>`.
Use `--file <record>` (or the known `--session <id>`) and the same `--context-dir` for note, check, and save as work moves.
```

## 6. Check that it works

- `node <project context>/ctx.mjs doctor --context-dir <central context root>` checks Node.js, the folder, the project's copy of the script, each
  tool's hooks, and the errors they wrote down, and gives the command that fixes each.
- `node <project context>/ctx.mjs list --context-dir <central context root>` shows records per chat; the project's `index.md` lists them too.
- After a wired session that changed files, its record is in `<project context>/conversations/`.
- A hook that fails never stops the tool: its error is in `<project context>/hook-errors.log`.

## 7. When something is off

- **The project moved:** a central project's `project-root.txt` identifies its original owner.
  Confirm the folder belongs to the moved project, then update that file to its new absolute root.
  If the project was renamed, also move its context folder to the new project name. Rewire any hooks
  after the move; `doctor` reports stale hook paths.
- **SkillMaster was updated:** the project keeps its own copy of the script, which the hooks run.
  `node <skill folder>/scripts/ctx.mjs init --context-dir <central context root>` brings it up to date; the agent does this when it
  uses the skill.
- **A hook cannot run at all:** each tool needs Node.js 18 or later on its PATH, the one its hooks
  run with.

## 8. Remove it

`node <project context>/ctx.mjs unwire all --context-dir <central context root>`, then delete only
that project's context folder.
