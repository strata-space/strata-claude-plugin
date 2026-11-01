import type { CommandRunInput, PromptAutocompleteInput, PromptComposeInput, PromptSubmitInput, ToolCallArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { deploymentOf, mentionSpans, plainSnippet, quoteForPrompt } from './strata'

test('a search snippet reads as text: match markers dropped, entities turned into characters', () => {
  expect(plainSnippet('Lighthouse <<rollout>> plan H3 &rarr; H2 &amp; <b>more</b>')).toBe('Lighthouse rollout plan H3 → H2 & more')
  expect(plainSnippet('&#x2192; &#8594; &#1; &#9999999; &unknown;')).toBe('→ → &#1; &#9999999; &unknown;')
})

test('a deployment is named the same by the API and the web app, with its port, and not at all by what is not a URL', async () => {
  expect(deploymentOf('https://api.beta.strata.space')).toBe('beta.strata.space:443')
  expect(deploymentOf('https://app.beta.strata.space/w/acme/documents/doc_1/plan')).toBe('beta.strata.space:443')
  expect(deploymentOf('https://api.strata.space')).toBe('strata.space:443')
  expect(deploymentOf('https://user@API.strata.space:8443/')).toBe('strata.space:8443')
  expect(deploymentOf('http://localhost:18001')).toBe('localhost:18001')
  expect(deploymentOf('http://localhost:19001')).not.toBe(deploymentOf('http://localhost:18001'))
  expect(deploymentOf('http://[::1]:18001/x')).toBe('[::1]:18001')
  expect(deploymentOf('http://[::1]')).toBe('[::1]:80')
  expect(deploymentOf('http://[::1')).toBe(null)
  expect(deploymentOf('https://api.strata.space:port')).toBe(null)
  expect(deploymentOf('ftp://api.strata.space')).toBe(null)
  expect(deploymentOf('not a url')).toBe(null)
  expect(deploymentOf('')).toBe(null)
})

const READ = JSON.stringify({
  documentId: 'doc_1',
  title: 'Plan',
  format: 'markdown',
  documentVersion: 4,
  content: '# Plan\n\nIntro.\n\n## Owners\n\nNone yet.\n',
})

/** A system-prompt render's input, whole, as the test kit asks for one. */
const COMPOSE: PromptComposeInput = {
  model: 'claude-fable-5-1',
  promptModel: 'claude-fable-5-1',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
}

test('an @strata: mention reads the document into the prompt and names it in the text', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const sent = await $.prompt.submit({ text: 'Summarize @strata:doc_1 in two lines.' } as PromptSubmitInput)
  expect(sent.text).toBe('Summarize the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool) in two lines.')
  expect(sent.context?.join('\n')).toContain('None yet.')
  expect(sent.context?.join('\n')).toContain('revision 4')
  expect(sent.context?.join('\n')).toContain('mcp__strata__read_document')
})

test('a mention inside a quoted line, or in a prompt a plugin submitted, is left as text', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let reads = 0
  on('mcp.call', () => {
    reads += 1
    return { value: { content: [{ type: 'text', text: READ }], isError: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const quoted = await $.prompt.submit({
    text: 'About this passage:\n\n> See @strata:doc_1 for the plan.\n\nWhat does it mean?',
  } as PromptSubmitInput)
  expect(quoted.text).toContain('> See @strata:doc_1 for the plan.')
  expect(reads).toBe(0)
  const byPlugin = await $.prompt.submit({
    text: 'Summarize @strata:doc_1',
    origin: { kind: 'plugin', name: 'other' },
  } as unknown as PromptSubmitInput)
  expect(byPlugin.text).toBe('Summarize @strata:doc_1')
  expect(reads).toBe(0)
})

test('a prompt without a mention passes untouched', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const sent = await $.prompt.submit({ text: 'Hello.' } as PromptSubmitInput)
  expect(sent.text).toBe('Hello.')
})

test('a note a hook beneath dropped leaves the document unrecorded as read', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'unexpected' }], isError: true } }
  })
  // A hook beneath that strips the context, then one that passes it on.
  let isDropping = true
  on('prompt.submit', (_, e) => ({ text: e.text, context: isDropping ? [] : e.context }))
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const dropped = await $.prompt.submit({ text: 'Summarize @strata:doc_1.' } as PromptSubmitInput)
  expect(dropped.text).toBe('Summarize the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool).')
  const bare = await $.prompt.compose(COMPOSE)
  expect(bare.sections.map(section => section.text).join('\n')).not.toContain('doc_1')

  isDropping = false
  await $.prompt.submit({ text: 'Again: @strata:doc_1.' } as PromptSubmitInput)
  const noted = await $.prompt.compose(COMPOSE)
  expect(noted.sections.map(section => section.text).join('\n')).toContain('"Plan" (doc_1, via mcp__strata__read_document) read at v4')
})

