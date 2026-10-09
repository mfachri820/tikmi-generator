/** Role names as the UI shows them, with what each may do. Shared by server and client code. */
export const ROLE_LABELS = { admin: "Admin", pengawas: "Pengawas", viewer: "Peninjau (hanya lihat)" } as const;

export const ROLE_HELP = {
  admin: "Semua akses, termasuk mengelola pengguna dan melihat log aktivitas.",
  pengawas: "Melihat dan menilai semua PJP, serta export.",
  viewer: "Melihat semua PJP dan export, tanpa bisa mengubah nilai.",
} as const;
