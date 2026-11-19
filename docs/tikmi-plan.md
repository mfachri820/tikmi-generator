# TIKMI Generator: plan

Status: **steps 2–5 of 8 done (data model, PJP master, Sumber BI; scoring engine with golden and Excel-parity tests; submission parser and validation report; ingest + Apps Script).** Decisions from 2026-11-19 are in §8. The web app (`apps/web`) still targets the IRA schema and does not build until step 6 rewrites it.
Date: 2026-11-19.

This repo is being turned from the IRA app into the TIKMI Generator. The platform stays: Next.js + Postgres on Vercel, typed input cells only, live recalculation, export into the original template, one audited write path. The IRA domain is replaced with the TIKMI domain. This document records what the templates actually contain (§1), what does not match the brief (§2), how each IRA module maps to TIKMI (§3), the design of the new parts (§4–§7), and the open questions to settle before building (§8).

## 0. Inputs and how they were read

`scripts/dump-template.py` (openpyxl) dumps every sheet of every workbook in `templates/tikmi/2025/` to `templates/tikmi/2025/_dump/*.json`. Each dump records the sheet state, every non-empty cell (typed value, or formula plus the cached result Excel saved), number formats, comments, data validations, merges, hidden rows and columns, conditional-format ranges and defined names. The dump is the spec. Re-run it with `python scripts/dump-template.py`.

| File in `templates/tikmi/2025/` | Role | Note |
|---|---|---|
| `Nama PSP LSB Bundling 2_Self Asesmen M_Posisi.xlsx` | PJP MR template, Bundling 2 | blank |
| `Nama PSP LSB Bundling 3_Self Asesmen M_Posisi.xlsx` | PJP MR template, Bundling 3 | blank |
| `Nama PSP_Self Asesmen Infrastruktur TI_Posisi.xlsx` | PJP IT template | blank |
| `Nama PSP LSB Bundling 2_Kertas Kerja M Pengawas_Posisi.xlsx` | MR KK, Bundling 2 | filled sample: PT Iforte |
| `Nama PSP LSB Bundling 3_Kertas Kerja M Pengawas_Posisi.xlsx` | MR KK, Bundling 3 | filled sample: Bank of China (HK) Cabang Jakarta |
| `Lampiran 2 Kertas Kerja - Penilaian Keandalan Infrastruktur TI.xlsx` | IT KK | blank |
| `Rekap Penilaian per PJP.xlsx` | IT recap | formulas stored as text |

The file names use spaces, as delivered, not the underscore names in the brief. **`google-form.txt` is missing.**

Four real 2025 PJP submissions in `…/WORK - BI/TIKMI/Folder PSP/` (Andalusia, Jasa Kembar Kilat, Kawan Hai Hai, MM Indonesia; all Bundling 3 MR + IT) were dumped to the session scratchpad, **not the repo**, and used only to check the parser assumptions. They are PJP data and must never be committed. They will become parser and validation fixtures read from `TIKMI_FIXTURES_DIR`, like IRA's `IRA_FIXTURES_DIR`.

Both KKs and their `_dump` JSON hold real data: a filled PJP sample, plus BI amounts for every PJP in the `Sumber BI` sheets. Until §8 Q9 is settled, `.gitignore` keeps `templates/tikmi/**/*.xlsx` and `_dump/` out of git.

## 1. What the templates contain (verified against the dump)

### 1a. MR KK

| Item | Bundling 2 | Bundling 3 |
|---|---|---|
| Visible sheets | `1 - Asesmen Risiko`, `2 - Asesmen Manajemen Risiko`, `3 -Asesmen Permodalan`, `4 - Form Penilaian ` (trailing space), `Lamp1. Daerah Rawan`, `Sumber BI 1 Tahun` | same, but sheet 2 is `2 -Asesmen Manajemen Risiko` (no space), **`Lamp. PJP` is visible** and `Sumber BI 1 Tahun` is hidden |
| Hidden sheets | `Glosarium`, `Asesmen Manajemen Risiko old`, `Sumber BI (6 Bulan)`, `Industri(6 Bulan)`, `DropDown List`, `Lamp. PJP` | `Glosarium`, `Asesmen Manajemen Risiko - old`, `Sumber BI 1 Tahun`, `Sumber BI (6 Bulan)`, `Industri(6 Bulan)`, `DropDown List` |
| Sheet 1 indicators (K = `I.xxx`) | **178**, rows 22–309. OPS 102, LIQ 18, KEU 10, CR 1, CMP 8, HK 3, STG 12, RPT 7, PK 17 | **134**, rows 22–239. OPS 62, LIQ 14, KEU 10, CR 1, CMP 8, HK 3, STG 12, RPT 7, PK 17. **`I.STG.2.3` appears twice** |
| PJP-input rows (B = ID DATA, H, I) | rows 17–298, same rows as the PJP template | rows 17–281, same rows as the PJP template |
| BI-sourced H rows | 31 `VLOOKUP` rows, 303–345 | 11 `VLOOKUP` rows, 286–311 |
| H formulas that sum other H cells or Lamp1 | H100, H103, H104, H108, H109, … | H88, H91, H92, H96, H97, … |
| M pass-throughs (`=$Hnnn`) | 24 | 0. B3 uses `IF(H="NA","NA",IF(H="","Belum Diisi",H))` instead (25 cells) |
| Distinct formula shapes (references and numbers abstracted) | O: 55, M: 40 | O: 39, M: 27 |
| O status strings | `NA`, `Belum Diisi`, `Data Invalid` | the same **plus `Perlu Cek Data`** |
| Excel functions used (whole workbook) | IF AND OR COUNTIF SUM COUNT IFERROR AVERAGEIFS VLOOKUP AVERAGE ISNUMBER FILTER LEFT NOT AGGREGATE XLOOKUP TRIM UPPER MAX COUNTBLANK MIN COUNTA | the same minus MAX/MIN/COUNTBLANK, plus SEARCH |

