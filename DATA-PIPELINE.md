# IRA data pipeline: where every cell comes from

How the four sheets of the 2026 IRA workbook are filled and calculated, cell by cell: what the PJP's form fills, what LTDBB fills, what the pengawas fills, and what each formula does. Formulas are quoted from the template itself (identical in all 66 real 2026 files); the app recomputes the same formulas in code (`packages/scoring`) so the grid, Beranda and the Excel export always agree.

Sheet names: **C2** = `C2. Form PJP LR`, **A2** = `A2. PJP ALL peng`, **KPMR** = `B. KPMR 2025`, **Validasi** = `Validasi Data Transaksi`.

---

## 1. The big picture

```
 Google Form (PJP)                LTDBB file (BI)                 Pengawas (in the app)
        │                                │                                  │
        │ /api/ingest                    │ import-ltdbb                     │ grid edits
        ▼                                ▼                                  ▼
 C2 column C (numbers)          Validasi F–M (per PJP,           A2 O (score override), M, N
 C2 column E (document links)    12 months of the data year)     KPMR J (score override)
 KPMR H (self-score 1–5)                 │                        C2 column C (corrections)
 KPMR I (document links)                 │
        │                                │
        ▼                                ▼
 C2 column D: shares (C ÷ group total)   C2 G18 = PJP's LTDBB total ──► C2 H18 "Sesuai" / "Perbedaan Data"
        │                                                                          │
        ▼                                                                          │
 A2 column L: 1–5 score per parameter (from C2 shares)                             │
 A2 column O: pengawas score (= L unless overridden)                               │
        │                                                                          │
        ▼                                                                          │
 A2 rows 60–65: inherent risk score + predikat                                     │
        │               KPMR pillars → overall (weighted) → KPMR predikat          │
        ▼                         │                                                │
 A2 row 70: final IRA = matrix(inherent predikat × KPMR predikat) ── minus 1 if ◄──┘
 A2 row 71: final predikat
```

### Sources at a glance

| Source | Fills | Stored as |
|---|---|---|
| **Google Form** (via `/api/ingest`) | C2 numbers, KPMR H/I | `cell_inputs`, source `form` |
| **LTDBB file** (`npm run import-ltdbb`) | Validasi F–M | `ltdbb_monthly`, summed on the fly |
| **Pengawas** (grid edits) | A2 M/N/O, KPMR J, corrections in C2 C | `cell_inputs`, source `pengawas` |
| **Template constants** | Labels, weights (A2 D/E), criteria (A2 G–K), predikat tables, final matrix | `template_versions` + `packages/scoring/config/2026.ts` |
| **Formulas** | Everything else | Computed live, never stored |

Rules that cut across all sheets:
- **Latest submission wins.** A PJP that submits twice is scored on the newest response (by timestamp); a blank answer clears its cell.
- **Pengawas edits are never overwritten** by a resubmission. The new form answer is still kept in `form_submissions`.
- **Every write is audited** (`audit_log`: who, old value, new value, reason).

---

## 2. Sheet C2: Form PJP LR (the PJP's own data)

### Columns

| Col | Meaning | Source |
|---|---|---|
| B | Question / row label | Template |
| C | **Diisi PJP**: the PJP's answer | Form (see mapping status below); pengawas can correct |
| D | **%**: share of the row in its group | Formula `=IFERROR(C{row}/{group total},0)` |
| E | **Dokumen pendukung**: evidence link | Form upload (mapping pending) |
| F | Penilaian pengawas | Free, not used in scoring |
| G | Konfirmasi Data | Only G18 is used (see row 18) |
| H | Result of the LTDBB check | Only H18 |

### Rows

