---
name: strata-presentation
description: Author or revise a Strata presentation from a conversation, adapt an existing deck file, and import company design tokens. Use for Strata deck authoring, slide edits, themes, notes, and presentation import or export requests.
metadata:
  grammar-version-min: "1"
  grammar-version-max: "1"
---

# Strata presentations

Create a presentation as an ordinary Strata document with leading YAML presentation settings. Use the connected server's `find`, `read_document`, and `edit_document` tools; tool prefixes depend on the host. Discover their actual schemas before calling them.

The document grammar, theme resolver, reader edition projection, shared deck stage, text layouts, and presentation routes are available. Discover the connected tool schemas before validation or export; `export_presentation` supports standalone HTML and PDF on current servers, and rejects opaque whole-deck HTML because note removal cannot be established.

## From conversation to document

Before the first write, fetch `presentations` and `presentation-grammar` with `find` and `scope: {"type":"strataDocumentation","slug":"..."}`. This skill supports `grammarVersion` 1 through 1. Follow the live corpus over this file if they differ, and read theme names and findings from `presentation-themes` and `presentation-validation`. If the version is outside this range, read the changed rules before authoring and report the compatibility mismatch. If the corpus is unreachable, use these references and disclose that fallback. Never treat a documentation section's existence as proof that its tools exist.

1. Recover the audience, purpose, source material, desired length, and destination from the conversation. Bundle necessary questions in at most one round. Default to eight to twelve slides including the cover when there is no length signal. Preserve the user's facts and uncertainty; identify assumptions instead of inventing metrics or evidence.
2. Before styling, find and read the user's design system or company theme, using the supplied document ID or `find` scoped to the relevant workspace/Space. Read [theme-import.md](references/theme-import.md) for the copy contract and the `:root` rule. A theme is copied document content, not a remote reference that updates itself. If none is provided or found, use `strata-light` and state that choice.
3. Develop a sequence of claims, one headline per slide, with evidence on the visual and supporting narration in notes. Prefer the default `form: slides` for a newly authored deck. Use whole-deck HTML when preserving an existing HTML deck calls for it; it has different privacy and navigation limits.
4. Read [grammar.md](references/grammar.md) before arranging headings, visuals, notes, or appendix resources. Use one H1 cover, then H2 slides. Choose one `html` visual per section for custom visuals; `slide layout=...` uses the shared text-layout renderer. Ordinary paragraphs outside a visual are notes, not slide body copy.
5. Start each newly authored slide HTML block with a `<!-- slide: topic -->` marker inside the fence. Gate-one whole-deck import keeps the original file bytes without this marker. Give editable HTML elements descriptive IDs unique across the authored deck, such as `s03-retention-value`. Reuse deck tokens for colors, fonts, padding, and radius; keep per-slide CSS for composition. In shell-aware HTML use `data-deck-headline` to receive the section headline, with readable fallback text for an ordinary HTML preview. Draw figures from named data blocks in the appendix using `uses`, `strata.data.get`, and a `strata:data` listener. Handle the returned tagged source, including unavailable data; it is not a parsed JSON object. Aggregate large sources locally to fit the 128 KiB per-source and 256 KiB total payload limits. Label hypothetical inputs. Copied data is a snapshot; record its source in notes. Add a readable static result for charts and reduced motion. Consult `interactive-html` for sandbox capabilities.
6. Prepare complete sections before saving. The planned one-section-per-call `insertSection` action does not exist yet, so do not call it. For a new deck, create the prepared Markdown with `edit_document` `action: create`. For an existing file use [import-contract.md](references/import-contract.md). For an existing deck, follow the concurrency limits below. Use returned IDs, read the result back, and run [validation.md](references/validation.md). Report the document link actually available, slide count, theme/provenance, bindings, and verification limits; do not fabricate present links. Creation does not itself request publication or an audience change.

### Editing while others may be working

No MCP document-body write accepts the `documentVersion` returned by `read_document` as an expected-version precondition. Neither `action: write` nor replacement through `finalizeUpload` checks that the document still matches your read. Both can overwrite collaborator changes without a version-conflict error. Internal conditional WAL writes provide durability and ordering; they do not compare your source version.

Prefer small, uniquely anchored `edit` calls with `replaceAll: false`. They reject a missing or ambiguous match in the serving ECS task's in-memory Yjs replica, under the API's matching rules (which can normalize quotes, footnote markers, and whitespace). This is not an exact-byte check or a distributed compare-and-swap. Another task may already have committed a change that this replica has not received; a stale anchor can still match, and raced WAL records are integrated during persistence after the edit was authored. No available MCP body-write path guarantees safety against a concurrent editor.

An anchored edit is preferable to supplying a stale full document because it checks a local match and derives the replacement from that replica. A character-level edit touches the matched region; cross-node edits or changes requiring block structure can fall back to a Markdown round-trip and structural rewrite, so do not promise that every anchored edit touches only one region. Keep HTML edits within one uniquely identified fragment. For a section addition, anchor on the last unique fragment of the preceding section and emit it plus the new section as `newString`, recognizing that this can take the rewrite fallback. Never use an anchor that also occurs inside HTML source.

If presence or changing reads suggest active editing, tell the user that the write cannot be guaranteed safe and coordinate a pause or prepare a separate copy. For an unavoidable full replacement, re-read immediately before `write` or `finalizeUpload`, compare `documentVersion` with the version used to prepare the replacement, and abort and tell the user if it moved. An unchanged version only narrows the race window; it does not close it. Read-back verifies an observed result, not freedom from concurrent changes.

