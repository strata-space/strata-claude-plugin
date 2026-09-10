# Import rehearsal (#1415)

This rehearsal was recorded in `NSAN-LLC/aidocs` before the skill moved to this plugin. The input snapshot is now `tests/presentation/fixtures/presentation-import.json`; parser and rendering fixtures remain in the monorepo. Historical paths and test receipts below describe those earlier runs. Update the input snapshot and rehearse the cases together when the import contract changes.

LLD 1, `doc_01M1TX0FWFPE2NCB0KKEYRRBZ6`, was read through the Beta document connector. Its “Import of an existing deck” and “Out of scope” sections assign eligibility and splitting to the coding agent and explicitly exclude a shipped importer script. The numbered procedure lives in the skill reference; the executable file here verifies a run's answers, not HTML eligibility. No new API or wire DTO is introduced.

`fixtures/presentation-import.json` supplies the source and 34 table-driven eligibility cases plus shared delimiter, fence-byte, frame-attribute and cascade cases. Each S1–S5 rule has passing and independently failing inputs. Script boundaries include a local lookup, navigation, a shared helper, a computed selector, a sibling read, a global write, and an aliased lookup. The two Markdown fixtures were prepared by an independent agent using the revised skill. Their canonical documents and slide structures are also committed in `fixtures/presentation-grammar.json`.

To repeat the behavioral check, give a fresh agent only the skill and `{source, cases: [{name, html}]}` from the input fixture, withholding the expected answers. Ask it to import the source whole-deck first and split if eligible, using local files when remote creation is unavailable. It must emit `whole.md`, `split.md`, and `cases.json` with `{cases: [{name, checks: [{rule, status, reason?, location?}]}]}`. Every case has ordered S1–S5 rows and every non-pass has a reason and source location. Preserve a receipt of gate order, adaptations, bindings, and actual remote/rendering limitations.

Run:

```sh
# From the plugin repository:
PRESENTATION_IMPORT_RUN_DIR=/path/to/run node --test tests/presentation/*.test.mjs

# From a checkout of NSAN-LLC/aidocs:
PRESENTATION_IMPORT_RUN_DIR=/path/to/run pnpm --filter @strata/editor-core test htmlDeckImport.test.ts --maxWorkers=1
```

The same directory can be supplied to the Rust `import_roundtrip_preserves_whole_sections_and_fence_attributes` test. Without that variable, Rust and TypeScript test the committed artifacts. The editor test starts with two empty editors and performs real Markdown paste actions, then observes `documentDeck`, whole-section bytes, heading injection carriers, styles, tokens, and retention of the first document. Rust takes the artifacts through Markdown → ProseMirror → Yjs → Markdown and verifies fence bodies and attributes, including `uses`, `name`, `extends`, `locked`, `source`, and the decimal spelling of `sourceVersion`.

## Before-change evidence

| Test | Observed failure against the old behavior |
| --- | --- |
| `import eligibility: all five rules and their pass/fail boundary cases` | Old skill produced six mismatches across 105 rows: positional selectors, script rejection status for sibling reads/global writes, sibling fragments, reserved Appendix headlines, and structured headlines. |
| `imports from empty editors through paste, keeping whole-deck while creating the whole-section split` | Old paste path returned no presentation (`undefined`, expected `whole-deck`). After fixing that path, the old skill artifact still failed byte preservation because it prepended a slide marker to the original HTML. |
| `import_roundtrip_preserves_whole_sections_and_fence_attributes` | Old skill artifact failed “gate one retains the exact HTML bytes”; its split also retained headline text and changed original styles/attributes. |
| Shared corpus `import-whole-deck` and `import-split` (TypeScript) | Both fail with the former paste path: YAML becomes ordinary document content and all derived positions/structure diverge from Rust. The old paste implementation was temporarily restored for this check and then the fix restored. |
| `deck_structure_agrees_across_languages` (Rust) | Enforces the regenerated corpus containing both imported artifacts. Existing grammar assertions already passed; this test is extended rather than presented as a new parser defect. |

The baseline run used the skill from `a62ac0c39`; the forward run used the revised procedure. Neither agent saw expected case verdicts. The revised run passed all 21 cases / 105 rows. These behavioral results test the written procedure on the fixture set; they do not prove that every future model will follow it.

## Prior rehearsal verification (before round-one remediation)

- Requested Rust selection: **148 tests run, 148 passed, 532 outside the selection**; stderr and summary captured in `/tmp/import-verify.txt`. Build parallelism was capped at two jobs; test threads remained four.
- Scoped Clippy with `-W clippy::pedantic`: passed, `/tmp/import-clippy.txt`.
- Editor-core: **110 files, 1615 tests (1605 passed and 10 expected-failure cases)**, `/tmp/import-editor-verify.txt`.
- Direct `pnpm --filter @strata/editor-core typecheck`: passed, `/tmp/import-typecheck-direct.txt`. The requested Turbo invocation and a telemetry-disabled retry both crashed in macOS `system-configuration` with “Attempted to create a NULL object”; `/tmp/import-typecheck.txt` and `/tmp/import-typecheck-retry.txt` capture those failures.
- The first frontend run found missing generated document CSS; `just _ensure-document-styles-dist` built it, and the complete suite then passed. Type checking also exposed a theme diagnostic object being returned where local validation promises display text; the initial patch serialized the diagnostic at that boundary; F2 remediation below replaces that with a tagged machine payload.