| Rows | Label | C (input) | D (share) | 2027 form → app mapping |
|---|---|---|---|---|
| 2 | Sandi - Nama | Written by the app/export: `"{sandi} - {nama}"` | – | – |
| 6–17 | Transaksi by Produk/Jasa: Cash to Cash / Cash to Account / Account to Account / Account to Cash × Incoming / Outgoing / Domestic | Nominal Rp | `=IFERROR(C6/$C$18,0)` … | ✅ mapped ("Total Nominal … (Incoming)" etc.) |
| 18 | Total Transaksi | `=SUM(C6:C17)` | `=SUM(D6:D17)` | – |
| 22–24 | Jalur Distribusi: Kantor PTD, Aplikasi Mobile/Website, Mitra | Nominal Rp | `=IFERROR(C22/C$25,0)` … | ✅ mapped |
| 25, 26 | Jalur Distribusi total | `=SUM(C22:C24)`, `=SUM(C25)` | sums | – |
| 28–29 | Mitra Kerja Sama: a. Domestik, b. Asing | Count | `=IFERROR(C28/C$30,0)` … | ✅ mapped |
| 30 | Mitra total | `=SUM(C28:C29)` | sum | – |
| 34–56 | Pengguna Jasa Perorangan by profession (Pejabat Negara, Wirausaha, … Pengurus Partai Politik; 23 rows) | Count | `=IFERROR(C34/C$57,0)` … | ⏳ form question exists, not yet mapped |
| 57 | Perorangan total | `=SUM(C34:C56)` | `=SUM(D34:D56)` | – |
| 58 | PEPs | Count | `=IFERROR(C58/C$57,0)` (share of perorangan) | ⏳ |
| 62–70 | Badan Usaha Berbadan Hukum (PT, Perusahaan Perseorangan/UMKM, PT Social Enterprise, CV, Firma, Persekutuan Perdata, Koperasi, Yayasan, Perkumpulan) | Count | `=IFERROR(C62/C$74,0)` … | ⏳ |
| 72–73 | Tidak Berbadan Hukum (Ormas terdaftar / tidak terdaftar) | Count | `=IFERROR(C72/C$74,0)` | ⏳ |
| 74 | Badan Usaha total | `=SUM(C62:C70)` ⚠ excludes 72–73 | `=SUM(D62:D73)` | – |
| 76 | Lokasi Operasional (provinsi) | Text | – | ⏳ |
| 80–117 | Lokasi Transaksi Domestik: 38 provinces (row 84 = Kepulauan Riau, row 90 = DKI Jakarta) | Nominal Rp | `=IFERROR(C80/C$118,0)` … | ⏳ (form asks for a detail template) |
| 118 | Domestic total | `=SUM(C80:C117)` | sum | – |
| 120, 121 | Transaksi FATF Black List / Grey List | Nominal Rp | `=IFERROR(C120/C$18,0)` (share of all transactions) | ⏳ |
| 123 | Transaksi negara UN Sanctions | Nominal Rp | `=IFERROR(C123/C$18,0)` | ⏳ |
| 127–128 | Kepemilikan by jenis (%): Perorangan, Badan Hukum | % | **none** | ⏳ |
| 131–132 | Kepemilikan by negara (%): Domestik, Asing | % | **none** | ⏳ |
| 135–136 | Pengendalian by negara (%): Domestik, Asing | % | **none** | ⏳ |
| 139–141 | Kepemilikan by kategori (%): PEP, Nominee, Trust | % | **none** ⚠ (see quirks) | ⏳ |
| 145 | Lini Bisnis (jumlah) | Count | **none** ⚠ | ⏳ |
| 147 | Struktur Korporasi (Grup/Sendiri) | Text | – | ⏳ |

### The LTDBB cross-check (row 18)

| Cell | Formula | Meaning |
|---|---|---|
| G18 | `=XLOOKUP(B2, Validasi!C:C, Validasi!M:M)` | The PJP's **total nominal in LTDBB** for the data year |
| H18 | `=IF(ABS(C18-G18)<=1000,"Sesuai","Perbedaan Data")` | Reported total vs LTDBB, tolerance **Rp1.000** |

"Perbedaan Data" costs the PJP **1 point on the final IRA score** (A2 row 70, column S).

---

## 3. Sheet Validasi Data Transaksi (BI's LTDBB data)

One row per PJP in the form's list (85 rows), filled from the **active LTDBB upload**, summing the 12 months of the period's **data year** (2025 for the 2026 assessment).

**Getting a new LTDBB file in:** a pengawas or admin uploads the `.xlsx` on **Data LTDBB → Unggah LTDBB baru**. Route: `POST /api/ltdbb/upload`, which uses the same `importLtdbb` as `npm run import-ltdbb`. The new file becomes the active upload at once, so every score, export and the Perbedaan Data check use it.
- Re-uploading a file that was already imported (same sha256) makes that copy active again.
- An unreadable file is kept as `failed`, and the reason is shown.
- Older uploads stay listed under "unggahan lain" with an **Aktifkan** button to switch back.
- Files are limited to 4.4 MB, under Vercel's 4.5 MB request limit. The current file is about 4 MB.

