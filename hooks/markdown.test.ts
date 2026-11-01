import { expect, test } from 'claude-code/testing'

test('a table is laid out for the pane: a grid where it fits, cards where it does not', async () => {
  const table = '| Step | Owner |\n|---|:-:|\n| Canary 1% | Priya |\n| Widen \\| 10% | Sam |'
  expect(tableLayout(table, 80)).toEqual({
    kind: 'grid',
    header: 'Step         Owner',
    rule: '───────────  ─────',
    rows: ['Canary 1%    Priya', 'Widen | 10%  Sam'],
  })
  expect(tableLayout(table, 10)).toEqual({
    kind: 'cards',
    cards: [
      [{ label: 'Step', value: 'Canary 1%' }, { label: 'Owner', value: 'Priya' }],
      [{ label: 'Step', value: 'Widen | 10%' }, { label: 'Owner', value: 'Sam' }],
    ],
  })
  // Cells are measured as drawn: emphasis marks dropped, images named.
  expect(tableLayout('| a | b |\n|---|---|\n| **aa** | ![x](strata://image/) |', 80)).toEqual({
    kind: 'grid',
    header: 'a   b',
    rule: '──  ──────────',
    rows: ['aa  [image: x]'],
  })
  // A long table is laid out whole; its cost grows with it, so the pane's cut decides.
  const long = ['| n |', '|---|', ...Array.from({ length: 2000 }, (_, at) => `| ${String(at)} |`)].join('\n')
  const whole = tableLayout(long, 70)
  expect(whole !== null && whole.kind === 'grid' ? whole.rows.length : 0).toBe(2000)
  expect(tableCost(long) ?? 0).toBeGreaterThan(20_000)
  expect(tableLayout('Just a | pipe in prose.', 80)).toBe(null)
  expect(withoutImages('See ![Arch](strata://image/) and ![](x.png "t").')).toBe('See [image: Arch] and [image].')
})

test('diagrams, charts and formulas fold like html embeds; other code passes whole', async () => {
  const text = ['Intro.', '', '```mermaid', 'graph TD', 'A-->B', '```', '', '```math', 'E = mc^2', '```', '', '```ts', 'const a = 1', '```', '', '```html uses=sales,costs', '<div></div>', '```'].join('\n')
  const folded = degradeHtml(text, [])
  expect(folded.fences.map(fence => fence.label)).toEqual(['mermaid diagram', 'tex math', 'html block'])
  expect(folded.fences.map(fence => fence.noun)).toEqual(['mermaid', 'math', 'html'])
  expect(folded.fences[2]?.uses).toEqual(['sales', 'costs'])
  expect(folded.text).toContain('> **mermaid diagram 1** (2 lines): drawn in the web app; open in browser to view')
  expect(folded.text).toContain('> **html block 3** (1 lines, uses sales, costs): runs in the web app')
  expect(folded.text).toContain('```ts\nconst a = 1\n```')
  expect(blocksOf(folded.text).map(block => block.kind)).toEqual(['paragraph', 'embed', 'embed', 'code', 'embed'])
  // Shown, a diagram is its source, still an embed and never quoted as the document's prose.
  const shown = degradeHtml(text, [0])
  expect(shown.text).toContain('```mermaid\ngraph TD\nA-->B\n```')
  expect(blocksOf(shown.text)[1]?.kind).toBe('embed')
  // Every folded kind's placeholder stays an embed, a kind with a digit included.
  for (const language of ['plantuml', 'dot', 'd2', 'vega-lite', 'chart', 'latex']) {
    const one = degradeHtml(['```' + language, 'x', '```'].join('\n'), [])
    expect(blocksOf(one.text).map(block => block.kind)).toEqual(['embed'])
  }
})

import {
  blocksOf,
  degradeHtml,
  heldHeadingsAmbiguous,
  heldPathAt,
  heldSectionRange,
  headingPathsByLine,
  opensFence,
  outlineOf,
  runsOn,
  parseReadResult,
  placeThreads,
  rebaseOutline,
  sectionSlice,
  tableLayout,
  tableCost,
  shownText,
  withoutImages,
} from './markdown'

const DOC = [
  '# Plan',
  '',
  'Intro.',
  '',
  '## Risks',
  '',
  'The gate reads p95 alone.',
  '',
  '```ts',
  '# not a heading',
  '```',
  '',
  '### Rollback',
  '',
  'Manual.',
  '',
  '## Owners',
  '',
  'None yet.',
  '',
].join('\n')

test('a trailing hash is part of the title unless a space sets it off as a closing run', async () => {
  const text = '# C#\n\nSharp.\n\n## A ##\n\nClosed.\n\n## B#\n\nAlso sharp.'
  expect(outlineOf(text).map(entry => entry.title)).toEqual(['C#', 'A', 'B#'])
  expect(outlineOf(text).map(entry => entry.path)).toEqual(['C#', 'C# > A', 'C# > B#'])
  expect(sectionSlice(text, 'C# > B#').trim()).toBe('## B#\n\nAlso sharp.')
})

test('headings make the paths read_document takes in sections', async () => {
  expect(outlineOf(DOC).map(entry => entry.path)).toEqual([
    'Plan',
    'Plan > Risks',
    'Plan > Risks > Rollback',
    'Plan > Owners',
  ])
  expect(outlineOf(DOC).map(entry => entry.level)).toEqual([1, 2, 3, 2])
})

test('a section runs to the next heading of its level or above', async () => {
  const risks = sectionSlice(DOC, 'Plan > Risks')
  expect(risks.startsWith('## Risks')).toBe(true)
  expect(risks).toContain('### Rollback')
  expect(risks).not.toContain('## Owners')
  expect(sectionSlice(DOC, 'Plan > Owners').trim()).toBe('## Owners\n\nNone yet.')
  // Paths match as the server matches them: case folded, spacing around the separator free.
  expect(sectionSlice(DOC, 'plan>OWNERS').trim()).toBe('## Owners\n\nNone yet.')
  expect(sectionSlice(DOC, null)).toBe(DOC)
  expect(sectionSlice(DOC, 'Nowhere')).toBe(DOC)
})

