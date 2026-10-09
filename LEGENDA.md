# Legenda IRA PJP

What every score, label, flag, colour and abbreviation in the app (and the IRA workbook) means. For where each number is calculated, see [DATA-PIPELINE.md](DATA-PIPELINE.md).

---

## 1. Scores

All scores run **1 to 5. Higher is better: 5 = lowest risk / best practice, 1 = highest risk / weakest.**

### Nilai Risiko Inheren & Struktural (A2 row 64)

The weighted risk score from the PJP's own data: TPPU 40% · TPPT 25% · PPSPM 5% · Struktural 30%.

| Score | Predikat |
|---|---|
| 4.50 – 5.00 | **Rendah** |
| 3.75 – 4.49 | **Rendah ke Menengah** |
| 3.00 – 3.74 | **Menengah** |
| 2.00 – 2.99 | **Menengah ke Tinggi** |
| 1.00 – 1.99 | **Tinggi** |

### Nilai KPMR (KPMR row 46)

How well the PJP manages AML/CFT risk, from the 31 KPMR questions; pillars weighted Direksi 30% · KPT 25% · Proses MR 25% · SDM 10% · SPI 10%.

| Score | Predikat |
|---|---|
| 4.50 – 5.00 | **Strong** |
| 3.75 – 4.49 | **Satisfactory** |
| 3.00 – 3.74 | **Fair** |
| 2.00 – 2.99 | **Marginal** |
| 1.00 – 1.99 | **Unsatisfactory** |

### KPMR answer scale (each question)

| Value | Meaning (as in the form) |
|---|---|
| 1 | Penyelenggara **tidak melaksanakan** |
| 2 | Melaksanakan **sebagian kecil** |
| 3 | Melaksanakan **sebagian** |
| 4 | Melaksanakan **sebagian besar** |
| 5 | **Sepenuhnya** melaksanakan |

### Nilai Akhir IRA (A2 row 70)

Inherent predikat × KPMR predikat, looked up in the template's matrix, **minus 1 for Perbedaan Data** (never below 1). Its predikat uses the inherent scale (Tinggi … Rendah).

| Inherent \ KPMR | Unsatisfactory | Marginal | Fair | Satisfactory | Strong |
|---|---|---|---|---|---|
| Tinggi | 1 | 1 | 2 | 3 | 3 |
| Menengah ke Tinggi | 1 | 2 | 2 | 3 | 4 |
| Menengah | 2 | 2 | 3 | 4 | 4 |
| Rendah ke Menengah | 2 | 3 | 4 | 4 | 5 |
| Rendah | 3 | 3 | 4 | 5 | 5 |

**#N/A**: the KPMR has no answers yet, so there is no KPMR predikat and no final score (same as the template).

### Nilai PJP vs Nilai Pengawas

Every score exists twice. The **PJP version** is calculated from the PJP's own answers (A2 column L, KPMR column H). The **pengawas version** (A2 column O, KPMR column J) starts equal to it and is what the pengawas confirms or changes. **Beranda and the final score always use the pengawas version.**

---

## 2. Flags and notes

### On a PJP (Beranda "Catatan" column, workbook status bar)

| Label | Meaning | Effect |
|---|---|---|
| **Perbedaan Data** | The total the PJP reported in the form (C2 row 18) differs from its LTDBB total for the data year by **more than Rp1.000** | Final IRA **−1** (minimum 1) |
| **Tidak ada di LTDBB** | The PJP has no transaction rows at all in the LTDBB file for the data year; its Validasi row is written as zero | If the PJP reported transactions, this also triggers Perbedaan Data |
| **LTDBB < 12 bulan** | LTDBB has the PJP for fewer than 12 months of the data year | Its LTDBB total may be too low, so a Perbedaan Data here may not be the PJP's fault |
| **KPMR belum diisi** | No KPMR answers yet | Final IRA is #N/A |

### Perbedaan Data check, LTDBB page

| Label | Meaning |
|---|---|
| **Dilaporkan** | Total nominal the PJP reported (C2 row 18); "—" = no workbook yet |
| **Selisih** | Dilaporkan − LTDBB total |
| **Sesuai** | Difference at most Rp1.000 |
| **Perbedaan Data** | Difference above Rp1.000 → final IRA −1 |

### On LTDBB file rows (LTDBB page)

| Label | Meaning |
|---|---|
| **Kode dikoreksi** | Rows filed under the wrong PJP code were moved to the right sandi (code-correction list) |
| **Dihitung dari Nilai** | The "Fin" column was empty; recomputed from Jumlah, or Nilai × 1.000.000.000 (Nilai is in billions) |
| **Nilai kosong** | Fin and its source columns are all empty; counted as 0 |
| **Bukan angka** | A cell holds text, not a number; ignored |
| **Frekuensi desimal** | Transaction count has decimals (e.g. 212.036,755); used as-is, like the template |
| **Nilai negatif** | A negative value (correction/cancellation); used as-is, check it |
| **Tanggal tidak cocok** | The Date column disagrees with Month/Year; Month/Year is used |
| **Kode LTDBB tanpa PJP di daftar formulir** | An LTDBB code that is not one of the 85 PJPs; not counted for anyone |