test('the composed note names the pane\'s document only while the person sees the pane', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  // The engine's record of the pane: listed once opened, placed as the terminal allows.
  let isListed = false
  let isPlaced = true
  on('ui.open', () => {
    isListed = true
    return isPlaced ? { value: { isPlaced: true as const } } : { value: { isPlaced: false as const, reason: 'narrow' } }
  })
  on('ui.close', () => {
    isListed = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: isListed ? [{ id: 'strata-doc', title: 'Plan', isShown: true, isFocused: false, isPlaced }] : [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }))
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__strata__read_document', documentId: 'doc_1' } as unknown as ToolCallArgs)
  const up = (await $.prompt.compose(COMPOSE)).sections.map(section => section.text).join('\n')
  expect(up).toContain('The person\'s Strata pane shows "Plan"')
  // Closed, the pane shows the person nothing: the ledger's row stays, the referent goes.
  await $.command.run({
    command: 'strata',
    args: 'close',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  } as unknown as CommandRunInput)
  const down = (await $.prompt.compose(COMPOSE)).sections.map(section => section.text).join('\n')
  expect(down).not.toContain('pane shows')
  expect(down).toContain('"Plan" (doc_1, via mcp__strata__read_document) read at v4')
  // Opened again on a terminal too narrow to place it, the pane waits unseen: no referent either.
  isPlaced = false
  await $.command.run({
    command: 'strata',
    args: 'doc',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  } as unknown as CommandRunInput)
  const waiting = (await $.prompt.compose(COMPOSE)).sections.map(section => section.text).join('\n')
  expect(waiting).not.toContain('pane shows')
  // Placed, it is seen.
  isPlaced = true
  const placed = (await $.prompt.compose(COMPOSE)).sections.map(section => section.text).join('\n')
  expect(placed).toContain('The person\'s Strata pane shows "Plan"')
})

test('a document opened from the explorer, which the model never read, is named as the pane\'s all the same', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'strata-doc', title: 'Notes', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') {
      const notes = JSON.stringify({ documentId: 'doc_2', title: 'Notes', format: 'markdown', documentVersion: 3, content: '# Notes\n\nOther.\n' })
      return { value: { content: [{ type: 'text', text: notes }], isError: false } }
    }
    if (e.tool === 'find') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ documents: [{ documentId: 'doc_2', title: 'Notes' }] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
  })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const explorer = await $.ui.mount({
    plugin: 'strata',
    component: 'Pane',
    requestId: 'strata-space',
    surface: 'terminal',
    props: { title: 'Strata', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as const)
  await explorer.input({ key: 'search', text: 'notes' })
  await explorer.redraw()
  await explorer.press({ key: 'open0' })
  await clock.settle()
  const note = (await $.prompt.compose(COMPOSE)).sections.map(section => section.text).join('\n')
  expect(note).toContain('The person\'s Strata pane shows "Notes" (doc_2')
  expect(note).toContain('none read yet')
  await explorer.unmount()
})

