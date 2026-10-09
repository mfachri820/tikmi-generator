import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { activateLtdbbUpload, importLtdbb, LtdbbParseError } from "@ira/ltdbb";
import { can, requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel caps request bodies at 4.5 MB; refuse bigger files with a clear message instead of a platform error. */
const MAX_BYTES = 4.4 * 1024 * 1024;

/**
 * A new LTDBB workbook from the Data LTDBB page. A route handler rather than a
 * server action: the file (~4 MB) is over the server-action body limit. The
 * file becomes the active data at once; uploading a file that was already
 * imported just makes that copy active again.
 */
export async function POST(req: Request) {
  const { user, denied } = await requireApiUser(can.edit);
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Pilih file LTDBB (.xlsx) terlebih dahulu." }, { status: 400 });
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "File harus berformat .xlsx." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File lebih dari 4,4 MB. Hapus sheet lain selain data LTDBB lalu coba lagi." }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { upload, existing } = await importLtdbb(db, { buffer, filename: file.name, source: "upload", userId: user.id });
    if (existing) {
      if (upload.status !== "ready") {
        const reason = (upload.report as { error?: string } | null)?.error;
        return NextResponse.json({ error: `File ini pernah diunggah dan gagal dibaca${reason ? `: ${reason}` : "."}` }, { status: 422 });
      }
      if (!upload.isActive) await activateLtdbbUpload(db, upload.id);
    }
    revalidatePath("/", "layout");
    return NextResponse.json({
      existing,
      filename: upload.filename,
      rowCount: upload.rowCount,
      minDate: upload.minDate,
      maxDate: upload.maxDate,
    });
  } catch (err) {
    if (err instanceof LtdbbParseError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error("LTDBB upload failed", err);
    return NextResponse.json({ error: "Gagal memproses file. Coba lagi." }, { status: 500 });
  }
}