Identity cells (both bundlings): D4 Nama PSP (typed; dropdown), D5 `=VLOOKUP(D4,'Lamp. PJP'!D5:E463,2,FALSE)`, D6 Bentuk Lembaga, D7 Bundling (number), D8 Kategori PSP, D9 Posisi (text), E9 Tahun. The Bundling 2 sample has **D8 = PSP Utama and D9 = "1 Juli - 31 Desember"**, which is the old six-month period.

Sheet 2 (TKMR): 122 questions (Bundling 2) and 121 (Bundling 3), in rows 19–560 / 19–566. Each question spans several document sub-rows. A is the family code (`P0.OPS` … `P5.PK`; P0 = 75 / 74 questions, P1–P5 = 9–10 each), B is the question id, F is the PJP score, G the document id, H Kelengkapan, I the explanation, J `=IF(COUNTIF(H19:H22,"Tidak Ada")>=1,"Tidak Lengkap","Lengkap")`, K the pengawas Keandalan Dokumen, L the pengawas score. **Columns A, C and G of the PJP template match the KK on every row in both bundlings.** Sheet 2 has no data validations in either file; the dropdown lists live only in `DropDown List`.

Sheet 3: the pengawas types E6. The criteria grid is G6:L8. The PJP's own sheet 3 uses C7/D7 (KPSP), C9/D9 and C10/D10 (laba of the last 2 years).

Sheet 4, Form Penilaian. The cached values match the brief:

| Cell | B2 sample | B3 sample | Formula |
|---|---|---|---|
| C10:L10 | .32 .07 .10 .01 .125 .125 .05 .05 .05 .10 | .32 .03 .10 **.01 .14** .15 .05 .05 .05 .10 | `XLOOKUP(1,(DropDown!A34:A41=C5)*(DropDown!B34:B41=C7),…,"NA")`, C5 = `'1 - Asesmen Risiko'!D7`, C7 = D6 |
| C15:L22 | | | `IFERROR(AVERAGE(FILTER(sheet1!O:O, LEFT(sheet1!K:K,7)="I.OPS.1")),"")` |
| C23 | 3.641025641… | 0 | `IFERROR(AVERAGE(C15:C22),0)` (H23 = 3, a constant) |
| C30:C35 | | | `AVERAGEIFS(sheet2!F:F, sheet2!A:A,"P0.OPS", …)`. B2 adds an odd criterion: F `<>"'Form Penilaian '!"` |
| C36 | 4.8333… | 5 | `IFERROR(AGGREGATE(1,6,C30:C35),0)` (H36 = 3, a constant) |
| C39 | 4.2371… | 2.5 | `IFERROR((C23*A23+C36*A36)/1,0)` |
| C46:C52 | C52 = 0 (no pengawas scores) | C52 = 5 | the same on sheet 2 column L. **H52 = 0**, not the constant 3 |
| C55 | 1.8205… | 2.5 | `(C23*A23+C52*A36)/1`, **no IFERROR**. A blank pengawas TKMR counts as 0, so H55 = 1.5 in both samples |
| C60 | 3.630897435… | 3.1125 | Σ weight × row 39 |
| C62 | 2 | 2 | `='3 -Asesmen Permodalan'!E6` |
| C64 | 3.141628205… | 2.77875 | `(C60*A60)+(C62*A62)/1`, A60 = 0.7, A62 = `1-A60` = 0.30000000000000004 |
| C65 | Cukup Baik | Kurang Baik | |

Predicate formulas: rows 24, 37, 40 and 56 return `"NA"` below 1 (row 56: when exactly 0). C61, C63 and C65 have no NA branch, so they return **FALSE** below 1. Bands: `>=1,<2`; `>=2,<3`; `>=3,<3.5`; `>=3.5,<4`; `>=4,<=5`.

Sheet-1 formulas that read D8 (divisor depends on PSP Utama): **I.OPS.6.8, 6.9, 6.11, 6.12** (not 6.10) and **I.LIQ.1.2** in both bundlings, plus **I.PK.2.1** in Bundling 2.

Sumber BI sheets: header `id, ket, idpelapor, idx (=A&"-"&C), amount`. `Industri(6 Bulan)` has `no, id, ket, amount, …`.

Lamp1:
- KK: header row 4, data rows 5–116 (116 = "Lainnya"), total row 117, columns E–L = Kantor Cabang, Kantor Kas, Kantor Fungsional, ATM/CDM/CRM, EDC/Reader, LKA, DC, DRC.
- PJP template: an extra "(a)…(k)" row 5, data rows 6–117, total row 118. Bundling 2 has the same 8 columns. **Bundling 3 has only 4: E Kantor Cabang, F LKA, G DC, H DRC.**
- The KK's H91/H103 sum rows 5–**115**, so "Lainnya" is left out. The PJP template's own H91/H103 sum rows 6–**116**, so it is included. Bundling 3's PJP H91 sums Kantor Cabang only, while the KK sums E:I.

