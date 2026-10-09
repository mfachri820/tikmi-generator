import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { loadPeriodOverview } from "@/lib/periodOverview";
import { AppHeader } from "@/components/app-header";
import { HomeDashboard } from "./home-dashboard";

export const dynamic = "force-dynamic";

/** Beranda: the active period at a glance -- every PJP, where its workbook stands, and its live scores. */
export default async function Home() {
  const user = await requirePageUser("/");
  const overview = await loadPeriodOverview(db);

  return (
    <div className="min-h-screen">
      <AppHeader
        active="/"
        user={user}
      />

      {overview.period ? (
        <HomeDashboard overview={overview} />
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="card mx-auto max-w-md p-8 text-center">
            <h1 className="text-lg font-semibold">Belum ada periode aktif</h1>
            <p className="mt-2 text-[13px] text-ink-2">
              Jalankan <code className="rounded bg-plane px-1 py-0.5 font-mono text-[12px]">npm run seed-dev</code> untuk
              membuat periode 2026 beserta data contoh.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