Unexercised assertions: real MCP upload/finalize/readback and persistence of both separate remote documents; source-versus-split screenshots for both slides at 1280×720 and 960×540; rendered clipping/headline/script fidelity; optional adapter first/last navigation and reported count in a real browser. Docker startup (`just _up-test-services`) was denied access to the Docker socket. Chromium launch was denied macOS `MachPortRendezvousServer` registration before any page opened. Those are environment failures, not reported test passes. No screenshot fidelity or remote creation is claimed. The selected Rust tests require neither DynamoDB nor the full stack.


## Round-one remediation

`tests/presentation/cases.json` now commits the original independent rehearsal's 21 verdicts, plus seven explicitly adjudicated version-2 adapter/cascade cases. `verify-import-run.test.mjs` runs under the package's existing test command, compares all five rows to the shared corpus, pins the reviewed contract hash and exact adapter template, and checks that incorrect verdicts, missing rows/locations and confidence fields are rejected. A fresh agent run remains optional; a missing requested run artifact is an error. Golden receipt changes require explicit review/rehearsal after a contract edit.

The adapter exception is an exact, versioned in-file representation. Original, adapted and byte-identical re-imported cases all pass; changed bytes, unknown versions and duplicate markers cannot establish S3. The actual bootstrap tests exercise adapter count and first/last navigation. The split retains global styles before/after each section in original source order, with a shared local/global conflict fixture. Tests assert the actual adopted style layers and order before flattening their single identical layer for jsdom's cascade probe; jsdom does not implement layered CSS cascade, so this is not browser visual evidence.

The hosted bootstrap (shared by webapp and MCP frames) now installs supported html/body attributes and reports unsupported ones. This is why the adoption change lives in webapp's deployable sandbox asset; its assertions live in editor-core and execute that exact asset. Stored source retains all attributes. The surface-local validation page only localizes display; the shared machine report now carries theme detail objects, covered by a real nonempty theme finding.

The shared delimiter corpus covers scalar content between delimiters, `...`, CRLF, BOM, padding, indented delimiters, leading blank lines, blank first content, empty and unclosed blocks. A direct Rust probe disproved the reported scalar-case mismatch: pinned pulldown-cmark 0.13.4 treats `---\nSome text\n---` as metadata. Both runtimes now assert that behavior. The actual mismatches were BOM and leading blanks. LF, CRLF, mixed, authored final CRLF, and CRLF fence delimiters survive real paste and Rust Markdown → Yjs → Markdown with literal HTML equality.


Final targeted verification was **run**, with stdout and stderr captured:

- Requested Rust nextest selection: **99 run, 99 passed, 582 outside the selection**, `/tmp/import-r1fix.txt`. The longest selected test ran for 1.516 s; this was not the all-fail-under-0.05-s container symptom.
- Editor-core: **110 files, 1641 tests: 1631 passed and 10 existing expected-failure tests**, `/tmp/import-editor-r1fix.txt`.
- Strata skill: **2 files, 7 tests passed**, including 28 cases / 140 S1–S5 verdicts, `/tmp/import-skill-r1fix.txt`.
- Scoped Clippy (`st-core`, `st-api-document`, `-W clippy::pedantic`): **passed**, `/tmp/import-clippy-r1fix.txt`.
- Additional affected sandbox tests: **3 files, 24 tests passed**, `/tmp/import-sandbox-r1fix.txt`. Direct editor-core and webapp type checks and scoped Biome checks passed.

Webapp type checking required regenerating the two existing presentation routes in `routeTree.gen.ts`. The initial Wasm build hit the sandbox's read-only Cargo cache; the generated local package was restored from the primary checkout after byte-comparing the crate's source and manifest. No Wasm source or dependency changed.

Assertions not exercised: live MCP upload, finalize, remote readback and persistence/retention of the two separate remote documents; screenshot equality for each source/split slide at **1280×720 and 960×540**; real-browser clipping, headline and local-script fidelity; real-browser adapter count and first/last navigation. The actual bootstrap's attributes, diagnostics, script execution, count and navigation were exercised in jsdom, but that does not establish browser visual fidelity. Chromium launch terminated with SIGABRT/EPERM before any page opened (`/tmp/import-browser-r1fix.txt`). No full-workspace sweep, deployment or merge was run.