| Col | Meaning | Source |
|---|---|---|
| A | Sandi PJP | PJP list |
| B | Nama Penyelenggara | PJP list (not LTDBB, whose names differ) |
| C | Merge Name | `=A2&" - "&B2` (what C2!G18 looks up) |
| D | Status PJP | PJP list (seed) |
| E | Keterangan | PJP list (seed) |
| F / G | Frekuensi / Nominal **Incoming** | Σ LTDBB months |
| H / I | Frekuensi / Nominal **Outgoing** | Σ LTDBB months |
| J / K | Frekuensi / Nominal **Domestik** | Σ LTDBB months |
| L | Total Frekuensi | F + H + J |
| M | Total Nominal | G + I + K → **feeds C2!G18** |

Flags shown in the app: **Tidak ada di LTDBB** (no rows for the PJP; totals 0), **LTDBB < 12 bulan** (missing months). Both are warnings, not blocks.

---

## 4. Sheet A2: PJP ALL peng (inherent & structural risk)

### Columns

| Col | Meaning | Source |
|---|---|---|
| B, C | Item number / risk factor | Template |
| D | **Bobot1**: weight of the item within its category | Template constant |
| E | **Bobot2**: weight of the parameter within its item | Template constant |
| F | Parameter description | Template |
| G–K | Kriteria for scores 5 … 1 | Template (text only) |
| L | **PJP-derived score 1–5** | Formula reading C2 (table below); blank for the 7 manual parameters |
| M | Keterangan (SRA basis) | Pengawas; **one value for all PJPs in the period** |
| N | Notes | Pengawas |
| O | **Pengawas score 1–5** | `=L` by default; pengawas overrides (red triangle in the grid) |

Item rows (6, 9, 12, 18, 22, 25, 28, 33, 37, 40, 43, 47, 50, 56) add their parameters up: e.g. `L6 = $D6*SUMPRODUCT($E7:$E8,$L7:$L8)`, and the same on O.

### Scoring rules used by column L

| Rule | Formula shape | Score |
|---|---|---|
| **R1** share bands | `IF(x<=20%,5, IF(x<=40%,4, IF(x<=60%,3, IF(x<=80%,2, IF(x<=100%,1)))))` | ≤20% → 5 · ≤40% → 4 · ≤60% → 3 · ≤80% → 2 · ≤100% → 1 |
| **R2** small share | `LET(jml,COUNT(C…), total,SUM(D…), IF(jml=0,5, IF(total=0,5, IF(total<=1%,4, …))))` | no answer or 0 → 5 · ≤1% → 4 · ≤2% → 3 · ≤3% → 2 · >3% → 1 |
| **R3** lookup | `LOOKUP(total,{0,0.02,0.04,0.05,0.06},{5,4,3,2,1})` | <2% → 5 · <4% → 4 · <5% → 3 · <6% → 2 · ≥6% → 1 |
| **R4** presence | `IF(SUM(…)>0, 1, 5)` | any → 1, none → 5 |
| **R5** presence > 1 | `IF(SUM(…)>1, 1, 5)` | more than 1 → 1, otherwise 5 |
| **Manual** | (no formula) | Pengawas decides in O; counts as 5 until then |

### The 35 parameters

*Effective weight* = D × E, i.e. the parameter's share of its category.

**Risiko Inheren TPPU, category weight 40%**

