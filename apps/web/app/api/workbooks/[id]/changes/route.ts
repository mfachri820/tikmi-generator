import { NextResponse } from "next/server";
import { auditLog, users } from "@tikmi/db";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { workbookVersion } from "@/lib/workbookVersion";
import { requireApiUser } from "@/lib/auth";

/**
 * What an open workbook page polls (every 30 s, only while it's visible and in
 * use): one small query for the workbook's version. Only when it differs from
 * `?since=` does it also say who made the latest change; the page then reloads
 * the full view from GET /api/workbooks/[id].
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { denied } = await requireApiUser();
  if (denied) return denied;
  const { id } = await ctx.params;
  const version = isUuid(id) ? await workbookVersion(db, id) : null;
  if (!version) {
    return NextResponse.json({ error: "Workbook tidak ditemukan." }, { status: 404 });
  }

  const updatedAt = version.toISOString();
  const since = new URL(req.url).searchParams.get("since");
  if (since === updatedAt) {
    return NextResponse.json({ updatedAt, changed: false });
  }

  const [last] = await db
    .select({ by: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.workbookId, id))
    .orderBy(desc(auditLog.at))
    .limit(1);
  return NextResponse.json({ updatedAt, changed: true, by: last?.by ?? null });
}
