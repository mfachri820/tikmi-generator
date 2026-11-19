/**
 * Parser for the Excel formula subset the TIKMI templates use. Produces an AST
 * that `evaluate.ts` interprets. Anything outside the subset (unknown token,
 * intersection, structured refs, R1C1) is a ParseError: the generator fails
 * on it instead of skipping the cell.
 */

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  /** Single cell. `sheet` undefined = the formula's own sheet. */
  | { t: "ref"; sheet?: string; col: number; row: number }
  /** Rectangle; whole columns have `row1 = 1`, `row2 = Infinity` (clipped to the sheet's used rows). */
  | { t: "range"; sheet?: string; col1: number; row1: number; col2: number; row2: number }
  | { t: "fn"; name: string; args: Node[] }
  | { t: "bin"; op: BinOp; a: Node; b: Node }
  | { t: "neg"; a: Node }
  | { t: "pct"; a: Node };

export type BinOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

export class ParseError extends Error {
  constructor(message: string, public readonly formula: string) {
    super(`${message} in ${formula.length > 200 ? formula.slice(0, 200) + "…" : formula}`);
    this.name = "ParseError";
  }
}

type Tok =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "err"; v: string }
  | { k: "ref"; sheet?: string; text: string }
  | { k: "name"; v: string }
  | { k: "op"; v: string }
  | { k: "("; }
  | { k: ")"; }
  | { k: "," };

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A1" -> { col: 1, row: 1 }. */
export function parseAddress(addr: string): { col: number; row: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(addr);
  if (!m) throw new Error(`Not a cell address: ${addr}`);
  return { col: colToNum(m[1]), row: Number(m[2]) };
}

export function formatAddress(col: number, row: number): string {
  return `${numToCol(col)}${row}`;
}

/** Function names as saved in the file carry future-function prefixes. */
function cleanName(name: string): string {
  return name.toUpperCase().replace(/^_XLFN\./, "").replace(/^_XLWS\./, "");
}

const REF_BODY = String.raw`\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3}`;

function tokenize(src: string): Tok[] {
  const s = src.startsWith("=") ? src.slice(1) : src;
  const out: Tok[] = [];
  let i = 0;
  const refRe = new RegExp(`^(?:${REF_BODY})(?![A-Za-z0-9_(])`, "i");
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      for (;;) {
        if (j >= s.length) throw new ParseError("Unterminated string", src);
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += s[j++];
      }
      out.push({ k: "str", v });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      // 'Sheet name'!ref
      let j = i + 1;
      let name = "";
      for (;;) {
        if (j >= s.length) throw new ParseError("Unterminated sheet name", src);
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          break;
        }
        name += s[j++];
      }
      if (s[j + 1] !== "!") throw new ParseError(`Expected "!" after '${name}'`, src);
      const rest = s.slice(j + 2);
      const m = refRe.exec(rest);
      if (!m) throw new ParseError(`Bad reference after '${name}'!`, src);
      out.push({ k: "ref", sheet: name, text: m[0] });
      i = j + 2 + m[0].length;
      continue;
    }
    if (ch === "#") {
      const m = /^#(?:DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!|CALC!|SPILL!)/i.exec(s.slice(i));
      if (!m) throw new ParseError("Unknown error literal", src);
      out.push({ k: "err", v: m[0].toUpperCase() });
      i += m[0].length;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.slice(i));
      if (m) {
        // "1:1" style row ranges are not used; a number is a number.
        out.push({ k: "num", v: Number(m[0]) });
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch)) {
      // Unquoted sheet name: Name!A1
      const sheetM = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(s.slice(i));
      if (sheetM) {
        const rest = s.slice(i + sheetM[0].length);
        const m = refRe.exec(rest);
        if (!m) throw new ParseError(`Bad reference after ${sheetM[1]}!`, src);
        out.push({ k: "ref", sheet: sheetM[1], text: m[0] });
        i += sheetM[0].length + m[0].length;
        continue;
      }
      const refM = refRe.exec(s.slice(i));
      if (refM) {
        out.push({ k: "ref", text: refM[0] });
        i += refM[0].length;
        continue;
      }
      const nameM = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
      if (nameM) {
        out.push({ k: "name", v: nameM[0] });
        i += nameM[0].length;
        continue;
      }
    }
    const two = s.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") out.push({ k: "(" });
    else if (ch === ")") out.push({ k: ")" });
    else if (ch === "," || ch === ";") out.push({ k: "," });
    else throw new ParseError(`Unexpected character "${ch}"`, src);
    i++;
  }
  return out;
}

