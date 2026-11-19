import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { submissionFiles } from "@tikmi/db";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileStore } from "@/lib/fileStorage";
import { isUuid } from "@/lib/ids";

export const runtime = "nodejs";

/** The original of a submitted file, for signed-in users only (files are never public). */
export async function GET(_req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  const { denied } = await requireApiUser();
  if (denied) return denied;
  const { fileId } = await ctx.params;
  if (!isUuid(fileId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [f] = await db.select().from(submissionFiles).where(eq(submissionFiles.id, fileId));
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await fileStore.get(f.storageKey);
  if (!bytes) return NextResponse.json({ error: "File tidak ditemukan di penyimpanan" }, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.originalName)}`,
      "cache-control": "private, no-store",
    },
  });
}
