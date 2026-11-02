# Delivery pipeline (multi-role, senior + architect)

This repository was built with a role-based pipeline run inside Claude Code. Each role appends a typed
section to a single case file (`.claude/cases/JI-SUPPORT-DESK.md`), which is the source of truth and
the resume point. No role re-derives what the previous role already established.

```
DETECTIVE ──► CARTOGRAPHER ──► ARCHITECT ──► DEVELOPER ──► BEFORE/AFTER ──► SCRIBE
                                   ▲              │               │
                                   └── red-team ──┘◄── broken ────┘        PLUMBER (git) between steps
                                                     endpoint
```

| Role | Agent file | Output (typed handoff) |
|---|---|---|
| Detective | `agents/detective.md` | reproduction per defect, root cause, code-bug vs data-bug, red tests |
| Cartographer | `agents/cartographer.md` | blast radius: 100% of routes/functions/tables touched, confidence, `test_list` |
| Architect | `agents/architect.md` | strategy through `ARCHITECT-LENS.md`, explicit concurrency analysis, ADR-lite |
| Developer | `agents/developer.md` | minimal diff mapped 1:1 to the plan, red-green tests, self-review |
| Before/After | `agents/before-after.md` | same scenario battery against baseline and feature, semantic diff report |
| Scribe | `agents/scribe.md` | output document, AC → evidence matrix, HANDOFF |
| Plumber | `agents/plumber.md` | branch hygiene, atomic commits, worktrees for the before/after |
| Adversarial reviewer | `agents/adversarial-reviewer.md` | clean-context review of the diff against the acceptance criteria |

## Fixed rules
1. Reproduce before theorising. Every defect gets a failing test before the fix (red → green).
2. The blast radius decides what the before/after battery exercises, not memory.
3. Assert semantics (provider ledger, database state), never only `200 OK`.
4. Concurrency and idempotency are declared explicitly by the architect, not implied.
5. Definition of Done: tests green, before/after report shows every requirement fixed and nothing
   else changed, output document and handoff complete, adversarial review addressed.
6. Never claim production readiness. Unknowns are written down as risks with the next fix.

## Optimisations used
- Typed handoffs and pointers instead of prose dumps (token economy).
- Before/after runs the baseline commit in a git worktree and the feature branch side by side, with
  isolated databases per run, and a script that reports only the deltas (highlighted in yellow).
- Generated module graph (`npm run graph`) so the blast radius is recomputed from code, not recalled.
