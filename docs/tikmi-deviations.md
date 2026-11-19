# TIKMI Generator: deviations from the Excel templates

Every place where the app's numbers can differ from what the 2025 Kertas Kerja (KK) would compute, why, and in which mode. The app always computes two modes side by side and shows both:

- **Template mode** reproduces the KK formulas exactly. The engine matches every cached formula result in both KK samples (877 cells for Bundling 2, 771 for Bundling 3) and agrees with Microsoft Excel on 12 random input sets per bundling (`packages/scoring/src/golden.test.ts`, `parity.test.ts`). It applies only the two input normalisations decided for 2025 (rows 1 and 2 below).
- **Corrected mode** applies the documented deviations on top.

Results are reported in template mode; corrected mode is shown beside it. The UI marks every cell a deviation changes. Code: `packages/scoring/src/summary.ts` (`computeMr`, `deviations[]`, `warnings[]`) and `packages/scoring/src/it.ts`.

## Deviations

| # | What | KK behaviour | App | Mode | Decided |
|---|---|---|---|---|---|
| 1 | Bentuk Lembaga "Lembaga Remitansi" | The Bundling 3 PJP template offers it in D6, but the weight table (`DropDown List` A34:L41) has no row for it. XLOOKUP returns "NA" and Rating M becomes `#VALUE!` (seen in Excel). | Weighted as "Lembaga Selain Bank". The PJP's own value stays visible, with a note on the PJP page. | both | 2026-11-19 |
| 2 | Risk weights (Form Penilaian C10:L10) | XLOOKUP into the KK's own table. The Bundling 2 KK carries an outdated Bundling 3 row (CR 0, CMP .15). | Versioned `weight_sets`, seeded from the KK of the same bundling (B3: CR .01, CMP .14) and editable while the methodology owner confirms them. Keyed by the assessment's bundling, not by the PJP's D7. | both | 2026-11-19 |
| 3 | PU-PT | H23 = 3 and H36 = 3 (typed constants), H52 = 0, so the pengawas composite H55 = 1.5 for every PJP. | Pengawas input (default 3, with a note) used for H23, H36 and H52. The optional IRA APU-PPT import is off by default. | corrected | default, open |
| 4 | Period divisor and BI source | Kategori PSP (D8) decides: "PSP Utama" means a 6-month divisor for I.OPS.6.8, 6.9, 6.11, 6.12 and I.LIQ.1.2 (B2 also I.PK.2.1), and `Sumber BI (6 Bulan)`. "Belum Diketahui" means "NA" for every BI-sourced row. | Decided by Posisi (D9): Jan–Des means 12 months and `Sumber BI 1 Tahun`; a half-year Posisi means 6 months. A warning is shown when D8 and D9 disagree. | corrected | brief §2c |
| 5a | IT sheets that apply | Not in the template: the pengawas decided by hand. | Derived from the PJP's MR service declarations (config `it-applicability-2025.json`, draft); pengawas override with a note. | always | 2026-11-19 |
| 5b | Blank applicable IT sheets | A blank row, or a whole sheet answered N/A, simply drops out of AVERAGE. | Not dropped silently: the file is Perlu Perbaikan, and Final waits for a resubmission, pengawas scores or an override with a note. Official scores use applicable sheets only; an "as submitted" score over all filled sheets is shown for information. | always | 2026-11-19 |
| 5 | IT recap | `Rekap Penilaian per PJP.xlsx` hard-codes row ranges (see below). An empty pillar gives `#DIV/0!`. | Pillars from the question codes and column-B labels; rows pooled across applicable sheets; empty pillars skipped. | always | brief §2c |

## Not deviations (the KK already does it)

- **Rating M "validasi pengawas"** is in the KK itself: Form Penilaian **F60–F65** ("Berdasarkan Penilaian Pengawas", from row 55) sits beside C60–C65 ("Berdasarkan Asesmen Mandiri", from row 39). The app shows both, from the KK's own cells, labelled plainly. Neither is marked official for 2025 (`periods.official_rating_basis` is unset until the methodology owner confirms). An MR assessment cannot be set to **Final** until every pengawas TKMR score (sheet 2 column L, 1–5 or NA) is filled (`finalizeBlockers`). Until then the app shows "TKMR pengawas belum lengkap (x/122)" (121 for Bundling 3), because row 55 counts blanks as 0.
- **Risks without data count as 0** (row 23 `IFERROR(...,0)`). Kept, with a "risiko tanpa data" warning per risk. The same goes for TKMR Mandiri and TKMR Pengawas: row 55 has no IFERROR, so a risk the pengawas has not scored lowers F64 until it is scored. The app flags this as "TKMR Pengawas belum dinilai".

## Warnings (template behaviour kept, shown to the pengawas)