| Row | Parameter | D × E | L reads (C2) | Rule |
|---|---|---|---|---|
| 7 | Mekanisme transaksi berisiko Tinggi | 0.30 × 0.65 | D10 (Cash to Account Outgoing) | R1 |
| 8 | Mekanisme transaksi berisiko Menengah | 0.30 × 0.35 | D12 (Account to Account Incoming) | R1 |
| 10 | Jalur distribusi berisiko Tinggi | 0.20 × 0.65 | D90 (DKI Jakarta) | R1 |
| 11 | Jalur distribusi berisiko Menengah | 0.20 × 0.35 | **D22** (Kantor PTD); template read D20, fixed in app | R1 |
| 13 | Individu, profesi berisiko Tinggi | 0.30 × 0.35 | D35 + D39 + D58 (Wirausaha, Profesi Keuangan Lainnya, PEP) | R2 |
| 14 | Individu, profesi berisiko Menengah | 0.30 × 0.10 | D42 + D40 + D39 (IRT, Profesional, Profesi Keuangan Lainnya) | R3 |
| 15 | Badan usaha berisiko Tinggi | 0.30 × 0.35 | D62 + D64 (PT, PT Social Enterprise) | R2 |
| 16 | Badan usaha berisiko Menengah | 0.30 × 0.10 | D62 (PT) | R3 |
| 17 | WN/BH High Risk Countries (FATF) | 0.30 × 0.10 | D120 + D121 (FATF black + grey) | R4 |
| 19 | Lokasi transaksi domestik berisiko Tinggi | 0.20 × 0.75 | D90 (DKI Jakarta) | R2 |
| 20 | Transaksi di Black/Grey List FATF | 0.20 × 0.25 | D120 + D121 | R4 |

**Risiko Inheren TPPT, category weight 25%**

| Row | Parameter | D × E | L reads (C2) | Rule |
|---|---|---|---|---|
| 23 | Mekanisme transaksi berisiko Tinggi | 0.20 × 0.70 | D6 + D7 + D8 (Cash to Cash, all directions) | R1 |
| 24 | Mekanisme transaksi berisiko Menengah | 0.20 × 0.30 | D13 (Account to Account Outgoing) | R1 |
| 26 | Jalur distribusi berisiko Tinggi | 0.20 × 0.70 | – | Manual |
| 27 | Jalur distribusi berisiko Menengah | 0.20 × 0.30 | **D22** (Kantor PTD); template read D20, fixed in app | R1 |
| 29 | Individu, profesi berisiko Tinggi | 0.30 × 0.35 | D35 (Wirausaha) | R2 |
| 30 | Individu, profesi berisiko Menengah | 0.30 × **0.15** (template 0.10) | D38 (Pegawai Swasta) | R2 |
| 31 | Badan usaha berisiko Tinggi | 0.30 × 0.35 | – | Manual |
| 32 | Badan usaha berisiko Menengah | 0.30 × **0.15** (template 0.10) | – | Manual |
| 34 | Lokasi transaksi domestik berisiko Tinggi | 0.30 × 0.75 | D90 + D84 (DKI Jakarta, Kepulauan Riau) | R2 |
| 35 | Transaksi di Black/Grey List FATF | 0.30 × 0.25 | D120 + D121 | R4 |

**Risiko Inheren PPSPM, category weight 5%**

| Row | Parameter | D × E | L reads (C2) | Rule |
|---|---|---|---|---|
| 38 | Layanan berisiko Tinggi | 0.10 × 0.70 | D6 + D7 + D8 | R1 |
| 39 | Layanan berisiko Menengah | 0.10 × 0.30 | – | Manual |
| 41 | Mitra kerja sama asing | 0.20 × 0.40 | D29 (Mitra Asing) | R4 |
| 42 | Mitra dari negara sanksi PBB (PPSPM) | 0.20 × 0.60 | – | Manual |
| 44 | Individu dari negara sanksi PBB | 0.40 × 0.50 | D123 (UN sanctions) | R2 |
| 45 | Profesi berisiko Tinggi PPSPM | 0.40 × 0.25 | D35 + D49 + **C58** ⚠ (raw PEP count) | R2 |
| 46 | Badan usaha PT non-UMKM | 0.40 × 0.25 | D62 (PT) | R2 |
| 48 | Transaksi negara sanksi PBB | 0.30 × 1.00 | D123 | R4 |

**Risiko Struktural, category weight 30%**

| Row | Parameter | D × E | L reads (C2) | Rule |
|---|---|---|---|---|
| 51 | UBO dapat diidentifikasi | 0.80 × 0.20 | – | Manual |
| 52 | Pemegang saham PEP | 0.80 × 0.20 | D139 ⚠ empty, always 5 | R4 |
| 53 | Pemegang saham Nominee/Trust | 0.80 × 0.20 | D140 + D141 ⚠ empty, always 5 | R4 |
| 54 | Pemegang saham WN/BH negara berisiko | 0.80 × 0.20 | C132 (Kepemilikan Asing %) | R4 |
| 55 | Struktur korporasi Grup/kompleks | 0.80 × 0.20 | – | Manual |
| 57 | Lini bisnis lain di luar SP | 0.20 × 1.00 | D145 ⚠ empty, always 5 | R5 |

