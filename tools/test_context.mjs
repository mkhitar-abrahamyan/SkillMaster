#!/usr/bin/env node
/**
 * context-keeper's ctx.mjs, proven in throwaway git repositories, one with a space and Cyrillic in
 * its path: .context/ appears when it is missing, and git ignores it; every conversation gets a
 * record of its own that starts from the last; save writes what git says and refuses a secret; a
 * check goes stale when the code changes; resume tells what changed since; the hooks Claude Code and
 * Codex run write a conversation's record by themselves; and wire adds exactly those hooks to each
 * tool's local settings, kept out of git, as commands that run.
 *
 *   node tools/test_context.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CTX = path.join(root, 'skills', 'context-keeper', 'scripts', 'ctx.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'skillmaster-context-'));
// Not as the agent running this test: the records name the agents the test says.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CLAUDECODE' && key !== 'CTX_AGENT' && !key.startsWith('CODEX_')));

function project(name, { git = true } = {}) {
  const dir = path.join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'app.js'), 'export const add = (a, b) => a + b;\n');
  if (git) {
    for (const args of [
      ['init', '-q'],
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Test'],
      ['config', 'core.autocrlf', 'false'],
      ['config', 'commit.gpgsign', 'false'],
      ['add', '.'],
      ['commit', '-qm', 'Add the adder'],
    ]) execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  }
  return dir;
}
const run = (cwd, args, input) => spawnSync(process.execPath, [CTX, ...args], { cwd, input, encoding: 'utf8', env });
const gitOut = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const recordsIn = (dir) => readdirSync(path.join(dir, '.context', 'conversations')).filter((name) => name.endsWith('.md')).sort();
const read = (file) => readFileSync(file, 'utf8');
const pattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const recordOf = (stdout) => /This conversation's record: (\S+)/.exec(stdout)?.[1];
// What the agent writes: a section that was empty gets its content.
function fill(file, name, content) {
  const text = read(file);
  const empty = `## ${name}\n\n- None yet.\n`;
  assert.ok(text.includes(empty), `${name} is empty before it is filled:\n${text}`);
  writeFileSync(file, text.replace(empty, () => `## ${name}\n\n${content}\n`));
}

try {
  // ── .context/ appears when missing, and git ignores it ──────────────
  const repo = project('проект с пробелом');
  const dot = path.join(repo, '.context');
  let out = run(repo, ['init']);
  assert.equal(out.status, 0, out.stderr);
  const ignore = read(path.join(dot, '.gitignore')).split('\n').filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(ignore, ['*'], 'the folder ignores itself');
  assert.equal(read(path.join(dot, 'ctx.mjs')), read(CTX), 'the project gets a copy of the script, for every tool');
  assert.ok(existsSync(path.join(dot, 'README.md')), 'and a README for whoever finds the folder');
  assert.equal(gitOut(repo, 'status', '--porcelain', '--untracked-files=all'), '', 'git sees nothing new');
  assert.ok(!existsSync(path.join(repo, '.gitignore')), "the project's own .gitignore is not touched");
  // Only when the folder was missing: once it exists, whether git ignores it is the user's call.
  unlinkSync(path.join(dot, '.gitignore'));
  assert.equal(run(repo, ['init']).status, 0);
  assert.ok(!existsSync(path.join(dot, '.gitignore')), 'a .gitignore the user deleted is not put back');
  writeFileSync(path.join(dot, '.gitignore'), '*\n');
  assert.equal(run(repo, ['help']).status, 0, 'help');
  assert.equal(run(repo, ['bogus']).status, 1, 'an unknown command is a usage error');
  console.log('ok - .context/ appears when it is missing, git ignores it, and the project is untouched');

  // ── A conversation's record: facts from git, judgment from the agent ─
  out = run(repo, ['start', '--task', 'CSV export', '--agent', 'claude-code', '--session', 'claude-1']);
  assert.equal(out.status, 0, out.stderr);
  const first = recordOf(out.stdout);
  assert.match(first ?? '', /^\.context\/conversations\/\d{4}-\d{2}-\d{2}_\d{4}_claude-code_csv-export\.md$/, `named for when, who, and what:\n${out.stdout}`);
  const firstFile = path.join(repo, first);
  let text = read(firstFile);
  for (const field of ['task: csv-export', 'agent: claude-code', 'session: claude-1', 'status: in progress', 'head: ', 'fingerprint: ']) {
    assert.ok(text.includes(field), `the front matter has ${field}:\n${text}`);
  }
  fill(firstFile, 'Goal', 'Export invoices as CSV from the list page.');
  fill(firstFile, 'Done', '- Parser in `src/csv.js`.');
  fill(firstFile, 'Next actions', '1. Quote fields that hold commas.');
  fill(firstFile, 'Decisions', '- RFC 4180 quoting in one function, not a library.');
  fill(firstFile, 'Dead ends', '- Papa Parse: too large for one export.');
  out = run(repo, ['check', '--', process.execPath, '-e', 'process.exit(0)']);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(run(repo, ['check', '--', process.execPath, '-e', 'process.exit(3)']).status, 3, "check exits with its command's code");
  text = read(firstFile);
  assert.match(text, /passed, fresh: `[^`]*process\.exit\(0\)/, `a check is recorded on the code it ran on:\n${text}`);
  assert.match(text, /failed \(exit 3\), fresh: /, `and so is a failure:\n${text}`);
  writeFileSync(path.join(repo, 'app.js'), 'export const add = (a, b) => a + b + 0;\n');
  out = run(repo, ['save', '--file', first]);
  assert.equal(out.status, 0, out.stderr);
  text = read(firstFile);
  assert.ok(text.includes('M app.js`'), `the save lists what is uncommitted:\n${text}`);
  assert.match(text, /passed, stale, the code changed since: `[^`]*process\.exit\(0\)/, `an edit makes the check stale:\n${text}`);
  assert.equal(run(repo, ['save', '--file', first, '--status', 'shipped']).status, 1, 'a status is one of four');
  console.log('ok - a record carries what git says, checks with their freshness, and what the agent wrote');

  // ── A secret is never saved ──────────────────────────────────────────
  const token = `ghp_${'a1B2'.repeat(9)}`;
  fill(firstFile, 'Notes', `- Pushed with ${token}`);
  const before = read(firstFile);
  out = run(repo, ['save', '--file', first]);
  assert.equal(out.status, 2, 'a record that holds a secret is not saved');
  assert.match(out.stderr, /line \d+: a GitHub token/, out.stderr);
  const line = Number(/line (\d+)/.exec(out.stderr)[1]);
  assert.ok(before.split('\n')[line - 1].includes(token), `the line it names holds the token: line ${line}`);
  assert.equal(read(firstFile), before, 'the refused record is left as it was');
  out = run(repo, ['save', '--file', first, '--mask']);
  assert.equal(out.status, 0, out.stderr);
  for (const file of [firstFile, path.join(dot, 'index.md'), path.join(dot, 'BRIEF.md')]) {
    assert.ok(!read(file).includes(token), `${path.basename(file)} holds no token`);
  }
  assert.ok(read(firstFile).includes('- Pushed with •••'), 'masked in place');
  assert.equal(run(repo, ['note', 'note', 'password: hunter22x']).status, 2, 'a note with a password value is refused');
  // A check whose command line carries a token is recorded with it masked.
  assert.equal(run(repo, ['check', '--', process.execPath, '-e', 'process.exit(0)', token]).status, 0);
  for (const file of [path.join(dot, 'checks.jsonl'), firstFile]) assert.ok(!read(file).includes(token), `${path.basename(file)} holds no token from a command`);
  assert.equal(run(repo, ['note', 'note', 'Read token = process.env.API_TOKEN_V2 at startup']).status, 0, 'a reference to a secret is not one');
  console.log('ok - a secret is refused, or masked when asked, and never reaches the index or the brief');

  // ── The next conversation, in another tool, starts from this one ────
  gitOut(repo, 'commit', '-qam', 'Quote fields');
  out = run(repo, ['start', '--agent', 'codex']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /# Context: csv-export/, out.stdout);
  assert.match(out.stdout, /HEAD moved 1 commit ahead:\n {2}- [0-9a-f]{7} Quote fields/, `the brief tells what changed since:\n${out.stdout}`);
  assert.match(out.stdout, /Quote fields that hold commas/, 'and what was next');
  const second = recordOf(out.stdout);
  assert.match(second ?? '', /_codex_csv-export(-\d+)?\.md$/, out.stdout);
  assert.notEqual(second, first, 'a new conversation gets a new record');
  const secondFile = path.join(repo, second);
  text = read(secondFile);
  assert.ok(text.includes(`previous: ${path.basename(first)}`), `it links the one it continues:\n${text}`);
  for (const carried of ['Export invoices as CSV', 'Quote fields that hold commas', 'RFC 4180 quoting', 'Papa Parse']) {
    assert.ok(text.includes(carried), `${carried} is carried over:\n${text}`);
  }
  assert.ok(!text.includes('Parser in `src/csv.js`'), "what the last conversation did stays in that one's record");
  assert.equal(run(repo, ['note', 'next', 'Write the docs', '--file', second]).status, 0);
  assert.equal(run(repo, ['note', 'done', 'Fields with commas are quoted', '--file', second]).status, 0);
  text = read(secondFile);
  assert.match(text, /## Next actions\n\n1\. Quote fields that hold commas\.\n- Write the docs\n/, `a note goes to the newest record:\n${text}`);
  assert.match(text, /## Done\n\n- Fields with commas are quoted\n/, `the placeholder gives way:\n${text}`);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  out = run(path.join(repo, 'src'), ['resume']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, new RegExp(`Record: ${pattern(second)}; 1 earlier for this task`), `resume, from a subfolder, finds the latest:\n${out.stdout}`);
  assert.match(out.stdout, /HEAD: unchanged\.\n- Code: exactly as saved\./, out.stdout);
  assert.match(out.stdout, /Write the docs/, out.stdout);
  assert.equal(run(repo, ['list']).stdout.trim().split('\n').length, 2, 'list shows both records');
  const index = read(path.join(dot, 'index.md'));
  assert.ok(index.includes(path.basename(first)) && index.includes(path.basename(second)), `index.md lists both:\n${index}`);
  assert.match(read(path.join(dot, 'BRIEF.md')), /Write the docs/, 'BRIEF.md is the latest record');
  console.log('ok - the next conversation, in another tool, starts from the last record and what changed since');

  // ── The hooks write a conversation's record by themselves ───────────
  const hook = (dir, tool, event, session) =>
    run(dir, ['hook', tool], JSON.stringify({ hook_event_name: event, session_id: session, cwd: dir, ...(event === 'SessionStart' ? { source: 'startup' } : {}) }));
  const count = recordsIn(repo).length;
  out = hook(repo, 'claude', 'SessionStart', 'claude-2');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /# Context: csv-export/, 'a session starts with the latest record');
  assert.match(out.stdout, /--session claude-2/, `and how to start its own:\n${out.stdout}`);
  out = hook(repo, 'claude', 'Stop', 'claude-2');
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, '', 'a Claude Stop hook prints nothing');
  assert.equal(recordsIn(repo).length, count, 'a conversation that changed nothing leaves no record');
  writeFileSync(path.join(repo, 'docs.md'), '# CSV export\n');
  hook(repo, 'claude', 'Stop', 'claude-2');
  assert.equal(recordsIn(repo).length, count + 1, 'once it changes files, the conversation gets its record');
  const autoName = recordsIn(repo).find((name) => read(path.join(repo, '.context', 'conversations', name)).includes('session: claude-2'));
  const autoFile = path.join(repo, '.context', 'conversations', autoName);
  text = read(autoFile);
  assert.ok(text.includes('agent: claude-code') && text.includes('Written by the hooks') && text.includes('docs.md'), `written by the hooks:\n${text}`);
  assert.ok(text.includes('Write the docs'), 'carried on from the latest record');
  writeFileSync(path.join(repo, 'more.md'), 'More.\n');
  hook(repo, 'claude', 'Stop', 'claude-2');
  assert.equal(recordsIn(repo).length, count + 1, 'and keeps that one record');
  assert.ok(read(autoFile).includes('more.md'), 'brought up to date');
  out = run(repo, ['start', '--task', 'csv-export', '--agent', 'claude-code', '--session', 'claude-2']);
  assert.equal(recordOf(out.stdout), `.context/conversations/${autoName}`, `start in the same session reuses it:\n${out.stdout}`);
  assert.equal(recordsIn(repo).length, count + 1, 'without a second record');
  out = hook(repo, 'codex', 'SessionStart', 'codex-1');
  assert.match(out.stdout, /# Context: csv-export/, 'Codex sessions start the same way');
  out = hook(repo, 'codex', 'Stop', 'codex-1');
  assert.deepEqual(JSON.parse(out.stdout), {}, 'a Codex Stop hook prints the JSON Codex expects');
  assert.equal(recordsIn(repo).length, count + 1, 'and a Codex session that changed nothing leaves no record');
  // A session that starts again, after compaction or a resume, keeps the state it began from.
  hook(repo, 'claude', 'SessionStart', 'claude-4');
  writeFileSync(path.join(repo, 'later.md'), 'Later.\n');
  hook(repo, 'claude', 'SessionStart', 'claude-4');
  hook(repo, 'claude', 'Stop', 'claude-4');
  assert.ok(
    recordsIn(repo).some((name) => read(path.join(repo, '.context', 'conversations', name)).includes('session: claude-4')),
    'what a session changed before it started again still gives it a record',
  );
  const bare = project('bare');
  out = hook(bare, 'codex', 'Stop', 'x');
  assert.deepEqual([out.status, JSON.parse(out.stdout)], [0, {}], 'in a project without .context/, a hook passes quietly');
  out = hook(bare, 'claude', 'SessionStart', 'x');
  assert.deepEqual([out.status, out.stdout], [0, ''], 'and says nothing at the start');
  assert.ok(!existsSync(path.join(bare, '.context')), 'and creates nothing');
  console.log('ok - the hooks start a session with the latest record and keep one record per conversation that changed files');

  // ── wire: the hooks in each tool's local settings, and only them ────
  mkdirSync(path.join(repo, '.claude'), { recursive: true });
  const theirs = { hooks: [{ type: 'command', command: 'echo theirs' }] };
  writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [theirs] } }, null, 2));
  // A machine may ignore one of them already, as Claude Code's own global ignore does for its file.
  const ignored = (file) => spawnSync('git', ['check-ignore', '-q', file], { cwd: repo }).status === 0;
  const settingsFiles = ['.claude/settings.local.json', '.codex/hooks.json'];
  const ignoredBefore = Object.fromEntries(settingsFiles.map((file) => [file, ignored(file)]));
  out = run(repo, ['wire', 'all']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\/hooks/, `Codex's trust step is named:\n${out.stdout}`);
  const ours = (settings, event) => settings.hooks[event].filter((group) => group.hooks.some((h) => h.command.includes('ctx.mjs" hook')));
  const settingsOf = (file) => JSON.parse(read(path.join(repo, file)));
  let claude = settingsOf('.claude/settings.local.json');
  const codex = settingsOf('.codex/hooks.json');
  assert.deepEqual(claude.permissions, { allow: ['Bash(ls)'] }, 'other settings stay');
  assert.deepEqual(claude.hooks.Stop.find((group) => !ours({ hooks: { Stop: [group] } }, 'Stop').length), theirs, 'and so do other hooks');
  assert.deepEqual(Object.keys(claude.hooks).sort(), ['PreCompact', 'SessionEnd', 'SessionStart', 'Stop'], 'Claude Code: four events');
  assert.deepEqual(Object.keys(codex.hooks).sort(), ['PreCompact', 'SessionStart', 'Stop'], 'Codex: three events');
  assert.equal(ours(claude, 'SessionStart')[0].matcher, 'startup|resume|clear|compact', 'every way a session starts');
  run(repo, ['wire', 'all']);
  claude = settingsOf('.claude/settings.local.json');
  for (const event of Object.keys(claude.hooks)) assert.equal(ours(claude, event).length, 1, `wired twice, still one context hook on ${event}`);
  const status = gitOut(repo, 'status', '--porcelain', '--untracked-files=all');
  assert.ok(!/\.claude|\.codex/.test(status), `neither settings file shows in git:\n${status}`);
  const exclude = read(path.join(repo, '.git', 'info', 'exclude')).split('\n');
  for (const file of settingsFiles) {
    assert.ok(ignored(file), `${file} is ignored by git`);
    const expected = ignoredBefore[file] ? 0 : 1;
    assert.equal(exclude.filter((entry) => entry === `/${file}`).length, expected, `${file}: ${expected ? 'excluded once, through .git/info/exclude' : 'ignored already, so not excluded again'}`);
  }
  // The wired commands run as the tools run them: through a shell, from the project.
  const runWired = (command, event, session) =>
    spawnSync(command, { shell: true, cwd: repo, encoding: 'utf8', env, input: JSON.stringify({ hook_event_name: event, session_id: session, cwd: repo }) });
  const claudeStart = ours(claude, 'SessionStart')[0].hooks[0].command;
  out = runWired(claudeStart, 'SessionStart', 'claude-3');
  assert.match(out.stdout, /# Context: csv-export/, `the wired Claude Code command runs: ${claudeStart}\n${out.stderr}`);
  const codexStop = ours(codex, 'Stop')[0].hooks[0].command;
  out = runWired(codexStop, 'Stop', 'codex-2');
  assert.deepEqual(JSON.parse(out.stdout || 'null'), {}, `the wired Codex command runs: ${codexStop}\n${out.stderr}`);
  out = run(repo, ['unwire', 'claude']);
  assert.equal(out.status, 0, out.stderr);
  claude = settingsOf('.claude/settings.local.json');
  assert.deepEqual(claude, { permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [theirs] } }, 'unwired: only what was there before is left');
  console.log('ok - wire adds the hooks to each tool\'s local settings, once, out of git, as commands that run; unwire takes them out');

  // ── Shared through git: .context/ itself never makes the code look changed ─
  const shared = project('shared');
  assert.equal(run(shared, ['start', '--task', 'share', '--agent', 'codex']).status, 0);
  assert.equal(run(shared, ['check', '--', process.execPath, '-e', 'process.exit(0)']).status, 0);
  unlinkSync(path.join(shared, '.context', '.gitignore'));
  assert.equal(run(shared, ['save']).status, 0);
  out = run(shared, ['resume']);
  assert.match(out.stdout, /- Code: exactly as saved\./, `the records git now sees are not code changes:\n${out.stdout}`);
  assert.match(out.stdout, /passed, fresh: /, `and leave the check fresh:\n${out.stdout}`);
  console.log('ok - shared through git, the records never make the code look changed');

  // ── The project's own folder, never one above it ────────────────────
  const outer = path.join(work, 'outer');
  mkdirSync(outer, { recursive: true });
  assert.equal(run(outer, ['start', '--task', 'outer', '--agent', 'aider']).status, 0);
  const inner = project(path.join('outer', 'inner'));
  // From a drive letter in lower case, as VS Code's terminal has it, while git reports it in upper.
  out = run(process.platform === 'win32' ? inner.replace(/^[A-Z]:/, (drive) => drive.toLowerCase()) : inner, ['start', '--task', 'inner', '--agent', 'codex']);
  assert.equal(out.status, 0, out.stderr);
  assert.ok(existsSync(path.join(inner, '.context', 'conversations')), 'a repository inside a folder with .context/ gets its own');
  assert.equal(recordsIn(outer).length, 1, "and the outer folder's records are left alone");
  // Nor the home folder's: a .context/ there would take in every project under it.
  const home = path.join(work, 'home');
  mkdirSync(path.join(home, '.context', 'conversations'), { recursive: true });
  mkdirSync(path.join(home, 'notes'), { recursive: true });
  out = spawnSync(process.execPath, [CTX, 'start', '--task', 'notes', '--agent', 'aider'], {
    cwd: path.join(home, 'notes'),
    encoding: 'utf8',
    env: { ...env, HOME: home, USERPROFILE: home },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(existsSync(path.join(home, 'notes', '.context', 'conversations')), 'a folder under home gets its own .context/');
  assert.deepEqual(readdirSync(path.join(home, '.context', 'conversations')), [], "and home's is left alone");
  console.log("ok - records go to the project's own .context/, never to one above the repository or in the home folder");

  // ── A heading in another case is the same section ───────────────────
  const cased = project('cased');
  out = run(cased, ['start', '--task', 'case', '--agent', 'claude-code']);
  const casedFile = path.join(cased, recordOf(out.stdout));
  writeFileSync(casedFile, read(casedFile).replace('## Next actions\n\n- None yet.\n', () => '## Next Actions\n\n- Ship it.\n'));
  assert.equal(run(cased, ['note', 'next', 'Then announce it']).status, 0);
  const casedText = read(casedFile);
  assert.equal(casedText.match(/^## next actions$/gim).length, 1, `one Next actions section, whatever its case:\n${casedText}`);
  assert.match(casedText, /- Ship it\.\n- Then announce it/, `the note joins it:\n${casedText}`);
  out = run(cased, ['start', '--agent', 'codex']);
  assert.match(read(path.join(cased, recordOf(out.stdout))), /- Ship it\./, 'and the next conversation carries it over');
  console.log('ok - a section is found whatever the case of its heading');

  // ── doctor: what could keep it from working, and the fix for each ───
  const doc = project('doctor');
  out = run(doc, ['doctor']);
  assert.equal(out.status, 1, 'no .context/ yet is a problem to fix');
  assert.match(out.stdout, /fix {2}No \.context\/ in .*: node ".*ctx\.mjs" start/, out.stdout);
  assert.equal(run(doc, ['start', '--task', 'doc', '--agent', 'codex']).status, 0);
  assert.equal(run(doc, ['wire', 'all']).status, 0);
  out = run(doc, ['doctor']);
  assert.equal(out.status, 0, `a healthy setup:\n${out.stdout}`);
  assert.match(out.stdout, /ok {3}Claude Code hooks in \.claude\/settings\.local\.json/, out.stdout);
  assert.match(out.stdout, /ok {3}Codex hooks in \.codex\/hooks\.json/, out.stdout);
  // The project moved: the hooks run a script that is no longer there.
  const codexHooks = path.join(doc, '.codex', 'hooks.json');
  writeFileSync(codexHooks, read(codexHooks).replaceAll('/.context/ctx.mjs', '/moved/ctx.mjs'));
  out = run(doc, ['doctor']);
  assert.equal(out.status, 1, `hooks that run a missing script are a problem:\n${out.stdout}`);
  assert.match(out.stdout, /fix {2}Codex hooks in \.codex\/hooks\.json: .*not there.*: node \.context\/ctx\.mjs wire codex/, out.stdout);
  assert.equal(run(doc, ['wire', 'codex']).status, 0);
  assert.equal(run(doc, ['doctor']).status, 0, 'wired again, they work');
  // The hooks wrote an error down.
  writeFileSync(path.join(doc, '.context', 'hook-errors.log'), '2026-10-30T10:00:00.000+04:00 codex Stop: Error: something broke\n    at somewhere\n');
  out = run(doc, ['doctor']);
  assert.equal(out.status, 1, `a hook error is a problem:\n${out.stdout}`);
  assert.match(out.stdout, /fix {2}1 hook error\(s\), the last: .*something broke/, out.stdout);
  unlinkSync(path.join(doc, '.context', 'hook-errors.log'));
  // SkillMaster was updated: the project's copy is older than the skill's.
  const copyFile = path.join(doc, '.context', 'ctx.mjs');
  writeFileSync(copyFile, read(copyFile).replace(/^const VERSION = \d+;/m, 'const VERSION = 1;'));
  out = run(doc, ['doctor']);
  assert.equal(out.status, 1, `a project copy older than the skill's is a problem:\n${out.stdout}`);
  assert.match(out.stdout, /fix {2}\.context\/ctx\.mjs is version 1, older than this script's \d+: node ".*" init/, out.stdout);
  assert.equal(run(doc, ['init']).status, 0);
  assert.equal(read(copyFile), read(CTX), 'init brings the copy up to date');
  assert.equal(run(doc, ['doctor']).status, 0, 'and all is well again');
  console.log('ok - doctor finds a missing folder, a moved project, hook errors, and an old copy, each with its fix');

  // ── Without git ──────────────────────────────────────────────────────
  const plain = project('plain', { git: false });
  out = run(plain, ['start', '--task', 'notes', '--agent', 'aider']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(read(path.join(plain, recordOf(out.stdout))), /Not a git repository/, 'a record says what it cannot know');
  // A finished task steps aside: resume shows the latest open one.
  out = run(plain, ['start', '--task', 'later', '--agent', 'aider']);
  assert.equal(out.status, 0);
  assert.equal(run(plain, ['save', '--file', recordOf(out.stdout), '--status', 'done']).status, 0);
  mkdirSync(path.join(plain, 'notes'), { recursive: true });
  out = run(path.join(plain, 'notes'), ['resume']);
  assert.match(out.stdout, /^# Context: notes$/m, `resume, from a subfolder, skips the task marked done:\n${out.stdout}`);
  assert.match(out.stdout, /Not a git repository: what changed since cannot be told/, 'and says what it cannot know');
  console.log('ok - without git, records and briefs still work, and say what they cannot know; a finished task steps aside');

  // A passing command cannot certify code that changed while it ran.
  const moving = project('changed-during-check');
  run(moving, ['start', '--task', 'freshness', '--agent', 'codex']);
  const originalApp = read(path.join(moving, 'app.js'));
  writeFileSync(path.join(moving, 'check.cjs'), [
    "const fs = require('node:fs');",
    "require('node:assert/strict').match(fs.readFileSync('app.js', 'utf8'), /a \\+ b/);",
    "fs.writeFileSync('app.js', 'export const add = () => 999;\\n');",
  ].join('\n'));
  assert.equal(run(moving, ['check', '--', process.execPath, 'check.cjs']).status, 0);
  assert.match(run(moving, ['resume']).stdout, /passed, stale, the code changed during the check/);
  const entry = JSON.parse(read(path.join(moving, '.context', 'checks.jsonl')).trim());
  assert.equal(entry.changedDuringRun, true);
  writeFileSync(path.join(moving, 'app.js'), originalApp);
  assert.match(run(moving, ['resume']).stdout, /stale, the code changed during the check/, 'returning to the old code does not validate an unstable run');
  console.log('ok - checks fingerprint their starting code and flag changes during execution');

  // Resuming one session must not select another session's newer record.
  const concurrent = project('concurrent');
  const a = recordOf(run(concurrent, ['start', '--task', 'task-a', '--agent', 'codex', '--session', 'session-a']).stdout);
  const b = recordOf(run(concurrent, ['start', '--task', 'task-b', '--agent', 'codex', '--session', 'session-b']).stdout);
  const bBefore = read(path.join(concurrent, b));
  out = hook(concurrent, 'codex', 'SessionStart', 'session-a');
  assert.match(out.stdout, /^# Context: task-a$/m);
  assert.match(out.stdout, /do not start another record/);
  assert.doesNotMatch(out.stdout, /ctx\.mjs start --task/);
  assert.equal(run(concurrent, ['note', 'done', 'ambiguous']).status, 1);
  assert.equal(run(concurrent, ['save', '--status', 'done']).status, 1);
  writeFileSync(path.join(concurrent, 'marker.cjs'), `const fs = require('node:fs');\nfs.writeFileSync('ran.txt', 'ran');\nfs.appendFileSync(${JSON.stringify(a)}, '\\nNotes saved during the check.\\n');\n`);
  assert.equal(run(concurrent, ['check', '--', process.execPath, 'marker.cjs']).status, 1);
  assert.ok(!existsSync(path.join(concurrent, 'ran.txt')), 'ambiguous checks fail before executing');
  assert.equal(run(concurrent, ['note', 'done', 'A-only note', '--session', 'session-a']).status, 0);
  assert.equal(run(concurrent, ['check', '--session', 'session-a', '--', process.execPath, 'marker.cjs']).status, 0);
  assert.equal(run(concurrent, ['save', '--file', a, '--status', 'ready-for-review']).status, 0);
  assert.equal(read(path.join(concurrent, b)), bBefore, 'session B was not changed');
  assert.match(read(path.join(concurrent, a)), /A-only note/);
  assert.match(read(path.join(concurrent, a)), /Notes saved during the check\./, 'check preserves notes saved during execution');
  out = run(concurrent, ['resume', '--session', 'session-a']);
  assert.match(out.stdout, /^# Context: task-a$/m);
  assert.doesNotMatch(out.stdout, /earlier for this task/, 'a record is not its own history');
  assert.equal(run(concurrent, ['save', '--session', 'missing']).status, 1, 'an unknown session never falls back');
  console.log('ok - session resumes, notes, saves, and checks retain their owner');

  // Completion belongs to the current record, not an unfinished historical predecessor.
  const finished = project('finished', { git: false });
  const old = recordOf(run(finished, ['start', '--task', 'complete', '--agent', 'codex']).stdout);
  const done = recordOf(run(finished, ['start', '--task', 'complete', '--agent', 'codex']).stdout);
  assert.equal(run(finished, ['save', '--file', done, '--status', 'done']).status, 0);
  assert.match(run(finished, ['resume']).stdout, new RegExp(`Record: ${pattern(done)}`));
  assert.equal(run(finished, ['save', '--file', old]).status, 0, 'an older session can still save its own history');
  assert.match(run(finished, ['resume', '--task', 'complete']).stdout, new RegExp(`Record: ${pattern(done)}`));
  run(finished, ['start', '--task', 'open', '--agent', 'codex']);
  out = run(finished, ['resume']);
  assert.match(out.stdout, /^# Context: open$/m);
  assert.doesNotMatch(out.stdout, /Other open tasks:.*complete/, 'history does not revive the completed task');
  console.log('ok - completed successor records keep their predecessors out of open-task selection');
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
