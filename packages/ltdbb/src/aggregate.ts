import { and, asc, eq } from "drizzle-orm";
import { ltdbbMonthly, pjp, type Db } from "@ira/db";
import type { LtdbbFlag } from "./parse";

export type AggregateFlag = LtdbbFlag | "NOT_IN_LTDBB" | "INCOMPLETE_YEAR";

export interface PjpYearTotals {
  finJumlahInc: number;
  finNilaiInc: number;
  finJumlahOut: number;
  finNilaiOut: number;
  finJumlahDom: number;
  finNilaiDom: number;
}

export interface PjpYearAggregate extends PjpYearTotals {
  sandi: string;
  /** From the PJP list (the form's dropdown), never from LTDBB, whose names differ. */
  nama: string;
  totalFrekuensi: number;
  totalNominal: number;
  monthsPresent: number[];
  inLtdbb: boolean;
  flags: AggregateFlag[];
}

export interface UnknownKode {
  kode: string;
  namaLtdbb: string;
  monthsPresent: number[];
}

const TOTAL_KEYS: (keyof PjpYearTotals)[] = [
  "finJumlahInc", "finNilaiInc", "finJumlahOut", "finNilaiOut", "finJumlahDom", "finNilaiDom",
];

/**
 * One row per PJP in the form's list (in `pjp.sort_order`, i.e. the order of
 * "Validasi Data Transaksi"), with that PJP's LTDBB totals for `dataYear`.
 * PJPs absent from LTDBB get zeros and `NOT_IN_LTDBB`; `unknownKodes` lists
 * LTDBB codes that match no PJP in the list. Pass `sandi` to get one PJP.
 * Sums keep full float precision -- compare against them with a ±1 tolerance.
 */
export async function aggregateYear(
  db: Db,
  uploadId: string,
  dataYear: number,
  options: { sandi?: string } = {},
): Promise<{ rows: PjpYearAggregate[]; unknownKodes: UnknownKode[] }> {
  const pjps = await db
    .select({ sandi: pjp.sandi, nama: pjp.nama })
    .from(pjp)
    .where(options.sandi ? eq(pjp.sandi, options.sandi) : undefined)
    .orderBy(asc(pjp.sortOrder));

  const monthly = await db
    .select()
    .from(ltdbbMonthly)
    .where(
      and(
        eq(ltdbbMonthly.uploadId, uploadId),
        eq(ltdbbMonthly.year, dataYear),
        options.sandi ? eq(ltdbbMonthly.kode, options.sandi) : undefined,
      ),
    );

  const byKode = new Map<string, typeof monthly>();
  for (const row of monthly) {
    if (!byKode.has(row.kode)) byKode.set(row.kode, []);
    byKode.get(row.kode)!.push(row);
  }

  const rows: PjpYearAggregate[] = pjps.map(({ sandi, nama }) => {
    const months = byKode.get(sandi) ?? [];
    const totals = Object.fromEntries(
      TOTAL_KEYS.map((key) => [key, months.reduce((sum, m) => sum + m[key], 0)]),
    ) as unknown as PjpYearTotals;
    const flags = new Set<AggregateFlag>(months.flatMap((m) => m.flags as LtdbbFlag[]));
    const monthsPresent = months.map((m) => m.month).sort((a, b) => a - b);
    if (months.length === 0) flags.add("NOT_IN_LTDBB");
    else if (new Set(monthsPresent).size < 12) flags.add("INCOMPLETE_YEAR");
    return {
      sandi,
      nama,
      ...totals,
      totalFrekuensi: totals.finJumlahInc + totals.finJumlahOut + totals.finJumlahDom,
      totalNominal: totals.finNilaiInc + totals.finNilaiOut + totals.finNilaiDom,
      monthsPresent,
      inLtdbb: months.length > 0,
      flags: [...flags],
    };
  });

  const known = new Set(pjps.map((p) => p.sandi));
  const unknownKodes: UnknownKode[] = options.sandi
    ? []
    : [...byKode]
        .filter(([kode]) => !known.has(kode))
        .map(([kode, months]) => ({
          kode,
          namaLtdbb: months[0].namaLtdbb,
          monthsPresent: months.map((m) => m.month).sort((a, b) => a - b),
        }));

  return { rows, unknownKodes };
}
