# JustInsurance support-desk work sample

[![ci](https://github.com/3xor18/JustInsurance/actions/workflows/ci.yml/badge.svg)](https://github.com/3xor18/JustInsurance/actions/workflows/ci.yml)

A small support inbox connected to a GHL-like mock provider, made **safe and usable**. Inbound events are
idempotent, organizations are isolated, approval is tied to the exact text, delivery is honest (uncertain
outcomes become `UNKNOWN` and are reconciled, never resent blindly), human takeover blocks automation,
and the inbox tells the agent the next safe action.

- Original assignment: [`docs/ASSIGNMENT.md`](docs/ASSIGNMENT.md) · contract: [`CONTRACT.md`](CONTRACT.md)
- Handoff (what was fixed, checks, operator runbook, risks, AI use): [`HANDOFF.md`](HANDOFF.md)
- Output document: [`docs/output/support-desk-docs.html`](docs/output/support-desk-docs.html)
- Before/after evidence: [`docs/before-after/report.html`](docs/before-after/report.html) · [`report.md`](docs/before-after/report.md)

## Run locally (Node.js 24+, no installation)

```sh
npm run provider     # terminal A: mock provider on 127.0.0.1:4301
npm start            # terminal B: app on http://127.0.0.1:4300
npm run event        # terminal C: post the fixture inbound event (run twice: the replay is ignored)
npm test             # 68 tests
npm run coverage     # same suite with a coverage gate (lines 90 / branches 80 / functions 90)
npm run before-after # black-box battery vs the baseline commit → docs/before-after/report.html
npm run graph        # regenerate the module graph
```

Open http://127.0.0.1:4300 and switch between the Alpha and Beta agents. To try an uncertain delivery:

```sh
curl -X POST http://127.0.0.1:4301/control -H 'Content-Type: application/json' -d '{"mode":"accept_then_timeout"}'
```

Then save, approve and send a draft: the ticket becomes `UNKNOWN`, Send is refused, and **Check delivery**
resolves it to `SENT` without resending. Fresh state: stop both processes and delete `data/`. An existing
`data/` from the original starter is migrated in place on startup.

## Run with Docker

```sh
docker compose up -d --build      # app + mock provider in one container, http://127.0.0.1:4300
docker compose exec desk node -e "fetch('http://127.0.0.1:4301/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'accept_then_timeout'})}).then(r=>r.text()).then(console.log)"
docker compose down               # add -v to drop the data volume
```

The mock provider keeps its loopback-only binding (contract), so both processes run in the same container
and only the app port is published, bound to `127.0.0.1`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `4300` / `127.0.0.1` | app listener |
| `DESK_DB` | `data/desk.sqlite` | app database |
| `PROVIDER_URL` | `http://127.0.0.1:4301` | provider base URL |
| `PROVIDER_TIMEOUT_MS` | `5000` | provider call timeout; a timeout is an `UNKNOWN` outcome |
| `DESK_DATA_KEY` | derived dev key | base64 32-byte key for AES-256-GCM encryption at rest |
| `DESK_WEBHOOK_SECRET` | fixture secret | webhook shared secret |
| `DESK_MAX_BODY_BYTES` / `DESK_MAX_MESSAGE_LENGTH` | `100000` / `5000` | input limits |
| `DESK_RECONCILE_INTERVAL_MS` | `30000` (`0` disables) | background reconciler period for `UNKNOWN` deliveries |
| `DESK_RECONCILE_MAX_BACKOFF_MS` / `DESK_RECONCILE_JITTER_RATIO` | `300000` / `0.2` | exponential backoff cap and jitter per inconclusive attempt |
| `DESK_SHUTDOWN_GRACE_MS` | `10000` | how long SIGTERM waits for in-flight sends before closing |

## API (contract preserved, additive changes only)

All routes from `CONTRACT.md` behave as specified. Additions:
- `GET /api/tickets/:id` also returns `nextAction`, `approved`, attempts with `origin`/`actor`, audit with `actor`.
- `POST /api/tickets/:id/approve` accepts an optional `{ "version": n }`; a stale version returns 409.
- `POST /api/tickets/:id/mark-undelivered` with `{ "reason": "…" }` closes an `UNKNOWN` attempt after
  manual verification (audited), so a resend becomes possible.
- `GET /health` (public): database and background-reconciler status, for container health checks.
- `GET /api/metrics` (authenticated, scoped to the caller's organization): attempts by state, age of the oldest
  unresolved delivery, counts of refused dispatches, duplicates detected, recoveries and confirmations.

## Operations
- **Background reconciler**: every `DESK_RECONCILE_INTERVAL_MS` it looks up `UNKNOWN` deliveries by `clientRef`.
  It only reads provider evidence and never resends; confirmed deliveries become `SENT` (audited as
  `background-reconciler`), inconclusive ones back off exponentially with jitter and are not re-audited each time.
- **Graceful shutdown**: on SIGTERM/SIGINT the server stops accepting requests, waits up to
  `DESK_SHUTDOWN_GRACE_MS` for in-flight sends and the current reconciler run, then closes the database. Anything
  still in flight is recovered as `UNKNOWN` on the next start.
- **Inbox page** is read once at startup and served with an `ETag` (`304 Not Modified` on revalidation).
- **CI** (`.github/workflows/ci.yml`): coverage-gated tests, the before/after battery against the baseline commit
  (report uploaded as an artifact), Docker build and container smoke test.

## Architecture

```
src/
  config/          constants (no magic strings), fixtures, AppConfig (singleton)
  domain/          DeskError, DeliveryStateMachine, SendPolicy (specification),
                   OutcomeClassifier / ReconcileResolver (strategy), NextActionAdvisor
  infrastructure/  SQL, Database (unit of work), Migrator (v1–v5), FieldCipher (AES-256-GCM),
                   repositories, SqlitePersistenceFactory (abstract factory), Logger (singleton)
  application/     InboundWebhookHandler (idempotent receiver), DraftWorkflow,
                   DeliveryDispatcher (outbox-style reservation), DeliveryReconciler,
                   ReconciliationSweeper (backoff + jitter), StartupRecovery,
                   TicketQuery, OperationsQuery (health, metrics)
  http/            ActorResolver, WebhookVerifier (constant-time), Router (command table), IO
  service.mjs      DeskService facade (the adapter from CONTRACT.md)
  server.mjs       createApp() for tests, start() for the process
```

Concurrency is closed by database constraints (primary key on inbound events, partial unique indexes on
attempts) and compare-and-set transitions, not by in-memory locks. See the generated
[module graph](docs/graphs/module-graph.md) and the [blast radius](docs/graphs/blast-radius.md).

## How it was built

A role-based pipeline run with Claude Code, versioned in [`.claude/`](.claude):
detective → cartographer → architect → developer → before/after → scribe, with a plumber for git and a
clean-context adversarial reviewer. The full trail (reproductions, concurrency analysis, ADRs, review
findings) is in [`.claude/cases/JI-SUPPORT-DESK.md`](.claude/cases/JI-SUPPORT-DESK.md). Git history starts
with the untouched starter (`06d7be3`), which is the baseline of the before/after.

## Repository map

| Path | Content |
|---|---|
| `src/`, `public/`, `test/` | application, inbox UI, tests |
| `scripts/before-after/` | black-box battery, baseline worktree runner, HTML/Markdown report |
| `scripts/graph/` | module graph generator |
| `scripts/docker/`, `Dockerfile`, `docker-compose.yml` | container setup |
| `.github/workflows/ci.yml` | continuous integration |
| `docs/` | assignment, output document, before/after report, graphs, screenshots |
| `.claude/` | pipeline, role agents, case file |
