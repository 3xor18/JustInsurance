# Before / After summary

Requirement tests: baseline 6 pass / 20 fail · feature 26 pass / 0 fail

| ID | Req | Scenario | Before | After |
|---|---|---|---|---|
| S01 | R1 | Same inbound event delivered twice, then five times in parallel | FAIL | PASS |
| S02 | R1 | Same event id for Alpha and Beta is accepted for both | PASS | PASS |
| S03 | R1 | Webhook with a wrong secret | PASS | PASS |
| S04 | R2 | Beta guesses Alpha ticket 101 and adds tenantId=alpha | FAIL | PASS |
| S05 | R3 | Approve, edit, then send without re-approval | FAIL | PASS |
| S06 | R3 | Five overlapping clicks on Send for one approved version | FAIL | PASS |
| S07 | R4 | Provider accepts then times out (504) | FAIL | PASS |
| S08 | R4 | Restart the app after the unknown attempt, then click Send again | FAIL | PASS |
| S09 | R4 | Operator checks delivery (reconcile) | FAIL | PASS |
| S10 | R4 | Provider rejects before accepting (503), then a retry | FAIL | PASS |
| S11 | R4 | App killed while the provider call is in flight, restarted, Send clicked again | FAIL | PASS |
| S12 | R5 | Human takes over, automation tries to send, human sends | FAIL | PASS |
| S13 | R6 | Ticket view tells the operator the next safe action | FAIL | PASS |
| S14 | OPS | Health endpoint and tenant-scoped delivery metrics | FAIL | PASS |
| S15 | R4+OPS | Uncertain delivery, restart with the background reconciler on, no operator action | FAIL | PASS |

Full detail with highlighted deltas: `docs/before-after/report.html`.
