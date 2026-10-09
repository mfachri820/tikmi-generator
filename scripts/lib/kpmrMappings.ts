import { and, eq, like } from "drizzle-orm";
import { fieldMappings, type Db } from "@ira/db";
import { kpmrFieldMappings2027 } from "../../packages/scoring/config/kpmr-form-2027";

/**
 * Replaces a template version's KPMR `field_mappings` (targets in
 * "B. KPMR 2025!") with the 2027 form's, in one transaction; C2 and other
 * mappings are untouched. `remove` only deletes.
 */
export async function replaceKpmrMappings(db: Db, templateVersionId: string, { remove = false } = {}) {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(fieldMappings)
      .where(and(eq(fieldMappings.templateVersionId, templateVersionId), like(fieldMappings.targetCell, "B. KPMR 2025!%")))
      .returning({ id: fieldMappings.id });
    if (remove) return { removed: deleted.length, added: 0 };

    const rows = kpmrFieldMappings2027().map((m) => ({ templateVersionId, ...m }));
    await tx.insert(fieldMappings).values(rows);
    return { removed: deleted.length, added: rows.length };
  });
}