test('blocks: each heading alone, each fence whole, else runs of lines; embeds marked', async () => {
  const blocks = blocksOf(DOC)
  expect(blocks.map(block => block.kind)).toEqual([
    'heading',
    'paragraph',
    'heading',
    'paragraph',
    'code',
    'heading',
    'paragraph',
    'heading',
    'paragraph',
  ])
  expect(blocks[4]?.text).toBe('```ts\n# not a heading\n```')
  expect(blocks[3]?.start).toBe(6)
  expect(blocks[3]?.text).toBe('The gate reads p95 alone.')
  const embed = 'A.\n\n```html\n<div/>\n```\n\nB.'
  expect(blocksOf(degradeHtml(embed, []).text).map(block => block.kind)).toEqual(['paragraph', 'embed', 'paragraph'])
  expect(blocksOf(degradeHtml(embed, [0]).text).map(block => block.kind)).toEqual(['paragraph', 'embed', 'paragraph'])
  expect(blocksOf('one\ntwo\n\nthree').map(block => block.text)).toEqual(['one\ntwo', 'three'])
})

test('each drawn line knows the document line it came from, markers and folds included', async () => {
  const original = ['A.', '', '<!-- strata:name=x -->', '```html', '<div>A.</div>', '```', '', 'B.'].join('\n')
  const folded = degradeHtml(original, [])
  // The marker stays in the text the scans read (a block boundary), and is no block the pane draws.
  expect(folded.text.split('\n')).toEqual(['A.', '', '<!-- strata:name=x -->', '> **html block 1** (1 lines): runs in the web app', '', 'B.'])
  expect(folded.origin).toEqual([0, 1, 2, 3, 6, 7])
  expect(blocksOf(folded.text).map(block => block.text)).toEqual(['A.', '> **html block 1** (1 lines): runs in the web app', 'B.'])
  const shown = degradeHtml(original, [0])
  expect(shown.origin).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
})

test('a code fence of another kind passes whole, an html fence inside it included', async () => {
  const text = ['````md', '```html', '<x/>', '```', '````', '', 'After.'].join('\n')
  const folded = degradeHtml(text, [])
  expect(folded.fences).toEqual([])
  expect(folded.text).toBe(text)
  expect(folded.origin).toEqual([0, 1, 2, 3, 4, 5, 6])
})

test('a delimiter with text after it inside a fence is content, not its close', async () => {
  const text = ['# A', '', '```', '```html', '## Fake', '```', '', '## B'].join('\n')
  expect(outlineOf(text).map(entry => entry.path)).toEqual(['A', 'A > B'])
  expect(degradeHtml(text, []).fences).toEqual([])
  expect(blocksOf(text).map(block => block.kind)).toEqual(['heading', 'code', 'heading'])
})

test("a sectioned read's headings go back under the ancestors the whole document gives them", async () => {
  const entries = outlineOf('## Risks\n\nThe gate.\n\n### Rollback\n\nManual.')
  expect(entries.map(entry => entry.path)).toEqual(['Risks', 'Risks > Rollback'])
  const rebased = rebaseOutline(entries, ['Plan > Risks'])
  expect(rebased.map(entry => entry.path)).toEqual(['Plan > Risks', 'Plan > Risks > Rollback'])
  expect(rebased.map(entry => entry.level)).toEqual([2, 3])
  expect(rebaseOutline(entries, []).map(entry => entry.path)).toEqual(['Risks', 'Risks > Rollback'])
  // Two sections of different depths, read together: each restarts the ancestry at its own root.
  const mixed = outlineOf('## Risks\n\nThe gate.\n\n### Deadlines\n\nSoon.\n\n#### Q3\n\nJuly.')
  expect(rebaseOutline(mixed, ['Plan > Risks', 'Plan > Owners > Deadlines']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Owners > Deadlines',
    'Plan > Owners > Deadlines > Q3',
  ])
  // A sub-heading that shares a later section's title is a descendant, not that section.
  const text = '## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n## Summary\n\nAll.\n\nMore.'
  const shared = outlineOf(text)
  expect(rebaseOutline(shared, ['Plan > Risks', 'Owners > Summary']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Risks > Summary',
    'Owners > Summary',
  ])
  // Even when the later section's path is as deep as the sub-heading: the real one is the last such heading.
  const deeper = outlineOf('## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n### Summary\n\nAll.')
  expect(rebaseOutline(deeper, ['Plan > Risks', 'Owners > Notes > Summary']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Risks > Summary',
    'Owners > Notes > Summary',
  ])
  // A same-titled heading inside a later returned section is past the boundary and does not count.
  const bounded = outlineOf('## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n## Owners\n\nWho.\n\n### Summary\n\nTheirs.')
  expect(
    rebaseOutline(bounded, ['Plan > Risks', 'Other > Notes > Summary', 'Plan > Owners']).map(entry => entry.path),
  ).toEqual(['Plan > Risks', 'Other > Notes > Summary', 'Plan > Owners', 'Plan > Owners > Summary'])
  // A deeper heading with the following section's title is no boundary. Among
  // the candidates before a real one, the heading at the level the path's
  // length names wins when there is exactly one: the server returns a
  // section's heading at its own level, so `### Summary` is `Plan > Other >
  // Summary`, and the `#### Summary` under it is its own child.
  const nested = outlineOf('## Risks\n\nA.\n\n### Summary\n\nB.\n\n#### Owners\n\nC.\n\n#### Summary\n\nD.\n\n## Owners\n\nE.')
  expect(rebaseOutline(nested, ['Plan > Risks', 'Plan > Other > Summary', 'Plan > Owners']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Other > Summary',
    'Plan > Other > Summary > Owners',
    'Plan > Other > Summary > Summary',
    'Plan > Owners',
  ])
  // A same-titled child of a returned section's root cannot displace the root.
  const child = outlineOf('## Risks\n\nA.\n\n### Schedule\n\nB.\n\n#### Schedule\n\nC.')
  expect(rebaseOutline(child, ['Plan > Risks', 'Plan > Owners > Schedule']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Owners > Schedule',
    'Plan > Owners > Schedule > Schedule',
  ])
  expect(heldSectionRange('## Risks\n\nA.\n\n### Schedule\n\nB.\n\n#### Schedule\n\nC.', 'Plan > Risks', ['Plan > Risks', 'Plan > Owners > Schedule'])).toEqual({
    start: 0,
    end: 4,
  })
  // A document that skips levels: the section's heading level need not match its path's length.
  const skipped = outlineOf('## Risks\n\nThe gate.\n\n#### Schedule\n\nQ3.')
  expect(rebaseOutline(skipped, ['Plan > Risks', 'Plan > Owners > Schedule']).map(entry => entry.path)).toEqual([
    'Plan > Risks',
    'Plan > Owners > Schedule',
  ])
})

