# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is
A fictional support-desk work sample: Node.js 24, zero npm dependencies, built-in SQLite. The public HTTP
contract and the mock provider semantics in `CONTRACT.md` must be preserved.

## Commands
- `npm run provider` · `npm start` · `npm run event` · `npm test` · `npm run coverage` (gate 90/80/90)
- `npm run before-after` — black-box battery against the baseline commit (worktree) and HEAD → `docs/before-after/`
- `npm run graph` — regenerates `docs/graphs/module-graph.md`
- `docker compose up -d --build` — app + mock provider in one container on `127.0.0.1:4300`

## Architecture (dependencies point inward)
`http` → `application` → `domain`; `infrastructure` sits behind repositories built by
`SqlitePersistenceFactory`; `config` holds constants, fixtures and the `AppConfig` singleton.
`DeskService` is the facade that keeps the adapter described in `CONTRACT.md`.

## Rules for changes
1. Follow the pipeline in `.claude/pipeline/PIPELINE.md`; record work in `.claude/cases/<CASE>.md`.
2. Reproduce first, write the red test, then fix. Run `npm test` and `npm run before-after`.
3. No comments in `src`, no inline magic strings in logic (use `src/config/constants.mjs`), no nested loops.
4. Every race is closed by a database constraint or a compare-and-set update, never by an in-memory lock.
5. Never auto-retry an uncertain provider outcome. Never log customer text.
6. API changes are additive only.
