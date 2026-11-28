---
name: strata-plan-lead
description: >
  Run a StrataSpace plan (strata.space) with a team of agents: read what is
  ready, give each ready item to one worker, review, merge, complete, and
  turn findings into proposed edits. Use for "run this plan with a team",
  "lead the plan", "work the plan in parallel", "dispatch the ready items".
  Needs the plan tools on the StrataSpace MCP connection and a host that can
  start worker agents. No CLI required.
---

# StrataSpace plan lead

One lead agent runs a plan with worker agents. Each worker follows
`strata-plan-work`. How code is built, reviewed and merged follows the rules
of your repository and the user's instructions.

The plan is the board. Read state from the plan tools only. Keep no local
file or folder as plan state, and give a worker no copy of an item: it reads
the item from its own claim result.

## Setup

- If `plan_status` and `claim_item` are not in your tool list, tell the user
  they need Plans on their account, the `plans` tool group selected on the
  MCP connection, and read and write scope. Stop.
- Get the plan id from the user. Confirm how many workers to run and which
  agent profiles they take before the first claim.

## The run

1. **Frontier.** `plan_status` with `planId` gives the ready items and the
   next pick for each agent profile, one per profile. With several workers
   of one profile, use `view: full`, or read again after each claim.
2. **Dispatch.** Give each ready item to one worker: the plan id, the item id
   and `strata-plan-work`. The worker claims it with `claim_item` and holds
   its own claim. Never claim an item for a worker. Do not give two workers
   items that conflict.
3. **Report.** After submit, each worker reports the item id, the fence, the
   `rev` of the submit result, the evidence id, the pull request and what it
   tested. Keep these: a submitted item cannot be claimed again.
4. **Review.** Review the pull request as your repository requires. Plans
   records no review: a fix round is only more work on the same pull request.
5. **Merge** the pull request, as your repository and the user allow. Wait
   until the merge shows on `origin`.
6. **Complete.** The holder of the claim attaches the pull request again with
   `state: "merged"`, the merge `sha` and the `base` branch, then completes the
   item with its fence, the `rev` of a new `plan_status` read and the evidence
   id of the merged attach.
   - Workers share your agent identity: you may attach the merged state and
     call `item_complete` with the item id, the fence, the evidence id and the
     `rev` of a new `plan_status` read. Take the item id, fence and evidence id from the
     worker's report. If the worker stopped before it submitted, take over its
     claim with `claim_item`, which answers the same claim. After submit,
     `claim_item` is refused: complete with the reported values.
   - Each worker has its own identity: tell the worker to complete. If that
     worker has stopped, ask a person to revoke the claim, then give the item
     out again.
7. **Next.** Read the frontier again and dispatch. Stop when nothing is
   ready and nothing is in flight.

## Findings for later items

A finding that belongs to a later item becomes a proposed edit of that item
(`propose_plan_changes`, dry run first), or a post in the plan channel when
`channel_post` is in your tool list. Never a local note.

## Stop and ask a person

- Nothing is ready or claimable and you hold no claim. Proposals that wait
  for acceptance are not a reason to stop while an accepted item is ready.
- `claim_next` or `plan_status` reports a waiting state you cannot clear:
  paused, gated, blocked by dependencies, no matching profile, or
  `graphInvalid`.
- A worker reports an item blocked, wrong item text, or an open design
  decision.
- Review finds the item cannot meet its acceptance criteria.
- A claim must be revoked.

## Never

- Accept a proposal. A person with manage access does that.
- Deploy or release. A person does that.
- Complete an item before its work has merged.

Items that are not `code` (`decision`, `document`, `operations`) have no pull
request and no merge: the worker attaches the evidence the kind names and
completes when the work is done.
