import type { ItDefinition, MrDefinition } from "./definitions";

/** packages/scoring/config/it-applicability-<year>.json, after `parseItApplicabilityConfig`. */
export interface ItApplicabilityConfig {
  year: number;
  status: string;
  description?: string;
  always: string[];
  never: string[];
  notByDefault: string[];
  /** Pair -> the pengawas flag that switches it on (TI-SPBI -> spbiParticipant). */
  pengawasFlag: Record<string, string>;
  /** Service IDs each bundling's MR template asks ("2", "3"). Only these count for that bundling. */
  askedByBundling: Record<string, string[]>;
  /** Pairs to use when every asked declaration is blank (or there is no active MR file), per bundling, and the warning to show. */
  fallbackWhenAllBlank: { warning: string; byBundling: Record<string, string[]> };
  /** What to do with a declared service that switches on no pair: "askPengawas" lists it for the pengawas to decide. */
  unmappedYa: "askPengawas";
  /** Free-text services (Lainnya): these answers count as "not declared". Compared trimmed, case-insensitive. */
  lainnyaNoValuesForApplicability: string[];
  services: Record<string, ItServiceConfig>;
}

export interface ItServiceConfig {
  label: string;
  pairs: string[];
  confirm?: string;
  freetext?: boolean;
}

export class ItApplicabilityConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid IT applicability config:\n  ${problems.join("\n  ")}`);
    this.name = "ItApplicabilityConfigError";
  }
}

/**
 * Strict load-time check of the applicability config: unknown keys (e.g. a
 * leftover "pair"), missing or mistyped fields, services not defined for an
 * asked ID and, with `itDef`, pair keys that are not IT sheet pairs are all
 * errors. Every problem is listed; nothing is silently ignored.
 */
export function parseItApplicabilityConfig(raw: unknown, itDef?: ItDefinition): ItApplicabilityConfig {
  const problems: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  const keys = (where: string, o: Record<string, unknown>, required: string[], optional: string[] = []) => {
    for (const k of required) if (!(k in o)) problems.push(`${where}: missing "${k}"`);
    for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) problems.push(`${where}: unknown key "${k}"`);
  };
  const pairKeys = itDef ? new Set(itDef.pairs.map((p) => p.key)) : null;
  const checkPairs = (where: string, v: unknown) => {
    if (!isStrArr(v)) return problems.push(`${where}: must be a list of sheet pair names`);
    if (pairKeys) for (const p of v) if (!pairKeys.has(p)) problems.push(`${where}: "${p}" is not an IT sheet pair (${[...pairKeys].join(", ")})`);
  };

  if (!isObj(raw)) throw new ItApplicabilityConfigError(["config: must be an object"]);
  keys("config", raw, ["year", "status", "always", "never", "notByDefault", "pengawasFlag", "askedByBundling", "fallbackWhenAllBlank", "unmappedYa", "lainnyaNoValuesForApplicability", "services"], ["description"]);
  if (typeof raw.year !== "number") problems.push("year: must be a number");
  if (typeof raw.status !== "string") problems.push("status: must be text");
  if (raw.description !== undefined && typeof raw.description !== "string") problems.push("description: must be text");
  for (const k of ["always", "never", "notByDefault"] as const) checkPairs(k, raw[k]);
  if (!isObj(raw.pengawasFlag)) problems.push("pengawasFlag: must be an object");
  else for (const [pair, flag] of Object.entries(raw.pengawasFlag)) {
    checkPairs(`pengawasFlag`, [pair]);
    if (typeof flag !== "string") problems.push(`pengawasFlag.${pair}: must be a flag name`);
  }
  if (raw.unmappedYa !== "askPengawas") problems.push(`unmappedYa: must be "askPengawas"`);
  if (!isStrArr(raw.lainnyaNoValuesForApplicability)) problems.push("lainnyaNoValuesForApplicability: must be a list of text");

  const services: Record<string, ItServiceConfig> = {};
  if (!isObj(raw.services)) problems.push("services: must be an object");
  else {
    for (const [id, s] of Object.entries(raw.services)) {
      const where = `services["${id}"]`;
      if (!/^R\.[A-Z]+\.\d+\.[a-z]\.\d+$/.test(id)) problems.push(`${where}: not an ID DATA code`);
      if (!isObj(s)) {
        problems.push(`${where}: must be an object`);
        continue;
      }
      keys(where, s, ["label", "pairs"], ["confirm", "freetext"]);
      if (typeof s.label !== "string") problems.push(`${where}.label: must be text`);
      checkPairs(`${where}.pairs`, s.pairs);
      if (s.confirm !== undefined && typeof s.confirm !== "string") problems.push(`${where}.confirm: must be text`);
      if (s.freetext !== undefined && typeof s.freetext !== "boolean") problems.push(`${where}.freetext: must be true/false`);
      services[id] = s as unknown as ItServiceConfig;
    }
  }

  const askedByBundling: Record<string, string[]> = {};
  if (!isObj(raw.askedByBundling)) problems.push("askedByBundling: must be an object");
  else {
    for (const [b, ids] of Object.entries(raw.askedByBundling)) {
      if (!/^[23]$/.test(b)) problems.push(`askedByBundling: unknown bundling "${b}" (2 or 3)`);
      if (!isStrArr(ids)) {
        problems.push(`askedByBundling.${b}: must be a list of ID DATA codes`);
        continue;
      }
      for (const id of ids) if (!services[id]) problems.push(`askedByBundling.${b}: "${id}" has no entry in services`);
      askedByBundling[b] = ids;
    }
  }

  let fallback: ItApplicabilityConfig["fallbackWhenAllBlank"] = { warning: "", byBundling: {} };
  const fb = raw.fallbackWhenAllBlank;
  if (!isObj(fb)) problems.push("fallbackWhenAllBlank: must be an object");
  else {
    if (typeof fb.warning !== "string") problems.push("fallbackWhenAllBlank.warning: must be text");
    const byBundling: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(fb)) {
      if (k === "warning") continue;
      if (!/^[23]$/.test(k)) {
        problems.push(`fallbackWhenAllBlank: unknown key "${k}" (bundling 2 or 3, or "warning")`);
        continue;
      }
      checkPairs(`fallbackWhenAllBlank.${k}`, v);
      byBundling[k] = v as string[];
    }
    for (const b of Object.keys(askedByBundling)) if (!byBundling[b]) problems.push(`fallbackWhenAllBlank: missing bundling "${b}"`);
    fallback = { warning: String(fb.warning ?? ""), byBundling };
  }

  if (problems.length) throw new ItApplicabilityConfigError(problems);
  return {
    year: raw.year as number,
    status: raw.status as string,
    description: raw.description as string | undefined,
    always: raw.always as string[],
    never: raw.never as string[],
    notByDefault: raw.notByDefault as string[],
    pengawasFlag: raw.pengawasFlag as Record<string, string>,
    askedByBundling,
    fallbackWhenAllBlank: fallback,
    unmappedYa: "askPengawas",
    lainnyaNoValuesForApplicability: raw.lainnyaNoValuesForApplicability as string[],
    services,
  };
}

export type ApplicabilityReason =
  | "always"
  | "service"
  | "fallback"
  | "pengawas_flag"
  | "override"
  | "never"
  | "not_by_default"
  | "no_service";

export interface DeclaredService {
  id: string;
  label: string;
  pairs: string[];
  value: unknown;
  /** Declared: YA (trimmed, case-insensitive), or for a free-text service any answer not in the no-values list. */
  yes: boolean;
  blank: boolean;
  /** Methodology note to confirm (from the config). */
  confirm?: string;
}

export interface PairApplicability {
  pair: string;
  applicable: boolean;
  reason: ApplicabilityReason;
  /** Services declared that switch this pair on (with any note to confirm). */
  services: { id: string; label: string; confirm?: string }[];
}

export interface ItApplicability {
  /** Pair keys that apply. */
  pairs: string[];
  byPair: PairApplicability[];
  /** The services read, with what the PJP declared (H of its row in MR sheet 1). */
  declared: DeclaredService[];
  /**
   * Where `declared` comes from: the active MR file (it decides applicability), a non-active MR file
   * (wrong template or bundling; read with that file's own template, for information only), or none.
   */
  declaredFrom: "active_mr" | "inactive_mr" | "none";
  /** True when an active MR file decided (as opposed to the fallback). */
  fromMr: boolean;
  /** Every declaration blank, or no active MR file: the bundling's fallback set was used. */
  fallback: { used: boolean; warning: string | null };
  /** Declared services that switch on no IT sheet: the pengawas decides (config `unmappedYa: "askPengawas"`). */
  askPengawas: { id: string; label: string; value: unknown }[];
  /** Every asked service explicitly declared TIDAK (none YA, none blank). */
  allTidak: boolean;
  override: { pairs: string[]; note: string } | null;
}

export interface ApplicabilityOptions {
  /** The assessment's bundling (2 or 3): picks the fallback. Defaults to the active MR definition's. */
  bundling?: 2 | 3;
  /** The PJP's active MR file: its cells (KK addresses) decide applicability. */
  mr?: { def: MrDefinition; cells: Map<string, unknown> | Record<string, unknown> };
  /**
   * A non-active MR file (excluded: wrong template / bundling), read with its own detected template's
   * definition and asked list. Informational only: applicability falls back as if no MR file had arrived.
   */
  inactiveMr?: { def: MrDefinition; cells: Map<string, unknown> | Record<string, unknown> };
  /** Pengawas flags, e.g. { spbiParticipant: true }. */
  flags?: Record<string, boolean>;
  /** Pengawas override of the whole set, with its note. */
  override?: { pairs: string[]; note: string } | null;
}

const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim().toUpperCase();

/** What an MR file declares for the services its own bundling asks (rows found by ID DATA). */
export function readDeclarations(config: ItApplicabilityConfig, mr: NonNullable<ApplicabilityOptions["mr"]>): DeclaredService[] {
  const asked = config.askedByBundling[String(mr.def.bundling)] ?? [];
  const get = (k: string): unknown => (mr.cells instanceof Map ? mr.cells.get(k) : mr.cells[k]);
  const rowOf = new Map<string, number>(mr.def.pjp.rows.map(([row, id]) => [id, row]));
  const noValues = new Set(config.lainnyaNoValuesForApplicability.map(norm));
  return asked.map((id) => {
    const s = config.services[id];
    const row = rowOf.get(id);
    const value = row !== undefined ? get(`${mr.def.sheets.risiko}!H${row}`) : undefined;
    const yes = s.freetext ? !noValues.has(norm(value)) : norm(value) === "YA";
    return { id, label: s.label, pairs: s.pairs, value, yes, blank: norm(value) === "", ...(s.confirm ? { confirm: s.confirm } : {}) };
  });
}

/**
 * Which IT sheet pairs apply to one PJP: General always; a service pair when
 * any service mapped to it is declared in the active MR file (found by ID
 * DATA, only the services that bundling asks); the bundling's fallback set
 * when every declaration is blank or no MR file is active; a flagged pair when
 * the pengawas set the flag; never Infra SP. A pengawas override replaces it all.
 */
export function deriveItApplicability(itDef: ItDefinition, config: ItApplicabilityConfig, opts: ApplicabilityOptions = {}): ItApplicability {
  const bundling = opts.bundling ?? opts.mr?.def.bundling;
  const declaredFrom = opts.mr ? "active_mr" : opts.inactiveMr ? "inactive_mr" : "none";
  const declared = opts.mr ? readDeclarations(config, opts.mr) : opts.inactiveMr ? readDeclarations(config, opts.inactiveMr) : [];
  const decides = !!opts.mr && !declared.every((d) => d.blank);
  const fallbackPairs = !decides && bundling ? (config.fallbackWhenAllBlank.byBundling[String(bundling)] ?? null) : null;

  const byPair: PairApplicability[] = itDef.pairs.map(({ key }) => {
    const services = decides ? declared.filter((d) => d.yes && d.pairs.includes(key)).map((d) => ({ id: d.id, label: d.label, ...(d.confirm ? { confirm: d.confirm } : {}) })) : [];
    if (config.never.includes(key)) return { pair: key, applicable: false, reason: "never", services };
    if (config.always.includes(key)) return { pair: key, applicable: true, reason: "always", services };
    const flag = config.pengawasFlag[key];
    if (flag) return { pair: key, applicable: !!opts.flags?.[flag], reason: "pengawas_flag", services };
    if (fallbackPairs) {
      const on = fallbackPairs.includes(key);
      return { pair: key, applicable: on, reason: on ? "fallback" : config.notByDefault.includes(key) ? "not_by_default" : "no_service", services };
    }
    if (services.length) return { pair: key, applicable: true, reason: "service", services };
    return { pair: key, applicable: false, reason: config.notByDefault.includes(key) ? "not_by_default" : "no_service", services };
  });

  const override = opts.override ?? null;
  if (override) {
    const set = new Set(override.pairs);
    for (const p of byPair) {
      const applicable = set.has(p.pair);
      if (applicable !== p.applicable) Object.assign(p, { applicable, reason: "override" as const });
    }
  }

  return {
    pairs: byPair.filter((p) => p.applicable).map((p) => p.pair),
    byPair,
    declared,
    declaredFrom,
    fromMr: decides,
    fallback: { used: !!fallbackPairs, warning: fallbackPairs ? config.fallbackWhenAllBlank.warning : null },
    askPengawas: config.unmappedYa === "askPengawas" ? declared.filter((d) => d.yes && d.pairs.length === 0).map((d) => ({ id: d.id, label: d.label, value: d.value })) : [],
    allTidak: declared.length > 0 && declared.every((d) => !d.yes && !d.blank),
    override,
  };
}