### 1b. IT KK (Lampiran 2)

Sheets: Informasi, then SM/TK pairs for General, PSD-UE, PSD-APMK, PSD-Propchan, Penerusan TD, Penerusan Data, and `SM Inheren TI - SPBI` / `TK TI - SPBI`. Hidden: `TKMR TI - Dompet Elektronik` and an old `REKAP`. The PJP template also has `SM Infra SP` / `TK Infra SP`.

Header in row 1, data from row 2. Columns: A Variabel, B Komponen (label on the first row of each block), C Pertanyaan, D Panduan, E Nilai Riil, F Self score, G Justifikasi, H Panduan Pengisian, I Nilai Pengawas, J Justifikasi Penilaian. Lampiran 2 has **no formulas** outside the hidden REKAP and **no data validations**. Columns B and C match the PJP template on every sheet except one row each in TK General (row 20) and TK Penerusan TD (row 8), whose wording differs. Some blocks are placeholders (`C = "N/A"`, e.g. TK Penerusan TD 2.A and 2.B) and have to count as empty pillars.

`Rekap Penilaian per PJP.xlsx` (one sheet, text formulas, ";" separators): B4/C4 = AVERAGE(SM, TK). B5 (SM) and B6 (TK) average across sheets. Then one row per sheet and per component. Range errors confirmed, for example SM PSD-APMK 1.C: self F24:F28 vs pengawas I24:I27; 1.D: F29 vs I28; 1.E: F30:F38 vs I29:I37. The old hidden REKAP in Lampiran 2 averages TK General **column E** (Nilai Riil) instead of F.

## 2. Where the brief and the files disagree (the dump wins)

| # | Brief | Dump | Consequence |
|---|---|---|---|
| D1 | Sheet-1 rows 20–298 / 20–281 | PJP-input rows 17–298 / 17–281; indicators (K) 22–309 / 22–239 | Indicator rows on the right do not line up with input rows on the left (e.g. B3 M85 reads H112). Definitions name their input cells explicitly. |
| D2 | Bundling 3 weights CR 0, CMP .15 | **The Bundling 3 KK** has CR .01, CMP .14. The Bundling 2 KK's copy of the table has CR 0, CMP .15 | §8 Q6 |
| D3 | Statuses NA / Belum Diisi / Data Invalid | Bundling 3 adds **Perlu Cek Data** | The engine supports it. Perlu Cek Data is a validation issue. |
| D4 | Bentuk Lembaga Bank / LSB | **The Bundling 3 PJP template also offers "Lembaga Remitansi".** 3 of 4 real submissions picked it. The KK weight XLOOKUP has no row for it, so every weight becomes "NA" and C60/C64 error | §8 Q7. Proposed: treat Lembaga Remitansi as LSB, flagged as a deviation |
| D5 | Downtime I.OPS.6.8–6.12 | 6.8, 6.9, 6.11, 6.12 (not 6.10), I.LIQ.1.2, and in B2 also I.PK.2.1 | Deviation 3 covers all six |
| D6 | PU-PT hard-coded 3 in H23 and H36 | Yes, but pengawas H52 = 0, so H55 = 1.5 | Deviation 2 also covers H52 (§8 Q3) |
| D7 | Pengawas composite row 55 | No IFERROR. A blank pengawas TKMR counts as 0 (B2 sample: OPS 1.82) | Validated Rating M is meaningless until every risk has pengawas scores. The UI must show that. |
| D8 | — | C61/C63/C65 return FALSE below 1 | Kept in template mode; shown as "–" |
| D9 | Lamp1 offset by one row; B3 columns differ | Confirmed. In addition, the KK leaves out "Lainnya" and the PJP template includes it | Parse with the PJP layout; place values on the KK rows; record the Lainnya difference as a deviation |
| D10 | Sample is the 2025 Jan–Dec round | B2 sample is **PSP Utama, Juli–Desember** | The golden test runs both modes; the sample is valid for template mode |
| D11 | `Sumber BI` seeded "from the templates" | The two KKs carry **different `Sumber BI 1 Tahun` snapshots** (B2: 7,290 rows, B3: 6,991). `Sumber BI (6 Bulan)` is the same in both (6,284) | §8 Q8 |
| D12 | Lampiran 2 recap is in `Rekap_Penilaian_per_PJP.xlsx` | Lampiran 2 also has its own hidden REKAP, with different errors | Neither is used; the recap is derived from column B (§5) |
| D13 | Template file names with underscores | Delivered with spaces | The app keys templates by role, not by file name |

What the real submissions show (the validation report has to catch all of these):

