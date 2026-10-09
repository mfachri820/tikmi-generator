"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { periods, weightSettings, workbooks, pjp } from "@ira/db";
import { aggregateYear, getActiveLtdbbUpload } from "@ira/ltdbb";
import { weightProblems, withDefaultWeights, type WeightSet } from "@ira/scoring/config/2026";
import { can, getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadWeights } from "@/lib/weights";
import { loadWorkbookView } from "@/lib/workbookView";

export type SaveState = { error?: string; saved?: boolean };

export interface ImpactRow {
  nama: string;
  inherent: [string, string];
  kpmr: [string, string];
  final: [number | null, number | null];
}

async function activePeriod() {
  const [period] = await db.select().from(periods).where(eq(periods.status, "active")).limit(1);
  return period;
}

/** Percentages from the form → a complete weight set of fractions. */
function parseWeights(json: string): WeightSet | null {
  try {
    const raw = JSON.parse(json) as WeightSet;
    const frac = (group: Record<string, number>) =>
      Object.fromEntries(Object.entries(group).map(([k, v]) => [k, Math.round(Number(v) * 10000) / 1000000]));
    return withDefaultWeights({
      categories: frac(raw.categories),
      items: frac(raw.items),
      leaves: frac(raw.leaves),
      kpmrPillars: frac(raw.kpmrPillars),
    });
  } catch {
    return null;
  }
}

export async function saveWeights(_prev: SaveState, form: FormData): Promise<SaveState> {
  const me = await getCurrentUser();
  if (!me || !can.manageWeights(me)) return { error: "Hanya admin yang bisa mengubah bobot." };
  const period = await activePeriod();
  if (!period) return { error: "Tidak ada periode aktif." };
  const weights = parseWeights(String(form.get("weights") ?? ""));
  if (!weights) return { error: "Data bobot tidak terbaca." };
  const problems = weightProblems(weights);
  if (problems.length) return { error: `Belum 100%: ${problems.map((p) => p.group).join(", ")}.` };

  await db.insert(weightSettings).values({
    periodId: period.id,
    weights,
    note: String(form.get("note") ?? "").trim() || null,
    createdBy: me.id,
  });
  revalidatePath("/", "layout");
  return { saved: true };
}

/** Which PJPs' results would change with these weights, compared with the weights in force now. */
export async function previewWeights(json: string): Promise<{ error?: string; rows?: ImpactRow[]; total?: number }> {
  const me = await getCurrentUser();
  if (!me || !can.manageWeights(me)) return { error: "Hanya admin yang bisa mengubah bobot." };
  const period = await activePeriod();
  if (!period) return { error: "Tidak ada periode aktif." };
  const proposed = parseWeights(json);
  if (!proposed) return { error: "Data bobot tidak terbaca." };
  if (weightProblems(proposed).length) return { error: "Lengkapi dulu semua kelompok sampai 100%." };

  const current = await loadWeights(db, period.id);
  const upload = await getActiveLtdbbUpload(db);
  const ltdbbRows = upload ? (await aggregateYear(db, upload.id, period.dataYear)).rows : [];
  const ltdbbContext = { upload, rowsBySandi: new Map(ltdbbRows.map((r) => [r.sandi, r])) };
  const list = await db
    .select({ id: workbooks.id, nama: pjp.nama })
    .from(workbooks)
    .innerJoin(pjp, eq(pjp.sandi, workbooks.pjpSandi))
    .where(eq(workbooks.periodId, period.id));

  const rows: ImpactRow[] = [];
  for (const w of list) {
    const before = await loadWorkbookView(db, w.id, ltdbbContext, current);
    const after = await loadWorkbookView(db, w.id, ltdbbContext, proposed);
    if (!before || !after) continue;
    const fin = (x: number) => (Number.isFinite(x) ? x : null);
    const row: ImpactRow = {
      nama: w.nama,
      inherent: [before.scores.inherentPredikat.pengawas, after.scores.inherentPredikat.pengawas],
      kpmr: [before.scores.kpmrPredikat.pengawas, after.scores.kpmrPredikat.pengawas],
      final: [fin(before.scores.finalIra.pengawasAdjusted), fin(after.scores.finalIra.pengawasAdjusted)],
    };
    if (row.inherent[0] !== row.inherent[1] || row.kpmr[0] !== row.kpmr[1] || row.final[0] !== row.final[1]) rows.push(row);
  }
  return { rows, total: list.length };
}
