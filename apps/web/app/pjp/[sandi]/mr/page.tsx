import Link from "next/link";
import { notFound } from "next/navigation";
import { KkViewer } from "@/components/kk-viewer";
import { requirePageUser } from "@/lib/auth";
import { loadMrView } from "@/lib/assessmentView";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const num = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : v === null || v === undefined ? "–" : String(v));

/** The PJP's MR Kertas Kerja, read-only (slice 6a): its answers in the KK, with every formula computed live. */
export default async function MrWorkbookPage({ params, searchParams }: PageProps<"/pjp/[sandi]/mr">) {
  const { sandi } = await params;
  const { sheet: sheetParam } = await searchParams;
  await requirePageUser(`/pjp/${sandi}/mr`);
  const v = await loadMrView(db, sandi);
  if (!v) notFound();
  // One sheet per request: the KKs are large, so only the sheet in view is sent to the browser.
  const index = Math.min(Math.max(Number(sheetParam) || 0, 0), v.sheets.length - 1);
  const sheetName = v.sheets[index];
  const sheet = v.layout?.sheets.find((s) => s.name === sheetName);
  const prefix = `${sheetName}!`;
  const values = Object.fromEntries(Object.entries(v.values).filter(([k]) => k.startsWith(prefix)));
  const sources = Object.fromEntries(Object.entries(v.sources).filter(([k]) => k.startsWith(prefix)));
  const tabs = v.sheets.map((name, i) => ({ name, href: `/pjp/${sandi}/mr?sheet=${i}`, active: i === index }));

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-surface px-4 py-2 text-[13.5px]">
        <Link href={`/pjp/${sandi}`} className="text-ink-3 hover:underline">
          ← {v.pjp.nama}
        </Link>
        <span className="font-semibold">Kertas Kerja MR · Bundling {v.assessment.bundling}</span>
        <span className="text-ink-2">
          Rating M Asesmen Mandiri (C64): <b className="tabular-nums">{num(v.summary.ratingM.template.score)}</b> {String(v.summary.ratingM.template.predikat ?? "")}
        </span>
        <span className="text-ink-2">
          Penilaian Pengawas (F64): <b className="tabular-nums">{num(v.summary.ratingM.validasiPengawas.score)}</b> {String(v.summary.ratingM.validasiPengawas.predikat ?? "")}
        </span>
        {v.summary.tkmr.badge && <span className="rounded bg-[#fff4d6] px-2 py-0.5 text-[12.5px] text-[#7a5200]">{v.summary.tkmr.badge}</span>}
        <span className="ml-auto text-[12px] text-ink-3">Hanya baca</span>
      </header>
      {!v.hasActiveFile && <p className="border-b border-line bg-[#fff8e6] px-4 py-2 text-[13px]">Belum ada file MR yang dipakai: kertas kerja ini masih kosong.</p>}
      {v.summary.deviations.length > 0 && (
        <details className="border-b border-line bg-plane px-4 py-1.5 text-[12.5px] text-ink-2">
          <summary className="cursor-pointer">Penyesuaian terhadap template ({v.summary.deviations.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {v.summary.deviations.map((d) => (
              <li key={d.code}>
                {d.description} <span className="text-ink-3">({d.modes.includes("template") ? "dipakai" : "hanya mode koreksi"})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {v.layout && sheet ? (
        <KkViewer key={sheetName} sheet={sheet} styles={v.layout.styles} values={values} sources={sources} tabs={tabs} />
      ) : (
        <p className="p-6 text-[14px]">Tata letak template {v.templateFile} belum dibuat: jalankan scripts/seed-period.ts.</p>
      )}
    </div>
  );
}
