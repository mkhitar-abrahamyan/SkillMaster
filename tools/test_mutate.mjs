#!/usr/bin/env node
/**
 * The mutation runner, against a project it makes: a mutant the tests catch is killed, one they
 * miss survives, one whose text is not there exactly once is missing, a slow one times out, and
 * every file is restored byte for byte, Windows line endings included. A failing baseline and a
 * file outside the root are refused before anything is mutated.
 *
 *   node tools/test_mutate.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../scripts/mutate.mjs', import.meta.url));
const project = mkdtempSync(path.join(tmpdir(), 'skillmaster-mutate-'));
// The Node running this test, wherever it lives, so the commands do not depend on PATH.
const node = JSON.stringify(process.execPath);
const hang = `${node} -e "setTimeout(() => {}, 60000)"`;
const write = (file, text) => writeFileSync(path.join(project, file), text);
const read = (file) => readFileSync(path.join(project, file));

try {
  // A discount with a boundary the test checks, and a branch it never reaches.
  write(
    'discount.mjs',
    [
      'export function discount(total, code) {',
      '  if (code === "STAFF") return total * 0.5;',
      '  return total >= 100 ? total * 0.9 : total;',
      '}',
      '',
    ].join('\r\n'),
  );
  write(
    'discount.test.mjs',
    [
      "import assert from 'node:assert/strict';",
      "import { discount } from './discount.mjs';",
      'assert.equal(discount(100), 90);',
      'assert.equal(discount(99), 99);',
      '',
    ].join('\n'),
  );
  write('twice.mjs', 'export const a = 1;\nexport const b = 1;\n');
  const before = { discount: read('discount.mjs'), twice: read('twice.mjs') };
  const mutants = (list, extra = {}) => {
    write('mutants.json', JSON.stringify({ test: `${node} discount.test.mjs`, mutants: list, ...extra }));
    const ran = spawnSync(process.execPath, [runner, 'mutants.json', '--root', project, '--json'], {
      cwd: project,
      encoding: 'utf8',
    });
    return { status: ran.status, report: ran.stdout ? JSON.parse(ran.stdout) : undefined, stderr: ran.stderr };
  };

  const { status, report } = mutants([
    { name: 'boundary shifted', file: 'discount.mjs', from: 'total >= 100', to: 'total > 100' },
    { name: 'staff rate changed', file: 'discount.mjs', from: 'total * 0.5', to: 'total * 0.6' },
    { name: 'text not there', file: 'discount.mjs', from: 'total <= 5', to: 'total < 5' },
    { name: 'text there twice', file: 'twice.mjs', from: '= 1', to: '= 2' },
    { name: 'no such file', file: 'gone.mjs', from: 'a', to: 'b' },
    {
      name: 'a test that hangs',
      file: 'discount.mjs',
      from: 'return total >= 100',
      to: 'return total >= 100',
      test: hang,
    },
  ].filter((mutant) => mutant.from !== mutant.to), { timeoutSeconds: 2 });
  assert.equal(status, 1, 'a survivor fails the run');
  assert.deepEqual(
    report.results.map((result) => [result.name, result.outcome]),
    [
      ['boundary shifted', 'killed'],
      ['staff rate changed', 'survived'],
      ['text not there', 'missing'],
      ['text there twice', 'missing'],
      ['no such file', 'missing'],
    ],
  );
  assert.match(report.results[3].detail, /occurs 2 times/);
  assert.deepEqual(report.counts, { killed: 1, timeout: 0, survived: 1, missing: 3 });
  assert.equal(report.restored, true);
  assert.deepEqual(read('discount.mjs'), before.discount, 'restored byte for byte, CRLF included');
  assert.deepEqual(read('twice.mjs'), before.twice);

  // A slow test is a timeout, which counts as caught.
  const slow = mutants(
    [{ name: 'boundary shifted', file: 'discount.mjs', from: 'total >= 100', to: 'total > 100', test: hang }],
    { timeoutSeconds: 2 },
  );
  assert.equal(slow.report.results[0].outcome, 'timeout');
  assert.equal(slow.status, 0, 'every mutant caught');
  assert.deepEqual(read('discount.mjs'), before.discount);

  // Refused before anything is touched.
  write('discount.test.mjs', "import assert from 'node:assert/strict';\nassert.equal(1, 2);\n");
  const red = mutants([{ name: 'boundary shifted', file: 'discount.mjs', from: 'total >= 100', to: 'total > 100' }]);
  assert.equal(red.status, 2);
  assert.match(red.stderr, /baseline fails/);
  const outside = mutants([{ name: 'escape', file: '../elsewhere.mjs', from: 'a', to: 'b' }]);
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /outside/);
  assert.deepEqual(read('discount.mjs'), before.discount);
  console.log('ok - the mutation runner: killed, survived, missing, timeout, restored, and refusals');
} finally {
  rmSync(project, { recursive: true, force: true });
}
