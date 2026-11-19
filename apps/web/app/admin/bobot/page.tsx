import { eq } from "drizzle-orm";
import { periods, templateVersions } from "@tikmi/db";
import { a2Items, defaultWeights2026, itemRowOf, scoringConfig2026, type WeightSet } from "@tikmi/scoring/config/2026";
import type { ExtractedLayout } from "@tikmi/template";
import { AppHeader } from "@/components/app-header";
import { can, requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { layoutText } from "@/lib/layoutOverrides";
import { loadWeights, weightHistory } from "@/lib/weights";
import { WeightsEditor, type WeightStructure } from "./weights-editor";

const A2 = "A2. PJP ALL peng";
const CATEGORY_HEADINGS: Record<string, string> = { TPPU: "B5", TPPT: "B21", PPSPM: "B36", Struktural: "B49" };

/** Fractions → percentages for the form (40 = 40%). */
const toPercent = (w: WeightSet): WeightSet => {
  const p = (g: Record<string, number>) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Math.round(v * 1e6) / 1e4]));
  return { categories: p(w.categories), items: p(w.items), leaves: p(w.leaves), kpmrPillars: p(w.kpmrPillars) };
};

/** Admin: every weight of the assessment, for the active period. */
export default async function WeightsPage() {
  const me = await requirePageUser("/admin/bobot", can.manageWeights);
  const [period] = await db
    .select({ id: periods.id, year: periods.year, layoutJson: templateVersions.layoutJson })
    .from(periods)
    .innerJoin(templateVersions, eq(templateVersions.id, periods.templateVersionId))
    .where(eq(periods.status, "active"))
    .limit(1);

  if (!period) {
    return (
      <div className="min-h-screen">
        <AppHeader active="/admin/bobot" user={me} />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center text-ink-2">Belum ada periode aktif.</main>
      </div>
    );
  }

  const text = layoutText(period.layoutJson as ExtractedLayout);
  const clean = (v: unknown) => String(v ?? "").replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*%\s*\)\s*/, "").replace(/\s+/g, " ").trim();
  const structure: WeightStructure = {
    categories: Object.keys(scoringConfig2026.categoryWeights).map((key) => ({
      key,
      label: clean(text(`${A2}!${CATEGORY_HEADINGS[key]}`)) || key,
      items: a2Items
        .filter((i) => i.category === key)
        .map((i) => ({
          key: String(i.row),
          label: clean(text(`${A2}!C${i.row}`)) || `Baris ${i.row}`,
          params: scoringConfig2026.parameters
            .filter((p) => itemRowOf(p.id) === i.row)
            .map((p) => ({ key: p.id, label: clean(text(`${A2}!C${p.id}`)) || p.label, detail: p.label })),
        })),
    })),
    pillars: [...new Set(scoringConfig2026.kpmrQuestions.map((q) => q.pillar))].map((p) => ({ key: p, label: p })),
  };

  const [weights, history] = await Promise.all([loadWeights(db, period.id), weightHistory(db, period.id)]);

  return (
    <div className="min-h-screen">
      <AppHeader active="/admin/bobot" user={me} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-9 sm:px-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Bobot penilaian</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-2">
            Bobot untuk periode {period.year}. Perubahan langsung berlaku untuk semua PJP: nilai di Beranda, workbook, Template Excel, dan
            BSSS - PJP Individu.
          </p>
        </div>
        <WeightsEditor
          structure={structure}
          current={toPercent(weights)}
          defaults={toPercent(defaultWeights2026)}
          history={history.map((h) => ({ id: h.id, at: h.createdAt.toISOString(), by: h.by, note: h.note }))}
        />
      </main>
    </div>
  );
}
