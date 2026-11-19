#!/usr/bin/env tsx
/**
 * Creates the 2025 assessment period (data Jan–Des 2025, deadline 19 Nov 2026
 * 23.59 WIB; official Rating M left unset until the methodology owner confirms) and its risk weights.
 *
 * Weights: each bundling's rows come from the KK of that bundling (the
 * Bundling 2 KK carries an outdated Bundling 3 row). They are stored as the
 * first version of `weight_sets` (source "template:<file>") and stay editable
 * on the period settings page while the methodology owner confirms them.
 * Re-running adds nothing when the stored weights already match the templates.
 *
 * Templates: one `templates` row per role (sha256, storage key templates/<period>/<role>.xlsx). With
 * SUPABASE_URL / SUPABASE_SECRET_KEY set, the files are uploaded to the private bucket too.
 *
 * Usage: npx tsx scripts/seed-period.ts [--dry-run]
 */
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { createDb, logEvent, periods, templates, weightSets, type TemplateRole } from "@tikmi/db";
import { definitions2025 } from "@tikmi/parser";
import { inputCellRefs } from "@tikmi/scoring";
import { extractViewLayout } from "@tikmi/template";
import { RISK_KEYS, readTemplate, readWeightTable, TEMPLATE_FILES, type TemplateKey, type WeightRow } from "./lib/templates2025";

const PERIOD = {
  code: "2025",
  dataYear: 2025,
  posisi: "1 Januari - 31 Desember",
  // 19 Nov 2026 23.59 WIB (UTC+7).
  deadline: new Date("2026-11-19T23:59:00+07:00"),
  status: "active" as const,
};

async function weightsFor(bundling: 2 | 3): Promise<(WeightRow & { file: string })[]> {
  const key = bundling === 2 ? "mr_kk_b2" : "mr_kk_b3";
  const rows = await readWeightTable(await readTemplate(key));
  return rows.filter((r) => r.bundling === String(bundling)).map((r) => ({ ...r, file: TEMPLATE_FILES[key] }));
}

/**
 * The viewer's layout of a KK template (styles, merges, fixed text; no input or formula values, so the KK's
 * sample PJP never reaches the database). Only the KKs the app shows get one.
 */
async function viewLayout(role: TemplateKey, bytes: Buffer) {
  const defs = definitions2025;
  if (role === "mr_kk_b2" || role === "mr_kk_b3") {
    const def = defs.mr[role === "mr_kk_b2" ? 2 : 3];
    const S = def.sheets;
    return extractViewLayout(bytes, [S.risiko, S.tkmr, S.permodalan, S.form, S.lamp1], inputCellRefs(def));
  }
  if (role === "it_kk") {
    const it = defs.it;
    const sheets = ["Informasi", ...it.sheets.filter((x) => !x.pipOnly).map((x) => x.name)];
    const inputs = new Set<string>(["Informasi!D11", "Informasi!D13", "Informasi!D15", "Informasi!D17"]);
    for (const x of it.sheets) for (const r of x.rows) for (const c of ["E", "F", "G", "I", "J"]) inputs.add(`${x.name}!${c}${r.row}`);
    return extractViewLayout(bytes, sheets, inputs);
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = [...(await weightsFor(2)), ...(await weightsFor(3))];
  for (const r of rows) {
    const sum = RISK_KEYS.reduce((s, k) => s + r.weights[k], 0);
    console.log(`Bundling ${r.bundling} / ${r.bentukLembaga}: ${RISK_KEYS.map((k) => `${k} ${r.weights[k]}`).join(", ")} (sum ${sum.toFixed(4)})`);
    if (Math.abs(sum - 1) > 1e-9) console.warn(`  ! weights do not sum to 1`);
  }
  if (dryRun) return;

  const db = createDb();
  await db.transaction(async (tx) => {
    const [period] = await tx
      .insert(periods)
      .values(PERIOD)
      .onConflictDoUpdate({ target: periods.code, set: { dataYear: PERIOD.dataYear, posisi: PERIOD.posisi, deadline: PERIOD.deadline } })
      .returning();
    for (const r of rows) {
      const bundling = Number(r.bundling);
      const [current] = await tx
        .select()
        .from(weightSets)
        .where(and(eq(weightSets.periodId, period.id), eq(weightSets.bundling, bundling), eq(weightSets.bentukLembaga, r.bentukLembaga)))
        .orderBy(desc(weightSets.createdAt))
        .limit(1);
      if (current) continue; // never replace a stored (possibly admin-edited) version on re-seed
      await tx.insert(weightSets).values({ periodId: period.id, bundling, bentukLembaga: r.bentukLembaga, weights: r.weights, source: `template:${r.file}` });
      await logEvent(tx, { event: "weights", newValue: { bundling, bentukLembaga: r.bentukLembaga, weights: r.weights }, reason: `seed dari ${r.file}` });
    }
    console.log(`Period ${period.code} ready (${period.id}).`);
  });

  const [period] = await db.select().from(periods).where(eq(periods.code, PERIOD.code));
  const sb = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }) : null;
  const bucket = process.env.TIKMI_STORAGE_BUCKET ?? "tikmi-files";
  for (const role of Object.keys(TEMPLATE_FILES) as TemplateKey[]) {
    const bytes = await readTemplate(role);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `templates/${PERIOD.code}/${role}.xlsx`;
    const layoutJson = await viewLayout(role, bytes);
    const inserted = await db
      .insert(templates)
      .values({ periodId: period.id, role: role as TemplateRole, filename: TEMPLATE_FILES[role], sha256, storageKey, layoutJson })
      .onConflictDoUpdate({ target: [templates.periodId, templates.role, templates.sha256], set: { layoutJson } })
      .returning();
    if (sb) {
      const { error } = await sb.storage.from(bucket).upload(storageKey, bytes, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      if (error) throw error;
    }
    console.log(`Template ${role}: registered${layoutJson ? ", view layout extracted" : ""}${sb ? ", uploaded" : " (no storage configured: not uploaded)"} (${inserted.length})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
