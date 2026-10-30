#!/usr/bin/env node
/**
 * Mutation check: does a test fail when the behavior it claims to test is broken?
 *
 *   node scripts/mutate.mjs <mutants.json> [--root <dir>] [--json]
 *
 * The mutants file names a test command and the mutants to try:
 *
 *   {
 *     "test": "npm test -- tests/discount.test.ts",
 *     "timeoutSeconds": 300,
 *     "mutants": [
 *       { "name": "boundary shifted", "file": "src/discount.ts", "from": "total >= 100", "to": "total > 100" },
 *       { "name": "error branch dropped", "file": "src/discount.ts", "from": "if (!code) throw", "to": "if (false) throw",
 *         "test": "npm test -- tests/discount-errors.test.ts" }
 *     ]
 *   }
 *
 * Each `from` must occur exactly once in its file. The test command must pass on the unmutated code
 * first. Every mutant is applied alone, the test run, and the file restored byte for byte, also when
 * the run is interrupted; the restore is verified at the end. Run it in an isolated copy (a git
 * worktree or a scratch copy), never in a working tree with someone's edits in progress: `--root`
 * points at that copy, and every mutated file must lie inside it.
 *
 * A mutant is `killed` when the test fails, `timeout` when it ran out of time (counted as killed),
 * `survived` when the test still passes, and `missing` when its `from` was not found exactly once.
 * Exit code: 0 when every mutant was killed, 1 when one survived or was missing, 2 when the file is
 * malformed or the baseline fails.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const asJson = args.includes('--json');
const specPath = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--root');
const fail = (message) => {
  console.error(message);
  process.exit(2);
};
if (!specPath) fail('Usage: node scripts/mutate.mjs <mutants.json> [--root <dir>] [--json]');

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
} catch (error) {
  fail(`${specPath} is not readable JSON: ${error.message}`);
}
const root = path.resolve(option('--root') ?? '.');
if (typeof spec.test !== 'string' || !Array.isArray(spec.mutants) || spec.mutants.length === 0) {
  fail('The mutants file needs a "test" command and a non-empty "mutants" list');
}
const timeout = (Number(spec.timeoutSeconds) || 300) * 1000;
for (const [index, mutant] of spec.mutants.entries()) {
  for (const key of ['name', 'file', 'from', 'to']) {
    if (typeof mutant[key] !== 'string') fail(`mutants[${index}] needs a string "${key}"`);
  }
  if (mutant.from === mutant.to) fail(`mutants[${index}] ("${mutant.name}") changes nothing`);
  const file = path.resolve(root, mutant.file);
  if (path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file))) {
    fail(`mutants[${index}] ("${mutant.name}") names a file outside ${root}`);
  }
}

let current;
/** Ends a test run and everything it started: a hung test left behind would hold files and time. */
function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/** Runs a test command in the root, and how it ended. */
function run(command) {
  const started = Date.now();
  return new Promise((resolve) => {
    // Its own process group off Windows, so a timeout ends the test's children too.
    const child = spawn(command, { cwd: root, shell: true, detached: process.platform !== 'win32', windowsHide: true });
    current = child;
    let output = '';
    const keep = (chunk) => {
      output = (output + chunk).slice(-20_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeout);
    child.on('close', (status) => {
      clearTimeout(timer);
      current = undefined;
      resolve({
        passed: status === 0 && !timedOut,
        timedOut,
        status,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        tail: output.trim().split('\n').slice(-5).join('\n'),
      });
    });
  });
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const originals = new Map();
const restoreAll = () => {
  for (const [file, bytes] of originals) writeFileSync(file, bytes);
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (current) killTree(current.pid);
    restoreAll();
    console.error(`Interrupted: every mutated file was restored.`);
    process.exit(130);
  });
}

const baseline = await run(spec.test);
if (!baseline.passed) {
  fail(`The baseline fails, so no mutant can be judged. \`${spec.test}\` ended with ${baseline.status}:\n${baseline.tail}`);
}

const results = [];
for (const mutant of spec.mutants) {
  const file = path.resolve(root, mutant.file);
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    results.push({ name: mutant.name, file: mutant.file, outcome: 'missing', detail: 'file not found' });
    continue;
  }
  if (!originals.has(file)) originals.set(file, bytes);
  // Matched on LF text, written back with the file's own line endings.
  const original = bytes.toString('utf8');
  const crlf = original.includes('\r\n');
  const text = crlf ? original.replace(/\r\n/g, '\n') : original;
  const from = mutant.from.replace(/\r\n/g, '\n');
  const count = text.split(from).length - 1;
  if (count !== 1) {
    results.push({ name: mutant.name, file: mutant.file, outcome: 'missing', detail: `"from" occurs ${count} times` });
    continue;
  }
  const mutated = text.replace(from, () => mutant.to.replace(/\r\n/g, '\n'));
  writeFileSync(file, crlf ? mutated.replace(/\n/g, '\r\n') : mutated);
  try {
    const ran = await run(mutant.test ?? spec.test);
    const outcome = ran.passed ? 'survived' : ran.timedOut ? 'timeout' : 'killed';
    results.push({ name: mutant.name, file: mutant.file, outcome, seconds: ran.seconds, ...(ran.passed ? {} : { detail: ran.tail }) });
  } finally {
    writeFileSync(file, originals.get(file));
  }
}

const unrestored = [...originals].filter(([file, bytes]) => digest(readFileSync(file)) !== digest(bytes)).map(([file]) => file);
const counts = Object.fromEntries(['killed', 'timeout', 'survived', 'missing'].map((outcome) => [outcome, results.filter((result) => result.outcome === outcome).length]));
const summary = { root, test: spec.test, baselineSeconds: baseline.seconds, counts, results, restored: unrestored.length === 0 };

if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  for (const result of results) {
    const detail = result.outcome === 'missing' ? ` (${result.detail})` : result.seconds !== undefined ? ` (${result.seconds} s)` : '';
    console.log(`${result.outcome.padEnd(8)} ${result.name} — ${result.file}${detail}`);
  }
  console.log(
    `${counts.killed + counts.timeout} of ${results.length} killed` +
      (counts.survived ? `; ${counts.survived} survived` : '') +
      (counts.missing ? `; ${counts.missing} missing` : '') +
      `; files restored: ${unrestored.length === 0 ? 'yes' : `NO (${unrestored.join(', ')})`}`,
  );
}
process.exit(unrestored.length || counts.survived || counts.missing ? 1 : 0);
