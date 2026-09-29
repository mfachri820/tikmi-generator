import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import { createDb, yjsSnapshots } from "@ira/db";
import { desc, eq } from "drizzle-orm";

/** Document name convention: "workbook:<workbooks.id>". */
function workbookIdFromDocumentName(documentName: string): string {
  const [, workbookId] = documentName.split(":");
  if (!workbookId) {
    throw new Error(`Expected "workbook:<id>", got "${documentName}"`);
  }
  return workbookId;
}

const db = createDb();

const server = Server.configure({
  port: Number(process.env.PORT ?? 1234),
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const workbookId = workbookIdFromDocumentName(documentName);
        const [latest] = await db
          .select()
          .from(yjsSnapshots)
          .where(eq(yjsSnapshots.workbookId, workbookId))
          .orderBy(desc(yjsSnapshots.version))
          .limit(1);
        return latest ? Buffer.from(latest.stateBlob, "base64") : null;
      },
      store: async ({ documentName, state }) => {
        const workbookId = workbookIdFromDocumentName(documentName);
        const [latest] = await db
          .select({ version: yjsSnapshots.version })
          .from(yjsSnapshots)
          .where(eq(yjsSnapshots.workbookId, workbookId))
          .orderBy(desc(yjsSnapshots.version))
          .limit(1);
        await db.insert(yjsSnapshots).values({
          workbookId,
          stateBlob: Buffer.from(state).toString("base64"),
          version: (latest?.version ?? 0) + 1,
        });
      },
    }),
  ],
});

server.listen();
