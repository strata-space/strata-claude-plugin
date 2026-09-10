# Presentation source and notes

## Frontmatter

Start the Markdown file with a leading YAML block:

```yaml
---
presentation: true
---
```

The boolean enables defaults. To configure them, replace it with a map:

```yaml
---
presentation:
  aspect: '16:9'
  transition: fade
  audience: Leadership
  purpose: Decide the launch date
  form: slides
  notes: presenter
---
```

Only these six keys are accepted inside `presentation`. `aspect` accepts `16:9` (default), `16:10`, or `4:3`; `transition` accepts `fade` (default), `none`, or `slide`; `form` accepts `slides` (default) or `whole-deck`; `notes` accepts `presenter` (default) or `none`. Optional `audience` and `purpose` are strings of at most 200 Unicode characters each. The leading YAML text is limited to 16 KiB in UTF-8. Unknown presentation keys and invalid map values are errors. The theme belongs in a CSS fence, not `presentation.theme`.

Use the actual YAML boolean `true`, not a quoted string or `yes`. Missing settings, `presentation: false`, null, and other non-map/non-true values describe an ordinary document. Disabling or removing presentation settings also disables the edition privacy policy; it is not a safe way to hide presenter notes. Invalid settings that still name the presentation key fail closed for readers below editor.

## Heading decision table (`form: slides`)

Only top-level document nodes define the structure; headings nested in a blockquote/list or written inside an HTML fence do not create slides.

| Source | Interpretation |
| --- | --- |
| First H1 | Cover, placed first in the resulting slide order even if encountered after an H2. |
| Each H2 before the appendix | A slide whose headline is the heading's plain text. Identical headline text still produces distinct slides. A cover is optional. |
| Second and later H1 | `duplicate-cover` finding. That H1 and everything until the next H2 belong to the preceding section's notes, even an HTML block there. |
| H3–H6 and ordinary blocks | Notes in the current section, except for its selected visual. This includes prose, lists, quotes, tables, images, and non-visual code fences. |
| Preamble before any slide heading | Notes attached to the first H1 cover, if one exists. Without a cover it is not assigned to a slide. |
| First H2 whose trimmed, case-insensitive text starts with `appendix` | Ends all slide processing, including all later headings. This is a prefix test: `Appendixes` also starts the appendix. |

In each section, the first top-level `html` fence is its visual (`HTML` is also recognized). Additional HTML fences receive `extra-visual` findings and are neither selected visuals nor notes. A section containing both an HTML fence and a `slide` fence gets `slide-and-visual` and is excluded entirely. Fix it rather than relying on its omission. Only `html` is matched case-insensitively. The `slide` and `css` fence languages are compared exactly and must be lowercase: a mis-cased ```` ```CSS name=theme ```` fence loses its `extends`, `locked`, `source` and `sourceVersion` attributes at import, produces no finding at all, and is dropped from the reader edition, so the deck silently renders in the default theme.

With no HTML fence, the first `slide` fence is the visual. Its `layout` must be `title`, `statement`, `bullets`, `big-number`, or `two-column`. A missing/invalid layout gets `unknown-layout` and falls back structurally to `statement`. Later `slide` fences are notes. With neither kind of visual, the section is a headline-only statement. These are grammar decisions: the shipped sandbox bootstrap does not yet install the text-layout renderer, so do not promise that layout bodies render today.

## Fence ownership

| Fence | Attributes |
| --- | --- |
| `slide layout=bullets` | `layout` only; `name` and `uses` are discarded on slide fences. |
| `css name=theme` or `css name=deckTheme` | May carry `extends`, `locked`, `source`, and `sourceVersion`. |
| `html uses="sales,targets"` | Declares which named resources the visual reads. |
| `json name=sales` (also `csv`, `tsv`, `yaml`) | Defines a document-scoped data source. A table can be named by `<!-- strata:name=sales -->` immediately above it. |

Names match `[A-Za-z][A-Za-z0-9_-]{0,63}`. Use comma-separated `uses` names. `extends` matches `[a-z][a-z0-9-]{0,31}`; well-formed unknown themes survive import but resolve with a finding. `locked` is the literal `true` or `false`. Provenance requires both a valid `doc_` ULID and a nonnegative decimal `sourceVersion` within u64. Keep the version as a decimal string, not a JavaScript number. Attributes outside their owning fence are dropped; provenance is omitted if either half is invalid or missing.

## Source example

This is a complete authoring document, not a promise that a deck presentation route is installed. The theme is in the appendix so it does not become a cover note; it is still retained for the audience.

````markdown
---
presentation: true
---
# A simpler launch

Explain the decision we need today.

## Ship the smaller release first

```html
<!-- slide: launch -->
<main id="s02-launch" style="padding:var(--deck-padding)">
  <h1 class="deck-title" data-deck-headline>Ship the smaller release first</h1>
  <p id="s02-rationale">A focused release gives us a clear learning signal.</p>
</main>
```

Discuss the internal negotiation here, outside the visual.

## Appendix: resources

```css name=deckTheme extends=strata-light
:root {
  --deck-accent: #1d4ed8;
}
```
````

## What the edition actually keeps

Owners and editors receive the full authoring document. Viewers, commenters, and suggest-only readers receive an edition derived from the accepted structure. It includes accepted slide headings and visual blocks, synthesized `presentation` settings, both named theme CSS blocks, and named JSON/CSV/TSV/YAML blocks or tables declared by accepted visuals' `uses`. These resources can be anywhere in the top-level document, including the appendix. A slides edition also retains the appendix heading itself, but not ordinary appendix prose. Other authored frontmatter keys are not carried into the edition. The allowed presentation settings, including `audience` and `purpose`, are retained.

The projection copies retained blocks whole. Hidden HTML, HTML/CSS comments, JavaScript strings, and unused fields inside a declared data source are visible to readers who inspect the source. A resource may be classified structurally as notes and still be retained because it is theme CSS or declared data. Never put secrets in those blocks or in the appendix heading. Keep private narration as ordinary prose in a valid slide section. The `notes` setting describes pane visibility; the projection does not use it to decide privacy.

For `form: whole-deck`, the first top-level HTML fence before the appendix is the entire deck. Headings do not create slides; non-HTML blocks before the appendix are external notes. More HTML fences produce `extra-visual`. No HTML means no slide. The edition retains the selected HTML plus themes/declared data; it cannot inspect or strip notes inside that HTML. Its `notesPrivacy` is `notStripped`, rather than `stripped`. Existing whole-deck publication requires explicit acknowledgement of that limitation. Do not claim that CSS hiding, a framework's speaker-note class, or `notes: none` protects internal HTML notes.
