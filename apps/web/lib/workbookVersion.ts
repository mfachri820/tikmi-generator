import { sql } from "drizzle-orm";
import type { Db } from "@ira/db";

/**
 * A workbook's version: when anything in it last changed -- the workbook row,
 * any of its own cells, or any of its period's shared cells. Saves send it back
 * to detect conflicts and open pages poll it to notice others' edits. Derived
 * rather than stored, so cells written by any path (or before this existed)
 * always count. One query on the indexed workbook/period columns.
 */
export async function workbookVersion(db: Db, workbookId: string): Promise<Date | null> {
  const [row] = await db.execute<{ version: Date | string | null }>(sql`
    select greatest(
      w.updated_at,
      (select max(c.updated_at) from cell_inputs c where c.workbook_id = w.id),
      (select max(s.updated_at) from shared_cell_inputs s where s.period_id = w.period_id)
    ) as version
    from workbooks w
    where w.id = ${workbookId}
  `);
  return row?.version ? new Date(row.version) : null;
}