function refNode(tok: { sheet?: string; text: string }, src: string): Node {
  const text = tok.text.replace(/\$/g, "").toUpperCase();
  const [a, b] = text.split(":");
  if (b === undefined) {
    const { col, row } = parseAddress(a);
    return { t: "ref", sheet: tok.sheet, col, row };
  }
  if (/^[A-Z]+$/.test(a) && /^[A-Z]+$/.test(b)) {
    return { t: "range", sheet: tok.sheet, col1: colToNum(a), row1: 1, col2: colToNum(b), row2: Infinity };
  }
  if (!/\d/.test(a) || !/\d/.test(b)) throw new ParseError(`Unsupported range ${tok.text}`, src);
  const p = parseAddress(a);
  const q = parseAddress(b);
  return {
    t: "range",
    sheet: tok.sheet,
    col1: Math.min(p.col, q.col),
    row1: Math.min(p.row, q.row),
    col2: Math.max(p.col, q.col),
    row2: Math.max(p.row, q.row),
  };
}

const BIN_PREC: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function primary(): Node {
    const tok = next();
    if (!tok) throw new ParseError("Unexpected end", src);
    switch (tok.k) {
      case "num":
        return { t: "num", v: tok.v };
      case "str":
        return { t: "str", v: tok.v };
      case "err":
        return { t: "err", v: tok.v };
      case "ref":
        return refNode(tok, src);
      case "(": {
        const e = expr(0);
        if (next()?.k !== ")") throw new ParseError('Expected ")"', src);
        return e;
      }
      case "op":
        if (tok.v === "-") return { t: "neg", a: unary() };
        if (tok.v === "+") return unary();
        throw new ParseError(`Unexpected operator ${tok.v}`, src);
      case "name": {
        const upper = tok.v.toUpperCase();
        if (peek()?.k === "(") {
          next();
          const args: Node[] = [];
          if (peek()?.k === ")") {
            next();
            return { t: "fn", name: cleanName(tok.v), args };
          }
          for (;;) {
            // An empty argument (e.g. IF(a,,b)) is not used by the templates.
            args.push(expr(0));
            const sep = next();
            if (sep?.k === ")") break;
            if (sep?.k !== ",") throw new ParseError(`Expected "," or ")" in ${tok.v}(`, src);
          }
          return { t: "fn", name: cleanName(tok.v), args };
        }
        if (upper === "TRUE" || upper === "FALSE") return { t: "bool", v: upper === "TRUE" };
        throw new ParseError(`Unknown name ${tok.v}`, src);
      }
      default:
        throw new ParseError(`Unexpected token ${tok.k}`, src);
    }
  }

  function postfix(): Node {
    let n = primary();
    while (peek()?.k === "op" && (peek() as { v: string }).v === "%") {
      next();
      n = { t: "pct", a: n };
    }
    return n;
  }

  function unary(): Node {
    const tok = peek();
    if (tok?.k === "op" && (tok.v === "-" || tok.v === "+")) {
      next();
      const a = unary();
      return tok.v === "-" ? { t: "neg", a } : a;
    }
    return postfix();
  }

  function expr(minPrec: number): Node {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok?.k !== "op" || !(tok.v in BIN_PREC)) break;
      const prec = BIN_PREC[tok.v];
      if (prec < minPrec) break;
      next();
      // All binary operators are left-associative in Excel, including ^.
      const right = expr(prec + 1);
      left = { t: "bin", op: tok.v as BinOp, a: left, b: right };
    }
    return left;
  }

  const ast = expr(0);
  if (pos !== toks.length) throw new ParseError(`Unexpected trailing token ${toks[pos].k}`, src);
  return ast;
}

/** Every cell/range a formula refers to (for dependency listing in the generator). */
export function references(node: Node, out: Node[] = []): Node[] {
  switch (node.t) {
    case "ref":
    case "range":
      out.push(node);
      break;
    case "fn":
      node.args.forEach((a) => references(a, out));
      break;
    case "bin":
      references(node.a, out);
      references(node.b, out);
      break;
    case "neg":
    case "pct":
      references(node.a, out);
      break;
  }
  return out;
}

export function functionNames(node: Node, out = new Set<string>()): Set<string> {
  if (node.t === "fn") {
    out.add(node.name);
    node.args.forEach((a) => functionNames(a, out));
  } else if (node.t === "bin") {
    functionNames(node.a, out);
    functionNames(node.b, out);
  } else if (node.t === "neg" || node.t === "pct") functionNames(node.a, out);
  return out;
}
