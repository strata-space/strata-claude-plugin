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

Before the first write, ask only what the user did not say: the plan name,
the folder for the plan, the repositories the work lands in (at most 4) and
the kinds of agent that do the items (at most 16, such as `backend`). Then
show what you will create and get a yes. Each later write that saves
proposals gets its own yes too.

To add to an existing plan, get its id from the user, read it with
`plan_status`, and go to "Write the items".

## Start: from a StrataSpace document

1. Find the document with `find` and read it with `read_document`.
2. Call `create_plan` with the document as `sourceDocId`, the answers above
   and a fresh idempotency key.
3. Cite the source: put each passage an item comes from in that item's
   `excerpts`, with its text and heading path. Quote the document as it is
   now, and only text that every reader of the document can see. A section
   name in the body is not a citation.

## Start: ad hoc

The user describes the work and names no document.

- If the `create_plan` schema shows `sourceDocId` as optional, create the
  plan with no source. Items carry no excerpt.
- If `sourceDocId` is required, offer to save the user's description as a
  short StrataSpace document with `create_document`, in the folder they
  chose, and use it as the source. Do this only with their yes. Items still
  carry no excerpt: do not write a document only to have text to cite.

## Write the items

1. Draft milestones and every item. Each item has a body that says what to do
   and the traps, and acceptance criteria that a test or a command can check.
2. Call `propose_plan_changes` with `dryRun` true. A dry run saves nothing.
3. Fix each violation in the results and in `validation`.
4. Send the call with `dryRun` false. Use new proposal keys if the payload
   is not byte for byte the payload of the dry run.
5. More than 25 items: write the whole draft as one `strata-plan-draft` code
   block in a StrataSpace document, check it with `validate_plan_draft`, then
   save it with `import_plan_draft` and the `draftHash` of the check. Repeat
   the import with the same hash until `remaining` is 0. That route takes
   items with no excerpt, and names an item that is already saved by its item
   id, not by its proposal key.

## Rules

- Each new edit needs a new `proposalKey`. The same key with changed content
  is refused with `idempotencyKeyReused`, dry runs included.
- A pending add cannot be changed by a new proposal (`staleProposal`).
  Withdraw it with `withdraw_proposal` and propose it again, with each item
  that names it.
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
Per item: body 16 KiB, 20 acceptance criteria of at most 500 characters, 16
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
