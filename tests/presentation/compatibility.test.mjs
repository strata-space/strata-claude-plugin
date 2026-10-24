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

// The server rejects any presentation key outside the live grammar and turns
// presentation mode off for the whole document, so the skill's reference must
// name exactly the keys the corpus accepts.
test('the reference names exactly the presentation keys the corpus accepts', () => {
  const manifest = JSON.parse(readFileSync(
    process.env.STRATA_DOCS_MANIFEST ?? new URL('fixtures/corpus-overview.json', import.meta.url),
    'utf8',
  ));
  const grammar = manifest.sections.find((section) => section.slug === 'presentation-grammar');
  assert.ok(grammar, 'the corpus must carry presentation-grammar');
  const accepted = grammar.body.match(/presentation map accepts only ([^.]+)\./);
  assert.ok(accepted, 'presentation-grammar must list the accepted keys');
  const corpusKeys = [...accepted[1].matchAll(/(?:^|, |and )([a-z]+) \(/g)].map((m) => m[1]).sort();

  const reference = readFileSync(
    new URL('../../skills/strata-presentation/references/grammar.md', import.meta.url),
    'utf8',
  );
  const example = reference.match(/```yaml\n---\npresentation:\n((?: {2}[a-z]+:.*\n)+)---\n```/);
  assert.ok(example, 'grammar.md must show a presentation map example');
  const exampleKeys = [...example[1].matchAll(/^ {2}([a-z]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exampleKeys, corpusKeys, 'the example map must use exactly the accepted keys');

  const counted = reference.match(/Only these (\w+) keys are accepted/);
  const words = { four: 4, five: 5, six: 6 };
  assert.equal(words[counted?.[1]], corpusKeys.length, 'the stated key count must match the corpus');
});
