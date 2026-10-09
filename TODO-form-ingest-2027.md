# TODO: 2027 Google Form → IRA ingest

Status as of 2026-10-02. Latest-submission handling is done (`/api/ingest` picks the newest by `submittedAt`, keeps pengawas edits, clears blanks).

## 1. App side (can start now, no template needed)

- [ ] **Fix number parsing.** The form says to type `13323323.32` (dot = decimal), but ingest strips dots → 100× too big. Accept `13323323.32`, `13.323.323,32`, `Rp.13.323.323,32`; flag ambiguous values like `1.500` instead of guessing.
- [ ] **Unreadable answer = flag, not blank.** Right now an answer that can't be parsed clears the cell. Keep the raw answer and show it to the pengawas instead.
- [ ] **Match PJP by name → sandi** (the form has names only, no sandi).
  - [ ] Lookup table including the 5 spelling variants: Achilles Financial System(s), Indogo Ekspress/Express, Zen e-Transfer/Etransfer, Baiili Remintance/Remitance, PT Atom Teknologi (d/h PT Silot Technology Indonesia)
  - [ ] "Other" answers go to a manual matching list, never auto-matched
- [ ] **Add `responseId`** to the ingest body and store it on `form_submissions` (migration), to recognise retries and edited responses
- [ ] **Replace `sandiNama`** in the ingest body with a `pjp` field
- [x] **`drive_link` transform** for file uploads (Apps Script sends Drive file IDs) → KPMR column I done; C2 column E still to map
- [x] **KPMR pipeline** (2026-10-05): 31 score questions → H, 25 document questions → I (`packages/scoring/config/kpmr-form-2027.ts`, loaded by `scripts/seed-kpmr-mappings.ts`); `score` transform (1–5 only); unreadable answers reported in `invalidAnswers`, not written
  - [ ] Check rows 36–38 and 41–43 against the live form (the paste was cut off there): score titles use the template's wording, document questions are missing
- [x] **KPMR pillar weights 30/25/25/10/10** applied (the template's `AVERAGE` ignored them); export rewrites H46/J46 to match. Changes 3 of the 66 2026 results: Moneta 4→5, Berkah Sinar Abadi 3→4, Syaftraco 4→3 — **confirmed 2026-10-06: follow the template** (BI's BSSS report uses 20% each; the app's BSSS export prints the template weights in its headings)
- [x] **TPPT Pengguna Jasa weights follow the BSSS** (2026-10-06): rows 29–32 = 35/15/35/15 instead of the template's 35/10/35/10 (which summed to 90%). Config `leafWeightFixes`; the Template Excel export writes 0.15 into A2 E30/E32. On the 65 valid 2026 files: 1 inherent predikat changes, no final score
- [ ] **Log unmapped answers.** Answer IDs with no mapping (and not marked "ignore") get recorded, not silently dropped.
- [ ] **Mapping loader script:** mapping sheet/CSV → `field_mappings` (`formColumn` = item ID)
- [ ] **Checker script:** every mapped ID exists in the form, and every question is mapped or marked "ignore"
- [ ] Tests for the above with made-up item IDs

## 2. Google side (you)

- [ ] Run `dumpItems()` in the form's Apps Script editor and share the resulting sheet (item ID, type, title)
- [ ] Optional but recommended:
  - [ ] Turn on **Number** response validation on the nominal/count questions
  - [ ] Put the sandi in the PJP dropdown options (`777xxx - PT ...`)
- [ ] Decide: allow PJPs to **edit** their response, or only resubmit?
- [ ] Install the `onFormSubmit` trigger (code from the chat), with `FORM_INGEST_SECRET` in Script Properties
- [ ] Give the sandi for the 2 new PJPs not in the database: **PT Artha Prima Pratama**, **PT Super Mega Express**
- [ ] Re-send form sections 10–12 (the paste was cut off partway through KPMR)

## 3. Needs the 2027 template

- [ ] Fill the mapping sheet: item ID → template cell + transform (or "ignore")
- [ ] Cells for the new 2027 questions: PPSPM-sanctioned partners, FATF black/grey list, UN sanctions, ownership & control %, business lines, corporate structure
- [ ] KPMR: self-score (1–5) → column H, supporting document → column I; confirm the form's question count matches the template's rows
- [ ] New template version and period in the app for 2027 (data year 2026)

## 3b. Template formula fixes (decide with the team first)

Five A2 parameters read the wrong C2 cell and can never change; details and the 2026 impact are in `DATA-PIPELINE.md` §7.

- [x] **Rows 11 & 27 (jalur distribusi Menengah) connected to Kantor PTD** (2026-10-05): C2!D20 (empty heading, always 5) → **D22** (Kantor PTD share). Applied in the app and the export (L11/L27 formulas rewritten). Golden test still checks the template's original D20. Config: `parameterShareRefFixes` in `packages/scoring/config/2026.ts`.
  - On the 10 seeded PJPs: the parameter drops 5 → 1 for the 5 PJPs that work 100% through a PTD office; no final score changed.
  - [ ] Still to confirm with the team: Keterangan also lists Online Merchant / ATM as medium-risk channels, which C2 has no row for; D22 covers only the PTD part
- [ ] **Decide:** fix the rest for 2027 only, or also recompute 2026?
- [ ] Then point the remaining formulas at the right cells (same mechanism as rows 11 & 27):
  - [ ] Row 52 (pemegang saham PEP): D139 → **C139**
  - [ ] Row 53 (pemegang saham Nominee/Trust): D140:D141 → **C140 + C141**
  - [ ] Row 57 (lini bisnis lain): D145 → **C145**, keep "> 1 → score 1"
  - [ ] Re-run the impact check: on 2026 data this changes 7 inherent predikat and 2 final scores (Kangaroo Ausindo 4→3, Moneta 5→4)
- [ ] Optional: extra **warnings** (not penalties) from Validasi: per-direction mismatch (Incoming/Outgoing/Domestic vs LTDBB G/I/K) and Jalur Distribusi total ≠ Produk total (C25 ≠ C18)

- [x] **Weights are editable by admins** (2026-10-06): page **Bobot** (`/admin/bobot`): category, item, parameter and KPMR pillar weights per period, each group must total 100%, with an impact preview and a change history. Scores, grid, Template Excel and BSSS all follow. The decisions above are the defaults ("Kembalikan ke bawaan").

## 4. Before going live

- [ ] Deploy the app (Google can't reach `localhost`); set `DATABASE_URL` and `FORM_INGEST_SECRET`
- [ ] **Fresh database without the demo workbooks.** Otherwise a real submission from PJP 777248911 merges into the demo workbook.
- [ ] Run the checker script against the live form
- [ ] Submit one test response end to end, check the workbook, then delete it
- [ ] Backfill responses that came in before the trigger was live (`scripts/import-2026-responses.ts`, adapted for 2027)
- [ ] If next year's form starts as a copy: check that the item IDs survived the copy

## 5. Housekeeping

- [ ] `git init` and a first commit (rollbacks are manual copies in `_backups/` for now)
- [ ] Delete stale `apps/web/.next/types` (it still points at the old `app/page.tsx` and breaks `tsc`)
