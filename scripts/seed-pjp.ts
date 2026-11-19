#!/usr/bin/env tsx
/**
 * Builds the PJP master and alias table for the 2025 round from `Lamp. PJP`
 * (Bundling 3 KK; the Bundling 2 copy differs only in how one Sandi is typed)
 * and the Google Form's PJP dropdown (google-form.txt).
 *
 * - Normalised name matches are stored as `auto` aliases and mark the PJP as
 *   supervised by this KPw.
 * - Fuzzy matches are stored as `suggested` for one-click confirmation on
 *   /admin/pjp; the rest as `unmatched` (an admin picks a PJP or enters the
 *   missing Sandi).
 *
 * Safe to re-run: PJP rows are upserted (admin edits to bundling/pengawas are
 * kept) and aliases an admin already decided are never overwritten.
 *
 * Usage: npx tsx scripts/seed-pjp.ts [--dry-run]
 */
import { sql } from "drizzle-orm";
import { createDb, logEvent, pjp, pjpAliases } from "@tikmi/db";
import { planPjpMaster, readFormPjpNames, readLampPjp } from "@tikmi/pjp-master";
import { readFormText, readTemplate } from "./lib/templates2025";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const lamp = await readLampPjp(await readTemplate("mr_kk_b3"));
  const formNames = readFormPjpNames(await readFormText());
  const plan = planPjpMaster(lamp, formNames);

  const { stats } = plan;
  console.log(
    `Lamp. PJP: ${stats.lampRows} rows, ${stats.lampPjp} Sandi. Form: ${stats.formNames} names -> ` +
      `${stats.exact} exact, ${stats.normalized} after normalising, ${stats.suggested} suggested, ${stats.unmatched} unmatched.`,
  );
  const nama = new Map(plan.pjp.map((p) => [p.sandi, p.nama]));
  for (const a of plan.aliases.filter((x) => x.source === "form_list" && x.status !== "auto")) {
    const target = a.suggestedSandi ? ` -> ${a.suggestedSandi} ${nama.get(a.suggestedSandi)} (${a.score?.toFixed(2)})` : a.score ? ` (best ${a.score.toFixed(2)})` : "";
    console.log(`  ${a.status.padEnd(9)} ${a.alias}${target}`);
  }
  if (plan.ambiguousNames.length) console.log(`  ambiguous Lamp names (never auto-matched): ${plan.ambiguousNames.map((n) => n.normalized).join("; ")}`);
  if (dryRun) return;

  const db = createDb();
  await db.transaction(async (tx) => {
    for (const p of plan.pjp) {
      await tx
        .insert(pjp)
        .values({ ...p, source: "lamp_pjp" })
        .onConflictDoUpdate({
          target: pjp.sandi,
          set: { nama: p.nama, kategoriLamp: p.kategoriLamp, formName: p.formName, supervised: p.supervised, sortOrder: p.sortOrder },
        });
    }
    for (const a of plan.aliases) {
      await tx
        .insert(pjpAliases)
        .values({ alias: a.alias, normalized: a.normalized, sandi: a.sandi, suggestedSandi: a.suggestedSandi, score: a.score, status: a.status, source: a.source })
        .onConflictDoUpdate({
          target: pjpAliases.normalized,
          set: { alias: a.alias, sandi: a.sandi, suggestedSandi: a.suggestedSandi, score: a.score, status: a.status, source: a.source },
          // An admin's decision outlives a re-seed.
          setWhere: sql`${pjpAliases.decidedBy} is null`,
        });
    }
    await logEvent(tx, { event: "pjp_master", newValue: stats, reason: "seed dari Lamp. PJP dan daftar Google Form" });
  });
  console.log(`Seeded ${plan.pjp.length} PJP and ${plan.aliases.length} aliases.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
