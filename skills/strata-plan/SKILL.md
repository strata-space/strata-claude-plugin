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
- The MCP connection must select the `plans` tool group, with the
  `X-Strata-Tool-Groups` header or the `groups` parameter of the MCP URL, as
  the server's instructions say. The default groups do not include it.
- The sign-in must grant write scope.

Do not edit the MCP config yourself.

## Ask first

Before the first write, ask only what the user did not say: the plan title
(at most 200 characters), the folder for the plan (`folderId`; without it the
plan goes in the user's personal folder), the repositories the work lands in
(at most 4, each with its connection, its repository and 1 to 8 target
branches) and the kinds of agent that do the items (at most 16, such as
`backend`, at most 64 characters each). Do not set `supersedes`: an agent
cannot supersede a plan. Then show what you will create and get a yes. Each later write that saves
proposals gets its own yes too.

To add to an existing plan, get its id from the user, read it with
`plan_status`, and go to "Write the items".

## Start: from a StrataSpace document

1. Find the document with `find` and read it with `read_document`.
2. Call `create_plan` with the document as `sourceDocId`, the answers above
   and `idempotency: { key }` with a fresh key. A retry with the same key and
   request returns the same plan.
3. Cite the source: put each passage an item comes from in that item's
   `excerpts`, with its text and heading path. Quote the document as it is
   now, and only text that every reader of the document can see. When the
   plan has two or more sources, name the `docId` on each excerpt, or it
   answers `sourceUnavailable`. A section name in the body is not a
   citation.

## Start: ad hoc

The user describes the work and names no document. Call `create_plan` with
no `sourceDocId`. The plan has no source, so items carry no excerpt. Do not
write a document only to have text to cite.

## Write the items

1. Draft milestones and every item. Each item has a body that says what to do
   and the traps, and acceptance criteria that a test or a command can check.
2. Count the items. More than 25: use the draft route below, not these
   steps.
3. Call `propose_plan_changes` with `dryRun` true. A dry run saves nothing.
4. Fix each violation in the results and in `validation`.
5. Send the call with `dryRun` false.

Draft route, for more than 25 items: write the whole draft as one
`strata-plan-draft` code block in a StrataSpace document, check it with
`validate_plan_draft`, then save it with `import_plan_draft` and the
`draftHash` of the check. Repeat the import with the same hash until
`remaining` is 0. If an answer carries `stoppedBy`, stop and report it. A row may
cite excerpts as in a propose call, and a row with no excerpt is fine. Inside a draft, name another row of the draft by its
`proposalKey`, and an item already in the plan by its item id. The draft
document only carries the draft: it is not a source of the plan.

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
criteria of at most 500 characters, 16
`touches` of at most 256 characters, 8 excerpts, 32 dependencies, conflicts
and needs together, 8 `provides` and 8 `needs`.

## End

Give the user the plan link,
`https://app.strata.space/workspaces?next=%2Fplans%2F<planId>`, with the plan
`id` from the `create_plan` result. It opens the plan page in the user's
workspace. Never link the plan's document. Say that a
person with manage access must accept the proposals before any item can be
claimed. Do not accept them. To work the items, use `strata-plan-work` or
`strata-plan-lead`.
