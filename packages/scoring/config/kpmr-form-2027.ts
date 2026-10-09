/**
 * The 2027 Google Form's KPMR section -> the template's "B. KPMR 2025" rows:
 * each question's 1-5 answer goes to H (the PJP's self-score) and its
 * supporting-document upload to I (the evidence link). J, the pengawas score,
 * is never written by the form.
 *
 * Keyed by question title, a stand-in until the form's Apps Script item IDs
 * are known (`dumpItems()`; see TODO-form-ingest-2027.md). Ingest matches
 * titles with whitespace collapsed, so the form's stray double/trailing
 * spaces don't matter -- but any other wording change breaks the match, which
 * is exactly why item IDs should replace these.
 *
 * Titles are copied from the form as pasted on 2026-10-05, typos included
 * (e.g. "dtetapkan", "PPPSPMx`"). `verified: false` rows are past where that
 * paste was cut off: their question title is the template's own wording and
 * their document question is unknown, so check both against the live form.
 */

const SHEET = "B. KPMR 2025";

export interface KpmrFormQuestion {
  row: number;
  /** Title of the 1-5 question -> H{row}. */
  scoreQuestion: string;
  /** Title of the supporting-document upload -> I{row}; null when not known yet. */
  documentQuestion: string | null;
  verified: boolean;
}

