import { formatAddress, parseAddress, parseFormula, type Node } from "./parse";
import {
  at,
  compare,
  isError,
  isMatrix,
  lookupEquals,
  matrix,
  parseNumericText,
  toBool,
  toNumber,
  toText,
  XlError,
  type Matrix,
  type Scalar,
  type Value,
} from "./values";

/**
 * A template as data: its formula cells, the constant cells formulas read, and
 * the size of each sheet (whole-column references are clipped to `maxRow`).
 * Input cells are neither: their values come from the caller, so a template's
 * sample answers can never leak into a computation.
 */
export interface WorkbookSpec {
  sheets: Record<string, { maxRow: number; maxCol: number }>;
  /** "Sheet!A1" -> formula text, as written in the template ("=..."). */
  formulas: Record<string, string>;
  /** "Sheet!A1" -> typed template value read by formulas (labels, weights, IDs, constants such as A23 = 0.5). */
  constants: Record<string, string | number | boolean>;
  /** Sheets that are lookup tables supplied at run time (Sumber BI, Lamp. PJP): only VLOOKUP may read them. */
  external: string[];
}

/** Resolves `VLOOKUP(key, '<sheet>'!range, col, FALSE)` against a run-time table. Undefined = no such row (#N/A). */
export type ExternalLookup = (sheet: string, key: Scalar, colIndex: number) => Scalar | undefined;

export type Override = Scalar | { formula: string };

export interface WorkbookOptions {
  /**
   * Cells replaced for this evaluation: a value or a formula. Used for
   * corrected-mode deviations and for app-provided cells (e.g. D5 = the
   * matched Sandi). Applied before formulas, inputs and constants.
   */
  overrides?: Record<string, Override>;
  external?: ExternalLookup;
}

export class UnsupportedFormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormulaError";
  }
}

const astCache = new Map<string, Node>();
function ast(formula: string): Node {
  let n = astCache.get(formula);
  if (!n) {
    n = parseFormula(formula);
    astCache.set(formula, n);
  }
  return n;
}

const key = (sheet: string, col: number, row: number) => `${sheet}!${formatAddress(col, row)}`;

export function splitRef(ref: string): { sheet: string; col: number; row: number } {
  const i = ref.lastIndexOf("!");
  if (i < 0) throw new Error(`Cell ref without sheet: ${ref}`);
  const { col, row } = parseAddress(ref.slice(i + 1));
  return { sheet: ref.slice(0, i), col, row };
}

function normalizeInput(v: unknown): Scalar {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof XlError) return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Lazily evaluates a template's formulas over the given input cells, with
 * memoisation. One instance = one assessment's numbers; create a new one
 * when inputs change.
 */
export class Workbook {
  private readonly memo = new Map<string, Scalar>();
  private readonly active = new Set<string>();
  private readonly inputs: Map<string, Scalar>;
  private readonly external: Set<string>;

  constructor(
    private readonly spec: WorkbookSpec,
    inputs: Map<string, unknown> | Record<string, unknown>,
    private readonly options: WorkbookOptions = {},
  ) {
    const entries = inputs instanceof Map ? [...inputs.entries()] : Object.entries(inputs);
    this.inputs = new Map(entries.map(([k, v]) => [k, normalizeInput(v)]));
    this.external = new Set(spec.external);
  }

  /** Value of "Sheet!A1" as Excel would show it (a formula pointing at an empty cell gives 0). */
  value(ref: string): Scalar {
    const { sheet, col, row } = splitRef(ref);
    return this.cell(sheet, col, row);
  }

  /** Every formula cell of the template, evaluated. */
  evaluateAll(): Map<string, Scalar> {
    const out = new Map<string, Scalar>();
    for (const ref of Object.keys(this.spec.formulas)) out.set(ref, this.value(ref));
    return out;
  }

