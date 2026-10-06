---
name: strata-blog
description: >
  Write, revise, or style a Strata blog post (strata.space): draft an article
  from a conversation or notes, turn an existing Strata document into a post,
  and set its `blog:` frontmatter (summary, tags, cover thumbnail, header
  image, typography, colors, wallpaper, series). Use for "turn this doc into a
  blog post", "write a blog post about X in Strata", "add a cover / header
  image to my post", "style my post", "give my post a wallpaper", "get this
  post ready to publish". Uses the Strata MCP server; no CLI required.
---

# Strata blog posts

A Strata blog post is an ordinary prose document whose first YAML frontmatter block holds a `blog:` mapping. The article is plain Markdown; the mapping controls appearance and discovery. The **Post appearance** panel in the app edits the same frontmatter, so humans and agents share one source. Tool prefixes depend on the host; discover the connected server's `find`, `read_document`, and `edit_document` schemas before calling them.

## Load the live rules first

Before the first write, fetch the authoring guides from the documentation corpus. They are the source of truth for keys, allowed values, and limits, and they change faster than this skill:

```json
{"intent":"info","scope":{"type":"strataDocumentation","slug":"blog-design"}}
```

Also fetch `interactive-html` when the post will carry an `html` block or an HTML wallpaper. Follow the live corpus wherever it differs from this file. If the corpus is unreachable, use the summary below and tell the user you did.

## Workflow

1. **Recover intent.** Audience, purpose, the user's voice (read their earlier posts with `find` scoped to `{"type":"published"}` when a handle is known), length, and any source documents. Ask at most one bundled round of questions. Preserve the user's facts, voice, and jokes; never invent metrics, quotes, or product capabilities.
2. **Read before writing.** `read_document` the target in full. Large documents return an outline; read every section you will touch. If a read comes back truncated, summarized, compressed, or otherwise not verbatim, you have NOT seen the body: do not use it as the basis for `action: write`. Re-read with sections, or switch to anchored `edit` calls.
3. **Write the article** as normal Markdown: one H1 title, descriptive H2/H3 headings, the main answer early. Keep essential information in text, not only in images or executable visuals.
4. **Add the `blog:` frontmatter.** Merge into the existing first frontmatter block if there is one; never create a second block and never drop unrelated keys or comments. Add only what was asked for or clearly helps; omit a field to inherit its default instead of writing `null` or `default`.
5. **Name images before referencing them** (see below).
6. **Check `blogValidation`.** Every `edit_document` result on a document with blog frontmatter returns `blogValidation.findings`. Fix every `error`; review each `warning`. A successful edit does not mean the draft is publishable.
7. **Hand back for review.** Leave the post as a draft and give the user the document link. Publish only when the user explicitly asks and a publishing tool is connected; otherwise tell them to publish from the app. Publication freezes content and resolved design, so later draft edits need a re-publish.

## Key summary (verify against `blog-design`)

```yaml
---
blog:
  summary: "At most 160 characters; search and social description."
  tags: [ai, startups]              # up to 10, each at most 32 chars
  cover: cover                      # thumbnail and social card image
  coverInBody: hidden               # visible (default) | hidden
  hero: banner                      # header band above the title
  typography: editorial             # modern | editorial | expressive | technical
  palette: paper                    # strata | paper
  tableOfContents: visible          # visible | hidden (default)
  accent: { light: "#8a3515", dark: "#ffb788" }
  background: { light: "#fffdf8", dark: "#272119" }
  fonts: { heading: Georgia, body: Georgia }
  readingSurface: opaque            # opaque (default) | translucent
  series: { name: "Field notes", order: 1 }
  noindex: false
  wallpaper:                        # exactly one kind: color | gradient | pattern | image | html
    pattern: { name: dots, tint: { light: "#e7e0d4", dark: "#111827" } }
---
```

- Colors are quoted six-digit `#RRGGBB` pairs for light and dark. Body text and accent links must reach 4.5:1 contrast on the reading surface in both schemes; validation enforces it.
- `translucent` is allowed only over `color` or `gradient` wallpaper.
- `html` wallpaper names an `html` code block (declare `uses="frontmatter"` to read design values) and requires a static `fallback` color or image. It is decoration only: no clicks, no essential content.
- Unknown keys are errors. Check spelling and nesting against the live guide.

## Images: cover, header band, wallpaper

Every image reference names an image that lives in this document. Put a naming comment on the line immediately before the image, keeping the image's existing `strata://image/<id>` URL:

```markdown
<!-- strata:name=banner -->
![Alt text describing the image](strata://image/<existing image id>)
```

Names start with a letter, use letters, digits, `_` or `-`, are unique in the document, and are at most 64 characters.

- **`cover`** is the thumbnail on the profile, feeds, and link previews. A square or 1.91:1 image works best. It also shows in the body where it sits unless `coverInBody: hidden`.
- **`hero`** is the header band: rendered full width across the top of the post, above the title, at the image's own aspect ratio (tall images are capped and cropped). Its source image is removed from the body so it never shows twice. Use a wide crop (roughly 2:1 to 4:1) and give it real alt text; the band uses it. Cover and hero may name the same image or different ones. A common setup: full image as `cover` with `coverInBody: hidden`, and a wide crop of it as `hero`.
- If the live `blog-design` guide does not list `blog.hero`, or validation reports it as an unknown key, the connected server predates the header band: tell the user, and fall back to leaving the cover visible at the top of the body.
- **`wallpaper.image`** fills the page behind the reading surface and is also removed from the body.

You cannot fetch an external image URL into a post through these tools. If the user needs a new image (for example a cropped hero), ask them to add it to the document in the app, then name it.

## Editing safely

MCP body writes do not take an expected-version precondition, so `action: write` can overwrite a collaborator's concurrent changes. Prefer small, uniquely anchored `edit` calls (`replaceAll: false`): for example, anchor on the H1 plus the first image to insert frontmatter and naming comments above them. Use full `write` only for a brand-new document or when the user asks for a rewrite, and only from a verbatim read taken immediately before. If you overwrote something by mistake, say so at once and restore from document history if the host exposes it.

## Done means

- `blogValidation` has no errors, and the warnings have been reviewed with the user.
- Summary, tags, and cover are set unless the user declined them.
- The article text is the user's, with only the changes they asked for.
- You tell the user what you could not check (preview in both color schemes, phone width, wallpaper fallback) rather than implying you saw a rendered page.