| Code | When |
|---|---|
| `risk_no_data` | A risk has no inherent indicator with a value: row 23 = 0 pulls Rating M down. |
| `tkmr_no_data`, `tkmr_pengawas_incomplete` | TKMR Mandiri / Pengawas of a risk is 0 because nothing is scored. |
| `d8_d9_mismatch` | Kategori PSP and Posisi disagree (deviation 4). |
| `weights_missing` | No weight row for the bundling and bentuk lembaga (e.g. Bank on Bundling 3): Rating M cannot be computed. |
| `score_out_of_range` | An O score outside 1–5. **I.PK.4.1** (Pemenuhan prinsip PKBI, "Diisi oleh Bank Indonesia, Nilai 1 sd 5") passes the pengawas value through without checking it. The input form also validates 1–5. |
| `pupt_template_constant` | PU-PT not entered by the pengawas; 3 is used, as in the template. |
| `bentuk_remitansi` | Deviation 1 applied. |

## IT recap: where `Rekap Penilaian per PJP.xlsx` is wrong

Output of `npm run it-rekap-diff` (structural; no PJP data). Every other component's range matches the questions.

| Sheet | Komponen | Rekap self (F) | Rekap pengawas (I) | Question rows | Problem |
|---|---|---|---|---|---|
| SM PSD-APMK | 1.C Kompatibilitas | 24–28 | 24–27 | 24–27 | F range shifted by one (includes 1.D.1); F and I differ |
| SM PSD-APMK | 1.D Kapabilitas Interaksi | 29 | 28 | 28 | F reads 1.E.1 instead of 1.D.1 |
| SM PSD-APMK | 1.E Keandalan | 30–38 | 29–37 | 29–37 | F skips 1.E.1 and reads one row past the end |
| SM Infra SP | 1.A Kesesuaian Fungsional | 2–48 | 2–48 | 2–8 | range runs into 1.B–1.F (PIP only; never applies to PJP) |
| TK Infra SP | 2.D / 2.E | 20–25 / 26–31 | same | 20–26 / 27–32 | off by one (PIP only) |

Also, in the IT templates:

- **SM PSD-Propchan** has no "1.E Keandalan" label in column B, so its 1.E.1–1.E.11 questions sit inside the 1.D block. The app files them by their question codes (`knownIssues` in `definitions/2025-it.json`). The Rekap's ranges for that sheet happen to be right.
- Note rows ("Pertanyaan 1.F.1 s.d. 1.F.4 mencakup …") and "N/A" placeholder rows are never scored.
- The old hidden `REKAP` sheet inside Lampiran 2 averages TK General **column E** (Nilai Riil) instead of F. It is not used.

## Template facts the app copes with

- Bundling 3 lists indicator **I.STG.2.3** twice (two rows). Both are kept, by row.
- Two pairs of indicators are rated by one O cell: I.OPS.2.7 / 2.8 and I.LIQ.1.5 / 1.6. **I.LIQ.3.2** (Intraday Liquidity Gap, in Rupiah) has no rating; it feeds I.LIQ.3.3.
- The rows below the BI block (B2 333–351, B3 294–317) are typed in the KK by the pengawas, partly "Diisi oleh Bank Indonesia": R.CMP.1.d.1, R.PK.4.a.1, R.PK.5.a.1, R.PK.6.a.1, and in B3 also R.LIQ.1.d.1–3. They are pengawas inputs in the app.
- Lamp1 "Lainnya" (row 116) is left out of the KK's rawan-area totals (rows 5–115), but included by the PJP template's own formulas. The app follows the KK.
- `Sumber BI` sheets: the first row with a key wins (VLOOKUP), and the KKs type `idx` by hand for bank UUS rows (filed under the parent bank). Both are kept.

## The blank PJP templates are pre-filled

The templates sent to PJPs are not empty. Both MR templates ship with D4 = "Bank of America, N.A. Cabang Jakarta" (Sandi 033000000), D7 to E9 set (Bundling 2: "PSP Utama", "1 Juli - 31 Desember"; Bundling 3: "Lembaga Remitansi", "PSP Selain PSP Utama", Jan–Des 2025), every TKMR self-score F = 5 (one 3), placeholder document numbers in G ("P0.OPS.1.1", …) and Kelengkapan in H. Bundling 2 also has "TIDAK" in H259:H260. A submission that keeps these values looks complete but was not filled in. The validation report therefore compares each answer with the template's value (`pjp.defaults` in the definitions):

- D4 still the default: **error** (the PJP did not pick its name). In the 2025 sample, PT Kawan Hai Hai's "Bank of America" is this default, not a wrong pick.
- D6 / D8 / D9 still the default: **warning**. Not flagged when the default is what the period requires: D9 "1 Januari - 31 Desember", and D8 "PSP Selain PSP Utama" for a full year. Bundling 2's defaults "PSP Utama" and "1 Juli - 31 Desember" are therefore flagged.
- TKMR self-scores (F) still the template's values: **prominent warning** "Nilai TKMR mandiri sama dengan bawaan template (n/122)", because the defaults are 5s and inflate C64. "No Ref. Dokumen" (G) still the placeholder: warning. In the 2025 sample, one PJP left 83 of 121 untouched.
