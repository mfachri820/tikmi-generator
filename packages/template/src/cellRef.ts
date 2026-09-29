/** A template address such as "C2. Form PJP LR!C6": sheet name + cell address. */
export interface CellRef {
  sheet: string;
  address: string;
}

export function parseCellRef(ref: string): CellRef {
  const separatorIndex = ref.lastIndexOf("!");
  if (separatorIndex === -1) {
    throw new Error(`Cell ref "${ref}" is missing a "Sheet!Address" separator`);
  }
  return {
    sheet: ref.slice(0, separatorIndex),
    address: ref.slice(separatorIndex + 1),
  };
}

export function formatCellRef(ref: CellRef): string {
  return `${ref.sheet}!${ref.address}`;
}