  cell(sheet: string, col: number, row: number): Scalar {
    const k = key(sheet, col, row);
    const cached = this.memo.get(k);
    if (cached !== undefined) return cached;

    const ov = this.options.overrides?.[k];
    let formula: string | undefined;
    if (ov !== undefined && !(typeof ov === "object" && ov !== null && "formula" in ov)) {
      const v = normalizeInput(ov);
      this.memo.set(k, v);
      return v;
    }
    if (ov && typeof ov === "object" && "formula" in ov) formula = ov.formula;
    formula ??= this.spec.formulas[k];

    if (formula === undefined) {
      const v = this.inputs.has(k) ? this.inputs.get(k)! : (this.spec.constants[k] ?? null);
      this.memo.set(k, v);
      return v;
    }

    if (this.active.has(k)) throw new UnsupportedFormulaError(`Circular reference at ${k}`);
    this.active.add(k);
    try {
      let v = this.ev(ast(formula), sheet);
      if (isMatrix(v)) v = v.data.length ? v.data[0] : null; // spill: the anchor cell shows the first element
      if (v === null) v = 0; // =A1 with A1 empty shows 0
      this.memo.set(k, v);
      return v;
    } finally {
      this.active.delete(k);
    }
  }

  private rangeValue(sheet: string, col1: number, row1: number, col2: number, row2: number): Matrix {
    if (this.external.has(sheet)) throw new UnsupportedFormulaError(`Sheet "${sheet}" can only be read through VLOOKUP`);
    const dims = this.spec.sheets[sheet];
    if (!dims) throw new UnsupportedFormulaError(`Unknown sheet "${sheet}"`);
    const r2 = Number.isFinite(row2) ? row2 : dims.maxRow;
    const rows = Math.max(0, r2 - row1 + 1);
    const cols = col2 - col1 + 1;
    const data: Scalar[] = new Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = this.cell(sheet, col1 + c, row1 + r);
    return matrix(rows, cols, data);
  }

  // ------------------------------------------------------------------ evaluation

  ev(node: Node, sheet: string): Value {
    switch (node.t) {
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "bool":
        return node.v;
      case "err":
        return XlError.of(node.v);
      case "ref": {
        const s = node.sheet ?? sheet;
        if (this.external.has(s)) throw new UnsupportedFormulaError(`Sheet "${s}" can only be read through VLOOKUP`);
        return this.cell(s, node.col, node.row);
      }
      case "range":
        return this.rangeValue(node.sheet ?? sheet, node.col1, node.row1, node.col2, node.row2);
      case "neg":
        return lift1(this.ev(node.a, sheet), (v) => {
          const n = toNumber(v);
          return isError(n) ? n : -n;
        });
      case "pct":
        return lift1(this.ev(node.a, sheet), (v) => {
          const n = toNumber(v);
          return isError(n) ? n : n / 100;
        });
      case "bin":
        return lift2(this.ev(node.a, sheet), this.ev(node.b, sheet), (a, b) => binary(node.op, a, b));
      case "fn":
        return this.call(node.name, node.args, sheet);
    }
  }

  private scalarArg(node: Node, sheet: string): Scalar {
    const v = this.ev(node, sheet);
    if (isMatrix(v)) return v.data.length ? v.data[0] : null;
    return v;
  }

  /**
   * Values of aggregate arguments with Excel's two rules: from references and
   * arrays only real numbers count (text, logicals, blanks are skipped); a
   * value typed directly as an argument is coerced.
   */
  private numbers(args: Node[], sheet: string): number[] | XlError {
    const out: number[] = [];
    for (const a of args) {
      const v = this.ev(a, sheet);
      if (isMatrix(v) || a.t === "ref" || a.t === "range") {
        const items = isMatrix(v) ? v.data : [v];
        for (const x of items) {
          if (isError(x)) return x;
          if (typeof x === "number") out.push(x);
        }
      } else {
        const n = toNumber(v);
        if (isError(n)) return n;
        out.push(n);
      }
    }
    return out;
  }

