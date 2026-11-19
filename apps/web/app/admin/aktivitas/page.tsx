import Link from "next/link";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { assessments, auditEvent, auditLog, pjp, users, type AuditEvent } from "@tikmi/db";
import { AppHeader } from "@/components/app-header";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import { can, requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<AuditEvent, string> = {
  cell: "Isian",
  koreksi: "Koreksi",
  ingest: "Penyampaian",
  version: "Versi file",
  status: "Status",
  finalize: "Final",
  reopen: "Dibuka kembali",
  assign: "Penugasan",
  setting: "Pengaturan",
  weights: "Bobot",
  sumber_bi: "Sumber BI",
  pjp_master: "Data PJP",
  bundling: "Bundling",
  applicability: "Sheet TI berlaku",
  perbaikan_override: "Terima Perlu Perbaikan",
  export: "Export",
};

const fmtTime = (d: Date) =>
  d.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

/** Every recorded change and event, newest first, filterable by kind and PJP. */
export default async function ActivityPage({ searchParams }: PageProps<"/admin/aktivitas">) {
  const me = await requirePageUser("/admin/aktivitas", can.viewActivity);
  const { event: eventParam, pjp: pjpParam, page: pageParam } = await searchParams;
  const eventFilter = typeof eventParam === "string" && (auditEvent.enumValues as string[]).includes(eventParam) ? (eventParam as AuditEvent) : "";
  const pjpFilter = typeof pjpParam === "string" ? pjpParam : "";

  const conditions: SQL[] = [];
  if (eventFilter) conditions.push(eq(auditLog.event, eventFilter));
  if (pjpFilter) conditions.push(eq(assessments.pjpSandi, pjpFilter));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLog)
    .leftJoin(assessments, eq(assessments.id, auditLog.assessmentId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(Number(pageParam) || 1, 1), pageCount);
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      event: auditLog.event,
      cellRef: auditLog.cellRef,
      oldValue: auditLog.oldValue,
      newValue: auditLog.newValue,
      reason: auditLog.reason,
      userName: users.name,
      sandi: assessments.pjpSandi,
      nama: pjp.nama,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(assessments, eq(assessments.id, auditLog.assessmentId))
    .leftJoin(pjp, eq(pjp.sandi, assessments.pjpSandi))
    .where(where)
    .orderBy(desc(auditLog.at))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const href = (p: number) => {
    const q = new URLSearchParams({ ...(eventFilter && { event: eventFilter }), ...(pjpFilter && { pjp: pjpFilter }), page: String(p) });
    return `/admin/aktivitas?${q}`;
  };

  return (
    <div className="min-h-screen">
      <AppHeader active="/admin/aktivitas" user={me} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-9 sm:px-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Aktivitas</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-2">Semua perubahan dan kejadian: penyampaian, versi file, isian, koreksi, keputusan pengawas.</p>
        </div>
        <form className="flex flex-wrap gap-2 text-[13.5px]" action="/admin/aktivitas">
          <select name="event" defaultValue={eventFilter} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
            <option value="">Semua jenis</option>
            {auditEvent.enumValues.map((e) => (
              <option key={e} value={e}>
                {EVENT_LABEL[e]}
              </option>
            ))}
          </select>
          <input name="pjp" defaultValue={pjpFilter} placeholder="Sandi PJP" className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5" />
          <button className="rounded-lg bg-ink px-3 py-1.5 font-medium text-white">Terapkan</button>
        </form>
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line bg-plane text-left text-[12px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-3 py-2">Waktu</th>
                <th className="px-3 py-2">Jenis</th>
                <th className="px-3 py-2">PJP</th>
                <th className="px-3 py-2">Sel</th>
                <th className="px-3 py-2">Sebelum → sesudah</th>
                <th className="px-3 py-2">Oleh / alasan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2">{fmtTime(r.at)}</td>
                  <td className="px-3 py-2">{EVENT_LABEL[r.event]}</td>
                  <td className="px-3 py-2">{r.sandi ? <Link href={`/pjp/${r.sandi}`} className="hover:underline">{r.nama ?? r.sandi}</Link> : "–"}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.cellRef ?? "–"}</td>
                  <td className="px-3 py-2">
                    {show(r.oldValue)} → {show(r.newValue)}
                  </td>
                  <td className="px-3 py-2">
                    {r.userName ?? <span className="text-ink-3">Sistem / formulir</span>}
                    {r.reason && <div className="text-[12px] text-ink-3">{r.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={total} hrefFor={href} />
      </main>
    </div>
  );
}
