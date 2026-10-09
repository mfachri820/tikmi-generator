import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadWorkbookView } from "@/lib/workbookView";
import { requireApiUser } from "@/lib/auth";

export async function GET(_req: Request, ctx: RouteContext<"/api/workbooks/[id]">) {
  const { denied } = await requireApiUser();
  if (denied) return denied;
  const { id } = await ctx.params;
  const view = await loadWorkbookView(db, id);
  if (!view) {
    return NextResponse.json({ error: "Workbook not found" }, { status: 404 });
  }
  return NextResponse.json(view);
}