  private call(name: string, args: Node[], sheet: string): Value {
    const ev = (n: Node) => this.ev(n, sheet);
    const sc = (n: Node) => this.scalarArg(n, sheet);
    const need = (min: number, max = min) => {
      if (args.length < min || args.length > max) throw new UnsupportedFormulaError(`${name} with ${args.length} arguments`);
    };

    switch (name) {
      case "IF": {
        need(2, 3);
        const cond = ev(args[0]);
        if (isMatrix(cond)) {
          const yes = ev(args[1]);
          const no = args[2] ? ev(args[2]) : false;
          return lift3(cond, yes, no, (c, y, n) => {
            const b = toBool(c);
            return isError(b) ? b : b ? y : n;
          });
        }
        const b = toBool(cond);
        if (isError(b)) return b;
        if (b) return ev(args[1]);
        return args[2] ? ev(args[2]) : false;
      }
      case "IFERROR": {
        need(2);
        const v = ev(args[0]);
        if (isMatrix(v)) {
          if (!v.data.some(isError)) return v;
          const alt = ev(args[1]);
          return lift2(v, alt, (x, y) => (isError(x) ? y : x));
        }
        return isError(v) ? ev(args[1]) : v;
      }
      case "AND":
      case "OR": {
        let seen = false;
        let acc = name === "AND";
        for (const a of args) {
          const v = ev(a);
          const fromRef = isMatrix(v) || a.t === "ref" || a.t === "range";
          for (const x of isMatrix(v) ? v.data : [v]) {
            if (isError(x)) return x;
            if (fromRef && (x === null || typeof x === "string")) continue;
            const b = toBool(x);
            if (isError(b)) return b;
            seen = true;
            acc = name === "AND" ? acc && b : acc || b;
          }
        }
        return seen ? acc : XlError.VALUE;
      }
      case "NOT": {
        need(1);
        const b = toBool(sc(args[0]));
        return isError(b) ? b : !b;
      }
      case "SUM": {
        const ns = this.numbers(args, sheet);
        return isError(ns) ? ns : ns.reduce((s, n) => s + n, 0);
      }
      case "AVERAGE": {
        const ns = this.numbers(args, sheet);
        if (isError(ns)) return ns;
        return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : XlError.DIV0;
      }
      case "MAX":
      case "MIN": {
        const ns = this.numbers(args, sheet);
        if (isError(ns)) return ns;
        if (!ns.length) return 0;
        return name === "MAX" ? Math.max(...ns) : Math.min(...ns);
      }
      case "COUNT": {
        let n = 0;
        for (const a of args) {
          const v = ev(a);
          if (isMatrix(v) || a.t === "ref" || a.t === "range") {
            for (const x of isMatrix(v) ? v.data : [v]) if (typeof x === "number") n++;
          } else if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && parseNumericText(v) !== null)) n++;
        }
        return n;
      }
      case "COUNTA": {
        let n = 0;
        for (const a of args) {
          const v = ev(a);
          for (const x of isMatrix(v) ? v.data : [v]) if (x !== null) n++;
        }
        return n;
      }
      case "COUNTBLANK": {
        need(1);
        const v = ev(args[0]);
        return (isMatrix(v) ? v.data : [v]).filter((x) => x === null || x === "").length;
      }
      case "COUNTIF": {
        need(2);
        const range = ev(args[0]);
        const match = criterion(sc(args[1]));
        return (isMatrix(range) ? range.data : [range]).filter(match).length;
      }
      case "AVERAGEIFS": {
        if (args.length < 3 || args.length % 2 === 0) throw new UnsupportedFormulaError(`AVERAGEIFS with ${args.length} arguments`);
        const avg = asMatrix(ev(args[0]));
        const conds: { range: Matrix; match: (v: Scalar) => boolean }[] = [];
        for (let i = 1; i < args.length; i += 2) conds.push({ range: asMatrix(ev(args[i])), match: criterion(sc(args[i + 1])) });
        let sum = 0;
        let count = 0;
        for (let i = 0; i < avg.data.length; i++) {
          if (!conds.every((c) => c.match(c.range.data[i] ?? null))) continue;
          const x = avg.data[i];
          if (isError(x)) return x;
          if (typeof x === "number") {
            sum += x;
            count++;
          }
        }
        return count ? sum / count : XlError.DIV0;
      }
      case "AGGREGATE": {
        const fn = toNumber(sc(args[0]));
        const opt = toNumber(sc(args[1]));
        if (fn !== 1 || (opt !== 6 && opt !== 2 && opt !== 3 && opt !== 7)) {
          throw new UnsupportedFormulaError(`AGGREGATE(${String(fn)},${String(opt)},...) is not supported`);
        }
        // Function 1 = AVERAGE; options 2/3/6/7 all ignore error values (hidden rows are not modelled).
        const ns: number[] = [];
        for (const a of args.slice(2)) {
          const v = ev(a);
          for (const x of isMatrix(v) ? v.data : [v]) if (typeof x === "number") ns.push(x);
        }
        return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : XlError.DIV0;
      }
      case "FILTER": {
        need(2, 3);
        const arr = asMatrix(ev(args[0]));
        const inc = asMatrix(ev(args[1]));
        const byRow = inc.cols === 1 && inc.rows === arr.rows;
        const byCol = inc.rows === 1 && inc.cols === arr.cols;
        if (!byRow && !byCol) return XlError.VALUE;
        const keep: number[] = [];
        const n = byRow ? arr.rows : arr.cols;
        for (let i = 0; i < n; i++) {
          const b = toBool(inc.data[i]);
          if (isError(b)) return b;
          if (b) keep.push(i);
        }
        if (!keep.length) return args[2] ? ev(args[2]) : XlError.CALC;
        const data: Scalar[] = [];
        if (byRow) {
          for (const r of keep) for (let c = 0; c < arr.cols; c++) data.push(arr.data[r * arr.cols + c]);
          return matrix(keep.length, arr.cols, data);
        }
        for (let r = 0; r < arr.rows; r++) for (const c of keep) data.push(arr.data[r * arr.cols + c]);
        return matrix(arr.rows, keep.length, data);
      }
      case "XLOOKUP": {
        need(3, 4);
        const needle = sc(args[0]);
        const hay = asMatrix(ev(args[1]));
        const ret = asMatrix(ev(args[2]));
        const idx = hay.data.findIndex((x) => lookupEquals(needle, x));
        if (idx < 0) return args[3] ? ev(args[3]) : XlError.NA;
        // The templates return one value from a vector; for a 2-D return array, the matching row (or column).
        if (ret.rows === 1 || ret.cols === 1) return ret.data[idx] ?? XlError.NA;
        return (hay.cols === 1 ? ret.data[idx * ret.cols] : ret.data[idx]) ?? XlError.NA;
      }
      case "VLOOKUP": {
        need(3, 4);
        const needle = sc(args[0]);
        if (isError(needle)) return needle;
        const col = toNumber(sc(args[2]));
        if (isError(col)) return col;
        const exact = args[3] ? toBool(sc(args[3])) : true;
        if (exact !== false) throw new UnsupportedFormulaError("VLOOKUP with approximate match is not supported");
        const rangeNode = args[1];
        if (rangeNode.t !== "range") throw new UnsupportedFormulaError("VLOOKUP table must be a range");
        const tableSheet = rangeNode.sheet ?? sheet;
        if (this.external.has(tableSheet)) {
          if (!this.options.external) throw new UnsupportedFormulaError(`No lookup table supplied for "${tableSheet}"`);
          const v = this.options.external(tableSheet, needle, col);
          return v === undefined ? XlError.NA : v === null ? 0 : v;
        }
        const table = ev(rangeNode) as Matrix;
        for (let r = 0; r < table.rows; r++) {
          if (lookupEquals(needle, table.data[r * table.cols])) {
            if (col < 1 || col > table.cols) return XlError.REF;
            const v = table.data[r * table.cols + (col - 1)];
            return v === null ? 0 : v;
          }
        }
        return XlError.NA;
      }
      case "LEFT": {
        need(1, 2);
        const n = args[1] ? toNumber(sc(args[1])) : 1;
        return lift1(ev(args[0]), (v) => {
          if (isError(n)) return n;
          const t = toText(v);
          return isError(t) ? t : t.slice(0, Math.max(0, Math.trunc(n)));
        });
      }
      case "TRIM":
        need(1);
        return lift1(ev(args[0]), (v) => {
          const t = toText(v);
          return isError(t) ? t : t.replace(/ +/g, " ").trim();
        });
      case "UPPER":
        need(1);
        return lift1(ev(args[0]), (v) => {
          const t = toText(v);
          return isError(t) ? t : t.toUpperCase();
        });
      case "ISNUMBER":
        need(1);
        return lift1(ev(args[0]), (v) => typeof v === "number");
      case "SEARCH": {
        need(2, 3);
        const find = toText(sc(args[0]));
        const within = toText(sc(args[1]));
        const start = args[2] ? toNumber(sc(args[2])) : 1;
        if (isError(find)) return find;
        if (isError(within)) return within;
        if (isError(start)) return start;
        const re = new RegExp(wildcardSource(find), "i");
        const m = re.exec(within.slice(start - 1));
        return m ? m.index + start : XlError.VALUE;
      }
      default:
        throw new UnsupportedFormulaError(`Function ${name} is not supported`);
    }
  }
}

