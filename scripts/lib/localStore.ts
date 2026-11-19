import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { FileStore } from "@tikmi/ingest";

/**
 * Development file store for scripts: the same folder the web app uses when no
 * Supabase Storage is configured (repo/.tikmi-files, gitignored), so files a
 * script ingests can be downloaded in the app.
 */
export function localStore(root = resolve(process.env.TIKMI_LOCAL_FILES ?? ".tikmi-files")): FileStore {
  return {
    async put(key, bytes) {
      const p = resolve(root, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, bytes);
    },
    async get(key) {
      try {
        return await readFile(resolve(root, key));
      } catch {
        return null;
      }
    },
  };
}