Final handoff: A1 checkpoint commit `623545f7f` exists. The final `git add`/commit was denied when creating `/Users/andrewnaeve/Code/aidocs/.git/worktrees/presentations-import/index.lock` (Operation not permitted). Remaining remediation files, the two new golden/verifier files, and generated route correction are intact in the working tree. No work was discarded. The final editor-core run also verifies rich-HTML `<br>` code paste remains on the standard parser; only generated Markdown code with CRs uses the literal-text carrier. Final counts above include that added assertion.


## Round-three remediation (2026-09-09)

Addressed all five adjudicated round-two findings in commit `573ca1cf8`; no merge or additional independent review was run.

- Export root attributes: the export bootstrap now applies the hosted frame's allowlist, merges classes/styles, and reports unsupported attributes. Regenerated the shared export assets and shell manifest/version. The frame harness explicitly selects the composed `export-frame.js` for its export assertions. Both forms assert attributes and diagnostics in both runtimes against the same corpus. Before the fix, all four new export assertions failed on missing attributes/diagnostics (`/tmp/import-r3-regressions.txt`). These are jsdom execution results, not Chromium or PDF visual results.
- CI/cache inputs: added `@strata/strata-skill` to the frontend CI test step, its tests/skills/package/fixture inputs to Turbo, and all root presentation fixtures to editor-core's test inputs. Turbo's dry-run/hash inspection could not execute: both the normal invocation and a telemetry-disabled, local-cache, no-daemon retry crashed in macOS `system-configuration` with “Attempted to create a NULL object.” Logs: `/tmp/import-r3-turbo-stderr.txt`, `/tmp/import-r3-turbo-retry-stderr.txt`. CI selection and cache invalidation are configured but were not exercised in CI or by a successful Turbo hash probe here.
- Shared topology: TypeScript now asserts every top-level node type and heading level against `boundaries[].blocks`. Both runtimes additionally assert the normalized Yjs/editor topology, including the exact empty trailing editing paragraph. No nodes are filtered out. Removing the BOM carrier produced the expected extra-horizontal-rule assertion failure (`/tmp/import-r3-bom-mutation.txt`); the source was restored. All 28 previous eligibility cases and all existing source/adapter/cascade/root-attribute/boundary/fence-byte fixtures were compared to the prior commit and are unchanged.
- Authored hidden: gate one prohibits inserting any adapter if any source section has `hidden`, regardless of value. The validated-adapter exception returns S3 `cannotEstablish` for those bytes. The split must retain authored `hidden`. Six additional cases cover bare, `false`, and `until-found`, before and after adding the exact template. The contract receipt was explicitly updated to version 3 after reviewing the existing cases and manually adjudicating these six; this was not an independent agent rehearsal. Both runtimes assert all 34 cases' HTML bytes survive their import paths, and hosted/export jsdom frames preserve the three authored-hidden variants.
- Parser preconditions: parser absence, timeout, and infrastructure failure now report **procedure not executed**, with no eligibility verdict or partial S1–S5 rows; recovery reruns the complete procedure. Unsupported file syntax retains `cannotEstablish`. The skill remains a written procedure, with no shipped eligibility checker.

RAN the requested targeted commands, with stdout and stderr captured:

| Command | Run count / result | Log |
| --- | --- | --- |
| Requested nextest selection, four test threads | 99 run, 99 passed; 582 outside selection | `/tmp/import-r3.txt` |
| `pnpm --filter @strata/editor-core test` | 110 files; 1685 total: 1675 passed, 10 expected-failure cases | `/tmp/import-editor-r3.txt` |
| `pnpm --filter @strata/strata-skill test` | 2 files; 7 passed; 34 cases / 170 rule verdicts | `/tmp/import-skill-r3.txt` |
| Scoped Clippy with `-W clippy::pedantic` | Passed, no warnings | `/tmp/import-clippy-r3.txt` |

Also ran the direct editor-core typecheck (passed after replacing unsupported `Array.at` in the new test), scoped Biome checks, shell freshness check, and skill validation. The normal commit hook ran formatting/lint checks. No full test sweep was run.

Unexercised assertions: live MCP upload/finalize/readback and persistence/retention of two separate remote documents; source/split screenshot equality for both slides at 1280×720 and 960×540; real-browser clipping, headline injection, local-script fidelity, adapter count and first/last navigation; standalone/PDF visual fidelity. Chromium was not launched, per the known environment restriction. Actual CI execution and Turbo task-hash/cache invalidation could not be exercised because Turbo crashed before producing a dry run. A fresh independent agent rehearsal, including adapter refusal and parser-failure reporting, was not run; the new written-procedure cases were manually adjudicated and the contract hash pin passed. No browser, remote-document, independent-convergence, or merge claim is made.

Final handoff: implementation commit `573ca1cf8` is complete. Committing the verification report failed when Git attempted to create `/Users/andrewnaeve/Code/aidocs/.git/worktrees/presentations-import/index.lock` (Operation not permitted). Only `packages/strata-skill/tests/presentation/import.md` remains modified; its report and this ledger update are preserved. No approval escalation is available in this session.
