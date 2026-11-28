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
  tool group (on by default while Plans is on; a connection that names its
  groups must list `plans`), and read and write scope. Stop.
- Get the plan id from the user. Never guess it. An item id is optional.
- Before the first claim, confirm the plan and the item or agent profile with
  the user. A lead's or user's explicit request to work a named item counts as
  that confirmation.
- The plan's sources are in `plan_status` with `view: full`, in `plan.sources[]`
  (the summary view shows only how many there are). The passages an item is cut
  from are its anchors in the claim result.

## The loop

1. **Claim.** `claim_next` with `planId`, `agentProfile` (the `agent` the
   items name, such as `backend`) and `idempotency: { key }`, or `claim_item`
   with `itemId` and `idempotency: { key }` for a named item. After a timeout,
   repeat the call with the same key, and start work only when the receipt
   shows `liveness` `live`. `submitted` means you submitted already: go to
   Complete with the values you kept. Any other liveness means the claim is
   gone: stop.
2. **Read.** The result holds the item: body, acceptance criteria, `rev`,
   anchors. Read `previousClaimEnd` first: it says why the last claim ended. Read each document and design section the
   item names. If one cannot be found, ask, and see "While you wait".
3. **Work** until the acceptance criteria are met. When a later answer
   carries `sinceClaim` with `workChanged` true, read the item again with
   `plan_status` and `itemId` before you go on.
4. **Attach.** Open the pull request, then call `item_attach_evidence` with
   the fence and `evidence` `{ kind: "pullRequest", repo, number, url }`, where
   `repo` is `{ provider, repoId, fullName }`. The pull request is open until
   you report another state. The answer names the `evidenceId`.
5. **Submit.** `item_submit` with the fence, `rev` (the `item.rev` of the
   latest answer that returned the item: `result.item.rev` for a command
   answer, `item.rev` for `plan_status` with `itemId`) and
   `evidence: [evidenceId]`. Keep the `rev` of the submit result, the fence and
   the evidence id: a submitted item cannot be claimed again, and `plan_status`
   with `heldBy: me` no longer lists it.
6. **Merge.** The merge follows the rules of your repository. Wait until it
   shows on `origin`. Never complete before the work has merged.
7. **Complete.** Attach the pull request again with `item_attach_evidence`,
   with the same `repo` and `number`, `url` and
   `state: { kind: "merged", sha, base }`, where `sha` is the merge commit and
   `base` is the branch it merged into. The entry the item holds takes the new
   state. Then read the item again with `plan_status` and `itemId`, and call
   `item_complete` with the same fence, the `rev` of that read and the evidence
   id of the pull request. The `rev` can come from the latest answer that
   returned the item, such as the attach answer: read again only when another
   party could have changed the item. If it answers `evidenceRequired`, the
   item has no pull request that delivers it and shows merged: attach it with
   the merged state and try again.
8. **Next.** `claim_next` with a new idempotency key. Stop when it answers
   `empty`.

The steps above are for a `code` item. A `decision`, `document` or
`operations` item has no pull request and no merge: attach evidence that
matches the kind, and complete when the work is done. Completion needs the
evidence of the item's kind, in addition to any evidence the item body asks
for. When the work has no natural link, an `operations` item takes the link of
the plan page, the web address where the user opens StrataSpace (for most users
`https://app.strata.space`) followed by
`/workspaces?next=%2Fplans%2F<planId>`:

- `decision`: `{ kind: "decision", text }`
- `document`: `{ kind: "documentRevision", docId, revision, note? }`
- `operations`: `{ kind: "link", url, note? }`

A non-code item has no submit: complete it. "Stop after submit" applies only
to a code item.

When a lead gave you a code item, stop after submit and report to the lead: the
item id, the fence, the `rev` of the submit result, the evidence id and the
pull request. Attach the merged state and complete when the lead says the work
has merged.

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
- After a restart, `plan_status` with `heldBy: me` lists the items you still
  work. `claim_item` on an item you hold answers the same claim. An item you
  submitted is not listed and cannot be claimed. Complete it
  with the fence, `rev` and evidence id you kept.
- `empty` with `planComplete` means done only if `counts.pendingAdds` of
  `plan_status` is 0. Above 0, items wait for a person to accept them, so the
  plan is not done: say so. `graphInvalid` means the plan needs a fix: ask a person. The
  other reasons are waiting states: report the reason.

## Idempotency keys

1 to 128 characters of letters, digits, `.`, `_`, `:` and `-`. Use
`<handle>.<runId>.<call>.<n>` with a fresh `runId` per run. Reuse a key only
to repeat the same call after a timeout. The same key with a different
request is refused with `idempotencyKeyReused`.

## Findings for other items

A finding that belongs to a later item goes into the plan: propose an
edit of that item with `propose_plan_changes`, or post it in the plan
channel (`planChannel` of the claim result) when `channel_post` is in your
tool list. Never keep it in a local note.

## When the item does not finish

- Blocked: `item_report_blocked` with the fence and why. The claim stays
  live. If you stop, call `item_release` with the fence and a reason, so the
  item does not stay stranded.
- Giving up: `item_release` with the fence and a reason.
- Report what happened, then claim the next item or stop, as the user asked.

## While you wait

When you wait for an answer from a person, keep the claim if you will go on
in this run, and say so. If you end the run without the answer, release the
item with `item_release` and a reason that says what you wait for.

Evidence limits: at most 16 ids on submit and 4 on complete.
