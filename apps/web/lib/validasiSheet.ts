import { eq } from "drizzle-orm";
import { pjpValidationMeta, type Db } from "@ira/db";
import type { PjpYearAggregate } from "@ira/ltdbb";
import type { CellInputValue, ExtractedLayout, LayoutCell } from "@ira/template";

export const VALIDASI_SHEET = "Validasi Data Transaksi";
/** Data rows of "Validasi Data Transaksi": row 1 is the header. */
const VALIDASI_FIRST_ROW = 2;
const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"] as const;

/**
 * Every "Validasi Data Transaksi" cell (A–M) as the active LTDBB fills it, by
 * address: one row per PJP in the form's list, then blanks down to the
 * template's last row so no stale totals survive. Columns C (=A&" - "&B) and,
 * in template v2, L/M (=F+H+J, =G+I+K) are formulas: the export keeps the
 * formula and skips them, the grid shows the value here. One source for both,
 * so the sheet on screen is the sheet in the file.
 */
export async function validasiSheetValues(
  db: Db,
  dataYear: number,
  transactions: PjpYearAggregate[],
  templateRowCount: number,
): Promise<Map<string, CellInputValue>> {
  const meta = new Map(
    (await db.select().from(pjpValidationMeta).where(eq(pjpValidationMeta.dataYear, dataYear))).map((m) => [m.sandi, m]),
  );
  const values = new Map<string, CellInputValue>();
  transactions.forEach((t, i) => {
    const r = VALIDASI_FIRST_ROW + i;
    const row: Record<(typeof COLUMNS)[number], CellInputValue> = {
      A: Number(t.sandi),
      B: t.nama,
      C: `${t.sandi} - ${t.nama}`,
      D: meta.get(t.sandi)?.statusPjp ?? null,
      E: meta.get(t.sandi)?.keterangan ?? null,
      F: t.finJumlahInc,
      G: t.finNilaiInc,
      H: t.finJumlahOut,
      I: t.finNilaiOut,
      J: t.finJumlahDom,
      K: t.finNilaiDom,
      L: t.totalFrekuensi,
      M: t.totalNominal,
    };
    for (const col of COLUMNS) values.set(`${col}${r}`, row[col]);
  });
  for (let r = VALIDASI_FIRST_ROW + transactions.length; r <= templateRowCount; r++) {
    for (const col of COLUMNS) values.set(`${col}${r}`, null);
  }
  return values;
}

/** The layout with the Validasi sheet's values replaced, for the grid (formulas stay, for the formula bar). */
export function withValidasiValues(layout: ExtractedLayout, values: Map<string, CellInputValue>): ExtractedLayout {
  return {
    ...layout,
    sheets: layout.sheets.map((s) => {
      if (s.name !== VALIDASI_SHEET) return s;
      const seen = new Set<string>();
      const cells: LayoutCell[] = s.cells.map((c) => {
        if (!values.has(c.address)) return c;
        seen.add(c.address);
        const v = values.get(c.address);
        return { ...c, value: v === null || v === undefined || typeof v === "boolean" || v instanceof Date ? undefined : v };
      });
      // A value where the template had an empty cell: style it like the row-2 cell of the same column.
      for (const [address, v] of values) {
        if (seen.has(address) || v === null || typeof v === "boolean" || v instanceof Date) continue;
        const col = address.replace(/\d+$/, "");
        const row = Number(address.slice(col.length));
        const like = s.cells.find((c) => c.address === `${col}${VALIDASI_FIRST_ROW}`);
        cells.push({ address, row, col: col.charCodeAt(0) - 64, value: v, isInput: false, style: like?.style });
      }
      return { ...s, cells };
    }),
  };
}