- **PT Jasa Kembar Kilat filled in the Bundling 2 template** (122 TKMR questions, B2 row layout, sheet names `2- …`), while D7 = 3 and the file name say Bundling 3. Its D9 = "1 Januari- 30 Juni", E9 = 2026, and D5 is empty (D4 "Jasa Kembar Kilat" is not in `Lamp. PJP`).
- **PT Kawan Hai Hai picked "Bank of America, N.A. Cabang Jakarta"** as D4. The Sandi has to come from the form's PJP name, never from the file.
- PJPs type formulas into H (`=9434901499+ 614725789`). The parser takes the cached value and records that it was a formula.
- Sheet-3 C7 holds free text in one file ("Memenuhi KPSP dan …") and a number in another.
- Several PJP templates disagree with their KK on a few labels: B2 has 6 text differences and 3 ID DATA labels (e.g. row 222 `R.CR.1.a.1` vs `R.CR.2.b.1`); B3 has 13 and 17. The mapping goes by row, with a test that checks the descriptive text, and the known differences listed.

## 3. Module map: IRA → TIKMI

K = keep, A = adapt, D = delete, N = new.

| IRA module | Action | TIKMI |
|---|---|---|
| `apps/web/lib/auth.ts`, `/login`, `/akun`, `/admin/pengguna`, `packages/db/src/passwords.ts`, `scripts/create-user.ts` | K | Rename `tikmi_session`. Role model per §8 Q4. |
| `/admin/aktivitas`, `audit_log`, `recordCellInput`, `loadCellValues`, `workbookVersion`, polling `/changes`, conflict banner | K/A | Keyed by `assessment_part` instead of `workbooks`. New audit event kinds: ingest, version, koreksi, override, rating-mode change, status change, finalize. |
| `apps/collab` (Hocuspocus, not wired in) | K | Unchanged. Still not wired in; still needs a non-Vercel host. |
| `packages/template` (`extractLayout`, colors, symbol fonts, `fillTemplateBuffer`, `writeInputCells`, `findColumnByHeader`) | K/A | Layout extraction for 2 MR KKs + Lampiran 2. Writer gains cell comments (pengawas overrides) and the extra "Rekap Kerja" sheet. |
| `apps/web/app/workbook/[id]/*` (sheet-grid, spreadsheet, doc-panel, explain-strip), `cellFormat`, `usePersistentState` | A | Same Excel-like grid. Three cell shadings (PJP / pengawas / computed). PJP cells read-only; "Koreksi pengawas" needs a note. Tabs = visible MR KK sheets + applicable IT sheets. |
| `packages/scoring` (`src/*`, `config/2026*.ts`, `kpmr-form-2027.ts`) | D → N | Rewritten: indicator definitions as data + one evaluator (§4). |
| `packages/ltdbb`, `/admin/ltdbb`, `/api/ltdbb/*`, `scripts/import-ltdbb.ts`, `verify-ltdbb.ts`, `lib/ltdbbDefault.ts`, `glossary.ts` flags | D (pending §8 Q1) | **Data Sumber BI** (`packages/sumber-bi`, `/admin/sumber-bi`). The upload/snapshot/activate pattern and the browser-to-storage upload are reused. |
| `lib/validasiSheet.ts`, `Validasi Data Transaksi` | D | Replaced by the Sumber BI fill of sheet-1 BI rows and the mismatch check (§6). |
| `lib/individuReport.ts`, `individuTemplate.ts`, `/api/workbooks/[id]/export-individu`, `scripts/make-individu-template.ts` | D | The BI-SSS export goes. |
| `/admin/bobot`, `weight_settings`, `lib/weights.ts`, `layoutOverrides.ts` | A | Becomes **Pengaturan periode**: risk weights per (bundling, bentuk) seeded from `DropDown List` A34:L41 (read-only by default), official Rating M basis, Lembaga Remitansi mapping. |
| `/api/ingest` + Apps Script | A | §7. Matched by PJP name → PJP master, not Sandi. Files go to storage. |
| `field_mappings`, `scripts/seed-kpmr-mappings.ts`, `import-2026-responses.ts` | D | The form carries only identity + 2 files; the files are parsed. |
| `scripts/golden-test.ts`, `template-roundtrip-spike.ts` | A | TIKMI golden test (§4c), round-trip test. |
| `scripts/seed-dev.ts`, `extract-template.ts`, `refresh-layout.ts` | A | Seed templates, PJP master, Sumber BI and demo assessments. |
| Beranda (`home-dashboard.tsx`, `periodOverview.ts`) | A | Becomes **Rekap** (§6). |
| `DATA-PIPELINE.md`, `LEGENDA.md`, `TODO-form-ingest-2027.md` | D | Replaced by `docs/tikmi-pipeline.md` and `docs/tikmi-deviations.md`. |
| `README.md`, `.env.example`, `docker-compose.yml`, package names `@tikmi/*` | A | Rename to `@tikmi/*` and the `tikmi` DB. |
| — | N | `scripts/dump-template.py` (done), `packages/tikmi-parser`, `docs/tikmi-deviations.md`, `apps-script/`, `/pjp/[sandi]`, `/admin/pjp` (master + review queue). |

**Not in this copy**: `ira-generator` has uncommitted work that never reached `tikmi-generator`: `apps-script/Code.gs`, `apps/web/lib/fileStorage.ts`, `/api/ltdbb/upload-url`, `apps/web/lib/workbookStatus.ts`, `docs/BUILD-PLAN.md`, plus edits to 15 files. That storage code uses **Supabase Storage** (signed upload URLs), **not Vercel Blob**. The plan ports those pieces by hand where TIKMI needs them (Apps Script pattern, storage, status transitions) and does not copy the rest. §8 Q10.

