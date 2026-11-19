import JSZip from "jszip";

/**
 * Minimal, faithful .xlsx cell reader: every cell's stored value, whether it
 * holds a formula (and its text when not shared), and the cached result Excel
 * saved. Reads the XML directly instead of going through exceljs, which drops
 * a cached result of 0 (`<f>…</f><v>0</v>`) and so would turn a PJP's typed
 * formula that evaluates to 0 into a blank answer.
 */

export type CellScalar = number | string | boolean | null;

export interface RawCell {
  /** Typed value, or the cached result of a formula. Errors as their code text ("#N/A"). */
  value: CellScalar;
  /** True when the cell holds a formula (shared-formula children included). */
  isFormula: boolean;
  /** Formula text when stored on this cell (absent for children of a shared formula). */
  formula?: string;
  isError?: boolean;
}

export interface RawSheet {
  name: string;
  state: "visible" | "hidden" | "veryHidden";
  cells: Map<string, RawCell>;
}

export interface RawWorkbook {
  sheets: RawSheet[];
  sheet(name: string): RawSheet | undefined;
}

export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxReadError";
  }
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    // Excel escapes control characters as _xHHHH_ (e.g. _x000D_ for CR).
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decode(m[1]) : undefined;
};

/** Text of a <si> / <is> element: plain <t> or rich-text runs (<r><t>), ignoring phonetic runs (<rPh>). */
function textOf(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decode(m[1] ?? "");
  return out;
}

export async function readXlsx(data: Buffer | ArrayBuffer | Uint8Array): Promise<RawWorkbook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new XlsxReadError("File bukan .xlsx yang valid (tidak dapat dibuka sebagai arsip Excel).");
  }
  const read = async (path: string) => (await zip.file(path)?.async("string")) ?? null;
  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) throw new XlsxReadError("File .xlsx tidak memiliki xl/workbook.xml.");
  const relsXml = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const shared: string[] = [];
  const sst = await read("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const sheets: RawSheet[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name") ?? "";
    const state = (attr(m[1], "state") ?? "visible") as RawSheet["state"];
    const rid = attr(m[1], "r:id");
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? await read(path) : null;
    const cells = new Map<string, RawCell>();
    if (xml) {
      for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? "";
        const ref = attr(attrs, "r");
        if (!ref) continue;
        const t = attr(attrs, "t") ?? "n";
        const f = /<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body);
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: CellScalar = null;
        let isError = false;
        if (t === "inlineStr") value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else if (v !== undefined) {
          const raw = decode(v);
          if (t === "s") value = shared[Number(raw)] ?? "";
          else if (t === "str") value = raw;
          else if (t === "b") value = raw === "1";
          else if (t === "e") {
            value = raw;
            isError = true;
          } else value = raw === "" ? null : Number(raw);
        }
        if (value === null && !f) continue;
        const cell: RawCell = { value, isFormula: !!f };
        if (f?.[2]) cell.formula = "=" + decode(f[2]);
        if (isError) cell.isError = true;
        cells.set(ref.replace(/\$/g, ""), cell);
      }
    }
    sheets.push({ name, state, cells });
  }
  return { sheets, sheet: (name) => sheets.find((s) => s.name === name) };
}

/** A sheet by name, tolerating spacing differences ("2- Asesmen" / "2 - Asesmen" / "2 -Asesmen"). */
export function findSheetLoose(wb: RawWorkbook, name: string): RawSheet | undefined {
  const key = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  return wb.sheet(name) ?? wb.sheets.find((s) => key(s.name) === key(name));
}
