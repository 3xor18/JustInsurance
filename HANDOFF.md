# Handoff

## Changes and ownership
**Completed.** The six required behaviours, keeping the public HTTP contract, fixture identities and
the mock provider unchanged.
- **Safe inbound delivery.** `inbound_events` has the primary key (tenant, event). The event row, the
  message and the audit entry are written in one transaction. A replay returns `200 {duplicate:true}`
  and has no effect. The webhook secret is compared in constant time.
- **Customer isolation.** Every read and write is scoped by the actor resolved on the server. A request
  for another organization's ticket returns 404, and a `tenantId` in the body is ignored.
- **Exact approval.** Approval is tied to the draft version. Editing clears it. `approve` also accepts
  the `version` the agent reviewed and returns 409 if the draft changed. A version that was already
  dispatched cannot be re-approved. The exact approved text is what is sent.
- **Honest delivery.** A `PENDING` attempt with a unique `clientRef` is committed *before* the
  provider call (an outbox-style reservation). Afterwards the outcome is classified: 200 with an id →
  `SENT`, 503 → `FAILED` (safe to resend), anything else → `UNKNOWN`. Nothing is retried automatically.
  Two partial unique indexes enforce at most one live attempt per version and one unresolved attempt
  per ticket. `reconcile` looks up the provider by `clientRef`: `delivered` → `SENT` with no resend;
  `not_found` or a failed lookup is recorded as inconclusive. At startup, any `PENDING` attempt
  becomes `UNKNOWN`.
- **Human takeover.** Automation is refused on the server, in the same transaction that would reserve
  the attempt. The refusal is audited. A human can still send an approved reply.
- **Usable handoff.** The API returns `nextAction`, `approved`, attempts (state, origin, `clientRef`,
  provider id) and an audit trail with an actor column. The UI renders all of it with `textContent`
  only. The inbox list shows an unresolved delivery even after the draft is edited.
- **Additions.** Customer text, drafts and attempt bodies are encrypted at rest (AES-256-GCM). There
  are versioned migrations that upgrade a starter `data/` database in place, an operator action
  `mark-undelivered` (UNKNOWN → FAILED, reason required, audited), a Docker image, a before/after
  harness and a generated module graph.

**Proposed, not done.** Provider-side idempotency keys, a reconciliation sweep job, real authentication,
and metrics/alerting.

## Verification
| Command | Result |
|---|---|
| `npm test` | 57 pass, 0 fail (requirements, HTTP contract, security, units, migration, review fixes) |
| `node --test test/requirements.test.mjs` on the baseline commit (`06d7be3`) | 6 pass, 20 fail (red), every requirement reproduced |
| `npm run before-after` | baseline 2/13 scenarios pass, feature 13/13. Report: `docs/before-after/report.html` |
| `docker compose up -d --build` + webhook/draft/approve/send via curl | 200s, delivery `SENT`, one provider delivery |

The before/after battery starts the real mock provider and server for each side. It covers 504, 503,
`accept_then_delay` with a `SIGKILL` mid-send and a restart, overlapping clicks, replay bursts and
cross-tenant probes. Only manually verified: the UI flow in Chrome (screenshots in `docs/screenshots/`).

## Operator instructions
- **UNKNOWN** means the provider may or may not have delivered the message. **Do not** click Send again,
  and do not edit and resend; the server refuses both until the delivery is resolved.
- Use **Check delivery**. If the provider confirms this `clientRef`, the attempt becomes `SENT` without
  a resend. `not_found` is *not* proof of non-delivery, so the state stays `UNKNOWN`.
- If checks stay inconclusive, verify with the provider console or the customer, then use **Mark not
  delivered** with a reason. Only then is a new send allowed. The audit records who decided and why.
- **FAILED** after a 503 is a documented rejection before acceptance, so it is safe to send again.
- **After a restart**, sends that were in flight show as `UNKNOWN` (audit: `recovered_after_restart`).
  Nothing is resent on its own.

## Remaining risks and production plan
This exercise is not production-ready.
- One process with SQLite. The guarantees come from database constraints and synchronous
  transactions, which would carry over to Postgres (`SERIALIZABLE` or unique indexes). Multiple
  instances need a shared database and a lease on startup recovery so it only touches attempts it owns.
- The provider does not deduplicate by `clientRef`, so `mark-undelivered` followed by a resend can
  duplicate a message if the operator is wrong. The human decision is audited, not prevented.
- The encryption key comes from `DESK_DATA_KEY`. Without it, a dev key derived from a fixed passphrase is
  used. Production needs a KMS, key rotation (the envelope is versioned as `enc1`) and searchable hashes.
- Fixture bearer tokens stand in for authentication. Rate limits and an inbound payload size per field
  are also out of scope.
- **Real GHL pilot.** First confirm how GHL deduplicates and whether it supports idempotency keys. Then
  confirm its lookup semantics and delay, and its webhook signature (HMAC) and retry policy, by replaying
  captured payloads in a sandbox. Roll out behind a per-tenant flag. Add metrics and alerts on the count
  and age of `UNKNOWN` attempts, `dispatch_refused` and `duplicate_delivery_detected`. To roll back,
  disable outbound sends per tenant; the attempt ledger keeps state consistent.

## AI use and time
- **Tools.** Claude Code (Anthropic Claude Opus 5.5) as a coding agent, following a role-based pipeline
  that is versioned in `.claude/`. A clean-context adversarial reviewer agent read only the diff and
  the requirements.
- **A suggestion that was changed.** The reviewer showed that an `UNKNOWN` attempt whose lookups keep
  returning `not_found` left the ticket blocked forever. I added the audited, reason-required
  `mark-undelivered` action instead of allowing a blind retry. It is verified by
  `test/review-fixes.test.mjs` ("operator can close an inconclusive delivery…").
- **A suggestion that was rejected.** Retrying with the same `clientRef` on timeout. The provider does
  not deduplicate on it, so a retry could deliver the message twice.
- **Time.** Agent-assisted implementation, tests, harness, Docker and docs: under 1 h wall-clock, measured
  by the commit timestamps (first commit = untouched starter, last commit = this handoff). The candidate's own review and walkthrough preparation is recorded separately:
  _to be completed by the candidate before submission_.
