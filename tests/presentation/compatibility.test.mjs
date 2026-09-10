import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The committed corpus snapshot makes plugin CI independent of Strata credentials.
// Set STRATA_DOCS_MANIFEST to a freshly generated platform manifest for release rehearsal.
test('the documentation grammar is inside the presentation skill compatibility range', () => {
  const skill = readFileSync(new URL('../../skills/strata-presentation/SKILL.md', import.meta.url), 'utf8');
  const metadata = skill.split('---')[1];
  const min = metadata.match(/^  grammar-version-min: "(\d+)"$/m);
  const max = metadata.match(/^  grammar-version-max: "(\d+)"$/m);
  assert.ok(min && max, 'the skill must declare its supported grammar versions');
  assert.ok(Number(min[1]) <= Number(max[1]), 'the compatibility range must be ordered');
  const manifest = JSON.parse(readFileSync(
    process.env.STRATA_DOCS_MANIFEST ?? new URL('fixtures/corpus-overview.json', import.meta.url),
    'utf8',
  ));
  const overview = manifest.sections.find((section) => section.slug === 'presentations');
  const version = overview?.body.match(/^grammarVersion: (\d+)$/m);
  assert.ok(version, 'the corpus must declare its grammar version');
  assert.ok(Number(version[1]) >= Number(min[1]), 'the corpus is older than the supported range');
  assert.ok(Number(version[1]) <= Number(max[1]), 'update the skill for this corpus version');
});