Implementation: `rust/crates/st-api-core/src/collaboration/yjs_manager.rs` (`apply_string_replace`, including its `apply_full_rewrite` fallback); `rust/crates/st-api-core/src/handlers/documents/yjs.rs` (`string_edit_document`, `persist_yjs_edit`, and the subsequent `integrate_raced_then_advance`); `rust/crates/st-api-core/src/handlers/bulk_upload.rs` (replacement through `full_rewrite_document`). These managers are task-local under the root `AGENTS.md` multi-task rules.

Retrieve the documentation corpus with real `find` scopes, for example:

```json
{"intent":"info","scope":{"type":"strataDocumentation","slug":"presentation-grammar"}}
```

Other deck slugs: `presentations`, `presentation-themes`, `presentation-validation`, `presentation-import`, `presentation-export`, `presentation-refresh`. Use `interactive-html` for libraries and data bindings. `intent: search` takes `query` beside the scope object; `intent: list` enumerates sections. An `info` result contains the full section body in its snippet.

## Anchor on an ID for in-block edits

Read the current document before editing. For an HTML-body change, include the target element's authored `id` in both `oldString` and `newString`, and require the old fragment to occur exactly once in the current source. This is an authoring discipline for the existing text-replacement API: there is no CSS-selector or element-ID edit parameter.

Change a bound number in its named data block, leaving the visual intact. The example below applies to an existing unbound fragment, such as one preserved from an imported file; offer to bind it if it should track data.

```json
{
  "action": "edit",
  "documentId": "<document ID returned by Strata>",
  "oldString": "<strong id=\"s03-retention-value\">84%</strong>",
  "newString": "<strong id=\"s03-retention-value\">87%</strong>",
  "replaceAll": false
}
```

Do not match only `84%`, a repeated class, or generic markup. If the target has no ID, read enough surrounding source to identify it uniquely and add one with a narrow edit first. If the fragment is absent, ambiguous, or changed by a collaborator, reread and re-anchor; do not widen to `replaceAll` or rewrite the whole document to force the edit. For CSS or JavaScript, anchor the replacement on the ID selector or ID lookup plus unique surrounding source. Preserve the fence and its `name`, `uses`, and theme attributes when changing only its body. Read back after the edit and check that the intended element alone changed.

## Review before handing over

- Check leading frontmatter, the cover and H2 order, exactly one visual per section, and the first appendix boundary. Fix duplicate covers, mixed `slide`/`html` sections, extra visuals, and unknown layouts.
- Check the theme's eight tokens in a top-level plain `:root`, company provenance from the real source version, and any lock. Address theme findings; a lock reports overrides but does not prevent the CSS from winning.
- Inspect all audience-visible bytes: headings, visuals (including HTML comments, hidden nodes and scripts), theme CSS, declared data, and presentation metadata. The edition retains these. Put private narration in ordinary section prose; `notes: none` is not a privacy switch. Whole-deck HTML cannot have its internal notes stripped. Never disable presentation settings on a shared document to work around a rendering problem: it becomes an ordinary document and readers can receive its full body.
- Check legibility, clipping, contrast, chart labels and source attribution, meaningful text for graphics, and a useful static/reduced-motion state. Distinguish source checks from a rendered check; never report a preview, export, or automated validator that was not run.

## Existing files and exports

For an existing HTML deck, use these two gates in order:

1. **Whole-deck first.** Read [import-contract.md](references/import-contract.md), run its four pre-write checks, and prepare the original HTML as one block with `presentation.form: whole-deck` and the file title as H1. Upload through the existing Markdown file flow, read back, and give the returned document link. Add an adapter only for an index/navigation interface the source actually exposes. Tell the person that **nothing inside a whole-deck block is private**, including hidden notes and comments.
2. **Split second.** Run the numbered decision procedure on the exact adapted HTML bytes, and report all five rows, each as `pass`, `fail`, or `cannotEstablish`, with the rule, source location, and reason. No confidence scores or guessed script locality. An unknown construct is `cannotEstablish`; either non-pass result keeps the whole-deck document. If all pass and splitting is authorized, carry each whole section into a NEW document as described in the reference. If the user already requested the split, that is authorization; otherwise offer it after delivering gate one. Keep the whole-deck document. Report hardcoded numbers as binding candidates and distinguish source checks from browser comparisons.

The procedure is content executed by the coding agent, as specified in LLD 1. There is no dedicated import or split API. Prepare local artifacts with the agent's ordinary coding tools, then use the real `edit_document` upload/create actions; a local file or a successful PUT alone is not a created document.

Read [import-contract.md](references/import-contract.md) whenever the user supplies a file or requests an export. Preserve their existing artifact and explain required adaptations. A file that already exists should be uploaded as bytes through the supported Markdown upload flow after any necessary conversion, rather than reproduced in a large inline tool argument. Binary office-file import is a separate conversion path and does not promise an editable presentation with original slide fidelity. Read the reference’s export contract; ordinary document exports are not equivalent to a presentation export. After a company theme copy, follow [refresh-routine.md](references/refresh-routine.md) to write one routine watching the theme and the deck when the server advertises the contract. Explain that external copied data remains a snapshot and that refresh suggestions need human acceptance.