function asMatrix(v: Value): Matrix {
  return isMatrix(v) ? v : matrix(1, 1, [v]);
}

function lift1(v: Value, f: (s: Scalar) => Scalar): Value {
  if (!isMatrix(v)) return f(v);
  return matrix(v.rows, v.cols, v.data.map(f));
}

function lift2(a: Value, b: Value, f: (x: Scalar, y: Scalar) => Scalar): Value {
  if (!isMatrix(a) && !isMatrix(b)) return f(a, b);
  const ma = asMatrix(a);
  const mb = asMatrix(b);
  const rows = Math.max(ma.rows, mb.rows);
  const cols = Math.max(ma.cols, mb.cols);
  const data: Scalar[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data.push(f(at(ma, r, c), at(mb, r, c)));
  return matrix(rows, cols, data);
}

function lift3(a: Value, b: Value, c: Value, f: (x: Scalar, y: Scalar, z: Scalar) => Scalar): Value {
  const ma = asMatrix(a);
  const mb = asMatrix(b);
  const mc = asMatrix(c);
  const rows = Math.max(ma.rows, mb.rows, mc.rows);
  const cols = Math.max(ma.cols, mb.cols, mc.cols);
  const data: Scalar[] = [];
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) data.push(f(at(ma, r, k), at(mb, r, k), at(mc, r, k)));
  return matrix(rows, cols, data);
}