test('a thread sits under the block its quote starts in, and nowhere when found twice or not at all', async () => {
  const drawn = 'Summary.\n\nThe full summary is Summary.\n\nTwice.\n\nTwice.'
  const blocks = blocksOf(drawn)
  const threads = [
    { id: 'a', quotedText: 'The full summary is Summary.' },
    { id: 'b', quotedText: 'Summary.' },
    { id: 'c', quotedText: 'Twice.' },
    { id: 'd', quotedText: 'Nowhere.' },
    { id: 'e', quotedText: '' },
  ]
  const placed = placeThreads(drawn, blocks, threads)
  expect(placed.perBlock.map(list => list.map(thread => thread.id))).toEqual([[], ['a'], [], []])
  expect(placed.loose.map(thread => thread.id)).toEqual(['b', 'c', 'd', 'e'])
})

test('the breadcrumbs in force at a line of held text name the section the line is under', async () => {
  const text = '## Risks\n\nThe gate.\n\n### Summary\n\nShort.\n\n## Summary\n\nAll.\n\nMore.'
  const lines = text.split('\n')
  expect(heldPathAt(text, lines.indexOf('The gate.'), ['Plan > Risks', 'Owners > Summary'])).toEqual(['Plan', 'Risks'])
  expect(heldPathAt(text, lines.indexOf('Short.'), ['Plan > Risks', 'Owners > Summary'])).toEqual(['Plan', 'Risks', 'Summary'])
  expect(heldPathAt(text, lines.indexOf('More.'), ['Plan > Risks', 'Owners > Summary'])).toEqual(['Owners', 'Summary'])
  expect(heldPathAt('No heading.', 0, ['Plan > Risks'])).toEqual([])
})

test('a fence opening a list item closes at the item\'s indentation; one of its own gains nothing from its indentation', async () => {
  const listed = ['# Plan', '', '- ~~~text', '  example', '  ~~~', '', '## Owners', '', 'Priya.'].join('\n')
  expect(outlineOf(listed).map(entry => entry.path)).toEqual(['Plan', 'Plan > Owners'])
  expect(blocksOf(listed).map(block => block.kind)).toEqual(['heading', 'code', 'heading', 'paragraph'])
  expect(sectionSlice(listed, 'Plan > Owners').trim()).toBe('## Owners\n\nPriya.')
  expect(degradeHtml(listed, []).text).toBe(listed)
  // Four blanks before the delimiter do not close a fence of its own, so the heading inside is no heading.
  const indented = ['# A', '', '   ~~~', '    ~~~', '## Fake', '   ~~~', '', '## B'].join('\n')
  expect(outlineOf(indented).map(entry => entry.path)).toEqual(['A', 'A > B'])
  expect(blocksOf(indented).map(block => block.kind)).toEqual(['heading', 'code', 'heading'])
})

test('a fence in a list item ends with the item; CRLF endings and a tab after the marker read as Markdown does', async () => {
  const ended = ['- ```', '  code', '', 'Outside.', '', '## B'].join('\n')
  expect(blocksOf(ended).map(block => block.kind)).toEqual(['code', 'paragraph', 'heading'])
  expect(blocksOf(ended)[1]?.text).toBe('Outside.')
  expect(outlineOf(ended).map(entry => entry.path)).toEqual(['B'])
  expect(degradeHtml(ended, []).text).toBe(ended)
  const crlf = ['# A', '', '```html', '<x/>', '```', '', '## B', ''].join('\r\n')
  expect(outlineOf(crlf).map(entry => entry.path)).toEqual(['A', 'A > B'])
  expect(blocksOf(crlf).map(block => block.kind)).toEqual(['heading', 'embed', 'heading'])
  expect(degradeHtml(crlf, []).fences.map(fence => fence.lines)).toEqual([1])
  const tabbed = ['-\t~~~', '\tx', '       ~~~', '', '## B'].join('\n')
  expect(outlineOf(tabbed).map(entry => entry.path)).toEqual(['B'])
  expect(blocksOf(tabbed).map(block => block.kind)).toEqual(['code', 'heading'])
})

test('a tilde line inside a backtick fence closes nothing, so a heading in the fence is not a heading', async () => {
  const text = ['# A', '', '```', '~~~', '## Fake', '```', '', '## B', '', 'b'].join('\n')
  expect(outlineOf(text).map(entry => entry.path)).toEqual(['A', 'A > B'])
  // The fake heading is no section: asking for it answers the whole text, and B's section starts at the real heading.
  expect(sectionSlice(text, 'A > Fake')).toBe(text)
  expect(sectionSlice(text, 'A > B').trim()).toBe('## B\n\nb')
})