**Git**: `tikmi-generator`'s `origin` is the IRA repo (`ira-evaluation-pjplr`), branch `feat/ira-web-app`. Pushing from here would mix TIKMI into IRA. §8 Q11.

## 4. Scoring engine (step 3, built)

`packages/scoring`:

- `src/formula/` is a parser and evaluator for the Excel subset the KKs use (IF, IFERROR, AND, OR, NOT, SUM, AVERAGE, MAX, MIN, COUNT, COUNTA, COUNTBLANK, COUNTIF, AVERAGEIFS, AGGREGATE(1,…), FILTER, XLOOKUP, VLOOKUP, LEFT, TRIM, UPPER, ISNUMBER, SEARCH). It follows Excel 365 semantics: dynamic arrays, an empty cell as 0 or "", text ranked above numbers in comparisons, references and literals treated differently in aggregates, and first-match, case-insensitive lookups. Anything else throws.
- `definitions/2025-mr-b2.json`, `2025-mr-b3.json` and `2025-it.json` are **generated by `scripts/gen-definitions.ts` from the dump and committed**. Each MR file holds every formula of the modelled sheets, the template constants they read, the declared input ranges (PJP answers, the pengawas rows, TKMR, permodalan, Lamp1, narrative), and per-indicator metadata (`mKind`, `oKind`, inputs, band text). The generator fails on any unparsable formula, unsupported function, unmodelled sheet, undeclared input read as a constant, unclassified indicator, or unlisted duplicate. No sample PJP or BI data is in the files (checked).
- `computeMr` (`src/summary.ts`) gives template and corrected results, both Rating M values (C64 and F64; the official one per setting), risk rows, the deviations applied and the warnings. `computeIt` (`src/it.ts`) gives the IT recap for self and pengawas. See `docs/tikmi-deviations.md`.

Tests (63 across the repo, 28 in scoring):

- **Golden**: every cached formula cell of both KK samples, within 1e-9 relative; strings, booleans and errors exact. Cached values come from the openpyxl dump, because exceljs drops a cached 0.
- **Excel parity**: 12 seeded random cases per bundling, recalculated by Microsoft Excel 16 through COM (`npm run parity:cases`, `npm run parity:excel`), replayed through the engine: all cells agree. Fixtures stay in the gitignored `templates/tikmi/2025/_parity/`, because Excel's results contain BI amounts. This replaces the LibreOffice check locally. LibreOffice is not installed here; it remains an option for CI.
- **Deviations** are tested both ways on synthetic inputs (no templates needed). IT recap tests cover pooling, empty pillars, N/A, applicable sheets, the Propchan label fix and note rows.

The sample alone exercises few numeric paths (28 of 177 / 15 of 133 indicators reach a score), which is why the random parity cases matter: they reach 45–103 scores per case, as well as Data Invalid and error propagation.

## 4b. Submission parser and validation (step 4, built)

`packages/parser`:

- `readXlsx`: a small reader on jszip that keeps every stored value and cached formula result. exceljs drops a cached 0, so a PJP's typed formula that evaluates to 0 would read as blank.
- `parseSubmission`: recognises the template by its rows, not by file name or form answer. The match is on ID DATA in sheet 1 for MR and on question codes for IT; at least 90% must match. It then maps every PJP cell onto the KK address: identity, sheet 1 H/I, TKMR F/G/H/I, sheet 3 (PJP rows 7/9/10 → KK rows 6/8/9), Lamp1 (one row up, columns by header, so B3's 4 columns land on E/J/K/L), IT E/F/G and `Informasi`. Typed formulas keep their value and are listed. Structural differences (row text, IDs, Lamp1 kota names) are reported.
- `validateMr` / `validateIt`: the submission check report and the "Kirim catatan ke PJP" text, with severity error / warning / info. MR checks: template vs bundling, D7, D9, E9, D4/D5 against the matched PJP, template defaults (see deviations doc), file name, Belum Diisi / Data Invalid / Perlu Cek Data (only for indicators that read PJP-entered cells), NA without explanation, TKMR F outside 1–5/NA or blank, "Tidak Ada" documents, permodalan, typed formulas. IT checks: applicable sheets left blank, sheets filled but not applicable, scores that are not 1–5/N/A, `Informasi`, file name.

Generated per definition (`pjp` section): the PJP template's sheet names, per-row fingerprints, Lamp1 and sheet-3 maps, the template's own formula cells, and its pre-filled defaults.

Tests: 24 in the parser. The three blank templates are recognised at 100% with no structural findings. Against the four real 2025 submissions:

| PJP | MR | IT |
|---|---|---|
| Andalusia | B3 ✓, Lembaga Remitansi, 1 TKMR question untouched | Penerusan TD and Data blank; filled PSD-UE instead |
| Jasa Kembar Kilat | **Bundling 2 template** for a declared Bundling 3, Posisi "1 Januari- 30 Juni", E9 2026, 26 Belum Diisi | Penerusan Data blank, invalid scores, filled Infra SP |
| Kawan Hai Hai | D4 = **template default** (Bank of America), **83 of 121 TKMR untouched**, typed formula H199 read by value | TK Penerusan TD and Penerusan Data blank |
| MM Indonesia | B3 ✓, Lembaga Remitansi, 2 TKMR untouched, 2 Belum Diisi | filled PSD-UE/APMK too |

Not tested yet: the "Kertas Kerja - PT MM" folder (a hand-made KK, open in Excel) could serve as a manual-vs-app comparison once it is finished.

IT sheet applicability is derived from the MR service declarations (decision 10 below).

## 4c. Ingest (step 5, built)

`packages/ingest` holds the logic, with no web framework; it is tested on PGlite with an in-memory store. `apps/web/app/api/ingest/*` and `apps-script/` are the transport.

1. `registerSubmission`: a form response becomes a version of its response ID (edits arrive with the same ID). The PJP name, or the "Other" text, is matched through `pjp_aliases`: a normalised match is automatic, a fuzzy one becomes a suggestion, anything else goes to the review queue. A private storage key is assigned per file.
2. The files go to storage: one-time signed URLs into the Supabase bucket, or base64 through the app for files of 3 MB or less.
3. `processSubmission`: parses every file, then (once the PJP is known) creates the assessment and its parts, validates (IT applicability from the MR declarations, so MR goes first), decides with `decideFile`, and applies the active file's cells. The write is one batched, audited `recordCellInputs`. It never overwrites a koreksi; it updates the PJP's value underneath (`cell_inputs.pjp_value`) and reports when that value changed. An older version arriving late, a pinned part or a Final assessment leaves the cells alone, and the reason is logged.
4. Admin actions: `resolveAlias` (confirm a name; waiting submissions are processed oldest first), `reassignBundling` (with a note; the MR part moves to the other KK, its cells are cleared and the PJP's MR files are processed again), `setPerbaikanOverride` and `setApplicabilityOverride` (note required), `partFiles` (versions, and why the newest one is not active).
5. `assessmentFinalBlockers`: each part needs an active file; a "Perlu Perbaikan" file needs a resubmission or a pengawas override of that very file; every pengawas TKMR score must be filled.

Routes: `POST /api/ingest/start`, `/api/ingest/file`, `/api/ingest/complete`, all HMAC-signed over `<timestamp>.<body>` with a 10-minute window, and `GET /api/files/[fileId]` (signed-in users only). The routes typecheck; they have not been exercised over HTTP yet, because the web app does not build until step 6 and no local Postgres runs here. The logic they call is covered by the ingest tests, including the real Andalusia and Jasa Kembar Kilat files.

Migrations 0010–0013: official basis nullable; `submission_files.excluded` / `acceptance`; `assessment_parts.applicability_override` / `perbaikan_override` (replacing `applicable_sheets`); `assessments.spbi_participant`; `cell_inputs.pjp_value`; audit events `bundling`, `applicability`, `perbaikan_override`.

## 5. IT KK

- Per sheet, pillars are derived from column B: a block runs from its label row to the row before the next label. Rows whose C is "N/A" or blank are skipped. An empty pillar is skipped, not an error.
- Pillar score = average of numeric F (self) or I (pengawas) over that pillar's rows **across all applicable sheets**. SM = average of the SM pillars, TK = average of the TK pillars, Nilai Keandalan = AVERAGE(SM, TK).
- Applicable sheets per PJP: default General + Penerusan TD + Penerusan Data for Bundling 2/3; editable by the pengawas. `SM/TK Infra SP` (PIP only) is parsed but never applicable to these PJPs.
- `F = "N/A"` counts as no value.
- The breakdown table shows self vs pengawas per sheet and component. The old recap's values are computed separately in a debug view, so the differences can be shown in `docs/tikmi-deviations.md`.

## 6. Data model (step 2, built)

Schema: `packages/db/src/schema.ts`. Migrations: `0000`–`0007` are IRA's, `0008_drop_ira_schema.sql` (hand-written) drops every IRA table and enum, `0009_tikmi_schema.sql` (generated) creates the TIKMI schema. `packages/db/src/cellInputs.test.ts` applies all of them to an in-memory PGlite Postgres and checks that only TIKMI tables remain.

| Table | Holds |
|---|---|
| `users`, `sessions` | Role enum now `admin`, `koordinator`, `pengawas`, `viewer`. |
| `periods` | `code` 2025, `posisi` "1 Januari - 31 Desember", deadline 2026-11-19 23:59 WIB, `official_rating_basis` (default `template`), `settings` jsonb. |
| `templates` | Role (`mr_kk_b2`, `mr_kk_b3`, `it_kk`, `mr_pjp_b2`, `mr_pjp_b3`, `it_pjp`, `it_rekap`), sha256, private storage key, layout. |
| `weight_sets` | Versioned weights per (period, bundling, bentuk lembaga); newest row wins; editable; seeded from the KK of the same bundling. |
| `pjp`, `pjp_aliases` | PJP master (Sandi PK) and every spelling seen, with status `auto` / `confirmed` / `suggested` / `unmatched` / `rejected`. |
| `submissions`, `submission_files` | One row per form response version (`response_id` + `version`, since editing is on); one file row per MR/IT upload with sha256, storage key, parse report, `valid`. |
| `assessments`, `assessment_parts` | One per PJP per period (`draft` → `direview` → `final`, pengawas, finalized by/at); parts `mr` / `it` with template, active file, pinned-by, IT applicable sheets. |
| `cell_inputs` | Typed cells only: source `pjp` / `pengawas` / `koreksi` / `system`, note, originating file. App-only inputs use the sheet `_app` (e.g. `_app!PUPT`). |
| `audit_log` | `event` (cell, koreksi, ingest, version, status, finalize, reopen, assign, setting, weights, sumber_bi, pjp_master, export) + old/new/reason/user. |
| `sumber_bi_uploads`, `sumber_bi_rows` | Snapshots per (period, kind `1_tahun` / `6_bulan` / `industri`), sha256-deduplicated, one active per slot; rows in file order. |
| `comments`, `yjs_snapshots`, `exports` | Re-keyed to parts / assessments. |

Rules enforced in `recordCellInput` (the only writer of `cell_inputs`): a `koreksi` needs a note; any write to a Final assessment throws `AssessmentFinalError`; unchanged writes log nothing.

**PJP master** (`packages/pjp-master`, `scripts/seed-pjp.ts`). `Lamp. PJP` has 427 rows and 418 Sandi. Of the form's 67 names, 21 equal a Lamp name exactly. Matching normalises case, legal forms ("PT", "Tbk", "(Persero)"), punctuation, "(d/h …)", spelling variants (Ekspres/Ekspress → express) and spacing ("Omni Pay" = "Omnipay"). Result: **61 automatic, 2 suggested** (Achilles Financial System → "Achilles Financial Systems" 0.97; Priority Valasindo Remittance → "Priority Valasindo" 0.87), **4 unmatched** (Artha Prima Pratama, Baiili Remintance Indonesia, MDAQ Indonesia Technologies, Super Mega Express). Fuzzy matches are never automatic.

**Sumber BI** (`packages/sumber-bi`). Parses id / ket / idpelapor / [idx] / amount by header; pads numeric Sandi; keeps file order; reproduces VLOOKUP (first row wins, case-insensitive, blank → 0, missing → "NA" via IFERROR); reports duplicates, blanks, non-numeric amounts, non-Sandi pelapor and idx mismatches; lists PJPs without data. Findings in the 2025 KKs:

- Normalised, `1 Tahun` covers **270 pelapor in both KKs** (the B2 copy has 299 more rows, no extra pelapor); `6 Bulan` 234. The earlier 307 / 272 / 238 counted numeric and text forms of the same Sandi separately.
- 98 / 96 duplicate keys with different amounts: only the first row counts.
- The KKs type `idx` by hand for bank UUS rows (`116990000` filed as `…-116000000`, the parent bank). This is a deliberate mapping, so an `idx` column is honoured whenever a file has one. None of the 67 non-bank PJPs is affected.
- SNAP rows (`R.OPS.1.c.53/54`) use masked pelapor codes (`X77000003`): flagged, never matched.

Seeds: `scripts/seed-period.ts` (period + weights), `scripts/seed-pjp.ts`, `scripts/seed-sumber-bi.ts` (dev only, from the B2 KK). All accept `--dry-run`, which needs no database.

Not yet built (needs the web app, step 6): the Sumber BI upload page, the PJP review queue (`/admin/pjp`), storage wiring.

## 7. Ingest (step 5)

The Google Form has PJP name (dropdown + Other) and two file uploads. Apps Script `onFormSubmit`:

1. Reads both Drive files.
2. POSTs `{responseId, submittedAt, pjpName, email?, files: [{kind, name, mime}]}` with the HMAC header to `/api/ingest/start`, and gets back one signed upload URL per file.
3. PUTs each file straight to storage, so it doesn't hit the Vercel 4.5 MB body limit.
4. POSTs `/api/ingest/complete`, which parses, validates and versions.

A submission whose files are under ~3 MB base64 may use one direct POST instead. A resubmission creates a new version; the latest *valid* one per file becomes active, and a pengawas can pin an older one. Pengawas inputs and koreksi survive a new version, and a cell whose PJP value changed under a koreksi is flagged.

Validation report per PJP: right template for the bundling (sheet signature + row text), D7 = bundling, D9 = "1 Januari - 31 Desember", E9 = 2025, D4/D5 vs the matched PJP, file-name convention, every O = Belum Diisi / Data Invalid / Perlu Cek Data, "NA" without an I explanation, TKMR F outside 1–5/NA, "Tidak Ada" documents, typed formulas in H, IT sheets left blank. It produces a "Kirim catatan ke PJP" text to copy.

Recap (step 7): one row per PJP with submission status vs deadline (late = after 19 Nov 2026 23.59 WIB), pengawas, bundling, inherent/TKMR/composite per risk, permodalan, both Rating M + predicate, IT self vs pengawas, open issues, review status. Filters, "PJP saya", xlsx export, optional Google Sheet push (off by default).

## 8. Decisions (2026-11-19)

| # | Question | Decision |
|---|---|---|
| 1 | Bundling 3 weights | Use each bundling's own KK table (B3: OPS .32, LIQ .03, KEU .10, CR .01, CMP .14, PU-PT .15, HK .05, STG .05, RPT .05, PK .10). Versioned config, editable while the methodology owner confirms. |
| 2 | Lembaga Remitansi | Weighted as Lembaga Selain Bank; original value displayed, with a note on the PJP page. |
| 3 | Rating M | Revised 2026-11-19: show C64 (Asesmen Mandiri) and F64 (Penilaian Pengawas) side by side from the KK's own cells, labelled plainly. `official_rating_basis` stays unset for 2025 until the methodology owner confirms. Final is blocked until every pengawas TKMR score (column L) is filled; until then the badge "TKMR pengawas belum lengkap (x/122)". |
| 4 | Roles | Pengawas edits only assigned PJPs; koordinator finalizes; koordinator or admin reopens with a required reason (activity log). Final = read-only; exports stamped "FINAL" + date. |
| 5 | Sumber BI | Template copies for development and golden tests only (each golden test uses its own KK's copy). Production: upload page for the fresh Jan–Des 2025 file; show PJPs without BI data. |
| 6 | Storage | What IRA uses: **Supabase Storage** (private bucket, signed upload URLs; `ira-generator`'s uncommitted `fileStorage.ts`). No public URLs, downloads through an authenticated route, originals of every version kept. |
| 7 | Git | `origin` (the IRA repo) removed 2026-11-19. Work is on local branch `feat/tikmi-generator`. Nothing pushed until the new repo exists. |
| 8 | Engine | Generated definitions + one evaluator, on condition that definitions are committed and reviewed, every indicator is tested against cached values, and anything unclassified fails loudly. |
| 9 | Form | `google-form.txt` added. Items keyed by item ID or section (Bagian 2 and 3 repeat titles). An edited response is a new version of the same response ID. The form also asks Bundling Aktivitas: compared with the file's D7. |

| 10 | IT applicability | Derived from the PJP's MR service declarations (R.OPS.1.a.*, by ID DATA; only the IDs each bundling asks, `askedByBundling`). A service can switch on several pairs (a.15 → Penerusan Data and Penerusan TD). YA is trimmed and case-insensitive; Lainnya (free text) counts unless its answer is in `lainnyaNoValuesForApplicability`. Every declaration blank, or no MR file yet: `fallbackWhenAllBlank` for the bundling, with its warning. A declared service with no sheet (`pairs: []`) is listed for the pengawas (`unmappedYa: askPengawas`). General always; PSD-UE/APMK not by default; TI-SPBI only with the pengawas flag; Infra SP never. `confirm` notes are shown with the service. Config `packages/scoring/config/it-applicability-2025.json` (draft, edited 2026-11-19), checked by `applicability.test.ts`. Pengawas override per PJP with a note. Warnings both ways. |
| 11 | Active vs acceptable | Excluded from becoming active only: not a TIKMI file / unreadable, the other kind, the other bundling's template (the previous valid version stays active and the PJP page says so). The pengawas may reassign the PJP's bundling after checking its licence; the file then becomes active. Wrong Posisi or year: active but **Perlu Perbaikan**, which blocks Final until the PJP resubmits or the pengawas overrides that file with a note. Untouched template defaults are warnings; "Nilai TKMR mandiri sama dengan bawaan template (n/122)" is shown prominently; Bundling 2's default D8 "PSP Utama" and D9 "1 Juli - 31 Desember" are warnings too. |
| 12 | PT MM comparison | When the hand-made KK is finished: copy it to the scratchpad (never open the original while Excel has it), compare cell by cell with the app's KK for the PT MM submission, and explain each difference on either side. |

| 13 | Blank applicable IT sheets | An applicable sheet is never silently dropped from the average. Rows the PJP left empty: the IT file is **Perlu Perbaikan** and Final is blocked until the PJP resubmits, the pengawas scores those rows (column I), or the pengawas accepts the file with a note. Found in the 2025 sample and added: a sheet answered **entirely "N/A"** (Kawan Hai Hai's TK Penerusan TD, despite declaring transfer dana) has no self-scores either, so it is treated the same way and clears once the pengawas gives it a score. "N/A" on individual questions stays a valid answer. The IT Final check runs on the current cells (`assessmentFinalBlockers`). |
| 14 | Which sheets count | Official IT scores (self and pengawas) average the applicable sheets only. An information-only "as submitted" self-score over every filled sheet (PIP-only included) is reported beside it (`computeIt().asSubmitted`, issue `it_as_submitted`). |
| 15 | Non-active MR file | No active MR file (none yet, or excluded as the wrong template/bundling): applicability falls back as if none had arrived. An excluded MR file from the same submission is still read, with its own detected template's asked list, for information. New warning `it_declared_none_but_filled`: every service TIDAK but IT sheets beyond General filled. Tested with Jasa Kembar Kilat before and after the bundling reassignment. |
| 16 | Config safety | `parseItApplicabilityConfig` validates the config strictly when `@tikmi/scoring` loads (`itApplicability2025`): unknown keys (e.g. a leftover "pair"), missing or mistyped fields, unknown bundlings or sheet pairs, and asked IDs without a service all throw, with every problem listed. |

Still open (defaults used until answered):

- **LTDBB comparison**: not reused. The Sumber BI mismatch check replaces it, pending a field mapping you confirm.
- **IRA APU-PPT score for PU-PT**: optional import, off by default. Pengawas PU-PT input (default 3) used for H23, H36 and, in corrected mode, H52.
- **What may be committed**: template xlsx files and `_dump/` stay gitignored. A "blank template" script (strip sample + Sumber BI) is proposed for the repo copy.
- **PJP template vs KK label differences**: KK text authoritative, mapping by row, known differences listed in a test.
- **Lamp1 "Lainnya"**: KK behaviour (excluded) in template mode; shown as a deviation.
