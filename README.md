# IRA PJP Web App

Build plan: `../IRA PJP Web App — Build Plan.md`. This repo implements it in roadmap order, starting at Phase 0.

**Hosting: Vercel + a cloud Postgres** (decided 2026-10-01; this replaces the build plan's on-prem Docker/MinIO setup). Nothing in the app may depend on a local filesystem: the template lives in Postgres (`template_versions.xlsx_base64`) and exports are generated in memory. Docker Compose is only for local development.

## Layout

```
apps/web           Next.js app: UI and API routes
apps/collab        Hocuspocus server (Yjs co-editing, snapshots in packages/db)
packages/scoring   Pure TypeScript scoring engine; weights/thresholds/cell refs come from config, never hard-coded
packages/template  Template layout extraction, input-cell read/write, ExcelJS writer
packages/db        Drizzle schema and Postgres client
packages/ltdbb     LTDBB transaction workbook parser, per-year aggregation, import (sha256-deduped snapshots)
scripts/           seed-dev, import-ltdbb, verify-ltdbb, golden-test, refresh-layout, template-roundtrip-spike, ...
```

## Setup

```bash
npm install
docker compose up -d postgres              # local Postgres for development (host port 5434, see below)
cp .env.example .env                       # fill in DATABASE_URL, IRA_FIXTURES_DIR, FORM_INGEST_SECRET
npm run generate -w @ira/db                # generate a migration from packages/db/src/schema.ts (first run only, or after a schema change)
npm run migrate -w @ira/db                 # apply migrations
npm run seed-dev                           # template (from a real fixture), period, 85 PJP, field_mappings, a demo workbook, then the default LTDBB import
npm run verify-ltdbb                       # optional: check the LTDBB import against the template's own 2025 Validasi sheet
npm run dev                                # apps/web on http://localhost:3000, then open /workbook
```

`docker-compose.yml`'s Postgres is mapped to host port **5434**, not the default 5432 -- a dev machine used for this project already has another project's Postgres container bound to 5432. `DATABASE_URL` and `drizzle.config.ts`'s fallback both already point at 5434.

Run a workspace's own scripts with `npm run <script> -w @ira/<name>` (e.g. `npm run test -w @ira/scoring`).

`apps/web` runs Next.js with `--webpack`: Turbopack's native binary (`@next/swc-win32-x64-msvc`) fails to load on at least one Windows dev machine used for this project ("not a valid Win32 application" despite a correctly sized download). If that's fixed upstream or on your machine, drop the flag.

## Ground rules

- Never commit PJP workbooks, form data or LTDBB data. Tests and scripts read fixtures from the path in `IRA_FIXTURES_DIR`, which is never set in this repo; root-level `*.xlsx` (the LTDBB file) is gitignored.
- No 2026 numbers in `packages/scoring/src` or `packages/template/src`: the engine logic there is generic. The actual 2026 weights/thresholds/cell refs live in `packages/scoring/config/2026.ts` (A2/KPMR) and `packages/scoring/config/2026-c2.ts` (C2's share formulas), reverse-engineered from the template's own formulas. Those files are template structure, not PJP data, so they're fine to commit — unlike anything read from `IRA_FIXTURES_DIR`.
- Port the logic of the template's `LET`/`XLOOKUP` formulas into TypeScript; do not add a JS formula engine (see the build plan's "Alternatives considered").
- Phase 0 gate: for all 66 fixture files, `packages/scoring` must reproduce the cached rekap values (A2 `F60:F71`, `R60:R71`, `S60:S71`) and KPMR `H46`/`J46` to 2 decimals, computed from C2's **raw typed values**, not any cached formula result. **Status: 65/66 pass exactly.** Run it yourself with `IRA_FIXTURES_DIR="<path to the 01. raw data penilaian PJP LR folder>" npx tsx scripts/golden-test.ts`. The one failure is the file the build plan already flags (777111112, PT Omnipay Transfer Dana): it has a genuinely malformed layout — an extra column shifted through the *entire* rekap block (not just the leaf pengawas scores) plus a skipped column inside the predikat matrix — unique to that one file, not a gap in the engine or config.
- Every write to an input cell goes through one function that records user, old value, new value and reason in `audit_log`: `packages/db/src/cellInputs.ts`'s `recordCellInput`. The pengawas PATCH route, `/api/ingest`, and `scripts/seed-dev.ts` all call it; nothing writes `cell_inputs` directly.
- Locate spreadsheet columns by header text, not by letter — one 2026 file has an extra column that shifts pengawas scores from `O` to `P`. `packages/template`'s `findColumnByHeader` does this; `scripts/golden-test.ts` does its own header-based lookup for the same reason.
- UI labels in Bahasa Indonesia, taken from the template; code and comments in English.

## Status

Phase 0's scoring-parity risk is effectively cleared, and the pipeline now runs genuinely end-to-end from raw typed values to the final IRA score:

- `packages/scoring/config/2026.ts` encodes the real 2026 weights, thresholds and the final-IRA matrix for the A2/KPMR sheets (reverse-engineered from the template's formulas, identical across all 66 fixtures).
- `packages/scoring/config/2026-c2.ts` encodes C2's own share formulas (`IFERROR(sum(numerator)/sum(denominator),0)`, including two genuine template quirks it preserves rather than "fixes": the business-entity denominator excludes two rows its own numerators still divide by, and one PPSPM share formula sums a raw `C` cell instead of the derived `D` cell).
- `scripts/golden-test.ts` reads only C2's raw typed `C`-column values and cross-references `Validasi Data Transaksi` for the "Perbedaan Data" flag (replicating C2!H18's `XLOOKUP`) — it never reads a cached `D`-column share or `H18` result. **65/66 files match exactly**, same single known exception as before (the malformed PT Omnipay file).

The **template export round-trip spike** also passed: `scripts/template-roundtrip-spike.ts` opens a real fixture, snapshots its styles/merges/data validations/conditional formatting/defined names/column widths/row heights/freeze panes/hidden-sheet states, writes one input cell through `fillTemplate`, re-opens the output, and diffs. Run against 3 fixtures (a plain one, the drifted PT Omnipay file, and one with a real pengawas override) — **0 differences** every time; formulas and their cached results are untouched. Run it yourself with `IRA_FIXTURES_DIR="<path>" npx tsx scripts/template-roundtrip-spike.ts [optional-specific-file.xlsx]`.

Both Phase 0 spikes are cleared.

**UI milestone:** `/workbook/[id]` renders each visible sheet of the real template (C2, A2, KPMR, Validasi Data Transaksi) the way Excel does: column widths, row heights, merges, fills, borders, number formats (Indonesian separators, `0%`, the accounting "-" for zero), frozen rows, column/row headers, sheet tabs, a name box + formula bar, and a status bar with the live final score. The layout comes from `template_versions.layout_json` (`packages/template`'s `extractLayout` now captures styles with theme colors resolved to hex); every formula cell shows a live value from `packages/scoring/config/2026-sheet.ts` rather than the template's cached results, which belong to whichever PJP's file the layout was taken from — checked against 13,317 cached formula cells across the 65 good fixtures. Only pengawas-editable cells (`pengawasEditableCellRefs2026`) accept input: Excel keys work (type to overwrite, F2/double-click to edit, Enter/Tab/arrows, Esc, Delete reverts a score to the PJP value), scores are validated 1–5, and an override gets Excel's red corner marker. `?sheet=` deep-links a tab. After changing `extractLayout`, run `npm run refresh-layout` to re-extract the stored layout in place without reseeding.

Getting this working surfaced one non-obvious fix: the workspace packages' relative imports originally used NodeNext-style explicit `.js` extensions (pointing at `.ts` files, needed for `tsx`/Node ESM resolution). Since these packages' `tsconfig.json` actually specifies `moduleResolution: "bundler"`, that extension isn't required — and importing them into Next.js via `transpilePackages` needs a webpack `resolve.extensionAlias` to make sense of it, which applies globally and made every `.js` import in the entire dependency graph try `.ts`/`.tsx` first, effectively hanging the build. Dropping the extensions (verified against `tsx`, Vitest and `tsc` first) fixed it cleanly with no webpack config needed.

**Real persistence, export and ingest:** the grid is no longer a demo. `scripts/seed-dev.ts` creates one `template_versions` row (layout extracted from a real, non-malformed fixture, whose bytes are also stored as that version's template — this repo has no separate blank "Excel Template Filled" yet, which is safe because export rewrites every input cell and the Validasi sheet), `pjp` rows (in sheet order) and `pjp_validation_meta` from that fixture's own "Validasi Data Transaksi" sheet, a handful of real `field_mappings` verified against `Raw_Data_IRA`'s actual headers, and one fully-populated demo `workbooks` row. `/workbook` lists seeded workbooks; `/workbook/[id]` reads and edits one for real via `GET`/`PATCH /api/workbooks/[id]` and `/cells`, computing scores server-side with the same `@ira/scoring` pipeline `golden-test.ts` already proved. Every write — seed, pengawas edit, or ingest — goes through `packages/db/src/cellInputs.ts`'s `recordCellInput`, the one function that upserts `cell_inputs` and logs `audit_log` in a transaction (ground rule). `POST /api/workbooks/[id]/export` is the first real caller of `fillTemplate` outside the round-trip spike, and `POST /api/ingest` is a real, HMAC-signed (`FORM_INGEST_SECRET`) webhook endpoint, tested against synthetic payloads. All of this was exercised against the real 2026 fixtures and a real local Postgres, not just unit tests.

Building this surfaced one real bug, now fixed: `writeInputCells` refused to write a literal pengawas override into `A2!O`-column cells, because those cells default to a formula (`=L`) until a pengawas actually overrides them — so an untouched fixture's O-column is a formula, and the original "refuse to overwrite any formula cell" guard rejected a completely legitimate override. `writeInputCells`/`fillTemplate` now take the input-cell allow-list explicitly and only refuse a formula write when the cell *isn't* a known input cell — preserving the original protection (never type over a genuinely formula-only cell like `C2` column `D`) while allowing the formula-by-default cells (`A2!O`, `KPMR!J`) to be overridden, as the build plan's Input cells table always intended.

**LTDBB transaction data ("Validasi Data Transaksi"):** the LTDBB workbook in the repo root (`Data LTDBB PJP LR JKT.xlsx`, gitignored) is the default data. `packages/ltdbb` parses only sheet `Trx_PJPJKT` (exact A–S headers checked; a clear error names a wrong column or a missing sheet), takes Rupiah from the "Fin" columns, derives them from Nilai×10⁹ / Jumlah when the file has no cached formula value (true for 6,067 cells in this file), flags rows (`DERIVED_FROM_NILAI`, `NON_INTEGER_FREQ`, `NEGATIVE`, `CODE_OVERRIDDEN`, ...), applies `ltdbb_code_overrides` (Indomarco Prismatama → 777958116), and refuses a PJP-month that appears twice. `npm run import-ltdbb [file]` stores it as an `ltdbb_uploads` snapshot (deduped by sha256, one active at a time) — point `DATABASE_URL` at the Vercel Postgres to load it into production. `aggregateYear()` gives all 85 PJPs for a data year (`periods.data_year`, 2025 for the 2026 assessment): the export writes them into "Validasi Data Transaksi" rows 2–86 (C stays `=A&" - "&B`; any formula column is left alone), the live score uses the same total for "Perbedaan Data", and `/admin/ltdbb` shows them with warnings and who will get −1. Export is blocked with "Upload LTDBB terlebih dahulu" when no upload is active. `npm run verify-ltdbb` checks the import against the template's own 2025 sheet: **83/85 PJPs match F–K within ±1**, spot checks exact, NOT_IN_LTDBB and INCOMPLETE_YEAR lists exactly as expected (the two differences, Indogo and ZND, are the known LTDBB revisions). Export also now writes **every** input cell (blank when the workbook has no value), so nothing from the PJP whose file the template came from leaks into another PJP's export. Open decisions stay settings in `packages/ltdbb/src/policy.ts` (PJP missing from LTDBB, incomplete year: warn vs block). Uploading newer LTDBB files through the app (Vercel Blob client upload — the file is ~4.2 MB, near Vercel's request limit), re-activating older snapshots and editing Status PJP / Keterangan come next.

**Shared Keterangan:** A2's "Keterangan" column (`M` on the 35 parameter rows, the SRA reference text) is one value per period, not per workbook — it is identical in all 66 fixtures. Those refs are `sharedCellRefs2026`; `recordCellInput(..., { shared: true })` stores them in `shared_cell_inputs` (keyed by period, audit row still names the workbook it was edited from), and `loadCellValues` overlays them for both the grid and the export. Editing one in any PJP's A2 sheet changes it for every PJP. Migration `0003` moved existing per-workbook values over. A2's "Notes" column (`N`) is still per workbook.

A workbook with no KPMR answers yet (e.g. freshly ingested) used to crash the page ("No predikat rule matches score 0"); the engine now returns `#N/A` there, exactly as the template's VLOOKUP does.

Known limitations, carried forward honestly:
- **No live Google Form/Apps Script access** in this environment, so `/api/ingest` is built and tested (HMAC signature, PJP matching, number-transform, workbook auto-creation) but only a handful of `field_mappings` are seeded for real (the product/channel/distribution/partner columns verified against `Raw_Data_IRA`'s actual headers) — not the full question-ID-keyed 148-column map the 2027 form needs, and `formColumn` is header text rather than a real Apps Script item ID.
- **No auth system yet** (Auth.js is still an open decision in the build plan). `apps/web/lib/devUser.ts` stubs one seeded user for every `audit_log`/`cell_inputs.updatedBy`/`exports.createdBy` — fine for local development, not for anything resembling production.
- Next's dev-mode error overlay sometimes replaces a route handler's real thrown error with its own unrelated `invalid type: boolean false, expected enum CodeFrameColorMode` crash. When an API route 500s with that message in `npm run dev`'s output, the real error isn't shown — reproduce the route's logic in a one-off `tsx` script (reading the same env vars) to see the actual stack trace.
- Co-editing (Hocuspocus/Yjs) still isn't wired into the grid — `apps/collab` runs standalone against `yjs_snapshots` but the workbook page doesn't open a connection to it yet. Hocuspocus is a long-running WebSocket server, so on Vercel it needs a separate host (or a hosted Yjs provider).
- Migration `0001` adds NOT NULL columns without defaults, which only applies to an empty database; reset a local dev DB (`docker compose down -v`) rather than migrating one seeded before it.