test('html embeds fold to a placeholder until shown, and binding markers hide', async () => {
  const text = [
    'Before.',
    '',
    '<!-- strata:name=sales -->',
    '```json name=sales',
    '{"a": 1}',
    '```',
    '',
    '```html uses="sales"',
    '<div>chart</div>',
    '<script>draw()</script>',
    '```',
    '',
    'After.',
  ].join('\n')
  const folded = degradeHtml(text, [])
  expect(folded.fences).toEqual([{ index: 0, lines: 2, uses: ['sales'], isRevealed: false, label: 'html block', noun: 'html' }])
  expect(blocksOf(folded.text).some(block => block.text.includes('strata:name'))).toBe(false)
  expect(folded.text).toContain('```json name=sales')
  expect(folded.text).toContain('html block 1')
  expect(folded.text).not.toContain('<script>')
  const shown = degradeHtml(text, [0])
  expect(shown.text).toContain('<script>draw()</script>')
  expect(shown.fences[0]?.isRevealed).toBe(true)
})

test('a read answer parses in both of its shapes', async () => {
  const markdown = parseReadResult(
    JSON.stringify({ documentId: 'doc_1', title: 'Plan', format: 'markdown', documentVersion: 4, content: DOC }),
  )
  expect(markdown?.version).toBe(4)
  expect(markdown?.markdown).toBe(DOC)
  const outline = parseReadResult(
    JSON.stringify({
      documentId: 'doc_1',
      title: 'Plan',
      format: 'outline',
      documentVersion: 5,
      outline: [
        { heading: 'Plan', headingLevel: 1, path: 'Plan', tokenCount: 10, preview: '' },
        { heading: 'Risks', headingLevel: 2, path: 'Plan > Risks', tokenCount: 20, preview: '' },
      ],
    }),
  )
  expect(outline?.format).toBe('outline')
  expect(outline?.outline.map(entry => entry.title)).toEqual(['Plan', 'Risks'])
  expect(parseReadResult('not json')).toBe(null)
  expect(parseReadResult('{"title":"x"}')).toBe(null)
})

test('a held section is found by the name the whole document gives it, not by a path search over the held text', () => {
  // Read as `A > A` of a document whose `# A` holds `## A` holds `### A`: the
  // held text starts at `## A`, which a path search would call plain `A`, and
  // whose own `### A` it would call `A > A`.
  const held = '## A\n\nOwn.\n\n### A\n\nNested.\n\n## B\n\nOther.\n'
  expect(heldSectionRange(held, 'A > A', ['A > A', 'A > B'])).toEqual({ start: 0, end: 8 })
  expect(heldSectionRange(held, 'a > a > a', ['A > A', 'A > B'])).toEqual({ start: 4, end: 8 })
  expect(heldSectionRange(held, 'A > B', ['A > A', 'A > B'])).toEqual({ start: 8, end: 12 })
  expect(heldSectionRange(held, 'A', ['A > A', 'A > B'])).toBeNull()
})

test('a held section ends where the whole document places the next returned section, however deep its heading', () => {
  // `Plan > Risks` and `Plan > Owners > Schedule` read together: Schedule's
  // heading is deeper than Risks', yet it is no part of Risks.
  const held = '## Risks\n\nR.\n\n#### Schedule\n\nS.\n'
  const sections = ['Plan > Risks', 'Plan > Owners > Schedule']
  expect(heldSectionRange(held, 'Plan > Risks', sections)).toEqual({ start: 0, end: 4 })
  expect(heldSectionRange(held, 'Plan > Owners > Schedule', sections)).toEqual({ start: 4, end: 8 })
})

test('a folded html placeholder right under a paragraph stays an embed of its own', () => {
  // No blank line between the paragraph and the fence: the placeholder must
  // not be quoted along with the paragraph, since it stands for hidden source.
  const folded = degradeHtml('Intro.\n```html\n<b>x</b>\n```\n\nAfter.', []).text
  const blocks = blocksOf(folded)
  expect(blocks.map(block => block.kind)).toEqual(['paragraph', 'embed', 'paragraph'])
  expect(blocks[0]?.text).toBe('Intro.')
})

test('sections read together are ambiguous when a deeper root is chosen among several same-titled headings', () => {
  const sections = ['Plan > Risks', 'Plan > Owners > Schedule']
  // Two headings could begin `Plan > Owners > Schedule`: the choice is a guess.
  expect(heldHeadingsAmbiguous('## Risks\n\nA.\n\n### Schedule\n\nB.\n\n#### Schedule\n\nC.', sections)).toBe(true)
  // One heading can: no guess.
  expect(heldHeadingsAmbiguous('## Risks\n\nA.\n\n#### Schedule\n\nC.', sections)).toBe(false)
  // A root at or above the current root's level is never a guess.
  expect(heldHeadingsAmbiguous('## Risks\n\nA.\n\n## Schedule\n\nC.', sections)).toBe(false)
  expect(heldHeadingsAmbiguous('## Risks\n\nA.', ['Plan > Risks'])).toBe(false)
})

test('a quote found twice in the whole held text stays loose in a section cut that finds it once', () => {
  const whole = '## A\n\nSame passage.\n\n## B\n\nSame passage.'
  const cut = '## A\n\nSame passage.'
  const thread = { id: 'cmt_1', quotedText: 'Same passage.' }
  expect(placeThreads(cut, blocksOf(cut), [thread]).perBlock[1]).toEqual([thread])
  const held = placeThreads(cut, blocksOf(cut), [thread], whole)
  expect(held.loose).toEqual([thread])
  expect(held.perBlock.flat()).toEqual([])
})

