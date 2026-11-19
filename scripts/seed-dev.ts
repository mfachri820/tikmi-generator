#!/usr/bin/env tsx
/**
 * Local development data, in one go (after `npm run migrate -w @tikmi/db`):
 *
 *   1. period, weights, templates and their view layouts (seed-period.ts)
 *   2. PJP master and aliases (seed-pjp.ts)
 *   3. Sumber BI from the templates (seed-sumber-bi.ts, development only)
 *   4. three users: admin, koordinator and a pengawas (password TIKMI_DEV_PASSWORD, default "tikmi-dev-2025")
 *   5. the real 2025 submissions in TIKMI_FIXTURES_DIR (default ../../../TIKMI/Folder PSP), ingested as form
 *      responses: one folder per PJP with its MR and IT workbook. The PJP name is read from the IT file's
 *      "Informasi" sheet (the MR file's D4 may be the template default), the bundling from the MR file name.
 *      Folders starting with "Kertas Kerja" are skipped. The pengawas is assigned to the first two PJPs.
 *
 * Never run against production: it creates users with a known password and loads PJP files.
 * Usage: DATABASE_URL=... npx tsx scripts/seed-dev.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { assessments, createDb, hashPassword, pjp, users } from "@tikmi/db";
import { processSubmission, registerSubmission, storeFile } from "@tikmi/ingest";
import { definitions2025, readXlsx } from "@tikmi/parser";
import { itApplicability2025 } from "@tikmi/scoring";
import { localStore } from "./lib/localStore";

const FIXTURES = resolve(process.env.TIKMI_FIXTURES_DIR ?? "../../../TIKMI/Folder PSP");
const PASSWORD = process.env.TIKMI_DEV_PASSWORD ?? "tikmi-dev-2025";

function run(script: string) {
  console.log(`\n== ${script}`);
  execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts", script)], { stdio: "inherit", env: process.env });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (/supabase|neon|vercel/i.test(process.env.DATABASE_URL)) throw new Error("seed-dev is for local databases only");
  run("seed-period.ts");
  run("seed-pjp.ts");
  run("seed-sumber-bi.ts");

  const db = createDb();
  console.log("\n== users");
  const passwordHash = await hashPassword(PASSWORD);
  const ids: Record<string, string> = {};
  for (const [email, name, role, initials] of [
    ["admin@tikmi.local", "Admin TIKMI", "admin", "ADM"],
    ["koordinator@tikmi.local", "Koordinator Tim", "koordinator", "KT"],
    ["pengawas@tikmi.local", "Pengawas Satu", "pengawas", "PS"],
  ] as const) {
    const [u] = await db
      .insert(users)
      .values({ email, name, role, initials, passwordHash, mustChangePassword: false })
      .onConflictDoUpdate({ target: users.email, set: { name, role, initials, passwordHash, active: true, mustChangePassword: false } })
      .returning();
    ids[role] = u.id;
    console.log(`  ${role.padEnd(11)} ${email}`);
  }
  console.log(`  password: ${PASSWORD}`);

  if (!existsSync(FIXTURES)) {
    console.log(`\nNo fixtures at ${FIXTURES}: no submissions loaded (set TIKMI_FIXTURES_DIR).`);
    process.exit(0);
  }
  console.log(`\n== submissions from ${FIXTURES}`);
  const deps = { db, store: localStore(), defs: definitions2025, applicability: itApplicability2025 };
  const folders = readdirSync(FIXTURES).filter((f) => !/^kertas kerja/i.test(f) && statSync(resolve(FIXTURES, f)).isDirectory());
  let assigned = 0;
  for (const folder of folders) {
    const files = readdirSync(resolve(FIXTURES, folder)).filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"));
    const it = files.find((f) => /infrastruktur/i.test(f));
    const mr = files.find((f) => !/infrastruktur/i.test(f));
    if (!it && !mr) continue;
    let pjpName = folder;
    if (it) {
      const info = (await readXlsx(await readFile(resolve(FIXTURES, folder, it)))).sheet("Informasi")?.cells.get("D11")?.value;
      if (typeof info === "string" && info.trim()) pjpName = info.trim();
    }
    const bundling = Number(/bundling[\s_]*(\d)/i.exec(mr ?? "")?.[1]) || null;
    const chosen = [...(mr ? [{ kind: "mr" as const, name: mr }] : []), ...(it ? [{ kind: "it" as const, name: it }] : [])];
    const bytes = await Promise.all(chosen.map((c) => readFile(resolve(FIXTURES, folder, c.name))));
    const submittedAt = new Date(Math.max(...chosen.map((c) => statSync(resolve(FIXTURES, folder, c.name)).mtimeMs)));
    const reg = await registerSubmission(db, {
      responseId: `dev:${folder}`,
      submittedAt,
      pjpName,
      bundling,
      answers: {},
      files: chosen.map((c, i) => ({ kind: c.kind, name: c.name, size: bytes[i].length })),
    });
    for (const [i, f] of reg.files.entries()) await storeFile(deps, f.fileId, bytes[i]);
    const res = await processSubmission(deps, reg.submissionId);
    const summary = res.status === "processed" ? res.files.map((o) => `${o.kind}: ${o.activated ? "aktif" : `tidak dipakai (${o.decision.excluded ?? o.notApplied})`}${o.decision.acceptance === "perlu_perbaikan" ? ", Perlu Perbaikan" : ""}`).join("; ") : "PJP belum dikenali";
    console.log(`  ${folder} -> ${pjpName} [${reg.pjpSandi ?? "?"}] v${reg.version}: ${summary}`);
    if (reg.pjpSandi && assigned < 2) {
      await db.update(assessments).set({ pengawasId: ids.pengawas }).where(eq(assessments.pjpSandi, reg.pjpSandi));
      await db.update(pjp).set({ defaultPengawasId: ids.pengawas }).where(eq(pjp.sandi, reg.pjpSandi));
      assigned++;
    }
  }
  console.log("\nDone. Start the app with `npm run dev` and sign in with one of the users above.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