function binary(op: string, a: Scalar, b: Scalar): Scalar {
  if (op === "&") {
    const x = toText(a);
    if (isError(x)) return x;
    const y = toText(b);
    if (isError(y)) return y;
    return x + y;
  }
  if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
    const c = compare(a, b);
    if (isError(c)) return c;
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case ">":
        return c > 0;
      case "<=":
        return c <= 0;
      default:
        return c >= 0;
    }
  }
  const x = toNumber(a);
  if (isError(x)) return x;
  const y = toNumber(b);
  if (isError(y)) return y;
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return y === 0 ? XlError.DIV0 : x / y;
    case "^": {
      const p = Math.pow(x, y);
      return Number.isFinite(p) ? p : XlError.NUM;
    }
  }
  throw new UnsupportedFormulaError(`Operator ${op}`);
}

function wildcardSource(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length) {
      out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "*") out += "[\\s\\S]*";
    else if (ch === "?") out += "[\\s\\S]";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/** COUNTIF / AVERAGEIFS criterion: "YA", "<>", "<>x", ">=5", 5, "a*b". */
export function criterion(crit: Scalar): (v: Scalar) => boolean {
  if (isError(crit)) return (v) => isError(v) && v.code === crit.code;
  if (typeof crit === "number") return (v) => (typeof v === "number" ? v === crit : typeof v === "string" && parseNumericText(v) === crit);
  if (typeof crit === "boolean") return (v) => v === crit;
  const text = crit ?? "";
  const m = /^(<>|<=|>=|=|<|>)?([\s\S]*)$/.exec(text)!;
  const op = m[1] ?? "";
  const rest = m[2];
  const restNum = parseNumericText(rest);

  const equals = (v: Scalar): boolean => {
    if (rest === "") return v === null || v === "";
    if (restNum !== null) return (typeof v === "number" && v === restNum) || (typeof v === "string" && v.toLowerCase() === rest.toLowerCase());
    if (typeof v !== "string") return false;
    return new RegExp(`^${wildcardSource(rest)}$`, "i").test(v);
  };
  if (op === "" || op === "=") return equals;
  if (op === "<>") return (v) => (rest === "" ? v !== null && v !== "" : !equals(v));
  return (v) => {
    if (restNum !== null) {
      if (typeof v !== "number") return false;
      const c = v === restNum ? 0 : v < restNum ? -1 : 1;
      return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
    }
    if (typeof v !== "string") return false;
    const c = compare(v, rest) as number;
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  };
}
