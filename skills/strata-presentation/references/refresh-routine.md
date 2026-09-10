# Refresh copied company themes and deck data

After copying a company theme, create or update one refresh routine per deck when `manage_suggestions`, `get_company_theme`, and `list_company_themes` are advertised and `find` with `intent: "info"`, `scope: {"type": "strataDocumentation", "slug": "presentation-refresh"}` returns the refresh contract. On older servers, report that the theme copy will not refresh itself and create no routine.

Find the person's Agents folder with `find` (`intent: "list"`, `scope: {"type": "folders"}`). Write an ordinary agent document there using `edit_document` `action: "create"`; update the existing routine if one already targets this deck. Preserve frontmatter: template instantiation removes it. Replace every example ID and the identity fields below with the actual values. There is no `output`.

````markdown
---
name: deck-refresh-august-review
description: Files refresh suggestions when the copied company theme or this deck's data changes.
tools: [read_document, get_company_theme, manage_suggestions]
triggers:
  - kind: documentEvent
    event: updated
    scope: { kind: document, documentId: doc_01THEME }
  - kind: documentEvent
    event: updated
    scope: { kind: document, documentId: doc_01DECK }
target: { documentId: doc_01DECK }
---
You refresh presentation doc_01DECK. Read it. Compare its css name=theme
sourceVersion with get_company_theme on the source. If different, propose ONE
suggestion replacing the whole fence with the returned CSS, extends, and locked
attributes, updating source and sourceVersion together. Preserve deckTheme.
For each slide body, headline, or note stating a number, read the Appendix data
block named in that slide's notes. If the number differs, propose ONE suggestion
for that slide with the before and after values in its rationale.
Every proposal carries baseVersion (the deck version read), sourceRef
{documentId, sourceVersion}, and anchor {sectionPath, blockOrdinal, offset}.
For data in the deck, sourceRef names the deck and its current version.
Use manage_suggestions only to propose, list, and withdraw your own suggestions.
Never accept: accepting is a person's decision. Never edit the deck. Never publish.
````

`blockOrdinal` is one-based among the section's top-level blocks, including its heading. `offset` counts UTF-16 code units within the block's text. The empty section path names the preamble. For a whole fenced block, use offset zero and the exact exported fence as `originalText`. Match the exact block; do not rely on repeated text elsewhere.

The run's tool allowlist restricts tool names, not actions: its prohibition on accepting is an instruction, not an enforced action boundary. Leave model selection at the routine default.

Tell the person that changes to the company theme or deck data produce reviewable suggestions after the debounce. Human acceptance and republication remain separate actions. `suggestionBaseMoved` and `suggestionSourceMoved` mean wait for the next run or rerun; never force an overwrite. Newer runs supersede old source proposals. Data copied from another document remains a snapshot and is not watched; report that at copy time.
