/** Role names as the UI shows them, with what each may do. Shared by server and client code. */
export const ROLE_LABELS = {
  admin: "Admin",
  koordinator: "Koordinator / Ketua Tim",
  pengawas: "Pengawas",
  viewer: "Peninjau (hanya lihat)",
} as const;

export const ROLE_HELP = {
  admin: "Semua akses, termasuk mengelola pengguna, membuka kembali asesmen Final, dan melihat log aktivitas.",
  koordinator: "Melihat dan menilai semua PJP, menetapkan Final, dan membuka kembali asesmen Final (dengan alasan).",
  pengawas: "Melihat semua PJP; menilai dan mengunggah file hanya untuk PJP yang ditugaskan kepadanya.",
  viewer: "Melihat semua PJP dan export, tanpa bisa mengubah apa pun.",
} as const;