test('a search the server refused is asked again at the next typing', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The first search is refused; the one after answers.
  let searches = 0
  on('mcp.call', (_, e) => {
    if (e.tool === 'find') {
      searches += 1
      if (searches === 1) return { value: { content: [{ type: 'text', text: 'refused' }], isError: true } }
      return { value: { content: [{ type: 'text', text: JSON.stringify({ documents: [{ documentId: 'doc_2', title: 'Notes' }] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
  })
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The kit raises the typeahead's event through `$.prompt.autocomplete`, which its types do not yet declare.
  const prompt = $.prompt as unknown as { autocomplete: (input: PromptAutocompleteInput) => Promise<{ suggestions: readonly unknown[] }> }
  const typing = { text: '@strata:not', cursor: 11, token: '@strata:not', start: 0 } as PromptAutocompleteInput
  const refused = await prompt.autocomplete(typing)
  expect(refused.suggestions.length).toBe(0)
  // Not kept as an empty answer: the same typing asks again, and is offered the document.
  const offered = await prompt.autocomplete(typing)
  expect(searches).toBe(2)
  expect(offered.suggestions.length).toBe(1)
})

test('a mention inside code, a fence, or an address is left as text; one of its own beside them is read', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let reads = 0
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') reads += 1
    if (e.tool === 'list_comments') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: READ }], isError: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const literals = [
    'Explain this literal: `@strata:doc_1`.',
    'Or this one: ``a `@strata:doc_1` b``.',
    'Explain this log:\n```text\n@strata:doc_1\n```\nand this address https://example.org/@strata:doc_1 too.',
    'Mail me at me@strata:doc_1 and see\n~~~\n@strata:doc_1\n~~~',
    // A longer fence holds a shorter one's line; a fence never closed holds the rest.
    'A long fence:\n````\n```\n@strata:doc_1\n```\n````\nand one left open:\n```\n@strata:doc_1',
    // A code span across lines, and one whose closing run differs in length.
    'A span `across\n@strata:doc_1\nlines` here.',
    'A file @strata:doc_1.json, a host @strata:doc_1.example.org, a path @strata:doc_1/x, a word @strata:doc_1é.',
    'Indented code:\n\n    @strata:doc_1\n\tand @strata:doc_1 too',
    // A space then a tab reaches the fourth column too; a letter or a digit
    // past the basic plane (two code units) is more of the word all the same.
    'Tabbed code:\n\n \t@strata:doc_1',
    'A long letter @strata:doc_1𐐀, a long digit @strata:doc_1𝟘, and a name @strata:doc_1.𐐀 too.',
    // An address with marks around a mention inside it, and a link's destination.
    'Explain https://example.org/(@strata:doc_1) please, and <https://example.org/?q=(@strata:doc_1)> too.',
    'See [the plan](@strata:doc_1) and [another](https://example.org/@strata:doc_1 "title").',
    // A destination with parentheses inside it, balanced or escaped, and one never closed; an address holding a code span.
    'Explain [plan](folder(part)/(@strata:doc_1)) and [this](a\\)(@strata:doc_1)) too.',
    'Explain [broken](folder(part @strata:doc_1 and on',
    'Explain https://example.org/`part`/(@strata:doc_1).',
    // A title in quotes, with a parenthesis inside it; an apostrophe in a destination, which is no title.
    'Explain [link](https://example.org "a) @strata:doc_1") and [other](https://example.org \'b) @strata:doc_1\').',
    "Explain [link](a'('b)/(@strata:doc_1)) please.",
    // A destination in angle brackets, with parentheses inside it, after the blanks Markdown allows.
    'Explain [link](<folder/a)(@strata:doc_1>) please.',
    'Explain [link](  <folder/a)(@strata:doc_1>) and [other](\n<folder/b)(@strata:doc_1>) please.',
    // A link reference definition, its destination and title, on one line or the next.
    '[p]: <folder/(@strata:doc_1)>\n[q]: folder/(@strata:doc_1) "see @strata:doc_1"\n\nSee [p] and [q].',
    '[plan]:\n  <folder/(@strata:doc_1)>\n\nSee [plan].',
    '[plan]: folder/plan\n  "See @strata:doc_1"\n\nSee [plan].',
    // A title running on over lines, in quotes or in parentheses.
    '[p]: /url "first line\nSee @strata:doc_1"\n[q]: /url (first line\nSee @strata:doc_1)\n\nSee [p] and [q].',
    // A label with an escaped bracket; CRLF line ends before the title, before the destination, and around a fence.
    '[p\\]]: /url "See @strata:doc_1"\n\nSee [p\\]].',
    '[p]: /url\r\n  "See @strata:doc_1"\r\n\r\nSee [p].',
    '[p]:\r\n  <folder/(@strata:doc_1)>',
    '```\r\n@strata:doc_1\r\n```\r\nand `@strata:doc_1`',
    // An escaped backtick opens no code span: the real span after it holds the mention.
    'Explain \\` and `literal @strata:doc_1`.',
    // A fence opening a list item, closed at the item's indentation; a numbered item too.
    '- ```text\n  @strata:doc_1\n  ```\n1. ~~~\n   @strata:doc_1\n   ~~~',
    // A fence of its own, indented: a run indented four spaces does not close it.
    '   ~~~text\n    ~~~\n@strata:doc_1\n   ~~~',
    // A fence in a list item ends with the item: the line outside is read anew, and a fence of its own opens after it.
    '- ```\n  code\n\nOutside.\n\n```\n@strata:doc_1\n```',
    // A line running a quoted paragraph on is the quote's; a quote in a list item is a quote.
    '> Explain this literal:\n@strata:doc_1',
    '- > literal @strata:doc_1\n1. > literal @strata:doc_1\n   run-on @strata:doc_1',
    // A backtick left open before a heading pairs with nothing past it: the code span after the heading is one.
    '`unclosed\n# Heading\n`literal @strata:doc_1`',
    // A table is left as typed: a mention in a cell is an example.
    '| Tick | Literal |\n|---|---|\n| ` | `literal @strata:doc_1` |',
    // A table interrupting prose, no blank line between, is held too.
    'Examples:\n| Tick | Literal |\n|---|---|\n| ` | `literal @strata:doc_1` |',
    // A single-column table with a pipe-free delimiter row: its rows are held all the same.
    '| Literal |\n---\n| ` |\n| `literal @strata:doc_1` |',
    // A paragraph holding a pipe is held whole: a pipe line inside a code span, a table without leading pipes.
    'Explain `a\n| b\n@strata:doc_1\nc`',
    'Literal @strata:doc_1 |\n---\nexample |',
    // A table's body rows need no pipe: they run on to the next blank line, held with it.
    '| Literal |\n---\n@strata:doc_1',
    // An empty list item is a container: the fence on the lines after it is the item's.
    '-\n    ~~~\n  @strata:doc_1\n    ~~~',
    '- example\n-\n    ~~~\n  @strata:doc_1\n    ~~~',
    '- -\n      ~~~\n    @strata:doc_1\n      ~~~',
    // Opening marks inside a word make a path, not a mention in parentheses.
    'Explain /tmp/(@strata:doc_1).md',
    'Explain the relative path (@strata:doc_1)/README.md and (@strata:doc_1).md',
    'Explain (@strata:doc_1)./README.md',
    // A tab past an item's column is measured from where it stands: the fence is the item's.
    '- Example:\n\n  \t~~~text\n  @strata:doc_1\n  \t~~~',
    // An ordered sibling of an enclosing item, under a nested bullet, opens its fence.
    '1. - text\n2. ~~~text\n   @strata:doc_1\n   ~~~',
    // The block scan's reading has the last word: indented code in an empty item, a fence in a sibling item, a quote's fence.
    '2. two\n-\n      @strata:doc_1',
    '- item\n2. ~~~\n   @strata:doc_1\ntext\n~~~',
    '-\n\n   ~~~\n@strata:doc_1\n2. ~~~',
    '> ~~~\n> @strata:doc_1\n> ~~~',
    // A code span pairs within one block: a list of another kind or delimiter after it is a block of its own.
    '- `a\n2. `literal @strata:doc_1`',
    // A label of blanks makes no definition: the code span runs on over its lines.
    '[ ]: /url`\n@strata:doc_1\nz`',
    // A definition's destination on the line after its label is an address, not prose.
    '* `a\n-\n[a]:\n  @strata:doc_1',
    // A label of a no-break space, or a bare destination with an escaped blank, makes no definition either.
    '[\u00a0]: /url`\n@strata:doc_1\nz`',
    '[p]: /url\\ `\n@strata:doc_1\nz`',
    '[p]: /url\u007f`\n@strata:doc_1\nz`',
    '[p]: /url\\\u007f`\n@strata:doc_1\nz`',
    // A label over 999 characters as written (escapes counting two) makes no definition.
    `[${'\\*'.repeat(500)}]: /url\`\n@strata:doc_1\nz\``,
    '1. `a\n2) `literal @strata:doc_1`',
    '- `a\n* `literal @strata:doc_1`',
    // A Unicode line or paragraph separator is text to the block scans: a quote, a fence, a list holding one is still one.
    '\n> See \u2028 @strata:doc_1.\n\n',
    '~~~\u2029\n@strata:doc_1\n~~~',
    '> \u2029\n> @strata:doc_1',
    // A bare carriage return ends a line: the fence holds the mention.
    '~~~\r@strata:doc_1\r~~~',
    // A quote of a non-breaking space has text: the line after it runs it on.
    '> \u00a0\n@strata:doc_1',
    // A list item of a non-breaking space is an item, not an empty one: its fence is the item's.
    'Intro.\n- \u00a0\n    ~~~\n  @strata:doc_1\n    ~~~',
    // A sibling item of an ordered list begins a block of its own, whatever its number; a line indented to the item's text, numbered otherwise than 1, runs it on.
    '1. `unclosed\n2. `literal @strata:doc_1`',
    '1. `a\n   2. @strata:doc_1`',
    // An empty sibling item (its marker alone) ends the item's paragraph too, and opens none.
    '1. `unclosed\n2.\n`literal @strata:doc_1`',
    '- `unclosed\n-\n`literal @strata:doc_1`',
    // An item numbered 1 with zeros before it interrupts a paragraph as 1 does.
    '`unclosed\n01. `literal @strata:doc_1`',
    // A list item goes on past a blank line where the lines stay indented to its text: a fence there is the item's, a mention in it literal.
    '- Example:\n\n    ~~~text\n  @strata:doc_1\n    ~~~',
    // An item a quote begins is a container all the same; an inner item ending gives way to the outer one, whose fence this is.
    '- > quote\n\n    ~~~text\n  @strata:doc_1\n    ~~~',
    '- outer\n\n  10. > inner\n\n    ~~~text\n  @strata:doc_1\n    ~~~',
    // Two items begun on one line (by a quote, a fence, a paragraph): each a container; the outer holds the fence after the inner ends.
    '- 10. > inner\n\n    ~~~text\n  @strata:doc_1\n    ~~~',
    '- - ```\n    @strata:doc_1\n    ```',
    '- 1. para\n\n  ~~~text\n  @strata:doc_1\n  ~~~',
    // Columns as Markdown counts them: a tab after a nested marker reaches the next tab stop from where it stands; a tab crossing a container's column leaves its remaining columns (indented code here).
    '- outer\n\n  -\t~~~\n    @strata:doc_1\n    ~~~',
    '1. first\n\n\t   @strata:doc_1',
    // A paragraph inside an item (after a blank line) is that item's: a sibling item ends it.
    '1. first\n\n   `unclosed\n2. `literal @strata:doc_1`',
    // A heading begun in an item is a block of its own; five blanks after a marker leave indented code.
    '- # `unclosed\n  `literal @strata:doc_1`',
    '-     @strata:doc_1',
    // A tab among five columns of blanks after a marker pads it by one column, the rest indented code.
    '-\t  @strata:doc_1',
    // A thematic break of spaced marks begins no items: the indented line after it is code.
    '- - -\n\n    @strata:doc_1',
    // A marker that cannot interrupt the paragraph runs it on, a heading mark behind it or not.
    '`a\n2. # @strata:doc_1\nz`',
    // A definition beginning a list item.
    '- [p]: /url "see @strata:doc_1"',
    // A quote behind a marker that cannot interrupt the paragraph is the paragraph's text: the code span runs on.
    '`a\n2. >\n@strata:doc_1\nz`',
    // A fence's padding is counted in columns: a tab among five blanks after the marker leaves indented code, and the fence opens on the next line.
    '-\t  ~~~\n  ~~~\n  @strata:doc_1\n  ~~~',
    // A definition is a block of its own: a backtick in its title pairs with nothing in the prose after it.
    '[p]: /url "backtick `"\nExplain `literal @strata:doc_1`',
    // A backtick fence whose info string holds a backtick is no fence: the line runs the paragraph on, its last backtick closing the span.
    '`a\n```bad`\n`literal @strata:doc_1`',
    // A definition whose destination Markdown refuses (a parenthesis unbalanced) is prose, its backtick pairing on.
    '[p]: /url(`\na` then `literal @strata:doc_1`',
    // So are one with a bracket inside its bracketed destination, one with a bracket in its label, and one with a parenthesis in its parenthesized title.
    '[p]: <a<b`>\na` then `literal @strata:doc_1`',
    '[p[q]: /url `\na` then `literal @strata:doc_1`',
    '[p]: /url (a (b `)\na` then `literal @strata:doc_1`',
    // A setext underline of hyphens, too few for a thematic break, ends the paragraph as its heading; one short of a list item's column runs its paragraph on.
    '`a\n--\n`literal @strata:doc_1`',
    '- `a\n--\nx` then `literal @strata:doc_1`',
    // A title on the line after the destination, followed by more, is dropped: the definition ends with its destination, and that line is prose.
    '[p]: /url`\n"title" `literal @strata:doc_1`',
    // A line of a non-breaking space is no blank line: the code span runs on through it.
    '`start\n \n@strata:doc_1\nend`',
    // The line after a definition is read anew: indented, it is code. A non-breaking space is part of a bare destination.
    '[p]: /url\n    @strata:doc_1',
    '[p]: /url `\n`literal @strata:doc_1`',
    // A definition beginning a list item after another definition makes that item a container: the fence after it is the item's.
    '[p]: /url\n- [q]: /url\n    ~~~text\n  @strata:doc_1\n    ~~~',
    // A title runs no further than its block: a heading ends it unclosed, so the line is prose, its backtick pairing on.
    '[p]: /url "title\n# Heading\n`"\na` then `literal @strata:doc_1`',
    // A label of a thousand characters is none: the line is prose, its backtick pairing on.
    `[${'a'.repeat(1000)}]: /url\`\n@strata:doc_1\nend\``,
    // A label running over two lines is a label: the definition is a block of its own, its title's backtick pairing with nothing after.
    '[p\nq]: /url "backtick `"\nExplain `literal @strata:doc_1`',
    // An indented line is code before it is anything else: no definition begins in it.
    '    [p\nq`]: /url\n@strata:doc_1\nend`',
    // An HTML block holds raw lines: a comment to its end marker, a block element to a blank line.
    '<!-- ` -->\nExplain `literal @strata:doc_1`',
    '<div>\n@strata:doc_1\n</div>',
    // An inline tag begun before a backtick takes the text to its end: a backtick in its attribute opens nothing, and a mention in one is an attribute's.
    'Explain <span title="`">x</span>, then `literal @strata:doc_1`.',
    'See <a title="@strata:doc_1">it</a>',
    // A bracket a backslash escapes opens no tag: the backticks around the mention make a code span.
    'Explain \\<span title="`"> @strata:doc_1 `.',
    // Nor does a tag whose attribute a non-breaking space sets apart: ASCII whitespace alone does.
    'Explain <span title="`"> @strata:doc_1 `.',
    // A short comment is whole at its own bracket: it reaches no later `-->`, and the backticks after it pair.
    'Explain <!--> ` --> @strata:doc_1 `.',
    // An autolink in angle brackets, whatever its scheme, a bare mail address and a bare `www.` address are addresses.
    'Explain <mailto:me@example.org?subject=(@strata:doc_1)>.',
    'Explain mailto:me@example.org?subject=(@strata:doc_1) too.',
    'Explain www.example.org/(@strata:doc_1) please.',
    // An autolink is a raw span like a tag: a backtick in it opens nothing, and the code span after it holds its mention.
    'Explain <mailto:me@example.org?x=`> and `literal @strata:doc_1`.',
    // An autolink runs to an ASCII blank alone: a non-breaking space is part of it, before a mention or a backtick.
    'Explain <https://example.org/ @strata:doc_1>.',
    'Explain <https://example.org/ `> and `literal @strata:doc_1`.',
  ]
  for (const text of literals) {
    const sent = await $.prompt.submit({ text } as PromptSubmitInput)
    expect(sent.text).toBe(text)
    expect(sent.context ?? []).toEqual([])
  }
  expect(reads).toBe(0)

  // One standing on its own beside an address is read, and the address stays.
  const beside = await $.prompt.submit({
    text: 'Compare https://example.org/(@strata:doc_1) with @strata:doc_1.',
  } as PromptSubmitInput)
  expect(beside.text).toBe(
    'Compare https://example.org/(@strata:doc_1) with the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool).',
  )
  expect(reads).toBe(1)
  // One after a link whose destination holds parentheses is read.
  const after = await $.prompt.submit({ text: 'See [plan](folder(part)) then @strata:doc_1' } as PromptSubmitInput)
  expect(after.text).toBe(
    'See [plan](folder(part)) then the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)',
  )
  expect(reads).toBe(2)
  // A link opener inside code is literal: a mention after it is read.
  const opener = await $.prompt.submit({ text: 'Explain `](`, then summarize @strata:doc_1.' } as PromptSubmitInput)
  expect(opener.text).toBe(
    'Explain `](`, then summarize the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool).',
  )
  expect(reads).toBe(3)
  // An apostrophe in a destination opens no title: the link closes, and a mention after it is read.
  const apostrophe = await $.prompt.submit({ text: "See [it](https://example.org/it's) then @strata:doc_1" } as PromptSubmitInput)
  expect(apostrophe.text).toBe(
    "See [it](https://example.org/it's) then the Strata document \"Plan\" (doc_1, read with the mcp__strata__read_document tool)",
  )
  expect(reads).toBe(4)
  // A destination in angle brackets closes at its bracket: a mention after the link is read.
  const bracketed = await $.prompt.submit({ text: 'See [it](<a)b>) then @strata:doc_1' } as PromptSubmitInput)
  expect(bracketed.text).toBe('See [it](<a)b>) then the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(5)
  // One standing on its own is read, and the literal beside it stays.
  const mixed = await $.prompt.submit({ text: 'Compare `@strata:doc_1` with (@strata:doc_1).' } as PromptSubmitInput)
  expect(mixed.text).toBe('Compare `@strata:doc_1` with (the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)).')
  expect(reads).toBe(6)
  expect(mixed.context?.join('\n')).toContain('None yet.')
  // A definition's opener inside a code span is literal: the quote in it opens no title, and a mention after the span is read.
  const defined = await $.prompt.submit({ text: '`example\n[p]: /url "`\nThen summarize @strata:doc_1.' } as PromptSubmitInput)
  expect(defined.text).toBe(
    '`example\n[p]: /url "`\nThen summarize the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool).',
  )
  expect(reads).toBe(7)
  // A fence opening a list item closes at the item's indentation: a mention in the next item is read.
  const listed = await $.prompt.submit({ text: '- ```text\n  @strata:doc_1\n  ```\n- then @strata:doc_1' } as PromptSubmitInput)
  expect(listed.text).toBe(
    '- ```text\n  @strata:doc_1\n  ```\n- then the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)',
  )
  expect(reads).toBe(8)
  // An escaped bracket before a parenthesis opens no link: the mention after it is read.
  const escaped = await $.prompt.submit({ text: 'See \\](then @strata:doc_1' } as PromptSubmitInput)
  expect(escaped.text).toBe('See \\](then the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(9)
  // A tab after a list marker reaches the next tab stop: the item's text starts at column four, and a close seven blanks in closes the fence.
  const tabbed = await $.prompt.submit({ text: '-\t~~~text\n    code\n       ~~~\nthen @strata:doc_1' } as PromptSubmitInput)
  expect(tabbed.text).toBe('-\t~~~text\n    code\n       ~~~\nthen the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(10)
  // A line outside the list item ends the fence in it, and is prose of its own.
  const outside = await $.prompt.submit({ text: '- ```\n  code\n\nOutside @strata:doc_1' } as PromptSubmitInput)
  expect(outside.text).toBe('- ```\n  code\n\nOutside the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(11)
  // A list item begins a block of its own after a quote: no lazy run-on.
  const interrupted = await $.prompt.submit({ text: '> quoted\n- @strata:doc_1' } as PromptSubmitInput)
  expect(interrupted.text).toBe('> quoted\n- the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(12)
  // A heading's text is prose of the person's; a list item is a block of its own, so a backtick left open before it pairs with nothing in it.
  const headed = await $.prompt.submit({ text: '# See @strata:doc_1\n`a\n- b` @strata:doc_1' } as PromptSubmitInput)
  expect(headed.text).toBe(
    '# See the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)\n`a\n- b` the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)',
  )
  expect(reads).toBe(13)
  // An item of another delimiter, not numbered 1, runs the item's paragraph on: the span closes in it, and the mention after is read.
  const sibling = await $.prompt.submit({ text: '1. `a\n2) b` @strata:doc_1' } as PromptSubmitInput)
  expect(sibling.text).toBe('1. `a\n2) b` the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(14)
  // A nested item numbered 1, indented to the item's text, interrupts it: a backtick left open above pairs with nothing in it.
  const nested = await $.prompt.submit({ text: '1. `a\n   1. b` @strata:doc_1' } as PromptSubmitInput)
  expect(nested.text).toBe('1. `a\n   1. b` the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(15)
  // An empty item of another list, short of the item's column, begins a list of its own (as the reference parser has it):
  // no span runs from the item into the text after, which pairs its own backticks; the mention past them is read.
  const other = await $.prompt.submit({ text: '- `a\n*\n`b` @strata:doc_1' } as PromptSubmitInput)
  expect(other.text).toBe('- `a\n*\n`b` the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(16)
  // A heading begun in an item is prose of the person's too.
  const itemHeading = await $.prompt.submit({ text: '- # See @strata:doc_1' } as PromptSubmitInput)
  expect(itemHeading.text).toBe('- # See the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(17)
  // A thematic break inside an item leaves the item a container: a heading indented to it after a blank line is prose.
  const breakHeading = await $.prompt.submit({ text: '1. - - -\n\n   # See @strata:doc_1' } as PromptSubmitInput)
  expect(breakHeading.text).toBe('1. - - -\n\n   # See the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(18)
  // Prose right after a definition, no blank line between, is prose of its own.
  const afterDefinition = await $.prompt.submit({ text: '[p]: /url "t"\nExplain @strata:doc_1' } as PromptSubmitInput)
  expect(afterDefinition.text).toBe('[p]: /url "t"\nExplain the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(19)
  // A list item right after a definition is a block of its own, its text prose.
  const listAfterDefinition = await $.prompt.submit({ text: '[p]: /url\n- then @strata:doc_1' } as PromptSubmitInput)
  expect(listAfterDefinition.text).toBe('[p]: /url\n- then the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(20)
  // Many definitions in one block are read each at its own offset, not the block over again for each.
  const many = Array.from({ length: 20000 }, (_, i) => `[p${String(i)}]: /url`).join('\n')
  const manyDefinitions = await $.prompt.submit({ text: `${many}\nthen @strata:doc_1` } as PromptSubmitInput)
  expect(manyDefinitions.text).toBe(`${many}\nthen the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)`)
  expect(reads).toBe(21)
  // A raw text element ends on the line of its closing tag: the line after is prose.
  const afterPre = await $.prompt.submit({ text: '<pre>\n@strata:doc_1\n</pre>\nthen @strata:doc_1' } as PromptSubmitInput)
  expect(afterPre.text).toBe('<pre>\n@strata:doc_1\n</pre>\nthen the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(22)
  // An HTML block in a list item ends with the item: the line outside it is prose.
  const afterItemHtml = await $.prompt.submit({ text: '- <div>\n  example\n  </div>\nRead @strata:doc_1' } as PromptSubmitInput)
  expect(afterItemHtml.text).toBe('- <div>\n  example\n  </div>\nRead the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(23)
  // A tag in a code span is text, and a mention after the span is read.
  const tagInCode = await $.prompt.submit({ text: 'Use `<b title="`">` then @strata:doc_1' } as PromptSubmitInput)
  expect(tagInCode.text).toBe('Use `<b title="`">` then the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(24)
  // A mention beside a bare `www.` address is its own.
  const besideWww = await $.prompt.submit({ text: 'See www.example.org then @strata:doc_1' } as PromptSubmitInput)
  expect(besideWww.text).toBe('See www.example.org then the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)')
  expect(reads).toBe(25)
  // Sentence punctuation after one, a backtick never closed before one, and
  // a list item or a line of its own around one leave it a mention.
  const prose = await $.prompt.submit({
    text: 'Unclosed ` then @strata:doc_1? Yes: @strata:doc_1.\n- @strata:doc_1\n@strata:doc_1',
  } as PromptSubmitInput)
  const named = 'the Strata document "Plan" (doc_1, read with the mcp__strata__read_document tool)'
  expect(prose.text).toBe(`Unclosed \` then ${named}? Yes: ${named}.\n- ${named}\n${named}`)
  expect(reads).toBe(26)
})

test('a Strata search the model ran names the server a mention typed after it reads through', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'strata' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const servers: string[] = []
  on('mcp.call', (_, e) => {
    if (e.tool === 'read_document') {
      servers.push(String((e as { server?: string }).server))
      return { value: { content: [{ type: 'text', text: READ }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ comments: [] }) }], isError: false } }
  })
  on('tool.call', (_, e) =>
    String(e.tool) === 'mcp__beta__find'
      ? { result: {}, text: JSON.stringify({ results: [{ documentId: 'doc_shared', title: 'Shared' }] }) }
      : { result: {}, text: JSON.stringify({ results: [{ id: 'file-1', title: 'Not a document' }] }) },
  )
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__beta__find', query: 'shared' } as unknown as ToolCallArgs)
  // Another server's `find`, with no Strata document in its answer, names nothing.
  await $.tool.call({ tool: 'mcp__other__find', query: 'x' } as unknown as ToolCallArgs)
  await $.prompt.submit({ text: 'Summarize @strata:doc_shared.' } as PromptSubmitInput)
  expect(servers).toEqual(['beta'])
})

test('a passage quoted into the prompt keeps every line behind the quote mark', async () => {
  expect(mentionSpans(quoteForPrompt('Intro.\r\r@strata:doc_2'))).toEqual([])
  expect(mentionSpans(quoteForPrompt('Intro.\r\n\r\n@strata:doc_2'))).toEqual([])
  expect(quoteForPrompt('A\rB')).toBe('\n> A\n> B\n\n')
})

test('backtick runs of many lengths and unclosed tags cost one pass', async () => {
  // Each shape on its own budget.
  const timed = (run: () => unknown): number => {
    const at = Date.now()
    run()
    return Date.now() - at
  }
  expect(timed(() => mentionSpans(`${Array.from({ length: 3000 }, (_, k) => '`'.repeat(k + 1)).join(' ')} @strata:doc_1`))).toBeLessThan(2000)
  expect(timed(() => mentionSpans(`${'<a '.repeat(30000)}\`x @strata:doc_1`))).toBeLessThan(2000)
  expect(timed(() => mentionSpans(`Explain ${'<!--'.repeat(130000)} @strata:doc_1`))).toBeLessThan(2000)
  expect(timed(() => mentionSpans(`${'<a b="'.repeat(60000)} @strata:doc_1`))).toBeLessThan(2000)
  expect(timed(() => mentionSpans(`${'[a\n'.repeat(64000)}@strata:doc_1`))).toBeLessThan(2000)
  expect(timed(() => mentionSpans(`${'- '.repeat(32000)}text @strata:doc_1`))).toBeLessThan(2000)
  expect(timed(() => mentionSpans('https://e.org @strata:doc_1 '.repeat(60000)))).toBeLessThan(2000)
  expect(timed(() => mentionSpans('[a]: \n<a \n@strata:doc_1\n'.repeat(20000)))).toBeLessThan(2000)
  expect(timed(() => mentionSpans(`${'a-'.repeat(256000)} @strata:doc_1`))).toBeLessThan(2000)
  expect(timed(() => mentionSpans(`${'a://'.repeat(100000)} @strata:doc_1`))).toBeLessThan(2000)
})