### Rekap (rows 59–71)

Each row is computed three times: **F** from the PJP scores (column L), **R** from the pengawas scores (column O), and **S** = R with the Perbedaan Data penalty. **The app and Beranda use S.**

| Row | Meaning | F (PJP) | R (pengawas) | S (final) |
|---|---|---|---|---|
| 60–63 | Category score: TPPU 0.40 · TPPT 0.25 · PPSPM 0.05 · Struktural 0.30 | `E60=SUM(L6,L9,L12,L18)`, `F60=D60*E60` | `R60=P60*Q60` | `=R60` |
| 64 | **Nilai Risiko Inheren & Struktural** | `=SUM(F60:F63)` | `=SUM(R60:R63)` | `=R64` |
| 65 | Predikat inheren | `=VLOOKUP(F64,$H$60:$I$64,2,1)` | same on R64 | `=R65` |
| 67 | **Nilai KPMR** | `='B. KPMR 2025'!H46` | `='B. KPMR 2025'!J46` | `=R67` |
| 68 | Predikat KPMR | `=VLOOKUP(F67,$K$60:$L$64,2,1)` | same on R67 | `=R68` |
| 70 | **Nilai Akhir IRA** | `=INDEX($I$67:$M$71, MATCH(F65,…), MATCH(F68,…))` | same with R | `=IF(C2!H18="Perbedaan Data", IF(R70>1,R70-1,1), R70)` |
| 71 | Predikat akhir | `=VLOOKUP(F70,$H$60:$I$64,2,1)` | same on R70 | same on S70 |

**Predikat tables** (both use the same breakpoints):

| Score from | Inherent predikat (H60:I64) | KPMR predikat (K60:L64) |
|---|---|---|
| 1 | Tinggi | Unsatisfactory |
| 2 | Menengah ke Tinggi | Marginal |
| 3 | Menengah | Fair |
| 3.75 | Rendah ke Menengah | Satisfactory |
| 4.5 | Rendah | Strong |

**Final IRA matrix** (H66:M71, inherent predikat × KPMR predikat):

| Inherent \ KPMR | Unsatisfactory | Marginal | Fair | Satisfactory | Strong |
|---|---|---|---|---|---|
| Tinggi | 1 | 1 | 2 | 3 | 3 |
| Menengah ke Tinggi | 1 | 2 | 2 | 3 | 4 |
| Menengah | 2 | 2 | 3 | 4 | 4 |
| Rendah ke Menengah | 2 | 3 | 4 | 4 | 5 |
| Rendah | 3 | 3 | 4 | 5 | 5 |

A KPMR of 0 (nothing answered) has no predikat, so the final IRA shows **#N/A**, exactly as the template's `INDEX/MATCH` does.

---

## 5. Sheet KPMR (B. KPMR 2025)

### Columns

| Col | Meaning | Source |
|---|---|---|
| C | Question | Template |
| E, F, G | Acuan PBI / PADG, PSP LSB | Template |
| **H** | **Nilai (1–5)**: the PJP's self-score | Form, `score` transform (only 1–5 accepted) |
| **I** | **Penjelasan dan Dokumen Pendukung** | Form upload → Drive link (one per line for several files); opens in the side panel |
| **J** | **Penilaian Pengawas** | `=H5` by default; pengawas overrides (red triangle) |

### Rows

| Pillar | Weight | Question rows | Pillar average row |
|---|---|---|---|
| Tugas dan Tanggung Jawab Direksi dan Pengawasan Aktif Dewan Komisaris | 30% | 5–11 (7) | 12 |
| Kebijakan dan Prosedur Tertulis | 25% | 14–21 (8) | 22 |
| Proses Manajemen Risiko | 25% | 24–33 (10) | 34 |
| Manajemen Sumber Daya Manusia | 10% | 36–38 (3) | 39 |
| Sistem Pengendalian Internal | 10% | 41–43 (3) | 44 |

