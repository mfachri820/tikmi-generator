import type { AggregateFlag } from "@ira/ltdbb";

/**
 * Plain-language explanations behind the "i" icons, in one place so every
 * page explains a term the same way. UI copy, so Bahasa Indonesia.
 */

export type FlagKey = AggregateFlag | "PENALTY_EXPECTED";

export const FLAG_HELP: Record<FlagKey, string> = {
  PENALTY_EXPECTED:
    "Total transaksi yang dilaporkan PJP di formulir (C2 baris 18) berbeda lebih dari Rp1.000 dari total LTDBB. Seperti rumus templat (C2!H18), nilai akhir IRA PJP ini dikurangi 1.",
  NOT_IN_LTDBB:
    "PJP ini tidak punya satu pun baris transaksi di file LTDBB untuk tahun data ini. Baris Validasi Data Transaksi-nya ditulis nol, jadi bila PJP melaporkan transaksi di formulir, nilai akhirnya dikurangi 1 (Perbedaan Data).",
  INCOMPLETE_YEAR:
    "Data LTDBB PJP ini ada untuk kurang dari 12 bulan dalam tahun data, sehingga totalnya bisa lebih kecil dari yang dilaporkan PJP. Arahkan kursor ke kolom Bulan untuk melihat bulan yang ada.",
  CODE_OVERRIDDEN:
    "Sebagian baris di file LTDBB tercatat dengan Kode (sandi) PJP yang salah. Aplikasi memindahkannya ke sandi yang benar berdasarkan daftar koreksi kode, sehingga transaksinya dihitung untuk PJP yang tepat.",
  DERIVED_FROM_NILAI:
    "Kolom \"Fin\" di baris ini kosong karena file tidak menyimpan hasil rumusnya. Nilainya dihitung ulang seperti rumus kolom Fin: dari kolom Jumlah, atau dari kolom Nilai × 1.000.000.000 (Nilai dalam miliar Rupiah).",
  MISSING_VALUE:
    "Kolom Fin dan kolom asalnya (Jumlah/Nilai) sama-sama kosong, jadi nilainya dihitung 0.",
  NON_NUMERIC:
    "Ada sel berisi teks, bukan angka. Sel itu diabaikan: dipakai kolom Jumlah/Nilai bila ada, jika tidak dihitung 0. Periksa file LTDBB.",
  NON_INTEGER_FREQ:
    "Frekuensi (jumlah transaksi) di file berupa angka desimal, misalnya 212.036,755. Nilainya dipakai apa adanya, sama seperti di templat.",
  NEGATIVE:
    "Ada nilai negatif di file LTDBB (misalnya koreksi atau pembatalan). Nilainya dipakai apa adanya; periksa kebenarannya.",
  DATE_MISMATCH:
    "Tanggal di kolom Date tidak cocok dengan kolom Month/Year di baris yang sama. Aplikasi memakai Month/Year.",
};

export const HELP = {
  stages:
    "Belum ada workbook: formulir PJP belum masuk. Dibuat: workbook dibuat otomatis dari formulir, belum dinilai. Ditinjau: pengawas sedang menilai. Final: pengawas selesai, menunggu admin. Dikunci: admin mengunci; nilai tidak bisa diubah lagi.",
  finalIra:
    "Nilai akhir IRA 1–5, dari matriks risiko inheren × KPMR di templat (A2 baris 70). 1 = risiko tinggi, 5 = risiko rendah. Memakai nilai pengawas, setelah pengurangan Perbedaan Data. #N/A berarti KPMR belum diisi.",
  attention: "Hal yang memengaruhi nilai atau export. Klik salah satu untuk menyaring tabel di bawah.",
  kpmrMissing:
    "Workbook ini belum punya jawaban KPMR (sheet B. KPMR 2025), jadi nilai akhir IRA belum bisa dihitung (#N/A, sama seperti templat).",
  unassigned:
    "Belum ada pengawas yang ditugaskan untuk PJP ini. Penugasan pengawas belum bisa diatur di aplikasi.",
  statusPjp:
    "Status izin PJP dari daftar formulir (Validasi Data Transaksi), misalnya Aktif, Dicabut, atau Multilicense. PJP yang tidak Aktif ditampilkan abu-abu.",
  formulir: "Tanggal formulir IRA terakhir yang masuk dari PJP. \"Belum masuk\" berarti belum ada kiriman.",
  inherent:
    "Nilai risiko inheren & struktural (A2 baris 64, nilai pengawas) dan predikatnya, dari Tinggi sampai Rendah.",
  kpmr:
    "Nilai kualitas penerapan APU PPT PPPSPM (KPMR, sheet B) dan predikatnya: Strong paling baik, Unsatisfactory paling buruk.",
  catatan: "Penanda yang memengaruhi nilai: Perbedaan Data (nilai akhir −1) dan masalah data LTDBB PJP ini.",
  ltdbbSource:
    "File transaksi LTDBB yang dipakai untuk sheet Validasi Data Transaksi dan pengecekan Perbedaan Data. Tanpa file ini export diblokir.",
  // LTDBB page
  ltdbbRowFlags: "Penanda untuk baris-baris di file LTDBB yang perlu diketahui saat membaca totalnya. Angka di sampingnya = jumlah baris.",
  ltdbbPenalty:
    "PJP yang sudah punya workbook dan total laporannya berbeda lebih dari Rp1.000 dari LTDBB. Nilai akhirnya akan dikurangi 1.",
  ltdbbPolicy:
    "Cara aplikasi menangani data LTDBB yang kurang lengkap: \"peringatan saja\" berarti workbook tetap bisa di-export; \"export diblokir\" berarti tidak.",
  ltdbbUnknownKode:
    "Kode di file LTDBB yang tidak ada di daftar 85 PJP formulir. Transaksinya tidak dihitung untuk PJP mana pun; mungkin perlu ditambahkan ke daftar koreksi kode.",
  bulan: "Jumlah bulan dalam tahun data yang punya baris LTDBB untuk PJP ini. Arahkan kursor untuk melihat bulannya.",
  dilaporkan:
    "Total nominal transaksi yang dilaporkan PJP sendiri di formulir (C2 baris 18). \"—\" berarti PJP belum punya workbook.",
  selisih: "Dilaporkan PJP dikurangi Total Nominal LTDBB. Selisih lebih dari Rp1.000 berarti Perbedaan Data.",
  hasil:
    "Sesuai: selisih paling banyak Rp1.000. Perbedaan Data: lebih dari itu, nilai akhir dikurangi 1.",
  // Workbook page
  highlightInputs: "Memberi garis biru pada sel yang bisa diisi atau diubah oleh pengawas.",
} as const;
