/**
 * `periods.settings` (jsonb), typed. Every key is optional in the database;
 * `periodSettings()` fills the defaults, so callers never see a missing value.
 */
export interface PeriodSettings {
  /**
   * Warn (no block) when more than this share of an applicable IT sheet's
   * questions are answered "N/A" ("Sebagian besar N/A: x/y"). 0..1.
   */
  itMostlyNaThreshold: number;
  /** Optional, off by default: use the IRA APU-PPT score as the PU-PT input. */
  puptFromIra: boolean;
  /** Optional, off by default: Google Sheet the recap is pushed to. */
  recapSheetUrl: string | null;
}

export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = {
  itMostlyNaThreshold: 0.5,
  puptFromIra: false,
  recapSheetUrl: null,
};

export function periodSettings(raw: unknown): PeriodSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = o.itMostlyNaThreshold;
  return {
    itMostlyNaThreshold: typeof t === "number" && t >= 0 && t <= 1 ? t : DEFAULT_PERIOD_SETTINGS.itMostlyNaThreshold,
    puptFromIra: o.puptFromIra === true,
    recapSheetUrl: typeof o.recapSheetUrl === "string" && o.recapSheetUrl ? o.recapSheetUrl : null,
  };
}