export const kpmrFormQuestions2027: KpmrFormQuestion[] = [
  // Tugas Dan Tanggung Jawab Direksi Dan Pengawasan Aktif Dewan Komisaris (30%)
  {
    row: 5,
    scoreQuestion:
      "Apakah Direksi telah menetapkan Kebijakan dan Prosedur Tertulis (KPT) APU PPT PPPSPM dengan ketentuan dan perundang-undangan yang berlaku serta disetujui oleh Dewan Komisaris?",
    documentQuestion: "Kebijakan dan Prosedur Tertulis (KPT) APU PPT PPPSPM yang telah dtetapkan Direksi dan disetujui oleh Dewan Komisaris",
    verified: true,
  },
  {
    row: 6,
    scoreQuestion: "Apakah terdapat laporan yang disampaikan kepada Direksi untuk memastikan bahwa KPT APU PPT PPPSPM telah diterapkan secara efektif?",
    documentQuestion: "Laporan yang disampaikan kepada Direksi untuk memastikan bahwa KPT APU PPT PPPSPM telah diterapkan secara efektif",
    verified: true,
  },
  {
    row: 7,
    scoreQuestion: "Apakah Direksi melakukan pengkinian KPT APU PPT PPPSPM sesuai dengan ketentuan terkini?",
    documentQuestion: "Dokumen Pendukung pengkinian KPT APU PPT PPPSPM",
    verified: true,
  },
  {
    row: 8,
    scoreQuestion:
      "Apakah Direksi telah memastikan bahwa pelaporan LTKM, LTKT, LTKL dan laporan lainnya ke PPATK telah dilaksanakan sesuai ketentuan?",
    documentQuestion:
      "Dokumen Pendukung Direksi telah memastikan bahwa pelaporan LTKM, LTKT, LTKL dan laporan lainnya ke PPATK telah dilaksanakan sesuai ketentuan",
    verified: true,
  },
  {
    row: 9,
    scoreQuestion: "Apakah Direksi memastikan bahwa seluruh pegawai telah memperoleh pengetahuan dan/atau pelatihan mengenai penerapan APU PPT PPPSPM?",
    documentQuestion:
      "Dokumen Pendukung Direksi memastikan bahwa seluruh pegawai telah memperoleh pengetahuan dan/atau pelatihan mengenai penerapan APU PPT PPPSPM",
    verified: true,
  },
  {
    row: 10,
    scoreQuestion: "Apakah Direksi memastikan pengkinian profil nasabah dan profil transaksi nasabah?",
    documentQuestion: "Dokumen Pendukung pengkinian profil nasabah dan profil transaksi nasabah",
    verified: true,
  },
  {
    row: 11,
    scoreQuestion: "Apakah Dewan Komisaris telah mengawasi pelaksanaan tugas dan tanggung jawab Direksi terhadap penerapan APU PPT PPPSPM?",
    documentQuestion:
      "Dokumen Pendukung Dewan Komisaris telah mengawasi pelaksanaan tugas dan tanggung jawab Direksi terhadap penerapan APU PPT PPPSPMx`",
    verified: true,
  },

  // Kebijakan Dan Prosedur Tertulis (25%)
  {
    row: 14,
    scoreQuestion: "Apakah Penyelenggara telah memiliki, melaksanakan, dan mengembangkan KPT terkait APU PPT PPPSPM?",
    documentQuestion: "Dokumen Pendukung memiliki, melaksanakan, dan mengembangkan KPT terkait APU PPT PPPSPM",
    verified: true,
  },
  {
    row: 15,
    scoreQuestion: "Apakah Penyelenggara memantau, mengevaluasi, dan meningkatkan efektivitas penerapan KPT APU PPT PPPSPM?",
    documentQuestion: "Dokumen Pendukung Penyelenggara memantau, mengevaluasi, dan meningkatkan efektivitas penerapan KPT APU PPT PPPSPM",
    verified: true,
  },
  {
    row: 16,
    scoreQuestion: "Apakah Penyelenggara memiliki KPT yang lengkap mengenai Customer Due Diligence (CDD)?",
    documentQuestion: "Dokumen Pendukung Kelengkapan KPT mengenai Customer Due Diligence (CDD)",
    verified: true,
  },
  {
    row: 17,
    scoreQuestion: "Apakah Penyelenggara memiliki KPT yang lengkap mengenai pengelolaan data, informasi, dan dokumen?",
    documentQuestion: "Dokumen Pendukung KPT yang lengkap mengenai pengelolaan data, informasi, dan dokumen",
    verified: true,
  },
  {
    row: 18,
    scoreQuestion: "Apakah Penyelenggara memiliki KPT yang lengkap mengenai pelaporan transaksi mencurigakan dan laporan lainnya?",
    documentQuestion: "Dokumen Pendukung KPT yang lengkap mengenai pelaporan transaksi mencurigakan dan laporan lainnya",
    verified: true,
  },
  {
    row: 19,
    scoreQuestion: "Bagi Penyelenggara yang menyelenggarakan kegiatan transfer dana, apakah memiliki KPT yang lengkap mengenai Transfer Dana?",
    documentQuestion: "Dokumen Pendukung KPT yang lengkap mengenai Transfer Dana",
    verified: true,
  },
  {
    row: 20,
    scoreQuestion:
      "Bagi Penyelenggara yang merupakan kelompok usaha, apakah memiliki KPT yang lengkap mengenai penerapan APU PPT PPPSPM terhadap Kelompok Usaha?",
    documentQuestion: "Dokumen Pendukung KPT yang lengkap mengenai penerapan APU PPT PPPSPM terhadap Kelompok Usaha",
    verified: true,
  },
  {
    row: 21,
    scoreQuestion: "Apakah Penyelenggara memiliki KPT yang lengkap mengenai penanganan DTTOT dan DPPSPM?",
    documentQuestion: "Dokumen Pendukung KPT yang lengkap mengenai penanganan DTTOT dan DPPSPM",
    verified: true,
  },

  // Proses Manajemen Risiko (25%)
  {
    row: 24,
    scoreQuestion:
      "Apakah Penyelenggara telah menerapkan APU PPT PPPSPM dengan cara mengidentifikasi, menilai, dan memahami proses manajemen risiko (termasuk aspek pengendalian dan mitigasi) sesuai dengan pedoman Risk Based Approach (RBA) untuk Penyelenggara?",
    documentQuestion:
      "Dokumen Pendukung Penyelenggara telah menerapkan APU PPT PPPSPM dengan cara mengidentifikasi, menilai, dan memahami proses manajemen risiko (termasuk aspek pengendalian dan mitigasi)",
    verified: true,
  },
  {
    row: 25,
    scoreQuestion: "Apakah identifikasi dan penilaian risiko Penyelenggara telah meliputi seluruh faktor risiko dengan memadai?",
    documentQuestion: "Dokumen Pendukung identifikasi dan penilaian risiko Penyelenggara telah meliputi seluruh faktor risiko dengan memadai",
    verified: true,
  },
  {
    row: 26,
    scoreQuestion:
      "Apakah Penyelenggara telah mengacu pada hasil identifikasi dan penilaian risiko oleh otoritas yang berwenang serta dokumen dan informasi terkait lainnya?",
    documentQuestion:
      "Dokumen Pendukung Penyelenggara telah mengacu pada hasil identifikasi dan penilaian risiko oleh otoritas yang berwenang serta dokumen dan informasi terkait lainnya",
    verified: true,
  },
  {
    row: 27,
    scoreQuestion:
      "Dalam hal penyelenggara menilai risiko yang dihadapi dalam kegiatan usahanya semakin meningkat, apakah Penyelanggara telah melakukan peningkatan pengendalian dan mitigasi risiko TPPU, TPPT, dan PPSPM?",
    documentQuestion:
      "Dokumen Pendukung penyelenggara menilai risiko yang dihadapi dalam kegiatan usahanya semakin meningkat, apakah Penyelanggara telah melakukan peningkatan pengendalian dan mitigasi risiko TPPU, TPPT, dan PPSPM",
    verified: true,
  },
  {
    row: 28,
    // A multi-line title on the form; whitespace-collapsed matching makes the line breaks irrelevant.
    scoreQuestion:
      "Apakah Penyelenggara: a. melakukan pengkinian secara berkala; b. mendokumentasikan; dan c. memiliki mekanisme penyediaan informasi yang memadai bagi otoritas yang berwenang.",
    documentQuestion:
      "Dokumen Pendukung a. melakukan pengkinian secara berkala; b. mendokumentasikan; dan c. memiliki mekanisme penyediaan informasi yang memadai bagi otoritas yang berwenang.",
    verified: true,
  },
  {
    row: 29,
    scoreQuestion:
      "Apakah Penyelenggara telah melakukan pengkinian secara berkala terhadap profil nasabah dan profil transaksi, serta melakukan pemantauan kesesuaian transaksi terhadap profil?",
    documentQuestion:
      "Dokumen Pendukung telah melakukan pengkinian secara berkala terhadap profil nasabah dan profil transaksi, serta melakukan pemantauan kesesuaian transaksi terhadap profil",
    verified: true,
  },
  {
    row: 30,
    scoreQuestion:
      "Apakah Penyelenggara telah menunjuk Manajemen Senior yang bertanggung jawab dalam pelaksanaan hubungan usaha dan/atau Transaksi dengan calon Pengguna Jasa, Pengguna Jasa, atau Beneficial Owner yang termasuk kategori berisiko tinggi?",
    documentQuestion:
      "Dokumen Pendukung Penyelenggara telah menunjuk Manajemen Senior yang bertanggung jawab dalam pelaksanaan hubungan usaha dan/atau Transaksi dengan calon Pengguna Jasa, Pengguna Jasa, atau Beneficial Owner yang termasuk kategori berisiko tinggi",
    verified: true,
  },
  {
    row: 31,
    scoreQuestion: "Apakah Penyelenggara telah menatausahakan Daftar Pengguna Jasa yang mendapat perlakuan EDD?",
    documentQuestion: "Dokumen Pendukung Penyelenggara telah menatausahakan Daftar Pengguna Jasa yang mendapat perlakuan EDD",
    verified: true,
  },
  {
    row: 32,
    scoreQuestion:
      "Apakah Penyelenggara telah melakukan EDD dan langkah pencegahan (countermeasures) yang proporsional dan memadai terhadap risiko dari hubungan usaha dan/atau Transaksi dengan calon Pengguna Jasa dan/atau Pengguna Jasa, yang berasal dari negara berisiko tinggi yang dipublikasikan oleh FATF?",
    documentQuestion: "Dokumen Pendukung Penyelenggara telah melakukan EDD dan langkah pencegahan (countermeasures)",
    verified: true,
  },
  {
    row: 33,
    scoreQuestion:
      "Apakah Penyelenggara melakukan identifikasi, penilaian dan mitigasi risiko PU dan PT sebelum melakukan pengembangan produk baru dan/atau menggunakan teknologi baru?",
    documentQuestion:
      "Dokumen Pendukung Penyelenggara melakukan identifikasi, penilaian dan mitigasi risiko PU dan PT sebelum melakukan pengembangan produk baru dan/atau menggunakan teknologi baru",
    verified: true,
  },

  // Manajemen Sumber Daya Manusia (10%)
  {
    row: 36,
    scoreQuestion:
      "Apakah Penyelenggara melakukan proses penyaringan penerimaan pegawai yang terkait penerapan APU PPT PPPSPM (pre-employee screening) secara efektif?",
    documentQuestion: null,
    verified: false, // score title seen on the form; the paste ended before its document question
  },
  {
    row: 37,
    scoreQuestion:
      "Apakah Penyelenggara melakukan proses Know Your Employee (KYE) yang menghasilkan profil pegawai yang terkait penerapan APU PPT PPPSPM dan melakukan pemantauan serta pengkinian profil pegawai dimaksud secara berkala?",
    documentQuestion: null,
    verified: false,
  },
  {
    row: 38,
    scoreQuestion:
      "Apakah Penyelenggara melakukan pelatihan dan peningkatanan pemahaman (awareness) mengenai APU, PPT, dan PPPSPM terhadap pegawai yang terkait penerapan APU PPT PPPSPM secara berkesinambungan?",
    documentQuestion: null,
    verified: false,
  },

  // Sistem Pengendalian Internal (10%)
  {
    row: 41,
    scoreQuestion:
      "Apakah Penyelenggara telah membentuk unit kerja, penetapan fungsi dan/atau menunjuk Manajemen senior yang bertanggung jawab khusus untuk penerapan APU PPT PPPSPM?",
    documentQuestion: null,
    verified: false,
  },
  {
    row: 42,
    scoreQuestion:
      "Apakah Penyelenggara telah melakukan pemisahan wewenang dan tanggung jawab antara pihak yang melaksanakan fungsi audit dengan unit bisnis?",
    documentQuestion: null,
    verified: false,
  },
  {
    row: 43,
    scoreQuestion:
      "Apakah telah dilakukan audit independen (Internal/eksternal) secara berkala untuk menguji kepatuhan dan efektivitas penerapan APU PPT dan PPPSPM?",
    documentQuestion: null,
    verified: false,
  },
];

/** `field_mappings` rows for these questions: score -> H (transform "score"), document -> I ("drive_link"). */
export function kpmrFieldMappings2027(): { formColumn: string; targetCell: string; transform: string }[] {
  return kpmrFormQuestions2027.flatMap((q) => [
    { formColumn: q.scoreQuestion, targetCell: `${SHEET}!H${q.row}`, transform: "score" },
    ...(q.documentQuestion
      ? [{ formColumn: q.documentQuestion, targetCell: `${SHEET}!I${q.row}`, transform: "drive_link" }]
      : []),
  ]);
}
