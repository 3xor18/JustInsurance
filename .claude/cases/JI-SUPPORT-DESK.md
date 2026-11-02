# JI-SUPPORT-DESK — Make the support-desk reply workflow safe and usable
Type: feature + bugs · Status: closed (exercise) · Baseline: `06d7be3`

## 0. Intake
- Requirements: `docs/ASSIGNMENT.md` (six required behaviours), contract: `CONTRACT.md`.
- Triage: code touches every shared path (webhook, send, reconcile, schema) → full pipeline.
- Definition of Ready: requirements explicit, fixtures given, no UI design needed beyond the starter.

## 1. Detective {repro, root_cause, code_vs_data, red_tests}
All defects are code bugs. Reproduced with a throwaway script against the baseline before any change:

| Req | Reproduction on baseline | Root cause (baseline file) |
|---|---|---|
| R1 | same event twice → 2 messages | `service.receiveWebhook` inserts blindly; no (tenant, event) uniqueness, no transaction |
| R2 | Beta `GET /api/tickets/101` → 200 with Alpha data | `service.row()` looks up by id only; `actor` ignored |
| R3 | approve v1, edit v2, send → v2 delivered | `updateDraft` keeps `approved_version`; `sendReply` checks only `!= null` |
| R3 | 2 parallel sends → 2 provider deliveries | no reservation before `await provider.send` |
| R4 | 504 → retried with a new clientRef (2 deliveries), nothing persisted, error 502 | retry loop with `randomUUID()` per try; no attempt row; `reconcile` returns 501 |
| R5 | handoff then `/automation` → delivered | `automatic` flag only affects the audit text |
| R6 | audit is raw JSON, no next action, no actor column | starter UI |

Red tests: `test/requirements.test.mjs` → baseline 6 pass / 20 fail (the 6 passes are guards the starter
already honoured and must keep honouring).

## 2. Cartographer — blast radius {nodes, tables, confidence, test_list}
See `docs/graphs/blast-radius.md` (entry point → use case → table, confidence "sure" for all) and the
generated `docs/graphs/module-graph.md`. Shared-table coupling: `attempts` has three writers
(dispatcher, reconciler, startup recovery). `test_list` = scenarios S01–S13 in
`scripts/before-after/scenarios.mjs`, one or more per entry point and per failure mode.

## 3. Architect {strategy, concurrency, red_team, pre_mortem, adr}
Strategy (patterns chosen only where they remove a risk):
- **Idempotent receiver** — `inbound_events(tenant_id, event_id)` primary key; insert-or-ignore + message + audit in one transaction.
- **Outbox-style reservation** — attempt row (`PENDING`, unique `clientRef`) committed before the provider call; settle afterwards with compare-and-set.
- **State machine** — `DeliveryStateMachine` validates every attempt transition.
- **Specification** — `SendPolicy` (draft present, approved, approval current, takeover, no unresolved attempt, version not dispatched).
- **Strategy** — `OutcomeClassifier` (503 → FAILED, everything else uncertain → UNKNOWN), `ReconcileResolver` (delivered → SENT, not_found/error → inconclusive).
- **Repository + Abstract Factory** — `PersistenceFactory` / `SqlitePersistenceFactory`; **Unit of Work** — `Database.transaction` (BEGIN IMMEDIATE, rejects async work).
- **Singleton** — `AppConfig`, `Logger`. **Command** — router table of ticket actions. **Facade** — `DeskService` keeps the contract adapter.
- **Encryption at rest** — AES-256-GCM envelope for messages, drafts and attempt bodies; constant-time webhook secret check.

Concurrency analysis: node:sqlite is synchronous, so each transaction completes within one event-loop
turn; overlapping HTTP requests interleave only at `await` (provider calls). Races and their guards:
duplicate webhook → primary key; double send → reservation inside one transaction + partial unique
indexes `attempts(ticket_id, version) WHERE state <> FAILED` and `attempts(ticket_id) WHERE state IN
(PENDING, UNKNOWN)`; reconcile vs settle → compare-and-set, loser audits `settlement_skipped`; takeover vs
automation → owner checked in the same transaction that reserves; crash between reserve and settle →
startup recovery turns `PENDING` into `UNKNOWN`; edit during in-flight send → send state updated only
if the attempt version is still current and the read model overlays unresolved attempts.

Red team (M1) / pre-mortem (M3) — "a customer got two replies": retry on timeout (removed), new clientRef
per retry (single reserved ref), edit-and-resend while unknown (blocked by unresolved rule), restart
during send (recovery), reconcile `not_found` treated as "not sent" (inconclusive by design).

ADR-lite:
1. Constraints over in-memory locks — survive restarts and multiple processes. Rejected: mutex map (lost on crash).
2. No automatic retry of UNKNOWN — provider has no dedup on clientRef. Rejected: retry with same ref (would duplicate).
3. Operator escape hatch `mark-undelivered` (UNKNOWN → FAILED, reason required, audited) — added after review; avoids permanently blocked tickets without a blind resend.
4. Additive API only — new fields (`nextAction`, `approved`, attempt/audit columns) and two optional inputs (`approve.version`, `mark-undelivered.reason`).

## 4. Developer {diff_map, tests, self_review}
`src/config` (constants, fixtures, singleton config) · `src/domain` (errors, state machine, send policy,
classifiers, next action) · `src/infrastructure` (SQL, Unit of Work, migrations v1–v5, cipher,
repositories, factory, logger) · `src/application` (webhook, drafts, dispatcher, reconciler, recovery,
query) · `src/http` (auth, IO, router) · `src/server.mjs`, `src/service.mjs`, `src/provider-client.mjs`
(timeout via AbortSignal) · `public/index.html`. 57 tests across requirements, HTTP, security, units,
migration and review fixes.

## 5. Before/After {scenarios, baseline_result, feature_result, unexpected_deltas}
`npm run before-after` → `docs/before-after/report.html`. Baseline: 2/13 scenarios pass (S02, S03 —
unchanged behaviour, still pass). Feature: 13/13. Every delta is an intended fix; no unexpected deltas.

## 6. Scribe {output_doc, ac_matrix, handoff}
`docs/output/support-desk-docs.html`, `HANDOFF.md`, `README.md`.

## Adversarial review (clean context)
Findings and resolution: stale approval across tabs → `approve {version}` + UI unsaved-change guard;
permanently blocked UNKNOWN → `mark-undelivered`; inbox list hiding UNKNOWN → effective state in list;
re-approve after send → refused; legacy `enc1:` plaintext → decrypt fallback; `null` JSON body → 400;
numeric-string `ticketId` → accepted; state literals in SQL → derived from constants / bound parameters.

## Close
- [x] tests green (57) · [x] red on baseline (20 failing) · [x] before/after 13/13 · [x] Docker build and run verified
- [x] concurrency analysis written · [x] adversarial review addressed · [ ] production readiness — explicitly not claimed (see HANDOFF)
