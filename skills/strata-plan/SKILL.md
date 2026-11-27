---
name: strata-plan
description: >
  Make a StrataSpace plan (strata.space), ad hoc from a description or from a
  StrataSpace document, and write its items as proposals for a person to
  accept. Use for "make a plan for X", "turn this doc into a plan", "break
  this design into plan items", "add items to my plan", "revise these
  proposals". Needs the plan tools on the StrataSpace MCP connection. No CLI
  required.
---

# StrataSpace plan

Make a plan and write its items. The agent proposes. A person with manage
access to the plan accepts. This skill never accepts a proposal.

The plan tools carry their own rules in their descriptions. Read them, and
follow this skill for the order of calls.

## Prerequisite check

If `create_plan` and `propose_plan_changes` are not in your tool list, stop
and tell the user what the plan tools need:

- Plans must be available on their StrataSpace account.
- The `plans` tool group is on by default while Plans is on. A connection
  that names its groups, with the `X-Strata-Tool-Groups` header or the
  `groups` parameter of the MCP URL, gets only the groups it names: the
  user adds `plans` to the list.
- The sign-in must grant write scope.

Do not edit the MCP config yourself.

## Ask first

Ask only what the user left out. A full request that names what to make (the
plan, its source or description, where it goes) is the yes: go on without
asking again. If you need to ask, ask for these, as the user did not say them:
the plan title (at most 200 characters), the folder for the plan (`folderId`;
without it the plan goes in the user's personal folder), the repositories the
work lands in (at most 4, each with its connection, its repository and 1 to 8
target branches) and the kinds of agent that do the items (at most 16, such
as `backend`, at most 64 characters each). Do not set `supersedes`: an agent
cannot supersede a plan.

A plan with no repositories is allowed. Then every item sends `touches: []`,
because each touch names a `repoId`.

Each later write that saves proposals needs its own yes, unless the user's
request already covered it.

To add to an existing plan, get its id from the user, read it with
`plan_status`, and go to "Write the items".

## Start: from a StrataSpace document

1. When the user gives a document id, read it with `read_document` at once.
   Use `find` only to locate a document the user described. Read the whole
   text: when the answer is an outline or a compressed result, read each
   section until you hold the full text. Never quote or propose from an
   outline.
2. Call `create_plan` with the document as `sourceDocId`, the answers above
   and `idempotency: { key }` with a fresh key. A retry with the same key and
   request returns the same plan.
3. Cite the source: put each passage an item comes from in that item's
   `excerpts`, with its text and heading path. Quote the document as it is
   now, and only text that every reader of the document can see. An excerpt
   with no `docId` cites the one source of the plan that is not purged. It
   answers `sourceUnavailable` only when the plan has no such source or has
   two or more: then name the `docId` on each excerpt. A section name in the
   body is not a citation.

## Start: ad hoc

The user describes the work and names no document. Call `create_plan` with
no `sourceDocId`. The plan has no source, so items carry no excerpt. Do not
write a document only to have text to cite.

## Write the items

Each item has a `kind`, and the kind says how it is done:

- `code`: a change to code. It is done by a merged pull request.
- `decision`: a decision to record. It completes with decision evidence.
- `document`: a change to a document. It completes with a document revision.
- `operations`: work outside code and documents. It completes with link
  evidence.

Steps:

1. Draft milestones and every item. Each item has a body that says what to do
   and the traps, and acceptance criteria that a test or a command can check.
2. Count the items and the milestones. More than 25 items or more than 10
   milestone drafts: use the draft route below, not these steps.
3. Call `propose_plan_changes` with `dryRun` true. A dry run saves nothing.
4. Fix each violation in the results and in `validation`.
5. Send the call with `dryRun` false. Read its result row by row: a row can
   be rejected in the live call even after a clean dry run, for example when
   the source changed. Fix each rejected row, send it again under a new
   `proposalKey`, and report what is saved and what is not.

Draft route: write the whole draft as one `strata-plan-draft` code block in
a StrataSpace document, and check it with `validate_plan_draft`.

1. Read `valid`, `rowProblems`, `rowConflicts` and `capacity` of the check.
   `valid` stays true with `rowConflicts`: a row whose proposal was saved
   before with other content is not saved again. Correct it as the tool
   description says: give the row a new `proposalKey`, or withdraw the saved
   proposal.
2. Save with `import_plan_draft` and the `draftHash` of the check. Repeat the
   import with the same hash until `remaining` is 0.
3. After every import read `conflicts` and `stoppedBy`. `remaining` can be 0
   while `conflicts` holds rows that are not saved. If `stoppedBy` is set,
   stop and report it. Report every conflict.

A row may cite excerpts as in a propose call, and a row with no excerpt is
fine. Inside a draft, name another row of the draft by its `proposalKey`, and
an item already in the plan by its item id. The draft document only carries
the draft: it is not a source of the plan.

## Rules

- Each new edit needs a new `proposalKey`. A dry run saves no key, so the
  live call may reuse the keys of the dry run. Once a proposal is saved, its
  key with changed content is refused with `idempotencyKeyReused`, in a dry
  run too. Proposals are saved one by one: after a live call, give a new key
  to each saved proposal you change.
- A pending add cannot be changed by a new proposal (`staleProposal`).
  Withdraw it with `withdraw_proposal` (`planId`, `proposalId` and the
  `proposalRev` you last read) and propose it again under a new key, with
  each item that names it.
- Name an add of the same call by its `proposalKey`.
- A dependency means "done first". When an item needs what another provides,
  name the capability in `provides` and `needs`.
- A conflict means two items cannot be worked at the same time. A shared
  folder, locale file or registry file is not a conflict. `touches` is a hint
  for conflict detection, not the bound of the work.
- An item cannot depend on an item it also conflicts with (`depAndConflict`).
- When a mock covers an item, name the mock and its frame at the top of the
  item body.
- Traps cover who may call the surface, which tenant each read and write
  belongs to, and what a retry does, not only conventions.
- `schedule: parked` keeps an item out of each claim until an edit sets
  `active`.

## Bounds

25 proposals and 10 milestone drafts per call. A draft holds at most 500
proposals, 50 milestone drafts and 1 MB, and one import saves at most 100.
A plan holds at most 500 live items. Per item: body 16 KiB, 20 acceptance
criteria of at most 500 characters, 16 `touches` of at most 256 characters,
8 excerpts, 32 dependencies, conflicts and needs together, 8 `provides` and
8 `needs`.

## End

Give the user the plan link: the host of the workspace the user works in (the
same host as the StrataSpace MCP server they use), then
`/workspaces?next=%2Fplans%2F<planId>`. Say which host you used. Take the
plan id from `plan.id` of the `create_plan` result, or from the id the user
gave for an existing plan. The link opens the plan page in the user's
workspace. Never link the plan's document. Say that a person with manage
access must accept the proposals before any item can be claimed. Do not
accept them. To work the items, use `strata-plan-work` or `strata-plan-lead`.
