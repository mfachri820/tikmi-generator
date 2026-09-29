# IRA PJP Web App

Build plan: `../IRA PJP Web App — Build Plan.md`. This repo implements it in roadmap order, starting at Phase 0.

## Layout

```
apps/web           Next.js app: UI and API routes
apps/collab        Hocuspocus server (Yjs co-editing, snapshots in packages/db)
packages/scoring   Pure TypeScript scoring engine; weights/thresholds/cell refs come from config, never hard-coded
packages/template  Template layout extraction, input-cell read/write, ExcelJS writer
packages/db        Drizzle schema and Postgres client
scripts/           extract-template, import-2026-responses, golden-test runner
```

## Setup

```bash
npm install
docker compose up -d postgres   # local Postgres for development
cp .env.example .env            # fill in DATABASE_URL, etc.
npm run dev                     # apps/web on http://localhost:3000
```

Run a workspace's own scripts with `npm run <script> -w @ira/<name>` (e.g. `npm run test -w @ira/scoring`).

`apps/web` runs Next.js with `--webpack`: Turbopack's native binary (`@next/swc-win32-x64-msvc`) fails to load on at least one Windows dev machine used for this project ("not a valid Win32 application" despite a correctly sized download). If that's fixed upstream or on your machine, drop the flag.

## Ground rules

- Never commit PJP workbooks or form data. Tests and scripts read fixtures from the path in `IRA_FIXTURES_DIR`, which is never set in this repo.
- No 2026 numbers in code: weights, thresholds and cell addresses live in template-version config (JSON), not in `packages/scoring` or `packages/template`.
- Port the logic of the template's `LET`/`XLOOKUP` formulas into TypeScript; do not add a JS formula engine (see the build plan's "Alternatives considered").
- Phase 0 gate: for all 66 fixture files, `packages/scoring` must reproduce the cached rekap values (A2 `F60:F71`, `R60:R71`, `S60:S71`) and KPMR `H46`/`J46` to 2 decimals. `scripts/golden-test.ts` extracts the cached baseline; the engine-vs-baseline diff still needs the real 2026 scoring config (an open decision in the build plan).
- Every write to an input cell goes through one function that records user, old value, new value and reason in `audit_log`.
- Locate spreadsheet columns by header text, not by letter — one 2026 file has an extra column that shifts pengawas scores from `O` to `P`. `packages/template`'s `findColumnByHeader` does this.
- UI labels in Bahasa Indonesia, taken from the template; code and comments in English.

## Status

Phase 0 scaffold: monorepo layout, the scoring engine's pipeline (parameter shares → category scores → inherent predikat, KPMR pillar averages → predikat, final IRA lookup), the template package's layout extraction and safe input-cell writer, the Drizzle schema for the full data model, and script stubs for template extraction, response backfill and the golden-test runner. No UI yet, no real 2026 config yet — both need the open decisions in the build plan resolved first (template version, field mappings, weights/thresholds).
