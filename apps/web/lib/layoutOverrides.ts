import type { WeightSet } from "@tikmi/scoring/config/2026";
import { formulaOverridesFor, valueOverridesFor } from "@tikmi/scoring/config/2026-sheet";
import type { ExtractedLayout } from "@tikmi/template";

/** A template cell's own value, for rewriting the "(40%)" in headings. */
export function layoutText(layout: ExtractedLayout): (ref: string) => unknown {
  return (ref) => {
    const i = ref.lastIndexOf("!");
    return layout.sheets.find((s) => s.name === ref.slice(0, i))?.cells.find((c) => c.address === ref.slice(i + 1))?.value;
  };
}

/**
 * The template layout as the app uses it, for a weight set: corrected formulas
 * (weighted KPMR total, rows 11/27 → D22) and the weights in force (A2 columns
 * D/E, category weights, "(40%)" headings), so the grid, the formula bar and the
 * BSSS report show what the scores are based on.
 */
export function applyLayoutOverrides(layout: ExtractedLayout, weights: WeightSet): ExtractedLayout {
  const formulas = formulaOverridesFor(weights);
  const values = valueOverridesFor(weights, layoutText(layout));
  return {
    ...layout,
    sheets: layout.sheets.map((s) => ({
      ...s,
      cells: s.cells.map((c) => {
        const ref = `${s.name}!${c.address}`;
        const formula = formulas[ref];
        const value = values[ref];
        if (formula === undefined && value === undefined) return c;
        return { ...c, ...(formula !== undefined ? { formula } : {}), ...(value !== undefined ? { value } : {}) };
      }),
    })),
  };
}
