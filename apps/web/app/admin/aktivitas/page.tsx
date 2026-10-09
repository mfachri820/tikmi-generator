import Link from "next/link";
import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { auditLog, pjp, users, workbooks } from "@ira/db";
import { AppHeader } from "@/components/app-header";
import { PAGE_SIZE, Pagination } from "@/components/pagination";
import { can, requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** Filter value for changes with no signed-in user: the PJP's form (ingest) or a script. */
const SYSTEM = "__system__";

const fmtTime = (d: Date) =>
  d.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });

/** A stored cell value as a short readable string. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "kosong";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

/** Who made a change; changes without a user came from the form or a script. */
function actor(name: string | null, reason: string | null): string {
  if (name) return name;
  if (reason?.startsWith("form ingest")) return "Formulir PJP (otomatis)";
  return "Sistem";
}

/** Admin: every recorded cell change, newest first, filterable by user and PJP. */
export default async function ActivityPage({ searchParams }: PageProps<"/admin/aktivitas">) {
  const me = await requirePageUser("/admin/aktivitas", can.viewActivity);
  const { user: userParam, pjp: pjpParam, page: pageParam } = await searchParams;
  const userFilter = typeof userParam === "string" ? userParam : "";
  const pjpFilter = typeof pjpParam === "string" ? pjpParam : "";

  const conditions: SQL[] = [];
  if (userFilter === SYSTEM) conditions.push(isNull(auditLog.userId));
  else if (userFilter) conditions.push(eq(auditLog.userId, userFilter));
  if (pjpFilter) conditions.push(eq(workbooks.pjpSandi, pjpFilter));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLog)
    .innerJoin(workbooks, eq(workbooks.id, auditLog.workbookId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(Number(pageParam) || 1, 1), pageCount);

  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      cellRef: auditLog.cellRef,
      oldValue: auditLog.oldValue,
      newValue: auditLog.newValue,
      reason: auditLog.reason,
      userName: users.name,
      workbookId: workbooks.id,
      pjpNama: pjp.nama,
      sandi: pjp.sandi,
    })
    .from(auditLog)
    .innerJoin(workbooks, eq(workbooks.id, auditLog.workbookId))
    .innerJoin(pjp, eq(pjp.sandi, workbooks.pjpSandi))
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where)
    .orderBy(desc(auditLog.at))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const userOptions = await db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
  const pjpOptions = await db
    .selectDistinct({ sandi: pjp.sandi, nama: pjp.nama })
    .from(workbooks)
    .innerJoin(pjp, eq(pjp.sandi, workbooks.pjpSandi))
    .orderBy(asc(pjp.nama));

  const hrefFor = (p: number) => {
    const q = new URLSearchParams();
    if (userFilter) q.set("user", userFilter);
    if (pjpFilter) q.set("pjp", pjpFilter);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/admin/aktivitas${s ? `?${s}` : ""}`;
  };
  const select =
    "h-10 rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <div className="min-h-screen">
      <AppHeader active="/admin/aktivitas" user={me} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-9 sm:px-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Aktivitas</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-2">Setiap perubahan isi sel workbook: siapa, kapan, nilai lama dan baru.</p>
        </div>

        <section className="card">
          {/* A plain GET form: filters live in the URL, so a filtered view can be bookmarked or shared. */}
          <form className="flex flex-wrap items-end gap-2.5 px-6 pb-5 pt-6" action="/admin/aktivitas">
            <label>
              <span className="block text-[12.5px] text-ink-2">Pengguna</span>
              <select name="user" defaultValue={userFilter} className={`mt-1 ${select}`}>
                <option value="">Semua pengguna</option>
                <option value={SYSTEM}>Formulir PJP / sistem</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-[12.5px] text-ink-2">PJP</span>
              <select name="pjp" defaultValue={pjpFilter} className={`mt-1 ${select}`}>
                <option value="">Semua PJP</option>
                {pjpOptions.map((p) => (
                  <option key={p.sandi} value={p.sandi}>
                    {p.nama}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-[14px] font-medium text-white hover:bg-brand-strong">
              Terapkan
            </button>
            {(userFilter || pjpFilter) && (
              <Link href="/admin/aktivitas" className="h-10 px-2 text-[13.5px] font-medium leading-10 text-brand hover:underline">
                Reset filter
              </Link>
            )}
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-t border-line text-left text-[14px]">
              <thead className="bg-plane text-[12.5px] text-ink-2">
                <tr>
                  <th className="py-3 pl-6 pr-3 font-medium">Waktu (WIB)</th>
                  <th className="px-3 py-3 font-medium">Pengguna</th>
                  <th className="px-3 py-3 font-medium">PJP</th>
                  <th className="px-3 py-3 font-medium">Sel</th>
                  <th className="px-3 py-3 pr-6 font-medium">Perubahan</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-14 text-center text-ink-3">
                      Belum ada aktivitas{userFilter || pjpFilter ? " untuk filter ini" : ""}.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const i = r.cellRef.lastIndexOf("!");
                  const sheet = r.cellRef.slice(0, i);
                  const address = r.cellRef.slice(i + 1);
                  return (
                    <tr key={r.id} className="border-t border-line align-top odd:bg-surface even:bg-plane">
                      <td className="whitespace-nowrap py-3 pl-6 pr-3 tabular-nums text-ink-2">{fmtTime(r.at)}</td>
                      <td className="px-3 py-3">{actor(r.userName, r.reason)}</td>
                      <td className="px-3 py-3">
                        <span className="font-medium">{r.pjpNama}</span>
                        <span className="block font-mono text-[12px] text-ink-3">{r.sandi}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Link href={`/workbook/${r.workbookId}?sheet=${encodeURIComponent(sheet)}`} className="font-mono text-brand hover:underline">
                          {address}
                        </Link>
                        <span className="block text-[12px] text-ink-3">{sheet}</span>
                      </td>
                      <td className="px-3 py-3 pr-6">
                        <span className="text-ink-3 line-through decoration-ink-3/50">{show(r.oldValue)}</span>
                        <span className="mx-1.5 text-ink-3">→</span>
                        <span className="font-medium">{show(r.newValue)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} hrefFor={hrefFor} />
        </section>
      </main>
    </div>
  );
}
