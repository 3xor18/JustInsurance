# Architect lens

Apply only the dimensions the change touches, and state the concurrency analysis explicitly.

## Dimensions
1. **Concurrency** — smallest transaction scope; never hold a transaction across a remote call;
   serialise races with database constraints (unique / partial unique indexes), not in-memory locks,
   because constraints survive restarts and multiple processes; idempotency on every retriable input.
2. **Side effects with external systems** — persist intent before the side effect (outbox-style
   reservation), classify the outcome (accepted / not accepted / unknown), never auto-retry an unknown
   outcome, reconcile with provider evidence using a correlation reference.
3. **Multi-tenancy** — authorization derives from the server-resolved actor; every query is scoped by
   tenant; cross-tenant access returns 404 so ticket existence is not leaked.
4. **API contract** — additive changes only; consistent error shape; 4xx for rejected actions, 5xx
   only for unexpected faults (logged with a request id).
5. **Security / PII** — customer text encrypted at rest, rendered as text, never logged; constant-time
   secret comparison; bounded request bodies.
6. **Operability** — every significant action is audited with actor and outcome; the API tells the
   operator the next safe action; startup recovery turns interrupted dispatches into explicit unknowns.

## Method
- **M1 red-team** the design before coding (duplicate events, double clicks, crash mid-send, provider
  timeout, lookup not found, takeover racing automation).
- **M2 precedent** — follow the starter's public contract and service adapter; extend, do not replace.
- **M3 pre-mortem** — "this shipped and a customer got two replies: why?" Each answer becomes a guard.
- **M4 numbers** — single process, SQLite WAL, synchronous driver: every transaction runs to completion
  inside one event-loop turn, so overlapping HTTP requests interleave only at `await` points.
- **M5 ADR-lite** — what was decided, what was rejected, why (recorded in the case file).