test('table share, images in code, an escaped closing pipe, and fence tags that are no diagrams', () => {
  // A table is charged the most it can draw, escaping included; prose is not a table.
  const small = tableCost('| a |\n|---|\n| b |') ?? 0
  expect(small).toBeGreaterThan(0)
  const quoted = tableCost(`| ${'"'.repeat(7800)} |\n|---|\n| x |`) ?? 0
  expect(quoted).toBeGreaterThan(15_600)
  expect(tableCost('Just | prose')).toBe(null)
  // An image reference in code is code.
  expect(withoutImages('```md\n![logo](x)\n```')).toBe('```md\n![logo](x)\n```')
  expect(withoutImages('Write `![logo](x)` for ![logo](x).')).toBe('Write `![logo](x)` for [image: logo].')
  expect(withoutImages('``a` ![logo](x)`` and ![b](y)')).toBe('``a` ![logo](x)`` and [image: b]')
  // An escaped pipe closing a row without an outer delimiter stays the cell's.
  const escaped = tableLayout('x | y\n---|---\na | value\\|', 80)
  expect(escaped !== null && escaped.kind === 'grid' ? escaped.rows : []).toEqual(['a  value|'])
  // A fence tag named like an object's own property is code, not a diagram.
  expect(degradeHtml('```constructor\nx\n```', []).fences).toEqual([])
})

test('tables of escaped backslashes, headers alone or many rows, and escaped backticks before code', () => {
  // Two backslashes are one escaped backslash: the pipe after them divides cells.
  const path = tableLayout('| Path | Owner |\n|---|---|\n| C:\\\\| Ada |', 80)
  expect(path !== null && path.kind === 'grid' ? path.rows : []).toEqual(['C:\\   Ada'])
  // A wide table of headers alone still shows its headers.
  const headers = tableLayout(`| ${'a'.repeat(60)} | ${'b'.repeat(60)} |\n|---|---|`, 40)
  expect(headers !== null && headers.kind === 'grid' ? headers.header : '').toContain('aaaa')
  // A very long table is costed without spreading its rows into one call.
  const huge = ['| n |', '|---|', ...Array.from({ length: 150_000 }, () => '| 1 |')].join('\n')
  expect(tableCost(huge) ?? 0).toBeGreaterThan(150_000)
  // An escaped backtick opens nothing: the real span after it keeps its image reference as code.
  expect(withoutImages('\\` followed by `![logo](x)`')).toBe('\\` followed by `![logo](x)`')
  // An escaped bang is a literal `!` before a link: not an image.
  expect(withoutImages('\\![spec](https://example.org/spec)')).toBe('\\![spec](https://example.org/spec)')
  // An escaped parenthesis is part of an image's address.
  expect(withoutImages('Before ![logo](report\\)final.png) after.')).toBe('Before [image: logo] after.')
  // In a cell, escaped markup stays literal: an escaped bang, escaped asterisks.
  const literal = tableLayout('| a | b |\n|---|---|\n| \\![spec](u) | \\*\\*lit\\*\\* |', 80)
  expect(literal !== null && literal.kind === 'grid' ? literal.rows : []).toEqual(['![spec](u)  **lit**'])
  // A code span in a cell keeps its content literally: globs, dunders, backslashes.
  const code = tableLayout('| a |\n|---|\n| `**/*.ts` |\n| `__init__` |\n| `C:\\\\x` |', 80)
  expect(code !== null && code.kind === 'grid' ? code.rows : []).toEqual(['**/*.ts', '__init__', 'C:\\\\x'])
  // Only paired emphasis delimiters are dropped: an expression's operator stays.
  const math = tableLayout('| Expression |\n|---|\n| 2 ** 3 |\n| **bold** |', 80)
  expect(math !== null && math.kind === 'grid' ? math.rows : []).toEqual(['2 ** 3', 'bold'])
  // A private-use character in a cell is kept where it stands.
  const private_ = tableLayout('| a |\n|---|\n| x\uE000\\*y |', 80)
  expect(private_ !== null && private_.kind === 'grid' ? private_.rows : []).toEqual(['x\uE000*y'])
  // Intraword underscores are literal; a delimiter row of another count makes no table.
  const ident = tableLayout('| a |\n|---|\n| my__internal__name |\n| __bold__ |', 80)
  expect(ident !== null && ident.kind === 'grid' ? ident.rows : []).toEqual(['my__internal__name', 'bold'])
  expect(tableLayout('a | b\n---\nc | d | e', 80)).toBe(null)
})

