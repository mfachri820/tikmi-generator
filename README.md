# IRA PJP Web App

Build plan: `../IRA PJP Web App — Build Plan.md`. This repo implements it in roadmap order, starting at Phase 0.

## Layout

```
apps/web           Next.js app: UI and API routes
apps/collab        Hocuspocus server (Yjs co-editing, snapshots in packages/db)
packages/scoring   Pure TypeScript scoring engine; weights/thresholds/cell refs come from config, never hard-coded
packages/template  Template layout extraction, input-cell read/write, ExcelJS writer
packages/db        Drizzle schema and Postgres client
scripts/           extract-template, import-2026-responses, golden-test runner, template-roundtrip-spike
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
- No 2026 numbers in `packages/scoring/src` or `packages/template/src`: the engine logic there is generic. The actual 2026 weights/thresholds/cell refs live in `packages/scoring/config/2026.ts`, reverse-engineered from the template's own formulas. That file is template structure, not PJP data, so it's fine to commit — unlike anything read from `IRA_FIXTURES_DIR`.
- Port the logic of the template's `LET`/`XLOOKUP` formulas into TypeScript; do not add a JS formula engine (see the build plan's "Alternatives considered").
- Phase 0 gate: for all 66 fixture files, `packages/scoring` must reproduce the cached rekap values (A2 `F60:F71`, `R60:R71`, `S60:S71`) and KPMR `H46`/`J46` to 2 decimals. **Status: 65/66 pass exactly.** Run it yourself with `IRA_FIXTURES_DIR="<path to the 01. raw data penilaian PJP LR folder>" npx tsx scripts/golden-test.ts`. The one failure is the file the build plan already flags (777111112, PT Omnipay Transfer Dana): it has a genuinely malformed layout — an extra column shifted through the *entire* rekap block (not just the leaf pengawas scores) plus a skipped column inside the predikat matrix — unique to that one file, not a gap in the engine or config.
- Every write to an input cell goes through one function that records user, old value, new value and reason in `audit_log`.
- Locate spreadsheet columns by header text, not by letter — one 2026 file has an extra column that shifts pengawas scores from `O` to `P`. `packages/template`'s `findColumnByHeader` does this; `scripts/golden-test.ts` does its own header-based lookup for the same reason.
- UI labels in Bahasa Indonesia, taken from the template; code and comments in English.

## Status

Phase 0's scoring-parity risk is effectively cleared: `packages/scoring/config/2026.ts` encodes the real 2026 weights, thresholds and the final-IRA matrix (reverse-engineered from the template's formulas, identical across all 66 fixtures), and the engine reproduces the cached values in 65/66 files exactly, with the 66th being a known malformed source file rather than a logic gap.

The **template export round-trip spike** also passed: `scripts/template-roundtrip-spike.ts` opens a real fixture, snapshots its styles/merges/data validations/conditional formatting/defined names/column widths/row heights/freeze panes/hidden-sheet states, writes one input cell through `fillTemplate`, re-opens the output, and diffs. Run against 3 fixtures (a plain one, the drifted PT Omnipay file, and one with a real pengawas override) — **0 differences** every time; formulas and their cached results are untouched. Run it yourself with `IRA_FIXTURES_DIR="<path>" npx tsx scripts/template-roundtrip-spike.ts [optional-specific-file.xlsx]`.

Both Phase 0 spikes are now cleared. Still open before moving to the UI:
- The scoring config's `share` inputs are currently read directly from each fixture's cached `C2` cells (proving the A2/KPMR porting is correct). Computing those shares from raw form answers (the `C2` sheet's own formulas, and the field mappings from Google Form question IDs) is separate, later work for the "Generate" workflow.
- No UI yet.
