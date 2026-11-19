import { Workbook, type ExternalLookup, type Override } from "./formula/evaluate";
import type { Scalar } from "./formula/values";
import type { MrDefinition } from "./definitions";

/** What a Sumber BI table answers for a lookup key (the KK's idx: `${dataId}-${sandi}`). Matches @tikmi/sumber-bi's lookup. */
export interface KeyLookup {
  getByKey(key: string): { found: false } | { found: true; value: number | string };
}

export interface MrTables {
  /** `Sumber BI 1 Tahun`. */
  satuTahun?: KeyLookup;
  /** `Sumber BI (6 Bulan)`. */
  enamBulan?: KeyLookup;
  /** `Lamp. PJP` name -> Sandi (column E), for D5. The app usually overrides D5 with the matched Sandi instead. */
  lampPjp?: (name: string) => Scalar | undefined;
}

export const SUMBER_BI_1_TAHUN = "Sumber BI 1 Tahun";
export const SUMBER_BI_6_BULAN = "Sumber BI (6 Bulan)";
export const LAMP_PJP = "Lamp. PJP";

/** The KK's VLOOKUPs into its run-time tables. A table that was not supplied answers "not found" (#N/A). */
export function externalLookup(tables: MrTables): ExternalLookup {
  return (sheet, key, colIndex) => {
    if (sheet === SUMBER_BI_1_TAHUN || sheet === SUMBER_BI_6_BULAN) {
      if (colIndex !== 2) throw new Error(`VLOOKUP into ${sheet} column ${colIndex}: only the amount column (2) is modelled`);
      const t = sheet === SUMBER_BI_1_TAHUN ? tables.satuTahun : tables.enamBulan;
      if (!t || key === null || typeof key === "object") return undefined;
      const r = t.getByKey(String(key));
      return r.found ? r.value : undefined;
    }
    if (sheet === LAMP_PJP) {
      if (colIndex !== 2) throw new Error(`VLOOKUP into ${sheet} column ${colIndex} is not modelled`);
      return typeof key === "string" ? tables.lampPjp?.(key) : undefined;
    }
    throw new Error(`No lookup table for sheet "${sheet}"`);
  };
}

/**
 * The KK of one assessment, ready to evaluate: the definition's formulas over
 * the stored input cells ("Sheet!A1" in the KK's own sheet names), the BI
 * tables, and any overrides (corrected-mode deviations, app-provided cells).
 */
export function mrWorkbook(
  def: MrDefinition,
  cells: Map<string, unknown> | Record<string, unknown>,
  tables: MrTables = {},
  overrides: Record<string, Override> = {},
): Workbook {
  return new Workbook(def.spec, cells, { overrides, external: externalLookup(tables) });
}
