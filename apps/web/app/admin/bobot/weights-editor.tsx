"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import type { WeightSet } from "@tikmi/scoring/config/2026";
import { previewWeights, saveWeights, type ImpactRow, type SaveState } from "./actions";

export interface WeightStructure {
  categories: {
    key: string;
    label: string;
    items: { key: string; label: string; params: { key: string; label: string; detail: string }[] }[];
  }[];
  pillars: { key: string; label: string }[];
}

type Group = keyof WeightSet;

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0) * 100) / 100;
const isHundred = (x: number) => Math.abs(x - 100) < 0.01;
const fmt = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

function Total({ value }: { value: number }) {
  const ok = isHundred(value);
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums ${ok ? "bg-brand-soft text-brand-strong" : "bg-[#fbeaea] text-status-critical"}`}
      title={ok ? "Jumlah 100%" : "Jumlah harus 100%"}
    >
      {ok ? "✓ " : ""}
      {fmt(value)}%
    </span>
  );
}

export function WeightsEditor({
  structure,
  current,
  defaults,
  history,
}: {
  structure: WeightStructure;
  /** Percentages in force now. */
  current: WeightSet;
  defaults: WeightSet;
  history: { id: string; at: string; by: string | null; note: string | null }[];
}) {
  const [w, setW] = useState<WeightSet>(current);
  const [note, setNote] = useState("");
  const [state, action, saving] = useActionState<SaveState, FormData>(saveWeights, {});
  const [impact, setImpact] = useState<{ rows?: ImpactRow[]; total?: number; error?: string } | null>(null);
  const [previewing, startPreview] = useTransition();

  // After a successful save the page re-renders with the new weights as "current".
  useEffect(() => {
    if (state.saved) {
      setNote("");
      setImpact(null);
    }
  }, [state.saved]);
  useEffect(() => setW(current), [current]);

  const set = (group: Group, key: string, value: string) => {
    setImpact(null);
    setW((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value === "" ? NaN : Number(value) } }));
  };

  const totals = useMemo(() => {
    const out: { label: string; total: number }[] = [];
    out.push({ label: "Kategori risiko", total: sum(structure.categories.map((c) => w.categories[c.key])) });
    for (const c of structure.categories) {
      out.push({ label: `Faktor ${c.label}`, total: sum(c.items.map((i) => w.items[i.key])) });
      for (const i of c.items) out.push({ label: `${i.label} (${c.key})`, total: sum(i.params.map((p) => w.leaves[p.key])) });
    }
    out.push({ label: "Pilar KPMR", total: sum(structure.pillars.map((p) => w.kpmrPillars[p.key])) });
    return out;
  }, [w, structure]);
  const wrong = totals.filter((t) => !isHundred(t.total));
  const changed = (group: Group, key: string) => Math.abs((w[group][key] ?? 0) - (current[group][key] ?? 0)) > 1e-9;
  const changedCount = (["categories", "items", "leaves", "kpmrPillars"] as Group[]).reduce(
    (n, g) => n + Object.keys(w[g]).filter((k) => changed(g, k)).length,
    0,
  );

  const input = (group: Group, key: string, label: string) => (
    <label className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={100}
        step={0.01}
        value={Number.isFinite(w[group][key]) ? w[group][key] : ""}
        onChange={(e) => set(group, key, e.target.value)}
        aria-label={`Bobot ${label}`}
        className={`h-8 w-20 rounded-md border px-2 text-right text-[13.5px] tabular-nums outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 ${
          changed(group, key) ? "border-[#e0b44a] bg-[#fef6e2]" : "border-line-strong bg-surface"
        }`}
      />
      <span className="text-[13px] text-ink-3">%</span>
    </label>
  );

  return (
    <div className="space-y-5">
      {/* Status and actions, kept in view while editing. */}
      <section className="card sticky top-16 z-20 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[13.5px]">
            {wrong.length === 0 ? (
              <span className="text-brand-strong">✓ Semua kelompok berjumlah 100%.</span>
            ) : (
              <span className="text-status-critical">
                {wrong.length} kelompok belum 100%: {wrong.slice(0, 3).map((t) => `${t.label} (${fmt(t.total)}%)`).join(", ")}
                {wrong.length > 3 ? ", …" : ""}
              </span>
            )}
            {changedCount > 0 && <span className="ml-2 text-ink-3">· {changedCount} bobot diubah</span>}
          </p>
          <button
            onClick={() => {
              setW(defaults);
              setImpact(null);
            }}
            className="h-9 rounded-lg px-3 text-[13px] font-medium text-ink-2 hover:bg-plane"
            title="Isi formulir dengan bobot bawaan (belum disimpan)"
          >
            Kembalikan ke bawaan
          </button>
          <button
            onClick={() => {
              setW(current);
              setImpact(null);
            }}
            disabled={changedCount === 0}
            className="h-9 rounded-lg px-3 text-[13px] font-medium text-ink-2 hover:bg-plane disabled:opacity-40"
          >
            Batalkan perubahan
          </button>
          <button
            onClick={() => startPreview(async () => setImpact(await previewWeights(JSON.stringify(w))))}
            disabled={wrong.length > 0 || changedCount === 0 || previewing}
            className="h-9 rounded-lg border border-line-strong px-3 text-[13px] font-medium text-ink hover:bg-plane disabled:opacity-40"
          >
            {previewing ? "Menghitung…" : "Pratinjau dampak"}
          </button>
        </div>
        <form
          action={action}
          onSubmit={(e) => {
            if (!confirm("Simpan bobot baru? Nilai semua PJP di periode ini langsung dihitung ulang.")) e.preventDefault();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="weights" value={JSON.stringify(w)} />
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan perubahan (opsional), mis. 'Bobot TPPT mengikuti BSSS'"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button
            type="submit"
            disabled={wrong.length > 0 || changedCount === 0 || saving}
            className="h-9 rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            {saving ? "Menyimpan…" : "Simpan bobot"}
          </button>
        </form>
        {state.error && <p className="rounded-lg bg-[#fbeaea] px-3 py-2 text-[13px] text-status-critical">{state.error}</p>}
        {state.saved && changedCount === 0 && (
          <p className="rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-strong">Bobot disimpan. Semua nilai sudah memakai bobot baru.</p>
        )}
      </section>

      {impact && (
        <section className="card p-5">
          <h2 className="card-title mb-2">Dampak perubahan</h2>
          {impact.error ? (
            <p className="text-[13.5px] text-status-critical">{impact.error}</p>
          ) : impact.rows && impact.rows.length === 0 ? (
            <p className="text-[13.5px] text-ink-2">Tidak ada predikat atau nilai akhir yang berubah pada {impact.total} PJP yang punya workbook.</p>
          ) : (
            <>
              <p className="mb-3 text-[13.5px] text-ink-2">
                {impact.rows?.length} dari {impact.total} PJP berubah:
              </p>
              <table className="w-full text-left text-[13.5px]">
                <thead className="text-[12.5px] text-ink-2">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">PJP</th>
                    <th className="px-3 py-1.5 font-medium">Predikat inheren</th>
                    <th className="px-3 py-1.5 font-medium">Predikat KPMR</th>
                    <th className="px-3 py-1.5 font-medium">Nilai akhir</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.rows?.map((r) => (
                    <tr key={r.nama} className="border-t border-line">
                      <td className="py-1.5 pr-3 font-medium">{r.nama}</td>
                      {[r.inherent, r.kpmr, r.final].map((pair, i) => (
                        <td key={i} className={`px-3 py-1.5 ${pair[0] !== pair[1] ? "font-semibold" : "text-ink-3"}`}>
                          {pair[0] ?? "#N/A"} {pair[0] !== pair[1] && <>→ {pair[1] ?? "#N/A"}</>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="card-title">Kategori risiko</h2>
          <Total value={sum(structure.categories.map((c) => w.categories[c.key]))} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {structure.categories.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-3 rounded-lg bg-plane px-3 py-2">
              <span className="text-[13.5px]">{c.label}</span>
              {input("categories", c.key, c.label)}
            </div>
          ))}
        </div>
      </section>

      {structure.categories.map((c) => (
        <section key={c.key} className="card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="card-title">
              {c.label} <span className="ml-2 font-normal text-ink-3">· faktor di dalamnya</span>
            </h2>
            <Total value={sum(c.items.map((i) => w.items[i.key]))} />
          </div>
          <div className="space-y-3">
            {c.items.map((item) => (
              <div key={item.key} className="rounded-lg ring-1 ring-line">
                <div className="flex items-center justify-between gap-3 bg-plane px-3 py-2">
                  <span className="text-[13.5px] font-medium">{item.label}</span>
                  {input("items", item.key, item.label)}
                </div>
                <div className="space-y-1 px-3 py-2">
                  {item.params.map((p) => (
                    <div key={p.key} className="flex items-center justify-between gap-3 py-0.5" title={p.detail}>
                      <span className="min-w-0 text-[13px] text-ink-2">
                        <span className="mr-1.5 font-mono text-[11.5px] text-ink-3">baris {p.key}</span>
                        {p.label}
                      </span>
                      {input("leaves", p.key, p.label)}
                    </div>
                  ))}
                  {item.params.length > 1 && (
                    <div className="flex justify-end pt-1">
                      <Total value={sum(item.params.map((p) => w.leaves[p.key]))} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="card-title">Pilar KPMR</h2>
          <Total value={sum(structure.pillars.map((p) => w.kpmrPillars[p.key]))} />
        </div>
        <div className="space-y-2">
          {structure.pillars.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-3 rounded-lg bg-plane px-3 py-2">
              <span className="text-[13.5px]">{p.label}</span>
              {input("kpmrPillars", p.key, p.label)}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="card-title mb-2">Riwayat perubahan</h2>
        {history.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">Belum pernah diubah: memakai bobot bawaan.</p>
        ) : (
          <ul className="space-y-1.5 text-[13.5px]">
            {history.map((h, i) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-ink-2">{fmtTime(h.at)}</span>
                <span className="font-medium">{h.by ?? "—"}</span>
                {h.note && <span className="text-ink-2">· {h.note}</span>}
                {i === 0 && <span className="rounded bg-brand-soft px-1.5 text-[12px] text-brand-strong">berlaku</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