| Cell | Formula | Meaning |
|---|---|---|
| H12 / J12 (and 22, 34, 39, 44) | `=IFERROR(SUM(H5:H11)/COUNTA(H5:H11),0)` | Pillar average of the **answered** questions; 0 if none |
| **H46 / J46** | **App:** `=H12*0.3+H22*0.25+H34*0.25+H39*0.1+H44*0.1`<br>Template: `=AVERAGE(H12,H22,H34,H39,H44)` | Overall KPMR → A2 row 67 |

The template's headings state the 30/25/25/10/10 weights but its H46/J46 ignored them. The app applies them, and the **export writes the weighted formula into H46/J46**, so the downloaded file matches the app.

The full form-question → row list is in `packages/scoring/config/kpmr-form-2027.ts` (31 score questions → H, 25 document questions → I; rows 36–38 and 41–43 still to verify against the live form).

---

## 6. What the export file contains

`Export Excel` takes the template file and:
1. writes **every input cell** from the database (or blanks it, so nothing from the PJP whose file became the template leaks through);
2. writes C2!B2 as `"{sandi} - {nama}"`;
3. fills **Validasi A–M** for all PJPs from the active LTDBB upload (formula columns C, L, M stay formulas);
4. replaces **KPMR H46/J46** with the weighted formula;
5. sets "recalculate on open", so Excel computes every formula fresh.

---

## 7. Known template quirks

These come from the 2026 template itself. The app reproduces items 2, 3, 5 and 6 **exactly** (they are what the 66 real results were scored with). Items 1, 4 and 7 were changed on purpose; the golden test still checks the template's original formulas and weights.

| # | Where | What happens | Effect |
|---|---|---|---|
| 1 | A2 rows **11 and 27** | Read **C2!D20**, the empty "Jalur Distribusi" heading. The Keterangan ("Kantor PTD risiko Menengah") points to **D22** | Always scored **5**. **Fixed in the app:** reads D22; the export rewrites L11/L27 |
| 2 | A2 rows **52, 53, 57** | Read **D139, D140:D141, D145**, which have no formula (empty in all 66 files); the answers are in column C (1, 4+6 and 47 PJPs answered) | Always score **5**, whatever the PJP reports |
| 3 | A2 row **45** | Sums D35 + D49 + **C58**: a raw PEP *count* mixed with shares | Any PEP pushes the score to 1 |
| 4 | A2 rows **29–32** | Leaf weights 35/10/35/10 sum to **0.9**, not 1 | **Fixed in the app** (2026-10-06): 35/15/35/15 as in BI's BSSS report; the export writes 0.15 into A2 E30/E32 |
| 5 | C2 row **74** | Badan Usaha total is `SUM(C62:C70)`, but rows 72–73 still get shares against it | The group's shares (D74) can add up to more than 100% |
| 6 | Data, 2026 SPI | The 2026 form asked "membentuk unit kerja…" twice; answers were placed by position, so rows 42/43 got the wrong answers and the independent-audit answer was dropped | Affects 2026 results only; the 2027 mapping goes by meaning |
| 7 | KPMR **H46/J46** | Template averaged the pillars equally despite the 30/25/25/10/10 headings | **Fixed in the app** (changes 3 of 66 2026 results) |

Quirks 2–3 are worth raising with the team before the 2027 template is final: as they stand, three parameters can never move.

---

## 8. Where it lives in the code

| Piece | File |
|---|---|
| A2 parameters, weights, rules, predikat, matrix, KPMR weights | `packages/scoring/config/2026.ts` |
| C2 share groups (column D) | `packages/scoring/config/2026-c2.ts` |
| Every formula value the grid shows | `packages/scoring/config/2026-sheet.ts` |
| Which cells are inputs / editable by pengawas | `packages/scoring/config/2026-input-cells.ts` |
| Form → cell mappings (C2 and KPMR) | `scripts/seed-dev.ts`, `packages/scoring/config/kpmr-form-2027.ts` |
| Form ingest (latest wins, transforms, pengawas edits kept) | `apps/web/app/api/ingest/route.ts` |
| LTDBB per-PJP totals | `packages/ltdbb/src/aggregate.ts` |
| Export | `apps/web/app/api/workbooks/[id]/export/route.ts` |
| Check against the 66 real files | `npm run golden-test` (65/66; the 66th is a known malformed file) |
