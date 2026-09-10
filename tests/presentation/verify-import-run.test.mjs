// Contract versus the committed rehearsal golden. An optional run directory
// verifies fresh agent outputs; missing artifacts always fail.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = process.env.PRESENTATION_IMPORT_RUN_DIR ?? fileURLToPath(new URL('.', import.meta.url));
const fixture = JSON.parse(
  readFileSync(new URL('fixtures/presentation-import.json', import.meta.url), 'utf8'),
);
const golden = JSON.parse(readFileSync(new URL('cases.json', import.meta.url), 'utf8'));
const actual = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

function verify(actual) {
  assert.equal(actual.cases.length, fixture.cases.length, 'every input needs a verdict');
  const mismatches = [];
  for (const expected of fixture.cases) {
    const matches = actual.cases.filter((item) => item.name === expected.name);
    assert.equal(matches.length, 1, expected.name);
    const { checks } = matches[0];
    assert.deepEqual(
      checks.map((check) => check.rule),
      ['S1', 'S2', 'S3', 'S4', 'S5'],
    );
    for (const [index, row] of expected.expected.entries()) {
      const got = checks[index];
      if (got.status !== row.status)
        mismatches.push(`${expected.name} ${row.rule}: ${got.status}, expected ${row.status}`);
      if (got.status !== 'pass') {
        assert.ok(got.reason?.trim(), `${expected.name}: missing reason`);
        assert.ok(got.location?.trim(), `${expected.name}: missing location`);
      }
      assert.equal('confidence' in got, false, 'verdicts cannot use confidence');
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'));
}

test('import eligibility: all five rules and their pass/fail boundary cases', () => verify(actual));

test('the rehearsal golden pins the contract including selector and adapter rules', () => {
  const contract = readFileSync(
    new URL('../../skills/strata-presentation/references/import-contract.md', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(contract).digest('hex'),
    golden.contractSha256,
    'Contract changed: review/rehearse all cases and explicitly update the golden receipt',
  );
  assert.equal(fixture.procedureVersion, golden.procedureVersion);
  assert.ok(contract.toString().includes(fixture.sectionAdapter));
});

test('the verifier rejects missing rows, wrong verdicts and confidence fields', () => {
  for (const mutate of [
    (run) => run.cases.pop(),
    (run) => run.cases[0].checks.pop(),
    (run) => {
      run.cases[0].checks[0].status = 'fail';
    },
    (run) => {
      run.cases[0].checks[0].confidence = 1;
    },
    (run) => {
      run.cases
        .find((item) => item.checks.some((row) => row.status !== 'pass'))
        .checks.find((row) => row.status !== 'pass').location = '';
    },
  ]) {
    const invalid = structuredClone(golden);
    mutate(invalid);
    assert.throws(() => verify(invalid));
  }
});

test('adaptation and re-import carry identical file-derived verdicts', () => {
  const names = ['S3-adapter-original', 'S3-adapter-adapted', 'S3-adapter-reimported'];
  const inputs = names.map((name) => fixture.cases.find((item) => item.name === name));
  assert.equal(inputs[1].html, inputs[2].html);
  assert.equal(inputs[1].html.replace(fixture.sectionAdapter, ''), inputs[0].html);
  for (const name of names) {
    assert.deepEqual(
      actual.cases.find((item) => item.name === name).checks.map((row) => row.status),
      Array(5).fill('pass'),
    );
  }
});
