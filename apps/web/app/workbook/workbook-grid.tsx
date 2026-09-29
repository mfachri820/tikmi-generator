"use client";

import { useMemo, useState } from "react";
import { computeWorkbookScores, type Score } from "@ira/scoring";
import { scoringConfig2026 } from "@ira/scoring/config/2026";

const CATEGORY_ORDER = ["TPPU", "TPPT", "PPSPM", "Struktural"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  TPPU: "Risiko Inheren TPPU (40%)",
  TPPT: "Risiko Inheren TPPT (25%)",
  PPSPM: "Risiko Inheren PPSPM (5%)",
  Struktural: "Risiko Struktural (30%)",
};

const KPMR_PILLARS = [
  "Tugas Dan Tanggung Jawab Direksi Dan Pengawasan Aktif Dewan Komisaris",
  "Kebijakan Dan Prosedur Tertulis",
  "Proses Manajemen Risiko",
  "Manajemen Sumber Daya Manusia",
  "Sistem Pengendalian Internal",
];

/** Demo PJP self-score every KPMR question starts at, since no real form data feeds this view yet. */
const DEMO_KPMR_PJP_SCORE = 5;

function ScoreSelect({
  value,
  onChange,
}: {
  value: Score | undefined;
  onChange: (value: Score | undefined) => void;
}) {
  return (
    <select
      className="w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : (Number(e.target.value) as Score))}
    >
      <option value="">Default</option>
      {([1, 2, 3, 4, 5] as const).map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

export function WorkbookGrid() {
  const [overrides, setOverrides] = useState<Record<string, Score | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [kpmrOverrides, setKpmrOverrides] = useState<Record<string, number | undefined>>({});
  const [hasDataMismatch, setHasDataMismatch] = useState(false);

  const result = useMemo(() => {
    const parameters = scoringConfig2026.parameters.map((p) => ({
      id: p.id,
      // No form ingest wired up yet -- every share starts at 0%, the same
      // "no data reported" default the real template falls back to.
      share: 0,
      pengawasScore: overrides[p.id],
    }));
    const kpmrAnswers = scoringConfig2026.kpmrQuestions.map((q) => ({
      id: q.id,
      pjpScore: DEMO_KPMR_PJP_SCORE,
      pengawasScore: kpmrOverrides[q.id],
    }));
    return computeWorkbookScores(scoringConfig2026, { parameters, kpmrAnswers, hasDataMismatch });
  }, [overrides, kpmrOverrides, hasDataMismatch]);

  const resolvedById = useMemo(() => new Map(result.parameters.map((p) => [p.id, p])), [result]);

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-10">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          A2. Penilaian Risiko Inheren TPPU, TPPT dan PPSPM
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Demo interaktif dari @ira/scoring. Nilai PJP memakai data kosong (0%) karena ingest formulir belum
          terhubung -- ubah Nilai Pengawas atau tandai Perbedaan Data untuk melihat skor, predikat dan Nilai Akhir
          IRA dihitung ulang secara langsung.
        </p>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const params = scoringConfig2026.parameters.filter((p) => p.category === category);
        const categoryScore = result.categoryScores.pengawas[category];
        const categoryWeight = scoringConfig2026.categoryWeights[category];

        return (
          <section key={category}>
            <h2 className="mb-2 font-medium text-zinc-800 dark:text-zinc-100">{CATEGORY_LABELS[category]}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left text-zinc-500 dark:border-zinc-700">
                  <th className="w-10 py-1.5 pr-2 font-normal">No</th>
                  <th className="py-1.5 pr-2 font-normal">Parameter</th>
                  <th className="w-16 py-1.5 pr-2 text-right font-normal">Bobot</th>
                  <th className="w-16 py-1.5 pr-2 text-right font-normal">Nilai PJP</th>
                  <th className="w-28 py-1.5 pr-2 font-normal">Nilai Pengawas</th>
                  <th className="py-1.5 pr-2 font-normal">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => {
                  const resolved = resolvedById.get(p.id)!;
                  return (
                    <tr key={p.id} className="border-b border-zinc-200 last:border-0 dark:border-zinc-800">
                      <td className="py-1.5 pr-2 align-top text-zinc-400">{p.id}</td>
                      <td className="py-1.5 pr-2 align-top">{p.label}</td>
                      <td className="py-1.5 pr-2 text-right align-top tabular-nums">
                        {(p.weight * 100).toFixed(1)}%
                      </td>
                      <td className="py-1.5 pr-2 text-right align-top tabular-nums">{resolved.pjpValue}</td>
                      <td className="py-1.5 pr-2 align-top">
                        <ScoreSelect
                          value={overrides[p.id]}
                          onChange={(value) => setOverrides((s) => ({ ...s, [p.id]: value }))}
                        />
                      </td>
                      <td className="py-1.5 pr-2 align-top">
                        <input
                          className="w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                          value={notes[p.id] ?? ""}
                          onChange={(e) => setNotes((s) => ({ ...s, [p.id]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-right text-sm text-zinc-600 dark:text-zinc-400">
              Nilai Terbobot: {(categoryWeight * categoryScore).toFixed(2)} (Bobot kategori{" "}
              {(categoryWeight * 100).toFixed(0)}%)
            </p>
          </section>
        );
      })}

      <section className="space-y-1 border-t border-zinc-300 pt-6 dark:border-zinc-700">
        <h2 className="font-medium text-zinc-800 dark:text-zinc-100">Rekap Nilai Risiko Inheren & Struktural</h2>
        <p className="text-sm">
          Nilai: <span className="tabular-nums">{result.inherentScore.pengawas.toFixed(2)}</span> — Predikat:{" "}
          {result.inherentPredikat.pengawas}
        </p>
      </section>

      <section className="space-y-3 border-t border-zinc-300 pt-6 dark:border-zinc-700">
        <h2 className="font-medium text-zinc-800 dark:text-zinc-100">B. KPMR 2025</h2>
        {KPMR_PILLARS.map((pillar) => {
          const questions = scoringConfig2026.kpmrQuestions.filter((q) => q.pillar === pillar);
          return (
            <div key={pillar}>
              <h3 className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">{pillar}</h3>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {questions.map((q, i) => (
                    <tr key={q.id} className="border-b border-zinc-200 last:border-0 dark:border-zinc-800">
                      <td className="w-8 py-1 pr-2 text-zinc-400">{i + 1}.</td>
                      <td className="w-32 py-1 pr-2 text-right tabular-nums">
                        Nilai PJP: {DEMO_KPMR_PJP_SCORE}
                      </td>
                      <td className="w-28 py-1 pr-2">
                        <ScoreSelect
                          value={kpmrOverrides[q.id] as Score | undefined}
                          onChange={(value) => setKpmrOverrides((s) => ({ ...s, [q.id]: value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        <p className="text-sm">
          Nilai KPMR: <span className="tabular-nums">{result.kpmrOverall.pengawas.toFixed(2)}</span> — Predikat:{" "}
          {result.kpmrPredikat.pengawas}
        </p>
      </section>

      <section className="space-y-2 border-t border-zinc-300 pt-6 dark:border-zinc-700">
        <h2 className="font-medium text-zinc-800 dark:text-zinc-100">Nilai Akhir Individual Risk Assessment</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasDataMismatch}
            onChange={(e) => setHasDataMismatch(e.target.checked)}
          />
          Perbedaan Data (C2!H18)
        </label>
        <p className="text-sm">
          Pengawas: <span className="tabular-nums">{result.finalIra.pengawasRaw}</span> —{" "}
          {result.finalIraPredikat.pengawasRaw}
        </p>
        <p className="text-sm">
          Setelah penyesuaian Perbedaan Data:{" "}
          <span className="tabular-nums">{result.finalIra.pengawasAdjusted}</span> —{" "}
          {result.finalIraPredikat.pengawasAdjusted}
        </p>
      </section>
    </div>
  );
}
