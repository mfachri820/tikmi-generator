"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ltdbbUploads } from "@ira/db";
import { activateLtdbbUpload } from "@ira/ltdbb";
import { can, getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/ids";

/** Switches the scoring back (or forward) to an earlier upload. */
export async function activateUpload(form: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || !can.edit(me)) return;
  const id = String(form.get("id") ?? "");
  if (!isUuid(id)) return;
  const [upload] = await db.select({ status: ltdbbUploads.status }).from(ltdbbUploads).where(eq(ltdbbUploads.id, id)).limit(1);
  if (upload?.status !== "ready") return;
  await activateLtdbbUpload(db, id);
  revalidatePath("/", "layout");
}
