import Link from "next/link";
import { db } from "@/lib/db";
import { getDevUser } from "@/lib/devUser";
import { loadPeriodOverview } from "@/lib/periodOverview";
import { HomeDashboard } from "./home-dashboard";

export const dynamic = "force-dynamic";

/** Beranda: the active period at a glance -- every PJP, where its workbook stands, and its live scores. */
export default async function Home() {
  await getDevUser(db); // Placeholder auth guard until Auth.js lands.
  const overview = await loadPeriodOverview(db);

  return (
    <div className="min-h-screen bg-zinc-50 text-[13px] text-zinc-900">
      <header className="bg-[#217346] text-white">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-white text-[11px] font-bold text-[#217346]">
            IRA
          </span>
          <span className="text-sm font-semibold">IRA PJP</span>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <span className="rounded bg-white/20 px-2.5 py-1 font-medium">Beranda</span>
            <Link href="/admin/ltdbb" className="rounded px-2.5 py-1 text-white/90 hover:bg-white/15">
              Data LTDBB
            </Link>
          </nav>
        </div>
      </header>

      {overview.period ? (
        <HomeDashboard overview={overview} />
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <h1 className="text-xl font-semibold">Belum ada periode aktif</h1>
          <p className="mt-2 text-zinc-600">
            Jalankan <code>npm run seed-dev</code> untuk membuat periode 2026 beserta data contoh.
          </p>
        </main>
      )}
    </div>
  );
}
