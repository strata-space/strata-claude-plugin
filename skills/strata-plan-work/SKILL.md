---
name: strata-plan-work
description: >
  Take one item of a StrataSpace plan (strata.space) and finish it: claim it,
  do the work, attach the pull request, submit, complete, then take the next.
  Use for "work the next plan item", "take item X of my plan", "pick up the
  next item for backend", or when given a plan id or an item id to work.
  Needs the plan tools on the StrataSpace MCP connection. No CLI required.
---

# StrataSpace plan work

Claim an item, finish it, claim the next. This skill covers the plan only.
How you build, test, review, commit and merge follows the rules of your
repository and the user's instructions.

The plan is the board. The item text is the claim result: work from it, not
from a copy. Keep no local file as plan state.

## Setup

- If `claim_next` is not in your tool list, the plan tools are not on this
  connection. Tell the user they need Plans on their account, the `plans`
  tool group selected on the MCP connection, and write scope. Stop.
- Get the plan id from the user. Never guess it. An item id is optional.
- Before the first claim, confirm the plan and the item or agent profile with
  the user.

## The loop

1. **Claim.** `claim_next` with `planId`, `agentProfile` (the `agent` the
   items name, such as `backend`) and a fresh idempotency key, or
   `claim_item` for a named item.
2. **Read.** The result holds the item: body, acceptance criteria, `rev`,
   anchors. Read `previousClaimEnd` first: it says why the last claim ended
   and what the last review found. Read each document and design section the
   item names. If one cannot be found, ask, and see "While you wait".
3. **Work** until the acceptance criteria are met. When a later answer
   carries `sinceClaim` with `workChanged` true, read the item again with
   `plan_status` and `itemId` before you go on.
4. **Cite.** When the claim result has `citeInPullRequests`, put that text in
   the pull request body exactly as given.
5. **Attach.** Call `item_attach_evidence` with the pull request. In a
   repository the plan binds, the cited pull request may already be attached
   for you, and the call then answers `alreadyApplied`. Both answers name the
   `evidenceId`.
6. **Submit.** `item_submit` with the fence, the `rev` you last read and the
   evidence id. The item goes to review. Keep the `rev` of the submit result.
7. **Complete.** After the pull request merges, read the item again with
   `plan_status` and `itemId`, then call `item_complete` with the same fence,
   the `rev` of that read and the evidence id. Never complete before the work
   has merged. If it answers `evidenceRequired`, attach the pull request with
   `item_attach_evidence` and try again, or try again after a short wait. If
   an answer says `completedByMerge`, the item is already done.
8. **Next.** `claim_next` with a new idempotency key. Stop when it answers
   `empty`.

The steps above are for a `code` item. A `decision`, `document` or
`operations` item has no pull request and no merge: attach the evidence its
kind names, such as a link, and complete when the work is done.

When a lead gave you the item, stop after submit and report to the lead: the
item id, the fence, the `rev` of the submit result, the evidence id and the
pull request. Complete when the lead says the work has merged.

## Claims

- The fence is `{ claimId: receipt.claim.id, epoch: receipt.claim.epoch }`.
  Send it on every command for the item.
- Only the holder completes or releases its claim.
- A refusal arrives as JSON in the tool error, `{ error, reason: { kind } }`.
  Act on `reason.kind`, not on the wording.
- A lost claim (`claimSuperseded`): stop work on the item. Never retry with
  the old fence.
- On `itemRevised`, read the item again, check the change against your work,
  and resend with the new `rev`.
- After a restart, `plan_status` with `heldBy: me` lists your claims.
  `claim_item` on an item you hold answers the same claim.
- `empty` with `planComplete` means done only if `plan_status` shows
  accepted items. If none are accepted, say a person must accept the
  proposals. `graphInvalid` means the plan needs a fix: ask a person. The
  other reasons are waiting states: report the reason.

## Idempotency keys

1 to 128 characters of letters, digits, `.`, `_`, `:` and `-`. Use
`<handle>.<runId>.<call>.<n>` with a fresh `runId` per run. Reuse a key only
to repeat the same call after a timeout. The same key with a different
request is refused with `idempotencyKeyReused`.

## Findings for other items

A review finding that belongs to a later item goes into the plan: propose an
edit of that item with `propose_plan_changes`, or post it in the plan
channel (`planChannel` of the claim result) when `channel_post` is in your
tool list. Never keep it in a local note.

## When the item does not finish

- Blocked: `item_report_blocked` with the fence and why.
- Giving up: `item_release` with the fence and a reason.
- Report what happened, then claim the next item or stop, as the user asked.

## While you wait

When you wait for an answer from a person, keep the claim if you will go on
in this run, and say so. If you end the run without the answer, release the
item with `item_release` and a reason that says what you wait for.

Evidence limits: at most 16 ids on submit and 4 on complete.