test('a fence under a list item, after a blank line, ends with the item; indented code is no table', () => {
  const text = ['- item', '', '  ~~~html', '  <x/>', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(text).map(entry => entry.path)).toEqual(['Real'])
  expect(degradeHtml(text, []).text).toContain('Outside.')
  expect(blocksOf(degradeHtml(text, []).text).map(block => block.kind)).toEqual(['paragraph', 'embed', 'paragraph', 'heading'])
  expect(tableLayout('    a | b\n    --- | ---\n    c | d', 80)).toBe(null)
  // An item's continuation line between it and the fence: still the item's fence.
  const continued = ['- item', '  more', '', '   ~~~html', '   <x/>', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(continued).map(entry => entry.path)).toEqual(['Real'])
  expect(degradeHtml(continued, []).text).toContain('Outside.')
  // An empty item holds the fence under it; text that ended an item lets no later fence back into it.
  const emptyItem = ['-', '  ~~~html', '  <x/>', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(emptyItem).map(entry => entry.path)).toEqual(['Real'])
  const ended = ['- item', '', ' Outside.', '', '  ~~~html', '<div>hidden</div>', '# Fake', '  ~~~', '', '# Real'].join('\n')
  expect(outlineOf(ended).map(entry => entry.path)).toEqual(['Real'])
  // An outer item holds the fence its ended inner item cannot; a thematic break is no item.
  const nested = ['- outer', '  - inner', '', '   ~~~html', '   x', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(nested).map(entry => entry.path)).toEqual(['Real'])
  expect(degradeHtml(nested, []).text).toContain('Outside.')
  const rule = ['- - -', '', '  ~~~html', '# Fake', '  ~~~', '', '# Real'].join('\n')
  expect(outlineOf(rule).map(entry => entry.path)).toEqual(['Real'])
  // A marker inside an earlier fence is no item; a fence four columns in, under an item at two, is a fence.
  const earlier = ['~~~text', '- fake', '  ~~~', '', '  ~~~html', '# Fake', '  ~~~', '', '# Real'].join('\n')
  expect(outlineOf(earlier).map(entry => entry.path)).toEqual(['Real'])
  const deep = ['- item', '', '    ~~~html', '    <div/>', '    ~~~'].join('\n')
  expect(blocksOf(degradeHtml(deep, []).text).map(block => block.kind)).toEqual(['paragraph', 'embed'])
  // An ordered item from 2 does not interrupt a paragraph: no container.
  const ordered = ['Intro.', '2. text', '', '   ~~~html', 'x', '# Fake', '   ~~~', '', '# Real'].join('\n')
  expect(outlineOf(ordered).map(entry => entry.path)).toEqual(['Real'])
  // Every marker before a fence opens an item: the outer one still holds a later fence.
  const markers = ['- - ~~~text', '    x', '    ~~~', '  continued', '', '    ~~~html', '  y', '    ~~~'].join('\n')
  expect(degradeHtml(markers, []).text).not.toContain('<')
  expect(degradeHtml(markers, []).text).not.toContain('\n  y')
  // A thematic break under a marker opens no items.
  const broken = ['1. - - -', '', '     ~~~html', '   x', '   ~~~'].join('\n')
  expect(degradeHtml(broken, []).text).not.toContain('\n   x')
  // A paragraph in an item ends at the item's fence.
  const under = ['- item', '    ~~~html', '    x', '    ~~~'].join('\n')
  expect(blocksOf(degradeHtml(under, []).text).map(block => block.kind)).toEqual(['paragraph', 'embed'])
  // A sibling item takes its fence; a rejected marker opens none; padding counts in columns.
  const sibling = ['1. first', '2. ~~~html', '   x', '      ~~~', '', '# Real'].join('\n')
  expect(outlineOf(sibling).map(entry => entry.path)).toEqual(['Real'])
  const rejected = ['Intro.', '2. ~~~html', '   x', '   ~~~', '', '# Literal'].join('\n')
  expect(outlineOf(rejected).map(entry => entry.path)).toEqual([])
  const padded = ['-\t  ~~~html', '      keep this literal code', '', '# Real'].join('\n')
  expect(degradeHtml(padded, []).text).toContain('keep this literal code')
  // A lazy continuation keeps the item open; indented code starts no paragraph.
  const lazy = ['- item', 'continued', '', '  ~~~html', '  <b>x</b>', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(lazy).map(entry => entry.path)).toEqual(['Real'])
  const code = ['    example', '2. ~~~html', '   <b>x</b>', '   ~~~', '', '# Real'].join('\n')
  expect(outlineOf(code).map(entry => entry.path)).toEqual(['Real'])
  // Short of the item's column, `2.` begins a list of its own (as the reference parser has it): the fence
  // after it, short of that item's column too, is top-level and unclosed, holding the rest.
  const runOn = ['- item', '2. continuation', '', '  ~~~html', '  x', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(runOn).map(entry => entry.path)).toEqual([])
  // Text that begins no block runs on lazily.
  expect(outlineOf('- item\ncontinued\n\n# Real').map(entry => entry.path)).toEqual(['Real'])
  const stars = ['- item', 'text', '***', '  ~~~html', '# Fake', '  ~~~', '', '# Real'].join('\n')
  expect(outlineOf(stars).map(entry => entry.path)).toEqual(['Real'])
  // Padding code and a setext underline leave no paragraph for the next item to interrupt.
  const padCode = ['-     example', '2. ~~~html', '   x', '   ~~~', '', '# Real'].join('\n')
  expect(outlineOf(padCode).map(entry => entry.path)).toEqual(['Real'])
  const setext = ['Title', '===', '2. ~~~html', '   x', '   ~~~', '', '# Real'].join('\n')
  expect(outlineOf(setext).map(entry => entry.path)).toContain('Real')
  // An invalid backtick opener interrupts nothing; an indented continuation keeps the paragraph; a non-breaking space is text.
  const badTicks = ['- item', '```bad`', '', '  ~~~html', '  x', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(badTicks).map(entry => entry.path)).toEqual(['Real'])
  const continuation = ['Intro.', '    continuation', '2. ~~~html', '   literal'].join('\n')
  expect(degradeHtml(continuation, []).text).toBe(continuation)
  const nbsp = ['- item', '1.\t\u00a0', '    ~~~html', '  Outside.', '', '# Real'].join('\n')
  expect(degradeHtml(nbsp, []).text).toContain('  Outside.')
  // Indented code is a code block, drawn verbatim.
  expect(blocksOf('Intro.\n\n    ![logo](x)').map(block => [block.kind, shownText(block)])).toEqual([
    ['paragraph', 'Intro.'],
    ['code', '    ![logo](x)'],
  ])
  expect(blocksOf('***\n    ![logo](x)').map(block => shownText(block))).toEqual(['***', '    ![logo](x)'])
  const marked = '    before\n    <!-- strata:name=example -->\n    after'
  expect(degradeHtml(marked, []).text).toBe(marked)
  // A lone quote mark leaves no paragraph open.
  const quoted = ['>', '2. ~~~html', '   <x/>', '   ~~~', '', '# Real'].join('\n')
  expect(outlineOf(quoted).map(entry => entry.path)).toEqual(['Real'])
  expect(degradeHtml('>\n    <!-- strata:name=example -->', []).text).toBe('>\n    <!-- strata:name=example -->')
  expect(degradeHtml('- >\n      <!-- strata:name=example -->', []).text).toBe('- >\n      <!-- strata:name=example -->')
  // A fold keeps its fence's list container: what follows parses as it did unfolded.
  const listed = ['- ~~~html', '  <x/>', '  ~~~', '  ~~~text', '  code', '    ~~~', '', '# Real'].join('\n')
  expect(outlineOf(degradeHtml(listed, []).text).map(entry => entry.path)).toEqual(['Real'])
  expect(degradeHtml(listed, []).text.split('\n')[0]).toBe('- > **html block 1** (1 lines): runs in the web app')
  // An empty bullet sibling opens its item; it is no setext underline.
  const emptySibling = ['- item', '-', '  ~~~html', '  <x/>', '', 'Outside.', '', '# Real'].join('\n')
  expect(outlineOf(emptySibling).map(entry => entry.path)).toEqual(['Real'])
  // A non-breaking space after the hashes makes no heading: the line is prose.
  expect(outlineOf('# Plan\n\n##\u00a0Example\n\nText.').map(entry => entry.path)).toEqual(['Plan'])
  expect(blocksOf('##\u00a0Example').map(block => block.kind)).toEqual(['paragraph'])
  // A table that runs into a quote is no table: drawn as Markdown, its text kept.
  expect(tableLayout('| a | b |\n|---|---|\n| c | d |\n> Important | these | words', 80)).toBe(null)
  // A fence in an HTML comment is the comment's; a heading indented up to three spaces is a heading.
  const commented = '<!--\n```html\nexample\n-->\n\n# Real\n\nVisible text.'
  expect(outlineOf(commented).map(entry => entry.path)).toEqual(['Real'])
  expect(degradeHtml(commented, []).text).toContain('Visible text.')
  expect(outlineOf('# A\n\nA text.\n\n   # B\n\nB text.').map(entry => entry.path)).toEqual(['A', 'B'])
  // A hidden binding marker keeps the block boundary it made.
  const bound = degradeHtml('Intro.\n<!-- strata:name=x -->\n    ![logo](x)', [])
  // In a list too: the marker ends the item, and what follows reads as it did.
  const listBound = degradeHtml('- ~~~text\n  item\n  ~~~\n<!-- strata:name=x -->\n    ![logo](x)', [])
  expect(blocksOf(listBound.text).map(block => block.kind)).toEqual(['code', 'code'])
  // An HTML comment interrupts a list item's paragraph: its literal fence is the comment's.
  const comment = degradeHtml('- item\n<!-- comment\n~~~html\nx\n-->\n\n# Real\n\nVisible text.', [])
  expect(outlineOf(comment.text).map(entry => entry.path)).toEqual(['Real'])
  expect(comment.text).toContain('Visible text.')
  // A one-line HTML block ends a table and is drawn verbatim.
  expect(blocksOf('| Col |\n| --- |\n| data |\n<pre>one | two</pre>').map(block => [block.kind, block.text])).toEqual([
    ['paragraph', '| Col |\n| --- |\n| data |'],
    ['code', '<pre>one | two</pre>'],
  ])
  expect(blocksOf('<pre>![logo](x)</pre>').map(block => shownText(block))).toEqual(['<pre>![logo](x)</pre>'])
  // A line of a non-breaking space is no blank line; a CRLF table is still a table.
  expect(blocksOf('`start\n\u00a0\n![logo](x)\nend`').length).toBe(1)
  expect(tableLayout('| a | b |\r\n|---|---|\r\n| c | d |\r', 80)?.kind).toBe('grid')
  // A nested ordered item's sibling, short of its outer bullet, opens its fence.
  expect(outlineOf('- 1. text\n2. ~~~html\n   # Fake\n      ~~~\n\n# Real').map(entry => entry.path)).toEqual(['Real'])
  // A code span pairs within one block: images in another are named, in their own code span kept.
  expect(blocksOf('`unclosed\n---\n`![logo](x)`').map(block => shownText(block))).toEqual(['`unclosed\n---\n`![logo](x)`'])
  expect(blocksOf('- `a\n- `![logo](x)`').map(block => shownText(block))).toEqual(['- `a\n- `![logo](x)`'])
  // A fence in a nested quote is code, drawn verbatim.
  expect(blocksOf('> > ~~~md\n> > ![logo](x)\n> > ~~~').map(block => [block.kind, shownText(block)])).toEqual([
    ['code', '> > ~~~md\n> > ![logo](x)\n> > ~~~'],
  ])
  // A tab after the quote mark is read by columns; a quoted list fence ends with its item.
  expect(blocksOf('> \t~~~md\n> ![logo](x)\n> ~~~').map(block => block.kind)).toEqual(['code'])
  expect(blocksOf('> > - ~~~\n> > paragraph\n> > ![logo](x)').map(block => shownText(block)).join('\n')).toContain('[image: logo]')
  // A deeper quote begins a block of its own; a quoted item padded five blanks holds indented code.
  expect(blocksOf('> `unclosed\n> > `![logo](x)`').map(block => shownText(block))).toEqual(['> `unclosed\n> > `![logo](x)`'])
  expect(blocksOf('> -     ![logo](x)').map(block => shownText(block))).toEqual(['> -     ![logo](x)'])
  // A link definition is a block of its own (over two lines too); a malformed one is a paragraph's text.
  expect(blocksOf('[a]: x\n`![logo](y)`').map(block => shownText(block))).toEqual(['[a]: x\n`![logo](y)`'])
  expect(runsOn('[a]:\nx\nmore')).toEqual([false, false, false])
  expect(runsOn('[p]: /url(`\na` b')).toEqual([false, true])
  // So within a quote: a heading there is a block of its own.
  expect(blocksOf('> # `unclosed\n> `![logo](x)`').map(block => shownText(block))).toEqual(['> # `unclosed\n> `![logo](x)`'])
  // A separator in a heading's title or a fence's info string is kept as written.
  expect(outlineOf('# A\n\n## B\u2028C\n\nText.').map(entry => entry.path)).toEqual(['A', 'A > B\u2028C'])
  expect(opensFence('```html\u2028uses=sales')?.info).toBe('html\u2028uses=sales')
  // Unclosed image openers and backtick runs cost one pass, not a rescan each.
  // Each shape on its own budget: one pass each, not a rescan.
  const timed = (run: () => unknown): number => {
    const at = Date.now()
    run()
    return Date.now() - at
  }
  expect(timed(() => withoutImages('!['.repeat(100000)))).toBeLessThan(2000)
  expect(timed(() => withoutImages('![a](b "'.repeat(20000)))).toBeLessThan(2000)
  expect(timed(() => withoutImages(Array.from({ length: 4000 }, (_, k) => '`'.repeat(k + 1)).join(' ')))).toBeLessThan(2000)
  expect(timed(() => withoutImages(`${'!['.repeat(28000)}a](${'a'.repeat(28000)}`))).toBeLessThan(2000)
  expect(timed(() => tableCost(`| ${Array.from({ length: 900 }, (_, k) => '`'.repeat(k + 1)).join(' ')} |\n|---|`))).toBeLessThan(2000)
  expect(timed(() => tableCost(`| ${'**a '.repeat(100000)} |\n|---|`))).toBeLessThan(2000)
  expect(timed(() => outlineOf(`# a${' '.repeat(128000)}z`))).toBeLessThan(2000)
  expect(timed(() => headingPathsByLine(`## R\n\nRisk.\n\n#### S\n${'##### S\n'.repeat(100000)}`, ['P > R', 'P > O > S']))).toBeLessThan(2000)
  expect(timed(() => headingPathsByLine(Array.from({ length: 60000 }, (_, k) => `## S${k}\n\ntext`).join('\n\n'), Array.from({ length: 60000 }, (_, k) => `D > S${k}`)))).toBeLessThan(2000)
  expect(timed(() => headingPathsByLine(`## S\n${'#### T\n'.repeat(20000)}`, ['D > S', ...Array.from({ length: 20000 }, () => 'D > S > X > T')]))).toBeLessThan(2000)
  expect(timed(() => rebaseOutline(outlineOf(`## Root\n${[0, 1].map(() => Array.from({ length: 48000 }, (_, k) => `#### S${k}`).join('\n')).join('\n')}`), ['P > Root', ...Array.from({ length: 48000 }, (_, k) => `Other > Group > S${k}`)]))).toBeLessThan(2000)
  expect(timed(() => headingPathsByLine(`## Root\n${Array.from({ length: 64000 }, (_, k) => `#### S${k}`).join('\n')}\n${Array.from({ length: 64000 }, (_, k) => `#### S${k}\n#### T`).join('\n')}`, ['P > Root', ...Array.from({ length: 64000 }, (_, k) => [`A > S${k}`, `B${k} > T`]).flat()]))).toBeLessThan(2000)
  expect(timed(() => tableCost(`| ${Array.from({ length: 64000 }, (_, k) => `h${k}`).join(' | ')} |\n|${'-|'.repeat(64000)}\n${'| x |\n'.repeat(64000)}`))).toBeLessThan(2000)
  expect(timed(() => tableCost(`| a |\n|---|\n| a${'_'.repeat(128000)}b |`))).toBeLessThan(2000)
  expect(timed(() => tableCost(`| a |\n|---|\n| a${'*'.repeat(128000)}b |`))).toBeLessThan(2000)
  expect(timed(() => tableCost(`a | b\n${' '.repeat(3072)}---${' '.repeat(3072)}x`))).toBeLessThan(2000)
  expect(timed(() => tableCost(`a | b\n${'- '.repeat(64000)}x`))).toBeLessThan(2000)
  // An underscore run inside a word is literal whole, whatever letters (astral ones too) stand beside it.
  const runs = tableLayout('| a |\n|---|\n| my___internal___name |\n| \u{1d465}__internal__\u{1d466} |', 80)
  expect(runs !== null && runs.kind === 'grid' ? runs.rows : []).toEqual(['my___internal___name', '\u{1d465}__internal__\u{1d466}'])
  // An escaped bang before a bracket leaves an image inside it an image (as the reference parser has it).
  expect(withoutImages('\\![![](])!!')).toBe('\\![[image]!!')
  expect(blocksOf(bound.text).map(block => [block.kind, shownText(block)])).toEqual([
    ['paragraph', 'Intro.'],
    ['code', '    ![logo](x)'],
  ])
  // A fence-shaped line four columns past the container it reaches runs the paragraph on.
  const runOnFence = ['123. inner', '    ~~~', '', '     ~~~html', '     <x/>', '     ~~~'].join('\n')
  expect(degradeHtml(runOnFence, []).fences.length).toBe(1)
  // A list fence's source is drawn verbatim, its images included.
  const listFence = blocksOf('- ~~~md\n  ![logo](x)\n  ~~~')
  expect(listFence.map(block => shownText(block))).toEqual(['- ~~~md\n  ![logo](x)\n  ~~~'])
  // A delimiter row indented four columns makes no table, with or without a leading pipe.
  expect(tableLayout('a | b\n    --- | ---\nc | d', 80)).toBe(null)
  expect(tableLayout('a | b\n\t--- | ---\nc | d', 80)).toBe(null)
})