---

## 3. Workbook stages

| Stage | Meaning |
|---|---|
| **Belum ada workbook** | No form submission from the PJP yet |
| **Dibuat** | Workbook created automatically from the form; not assessed yet |
| **Ditinjau** | A pengawas is assessing it |
| **Final** | Pengawas finished; waiting for admin |
| **Dikunci** | Locked by admin; values can no longer change |

## 4. Status PJP (licence status)

| Status | Meaning |
|---|---|
| **Aktif** | Licensed and supervised here |
| **Dicabut** | Licence revoked |
| **Dicabut atas Permintaan sendiri** | Licence returned at the PJP's own request |
| **Proses Pencabutan Izin** | Revocation in progress |
| **Proses Pengembalian Izin** | Licence return in progress |
| **Multilicense** | Holds several licences (supervised under another arrangement) |
| **Pindah Kepengawasan** | Moved to another supervisor |

PJPs that are not Aktif are shown in grey on Beranda.

---

## 5. Colours and markers in the workbook grid

| What you see | Meaning |
|---|---|
| **Yellow / light-orange cell** | Template's own input colour: KPMR "Penilaian Pengawas" (J), A2 pengawas "Nilai" (O), C2 "Diisi PJP" (C) |
| **Small red triangle, top-right** | Pengawas score **differs from the PJP's** (an override); hover to see |
| **▼ next to a selected cell** | Score cell: click or press 1–5 to choose, Delete returns to the PJP's value |
| **Blue underlined link** | Supporting document: click (or Space) to open in the side panel, Ctrl+click for a new tab |
| **Green outline** | Selected cell |

### Bars and banners

| Where | Text | Meaning |
|---|---|---|
| Title bar | *Ada perubahan belum disimpan* → *Menyimpan…* → *Tersimpan* | Edits are saved ~2 s after you stop typing, on **Simpan / Ctrl+S**, and when you leave the page |
| Title bar | *Gagal menyimpan* | Save failed; it retries automatically |
| Yellow banner | *…sudah diubah oleh X* + **Timpa dengan nilai saya** | Someone else changed the same cell first; their value was kept. The button overwrites with yours |
| Blue banner | *Workbook diperbarui oleh X* | Someone else changed this workbook; the grid refreshed (checked every 30 s while the tab is open) |
| Status bar | **Perbedaan Data** (yellow), **Data LTDBB belum ada** (red) | See section 2 |

---

## 6. Abbreviations

| Term | Meaning |
|---|---|
| **IRA** | Individual Risk Assessment |
| **PJP** | Penyedia Jasa Pembayaran (payment service provider) |
| **KI 3** | Kategori Izin 3 (licence category 3) |
| **PTD** | Penyelenggara Transfer Dana (remittance operator) |
| **APMK** | Alat Pembayaran Menggunakan Kartu (card payments) |
| **UE / DE** | Uang Elektronik / Dompet Elektronik |
| **LTDBB** | BI's monthly per-PJP transaction data file; the reference the form total is checked against |
| **APU PPT PPPSPM** | Anti Pencucian Uang, Pencegahan Pendanaan Terorisme, Pencegahan Pendanaan Proliferasi Senjata Pemusnah Massal |
| **TPPU** | Tindak Pidana Pencucian Uang (money laundering) |
| **TPPT** | Tindak Pidana Pendanaan Terorisme (terrorist financing) |
| **PPSPM** | Pendanaan Proliferasi Senjata Pemusnah Massal (proliferation financing) |
| **KPMR** | Kualitas Penerapan Manajemen Risiko |
| **KPT** | Kebijakan dan Prosedur Tertulis |
| **MR / SDM / SPI** | Manajemen Risiko / Sumber Daya Manusia / Sistem Pengendalian Internal |
| **SRA / NRA** | Sectoral / National Risk Assessment |
| **FATF** | Financial Action Task Force; *Black List* = high-risk jurisdictions, *Grey List* = increased monitoring |
| **PEP** | Politically Exposed Person |
| **UBO** | Ultimate Beneficial Owner |
| **CDD / EDD** | Customer Due Diligence / Enhanced Due Diligence |
| **KYE** | Know Your Employee |
| **DTTOT** | Daftar Terduga Teroris dan Organisasi Teroris |
| **DPPSPM** | Daftar Pendanaan Proliferasi Senjata Pemusnah Massal |
| **LTKM / LTKT / LTKL** | Laporan Transaksi Keuangan Mencurigakan / Tunai / Transfer Dana dari dan ke Luar Negeri |
| **PPATK** | Pusat Pelaporan dan Analisis Transaksi Keuangan |
| **PBI / PADG** | Peraturan Bank Indonesia / Peraturan Anggota Dewan Gubernur |
| **KPw** | Kantor Perwakilan (BI regional office) |
| **Sandi** | The PJP's code number (e.g. 777248911) |
