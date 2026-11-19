"""
Dumps every sheet of each TIKMI template workbook to JSON: sheet state, every
non-empty cell (typed value or formula, plus the cached result Excel saved),
data validations, merges, hidden rows/columns and defined names. The dump is
the spec the scoring definitions, the PJP-submission parser and the exporter
are written against (see docs/tikmi-plan.md).

Usage:
  python scripts/dump-template.py                      # templates/tikmi/2025/*.xlsx -> templates/tikmi/2025/_dump/
  python scripts/dump-template.py --out DIR FILE.xlsx  # any workbook (e.g. a real PJP submission) -> DIR

Never point --out inside the repo for a real PJP submission: those are PJP
data and must not be committed.

Requires openpyxl (pip install openpyxl).
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DIR = REPO / "templates" / "tikmi" / "2025"


def plain(value):
    """A cell value as JSON: dates as ISO strings, formulas as their text."""
    if isinstance(value, ArrayFormula):
        return {"arrayFormula": value.text, "ref": value.ref}
    if isinstance(value, DataTableFormula):
        return {"dataTableFormula": str(value)}
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value


def is_formula(value):
    return isinstance(value, (ArrayFormula, DataTableFormula)) or (isinstance(value, str) and value.startswith("="))


def dump_workbook(path: Path) -> dict:
    wb_f = openpyxl.load_workbook(path, data_only=False)
    wb_v = openpyxl.load_workbook(path, data_only=True)
    out = {
        "file": path.name,
        "sheetOrder": wb_f.sheetnames,
        "definedNames": {name: dn.attr_text for name, dn in wb_f.defined_names.items()},
        "sheets": {},
    }
    for ws in wb_f.worksheets:
        wv = wb_v[ws.title]
        cells = {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is None:
                    continue
                entry = {}
                if is_formula(c.value):
                    entry["f"] = plain(c.value)
                    cached = wv[c.coordinate].value
                    entry["v"] = plain(cached)
                else:
                    entry["v"] = plain(c.value)
                if c.number_format and c.number_format != "General":
                    entry["fmt"] = c.number_format
                if c.comment:
                    entry["comment"] = c.comment.text
                cells[c.coordinate] = entry
        validations = []
        for dv in ws.data_validations.dataValidation:
            validations.append({
                "sqref": str(dv.sqref),
                "type": dv.type,
                "operator": dv.operator,
                "formula1": dv.formula1,
                "formula2": dv.formula2,
                "allowBlank": dv.allow_blank,
                "prompt": dv.prompt,
                "error": dv.error,
            })
        hidden_rows = [r for r, d in ws.row_dimensions.items() if d.hidden]
        hidden_cols = []
        for key, d in ws.column_dimensions.items():
            if d.hidden:
                # A dimension can span min..max columns.
                hidden_cols += [get_column_letter(i) for i in range(d.min or 0, (d.max or 0) + 1) if i > 0] or [key]
        out["sheets"][ws.title] = {
            "state": ws.sheet_state,
            "dimensions": ws.dimensions,
            "maxRow": ws.max_row,
            "maxColumn": ws.max_column,
            "freezePanes": ws.freeze_panes,
            "merged": [str(m) for m in ws.merged_cells.ranges],
            "hiddenRows": sorted(hidden_rows),
            "hiddenColumns": sorted(set(hidden_cols)),
            "dataValidations": validations,
            "conditionalFormattingRanges": [str(cf.sqref) for cf in ws.conditional_formatting],
            "cellCount": len(cells),
            "formulaCount": sum(1 for e in cells.values() if "f" in e),
            "cells": cells,
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    files = args.files or sorted(DEFAULT_DIR.glob("*.xlsx"))
    out_dir = args.out or DEFAULT_DIR / "_dump"
    out_dir.mkdir(parents=True, exist_ok=True)
    if not files:
        sys.exit(f"No .xlsx files in {DEFAULT_DIR}")
    for f in files:
        data = dump_workbook(f)
        target = out_dir / (f.stem + ".json")
        target.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        summary = ", ".join(f"{name} [{s['state']}] {s['cellCount']}c/{s['formulaCount']}f" for name, s in data["sheets"].items())
        print(f"{f.name} -> {target.name}\n  {summary}")


if __name__ == "__main__":
    main()
